# Forge DSP GUI NG

Neue Bedienoberfläche für **Forge DSP** und **ETON CORE D8** als Nachfolger der Java-GUI. Eine Web-App, die auf zwei Wegen mit dem Gerät spricht:

| Weg | Wie | Voraussetzung |
|---|---|---|
| **USB** | Browser → Web Serial → USB-COM des Forge (CP2102, 38400 8N1) | Chromium-Browser (Chrome, Edge), nichts zu installieren |
| **ESP32** | Der ESP32 steckt am RS485-Master/Slave-Port, öffnet ein WLAN und liefert die App selbst aus. Die App spricht per WebSocket, der ESP reicht die Zeilen zur UART durch | ESP32 mit 3,3-V-Full-Duplex-Transceiver, siehe [docs/hardware-esp32.md](docs/hardware-esp32.md) |

Die Firmware des Forge (Original BASCOM 1.11.6000 oder der C-Port [forge-dsp-firmware](https://github.com/psych0d0g/forge-dsp-firmware)) bleibt unverändert, die App nutzt das Textprotokoll.

**Stand:** Läuft unter https://psych0d0g.github.io/forge-dsp-gui-ng/ (zum Ansehen ohne Gerät: `?demo`). Fertig: App-Rahmen (Navigation nach Signalweg, hell/dunkel, Handy), Gerätemodell mit vollständigem Einlesen, Übersicht, Mixer als Mischpult (Kanalzüge mit Eingangspegel, Routing mit Drehreglern, Ausgangsbank, Profile, „All Over“), Filter & EQ (Frequenz- und Phasengang, Filterzüge), Laufzeit, Steuerblöcke, Presets mit Abstimmungsdateien im `.cfg`-Format der Original-GUI, Diagnose, Firmware-Update im Browser, Konsole. Offen: Simulator, Pegelanzeige (braucht Firmware-Unterstützung), siehe Issues. Am echten Gerät sind bisher die verwendeten Befehle geprüft, die Seiten im Browser noch nicht durchgehend.

## Aufbau

```
src/lib/protocol/   Textprotokoll: Zeilen bauen (Ziel, Prüfsumme), Antworten parsen, Client mit Warteschlange
src/lib/transport/  Web Serial (USB) und WebSocket (ESP32) hinter einer Schnittstelle
src/lib/device/     Gerätemodell: Zustand, Einlesen, Übernahme von Antworten und Ereignissen, Demo-Gerät
src/lib/app.svelte.ts  Zustand der App (Verbindung, Gerät, Schreiben mit Drosselung)
src/App.svelte      App-Rahmen; src/pages/ Seiten, src/components/ Bedienelemente (Svelte 5)
tests/              Vitest, Antworten wie sie die Firmware sendet
esp32/              ESP-IDF-Firmware der Brücke (PlatformIO), bettet die gebaute App ein
```

Die Protokoll-Logik steckt komplett in der Web-App. Der ESP32 ist nur Webserver und Brücke WebSocket ↔ UART, damit es die Logik nur einmal gibt.

## Bauen

```sh
npm ci
npm test            # Protokoll-Tests
npm run check       # Typprüfung
npm run dev         # Entwicklungsserver (USB per Web Serial)
npm run build       # dist/index.html (eine Datei) und dist/index.html.gz für den ESP32

cd esp32
pio run             # Firmware, bettet ../dist/index.html.gz ein (ohne Build: Platzhalterseite)
pio run -t upload   # flashen
pio run -t menuconfig   # WLAN-Name/-Passwort, UART-Pins, Baudrate ("Forge bridge")
```

Der ESP32 öffnet standardmäßig das WLAN `forge-dsp` (Passwort `forge-dsp-setup`, bitte in menuconfig ändern), die App liegt unter http://192.168.4.1/. Optional tritt er zusätzlich einem bestehenden WLAN bei.

## Protokoll in Kürze

```
get.1 system.ping              ->  <.1 system.ping="pong"
set.1 gain.out.1=200;53        ->  *.1 gain.out.1 ok        (;53 = Prüfsumme, optional)
set.1 system.startup.9="x"     ->  !.1 system.startup.9 command out of range
                                   #.1 preset.loaded=2      (Ereignis, ohne Anfrage)
```

Ziel nach dem Punkt: `1`–`6` Gerät in der Kette, `a` alle, `m`/`s` Master/Slave-Port, `t` dieses Gerät. Prüfsumme: Bytesumme mod 256 ab dem Registernamen bis vor das `;`, zwei Hex-Ziffern.
