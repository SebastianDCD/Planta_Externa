
const db = require("../database");
const fs = require("fs");
const path = require("path");

const jsonPath = path.join(
  __dirname,
  "../../importacion_materiales_uach.json"
);

try {
  // 1. Leer el archivo JSON
  const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

  if (data.system !== "Planta Externa" || data.project !== "UACH") {
    throw new Error("El archivo no corresponde al proyecto UACH.");
  }

  if (data.records.length !== 64) {
    throw new Error(`Se esperaban 64 registros y llegaron ${data.records.length}.`);
  }

  const project = db.prepare(`
    SELECT id FROM projects WHERE name = ?
  `).get("UACH");

  if (!project) {
    throw new Error("No se encontró el proyecto UACH.");
  }

  // 2. Preparar consultas
  const findNap = db.prepare(`
    SELECT naps.id
    FROM naps
    JOIN phases ON phases.id = naps.phase_id
    WHERE phases.project_id = ?
      AND phases.name = ?
      AND naps.number = ?
  `);

  const checkMaterials = db.prepare(`
    SELECT COUNT(*) AS total
    FROM nap_materials
    WHERE nap_id = ?
  `);

  const updateNap = db.prepare(`
    UPDATE naps
    SET total_poles = ?, strapped_poles = ?
    WHERE id = ?
  `);

  const insertMaterial = db.prepare(`
    INSERT INTO nap_materials (nap_id, name, quantity, unit)
    VALUES (?, ?, ?, ?)
  `);

  // 3. Validar e importar dentro de una transacción
  const importData = db.transaction(() => {
    const seen = new Set();

    for (const record of data.records) {
      const key = `${record.phase}-${record.nap}`;

      if (seen.has(key)) {
        throw new Error(`NAP duplicado en el JSON: ${key}`);
      }

      seen.add(key);

      const phaseName = `Fase ${String(record.phase).padStart(2, "0")}`;

      const nap = findNap.get(
        project.id,
        phaseName,
        record.nap
      );

      if (!nap) {
        throw new Error(`No se encontró ${phaseName}, NAP ${record.nap}.`);
      }

      if (checkMaterials.get(nap.id).total > 0) {
        throw new Error(`El NAP ${phaseName}, número ${record.nap}, ya tiene materiales.`);
      }

      if (!Array.isArray(record.materials) || record.materials.length !== 6) {
        throw new Error(`Materiales incompletos en ${phaseName}, NAP ${record.nap}.`);
      }
    }

    // Comprobar que estén los 64 NAP distintos
    if (seen.size !== 64) {
      throw new Error(`Se esperaban 64 NAP distintos y se encontraron ${seen.size}.`);
    }

    // Guardar los datos
    for (const record of data.records) {
      const phaseName = `Fase ${String(record.phase).padStart(2, "0")}`;

      const nap = findNap.get(
        project.id,
        phaseName,
        record.nap
      );

      updateNap.run(
        record.total_poles,
        record.strapped_poles,
        nap.id
      );

      for (const material of record.materials) {
        insertMaterial.run(
          nap.id,
          material.name,
          material.quantity,
          material.unit
        );
      }
    }
  });

  importData();

  console.log("Importación completada correctamente.");
  console.log("NAP importados:", data.records.length);
  console.log("Materiales registrados:", data.records.length * 6);

} catch (error) {
  console.error("Error durante la importación:", error.message);
  process.exitCode = 1;

} finally {
  db.close();
}
