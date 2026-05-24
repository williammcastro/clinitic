import { normalizeForMatch } from "./slot-normalization";

const clinicalSignalPattern =
  /\b(anos|edad|sexo|hombre|mujer|masculino|femenino|motivo|consulta|dolor|sintoma|sintomas|tengo|tiene|tuve|sufro|padezco|diagnosticaron|enfermedad|antecedente|antecedentes|cirugia|operacion|operaron|apendice|apendicitis|apendicectomia|bypass|bypa|by pas|by pass|cornea|rodilla|tobillo|alergia|alergico|alergica|medicamento|medicamentos|tomo|toma|tomar|pastilla|tableta|mg|miligramos|familia|familiar|familiares|abuela|abuelo|abuelas|abuelos|madre|padre|padres|mama|papa|hermana|hermano|infarto|diabetes|cancer|glaucoma|alzheimer|lupus|epoc|presion|hipertension|fibrilacion|vesicula|calculos)\b/;

export function hasClinicalSignal(text: string): boolean {
  return clinicalSignalPattern.test(normalizeForMatch(text));
}
