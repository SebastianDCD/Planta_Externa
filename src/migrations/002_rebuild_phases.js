
const db = require("../database");

// Desactivar temporalmente las llaves foráneas.
// Esto debe hacerse fuera de la transacción.
db.pragma("foreign_keys = OFF");

try {
  const migrate = db.transaction(() => {
    // 1. Crear la nueva estructura
    db.exec(`
      CREATE TABLE phases_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'En desarrollo',

        FOREIGN KEY (project_id) REFERENCES projects(id),
        UNIQUE (project_id, name)
      );
    `);

    // 2. Copiar todos los registros existentes
    db.exec(`
      INSERT INTO phases_new (id, project_id, name, status)
      SELECT id, project_id, name, status
      FROM phases;
    `);

    // 3. Sustituir la tabla anterior
    db.exec(`
      DROP TABLE phases;
      ALTER TABLE phases_new RENAME TO phases;
    `);
  });

  migrate();

  // Reactivar las llaves foráneas
  db.pragma("foreign_keys = ON");

  // Comprobar integridad
  const errors = db.pragma("foreign_key_check");

  if (errors.length > 0) {
    throw new Error("Se encontraron errores de llaves foráneas");
  }

  console.log("Migración completada correctamente.");
  console.log("Integridad de llaves foráneas: correcta.");

} catch (error) {
  db.pragma("foreign_keys = ON");
  console.error("Error durante la migración:", error);
  process.exitCode = 1;

} finally {
  db.close();
}
