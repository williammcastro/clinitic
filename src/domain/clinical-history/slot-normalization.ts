import type { ClinicalHistory } from "./schema";

export function normalizeForMatch(value: string): string {
  return value
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function appendSlotValue(
  state: ClinicalHistory,
  slot: keyof ClinicalHistory,
  value: string
): void {
  const normalizedValue = normalizeForMatch(value);
  const current = state[slot];

  if (!current) {
    state[slot] = value;
    return;
  }

  if (!normalizeForMatch(current).includes(normalizedValue)) {
    state[slot] = `${current}; ${value}`;
  }
}

export function removeSlotValue(
  state: ClinicalHistory,
  slot: keyof ClinicalHistory,
  value: string
): void {
  const current = state[slot];
  if (!current) return;

  const normalizedValue = normalizeForMatch(value);
  const items = current
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => normalizeForMatch(item) !== normalizedValue);

  state[slot] = items.length > 0 ? items.join("; ") : null;
}

export function normalizeSlotValue(
  slot: keyof ClinicalHistory,
  value: string | null
): string | null {
  if (value === null) return null;
  const repairedValue = repairMojibake(value);

  if (slot !== "surgeries") {
    return repairedValue.trim() || null;
  }

  const items = repairedValue
    .split(/[;,]/)
    .map((item) => normalizeSurgeryItem(item))
    .filter((item): item is string => item !== null);

  const deduped: string[] = [];
  for (const item of items) {
    if (
      !deduped.some(
        (existing) => normalizeForMatch(existing) === normalizeForMatch(item)
      )
    ) {
      deduped.push(item);
    }
  }

  return deduped.length > 0 ? deduped.join("; ") : null;
}

export function normalizeSurgeryItem(value: string): string | null {
  const cleaned = repairMojibake(value)
    .trim()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ");
  if (!cleaned) return null;

  const normalized = normalizeForMatch(cleaned);

  if (
    /\b(cirugia knee|knee surgery|surgery knee|rodilla)\b/.test(normalized)
  ) {
    return "cirugía de rodilla";
  }
  if (/\b(appendectomy|apendicectomia|apendice|apendicitis)\b/.test(normalized)) {
    return "apendicectomía";
  }
  if (/\b(stomach surgery|cirugia stomach|estomago)\b/.test(normalized)) {
    return "cirugía de estómago";
  }
  if (
    /\b(bypa gastrico|by pas gastrico|by pass gastrico|bypass gastric|gastric bypass|bypass gastrico)\b/.test(
      normalized
    )
  ) {
    return "bypass gástrico";
  }

  return cleaned;
}

function repairMojibake(value: string): string {
  return value
    .replace(/Ã¡/g, "á")
    .replace(/Ã©/g, "é")
    .replace(/Ã­/g, "í")
    .replace(/Ã³/g, "ó")
    .replace(/Ãº/g, "ú")
    .replace(/Ã±/g, "ñ")
    .replace(/Ã¼/g, "ü")
    .replace(/Ã/g, "Á")
    .replace(/Ã‰/g, "É")
    .replace(/Ã/g, "Í")
    .replace(/Ã“/g, "Ó")
    .replace(/Ãš/g, "Ú")
    .replace(/Ã‘/g, "Ñ")
    .replace(/vesÃcula/gi, "vesícula");
}
