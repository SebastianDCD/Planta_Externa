
const db = require("../database");

try {
  const migrate = db.transaction(() => {
    db.exec(`
      ALTER TABLE fiber_run_history
      RENAME TO fiber_run_history_old;

      CREATE TABLE fiber_run_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fiber_run_id INTEGER NOT NULL,
        action TEXT NOT NULL CHECK (
          action IN (
            'COMPLETADO',
            'REABIERTO',
            'MATERIAL_ACTUALIZADO'
          )
        ),
        details TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (fiber_run_id) REFERENCES fiber_runs(id)
      );

      INSERT INTO fiber_run_history (
        id,
        fiber_run_id,
        action,
        details,
        created_at
      )
      SELECT
        id,
        fiber_run_id,
        action,
        details,
        created_at
      FROM fiber_run_history_old;

      DROP TABLE fiber_run_history_old;

      CREATE INDEX idx_fiber_history_run
      ON fiber_run_history(fiber_run_id);
    `);
  });

  migrate();

  console.log("Migración 011 completada correctamente.");
} catch (error) {
  console.error("Error en migración 011:", error);
  process.exitCode = 1;
} finally {
  db.close();
}
