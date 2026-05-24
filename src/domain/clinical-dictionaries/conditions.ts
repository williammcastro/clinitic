export type ConditionCorrectionEntry = {
  label: string;
  pattern: RegExp;
  replacement: string;
};

export const conditionCorrections: ConditionCorrectionEntry[] = [
  {
    label: "EPOC",
    pattern: /\b(e\s*poc|epoc|epok|pok|poc)\b/gi,
    replacement: "EPOC",
  },
  {
    label: "lupus",
    pattern: /\blucus\b/gi,
    replacement: "lupus",
  },
  {
    label: "hipertension arterial",
    pattern: /\bpresion alta\b/gi,
    replacement: "hipertensión arterial",
  },
  {
    label: "fibrilacion auricular",
    pattern: /\b(vibracion auricular|fibrilacion auricular)\b/gi,
    replacement: "fibrilación auricular",
  },
];
