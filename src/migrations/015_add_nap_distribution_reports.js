const db = require("../database");

try {
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS nap_distribution_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nap_id INTEGER NOT NULL UNIQUE,
        report_id TEXT,
        n8n_status TEXT NOT NULL DEFAULT 'PENDING'
          CHECK (n8n_status IN ('PENDING', 'SENT', 'ERROR')),
        n8n_sending INTEGER NOT NULL DEFAULT 0
          CHECK (n8n_sending IN (0, 1)),
        n8n_sent_at TEXT,
        n8n_last_error TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (nap_id) REFERENCES naps(id)
      );

      INSERT OR IGNORE INTO nap_distribution_reports (nap_id)
      SELECT n.id
      FROM naps n
      JOIN phases p ON p.id = n.phase_id
      WHERE p.display_code IS NOT NULL;
    `);

    const count = db.prepare(`
      SELECT COUNT(*) AS total
      FROM nap_distribution_reports
    `).get().total;

    if (count !== 72) {
      throw new Error(`Se esperaban 72 reportes; encontrados: ${count}`);
    }
  });

  migrate();

  console.log("Migración 015 completada correctamente.");
  console.log("72 controles individuales de reporte preparados.");
} catch (error) {
  console.error("Error en migración 015:", error);
  process.exitCode = 1;
} finally {
  db.close();
}
