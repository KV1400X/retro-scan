/* Retro Scan — photogrammetry capture PWA for small objects */
(function () {
  'use strict';

  const RINGS = [
    { id: 'low', label: 'Low', target: 10, tip: 'Shoot below midline, orbit 360°' },
    { id: 'eye', label: 'Eye', target: 12, tip: 'Eye-level orbit around the part' },
    { id: 'high', label: 'High', target: 10, tip: 'Shoot from above, orbit 360°' }
  ];

  const state = {
    stream: null,
    photos: [], // { id, blob, dataUrl, ring, ts }
    activeRing: 'eye',
    exporting: false
  };

  const $ = (sel) => document.querySelector(sel);
  const video = $('#preview');
  const canvas = $('#snapCanvas');
  const flash = $('#flash');
  const toastEl = $('#toast');

  function toast(msg, ms = 2200) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  function pad(n, w = 2) {
    return String(n).padStart(w, '0');
  }

  function scanStamp(d = new Date()) {
    return (
      d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      '-' +
      pad(d.getHours()) +
      pad(d.getMinutes())
    );
  }

  /* —— Rings UI —— */
  function ringCounts() {
    const c = { low: 0, eye: 0, high: 0 };
    for (const p of state.photos) c[p.ring] = (c[p.ring] || 0) + 1;
    return c;
  }

  function renderRings() {
    const bar = $('#ringBar');
    const counts = ringCounts();
    bar.innerHTML = RINGS.map((r) => {
      const n = counts[r.id] || 0;
      const active = state.activeRing === r.id ? ' active' : '';
      return `<button type="button" class="ring-btn${active}" data-ring="${r.id}" role="tab" aria-selected="${state.activeRing === r.id}">
        ${r.label}<span class="count">${n}/${r.target}</span>
      </button>`;
    }).join('');

    bar.querySelectorAll('.ring-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.activeRing = btn.dataset.ring;
        renderRings();
        renderProgress();
        updateRingChip();
      });
    });
  }

  function renderProgress() {
    const counts = ringCounts();
    const row = $('#progressRow');
    row.innerHTML = RINGS.map((r) => {
      const n = counts[r.id] || 0;
      let cls = 'progress-pill';
      if (n >= r.target) cls += ' done';
      else if (r.id === state.activeRing) cls += ' current';
      return `<span class="${cls}">${r.label} ${n}/${r.target}</span>`;
    }).join('');
  }

  function updateRingChip() {
    const r = RINGS.find((x) => x.id === state.activeRing);
    $('#ringChipText').textContent = `${r.label} orbit — ${r.tip}`;
  }

  function updateGalleryChrome() {
    const n = state.photos.length;
    const badge = $('#photoBadge');
    const thumb = $('#galleryThumb');
    const ph = $('#galleryPlaceholder');
    const exportBtn = $('#btnExport');

    if (n === 0) {
      badge.hidden = true;
      thumb.hidden = true;
      ph.hidden = false;
      exportBtn.disabled = true;
      $('#btnGallery').classList.add('empty');
    } else {
      badge.hidden = false;
      badge.textContent = String(n);
      ph.hidden = true;
      thumb.hidden = false;
      thumb.src = state.photos[state.photos.length - 1].dataUrl;
      exportBtn.disabled = false;
      $('#btnGallery').classList.remove('empty');
    }
  }

  /* —— Camera —— */
  async function startCamera() {
    const errBox = $('#cameraError');
    errBox.classList.remove('show');
    try {
      if (state.stream) {
        state.stream.getTracks().forEach((t) => t.stop());
        state.stream = null;
      }
      const constraints = {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 4032 },
          height: { ideal: 3024 }
        }
      };
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (e1) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'environment' }
        });
      }
      state.stream = stream;
      video.srcObject = stream;
      await video.play();
      $('#btnCapture').disabled = false;
    } catch (err) {
      console.error(err);
      $('#cameraErrorMsg').textContent =
        (err && err.message ? err.message : 'Permission denied') +
        '. Open in Safari over HTTPS, allow Camera, and try again.';
      errBox.classList.add('show');
      $('#btnCapture').disabled = true;
    }
  }

  function captureStill() {
    if (!state.stream || video.readyState < 2) {
      toast('Camera not ready');
      return;
    }
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) {
      toast('Waiting for camera…');
      return;
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);

    flash.classList.add('on');
    setTimeout(() => flash.classList.remove('on'), 80);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          toast('Capture failed');
          return;
        }
        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        const photo = {
          id: 'p' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          blob,
          dataUrl,
          ring: state.activeRing,
          ts: new Date().toISOString(),
          width: w,
          height: h
        };
        state.photos.push(photo);
        renderRings();
        renderProgress();
        updateGalleryChrome();
        maybeAdvanceRing();
        toast(`Shot ${state.photos.length} · ${RINGS.find((r) => r.id === photo.ring).label}`);
      },
      'image/jpeg',
      0.92
    );
  }

  function maybeAdvanceRing() {
    const counts = ringCounts();
    const cur = RINGS.find((r) => r.id === state.activeRing);
    if (counts[cur.id] >= cur.target) {
      const idx = RINGS.findIndex((r) => r.id === cur.id);
      for (let i = 1; i < RINGS.length; i++) {
        const next = RINGS[(idx + i) % RINGS.length];
        if ((counts[next.id] || 0) < next.target) {
          state.activeRing = next.id;
          renderRings();
          renderProgress();
          updateRingChip();
          toast(`Ring complete — switch to ${next.label}`);
          return;
        }
      }
      toast('All rings hit target — export when ready');
    }
  }

  /* —— Gallery —— */
  function openPanel(id) {
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('open'));
    $(id).classList.add('open');
  }
  function closePanels() {
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('open'));
  }

  function renderGallery() {
    const grid = $('#galleryGrid');
    const empty = $('#galleryEmpty');
    if (!state.photos.length) {
      grid.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    grid.innerHTML = state.photos
      .map((p, i) => {
        const ring = RINGS.find((r) => r.id === p.ring);
        return `<div class="gallery-item" data-id="${p.id}">
          <img src="${p.dataUrl}" alt="Photo ${i + 1}" loading="lazy" />
          <span class="meta">${pad(i + 1, 3)} · ${ring.label}</span>
          <button type="button" class="del" data-del="${p.id}" aria-label="Delete photo">×</button>
        </div>`;
      })
      .join('');
    grid.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deletePhoto(btn.dataset.del);
      });
    });
  }

  function deletePhoto(id) {
    state.photos = state.photos.filter((p) => p.id !== id);
    renderGallery();
    renderRings();
    renderProgress();
    updateGalleryChrome();
  }

  function clearGallery() {
    if (!state.photos.length) return;
    if (!confirm('Delete all photos in this session?')) return;
    state.photos = [];
    renderGallery();
    renderRings();
    renderProgress();
    updateGalleryChrome();
    toast('Gallery cleared');
  }

  /* —— ZIP export —— */
  function buildScanJson(folderName) {
    const counts = ringCounts();
    return {
      app: 'Retro Scan',
      version: 1,
      folder: folderName,
      exportedAt: new Date().toISOString(),
      photoCount: state.photos.length,
      rings: RINGS.map((r) => ({
        id: r.id,
        label: r.label,
        target: r.target,
        count: counts[r.id] || 0
      })),
      notes: ($('#notes').value || '').trim(),
      deviceHint: 'iPhone / Safari web capture (no LiDAR). Reconstruct on PC with COLMAP.',
      photos: state.photos.map((p, i) => ({
        file: `img_${pad(i + 1, 3)}.jpg`,
        ring: p.ring,
        capturedAt: p.ts,
        width: p.width,
        height: p.height
      }))
    };
  }

  async function blobToUint8(blob) {
    const buf = await blob.arrayBuffer();
    return new Uint8Array(buf);
  }

  async function buildZip() {
    if (typeof fflate === 'undefined') throw new Error('ZIP library missing');
    const stamp = scanStamp();
    const folder = `scan-${stamp}`;
    const files = {};
    const meta = buildScanJson(folder);
    const enc = new TextEncoder();
    files[`${folder}/scan.json`] = enc.encode(JSON.stringify(meta, null, 2));

    for (let i = 0; i < state.photos.length; i++) {
      const name = `${folder}/img_${pad(i + 1, 3)}.jpg`;
      files[name] = await blobToUint8(state.photos[i].blob);
    }

    return new Promise((resolve, reject) => {
      fflate.zip(files, { level: 0 }, (err, data) => {
        if (err) reject(err);
        else resolve({ data, filename: `${folder}.zip`, folder, meta });
      });
    });
  }

  function setExportStatus(msg, cls) {
    const el = $('#exportStatus');
    el.textContent = msg || '';
    el.className = 'export-status' + (cls ? ' ' + cls : '');
  }

  async function shareZip() {
    if (state.exporting || !state.photos.length) return;
    state.exporting = true;
    setExportStatus('Building ZIP…');
    try {
      const { data, filename } = await buildZip();
      const blob = new Blob([data], { type: 'application/zip' });
      const file = new File([blob], filename, { type: 'application/zip' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: 'Retro Scan',
          text: `Photogrammetry capture (${state.photos.length} photos)`
        });
        setExportStatus('Shared.', 'ok');
        toast('Shared ZIP');
      } else if (navigator.share) {
        // Share without files — fall back to download
        setExportStatus('Share with files not supported — use Download.', 'err');
        await downloadBlob(blob, filename);
      } else {
        setExportStatus('Web Share unavailable — downloaded instead.', 'ok');
        await downloadBlob(blob, filename);
      }
    } catch (err) {
      if (err && err.name === 'AbortError') {
        setExportStatus('Share cancelled.');
      } else {
        console.error(err);
        setExportStatus('Share failed: ' + (err.message || err), 'err');
        toast('Share failed — try Download');
      }
    } finally {
      state.exporting = false;
    }
  }

  async function downloadZip() {
    if (state.exporting || !state.photos.length) return;
    state.exporting = true;
    setExportStatus('Building ZIP…');
    try {
      const { data, filename } = await buildZip();
      const blob = new Blob([data], { type: 'application/zip' });
      await downloadBlob(blob, filename);
      setExportStatus('Download started. On iPhone: check Files / Downloads, or use Share.', 'ok');
      toast('ZIP ready');
    } catch (err) {
      console.error(err);
      setExportStatus('Download failed: ' + (err.message || err), 'err');
    } finally {
      state.exporting = false;
    }
  }

  async function downloadBlob(blob, filename) {
    // iOS Safari: <a download> is unreliable; try object URL + click, and keep link briefly
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 4000);
  }

  /* —— Honesty dismiss —— */
  function initHonesty() {
    try {
      if (localStorage.getItem('retroScanHonestyDismissed') === '1') {
        $('#honestyBanner').classList.add('hidden');
      }
    } catch (_) {}
    $('#btnDismissHonesty').addEventListener('click', () => {
      $('#honestyBanner').classList.add('hidden');
      try {
        localStorage.setItem('retroScanHonestyDismissed', '1');
      } catch (_) {}
    });
  }

  /* —— Wire UI —— */
  function wire() {
    $('#btnCapture').addEventListener('click', captureStill);
    $('#btnRetryCam').addEventListener('click', startCamera);
    $('#btnGallery').addEventListener('click', () => {
      renderGallery();
      openPanel('#panelGallery');
    });
    $('#btnCloseGallery').addEventListener('click', closePanels);
    $('#btnClearGallery').addEventListener('click', clearGallery);
    $('#btnTips').addEventListener('click', () => openPanel('#panelTips'));
    $('#btnCloseTips').addEventListener('click', closePanels);
    $('#btnHonesty').addEventListener('click', () => {
      $('#honestyBanner').classList.remove('hidden');
      openPanel('#panelTips');
    });
    $('#btnExport').addEventListener('click', () => {
      setExportStatus('');
      openPanel('#panelExport');
    });
    $('#btnCloseExport').addEventListener('click', closePanels);
    $('#btnShare').addEventListener('click', shareZip);
    $('#btnDownload').addEventListener('click', downloadZip);

    // Space / volume-ish: keyboard shutter for desktop testing
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat && !document.querySelector('.panel.open')) {
        e.preventDefault();
        captureStill();
      }
    });
  }

  /* —— Service worker —— */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW', e));
  }

  /* —— Boot —— */
  function boot() {
    renderRings();
    renderProgress();
    updateRingChip();
    updateGalleryChrome();
    initHonesty();
    wire();
    registerSW();
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      startCamera();
    } else {
      $('#cameraErrorMsg').textContent =
        'This browser has no camera API. Use Safari on iPhone over HTTPS.';
      $('#cameraError').classList.add('show');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
