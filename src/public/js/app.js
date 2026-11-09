const phasesContainer = document.getElementById("phases-container");
const phaseDetail = document.getElementById("phase-detail");
const napsContainer = document.getElementById("naps-container");

const materialsSection = document.getElementById("materials-section");
const materialsContainer = document.getElementById("materials-container");

const phasesSection = document.querySelector(".phases-section");
const dashboardCards = document.querySelector(".dashboard-cards");

const navLinks = document.querySelectorAll(".nav-link");
const pageTitle = document.querySelector(".topbar h1");

const completionModal = document.getElementById("completion-modal");
const completionDetails = document.getElementById("completion-details");
const closeModalButton = document.getElementById("close-modal");

const tendidosSection = document.getElementById("tendidos-section");
const constructionPhaseSelect = document.getElementById("construction-phase-select");

constructionPhaseSelect.addEventListener("change", () => {
  if (constructionPhaseSelect.value) {
    loadFiberRuns(constructionPhaseSelect.value);
  } else {
    fiberRunsContainer.innerHTML = "";
  }
});

const fiberRunsContainer = document.getElementById("fiber-runs-container");

function navigateTo(section) {
  tendidosSection.hidden = section !== "tendidos";
  console.log("Navegando a:", section);
  // Ocultar el detalle de una fase
  phaseDetail.hidden = true;

  // Mostrar u ocultar las secciones principales
  dashboardCards.hidden = section !== "dashboard";
  phasesSection.hidden = section !== "phases";
  materialsSection.hidden = section !== "materials";
  tendidosSection.hidden = section !== "tendidos";
  document.getElementById("progress-section").hidden = true;
  if (section === "progress") {
    document.getElementById("progress-section").hidden = false;
  }

  // Actualizar el título
  const titles = {
    dashboard: "Panel principal",
    phases: "Fases del proyecto",
    progress: "Avance general del proyecto",
    materials: "Inventario de materiales",
    tendidos: "Construcción de tendidos"
  };

  pageTitle.textContent = titles[section];

  // Actualizar el enlace activo
  navLinks.forEach((link) => {
    link.classList.toggle("active", link.dataset.section === section);
  });
}

navLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();

    const section = link.dataset.section;

if (
  section === "dashboard" ||
  section === "phases" ||
  section === "progress" ||
  section === "materials" ||
  section === "tendidos"
) {
  navigateTo(section);

  if (section === "materials") {
    loadMaterials();
  }
  if (section === "tendidos") {
  loadConstructionPhases();
}
}
  });
});

function showCompletionModal(data, reminder) {
  completionDetails.innerHTML = `
        <p><strong>Fase:</strong> ${data.phase}</p>
        <p><strong>NAP:</strong> ${data.nap}</p>
        <p><strong>Metraje:</strong> ${data.meters} m</p>
        <p><strong>Estado:</strong> ${data.status}</p>

        <hr>

        <h3>Materiales consumidos</h3>
        <p>${
          data.materials.length === 0
            ? "Todavía no hay materiales registrados."
            : "Materiales registrados correctamente."
        }</p>

        <p>${reminder}</p>
    `;

  completionModal.hidden = false;
}

