// TonieCloud Consumer PWA Client Logic
const USERS = {
  'Ivan19': {
    name: 'Ivan',
    avatar: '👦',
    box: 'Ivans Toniebox',
    household: 'ivan'
  },
  'Carla03': {
    name: 'Carla',
    avatar: '👧',
    box: 'Schwesters Toniebox',
    household: 'schwester'
  },
  'Joel09': {
    name: 'Joel',
    avatar: '🧒',
    box: 'Schwesters Toniebox',
    household: 'schwester'
  }
};

let currentAuthKey = null;
let customToniesCache = [];
let libraryFilesCache = [];
let currentTonieDetail = null;
let currentPlaylist = [];
let currentTrackIndex = 0;
let isNfcScanning = false;
let nfcReaderInstance = null;
let selectedLoginKey = 'Ivan19';
let currentLibraryFilter = 'my'; // 'my' | 'shared' | 'all'
let storageSoftcapGB = parseFloat(localStorage.getItem('tonie_storage_softcap_gb')) || 25.0;
let storageStats = {
  totalUsedBytes: 0,
  maxBytes: 25 * 1024 * 1024 * 1024,
  percentUsed: 0,
  isWarning: false,
  isCritical: false,
  fileDetails: []
};
let isStorageFilesExpanded = false;

// Initialize on Load
document.addEventListener('DOMContentLoaded', () => {
  initServiceWorker();
  initAuthAndApp();
  setupAudioPlayer();
});

// 1. Service Worker Registration & Update Trigger
function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/pwa/sw.js?v=5')
      .then((reg) => {
        console.log('[PWA] Service Worker registriert:', reg.scope);
        reg.update();
      })
      .catch((err) => console.warn('[PWA] Service Worker Fehler:', err));

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        console.log('[PWA] Neuer Service Worker aktiv. Aktualisiere...');
        window.location.reload();
      }
    });
  }
}

// 2. Authentication & Login Screen Logic
function getStoredAuthKey() {
  const key = localStorage.getItem('tonie_auth_key');
  if (key && USERS[key]) {
    return key;
  }
  return null;
}

function initAuthAndApp() {
  const stored = getStoredAuthKey();
  if (stored) {
    currentAuthKey = stored;
    applyUserSession(stored);
    hideLoginScreen();
    startApp();
  } else {
    showLoginScreen();
  }
}

function showLoginScreen() {
  const screen = document.getElementById('loginScreen');
  screen.classList.remove('hidden');
  selectUserProfile('Ivan19', 'Ivan', 'Ivans Toniebox');
  checkBiometricAvailability();
}

function hideLoginScreen() {
  const screen = document.getElementById('loginScreen');
  screen.classList.add('hidden');
}

function selectUserProfile(key, name, boxName) {
  selectedLoginKey = key;
  document.querySelectorAll('.profile-card').forEach(c => c.classList.remove('active'));
  
  if (key === 'Ivan19') document.getElementById('profileIvan')?.classList.add('active');
  if (key === 'Carla03') document.getElementById('profileCarla')?.classList.add('active');
  if (key === 'Joel09') document.getElementById('profileJoel')?.classList.add('active');

  const input = document.getElementById('loginPasswordInput');
  const err = document.getElementById('loginErrorMsg');
  if (input) {
    input.placeholder = `Passwort für ${USERS[key].name} eingeben...`;
    input.value = '';
    setTimeout(() => input.focus(), 100);
  }
  if (err) err.style.display = 'none';
}

function handleLoginSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('loginPasswordInput');
  const val = (input.value || '').trim();
  const err = document.getElementById('loginErrorMsg');

  if (val === selectedLoginKey || USERS[val]) {
    const validKey = USERS[val] ? val : selectedLoginKey;
    localStorage.setItem('tonie_auth_key', validKey);
    currentAuthKey = validKey;
    applyUserSession(validKey);
    hideLoginScreen();
    showToast(`🎉 Willkommen zurück, ${USERS[validKey].name}!`, 'success');
    startApp();
  } else {
    err.innerText = `Falsches Passwort für ${USERS[selectedLoginKey].name}. Bitte erneut versuchen.`;
    err.style.display = 'block';
    input.select();
  }
}

function applyUserSession(key) {
  const user = USERS[key];
  if (!user) return;

  const avatar = document.getElementById('userProfileAvatar');
  const name = document.getElementById('userProfileName');
  const box = document.getElementById('userProfileBox');

  if (avatar) avatar.innerText = user.avatar;
  if (name) name.innerText = user.name;
  if (box) box.innerText = `(${user.box})`;

  const ownerSelect = document.getElementById('wizardOwnerSelect');
  if (ownerSelect) ownerSelect.value = user.name;
}

function handleAccountMenu() {
  const user = USERS[currentAuthKey];
  if (!user) return;

  const isBioEnrolled = localStorage.getItem('tonie_bio_enrolled') === 'true';

  const choice = confirm(
    `Angemeldet als: ${user.avatar} ${user.name}\n` +
    `Zugeordnete Box: ${user.box}\n\n` +
    `Möchtest du dich abmelden / das Profil wechseln?\n` +
    `[OK] = Abmelden | [Abbrechen] = Weiterarbeiten`
  );

  if (choice) {
    localStorage.removeItem('tonie_auth_key');
    currentAuthKey = null;
    showToast('Erfolgreich abgemeldet.', 'info');
    showLoginScreen();
  } else if (!isBioEnrolled && window.PublicKeyCredential) {
    if (confirm('Möchtest du für schnellen Login den Fingerabdruck / FaceID für dieses Gerät aktivieren?')) {
      registerBiometrics();
    }
  }
}

