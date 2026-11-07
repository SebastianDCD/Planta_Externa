const db = require("../database");

function buildNapPayload(napId) {
  const nap = db
    .prepare(
      `
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
`,
    )
    .get(napId);

  if (!nap) {
    throw new Error(`No se encontró la NAP con ID ${napId}`);
  }

  const materials = db
    .prepare(
      `
    SELECT
        name,
        quantity,
        unit
    FROM nap_materials
    WHERE nap_id = ?
      AND quantity > 0
    ORDER BY name
`,
    )
    .all(napId);

  return {
    source: "planta-externa",

    project: {
      id: nap.project_id,
      name: nap.project_name,
    },

    phase: {
      id: nap.phase_id,
      name: nap.phase_name,
    },

    nap: {
      id: nap.nap_id,
      number: nap.nap_number,
      opening_date: nap.opening_date,
      opening_power: nap.opening_power,
      construction_status: nap.construction_status,
    },

    materials,
  };
}

async function sendNapToN8n(napId) {
    if (!process.env.N8N_WEBHOOK_URL || !process.env.N8N_WEBHOOK_SECRET) {
    throw new Error("Falta configurar la conexión con n8n.");
}
    const payload = buildNapPayload(napId);

    const response = await fetch(process.env.N8N_WEBHOOK_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-API-Key": process.env.N8N_WEBHOOK_SECRET
        },
        body: JSON.stringify(payload)
    });

if (!response.ok) {
    const errorDetails = await response.text();

    throw new Error(
        `n8n respondió con HTTP ${response.status}: ${errorDetails}`
    );
}

    return await response.json();
}


module.exports = {
    buildNapPayload,
    sendNapToN8n
};
