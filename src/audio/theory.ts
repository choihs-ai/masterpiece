/** Music theory helpers (pure, no Web Audio). */
export const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
} as const;

export type ModeName = keyof typeof MODES;

export const midiToFreq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

export class Scale {
  readonly steps: readonly number[];

  constructor(
    readonly root: number,
    readonly mode: ModeName,
  ) {
    this.steps = MODES[mode];
  }

  /** MIDI note of a scale degree (0 = root). Negative and multi-octave degrees allowed. */
  note(deg: number): number {
    const n = this.steps.length;
    const oct = Math.floor(deg / n);
    const idx = ((deg % n) + n) % n;
    return this.root + oct * 12 + this.steps[idx];
  }

  /** Degrees of a chord stacked in thirds on `deg`. */
  chordDegrees(deg: number, size = 3): number[] {
    const out: number[] = [];
    for (let i = 0; i < size; i++) out.push(deg + i * 2);
    return out;
  }

  chord(deg: number, size = 3): number[] {
    return this.chordDegrees(deg, size).map((d) => this.note(d));
  }

  /** Is `deg` a chord tone (any octave) of the chord built on `chordDeg`? */
  isChordTone(deg: number, chordDeg: number, size = 3): boolean {
    const n = this.steps.length;
    const rel = (((deg - chordDeg) % n) + n) % n;
    for (let i = 0; i < size; i++) if (rel === (i * 2) % n) return true;
    return false;
  }

  /** Nearest degree (to `deg`) that is a chord tone of chord `chordDeg`. Ties resolve downward. */
  nearestChordTone(deg: number, chordDeg: number, size = 3): number {
    for (let d = 0; d < 7; d++) {
      if (this.isChordTone(deg - d, chordDeg, size)) return deg - d;
      if (this.isChordTone(deg + d, chordDeg, size)) return deg + d;
    }
    return deg;
  }
}

/**
 * Choose an inversion/octave placement for chord pitch classes that moves the least from
 * the previous voicing, keeping notes inside [lo, hi].
 */
export function voiceLead(chord: number[], prev: number[] | null, lo = 52, hi = 72): number[] {
  const pcs = chord.map((n) => ((n % 12) + 12) % 12);
  const candidates: number[][] = [];
  for (let inv = 0; inv < pcs.length; inv++) {
    const order = pcs.slice(inv).concat(pcs.slice(0, inv));
    for (let base = lo - 12; base <= hi; base += 12) {
      const v: number[] = [];
      let last = -Infinity;
      for (const pc of order) {
        let n = base + pc;
        while (n <= last) n += 12;
        v.push(n);
        last = n;
      }
      if (v[0] >= lo && v[v.length - 1] <= hi) candidates.push(v);
    }
  }
  if (candidates.length === 0) {
    // fall back to close position around the middle of the range
    const mid = Math.round((lo + hi) / 2 / 12) * 12;
    return pcs.map((pc) => mid + pc).sort((a, b) => a - b);
  }
  if (!prev || prev.length === 0) {
    const center = (lo + hi) / 2;
    candidates.sort(
      (a, b) =>
        Math.abs(a.reduce((s, x) => s + x, 0) / a.length - center) -
        Math.abs(b.reduce((s, x) => s + x, 0) / b.length - center),
    );
    return candidates[0];
  }
  let best = candidates[0];
  let bestCost = Infinity;
  for (const c of candidates) {
    let cost = 0;
    for (const n of c) {
      let m = Infinity;
      for (const p of prev) m = Math.min(m, Math.abs(n - p));
      cost += m;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = c;
    }
  }
  return best;
}
