export function renderHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clinitic Clinical Data Extraction</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #101417; color: #e7edf0; }
    header { padding: 18px 24px; border-bottom: 1px solid #263038; background: #151b20; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    h1 { font-size: 18px; margin: 0; }
    main { padding: 20px 24px; display: grid; grid-template-columns: 1fr 1.1fr; gap: 20px; }
    button { border: 1px solid #4f8cff; background: #2563eb; color: white; height: 36px; padding: 0 14px; border-radius: 6px; cursor: pointer; font-weight: 600; }
    button.secondary { background: #1b2329; color: #d8e0e4; border-color: #34414a; }
    .meta { font-size: 12px; color: #95a3ad; display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
    .panel { background: #151b20; border: 1px solid #263038; border-radius: 8px; min-height: 500px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 16px 40px rgba(0,0,0,0.22); }
    .panel h2 { font-size: 14px; margin: 0; padding: 12px 14px; border-bottom: 1px solid #263038; background: #1a2228; display: flex; justify-content: space-between; gap: 12px; }
    .stream { padding: 14px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
    .item { border-left: 3px solid #64717b; padding: 8px 10px; background: #1b2329; border-radius: 4px; color: #dce5e9; }
    .partial { color: #a8b4bc; }
    .final { border-left-color: #4f8cff; }
    .error { border-left-color: #ff6b6b; }
    .small { font-size: 12px; color: #95a3ad; margin-top: 4px; }
    .slots { padding: 14px; display: flex; flex-direction: column; gap: 16px; overflow: auto; }
    .category { border: 1px solid #2a353d; border-radius: 8px; background: #182027; overflow: hidden; }
    .category h3 { margin: 0; padding: 10px 12px; font-size: 13px; color: #d7e0e5; background: #202a32; border-bottom: 1px solid #2a353d; }
    .category-grid { padding: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .slot { border: 1px solid #2a353d; border-radius: 8px; padding: 10px; background: #1b2329; min-height: 68px; }
    .slot label { display: block; font-size: 12px; color: #95a3ad; margin-bottom: 6px; }
    .slot div { font-size: 14px; line-height: 1.35; }
    .empty { color: #697780; font-style: italic; }
    @media (max-width: 950px) { main { grid-template-columns: 1fr; } header { align-items: flex-start; flex-direction: column; } .category-grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Clinitic - Clinical Data Extraction</h1>
      <div class="meta" id="meta">Connecting...</div>
    </div>
    <div>
      <button id="start">Start</button>
      <button id="stop" class="secondary">Stop</button>
      <button id="reset" class="secondary">Reset</button>
    </div>
  </header>
  <main>
    <section class="panel">
      <h2>Riva Transcription <span id="clinicalStatus" class="small"></span></h2>
      <div class="stream" id="transcripts"></div>
    </section>
    <section class="panel">
      <h2>Clinical Data Extraction <span id="latency" class="small"></span></h2>
      <div class="slots" id="slots"></div>
    </section>
  </main>
  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    const meta = document.getElementById("meta");
    const transcripts = document.getElementById("transcripts");
    const slots = document.getElementById("slots");
    const latency = document.getElementById("latency");
    const clinicalStatus = document.getElementById("clinicalStatus");
    const start = document.getElementById("start");
    const stop = document.getElementById("stop");
    const reset = document.getElementById("reset");
    let partialNode = null;

    const slotCategories = [
      {
        title: "Identificación",
        fields: [
          ["age", "Edad"],
          ["sex", "Sexo"]
        ]
      },
      {
        title: "Antecedentes patológicos",
        fields: [
          ["past_medical_history", "Enfermedades que sufre"],
          ["family_history", "Antecedentes familiares"]
        ]
      },
      {
        title: "Antecedentes quirúrgicos",
        fields: [
          ["surgeries", "Cirugías"]
        ]
      },
      {
        title: "Antecedentes toxicológicos",
        fields: [
          ["tobacco_use", "Fuma"],
          ["alcohol_use", "Consume licor"],
          ["recreational_drug_use", "Consume drogas"]
        ]
      },
      {
        title: "Antecedentes farmacológicos",
        fields: [
          ["current_medications", "Medicamentos que toma"]
        ]
      },
      {
        title: "Hipersensibilidad",
        fields: [
          ["medication_hypersensitivity", "Medicamentos"],
          ["food_hypersensitivity", "Alimentos"],
          ["allergies", "Otras alergias"]
        ]
      },
      {
        title: "Hospitalizaciones y vacunación",
        fields: [
          ["hospitalizations", "Motivos de hospitalización"],
          ["vaccination_history", "Vacunas que tiene"]
        ]
      },
      {
        title: "Motivo de consulta principal",
        fields: [
          ["chief_complaint", "Motivo de consulta"],
          ["current_illness", "Descripción detallada"]
        ]
      },
      {
        title: "Revisión de exámenes previos",
        fields: [
          ["previous_abnormal_exams", "Exámenes con variables fuera de rango"],
          ["previous_abnormal_exam_dates", "Fechas de exámenes alterados"]
        ]
      },
      {
        title: "Examen físico",
        fields: [
          ["blood_pressure", "Presión arterial"],
          ["pulse", "Pulso"],
          ["temperature", "Temperatura"],
          ["oxygen_saturation", "SaO2"],
          ["glucometry", "Glucometría"],
          ["head_to_toe_exam", "Cabeza a pies"],
          ["physical_exam", "Otros hallazgos"]
        ]
      },
      {
        title: "Datos extra relevantes",
        fields: [
          ["housing_environment", "Sitio de vivienda y ambiente"],
          ["rural_urban", "Rural / urbano"],
          ["occupation", "Ocupación"]
        ]
      },
      {
        title: "Evaluación",
        fields: [
          ["review_of_systems", "Revisión por sistemas"],
          ["assessment", "Assessment"]
        ]
      }
    ];

    function addTranscript(className, text, detail) {
      const node = document.createElement("div");
      node.className = "item " + className;
      node.textContent = text;
      if (detail) {
        const small = document.createElement("div");
        small.className = "small";
        small.textContent = detail;
        node.appendChild(small);
      }
      transcripts.prepend(node);
      while (transcripts.children.length > 20) {
        transcripts.removeChild(transcripts.lastElementChild);
      }
      return node;
    }

    function renderSlots(state) {
      slots.innerHTML = "";
      for (const category of slotCategories) {
        const categoryNode = document.createElement("section");
        categoryNode.className = "category";
        const title = document.createElement("h3");
        title.textContent = category.title;
        const grid = document.createElement("div");
        grid.className = "category-grid";

        for (const [key, labelText] of category.fields) {
          const slot = document.createElement("div");
          slot.className = "slot";
          const label = document.createElement("label");
          label.textContent = labelText;
          const value = document.createElement("div");
          const current = state[key];
          value.textContent = current || "Pending";
          if (!current) value.className = "empty";
          slot.appendChild(label);
          slot.appendChild(value);
          grid.appendChild(slot);
        }

        categoryNode.appendChild(title);
        categoryNode.appendChild(grid);
        slots.appendChild(categoryNode);
      }
    }

    start.onclick = () => socket.emit("lab:start");
    stop.onclick = () => socket.emit("lab:stop");
    reset.onclick = () => socket.emit("lab:reset");

    socket.on("connection:status", (status) => {
      meta.textContent = [
        "Riva " + status.rivaAddress,
        "audio index " + status.audioIndex,
        "Ollama " + status.ollamaModel,
        status.recording ? "recording" : "stopped"
      ].join(" | ");
    });

    socket.on("lab:status", (status) => {
      addTranscript("partial", status.recording ? "Recording started" : "Recording stopped");
    });

    socket.on("transcript:partial", (event) => {
      if (!partialNode) partialNode = addTranscript("partial", event.text);
      partialNode.textContent = event.text;
    });

    socket.on("transcript:final", (event) => {
      partialNode = null;
      addTranscript("final", event.text, "FINAL");
    });

    socket.on("transcript:reset", () => {
      partialNode = null;
      transcripts.innerHTML = "";
      latency.textContent = "";
      clinicalStatus.textContent = "";
    });

    socket.on("clinical:status", (event) => {
      clinicalStatus.textContent = event.status === "extracting" ? "Extracting..." : "";
    });

    socket.on("clinical:update", (event) => {
      renderSlots(event.state);
      latency.textContent = event.elapsedMs ? event.elapsedMs + " ms" : "";
    });

    socket.on("clinical:error", (event) => {
      addTranscript("error", event.error, "clinical extraction error");
    });

    socket.on("system:log", (event) => {
      addTranscript(event.level === "error" ? "error" : "partial", event.message);
    });
  </script>
</body>
</html>`;
}
