
const db = require("../database");

try {
  const columns = db.prepare("PRAGMA table_info(naps)").all();

  const hasConstructionStatus = columns.some(
    column => column.name === "construction_status"
  );

  if (!hasConstructionStatus) {
    db.exec(`
      ALTER TABLE naps
      ADD COLUMN construction_status TEXT NOT NULL
      DEFAULT 'PLANIFICADO'
      CHECK (
        construction_status IN (
          'PLANIFICADO',
          'EN_CONSTRUCCION',
          'EXISTENTE'
        )
      );
    `);
  }

  console.log("Migración completada correctamente.");
  console.log("Estado de construcción agregado a los NAP.");

} catch (error) {
  console.error("Error durante la migración:", error);
  process.exitCode = 1;

} finally {
  db.close();
}
