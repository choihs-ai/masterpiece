/**
 * Wave composer. Builds a spawn schedule (in 16th-note steps) from a threat budget, so
 * every run differs while difficulty ramps predictably. Groups start on beats/bars.
 */
import type { RNG } from '../core/rng';
import type { PathKind, SpawnSpec } from './enemies';
import type { EnemyId } from './ids';
import type { SectorDef } from './sectors';

export interface WaveEntry {
  at: number;
  spec: SpawnSpec;
}

export interface WavePlan {
  entries: WaveEntry[];
  length: number;
}

type Kind = Exclude<EnemyId, 'boss'>;

const COST: Record<Kind, number> = {
  dart: 1,
  weaver: 2,
  mine: 1.5,
  sentinel: 5,
  lancer: 2.5,
  spinner: 7,
  sniper: 6,
  splitter: 7,
  bulwark: 12,
  carrier: 18,
};

const WEIGHT: Record<Kind, number> = {
  dart: 5,
  weaver: 3,
  mine: 2,
  sentinel: 3,
  lancer: 2.5,
  spinner: 2.2,
  sniper: 2,
  splitter: 2,
  bulwark: 1.4,
  carrier: 1,
};

interface Group {
  entries: WaveEntry[];
  cost: number;
}

const beatAlign = (n: number): number => Math.ceil(n / 4) * 4;

function dartGroup(rng: RNG, sector: number, elite: boolean): Group {
  const style = rng.int(0, 4);
  const out: WaveEntry[] = [];
  const shooterEvery = sector === 0 ? 3 : 2;
  const dir = rng.sign();
  switch (style) {
    case 0: {
      // snake following a swoop
      const n = rng.int(5, 7);
      for (let i = 0; i < n; i++) {
        out.push({ at: i * 2, spec: { kind: 'dart', x: -dir * rng.range(12, 20), path: 'swoop', dir, shooter: i % shooterEvery === 1, elite: elite && i === 0 } });
      }
      break;
    }
    case 1: {
      // mirrored snakes
      const n = rng.int(3, 4);
      for (let i = 0; i < n; i++) {
        for (const d of [-1, 1]) out.push({ at: i * 2, spec: { kind: 'dart', x: -d * 16, path: 'swoop', dir: d, shooter: i === 1 } });
      }
      break;
    }
    case 2: {
      // V formation diving
      const xs = [-12, -6, 0, 6, 12];
      xs.forEach((x, i) => out.push({ at: Math.abs(i - 2) * 1, spec: { kind: 'dart', x, path: 'dive', dir: x < 0 ? -1 : 1, shooter: i === 2, elite: elite && i === 2 } }));
      break;
    }
    case 3: {
      // rain
      const n = rng.int(5, 7);
      for (let i = 0; i < n; i++) out.push({ at: i * 4, spec: { kind: 'dart', x: rng.range(-22, 22), path: 'rain', dir: rng.sign(), shooter: i % 2 === 0 } });
      break;
    }
    default: {
      // crossing line
      const n = 5;
      const y = rng.range(22, 38);
      for (let i = 0; i < n; i++) out.push({ at: i * 2, spec: { kind: 'dart', x: 0, y, path: 'cross', dir, shooter: i % 2 === 0 } });
      break;
    }
  }
  return { entries: out, cost: out.length * COST.dart * (elite ? 1.5 : 1) };
}

function groupFor(kind: Kind, rng: RNG, sector: number, elite: boolean): Group {
  const out: WaveEntry[] = [];
  const add = (at: number, spec: Omit<SpawnSpec, 'kind'>): void => {
    out.push({ at, spec: { kind, elite, ...spec } });
  };
  switch (kind) {
    case 'dart':
      return dartGroup(rng, sector, elite);
    case 'weaver': {
      const xs = rng.chance(0.5) ? [-16, 0, 16] : [-10, 10];
      xs.forEach((x, i) => add(0, { x, dir: i % 2 ? 1 : -1, elite: elite && i === 0 }));
      break;
    }
    case 'mine': {
      const n = rng.int(3, 5);
      for (let i = 0; i < n; i++) add(i * 4, { x: rng.range(-22, 22), dir: rng.sign(), elite: false });
      break;
    }
    case 'sentinel': {
      if (rng.chance(0.55)) {
        add(0, { x: -13, y: rng.range(26, 34), hold: 64 });
        add(4, { x: 13, y: rng.range(26, 34), hold: 64, elite: false });
      } else add(0, { x: rng.range(-10, 10), y: rng.range(26, 36), hold: 64 });
      break;
    }
    case 'lancer': {
      const n = rng.int(2, 3);
      for (let i = 0; i < n; i++) add(i * 4, { x: rng.range(-20, 20), y: rng.range(32, 42), elite: elite && i === 0 });
      break;
    }
    case 'spinner':
      add(0, { x: rng.pick([-13, 0, 13]), y: rng.range(20, 30), hold: 80 });
      break;
    case 'sniper': {
      add(0, { x: 0, dir: -1, y: rng.range(34, 42), hold: 96 });
      if (rng.chance(0.5)) add(8, { x: 0, dir: 1, y: rng.range(34, 42), hold: 96, elite: false });
      break;
    }
    case 'splitter':
      add(0, { x: rng.range(-12, 12), y: rng.range(26, 34), hold: 72 });
      break;
    case 'bulwark':
      add(0, { x: rng.range(-6, 6), y: 26, hold: 128 });
      break;
    case 'carrier':
      add(0, { x: 0, y: 34, hold: 128 });
      break;
  }
  const cost = out.reduce((s, e) => s + COST[e.spec.kind as Kind] * (e.spec.elite ? 2 : 1), 0);
  return { entries: out, cost };
}

