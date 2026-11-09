import type { BossId, EnemyId } from './ids';

/** Pooled enemy (bosses are enemies too). Fields u0..u3 are per-behaviour scratch space. */
export class Enemy {
  id = 0;
  kind: EnemyId = 'dart';
  boss: BossId | null = null;
  alive = false;
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  hp = 1;
  maxHp = 1;
  r = 1;
  t = 0;
  steps = 0;
  state = 0;
  stateSteps = 0;
  stateT = 0;
  elite = false;
  flash = 0;
  spin = 0;
  spinRate = 1;
  invuln = 0;
  color = 0;
  x0 = 0;
  y0 = 0;
  x1 = 0;
  y1 = 0;
  x2 = 0;
  y2 = 0;
  x3 = 0;
  y3 = 0;
  dur = 1;
  hold = 64;
  dir = 1;
  aim = 0;
  u0 = 0;
  u1 = 0;
  u2 = 0;
  u3 = 0;
  phase = 0;
  phaseSteps = 0;
  score = 0;
  notes = 0;
  size = 0;
  shooter = false;
  chainCd = 0;
  /** telegraph line visual (lancer / sniper): 0 = off */
  tele = 0;

  reset(): void {
    this.boss = null;
    this.alive = true;
    this.vx = this.vy = 0;
    this.t = 0;
    this.steps = 0;
    this.state = 0;
    this.stateSteps = 0;
    this.stateT = 0;
    this.elite = false;
    this.flash = 0;
    this.spin = Math.random() * 6.28;
    this.spinRate = 1;
    this.invuln = 0;
    this.color = 0;
    this.dur = 1;
    this.hold = 64;
    this.dir = 1;
    this.aim = 0;
    this.u0 = this.u1 = this.u2 = this.u3 = 0;
    this.phase = 0;
    this.phaseSteps = 0;
    this.shooter = false;
    this.chainCd = 0;
    this.tele = 0;
  }
}

export interface Laser {
  x: number;
  y: number;
  ang: number;
  angv: number;
  len: number;
  width: number;
  /** telegraph time remaining (harmless while > 0) */
  warm: number;
  /** active time remaining */
  life: number;
  owner: Enemy | null;
  /** oscillating sweep: ang = base + amp * sin(t * freq) when amp > 0 */
  base: number;
  amp: number;
  freq: number;
  t: number;
  c: number;
}
