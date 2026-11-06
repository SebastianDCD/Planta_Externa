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
      construction_status
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

// Ruta de prueba
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Control de Planta Externa funcionando",
  });
});

module.exports = app;
