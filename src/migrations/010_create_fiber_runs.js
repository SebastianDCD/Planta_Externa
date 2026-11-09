const db = require("../database");
const fs = require("fs");
const path = require("path");

const jsonPath = path.join(
  __dirname,
  "../../importacion_tendidos_uach.json"
);

function validateImport(data) {
  if (data.system !== "Planta Externa" || data.project !== "UACH") {
    throw new Error("El archivo no corresponde al proyecto UACH.");
  }

  if (!Array.isArray(data.construction_phases) ||
      data.construction_phases.length !== 3) {
    throw new Error("Se esperaban exactamente 3 fases de construcción.");
  }

  let totalRuns = 0;
  let totalMaterials = 0;
  const expectedRuns = {
    1: ["Troncal 24 hilos"],
    2: ["Brazo 1", "Brazo 2", "Brazo 3", "Brazo 4"],
    3: ["Brazo 1", "Brazo 2"]
  };

  for (const phase of data.construction_phases) {
    if (!expectedRuns[phase.number]) {
      throw new Error(`Fase de construcción no reconocida: ${phase.number}`);
    }

    const expectedNames = expectedRuns[phase.number];
    const actualNames = phase.runs.map(run => run.name);

    if (
      actualNames.length !== expectedNames.length ||
      [...actualNames].sort().join("|") !== [...expectedNames].sort().join("|")
    ) {
      throw new Error(`Los tendidos de la fase ${phase.number} no coinciden.`);
    }

    totalRuns += phase.runs.length;

    for (const run of phase.runs) {
      if (!Array.isArray(run.materials) || run.materials.length === 0) {
        throw new Error(`No hay materiales para ${run.name}.`);
      }

      totalMaterials += run.materials.length;

      for (const material of run.materials) {
        if (
          typeof material.name !== "string" ||
          !material.name.trim() ||
          typeof material.unit !== "string" ||
          !material.unit.trim() ||
          typeof material.initial_quantity !== "number" ||
          !Number.isFinite(material.initial_quantity) ||
          material.initial_quantity < 0
        ) {
          throw new Error(`Material inválido en ${run.name}.`);
        }
      }
    }
  }

  if (totalRuns !== 7 || totalMaterials !== 79) {
    throw new Error(
      `Importación incorrecta: ${totalRuns} tendidos y ${totalMaterials} materiales.`
    );
  }
}

