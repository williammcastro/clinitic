import http from "node:http";
import process from "node:process";
import express from "express";
import { Server } from "socket.io";
import { appConfig } from "./config";
import { ConsultationSession } from "./consultation-session";
import { renderHtml } from "./ui/clinical-history-html";
import { ClinicalHistoryExtractor } from "../domain/clinical-history/clinical-history-extractor";
import { normalizeClinicalTerms } from "../domain/clinical-dictionaries/normalize-clinical-terms";
import {
  RivaMicTranscriber,
  type RivaMicTranscriptionStream,
} from "../infrastructure/riva/riva-mic-transcriber";

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const session = new ConsultationSession();
const transcriber = new RivaMicTranscriber({
  ffmpegPath: appConfig.ffmpegPath,
  protoDir: appConfig.protoDir,
  protoPath: appConfig.protoPath,
  rivaAddress: appConfig.rivaAddress,
  languageCode: appConfig.rivaLanguageCode,
  audioIndex: appConfig.audioIndex,
});
const clinicalHistoryExtractor = new ClinicalHistoryExtractor({
  ollamaBaseUrl: appConfig.ollamaBaseUrl,
  ollamaModel: appConfig.ollamaModel,
  log: logApp,
});

let activeStream: RivaMicTranscriptionStream | null = null;
let isExtracting = false;
const pendingFinals: string[] = [];

function logApp(message: string, data?: unknown): void {
  const suffix = data === undefined ? "" : ` ${JSON.stringify(data)}`;
  console.log(`[App] ${message}${suffix}`);
}

function normalizeTranscript(transcript: string): string {
  const result = normalizeClinicalTerms(transcript);

  if (result.text !== transcript) {
    logApp("clinical term correction", {
      original: transcript,
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

    io.emit("clinical:status", { status: "extracting" });

    try {
      const result = await clinicalHistoryExtractor.extract(
        session.createExtractionPayload(latestFinal)
      );
      session.clinicalHistory = result.state;
      io.emit("clinical:update", {
        state: session.clinicalHistory,
        elapsedMs: result.elapsedMs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logApp("clinical extraction error", { error: message });
      io.emit("clinical:error", { error: message });
    }
  }

  isExtracting = false;
  io.emit("clinical:status", { status: "idle" });
}

function startTranscription(): void {
  if (activeStream) return;

  activeStream = transcriber.start({
    onPartialTranscript: (transcript) => {
      io.emit("transcript:partial", { text: transcript, at: Date.now() });
    },
    onFinalTranscript: (transcript) => {
      // Normalize common Riva clinical transcription errors before slot extraction.
      const correctedTranscript = normalizeTranscript(transcript);
      session.addFinalTranscript(correctedTranscript);
      logApp("riva final transcript", {
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
    },
    onSystemLog: (event) => {
      io.emit("system:log", event);
    },
  });

  io.emit("lab:status", { recording: true });
}

function stopTranscription(): void {
  if (!activeStream) return;
  activeStream.stop();
  activeStream = null;
  io.emit("lab:status", { recording: false });
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    rivaAddress: appConfig.rivaAddress,
    rivaLanguageCode: appConfig.rivaLanguageCode,
    audioIndex: appConfig.audioIndex,
    ollamaBaseUrl: appConfig.ollamaBaseUrl,
    ollamaModel: appConfig.ollamaModel,
  });
});

app.get("/", (_req, res) => {
  res.type("html").send(renderHtml());
});

io.on("connection", (socket) => {
  socket.emit("connection:status", {
    connected: true,
    rivaAddress: appConfig.rivaAddress,
    rivaLanguageCode: appConfig.rivaLanguageCode,
    audioIndex: appConfig.audioIndex,
    ollamaBaseUrl: appConfig.ollamaBaseUrl,
    ollamaModel: appConfig.ollamaModel,
    recording: activeStream !== null,
  });
  socket.emit("clinical:update", {
    state: session.clinicalHistory,
    elapsedMs: 0,
  });

  socket.on("lab:start", startTranscription);

  socket.on("lab:stop", stopTranscription);

  socket.on("lab:reset", () => {
    session.reset();
    pendingFinals.length = 0;
    io.emit("clinical:update", {
      state: session.clinicalHistory,
      elapsedMs: 0,
    });
    io.emit("transcript:reset");
  });
});

server.listen(appConfig.port, () => {
  console.log(`Clinitic app listening at http://localhost:${appConfig.port}`);
  console.log(`RIVA_ADDRESS=${appConfig.rivaAddress}`);
  console.log(`RIVA_LANGUAGE_CODE=${appConfig.rivaLanguageCode}`);
  console.log(`AUDIO_INDEX=${appConfig.audioIndex}`);
  console.log(`OLLAMA_BASE_URL=${appConfig.ollamaBaseUrl}`);
  console.log(`OLLAMA_MODEL=${appConfig.ollamaModel}`);
});

process.on("SIGINT", () => {
  stopTranscription();
  server.close(() => process.exit(0));
});
