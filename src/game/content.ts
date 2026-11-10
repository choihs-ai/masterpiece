/** Static game data: stages, upgrades, difficulty. Pure data, no logic. */
import type { SongPreset } from '../audio/composer';
import type { Difficulty } from '../core/save';

export type EnemyKind = 'wasp' | 'hornet' | 'lantern' | 'mine' | 'turret' | 'bulwark';
export type BossId = 'colossus' | 'maelstrom' | 'warden';
export type Terrain = 'canyon' | 'ocean' | 'peaks';

export interface StageLook {
  /** sun elevation / azimuth in degrees for the physical sky */
  elevation: number;
  azimuth: number;
  turbidity: number;
  rayleigh: number;
  mie: number;
  exposure: number;
  fog: string;
  fogNear: number;
  fogFar: number;
  sun: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  ground: [string, string, string];
  accent: string;
  enemyGlow: string;
  bulletA: string;
  bulletB: string;
  night: boolean;
}

export interface StageDef {
  key: string;
  terrain: Terrain;
  song: SongPreset;
  look: StageLook;
  roster: EnemyKind[];
  boss: BossId;
  hpMul: number;
  speedMul: number;
}

export const STAGES: StageDef[] = [
  {
    key: 'st1',
    terrain: 'canyon',
    song: { style: 'synthwave', root: 57, mode: 'aeolian', bpm: 120 },
    look: {
      elevation: 4,
      azimuth: 180,
      turbidity: 9,
      rayleigh: 2.6,
      mie: 0.012,
      exposure: 0.55,
      fog: '#e7956a',
      fogNear: 60,
      fogFar: 330,
      sun: '#ffd2a0',
      sunIntensity: 3.2,
      hemiSky: '#ffc49a',
      hemiGround: '#4a2216',
      ground: ['#c26a3c', '#8a3d24', '#f2b07a'],
      accent: '#ffb35c',
      enemyGlow: '#ff3b2f',
      bulletA: '#ff4a6a',
      bulletB: '#ffd04a',
      night: false,
    },
    roster: ['wasp', 'hornet', 'lantern', 'turret', 'mine'],
    boss: 'colossus',
    hpMul: 1,
    speedMul: 1,
  },
  {
    key: 'st2',
    terrain: 'ocean',
    song: { style: 'breaks', root: 48, mode: 'harmonicMinor', bpm: 134 },
    look: {
      elevation: 1.5,
      azimuth: 140,
      turbidity: 14,
      rayleigh: 1.2,
      mie: 0.02,
      exposure: 0.42,
      fog: '#3c4c63',
      fogNear: 40,
      fogFar: 300,
      sun: '#b8c8ff',
      sunIntensity: 2.2,
      hemiSky: '#8fa5c8',
      hemiGround: '#0b1622',
      ground: ['#1b3b52', '#0a1a28', '#7fa6c4'],
      accent: '#7fe0ff',
      enemyGlow: '#ff6a2a',
      bulletA: '#ff5a3a',
      bulletB: '#ffe06a',
      night: false,
    },
    roster: ['wasp', 'hornet', 'lantern', 'mine', 'bulwark'],
    boss: 'maelstrom',
    hpMul: 1.9,
    speedMul: 1.06,
  },
  {
    key: 'st3',
    terrain: 'peaks',
    song: { style: 'epic', root: 52, mode: 'aeolian', bpm: 142 },
    look: {
      elevation: -3,
      azimuth: 200,
      turbidity: 2,
      rayleigh: 0.6,
      mie: 0.004,
      exposure: 0.3,
      fog: '#1a2448',
      fogNear: 70,
      fogFar: 360,
      sun: '#9fb4ff',
      sunIntensity: 1.6,
      hemiSky: '#5868b8',
      hemiGround: '#141030',
      ground: ['#c8d4f0', '#3a4470', '#ffffff'],
      accent: '#8affd8',
      enemyGlow: '#ff3a8a',
      bulletA: '#ff4aa0',
      bulletB: '#a4ff6a',
      night: true,
    },
    roster: ['wasp', 'hornet', 'lantern', 'turret', 'mine', 'bulwark'],
    boss: 'warden',
    hpMul: 3.2,
    speedMul: 1.12,
  },
];

export type UpgradeId = 'guns' | 'power' | 'rate' | 'locks' | 'warhead' | 'hull' | 'repair' | 'roll' | 'nova' | 'drone' | 'rail';
export type Rarity = 'common' | 'rare' | 'epic';

export interface UpgradeDef {
  id: UpgradeId;
  max: number;
  rarity: Rarity;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'guns', max: 2, rarity: 'rare' },
  { id: 'power', max: 4, rarity: 'common' },
  { id: 'rate', max: 2, rarity: 'rare' },
  { id: 'locks', max: 2, rarity: 'common' },
  { id: 'warhead', max: 3, rarity: 'common' },
  { id: 'hull', max: 3, rarity: 'common' },
  { id: 'repair', max: 99, rarity: 'common' },
  { id: 'roll', max: 2, rarity: 'common' },
  { id: 'nova', max: 1, rarity: 'epic' },
  { id: 'drone', max: 2, rarity: 'epic' },
  { id: 'rail', max: 1, rarity: 'epic' },
];

export const UPGRADE_MAP = Object.fromEntries(UPGRADES.map((u) => [u.id, u])) as Record<UpgradeId, UpgradeDef>;

export interface DiffParams {
  hp: number;
  bulletSpeed: number;
  density: number;
  enemyHp: number;
  scoreMul: number;
  hitbox: number;
}

export const DIFFICULTY: Record<Difficulty, DiffParams> = {
  easy: { hp: 8, bulletSpeed: 0.78, density: 0.6, enemyHp: 0.8, scoreMul: 0.6, hitbox: 0.5 },
  normal: { hp: 5, bulletSpeed: 1, density: 1, enemyHp: 1, scoreMul: 1, hitbox: 0.62 },
  hard: { hp: 4, bulletSpeed: 1.15, density: 1.3, enemyHp: 1.25, scoreMul: 1.6, hitbox: 0.62 },
};

/** Playfield the ship can occupy (camera-relative corridor). */
export const FIELD = { x: 13, yMin: 0.6, yMax: 11 };
/** Forward speed of the world, units per second. */
export const WORLD_SPEED = 42;
