export type MedicationDictionaryEntry = {
  canonical: string;
  variants: string[];
  category?: string;
  requiresContext: boolean;
};

export const medicationDictionary: MedicationDictionaryEntry[] = [
  {
    canonical: "loratadina",
    variants: ["lora ta dina", "lorata dina", "lora tadina"],
    category: "antihistaminico",
    requiresContext: true,
  },
  {
    canonical: "losartán",
    variants: ["los sart", "lo sart", "losartan"],
    category: "antihipertensivo",
    requiresContext: true,
  },
  {
    canonical: "levotiroxina",
    variants: ["levo tiroxina", "eutirox", "utirox", "tolex"],
    category: "hormona tiroidea",
    requiresContext: true,
  },
];
