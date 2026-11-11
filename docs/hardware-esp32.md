# ESP32 am RS485-Port

Quelle: Schaltplan der Forge-Platine V4.0h (`board/V40h/FORGE_BASE_II-SCHEMA1.png` und `-SCHEMA6.png` im PCB-Repository des Originals). Andere Platinenversionen sind noch nicht geprüft.

## Ports des Forge

Zwei RJ45-Buchsen, jede mit eigenem **Full-Duplex**-Transceiver an 3,3 V (getrennte Paare für Senden und Empfangen, kein Richtungs-Pin, Pinout wie MAX3490/SN65HVD379). 120 Ω Abschluss am Empfänger. Standard 38400 8N1.

| RJ45-Pin | Buchse 1 „Master“ (USARTC1) | Buchse 2 „Slave“ (USARTD1) |
|---|---|---|
| 1 | A (RX+) | Y (TX+) |
| 2 | B (RX−) | Z (TX−) |
| 3 | Y (TX+) | A (RX+) |
| 6 | Z (TX−) | B (RX−) |
| 7 | PWR.ON | – |
| 8 | GND | GND |
| 4, 5 | – | – |

- Die Belegung ist gekreuzt: Ein 1:1-Patchkabel verbindet Buchse 1 eines Geräts mit Buchse 2 des nächsten.
- **Keine Versorgung auf den Buchsen.** Der ESP braucht eine eigene Stromversorgung.
- PWR.ON (Pin 7, nur Buchse 1): Pegel und Richtung noch unklar, nicht anschließen.

## Brücke

| ESP32 | Transceiver (z. B. MAX3490, 3,3 V) | RJ45 der Brücke |
|---|---|---|
| GPIO17 (TX, einstellbar) | DI | Y → Pin 3, Z → Pin 6 |
| GPIO16 (RX, einstellbar) | RO | A → Pin 1, B → Pin 2 (120 Ω zwischen A und B) |
| GND | GND | Pin 8 |
| 3V3 | VCC | – |

Die RJ45 der Brücke ist wie Buchse 1 eines Forge belegt. Ein normales Patchkabel geht damit in **Buchse 2** des Forge, die Brücke sitzt dann wie ein vorgeschaltetes Gerät vor der Kette.

Offen: am Gerät bestätigen, dass Befehle über Buchse 2 wie über USB beantwortet werden; Versorgung aus dem Bordnetz (12 V → 3,3 V).
