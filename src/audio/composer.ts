/**
 * Procedural composer. Produces a deterministic "song" per sector: chord progressions,
 * voicings, drum grooves, basslines, arpeggios and generated melodies, organised as
 * 16-step bars at five intensity levels:
 *   0 ambient · 1 light groove · 2 full groove · 3 boss · 4 climax
 * Pure TypeScript — no Web Audio here, so it can be unit tested.
 */
import { RNG } from '../core/rng';
import { ModeName, Scale, voiceLead } from './theory';

export type StyleId = 'title' | 'synthwave' | 'deephouse' | 'trance' | 'breaks' | 'epic' | 'ending';

export interface NoteEv {
  step: number;
  dur: number;
  midi: number;
  vel: number;
}

export interface ChordEv {
  step: number;
  dur: number;
  midis: number[];
  vel: number;
}

export interface ToneDef {
  bassWave: OscillatorType;
  bassCutoff: number;
  bassEnv: number;
  bassQ: number;
  bassDrive: number;
  bassOct: number;
  arpWave: OscillatorType;
  arpCutoff: number;
  arpDecay: number;
  arpOct: number;
  leadWave: OscillatorType;
  leadCutoff: number;
  leadOct: number;
  leadDetune: number;
  padWave: OscillatorType;
  padCutoff: number;
  padDetune: number;
  pluckStab: boolean;
  kickPitch: number;
  hatTone: number;
}

export interface StyleDef {
  id: StyleId;
  kick: string[];
  snare: string[];
  hat: string[];
  ohat: string[];
  perc: string[];
  bass: string[];
  arp: (string | null)[];
  counter: boolean[];
  lead: boolean[];
  pad: boolean[];
  padGate: (string | null)[];
  stab: string[];
  clap: boolean;
  toms: boolean;
  swing: number;
  progressionsA: number[][];
  progressionsB: number[][];
  tone: ToneDef;
}

export interface BarScore {
  kick: Float32Array;
  snare: Float32Array;
  hat: Float32Array;
  ohat: Float32Array;
  perc: Float32Array;
  bass: NoteEv[];
  arp: NoteEv[];
  lead: NoteEv[];
  counter: NoteEv[];
  pad: ChordEv[];
  stab: ChordEv[];
  chord: number[];
  chordDeg: number;
  section: 'A' | 'B';
}

export interface SongSpec {
  seed: number;
  style: StyleId;
  root: number;
  mode: ModeName;
  bpm: number;
}

const E = '................';
const fill5 = (s: string): string[] => [s, s, s, s, s];

const BASE_TONE: ToneDef = {
  bassWave: 'sawtooth',
  bassCutoff: 420,
  bassEnv: 3.5,
  bassQ: 6,
  bassDrive: 0,
  bassOct: -1,
  arpWave: 'square',
  arpCutoff: 2400,
  arpDecay: 0.16,
  arpOct: 0,
  leadWave: 'sawtooth',
  leadCutoff: 3200,
  leadOct: 0,
  leadDetune: 9,
  padWave: 'sawtooth',
  padCutoff: 1400,
  padDetune: 12,
  pluckStab: false,
  kickPitch: 1,
  hatTone: 7500,
};

