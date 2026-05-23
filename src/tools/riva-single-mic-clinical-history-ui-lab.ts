import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import process from "node:process";
import http from "node:http";
import axios from "axios";
import express from "express";
import { Server } from "socket.io";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { z } from "zod";

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

const slotSchema = z.preprocess((value) => {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) {
    const items = value
      .filter((item) => item !== undefined && item !== null)
      .map((item) => String(item).trim())
      .filter(Boolean);
    return items.length > 0 ? items.join("; ") : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return value;
}, z.string().nullable());
const ClinicalHistorySchema = z.object({
  age: slotSchema,
  sex: slotSchema,
  chief_complaint: slotSchema,
  current_illness: slotSchema,
  past_medical_history: slotSchema,
  surgeries: slotSchema,
  allergies: slotSchema,
  current_medications: slotSchema,
  family_history: slotSchema,
  review_of_systems: slotSchema,
  physical_exam: slotSchema,
  assessment: slotSchema,
});
const PartialClinicalHistorySchema = ClinicalHistorySchema.partial();

type ClinicalHistory = z.infer<typeof ClinicalHistorySchema>;

type LabStream = {
  ffmpeg: ChildProcess;
  endCall: () => void;
};

const emptyClinicalHistory: ClinicalHistory = {
  age: null,
  sex: null,
  chief_complaint: null,
  current_illness: null,
  past_medical_history: null,
  surgeries: null,
  allergies: null,
  current_medications: null,
  family_history: null,
  review_of_systems: null,
  physical_exam: null,
  assessment: null,
};

let activeStream: LabStream | null = null;
let clinicalHistory: ClinicalHistory = { ...emptyClinicalHistory };
let finalTranscriptLog: string[] = [];
let isExtracting = false;
const pendingFinals: string[] = [];

function logLab(message: string, data?: unknown): void {
  const suffix = data === undefined ? "" : ` ${JSON.stringify(data)}`;
  console.log(`[Lab06] ${message}${suffix}`);
  io.emit("debug:log", {
    at: new Date().toISOString(),
    message,
    data,
  });
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

function extractJsonObject(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const firstBrace = content.indexOf("{");
    const lastBrace = content.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("Ollama response does not contain a JSON object.");
    }

    return JSON.parse(content.slice(firstBrace, lastBrace + 1));
  }
}

