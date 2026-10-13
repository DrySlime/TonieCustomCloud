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
let isNfcScanning = false;
let nfcReaderInstance = null;
let selectedLoginKey = 'Ivan19';
let currentLibraryFilter = 'my'; // 'my' | 'shared' | 'all'

// Initialize on Load
document.addEventListener('DOMContentLoaded', () => {
  initServiceWorker();
  initAuthAndApp();
  setupAudioPlayer();
});

// 1. Service Worker Registration & Update Trigger
function initServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/pwa/sw.js?v=3')
      .then((reg) => {
        console.log('[PWA] Service Worker v3 registriert:', reg.scope);
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

  // Prüfen ob Biometrie (Fingerabdruck) hinterlegt ist
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

  // Im Wizard vorauswählen
  const ownerSelect = document.getElementById('wizardOwnerSelect');
  if (ownerSelect) ownerSelect.value = user.name;
}

function handleAccountMenu() {
  const user = USERS[currentAuthKey];
  if (!user) return;

  const isBioEnrolled = localStorage.getItem('tonie_bio_enrolled') === 'true';
  const bioText = isBioEnrolled ? '✓ Fingerabdruck aktiv' : '👆 Fingerabdruck einrichten';

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
    if (available && enrolled) {
      btn.style.display = 'flex';
    } else {
      btn.style.display = 'none';
    }
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
      showToast('🎉 Fingerabdruck erfolgreich für diesen Account eingerichtet!', 'success');
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

// 4. App Start & Data Loading (ECHTE Tonies only)
async function startApp() {
  checkServerHealth();
  await loadRealTonies();
  loadLibraryFiles();
  loadTonieboxes();
}

async function checkServerHealth() {
  const badge = document.getElementById('userProfileBadge');
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) throw new Error();
  } catch (e) {
    showToast('Verbindung zur TeddyCloud unterbrochen.', 'error');
  }
}

async function loadRealTonies() {
  try {
    // 1. Echte Custom Tonies aus der DB
    const res = await fetch('/api/toniesCustomJson');
    if (res.ok) {
      const data = await res.json();
      customToniesCache = Array.isArray(data) ? data : (data.tonies || []);
    }
  } catch (e) {
    console.warn('Could not load toniesCustomJson:', e);
  }

  // Filter & Render
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

  // Trennung:
  // Meine Tonies: owner == currentUser ODER household == currentHousehold
  // Geteilt: owner != currentUser
  const myTonies = customToniesCache.filter(t => (t.owner === currentUser) || (t.household === currentHousehold));
  const sharedTonies = customToniesCache.filter(t => t.owner && t.owner !== currentUser && t.household !== currentHousehold);

  // Update Counters
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

  // Suchfilter
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
  const currentUser = USERS[currentAuthKey]?.name || 'Ivan';

  // Bevorzugt kürzliche Tonies des Nutzers oder alle
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

  return `
    <div class="tonie-card" onclick="openDetailModal(${JSON.stringify(item).replace(/"/g, '&quot;')}, '${uid}')">
      <div class="tonie-card-img-wrap">
        <img class="tonie-card-img" src="${imgUrl}" alt="${title}" onerror="this.src='/img_custom.png'">
      </div>
      <div class="tonie-card-title">${title}</div>
      <div class="tonie-card-subtitle">${series}</div>
      <div style="display: flex; gap: 4px; justify-content: center; align-items: center; flex-wrap: wrap;">
        <span class="owner-badge ${ownerClass}">${ownerAvatar} ${owner}</span>
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

  // 1. Suche in Custom Tonies
  let found = customToniesCache.find(t => (t.nfc_uid || t.ruid || t.uid || '').toUpperCase() === cleanUid);

  // 2. Fallback: TeddyCloud API Abfrage
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
    // Neuer Tag -> Wizard für aktuellen Account öffnen!
    openOnboardingWizard(cleanUid);
  }
}

// 7. Onboarding & Speichern mit Owner/Box Zuordnung
function openOnboardingWizard(tagUid, initialTitle = '', initialSeries = '', initialIcon = '🧸', initialAudio = '', initialOwner = '') {
  const modal = document.getElementById('wizardModal');
  const currentUser = USERS[currentAuthKey]?.name || 'Ivan';

  document.getElementById('wizardTagUid').value = tagUid || 'TAG_' + Math.random().toString(36).substring(2, 10).toUpperCase();
  document.getElementById('wizardTitle').value = initialTitle;
  document.getElementById('wizardSeries').value = initialSeries;
  document.getElementById('wizardSelectedIcon').value = initialIcon;
  document.getElementById('wizardOwnerSelect').value = initialOwner || currentUser;

  if (initialAudio) {
    document.getElementById('wizardAudioSelect').value = initialAudio;
  }
  document.querySelectorAll('.icon-preset-btn').forEach(b => {
    b.classList.toggle('active', b.innerText.trim() === initialIcon);
  });
  modal.classList.add('open');
}

function selectIconPreset(icon, btn) {
  document.querySelectorAll('.icon-preset-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('wizardSelectedIcon').value = icon;
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
  const audioFile = document.getElementById('wizardAudioSelect').value;
  const owner = document.getElementById('wizardOwnerSelect').value || USERS[currentAuthKey].name;
  const box = owner === 'Ivan' ? 'Ivans Toniebox' : 'Schwesters Toniebox';
  const household = owner === 'Ivan' ? 'ivan' : 'schwester';

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
    picture: '/img_custom.png',
    icon: icon,
    audio_file: audioFile || null
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
      showToast(`🎉 Tonie gespeichert für ${owner} (Freigegeben für beide Boxen)!`, 'success');
      
      // Update Cache
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

// 8. Tonie Details, Bearbeiten & Audio Player
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

  // Kapitel / Tracks
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
    trackList.innerHTML = '<li class="track-item" style="color: var(--text-dim);">1 Gesamtfolge (Vollständiges Hörspiel)</li>';
  }

  // Audio URL
  const audio = document.getElementById('audioElement');
  if (item.audio_url || item.url) {
    audio.src = item.audio_url || item.url;
  } else {
    audio.src = '';
  }

  modal.classList.add('open');
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
    currentTonieDetail.owner || ''
  );
}

// 9. Tonieboxen Übersicht
async function loadTonieboxes() {
  const boxList = document.getElementById('boxList');
  if (!boxList) return;

  // Realistische Box-Darstellung beider Haushalte (Ivan & Schwester)
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
  const select = document.getElementById('wizardAudioSelect');
  if (!select) return;
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

// 10. Manual Tag Simulator
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

// 11. Audio Player Engine
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

// 12. Modal Controls & Tabs
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
