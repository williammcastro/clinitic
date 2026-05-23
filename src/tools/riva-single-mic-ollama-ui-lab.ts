import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import process from "node:process";
import http from "node:http";
import axios from "axios";
import express from "express";
import { Server } from "socket.io";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

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
let isSendingToOllama = false;
const pendingFinals: string[] = [];

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

async function sendFinalToOllama(text: string): Promise<void> {
  pendingFinals.push(text);
  if (isSendingToOllama) return;

  isSendingToOllama = true;
  while (pendingFinals.length > 0) {
    const transcript = pendingFinals.shift();
    if (!transcript) continue;

    const startedAt = Date.now();
    io.emit("llm:request", { text: transcript, startedAt });

    try {
      const response = await axios.post(
        `${OLLAMA_BASE_URL}/api/chat`,
        {
          model: OLLAMA_MODEL,
          stream: false,
          messages: [
            {
              role: "system",
              content:
                "Responde en espanol, de forma breve y clara. No inventes informacion.",
            },
            {
              role: "user",
              content: transcript,
            },
          ],
          options: {
            temperature: 0.2,
          },
        },
        {
          timeout: 120_000,
        }
      );

      const elapsedMs = Date.now() - startedAt;
      io.emit("llm:response", {
        text: transcript,
        response: response.data?.message?.content ?? "",
        elapsedMs,
      });
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      const message = error instanceof Error ? error.message : String(error);
      io.emit("llm:error", { text: transcript, error: message, elapsedMs });
    }
  }
  isSendingToOllama = false;
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
        io.emit("transcript:final", { text: transcript, at: Date.now() });
        void sendFinalToOllama(transcript);
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

  socket.on("lab:start", () => {
    if (activeStream) return;
    activeStream = startRivaStream();
    io.emit("lab:status", { recording: true });
  });

  socket.on("lab:stop", () => {
    stopStream();
    io.emit("lab:status", { recording: false });
  });
});

server.listen(PORT, () => {
  console.log(`Lab 05 UI listening at http://localhost:${PORT}`);
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
  <title>Clinitic Lab 05</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f7f4; color: #1f2933; }
    header { padding: 18px 24px; border-bottom: 1px solid #ddd8ce; background: #fffdfa; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    h1 { font-size: 18px; margin: 0; }
    main { padding: 20px 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    button { border: 1px solid #1f2933; background: #1f2933; color: white; height: 36px; padding: 0 14px; border-radius: 6px; cursor: pointer; font-weight: 600; }
    button.secondary { background: white; color: #1f2933; }
    .meta { font-size: 12px; color: #5c6670; display: flex; flex-wrap: wrap; gap: 10px; }
    .panel { background: white; border: 1px solid #ddd8ce; border-radius: 8px; min-height: 420px; display: flex; flex-direction: column; overflow: hidden; }
    .panel h2 { font-size: 14px; margin: 0; padding: 12px 14px; border-bottom: 1px solid #eee9df; background: #fffdfa; }
    .stream { padding: 14px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
    .item { border-left: 3px solid #8a948c; padding: 8px 10px; background: #faf9f5; border-radius: 4px; }
    .partial { color: #69737a; }
    .final { border-left-color: #2563eb; }
    .llm { border-left-color: #047857; }
    .error { border-left-color: #b42318; }
    .small { font-size: 12px; color: #69737a; margin-top: 4px; }
    @media (max-width: 900px) { main { grid-template-columns: 1fr; } header { align-items: flex-start; flex-direction: column; } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Clinitic Lab 05 - Riva + Ollama UI</h1>
      <div class="meta" id="meta">Connecting...</div>
    </div>
    <div>
      <button id="start">Start</button>
      <button id="stop" class="secondary">Stop</button>
    </div>
  </header>
  <main>
    <section class="panel">
      <h2>Riva Transcription</h2>
      <div class="stream" id="transcripts"></div>
    </section>
    <section class="panel">
      <h2>Ollama Responses</h2>
      <div class="stream" id="llm"></div>
    </section>
  </main>
  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const meta = document.getElementById("meta");
    const transcripts = document.getElementById("transcripts");
    const llm = document.getElementById("llm");
    const start = document.getElementById("start");
    const stop = document.getElementById("stop");
    let partialNode = null;

    function add(container, className, text, detail) {
      const node = document.createElement("div");
      node.className = "item " + className;
      node.textContent = text;
      if (detail) {
        const small = document.createElement("div");
        small.className = "small";
        small.textContent = detail;
        node.appendChild(small);
      }
      container.prepend(node);
      return node;
    }

    start.onclick = () => socket.emit("lab:start");
    stop.onclick = () => socket.emit("lab:stop");

    socket.on("connection:status", (status) => {
      meta.textContent = [
        "Riva " + status.rivaAddress,
        "audio index " + status.audioIndex,
        "Ollama " + status.ollamaModel,
        status.recording ? "recording" : "stopped"
      ].join(" | ");
    });

    socket.on("lab:status", (status) => {
      add(transcripts, "partial", status.recording ? "Recording started" : "Recording stopped");
    });

    socket.on("transcript:partial", (event) => {
      if (!partialNode) partialNode = add(transcripts, "partial", event.text);
      partialNode.textContent = event.text;
    });

    socket.on("transcript:final", (event) => {
      partialNode = null;
      add(transcripts, "final", event.text, "FINAL");
    });

    socket.on("llm:request", (event) => {
      add(llm, "partial", event.text, "sent to Ollama");
    });

    socket.on("llm:response", (event) => {
      add(llm, "llm", event.response, event.elapsedMs + " ms");
    });

    socket.on("llm:error", (event) => {
      add(llm, "error", event.error, event.elapsedMs + " ms");
    });

    socket.on("system:log", (event) => {
      add(transcripts, event.level === "error" ? "error" : "partial", event.message);
    });
  </script>
</body>
</html>`;
}
