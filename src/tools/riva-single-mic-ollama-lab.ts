/**
 * Lab 03 - Single microphone Riva + Ollama clinical utterance extraction.
 *
 * Sends each final Riva transcript to Ollama and asks for a compact validated
 * JSON summary of the utterance. This lab checks the basic ASR-to-LLM pipeline
 * and schema validation without a browser interface.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import process from "node:process";
import axios from "axios";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { z } from "zod";

const ffmpegPath = require("ffmpeg-static") as string | null;

const RIVA_ADDRESS = process.env.RIVA_ADDRESS ?? "192.168.1.205:50051";
const RIVA_LANGUAGE_CODE = process.env.RIVA_LANGUAGE_CODE ?? "es-en-US";
const AUDIO_INDEX = process.env.AUDIO_INDEX ?? "0";
const OLLAMA_BASE_URL =
  process.env.OLLAMA_BASE_URL ?? "http://192.168.1.205:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "mistral:latest";

const OllamaClinicalUtteranceSchema = z.object({
  text: z.string(),
  summary: z.string(),
  possible_clinical_relevance: z.enum([
    "none",
    "symptom",
    "medication",
    "recommendation",
    "history",
    "procedure",
    "diagnosis",
    "follow_up",
    "other",
  ]),
  requires_doctor_review: z.boolean(),
});

type OllamaClinicalUtterance = z.infer<typeof OllamaClinicalUtteranceSchema>;

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

let pendingFinals: string[] = [];
let isProcessingFinal = false;

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

function parseOllamaResponse(content: string): OllamaClinicalUtterance {
  const parsed = extractJsonObject(content);
  return OllamaClinicalUtteranceSchema.parse(parsed);
}

async function sendFinalToOllama(transcript: string): Promise<void> {
  pendingFinals.push(transcript);
  if (isProcessingFinal) return;

  isProcessingFinal = true;
  while (pendingFinals.length > 0) {
    const nextTranscript = pendingFinals.shift();
    if (!nextTranscript) continue;

    console.log(`[Ollama] sending: ${nextTranscript}`);
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
                [
                  "Eres un asistente de laboratorio para transcripcion clinica.",
                  "Analiza una frase transcrita en espanol.",
                  "No inventes informacion.",
                  "Responde siempre en espanol.",
                  "Devuelve solamente un objeto JSON valido, sin Markdown, sin explicaciones y sin texto adicional.",
                  "El JSON debe cumplir exactamente este esquema:",
                  "{",
                  '  "text": string,',
                  '  "summary": string,',
                  '  "possible_clinical_relevance": "none" | "symptom" | "medication" | "recommendation" | "history" | "procedure" | "diagnosis" | "follow_up" | "other",',
                  '  "requires_doctor_review": boolean',
                  "}",
                  'Usa "none" cuando la frase no tenga relevancia clinica.',
                  "Marca requires_doctor_review como true si la frase contiene sintomas, medicamentos, antecedentes, diagnosticos, procedimientos, recomendaciones o seguimiento.",
                ].join("\n"),
            },
            {
              role: "user",
              content: nextTranscript,
            },
          ],
          options: {
            temperature: 0.1,
          },
        },
        {
          timeout: 60_000,
        }
      );

      const content = response.data?.message?.content;
      if (!content) {
        console.log("[Ollama] response: (empty response)");
        continue;
      }

      try {
        const validated = parseOllamaResponse(content);
        console.log(`[Ollama] validated: ${JSON.stringify(validated)}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[Ollama] invalid response: ${message}`);
        console.error(`[Ollama] raw response: ${content}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Ollama] error: ${message}`);
    }
  }
  isProcessingFinal = false;
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

      const label = result.is_final ? "FINAL" : "partial";
      console.log(`[Riva ${label}] ${transcript}`);

      if (result.is_final) {
        void sendFinalToOllama(transcript);
      }
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

console.log("Starting single mic Riva + Ollama lab");
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
