/** Upgrade catalogue, stat derivation and offer rolling. Pure and deterministic. */
import type { RNG } from '../core/rng';
import type { DiffParams, ShipDef } from './sectors';

export type UpgradeId =
  | 'barrel'
  | 'spread'
  | 'overclock'
  | 'amp'
  | 'pierce'
  | 'missile'
  | 'orbital'
  | 'chain'
  | 'beam'
  | 'echo'
  | 'nova'
  | 'wingman'
  | 'crit'
  | 'sub'
  | 'hull'
  | 'repair'
  | 'graze'
  | 'capacitor'
  | 'phase'
  | 'magnet'
  | 'dilation'
  | 'phoenix'
  | 'rhythm'
  | 'thruster';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type Category = 'atk' | 'def' | 'util';

export interface UpgradeDef {
  id: UpgradeId;
  max: number;
  rarity: Rarity;
  cat: Category;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'barrel', max: 3, rarity: 'common', cat: 'atk' },
  { id: 'spread', max: 3, rarity: 'common', cat: 'atk' },
  { id: 'amp', max: 5, rarity: 'common', cat: 'atk' },
  { id: 'crit', max: 3, rarity: 'common', cat: 'atk' },
  { id: 'overclock', max: 2, rarity: 'rare', cat: 'atk' },
  { id: 'pierce', max: 2, rarity: 'rare', cat: 'atk' },
  { id: 'missile', max: 4, rarity: 'rare', cat: 'atk' },
  { id: 'orbital', max: 4, rarity: 'rare', cat: 'atk' },
  { id: 'chain', max: 3, rarity: 'rare', cat: 'atk' },
  { id: 'nova', max: 3, rarity: 'rare', cat: 'atk' },
  { id: 'sub', max: 3, rarity: 'rare', cat: 'atk' },
  { id: 'beam', max: 3, rarity: 'epic', cat: 'atk' },
  { id: 'echo', max: 2, rarity: 'epic', cat: 'atk' },
  { id: 'wingman', max: 2, rarity: 'epic', cat: 'atk' },
  { id: 'hull', max: 3, rarity: 'common', cat: 'def' },
  { id: 'repair', max: 99, rarity: 'common', cat: 'def' },
  { id: 'phase', max: 2, rarity: 'rare', cat: 'def' },
  { id: 'phoenix', max: 1, rarity: 'legendary', cat: 'def' },
  { id: 'graze', max: 3, rarity: 'common', cat: 'util' },
  { id: 'magnet', max: 3, rarity: 'common', cat: 'util' },
  { id: 'thruster', max: 2, rarity: 'common', cat: 'util' },
  { id: 'capacitor', max: 2, rarity: 'rare', cat: 'util' },
  { id: 'dilation', max: 1, rarity: 'epic', cat: 'util' },
  { id: 'rhythm', max: 1, rarity: 'epic', cat: 'util' },
];

export const UPGRADE_MAP: Record<UpgradeId, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u])) as Record<
  UpgradeId,
  UpgradeDef
>;

export type Levels = Partial<Record<UpgradeId, number>>;

export interface Stats {
  maxHp: number;
  speed: number;
  damage: number;
  streams: number;
  spread: number;
  shotsPerBeat: number;
  pierce: number;
  critChance: number;
  critMul: number;
  missiles: number;
  orbitals: number;
  chainChance: number;
  chainTargets: number;
  beam: number;
  echo: number;
  nova: number;
  wingmen: number;
  sub: number;
  grazeRadius: number;
  grazeGain: number;
  maxCharges: number;
  invuln: number;
  phasePulse: boolean;
  magnet: number;
  dilation: boolean;
  phoenix: boolean;
  rhythm: boolean;
  perfectWindow: number;
}

const L = (lv: Levels, id: UpgradeId): number => lv[id] ?? 0;

/** Damage of one main-gun bolt before upgrades. */
export const BASE_DAMAGE = 1.3;

export function computeStats(ship: ShipDef, lv: Levels, diff: DiffParams): Stats {
  const crit = L(lv, 'crit');
  const chain = L(lv, 'chain');
  return {
    maxHp: Math.max(1, ship.hp + diff.hpBonus + L(lv, 'hull')),
    speed: 55 * ship.speed * (1 + 0.12 * L(lv, 'thruster')),
    damage: BASE_DAMAGE * ship.damage * (1 + 0.2 * L(lv, 'amp')),
    streams: 2 + L(lv, 'barrel'),
    spread: L(lv, 'spread'),
    shotsPerBeat: [4, 6, 8][Math.min(2, L(lv, 'overclock'))],
    pierce: L(lv, 'pierce'),
    critChance: [0, 0.1, 0.18, 0.26][Math.min(3, crit)],
    critMul: 2.5,
    missiles: L(lv, 'missile'),
    orbitals: L(lv, 'orbital'),
    chainChance: [0, 0.15, 0.25, 0.35][Math.min(3, chain)],
    chainTargets: [0, 2, 3, 4][Math.min(3, chain)],
    beam: L(lv, 'beam'),
    echo: L(lv, 'echo'),
    nova: L(lv, 'nova'),
    wingmen: L(lv, 'wingman'),
    sub: L(lv, 'sub'),
    grazeRadius: 3 * (1 + 0.3 * L(lv, 'graze')),
    grazeGain: 1 + 0.4 * L(lv, 'graze'),
    maxCharges: 2 + L(lv, 'capacitor'),
    invuln: 2 + 0.6 * L(lv, 'phase'),
    phasePulse: L(lv, 'phase') >= 2,
    magnet: 9 * Math.pow(1.5, L(lv, 'magnet')),
    dilation: L(lv, 'dilation') > 0,
    phoenix: L(lv, 'phoenix') > 0,
    rhythm: L(lv, 'rhythm') > 0,
    perfectWindow: L(lv, 'rhythm') > 0 ? 0.16 : 0.11,
  };
}