export const STYLES: Record<StyleId, StyleDef> = {
  title: {
    id: 'title',
    kick: [E, 'X.......X.......', 'X.......X.......', 'X...X...X...X...', 'X...X...X...X...'],
    snare: [E, E, '....X.......X...', '....X.......X...', '....X.......X...'],
    hat: [E, '..-...-...-...-.', '..o...o...o...o.', 'o.x.o.x.o.x.o.x.', 'o.x.o.x.o.x.o.x.'],
    ohat: fill5(E),
    perc: fill5(E),
    bass: ['', 'R-------R-------', 'R-------R-------', 'R-R-R-R-R-R-R-R-', 'R-R-R-R-R-R-R-R-'],
    arp: ['0..2..4..3..2...', '0..2..4..3..2...', '0..2..4..3..2...', '0234023402340234', '0234023402340234'],
    counter: [false, true, true, false, false],
    lead: [false, false, false, true, true],
    pad: [true, true, true, true, true],
    padGate: [null, null, null, null, null],
    stab: fill5(''),
    clap: false,
    toms: false,
    swing: 0,
    progressionsA: [[0, 3, 2, 6]],
    progressionsB: [[0, 3, 2, 6]],
    tone: { ...BASE_TONE, arpWave: 'triangle', arpDecay: 0.42, arpCutoff: 2600, padCutoff: 950, bassCutoff: 300 },
  },
  synthwave: {
    id: 'synthwave',
    kick: [E, 'X...X...X...X...', 'X...X...X...X...', 'X...X...X...X...', 'X...X...X...X.x.'],
    snare: [E, E, '....X.......X...', '....X.......X...', '....X.......X...'],
    hat: [E, '..x...x...x...x.', 'o.x.o.x.o.x.o.x.', 'o-x-o-x-o-x-o-x-', 'xoxoxoxoxoxoxoxo'],
    ohat: [E, E, E, '..o.......o.....', '..o...o...o...o.'],
    perc: fill5(E),
    bass: ['', 'R-R-R-R-R-R-R-R-', 'R.RRR.RRR.RRR.RR', 'RRRRRRRRRRRRRRRR', 'RORORORORORORORO'],
    arp: ['0---2---4---2---', '0.2.4.2.0.2.4.2.', '0234023402340234', '0123432101234321', '0356035603560356'],
    counter: [false, false, true, false, false],
    lead: [false, false, false, true, true],
    pad: [true, true, true, true, true],
    padGate: [null, null, null, null, null],
    stab: ['', '', '', '', 'X..X..X...X.....'],
    clap: false,
    toms: false,
    swing: 0,
    progressionsA: [
      [0, 5, 2, 6],
      [0, 6, 5, 6],
      [5, 6, 0, 0],
      [0, 3, 5, 6],
    ],
    progressionsB: [
      [0, 5, 3, 4],
      [5, 3, 0, 6],
      [0, 2, 5, 6],
    ],
    tone: { ...BASE_TONE },
  },
  deephouse: {
    id: 'deephouse',
    kick: [E, 'X...X...X...X...', 'X...X...X...X...', 'X...X...X...X...', 'X...X...X...X...'],
    snare: [E, E, '....X.......X...', '....X.......X...', '....X.......X..x'],
    hat: [E, E, E, 'x.x.x.x.x.x.x.x.', 'x.x.x.x.x.x.x.x.'],
    ohat: [E, '..X...X...X...X.', '..X...X...X...X.', '..X...X...X...X.', '..X...X...X...X.'],
    perc: [E, E, '-o-o-o-o-o-o-o-o', '-o-o-o-o-o-o-o-o', 'oxoxoxoxoxoxoxox'],
    bass: ['', '..R-..R-..R-..R-', '..R-..RR..R-..5-', '..R-..RR..R-.OR-', 'R.R-..RR.R..R-5O'],
    arp: ['0..2..4..2..0...', null, null, '0.2.3.4.3.2.0.2.', '0.2.3.4.3.2.0.2.'],
    counter: [false, false, true, false, false],
    lead: [false, false, false, true, true],
    pad: [true, true, true, true, true],
    padGate: [null, null, null, null, null],
    stab: ['', '..x..x......x...', '..x..x....x..x..', '..x..x....x..x..', 'x.x..x..x.x..x..'],
    clap: true,
    toms: false,
    swing: 0.12,
    progressionsA: [
      [0, 3, 6, 3],
      [0, 2, 3, 6],
      [0, 1, 2, 3],
    ],
    progressionsB: [
      [0, 6, 2, 3],
      [2, 3, 0, 0],
      [0, 3, 4, 6],
    ],
    tone: {
      ...BASE_TONE,
      bassCutoff: 320,
      bassEnv: 2.2,
      bassQ: 3,
      arpWave: 'triangle',
      arpCutoff: 3000,
      arpDecay: 0.25,
      leadWave: 'square',
      leadCutoff: 2200,
      padCutoff: 1100,
      pluckStab: true,
      kickPitch: 0.95,
      hatTone: 8000,
      arpOct: 1,
    },
  },
  trance: {
    id: 'trance',
    kick: [E, 'X...X...X...X...', 'X...X...X...X...', 'X...X...X...X...', 'X...X...X...X...'],
    snare: [E, E, '....X.......X...', '....X.......X...', '....X.......X...'],
    hat: [E, E, '-.-.-.-.-.-.-.-.', 'o-x-o-x-o-x-o-x-', 'oxoxoxoxoxoxoxox'],
    ohat: [E, '..X...X...X...X.', '..X...X...X...X.', '..X...X...X...X.', '..X...X...X...X.'],
    perc: fill5(E),
    bass: ['', '.RRR.RRR.RRR.RRR', '.RRR.RRR.RRR.RRR', '.RRR.RRR.RRR.RRR', '.RRO.RRO.RRO.RRO'],
    arp: ['0.2.4.2.0.2.4.2.', '0.2.4.2.0.2.4.2.', '0242024202420242', '0245024502450245', '0356035603560356'],
    counter: [false, false, true, false, false],
    lead: [false, false, false, true, true],
    pad: [true, true, true, true, true],
    padGate: [null, null, null, 'x-x.x-x.x-x.x-x.', 'x.x.x.x.x.x.x.x.'],
    stab: ['', '', '', '', 'X..X..X...X..X..'],
    clap: true,
    toms: false,
    swing: 0,
    progressionsA: [
      [0, 5, 2, 6],
      [5, 6, 0, 0],
      [0, 3, 5, 6],
    ],
    progressionsB: [
      [0, 5, 3, 6],
      [3, 5, 0, 6],
      [5, 2, 6, 0],
    ],
    tone: {
      ...BASE_TONE,
      bassCutoff: 600,
      bassEnv: 2.5,
      bassQ: 4,
      arpWave: 'sawtooth',
      arpCutoff: 3200,
      arpDecay: 0.12,
      leadCutoff: 4200,
      leadDetune: 18,
      padCutoff: 1800,
      kickPitch: 1.05,
      hatTone: 9000,
    },
  },
  breaks: {
    id: 'breaks',
    kick: [E, 'X.....X...X.....', 'X.....X...X.....', 'X.....X..XX.....', 'X.X...X..XX...X.'],
    snare: [E, '....X.......X...', '....X.......X...', '....X..o....X.o.', '....X..o.o..X.oX'],
    hat: [E, 'x.x.x.x.x.x.x.x.', 'xoxoxoxoxoxoxoxo', 'xoxoxoxoxoxoxoxo', 'xxxxxxxxxxxxxxxx'],
    ohat: [E, E, '..............o.', '......o.......o.', '..o...o...o...o.'],
    perc: fill5(E),
    bass: ['', 'R..R..R.R..R....', 'R..R..R.R..R.R..', 'R..R..R.R.RR.R.O', 'R.RR.RR.R.RR.ROR'],
    arp: ['0..1..2..1..0...', null, '0.1.2.1.0.1.2.3.', '0123012301230123', '0213243502132435'],
    counter: [false, false, true, false, false],
    lead: [false, false, false, true, true],
    pad: [true, true, true, true, true],
    padGate: [null, null, null, null, null],
    stab: ['', '', '', '', 'X..X..X..X..X.X.'],
    clap: false,
    toms: false,
    swing: 0,
    progressionsA: [
      [0, 5, 3, 4],
      [0, 3, 5, 4],
      [3, 4, 0, 0],
    ],
    progressionsB: [
      [0, 5, 1, 4],
      [5, 4, 0, 0],
      [0, 3, 4, 4],
    ],
    tone: {
      ...BASE_TONE,
      bassCutoff: 500,
      bassEnv: 4,
      bassQ: 9,
      bassDrive: 0.6,
      arpWave: 'square',
      arpCutoff: 2000,
      arpDecay: 0.1,
      arpOct: 1,
      leadCutoff: 2800,
      leadDetune: 12,
      padCutoff: 1200,
      kickPitch: 1.1,
      hatTone: 7000,
    },
  },
  epic: {
    id: 'epic',
    kick: [E, 'X.........X.....', 'X.........X.....', 'X.....X...X.....', 'X.....X...X...X.'],
    snare: [E, '........X.......', '........X.......', '........X.......', '....X.......X...'],
    hat: [E, 'x...x...x...x...', 'x.x.x.x.x.x.x.x.', 'xoxoxoxoxoxoxoxo', 'xoxoxoxoxoxoxoxo'],
    ohat: [E, E, '......o.......o.', '..o.......o.....', '..o...o...o...o.'],
    perc: fill5(E),
    bass: ['', 'R-------R-------', 'R---R---R---5---', 'R-R-R-R-R-R-R-RO', 'RORORORORORORORO'],
    arp: ['0---2---4---2---', '0.2.4.2.0.2.4.2.', '0242024202420242', '0245024502450245', '0356035603560356'],
    counter: [false, false, true, false, false],
    lead: [false, false, false, true, true],
    pad: [true, true, true, true, true],
    padGate: [null, null, null, null, null],
    stab: ['', '', '', '', 'X.....X.....X...'],
    clap: false,
    toms: true,
    swing: 0,
    progressionsA: [
      [0, 5, 2, 6],
      [0, 3, 5, 6],
      [5, 6, 0, 0],
    ],
    progressionsB: [
      [0, 5, 6, 4],
      [5, 3, 0, 6],
      [0, 6, 5, 4],
    ],
    tone: {
      ...BASE_TONE,
      bassCutoff: 380,
      bassEnv: 3,
      bassQ: 5,
      arpWave: 'sawtooth',
      arpCutoff: 2600,
      arpDecay: 0.14,
      leadCutoff: 3600,
      leadDetune: 14,
      padCutoff: 1000,
      kickPitch: 0.9,
    },
  },
  ending: {
    id: 'ending',
    kick: [E, 'X.......X.......', 'X...X...X...X...', 'X...X...X...X...', 'X...X...X...X...'],
    snare: [E, E, '....X.......X...', '....X.......X...', '....X.......X...'],
    hat: [E, '..-...-...-...-.', 'o.x.o.x.o.x.o.x.', 'o.x.o.x.o.x.o.x.', 'xoxoxoxoxoxoxoxo'],
    ohat: fill5(E),
    perc: fill5(E),
    bass: ['', 'R-------R-------', 'R-R-R-R-R-R-R-R-', 'R.RRR.RRR.RRR.RR', 'RORORORORORORORO'],
    arp: ['0..2..4..3..2...', '0..2..4..3..2...', '0234023402340234', '0123432101234321', '0356035603560356'],
    counter: [false, true, false, false, false],
    lead: [false, false, true, true, true],
    pad: [true, true, true, true, true],
    padGate: [null, null, null, null, null],
    stab: fill5(''),
    clap: false,
    toms: false,
    swing: 0,
    progressionsA: [[0, 4, 5, 3]],
    progressionsB: [[3, 4, 0, 5]],
    tone: { ...BASE_TONE, arpWave: 'triangle', arpDecay: 0.3, leadWave: 'triangle', leadCutoff: 2600, padCutoff: 1300 },
  },
};