function parseClinicalHistory(content: string): ClinicalHistory {
  const parsed = extractJsonObject(content);
  const candidate =
    typeof parsed === "object" &&
    parsed !== null &&
    "current_slots" in parsed &&
    typeof (parsed as { current_slots?: unknown }).current_slots === "object" &&
    (parsed as { current_slots?: unknown }).current_slots !== null
      ? (parsed as { current_slots: unknown }).current_slots
      : parsed;

  const partial = PartialClinicalHistorySchema.parse(candidate);
  const merged: ClinicalHistory = { ...clinicalHistory };

  for (const [key, value] of Object.entries(partial) as [
    keyof ClinicalHistory,
    string | null,
  ][]) {
    if (value === null && merged[key] !== null) {
      logLab("ignored null overwrite", {
        slot: key,
        existing: merged[key],
      });
      continue;
    }

    merged[key] = value;
  }

  return ClinicalHistorySchema.parse(merged);
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
              content: [
                "Eres un extractor de historia clinica.",
                "Recibiras la transcripcion acumulada de una entrevista medica en espanol y el estado actual de slots.",
                "Actualiza los slots solo con informacion dicha explicitamente.",
                "No inventes datos.",
                "Si un dato no esta presente, usa null.",
                "Si un slot ya tenia valor y no hay contradiccion, conservalo.",
                "Nunca reemplaces un slot existente con null si el nuevo turno no contradice ese dato.",
                "Si el paciente menciona cirugia, operacion, apendice, apendicitis o apendicectomia, actualiza el slot surgeries.",
                "Devuelve solamente JSON valido, sin Markdown y sin explicaciones.",
                "Devuelve un objeto JSON plano. No anides la respuesta dentro de current_slots, slots, data ni ningun otro objeto.",
                "Puedes devolver solo los slots que cambian o todos los slots.",
                "Los slots validos son:",
                "age, sex, chief_complaint, current_illness, past_medical_history, surgeries, allergies, current_medications, family_history, review_of_systems, physical_exam, assessment.",
              ].join("\n"),
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
      clinicalHistory = parseClinicalHistory(content);
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
        finalTranscriptLog.push(transcript);
        logLab("riva final transcript", { transcript });
        io.emit("transcript:final", { text: transcript, at: Date.now() });
        void extractClinicalHistory(transcript);
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

function renderHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clinitic Lab 06</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #101417; color: #e7edf0; }
    header { padding: 18px 24px; border-bottom: 1px solid #263038; background: #151b20; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    h1 { font-size: 18px; margin: 0; }
    main { padding: 20px 24px; display: grid; grid-template-columns: 1fr 1.1fr; gap: 20px; }
    button { border: 1px solid #4f8cff; background: #2563eb; color: white; height: 36px; padding: 0 14px; border-radius: 6px; cursor: pointer; font-weight: 600; }
    button.secondary { background: #1b2329; color: #d8e0e4; border-color: #34414a; }
    .meta { font-size: 12px; color: #95a3ad; display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
    .panel { background: #151b20; border: 1px solid #263038; border-radius: 8px; min-height: 500px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 16px 40px rgba(0,0,0,0.22); }
    .panel h2 { font-size: 14px; margin: 0; padding: 12px 14px; border-bottom: 1px solid #263038; background: #1a2228; display: flex; justify-content: space-between; gap: 12px; }
    .stream { padding: 14px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
    .item { border-left: 3px solid #64717b; padding: 8px 10px; background: #1b2329; border-radius: 4px; color: #dce5e9; }
    .partial { color: #a8b4bc; }
    .final { border-left-color: #4f8cff; }
    .error { border-left-color: #ff6b6b; }
    .small { font-size: 12px; color: #95a3ad; margin-top: 4px; }
    .slots { padding: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; overflow: auto; }
    .slot { border: 1px solid #2a353d; border-radius: 8px; padding: 10px; background: #1b2329; min-height: 68px; }
    .slot label { display: block; font-size: 12px; color: #95a3ad; margin-bottom: 6px; }
    .slot div { font-size: 14px; line-height: 1.35; }
    .empty { color: #697780; font-style: italic; }
    .debug { grid-column: 1 / -1; min-height: 260px; }
    .debug pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; color: #b8c4cc; }
    @media (max-width: 950px) { main { grid-template-columns: 1fr; } header { align-items: flex-start; flex-direction: column; } .slots { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Clinitic Lab 06 - Clinical History Slots</h1>
      <div class="meta" id="meta">Connecting...</div>
    </div>
    <div>
      <button id="start">Start</button>
      <button id="stop" class="secondary">Stop</button>
      <button id="reset" class="secondary">Reset</button>
    </div>
  </header>
  <main>
    <section class="panel">
      <h2>Riva Transcription <span id="clinicalStatus" class="small"></span></h2>
      <div class="stream" id="transcripts"></div>
    </section>
    <section class="panel">
      <h2>Clinical History Slots <span id="latency" class="small"></span></h2>
      <div class="slots" id="slots"></div>
    </section>
    <section class="panel debug">
      <h2>Debug Log</h2>
      <div class="stream" id="debug"></div>
    </section>
  </main>
  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const meta = document.getElementById("meta");
    const transcripts = document.getElementById("transcripts");
    const slots = document.getElementById("slots");
    const debug = document.getElementById("debug");
    const latency = document.getElementById("latency");
    const clinicalStatus = document.getElementById("clinicalStatus");
    const start = document.getElementById("start");
    const stop = document.getElementById("stop");
    const reset = document.getElementById("reset");
    let partialNode = null;

    const slotLabels = {
      age: "Age",
      sex: "Sex",
      chief_complaint: "Chief complaint",
      current_illness: "Current illness",
      past_medical_history: "Past medical history",
      surgeries: "Surgeries",
      allergies: "Allergies",
      current_medications: "Current medications",
      family_history: "Family history",
      review_of_systems: "Review of systems",
      physical_exam: "Physical exam",
      assessment: "Assessment"
    };

    function addTranscript(className, text, detail) {
      const node = document.createElement("div");
      node.className = "item " + className;
      node.textContent = text;
      if (detail) {
        const small = document.createElement("div");
        small.className = "small";
        small.textContent = detail;
        node.appendChild(small);
      }
      transcripts.prepend(node);
      return node;
    }

    function renderSlots(state) {
      slots.innerHTML = "";
      for (const key of Object.keys(slotLabels)) {
        const slot = document.createElement("div");
        slot.className = "slot";
        const label = document.createElement("label");
        label.textContent = slotLabels[key];
        const value = document.createElement("div");
        const current = state[key];
        value.textContent = current || "Pending";
        if (!current) value.className = "empty";
        slot.appendChild(label);
        slot.appendChild(value);
        slots.appendChild(slot);
      }
    }

    function addDebug(event) {
      const node = document.createElement("div");
      node.className = "item partial";
      const pre = document.createElement("pre");
      pre.textContent = "[" + event.at + "] " + event.message + (event.data === undefined ? "" : "\\n" + JSON.stringify(event.data, null, 2));
      node.appendChild(pre);
      debug.prepend(node);
    }

    start.onclick = () => socket.emit("lab:start");
    stop.onclick = () => socket.emit("lab:stop");
    reset.onclick = () => socket.emit("lab:reset");

    socket.on("connection:status", (status) => {
      meta.textContent = [
        "Riva " + status.rivaAddress,
        "audio index " + status.audioIndex,
        "Ollama " + status.ollamaModel,
        status.recording ? "recording" : "stopped"
      ].join(" | ");
    });

    socket.on("lab:status", (status) => {
      addTranscript("partial", status.recording ? "Recording started" : "Recording stopped");
    });

    socket.on("transcript:partial", (event) => {
      if (!partialNode) partialNode = addTranscript("partial", event.text);
      partialNode.textContent = event.text;
    });

    socket.on("transcript:final", (event) => {
      partialNode = null;
      addTranscript("final", event.text, "FINAL");
    });

    socket.on("transcript:reset", () => {
      partialNode = null;
      transcripts.innerHTML = "";
      latency.textContent = "";
      clinicalStatus.textContent = "";
    });

    socket.on("clinical:status", (event) => {
      clinicalStatus.textContent = event.status === "extracting" ? "Extracting..." : "";
    });

    socket.on("clinical:update", (event) => {
      renderSlots(event.state);
      latency.textContent = event.elapsedMs ? event.elapsedMs + " ms" : "";
    });

    socket.on("clinical:error", (event) => {
      addTranscript("error", event.error, "clinical extraction error");
    });

    socket.on("debug:log", addDebug);

    socket.on("system:log", (event) => {
      addTranscript(event.level === "error" ? "error" : "partial", event.message);
    });
  </script>
</body>
</html>`;
}
