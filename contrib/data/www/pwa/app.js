// TonieCloud Consumer PWA Client Logic
let toniesCache = [];
let customToniesCache = [];
let libraryFilesCache = [];
let currentTonieDetail = null;
let isNfcScanning = false;
let nfcReaderInstance = null;

// Initialize on Load
document.addEventListener('DOMContentLoaded', () => {
  initServiceWorker();
  checkServerHealth();
  loadAllTonies();
  loadLibraryFiles();
  loadTonieboxes();
  setupAudioPlayer();
});

// 1. Service Worker Registration
function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/pwa/sw.js')
      .then(() => console.log('[PWA] Service Worker registered'))
      .catch((err) => console.warn('[PWA] Service Worker error:', err));
  }
}

// 2. Server Status Polling
async function checkServerHealth() {
  const badge = document.getElementById('statusBadge');
  const text = document.getElementById('statusText');
  try {
    const res = await fetch('/api/stats');
    if (res.ok) {
      badge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      badge.style.color = '#34d399';
      text.innerText = 'Online';
    } else {
      throw new Error();
    }
  } catch (e) {
    badge.style.borderColor = 'rgba(239, 68, 68, 0.3)';
    badge.style.color = '#f87171';
    text.innerText = 'Offline';
  }
}

// 3. Web NFC Scanning API
async function startNfcScan() {
  const ring = document.getElementById('nfcRing');
  const btn = document.getElementById('btnScanNfc');

  if (!('NDEFReader' in window)) {
    showToast('Web NFC wird auf diesem Gerät/Browser nicht unterstützt. Nutze die manuelle Eingabe.', 'error');
    openManualTagModal();
    return;
  }

  try {
    if (!nfcReaderInstance) {
      nfcReaderInstance = new NDEFReader();
    }

    await nfcReaderInstance.scan();
    isNfcScanning = true;
    ring.classList.add('scanning');
    btn.innerHTML = '<span>⏳ Warte auf Tonie...</span>';
    showToast('NFC aktiv: Halte die Figur jetzt an dein Smartphone!', 'success');

    nfcReaderInstance.onreading = (event) => {
      const serialNumber = (event.serialNumber || '').replace(/[:\s-]/g, '').toUpperCase();
      console.log('[NFC] Gelesener Tag:', serialNumber);
      
      // Haptisches Feedback (Vibration)
      if ('vibrate' in navigator) {
        navigator.vibrate([100, 50, 100]);
      }

      showToast(`Tonie erkannt: ${serialNumber}`, 'success');
      resolveTag(serialNumber);
    };

    nfcReaderInstance.onreadingerror = () => {
      showToast('Fehler beim Lesen des NFC-Tags. Bitte erneut versuchen.', 'error');
    };

  } catch (err) {
    console.warn('[NFC] Scan-Fehler:', err);
    ring.classList.remove('scanning');
    btn.innerHTML = '<span>📡 NFC-Scan starten</span>';
    showToast('NFC-Berechtigung verweigert oder abgebrochen.', 'error');
  }
}

