import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import process from "node:process";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

const ffmpegPath = require("ffmpeg-static") as string | null;

type SpeakerRole = "doctor" | "patient";

type MicConfig = {
  role: SpeakerRole;
  avFoundationAudioIndex: string;
};

type ActiveStream = {
  role: SpeakerRole;
  ffmpeg: ChildProcess;
  call: grpc.ClientDuplexStream<unknown, unknown>;
  endCall: () => void;
};

const RIVA_ADDRESS = process.env.RIVA_ADDRESS ?? "192.168.1.205:50051";
const RIVA_LANGUAGE_CODE = process.env.RIVA_LANGUAGE_CODE ?? "es-en-US";

const MIC_CONFIGS: MicConfig[] = [
  {
    role: "doctor",
    avFoundationAudioIndex: process.env.DOCTOR_AUDIO_INDEX ?? "0",
  },
  {
    role: "patient",
    avFoundationAudioIndex: process.env.PATIENT_AUDIO_INDEX ?? "1",
  },
];

if (!ffmpegPath) {
  throw new Error("ffmpeg-static did not provide an ffmpeg binary path.");
}
const resolvedFfmpegPath = ffmpegPath;

const PROTO_DIR = path.resolve(__dirname, "../../protos");
const PROTO_PATH = path.join(PROTO_DIR, "riva_asr.proto");

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [PROTO_DIR],
});

const proto = grpc.loadPackageDefinition(packageDef) as any;
const RivaSpeechRecognition = proto.nvidia.riva.asr.RivaSpeechRecognition;

function startRivaStream(config: MicConfig): ActiveStream {
  const client = new RivaSpeechRecognition(
    RIVA_ADDRESS,
    grpc.credentials.createInsecure()
  );
  const call = client.StreamingRecognize() as grpc.ClientDuplexStream<
    unknown,
    unknown
  >;
  let callEnded = false;
  const endCall = () => {
    if (!callEnded) {
      callEnded = true;
      call.end();
    }
  };

  call.write({
    streaming_config: {
      config: {
        encoding: "LINEAR_PCM",
        sample_rate_hertz: 16000,
        language_code: RIVA_LANGUAGE_CODE,
        max_alternatives: 1,
        enable_automatic_punctuation: true,
      },
      interim_results: false,
    },
  });

  const ffmpeg = spawn(resolvedFfmpegPath, [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-f",
    "avfoundation",
    "-i",
    `:${config.avFoundationAudioIndex}`,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-f",
    "s16le",
    "pipe:1",
  ]);

  ffmpeg.stdout?.on("data", (chunk: Buffer) => {
    if (!callEnded) {
      call.write({ audio_content: chunk });
    }
  });

  ffmpeg.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) {
      console.error(`[${config.role}] ffmpeg: ${text}`);
    }
  });

  ffmpeg.on("error", (error: Error) => {
    console.error(`[${config.role}] ffmpeg error:`, error.message);
    endCall();
  });

  ffmpeg.on("close", (code: number | null) => {
    console.log(`[${config.role}] ffmpeg closed with code ${code}`);
    endCall();
  });

  call.on("data", (response: any) => {
    if (callEnded) return;

    for (const result of response.results ?? []) {
      const alt = result.alternatives?.[0];
      const transcript = alt?.transcript?.trim();
      if (!transcript) continue;

      const label = result.is_final ? "FINAL" : "partial";
      console.log(`[${config.role}] ${label}: ${transcript}`);
    }
  });

  call.on("error", (error: Error) => {
    console.error(`[${config.role}] Riva error:`, error.message);
    callEnded = true;
  });

  call.on("end", () => {
    callEnded = true;
    console.log(`[${config.role}] Riva stream ended`);
  });

  return { role: config.role, ffmpeg, call, endCall };
}

function stopStream(stream: ActiveStream): void {
  if (!stream.ffmpeg.killed) {
    stream.ffmpeg.kill("SIGTERM");
  }
  stream.endCall();
}

console.log("Starting dual mic Riva smoke test");
console.log(`RIVA_ADDRESS=${RIVA_ADDRESS}`);
console.log(`RIVA_LANGUAGE_CODE=${RIVA_LANGUAGE_CODE}`);
console.log("AVFoundation mapping:");
for (const mic of MIC_CONFIGS) {
  console.log(`- ${mic.role}: audio index ${mic.avFoundationAudioIndex}`);
}
console.log("");
console.log("Speak into each microphone. Press Ctrl+C to stop.");

const streams = MIC_CONFIGS.map(startRivaStream);

const stopAll = () => {
  console.log("\nStopping streams...");
  for (const stream of streams) {
    stopStream(stream);
  }
};

process.on("SIGINT", () => {
  stopAll();
  setTimeout(() => process.exit(0), 500);
});
