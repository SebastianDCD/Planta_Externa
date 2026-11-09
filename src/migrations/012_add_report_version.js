
const db = require("../database");

try {
  const migrate = db.transaction(() => {
    const columns = db.prepare(`
      PRAGMA table_info(construction_phases)
    `).all();

    const existingColumns = columns.map(column => column.name);

    if (!existingColumns.includes("report_version")) {
      db.exec(`
        ALTER TABLE construction_phases
        ADD COLUMN report_version INTEGER NOT NULL DEFAULT 0
      `);
    }

    if (!existingColumns.includes("n8n_report_id")) {
      db.exec(`
        ALTER TABLE construction_phases
        ADD COLUMN n8n_report_id TEXT
      `);
    }

    if (!existingColumns.includes("n8n_sending")) {
      db.exec(`
        ALTER TABLE construction_phases
        ADD COLUMN n8n_sending INTEGER NOT NULL DEFAULT 0
        CHECK (n8n_sending IN (0, 1))
      `);
    }
  });

  migrate();

  console.log("Migración 012 completada correctamente.");
} catch (error) {
  console.error("Error en migración 012:", error);
  process.exitCode = 1;
} finally {
  db.close();
}
