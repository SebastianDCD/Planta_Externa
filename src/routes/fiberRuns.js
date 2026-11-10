
const express = require("express");
const db = require("../database");

const {
  sendFiberRunToN8n,
  sendNapDistributionToN8n
} = require("../services/N8nService");

const { randomUUID } = require("crypto");

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
    completed_at,
    n8n_report_id,
    n8n_status,
    n8n_sending,
    n8n_sent_at,
    n8n_last_error
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
    return res.status(400).json({
      success: false,
      message: "ID inválido."
    });
  }

  try {
    const result = db.transaction(() => {
      const run = db.prepare(`
        SELECT *
        FROM fiber_runs
        WHERE id = ?
      `).get(runId);

      if (!run) throw new Error("NOT_FOUND");
      if (run.status === "COMPLETADO") throw new Error("ALREADY_COMPLETED");

      const reportId = randomUUID();

      db.prepare(`
        UPDATE fiber_runs
        SET status = 'COMPLETADO',
            completed_at = CURRENT_TIMESTAMP,
            n8n_report_id = ?,
            n8n_sending = 1,
            n8n_status = 'PENDING',
            n8n_sent_at = NULL,
            n8n_last_error = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(reportId, runId);

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

      if (remaining === 0) {
        db.prepare(`
          UPDATE construction_phases
          SET status = 'COMPLETADA',
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(run.construction_phase_id);
      }

      return {
        reportId,
        phaseCompleted: remaining === 0,
        remaining
      };
    })();

    try {
      const n8nResult = await sendFiberRunToN8n(runId);

      db.prepare(`
        UPDATE fiber_runs
        SET n8n_sending = 0,
            n8n_status = 'SENT',
            n8n_sent_at = CURRENT_TIMESTAMP,
            n8n_last_error = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND n8n_report_id = ?
      `).run(runId, result.reportId);

      return res.json({
        success: true,
        message: "Tendido completado y enviado a n8n.",
        ...result,
        n8n: {
          sent: true,
          report_id: result.reportId,
          message: n8nResult.message || "JSON recibido por n8n."
        }
      });

    } catch (n8nError) {
      db.prepare(`
        UPDATE fiber_runs
        SET n8n_sending = 0,
            n8n_status = 'ERROR',
            n8n_last_error = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND n8n_report_id = ?
      `).run(n8nError.message, runId, result.reportId);

      return res.json({
        success: true,
        message: "Tendido completado, pero falló el envío a n8n.",
        ...result,
        n8n: {
          sent: false,
          report_id: result.reportId,
          error: n8nError.message
        }
      });
    }

  } catch (error) {
    if (error.message === "NOT_FOUND") {
      return res.status(404).json({
        success: false,
        message: "Tendido no encontrado."
      });
    }

    if (error.message === "ALREADY_COMPLETED") {
      return res.status(409).json({
        success: false,
        message: "El tendido ya está completado."
      });
    }

    console.error("Error al completar tendido:", error);

    return res.status(500).json({
      success: false,
      message: "Error al completar el tendido."
    });
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
      if (run.n8n_sending === 1) throw new Error("SENDING");

      db.prepare(`
        UPDATE fiber_runs
        SET status = 'EN_PROCESO',
            completed_at = NULL,
            n8n_report_id = NULL,
            n8n_status = 'PENDING',
            n8n_sending = 0,
            n8n_sent_at = NULL,
            n8n_last_error = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(runId);

      db.prepare(`
        INSERT INTO fiber_run_history (fiber_run_id, action, details)
        VALUES (?, 'REABIERTO', ?)
      `).run(runId, "Tendido reabierto.");

      db.prepare(`
        UPDATE construction_phases
        SET status = 'EN_PROCESO',
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
    return res.status(500).json({
      success: false,
      message: "Error al reabrir el tendido."
    });
  }
});


 // Reintentar envío de un tendido a n8n
