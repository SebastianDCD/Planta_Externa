
const express = require("express");
const db = require("../database");

const {
  sendConstructionPhaseToN8n
} = require("../services/N8nService");

const router = express.Router();

// Consultar las fases de construcción
router.get("/construction-phases", (req, res) => {
  const projectId = Number(req.query.project_id);

  if (!Number.isInteger(projectId) || projectId <= 0) {
    return res.status(400).json({
      success: false,
      message: "ID de proyecto inválido."
    });
  }

  const phases = db.prepare(`
    SELECT
      cp.id,
      cp.number,
      cp.name,
      cp.status,
      cp.n8n_status,
      COUNT(fr.id) AS total_runs,
      SUM(CASE WHEN fr.status = 'COMPLETADO' THEN 1 ELSE 0 END)
        AS completed_runs
    FROM construction_phases cp
    LEFT JOIN fiber_runs fr
      ON fr.construction_phase_id = cp.id
    WHERE cp.project_id = ?
    GROUP BY cp.id
    ORDER BY cp.number
  `).all(projectId);

  res.json({
    success: true,
    data: phases
  });
});

// Consultar los tendidos y materiales de una fase
router.get("/construction-phases/:phaseId/runs", (req, res) => {
  const phaseId = Number(req.params.phaseId);

  if (!Number.isInteger(phaseId) || phaseId <= 0) {
    return res.status(400).json({
      success: false,
      message: "ID de fase inválido."
    });
  }

  const phase = db.prepare(`
    SELECT id, number, name, status, n8n_status
    FROM construction_phases
    WHERE id = ?
  `).get(phaseId);

  if (!phase) {
    return res.status(404).json({
      success: false,
      message: "No se encontró la fase."
    });
  }

  const runs = db.prepare(`
    SELECT
      id,
      name,
      strand_count,
      status,
      completed_at
    FROM fiber_runs
    WHERE construction_phase_id = ?
    ORDER BY id
  `).all(phaseId);

  const getMaterials = db.prepare(`
    SELECT
      id,
      name,
      initial_quantity,
      actual_quantity,
      unit
    FROM fiber_run_materials
    WHERE fiber_run_id = ?
    ORDER BY id
  `);

  const data = runs.map(run => ({
    ...run,
    materials: getMaterials.all(run.id)
  }));

  res.json({
    success: true,
    phase,
    data
  });
});


