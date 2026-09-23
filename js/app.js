(function () {
  "use strict";

  const MAX_PHOTOS_PREVIEW = 5;

  // ---- Agrupación por zona de mantenimiento ----
  // Nombres a mostrar para grupos que se renombraron en el tablero
  // (el nombre real del grupo de WhatsApp, en `activities.json`, no cambia).
  const GROUP_DISPLAY_NAMES = {
    "Supervisores": "Redes Energizadas",
    "Trabajos Mant. Empalmes": "Empalmes Distribucion",
    "Fotos distribución": "Fotos Terreno",
  };

  // A qué zona de mantenimiento pertenece cada grupo de WhatsApp.
  // Los grupos que no aparecen acá se muestran en la sección "General"
  // (sin desglose por zona), por ahora: Reporte SAT Costa_MM, Redes
  // Energizadas, Empalmes Distribucion y Fotos Terreno.
  const GROUP_ZONES = {
    "Coordinación SIEL Chilquinta": "Zona Costa",
    "Reporte Valparaiso Dx": "Zona Valparaíso",
    // Grupos nuevos pendientes de incorporar (ver claude/estado-proyecto.md):
    // "Reporte Quillota": "Zona Quillota",
    // "Reporte San Antonio": "Zona San Antonio",
    // "Reporte SAT Los Andes": "Zona Los Andes",
  };

  // Orden fijo de las zonas en pestañas y en el resumen (aunque algunas
  // todavía no tengan ningún grupo asignado).
  const ZONE_ORDER = [
    "Zona Aconcagua",
    "Zona Quillota",
    "Zona Marga Marga",
    "Zona Costa",
    "Zona Valparaíso",
    "Zona San Antonio",
    "Zona Los Andes",
  ];

  const ZONE_TAB_PREFIX = "zone:";

  function displayName(group) {
    return GROUP_DISPLAY_NAMES[group] || group;
  }

  function zoneOf(group) {
    return GROUP_ZONES[group] || null;
  }

  function groupLabelWithZone(group) {
    const z = zoneOf(group);
    const name = displayName(group);
    return z ? `${name} · ${z}` : name;
  }

  const state = {
    all: [],
    filtered: [],
    currentActivity: null,
    lightboxPhotos: [],
    lightboxIndex: 0,
    activeTab: "", // "" = Resumen (todos los grupos)
  };

  const el = {
    grid: document.getElementById("grid"),
    emptyState: document.getElementById("emptyState"),
    resultsInfo: document.getElementById("resultsInfo"),
    stats: document.getElementById("stats"),
    searchInput: document.getElementById("searchInput"),
    tabs: document.getElementById("tabs"),
    summaryGrid: document.getElementById("summaryGrid"),
    photoFilter: document.getElementById("photoFilter"),
    modalOverlay: document.getElementById("modalOverlay"),
    modalBody: document.getElementById("modalBody"),
    modalClose: document.getElementById("modalClose"),
    lightbox: document.getElementById("lightbox"),
    lightboxImg: document.getElementById("lightboxImg"),
    lightboxClose: document.getElementById("lightboxClose"),
    lightboxPrev: document.getElementById("lightboxPrev"),
    lightboxNext: document.getElementById("lightboxNext"),
  };

  function fmtDate(raw) {
    if (!raw) return "";
    return raw.replace(" AM", " a. m.").replace(" PM", " p. m.");
  }

  function idsFlat(ids) {
    const out = [];
    Object.keys(ids || {}).forEach((label) => {
      (ids[label] || []).forEach((v) => out.push(`${label.toUpperCase()}: ${v}`));
    });
    return out;
  }

  // Validador de fotos vs. actividad declarada.
  const VALIDATION_LABELS = {
    ok: "✓ Corresponde",
    revisar: "⚠ Revisar",
    no_corresponde: "✕ No corresponde",
    sin_fotos: "Sin fotos",
  };

  function validationLabel(estado) {
    return VALIDATION_LABELS[estado] || estado;
  }

  // Parsea fechas tipo "D/M/YYYY H:MM a. m./p. m." o "D/M/YYYY H:MM (approx)"
  // a un timestamp numérico para poder ordenar. Devuelve 0 si no se puede leer.
  function parseStartDate(raw) {
    if (!raw) return 0;
    const m = raw.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?)?/i
    );
    if (!m) return 0;
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const year = parseInt(m[3], 10);
    let hour = m[4] ? parseInt(m[4], 10) : 0;
    const minute = m[5] ? parseInt(m[5], 10) : 0;
    const ampm = m[6] ? m[6].toLowerCase().replace(/[\s.]/g, "") : "";
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    const ts = new Date(year, month, day, hour, minute).getTime();
    return isNaN(ts) ? 0 : ts;
  }

  async function loadData() {
    const res = await fetch("data/activities.json");
    const data = await res.json();
    // Más nueva primero (antes venían de la más antigua a la más nueva).
    data.sort((a, b) => parseStartDate(b.start) - parseStartDate(a.start));
    state.all = data;
    state.filtered = data;
    renderTabs(data);
    renderSummaryCards(data);
    renderStats(data);
    render();
  }

  function renderTabs(data) {
    const groups = Array.from(new Set(data.map((a) => a.group)));
    const zonesPresent = ZONE_ORDER.filter((z) =>
      groups.some((g) => zoneOf(g) === z)
    );
    const ungroupedGroups = groups
      .filter((g) => !zoneOf(g))
      .sort((a, b) => displayName(a).localeCompare(displayName(b)));

    const tabDefs = [{ value: "", label: "Resumen" }]
      .concat(zonesPresent.map((z) => ({ value: ZONE_TAB_PREFIX + z, label: z })))
      .concat(ungroupedGroups.map((g) => ({ value: g, label: displayName(g) })));
    el.tabs.innerHTML = "";
    tabDefs.forEach(({ value, label }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tab-btn" + (value === state.activeTab ? " active" : "");
      btn.dataset.value = value;
      btn.textContent = label;
      btn.addEventListener("click", () => selectTab(value));
      el.tabs.appendChild(btn);
    });
  }

  function selectTab(value) {
    state.activeTab = value;
    el.tabs.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.value === value);
    });
    applyFilters();
  }

  function renderSummaryCards(data) {
    const groups = Array.from(new Set(data.map((a) => a.group)));
    const zonesPresent = ZONE_ORDER.filter((z) =>
      groups.some((g) => zoneOf(g) === z)
    );
    const ungroupedGroups = groups
      .filter((g) => !zoneOf(g))
      .sort((a, b) => displayName(a).localeCompare(displayName(b)));

    function cardHtml(label, items, tabValue) {
      const photos = items.reduce((sum, a) => sum + a.photos.length, 0);
      return `
        <div class="summary-card" data-tab="${tabValue}">
          <h3>${label}</h3>
          <div class="summary-nums">
            <div><b>${items.length}</b>actividades</div>
            <div><b>${photos}</b>fotos</div>
          </div>
        </div>
      `;
    }

    let html = "";

    if (zonesPresent.length > 0) {
      html += `<h2 class="summary-section-title">Detalle por zona de mantenimiento</h2>`;
      html += `<div class="summary-grid-inner">`;
      zonesPresent.forEach((z) => {
        const items = data.filter((a) => zoneOf(a.group) === z);
        html += cardHtml(z, items, ZONE_TAB_PREFIX + z);
      });
      html += `</div>`;
    }

    if (ungroupedGroups.length > 0) {
      html += `<h2 class="summary-section-title">General</h2>`;
      html += `<div class="summary-grid-inner">`;
      ungroupedGroups.forEach((g) => {
        const items = data.filter((a) => a.group === g);
        html += cardHtml(displayName(g), items, g);
      });
      html += `</div>`;
    }

    el.summaryGrid.innerHTML = html;
    el.summaryGrid.querySelectorAll(".summary-card").forEach((card) => {
      card.addEventListener("click", () => selectTab(card.dataset.tab));
    });
  }

  function renderStats(data) {
    const totalPhotos = data.reduce((sum, a) => sum + a.photos.length, 0);
    const groups = new Set(data.map((a) => a.group)).size;
    const zonesPresent = new Set(
      data.map((a) => zoneOf(a.group)).filter(Boolean)
    ).size;
    el.stats.innerHTML = `
      <div><b>${data.length}</b>actividades</div>
      <div><b>${totalPhotos}</b>fotos</div>
      <div><b>${groups}</b>grupos</div>
      <div><b>${zonesPresent}</b>zonas</div>
    `;
  }

  function applyFilters() {
    const q = el.searchInput.value.trim().toLowerCase();
    const tabValue = state.activeTab;
    const photoMode = el.photoFilter.value;
    const isZone = tabValue.startsWith(ZONE_TAB_PREFIX);
    const zoneName = isZone ? tabValue.slice(ZONE_TAB_PREFIX.length) : null;

    state.filtered = state.all.filter((a) => {
      if (tabValue) {
        if (isZone) {
          if (zoneOf(a.group) !== zoneName) return false;
        } else if (a.group !== tabValue) {
          return false;
        }
      }
      if (photoMode === "with" && a.photos.length === 0) return false;
      if (photoMode === "without" && a.photos.length > 0) return false;
      if (q) {
        const haystack = [
          a.primary_id || "",
          a.sender || "",
          a.group || "",
          displayName(a.group) || "",
          a.text || "",
          idsFlat(a.ids).join(" "),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    render();
  }

  function render() {
    el.summaryGrid.hidden = state.activeTab !== "";
    el.grid.innerHTML = "";
    el.emptyState.hidden = state.filtered.length > 0;
    el.resultsInfo.textContent = `${state.filtered.length} actividad(es) encontradas`;

    state.filtered.forEach((a) => {
      const card = document.createElement("article");
      card.className = "card";
      card.addEventListener("click", () => openDetail(a));

      const thumb = document.createElement("div");
      thumb.className = "card-thumb";
      if (a.photos.length > 0) {
        thumb.style.backgroundImage = `url(${encodeURI(a.photos[0].thumb)})`;
      } else {
        thumb.textContent = "Sin fotos";
      }
      if (a.validation && a.validation.estado !== "sin_fotos") {
        const vb = document.createElement("span");
        vb.className = `val-badge card-thumb-badge val-${a.validation.estado}`;
        vb.textContent = validationLabel(a.validation.estado);
        thumb.appendChild(vb);
      }
      card.appendChild(thumb);

      const body = document.createElement("div");
      body.className = "card-body";
      body.innerHTML = `
        <span class="badge">${a.primary_id || "Sin identificador"}</span>
        <div class="card-group">${groupLabelWithZone(a.group)}</div>
        <div class="card-dates">${fmtDate(a.start)}${a.start !== a.end ? " &ndash; " + fmtDate(a.end) : ""}</div>
        <div class="card-text">${(a.text || "").slice(0, 140)}</div>
        <div class="card-footer">
          <span>${a.sender || ""}</span>
          <span>${a.photos.length} foto(s)</span>
        </div>
      `;
      card.appendChild(body);
      el.grid.appendChild(card);
    });
  }

  function openDetail(a) {
    state.currentActivity = a;
    const idsHtml = idsFlat(a.ids)
      .map((s) => `<span class="badge">${s}</span>`)
      .join("");

    const validationHtml =
      a.validation && a.validation.estado !== "sin_fotos"
        ? `<div class="detail-validation val-${a.validation.estado}">
             <span class="detail-validation-label">${validationLabel(a.validation.estado)}</span>
             <span>${(a.validation.motivo || "").replace(/</g, "&lt;")}</span>
           </div>`
        : "";

    const shownPhotos = a.photos.slice(0, MAX_PHOTOS_PREVIEW);
    const remaining = a.photos.length - shownPhotos.length;

    function photoImgTag(p, i) {
      return `<img src="${encodeURI(p.thumb)}" data-full="${encodeURI(p.img)}" data-index="${i}">`;
    }

    const photosHtml =
      a.photos.length > 0
        ? `<div class="photo-grid" id="photoGrid">${shownPhotos.map(photoImgTag).join("")}</div>
           ${remaining > 0 ? `<button class="btn btn-secondary btn-show-all" id="btnShowAllPhotos">Mostrar las ${a.photos.length} fotos</button>` : ""}`
        : `<p class="no-photos-note">No se encontraron fotos descargadas para esta actividad (puede que aún no se hayan descargado o falten por sincronizar).</p>`;

    el.modalBody.innerHTML = `
      <div class="detail-header">
        <p class="detail-id">${a.primary_id || "Sin identificador"}</p>
        <p class="detail-meta">${groupLabelWithZone(a.group)} &middot; ${a.sender || ""} &middot; ${fmtDate(a.start)}${a.start !== a.end ? " &ndash; " + fmtDate(a.end) : ""}</p>
      </div>
      ${validationHtml}
      <div class="detail-ids">${idsHtml}</div>
      <div class="detail-text">${(a.text || "(sin texto)").replace(/</g, "&lt;")}</div>
      <div class="detail-actions">
        <button class="btn btn-primary" id="btnFicha">Descargar ficha (PDF)</button>
        <button class="btn btn-secondary" id="btnZip" ${a.photos.length === 0 ? "disabled" : ""}>Descargar ZIP (fotos + texto)</button>
      </div>
      ${photosHtml}
    `;

    function bindPhotoClicks() {
      el.modalBody.querySelectorAll(".photo-grid img").forEach((img) => {
        img.addEventListener("click", () => openLightbox(a.photos, parseInt(img.dataset.index, 10)));
      });
    }
    bindPhotoClicks();

    const btnShowAll = document.getElementById("btnShowAllPhotos");
    if (btnShowAll) {
      btnShowAll.addEventListener("click", () => {
        document.getElementById("photoGrid").innerHTML = a.photos.map(photoImgTag).join("");
        btnShowAll.remove();
        bindPhotoClicks();
      });
    }

    document.getElementById("btnFicha").addEventListener("click", () => generateFicha(a));
    const btnZip = document.getElementById("btnZip");
    if (btnZip) btnZip.addEventListener("click", () => generateZip(a));

    el.modalOverlay.hidden = false;
  }

  function closeDetail() {
    el.modalOverlay.hidden = true;
    state.currentActivity = null;
  }

  function openLightbox(photos, index) {
    state.lightboxPhotos = photos;
    state.lightboxIndex = index;
    updateLightbox();
    el.lightbox.hidden = false;
  }

  function updateLightbox() {
    const p = state.lightboxPhotos[state.lightboxIndex];
    el.lightboxImg.src = encodeURI(p.img);
  }

  function closeLightbox() {
    el.lightbox.hidden = true;
  }

  function lightboxStep(delta) {
    const n = state.lightboxPhotos.length;
    state.lightboxIndex = (state.lightboxIndex + delta + n) % n;
    updateLightbox();
  }

  async function generateFicha(a) {
    const btn = document.getElementById("btnFicha");
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Generando...";
    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 42;
      let y = margin;

      doc.setFontSize(16);
      doc.setFont(undefined, "bold");
      doc.text("Ficha de actividad — Probatorio Final GDX", margin, y);
      y += 26;

      doc.setFontSize(13);
      doc.text(a.primary_id || "Sin identificador", margin, y);
      y += 20;

      doc.setFont(undefined, "normal");
      doc.setFontSize(10);
      doc.text(`Grupo: ${groupLabelWithZone(a.group)}`, margin, y); y += 14;
      doc.text(`Remitente: ${a.sender || ""}`, margin, y); y += 14;
      doc.text(`Fecha: ${fmtDate(a.start)}${a.start !== a.end ? " a " + fmtDate(a.end) : ""}`, margin, y); y += 14;
      const idsLine = idsFlat(a.ids).join("  |  ");
      if (idsLine) {
        const idsWrapped = doc.splitTextToSize(idsLine, pageWidth - margin * 2);
        doc.text(idsWrapped, margin, y);
        y += idsWrapped.length * 12 + 6;
      }

      y += 6;
      doc.setFont(undefined, "bold");
      doc.text("Texto del reporte:", margin, y);
      y += 16;
      doc.setFont(undefined, "normal");
      const textLines = doc.splitTextToSize(a.text || "(sin texto)", pageWidth - margin * 2);
      textLines.forEach((line) => {
        if (y > 780) { doc.addPage(); y = margin; }
        doc.text(line, margin, y);
        y += 13;
      });

      // photos
      if (a.photos.length > 0) {
        doc.addPage();
        y = margin;
        doc.setFont(undefined, "bold");
        doc.setFontSize(12);
        doc.text(`Fotografías (${a.photos.length})`, margin, y);
        y += 20;

        const imgW = (pageWidth - margin * 2 - 12) / 2;
        const imgH = imgW * 0.75;
        let col = 0;

        for (const p of a.photos) {
          const dataUrl = await imageToDataUrl(p.img);
          if (!dataUrl) continue;
          const x = margin + col * (imgW + 12);
          if (y + imgH > 800) {
            doc.addPage();
            y = margin;
          }
          try {
            doc.addImage(dataUrl, "JPEG", x, y, imgW, imgH);
          } catch (e) {
            // skip broken image
          }
          col++;
          if (col === 2) {
            col = 0;
            y += imgH + 12;
          }
        }
      }

      const filename = `Ficha_${(a.primary_id || a.id).replace(/[^A-Za-z0-9\-]+/g, "_")}.pdf`;
      doc.save(filename);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  function imageToDataUrl(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = encodeURI(src);
    });
  }

  async function generateZip(a) {
    const btn = document.getElementById("btnZip");
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Preparando ZIP...";
    try {
      const zip = new JSZip();
      const folderName = (a.primary_id || a.id).replace(/[^A-Za-z0-9\-]+/g, "_");
      const folder = zip.folder(folderName);

      const infoLines = [
        `Identificador: ${a.primary_id || "Sin identificador"}`,
        `Grupo: ${groupLabelWithZone(a.group)}`,
        `Remitente: ${a.sender || ""}`,
        `Fecha: ${fmtDate(a.start)}${a.start !== a.end ? " a " + fmtDate(a.end) : ""}`,
        `Identificadores detectados: ${idsFlat(a.ids).join(", ")}`,
        "",
        "Texto del reporte:",
        a.text || "(sin texto)",
      ];
      folder.file("info.txt", infoLines.join("\n"));

      let i = 1;
      for (const p of a.photos) {
        const res = await fetch(encodeURI(p.img));
        const blob = await res.blob();
        folder.file(`foto_${String(i).padStart(2, "0")}.jpg`, blob);
        i++;
      }

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a_tag = document.createElement("a");
      a_tag.href = url;
      a_tag.download = `${folderName}.zip`;
      document.body.appendChild(a_tag);
      a_tag.click();
      document.body.removeChild(a_tag);
      URL.revokeObjectURL(url);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  // events
  el.searchInput.addEventListener("input", applyFilters);
  el.photoFilter.addEventListener("change", applyFilters);
  el.modalClose.addEventListener("click", closeDetail);
  el.modalOverlay.addEventListener("click", (e) => {
    if (e.target === el.modalOverlay) closeDetail();
  });
  el.lightboxClose.addEventListener("click", closeLightbox);
  el.lightboxPrev.addEventListener("click", () => lightboxStep(-1));
  el.lightboxNext.addEventListener("click", () => lightboxStep(1));
  el.lightbox.addEventListener("click", (e) => {
    if (e.target === el.lightbox) closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (!el.lightbox.hidden) {
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") lightboxStep(-1);
      if (e.key === "ArrowRight") lightboxStep(1);
    } else if (!el.modalOverlay.hidden && e.key === "Escape") {
      closeDetail();
    }
  });

  loadData();
})();
