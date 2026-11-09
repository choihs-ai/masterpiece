import type { SongPreset } from '../audio/composer';
import type { Difficulty, ShipId } from '../core/save';
import type { BossId, EnemyId } from './ids';

export interface Palette {
  bgTop: string;
  bgBottom: string;
  nebulaA: string;
  nebulaB: string;
  grid: string;
  star: string;
  accent: string;
  enemyA: string;
  enemyB: string;
  bulletA: string;
  bulletB: string;
  bulletC: string;
}

export interface SectorDef {
  index: number;
  key: string;
  song: SongPreset;
  palette: Palette;
  roster: EnemyId[];
  boss: BossId;
  hpMul: number;
  speedMul: number;
  densityMul: number;
  scenery: 'aurora' | 'tide' | 'crystal' | 'giant' | 'horizon';
}

export const SECTORS: SectorDef[] = [
  {
    index: 0,
    key: 's1',
    song: { style: 'synthwave', root: 57, mode: 'aeolian', bpm: 118 },
    palette: {
      bgTop: '#0a0624',
      bgBottom: '#1b0b3b',
      nebulaA: '#00c2d1',
      nebulaB: '#5b3dff',
      grid: '#7b4dff',
      star: '#cfe8ff',
      accent: '#5ef2ff',
      enemyA: '#ff4fa3',
      enemyB: '#ffb347',
      bulletA: '#ff3d7f',
      bulletB: '#ffb13b',
      bulletC: '#ffe95c',
    },
    roster: ['dart', 'weaver', 'mine', 'sentinel'],
    boss: 'herald',
    hpMul: 1,
    speedMul: 1,
    densityMul: 1,
    scenery: 'aurora',
  },
  {
    index: 1,
    key: 's2',
    song: { style: 'deephouse', root: 50, mode: 'dorian', bpm: 124 },
    palette: {
      bgTop: '#02101c',
      bgBottom: '#05283a',
      nebulaA: '#14b8ff',
      nebulaB: '#1affc6',
      grid: '#0fa3c9',
      star: '#d8fbff',
      accent: '#3cf5d0',
      enemyA: '#ff6b6b',
      enemyB: '#ffd84d',
      bulletA: '#ff5470',
      bulletB: '#ffe44d',
      bulletC: '#ff9a3c',
    },
    roster: ['dart', 'weaver', 'mine', 'sentinel', 'lancer', 'spinner'],
    boss: 'tidecaller',
    hpMul: 1.75,
    speedMul: 1.04,
    densityMul: 1.08,
    scenery: 'tide',
  },
  {
    index: 2,
    key: 's3',
    song: { style: 'trance', root: 54, mode: 'aeolian', bpm: 130 },
    palette: {
      bgTop: '#0b0620',
      bgBottom: '#24104a',
      nebulaA: '#a77bff',
      nebulaB: '#8fe6ff',
      grid: '#c6b3ff',
      star: '#f2ecff',
      accent: '#d9c8ff',
      enemyA: '#ff5fd2',
      enemyB: '#7dffb2',
      bulletA: '#ff4fd8',
      bulletB: '#6dff9e',
      bulletC: '#ffd36b',
    },
    roster: ['dart', 'weaver', 'sentinel', 'lancer', 'spinner', 'sniper', 'splitter'],
    boss: 'archon',
    hpMul: 2.7,
    speedMul: 1.08,
    densityMul: 1.15,
    scenery: 'crystal',
  },
  {
    index: 3,
    key: 's4',
    song: { style: 'breaks', root: 48, mode: 'harmonicMinor', bpm: 138 },
    palette: {
      bgTop: '#160404',
      bgBottom: '#3a0d06',
      nebulaA: '#ff6a00',
      nebulaB: '#ff1f4b',
      grid: '#ff8c2b',
      star: '#ffe9d6',
      accent: '#ffb35c',
      enemyA: '#c77dff',
      enemyB: '#59ffb4',
      bulletA: '#d277ff',
      bulletB: '#ff59e6',
      bulletC: '#a6ff6a',
    },
    roster: ['dart', 'mine', 'sentinel', 'lancer', 'spinner', 'sniper', 'splitter', 'bulwark'],
    boss: 'tyrant',
    hpMul: 3.8,
    speedMul: 1.12,
    densityMul: 1.22,
    scenery: 'giant',
  },
  {
    index: 4,
    key: 's5',
    song: { style: 'epic', root: 52, mode: 'aeolian', bpm: 146 },
    palette: {
      bgTop: '#010103',
      bgBottom: '#0d0720',
      nebulaA: '#6b2cff',
      nebulaB: '#ffcc4d',
      grid: '#5c4a9e',
      star: '#ffffff',
      accent: '#ffe28a',
      enemyA: '#ff4d6d',
      enemyB: '#ffd166',
      bulletA: '#ff4d6d',
      bulletB: '#ffd166',
      bulletC: '#b48cff',
    },
    roster: ['dart', 'weaver', 'sentinel', 'lancer', 'spinner', 'sniper', 'splitter', 'bulwark', 'carrier'],
    boss: 'silence',
    hpMul: 5,
    speedMul: 1.15,
    densityMul: 1.28,
    scenery: 'horizon',
  },
];

export interface DiffParams {
  hpBonus: number;
  bulletSpeed: number;
  density: number;
  enemyHp: number;
  bossHp: number;
  budget: number;
  scoreMul: number;
  hitbox: number;
}

export const DIFFICULTY: Record<Difficulty, DiffParams> = {
  easy: { hpBonus: 3, bulletSpeed: 0.8, density: 0.62, enemyHp: 0.8, bossHp: 0.75, budget: 0.85, scoreMul: 0.6, hitbox: 0.36 },
  normal: { hpBonus: 0, bulletSpeed: 1, density: 1, enemyHp: 1, bossHp: 1, budget: 1, scoreMul: 1, hitbox: 0.45 },
  hard: { hpBonus: -1, bulletSpeed: 1.13, density: 1.3, enemyHp: 1.2, bossHp: 1.2, budget: 1.18, scoreMul: 1.6, hitbox: 0.45 },
};

export interface ShipDef {
  id: ShipId;
  color: string;
  hp: number;
  speed: number;
  damage: number;
  start: Partial<Record<string, number>>;
}

export const SHIPS: Record<ShipId, ShipDef> = {
  echo: { id: 'echo', color: '#5ef2ff', hp: 5, speed: 1, damage: 1, start: {} },
  aegis: { id: 'aegis', color: '#7dffa8', hp: 7, speed: 0.92, damage: 0.9, start: { orbital: 2 } },
  volt: { id: 'volt', color: '#ffe066', hp: 4, speed: 1.12, damage: 1.1, start: { chain: 1, overclock: 1 } },
};

export const SHIP_ORDER: ShipId[] = ['echo', 'aegis', 'volt'];
