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

## Scripts

```bash
pnpm run build
pnpm run test:riva:dual-mic
```

## Documentation

The product-level specification is available at:

```txt
docs/spec-driven-design.md
```