// Modificar la cantidad real de un material
router.patch(
  "/fiber-runs/:runId/materials/:materialId",
  (req, res) => {
    const runId = Number(req.params.runId);
    const materialId = Number(req.params.materialId);
    const { actual_quantity } = req.body;

    if (
      !Number.isInteger(runId) || runId <= 0 ||
      !Number.isInteger(materialId) || materialId <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Identificadores inválidos."
      });
    }

    if (
      typeof actual_quantity !== "number" ||
      !Number.isFinite(actual_quantity) ||
      actual_quantity < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "La cantidad debe ser un número válido igual o mayor a cero."
      });
    }

    const material = db.prepare(`
      SELECT
        frm.id,
        frm.name,
        frm.actual_quantity,
        fr.status
      FROM fiber_run_materials frm
      JOIN fiber_runs fr ON fr.id = frm.fiber_run_id
      WHERE frm.id = ? AND fr.id = ?
    `).get(materialId, runId);

    if (!material) {
      return res.status(404).json({
        success: false,
        message: "No se encontró el material."
      });
    }

    if (material.status === "COMPLETADO") {
      return res.status(409).json({
        success: false,
        message: "El tendido está bloqueado. Debes reabrirlo para modificar materiales."
      });
    }

    const previousQuantity = material.actual_quantity;

    const updateMaterial = db.transaction(() => {
      db.prepare(`
        UPDATE fiber_run_materials
        SET actual_quantity = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(actual_quantity, materialId);

      const details = JSON.stringify({
        material: material.name,
        previous_quantity: previousQuantity,
        new_quantity: actual_quantity
      });

      db.prepare(`
        INSERT INTO fiber_run_history (
          fiber_run_id,
          action,
          details
        )
        VALUES (?, 'MATERIAL_ACTUALIZADO', ?)
      `).run(runId, details);
    });

    updateMaterial();

    res.json({
      success: true,
      message: "Cantidad actualizada y movimiento registrado.",
      data: {
        previous_quantity: previousQuantity,
        actual_quantity
      }
    });
  }
);



// Completar un tendido y enviar la fase a n8n cuando corresponda

router.patch("/fiber-runs/:runId/complete", async (req, res) => {
  const runId = Number(req.params.runId);

  if (!Number.isInteger(runId) || runId <= 0) {
    return res.status(400).json({ success: false, message: "ID inválido." });
  }

  try {
    const result = db.transaction(() => {
      const run = db.prepare(`
        SELECT * FROM fiber_runs WHERE id = ?
      `).get(runId);

      if (!run) throw new Error("NOT_FOUND");
      if (run.status === "COMPLETADO") throw new Error("ALREADY_COMPLETED");

      db.prepare(`
        UPDATE fiber_runs
        SET status = 'COMPLETADO', completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(runId);

      db.prepare(`
        INSERT INTO fiber_run_history (fiber_run_id, action, details)
        VALUES (?, 'COMPLETADO', ?)
      `).run(runId, "Tendido completado.");

      const remaining = db.prepare(`
        SELECT COUNT(*) AS total
        FROM fiber_runs
        WHERE construction_phase_id = ?
          AND status != 'COMPLETADO'
      `).get(run.construction_phase_id).total;

      if (remaining > 0) {
        return { phaseCompleted: false, remaining };
      }

      const phase = db.prepare(`
        SELECT cp.*, p.name AS project_name
        FROM construction_phases cp
        JOIN projects p ON p.id = cp.project_id
        WHERE cp.id = ?
      `).get(run.construction_phase_id);

      const nextVersion = phase.report_version + 1;
      const projectCode = phase.project_name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-");

      const reportId =
        `${projectCode}-FASE-${phase.number}-V${nextVersion}`;

      db.prepare(`
        UPDATE construction_phases
        SET status = 'COMPLETADA',
            report_version = ?,
            n8n_report_id = ?,
            n8n_sending = 1,
            n8n_status = 'PENDING',
            n8n_sent_at = NULL,
            n8n_last_error = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(nextVersion, reportId, phase.id);

      return {
        phaseCompleted: true,
        remaining: 0,
        phaseId: phase.id,
        reportId,
        reportVersion: nextVersion
      };
    })();

    if (!result.phaseCompleted) {
      return res.json({
        success: true,
        message: "Tendido completado.",
        ...result
      });
    }

    try {
      const n8nResult = await sendConstructionPhaseToN8n(result.phaseId);

      db.prepare(`
        UPDATE construction_phases
        SET n8n_sending = 0,
            n8n_status = 'SENT',
            n8n_sent_at = CURRENT_TIMESTAMP,
            n8n_last_error = NULL
        WHERE id = ? AND n8n_report_id = ?
      `).run(result.phaseId, result.reportId);

      return res.json({
        success: true,
        message: "Fase completada y reporte enviado.",
        ...result,
        n8n: {
          sent: true,
          message: n8nResult.message || "JSON recibido por n8n."
        }
      });
    } catch (n8nError) {
      db.prepare(`
        UPDATE construction_phases
        SET n8n_sending = 0,
            n8n_status = 'ERROR',
            n8n_last_error = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND n8n_report_id = ?
      `).run(n8nError.message, result.phaseId, result.reportId);

      return res.json({
        success: true,
        message: "Fase completada, pero falló el envío a n8n.",
        ...result,
        n8n: {
          sent: false,
          error: n8nError.message
        }
      });
    }
  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({ success: false, message: "Tendido no encontrado." });
    }

    if (error.message === "ALREADY_COMPLETED") {
      return res.status(409).json({ success: false, message: "El tendido ya está completado." });
    }

    console.error("Error al completar tendido:", error);
    return res.status(500).json({ success: false, message: "Error al completar el tendido." });
  }
});


// Reabrir un tendido
router.patch("/fiber-runs/:runId/reopen", (req, res) => {
  const runId = Number(req.params.runId);

  if (!Number.isInteger(runId) || runId <= 0) {
    return res.status(400).json({ success: false, message: "ID inválido." });
  }

  try {
    const result = db.transaction(() => {
      const run = db.prepare(`
        SELECT * FROM fiber_runs WHERE id = ?
      `).get(runId);

      if (!run) throw new Error("NOT_FOUND");
      if (run.status !== "COMPLETADO") throw new Error("NOT_COMPLETED");

      const phase = db.prepare(`
        SELECT n8n_sending
        FROM construction_phases
        WHERE id = ?
      `).get(run.construction_phase_id);

      if (phase.n8n_sending === 1) throw new Error("SENDING");

      db.prepare(`
        UPDATE fiber_runs
        SET status = 'EN_PROCESO', completed_at = NULL
        WHERE id = ?
      `).run(runId);

      db.prepare(`
        INSERT INTO fiber_run_history (fiber_run_id, action, details)
        VALUES (?, 'REABIERTO', ?)
      `).run(runId, "Tendido reabierto.");

      db.prepare(`
        UPDATE construction_phases
        SET status = 'EN_PROCESO',
            n8n_status = 'PENDING',
            n8n_sent_at = NULL,
            n8n_last_error = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(run.construction_phase_id);

      return { phaseId: run.construction_phase_id };
    })();

    return res.json({
      success: true,
      message: "Tendido reabierto correctamente.",
      ...result
    });
  } catch (error) {
    const errors = {
      NOT_FOUND: [404, "Tendido no encontrado."],
      NOT_COMPLETED: [409, "El tendido no está completado."],
      SENDING: [409, "Hay un envío a n8n en curso. Intenta nuevamente después."]
    };

    if (errors[error.message]) {
      const [status, message] = errors[error.message];
      return res.status(status).json({ success: false, message });
    }

    console.error("Error al reabrir tendido:", error);
    return res.status(500).json({ success: false, message: "Error al reabrir el tendido." });
  }
});

