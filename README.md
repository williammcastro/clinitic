# Clinitic

Local AI assistant for medical offices. The goal is to listen to the doctor-patient interview, transcribe it live, structure the clinical information, and generate editable documents for physician review.

This repository is organized as incremental labs. Each lab validates one technical piece before it is integrated into the main product.

## Lab 01 - Riva Transcription With Two Microphones

### Goal

Validate a local live transcription test using two independent audio inputs:

- `doctor`: wireless USB microphone `USBAudio1.0` from `Jieli Technology`.
- `patient`: wired microphone connected to the 3.5 mm jack as `Micrófono externo`.

Each microphone is captured as an independent mono stream, normalized to PCM 16 kHz, and sent to NVIDIA Riva ASR over gRPC.

### Lab Architecture

```txt
[Mac Studio]
  ├─ ffmpeg / AVFoundation audio index 0 -> PCM s16le 16 kHz -> Riva doctor stream
  └─ ffmpeg / AVFoundation audio index 1 -> PCM s16le 16 kHz -> Riva patient stream

[Ubuntu Server]
  └─ NVIDIA Riva ASR gRPC at 192.168.1.205:50051
```

This lab does not use Asterisk, ARI, FIFO, MixMonitor, or telephony channels. It only captures local microphones and tests direct streaming to Riva.

### Relevant Files

```txt
src/tools/riva-dual-mic-smoke.ts
scripts/inspect-audio-devices.swift
scripts/monitor-default-input.swift
protos/riva_asr.proto
protos/riva/proto/riva_audio.proto
protos/riva/proto/riva_common.proto
docs/spec-driven-design.md
```

### Requirements

- macOS with microphone permission granted to the terminal being used.
- Node.js and pnpm.
- Riva server reachable over the network.
- Riva container exposing gRPC on `50051`.
- Two audio inputs visible to macOS.

Container used on the Ubuntu server:

```txt
nvcr.io/nvidia/riva/riva-speech:2.19.0
0.0.0.0:50051->50051/tcp
```

### Installation

```bash
pnpm install
```

If `ffmpeg-static` does not expose the binary because pnpm blocked build scripts:

```bash
pnpm approve-builds
pnpm rebuild ffmpeg-static
```

### Inspect Microphones With CoreAudio

```bash
env SWIFT_MODULECACHE_PATH=/private/tmp/clinitic-swift-module-cache \
CLANG_MODULE_CACHE_PATH=/private/tmp/clinitic-clang-module-cache \
swift scripts/inspect-audio-devices.swift
```

Expected output for this lab:

```txt
USBAudio1.0
manufacturer: Jieli Technology
input_channels: 1
nominal_sample_rate: 48000

Micrófono externo
manufacturer: Apple Inc.
input_channels: 1
nominal_sample_rate: 44100
```

### Test Default Input Level

```bash
env SWIFT_MODULECACHE_PATH=/private/tmp/clinitic-swift-module-cache \
CLANG_MODULE_CACHE_PATH=/private/tmp/clinitic-clang-module-cache \
swift scripts/monitor-default-input.swift 5
```

The last argument is the duration in seconds.

### View AVFoundation Indexes

```bash
node_modules/.pnpm/ffmpeg-static@5.3.0/node_modules/ffmpeg-static/ffmpeg \
-f avfoundation \
-list_devices true \
-i ""
```

Current mapping:

```txt
AVFoundation audio devices:
[0] USBAudio1.0
[1] Micrófono externo
```

### Run Continuous Dual Transcription

```bash
RIVA_ADDRESS=192.168.1.205:50051 \
RIVA_LANGUAGE_CODE=es-en-US \
pnpm run test:riva:dual-mic
```

The process keeps running until `Ctrl+C` is pressed.

Expected output:

```txt
Starting dual mic Riva smoke test
RIVA_ADDRESS=192.168.1.205:50051
RIVA_LANGUAGE_CODE=es-en-US
AVFoundation mapping:
- doctor: audio index 0
- patient: audio index 1

Speak into each microphone. Press Ctrl+C to stop.
[doctor] FINAL: Esta es la prueba desde el microfono del doctor.
[patient] FINAL: Esta es la prueba desde el microfono del paciente.
```

### Change Doctor/Patient Assignment

Default mapping:

```txt
doctor = audio index 0
patient = audio index 1
```

To invert the mapping:

```bash
DOCTOR_AUDIO_INDEX=1 \
PATIENT_AUDIO_INDEX=0 \
RIVA_ADDRESS=192.168.1.205:50051 \
RIVA_LANGUAGE_CODE=es-en-US \
pnpm run test:riva:dual-mic
```

### Available Variables

```txt
RIVA_ADDRESS=192.168.1.205:50051
RIVA_LANGUAGE_CODE=es-en-US
DOCTOR_AUDIO_INDEX=0
PATIENT_AUDIO_INDEX=1
```

### Lab 01 Findings

