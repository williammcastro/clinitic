# Clinitic - Spec Driven Design

## 1. Vision

Clinitic es un asistente local de IA para consultorios medicos. Durante una entrevista entre medico y paciente, el sistema escucha la conversacion, transcribe el audio en vivo, estructura la informacion clinica y propone tres documentos editables:

- Historia clinica.
- Prescripcion.
- Recomendaciones.

El medico siempre revisa, corrige y aprueba la informacion antes de considerarla final. El sistema no diagnostica, no prescribe por cuenta propia y no reemplaza el criterio medico.

## 2. Fase 1

La Fase 1 valida el flujo completo con una arquitectura simple:

```txt
[Mac Studio / Mac mini]
- Backend Node local
- UI web local
- Captura de audio
- Sesion clinica en vivo
- Estado clinico incremental
- Generacion inicial de documentos editables

[Servidor Ubuntu]
- Riva ASR por gRPC
- Ollama HTTP API
- Postgres
```

### Objetivos

- Capturar audio desde el equipo local.
- Soportar dos canales o dos microfonos: medico y paciente.
- Enviar audio a Riva para transcripcion.
- Mantener una linea de tiempo con segmentos etiquetados por hablante.
- Enviar fragmentos de transcripcion a Ollama para extraccion estructurada.
- Actualizar en vivo un estado clinico editable.
- Generar tres documentos editables desde ese estado.
- Guardar consulta, transcripcion, estado estructurado y versiones de documentos en Postgres.

### No objetivos de Fase 1

- Diagnostico automatico.
- Prescripcion automatica sin medico.
- Facturacion.
- Integracion con historia clinica externa.
- Diarizacion avanzada con un solo microfono.
- Portal para pacientes.
- Operacion multi-sede.
- Sincronizacion cloud.

## 3. Usuarios

### Medico

Necesita reducir tiempo de documentacion durante y despues de la consulta. Debe poder corregir rapidamente informacion capturada por el asistente.

### Asistente administrativo

Puede buscar consultas anteriores y verificar documentos finales, segun permisos.

### Administrador tecnico

Configura servidor Ubuntu, modelos de Riva/Ollama, conexion a base de datos y dispositivos de audio.

## 4. Principios del producto

- Local-first: el flujo critico debe funcionar dentro de la red local del consultorio.
- Medico en control: nada queda final sin aprobacion humana.
- Trazabilidad: cada dato importante debe poder apuntar a uno o varios segmentos de transcripcion.
- No invencion: si un dato no fue dicho o confirmado, queda vacio o marcado como pendiente.
- Edicion primero: los documentos son propuestas editables, no archivos cerrados.
- Privacidad por diseno: minimizar datos expuestos fuera de la infraestructura local.

## 5. Flujo principal

1. El medico abre la UI local.
2. El sistema muestra prueba de microfonos/canales.
3. El medico selecciona o confirma:
   - Canal del medico.
   - Canal del paciente.
   - Paciente o identificador temporal.
4. El medico inicia la consulta.
5. El backend local crea una sesion.
6. El backend envia audio a Riva.
7. Riva devuelve segmentos de transcripcion.
8. El backend normaliza los segmentos y los guarda.
9. El extractor envia bloques incrementales a Ollama.
10. Ollama responde con parches estructurados.
11. El backend valida los parches con Zod.
12. El estado clinico se actualiza.
13. La UI refleja cambios en:
    - Historia clinica.
    - Prescripcion.
    - Recomendaciones.
14. Al terminar, el sistema ejecuta una pasada final sobre la transcripcion completa.
15. Se generan versiones finales editables.
16. El medico revisa y aprueba.
17. El backend guarda la version aprobada en Postgres.

## 6. Modulos del sistema

### UI web local

Responsabilidades:

- Mostrar estado de conexion con Riva, Ollama y Postgres.
- Mostrar medidores de audio por canal.
- Permitir invertir canales medico/paciente.
- Mostrar transcripcion en vivo.
- Mostrar documentos editables.
- Marcar campos pendientes o de baja confianza.
- Permitir aprobacion final.

### Backend Node local

Responsabilidades:

- Servir la UI.
- Manejar sesiones clinicas.
- Capturar o recibir audio desde la UI.
- Conectar con Riva por gRPC.
- Conectar con Ollama por HTTP.
- Mantener estado clinico incremental en memoria.
- Validar estructuras con Zod.
- Persistir datos en Postgres.
- Emitir actualizaciones a la UI por Socket.IO.

### Riva ASR

Responsabilidades:

- Recibir audio en streaming.
- Devolver transcripcion parcial y final.
- Entregar metadata disponible: timestamps, confidence, canal.

### Ollama

Responsabilidades:

