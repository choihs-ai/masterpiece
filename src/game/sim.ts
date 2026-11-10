/**
 * SKYRIFT simulation. Camera-relative corridor space: the ship lives near z = 0 inside
 * FIELD, "ahead" is -z, and the world streams toward +z. Everything enemies do is
 * triggered on 16th-note steps from the music clock. No rendering, audio or DOM here.
 */
import type { StepEvent } from '../core/beat';
import { clamp, easeOutCubic, TAU } from '../core/math';
import { RNG } from '../core/rng';
import type { Difficulty } from '../core/save';
import {
  DIFFICULTY,
  FIELD,
  STAGES,
  UPGRADE_MAP,
  UPGRADES,
  WORLD_SPEED,
  type BossId,
  type DiffParams,
  type EnemyKind,
  type UpgradeId,
} from './content';

/* ================================================================== */
/* types                                                               */
/* ================================================================== */

export type Kind = EnemyKind | 'boss' | 'part';

export type MusicCue = { song?: number | 'title' | 'ending'; intensity?: number; dropout?: boolean; open?: number };

export type SimEvent =
  | { t: 'hit'; x: number; y: number; z: number; big: boolean }
  | { t: 'kill'; x: number; y: number; z: number; size: number; kind: Kind; score: number }
  | { t: 'playerHit'; hp: number }
  | { t: 'playerDie' }
  | { t: 'graze'; x: number; y: number; z: number }
  | { t: 'lock'; id: number }
  | { t: 'missiles'; n: number; perfect: boolean }
  | { t: 'boom'; x: number; y: number; z: number; size: number }
  | { t: 'roll'; dir: number }
  | { t: 'nova' }
  | { t: 'shoot'; x: number; y: number; z: number }
  | { t: 'beamWarn'; x: number; y: number }
  | { t: 'popup'; x: number; y: number; z: number; text: string; kind: string }
  | { t: 'shake'; amount: number }
  | { t: 'flash'; color: string; amount: number }
  | { t: 'stage'; index: number }
  | { t: 'wave'; stage: number; wave: number }
  | { t: 'waveClear' }
  | { t: 'bossWarning'; id: BossId }
  | { t: 'riser' }
  | { t: 'bossStart'; id: BossId }
  | { t: 'bossPhase'; phase: number }
  | { t: 'bossDefeated'; x: number; y: number; z: number }
  | { t: 'stageClear'; index: number; bonus: number; flawless: boolean }
  | { t: 'upgradeOffer'; boss: boolean }
  | { t: 'upgradeTaken'; id: UpgradeId }
  | { t: 'warp'; to: number }
  | { t: 'music'; cue: MusicCue }
  | { t: 'gameOver' }
  | { t: 'victory' };

export class Enemy {
  id = 0;
  kind: Kind = 'wasp';
  boss: BossId | null = null;
  owner: Enemy | null = null;
  alive = true;
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  ox = 0;
  oy = 0;
  oz = 0;
  hp = 1;
  maxHp = 1;
  r = 1;
  t = 0;
  steps = 0;
  state = 0;
  stateSteps = 0;
  flash = 0;
  score = 100;
  size = 0;
  invuln = 0;
  phase = 0;
  shooter = false;
  hold = 64;
  dur = 5;
  u0 = 0;
  u1 = 0;
  u2 = 0;
  /** 3D cubic path p0..p3 */
  p = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  /** visual rotation helpers */
  roll = 0;
  partIndex = 0;
}

/** Struct-of-arrays pool for bullets. */
export class Pool {
  count = 0;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  r: Float32Array;
  life: Float32Array;
  dmg: Float32Array;
  c: Uint8Array;
  flags: Uint8Array;
  hit: Int32Array;
  constructor(readonly cap: number) {
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.z = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.vz = new Float32Array(cap);
    this.r = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.dmg = new Float32Array(cap);
    this.c = new Uint8Array(cap);
    this.flags = new Uint8Array(cap);
    this.hit = new Int32Array(cap);
  }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, c: number): number {
    if (this.count >= this.cap) return -1;
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.z[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.r[i] = r;
    this.life[i] = 0;
    this.dmg[i] = 1;
    this.c[i] = c;
    this.flags[i] = 0;
    this.hit[i] = -1;
    return i;
  }
  remove(i: number): void {
    const j = --this.count;
    if (i === j) return;
    for (const a of [this.x, this.y, this.z, this.vx, this.vy, this.vz, this.r, this.life, this.dmg]) a[i] = a[j];
    this.c[i] = this.c[j];
    this.flags[i] = this.flags[j];
    this.hit[i] = this.hit[j];
  }
}

export interface Missile {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  target: number;
  dmg: number;
  t: number;
  alive: boolean;
}

export interface Beam {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  warm: number;
  life: number;
}

export interface Stats {
  barrels: number;
  damage: number;
  shotsPerBeat: number;
  maxLocks: number;
  missileDmg: number;
  maxHp: number;
  rollCd: number;
  nova: boolean;
  drones: number;
  rail: boolean;
}

export function computeStats(lv: Partial<Record<UpgradeId, number>>, diff: DiffParams): Stats {
  const L = (k: UpgradeId): number => lv[k] ?? 0;
  return {
    barrels: 2 + 2 * L('guns'),
    damage: 1.4 * (1 + 0.25 * L('power')),
    shotsPerBeat: [4, 6, 8][Math.min(2, L('rate'))],
    maxLocks: 4 + 2 * L('locks'),
    missileDmg: 7 * (1 + 0.4 * L('warhead')),
    maxHp: diff.hp + L('hull'),
    rollCd: 1.5 * (1 - 0.3 * L('roll')),
    nova: L('nova') > 0,
    drones: L('drone'),
    rail: L('rail') > 0,
  };
}

export class Player {
  x = 0;
  y = 4;
  vx = 0;
  vy = 0;
  hp: number;
  alive = true;
  invuln = 0;
  roll = 0;
  rollDir = 1;
  rollCd = 0;
  levels: Partial<Record<UpgradeId, number>> = {};
  stats: Stats;
  locks: number[] = [];
  gunT = 0;
  gunN = 0;
  beatDur = 0.5;
  bank = 0;
  pitch = 0;
  constructor(diff: DiffParams) {
    this.stats = computeStats(this.levels, diff);
    this.hp = this.stats.maxHp;
  }
}

export interface Input {
  mx: number;
  my: number;
  dragX: number;
  dragY: number;
  roll: boolean;
  fire: boolean;
  firePerfect: boolean;
}

export interface RunStats {
  kills: number;
  grazes: number;
  perfects: number;
  hits: number;
  maxChain: number;
  time: number;
  bosses: number;
  stage: number;
  upgrades: UpgradeId[];
}