// 3. Biometrie (WebAuthn / Fingerabdruck / TouchID / FaceID)
async function checkBiometricAvailability() {
  const btn = document.getElementById('btnBiometricLogin');
  if (!window.PublicKeyCredential || !btn) return;

  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    const enrolled = localStorage.getItem('tonie_bio_enrolled') === 'true';
    btn.style.display = (available && enrolled) ? 'flex' : 'none';
  } catch (e) {
    btn.style.display = 'none';
  }
}

async function registerBiometrics() {
  if (!window.PublicKeyCredential) {
    showToast('Biometrie wird von diesem Browser nicht unterstützt.', 'error');
    return;
  }
  const user = USERS[currentAuthKey];
  if (!user) return;

  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: challenge,
        rp: { name: 'TonieCloud', id: window.location.hostname },
        user: {
          id: new TextEncoder().encode(user.name),
          name: user.name,
          displayName: `${user.name} (${user.box})`
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },
          { alg: -257, type: 'public-key' }
        ],
        authenticatorSelection: { userVerification: 'preferred' },
        timeout: 60000
      }
    });

    if (credential) {
      localStorage.setItem('tonie_bio_enrolled', 'true');
      localStorage.setItem('tonie_bio_key', currentAuthKey);
      showToast('🎉 Fingerabdruck erfolgreich eingerichtet!', 'success');
    }
  } catch (err) {
    console.warn('[WebAuthn] Registrierung abgebrochen/Fehler:', err);
    showToast('Biometrie-Einrichtung abgebrochen.', 'info');
  }
}

async function loginWithBiometrics() {
  if (!window.PublicKeyCredential) return;
  const enrolledKey = localStorage.getItem('tonie_bio_key') || 'Ivan19';

  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challenge,
        rpId: window.location.hostname,
        userVerification: 'preferred',
        timeout: 60000
      }
    });

    if (assertion) {
      localStorage.setItem('tonie_auth_key', enrolledKey);
      currentAuthKey = enrolledKey;
      applyUserSession(enrolledKey);
      hideLoginScreen();
      showToast(`🎉 Per Fingerabdruck angemeldet als ${USERS[enrolledKey].name}!`, 'success');
      startApp();
    }
  } catch (err) {
    console.warn('[WebAuthn] Login fehlgeschlagen:', err);
    showToast('Fingerabdruck nicht erkannt. Bitte Passwort nutzen.', 'error');
  }
}

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.innerText = '🙈';
  } else {
    input.type = 'password';
    btn.innerText = '👁️';
  }
}

// 4. App Start & Data Loading
async function startApp() {
  checkServerHealth();
  await loadRealTonies();
  await loadLibraryFiles();
  await updateStorageStats();
  loadTonieboxes();
}

async function checkServerHealth() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) throw new Error();
  } catch (e) {
    showToast('Verbindung zur TeddyCloud unterbrochen.', 'error');
  }
}

async function loadRealTonies() {
  try {
    const res = await fetch('/api/toniesCustomJson');
    if (res.ok) {
      const data = await res.json();
      customToniesCache = Array.isArray(data) ? data : (data.tonies || []);
    }
  } catch (e) {
    console.warn('Could not load toniesCustomJson:', e);
  }

  renderLibrary();
  renderRecent();
  populateSampleTags();
}

// 5. Library Rendering & Account Trennung mit Chip Sharing
function setLibraryFilter(filterType) {
  currentLibraryFilter = filterType;
  document.getElementById('pillMyTonies')?.classList.toggle('active', filterType === 'my');
  document.getElementById('pillSharedTonies')?.classList.toggle('active', filterType === 'shared');
  document.getElementById('pillAllTonies')?.classList.toggle('active', filterType === 'all');
  renderLibrary();
}

function filterLibrary() {
  renderLibrary();
}

function renderLibrary() {
  const grid = document.getElementById('libraryGrid');
  const search = (document.getElementById('librarySearch')?.value || '').toLowerCase();
  const currentUser = USERS[currentAuthKey]?.name || 'Ivan';
  const currentHousehold = USERS[currentAuthKey]?.household || 'ivan';

  const myTonies = customToniesCache.filter(t => (t.owner === currentUser) || (t.household === currentHousehold));
  const sharedTonies = customToniesCache.filter(t => t.owner && t.owner !== currentUser && t.household !== currentHousehold);

  const countMy = document.getElementById('badgeCountMy');
  const countShared = document.getElementById('badgeCountShared');
  const countAll = document.getElementById('badgeCountAll');
  if (countMy) countMy.innerText = `(${myTonies.length})`;
  if (countShared) countShared.innerText = `(${sharedTonies.length})`;
  if (countAll) countAll.innerText = `(${customToniesCache.length})`;

  let listToRender = customToniesCache;
  if (currentLibraryFilter === 'my') {
    listToRender = myTonies;
  } else if (currentLibraryFilter === 'shared') {
    listToRender = sharedTonies;
  }

  if (search) {
    listToRender = listToRender.filter(t =>
      (t.title && t.title.toLowerCase().includes(search)) ||
      (t.series && t.series.toLowerCase().includes(search)) ||
      (t.owner && t.owner.toLowerCase().includes(search)) ||
      (t.nfc_uid && t.nfc_uid.toLowerCase().includes(search))
    );
  }

  if (!listToRender || listToRender.length === 0) {
    const emptyMsg = currentLibraryFilter === 'my'
      ? `Noch keine Tonies für <strong>${currentUser}</strong> angelegt.<br>Scanne eine Figur oder tippe auf "+ Neuer Tonie"!`
      : currentLibraryFilter === 'shared'
      ? `Keine geteilten Tonies von der Familie vorhanden.`
      : `Noch keine Tonies in der Datenbank.<br>Scanne deinen ersten Chip per NFC!`;

    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🧸</div>
        <div class="empty-state-title">Keine Tonies gefunden</div>
        <div class="empty-state-text">${emptyMsg}</div>
        <button class="btn-primary" onclick="openOnboardingWizard('')">
          <span>+ Ersten Tonie hinzufügen</span>
        </button>
      </div>
    `;
    return;
  }

  grid.innerHTML = listToRender.map(item => createTonieCardHtml(item)).join('');
}

function renderRecent() {
  const grid = document.getElementById('recentToniesGrid');
  const badge = document.getElementById('activeCountBadge');
  const list = customToniesCache.slice(0, 6);
  badge.innerText = `${list.length} bereit`;

  if (!list || list.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="padding: 24px 16px;">
        <div style="font-size: 32px; margin-bottom: 8px;">📲</div>
        <div class="empty-state-title" style="font-size: 1rem;">Noch kein Tonie gescannt</div>
        <div class="empty-state-text" style="font-size: 0.8rem; margin-bottom: 12px;">
          Halte einen Tonie an dein Smartphone, um ihn abzuspielen.
        </div>
      </div>
    `;
    return;
  }
  grid.innerHTML = list.map(item => createTonieCardHtml(item)).join('');
}

