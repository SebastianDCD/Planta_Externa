
const db = require("../database");

// Los nombres internos del catálogo se conservan. Estas transformaciones
// aplican únicamente a los materiales que salen en los JSON enviados a n8n.
const OUTPUT_MATERIAL_NAMES = {
  "Fleje": "Flejes 5/8",
  "Fleje 5/8": "Flejes 5/8",
  "Fleje 5/8 (m)": "Flejes 5/8",
  "Flejes 5/8": "Flejes 5/8",
  "Acero m": "Acero",
  "NAP": "Cajas NAP",
  "Herrajes Tipo D": "Herrajes tipo D",
  "Herrajes tipo D (pieza)": "Herrajes tipo D",

  "remates de aceros": "Remates de aceros",
  "Remate de aceros": "Remates de aceros",
  "Remates Acero (Pieza)": "Remates de aceros",
  "Remates para acero": "Remates de aceros",

  "Remate café (pieza)": "remate café",
  "Remate cafe (Pieza)": "remate café",

  "Remate 6 hilos": "Remate de fibra 6 hilos",

  "Fibra de 24 hilos": "Fibra 24 hilos - SYSCOM",
  "Fibra de 24 hilos - SYSCOM (m)": "Fibra 24 hilos - SYSCOM",
  "Fibra de 6 hilos - OpticTimes": "Fibra 6 hilos - OpticTimes",

  "Hebillas 5/8 (Pieza)": "Hebillas 5/8",
  "Raquetas (Pieza)": "Raquetas",

  "Splitter": "Splitters 1x8",
  "Splitter 1x8": "Splitters 1x8",
  "Splitter 1X8": "Splitters 1x8",
  "Splitter 1x2": "Splitters 1x2",
  "Splitter 1X2 (Pieza)": "Splitters 1x2",

  "Tensores": "Tensores TotalPlay",
  "Tensor": "Tensores TotalPlay",
  "Tensores Drop": "Tensores TotalPlay",
  "Tensores drop": "Tensores TotalPlay",
  "tensores drop": "Tensores TotalPlay",
  "Tensor Drop": "Tensores TotalPlay",
  "Tensor TotalPlay": "Tensores TotalPlay",
  "tensor totalplay": "Tensores TotalPlay",

  "Cierre de empalme de primer nivel": "Cierre de empalme primer nivel",
  "Cierre de empalme primer nivel": "Cierre de empalme primer nivel"
};

function getOutputMaterialName(name) {
  const normalizedName = String(name || "").trim();
  return OUTPUT_MATERIAL_NAMES[normalizedName] || normalizedName;
}

function getOutputMaterialUnit(name, unit) {
  // La nomenclatura solicitada para Acero siempre se reporta en piezas.
  if (["Acero", "Acero m"].includes(String(name || "").trim())) {
    return "pza";
  }

  if ([
    "Tensor",
    "Tensores",
    "Tensores Drop",
    "Tensor Drop",
    "Tensor TotalPlay",
    "Tensores TotalPlay"
  ].includes(String(name || "").trim())) {
    return "pza";
  }

  return unit;
}

function formatOutputMaterial(material, quantityField = "actual_quantity") {
  const quantity = Number(material.actual_quantity ?? material.quantity ?? 0);
  return {
    name: getOutputMaterialName(material.name),
    [quantityField]: quantity,
    unit: getOutputMaterialUnit(material.name, material.unit)
  };
}

function formatOutputMaterials(materials, quantityField = "actual_quantity") {
  const totals = new Map();

  for (const material of materials) {
    const formatted = formatOutputMaterial(material, quantityField);
    if (!Number.isFinite(formatted[quantityField]) || formatted[quantityField] <= 0) continue;

    const key = `${formatted.name}\u0000${formatted.unit}`;
    const current = totals.get(key);
    if (current) current[quantityField] += formatted[quantityField];
    else totals.set(key, formatted);
  }

  return [...totals.values()];
}

function isFiberRunExcludedMaterial(name) {
  const normalized = String(name || "").trim().toLowerCase();
  return [
    "postes usados",
    "postes flejados",
    "tensor totalplay",
    "tensor",
    "tensores",
    "tensores drop",
    "tensor drop",
    "splitter 1x2",
    "splitter 1x2 (pieza)",
    "splitter 1x8",
    "splitter 1x8 (pieza)"
  ].includes(normalized);
}

