import type { DeviceState } from "./model";

/**
 * Master volume (GUI-#3): the MODC block "Lautstärke" (type 16) attenuates the outputs by the values
 * of two events, odd and even outputs, on top of the stored levels (forge-dsp-firmware modc.c
 * modc_volumen: attenuation = 255 - value in 0.5 dB steps). The master fader sets both event values
 * like a rotary encoder would; the tuning stays as it is.
 */
export const MODC_VOLUME = 16;

export interface Master { block: number; odd: number; even: number }

/** the first enabled volume block whose volume events are set; null if there is none */
export function masterOf(s: DeviceState): Master | null {
  for (const [n, m] of Object.entries(s.modc).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    if (m.enable && m.type === MODC_VOLUME && m.events[0] > 0)
      return { block: Number(n), odd: m.events[0], even: m.events[1] > 0 ? m.events[1] : m.events[0] };
  }
  return null;
}

/** event value <-> dB of attenuation (255 = 0 dB, 0.5 dB per step) */
export const masterDb = (v: number) => (Math.max(0, Math.min(255, v)) - 255) / 2;
export const masterValue = (db: number) => Math.max(0, Math.min(255, Math.round(255 + 2 * db)));
