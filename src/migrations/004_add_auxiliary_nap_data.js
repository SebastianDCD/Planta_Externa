
const db = require("../database");

try {
  const columns = db.prepare("PRAGMA table_info(naps)").all();

  const hasTotalPoles = columns.some(
    column => column.name === "total_poles"
  );

  const hasStrappedPoles = columns.some(
    column => column.name === "strapped_poles"
  );

  if (!hasTotalPoles) {
    db.exec(`
      ALTER TABLE naps
      ADD COLUMN total_poles INTEGER;
    `);
  }

  if (!hasStrappedPoles) {
    db.exec(`
      ALTER TABLE naps
      ADD COLUMN strapped_poles INTEGER;
    `);
  }

  console.log("Migración completada correctamente.");
  console.log("Datos auxiliares agregados a NAP.");

} catch (error) {
  console.error("Error durante la migración:", error);
  process.exitCode = 1;

} finally {
  db.close();
}