function createTonieCardHtml(item) {
  const title = item.title || item.episode || 'Unbenannter Tonie';
  const series = item.series || item.model || 'Benutzerdefiniert';
  const imgUrl = item.picture || item.image || (item.model ? `/img/${item.model}.png` : '/img_custom.png');
  const uid = item.nfc_uid || item.ruid || item.uid || '';
  const owner = item.owner || 'Gemeinsam';
  const ownerAvatar = owner === 'Ivan' ? '👦' : owner === 'Carla' ? '👧' : owner === 'Joel' ? '🧒' : '🌟';
  const ownerClass = owner.toLowerCase();
  const trackCount = Array.isArray(item.tracks) ? item.tracks.length : (item.audio_file ? 1 : 0);

  return `
    <div class="tonie-card" onclick="openDetailModal(${JSON.stringify(item).replace(/"/g, '&quot;')}, '${uid}')">
      <div class="tonie-card-img-wrap">
        <img class="tonie-card-img" src="${imgUrl}" alt="${title}" onerror="this.src='/img_custom.png'">
      </div>
      <div class="tonie-card-title">${title}</div>
      <div class="tonie-card-subtitle">${series}</div>
      <div style="display: flex; gap: 4px; justify-content: center; align-items: center; flex-wrap: wrap;">
        <span class="owner-badge ${ownerClass}">${ownerAvatar} ${owner}</span>
        ${trackCount > 1 ? `<span class="tag-badge">🎵 ${trackCount} Tracks</span>` : ''}
        ${uid ? `<span class="tag-badge">${uid.substring(0, 8)}...</span>` : ''}
      </div>
    </div>
  `;
}

// 6. Web NFC Scanner
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
      
      if ('vibrate' in navigator) navigator.vibrate([100, 50, 100]);

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

async function resolveTag(tagUid) {
  if (!tagUid) return;
  const cleanUid = tagUid.trim().toUpperCase();

  let found = customToniesCache.find(t => (t.nfc_uid || t.ruid || t.uid || '').toUpperCase() === cleanUid);

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
    openDetailModal(found, cleanUid);
  } else {
    openOnboardingWizard(cleanUid);
  }
}

// 7. Cover-Bild Upload (Eigenes Bild ohne Icon)
async function handleCoverImageUpload(input) {
  const file = input.files?.[0];
  if (!file) return;

  if (isStorageLimitReached()) {
    showToast(`⛔ Upload blockiert: Speicherlimit von ${storageSoftcapGB.toFixed(1)} GB ist erreicht!`, 'error');
    input.value = '';
    return;
  }

  const btn = document.getElementById('btnUploadCover');
  btn.classList.add('uploading');
  btn.innerHTML = '<span>⏳ Lade Bild hoch...</span>';

  const formData = new FormData();
  formData.append('file', file, file.name);

  try {
    const res = await fetch('/api/fileUpload?special=custom_img&path=/', {
      method: 'POST',
      headers: {
        'X-Tonie-Key': currentAuthKey
      },
      body: formData
    });

    if (res.ok) {
      const imgUrl = `/custom_img/${encodeURIComponent(file.name)}`;
      document.getElementById('wizardCustomCoverUrl').value = imgUrl;

      // Preview anzeigen
      const card = document.getElementById('wizardCoverPreviewCard');
      const img = document.getElementById('wizardCoverPreviewImg');
      img.src = imgUrl;
      card.style.display = 'block';

      // Emoji active status entfernen
      document.querySelectorAll('.icon-preset-btn').forEach(b => b.classList.remove('active'));

      showToast('📸 Coverbild erfolgreich hochgeladen!', 'success');
      await updateStorageStats();
    } else {
      throw new Error(`Status ${res.status}`);
    }
  } catch (err) {
    console.error('Cover upload failed:', err);
    showToast('Fehler beim Hochladen des Coverbilds.', 'error');
  } finally {
    btn.classList.remove('uploading');
    btn.innerHTML = '<span>📷 Eigenes Coverbild hochladen</span>';
    input.value = '';
  }
}

function removeCustomCoverImage() {
  document.getElementById('wizardCustomCoverUrl').value = '';
  document.getElementById('wizardCoverPreviewCard').style.display = 'none';
  // Standard-Emoji wieder aktivieren
  selectIconPreset('🧸', document.querySelector('.icon-preset-btn'));
}

