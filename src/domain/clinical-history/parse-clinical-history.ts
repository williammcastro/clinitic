import {
  ClinicalHistorySchema,
  PartialClinicalHistorySchema,
  type ClinicalHistory,
} from "./schema";
import { normalizeSlotValue } from "./slot-normalization";

type ParseClinicalHistoryOptions = {
  onIgnoredNullOverwrite?: (event: {
    slot: keyof ClinicalHistory;
    existing: string;
  }) => void;
};

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

export function parseClinicalHistory(
  content: string,
  currentState: ClinicalHistory,
  options: ParseClinicalHistoryOptions = {}
): ClinicalHistory {
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
  const merged: ClinicalHistory = { ...currentState };

  for (const [key, value] of Object.entries(partial) as [
    keyof ClinicalHistory,
    string | null,
  ][]) {
    if (value === null && merged[key] !== null) {
      options.onIgnoredNullOverwrite?.({
        slot: key,
        existing: merged[key],
      });
      continue;
    }

    merged[key] = normalizeSlotValue(key, value);
  }

  return ClinicalHistorySchema.parse(merged);
}
