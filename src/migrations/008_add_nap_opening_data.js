const db = require("../database");

try {
  db.exec(`
    BEGIN TRANSACTION;

    ALTER TABLE naps
    ADD COLUMN opening_date TEXT;

    ALTER TABLE naps
    ADD COLUMN opening_power REAL;

    COMMIT;
  `);

  console.log("Migración 008 completada correctamente.");

} catch (error) {
  console.error("Error durante la migración:", error);
  process.exitCode = 1;

} finally {
  db.close();
}