// 8. Direkt-Upload von Audiodateien in die Library (Ohne TAF-Converter!)
async function handleAudioFilesUpload(input) {
  const files = Array.from(input.files || []);
  if (files.length === 0) return;

  if (isStorageLimitReached()) {
    showToast(`⛔ Upload blockiert: Speicherlimit von ${storageSoftcapGB.toFixed(1)} GB ist erreicht! Bitte lösche zuerst Dateien in der Library.`, 'error');
    input.value = '';
    return;
  }

  const btn = document.getElementById('btnUploadAudioFiles');
  btn.classList.add('uploading');
  btn.innerHTML = `<span>⏳ Lade ${files.length} Datei(en) in Library...</span>`;

  let uploadedCount = 0;

  for (const file of files) {
    const formData = new FormData();
    formData.append('file', file, file.name);

    try {
      const res = await fetch('/api/fileUpload?special=library&path=/', {
        method: 'POST',
        headers: {
          'X-Tonie-Key': currentAuthKey
        },
        body: formData
      });

      if (res.ok) {
        uploadedCount++;
        // Automatisch als Track in die Playlist aufnehmen!
        const trackTitle = file.name.replace(/\.[^/.]+$/, '').replace(/^[\d\s-_]+/, '');
        addPlaylistRow(trackTitle || file.name, file.name);
      }
    } catch (err) {
      console.warn('Upload error for', file.name, err);
    }
  }

  // Library-Cache und Speicherstatistiken neu laden
  await loadLibraryFiles();
  await updateStorageStats();

  btn.classList.remove('uploading');
  btn.innerHTML = '<span>📁 Audiodateien direkt hochladen (Mehrfachauswahl)</span>';
  input.value = '';

  if (uploadedCount > 0) {
    showToast(`🎉 ${uploadedCount} Datei(en) direkt in Library geladen & als Tracks eingetragen!`, 'success');
  } else {
    showToast('Upload fehlgeschlagen. Bitte erneut versuchen.', 'error');
  }
}

// 9. Playlist & Kapitel Management im Wizard
function addPlaylistRow(title = '', selectedFile = '') {
  const list = document.getElementById('wizardPlaylistList');
  const count = list.children.length + 1;

  const row = document.createElement('div');
  row.className = 'playlist-track-row';
  row.dataset.trackIndex = count;

  let fileOptions = '<option value="">-- Datei wählen --</option>';
  libraryFilesCache.forEach(file => {
    const name = typeof file === 'string' ? file : (file.name || file.path || '');
    const isSel = (name === selectedFile) ? 'selected' : '';
    fileOptions += `<option value="${name}" ${isSel}>${name}</option>`;
  });

  row.innerHTML = `
    <span class="playlist-track-num">${count}</span>
    <input type="text" class="form-input track-title-input" placeholder="Kapitel / Song ${count}" value="${title}" style="padding: 6px 10px; font-size: 0.85rem;">
    <select class="form-input track-file-select" style="padding: 6px 8px; font-size: 0.82rem; cursor: pointer;">
      ${fileOptions}
    </select>
    <button type="button" class="btn-track-delete" onclick="removePlaylistRow(this)" title="Track löschen">🗑️</button>
  `;

  list.appendChild(row);
  updateWizardTrackCount();
}

function removePlaylistRow(btn) {
  const row = btn.closest('.playlist-track-row');
  row.remove();
  // Nummern aktualisieren
  const list = document.getElementById('wizardPlaylistList');
  Array.from(list.children).forEach((r, idx) => {
    r.querySelector('.playlist-track-num').innerText = idx + 1;
    r.dataset.trackIndex = idx + 1;
  });
  updateWizardTrackCount();
}

function updateWizardTrackCount() {
  const count = document.getElementById('wizardPlaylistList').children.length;
  const badge = document.getElementById('wizardTrackCountBadge');
  if (badge) badge.innerText = `${count} Track${count === 1 ? '' : 's'}`;
}

function getWizardPlaylistData() {
  const rows = Array.from(document.getElementById('wizardPlaylistList').children);
  return rows.map((r, idx) => {
    const titleInput = r.querySelector('.track-title-input');
    const fileSelect = r.querySelector('.track-file-select');
    return {
      number: idx + 1,
      title: titleInput?.value.trim() || `Kapitel ${idx + 1}`,
      file: fileSelect?.value || ''
    };
  });
}

// 10. Onboarding Wizard öffnen & befüllen
function openOnboardingWizard(tagUid, initialTitle = '', initialSeries = '', initialIcon = '🧸', initialAudio = '', initialOwner = '', existingTracks = null, existingPicture = '') {
  const modal = document.getElementById('wizardModal');
  const currentUser = USERS[currentAuthKey]?.name || 'Ivan';

  document.getElementById('wizardTagUid').value = tagUid || 'TAG_' + Math.random().toString(36).substring(2, 10).toUpperCase();
  document.getElementById('wizardTitle').value = initialTitle;
  document.getElementById('wizardSeries').value = initialSeries;
  document.getElementById('wizardOwnerSelect').value = initialOwner || currentUser;

  // Cover Image vs Emoji
  const customCoverUrl = document.getElementById('wizardCustomCoverUrl');
  const previewCard = document.getElementById('wizardCoverPreviewCard');
  const previewImg = document.getElementById('wizardCoverPreviewImg');

  if (existingPicture && existingPicture.includes('/custom_img/')) {
    customCoverUrl.value = existingPicture;
    previewImg.src = existingPicture;
    previewCard.style.display = 'block';
    document.querySelectorAll('.icon-preset-btn').forEach(b => b.classList.remove('active'));
  } else {
    removeCustomCoverImage();
    selectIconPreset(initialIcon || '🧸', document.querySelector('.icon-preset-btn'));
  }

  // Playlist befüllen
  const playlistContainer = document.getElementById('wizardPlaylistList');
  playlistContainer.innerHTML = '';

  if (Array.isArray(existingTracks) && existingTracks.length > 0) {
    existingTracks.forEach(tr => {
      const title = typeof tr === 'string' ? tr : (tr.title || '');
      const file = typeof tr === 'object' ? (tr.file || '') : '';
      addPlaylistRow(title, file);
    });
  } else if (initialAudio) {
    addPlaylistRow(initialTitle || 'Hörspiel', initialAudio);
  } else {
    // Standardmäßig 1 leere Zeile anbieten
    addPlaylistRow('', '');
  }

  modal.classList.add('open');
}