- Recibir segmentos de conversacion.
- Extraer datos clinicos estructurados.
- Devolver JSON compatible con schemas.
- No crear datos no evidenciados.

### Postgres

Responsabilidades:

- Guardar pacientes.
- Guardar consultas.
- Guardar segmentos de transcripcion.
- Guardar estado clinico estructurado.
- Guardar prescripciones.
- Guardar recomendaciones.
- Guardar versiones de documentos.
- Guardar eventos de auditoria.

## 7. Modelo de datos conceptual

### Consultation

```ts
type ConsultationStatus =
  | "draft"
  | "recording"
  | "processing"
  | "pending_review"
  | "approved"
  | "cancelled";

type Consultation = {
  id: string;
  patientId?: string;
  doctorId?: string;
  status: ConsultationStatus;
  startedAt: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
};
```

### TranscriptSegment

```ts
type SpeakerRole = "doctor" | "patient" | "unknown";

type TranscriptSegment = {
  id: string;
  consultationId: string;
  speaker: SpeakerRole;
  channel?: "left" | "right" | "device_a" | "device_b";
  startMs: number;
  endMs: number;
  text: string;
  confidence?: number;
  isFinal: boolean;
  createdAt: string;
};
```

### ClinicalState

```ts
type ClinicalState = {
  consultationId: string;
  history: ClinicalHistory;
  prescription: PrescriptionState;
  recommendations: RecommendationState;
  pendingFields: PendingField[];
  updatedAt: string;
};
```

### ClinicalHistory

```ts
type ClinicalHistory = {
  patientInfo: {
    age?: FieldValue<string>;
    sex?: FieldValue<string>;
    occupation?: FieldValue<string>;
  };
  chiefComplaint?: FieldValue<string>;
  currentIllness?: FieldValue<string>;
  pastMedicalHistory?: FieldValue<string>;
  surgeries?: FieldValue<string>;
  allergies?: FieldValue<string>;
  currentMedications?: FieldValue<string>;
  familyHistory?: FieldValue<string>;
  reviewOfSystems?: FieldValue<string>;
  physicalExam?: FieldValue<string>;
  assessment?: FieldValue<string>;
};
```

### PrescriptionState

```ts
type PrescriptionState = {
  items: PrescriptionItem[];
};

type PrescriptionItem = {
  id: string;
  medication: FieldValue<string>;
  dose?: FieldValue<string>;
  route?: FieldValue<string>;
  frequency?: FieldValue<string>;
  duration?: FieldValue<string>;
  instructions?: FieldValue<string>;
  status: "draft" | "needs_review" | "approved" | "removed";
};
```

### RecommendationState

```ts
type RecommendationState = {
  items: RecommendationItem[];
};

type RecommendationItem = {
  id: string;
  category:
    | "habits"
    | "diet"
    | "exercise"
    | "warning_signs"
    | "follow_up"
    | "medication_use"
    | "other";
  text: FieldValue<string>;
  status: "draft" | "needs_review" | "approved" | "removed";
};
```

### FieldValue

```ts
type FieldValue<T> = {
  value: T;
  confidence?: number;
  sourceSegmentIds: string[];
  reviewedByDoctor: boolean;
  updatedAt: string;
};
```

## 8. Contrato de extraccion incremental

El modelo no debe devolver documentos completos en cada llamada. Debe devolver parches estructurados.

### Input al extractor

```json
{
  "consultationId": "uuid",
  "locale": "es-CO",
  "previousStateSummary": "Resumen breve del estado actual",
  "segments": [
    {
      "id": "seg_001",
      "speaker": "doctor",
      "startMs": 12000,
      "endMs": 15000,
      "text": "Tiene alergias a algun medicamento?"
    },
    {
      "id": "seg_002",
      "speaker": "patient",
      "startMs": 15500,
      "endMs": 18000,
      "text": "Si, a la penicilina."
    }
  ]
}
```

### Output del extractor

```json
{
  "updates": [
    {
      "target": "history.allergies",
      "operation": "set",
      "value": "Alergia a penicilina",
      "confidence": 0.93,
      "sourceSegmentIds": ["seg_001", "seg_002"],
      "reason": "El paciente confirmo alergia a penicilina."
    }
  ],
  "prescriptionItems": [],
  "recommendationItems": [],
  "warnings": []
}
```

### Reglas del extractor

- Usar solo informacion presente en los segmentos o en el estado confirmado.
- Si falta dosis, frecuencia o duracion de una prescripcion, marcar `needs_review`.
- No convertir medicamentos actuales del paciente en prescripciones nuevas.
- Solo crear una prescripcion cuando el medico indique una orden terapeutica.
- Solo crear recomendaciones cuando el medico indique una conducta al paciente.
- Mantener evidencia con IDs de segmentos.
- Si hay contradiccion, no sobrescribir silenciosamente; crear warning.