router.post("/fiber-runs/:runId/retry", async (req, res) => {
  const runId = Number(req.params.runId);

  if (!Number.isInteger(runId) || runId <= 0) {
    return res.status(400).json({ success: false, message: "ID inválido." });
  }

  try {
    const run = db.prepare(`
      SELECT * FROM fiber_runs WHERE id = ?
    `).get(runId);

    if (!run) {
      return res.status(404).json({
        success: false,
        message: "Tendido no encontrado."
      });
    }

    if (run.status !== "COMPLETADO") {
      return res.status(409).json({
        success: false,
        message: "El tendido no está completado."
      });
    }

    if (run.n8n_status === "SENT") {
      return res.status(409).json({
        success: false,
        message: "Este reporte ya fue enviado."
      });
    }

    if (run.n8n_sending === 1) {
      return res.status(409).json({
        success: false,
        message: "Ya existe un envío en curso."
      });
    }

    if (!run.n8n_report_id) {
      return res.status(409).json({
        success: false,
        message: "El tendido no tiene un identificador de reporte."
      });
    }

    const lock = db.prepare(`
      UPDATE fiber_runs
      SET n8n_sending = 1
      WHERE id = ?
        AND n8n_sending = 0
        AND n8n_status != 'SENT'
        AND n8n_report_id = ?
    `).run(runId, run.n8n_report_id);

    if (lock.changes !== 1) {
      return res.status(409).json({
        success: false,
        message: "No fue posible reservar el envío. Intenta nuevamente."
      });
    }

    try {
      const n8nResult = await sendFiberRunToN8n(runId);

      db.prepare(`
        UPDATE fiber_runs
        SET n8n_sending = 0,
            n8n_status = 'SENT',
            n8n_sent_at = CURRENT_TIMESTAMP,
            n8n_last_error = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND n8n_report_id = ?
      `).run(runId, run.n8n_report_id);

      return res.json({
        success: true,
        message: "Reporte enviado correctamente.",
        report_id: run.n8n_report_id,
        n8n: {
          sent: true,
          message: n8nResult.message || "JSON recibido por n8n."
        }
      });
    } catch (n8nError) {
      db.prepare(`
        UPDATE fiber_runs
        SET n8n_sending = 0,
            n8n_status = 'ERROR',
            n8n_last_error = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND n8n_report_id = ?
      `).run(n8nError.message, runId, run.n8n_report_id);

      return res.status(502).json({
        success: false,
        message: "No se pudo enviar el reporte a n8n.",
        report_id: run.n8n_report_id,
        error: n8nError.message
      });
    }
  } catch (error) {
    console.error("Error al reintentar envío del tendido:", error);
    return res.status(500).json({
      success: false,
      message: "Error al procesar el reintento."
    });
  }
});


// ======================================================
// DISTRIBUCIÓN INDIVIDUAL DE NAP
// ======================================================

// Consultar primeros niveles y NAP de una fase constructiva
router.get("/construction-phases/:phaseId/naps", (req, res) => {
  const phaseId = Number(req.params.phaseId);

  if (!Number.isInteger(phaseId) || phaseId <= 0) {
    return res.status(400).json({
      success: false,
      message: "ID de fase inválido."
    });
  }

  const phase = db.prepare(`
    SELECT id, number, name, status
    FROM construction_phases
    WHERE id = ?
  `).get(phaseId);

  if (!phase) {
    return res.status(404).json({
      success: false,
      message: "No se encontró la fase."
    });
  }

  const groups = db.prepare(`
    SELECT
      p.id,
      p.name,
      p.display_code
    FROM construction_phase_groups cpg
    JOIN phases p ON p.id = cpg.phase_id
    WHERE cpg.construction_phase_id = ?
    ORDER BY p.display_code
  `).all(phaseId);

  const getNaps = db.prepare(`
    SELECT
      n.id,
      n.number,
      n.meters,
      n.construction_status,
      ndr.report_id,
      ndr.n8n_status,
      ndr.n8n_sending,
      ndr.n8n_sent_at,
      ndr.n8n_last_error,
      ndr.completed_at AS distribution_completed_at
    FROM naps n
    JOIN nap_distribution_reports ndr ON ndr.nap_id = n.id
    WHERE n.phase_id = ?
    ORDER BY n.number
  `);

  const getMaterials = db.prepare(`
    SELECT
      dm.id,
      c.name,
      c.unit,
      dm.initial_quantity,
      dm.actual_quantity
    FROM nap_distribution_materials dm
    JOIN nap_distribution_material_catalog c
      ON c.id = dm.catalog_id
    WHERE dm.nap_id = ?
    ORDER BY c.id
  `);

  const data = groups.map(group => {
    const naps = getNaps.all(group.id).map(nap => ({
      ...nap,
      materials: getMaterials.all(nap.id)
    }));

    return {
      ...group,
      naps
    };
  });

  res.json({
    success: true,
    phase,
    data
  });
});