function selectIconPreset(icon, btn) {
  document.querySelectorAll('.icon-preset-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('wizardSelectedIcon').value = icon;
  document.getElementById('wizardCustomCoverUrl').value = '';
  document.getElementById('wizardCoverPreviewCard').style.display = 'none';
}

async function saveCustomTonie(e) {
  e.preventDefault();
  if (!currentAuthKey) {
    showLoginScreen();
    return;
  }

  const uid = document.getElementById('wizardTagUid').value.trim();
  const title = document.getElementById('wizardTitle').value.trim();
  const series = document.getElementById('wizardSeries').value.trim();
  const icon = document.getElementById('wizardSelectedIcon').value;
  const customCover = document.getElementById('wizardCustomCoverUrl').value;
  const owner = document.getElementById('wizardOwnerSelect').value || USERS[currentAuthKey].name;
  const box = owner === 'Ivan' ? 'Ivans Toniebox' : 'Schwesters Toniebox';
  const household = owner === 'Ivan' ? 'ivan' : 'schwester';

  // Playlist Daten
  const tracks = getWizardPlaylistData();
  const primaryAudioFile = tracks.find(t => t.file)?.file || null;

  const payload = {
    model: 'CUSTOM_' + uid,
    nfc_uid: uid,
    ruid: uid,
    title: title,
    series: series || 'Custom Tonie',
    owner: owner,
    box: box,
    household: household,
    shared: true,
    picture: customCover || '/img_custom.png',
    icon: icon,
    audio_file: primaryAudioFile,
    tracks: tracks
  };

  try {
    const res = await fetch('/api/toniesCustomJsonUpsert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tonie-Key': currentAuthKey
      },
      body: JSON.stringify(payload)
    });

    if (res.status === 403) {
      showToast('Sitzung abgelaufen. Bitte erneut anmelden.', 'error');
      showLoginScreen();
      return;
    }

    if (res.ok || res.status === 200) {
      showToast(`🎉 Tonie & Playlist gespeichert für ${owner}!`, 'success');
      
      const existingIdx = customToniesCache.findIndex(t => t.model === payload.model || t.nfc_uid === payload.nfc_uid);
      if (existingIdx >= 0) {
        customToniesCache[existingIdx] = payload;
      } else {
        customToniesCache.unshift(payload);
      }

      closeModal('wizardModal');
      renderRecent();
      renderLibrary();
      openDetailModal(payload, uid);
    } else {
      throw new Error();
    }
  } catch (err) {
    showToast('Tonie lokal zwischengespeichert!', 'success');
    customToniesCache.unshift(payload);
    closeModal('wizardModal');
    renderRecent();
    renderLibrary();
    openDetailModal(payload, uid);
  }
}

// 11. Tonie Detail Modal & Playlist Audio Player
function openDetailModal(item, uid) {
  currentTonieDetail = item;
  const modal = document.getElementById('detailModal');
  const img = document.getElementById('detailImg');
  const title = document.getElementById('detailTitle');
  const series = document.getElementById('detailSeries');
  const uidBadge = document.getElementById('detailTagUid');
  const ownerBadge = document.getElementById('detailOwnerBadge');
  const trackList = document.getElementById('detailTrackList');
  const trackCount = document.getElementById('trackCount');

  title.innerText = item.title || item.episode || 'Tonie Hörspiel';
  series.innerText = item.series || item.model || 'Benutzerdefinierter Tonie';
  img.src = item.picture || item.image || (item.model ? `/img/${item.model}.png` : '/img_custom.png');
  uidBadge.innerText = `UID: ${uid || item.nfc_uid || 'Unbekannt'}`;

  const owner = item.owner || 'Gemeinsam';
  const ownerAvatar = owner === 'Ivan' ? '👦' : owner === 'Carla' ? '👧' : owner === 'Joel' ? '🧒' : '🌟';
  ownerBadge.innerText = `${ownerAvatar} ${owner} (${item.box || 'Beide Boxen'})`;
  ownerBadge.className = `owner-badge ${owner.toLowerCase()}`;

  // Playlist aus Tonie-Daten laden
  currentPlaylist = Array.isArray(item.tracks) ? item.tracks : [];
  if (currentPlaylist.length === 0 && item.audio_file) {
    currentPlaylist = [{ number: 1, title: item.title || 'Hauptfolge', file: item.audio_file }];
  }

  trackCount.innerText = `${currentPlaylist.length} Tracks`;

  if (currentPlaylist.length > 0) {
    trackList.innerHTML = currentPlaylist.map((tr, idx) => `
      <li class="track-item ${idx === 0 ? 'active-track' : ''}" onclick="selectTrack(${idx})" id="trackItem_${idx}">
        <span class="track-number">${idx + 1}</span>
        <span class="track-title">${typeof tr === 'string' ? tr : (tr.title || `Kapitel ${idx + 1}`)}</span>
        <span class="track-duration">${tr.file ? '🎵' : ''}</span>
      </li>
    `).join('');
    // Ersten Track vorbereiten
    selectTrack(0, false);
  } else {
    trackList.innerHTML = '<li class="track-item" style="color: var(--text-dim);">Noch keine Tracks oder Audiodateien hinterlegt.</li>';
    document.getElementById('nowPlayingTrackTitle').innerText = 'Keine Audiodatei hinterlegt';
    const audio = document.getElementById('audioElement');
    audio.src = '';
  }

  modal.classList.add('open');
}

