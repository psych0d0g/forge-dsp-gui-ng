# Forge DSP GUI NG

Neue Bedienoberfläche für **Forge DSP** und **ETON CORE D8** als Nachfolger der Java-GUI. Eine Web-App, die auf drei Wegen mit dem Gerät spricht:

| Weg | Wie | Voraussetzung |
|---|---|---|
| **Browser, USB** | https://psych0d0g.github.io/forge-dsp-gui-ng/ → Web Serial → USB-COM des Forge (CP2102, 38400 8N1) | Chrome, Edge oder ein Firefox mit Web Serial; nichts zu installieren |
| **Desktop-App, USB** | Dieselbe Oberfläche als Programm: [Releases](https://github.com/psych0d0g/forge-dsp-gui-ng/releases) (Windows msi oder portable exe, Linux deb, rpm, AppImage, Flatpak, macOS dmg). Dateien mit „Speichern unter“, serielle Anschlüsse direkt | nichts weiter; macOS beim ersten Start per Rechtsklick › Öffnen (unsigniert) |
| **ESP32** | Der ESP32 steckt am RS485-Master/Slave-Port, öffnet ein WLAN und liefert die App selbst aus. Die App spricht per WebSocket, der ESP reicht die Zeilen zur UART durch | ESP32 mit 3,3-V-Full-Duplex-Transceiver, siehe [docs/hardware-esp32.md](docs/hardware-esp32.md) |

Die Firmware des Forge (Original BASCOM 1.11.6000 oder der C-Port [forge-dsp-firmware](https://github.com/psych0d0g/forge-dsp-firmware)) bleibt unverändert, die App nutzt das Textprotokoll.

**Stand:** Release 1.1.0. Seiten: Übersicht mit Pegeln aller Ein- und Ausgänge, Mixer als Mischpult (Kanalzüge, Routing,
Ausgangsbank, Profile, „All Over“), Filter & EQ (Frequenz- und Phasengang, Weichenansicht mit elektrischer Summe,
Kanal kopieren), Laufzeit, Steuerblöcke, Presets mit Abstimmungsdateien im `.cfg`-Format der Original-GUI und Vergleich
(zwei Presets oder Gerät gegen Datei, Unterschiede in Worten), Biquad-Verteilung, Diagnose mit Log der Speicherkarte, Speicherkarte, Firmware-Update im Browser (auch direkt aus den
Firmware-Releases), Einstellungen, Konsole. In der Kopfzeile Ausgangspegel, Master-Lautstärke und Rückgängig/Wiederholen; Tastenkürzel nach dem ETON Control
Center (Übersicht mit `?`). Viele Funktionen
nutzen die Erweiterungen der Port-Firmware ab 2.1.0; mit der Original-Firmware 1.11.6000 funktioniert alles, was diese
kann. Zum Ansehen ohne Gerät: `?demo`. Am DEV-Gerät (Forge 96ELN) im Browser geprüft: Verbinden, Pegel, Speicherkarte
und Log, Firmware-Update aus dem Release.

## Aufbau

```
src/lib/protocol/   Textprotokoll: Zeilen bauen (Ziel, Prüfsumme), Antworten parsen, Client mit Warteschlange
src/lib/transport/  Web Serial (USB) und WebSocket (ESP32) hinter einer Schnittstelle
src/lib/device/     Gerätemodell: Zustand, Einlesen, Übernahme von Antworten und Ereignissen, Demo-Gerät
src/lib/app.svelte.ts  Zustand der App (Verbindung, Gerät, Schreiben mit Drosselung)
src/App.svelte      App-Rahmen; src/pages/ Seiten, src/components/ Bedienelemente (Svelte 5)
tests/              Vitest, Antworten wie sie die Firmware sendet; tests/e2e/ Playwright gegen den Simulator
esp32/              ESP-IDF-Firmware der Brücke (PlatformIO), bettet die gebaute App ein
```

Simulator: Mit `?sim` (oder dem Knopf „Simulator“ auf der Startseite) läuft die echte Firmware als WebAssembly im
Browser, ohne Gerät (`src/lib/transport/sim.ts`, gebaut aus `tools/sim` der Firmware). EEPROM und Presets bleiben je
Modell im Browser. Pegelanzeige und Bootloader gibt es dort nicht. Die Ende-zu-Ende-Tests (`tests/e2e/`) bedienen die
gebaute Seite damit Klick für Klick, auch in Handybreite.

Firmware-Update (Seite *Firmware*, nur über USB):
- **Port-Firmware:** Der Forge geht per `system.boot` selbst in den Bootloader. Mit Karte im Forge und Firmware ab #61
  sichert die Firmware vorher Flash, MCU-EEPROM, Preset-EEPROM und DSP-EEPROMs auf die Karte (Platz 1–9, rund 40 s).
  Ohne Karte liest der Bootloader Flash und EEPROM als Dateien aus (rund 1,5 min).
- **Original-Firmware (erstes Update):** Sie kann den Bootloader nicht starten. Die Seite führt durch (ausschalten, Taster
  neben dem USB-Anschluss halten, einschalten), wartet auf den USB-Anschluss und verbindet sich mit dem Bootloader.
- **Forge im Bootloader:** Die App erkennt ihn beim Verbinden, sperrt alle anderen Seiten und liest Flash und EEPROM
  (Sicherung). Aus dem Image im Flash bestimmt sie, was läuft (Original/Port, Modell, PCB 3.0 oder 4.x), und lädt die
  passende Datei des neuesten Releases vor. Hinter einem kleineren Image bleibt der Rest einer älteren Firmware im Flash
  stehen (der Bootloader schreibt nur die Seiten des Images); erkannt wird das Image, das den Flash beginnt.
  Der Bootloader liest das letzte EEPROM-Byte (0xFFF) nicht, die Sicherung hat 4095 Byte; das Original nutzt das Byte nicht.

Die Protokoll-Logik steckt komplett in der Web-App. Der ESP32 ist nur Webserver und Brücke WebSocket ↔ UART, damit es die Logik nur einmal gibt.

## Bauen

```sh
npm ci
npm test            # Protokoll-Tests
npm run check       # Typprüfung
npm run dev         # Entwicklungsserver (USB per Web Serial)
npm run build       # dist/index.html (eine Datei) und dist/index.html.gz für den ESP32

scripts/build-sim.sh tests/sim V40-96ELN   # Simulator: die Firmware als WebAssembly (emsdk, holt forge-dsp-firmware)
npm run e2e         # Playwright: dist/ im Browser gegen den Simulator (vorher build; PW_CHROMIUM=/usr/bin/chromium
                    # nimmt das Chromium des Systems)

cd esp32
pio run             # Firmware, bettet ../dist/index.html.gz ein (ohne Build: Platzhalterseite)
pio run -t upload   # flashen
pio run -t menuconfig   # WLAN-Name/-Passwort, UART-Pins, Baudrate ("Forge bridge")
```

Desktop-App (Tauri, `src-tauri/`): die Web-App im Webview des Systems, dazu in Rust die serielle Schnittstelle
(WebKit hat kein Web Serial), „Speichern unter“ und der Abruf der Firmware-Releases. Bauen: `npx tauri build` (braucht
Rust; unter Linux `libwebkit2gtk-4.1-dev`, `libudev-dev`). Flatpak: `flatpak/`. Die Builds für alle drei Systeme macht
`.github/workflows/desktop.yml` (Tag `v*`:
an das Release, „Run workflow“: nur Artefakte).

Der ESP32 öffnet standardmäßig das WLAN `forge-dsp` (Passwort `forge-dsp-setup`, bitte in menuconfig ändern), die App liegt unter http://192.168.4.1/. Optional tritt er zusätzlich einem bestehenden WLAN bei.

## Protokoll in Kürze

```
get.1 system.ping              ->  <.1 system.ping="pong"
set.1 gain.out.1=200;53        ->  *.1 gain.out.1 ok        (;53 = Prüfsumme, optional)
set.1 system.startup.9="x"     ->  !.1 system.startup.9 command out of range
                                   #.1 preset.loaded=2      (Ereignis, ohne Anfrage)
```

Ziel nach dem Punkt: `1`–`6` Gerät in der Kette, `a` alle, `m`/`s` Master/Slave-Port, `t` dieses Gerät. Prüfsumme: Bytesumme mod 256 ab dem Registernamen bis vor das `;`, zwei Hex-Ziffern.
