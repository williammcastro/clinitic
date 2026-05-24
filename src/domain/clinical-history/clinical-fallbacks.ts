import { ClinicalHistorySchema, type ClinicalHistory } from "./schema";
import {
  appendSlotValue,
  normalizeForMatch,
  removeSlotValue,
} from "./slot-normalization";

export function applyClinicalFallbacks(
  state: ClinicalHistory,
  latestFinal: string,
  previousState: ClinicalHistory
): ClinicalHistory {
  const normalized = normalizeForMatch(latestFinal);
  const merged: ClinicalHistory = { ...state };
  const familySubject =
    /\b(abuela|abuelo|abuelas|abuelos|madre|mama|padre|papa|padres|hermana|hermano|hija|hijo|tia|tio|prima|primo|familia|familiar|familiares)\b/.test(
      normalized
    );
  const familyConditionStatement =
    familySubject &&
    /\b(murio|murio de|murieron|sufrio|sufria|sufre|sufren|padece|padecen|tenia|tuvo|tiene|tienen|diagnosticaron|antecedente|antecedentes)\b/.test(
      normalized
    );

  const patientDiseaseStatement =
    !familySubject &&
    /\b(tengo|sufro de|padezco|me diagnosticaron|actualmente sufro de|actualmente tengo)\b/.test(
      normalized
    );

  if (familyConditionStatement) {
    const familyConditions: string[] = [];

    if (/\bdiabetes\b/.test(normalized)) {
      familyConditions.push("diabetes");
    }
    if (/\b(infarto|infartos|infarto cardiaco)\b/.test(normalized)) {
      familyConditions.push("infarto");
    }
    if (/\b(cancer)\b/.test(normalized)) {
      familyConditions.push("cáncer");
    }
    if (/\b(glaucoma)\b/.test(normalized)) {
      familyConditions.push("glaucoma");
    }
    if (/\b(alzheimer)\b/.test(normalized)) {
      familyConditions.push("Alzheimer");
    }
    if (/\b(calculo|calculos|piedra|piedras)\b.*\b(vesicula|biliar)\b/.test(normalized)) {
      familyConditions.push("cálculos en la vesícula");
    }

    for (const condition of familyConditions) {
      appendSlotValue(merged, "family_history", condition);

      if (
        !previousState.past_medical_history ||
        !normalizeForMatch(previousState.past_medical_history).includes(
          normalizeForMatch(condition)
        )
      ) {
        removeSlotValue(merged, "past_medical_history", condition);
      }
    }
  }

  if (
    familySubject &&
    /\b(operaron|operado|operada|cirugia|operacion|apendice|apendicitis|apendicectomia|bypa|by pas|by pass|bypass)\b/.test(
      normalized
    )
  ) {
    const familySubjectLabel = getFamilySubjectLabel(normalized);
    const familySurgeries: string[] = [];

    if (/\b(apendice|apendicitis|apendicectomia)\b/.test(normalized)) {
      familySurgeries.push(`${familySubjectLabel}: apendicectomía`);

      if (
        !previousState.surgeries ||
        !normalizeForMatch(previousState.surgeries).includes(
          normalizeForMatch("apendicectomía")
        )
      ) {
        removeSlotValue(merged, "surgeries", "apendicectomía");
      }
    }
    if (/\b(bypa gastrico|by pas gastrico|by pass gastrico|bypass gastrico)\b/.test(normalized)) {
      familySurgeries.push(`${familySubjectLabel}: bypass gástrico`);

      if (
        !previousState.surgeries ||
        !normalizeForMatch(previousState.surgeries).includes(
          normalizeForMatch("bypass gástrico")
        )
      ) {
        removeSlotValue(merged, "surgeries", "bypass gástrico");
      }
    }

    for (const surgery of familySurgeries) {
      appendSlotValue(merged, "family_history", surgery);
    }
  }

  if (
    !familySubject &&
    /\b(tengo|tiene|tuve|me hicieron|me realizaron|cirugia|operacion|operaron|bypa|by pas|by pass|bypass|cornea|rodilla|tobillo|apendice|apendicitis|apendicectomia)\b/.test(
      normalized
    )
  ) {
    const patientSurgeries: string[] = [];

    if (/\b(bypa gastrico|by pas gastrico|by pass gastrico|bypass gastrico)\b/.test(normalized)) {
      patientSurgeries.push("bypass gástrico");
    }
    if (/\bcornea\b/.test(normalized)) {
      patientSurgeries.push("cirugía de córnea");
    }
    if (/\btobillo\b/.test(normalized)) {
      patientSurgeries.push("cirugía de tobillo");
    }
    if (/\brodilla\b/.test(normalized)) {
      patientSurgeries.push("cirugía de rodilla");
    }
    if (/\b(apendice|apendicitis|apendicectomia)\b/.test(normalized)) {
      patientSurgeries.push("apendicectomía");
    }

    for (const surgery of patientSurgeries) {
      appendSlotValue(merged, "surgeries", surgery);
    }
  }

  if (patientDiseaseStatement) {
    if (/\b(lupus|lucus)\b/.test(normalized)) {
      appendSlotValue(merged, "past_medical_history", "lupus");
    }
    if (/\bdiabetes\b/.test(normalized)) {
      appendSlotValue(merged, "past_medical_history", "diabetes");
    }
    if (/\b(presion alta|hipertension)\b/.test(normalized)) {
      appendSlotValue(merged, "past_medical_history", "hipertension arterial");
    }
  }

  if (
    merged.chief_complaint &&
    (["tengo", "to", "so"].includes(normalizeForMatch(merged.chief_complaint)) ||
      /\b(bypa gastrico|by pas gastrico|by pass gastrico|bypass gastrico|cirugia|operacion)\b/.test(
        normalizeForMatch(merged.chief_complaint)
      ))
  ) {
    merged.chief_complaint = null;
  }

  return ClinicalHistorySchema.parse(merged);
}

function getFamilySubjectLabel(normalizedText: string): string {
  const familySubjects = [
    "abuela",
    "abuelo",
    "madre",
    "mama",
    "padre",
    "papa",
    "hermana",
    "hermano",
    "hija",
    "hijo",
    "tia",
    "tio",
    "prima",
    "primo",
  ];

  return (
    familySubjects.find((subject) =>
      new RegExp(`\\b${subject}\\b`).test(normalizedText)
    ) ?? "familiar"
  );
}