function selectTrack(index, autoPlay = true) {
  if (!currentPlaylist || currentPlaylist.length === 0) return;
  if (index < 0 || index >= currentPlaylist.length) return;

  currentTrackIndex = index;
  const track = currentPlaylist[index];
  const audio = document.getElementById('audioElement');
  const nowPlaying = document.getElementById('nowPlayingTrackTitle');
  const btn = document.getElementById('btnPlayPause');

  const title = typeof track === 'string' ? track : (track.title || `Kapitel ${index + 1}`);
  const fileName = typeof track === 'object' ? (track.file || '') : '';

  nowPlaying.innerText = `Track ${index + 1} von ${currentPlaylist.length}: ${title}`;

  // Aktiven Track visuell hervorheben
  document.querySelectorAll('.track-item').forEach((item, idx) => {
    item.classList.toggle('active-track', idx === index);
  });

  // Audio Quelle: Falls file angegeben -> /audio/<fileName>, sonst fallback
  if (fileName) {
    audio.src = `/audio/${encodeURIComponent(fileName)}`;
  } else if (currentTonieDetail?.audio_url) {
    audio.src = currentTonieDetail.audio_url;
  } else {
    audio.src = '';
  }

  if (autoPlay && audio.src) {
    audio.play().then(() => {
      btn.innerText = '⏸';
    }).catch(() => {
      btn.innerText = '▶';
    });
  } else {
    btn.innerText = '▶';
  }
}

function playNextTrack() {
  if (currentPlaylist.length === 0) return;
  const nextIdx = (currentTrackIndex + 1) % currentPlaylist.length;
  selectTrack(nextIdx, true);
}

function playPrevTrack() {
  if (currentPlaylist.length === 0) return;
  const prevIdx = (currentTrackIndex - 1 + currentPlaylist.length) % currentPlaylist.length;
  selectTrack(prevIdx, true);
}

function editCurrentTonie() {
  if (!currentTonieDetail) return;
  closeModal('detailModal');
  openOnboardingWizard(
    currentTonieDetail.nfc_uid || currentTonieDetail.ruid || currentTonieDetail.uid || '',
    currentTonieDetail.title || '',
    currentTonieDetail.series || '',
    currentTonieDetail.icon || '🧸',
    currentTonieDetail.audio_file || '',
    currentTonieDetail.owner || '',
    currentTonieDetail.tracks || null,
    currentTonieDetail.picture || ''
  );
}

// 12. Tonieboxen & Library
async function loadTonieboxes() {
  const boxList = document.getElementById('boxList');
  if (!boxList) return;

  boxList.innerHTML = `
    <div class="tonie-card" style="text-align: left; display: flex; align-items: center; justify-content: space-between; border-left: 4px solid #6366f1;">
      <div>
        <div style="font-weight: 700; font-size: 1rem;">📻 Ivans Toniebox</div>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">Haushalt Ivan • Zugeordnet: 👦 Ivan</div>
        <div style="font-size: 0.72rem; color: #34d399; margin-top: 4px;">✅ Shared Family Pool: Spielt alle Chips ab</div>
      </div>
      <span class="status-badge" style="background: rgba(99,102,241,0.2); color: #a5b4fc; border-color: rgba(99,102,241,0.4);">Aktiv</span>
    </div>

    <div class="tonie-card" style="text-align: left; display: flex; align-items: center; justify-content: space-between; border-left: 4px solid #06b6d4;">
      <div>
        <div style="font-weight: 700; font-size: 1rem;">📻 Schwesters Toniebox</div>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">Haushalt Schwester • Zugeordnet: 👧 Carla & 🧒 Joel</div>
        <div style="font-size: 0.72rem; color: #34d399; margin-top: 4px;">✅ Shared Family Pool: Spielt alle Chips ab</div>
      </div>
      <span class="status-badge" style="background: rgba(6,182,212,0.2); color: #67e8f9; border-color: rgba(6,182,212,0.4);">Aktiv</span>
    </div>
  `;
}

async function loadLibraryFiles() {
  try {
    const res = await fetch('/api/fileIndexV2?special=library');
    if (res.ok) {
      const data = await res.json();
      libraryFilesCache = data.files || (Array.isArray(data) ? data : []);
      // Filtere Ordner heraus
      libraryFilesCache = libraryFilesCache.filter(f => {
        const isDir = typeof f === 'object' ? f.isDir : false;
        const name = typeof f === 'string' ? f : (f.name || '');
        return !isDir && name !== '..' && name !== '.';
      });
    }
  } catch (e) {
    console.warn('Could not load library files:', e);
  }
}

// 13. Speicherüberwachung & Storage Softcap Management
function isStorageLimitReached() {
  return storageStats.isCritical;
}

function triggerAudioUpload() {
  if (isStorageLimitReached()) {
    showToast(`⛔ Upload blockiert: Speicherlimit (${storageSoftcapGB.toFixed(1)} GB) erreicht! Bitte erst Dateien löschen.`, 'error');
    return;
  }
  document.getElementById('wizardAudioUploadInput')?.click();
}