type Phase = 'intro' | 'wave' | 'waveClear' | 'upgrade' | 'prewave' | 'bossWarn' | 'boss' | 'bossDead' | 'stageClear' | 'warp' | 'victory' | 'dead';

interface Spawn {
  at: number;
  kind: EnemyKind;
  x: number;
  y: number;
  path: number;
  shooter: boolean;
  elite: boolean;
}

const HP: Record<EnemyKind, number> = { wasp: 3, hornet: 9, lantern: 42, mine: 6, turret: 12, bulwark: 130 };
const RADIUS: Record<EnemyKind, number> = { wasp: 1.3, hornet: 1.6, lantern: 2.4, mine: 1.4, turret: 1.6, bulwark: 3.6 };
const SCORE: Record<EnemyKind, number> = { wasp: 100, hornet: 300, lantern: 800, mine: 150, turret: 250, bulwark: 2000 };
const COST: Record<EnemyKind, number> = { wasp: 1, hornet: 3, lantern: 7, mine: 1.5, turret: 2, bulwark: 14 };
const BOSS_HP: Record<BossId, number> = { colossus: 950, maelstrom: 1700, warden: 2800 };
const HOLD_Z = -95;
export const GROUND_Y = -2;

/* ================================================================== */
/* simulation                                                          */
/* ================================================================== */

export class Sim {
  readonly rng: RNG;
  readonly diff: DiffParams;
  readonly player: Player;
  readonly eb = new Pool(1800);
  readonly shots = new Pool(600);
  enemies: Enemy[] = [];
  missiles: Missile[] = [];
  beams: Beam[] = [];
  events: SimEvent[] = [];
  boss: Enemy | null = null;
  input: Input = { mx: 0, my: 0, dragX: 0, dragY: 0, roll: false, fire: false, firePerfect: false };
  stats: RunStats = { kills: 0, grazes: 0, perfects: 0, hits: 0, maxChain: 0, time: 0, bosses: 0, stage: 0, upgrades: [] };
  time = 0;
  stepDur = 0.125;
  scroll = 0;
  paused = false;
  over = false;
  won = false;
  invincible = false;
  score = 0;
  chain = 0;
  chainT = 0;
  mult = 1;
  hitStop = 0;
  slowT = 0;
  stage = 0;
  wave = 0;
  phase: Phase = 'intro';
  phaseSteps = 0;
  offers: UpgradeId[] = [];
  offerBoss = false;
  private plan: Spawn[] = [];
  private cursor = 0;
  private waveStep = 0;
  private waveLen = 0;
  private escalated = false;
  private nextId = 1;
  private stageHits = 0;
  private finished = false;
  private grazeCd = 0;
  private lockable: Enemy[] = [];

  constructor(
    readonly seed: number,
    readonly difficulty: Difficulty,
    startStage = 0,
  ) {
    this.rng = new RNG(seed);
    this.diff = DIFFICULTY[difficulty];
    this.player = new Player(this.diff);
    this.stage = startStage;
  }

  get bulletSpeed(): number {
    return this.diff.bulletSpeed * STAGES[this.stage].speedMul;
  }

  get density(): number {
    return this.diff.density * (1 + this.stage * 0.12);
  }

  get firing(): boolean {
    return this.player.alive && !['warp', 'victory', 'dead', 'stageClear', 'bossDead', 'intro'].includes(this.phase);
  }

  emit(e: SimEvent): void {
    if (this.events.length < 500) this.events.push(e);
  }

  start(): void {
    this.enter('intro');
    this.emit({ t: 'music', cue: { song: this.stage, intensity: 1, dropout: false, open: 1 } });
    this.emit({ t: 'stage', index: this.stage });
  }

  private enter(p: Phase): void {
    this.phase = p;
    this.phaseSteps = 0;
  }

  /* ------------------------------------------------------------ */
  /* run flow                                                      */
  /* ------------------------------------------------------------ */