function formatFiberRunMaterials(materials) {
  const output = [];

  for (const material of materials) {
    if (isFiberRunExcludedMaterial(material.name)) continue;

    const name = String(material.name || "").trim().toLowerCase();
    const quantity = Number(material.actual_quantity ?? material.quantity ?? 0);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    // En tendidos, el fleje se reporta por pieza: un fleje por cada 30 metros.
    if (["fleje", "fleje 5/8", "fleje 5/8 (m)", "flejes 5/8"].includes(name)) {
      output.push({
        name: "Flejes 5/8",
        actual_quantity: Math.ceil((quantity - 1e-9) / 30),
        unit: "pza"
      });
      continue;
    }

    output.push(formatOutputMaterial(material));
  }

  return formatOutputMaterials(output);
}

function buildMaterialsOnlyPayload(materials) {
  return {
    source: "planta-externa",
    materials
  };
}

// Cada NAP utiliza su propio carrete. No se acumulan metros ni sobrantes
// entre NAP: hasta 500 m corresponde un carrete de 500 m; desde 501 m,
// corresponde un carrete de 1000 m.
function buildUnifibraReel(meters, quantityField = "actual_quantity") {
  const quantity = Number(meters);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  return {
    name: quantity <= 500
      ? "Carretes unifibra 500 m"
      : "Carretes unifibra 1000 m",
    [quantityField]: 1,
    unit: "carrete"
  };
}

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
      //"X-API-Key": process.env.N8N_WEBHOOK_SECRET
      "FiberX-Key": process.env.N8N_WEBHOOK_SECRET
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
  `).all(napId).flatMap(material => {
    // Unifibra se captura en metros, pero n8n recibe el carrete completo.
    if (["Unifibra mts", "Drop"].includes(material.name)) {
      const reel = buildUnifibraReel(material.quantity, "quantity");
      return reel ? [reel] : [];
    }

    return [{
      ...material,
      name: getOutputMaterialName(material.name),
      unit: getOutputMaterialUnit(material.name, material.unit)
    }];
  });

  return buildMaterialsOnlyPayload(
    formatOutputMaterials(materials, "actual_quantity")
  );
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

  const allMaterials = runs.flatMap(run =>
    formatFiberRunMaterials(getMaterials.all(run.id))
  );

  return buildMaterialsOnlyPayload(
    formatOutputMaterials(allMaterials)
  );
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

  return buildMaterialsOnlyPayload(
    formatFiberRunMaterials(materials)
  );
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

  const materials = db.prepare(`
    SELECT c.name, dm.actual_quantity, c.unit
    FROM nap_distribution_materials dm
    JOIN nap_distribution_material_catalog c ON c.id = dm.catalog_id
    WHERE dm.nap_id = ?
      AND dm.actual_quantity > 0
      AND c.name NOT IN ('Drop', 'Fleje', 'Acero')
    ORDER BY c.id
  `).all(napId);

  const unifibra = db.prepare(`
    SELECT dm.actual_quantity
    FROM nap_distribution_materials dm
    JOIN nap_distribution_material_catalog c ON c.id = dm.catalog_id
    WHERE dm.nap_id = ? AND c.name = 'Drop'
  `).get(napId);

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
    .map(material => formatOutputMaterial(material));

  // Cada NAP se reporta por separado: el metraje de Drop determina un solo
  // carrete para esa NAP, sin acumular ni reutilizar sobrantes de otras NAP.
  if (unifibra && unifibra.actual_quantity !== null) {
    const reel = buildUnifibraReel(unifibra.actual_quantity);
    if (reel) reportMaterials.push(reel);
  }

  // El Fleje se reporta únicamente cuando el acumulado asigna una o más piezas.
  if (fleje && fleje.actual_quantity !== null && flejeAllocation.pieces > 0) {
    reportMaterials.push({
      name: 'Flejes 5/8',
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

  return buildMaterialsOnlyPayload(
    formatOutputMaterials(reportMaterials)
  );
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
