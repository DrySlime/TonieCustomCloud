# 📝 TonieCustomCloud – Entwicklungs- & Feature-TODOs

Dieses Dokument sammelt geplante Features und Optimierungen, die nach dem Testen des Basis-Systems umgesetzt werden sollen.

---

## ⏳ Geplante Features (Backlog)

### 1. Automatisches Löschen der Original-MP3 nach TAF-Konvertierung
- **Status:** Zurückgestellt / Im Backlog vermerkt (Nutzerentscheidung: Das aktuelle Roh-Audiosystem ohne TAF-Konvertierung wird zuerst im Alltag getestet).
- **Ziel:** Verhindern von redundantem Speicherplatzverbrauch (Quell-MP3 + Ziel-TAF).
- **Hintergrund:**
  - TeddyCloud kann MP3/FLAC/AAC/WAV-Dateien nativ und ohne vorherige TAF-Konvertierung direkt streamen.
  - Wenn Nutzer später optional TAF-Dateien für Offline-Boxen generieren, bleibt die Original-Audiodatei vorerst als Backup erhalten.
- **Geplante Umsetzung bei späterer Aktivierung:**
  1. Optionale Checkbox im Web-Interface / Upload-Assistenten:  
     `[ ] Original-Audiodatei nach erfolgreicher TAF-Erstellung automatisch vom Server löschen`.
  2. Nach erfolgreichem TAF-Encoding (Überprüfung via HTTP 200 und Vorhandensein des TAF-Headers mit gültigem SHA1-Hash) wird `POST /api/fileDelete?special=library` mit dem Dateinamen der Rohdatei ausgelöst.
  3. Bei Konvertierungsfehlern, unvollständigen Dateien oder Abbruch bleibt die Originaldatei unangetastet.

---

## ✅ Umgesetzte Features

### 2. Live-Kapazitätsüberwachung & Server-Schutz (Softcap mit Warnungen)
- **Status:** ✅ Vollständig umgesetzt in PWA v5.
- **Funktionen:**
  - **Echtzeit-Berechnung:** Erfasst Library-Audiodateien (`special=library`), Coverbilder (`special=custom_img`) und Content-Dateien (`/api/fileIndexV2`).
  - **Standard-Softcap:** 25.0 GB konfigurierbar über den Button `⚙️ Limit`.
  - **Frühwarnung (>= 80 %):** Prominentes gelbes Warnbanner (`⚠️ Speicherwarnung: 80% des Limits erreicht`), um rechtzeitig vor Engpässen zu warnen.
  - **Upload-Sperre (>= 100 %):** Rotes Alarmbanner (`⛔ Speicherlimit erreicht`), deaktiviert Audio- und Cover-Uploads und blockiert Dateianfragen mit Fehlermeldung, um das Linux-Root-Dateisystem vor Überlauf zu schützen.
  - **Integrierter Dateimanager:** Aufklappbare Liste der größten Audiodateien inklusive exakter Größenangaben und Schnelllösch-Funktion (`🗑️ Löschen` via `POST /api/fileDelete`).

---

## ⏳ Hardware & Inbetriebnahme

### 3. Physische Toniebox-Zertifikate & Pairing
- **Status:** Vorgemerkt für Hardware-Inbetriebnahme.
- **Funktion:**
  - Einpflegen der Client-Zertifikate von Ivans Toniebox und der Toniebox der Schwester in `/teddycloud/certs/client/`.
  - DNS-Umleitung oder Box-WLAN-Konfiguration für TeddyCloud-Server `192.168.178.29`.