async function loadMaterials() {
  try {
    materialsContainer.innerHTML = "<p>Cargando materiales...</p>";

    const response = await fetch("/api/materials?project_id=1");
    const result = await response.json();

    if (!result.success) {
      throw new Error("No se pudieron cargar los materiales.");
    }

    const materials = result.data;

    const phaseSelect = document.getElementById("materials-phase-select");

const phasesResponse = await fetch("/api/phases?project_id=1");
const phasesResult = await phasesResponse.json();

if (!phasesResult.success) {
  throw new Error("No se pudieron cargar las fases.");
}

phaseSelect.innerHTML = `
  <option value="">Selecciona una fase</option>
  ${phasesResult.data.map(phase => `
    <option value="${phase.id}">${phase.name}</option>
  `).join("")}
`;

    document.getElementById("materials-count").textContent =
      materials.length;

    document.getElementById("materials-naps").textContent =
      materials.length > 0 ? materials[0].nap_count : 0;

    materialsContainer.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Material</th>
            <th>Cantidad total</th>
            <th>Unidad</th>
            <th>NAP</th>
          </tr>
        </thead>
        <tbody>
          ${materials.map(material => `
            <tr>
              <td>${material.name}</td>
              <td>${Number(material.total_quantity).toLocaleString("es-MX")}</td>
              <td>${material.unit}</td>
              <td>${material.nap_count}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

  } catch (error) {
    console.error("Error al cargar materiales:", error);

    materialsContainer.innerHTML = `
      <p>No fue posible cargar los materiales.</p>
    `;
  }
}

async function loadPhaseMaterials(phaseId) {
  const container = document.getElementById("phase-materials-container");

  container.innerHTML = "<p>Cargando materiales de la fase...</p>";

  try {
    const response = await fetch(`/api/phases/${phaseId}/materials`);
    const result = await response.json();

    if (!result.success) {
      throw new Error("No se pudieron consultar los materiales.");
    }

    if (result.data.length === 0) {
      container.innerHTML = `
        <div class="card">
          <p>Esta fase aún no tiene materiales registrados.</p>
        </div>
      `;
      return;
    }

    const groupedMaterials = result.data.reduce((groups, item) => {
      if (!groups[item.nap]) {
        groups[item.nap] = [];
      }

      groups[item.nap].push(item);
      return groups;
    }, {});

    container.innerHTML = Object.entries(groupedMaterials)
      .map(([nap, materials]) => `
        <article class="card">
          <h3>NAP ${nap}</h3>

          <table>
            <thead>
              <tr>
                <th>Material</th>
                <th>Cantidad</th>
                <th>Unidad</th>
              </tr>
            </thead>

            <tbody>
              ${materials.map(material => `
                <tr>
                  <td>${material.material}</td>
                  <td>${material.quantity}</td>
                  <td>${material.unit}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </article>
      `)
      .join("");

  } catch (error) {
    console.error("Error al cargar materiales por fase:", error);
    container.innerHTML = `
      <div class="card">
        <p>No fue posible cargar los materiales de esta fase.</p>
      </div>
    `;
  }
}

const materialsPhaseSelect = document.getElementById("materials-phase-select");

materialsPhaseSelect.addEventListener("change", () => {
  const phaseId = materialsPhaseSelect.value;

  const container = document.getElementById("phase-materials-container");

  if (!phaseId) {
    container.innerHTML = "<p>Selecciona una fase para consultar el desglose.</p>";
    return;
  }

  loadPhaseMaterials(phaseId);
});

// Consultar fases desde SQLite
async function loadPhases() {
  try {
    const response = await fetch("/api/phases?project_id=1");
    const result = await response.json();

    console.log("Respuesta de fases:", response.status, result);

    if (!result.success) {
      throw new Error("No se pudieron cargar las fases");
    }

    const phases = result.data;

    renderPhases(phases);
    renderProgress(phases);

    const totalMeters = phases.reduce((total, phase) => {
      return (
        total +
        phase.naps.reduce((sum, nap) => {
          return sum + (nap.meters ?? 0);
        }, 0)
      );
    }, 0);

    const allNaps = phases.flatMap((phase) => phase.naps);

    const completedNaps = allNaps.filter(
      (nap) => nap.construction_status === "TERMINADA",
    );

    const completedMeters = completedNaps.reduce(
      (total, nap) => total + (nap.meters ?? 0),
      0,
    );

    const completedPhases = phases.filter((phase) =>
      phase.naps.some((nap) => nap.construction_status === "TERMINADA"),
    ).length;

    document.getElementById("total-meters").textContent =
      `${totalMeters.toLocaleString("es-MX")} m`;

    document.getElementById("completed-meters").textContent =
      `${completedMeters.toLocaleString("es-MX")} m`;

    document.getElementById("completed-naps").textContent =
      `${completedNaps.length} / ${allNaps.length}`;

    document.getElementById("completed-phases").textContent =
      `${completedPhases} / ${phases.length}`;

    return phases;
  } catch (error) {
    console.error("Error cargando fases:", error);
    console.error("Detalle del error:", error.message);
    phasesContainer.textContent = "No se pudieron cargar las fases.";
    alert(error.stack);
  }
}

function renderPhases(phases) {
  phasesContainer.innerHTML = "";

  phases.forEach((phase) => {
    const card = document.createElement("article");
    card.classList.add("phase-card");

    const totalNaps = phase.naps.length;

    const completedNaps = phase.naps.filter(
      (nap) => nap.construction_status === "TERMINADA",
    ).length;

    const pendingNaps = totalNaps - completedNaps;

    const napsWithMeters = phase.naps.filter(
      (nap) => nap.meters !== null && nap.meters !== undefined,
    );

    const phaseMeters = napsWithMeters.reduce(
      (sum, nap) => sum + nap.meters,
      0,
    );

    const completedMeters = napsWithMeters.reduce(
      (sum, nap) =>
        sum + (nap.construction_status === "TERMINADA" ? nap.meters : 0),
      0,
    );

    const availableSlots = 8 - totalNaps;

    const percentage =
      totalNaps === 0 ? 0 : Math.round((completedNaps / totalNaps) * 100);

    card.innerHTML = `
      <h3>${phase.name}</h3>
      <p>${phase.status}</p>

      <div class="phase-metrics">
        <div>
          <span>NAP terminadas</span>
          <strong>${completedNaps} / ${totalNaps}</strong>
        </div>

        <div>
          <span>Metros construidos</span>
          <strong>${completedMeters.toLocaleString("es-MX")} m</strong>
        </div>
      </div>

      <div class="phase-nap-info">
        <span>${completedNaps} terminadas</span>
        <span>${pendingNaps} en proceso</span>
        <span>${availableSlots} espacios disponibles</span>
      </div>

      <div class="progress-bar">
        <div class="phase-progress-fill"
             style="width: ${percentage}%">
        </div>
      </div>

      <strong>${percentage}% de avance</strong>
    `;

    card.addEventListener("click", () => {
      showPhase(phase);
    });

    phasesContainer.appendChild(card);
  });
}

function renderProgress(phases) {
  const progressContainer = document.getElementById("progress-container");

  progressContainer.innerHTML = "";

  const allNaps = phases.flatMap((phase) => phase.naps);

  const completedNaps = allNaps.filter(
    (nap) => nap.construction_status === "TERMINADA",
  );

  const totalMeters = allNaps.reduce(
    (total, nap) => total + (nap.meters ?? 0),
    0,
  );

  const completedMeters = completedNaps.reduce(
    (total, nap) => total + (nap.meters ?? 0),
    0,
  );

  const globalPercentage =
    allNaps.length === 0
      ? 0
      : Math.round((completedNaps.length / allNaps.length) * 100);

  document.getElementById("global-percentage").textContent =
    `${globalPercentage}%`;

  document.getElementById("global-naps").textContent =
    `${completedNaps.length} / ${allNaps.length}`;

  document.getElementById("global-meters").textContent =
    `${completedMeters.toLocaleString("es-MX")} / ${totalMeters.toLocaleString("es-MX")} m`;

  phases.forEach((phase) => {
    const phaseCompletedNaps = phase.naps.filter(
      (nap) => nap.construction_status === "TERMINADA",
    );

    const percentage =
      phase.naps.length === 0
        ? 0
        : Math.round((phaseCompletedNaps.length / phase.naps.length) * 100);

    const phaseTotalMeters = phase.naps.reduce(
      (total, nap) => total + (nap.meters ?? 0),
      0,
    );

    const phaseCompletedMeters = phaseCompletedNaps.reduce(
      (total, nap) => total + (nap.meters ?? 0),
      0,
    );

    const card = document.createElement("article");

    card.className = "progress-card";

    card.innerHTML = `
      <h3>${phase.name}</h3>

      <p>${phaseCompletedNaps.length} / ${phase.naps.length} NAP terminadas</p>

      <div class="progress-bar">
        <div class="phase-progress-fill" style="width: ${percentage}%"></div>
      </div>

      <p>${percentage}% de avance</p>

      <p>
        ${phaseCompletedMeters.toLocaleString("es-MX")} /
        ${phaseTotalMeters.toLocaleString("es-MX")} m
      </p>
    `;

    progressContainer.appendChild(card);
  });
}

// Mostrar el detalle de una fase
function showPhase(phase) {
  phasesSection.hidden = true;
  dashboardCards.hidden = true;
  phaseDetail.hidden = false;

  document.getElementById("detail-title").textContent = phase.name;
  document.getElementById("detail-status").textContent = phase.status;

  const phaseMeters = phase.naps.reduce((sum, nap) => {
    if (nap.meters === null || nap.meters === undefined) {
      return sum;
    }

    return sum + nap.meters;
  }, 0);

  document.getElementById("detail-meters").textContent =
    `${phaseMeters.toLocaleString("es-MX")} m`;

  napsContainer.innerHTML = "";

  for (let number = 1; number <= 8; number++) {
    const napData = phase.naps.find((nap) => nap.number === number);

    // Si no existe un NAP registrado, mostrar espacio libre
    if (!napData) {
      const emptyNap = document.createElement("article");
      emptyNap.classList.add("nap-row", "nap-empty");

      emptyNap.innerHTML = `
      <strong>NAP ${String(number).padStart(2, "0")}</strong>
      <span>Espacio disponible</span>
    `;

      napsContainer.appendChild(emptyNap);
      continue;
    }
    const nap = document.createElement("article");
    nap.classList.add("nap-row");

    const meterText =
      napData.meters === null
        ? "Metraje pendiente"
        : `${napData.meters.toLocaleString("es-MX")} m`;

    const isCompleted = napData.status === "COMPLETED";

    const constructionLabels = {
      EN_PROCESO: "En proceso",
      TERMINADA: "Terminada",
    };

    const isConstructionCompleted = napData.construction_status === "TERMINADA";

    const constructionText =
      constructionLabels[napData.construction_status] ?? "Sin definir";

    const installationText = isCompleted
      ? "Instalación completada"
      : "Instalación pendiente";

    const today = new Date();

    const todayLocal = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0"),
    ].join("-");

    nap.innerHTML = `
  <strong>NAP ${String(napData.number).padStart(2, "0")}</strong>

  <span>${meterText}</span>

  <div class="nap-status-info">
    <span class="construction-status">
      Construcción: ${constructionText}
    </span>
    <span>${installationText}</span>
  </div>

  <div class="opening-info">
    ${
      napData.opening_date
        ? `
          <p>Fecha de apertura: ${napData.opening_date}</p>
          <p>Potencia inicial: ${napData.opening_power} dBm</p>
        `
        : `
          <form class="opening-form">
            <strong>Registrar apertura</strong>

            <label>Fecha de apertura</label>
            <input
              type="date"
              name="opening_date"
              required
              max="${todayLocal}"
              value="${todayLocal}"
            >

            <label>Potencia óptica (dBm)</label>
            <input
              type="number"
              name="opening_power"
              step="0.01"
              min="-100"
              max="10"
              placeholder="-23.45"
              required
            >

            <button class="opening-button">
              Registrar apertura y terminar construcción
            </button>
          </form>
        `
    }
  </div>
`;

    const constructionStatus = nap.querySelector(".construction-status");

    const openingForm = nap.querySelector(".opening-form");

    if (openingForm) {
      openingForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const openingButton = openingForm.querySelector(".opening-button");

        const openingDate = openingForm.elements.opening_date.value;
        const openingPower = Number(openingForm.elements.opening_power.value);

        openingButton.disabled = true;
        openingButton.textContent = "Guardando...";

        try {
          const response = await fetch(
            `/api/phases/${phase.id}/naps/${napData.number}/opening`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                opening_date: openingDate,
                opening_power: openingPower,
              }),
            },
          );

          const result = await response.json();

          if (!response.ok) {
            throw new Error(result.message);
          }

          const updatedPhases = await loadPhases();

          const updatedPhase = updatedPhases.find(
            (item) => item.id === phase.id,
          );

          if (updatedPhase) {
            showPhase(updatedPhase);
          }
        } catch (error) {
          console.error("Error al registrar apertura:", error);

          openingButton.disabled = false;
          openingButton.textContent = "Reintentar";

          alert(`Error al registrar apertura: ${error.message}`);
        }
      });
    }
    napsContainer.appendChild(nap);
  }

  updateProgress(phase);
}

