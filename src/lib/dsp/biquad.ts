// Biquad coefficients as the firmware computes them (forge-dsp-firmware src/biquad.c, port of
// the BASCOM functions), for the frequency and phase response shown in the interface.
import type { Biquad } from "../device/model";

/** H(z) = (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2) */
export interface Coeffs { b0: number; b1: number; b2: number; a1: number; a2: number }

export const BYPASS: Coeffs = { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };

export interface TypeInfo {
  type: number;
  name: string;
  group: "Aus" | "EQ" | "Tiefpass" | "Hochpass" | "Phase" | "Sonstige";
  /** parameters the type uses */
  gain?: boolean;
  q?: boolean;
  /** meaning of b, when used */
  b?: "Bandbreite (Hz)" | "Winkel (°)";
  /** needs the C port (version of forge-dsp-firmware) */
  port?: boolean;
}

export const TYPES: TypeInfo[] = [
  { type: 0, name: "Aus", group: "Aus" },
  { type: 1, name: "EQ (Güte)", group: "EQ", gain: true, q: true },
  { type: 18, name: "EQ (Bandbreite)", group: "EQ", gain: true, b: "Bandbreite (Hz)" },
  { type: 14, name: "Bass-Shelf", group: "EQ", gain: true, q: true },
  { type: 15, name: "Höhen-Shelf", group: "EQ", gain: true, q: true },
  { type: 16, name: "Notch", group: "EQ", b: "Bandbreite (Hz)" },
  { type: 17, name: "Bandpass", group: "EQ", q: true, port: true },
  { type: 2, name: "Tiefpass 6 dB", group: "Tiefpass" },
  { type: 3, name: "Tiefpass Butterworth 12 dB", group: "Tiefpass" },
  { type: 5, name: "Tiefpass Linkwitz 12 dB", group: "Tiefpass" },
  { type: 4, name: "Tiefpass Bessel 12 dB", group: "Tiefpass" },
  { type: 6, name: "Tiefpass Chebyshev 12 dB", group: "Tiefpass" },
  { type: 7, name: "Tiefpass, Güte frei", group: "Tiefpass", q: true },
  { type: 8, name: "Hochpass 6 dB", group: "Hochpass" },
  { type: 9, name: "Hochpass Butterworth 12 dB", group: "Hochpass" },
  { type: 11, name: "Hochpass Linkwitz 12 dB", group: "Hochpass" },
  { type: 10, name: "Hochpass Bessel 12 dB", group: "Hochpass" },
  { type: 12, name: "Hochpass Chebyshev 12 dB", group: "Hochpass" },
  { type: 13, name: "Hochpass, Güte frei", group: "Hochpass", q: true },
  { type: 21, name: "Allpass 1. Ordnung (−90° bei f)", group: "Phase", port: true },
  { type: 20, name: "Allpass 2. Ordnung (−180° bei f)", group: "Phase", q: true },
  { type: 22, name: "Phase: Winkel bei f", group: "Phase", q: true, b: "Winkel (°)", port: true },
  { type: 19, name: "RIAA", group: "Sonstige" },
];
export const typeInfo = (t: number) => TYPES.find((x) => x.type === t);

const Q_BUTTERWORTH = 0.7071067811865476, Q_BESSEL = 0.5773502691896257, Q_LINKWITZ = 0.5, Q_CHEBYCHEV = 1.0;

/** stored bit 7 of the flags: the biquad is in use (otherwise bypass) */
export const isActive = (b: Biquad) => b.type !== 0 && (b.flags & 0x80) !== 0;