/* ------------------------------------------------------------------ */
/* Parsing helpers                                                     */
/* ------------------------------------------------------------------ */

export function parseDrums(p: string): Float32Array {
  const out = new Float32Array(16);
  for (let i = 0; i < 16 && i < p.length; i++) {
    const c = p[i];
    out[i] = c === 'X' ? 1 : c === 'x' ? 0.75 : c === 'o' ? 0.5 : c === '-' ? 0.28 : 0;
  }
  return out;
}

interface Onset {
  step: number;
  dur: number;
}

/** 'x' starts a note, '-' holds it, '.' is silence. */
export function parseRhythm(p: string): Onset[] {
  const out: Onset[] = [];
  let cur: Onset | null = null;
  for (let i = 0; i < 16; i++) {
    const c = p[i] ?? '.';
    if (c === 'x' || c === 'X') {
      cur = { step: i, dur: 1 };
      out.push(cur);
    } else if (c === '-' && cur) {
      cur.dur++;
    } else {
      cur = null;
    }
  }
  return out;
}

const RHYTHMS_A = [
  'x--x--x-x---x---',
  'x---x---x-x-x---',
  'x-x-x---x---x-x-',
  'x--x--x---x-x---',
  'x---x--x--x-x---',
  'x-----x-x---x---',
  'x--x--x--x--x-x-',
  'x---x-x---x-x-x-',
];
const RHYTHMS_B = [
  'x-x-x-x-x--x--x-',
  'x-xx-x-xx-x-x-x-',
  'x--x--x-x-x-x---',
  'x-x--x--x-x--x--',
  'x-xxx-x-x-xxx-x-',
  'x--xx--xx--xx-x-',
];
const RHYTHMS_CAD = ['x-------x-------', 'x-----------x-x-', 'x-------x---x---'];

