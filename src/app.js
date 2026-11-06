const express = require("express");
const path = require("path");
const db = require("./database");

const app = express();

// Middlewares
app.use(express.json());

// Archivos públicos
app.use(express.static(path.join(__dirname, "public")));

// Consultar todos los proyectos
app.get("/api/projects", (req, res) => {
  const projects = db
    .prepare(`
      SELECT id, name
      FROM projects
      ORDER BY name
    `)
    .all();

  res.json({
    success: true,
    data: projects,
  });
});


// Consultar fases de un proyecto
app.get("/api/phases", (req, res) => {
  const projectId = Number(req.query.project_id);

  if (!Number.isInteger(projectId) || projectId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Debes proporcionar un ID de proyecto válido.",
    });
  }

  const project = db.prepare(`
    SELECT id, name
    FROM projects
    WHERE id = ?
  `).get(projectId);

  if (!project) {
    return res.status(404).json({
      success: false,
      message: "No se encontró el proyecto.",
    });
  }

  const phases = db.prepare(`
    SELECT id, name, status
    FROM phases
    WHERE project_id = ?
    ORDER BY id
  `).all(projectId);

  const getNaps = db.prepare(`
  SELECT
    number,
    meters,
    status,
    construction_status,
    opening_date,
    opening_power
  FROM naps
  WHERE phase_id = ?
  ORDER BY number
`);

  const result = phases.map((phase) => {
    const naps = getNaps.all(phase.id);

    return {
      ...phase,
      naps,
      availableSlots: 8 - naps.length,
    };
  });

  res.json({
    success: true,
    project,
    data: result,
  });
});

// Marcar una NAP como terminada
app.patch("/api/phases/:phaseId/naps/:napNumber/complete", (req, res) => {
  const phaseId = Number(req.params.phaseId);
  const napNumber = Number(req.params.napNumber);

  const nap = db
    .prepare(
      `
        SELECT id, status
        FROM naps
        WHERE phase_id = ? AND number = ?
    `,
    )
    .get(phaseId, napNumber);

  if (!nap) {
    return res.status(404).json({
      success: false,
      message: "No se encontró la NAP solicitada",
    });
  }

  if (nap.status === "COMPLETED") {
    return res.status(409).json({
      success: false,
      message: "Esta NAP ya está terminada",
    });
  }

  db.prepare(
    `
        UPDATE naps
        SET status = 'COMPLETED'
        WHERE id = ?
    `,
  ).run(nap.id);

  const completedNap = db
    .prepare(
      `
    SELECT
        phases.name AS phase,
        naps.number AS nap,
        naps.meters,
        naps.status
    FROM naps
    INNER JOIN phases ON phases.id = naps.phase_id
    WHERE naps.id = ?
`,
    )
    .get(nap.id);

  res.json({
    success: true,
    message: "NAP terminada correctamente",

    data: {
      phase: completedNap.phase,
      nap: completedNap.nap,
      meters: completedNap.meters,
      status: completedNap.status,
      materials: [],
    },

    reminder: "Date prisa Sebastian, seguimos esperando tus inventarios...",
  });

});

// Marcar construcción de una NAP como terminada
app.patch("/api/phases/:phaseId/naps/:napNumber/construction", (req, res) => {
  const phaseId = Number(req.params.phaseId);
  const napNumber = Number(req.params.napNumber);

  const nap = db.prepare(`
    SELECT id, construction_status
    FROM naps
    WHERE phase_id = ? AND number = ?
  `).get(phaseId, napNumber);

  if (!nap) {
    return res.status(404).json({
      success: false,
      message: "No se encontró la NAP solicitada.",
    });
  }

  if (nap.construction_status === "TERMINADA") {
    return res.status(409).json({
      success: false,
      message: "La construcción de esta NAP ya está terminada.",
    });
  }

  db.prepare(`
    UPDATE naps
    SET construction_status = 'TERMINADA'
    WHERE id = ?
  `).run(nap.id);

  res.json({
    success: true,
    message: "Construcción terminada correctamente.",
    data: {
      phaseId,
      nap: napNumber,
      construction_status: "TERMINADA",
    },
  });
});


// Registrar apertura de una NAP
app.patch("/api/phases/:phaseId/naps/:napNumber/opening", (req, res) => {
  const phaseId = Number(req.params.phaseId);
  const napNumber = Number(req.params.napNumber);

  const { opening_date, opening_power } = req.body;

  if (!Number.isInteger(phaseId) || phaseId <= 0 ||
      !Number.isInteger(napNumber) || napNumber < 1 || napNumber > 8) {
    return res.status(400).json({
      success: false,
      message: "La fase o el número de NAP no son válidos.",
    });
  }

if (
  typeof opening_date !== "string" ||
  !/^\d{4}-\d{2}-\d{2}$/.test(opening_date) ||
  new Date(`${opening_date}T00:00:00.000Z`).toISOString().slice(0, 10) !== opening_date
) {
  return res.status(400).json({
    success: false,
    message: "Debes proporcionar una fecha válida.",
  });
}

const today = new Date();

const todayLocal = [
  today.getFullYear(),
  String(today.getMonth() + 1).padStart(2, "0"),
  String(today.getDate()).padStart(2, "0"),
].join("-");

if (opening_date > todayLocal) {
  return res.status(400).json({
    success: false,
    message: "La fecha de apertura no puede ser futura.",
  });
}

  if (
    typeof opening_power !== "number" ||
    !Number.isFinite(opening_power) ||
    opening_power < -100 ||
    opening_power > 10
  ) {
    return res.status(400).json({
      success: false,
      message: "La potencia debe ser un número válido en dBm.",
    });
  }

  const nap = db.prepare(`
    SELECT id, opening_date
    FROM naps
    WHERE phase_id = ? AND number = ?
  `).get(phaseId, napNumber);

  if (!nap) {
    return res.status(404).json({
      success: false,
      message: "No se encontró la NAP solicitada.",
    });
  }

  if (nap.opening_date !== null) {
    return res.status(409).json({
      success: false,
      message: "Esta NAP ya tiene una apertura registrada.",
    });
  }

  db.prepare(`
    UPDATE naps
    SET
      opening_date = ?,
      opening_power = ?,
      construction_status = 'TERMINADA'
    WHERE id = ?
  `).run(opening_date, opening_power, nap.id);

  res.json({
    success: true,
    message: "Apertura registrada correctamente.",
    data: {
      phaseId,
      nap: napNumber,
      opening_date,
      opening_power,
    },
  });
});


// Ruta de prueba
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Control de Planta Externa funcionando",
  });
});

module.exports = app;