// Calcular el avance
function updateProgress(phase) {
const completed = phase.naps.filter(
  (nap) => nap.construction_status === "TERMINADA",
).length;

  const total = phase.naps.filter(
    (nap) => nap.meters !== null && nap.meters > 0,
  ).length;

  const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);

  document.getElementById("completed-count").textContent =
    `${completed} de ${total} NAP terminadas`;

  document.getElementById("progress-percentage").textContent = `${percentage}%`;

  document.getElementById("progress-fill").style.width = `${percentage}%`;
}

closeModalButton.addEventListener("click", () => {
  completionModal.hidden = true;
});

// Regresar al panel
document.getElementById("back-button").addEventListener("click", () => {
  phaseDetail.hidden = true;
  phasesSection.hidden = false;
  dashboardCards.hidden = false;
});

// Iniciar aplicación
loadPhases();


async function loadConstructionPhases() {
  try {
    const response = await fetch(
      "/api/construction-phases?project_id=1"
    );
    const result = await response.json();

    if (!result.success) {
      throw new Error("No se pudieron cargar las fases.");
    }

    constructionPhaseSelect.innerHTML =
      '<option value="">Selecciona una fase</option>';

    result.data.forEach(phase => {
      const option = document.createElement("option");
      option.value = phase.id;
      option.textContent =
        `Fase ${phase.number} (${phase.completed_runs}/${phase.total_runs} tendidos)`;

      constructionPhaseSelect.appendChild(option);
    });

  } catch (error) {
    console.error(error);
    alert(error.message);
  }
}

