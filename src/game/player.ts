import type { ShipId } from '../core/save';
import { computeStats, type Levels, type Stats, type UpgradeId } from './upgrades';
import { DIFFICULTY, SHIPS } from './sectors';
import type { Difficulty } from '../core/save';

export interface EchoShot {
  t: number;
  mul: number;
}

export class Player {
  x = 0;
  y = -32;
  vx = 0;
  vy = 0;
  hp: number;
  alive = true;
  invuln = 0;
  resonance = 0;
  charges = 1;
  levels: Levels = {};
  stats: Stats;
  ship: ShipId;
  diff: Difficulty;
  gunTimer = 0;
  gunShots = 0;
  beatDur = 0.5;
  orbAngle = 0;
  orbX = [0, 0, 0, 0];
  orbY = [0, 0, 0, 0];
  orbCd = [0, 0, 0, 0];
  beamT = 0;
  wingLX = -6;
  wingLY = -34;
  wingRX = 6;
  wingRY = -34;
  phoenixUsed = false;
  dilationCd = 0;
  focus = false;
  echoQueue: EchoShot[] = [];
  /** visual banking (-1..1) */
  bank = 0;

  constructor(ship: ShipId, diff: Difficulty) {
    this.ship = ship;
    this.diff = diff;
    const def = SHIPS[ship];
    for (const [k, v] of Object.entries(def.start)) this.levels[k as UpgradeId] = v ?? 0;
    this.stats = computeStats(def, this.levels, DIFFICULTY[diff]);
    this.hp = this.stats.maxHp;
  }

  level(id: UpgradeId): number {
    return this.levels[id] ?? 0;
  }

  /** Apply an upgrade and recompute stats; returns the new level. */
  apply(id: UpgradeId): number {
    const lv = this.level(id) + 1;
    this.levels[id] = lv;
    this.stats = computeStats(SHIPS[this.ship], this.levels, DIFFICULTY[this.diff]);
    if (id === 'hull') this.hp = Math.min(this.stats.maxHp, this.hp + 1);
    if (id === 'repair') this.hp = Math.min(this.stats.maxHp, this.hp + 2);
    if (id === 'capacitor') this.charges = Math.min(this.stats.maxCharges, this.charges + 1);
    return lv;
  }
}