  onStep(ev: StepEvent): void {
    if (this.paused || this.over) return;
    this.stepDur = ev.stepDur;
    this.phaseSteps++;
    const bar = ev.pos === 0;
    switch (this.phase) {
      case 'intro':
        if (bar && this.phaseSteps >= 32) this.beginWave();
        break;
      case 'wave': {
        while (this.cursor < this.plan.length && this.plan[this.cursor].at <= this.waveStep) this.spawn(this.plan[this.cursor++]);
        this.waveStep++;
        if (!this.escalated && this.waveStep > this.waveLen * 0.35) {
          this.escalated = true;
          this.emit({ t: 'music', cue: { intensity: 2 } });
        }
        if (this.cursor >= this.plan.length && this.liveEnemies() === 0) {
          this.enter('waveClear');
          this.emit({ t: 'waveClear' });
        } else if (this.waveStep > this.waveLen + 16 * 10) {
          for (const e of this.enemies) e.alive = false;
        }
        break;
      }
      case 'waveClear':
        if (bar && this.phaseSteps >= 8) this.offer(false);
        break;
      case 'prewave':
        if (bar) {
          if (this.wave < 1) {
            this.wave++;
            this.beginWave();
          } else {
            this.enter('bossWarn');
            this.emit({ t: 'bossWarning', id: STAGES[this.stage].boss });
            this.emit({ t: 'music', cue: { intensity: 2 } });
          }
        }
        break;
      case 'bossWarn':
        if (bar && this.phaseSteps >= 16 && this.phaseSteps < 32) {
          this.emit({ t: 'music', cue: { intensity: 3 } });
          this.emit({ t: 'riser' });
        } else if (bar && this.phaseSteps >= 32) {
          this.enter('boss');
          this.spawnBoss(STAGES[this.stage].boss);
        }
        break;
      case 'bossDead':
        if (bar && this.phaseSteps >= 32) {
          this.enter('stageClear');
          const flawless = this.stageHits === 0;
          const bonus = (20000 + (flawless ? 30000 : 0)) * (this.stage + 1);
          this.addScore(bonus);
          if (this.player.hp < this.player.stats.maxHp) this.player.hp++;
          this.emit({ t: 'stageClear', index: this.stage, bonus: Math.round(bonus * this.diff.scoreMul), flawless });
        }
        break;
      case 'stageClear':
        if (bar && this.phaseSteps >= 32) {
          if (this.stage >= STAGES.length - 1) {
            this.enter('victory');
            this.emit({ t: 'music', cue: { song: 'ending', intensity: 2, dropout: false } });
          } else this.offer(true);
        }
        break;
      case 'warp':
        if (bar && this.phaseSteps === 16) this.emit({ t: 'music', cue: { song: this.stage + 1, intensity: 1, dropout: false } });
        if (bar && this.phaseSteps >= 32) {
          this.stage++;
          this.wave = 0;
          this.stageHits = 0;
          this.stats.stage = this.stage;
          this.enter('intro');
          this.emit({ t: 'stage', index: this.stage });
        }
        break;
      case 'victory':
        if (!this.finished && this.phaseSteps >= 64 && bar) this.finish(true);
        break;
      case 'dead':
        if (!this.finished && this.phaseSteps >= 40) this.finish(false);
        break;
      default:
        break;
    }
    this.stepWeapons(ev);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.steps++;
      e.stateSteps++;
      this.enemyStep(e, ev);
    }
  }

  private beginWave(): void {
    this.plan = this.buildWave();
    this.cursor = 0;
    this.waveStep = 0;
    this.escalated = false;
    this.waveLen = this.plan.length ? this.plan[this.plan.length - 1].at + 16 : 16;
    this.enter('wave');
    this.emit({ t: 'wave', stage: this.stage, wave: this.wave });
    this.emit({ t: 'music', cue: { intensity: 1, dropout: false } });
  }

  private offer(boss: boolean): void {
    this.offerBoss = boss;
    this.offers = this.rollOffers(this.rng.fork(900 + this.stage * 10 + this.wave + (boss ? 5 : 0)), boss);
    this.enter('upgrade');
    this.paused = true;
    this.emit({ t: 'upgradeOffer', boss });
    this.emit({ t: 'music', cue: { intensity: 0, open: 0.3 } });
  }

  rollOffers(rng: RNG, boss: boolean): UpgradeId[] {
    const p = this.player;
    const pool = UPGRADES.filter((u) => (p.levels[u.id] ?? 0) < u.max && (u.id !== 'repair' || p.hp < p.stats.maxHp));
    const w = (id: UpgradeId): number => {
      const r = UPGRADE_MAP[id].rarity;
      let v = r === 'common' ? 10 : r === 'rare' ? 6 : 2.5;
      if (boss && r !== 'common') v *= 2.5;
      if (id === 'repair') v = p.hp <= p.stats.maxHp / 2 ? 14 : 4;
      return v;
    };
    const out: UpgradeId[] = [];
    while (out.length < 3 && pool.length) {
      const pick = rng.weighted(pool, (u) => w(u.id));
      out.push(pick.id);
      pool.splice(pool.indexOf(pick), 1);
    }
    return out;
  }

  choose(id: UpgradeId): void {
    if (this.phase !== 'upgrade') return;
    const p = this.player;
    p.levels[id] = (p.levels[id] ?? 0) + 1;
    p.stats = computeStats(p.levels, this.diff);
    if (id === 'hull') p.hp = Math.min(p.stats.maxHp, p.hp + 1);
    if (id === 'repair') p.hp = Math.min(p.stats.maxHp, p.hp + 2);
    this.stats.upgrades.push(id);
    this.emit({ t: 'upgradeTaken', id });
    this.paused = false;
    this.emit({ t: 'music', cue: { open: 1 } });
    if (this.offerBoss) {
      this.enter('warp');
      this.emit({ t: 'warp', to: this.stage + 1 });
      this.emit({ t: 'music', cue: { intensity: 0 } });
    } else this.enter('prewave');
  }

  finish(win: boolean): void {
    this.finished = true;
    this.over = true;
    this.won = win;
    this.emit({ t: win ? 'victory' : 'gameOver' });
  }

  liveEnemies(): number {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  /* ------------------------------------------------------------ */
  /* waves                                                         */
  /* ------------------------------------------------------------ */

  private buildWave(): Spawn[] {
    const rng = this.rng.fork(100 + this.stage * 10 + this.wave);
    const st = STAGES[this.stage];
    let budget = (30 + 14 * this.stage + 10 * this.wave) * (0.85 + 0.15 * this.diff.density);
    const out: Spawn[] = [];
    let at = 0;
    let first = true;
    let guard = 0;
    while (budget > 0 && guard++ < 50) {
      const roster = st.roster.filter((k) => COST[k] <= budget + 6);
      const kind: EnemyKind = first ? 'wasp' : rng.weighted(roster, (k) => ({ wasp: 6, hornet: 3, lantern: 2.2, mine: 2, turret: 2.5, bulwark: 1 })[k]);
      const elite = this.stage > 0 && rng.chance(0.1 + this.stage * 0.05);
      let cost = 0;
      const add = (dt: number, x: number, y: number, path: number, shooter: boolean): void => {
        out.push({ at: at + dt, kind, x, y, path, shooter, elite: elite && cost === 0 });
        cost += COST[kind];
      };
      switch (kind) {
        case 'wasp': {
          const form = rng.int(0, 3);
          const n = rng.int(5, 7);
          const side = rng.sign();
          for (let i = 0; i < n; i++) {
            if (form === 0) add(i * 2, side * rng.range(4, 10), rng.range(3, 8), 0, i % 3 === 1);
            else if (form === 1) add(i * 2, (i - n / 2) * 3, 9, 1, i % 2 === 0);
            else if (form === 2) add(i * 3, side * 22, rng.range(2, 9), 2, i % 3 === 0);
            else add(0, Math.cos((i / n) * TAU) * 7, 5 + Math.sin((i / n) * TAU) * 4, 3, i % 2 === 0);
          }
          break;
        }
        case 'hornet': {
          const n = rng.int(2, 3);
          for (let i = 0; i < n; i++) add(i * 4, rng.range(-10, 10), rng.range(2, 9), 0, true);
          break;
        }
        case 'lantern':
          add(0, rng.range(-8, 8), rng.range(4, 9), 0, true);
          if (rng.chance(0.35)) add(8, rng.range(-8, 8), rng.range(4, 9), 0, true);
          break;
        case 'mine': {
          const n = rng.int(4, 6);
          for (let i = 0; i < n; i++) add(i * 3, rng.range(-12, 12), rng.range(1, 10), 0, false);
          break;
        }
        case 'turret': {
          const n = rng.int(3, 5);
          for (let i = 0; i < n; i++) add(i * 4, rng.range(-9, 9), GROUND_Y + 0.5, 0, true);
          break;
        }
        case 'bulwark':
          add(0, rng.range(-4, 4), 6, 0, true);
          break;
      }
      budget -= cost;
      at += Math.ceil((10 + cost * 1.8) / 4) * 4;
      first = false;
    }
    out.sort((a, b) => a.at - b.at);
    return out;
  }

  private newEnemy(kind: Kind): Enemy {
    const e = new Enemy();
    e.id = this.nextId++;
    e.kind = kind;
    this.enemies.push(e);
    return e;
  }

  private setPath(e: Enemy, a: number[], b: number[], c: number[], d: number[], dur: number): void {
    e.p = [...a, ...b, ...c, ...d];
    e.dur = dur / STAGES[this.stage].speedMul;
    e.x = a[0];
    e.y = a[1];
    e.z = a[2];
  }

  private spawn(s: Spawn): void {
    if (this.enemies.length > 60) return;
    const e = this.newEnemy(s.kind);
    const hpMul = this.diff.enemyHp * STAGES[this.stage].hpMul * (s.elite ? 2.5 : 1);
    e.hp = e.maxHp = HP[s.kind] * hpMul;
    e.r = RADIUS[s.kind] * (s.elite ? 1.2 : 1);
    e.score = SCORE[s.kind] * (s.elite ? 3 : 1);
    e.size = s.kind === 'bulwark' ? 3 : s.kind === 'lantern' ? 2 : s.kind === 'wasp' || s.kind === 'mine' ? 0 : 1;
    e.shooter = s.shooter;
    e.u2 = s.elite ? 1 : 0;
    const x = s.x;
    const y = s.y;
    switch (s.kind) {
      case 'wasp':
        if (s.path === 0) this.setPath(e, [x, y + 6, -280], [x * 0.5, y, -120], [-x * 0.6, y - 1, -40], [-x * 2.2, y + 4, 30], 5.4);
        else if (s.path === 1) this.setPath(e, [x, 22, -230], [x, y, -140], [x * 1.4, y - 4, -50], [x * 2.6, 18, 20], 5.2);
        else if (s.path === 2) this.setPath(e, [x, y, -60], [x * 0.3, y + 2, -110], [-x * 0.4, y, -160], [-x * 1.4, y + 8, -300], 4.6);
        else this.setPath(e, [x * 3, y + 10, -300], [x, y, -150], [x, y, -70], [x * 4, y + 12, 25], 6);
        break;
      case 'hornet':
        // overtakes the player from behind, then turns to strafe ahead
        this.setPath(e, [x * 0.5, y + 3, 30], [x, y + 1, -40], [x, y, -80], [x, y, HOLD_Z + 10], 2.4);
        e.hold = 40;
        break;
      case 'lantern':
        this.setPath(e, [x, y + 8, -320], [x, y + 4, -200], [x, y, -120], [x, y, HOLD_Z], 3);
        e.hold = 80;
        break;
      case 'bulwark':
        this.setPath(e, [x, y + 14, -340], [x, y + 8, -240], [x, y, -150], [x, y, HOLD_Z - 15], 4);
        e.hold = 128;
        break;
      case 'mine':
        e.x = x;
        e.y = y;
        e.z = -300;
        e.vz = 26;
        e.state = 9;
        break;
      case 'turret':
        e.x = x;
        e.y = y;
        e.z = -300;
        e.vz = WORLD_SPEED;
        e.state = 9;
        break;
    }
  }

  private spawnBoss(id: BossId): void {
    const b = this.newEnemy('boss');
    b.boss = id;
    b.hp = b.maxHp = BOSS_HP[id] * this.diff.enemyHp;
    b.r = 3.6;
    b.score = 60000 * (this.stage + 1);
    b.size = 4;
    b.x = 0;
    b.y = 26;
    b.z = -360;
    b.state = 0;
    b.invuln = 999;
    b.dur = 32 * this.stepDur;
    this.boss = b;
    const parts: [number, number, number, number][] =
      id === 'colossus'
        ? [
            [-9, -0.5, 1, 1.9],
            [9, -0.5, 1, 1.9],
            [0, 5.6, 2, 1.8],
          ]
        : id === 'maelstrom'
          ? [0, 1, 2, 3].map((k) => [Math.cos((k / 4) * TAU) * 8, Math.sin((k / 4) * TAU) * 8, 0, 2] as [number, number, number, number])
          : [0, 1, 2, 3, 4, 5].map((k) => [Math.cos((k / 6) * TAU) * 7, Math.sin((k / 6) * TAU) * 7, 0, 1.6] as [number, number, number, number]);
    parts.forEach(([ox, oy, oz, r], i) => {
      const p = this.newEnemy('part');
      p.owner = b;
      p.boss = id;
      p.ox = ox;
      p.oy = oy;
      p.oz = oz;
      p.r = r;
      p.partIndex = i;
      p.hp = p.maxHp = BOSS_HP[id] * 0.07 * this.diff.enemyHp;
      p.score = 5000;
      p.size = 2;
      p.invuln = 999;
    });
    this.emit({ t: 'bossStart', id });
    this.emit({ t: 'shake', amount: 0.8 });
  }

  private parts(b: Enemy): Enemy[] {
    return this.enemies.filter((e) => e.owner === b && e.alive);
  }

  /* ------------------------------------------------------------ */
  /* update                                                        */
  /* ------------------------------------------------------------ */

  update(dt: number): void {
    if (this.paused || this.over) return;
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      return;
    }
    let sdt = dt;
    if (this.slowT > 0) {
      this.slowT -= dt;
      sdt *= 0.3;
    }
    this.time += sdt;
    this.scroll += WORLD_SPEED * STAGES[this.stage].speedMul * sdt * (this.phase === 'warp' ? 4 : 1);
    if (this.player.alive) this.stats.time += dt;
    this.updatePlayer(dt);
    this.updateGun(sdt);
    this.updateEnemies(sdt);
    this.updateShots(sdt);
    this.updateMissiles(sdt);
    this.updateBullets(sdt);
    this.updateBeams(sdt);
    if (this.chainT > 0) {
      this.chainT -= dt;
      if (this.chainT <= 0) this.chain = 0;
    }
    this.mult = Math.min(8, 1 + this.chain * 0.025);
    this.grazeCd = Math.max(0, this.grazeCd - dt);
    if (this.enemies.some((e) => !e.alive)) this.enemies = this.enemies.filter((e) => e.alive);
    const p = this.player;
    if (p.locks.length) p.locks = p.locks.filter((id) => this.enemies.some((e) => e.id === id && e.alive && e.z < -6));
  }

  private updatePlayer(dt: number): void {
    const p = this.player;
    const inp = this.input;
    if (!p.alive) return;
    const px = p.x;
    const py = p.y;
    let mx = inp.mx;
    let my = inp.my;
    const l = Math.hypot(mx, my);
    if (l > 1) {
      mx /= l;
      my /= l;
    }
    p.x += mx * 24 * dt;
    p.y += my * 20 * dt;
    if (inp.dragX || inp.dragY) {
      const len = Math.hypot(inp.dragX, inp.dragY);
      const max = 90 * dt;
      const k = len > max ? max / len : 1;
      p.x += inp.dragX * k;
      p.y += inp.dragY * k;
      inp.dragX *= 1 - k;
      inp.dragY *= 1 - k;
      if (Math.abs(inp.dragX) < 1e-3) inp.dragX = 0;
      if (Math.abs(inp.dragY) < 1e-3) inp.dragY = 0;
    }
    if (p.rollCd > 0) p.rollCd -= dt;
    if (inp.roll) {
      inp.roll = false;
      if (p.rollCd <= 0) {
        p.rollDir = Math.abs(p.vx) > 2 ? Math.sign(p.vx) : p.x > 0 ? -1 : 1;
        p.roll = 0.5;
        p.rollCd = p.stats.rollCd;
        p.invuln = Math.max(p.invuln, 0.55);
        this.emit({ t: 'roll', dir: p.rollDir });
        if (p.stats.nova) {
          this.clearBullets(p.x, p.y, 14);
          this.emit({ t: 'nova' });
        }
      }
    }
    if (p.roll > 0) {
      p.roll -= dt;
      p.x += p.rollDir * 26 * dt;
    }
    p.x = clamp(p.x, -FIELD.x, FIELD.x);
    p.y = clamp(p.y, FIELD.yMin, FIELD.yMax);
    p.vx = (p.x - px) / Math.max(dt, 1e-4);
    p.vy = (p.y - py) / Math.max(dt, 1e-4);
    p.bank += (clamp(-p.vx / 30, -1, 1) - p.bank) * Math.min(1, dt * 8);
    p.pitch += (clamp(p.vy / 25, -1, 1) - p.pitch) * Math.min(1, dt * 8);
    if (p.invuln > 0) p.invuln -= dt;
    if (inp.fire) {
      inp.fire = false;
      this.fireMissiles(inp.firePerfect);
    }
  }

  /* ------------------------------------------------------------ */
  /* weapons                                                       */
  /* ------------------------------------------------------------ */

  private volley(): void {
    const p = this.player;
    const s = p.stats;
    const n = s.barrels;
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const k = Math.floor(i / 2);
      const ox = side * (0.9 + k * 0.9);
      const oy = -0.1 - k * 0.25;
      const j = this.shots.spawn(p.x + ox, p.y + oy, -1.5, -ox * 0.35, 0, -230, 0.45, 0);
      if (j >= 0) this.shots.dmg[j] = s.damage;
    }
    if (s.drones > 0) {
      for (const side of [-1, 1]) {
        const j = this.shots.spawn(p.x + side * 4.2, p.y + 1.2, -1, 0, 0, -230, 0.45, 1);
        if (j >= 0) this.shots.dmg[j] = s.damage * (s.drones >= 2 ? 1.2 : 0.7);
      }
    }
  }

  private stepWeapons(ev: StepEvent): void {
    const p = this.player;
    p.beatDur = ev.stepDur * 4;
    if (!this.firing) return;
    if (ev.pos % 4 === 0) {
      this.volley();
      p.gunT = 0;
      p.gunN = 1;
      // acquire one lock per beat
      if (p.locks.length < p.stats.maxLocks) {
        let best: Enemy | null = null;
        let bd = Infinity;
        for (const e of this.enemies) {
          if (!e.alive || e.z > -14 || e.z < -190 || e.invuln > 50) continue;
          const already = p.locks.filter((id) => id === e.id).length;
          const allowed = e.kind === 'boss' || e.kind === 'part' || e.maxHp > 30 ? 3 : 1;
          if (already >= allowed) continue;
          const dx = e.x - p.x;
          const dy = e.y - p.y;
          if (Math.abs(dx) > 16 || Math.abs(dy) > 12) continue;
          const d = dx * dx + dy * dy + already * 200 - e.z * 0.05;
          if (d < bd) {
            bd = d;
            best = e;
          }
        }
        if (best) {
          p.locks.push(best.id);
          this.emit({ t: 'lock', id: best.id });
        }
      }
    }
  }

  private updateGun(dt: number): void {
    const p = this.player;
    if (!this.firing) return;
    const interval = p.beatDur / p.stats.shotsPerBeat;
    p.gunT += dt;
    while (p.gunT >= interval && p.gunN < p.stats.shotsPerBeat) {
      p.gunT -= interval;
      p.gunN++;
      this.volley();
    }
  }

  private fireMissiles(perfect: boolean): void {
    const p = this.player;
    if (!p.alive || !p.locks.length || this.paused) return;
    const dmg = p.stats.missileDmg * (perfect ? 2 : 1);
    p.locks.forEach((id, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      this.missiles.push({ x: p.x + side * 1.2, y: p.y - 0.4, z: 0, vx: side * (8 + i * 2), vy: 6 + (i % 3) * 3, vz: -20, target: id, dmg, t: 0, alive: true });
    });
    if (perfect) {
      this.stats.perfects++;
      this.addScore(1500 * p.locks.length * this.mult);
      this.emit({ t: 'popup', x: p.x, y: p.y + 2.5, z: 0, text: 'PERFECT', kind: 'perfect' });
    }
    this.emit({ t: 'missiles', n: p.locks.length, perfect });
    p.locks = [];
  }

  private updateShots(dt: number): void {
    const s = this.shots;
    const rail = this.player.stats.rail;
    for (let i = s.count - 1; i >= 0; i--) {
      s.life[i] += dt;
      s.x[i] += s.vx[i] * dt;
      s.y[i] += s.vy[i] * dt;
      s.z[i] += s.vz[i] * dt;
      if (s.z[i] < -260 || s.life[i] > 1.4) {
        s.remove(i);
        continue;
      }
      const x = s.x[i];
      const y = s.y[i];
      const z = s.z[i];
      for (const e of this.enemies) {
        if (!e.alive || e.id === s.hit[i]) continue;
        const dz = e.z - z;
        if (dz > 3 || dz < -3 - e.r) continue;
        const dx = e.x - x;
        const dy = e.y - y;
        const rr = e.r + 0.5;
        if (dx * dx + dy * dy < rr * rr) {
          this.damage(e, s.dmg[i], x, y, z);
          if (rail) s.hit[i] = e.id;
          else s.remove(i);
          break;
        }
      }
    }
  }

  private updateMissiles(dt: number): void {
    for (const m of this.missiles) {
      if (!m.alive) continue;
      m.t += dt;
      let tgt = this.enemies.find((e) => e.id === m.target && e.alive);
      if (!tgt) {
        tgt = this.enemies.find((e) => e.alive && e.z < m.z) ?? undefined;
        if (tgt) m.target = tgt.id;
      }
      const speed = Math.min(170, 40 + m.t * 260);
      if (tgt) {
        const dx = tgt.x - m.x;
        const dy = tgt.y - m.y;
        const dz = tgt.z - m.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        const k = Math.min(1, dt * (3 + m.t * 10));
        m.vx += (dx / d * speed - m.vx) * k;
        m.vy += (dy / d * speed - m.vy) * k;
        m.vz += (dz / d * speed - m.vz) * k;
        if (d < tgt.r + 1.2) {
          m.alive = false;
          this.damage(tgt, m.dmg, m.x, m.y, m.z, true);
          this.emit({ t: 'boom', x: m.x, y: m.y, z: m.z, size: 1 });
          continue;
        }
      }
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.z += m.vz * dt;
      if (m.t > 4 || m.z < -400) m.alive = false;
    }
    this.missiles = this.missiles.filter((m) => m.alive);
  }

  /* ------------------------------------------------------------ */
  /* damage                                                        */
  /* ------------------------------------------------------------ */

  addScore(v: number): void {
    this.score += Math.round(v * this.diff.scoreMul);
  }

  private damage(e: Enemy, dmg: number, x: number, y: number, z: number, big = false): void {
    if (!e.alive) return;
    if (e.invuln > 0) {
      this.emit({ t: 'hit', x, y, z, big: false });
      return;
    }
    e.hp -= dmg;
    e.flash = 0.08;
    this.emit({ t: 'hit', x, y, z, big });
    if (e.kind === 'boss') {
      this.bossCheck(e);
      return;
    }
    if (e.hp <= 0) this.kill(e);
  }

  private kill(e: Enemy): void {
    e.alive = false;
    this.stats.kills++;
    this.chain++;
    this.chainT = 3;
    this.stats.maxChain = Math.max(this.stats.maxChain, this.chain);
    const pts = e.score * this.mult;
    this.addScore(pts);
    this.emit({ t: 'kill', x: e.x, y: e.y, z: e.z, size: e.size, kind: e.kind, score: Math.round(pts * this.diff.scoreMul) });
    if (e.size >= 2) this.emit({ t: 'shake', amount: 0.3 + e.size * 0.12 });
    if (e.kind === 'mine') this.burst(e, 10, 14);
    if (e.kind === 'part' && e.owner) {
      this.emit({ t: 'popup', x: e.x, y: e.y, z: e.z, text: 'BREAK', kind: 'info' });
      this.hitStop = 0.05;
      const b = e.owner;
      if (this.parts(b).length === 0 && b.phase === 0) {
        b.phase = 1;
        b.invuln = 4 * this.stepDur;
        this.clearBullets(0, 0, 999);
        this.emit({ t: 'bossPhase', phase: 1 });
        this.emit({ t: 'flash', color: '#ffffff', amount: 0.4 });
      }
    }
  }

  private bossCheck(b: Enemy): void {
    if (b.phase === 1 && b.hp <= b.maxHp * 0.45) {
      b.phase = 2;
      b.invuln = 4 * this.stepDur;
      this.beams = [];
      this.clearBullets(0, 0, 999);
      this.emit({ t: 'bossPhase', phase: 2 });
      this.emit({ t: 'flash', color: '#ffffff', amount: 0.4 });
      this.emit({ t: 'music', cue: { intensity: 4 } });
    }
    if (b.hp <= 0) {
      b.alive = false;
      this.boss = null;
      this.beams = [];
      this.stats.bosses++;
      this.stats.kills++;
      this.addScore(b.score);
      this.clearBullets(0, 0, 999);
      for (const e of this.enemies) e.alive = false;
      this.slowT = 1.4;
      this.emit({ t: 'bossDefeated', x: b.x, y: b.y, z: b.z });
      this.emit({ t: 'shake', amount: 2 });
      this.emit({ t: 'flash', color: '#ffffff', amount: 0.9 });
      this.emit({ t: 'popup', x: b.x, y: b.y + 6, z: b.z, text: `+${Math.round(b.score * this.diff.scoreMul).toLocaleString('en-US')}`, kind: 'score' });
      this.enter('bossDead');
      this.emit({ t: 'music', cue: { intensity: 1, dropout: true } });
    }
  }

  hurt(): void {
    const p = this.player;
    if (!p.alive || p.invuln > 0 || this.invincible) return;
    p.hp--;
    this.stats.hits++;
    this.stageHits++;
    p.invuln = 2;
    this.chain = Math.floor(this.chain * 0.3);
    this.clearBullets(p.x, p.y, 10);
    this.hitStop = 0.08;
    this.emit({ t: 'playerHit', hp: p.hp });
    this.emit({ t: 'shake', amount: 1.3 });
    this.emit({ t: 'flash', color: '#ff2a3a', amount: 0.55 });
    if (p.hp <= 0) {
      p.alive = false;
      this.slowT = 2.5;
      this.emit({ t: 'playerDie' });
      this.enter('dead');
      this.emit({ t: 'music', cue: { intensity: 0, open: 0.25, dropout: true } });
    }
  }

  clearBullets(x: number, y: number, r: number): void {
    const b = this.eb;
    for (let i = b.count - 1; i >= 0; i--) {
      const dx = b.x[i] - x;
      const dy = b.y[i] - y;
      if (dx * dx + dy * dy < r * r) b.remove(i);
    }
  }

  /* ------------------------------------------------------------ */
  /* enemy bullets                                                 */
  /* ------------------------------------------------------------ */

  /** Fire one bullet from (x,y,z) along a direction. */
  private bullet(x: number, y: number, z: number, dx: number, dy: number, dz: number, speed: number, big = false, c = 0): void {
    const l = Math.hypot(dx, dy, dz) || 1;
    const sp = speed * this.bulletSpeed;
    this.eb.spawn(x, y, z, (dx / l) * sp, (dy / l) * sp, (dz / l) * sp, big ? 1.1 : 0.6, c);
  }

  private aimDir(e: Enemy): [number, number, number] {
    const p = this.player;
    return [p.x - e.x, p.y - e.y, -e.z];
  }

  /** Fan of n bullets spread horizontally around the aim direction. */
  private fan(e: Enemy, n: number, spread: number, speed: number, big = false, c = 0): void {
    const [ax, ay, az] = this.aimDir(e);
    const l = Math.hypot(ax, ay, az) || 1;
    const count = Math.max(1, Math.round(n * Math.min(1.2, this.density)) | 1);
    for (let k = 0; k < count; k++) {
      const off = count === 1 ? 0 : (k / (count - 1) - 0.5) * spread;
      this.bullet(e.x, e.y, e.z, ax / l + off, ay / l, az / l, speed, big, c);
    }
  }

  /** Expanding ring: bullets leave on a cone around the aim axis. */
  private ring(e: Enemy, n: number, cone: number, speed: number, offset = 0, c = 1, big = false): void {
    const [ax, ay, az] = this.aimDir(e);
    const l = Math.hypot(ax, ay, az) || 1;
    const fx = ax / l;
    const fy = ay / l;
    const fz = az / l;
    const count = Math.max(3, Math.round(n * this.density));
    const t = Math.tan(cone);
    for (let k = 0; k < count; k++) {
      const a = offset + (k / count) * TAU;
      this.bullet(e.x, e.y, e.z, fx + Math.cos(a) * t, fy + Math.sin(a) * t, fz, speed, big, c);
    }
  }

  private burst(e: Enemy, n: number, speed: number): void {
    const count = Math.max(4, Math.round(n * this.density));
    for (let k = 0; k < count; k++) {
      const a = (k / count) * TAU;
      this.bullet(e.x, e.y, e.z, Math.cos(a) * 0.6, Math.sin(a) * 0.6, 1, speed, false, 1);
    }
  }

  /** A slab of bullets across the corridor with a gap to fly through. */
  private wall(e: Enemy, speed: number, c = 0): void {
    const gx = this.rng.range(-8, 8);
    const gy = this.rng.range(2.5, 8.5);
    const gap = this.density < 0.8 ? 4.6 : 3.6;
    for (let x = -FIELD.x - 1; x <= FIELD.x + 1; x += 2.6) {
      for (let y = FIELD.yMin; y <= FIELD.yMax + 0.5; y += 2.6) {
        if (Math.abs(x - gx) < gap && Math.abs(y - gy) < gap) continue;
        this.eb.spawn(x, y, e.z, 0, 0, speed * this.bulletSpeed, 0.7, c);
      }
    }
  }

  private updateBullets(dt: number): void {
    const b = this.eb;
    const p = this.player;
    const hb = this.diff.hitbox;
    for (let i = b.count - 1; i >= 0; i--) {
      b.life[i] += dt;
      const pz = b.z[i];
      b.x[i] += b.vx[i] * dt;
      b.y[i] += b.vy[i] * dt;
      b.z[i] += b.vz[i] * dt;
      const z = b.z[i];
      if (z > 14 || b.life[i] > 12 || z < -420) {
        b.remove(i);
        continue;
      }
      if (!p.alive) continue;
      // swept test against the ship's plane
      if (pz <= 0.8 && z >= -0.8) {
        const dx = b.x[i] - p.x;
        const dy = b.y[i] - p.y;
        const d2 = dx * dx + dy * dy;
        const rh = b.r[i] + hb;
        if (d2 < rh * rh) {
          if (p.invuln <= 0 && !this.invincible) {
            b.remove(i);
            this.hurt();
            continue;
          }
        } else if (!(b.flags[i] & 1) && d2 < (rh + 1.8) * (rh + 1.8)) {
          b.flags[i] |= 1;
          this.stats.grazes++;
          this.addScore(20 * this.mult);
          if (this.chain > 0) this.chainT = Math.max(this.chainT, 1.5);
          if (this.grazeCd <= 0) {
            this.grazeCd = 0.06;
            this.emit({ t: 'graze', x: b.x[i], y: b.y[i], z: 0 });
          }
        }
      }
    }
  }

  private updateBeams(dt: number): void {
    const p = this.player;
    for (const bm of this.beams) {
      bm.x += bm.vx * dt;
      bm.y += bm.vy * dt;
      if (bm.x < -FIELD.x - 2 || bm.x > FIELD.x + 2) bm.vx = -bm.vx;
      if (bm.warm > 0) {
        bm.warm -= dt;
        continue;
      }
      bm.life -= dt;
      if (p.alive && Math.hypot(p.x - bm.x, p.y - bm.y) < bm.r * 0.75 + this.diff.hitbox) this.hurt();
    }
    this.beams = this.beams.filter((bm) => bm.warm > 0 || bm.life > 0);
  }

  /* ------------------------------------------------------------ */
  /* enemies                                                       */
  /* ------------------------------------------------------------ */

  private follow(e: Enemy): boolean {
    const t = Math.min(1, e.t / e.dur);
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    const P = e.p;
    const nx = w0 * P[0] + w1 * P[3] + w2 * P[6] + w3 * P[9];
    const ny = w0 * P[1] + w1 * P[4] + w2 * P[7] + w3 * P[10];
    const nz = w0 * P[2] + w1 * P[5] + w2 * P[8] + w3 * P[11];
    e.vx = (nx - e.x) * 60;
    e.vy = (ny - e.y) * 60;
    e.x = nx;
    e.y = ny;
    e.z = nz;
    return t >= 1;
  }

  private updateEnemies(dt: number): void {
    const p = this.player;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.t += dt;
      e.flash = Math.max(0, e.flash - dt);
      if (e.invuln > 0 && e.invuln < 50) e.invuln -= dt;
      e.roll += (clamp(-e.vx / 30, -1, 1) - e.roll) * Math.min(1, dt * 5);
      switch (e.kind) {
        case 'wasp':
          if (this.follow(e)) e.alive = false;
          break;
        case 'hornet':
        case 'lantern':
        case 'bulwark':
          if (e.state === 0) {
            if (this.follow(e)) {
              e.state = 1;
              e.stateSteps = 0;
              e.u0 = e.x;
              e.u1 = e.y;
            }
          } else if (e.state === 1) {
            const amp = e.kind === 'hornet' ? 7 : 3;
            const nx = e.u0 + Math.sin(e.t * (e.kind === 'hornet' ? 1.2 : 0.6) + e.id) * amp;
            e.vx = (nx - e.x) / Math.max(dt, 1e-4);
            e.x = nx;
            e.y = e.u1 + Math.sin(e.t * 0.9 + e.id) * 1;
            if (e.stateSteps >= e.hold) e.state = 2;
          } else {
            e.vy += 30 * dt;
            e.y += e.vy * dt;
            e.z -= 20 * dt;
            if (e.y > 40) e.alive = false;
          }
          break;
        case 'mine':
          e.z += e.vz * dt;
          e.x += (p.x - e.x) * dt * 0.25;
          e.y += (p.y - e.y) * dt * 0.25;
          if (e.z > -22) {
            this.burst(e, 10, 15);
            e.alive = false;
            this.emit({ t: 'boom', x: e.x, y: e.y, z: e.z, size: 0 });
          }
          break;
        case 'turret':
          e.z += e.vz * dt;
          if (e.z > 20) e.alive = false;
          break;
        case 'boss':
          this.updateBoss(e, dt);
          break;
        case 'part': {
          const b = e.owner!;
          if (!b.alive) {
            e.alive = false;
            break;
          }
          let ox = e.ox;
          let oy = e.oy;
          if (b.boss === 'maelstrom' || b.boss === 'warden') {
            const a = Math.atan2(e.oy, e.ox) + b.t * (b.boss === 'maelstrom' ? 0.5 : -0.7);
            const r = Math.hypot(e.ox, e.oy);
            ox = Math.cos(a) * r;
            oy = Math.sin(a) * r;
          }
          e.x = b.x + ox;
          e.y = b.y + oy;
          e.z = b.z + e.oz;
          if (b.state === 1 && e.invuln > 50) e.invuln = 0;
          break;
        }
      }
      // ramming
      if (e.alive && p.alive && Math.abs(e.z) < e.r + 0.5 && e.kind !== 'boss') {
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        if (dx * dx + dy * dy < (e.r * 0.8 + this.diff.hitbox) ** 2) this.hurt();
      }
    }
  }

  private updateBoss(b: Enemy, dt: number): void {
    if (b.state === 0) {
      const k = Math.min(1, b.t / b.dur);
      const e = easeOutCubic(k);
      b.z = -360 + (HOLD_Z - -360) * e;
      b.y = 26 + (7 - 26) * e;
      if (k >= 1) {
        b.state = 1;
        b.invuln = this.parts(b).length ? 999 : 0;
        if (b.invuln > 50 && this.parts(b).length === 0) b.invuln = 0;
      }
      return;
    }
    if (b.phase === 0 && this.parts(b).length > 0) b.invuln = 999;
    else if (b.invuln > 50) b.invuln = 0;
    const sp = b.phase === 2 ? 1.4 : 1;
    const tx = Math.sin(b.t * 0.37 * sp) * 8;
    const ty = 6.5 + Math.sin(b.t * 0.53 * sp) * 2.5;
    b.vx = (tx - b.x) * 1.5;
    b.x += b.vx * dt;
    b.y += (ty - b.y) * Math.min(1, dt * 1.5);
    b.z = HOLD_Z + Math.sin(b.t * 0.4) * 6;
  }

  private enemyStep(e: Enemy, ev: StepEvent): void {
    const beat = ev.pos % 4 === 0;
    const z = e.z;
    const inRange = z < -30 && z > -200;
    switch (e.kind) {
      case 'wasp':
        if (e.shooter && beat && inRange && e.u0 < 2 && e.steps > 6) {
          e.u0++;
          this.fan(e, e.u2 ? 3 : 1, 0.25, 40, false, 0);
          this.emit({ t: 'shoot', x: e.x, y: e.y, z: e.z });
        }
        break;
      case 'hornet':
        if (e.state === 1 && (ev.pos === 0 || ev.pos === 8)) {
          this.fan(e, e.u2 ? 5 : 3, 0.35, 42, false, 0);
          this.emit({ t: 'shoot', x: e.x, y: e.y, z: e.z });
        }
        break;
      case 'lantern':
        if (e.state === 1) {
          if (beat) {
            this.ring(e, e.u2 ? 14 : 10, 0.13, 30, e.steps * 0.2, 1);
          }
          if (ev.pos === 6) this.fan(e, 1, 0, 46, true, 0);
        }
        break;
      case 'bulwark':
        if (e.state === 1) {
          if (ev.pos === 0 && (e.stateSteps / 16) % 2 < 1) this.wall(e, 30, 0);
          if (ev.pos === 8) this.fan(e, 5, 0.5, 38, true, 1);
        }
        break;
      case 'turret':
        if (beat && z < -40 && z > -190) {
          this.fan(e, e.u2 ? 3 : 1, 0.2, 44, false, 1);
          this.emit({ t: 'shoot', x: e.x, y: e.y, z: e.z });
        }
        break;
      case 'part':
        this.partStep(e, ev);
        break;
      case 'boss':
        this.bossStep(e, ev);
        break;
      default:
        break;
    }
  }

  private partStep(e: Enemy, ev: StepEvent): void {
    const b = e.owner!;
    if (b.state !== 1) return;
    switch (b.boss) {
      case 'colossus':
        if (e.partIndex < 2 && (ev.pos === 0 || ev.pos === 8) && (e.partIndex === 0) === (ev.pos === 0)) this.fan(e, 3, 0.3, 40, false, 0);
        if (e.partIndex === 2 && ev.pos === 4) this.fan(e, 1, 0, 34, true, 1);
        break;
      case 'maelstrom':
        if (ev.pos % 4 === e.partIndex) this.ring(e, 6, 0.08, 34, b.t, 1);
        break;
      case 'warden':
        if (ev.pos === e.partIndex * 2 % 16) this.fan(e, 1, 0, 44, false, e.partIndex % 2);
        break;
    }
  }

  private bossStep(b: Enemy, ev: StepEvent): void {
    if (b.state !== 1 || b.invuln > 0 && b.invuln < 50) return;
    b.u0 += 1;
    const pos = ev.pos;
    switch (b.boss) {
      case 'colossus':
        if (b.phase === 1) {
          if (pos % 4 === 0) this.ring(b, 14, 0.12, 32, b.u0 * 0.15, 1);
          if (pos === 6 || pos === 14) this.fan(b, 5, 0.5, 42, false, 0);
        } else if (b.phase === 2) {
          if (pos % 2 === 0) this.ring(b, 4, 0.1, 30, b.u0 * 0.3, 1);
          if (pos === 0) this.fan(b, 7, 0.7, 40, true, 0);
          if (pos === 8 && ev.bar % 2 === 0) this.wall(b, 28, 0);
        }
        break;
      case 'maelstrom':
        if (b.phase === 1) {
          if (pos === 0) this.wall(b, 28, 0);
          if (pos === 8 || pos === 12) this.ring(b, 16, 0.14, 30, b.u0 * 0.1, 1);
        } else if (b.phase === 2) {
          if (pos === 0 && ev.bar % 2 === 0) this.addBeams(2);
          if (pos % 2 === 0) this.ring(b, 3, 0.1, 30, b.u0 * 0.35, 1);
          if (pos === 4) this.fan(b, 5, 0.45, 40, true, 0);
        }
        break;
      case 'warden':
        if (b.phase === 1) {
          if (pos % 4 === 0) {
            this.ring(b, 12, 0.1, 30, b.u0 * 0.12, 1);
            this.ring(b, 12, 0.2, 26, -b.u0 * 0.12, 0);
          }
          if (pos === 0 && ev.bar % 2 === 0) this.addBeams(1);
        } else if (b.phase === 2) {
          if (pos % 2 === 0) {
            this.ring(b, 3, 0.09, 30, b.u0 * 0.3, 1);
            this.ring(b, 3, 0.09, 30, -b.u0 * 0.3, 0);
          }
          if (pos === 0 && ev.bar % 2 === 1) this.addBeams(2);
          if (pos === 8 && ev.bar % 4 === 0) this.wall(b, 26, 1);
        }
        break;
    }
  }

  private addBeams(n: number): void {
    const p = this.player;
    for (let k = 0; k < n; k++) {
      const x = k === 0 ? p.x : this.rng.range(-FIELD.x, FIELD.x);
      const y = clamp(p.y + this.rng.range(-2, 2), FIELD.yMin, FIELD.yMax);
      this.beams.push({ x, y, vx: this.rng.sign() * this.rng.range(2, 5), vy: 0, r: 2, warm: 4 * this.stepDur, life: 8 * this.stepDur });
      this.emit({ t: 'beamWarn', x, y });
    }
  }
}
