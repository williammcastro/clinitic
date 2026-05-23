/**
 * Lab 04 - Single microphone Riva + Ollama basic chat latency test.
 *
 * Sends every final Riva transcript directly to Ollama as a simple chat turn
 * and prints the response plus timing in the terminal. This lab is intentionally
 * minimal so response latency can be evaluated without clinical extraction.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import process from "node:process";
import axios from "axios";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

const ffmpegPath = require("ffmpeg-static") as string | null;

const RIVA_ADDRESS = process.env.RIVA_ADDRESS ?? "192.168.1.205:50051";
const RIVA_LANGUAGE_CODE = process.env.RIVA_LANGUAGE_CODE ?? "es-en-US";
const AUDIO_INDEX = process.env.AUDIO_INDEX ?? "0";
const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL ?? "http://192.168.1.205:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "mistral:latest";

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

let isSendingToOllama = false;
const pendingMessages: string[] = [];

async function sendToOllama(text: string): Promise<void> {
  pendingMessages.push(text);
  if (isSendingToOllama) return;

  isSendingToOllama = true;
  while (pendingMessages.length > 0) {
    const message = pendingMessages.shift();
    if (!message) continue;

    const startedAt = Date.now();
    console.log(`[Ollama] request: ${message}`);

    try {
      const response = await axios.post(
        `${OLLAMA_BASE_URL}/api/chat`,
        {
          model: OLLAMA_MODEL,
          stream: false,
          messages: [
            {
              role: "user",
              content: message,
            },
          ],
        },
        {
          timeout: 120_000,
        }
      );

      const elapsedMs = Date.now() - startedAt;
      const content = response.data?.message?.content ?? "";
      console.log(`[Ollama] response (${elapsedMs} ms): ${content}`);
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Ollama] error (${elapsedMs} ms): ${message}`);
    }
  }
  isSendingToOllama = false;
}

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

      console.log(`[Riva FINAL] ${transcript}`);
      void sendToOllama(transcript);
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

console.log("Starting basic Riva + Ollama chat lab");
console.log(`RIVA_ADDRESS=${RIVA_ADDRESS}`);
console.log(`RIVA_LANGUAGE_CODE=${RIVA_LANGUAGE_CODE}`);
console.log(`AUDIO_INDEX=${AUDIO_INDEX}`);
console.log(`OLLAMA_BASE_URL=${OLLAMA_BASE_URL}`);
console.log(`OLLAMA_MODEL=${OLLAMA_MODEL}`);
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