function updateWizardStorageNotice() {
  const notice = document.getElementById('wizardStorageNotice');
  if (!notice) return;

  const used = formatBytes(storageStats.totalUsedBytes);
  const limit = `${storageSoftcapGB.toFixed(1)} GB`;

  if (storageStats.isCritical) {
    notice.className = 'storage-micro-notice danger';
    notice.innerHTML = `⛔ Speicher voll (${used} / ${limit})! Uploads gesperrt.`;
  } else if (storageStats.isWarning) {
    notice.className = 'storage-micro-notice warning';
    notice.innerHTML = `⚠️ Speicher fast voll: ${used} / ${limit} (${storageStats.percentUsed}%).`;
  } else {
    notice.className = 'storage-micro-notice';
    notice.innerHTML = `💾 Speicher: ${used} / ${limit} belegt (${storageStats.percentUsed}%).`;
  }
}

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(i >= 3 ? 2 : 1)) + ' ' + sizes[i];
}

async function updateStorageStats() {
  const maxBytes = storageSoftcapGB * 1024 * 1024 * 1024;
  let totalBytes = 0;
  let fileList = [];

  try {
    // 1. Library-Audiodateien
    const resLib = await fetch('/api/fileIndexV2?special=library');
    if (resLib.ok) {
      const data = await resLib.json();
      const files = data.files || (Array.isArray(data) ? data : []);
      files.forEach(f => {
        if (!f.isDir && f.name !== '..' && f.name !== '.') {
          const sz = f.size || 0;
          totalBytes += sz;
          fileList.push({
            name: f.name,
            size: sz,
            date: f.date || 0,
            special: 'library'
          });
        }
      });
    }
  } catch (e) {
    console.warn('[Storage] Fehler beim Abrufen der Library-Dateien:', e);
  }

  try {
    // 2. Custom Cover-Bilder
    const resImg = await fetch('/api/fileIndexV2?special=custom_img');
    if (resImg.ok) {
      const data = await resImg.json();
      const files = data.files || (Array.isArray(data) ? data : []);
      files.forEach(f => {
        if (!f.isDir && f.name !== '..' && f.name !== '.') {
          totalBytes += (f.size || 0);
        }
      });
    }
  } catch (e) {}

  try {
    // 3. Content Directory (TAF / Firmware / Box Files)
    const resContent = await fetch('/api/fileIndexV2');
    if (resContent.ok) {
      const data = await resContent.json();
      const files = data.files || (Array.isArray(data) ? data : []);
      files.forEach(f => {
        if (!f.isDir && f.name !== '..' && f.name !== '.') {
          totalBytes += (f.size || f.tafHeader?.size || 0);
        }
      });
    }
  } catch (e) {}

  // Größte Dateien zuerst sortieren
  fileList.sort((a, b) => b.size - a.size);

  const ratio = totalBytes / maxBytes;
  const pct = Math.min(100, Math.round(ratio * 1000) / 10);
  const isWarning = ratio >= 0.8 && ratio < 1.0;
  const isCritical = ratio >= 1.0;

  storageStats = {
    totalUsedBytes: totalBytes,
    maxBytes: maxBytes,
    percentUsed: pct,
    isWarning: isWarning,
    isCritical: isCritical,
    fileDetails: fileList
  };

  renderStorageWidget();
  updateWizardStorageNotice();
}

function renderStorageWidget() {
  const usageText = document.getElementById('storageUsageText');
  const bar = document.getElementById('storageProgressBar');
  const percentText = document.getElementById('storagePercentText');
  const remainingText = document.getElementById('storageRemainingText');
  const alertBanner = document.getElementById('storageAlertBanner');
  const alertIcon = document.getElementById('storageAlertIcon');
  const alertMsg = document.getElementById('storageAlertMsg');
  const toggleText = document.getElementById('storageToggleText');

  if (!bar) return;

  const usedStr = formatBytes(storageStats.totalUsedBytes);
  const limitStr = `${storageSoftcapGB.toFixed(1)} GB`;
  const remainingBytes = Math.max(0, storageStats.maxBytes - storageStats.totalUsedBytes);
  const remainingStr = formatBytes(remainingBytes);

  if (usageText) {
    usageText.innerText = `${usedStr} / ${limitStr} belegt (${storageStats.percentUsed}%)`;
  }

  bar.style.width = `${Math.min(100, storageStats.percentUsed)}%`;
  bar.classList.toggle('warning', storageStats.isWarning);
  bar.classList.toggle('danger', storageStats.isCritical);

  if (percentText) {
    percentText.innerText = `${storageStats.percentUsed}% von ${limitStr} belegt`;
  }

  if (remainingText) {
    remainingText.innerText = storageStats.isCritical ? '0 B frei' : `Noch ${remainingStr} frei`;
  }

  // Warnhinweis / Alarmbanner bei >= 80% bzw. >= 100%
  if (alertBanner && alertMsg && alertIcon) {
    if (storageStats.isCritical) {
      alertBanner.style.display = 'flex';
      alertBanner.className = 'storage-alert-banner danger';
      alertIcon.innerText = '⛔';
      alertMsg.innerHTML = `<strong>Speicherlimit erreicht (${usedStr} / ${limitStr})!</strong><br>Neue Uploads sind gesperrt, um den Server vor Ausfall zu schützen. Bitte lösche nicht mehr benötigte Audiodateien über die Liste unten.`;
    } else if (storageStats.isWarning) {
      alertBanner.style.display = 'flex';
      alertBanner.className = 'storage-alert-banner warning';
      alertIcon.innerText = '⚠️';
      alertMsg.innerHTML = `<strong>Speicherwarnung: ${storageStats.percentUsed}% belegt!</strong><br>Der Server nähert sich der Kapazitätsgrenze (noch ${remainingStr} frei). Bitte plane das Bereinigen alter Audiodateien ein.`;
    } else {
      alertBanner.style.display = 'none';
    }
  }

  if (toggleText) {
    toggleText.innerText = `📁 Gespeicherte Audiodateien verwalten (${storageStats.fileDetails.length} Dateien)`;
  }

  renderStorageFilesList();
}

