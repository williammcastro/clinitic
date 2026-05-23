import { spawn, type ChildProcess } from "node:child_process";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

export type RivaMicTranscriberOptions = {
  ffmpegPath: string;
  protoDir: string;
  protoPath: string;
  rivaAddress: string;
  languageCode: string;
  audioIndex: string;
};

export type RivaMicTranscriptionHandlers = {
  onPartialTranscript: (transcript: string) => void;
  onFinalTranscript: (transcript: string) => void;
  onSystemLog: (event: { level: "info" | "warn" | "error"; message: string }) => void;
};

export type RivaMicTranscriptionStream = {
  stop: () => void;
};

export class RivaMicTranscriber {
  private readonly RivaSpeechRecognition: any;

  constructor(private readonly options: RivaMicTranscriberOptions) {
    const packageDef = protoLoader.loadSync(options.protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [options.protoDir],
    });

    const proto = grpc.loadPackageDefinition(packageDef) as any;
    this.RivaSpeechRecognition = proto.nvidia.riva.asr.RivaSpeechRecognition;
  }

  start(handlers: RivaMicTranscriptionHandlers): RivaMicTranscriptionStream {
    const client = new this.RivaSpeechRecognition(
      this.options.rivaAddress,
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
          language_code: this.options.languageCode,
          max_alternatives: 1,
          enable_automatic_punctuation: true,
        },
        interim_results: true,
      },
    });

    const ffmpeg = spawn(this.options.ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "warning",
      "-f",
      "avfoundation",
      "-i",
      `:${this.options.audioIndex}`,
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
        handlers.onSystemLog({ level: "warn", message: `[ffmpeg] ${text}` });
      }
    });

    ffmpeg.on("error", (error: Error) => {
      handlers.onSystemLog({ level: "error", message: error.message });
      endCall();
    });

    ffmpeg.on("close", (code: number | null) => {
      handlers.onSystemLog({
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
          handlers.onFinalTranscript(transcript);
        } else {
          handlers.onPartialTranscript(transcript);
        }
      }
    });

    call.on("error", (error: Error) => {
      callEnded = true;
      handlers.onSystemLog({
        level: "error",
        message: `[Riva] ${error.message}`,
      });
    });

    call.on("end", () => {
      callEnded = true;
      handlers.onSystemLog({ level: "info", message: "[Riva] stream ended" });
    });

    return {
      stop: () => {
        if (!ffmpeg.killed) {
          ffmpeg.kill("SIGTERM");
        }
        endCall();
      },
    };
  }
}