/** Hand-made opening wave: teaches dodging, fans, mines and the beat. */
function tutorialWave(): WavePlan {
  const e: WaveEntry[] = [];
  const snake = (at: number, dir: number, n: number, shooters: boolean): void => {
    for (let i = 0; i < n; i++) e.push({ at: at + i * 2, spec: { kind: 'dart', x: -dir * 16, path: 'swoop', dir, shooter: shooters && i % 3 === 1 } });
  };
  snake(0, 1, 6, false);
  snake(24, -1, 6, true);
  [-16, 0, 16].forEach((x, i) => e.push({ at: 48, spec: { kind: 'weaver', x, dir: i % 2 ? 1 : -1 } }));
  [-12, -6, 0, 6, 12].forEach((x, i) => e.push({ at: 72 + Math.abs(i - 2), spec: { kind: 'dart', x, path: 'dive', dir: x < 0 ? -1 : 1, shooter: i === 2 } }));
  e.push({ at: 96, spec: { kind: 'sentinel', x: -12, y: 30, hold: 48 } });
  e.push({ at: 100, spec: { kind: 'sentinel', x: 12, y: 32, hold: 48 } });
  for (let i = 0; i < 4; i++) e.push({ at: 128 + i * 4, spec: { kind: 'mine', x: -18 + i * 12, dir: i % 2 ? 1 : -1 } });
  snake(152, 1, 5, true);
  snake(152, -1, 5, false);
  e.sort((a, b) => a.at - b.at);
  return { entries: e, length: 184 };
}

export function buildWave(rng: RNG, sector: SectorDef, wave: number, budgetMul: number): WavePlan {
  if (sector.index === 0 && wave === 0) return tutorialWave();
  let budget = (26 + 9 * sector.index + 10 * wave) * budgetMul;
  const entries: WaveEntry[] = [];
  let cursor = 0;
  const roster = sector.roster.filter((k): k is Kind => k !== 'boss');
  let first = true;
  let guard = 0;
  while (budget > 0 && guard++ < 40) {
    const climax = budget < 14;
    let kind: Kind;
    if (first) kind = 'dart';
    else if (climax) {
      const heavy = roster.filter((k) => COST[k] >= 5 && COST[k] <= budget + 6);
      kind = heavy.length ? rng.pick(heavy) : 'dart';
    } else {
      kind = rng.weighted(roster, (k) => (COST[k] <= budget + 4 ? WEIGHT[k] : 0));
    }
    const elite = (climax && sector.index >= 1) || (sector.index >= 2 && rng.chance(0.08 + 0.04 * sector.index));
    const g = groupFor(kind, rng, sector.index, elite);
    for (const en of g.entries) entries.push({ at: cursor + en.at, spec: en.spec });
    // mid-size enemies get a little company
    if (!first && COST[kind] >= 5 && rng.chance(0.5)) {
      const d = dartGroup(rng, sector.index, false);
      const off = beatAlign(rng.int(8, 20));
      for (const en of d.entries) entries.push({ at: cursor + off + en.at, spec: en.spec });
      budget -= d.cost * 0.6;
    }
    budget -= g.cost;
    cursor += beatAlign(14 + g.cost * 2.4 - sector.index * 1.5);
    first = false;
  }
  entries.sort((a, b) => a.at - b.at);
  const last = entries.length ? entries[entries.length - 1].at : 0;
  return { entries, length: last + 16 };
}

export function pathKinds(): PathKind[] {
  return ['swoop', 'dive', 'uturn', 'cross', 'rain'];
}
