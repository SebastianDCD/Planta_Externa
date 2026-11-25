const db = require("../database");

try {
  const migrate = db.transaction(() => {
    // El Splitter 1x8 conserva el registro histórico "Splitter".
    // El 1x2 se agrega como material separado y opcional.
    db.prepare(`
      INSERT OR IGNORE INTO nap_distribution_material_catalog (name, unit)
      VALUES ('Splitter 1x2', 'pza')
    `).run();

    const splitter1x2 = db.prepare(`
      SELECT id
      FROM nap_distribution_material_catalog
      WHERE name = 'Splitter 1x2'
    `).get();

    if (!splitter1x2) {
      throw new Error("No fue posible crear el material Splitter 1x2.");
    }

    // Crear el espacio de captura para todas las NAP existentes del proyecto.
    const result = db.prepare(`
      INSERT OR IGNORE INTO nap_distribution_materials (nap_id, catalog_id)
      SELECT n.id, ?
      FROM naps n
      JOIN phases p ON p.id = n.phase_id
    `).run(splitter1x2.id);

    const missing = db.prepare(`
      SELECT COUNT(*) AS total
      FROM naps n
      LEFT JOIN nap_distribution_materials dm
        ON dm.nap_id = n.id AND dm.catalog_id = ?
      WHERE dm.id IS NULL
    `).get(splitter1x2.id).total;

    if (missing !== 0) {
      throw new Error(
        `Quedaron ${missing} NAP sin espacio para capturar Splitter 1x2.`
      );
    }

    return result.changes;
  });

  const inserted = migrate();

  console.log("Migración 018 completada correctamente.");
  console.log(`Espacios de Splitter 1x2 creados: ${inserted}.`);
  console.log("El Splitter 1x2 queda opcional y no altera los reportes existentes.");
} catch (error) {
  console.error("Error en migración 018:", error);
  process.exitCode = 1;
} finally {
  db.close();
}