// Guardar cantidad real de un material de distribución
router.patch(
  "/naps/:napId/distribution-materials/:materialId",
  (req, res) => {
    const napId = Number(req.params.napId);
    const materialId = Number(req.params.materialId);
    const { actual_quantity } = req.body;

    if (
      !Number.isInteger(napId) || napId <= 0 ||
      !Number.isInteger(materialId) || materialId <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Identificadores inválidos."
      });
    }

    if (
      actual_quantity !== null &&
      (
        typeof actual_quantity !== "number" ||
        !Number.isFinite(actual_quantity) ||
        actual_quantity < 0
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "La cantidad debe ser un número válido igual o mayor a cero, o estar vacía."
      });
    }

    const material = db.prepare(`
      SELECT
        dm.id,
        ndr.completed_at
      FROM nap_distribution_materials dm
      JOIN nap_distribution_reports ndr
        ON ndr.nap_id = dm.nap_id
      WHERE dm.id = ? AND dm.nap_id = ?
    `).get(materialId, napId);

    if (!material) {
      return res.status(404).json({
        success: false,
        message: "No se encontró el material."
      });
    }

    if (material.completed_at) {
      return res.status(409).json({
        success: false,
        message: "La distribución está completada. Debes reabrir la NAP para modificar materiales."
      });
    }

    db.prepare(`
      UPDATE nap_distribution_materials
      SET actual_quantity = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(actual_quantity, materialId);

    res.json({
      success: true,
      message: "Cantidad actualizada correctamente.",
      data: { actual_quantity }
    });
  }
);


// Completar distribución de una NAP y enviar su reporte individual
router.patch("/naps/:napId/distribution/complete", async (req, res) => {
  const napId = Number(req.params.napId);

  if (!Number.isInteger(napId) || napId <= 0) {
    return res.status(400).json({
      success: false,
      message: "ID de NAP inválido."
    });
  }

  try {
    const result = db.transaction(() => {
      const report = db.prepare(`
        SELECT *
        FROM nap_distribution_reports
        WHERE nap_id = ?
      `).get(napId);

      if (!report) throw new Error("NOT_FOUND");
      if (report.completed_at) throw new Error("ALREADY_COMPLETED");
      if (report.n8n_sending === 1) throw new Error("SENDING");

      const reportId = randomUUID();

      db.prepare(`
        UPDATE nap_distribution_reports
        SET completed_at = CURRENT_TIMESTAMP,
            report_id = ?,
            n8n_status = 'PENDING',
            n8n_sending = 1,
            n8n_sent_at = NULL,
            n8n_last_error = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE nap_id = ?
      `).run(reportId, napId);

      return { reportId };
    })();

    try {
      const n8nResult = await sendNapDistributionToN8n(napId);

      db.prepare(`
        UPDATE nap_distribution_reports
        SET n8n_sending = 0,
            n8n_status = 'SENT',
            n8n_sent_at = CURRENT_TIMESTAMP,
            n8n_last_error = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE nap_id = ? AND report_id = ?
      `).run(napId, result.reportId);

      return res.json({
        success: true,
        message: "Distribución completada y enviada a n8n.",
        report_id: result.reportId,
        n8n: {
          sent: true,
          message: n8nResult.message || "JSON recibido por n8n."
        }
      });

    } catch (n8nError) {
      db.prepare(`
        UPDATE nap_distribution_reports
        SET n8n_sending = 0,
            n8n_status = 'ERROR',
            n8n_last_error = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE nap_id = ? AND report_id = ?
      `).run(n8nError.message, napId, result.reportId);

      return res.json({
        success: true,
        message: "Distribución completada, pero falló el envío a n8n.",
        report_id: result.reportId,
        n8n: {
          sent: false,
          error: n8nError.message
        }
      });
    }

  } catch (error) {
    const errors = {
      NOT_FOUND: [404, "No se encontró el control de distribución de la NAP."],
      ALREADY_COMPLETED: [409, "La distribución de esta NAP ya está completada."],
      SENDING: [409, "Ya existe un envío en curso."]
    };

    if (errors[error.message]) {
      const [status, message] = errors[error.message];
      return res.status(status).json({ success: false, message });
    }

    console.error("Error al completar distribución NAP:", error);

    return res.status(500).json({
      success: false,
      message: "Error al completar la distribución."
    });
  }
});


// Reabrir distribución de una NAP
router.patch("/naps/:napId/distribution/reopen", (req, res) => {
  const napId = Number(req.params.napId);

  if (!Number.isInteger(napId) || napId <= 0) {
    return res.status(400).json({
      success: false,
      message: "ID de NAP inválido."
    });
  }

  try {
    const result = db.prepare(`
      UPDATE nap_distribution_reports
      SET completed_at = NULL,
          report_id = NULL,
          n8n_status = 'PENDING',
          n8n_sending = 0,
          n8n_sent_at = NULL,
          n8n_last_error = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE nap_id = ?
        AND completed_at IS NOT NULL
        AND n8n_sending = 0
    `).run(napId);

    if (result.changes === 0) {
      const report = db.prepare(`
        SELECT completed_at, n8n_sending
        FROM nap_distribution_reports
        WHERE nap_id = ?
      `).get(napId);

      if (!report) {
        return res.status(404).json({
          success: false,
          message: "No se encontró la NAP."
        });
      }

      return res.status(409).json({
        success: false,
        message: report.n8n_sending
          ? "Hay un envío en curso. Intenta nuevamente después."
          : "La distribución no está completada."
      });
    }

    res.json({
      success: true,
      message: "Distribución reabierta correctamente."
    });

  } catch (error) {
    console.error("Error al reabrir distribución NAP:", error);

    res.status(500).json({
      success: false,
      message: "Error al reabrir la distribución."
    });
  }
});


// Reintentar envío de distribución NAP a n8n
router.post("/naps/:napId/distribution/retry", async (req, res) => {
  const napId = Number(req.params.napId);

  if (!Number.isInteger(napId) || napId <= 0) {
    return res.status(400).json({
      success: false,
      message: "ID de NAP inválido."
    });
  }

  const report = db.prepare(`
    SELECT *
    FROM nap_distribution_reports
    WHERE nap_id = ?
  `).get(napId);

  if (!report) {
    return res.status(404).json({
      success: false,
      message: "No se encontró la NAP."
    });
  }

  if (!report.completed_at) {
    return res.status(409).json({
      success: false,
      message: "La distribución no está completada."
    });
  }

  if (report.n8n_status === "SENT") {
    return res.status(409).json({
      success: false,
      message: "Este reporte ya fue enviado."
    });
  }

  if (report.n8n_sending === 1) {
    return res.status(409).json({
      success: false,
      message: "Ya existe un envío en curso."
    });
  }

  if (!report.report_id) {
    return res.status(409).json({
      success: false,
      message: "La NAP no tiene identificador de reporte."
    });
  }

  const lock = db.prepare(`
    UPDATE nap_distribution_reports
    SET n8n_sending = 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE nap_id = ?
      AND n8n_sending = 0
      AND n8n_status != 'SENT'
      AND report_id = ?
  `).run(napId, report.report_id);

  if (lock.changes !== 1) {
    return res.status(409).json({
      success: false,
      message: "No fue posible reservar el envío. Intenta nuevamente."
    });
  }

  try {
    const n8nResult = await sendNapDistributionToN8n(napId);

    db.prepare(`
      UPDATE nap_distribution_reports
      SET n8n_sending = 0,
          n8n_status = 'SENT',
          n8n_sent_at = CURRENT_TIMESTAMP,
          n8n_last_error = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE nap_id = ? AND report_id = ?
    `).run(napId, report.report_id);

    return res.json({
      success: true,
      message: "Reporte enviado correctamente.",
      report_id: report.report_id,
      n8n: {
        sent: true,
        message: n8nResult.message || "JSON recibido por n8n."
      }
    });

  } catch (n8nError) {
    db.prepare(`
      UPDATE nap_distribution_reports
      SET n8n_sending = 0,
          n8n_status = 'ERROR',
          n8n_last_error = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE nap_id = ? AND report_id = ?
    `).run(n8nError.message, napId, report.report_id);

    return res.status(502).json({
      success: false,
      message: "No se pudo enviar el reporte a n8n.",
      report_id: report.report_id,
      error: n8nError.message
    });
  }
});


module.exports = router;