- The `Jieli Technology` USB receiver appears as a mono input, not stereo.
- The 3.5 mm jack appears as `Micrófono externo`, also mono.
- Two independent mono devices are enough to test role-based audio separation.
- Crosstalk exists: a sensitive microphone can pick up the speaker assigned to the other microphone.
- Riva's first `FINAL` result does not necessarily identify the real speaker; the distant microphone may finalize earlier because of weaker signal or fragmented audio.
- The product will need an anti-crosstalk layer before building the clinical timeline.

### Next Technical Step

Add a segment normalization layer:

```txt
raw transcripts by microphone
        ↓
deduplication / anti-crosstalk
        ↓
timeline with reliable speaker labels
        ↓
incremental clinical extraction
```

Initial suggested rule:

```txt
If doctor and patient produce similar text within a short window:
  keep the segment with better signal or more complete text
  mark the other one as crosstalk_ignored
```

## Lab 02 - Riva Transcription With One Microphone

### Goal

Validate a simpler live transcription path using only one microphone. This lab does not distinguish doctor from patient; it only confirms that one local audio input can be streamed continuously to Riva and transcribed.

Default input for this lab:

```txt
AVFoundation audio index 1 = Micrófono externo
```

### Lab Architecture

```txt
[Mac Studio]
  └─ ffmpeg / AVFoundation audio index 1 -> PCM s16le 16 kHz -> Riva stream

[Ubuntu Server]
  └─ NVIDIA Riva ASR gRPC at 192.168.1.205:50051
```

### Relevant File

```txt
src/tools/riva-single-mic-smoke.ts
```

### Run Continuous Single-Mic Transcription

```bash
RIVA_ADDRESS=192.168.1.205:50051 \
RIVA_LANGUAGE_CODE=es-en-US \
pnpm run test:riva:single-mic
```

The process keeps running until `Ctrl+C` is pressed.

Expected output:

```txt
Starting single mic Riva smoke test
RIVA_ADDRESS=192.168.1.205:50051
RIVA_LANGUAGE_CODE=es-en-US
AVFoundation audio index=1

Speak into the microphone. Press Ctrl+C to stop.
[FINAL] Esta es una prueba de transcripcion con un solo microfono.
```

### Change Input Microphone

Use `AUDIO_INDEX` to select a different AVFoundation input:

```bash
AUDIO_INDEX=0 \
RIVA_ADDRESS=192.168.1.205:50051 \
RIVA_LANGUAGE_CODE=es-en-US \
pnpm run test:riva:single-mic
```

## Lab 03 - Riva Final Transcripts Sent To Ollama

### Goal

Validate the first end-to-end AI pipeline:

```txt
single microphone -> Riva ASR -> final transcript -> Ollama LLM
```

This lab still uses only one microphone and does not distinguish doctor from patient. Whenever Riva emits a `FINAL` transcript, the text is sent to Ollama. Ollama returns a compact JSON analysis in Spanish, and the response is validated with Zod before being treated as usable output.

### Lab Architecture

```txt
[Mac Studio]
  └─ ffmpeg / AVFoundation audio index 1
        ↓
     PCM s16le 16 kHz
        ↓
     Riva StreamingRecognize
        ↓
     FINAL transcript
        ↓
     Ollama /api/chat

[Ubuntu Server]
  ├─ NVIDIA Riva ASR gRPC at 192.168.1.205:50051
  └─ Ollama HTTP API at http://192.168.1.205:11434
```

### Relevant File

```txt
src/tools/riva-single-mic-ollama-lab.ts
```

### Available Ollama Models On The Server

```txt
mistral-small:22b
mistral-nemo:latest
mistral-small3.2:latest
mistral-small:latest
mistral:latest
```

Default model for this lab:

```txt
mistral:latest
```

### Run Riva + Ollama Lab

```bash
RIVA_ADDRESS=192.168.1.205:50051 \
RIVA_LANGUAGE_CODE=es-en-US \
OLLAMA_BASE_URL=http://192.168.1.205:11434 \
OLLAMA_MODEL=mistral:latest \
pnpm run test:riva:single-mic:ollama
```

The process keeps running until `Ctrl+C` is pressed.

Expected output:

```txt
Starting single mic Riva + Ollama lab
RIVA_ADDRESS=192.168.1.205:50051
RIVA_LANGUAGE_CODE=es-en-US
AUDIO_INDEX=1
OLLAMA_BASE_URL=http://192.168.1.205:11434
OLLAMA_MODEL=mistral:latest

Speak into the microphone. Press Ctrl+C to stop.
[Riva FINAL] El paciente refiere dolor de cabeza desde ayer.
[Ollama] sending: El paciente refiere dolor de cabeza desde ayer.
[Ollama] validated: {"text":"El paciente refiere dolor de cabeza desde ayer.","summary":"Dolor de cabeza desde ayer.","possible_clinical_relevance":"symptom","requires_doctor_review":true}
```

Validated JSON schema:

```json
{
  "text": "string",
  "summary": "string",
  "possible_clinical_relevance": "none | symptom | medication | recommendation | history | procedure | diagnosis | follow_up | other",
  "requires_doctor_review": true
}
```

### Change Model Or Microphone

Use a larger model:

```bash
OLLAMA_MODEL=mistral-nemo:latest \
RIVA_ADDRESS=192.168.1.205:50051 \
OLLAMA_BASE_URL=http://192.168.1.205:11434 \
pnpm run test:riva:single-mic:ollama
```