function toggleStorageFilesList() {
  isStorageFilesExpanded = !isStorageFilesExpanded;
  const container = document.getElementById('storageFilesContainer');
  const arrow = document.getElementById('storageToggleArrow');
  if (container) {
    container.style.display = isStorageFilesExpanded ? 'block' : 'none';
  }
  if (arrow) {
    arrow.innerText = isStorageFilesExpanded ? '▴' : '▾';
  }
}

function renderStorageFilesList() {
  const listEl = document.getElementById('storageFilesList');
  if (!listEl) return;

  if (storageStats.fileDetails.length === 0) {
    listEl.innerHTML = '<div style="color: var(--text-dim); font-size: 0.8rem; padding: 6px 0;">Keine Audiodateien in der Library hinterlegt.</div>';
    return;
  }

  listEl.innerHTML = storageStats.fileDetails.map(f => `
    <div class="storage-file-item">
      <div class="storage-file-info">
        <span class="storage-file-name" title="${f.name}">🎵 ${f.name}</span>
        <span class="storage-file-size">${formatBytes(f.size)}</span>
      </div>
      <button type="button" class="btn-file-delete" onclick="deleteLibraryFile('${f.name.replace(/'/g, "\\'")}')" title="Datei vom Server löschen">
        🗑️ Löschen
      </button>
    </div>
  `).join('');
}

async function deleteLibraryFile(fileName) {
  if (!confirm(`Möchtest du die Datei "${fileName}" wirklich endgültig vom Server löschen?\n\nDadurch wird Speicherplatz freigegeben.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/fileDelete?special=library&path=/${encodeURIComponent(fileName)}`, {
      method: 'POST',
      headers: {
        'X-Tonie-Key': currentAuthKey
      },
      body: fileName
    });

    if (res.ok || res.status === 200) {
      showToast(`🗑️ "${fileName}" erfolgreich gelöscht!`, 'success');
      await loadLibraryFiles();
      await updateStorageStats();
    } else {
      throw new Error(`Status ${res.status}`);
    }
  } catch (err) {
    console.error('File delete failed:', err);
    showToast('Fehler beim Löschen der Datei.', 'error');
  }
}

function configureStorageLimit() {
  const current = storageSoftcapGB;
  const input = prompt(`Aktuelles Server-Speicherlimit (Softcap): ${current} GB\n\nGib das gewünschte Speicherlimit in Gigabyte (GB) ein:`, current);
  if (input === null) return;

  const val = parseFloat(input);
  if (isNaN(val) || val <= 0) {
    showToast('Ungültiges Limit eingegeben. Bitte eine positive Zahl angeben.', 'error');
    return;
  }

  storageSoftcapGB = val;
  localStorage.setItem('tonie_storage_softcap_gb', val.toString());
  showToast(`💾 Server-Speicherlimit auf ${val} GB gesetzt!`, 'success');
  updateStorageStats();
}

// 13. Manual Tag Simulator
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
  if (!container) return;
  
  if (customToniesCache.length === 0) {
    container.innerHTML = '<div style="color: var(--text-dim); font-size: 0.8rem;">Noch keine Tags gespeichert.</div>';
    return;
  }

  container.innerHTML = customToniesCache.slice(0, 4).map(s => `
    <button class="btn-secondary" style="font-size: 0.78rem;" onclick="closeModal('manualTagModal'); resolveTag('${s.nfc_uid || s.model}')">
      ${s.title || 'Tonie'} (${(s.nfc_uid || s.model).substring(0, 6)}...)
    </button>
  `).join('');
}

// 14. Audio Player Engine
function setupAudioPlayer() {
  const audio = document.getElementById('audioElement');
  const progress = document.getElementById('scrubberProgress');
  const curTime = document.getElementById('currentTime');
  const durTime = document.getElementById('totalDuration');
  const btn = document.getElementById('btnPlayPause');

  if (!audio) return;

  audio.ontimeupdate = () => {
    if (!audio.duration) return;
    const pct = (audio.currentTime / audio.duration) * 100;
    progress.style.width = `${pct}%`;
    curTime.innerText = formatTime(audio.currentTime);
  };

  audio.onloadedmetadata = () => {
    durTime.innerText = formatTime(audio.duration);
  };

  // Automatisch nächsten Track spielen, wenn Track vorbei ist!
  audio.onended = () => {
    if (currentPlaylist.length > 0 && currentTrackIndex < currentPlaylist.length - 1) {
      playNextTrack();
    } else {
      btn.innerText = '▶';
      progress.style.width = '0%';
    }
  };
}

function toggleAudioPlayback() {
  const audio = document.getElementById('audioElement');
  const btn = document.getElementById('btnPlayPause');
  if (audio.paused) {
    if (!audio.src) {
      showToast('Keine Audiodatei für diesen Track hinterlegt.', 'error');
      return;
    }
    audio.play().then(() => {
      btn.innerText = '⏸';
    }).catch(() => {
      showToast('Audiodatei konnte nicht abgespielt werden.', 'error');
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

// 15. Modal Controls & Tabs
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
    if (audio) {
      audio.pause();
      document.getElementById('btnPlayPause').innerText = '▶';
    }
  }
}

function closeModalOnOverlay(e, modalId) {
  if (e.target.id === modalId) {
    closeModal(modalId);
  }
}

function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.innerText = msg;
  toast.className = `toast show ${type}`;
  setTimeout(() => {
    toast.className = 'toast';
  }, 3200);
}
