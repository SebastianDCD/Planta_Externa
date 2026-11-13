
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


// ======================================================
// REPORTE INDIVIDUAL DE DISTRIBUCIÓN NAP
// ======================================================

function calculateNapFlejeAllocation(napId) {
  const target = db.prepare(`
    SELECT p.project_id
    FROM naps n
    JOIN phases p ON p.id = n.phase_id
    WHERE n.id = ?
  `).get(napId);

  if (!target) throw new Error("No se encontró la NAP para calcular Fleje.");

  const orderedNaps = db.prepare(`
    SELECT
      n.id,
      n.number,
      p.display_code,
      COALESCE(dm.actual_quantity, 0) AS fleje_meters
    FROM naps n
    JOIN phases p ON p.id = n.phase_id
    LEFT JOIN nap_distribution_materials dm
      ON dm.nap_id = n.id
    LEFT JOIN nap_distribution_material_catalog c
      ON c.id = dm.catalog_id AND c.name = 'Fleje'
    WHERE p.project_id = ?
      AND c.name = 'Fleje'
    ORDER BY p.display_code COLLATE NOCASE, n.number, n.id
  `).all(target.project_id);

  let accumulatedBefore = 0;
  let allocation = null;

  for (const nap of orderedNaps) {
    const meters = Number(nap.fleje_meters) || 0;
    const accumulatedAfter = accumulatedBefore + meters;
    const pieces = Math.floor((accumulatedAfter + 1e-9) / 30)
      - Math.floor((accumulatedBefore + 1e-9) / 30);

    if (nap.id === napId) {
      allocation = {
        meters,
        pieces,
        accumulated_before_meters: accumulatedBefore,
        accumulated_after_meters: accumulatedAfter,
        project_total_meters: orderedNaps.reduce(
          (sum, item) => sum + (Number(item.fleje_meters) || 0), 0
        )
      };
      break;
    }

    accumulatedBefore = accumulatedAfter;
  }

  if (!allocation) throw new Error("No se encontró la NAP dentro del orden de Fleje UACH.");

  allocation.project_total_pieces = Math.floor(
    (allocation.project_total_meters + 1e-9) / 30
  );
  allocation.project_remainder_meters = Number(
    (allocation.project_total_meters % 30).toFixed(4)
  );

  return allocation;
}

function buildNapDistributionPayload(napId) {
  const nap = db.prepare(`
    SELECT
      n.id AS nap_id,
      n.number AS nap_number,
      ndr.report_id,
      ph.display_code
    FROM naps n
    JOIN phases ph ON ph.id = n.phase_id
    JOIN nap_distribution_reports ndr ON ndr.nap_id = n.id
    WHERE n.id = ?
  `).get(napId);

  if (!nap) throw new Error("No se encontró la NAP de distribución.");
  if (!nap.report_id) throw new Error("La NAP no tiene identificador de reporte.");

  // Estos materiales se capturan localmente, pero no forman parte del JSON operativo.
  const excludedMaterials = new Set([
    'Postería total',
    'Postes que se flejó'
  ]);

  const outputNames = {
    'Drop': 'unifibra',
    'Splitter': 'Splitter 1X8',
    'Tensores': 'Tensor TotalPlay'
  };

  const materials = db.prepare(`
    SELECT c.name, dm.actual_quantity, c.unit
    FROM nap_distribution_materials dm
    JOIN nap_distribution_material_catalog c ON c.id = dm.catalog_id
    WHERE dm.nap_id = ?
      AND dm.actual_quantity > 0
      AND c.name NOT IN ('Fleje', 'Acero')
    ORDER BY c.id
  `).all(napId);

  const fleje = db.prepare(`
    SELECT dm.actual_quantity
    FROM nap_distribution_materials dm
    JOIN nap_distribution_material_catalog c ON c.id = dm.catalog_id
    WHERE dm.nap_id = ? AND c.name = 'Fleje'
  `).get(napId);

  const acero = db.prepare(`
    SELECT dm.actual_quantity
    FROM nap_distribution_materials dm
    JOIN nap_distribution_material_catalog c ON c.id = dm.catalog_id
    WHERE dm.nap_id = ? AND c.name = 'Acero'
  `).get(napId);

  const flejeAllocation = calculateNapFlejeAllocation(napId);

  const reportMaterials = materials
    .filter(material => !excludedMaterials.has(material.name))
    .map(material => ({
      name: outputNames[material.name] || material.name,
      actual_quantity: material.actual_quantity,
      unit: material.unit
    }));

  // El Fleje se reporta únicamente cuando el acumulado asigna una o más piezas.
  if (fleje && fleje.actual_quantity !== null && flejeAllocation.pieces > 0) {
    reportMaterials.push({
      name: 'Fleje',
      actual_quantity: flejeAllocation.pieces,
      unit: 'pza'
    });
  }

  if (acero && acero.actual_quantity !== null && acero.actual_quantity > 0) {
    reportMaterials.push({
      name: 'Acero',
      actual_quantity: acero.actual_quantity,
      unit: 'pza'
    });
  }

  return {
    source: 'planta-externa',
    event: 'NAP_DISTRIBUTION_COMPLETED',
    report_id: nap.report_id,
    group: nap.display_code,
    nap: {
      id: nap.nap_id,
      number: nap.nap_number
    },
    materials: reportMaterials
  };
}

async function sendNapDistributionToN8n(napId) {
  const payload = buildNapDistributionPayload(napId);
  return await postToN8n(payload);
}


// ======================================================
// EXPORTACIONES
// ======================================================

module.exports = {
  buildNapPayload,
  sendNapToN8n,
  buildConstructionPhasePayload,
  sendConstructionPhaseToN8n,
  buildFiberRunPayload,
  sendFiberRunToN8n,
  buildNapDistributionPayload,
  calculateNapFlejeAllocation,
  sendNapDistributionToN8n
};