/** coefficients from the stored values: f in Hz, gain in 0.1 dB, q in 1/1000, b as stored */
export function coeffs(bq: Biquad, rate: number): Coeffs {
  if (!isActive(bq)) return BYPASS;
  const f = bq.f, q = bq.q / 1000, bw = bq.b;
  const w = (2 * Math.PI * f) / rate;
  const cw = Math.cos(w), sw = Math.sin(w);
  const P = Math.pow(10, bq.gain / 10 / 40);
  const alpha = (qq: number) => sw / (2 * qq);
  // the firmware's form: a0, and A1/A2 already negated (the DSP adds them)
  let B0 = 1, B1 = 0, B2 = 0, A0 = 1, A1 = 0, A2 = 0;
  const low = (qq: number) => { const a = alpha(qq); B0 = (1 - cw) / 2; B1 = 1 - cw; B2 = B0; A0 = 1 + a; A1 = 2 * cw; A2 = -(1 - a); };
  const high = (qq: number) => { const a = alpha(qq); B0 = (1 + cw) / 2; B1 = -(1 + cw); B2 = B0; A0 = 1 + a; A1 = 2 * cw; A2 = -(1 - a); };
  const eq = (qq: number) => { const a = alpha(qq); A0 = 1 + a / P; A1 = 2 * cw; A2 = -(1 - a / P); B0 = 1 + a * P; B1 = -2 * cw; B2 = 1 - a * P; };
  const shelf = (hi: boolean) => {
    const p1 = P + 1, p2 = P - 1, c1 = p1 * cw, c2 = p2 * cw, bso = (Math.sqrt(P) / q) * sw;
    if (hi) { B0 = P * (p1 + c2 + bso); B1 = -2 * P * (p2 + c1); B2 = P * (p1 + c2 - bso); A0 = p1 - c2 + bso; A1 = -2 * (p2 - c1); A2 = -(p1 - c2 - bso); }
    else { B0 = P * (p1 - c2 + bso); B1 = 2 * P * (p2 - c1); B2 = P * (p1 - c2 - bso); A0 = p1 + c2 + bso; A1 = 2 * (p2 + c1); A2 = -(p1 + c2 - bso); }
  };
  const allpass1 = (k: number) => { const c = (k - 1) / (k + 1); A0 = 1; A1 = -c; A2 = 0; B0 = c; B1 = 1; B2 = 0; };
  const allpass2 = (w0: number, qq: number) => { const a = Math.sin(w0) / (2 * qq), c = Math.cos(w0); A0 = 1 + a; B2 = 1 + a; A1 = 2 * c; B1 = -2 * c; B0 = 1 - a; A2 = -(1 - a); };
  switch (bq.type) {
    case 1: eq(q); break;
    case 2: { const a = alpha(1); A0 = 1 + a; A1 = 1 - a; A2 = 0; B0 = a; B1 = a; B2 = 0; break; }
    case 3: low(Q_BUTTERWORTH); break;
    case 4: low(Q_BESSEL); break;
    case 5: low(Q_LINKWITZ); break;
    case 6: low(Q_CHEBYCHEV); break;
    case 7: low(q); break;
    case 8: { const a = alpha(1); A0 = 1 + a; A1 = 1 - a; A2 = 0; B0 = 1; B1 = -1; B2 = 0; break; }
    case 9: high(Q_BUTTERWORTH); break;
    case 10: high(Q_BESSEL); break;
    case 11: high(Q_LINKWITZ); break;
    case 12: high(Q_CHEBYCHEV); break;
    case 13: high(q); break;
    case 14: shelf(false); break;
    case 15: shelf(true); break;
    case 16: { const a = alpha(f / bw); A0 = 1 + a; A1 = 2 * cw; A2 = -(1 - a); B0 = 1; B1 = -2 * cw; B2 = 1; break; }
    case 17: { const a = alpha(q); B0 = sw / 2; B1 = 0; B2 = -sw / 2; A0 = 1 + a; A1 = 2 * cw; A2 = -(1 - a); break; }
    case 18: eq(f / bw); break;
    case 19: A0 = 1; A1 = 1.866634; A2 = -0.8670602; B0 = 0.117096; B1 = -0.0999452; B2 = -0.0129345; break;
    case 20: allpass2(w, q); break;
    case 21: allpass1(Math.tan(w / 2)); break;
    case 22: {
      const kf = Math.tan(w / 2);
      if (!(bw >= 1 && bw < 360) || !(kf > 0)) return BYPASS;
      const th = (bw / 2) * (Math.PI / 180);
      if (bw < 180) { allpass1(kf / Math.tan(th)); break; }
      const qq = q > 0 ? q : 0.707, s = Math.sin(th), c = Math.cos(th);
      const x = (-c / qq + Math.sqrt((c * c) / (qq * qq) + 4 * s * s)) / (2 * s);
      allpass2(2 * Math.atan(kf / x), qq);
      break;
    }
    default: return BYPASS;
  }
  const r = { b0: B0 / A0, b1: B1 / A0, b2: B2 / A0, a1: -A1 / A0, a2: -A2 / A0 };
  return Object.values(r).every(Number.isFinite) ? r : BYPASS;
}

/** complex response at f: [real, imaginary] */
export function response(c: Coeffs, f: number, rate: number): [number, number] {
  const w = (2 * Math.PI * f) / rate;
  const c1 = Math.cos(w), s1 = -Math.sin(w), c2 = Math.cos(2 * w), s2 = -Math.sin(2 * w);
  const nr = c.b0 + c.b1 * c1 + c.b2 * c2, ni = c.b1 * s1 + c.b2 * s2;
  const dr = 1 + c.a1 * c1 + c.a2 * c2, di = c.a1 * s1 + c.a2 * s2;
  const m = dr * dr + di * di;
  return [(nr * dr + ni * di) / m, (ni * dr - nr * di) / m];
}

/** logarithmically spaced frequencies */
export function logFreqs(lo: number, hi: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => lo * Math.pow(hi / lo, i / (n - 1)));
}

export interface Curve { db: number[]; phase: number[] }

/** magnitude (dB) and phase (degrees, -180..180) of a chain of biquads at the given frequencies */
export function chainResponse(list: Coeffs[], freqs: number[], rate: number): Curve {
  const db: number[] = [], phase: number[] = [];
  for (const f of freqs) {
    let re = 1, im = 0;
    for (const c of list) {
      const [r, i] = response(c, f, rate);
      [re, im] = [re * r - im * i, re * i + im * r];
    }
    db.push(10 * Math.log10(Math.max(re * re + im * im, 1e-30)));
    phase.push((Math.atan2(im, re) * 180) / Math.PI);
  }
  return { db, phase };
}

/**
 * Frequency range worth showing for a set of filters: from below the lowest to above the highest
 * filter frequency, with a margin of one octave and at least `marginHz`, inside `full`. Without
 * filters (or when they span nearly everything) the full range.
 */
export function viewRange(freqs: number[], full: [number, number], marginHz = 750): [number, number] {
  const f = freqs.filter((x) => x > 0);
  if (!f.length) return full;
  const lo = Math.max(full[0], Math.min(Math.min(...f) / 2, Math.min(...f) - marginHz));
  const hi = Math.min(full[1], Math.max(Math.max(...f) * 2, Math.max(...f) + marginHz));
  // nice ends: down/up to 1-2-5 steps
  const nice = (v: number, up: boolean) => {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const steps = [1, 2, 5, 10];
    const m = v / p;
    const k = up ? steps.find((x) => x >= m - 1e-9)! : [...steps].reverse().find((x) => x <= m + 1e-9)!;
    return k * p;
  };
  return [Math.max(full[0], nice(lo, false)), Math.min(full[1], nice(hi, true))];
}
