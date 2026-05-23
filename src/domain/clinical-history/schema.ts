import { z } from "zod";

const slotSchema = z.preprocess((value) => {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) {
    const items = value
      .filter((item) => item !== undefined && item !== null)
      .map((item) => String(item).trim())
      .filter(Boolean);
    return items.length > 0 ? items.join("; ") : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return value;
}, z.string().nullable());

export const ClinicalHistorySchema = z.object({
  age: slotSchema,
  sex: slotSchema,
  chief_complaint: slotSchema,
  current_illness: slotSchema,
  past_medical_history: slotSchema,
  surgeries: slotSchema,
  allergies: slotSchema,
  current_medications: slotSchema,
  family_history: slotSchema,
  review_of_systems: slotSchema,
  physical_exam: slotSchema,
  assessment: slotSchema,
});

export const PartialClinicalHistorySchema = ClinicalHistorySchema.partial();

export type ClinicalHistory = z.infer<typeof ClinicalHistorySchema>;

export const emptyClinicalHistory: ClinicalHistory = {
  age: null,
  sex: null,
  chief_complaint: null,
  current_illness: null,
  past_medical_history: null,
  surgeries: null,
  allergies: null,
  current_medications: null,
  family_history: null,
  review_of_systems: null,
  physical_exam: null,
  assessment: null,
};