// Reintentar envío de una fase de construcción a n8n
router.post("/construction-phases/:phaseId/retry", async (req, res) => {
  const phaseId = Number(req.params.phaseId);

  if (!Number.isInteger(phaseId) || phaseId <= 0) {
    return res.status(400).json({ success: false, message: "ID inválido." });
  }

  try {
    const phase = db.prepare(`
      SELECT *
      FROM construction_phases
      WHERE id = ?
    `).get(phaseId);

    if (!phase) {
      return res.status(404).json({ success: false, message: "Fase no encontrada." });
    }

    if (phase.status !== "COMPLETADA") {
      return res.status(409).json({ success: false, message: "La fase no está completada." });
    }

    if (phase.n8n_status === "SENT") {
      return res.status(409).json({ success: false, message: "Este reporte ya fue enviado." });
    }

    if (phase.n8n_sending === 1) {
      return res.status(409).json({ success: false, message: "Ya existe un envío en curso." });
    }

    if (!phase.n8n_report_id) {
      return res.status(409).json({ success: false, message: "La fase no tiene un identificador de reporte." });
    }

    const lock = db.prepare(`
      UPDATE construction_phases
      SET n8n_sending = 1
      WHERE id = ?
        AND n8n_sending = 0
        AND n8n_status != 'SENT'
    `).run(phaseId);

    if (lock.changes !== 1) {
      return res.status(409).json({ success: false, message: "No fue posible reservar el envío. Intenta nuevamente." });
    }

    try {
      const n8nResult = await sendConstructionPhaseToN8n(phaseId);

      db.prepare(`
        UPDATE construction_phases
        SET n8n_sending = 0,
            n8n_status = 'SENT',
            n8n_sent_at = CURRENT_TIMESTAMP,
            n8n_last_error = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND n8n_report_id = ?
      `).run(phaseId, phase.n8n_report_id);

      return res.json({
        success: true,
        message: "Reporte enviado correctamente.",
        report_id: phase.n8n_report_id,
        n8n: {
          sent: true,
          message: n8nResult.message || "JSON recibido por n8n."
        }
      });
    } catch (n8nError) {
      db.prepare(`
        UPDATE construction_phases
        SET n8n_sending = 0,
            n8n_status = 'ERROR',
            n8n_last_error = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND n8n_report_id = ?
      `).run(n8nError.message, phaseId, phase.n8n_report_id);

      return res.status(502).json({
        success: false,
        message: "No se pudo enviar el reporte a n8n.",
        report_id: phase.n8n_report_id,
        error: n8nError.message
      });
    }
  } catch (error) {
    console.error("Error al reintentar envío:", error);
    return res.status(500).json({ success: false, message: "Error al procesar el reintento." });
  }
});

module.exports = router;
