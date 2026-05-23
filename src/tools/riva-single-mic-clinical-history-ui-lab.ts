/**
 * Lab 06 - Single microphone clinical-history slot extraction UI.
 *
 * Captures one microphone, transcribes with Riva, normalizes common clinical
 * terms, sends final transcripts to Ollama, and updates structured clinical
 * history slots in a local browser UI. This lab is the current prototype for
 * progressively building the editable clinical-history document.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import process from "node:process";
import http from "node:http";
import axios from "axios";
import express from "express";
import { Server } from "socket.io";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { renderHtml } from "./ui/riva-single-mic-clinical-history-html";
import { applyClinicalFallbacks } from "../domain/clinical-history/clinical-fallbacks";
import { CLINICAL_HISTORY_SYSTEM_PROMPT } from "../domain/clinical-history/clinical-history-prompt";
import { parseClinicalHistory } from "../domain/clinical-history/parse-clinical-history";
import {
  emptyClinicalHistory,
  type ClinicalHistory,
} from "../domain/clinical-history/schema";
import { normalizeClinicalTerms } from "../domain/clinical-dictionaries/normalize-clinical-terms";

const ffmpegPath = require("ffmpeg-static") as string | null;

const PORT = Number(process.env.PORT ?? "3000");
const RIVA_ADDRESS = process.env.RIVA_ADDRESS ?? "192.168.1.205:50051";
const RIVA_LANGUAGE_CODE = process.env.RIVA_LANGUAGE_CODE ?? "es-en-US";
const AUDIO_INDEX = process.env.AUDIO_INDEX ?? "0";
const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL ?? "http://192.168.1.205:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "mistral-nemo:latest";

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

type LabStream = {
  ffmpeg: ChildProcess;
  endCall: () => void;
};

let activeStream: LabStream | null = null;
let clinicalHistory: ClinicalHistory = { ...emptyClinicalHistory };
let finalTranscriptLog: string[] = [];
let isExtracting = false;
const pendingFinals: string[] = [];

function logLab(message: string, data?: unknown): void {
  const suffix = data === undefined ? "" : ` ${JSON.stringify(data)}`;
  console.log(`[Lab06] ${message}${suffix}`);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    rivaAddress: RIVA_ADDRESS,
    rivaLanguageCode: RIVA_LANGUAGE_CODE,
    audioIndex: AUDIO_INDEX,
    ollamaBaseUrl: OLLAMA_BASE_URL,
    ollamaModel: OLLAMA_MODEL,
  });
});

app.get("/", (_req, res) => {
  res.type("html").send(renderHtml());
});

function applyClinicalTermCorrections(text: string): string {
  const result = normalizeClinicalTerms(text);

  if (result.text !== text) {
    logLab("clinical term correction", {
      original: text,
      corrected: result.text,
      corrections: result.corrections,
    });
  }

  return result.text;
}

async function extractClinicalHistory(finalText: string): Promise<void> {
  pendingFinals.push(finalText);
  if (isExtracting) return;

  isExtracting = true;
  while (pendingFinals.length > 0) {
    const latestFinal = pendingFinals.shift();
    if (!latestFinal) continue;

    const startedAt = Date.now();
    io.emit("clinical:status", { status: "extracting" });
    const extractionPayload = {
      current_slots: clinicalHistory,
      latest_final_transcript: latestFinal,
      accumulated_transcript: finalTranscriptLog.join("\n"),
    };
    logLab("clinical extraction request", extractionPayload);

    try {
      const response = await axios.post(
        `${OLLAMA_BASE_URL}/api/chat`,
        {
          model: OLLAMA_MODEL,
          stream: false,
          messages: [
            {
              role: "system",
              content: CLINICAL_HISTORY_SYSTEM_PROMPT,
            },
            {
              role: "user",
              content: JSON.stringify(extractionPayload),
            },
          ],
          options: {
            temperature: 0.1,
          },
        },
        {
          timeout: 120_000,
        }
      );

      const content = response.data?.message?.content;
      if (!content) {
        logLab("clinical extraction empty response");
        io.emit("clinical:error", { error: "Empty Ollama response" });
        continue;
      }

      logLab("clinical extraction raw response", { content });
      const previousClinicalHistory = clinicalHistory;
      clinicalHistory = applyClinicalFallbacks(
        parseClinicalHistory(content, previousClinicalHistory, {
          onIgnoredNullOverwrite: (event) =>
            logLab("ignored null overwrite", event),
        }),
        latestFinal,
        previousClinicalHistory
      );
      logLab("clinical extraction parsed state", clinicalHistory);
      io.emit("clinical:update", {
        state: clinicalHistory,
        elapsedMs: Date.now() - startedAt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logLab("clinical extraction error", { error: message });
      io.emit("clinical:error", { error: message });
    }
  }

  isExtracting = false;
  io.emit("clinical:status", { status: "idle" });
}

function startRivaStream(): LabStream {
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
      interim_results: true,
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
      io.emit("system:log", { level: "warn", message: `[ffmpeg] ${text}` });
    }
  });

  ffmpeg.on("error", (error: Error) => {
    io.emit("system:log", { level: "error", message: error.message });
    endCall();
  });

  ffmpeg.on("close", (code: number | null) => {
    io.emit("system:log", {
      level: "info",
      message: `[ffmpeg] closed with code ${code}`,
    });
    endCall();
  });

  call.on("data", (response: any) => {
    if (callEnded) return;

    for (const result of response.results ?? []) {
      const alt = result.alternatives?.[0];
      const transcript = alt?.transcript?.trim();
      if (!transcript) continue;

      if (result.is_final) {
        // Normalize common Riva clinical transcription errors before slot extraction.
        const correctedTranscript = applyClinicalTermCorrections(transcript);
        finalTranscriptLog.push(correctedTranscript);
        logLab("riva final transcript", {
          transcript,
          correctedTranscript:
            correctedTranscript === transcript ? undefined : correctedTranscript,
        });
        io.emit("transcript:final", {
          text: correctedTranscript,
          rawText: transcript,
          at: Date.now(),
        });
        void extractClinicalHistory(correctedTranscript);
      } else {
        io.emit("transcript:partial", { text: transcript, at: Date.now() });
      }
    }
  });

  call.on("error", (error: Error) => {
    callEnded = true;
    io.emit("system:log", { level: "error", message: `[Riva] ${error.message}` });
  });

  call.on("end", () => {
    callEnded = true;
    io.emit("system:log", { level: "info", message: "[Riva] stream ended" });
  });

  return { ffmpeg, endCall };
}

function stopStream(): void {
  if (!activeStream) return;
  if (!activeStream.ffmpeg.killed) {
    activeStream.ffmpeg.kill("SIGTERM");
  }
  activeStream.endCall();
  activeStream = null;
}

io.on("connection", (socket) => {
  socket.emit("connection:status", {
    connected: true,
    rivaAddress: RIVA_ADDRESS,
    rivaLanguageCode: RIVA_LANGUAGE_CODE,
    audioIndex: AUDIO_INDEX,
    ollamaBaseUrl: OLLAMA_BASE_URL,
    ollamaModel: OLLAMA_MODEL,
    recording: activeStream !== null,
  });
  socket.emit("clinical:update", { state: clinicalHistory, elapsedMs: 0 });

  socket.on("lab:start", () => {
    if (activeStream) return;
    activeStream = startRivaStream();
    io.emit("lab:status", { recording: true });
  });

  socket.on("lab:stop", () => {
    stopStream();
    io.emit("lab:status", { recording: false });
  });

  socket.on("lab:reset", () => {
    clinicalHistory = { ...emptyClinicalHistory };
    finalTranscriptLog = [];
    pendingFinals.length = 0;
    io.emit("clinical:update", { state: clinicalHistory, elapsedMs: 0 });
    io.emit("transcript:reset");
  });
});

server.listen(PORT, () => {
  console.log(`Lab 06 UI listening at http://localhost:${PORT}`);
  console.log(`RIVA_ADDRESS=${RIVA_ADDRESS}`);
  console.log(`RIVA_LANGUAGE_CODE=${RIVA_LANGUAGE_CODE}`);
  console.log(`AUDIO_INDEX=${AUDIO_INDEX}`);
  console.log(`OLLAMA_BASE_URL=${OLLAMA_BASE_URL}`);
  console.log(`OLLAMA_MODEL=${OLLAMA_MODEL}`);
});

process.on("SIGINT", () => {
  stopStream();
  server.close(() => process.exit(0));
});