async function loadFiberRuns(phaseId) {
  try {
    const response = await fetch(
      `/api/construction-phases/${phaseId}/runs`
    );

    const result = await response.json();

    if (!result.success) {
      throw new Error("No se pudieron cargar los tendidos.");
    }

    fiberRunsContainer.innerHTML = "";

[...result.data]
  .sort((a, b) => a.name.localeCompare(b.name, "es", { numeric: true }))
  .forEach(run => {
      const card = document.createElement("article");
      card.className = "card";

      card.innerHTML = `
        <h3>${run.name}</h3>
        <p>Hilos: ${run.strand_count}</p>
        <p>Estado: ${run.status}</p>
        <div class="run-materials">
          ${run.materials.map(material => `
            <label style="display:flex;justify-content:space-between;gap:12px;margin:10px 0;">
              ${material.name.replace(/\s*\((?:m|pza|pieza)\)\s*$/i, "")} (${material.unit})
              <input
                type="number"
                min="0"
                step="any"
                value="${material.actual_quantity}"
                data-material-id="${material.id}"
                style="width:100px;"
                ${run.status === "COMPLETADO" ? "disabled" : ""}
              >
            </label>
          `).join("")}
        </div>
        <button class="save-materials" ${run.status === "COMPLETADO" ? "disabled" : ""}>
          Guardar cantidades
        </button>
        ${
          run.status === "COMPLETADO"
            ? '<button class="reopen-run">Reabrir tendido</button>'
            : '<button class="complete-run">Completar tendido</button>'
        }
      `;

      fiberRunsContainer.appendChild(card);

      card.querySelector(".save-materials").addEventListener("click", async () => {
        try {
          const inputs = card.querySelectorAll("[data-material-id]");

          for (const input of inputs) {
            const response = await fetch(
              `/api/fiber-runs/${run.id}/materials/${input.dataset.materialId}`,
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  actual_quantity: Number(input.value)
                })
              }
            );

            const result = await response.json();

            if (!response.ok) throw new Error(result.message);
          }

          alert("Cantidades guardadas correctamente.");
          await loadFiberRuns(phaseId);

        } catch (error) {
          alert(error.message);
        }
      });

      const completeButton = card.querySelector(".complete-run");

      if (completeButton) {
        completeButton.addEventListener("click", async () => {
          if (!confirm(`¿Completar ${run.name}?`)) return;

          try {
            const response = await fetch(
              `/api/fiber-runs/${run.id}/complete`,
              { method: "PATCH" }
            );

            const result = await response.json();

            if (!response.ok) throw new Error(result.message);

            alert(result.n8n?.sent
              ? "Tendido completado. Reporte enviado a n8n."
              : result.n8n?.error
                ? `Tendido completado. Error de n8n: ${result.n8n.error}`
                : "Tendido completado."
            );

            await loadConstructionPhases();
            await loadFiberRuns(phaseId);

          } catch (error) {
            alert(error.message);
          }
        });
      }

      const reopenButton = card.querySelector(".reopen-run");

      if (reopenButton) {
        reopenButton.addEventListener("click", async () => {
          if (!confirm(`¿Reabrir ${run.name}?`)) return;

          try {
            const response = await fetch(
              `/api/fiber-runs/${run.id}/reopen`,
              { method: "PATCH" }
            );

            const result = await response.json();

            if (!response.ok) throw new Error(result.message);

            alert("Tendido reabierto.");
            await loadConstructionPhases();
            await loadFiberRuns(phaseId);

          } catch (error) {
            alert(error.message);
          }
        });
      }
    });

  } catch (error) {
    console.error(error);
    fiberRunsContainer.innerHTML = `<p>${error.message}</p>`;
  }
}

