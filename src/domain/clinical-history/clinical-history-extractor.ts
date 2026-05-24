import axios from "axios";
import { applyClinicalFallbacks } from "./clinical-fallbacks";
import { CLINICAL_HISTORY_SYSTEM_PROMPT } from "./clinical-history-prompt";
import { hasClinicalSignal } from "./clinical-signal";
import { parseClinicalHistory } from "./parse-clinical-history";
import type { ClinicalHistory } from "./schema";

export type ClinicalHistoryExtractionPayload = {
  current_slots: ClinicalHistory;
  latest_final_transcript: string;
  accumulated_transcript: string;
};

export type ClinicalHistoryExtractorOptions = {
  ollamaBaseUrl: string;
  ollamaModel: string;
  log?: (message: string, data?: unknown) => void;
};

export type ClinicalHistoryExtractionResult = {
  state: ClinicalHistory;
  elapsedMs: number;
};

export class ClinicalHistoryExtractor {
  constructor(private readonly options: ClinicalHistoryExtractorOptions) {}

  async extract(
    payload: ClinicalHistoryExtractionPayload
  ): Promise<ClinicalHistoryExtractionResult> {
    const startedAt = Date.now();
    this.options.log?.("clinical extraction request", payload);

    if (!hasClinicalSignal(payload.latest_final_transcript)) {
      this.options.log?.("clinical extraction skipped", {
        reason: "latest transcript has no clinical signal",
        latest_final_transcript: payload.latest_final_transcript,
      });

      return {
        state: payload.current_slots,
        elapsedMs: Date.now() - startedAt,
      };
    }

    const response = await axios.post(
      `${this.options.ollamaBaseUrl}/api/chat`,
      {
        model: this.options.ollamaModel,
        stream: false,
        messages: [
          {
            role: "system",
            content: CLINICAL_HISTORY_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: JSON.stringify(payload),
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
      throw new Error("Empty Ollama response");
    }

    this.options.log?.("clinical extraction raw response", { content });
    const previousState = payload.current_slots;
    let parsedState = previousState;

    try {
      parsedState = parseClinicalHistory(content, previousState, {
        onIgnoredNullOverwrite: (event) =>
          this.options.log?.("ignored null overwrite", event),
      });
    } catch (error) {
      this.options.log?.("clinical extraction parse error", {
        error: error instanceof Error ? error.message : String(error),
        fallback: "using previous state and applying transcript fallbacks",
      });
    }

    const state = applyClinicalFallbacks(
      parsedState,
      payload.latest_final_transcript,
      previousState
    );

    this.options.log?.("clinical extraction parsed state", state);

    return {
      state,
      elapsedMs: Date.now() - startedAt,
    };
  }
}
