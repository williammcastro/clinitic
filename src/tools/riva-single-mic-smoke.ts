import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import process from "node:process";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

const ffmpegPath = require("ffmpeg-static") as string | null;

const RIVA_ADDRESS = process.env.RIVA_ADDRESS ?? "192.168.1.205:50051";
const RIVA_LANGUAGE_CODE = process.env.RIVA_LANGUAGE_CODE ?? "es-en-US";
const AUDIO_INDEX = process.env.AUDIO_INDEX ?? "1";

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

function startRivaStream(): {
  ffmpeg: ChildProcess;
  endCall: () => void;
} {
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
    `:${AUDIO_INDEX}`,
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
      console.error(`[ffmpeg] ${text}`);
    }
  });

  ffmpeg.on("error", (error: Error) => {
    console.error("[ffmpeg] error:", error.message);
    endCall();
  });

  ffmpeg.on("close", (code: number | null) => {
    console.log(`[ffmpeg] closed with code ${code}`);
    endCall();
  });

  call.on("data", (response: any) => {
    if (callEnded) return;

    for (const result of response.results ?? []) {
      const alt = result.alternatives?.[0];
      const transcript = alt?.transcript?.trim();
      if (!transcript) continue;

      const label = result.is_final ? "FINAL" : "partial";
      console.log(`[${label}] ${transcript}`);
    }
  });

  call.on("error", (error: Error) => {
    console.error("[Riva] error:", error.message);
    callEnded = true;
  });

  call.on("end", () => {
    callEnded = true;
    console.log("[Riva] stream ended");
  });

  return { ffmpeg, endCall };
}

console.log("Starting single mic Riva smoke test");
console.log(`RIVA_ADDRESS=${RIVA_ADDRESS}`);
console.log(`RIVA_LANGUAGE_CODE=${RIVA_LANGUAGE_CODE}`);
console.log(`AVFoundation audio index=${AUDIO_INDEX}`);
console.log("");
console.log("Speak into the microphone. Press Ctrl+C to stop.");

const stream = startRivaStream();

const stop = () => {
  console.log("\nStopping stream...");
  if (!stream.ffmpeg.killed) {
    stream.ffmpeg.kill("SIGTERM");
  }
  stream.endCall();
};

process.on("SIGINT", () => {
  stop();
  setTimeout(() => process.exit(0), 500);
});
