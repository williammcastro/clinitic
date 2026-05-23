import { conditionCorrections } from "./conditions";
import { medicationDictionary } from "./medications";

export type ClinicalTermCorrection = {
  type: "condition" | "medication";
  label: string;
  matched: string;
  replacement: string;
};

export type ClinicalTermNormalizationResult = {
  text: string;
  corrections: ClinicalTermCorrection[];
};

const medicationContextPattern =
  /\b(tomo|toma|tomar|tomando|medicamento|medicamentos|pastilla|pastillas|tableta|tabletas|capsula|capsulas|me mandaron|me formularon|formulado|recetaron|mg|miligramos|cada|diario|diaria|vez al dia|veces al dia)\b/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function variantPattern(variant: string): RegExp {
  const escaped = escapeRegExp(variant).replace(/\\ /g, "\\s+");
  return new RegExp(`\\b${escaped}\\b`, "gi");
}

export function normalizeClinicalTerms(
  text: string
): ClinicalTermNormalizationResult {
  let normalizedText = text;
  const corrections: ClinicalTermCorrection[] = [];

  for (const correction of conditionCorrections) {
    const matches = Array.from(normalizedText.matchAll(correction.pattern));
    if (matches.length === 0) {
      correction.pattern.lastIndex = 0;
      continue;
    }

    normalizedText = normalizedText.replace(
      correction.pattern,
      correction.replacement
    );
    correction.pattern.lastIndex = 0;

    for (const match of matches) {
      corrections.push({
        type: "condition",
        label: correction.label,
        matched: match[0],
        replacement: correction.replacement,
      });
    }
  }

  const hasMedicationContext = medicationContextPattern.test(normalizedText);
  if (!hasMedicationContext) {
    return { text: normalizedText, corrections };
  }

  for (const medication of medicationDictionary) {
    for (const variant of medication.variants) {
      const pattern = variantPattern(variant);
      const matches = Array.from(normalizedText.matchAll(pattern));
      if (matches.length === 0) continue;

      normalizedText = normalizedText.replace(pattern, medication.canonical);

      for (const match of matches) {
        corrections.push({
          type: "medication",
          label: medication.canonical,
          matched: match[0],
          replacement: medication.canonical,
        });
      }
    }
  }

  return { text: normalizedText, corrections };
}
