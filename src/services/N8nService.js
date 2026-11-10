
const db = require("../database");

// ======================================================
// CONFIGURACIÓN Y ENVÍO COMÚN A N8N
// ======================================================

async function postToN8n(payload) {
  if (!process.env.N8N_WEBHOOK_URL || !process.env.N8N_WEBHOOK_SECRET) {
    throw new Error("Falta configurar la conexión con n8n.");
  }

  const response = await fetch(process.env.N8N_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": process.env.N8N_WEBHOOK_SECRET
    },
    body: JSON.stringify(payload)
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      `n8n respondió con HTTP ${response.status}: ${responseText}`
    );
  }

  if (!responseText) {
    return { success: true, message: "JSON recibido por n8n." };
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return { success: true, message: responseText };
  }
}

// ======================================================
// APERTURA DE NAP
// ======================================================

function buildNapPayload(napId) {
  const nap = db.prepare(`
    SELECT
      p.id AS project_id,
      p.name AS project_name,
      ph.id AS phase_id,
      ph.name AS phase_name,
      n.id AS nap_id,
      n.number AS nap_number,
      n.opening_date,
      n.opening_power,
      n.construction_status
    FROM naps n
    JOIN phases ph ON ph.id = n.phase_id
    JOIN projects p ON p.id = ph.project_id
    WHERE n.id = ?
  `).get(napId);

  if (!nap) {
    throw new Error(`No se encontró la NAP con ID ${napId}`);
  }

  const materials = db.prepare(`
    SELECT name, quantity, unit
    FROM nap_materials
    WHERE nap_id = ?
      AND quantity > 0
    ORDER BY name
  `).all(napId);

  return {
    source: "planta-externa",
    event: "NAP_OPENED",

    project: {
      id: nap.project_id,
      name: nap.project_name
    },

    phase: {
      id: nap.phase_id,
      name: nap.phase_name
    },

    nap: {
      id: nap.nap_id,
      number: nap.nap_number,
      opening_date: nap.opening_date,
      opening_power: nap.opening_power,
      construction_status: nap.construction_status
    },

    materials
  };
}

async function sendNapToN8n(napId) {
  const payload = buildNapPayload(napId);
  return await postToN8n(payload);
}

// ======================================================
// FASES DE CONSTRUCCIÓN Y TENDIDOS
// ======================================================


function buildConstructionPhasePayload(constructionPhaseId) {
  const phase = db.prepare(`
    SELECT
      cp.id,
      cp.number,
      cp.name,
      cp.status,
      cp.project_id,
      cp.report_version,
      cp.n8n_report_id,
      p.name AS project_name
    FROM construction_phases cp
    JOIN projects p ON p.id = cp.project_id
    WHERE cp.id = ?
  `).get(constructionPhaseId);

  if (!phase) {
    throw new Error(`No se encontró la fase ${constructionPhaseId}.`);
  }

  if (phase.status !== "COMPLETADA") {
    throw new Error("La fase todavía no está completada.");
  }

  if (!phase.n8n_report_id) {
    throw new Error("La fase todavía no tiene un identificador de reporte.");
  }

  const runs = db.prepare(`
    SELECT id, name, strand_count, status, completed_at
    FROM fiber_runs
    WHERE construction_phase_id = ?
    ORDER BY id
  `).all(constructionPhaseId);

  if (runs.length === 0 || runs.some(run => run.status !== "COMPLETADO")) {
    throw new Error("No todos los tendidos están completados.");
  }

  const getMaterials = db.prepare(`
    SELECT name, actual_quantity, unit
    FROM fiber_run_materials
    WHERE fiber_run_id = ?
    ORDER BY id
  `);

  const excludedMaterials = [
    "postes usados",
    "postes flejados"
  ];

  const formattedRuns = runs.map(run => ({
    name: run.name,
    strand_count: run.strand_count,
    completed_at: run.completed_at,
    materials: getMaterials.all(run.id)
      .filter(material =>
        !excludedMaterials.includes(material.name.trim().toLowerCase())
      )
      .map(material => ({
        name: material.name,
        actual_quantity: material.actual_quantity,
        unit: material.unit
      }))
  }));

  return {
    source: "planta-externa",
    event: "CONSTRUCTION_PHASE_COMPLETED",
    report_id: phase.n8n_report_id,
    report_version: phase.report_version,

    project: {
      id: phase.project_id,
      name: phase.project_name
    },

    construction_phase: {
      id: phase.id,
      number: phase.number,
      name: phase.name,
      status: phase.status
    },

    runs: formattedRuns
  };
}


async function sendConstructionPhaseToN8n(constructionPhaseId) {
  const payload = buildConstructionPhasePayload(constructionPhaseId);
  return await postToN8n(payload);
}

// ======================================================
// EXPORTACIONES
// ======================================================


function buildFiberRunPayload(runId) {
  const run = db.prepare(`
    SELECT
      fr.id,
      fr.name,
      fr.strand_count,
      fr.status,
      fr.completed_at,
      fr.n8n_report_id,
      fr.construction_phase_id,
      cp.number AS phase_number,
      cp.name AS phase_name,
      p.id AS project_id,
      p.name AS project_name
    FROM fiber_runs fr
    JOIN construction_phases cp
      ON cp.id = fr.construction_phase_id
    JOIN projects p
      ON p.id = cp.project_id
    WHERE fr.id = ?
  `).get(runId);

  if (!run) throw new Error("Tendido no encontrado.");

  if (run.status !== "COMPLETADO") {
    throw new Error("El tendido todavía no está completado.");
  }

  if (!run.n8n_report_id) {
    throw new Error("El tendido no tiene identificador de reporte.");
  }

  const materials = db.prepare(`
    SELECT name, actual_quantity, unit
    FROM fiber_run_materials
    WHERE fiber_run_id = ?
    ORDER BY id
  `).all(runId);

  const excluded = ["postes usados", "postes flejados"];

  return {
    source: "planta-externa",
    event: "FIBER_RUN_COMPLETED",
    report_id: run.n8n_report_id,

    project: {
      id: run.project_id,
      name: run.project_name
    },

    construction_phase: {
      id: run.construction_phase_id,
      number: run.phase_number,
      name: run.phase_name
    },

    fiber_run: {
      id: run.id,
      name: run.name,
      strand_count: run.strand_count,
      completed_at: run.completed_at
    },

    materials: materials
      .filter(material =>
        !excluded.includes(material.name.trim().toLowerCase())
      )
      .map(material => ({
        name: material.name,
        actual_quantity: material.actual_quantity,
        unit: material.unit
      }))
  };
}

async function sendFiberRunToN8n(runId) {
  const payload = buildFiberRunPayload(runId);
  return await postToN8n(payload);
}


module.exports = {
  buildNapPayload,
  sendNapToN8n,
  buildConstructionPhasePayload,
  sendConstructionPhaseToN8n,
  buildFiberRunPayload,
  sendFiberRunToN8n
};
