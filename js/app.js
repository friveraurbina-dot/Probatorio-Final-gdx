(function () {
  "use strict";

  const state = {
    all: [],
    filtered: [],
    currentActivity: null,
    lightboxPhotos: [],
    lightboxIndex: 0,
  };

  const el = {
    grid: document.getElementById("grid"),
    emptyState: document.getElementById("emptyState"),
    resultsInfo: document.getElementById("resultsInfo"),
    stats: document.getElementById("stats"),
    searchInput: document.getElementById("searchInput"),
    groupFilter: document.getElementById("groupFilter"),
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

  async function loadData() {
    const res = await fetch("data/activities.json");
    const data = await res.json();
    state.all = data;
    state.filtered = data;
    populateGroupFilter(data);
    renderStats(data);
    render();
  }

  function populateGroupFilter(data) {
    const groups = Array.from(new Set(data.map((a) => a.group))).sort();
    groups.forEach((g) => {
      const opt = document.createElement("option");
      opt.value = g;
      opt.textContent = g;
      el.groupFilter.appendChild(opt);
    });
  }

  function renderStats(data) {
    const totalPhotos = data.reduce((sum, a) => sum + a.photos.length, 0);
    const groups = new Set(data.map((a) => a.group)).size;
    el.stats.innerHTML = `
      <div><b>${data.length}</b>actividades</div>
      <div><b>${totalPhotos}</b>fotos</div>
      <div><b>${groups}</b>grupos</div>
    `;
  }

  function applyFilters() {
    const q = el.searchInput.value.trim().toLowerCase();
    const group = el.groupFilter.value;
    const photoMode = el.photoFilter.value;

    state.filtered = state.all.filter((a) => {
      if (group && a.group !== group) return false;
      if (photoMode === "with" && a.photos.length === 0) return false;
      if (photoMode === "without" && a.photos.length > 0) return false;
      if (q) {
        const haystack = [
          a.primary_id || "",
          a.sender || "",
          a.group || "",
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
      card.appendChild(thumb);

      const body = document.createElement("div");
      body.className = "card-body";
      body.innerHTML = `
        <span class="badge">${a.primary_id || "Sin identificador"}</span>
        <div class="card-group">${a.group}</div>
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

    const photosHtml =
      a.photos.length > 0
        ? `<div class="photo-grid">${a.photos
            .map(
              (p, i) =>
                `<img src="${encodeURI(p.thumb)}" data-full="${encodeURI(p.img)}" data-index="${i}">`
            )
            .join("")}</div>`
        : `<p class="no-photos-note">No se encontraron fotos descargadas para esta actividad (puede que aún no se hayan descargado o falten por sincronizar).</p>`;

    el.modalBody.innerHTML = `
      <div class="detail-header">
        <p class="detail-id">${a.primary_id || "Sin identificador"}</p>
        <p class="detail-meta">${a.group} &middot; ${a.sender || ""} &middot; ${fmtDate(a.start)}${a.start !== a.end ? " &ndash; " + fmtDate(a.end) : ""}</p>
      </div>
      <div class="detail-ids">${idsHtml}</div>
      <div class="detail-text">${(a.text || "(sin texto)").replace(/</g, "&lt;")}</div>
      <div class="detail-actions">
        <button class="btn btn-primary" id="btnFicha">Descargar ficha (PDF)</button>
        <button class="btn btn-secondary" id="btnZip" ${a.photos.length === 0 ? "disabled" : ""}>Descargar ZIP (fotos + texto)</button>
      </div>
      ${photosHtml}
    `;

    el.modalBody.querySelectorAll(".photo-grid img").forEach((img) => {
      img.addEventListener("click", () => openLightbox(a.photos, parseInt(img.dataset.index, 10)));
    });
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
      doc.text(`Grupo: ${a.group}`, margin, y); y += 14;
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
        `Grupo: ${a.group}`,
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
  el.groupFilter.addEventListener("change", applyFilters);
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