try {
  if (!fs.existsSync(jsonPath)) {
    throw new Error("No se encontró importacion_tendidos_uach.json.");
  }

  const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  validateImport(data);

  const migrate = db.transaction(() => {
    const project = db.prepare(`
      SELECT id FROM projects WHERE name = 'UACH'
    `).get();

    if (!project) {
      throw new Error("No se encontró el proyecto UACH.");
    }

    const existingPhases = db.prepare(`
      SELECT id, name FROM phases
      WHERE project_id = ?
      ORDER BY id
    `).all(project.id);

    if (existingPhases.length !== 9) {
      throw new Error("Se esperaban los 9 primeros niveles actuales.");
    }

    // Añadir identificador visible sin cambiar el nombre interno.
    const phaseColumns = db.prepare("PRAGMA table_info(phases)").all();
    const hasDisplayCode = phaseColumns.some(
      column => column.name === "display_code"
    );

    if (!hasDisplayCode) {
      db.exec("ALTER TABLE phases ADD COLUMN display_code TEXT");
    }

    const updateDisplayCode = db.prepare(`
      UPDATE phases
      SET display_code = ?
      WHERE id = ? AND project_id = ?
    `);

    for (let i = 0; i < 9; i++) {
      const expectedName = `Fase ${String(i + 1).padStart(2, "0")}`;

      if (existingPhases[i].name !== expectedName) {
        throw new Error(`Se esperaba ${expectedName} en la posición ${i + 1}.`);
      }

      updateDisplayCode.run(
        `1N${String(i + 1).padStart(2, "0")}`,
        existingPhases[i].id,
        project.id
      );
    }

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_phases_display_code
      ON phases(project_id, display_code)
      WHERE display_code IS NOT NULL;

      CREATE TABLE construction_phases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        number INTEGER NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'EN_PROCESO'
          CHECK (status IN ('EN_PROCESO', 'COMPLETADA')),
        n8n_status TEXT NOT NULL DEFAULT 'PENDING'
          CHECK (n8n_status IN ('PENDING', 'SENT', 'ERROR')),
        n8n_sent_at TEXT,
        n8n_last_error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        UNIQUE (project_id, number),
        UNIQUE (project_id, name)
      );

      CREATE TABLE fiber_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        construction_phase_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        strand_count INTEGER NOT NULL CHECK (strand_count > 0),
        status TEXT NOT NULL DEFAULT 'EN_PROCESO'
          CHECK (status IN ('EN_PROCESO', 'COMPLETADO')),
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (construction_phase_id)
          REFERENCES construction_phases(id),
        UNIQUE (construction_phase_id, name)
      );

      CREATE TABLE fiber_run_materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fiber_run_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        initial_quantity REAL NOT NULL CHECK (initial_quantity >= 0),
        actual_quantity REAL NOT NULL CHECK (actual_quantity >= 0),
        unit TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (fiber_run_id) REFERENCES fiber_runs(id),
        UNIQUE (fiber_run_id, name)
      );

      CREATE TABLE fiber_run_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fiber_run_id INTEGER NOT NULL,
        action TEXT NOT NULL
          CHECK (action IN ('COMPLETADO', 'REABIERTO')),
        details TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (fiber_run_id) REFERENCES fiber_runs(id)
      );

      CREATE INDEX idx_fiber_runs_phase
      ON fiber_runs(construction_phase_id);

      CREATE INDEX idx_fiber_materials_run
      ON fiber_run_materials(fiber_run_id);

      CREATE INDEX idx_fiber_history_run
      ON fiber_run_history(fiber_run_id);
    `);

    const existingConstructionPhases = db.prepare(`
      SELECT COUNT(*) AS total FROM construction_phases
    `).get().total;

    if (existingConstructionPhases !== 0) {
      throw new Error("Ya existen fases de construcción. Se cancela la importación.");
    }

    const insertPhase = db.prepare(`
      INSERT INTO construction_phases (project_id, number, name)
      VALUES (?, ?, ?)
    `);

    const insertRun = db.prepare(`
      INSERT INTO fiber_runs (
        construction_phase_id, name, strand_count
      ) VALUES (?, ?, ?)
    `);

    const insertMaterial = db.prepare(`
      INSERT INTO fiber_run_materials (
        fiber_run_id, name, initial_quantity, actual_quantity, unit
      ) VALUES (?, ?, ?, ?, ?)
    `);

    for (const phase of data.construction_phases) {
      const phaseResult = insertPhase.run(
        project.id,
        phase.number,
        phase.name
      );

      for (const run of phase.runs) {
        const runResult = insertRun.run(
          phaseResult.lastInsertRowid,
          run.name,
          run.strand_count
        );

        for (const material of run.materials) {
          insertMaterial.run(
            runResult.lastInsertRowid,
            material.name,
            material.initial_quantity,
            material.initial_quantity,
            material.unit
          );
        }
      }
    }

    const importedRuns = db.prepare(`
      SELECT COUNT(*) AS total FROM fiber_runs
    `).get().total;

    const importedMaterials = db.prepare(`
      SELECT COUNT(*) AS total FROM fiber_run_materials
    `).get().total;

    if (importedRuns !== 7 || importedMaterials !== 79) {
      throw new Error("La verificación final de la importación falló.");
    }
  });

  migrate();

  console.log("Migración 010 completada correctamente.");
  console.log("Primeros niveles identificados: 1N01 a 1N09.");
  console.log("Fases de construcción: 3.");
  console.log("Tendidos importados: 7.");
  console.log("Materiales importados: 79.");

} catch (error) {
  console.error("Error en la migración 010:", error.message);
  process.exitCode = 1;

} finally {
  db.close();
}
