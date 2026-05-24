import {
  ClinicalHistorySchema,
  PartialClinicalHistorySchema,
  type ClinicalHistory,
} from "./schema";
import {
  appendSlotValue,
  normalizeSlotValue,
} from "./slot-normalization";

type ParseClinicalHistoryOptions = {
  onIgnoredNullOverwrite?: (event: {
    slot: keyof ClinicalHistory;
    existing: string;
  }) => void;
};

const additiveSlots = new Set<keyof ClinicalHistory>([
  "past_medical_history",
  "surgeries",
  "allergies",
  "current_medications",
  "family_history",
  "review_of_systems",
]);

function extractJsonObject(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    const firstBrace = content.indexOf("{");
    const lastBrace = findBalancedObjectEnd(content, firstBrace);
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new Error("Ollama response does not contain a JSON object.");
    }

    return JSON.parse(content.slice(firstBrace, lastBrace + 1));
  }
}

function findBalancedObjectEnd(content: string, startIndex: number): number {
  if (startIndex < 0) return -1;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < content.length; index += 1) {
    const char = content[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
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

  const partial = PartialClinicalHistorySchema.parse(
    mergeDuplicateSlotValuesFromRawContent(candidate, content)
  );
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

    const normalizedValue = normalizeSlotValue(key, value);
    if (
      normalizedValue !== null &&
      additiveSlots.has(key) &&
      merged[key] !== null
    ) {
      appendSlotValue(merged, key, normalizedValue);
      continue;
    }

    merged[key] = normalizedValue;
  }

  return ClinicalHistorySchema.parse(merged);
}

function mergeDuplicateSlotValuesFromRawContent(
  candidate: unknown,
  content: string
): unknown {
  if (typeof candidate !== "object" || candidate === null) {
    return candidate;
  }

  const mergedCandidate = { ...(candidate as Record<string, unknown>) };

  for (const slot of additiveSlots) {
    const values = collectRawStringValuesForKey(content, slot);
    if (values.length > 1) {
      mergedCandidate[slot] = values.join("; ");
    }
  }

  return mergedCandidate;
}

function collectRawStringValuesForKey(content: string, key: string): string[] {
  const values: string[] = [];
  const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "g");
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    values.push(match[1].replace(/\\"/g, '"'));
  }

  return values;
}
