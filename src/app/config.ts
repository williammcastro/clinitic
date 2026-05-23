import path from "node:path";
import process from "node:process";

const ffmpegPath = require("ffmpeg-static") as string | null;

if (!ffmpegPath) {
  throw new Error("ffmpeg-static did not provide an ffmpeg binary path.");
}

export const appConfig = {
  port: Number(process.env.PORT ?? "3000"),
  rivaAddress: process.env.RIVA_ADDRESS ?? "192.168.1.205:50051",
  rivaLanguageCode: process.env.RIVA_LANGUAGE_CODE ?? "es-en-US",
  audioIndex: process.env.AUDIO_INDEX ?? "0",
  ollamaBaseUrl:
    process.env.OLLAMA_BASE_URL ?? "http://192.168.1.205:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "mistral-nemo:latest",
  ffmpegPath,
  protoDir: path.resolve(__dirname, "../../protos"),
  protoPath: path.resolve(__dirname, "../../protos/riva_asr.proto"),
};

export type AppConfig = typeof appConfig;