Use another microphone:

```bash
AUDIO_INDEX=0 \
RIVA_ADDRESS=192.168.1.205:50051 \
OLLAMA_BASE_URL=http://192.168.1.205:11434 \
pnpm run test:riva:single-mic:ollama
```

### Lab 03 Findings To Validate

- Riva `FINAL` events are usable as LLM trigger points.
- Ollama latency must be measured per model.
- Final utterances should be queued so the ASR stream does not block while the LLM responds.
- The LLM response is validated with a strict Zod schema before being used as lab output.

## Lab 04 - Basic Riva To Ollama Chat

### Goal

Validate the simplest possible real-time conversation loop with the model:

```txt
single microphone -> Riva FINAL transcript -> Ollama request -> raw model response
```

This lab intentionally has no clinical prompt, no JSON schema, no Zod validation, and no document extraction. It is meant to measure basic response times and observe how the selected Ollama model behaves in a live loop.

### Relevant File

```txt
src/tools/riva-single-mic-ollama-basic-chat.ts
```

### Run Basic Chat Lab

```bash
RIVA_ADDRESS=192.168.1.205:50051 \
RIVA_LANGUAGE_CODE=es-en-US \
OLLAMA_BASE_URL=http://192.168.1.205:11434 \
OLLAMA_MODEL=mistral:latest \
pnpm run test:riva:single-mic:ollama-chat
```

The process keeps running until `Ctrl+C` is pressed.

Expected output:

```txt
Starting basic Riva + Ollama chat lab
RIVA_ADDRESS=192.168.1.205:50051
RIVA_LANGUAGE_CODE=es-en-US
AUDIO_INDEX=1
OLLAMA_BASE_URL=http://192.168.1.205:11434
OLLAMA_MODEL=mistral:latest

Speak into the microphone. Press Ctrl+C to stop.
[Riva FINAL] Hola, quien eres?
[Ollama] request: Hola, quien eres?
[Ollama] response (1240 ms): Soy un modelo de lenguaje...
```

### Change Model Or Microphone

```bash
AUDIO_INDEX=0 \
OLLAMA_MODEL=mistral-nemo:latest \
RIVA_ADDRESS=192.168.1.205:50051 \
OLLAMA_BASE_URL=http://192.168.1.205:11434 \
pnpm run test:riva:single-mic:ollama-chat
```

### Lab 04 Findings To Validate

- Time from Riva `FINAL` to full Ollama response.
- Latency differences between available Ollama models.
- Whether requests should be queued, interrupted, or allowed to overlap in later labs.
- Whether the selected model follows spoken Spanish well without a system prompt.

## Lab 05 - Browser UI For Riva + Ollama

### Goal

Validate the first browser-based UI for live transcription and LLM responses.

This lab uses the approach defined in the spec:

```txt
Node backend -> Socket.IO -> browser UI
```

React is not used yet. The UI is plain HTML served by Express so the lab stays small and focused on event flow. React can be introduced later once the realtime contract is stable.

### Lab Architecture

```txt
[Mac Studio]
  ├─ Express serves browser UI
  ├─ Socket.IO emits transcript and LLM events
  └─ ffmpeg captures AVFoundation audio index 0
        ↓
     Riva StreamingRecognize
        ↓
     transcript:partial / transcript:final
        ↓
     Ollama /api/chat with mistral-nemo:latest
        ↓
     llm:request / llm:response

[Browser]
  ├─ Riva transcription panel
  └─ Ollama response panel
```

### Relevant File

```txt
src/tools/riva-single-mic-ollama-ui-lab.ts
```

### Run UI Lab

```bash
PORT=3000 \
RIVA_ADDRESS=192.168.1.205:50051 \
RIVA_LANGUAGE_CODE=es-en-US \
AUDIO_INDEX=0 \
OLLAMA_BASE_URL=http://192.168.1.205:11434 \
OLLAMA_MODEL=mistral-nemo:latest \
pnpm run test:riva:single-mic:ollama-ui
```

Open:

```txt
http://localhost:3000
```

The browser has Start and Stop buttons. Start begins microphone capture, Riva streaming, and Ollama requests for each final transcript.

### Socket.IO Events Used

Server to browser:

```txt
connection:status
lab:status
transcript:partial
transcript:final
llm:request
llm:response
llm:error
system:log
```

Browser to server:

```txt
lab:start
lab:stop
```

### Lab 05 Findings To Validate

- The browser can display Riva partial/final transcripts in real time.
- The browser can display Ollama responses without blocking the ASR stream.
- Socket.IO is enough for this stage; React is optional until the UI becomes more complex.
- `mistral-nemo:latest` should be compared against smaller models for latency.

## Scripts

```bash
pnpm run build
pnpm run test:riva:dual-mic
pnpm run test:riva:single-mic
pnpm run test:riva:single-mic:ollama
pnpm run test:riva:single-mic:ollama-chat
pnpm run test:riva:single-mic:ollama-ui
```

## Documentation

The product-level specification is available at:

```txt
docs/spec-driven-design.md
```
