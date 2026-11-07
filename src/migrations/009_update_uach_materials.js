const db = require("../database");
const fs = require("fs");
const path = require("path");

// Archivo con los datos actualizados de Excel
const jsonPath = path.join(
  __dirname,
  "../../importacion_materiales_uach_actualizado.json"
);

// Materiales oficiales y sus unidades
const expectedMaterials = {
  "Cajas NAP": "pza",
  "Unifibra mts": "m",
  "Flejes 5/8": "m",
  "Herrajes Tipo D": "pza",
  "remates de aceros": "pza",
  "Splitter 1x8": "pza",
  "Tensores TotalPlay": "pza",
  "Acero": "m"
};

function validateImportData(data) {
  if (data.system !== "Planta Externa") {
    throw new Error("El archivo no pertenece a Planta Externa.");
  }

  if (data.project !== "UACH") {
    throw new Error("El proyecto debe ser UACH.");
  }

  if (!Array.isArray(data.records) || data.records.length !== 64) {
    throw new Error("Se esperaban exactamente 64 NAP.");
  }

  const seen = new Set();

  for (const record of data.records) {
    const key = `${record.phase}-${record.nap}`;

    if (seen.has(key)) {
      throw new Error(`NAP duplicado: ${key}`);
    }

    seen.add(key);

    if (!Array.isArray(record.materials) || record.materials.length !== 8) {
      throw new Error(`El NAP ${key} no tiene exactamente 8 materiales.`);
    }

    const materialNames = new Set();

    for (const material of record.materials) {
      const expectedUnit = expectedMaterials[material.name];

      if (!expectedUnit) {
        throw new Error(
          `Material no reconocido en ${key}: ${material.name}`
        );
      }

      if (materialNames.has(material.name)) {
        throw new Error(`Material duplicado en ${key}: ${material.name}`);
      }

      materialNames.add(material.name);

      if (material.unit !== expectedUnit) {
        throw new Error(
          `Unidad incorrecta para ${material.name} en ${key}.`
        );
      }

      if (
        typeof material.quantity !== "number" ||
        !Number.isFinite(material.quantity) ||
        material.quantity < 0
      ) {
        throw new Error(
          `Cantidad inválida para ${material.name} en ${key}.`
        );
      }
    }

    if (materialNames.size !== 8) {
      throw new Error(`Faltan materiales en ${key}.`);
    }
  }
}

// Buscar el proyecto UACH
const findProject = db.prepare(`
  SELECT id
  FROM projects
  WHERE name = ?
`);

// Buscar cada NAP dentro de su fase
const findNap = db.prepare(`
  SELECT naps.id, naps.total_poles, naps.strapped_poles
  FROM naps
  JOIN phases ON phases.id = naps.phase_id
  WHERE phases.project_id = ?
    AND phases.name = ?
    AND naps.number = ?
`);

// Consultar los materiales actuales de un NAP
const findCurrentMaterials = db.prepare(`
  SELECT id, name, quantity, unit
  FROM nap_materials
  WHERE nap_id = ?
  ORDER BY name
`);

// Actualizar un material existente conservando su ID
const updateMaterial = db.prepare(`
  UPDATE nap_materials
  SET name = ?, quantity = ?, unit = ?
  WHERE id = ?
`);

// Insertar un material nuevo
const insertMaterial = db.prepare(`
  INSERT INTO nap_materials (nap_id, name, quantity, unit)
  VALUES (?, ?, ?, ?)
`);

// Actualizar información de postería del NAP
const updateNap = db.prepare(`
  UPDATE naps
  SET total_poles = ?, strapped_poles = ?
  WHERE id = ?
`);

const migrate = db.transaction(() => {
  // 1. Validar los datos importados
  const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  validateImportData(data);

  // 2. Localizar el proyecto
  const project = findProject.get("UACH");

  if (!project) {
    throw new Error("No se encontró el proyecto UACH.");
  }

  // 3. Validar los 64 NAP antes de modificar cualquiera
  const napRecords = [];

  for (const record of data.records) {
    const phaseName = `Fase ${String(record.phase).padStart(2, "0")}`;
    const nap = findNap.get(project.id, phaseName, record.nap);

    if (!nap) {
      throw new Error(
        `No se encontró el NAP ${record.nap} en ${phaseName}.`
      );
    }

    const currentMaterials = findCurrentMaterials.all(nap.id);

    if (currentMaterials.length !== 6) {
      throw new Error(
        `El NAP ${record.nap} de ${phaseName} no tiene los 6 materiales originales.`
      );
    }

    napRecords.push({
      record,
      nap,
      currentMaterials
    });
  }

  // 4. Comprobar que los materiales actuales sean los esperados
  const originalMaterials = [
    "Acero",
    "Drop",
    "Fleje",
    "Herrajes tipo D",
    "Splitter",
    "Tensores"
  ];

  for (const item of napRecords) {
    const currentNames = item.currentMaterials
      .map(material => material.name)
      .sort();

    const expectedNames = [...originalMaterials].sort();

    if (JSON.stringify(currentNames) !== JSON.stringify(expectedNames)) {
      throw new Error(
        `Los materiales originales del NAP ${item.record.nap} no coinciden.`
      );
    }
  }

    // 5. Relacionar los nombres anteriores con los nuevos
  const materialMapping = {
    "Acero": "Acero",
    "Drop": "Unifibra mts",
    "Fleje": "Fleje 5/8",
    "Herrajes tipo D": "Herrajes Tipo D",
    "Splitter": "Splitter 1x8",
    "Tensores": "Tensores TotalPlay"
  };

  // 6. Actualizar los seis materiales existentes
  for (const item of napRecords) {
    for (const [oldName, newName] of Object.entries(materialMapping)) {
      const currentMaterial = item.currentMaterials.find(
        material => material.name === oldName
      );

      const newMaterial = item.record.materials.find(
        material => material.name === newName
      );

      updateMaterial.run(
        newName,
        newMaterial.quantity,
        newMaterial.unit,
        currentMaterial.id
      );
    }

    // 7. Insertar los dos materiales nuevos
    const newMaterials = ["Cajas NAP", "remates de aceros"];

    for (const name of newMaterials) {
      const material = item.record.materials.find(
        entry => entry.name === name
      );

      insertMaterial.run(
        item.nap.id,
        material.name,
        material.quantity,
        material.unit
      );
    }

    // 8. Actualizar información de postería
    updateNap.run(
      item.record.total_poles,
      item.record.strapped_poles,
      item.nap.id
    );
  }


});

// Ejecutar la migración
try {
  migrate();

  console.log("Migración completada correctamente.");
  console.log("Proyecto: UACH");
  console.log("NAP actualizados: 64");
  console.log("Materiales por NAP: 8");
  console.log("Total de registros esperados: 512");

} catch (error) {
  console.error("Error durante la migración:", error);
  process.exitCode = 1;

} finally {
  db.close();
}