export const MISSILES_PER_BAR = [0, 2, 4, 8, 12];
export const NOVA_COUNT = [0, 12, 18, 24];
export const BEAM_WIDTH = [0, 2.6, 3.4, 4.2];
export const BEAM_DPS = [0, 42, 64, 90];
export const SUB_RADIUS = [0, 7, 8.5, 10];
export const SUB_DAMAGE = [0, 3, 5, 7];
export const ORBITAL_DPS = 16;

const RARITY_WEIGHT: Record<Rarity, number> = { common: 10, rare: 6, epic: 2.6, legendary: 0.9 };
const RARITY_WEIGHT_BOSS: Record<Rarity, number> = { common: 2, rare: 8, epic: 6, legendary: 2.4 };

export interface OfferContext {
  hp: number;
  maxHp: number;
  boss: boolean;
  count?: number;
}

export function isAvailable(id: UpgradeId, lv: Levels, ctx: OfferContext): boolean {
  const def = UPGRADE_MAP[id];
  if (L(lv, id) >= def.max) return false;
  if (id === 'repair') return ctx.hp < ctx.maxHp;
  return true;
}

/** Roll distinct upgrade offers, weighted by rarity, guaranteeing at least one attack option. */
export function rollOffers(rng: RNG, lv: Levels, ctx: OfferContext): UpgradeId[] {
  const count = ctx.count ?? 3;
  const weights = ctx.boss ? RARITY_WEIGHT_BOSS : RARITY_WEIGHT;
  const pool = UPGRADES.filter((u) => isAvailable(u.id, lv, ctx));
  const out: UpgradeId[] = [];
  const weightOf = (u: UpgradeDef): number => {
    let w = weights[u.rarity];
    // favour deepening what the player already has (builds synergy)
    if (L(lv, u.id) > 0 && u.id !== 'repair') w *= 1.35;
    if (u.id === 'repair') w = ctx.hp <= ctx.maxHp / 2 ? 14 : 5;
    return w;
  };
  while (out.length < count && pool.length > 0) {
    const pick = rng.weighted(pool, weightOf);
    out.push(pick.id);
    pool.splice(pool.indexOf(pick), 1);
  }
  if (!out.some((id) => UPGRADE_MAP[id].cat === 'atk')) {
    const atk = UPGRADES.filter((u) => u.cat === 'atk' && isAvailable(u.id, lv, ctx) && !out.includes(u.id));
    if (atk.length > 0 && out.length > 0) out[out.length - 1] = rng.weighted(atk, weightOf).id;
  }
  return out;
}

/** Values used by the UI to describe an upgrade's next level ("{a} → {b}"). */
export function describe(id: UpgradeId, lv: Levels, ship: ShipDef, diff: DiffParams): { a: string; b: string } {
  const cur = L(lv, id);
  const next: Levels = { ...lv, [id]: cur + 1 };
  const s0 = computeStats(ship, lv, diff);
  const s1 = computeStats(ship, next, diff);
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  switch (id) {
    case 'barrel':
      return { a: String(s0.streams), b: String(s1.streams) };
    case 'spread':
      return { a: String(s0.spread * 2), b: String(s1.spread * 2) };
    case 'overclock':
      return { a: String(s0.shotsPerBeat), b: String(s1.shotsPerBeat) };
    case 'amp':
      return { a: pct(0.2 * cur), b: pct(0.2 * (cur + 1)) };
    case 'pierce':
      return { a: String(s0.pierce), b: String(s1.pierce) };
    case 'missile':
      return { a: String(MISSILES_PER_BAR[s0.missiles]), b: String(MISSILES_PER_BAR[s1.missiles]) };
    case 'orbital':
      return { a: String(s0.orbitals), b: String(s1.orbitals) };
    case 'chain':
      return { a: pct(s0.chainChance), b: pct(s1.chainChance) };
    case 'beam':
      return { a: String(BEAM_DPS[s0.beam]), b: String(BEAM_DPS[s1.beam]) };
    case 'echo':
      return { a: pct(s0.echo * 0.5), b: pct(s1.echo * 0.5) };
    case 'nova':
      return { a: String(NOVA_COUNT[s0.nova]), b: String(NOVA_COUNT[s1.nova]) };
    case 'wingman':
      return { a: String(s0.wingmen * 2), b: String(Math.max(2, s1.wingmen * 2)) };
    case 'crit':
      return { a: pct(s0.critChance), b: pct(s1.critChance) };
    case 'sub':
      return { a: String(SUB_DAMAGE[s0.sub]), b: String(SUB_DAMAGE[s1.sub]) };
    case 'hull':
      return { a: String(s0.maxHp), b: String(s1.maxHp) };
    case 'repair':
      return { a: '2', b: '2' };
    case 'graze':
      return { a: pct(s0.grazeRadius / 3 - 1), b: pct(s1.grazeRadius / 3 - 1) };
    case 'capacitor':
      return { a: String(s0.maxCharges), b: String(s1.maxCharges) };
    case 'phase':
      return { a: s0.invuln.toFixed(1), b: s1.invuln.toFixed(1) };
    case 'magnet':
      return { a: pct(s0.magnet / 9 - 1), b: pct(s1.magnet / 9 - 1) };
    case 'thruster':
      return { a: pct(s0.speed / (55 * ship.speed) - 1), b: pct(s1.speed / (55 * ship.speed) - 1) };
    default:
      return { a: '', b: '' };
  }
}
