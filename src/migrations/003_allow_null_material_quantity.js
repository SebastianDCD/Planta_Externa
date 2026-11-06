
const db = require("../database");

db.pragma("foreign_keys = OFF");

try {
  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE nap_materials_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nap_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        quantity REAL,
        unit TEXT NOT NULL,

        FOREIGN KEY (nap_id) REFERENCES naps(id),
        UNIQUE (nap_id, name)
      );
    `);

    db.exec(`
      INSERT INTO nap_materials_new (id, nap_id, name, quantity, unit)
      SELECT id, nap_id, name, quantity, unit
      FROM nap_materials;
    `);

    db.exec(`
      DROP TABLE nap_materials;
      ALTER TABLE nap_materials_new RENAME TO nap_materials;
    `);
  });

  migrate();

  db.pragma("foreign_keys = ON");

  const errors = db.pragma("foreign_key_check");

  if (errors.length > 0) {
    throw new Error("Se encontraron errores de llaves foráneas");
  }

  console.log("Migración completada correctamente.");
  console.log("Cantidad NULL permitida.");
  console.log("Integridad de llaves foráneas: correcta.");

} catch (error) {
  db.pragma("foreign_keys = ON");
  console.error("Error durante la migración:", error);
  process.exitCode = 1;

} finally {
  db.close();
}