## 9. Documentos editables

Los documentos se generan desde `ClinicalState`, no directamente desde el texto libre.

### Historia clinica

Debe incluir, como minimo:

- Datos del paciente.
- Motivo de consulta.
- Enfermedad actual.
- Antecedentes medicos.
- Cirugias.
- Alergias.
- Medicamentos actuales.
- Examen fisico si fue mencionado.
- Analisis o impresion clinica si el medico la expresa.
- Plan si el medico lo expresa.

### Prescripcion

Debe incluir una lista estructurada de medicamentos:

- Medicamento.
- Dosis.
- Via.
- Frecuencia.
- Duracion.
- Indicaciones.
- Estado de revision.

Cada item incompleto debe mostrarse como pendiente.

### Recomendaciones

Debe incluir recomendaciones separadas por categoria:

- Habitos.
- Dieta.
- Ejercicio.
- Signos de alarma.
- Seguimiento.
- Uso de medicamentos.
- Otras recomendaciones.

## 10. Persistencia inicial en Postgres

Tablas sugeridas para Fase 1:

```txt
patients
doctors
consultations
transcript_segments
clinical_states
prescription_items
recommendations
document_versions
audit_events
```

### Regla de versionado

- Una consulta puede tener multiples versiones de documentos.
- Una version aprobada no se sobrescribe.
- Correcciones posteriores crean una nueva version.

### Auditoria minima

Registrar:

- Inicio de consulta.
- Fin de consulta.
- Cambios manuales del medico.
- Generacion de documentos.
- Aprobacion final.
- Errores de Riva/Ollama/Postgres.

## 11. API inicial

### REST

```txt
GET    /health
POST   /consultations
GET    /consultations/:id
POST   /consultations/:id/start
POST   /consultations/:id/stop
GET    /consultations/:id/state
PATCH  /consultations/:id/state
POST   /consultations/:id/finalize
POST   /consultations/:id/approve
GET    /consultations/:id/documents
```

### Socket.IO events

Cliente a servidor:

```txt
audio:chunk
consultation:start
consultation:stop
state:patch
document:edit
document:approve
```

Servidor a cliente:

```txt
connection:status
audio:levels
transcript:partial
transcript:final
clinical:update
clinical:warning
document:update
consultation:status
error
```

## 12. Configuracion esperada

Variables de entorno sugeridas:

```txt
PORT=3000
NODE_ENV=development

RIVA_GRPC_URL=192.168.1.10:50051
RIVA_LANGUAGE_CODE=es-US
RIVA_SAMPLE_RATE=16000

OLLAMA_BASE_URL=http://192.168.1.10:11434
OLLAMA_MODEL=llama3.1:8b

DATABASE_URL=postgres://user:password@192.168.1.10:5432/clinitic

SESSION_AUTOSAVE_MS=5000
EXTRACTION_WINDOW_MS=15000
EXTRACTION_MAX_SEGMENTS=20
```

## 13. Requisitos funcionales

### RF-001 Crear consulta

El sistema debe permitir crear una consulta con paciente conocido o paciente temporal.

### RF-002 Probar canales de audio

El sistema debe mostrar niveles de audio por canal y permitir asignar medico/paciente.

### RF-003 Transcribir en vivo

El sistema debe mostrar transcripcion parcial y final durante la consulta.

### RF-004 Etiquetar hablante por canal

Cada segmento debe guardarse con rol `doctor` o `patient` cuando la configuracion de canales lo permita.

### RF-005 Extraer historia clinica

El sistema debe actualizar campos de historia clinica cuando haya evidencia suficiente.

### RF-006 Detectar prescripciones

El sistema debe detectar medicamentos prescritos por el medico y extraer dosis, via, frecuencia, duracion e indicaciones cuando esten presentes.

### RF-007 Detectar recomendaciones

El sistema debe detectar recomendaciones dadas por el medico y separarlas por categoria.

### RF-008 Marcar pendientes

El sistema debe marcar campos incompletos, ambiguos o de baja confianza.

### RF-009 Editar documentos

El medico debe poder editar los documentos antes de aprobarlos.

### RF-010 Aprobar consulta

El medico debe poder aprobar una version final de los documentos.

## 14. Requisitos no funcionales

### Latencia

- Transcripcion parcial visible en menos de 2 segundos en red local.
- Actualizacion clinica incremental visible idealmente en menos de 10 segundos despues de un bloque relevante.

### Seguridad

- No exponer servicios fuera de la red local en Fase 1.
- Proteger `DATABASE_URL` y credenciales.
- Registrar eventos de aprobacion y edicion.

### Confiabilidad

- Si Ollama falla, la transcripcion debe continuar.
- Si Postgres falla temporalmente, el backend debe conservar la sesion en memoria y reportar estado degradado.
- Si Riva falla, la UI debe mostrar error claro y permitir reintento.

