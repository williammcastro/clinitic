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
  tobacco_use: slotSchema,
  alcohol_use: slotSchema,
  recreational_drug_use: slotSchema,
  allergies: slotSchema,
  medication_hypersensitivity: slotSchema,
  food_hypersensitivity: slotSchema,
  current_medications: slotSchema,
  hospitalizations: slotSchema,
  vaccination_history: slotSchema,
  family_history: slotSchema,
  previous_abnormal_exams: slotSchema,
  previous_abnormal_exam_dates: slotSchema,
  review_of_systems: slotSchema,
  physical_exam: slotSchema,
  blood_pressure: slotSchema,
  pulse: slotSchema,
  temperature: slotSchema,
  oxygen_saturation: slotSchema,
  glucometry: slotSchema,
  head_to_toe_exam: slotSchema,
  housing_environment: slotSchema,
  rural_urban: slotSchema,
  occupation: slotSchema,
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
  tobacco_use: null,
  alcohol_use: null,
  recreational_drug_use: null,
  allergies: null,
  medication_hypersensitivity: null,
  food_hypersensitivity: null,
  current_medications: null,
  hospitalizations: null,
  vaccination_history: null,
  family_history: null,
  previous_abnormal_exams: null,
  previous_abnormal_exam_dates: null,
  review_of_systems: null,
  physical_exam: null,
  blood_pressure: null,
  pulse: null,
  temperature: null,
  oxygen_saturation: null,
  glucometry: null,
  head_to_toe_exam: null,
  housing_environment: null,
  rural_urban: null,
  occupation: null,
  assessment: null,
};