interface Motif {
  onsets: Onset[];
  intervals: number[];
  startTone: number;
}

function makeMotif(rng: RNG, rhythm: string): Motif {
  const onsets = parseRhythm(rhythm);
  const intervals = [0];
  const steps = [-3, -2, -1, 0, 1, 2, 3];
  const w = [0.5, 1.6, 3, 0.7, 3, 1.6, 0.5];
  let sum = 0;
  for (let i = 1; i < onsets.length; i++) {
    let iv = rng.weighted(steps, (s) => w[steps.indexOf(s)]);
    // keep the motif inside a comfortable span
    if (sum + iv > 5 || sum + iv < -5) iv = -iv;
    sum += iv;
    intervals.push(iv);
  }
  return { onsets, intervals, startTone: rng.pick([0, 1, 2, 2]) };
}

function varyMotif(rng: RNG, m: Motif, tail: number): Motif {
  const intervals = m.intervals.slice();
  for (let i = Math.max(1, intervals.length - tail); i < intervals.length; i++) {
    intervals[i] = rng.pick([-2, -1, 1, 2, -3, 3]);
  }
  return { onsets: m.onsets, intervals, startTone: m.startTone };
}

const LEAD_LO = 6;
const LEAD_HI = 16;

function realize(scale: Scale, m: Motif, chordDeg: number, prevDeg: number, velBase: number): { notes: NoteEv[]; last: number } {
  let start = chordDeg + 2 * m.startTone;
  while (start < prevDeg - 3) start += 7;
  while (start > prevDeg + 3) start -= 7;
  while (start < LEAD_LO) start += 7;
  while (start > LEAD_HI) start -= 7;
  let deg = start;
  const notes: NoteEv[] = [];
  for (let i = 0; i < m.onsets.length; i++) {
    const on = m.onsets[i];
    if (i > 0) deg += m.intervals[i];
    if (deg > LEAD_HI) deg -= 2 * (deg - LEAD_HI);
    if (deg < LEAD_LO) deg += 2 * (LEAD_LO - deg);
    const strong = on.step % 8 === 0;
    if (strong && !scale.isChordTone(deg, chordDeg)) deg = scale.nearestChordTone(deg, chordDeg);
    notes.push({
      step: on.step,
      dur: Math.max(1, on.dur),
      midi: scale.note(deg),
      vel: velBase * (strong ? 1 : on.step % 4 === 0 ? 0.88 : 0.76),
    });
  }
  return { notes, last: deg };
}

