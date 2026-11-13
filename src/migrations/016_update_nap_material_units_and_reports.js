const db = require("../database");

try {
  const migrate = db.transaction(() => {
    const columns = db.prepare(`PRAGMA table_info(nap_distribution_reports)`).all();
    const hasNeedsUpdate = columns.some(column => column.name === "n8n_needs_update");

    if (!hasNeedsUpdate) {
      db.exec(`
        ALTER TABLE nap_distribution_reports
        ADD COLUMN n8n_needs_update INTEGER NOT NULL DEFAULT 0
          CHECK (n8n_needs_update IN (0, 1));
      `);
    }

    db.prepare(`
      UPDATE nap_distribution_material_catalog
      SET unit = 'pza'
      WHERE name = 'Acero'
    `).run();

    // Fleje se sigue capturando en metros. La conversión a piezas se realiza
    // al construir cada reporte individual, acumulando 30 m por pieza.
    db.prepare(`
      UPDATE nap_distribution_material_catalog
      SET unit = 'm'
      WHERE name = 'Fleje'
    `).run();

    const acero = db.prepare(`
      SELECT COUNT(*) AS total
      FROM nap_distribution_material_catalog
      WHERE name = 'Acero' AND unit = 'pza'
    `).get().total;

    const fleje = db.prepare(`
      SELECT COUNT(*) AS total
      FROM nap_distribution_material_catalog
      WHERE name = 'Fleje' AND unit = 'm'
    `).get().total;

    if (acero !== 1 || fleje !== 1) {
      throw new Error("No se pudieron actualizar las unidades de Acero y Fleje.");
    }
  });

  migrate();
  console.log("Migración 016 completada correctamente.");
  console.log("Acero configurado en piezas; Fleje permanece capturado en metros.");
  console.log("Control de reportes pendientes de actualización agregado.");
} catch (error) {
  console.error("Error en migración 016:", error);
  process.exitCode = 1;
} finally {
  db.close();
}
