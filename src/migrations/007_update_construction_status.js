const db = require("../database");

try {
  db.pragma("foreign_keys = OFF");

  db.exec(`
    BEGIN TRANSACTION;

    CREATE TABLE naps_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phase_id INTEGER NOT NULL,
      number INTEGER NOT NULL,
      meters INTEGER,
      status TEXT NOT NULL DEFAULT 'PENDING',
      total_poles INTEGER,
      strapped_poles INTEGER,
      construction_status TEXT NOT NULL DEFAULT 'EN_PROCESO'
        CHECK (
          construction_status IN ('EN_PROCESO', 'TERMINADA')
        ),
      FOREIGN KEY (phase_id) REFERENCES phases(id),
      UNIQUE (phase_id, number)
    );

    INSERT INTO naps_new (
      id,
      phase_id,
      number,
      meters,
      status,
      total_poles,
      strapped_poles,
      construction_status
    )
    SELECT
      id,
      phase_id,
      number,
      meters,
      status,
      total_poles,
      strapped_poles,
      'EN_PROCESO'
    FROM naps;

    DROP TABLE naps;
    ALTER TABLE naps_new RENAME TO naps;

    COMMIT;
  `);

  console.log("Migración 007 completada correctamente.");

} catch (error) {
  console.error("Error durante la migración:", error);
  process.exitCode = 1;

} finally {
  db.pragma("foreign_keys = ON");
  db.close();
}