### Observabilidad

- Logs estructurados para errores de Riva, Ollama y Postgres.
- Health check para dependencias.

## 15. Criterios de aceptacion de Fase 1

- Se puede iniciar una consulta desde la UI.
- Se reciben segmentos de transcripcion en vivo.
- Los segmentos se guardan asociados a una consulta.
- El estado clinico se actualiza con al menos:
  - Motivo de consulta.
  - Alergias.
  - Antecedentes o cirugias si se mencionan.
  - Una prescripcion con dosis/frecuencia si el medico la dice.
  - Una recomendacion si el medico la dice.
- Los tres documentos se muestran como editables.
- El medico puede modificar datos.
- El medico puede aprobar una version final.
- La consulta aprobada queda guardada en Postgres.

## 16. Riesgos

### Calidad de audio

Mitigacion:

- Prueba de microfonos antes de iniciar.
- Medidores por canal.
- Configuracion para invertir canales.

### Contaminacion entre microfonos

Mitigacion:

- Usar microfonos direccionales.
- Guardar canal original.
- Permitir correccion manual del hablante.

### Prescripciones incompletas

Mitigacion:

- Marcar `needs_review`.
- Requerir aprobacion del medico.
- Mostrar campos faltantes.

### Invencion del modelo

Mitigacion:

- Salida estricta con schema.
- Evidencia obligatoria por campo.
- No guardar datos sin `sourceSegmentIds`, salvo edicion manual.

## 17. Plan de implementacion sugerido

### Iteracion 1

- Crear servidor Express + Socket.IO.
- Crear `/health`.
- Crear entidad de consulta en memoria.
- Crear UI minima con transcripcion y estado.

### Iteracion 2

- Agregar captura de audio desde navegador.
- Enviar chunks al backend.
- Crear adaptador de Riva.
- Mostrar transcripcion parcial/final.

### Iteracion 3

- Crear schemas Zod para estado clinico.
- Crear adaptador de Ollama.
- Implementar extraccion incremental.
- Mostrar historia, prescripcion y recomendaciones.

### Iteracion 4

- Agregar Postgres.
- Persistir consultas y segmentos.
- Persistir estado clinico.

### Iteracion 5

- Editor de documentos.
- Finalizacion y aprobacion.
- Versionado inicial.

## 18. Preguntas abiertas

- El microfono dual aparece como entrada estereo o como dos dispositivos separados?
  - Estado actual: el receptor USB conectado aparece como `USBAudio1.0` de `Jieli Technology`.
  - macOS/CoreAudio lo reporta como `input_channels: 1`, `nominal_sample_rate: 48000`.
  - Tambien se probo un microfono conectado al jack de 3.5 mm. macOS lo reporta como `Micrófono externo`, `input_channels: 1`, `nominal_sample_rate: 44100`, `uid: BuiltInHeadphoneInputDevice`.
  - Conclusion actual: el receptor USB no entrega dos canales separados, pero el Mac si puede ver dos entradas independientes cuando se usa USB + jack. Para Fase 1 se puede probar separacion medico/paciente usando dos dispositivos mono independientes.
- Riva ya esta configurado para espanol medico o solo espanol general?
- Que modelo de Ollama se usara primero para extraccion?
- La historia clinica debe seguir una plantilla especifica de algun medico o especialidad?
- Se requiere exportar a PDF/DOCX en Fase 1 o basta con documentos editables en la UI?
- El servidor Ubuntu sera usado por un solo consultorio o varios desde el inicio?

## 19. Comandos de diagnostico de audio

Scripts disponibles:

```txt
scripts/inspect-audio-devices.swift
scripts/monitor-default-input.swift
```

Ejecucion recomendada en macOS:

```txt
env SWIFT_MODULECACHE_PATH=/private/tmp/clinitic-swift-module-cache CLANG_MODULE_CACHE_PATH=/private/tmp/clinitic-clang-module-cache swift scripts/inspect-audio-devices.swift
```

```txt
env SWIFT_MODULECACHE_PATH=/private/tmp/clinitic-swift-module-cache CLANG_MODULE_CACHE_PATH=/private/tmp/clinitic-clang-module-cache swift scripts/monitor-default-input.swift 5
```

Prueba de transcripcion dual con Riva:

```txt
RIVA_ADDRESS=192.168.1.205:50051 RIVA_LANGUAGE_CODE=es-en-US pnpm run test:riva:dual-mic
```

Mapeo AVFoundation actual:

```txt
audio index 0 = USBAudio1.0
audio index 1 = Micrófono externo
```

Variables para cambiar el mapeo:

```txt
DOCTOR_AUDIO_INDEX=0
PATIENT_AUDIO_INDEX=1
```
