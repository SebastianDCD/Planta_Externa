
const db = require("../database");

try {
  const migrate = db.transaction(() => {
    const columns = db.prepare(`
      PRAGMA table_info(fiber_runs)
    `).all();

    const existingColumns = columns.map(column => column.name);

    const newColumns = [
      {
        name: "n8n_report_id",
        sql: "ALTER TABLE fiber_runs ADD COLUMN n8n_report_id TEXT"
      },
      {
        name: "n8n_status",
        sql: "ALTER TABLE fiber_runs ADD COLUMN n8n_status TEXT NOT NULL DEFAULT 'PENDING'"
      },
      {
        name: "n8n_sending",
        sql: `ALTER TABLE fiber_runs ADD COLUMN n8n_sending INTEGER NOT NULL DEFAULT 0 CHECK (n8n_sending IN (0, 1))`
      },
      {
        name: "n8n_sent_at",
        sql: "ALTER TABLE fiber_runs ADD COLUMN n8n_sent_at TEXT"
      },
      {
        name: "n8n_last_error",
        sql: "ALTER TABLE fiber_runs ADD COLUMN n8n_last_error TEXT"
      }
    ];

    for (const column of newColumns) {
      if (!existingColumns.includes(column.name)) {
        db.exec(column.sql);
      }
    }
  });

  migrate();

  console.log("Migración 013 completada correctamente.");
} catch (error) {
  console.error("Error en migración 013:", error);
  process.exitCode = 1;
} finally {
  db.close();
}