function cadence(scale: Scale, rng: RNG, chordDeg: number, prevDeg: number, velBase: number): { notes: NoteEv[]; last: number } {
  const onsets = parseRhythm(rng.pick(RHYTHMS_CAD));
  let deg = scale.nearestChordTone(prevDeg, chordDeg);
  if (deg > LEAD_HI) deg -= 7;
  if (deg < LEAD_LO) deg += 7;
  const notes: NoteEv[] = onsets.map((on, i) => {
    const d = i === 0 ? deg : scale.nearestChordTone(deg + (i % 2 === 0 ? 0 : 2), chordDeg);
    return { step: on.step, dur: on.dur, midi: scale.note(d), vel: velBase * (i === 0 ? 1 : 0.8) };
  });
  return { notes, last: deg };
}

function generatePhrase(rng: RNG, scale: Scale, prog: number[], rhythms: string[], velBase: number): NoteEv[][] {
  const A = makeMotif(rng, rng.pick(rhythms));
  const B = makeMotif(rng, rng.pick(rhythms));
  const A2 = varyMotif(rng, A, 2);
  const B2 = varyMotif(rng, B, 2);
  const plan: (Motif | 'cad')[] = [A, A2, B, B2, A, A2, B, 'cad'];
  let prev = 9;
  const out: NoteEv[][] = [];
  for (let bar = 0; bar < 8; bar++) {
    const chordDeg = prog[bar % prog.length];
    const p = plan[bar];
    const r = p === 'cad' ? cadence(scale, rng, chordDeg, prev, velBase) : realize(scale, p, chordDeg, prev, velBase);
    out.push(r.notes);
    prev = r.last;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Song                                                                */
/* ------------------------------------------------------------------ */

interface Section {
  prog: number[];
  voicings: number[][];
  lead: NoteEv[][];
}

export class Song {
  readonly style: StyleDef;
  readonly scale: Scale;
  private readonly A: Section;
  private readonly B: Section;

  constructor(readonly spec: SongSpec) {
    this.style = STYLES[spec.style];
    this.scale = new Scale(spec.root, spec.mode);
    const rng = new RNG(spec.seed);
    this.A = this.makeSection(rng.fork(1), this.style.progressionsA, RHYTHMS_A, 0.8);
    this.B = this.makeSection(rng.fork(2), this.style.progressionsB, RHYTHMS_B, 0.9);
  }

  get bpm(): number {
    return this.spec.bpm;
  }

  private makeSection(rng: RNG, progs: number[][], rhythms: string[], vel: number): Section {
    const base = rng.pick(progs);
    // 8-bar phrase: the progression twice, the second time sometimes with a turnaround
    const prog = base.concat(base);
    if (rng.chance(0.5) && this.scale.mode === 'harmonicMinor') prog[7] = 4;
    const voicings: number[][] = [];
    let prev: number[] | null = null;
    for (const d of prog) {
      const size = rng.chance(0.35) ? 4 : 3;
      const v = voiceLead(this.scale.chord(d, size), prev, 52, 72);
      voicings.push(v);
      prev = v;
    }
    const lead = generatePhrase(rng, this.scale, prog, rhythms, vel);
    return { prog, voicings, lead };
  }

  sectionFor(intensity: number): 'A' | 'B' {
    return intensity >= 3 ? 'B' : 'A';
  }

  chordDegAt(section: 'A' | 'B', bar: number): number {
    const s = section === 'A' ? this.A : this.B;
    return s.prog[((bar % 8) + 8) % 8];
  }

  /** Root-position chord notes around the arp register, for pitching sound effects. */
  chordTones(section: 'A' | 'B', bar: number): number[] {
    const d = this.chordDegAt(section, bar);
    return this.scale.chord(d, 3).map((n) => n + 12);
  }

  private bassNote(chordDeg: number, kind: string): number {
    const tone = this.style.tone;
    const base = this.spec.root + 12 * tone.bassOct;
    const lo = base - 5;
    const pick = (deg: number): number => {
      const pc = ((this.scale.note(deg) % 12) + 12) % 12;
      let n = lo + ((pc - lo) % 12 + 12) % 12;
      if (n < lo) n += 12;
      return n;
    };
    switch (kind) {
      case 'O':
        return pick(chordDeg) + 12;
      case '5':
        return pick(chordDeg + 4);
      case '3':
        return pick(chordDeg + 2);
      default:
        return pick(chordDeg);
    }
  }

  bar(sectionBar: number, intensity: number): BarScore {
    const st = this.style;
    const lvl = Math.max(0, Math.min(4, Math.round(intensity)));
    const section = this.sectionFor(lvl);
    const sec = section === 'A' ? this.A : this.B;
    const bi = ((sectionBar % 8) + 8) % 8;
    const chordDeg = sec.prog[bi];
    const voicing = sec.voicings[bi];
    const tone = st.tone;

    const score: BarScore = {
      kick: parseDrums(st.kick[lvl]),
      snare: parseDrums(st.snare[lvl]),
      hat: parseDrums(st.hat[lvl]),
      ohat: parseDrums(st.ohat[lvl]),
      perc: parseDrums(st.perc[lvl]),
      bass: [],
      arp: [],
      lead: [],
      counter: [],
      pad: [],
      stab: [],
      chord: voicing,
      chordDeg,
      section,
    };

    // Bass
    const bp = st.bass[lvl];
    if (bp) {
      let cur: NoteEv | null = null;
      for (let i = 0; i < 16; i++) {
        const c = bp[i];
        if (c === '-' && cur) {
          cur.dur++;
        } else if (c === '.' || c === undefined) {
          cur = null;
        } else {
          cur = { step: i, dur: 1, midi: this.bassNote(chordDeg, c), vel: i % 4 === 0 ? 1 : 0.78 };
          score.bass.push(cur);
        }
      }
    }

    // Arpeggio over an extended chord
    const ap = st.arp[lvl];
    if (ap) {
      const triad = this.scale.chord(chordDeg, 3).map((n) => n + 12 * tone.arpOct);
      // keep the arp register stable regardless of chord root
      while (triad[0] > this.spec.root + 12 * tone.arpOct + 6) for (let k = 0; k < 3; k++) triad[k] -= 12;
      const ext = [triad[0], triad[1], triad[2], triad[0] + 12, triad[1] + 12, triad[2] + 12, triad[0] + 24];
      let cur: NoteEv | null = null;
      for (let i = 0; i < 16; i++) {
        const c = ap[i];
        if (c === '-' && cur) cur.dur++;
        else if (c >= '0' && c <= '6') {
          cur = { step: i, dur: 1, midi: ext[c.charCodeAt(0) - 48], vel: i % 4 === 0 ? 0.9 : 0.7 };
          score.arp.push(cur);
        } else cur = null;
      }
    }

    // Lead melody
    if (st.lead[lvl]) {
      const up = lvl >= 4 ? 12 : 0;
      for (const n of sec.lead[bi]) {
        score.lead.push({ ...n, midi: n.midi + 12 * tone.leadOct + up, vel: Math.min(1, n.vel * (lvl >= 4 ? 1.1 : 1)) });
      }
    }

    // Counter line: chord tones held under the groove
    if (st.counter[lvl]) {
      const t3 = this.scale.note(chordDeg + 2 + 7);
      const t5 = this.scale.note(chordDeg + 4 + 7);
      score.counter.push({ step: 0, dur: 6, midi: t5, vel: 0.55 });
      score.counter.push({ step: 6, dur: 4, midi: t3, vel: 0.5 });
      score.counter.push({ step: 10, dur: 6, midi: t5, vel: 0.5 });
    }

    // Pads
    if (st.pad[lvl]) {
      const gate = st.padGate[lvl];
      if (gate) {
        for (const on of parseRhythm(gate)) score.pad.push({ step: on.step, dur: on.dur, midis: voicing, vel: 0.5 });
      } else {
        score.pad.push({ step: 0, dur: 16, midis: voicing, vel: lvl === 0 ? 0.62 : 0.5 });
      }
    }

    // Stabs
    const sp = st.stab[lvl];
    if (sp) {
      for (let i = 0; i < 16; i++) {
        const c = sp[i];
        if (c === 'X' || c === 'x') score.stab.push({ step: i, dur: 2, midis: voicing.map((n) => n + 12), vel: c === 'X' ? 1 : 0.75 });
      }
    }
    return score;
  }
}

/* ------------------------------------------------------------------ */
/* Song catalogue used by the game                                     */
/* ------------------------------------------------------------------ */

export interface SongPreset {
  style: StyleId;
  root: number;
  mode: ModeName;
  bpm: number;
}

export const TITLE_SONG: SongPreset = { style: 'title', root: 50, mode: 'dorian', bpm: 92 };
export const ENDING_SONG: SongPreset = { style: 'ending', root: 55, mode: 'ionian', bpm: 112 };

export function makeSong(preset: SongPreset, seed: number): Song {
  return new Song({ seed, ...preset });
}
