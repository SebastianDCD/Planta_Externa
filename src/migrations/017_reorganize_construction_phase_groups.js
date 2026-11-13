const db = require("../database");

/**
 * Reorganiza los nueve grupos UACH sin recrear NAP ni tocar materiales/reportes.
 * Orden visual solicitado:
 * Fase 4: 1N01, 1N02, 1N03
 * Fase 5: 1N04, 1N07, 1N08
 * Fase 6: 1N06, 1N05, 1N09
 */

try {
  const migrate = db.transaction(() => {
    const projects = db.prepare(`
      SELECT DISTINCT project_id
      FROM construction_phases
    `).all();

    if (projects.length !== 1) {
      throw new Error(`Se esperaba un proyecto; encontrados: ${projects.length}.`);
    }

    const projectId = projects[0].project_id;
    const desired = [
      { phaseNumber: 4, groups: ["1N01", "1N02", "1N03"] },
      { phaseNumber: 5, groups: ["1N04", "1N07", "1N08"] },
      { phaseNumber: 6, groups: ["1N06", "1N05", "1N09"] }
    ];

    const phaseColumns = db.prepare(`PRAGMA table_info(construction_phase_groups)`).all();
    if (!phaseColumns.some(column => column.name === "sort_order")) {
      db.exec(`ALTER TABLE construction_phase_groups ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`);
    }

    const getConstructionPhase = db.prepare(`
      SELECT id FROM construction_phases
      WHERE project_id = ? AND number = ?
    `);
    const groups = db.prepare(`
      SELECT id, display_code FROM phases
      WHERE project_id = ?
    `).all(projectId);
    const groupsByCode = new Map(groups.map(group => [group.display_code, group.id]));

    for (const phase of desired) {
      if (!getConstructionPhase.get(projectId, phase.phaseNumber)) {
        throw new Error(`No existe la Fase ${phase.phaseNumber}.`);
      }
      for (const code of phase.groups) {
        if (!groupsByCode.has(code)) throw new Error(`No existe el grupo ${code}.`);
      }
    }

    const constructionPhaseIds = desired.map(item =>
      getConstructionPhase.get(projectId, item.phaseNumber).id
    );
    const groupIds = desired.flatMap(item => item.groups.map(code => groupsByCode.get(code)));

    const deleteRelations = db.prepare(`
      DELETE FROM construction_phase_groups
      WHERE construction_phase_id IN (${constructionPhaseIds.map(() => "?").join(",")})
         OR phase_id IN (${groupIds.map(() => "?").join(",")})
    `);
    deleteRelations.run(...constructionPhaseIds, ...groupIds);

    const insertRelation = db.prepare(`
      INSERT INTO construction_phase_groups
        (construction_phase_id, phase_id, sort_order)
      VALUES (?, ?, ?)
    `);

    for (const item of desired) {
      const constructionPhaseId = getConstructionPhase.get(projectId, item.phaseNumber).id;
      item.groups.forEach((code, index) => {
        insertRelation.run(constructionPhaseId, groupsByCode.get(code), index + 1);
      });
    }

    const verify = db.prepare(`
      SELECT cp.number AS phase_number, p.display_code, cpg.sort_order
      FROM construction_phase_groups cpg
      JOIN construction_phases cp ON cp.id = cpg.construction_phase_id
      JOIN phases p ON p.id = cpg.phase_id
      WHERE cp.project_id = ? AND cp.number IN (4, 5, 6)
      ORDER BY cp.number, cpg.sort_order
    `).all(projectId);

    const expected = desired.flatMap(item => item.groups.map(code => `${item.phaseNumber}:${code}`));
    const actual = verify.map(row => `${row.phase_number}:${row.display_code}`);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`La verificación de relaciones falló: ${JSON.stringify(actual)}`);
    }

    return verify;
  });

  const result = migrate();
  console.log("Migración 017 completada. NAP, materiales y reportes conservados.");
  console.table(result);
} catch (error) {
  console.error("Error en migración 017:", error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
