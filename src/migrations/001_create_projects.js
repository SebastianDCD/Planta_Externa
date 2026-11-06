
const db = require("../database");

const migrate = db.transaction(() => {
  // 1. Crear tabla de proyectos
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Registrar UACH
  db.prepare(`
    INSERT OR IGNORE INTO projects (name)
    VALUES (?)
  `).run("UACH");

  // 3. Agregar project_id a phases si todavía no existe
  const columns = db.prepare("PRAGMA table_info(phases)").all();
  const hasProjectId = columns.some(
    column => column.name === "project_id"
  );

  if (!hasProjectId) {
    db.exec(`
      ALTER TABLE phases
      ADD COLUMN project_id INTEGER
      REFERENCES projects(id);
    `);
  }

  // 4. Relacionar las fases existentes con UACH
  const project = db.prepare(`
    SELECT id FROM projects WHERE name = ?
  `).get("UACH");

  db.prepare(`
    UPDATE phases
    SET project_id = ?
    WHERE project_id IS NULL
  `).run(project.id);
});

try {
  migrate();
  console.log("Migración completada correctamente.");
} catch (error) {
  console.error("Error durante la migración:", error);
  process.exitCode = 1;
} finally {
  db.close();
}
