const db = require("../database");

try {
  const migrate = db.transaction(() => {
    // Identificar el proyecto existente.
    const projects = db.prepare(`
      SELECT DISTINCT project_id
      FROM construction_phases
    `).all();

    if (projects.length !== 1) {
      throw new Error(
        `Se esperaba un solo proyecto en construction_phases; encontrados: ${projects.length}`
      );
    }

    const projectId = projects[0].project_id;

    // Primeros niveles que corresponden a cada nueva fase constructiva.
    const phaseGroups = [
      { constructionPhase: 4, groups: ["1N01", "1N02", "1N03"] },
      { constructionPhase: 5, groups: ["1N09", "1N04", "1N08"] },
      { constructionPhase: 6, groups: ["1N05", "1N06", "1N07"] }
    ];

    // Verificar que existan los nueve primeros niveles.
    const existingGroups = db.prepare(`
      SELECT id, display_code
      FROM phases
      WHERE project_id = ?
    `).all(projectId);

    const groupsByCode = new Map(
      existingGroups.map(group => [group.display_code, group.id])
    );

    for (const phase of phaseGroups) {
      for (const code of phase.groups) {
        if (!groupsByCode.has(code)) {
          throw new Error(`No se encontró el primer nivel ${code}`);
        }
      }
    }

    // Crear las fases constructivas 4, 5 y 6.
    const insertConstructionPhase = db.prepare(`
      INSERT OR IGNORE INTO construction_phases
        (project_id, number, name, status)
      VALUES (?, ?, ?, 'EN_PROCESO')
    `);

    for (const phase of phaseGroups) {
      insertConstructionPhase.run(
        projectId,
        phase.constructionPhase,
        `Fase ${phase.constructionPhase}`
      );
    }

    // Relacionar cada fase constructiva con sus primeros niveles.
    db.exec(`
      CREATE TABLE IF NOT EXISTS construction_phase_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        construction_phase_id INTEGER NOT NULL,
        phase_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (construction_phase_id)
          REFERENCES construction_phases(id),

        FOREIGN KEY (phase_id)
          REFERENCES phases(id),

        UNIQUE (construction_phase_id, phase_id),
        UNIQUE (phase_id)
      );
    `);

    const getConstructionPhase = db.prepare(`
      SELECT id
      FROM construction_phases
      WHERE project_id = ? AND number = ?
    `);

    const insertGroupRelation = db.prepare(`
      INSERT OR IGNORE INTO construction_phase_groups
        (construction_phase_id, phase_id)
      VALUES (?, ?)
    `);

    for (const phase of phaseGroups) {
      const constructionPhase = getConstructionPhase.get(
        projectId,
        phase.constructionPhase
      );

      for (const code of phase.groups) {
        insertGroupRelation.run(
          constructionPhase.id,
          groupsByCode.get(code)
        );
      }
    }

    // Catálogo independiente de materiales para distribución NAP.
    db.exec(`
      CREATE TABLE IF NOT EXISTS nap_distribution_material_catalog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        unit TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const materials = [
      ["Drop", "m"],
      ["Splitter", "pza"],
      ["Postería total", "pza"],
      ["Postes que se flejó", "pza"],
      ["Fleje", "m"],
      ["Herrajes tipo D", "pza"],
      ["Tensores", "pza"],
      ["Acero", "m"],
      ["NAP", "pza"],
      ["Remates para acero", "pza"]
    ];

    const insertMaterial = db.prepare(`
      INSERT OR IGNORE INTO nap_distribution_material_catalog
        (name, unit)
      VALUES (?, ?)
    `);

    for (const material of materials) {
      insertMaterial.run(material[0], material[1]);
    }

    // Diez espacios de captura independientes por cada NAP.
    db.exec(`
      CREATE TABLE IF NOT EXISTS nap_distribution_materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nap_id INTEGER NOT NULL,
        catalog_id INTEGER NOT NULL,
        initial_quantity REAL,
        actual_quantity REAL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (nap_id) REFERENCES naps(id),
        FOREIGN KEY (catalog_id)
          REFERENCES nap_distribution_material_catalog(id),

        UNIQUE (nap_id, catalog_id)
      );
    `);

    db.prepare(`
      INSERT OR IGNORE INTO nap_distribution_materials
        (nap_id, catalog_id)
      SELECT
        n.id,
        c.id
      FROM naps n
      CROSS JOIN nap_distribution_material_catalog c
      JOIN phases p ON p.id = n.phase_id
      WHERE p.project_id = ?
    `).run(projectId);

    // Verificaciones dentro de la transacción.
    const napCount = db.prepare(`
      SELECT COUNT(*) AS total
      FROM naps n
      JOIN phases p ON p.id = n.phase_id
      WHERE p.project_id = ?
    `).get(projectId).total;

    const materialCount = db.prepare(`
      SELECT COUNT(*) AS total
      FROM nap_distribution_materials dm
      JOIN naps n ON n.id = dm.nap_id
      JOIN phases p ON p.id = n.phase_id
      WHERE p.project_id = ?
    `).get(projectId).total;

    if (napCount !== 72) {
      throw new Error(`Se esperaban 72 NAP; encontradas: ${napCount}`);
    }

    if (materialCount !== 720) {
      throw new Error(
        `Se esperaban 720 espacios de materiales; encontrados: ${materialCount}`
      );
    }
  });

  migrate();

  console.log("Migración 014 completada correctamente.");
  console.log("Fases constructivas 4, 5 y 6 creadas.");
  console.log("72 NAP preparadas con 10 materiales cada una.");
  console.log("720 espacios de captura creados con cantidades vacías.");
} catch (error) {
  console.error("Error en migración 014:", error);
  process.exitCode = 1;
} finally {
  db.close();
}