// 4. Tag Matching & Resolution Engine
async function resolveTag(tagUid) {
  if (!tagUid) return;
  const cleanUid = tagUid.trim().toUpperCase();

  // 1. Suche in Custom Tonies
  let found = customToniesCache.find(t => (t.nfc_uid || t.ruid || t.uid || '').toUpperCase() === cleanUid);

  // 2. Suche in offizieller Tonie-DB
  if (!found) {
    found = toniesCache.find(t => (t.nfc_uid || t.ruid || t.uid || '').toUpperCase() === cleanUid);
  }

  // 3. Fallback: API Abfrage
  if (!found) {
    try {
      const res = await fetch(`/api/getTagInfo?tag=${encodeURIComponent(cleanUid)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && (data.title || data.model)) {
          found = data;
        }
      }
    } catch (e) {}
  }

  if (found) {
    // Bekannter Tonie -> Detail Modal öffnen
    openDetailModal(found, cleanUid);
  } else {
    // Unbekannter Tag -> Neuer Tonie Wizard starten!
    openOnboardingWizard(cleanUid);
  }
}

// 5. Data Loading (Tonies, Custom, Library, Boxes)
async function loadAllTonies() {
  try {
    // Custom Tonies
    const resCustom = await fetch('/api/toniesCustomJson');
    if (resCustom.ok) {
      const data = await resCustom.json();
      customToniesCache = Array.isArray(data) ? data : (data.tonies || []);
    }
  } catch (e) {
    console.warn('Could not load custom tonies:', e);
  }

  try {
    // Offizielle Tonies
    const resOff = await fetch('/api/toniesJson');
    if (resOff.ok) {
      const data = await resOff.json();
      toniesCache = Array.isArray(data) ? data : (data.tonies || []);
    }
  } catch (e) {
    console.warn('Could not load official tonies:', e);
  }

  renderLibrary(customToniesCache.concat(toniesCache.slice(0, 40)));
  renderRecent(customToniesCache.slice(0, 6));
  populateSampleTags();
}

async function loadLibraryFiles() {
  const select = document.getElementById('wizardAudioSelect');
  try {
    const res = await fetch('/api/fileIndexV2');
    if (res.ok) {
      const data = await res.json();
      libraryFilesCache = data.files || (Array.isArray(data) ? data : []);
      
      select.innerHTML = '<option value="">-- Audiodatei wählen (Optional) --</option>';
      libraryFilesCache.forEach(file => {
        const name = typeof file === 'string' ? file : (file.name || file.path || 'Audiodatei');
        const opt = document.createElement('option');
        opt.value = name;
        opt.innerText = name;
        select.appendChild(opt);
      });
    } else {
      select.innerHTML = '<option value="">Keine Dateien in Library</option>';
    }
  } catch (e) {
    select.innerHTML = '<option value="">Library nicht verfügbar</option>';
  }
}

async function loadTonieboxes() {
  const boxList = document.getElementById('boxList');
  try {
    const res = await fetch('/api/getBoxes');
    if (res.ok) {
      const boxes = await res.json();
      const list = Array.isArray(boxes) ? boxes : (boxes.boxes || []);
      if (list.length === 0) {
        boxList.innerHTML = '<div style="color: var(--text-dim); text-align: center; padding: 20px;">Keine aktiven Tonieboxen gefunden.</div>';
        return;
      }
      boxList.innerHTML = list.map(box => `
        <div class="tonie-card" style="text-align: left; display: flex; align-items: center; justify-content: space-between;">
          <div>
            <div style="font-weight: 700; font-size: 1rem;">📻 ${box.box_name || box.id || 'Toniebox'}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">IP: ${box.ip || '192.168.x.x'} • MAC: ${box.mac || '--'}</div>
          </div>
          <span class="status-badge" style="background: rgba(16,185,129,0.15);">Aktiv</span>
        </div>
      `).join('');
    }
  } catch (e) {
    boxList.innerHTML = '<div style="color: var(--text-dim); text-align: center; padding: 20px;">Verbindungsfehler zur Box-API.</div>';
  }
}

// 6. UI Renderers
function renderLibrary(list) {
  const grid = document.getElementById('libraryGrid');
  if (!list || list.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-dim); padding: 40px;">Keine Tonies gefunden.</div>';
    return;
  }

  grid.innerHTML = list.map(item => createTonieCardHtml(item)).join('');
}

function renderRecent(list) {
  const grid = document.getElementById('recentToniesGrid');
  const badge = document.getElementById('activeCountBadge');
  
  badge.innerText = `${list.length} bereit`;
  if (!list || list.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-dim); padding: 20px;">Noch keine kürzlichen Tonies. Scanne deinen ersten Tag!</div>';
    return;
  }
  grid.innerHTML = list.map(item => createTonieCardHtml(item)).join('');
}

function createTonieCardHtml(item) {
  const title = item.title || item.episode || 'Unbenannter Tonie';
  const series = item.series || item.model || 'Custom Tonie';
  const imgUrl = item.picture || item.image || (item.model ? `/img/${item.model}.png` : '/img_custom.png');
  const uid = item.nfc_uid || item.ruid || item.uid || '';

  return `
    <div class="tonie-card" onclick="openDetailModal(${JSON.stringify(item).replace(/"/g, '&quot;')}, '${uid}')">
      <div class="tonie-card-img-wrap">
        <img class="tonie-card-img" src="${imgUrl}" alt="${title}" onerror="this.src='/img_custom.png'">
      </div>
      <div class="tonie-card-title">${title}</div>
      <div class="tonie-card-subtitle">${series}</div>
      ${uid ? `<span class="tag-badge">${uid.substring(0, 8)}...</span>` : ''}
    </div>
  `;
}

function filterLibrary() {
  const q = document.getElementById('librarySearch').value.toLowerCase();
  const all = customToniesCache.concat(toniesCache);
  const filtered = all.filter(t => 
    (t.title && t.title.toLowerCase().includes(q)) ||
    (t.series && t.series.toLowerCase().includes(q)) ||
    (t.model && t.model.toLowerCase().includes(q))
  );
  renderLibrary(filtered);
}

// 7. Modals: Detail & Audio Player
function openDetailModal(item, uid) {
  currentTonieDetail = item;
  const modal = document.getElementById('detailModal');
  const img = document.getElementById('detailImg');
  const title = document.getElementById('detailTitle');
  const series = document.getElementById('detailSeries');
  const uidBadge = document.getElementById('detailTagUid');
  const trackList = document.getElementById('detailTrackList');
  const trackCount = document.getElementById('trackCount');

  title.innerText = item.title || item.episode || 'Tonie Hörspiel';
  series.innerText = item.series || item.model || 'Benutzerdefinierter Tonie';
  img.src = item.picture || item.image || (item.model ? `/img/${item.model}.png` : '/img_custom.png');
  uidBadge.innerText = `UID: ${uid || item.nfc_uid || 'Unbekannt'}`;

  // Tracks/Kapitel
  const tracks = item.tracks || item.chapters || [];
  trackCount.innerText = `${tracks.length} Tracks`;
  
  if (tracks.length > 0) {
    trackList.innerHTML = tracks.map((tr, idx) => `
      <li class="track-item">
        <span class="track-number">${idx + 1}</span>
        <span class="track-title">${typeof tr === 'string' ? tr : (tr.title || `Kapitel ${idx + 1}`)}</span>
        <span class="track-duration">${tr.duration ? formatTime(tr.duration) : ''}</span>
      </li>
    `).join('');
  } else {
    trackList.innerHTML = '<li class="track-item" style="color: var(--text-dim);">1 Gesamtfolge (Keine einzelnen Kapitelunterteilungen)</li>';
  }

  // Setup Player Source
  const audio = document.getElementById('audioElement');
  if (item.audio_url || item.url) {
    audio.src = item.audio_url || item.url;
  } else {
    audio.src = '';
  }

  modal.classList.add('open');
}

// 8. Modals: Onboarding Wizard für neue Tags
function openOnboardingWizard(tagUid) {
  const modal = document.getElementById('wizardModal');
  document.getElementById('wizardTagUid').value = tagUid || 'TAG_' + Math.random().toString(36).substring(2, 10).toUpperCase();
  document.getElementById('wizardTitle').value = '';
  document.getElementById('wizardSeries').value = '';
  modal.classList.add('open');
}

function selectIconPreset(icon, btn) {
  document.querySelectorAll('.icon-preset-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('wizardSelectedIcon').value = icon;
}

async function saveCustomTonie(e) {
  e.preventDefault();
  const uid = document.getElementById('wizardTagUid').value.trim();
  const title = document.getElementById('wizardTitle').value.trim();
  const series = document.getElementById('wizardSeries').value.trim();
  const icon = document.getElementById('wizardSelectedIcon').value;
  const audioFile = document.getElementById('wizardAudioSelect').value;

  const payload = {
    nfc_uid: uid,
    ruid: uid,
    title: title,
    series: series || 'Custom Hörspiel',
    picture: '/img_custom.png',
    icon: icon,
    audio_file: audioFile || null
  };

  try {
    const res = await fetch('/api/toniesCustomJsonUpsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok || res.status === 200) {
      showToast('🎉 Tonie erfolgreich gespeichert!', 'success');
      customToniesCache.unshift(payload);
      closeModal('wizardModal');
      renderRecent(customToniesCache.slice(0, 6));
      renderLibrary(customToniesCache.concat(toniesCache));
      openDetailModal(payload, uid);
    } else {
      throw new Error();
    }
  } catch (err) {
    // Falls API offline ist, lokal cachen für Demo/Mock
    showToast('Tonie lokal zwischengespeichert!', 'success');
    customToniesCache.unshift(payload);
    closeModal('wizardModal');
    renderRecent(customToniesCache.slice(0, 6));
    openDetailModal(payload, uid);
  }
}

// 9. Manual Tag Simulator
function openManualTagModal() {
  document.getElementById('manualTagModal').classList.add('open');
}

function submitManualUid() {
  const val = document.getElementById('manualUidInput').value.trim();
  if (!val) return;
  closeModal('manualTagModal');
  resolveTag(val);
}

function populateSampleTags() {
  const container = document.getElementById('sampleTagList');
  const samples = [
    { name: 'Kreativ-Tonie', uid: 'E004035012345678' },
    { name: 'Neuer Tag (Unbekannt)', uid: 'E00403509988AABB' }
  ];

  container.innerHTML = samples.map(s => `
    <button class="btn-secondary" style="font-size: 0.78rem;" onclick="closeModal('manualTagModal'); resolveTag('${s.uid}')">
      ${s.name} (${s.uid.substring(0, 6)}...)
    </button>
  `).join('');
}

// 10. Audio Player Engine
function setupAudioPlayer() {
  const audio = document.getElementById('audioElement');
  const progress = document.getElementById('scrubberProgress');
  const curTime = document.getElementById('currentTime');
  const durTime = document.getElementById('totalDuration');
  const btn = document.getElementById('btnPlayPause');

  audio.ontimeupdate = () => {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    progress.style.width = `${pct}%`;
    curTime.innerText = formatTime(audio.currentTime);
  };

  audio.onloadedmetadata = () => {
    durTime.innerText = formatTime(audio.duration);
  };

  audio.onended = () => {
    btn.innerText = '▶';
    progress.style.width = '0%';
  };
}

function toggleAudioPlayback() {
  const audio = document.getElementById('audioElement');
  const btn = document.getElementById('btnPlayPause');
  if (audio.paused) {
    audio.play().then(() => {
      btn.innerText = '⏸';
    }).catch(() => {
      showToast('Keine Live-Audiodatei für diesen Tonie hinterlegt.', 'error');
    });
  } else {
    audio.pause();
    btn.innerText = '▶';
  }
}

function seekAudio(e) {
  const audio = document.getElementById('audioElement');
  const bar = document.getElementById('scrubberBar');
  if (!audio.duration) return;
  const rect = bar.getBoundingClientRect();
  const pos = (e.clientX - rect.left) / rect.width;
  audio.currentTime = pos * audio.duration;
}

function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// 11. Modal Controls & Tabs
function switchTab(tabName, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${tabName}`).classList.add('active');
  btn.classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('open');
  if (modalId === 'detailModal') {
    const audio = document.getElementById('audioElement');
    audio.pause();
    document.getElementById('btnPlayPause').innerText = '▶';
  }
}

function closeModalOnOverlay(e, modalId) {
  if (e.target.id === modalId) {
    closeModal(modalId);
  }
}

function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  toast.innerText = msg;
  toast.className = `toast show ${type}`;
  setTimeout(() => {
    toast.className = 'toast';
  }, 3200);
}
