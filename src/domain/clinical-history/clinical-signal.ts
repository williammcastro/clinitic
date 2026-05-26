import { normalizeForMatch } from "./slot-normalization";

const clinicalSignalPattern =
  /\b(anos|edad|sexo|hombre|mujer|masculino|femenino|motivo|consulta|dolor|sintoma|sintomas|tengo|tiene|tuve|sufro|padezco|diagnosticaron|enfermedad|antecedente|antecedentes|cirugia|operacion|operaron|apendice|apendicitis|apendicectomia|bypass|bypa|by pas|by pass|cornea|rodilla|tobillo|fuma|fumador|tabaco|cigarrillo|licor|alcohol|cerveza|drogas|marihuana|cocaina|alergia|alergico|alergica|hipersensibilidad|alimento|alimentos|medicamento|medicamentos|tomo|toma|tomar|pastilla|tableta|mg|miligramos|hospitalizacion|hospitalizaciones|hospitalizado|hospitalizada|vacuna|vacunas|vacunacion|examen|examenes|laboratorio|fecha|fuera de rango|presion|arterial|pulso|temperatura|saturacion|sao2|oxigeno|glucometria|glucosa|peso|talla|bmi|imc|cefalocaudal|general|cabeza|cuello|torax|respiratorio|cardiovascular|abdomen|extremidades|genitourinario|neurologico|neurologica|piel|tejidos|blandos|hallazgo|hallazgos|edema|soplo|murmullos|palidez|mucosas|yugular|adenopatias|masas|dolor|fuerza|sensibilidad|rot|lesiones|vivienda|ambiental|rural|urbano|ocupacion|trabaja|familia|familiar|familiares|abuela|abuelo|abuelas|abuelos|madre|padre|padres|mama|papa|hermana|hermano|infarto|diabetes|cancer|glaucoma|alzheimer|lupus|epoc|hipertension|fibrilacion|vesicula|calculos)\b/;

export function hasClinicalSignal(text: string): boolean {
  return clinicalSignalPattern.test(normalizeForMatch(text));
}
