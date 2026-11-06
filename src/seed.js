const db = require('./database');

const phases = [
    { name: 'Fase 01', naps: [50, 550, 210, 260, 600, 600, 140, 300] },
    { name: 'Fase 02', naps: [550, 300, 340, 250, 320, 420, 500, 50] },
    { name: 'Fase 03', naps: [240, 20, 200, 300, 400, 700, 700, 600] },
    { name: 'Fase 04', naps: [390, 330, 100, 100, 290, null, null, null] },
    { name: 'Fase 05', naps: [100, 100, 400, 310, 550, 100, 210, 450] },
    { name: 'Fase 06', naps: [300, 15, 170, 330, 500, 500, 300, null] },
    { name: 'Fase 07', naps: [450, 100, 270, 380, 350, 220, 460, 100] },
    { name: 'Fase 08', naps: [430, 500, 100, 400, 260, 340, 270, 360] },
    { name: 'Fase 09', naps: [0, 0, 0, 0, 0, 0, 0, 0] }
];

const insertPhase = db.prepare(`
    INSERT OR IGNORE INTO phases (name)
    VALUES (?)
`);

const insertNap = db.prepare(`
    INSERT OR IGNORE INTO naps (phase_id, number, meters)
    VALUES (?, ?, ?)
`);

const loadData = db.transaction(() => {

    phases.forEach(phase => {

        insertPhase.run(phase.name);

        const savedPhase = db.prepare(
            'SELECT id FROM phases WHERE name = ?'
        ).get(phase.name);

        phase.naps.forEach((meters, index) => {

            insertNap.run(
                savedPhase.id,
                index + 1,
                meters
            );

        });

    });

});

loadData();

console.log('Fases y NAP cargadas correctamente.');