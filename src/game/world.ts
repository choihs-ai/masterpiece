/**
 * The simulation. Owns every entity and rule; knows nothing about rendering, audio or DOM.
 * Presentation layers read its state and drain `events` each frame.
 */
import type { StepEvent } from '../core/beat';
import { clamp, easeOutCubic, segDist2, TAU } from '../core/math';
import { RNG } from '../core/rng';
import type { Difficulty, ShipId } from '../core/save';
import { BOSSES } from './bosses';
import { BF_FROZEN, BF_GRAZED, Bhv, BulletPool, PickupPool } from './bullets';
import { Director } from './director';
import { adjustSpawnOrigin, ENEMIES, type SpawnSpec } from './enemies';
import { Enemy, type Laser } from './entity';
import type { BossId } from './ids';
import { Player } from './player';
import { DIFFICULTY, SECTORS, type DiffParams } from './sectors';
import { Shape, type GameEvent, type PopupKind } from './types';
import type { UpgradeId } from './upgrades';
import { onStepWeapons, PB_MISSILE, updateWeapons } from './weapons';

export interface InputState {
  /** analog move vector from keyboard/gamepad, -1..1 */
  mx: number;
  my: number;
  /** accumulated touch/mouse drag in world units, consumed by the sim */
  dragX: number;
  dragY: number;
  focus: boolean;
  pulse: boolean;
  pulsePerfect: boolean;
}

export interface RunStats {
  kills: number;
  grazes: number;
  perfects: number;
  pulses: number;
  hits: number;
  maxChain: number;
  time: number;
  bosses: number;
  sector: number;
  upgrades: UpgradeId[];
  flawlessSectors: number;
}

export interface Pulse {
  x: number;
  y: number;
  r: number;
  maxR: number;
  t: number;
  dur: number;
  perfect: boolean;
  dmg: number;
  hit: Set<number>;
}

export interface WorldOptions {
  seed: number;
  ship: ShipId;
  difficulty: Difficulty;
  daily?: boolean;
  startSector?: number;
}

export class World {
  readonly W = 56;
  readonly H = 100;
  readonly seed: number;
  readonly rng: RNG;
  readonly difficulty: Difficulty;
  readonly diff: DiffParams;
  readonly daily: boolean;
  readonly player: Player;
  readonly pb = new BulletPool(1200);
  readonly eb = new BulletPool(2800);
  readonly pickups = new PickupPool(700);
  enemies: Enemy[] = [];
  private enemyPool: Enemy[] = [];
  private nextId = 1;
  boss: Enemy | null = null;
  lasers: Laser[] = [];
  pulse: Pulse | null = null;
  events: GameEvent[] = [];
  readonly stats: RunStats;
  readonly director: Director;
  readonly input: InputState = { mx: 0, my: 0, dragX: 0, dragY: 0, focus: false, pulse: false, pulsePerfect: false };

  time = 0;
  paused = false;
  hitStop = 0;
  slowT = 0;
  slowScale = 1;
  freezeT = 0;
  gravity = 0;
  stepDur = 0.125;
  sector = 0;
  score = 0;
  chain = 0;
  chainT = 0;
  mult = 1;
  over = false;
  won = false;
  sectorHits = 0;
  bulletSpeed = 1;
  density = 1;
  speedMul = 1;
  hpMul = 1;
  private grazeCd = 0;
  private hitFx = 0;
  private pickupCombo = 0;
  private pickupComboT = 0;
  invincible = false;

  constructor(opts: WorldOptions) {
    this.seed = opts.seed >>> 0;
    this.rng = new RNG(this.seed);
    this.difficulty = opts.difficulty;
    this.diff = DIFFICULTY[opts.difficulty];
    this.daily = !!opts.daily;
    this.player = new Player(opts.ship, opts.difficulty);
    this.stats = {
      kills: 0,
      grazes: 0,
      perfects: 0,
      pulses: 0,
      hits: 0,
      maxChain: 0,
      time: 0,
      bosses: 0,
      sector: 0,
      upgrades: [],
      flawlessSectors: 0,
    };
    this.director = new Director(this);
    this.enterSector(opts.startSector ?? 0);
  }

  start(): void {
    this.director.start(this.sector);
  }

  enterSector(i: number): void {
    const s = SECTORS[i];
    this.sector = i;
    this.stats.sector = Math.max(this.stats.sector, i);
    this.bulletSpeed = this.diff.bulletSpeed * s.speedMul;
    this.density = this.diff.density * s.densityMul;
    this.speedMul = s.speedMul;
    this.hpMul = this.diff.enemyHp * s.hpMul;
    this.sectorHits = 0;
  }

  emit(e: GameEvent): void {
    if (this.events.length < 600) this.events.push(e);
  }

  popup(x: number, y: number, text: string, kind: PopupKind): void {
    this.emit({ t: 'popup', x, y, text, kind });
  }

  get firing(): boolean {
    const p = this.director.phase;
    return p !== 'warp' && p !== 'victory' && p !== 'dead' && p !== 'sectorClear' && p !== 'bossDead';
  }

  liveEnemies(): number {
    let n = 0;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  /* ------------------------------------------------------------ */
  /* spawning                                                      */
  /* ------------------------------------------------------------ */

  private obtain(): Enemy {
    const e = this.enemyPool.pop() ?? new Enemy();
    e.reset();
    e.id = this.nextId++;
    this.enemies.push(e);
    return e;
  }

  spawnEnemy(s: SpawnSpec): Enemy | null {
    if (s.kind === 'boss') return null;
    if (this.enemies.length > 70) return null;
    const def = ENEMIES[s.kind];
    const e = this.obtain();
    e.kind = s.kind;
    e.elite = !!s.elite;
    e.dir = s.dir ?? 1;
    const hp = def.hp * this.hpMul * (e.elite ? 2.5 : 1);
    e.hp = e.maxHp = hp;
    e.r = def.r * (e.elite ? 1.15 : 1);
    e.score = def.score * (e.elite ? 3 : 1);
    e.notes = def.notes * (e.elite ? 3 : 1);
    e.size = def.size;
    e.color = s.kind === 'weaver' || s.kind === 'spinner' || s.kind === 'bulwark' ? 1 : 0;
    def.init(e, this, s);
    adjustSpawnOrigin(e, s);
    return e;
  }

  spawnBoss(id: BossId): void {
    const def = BOSSES[id];
    const e = this.obtain();
    e.kind = 'boss';
    e.boss = id;
    e.hp = e.maxHp = def.hp * this.diff.bossHp;
    e.r = def.r;
    e.score = def.score;
    e.notes = 40;
    e.size = 4;
    e.x = 0;
    e.y = 78;
    e.x0 = 0;
    e.y0 = 78;
    e.x2 = 0;
    e.y2 = def.homeY;
    e.state = 0;
    e.dur = 32 * this.stepDur;
    e.invuln = 999;
    e.spinRate = 0.6;
    this.boss = e;
    this.emit({ t: 'bossStart', id });
    this.emit({ t: 'shake', amount: 0.8 });
    this.emit({ t: 'flash', color: '#ffffff', amount: 0.5 });
  }

  addLaser(owner: Enemy | null, base: number, amp: number, freq: number, width: number, warm: number, c: number): void {
    this.lasers.push({
      x: owner ? owner.x : 0,
      y: owner ? owner.y : 0,
      ang: base,
      angv: 0,
      len: 150,
      width,
      warm,
      life: Infinity,
      owner,
      base,
      amp,
      freq,
      t: 0,
      c,
    });
  }

  removeEnemy(e: Enemy, silent = false): void {
    if (!e.alive) return;
    e.alive = false;
    if (silent) this.emit({ t: 'bulletBurst', x: e.x, y: e.y, c: 2, n: 6 });
  }

  dismissEnemies(): void {
    for (const e of this.enemies) if (e.alive && e.kind !== 'boss') e.alive = false;
  }

  /* ------------------------------------------------------------ */
  /* main update                                                   */
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
      sdt *= this.slowScale;
    }
    this.time += sdt;
    if (this.player.alive) this.stats.time += dt;
    this.updatePlayer(dt);
    updateWeapons(this, sdt);
    this.updateEnemies(sdt);
    this.updateEnemyBullets(sdt);
    this.updatePlayerBullets(sdt);
    this.updateLasers(sdt);
    this.updatePulse(sdt);
    this.updatePickups(sdt);
    if (this.chainT > 0) {
      this.chainT -= dt;
      if (this.chainT <= 0) this.chain = 0;
    }
    this.mult = Math.min(8, 1 + this.chain * 0.02);
    this.grazeCd = Math.max(0, this.grazeCd - dt);
    this.hitFx = Math.max(0, this.hitFx - dt);
    if (this.pickupComboT > 0) {
      this.pickupComboT -= dt;
      if (this.pickupComboT <= 0) this.pickupCombo = 0;
    }
    if (this.freezeT > 0) {
      this.freezeT -= sdt;
      if (this.freezeT <= 0) this.unfreeze();
    }
    // compact dead enemies
    if (this.enemies.some((e) => !e.alive)) {
      const live: Enemy[] = [];
      for (const e of this.enemies) {
        if (e.alive) live.push(e);
        else this.enemyPool.push(e);
      }
      this.enemies = live;
    }
  }

  onStep(ev: StepEvent): void {
    if (this.paused || this.over) return;
    this.stepDur = ev.stepDur;
    this.director.onStep(ev);
    onStepWeapons(this, ev);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.steps++;
      e.stateSteps++;
      if (e.kind === 'boss') this.bossStep(e, ev);
      else ENEMIES[e.kind].step?.(e, this, ev);
    }
  }

  /* ------------------------------------------------------------ */
  /* player                                                        */
  /* ------------------------------------------------------------ */

  private updatePlayer(dt: number): void {
    const p = this.player;
    const inp = this.input;
    if (!p.alive) return;
    const px = p.x;
    const s = p.stats;
    p.focus = inp.focus;
    const speed = s.speed * (inp.focus ? 0.45 : 1);
    let mx = inp.mx;
    let my = inp.my;
    const ml = Math.hypot(mx, my);
    if (ml > 1) {
      mx /= ml;
      my /= ml;
    }
    p.x += mx * speed * dt;
    p.y += my * speed * dt;
    if (inp.dragX !== 0 || inp.dragY !== 0) {
      const len = Math.hypot(inp.dragX, inp.dragY);
      const maxd = 260 * dt;
      const k = len > maxd ? maxd / len : 1;
      p.x += inp.dragX * k;
      p.y += inp.dragY * k;
      inp.dragX *= 1 - k;
      inp.dragY *= 1 - k;
      if (Math.abs(inp.dragX) < 1e-3) inp.dragX = 0;
      if (Math.abs(inp.dragY) < 1e-3) inp.dragY = 0;
    }
    if (this.gravity > 0 && this.boss) {
      const dx = this.boss.x - p.x;
      const dy = this.boss.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      p.x += (dx / d) * this.gravity * dt;
      p.y += (dy / d) * this.gravity * dt;
    }
    p.x = clamp(p.x, -this.W / 2 + 1.5, this.W / 2 - 1.5);
    p.y = clamp(p.y, -this.H / 2 + 3, this.H / 2 - 8);
    p.vx = (p.x - px) / Math.max(dt, 1e-4);
    p.bank += (clamp(p.vx / 60, -1, 1) - p.bank) * Math.min(1, dt * 10);
    if (p.invuln > 0) p.invuln -= dt;
    if (p.dilationCd > 0) p.dilationCd -= dt;
    if (inp.pulse) {
      inp.pulse = false;
      this.firePulse(inp.pulsePerfect);
    }
  }

  addResonance(v: number): void {
    const p = this.player;
    if (p.charges >= p.stats.maxCharges) {
      p.resonance = Math.min(100, p.resonance + v);
      return;
    }
    p.resonance += v;
    if (p.resonance >= 100) {
      p.resonance -= 100;
      p.charges++;
      if (p.charges >= p.stats.maxCharges) p.resonance = Math.min(p.resonance, 100);
      this.emit({ t: 'charge', count: p.charges });
    }
  }

  addScore(v: number): void {
    this.score += Math.round(v * this.diff.scoreMul);
  }

  firePulse(perfect: boolean): void {
    const p = this.player;
    if (!p.alive || this.pulse || p.charges < 1 || this.paused) return;
    p.charges--;
    this.stats.pulses++;
    const s = p.stats;
    this.pulse = {
      x: p.x,
      y: p.y,
      r: 0,
      maxR: perfect ? 54 : 36,
      t: 0,
      dur: perfect ? 0.55 : 0.45,
      perfect,
      dmg: (perfect ? 50 : 25) * (perfect && s.rhythm ? 2 : 1) * s.damage,
      hit: new Set(),
    };
    p.invuln = Math.max(p.invuln, perfect ? 1.6 : 1.1);
    if (perfect) {
      this.stats.perfects++;
      this.addScore(2500 * this.mult);
      this.popup(p.x, p.y + 4, 'PERFECT', 'perfect');
      if (s.rhythm) this.addResonance(60);
    }
    this.emit({ t: 'pulse', x: p.x, y: p.y, perfect, radius: this.pulse.maxR });
    this.emit({ t: 'shake', amount: perfect ? 0.9 : 0.6 });
    this.emit({ t: 'ripple', x: p.x, y: p.y, amount: perfect ? 1 : 0.7 });
  }

  private updatePulse(dt: number): void {
    const pu = this.pulse;
    if (!pu) return;
    pu.t += dt;
    const k = Math.min(1, pu.t / pu.dur);
    pu.r = pu.maxR * easeOutCubic(k);
    const r2 = pu.r * pu.r;
    const eb = this.eb;
    for (let i = eb.count - 1; i >= 0; i--) {
      const dx = eb.x[i] - pu.x;
      const dy = eb.y[i] - pu.y;
      if (dx * dx + dy * dy < r2) {
        if (i % 2 === 0) this.pickups.spawn(eb.x[i], eb.y[i], dx * 0.2, dy * 0.2, 2);
        eb.remove(i);
      }
    }
    for (const e of this.enemies) {
      if (!e.alive || pu.hit.has(e.id)) continue;
      const dx = e.x - pu.x;
      const dy = e.y - pu.y;
      const rr = pu.r + e.r;
      if (dx * dx + dy * dy < rr * rr) {
        pu.hit.add(e.id);
        this.damageEnemy(e, pu.dmg * (e.kind === 'boss' ? 0.6 : 1), e.x, e.y, false, false);
      }
    }
    if (k >= 1) this.pulse = null;
  }

  hurtPlayer(): void {
    const p = this.player;
    if (!p.alive || p.invuln > 0 || this.invincible) return;
    p.hp--;
    this.stats.hits++;
    this.sectorHits++;
    p.invuln = p.stats.invuln;
    this.chain = Math.floor(this.chain * 0.3);
    this.clearBullets(p.x, p.y, 14, false);
    this.hitStop = 0.07;
    this.emit({ t: 'playerHit', x: p.x, y: p.y, hp: p.hp });
    this.emit({ t: 'shake', amount: 1.2 });
    this.emit({ t: 'flash', color: '#ff2040', amount: 0.55 });
    this.emit({ t: 'ripple', x: p.x, y: p.y, amount: 0.6 });
    if (p.hp <= 0) {
      if (p.stats.phoenix && !p.phoenixUsed) {
        p.phoenixUsed = true;
        p.hp = 3;
        p.invuln = 3;
        this.clearBullets(0, 0, 999, true);
        this.emit({ t: 'revive', x: p.x, y: p.y });
        this.popup(p.x, p.y + 5, 'REVIVE', 'heal');
        return;
      }
      p.alive = false;
      this.slowT = 2.5;
      this.slowScale = 0.3;
      this.emit({ t: 'playerDie', x: p.x, y: p.y });
      this.director.playerDied();
      return;
    }
    if (p.stats.phasePulse) {
      this.clearBullets(p.x, p.y, 26, true);
      this.emit({ t: 'pulse', x: p.x, y: p.y, perfect: false, radius: 26 });
    }
  }

  clearBullets(x: number, y: number, r: number, toNotes: boolean): void {
    const eb = this.eb;
    const r2 = r * r;
    let n = 0;
    for (let i = eb.count - 1; i >= 0; i--) {
      const dx = eb.x[i] - x;
      const dy = eb.y[i] - y;
      if (dx * dx + dy * dy < r2) {
        if (toNotes && (n++ & 1) === 0) this.pickups.spawn(eb.x[i], eb.y[i], 0, 2, 2);
        eb.remove(i);
      }
    }
  }

  freezeBullets(dur: number): void {
    this.freezeT = dur;
    const eb = this.eb;
    for (let i = 0; i < eb.count; i++) eb.flags[i] |= BF_FROZEN;
    this.emit({ t: 'flash', color: '#c8b8ff', amount: 0.25 });
    this.emit({ t: 'ripple', x: this.boss ? this.boss.x : 0, y: this.boss ? this.boss.y : 30, amount: 0.5 });
  }

  private unfreeze(): void {
    const eb = this.eb;
    const p = this.player;
    for (let i = 0; i < eb.count; i++) {
      if (!(eb.flags[i] & BF_FROZEN)) continue;
      eb.flags[i] &= ~BF_FROZEN;
      const sp = Math.max(10, Math.hypot(eb.vx[i], eb.vy[i])) * 1.05;
      const toPlayer = (i & 1) === 0;
      if (toPlayer) {
        const a = Math.atan2(p.y - eb.y[i], p.x - eb.x[i]);
        eb.vx[i] = Math.cos(a) * sp;
        eb.vy[i] = Math.sin(a) * sp;
        eb.angv[i] = 0;
      }
    }
  }

  /* ------------------------------------------------------------ */
  /* enemies                                                       */
  /* ------------------------------------------------------------ */

  private updateEnemies(dt: number): void {
    const p = this.player;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.t += dt;
      e.flash = Math.max(0, e.flash - dt);
      e.spin += dt * e.spinRate;
      if (e.chainCd > 0) e.chainCd -= dt;
      if (e.kind === 'boss') this.updateBoss(e, dt);
      else ENEMIES[e.kind].update(e, this, dt);
      if (!e.alive) continue;
      // body collision with the player
      if (p.alive && p.invuln <= 0) {
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const rr = e.r * 0.8 + this.diff.hitbox;
        if (dx * dx + dy * dy < rr * rr) this.hurtPlayer();
      }
    }
  }

  private updateBoss(b: Enemy, dt: number): void {
    const def = BOSSES[b.boss!];
    if (b.state === 0) {
      const k = Math.min(1, b.t / b.dur);
      b.y = b.y0 + (def.homeY - b.y0) * easeOutCubic(k);
      if (k >= 1) {
        b.state = 1;
        b.invuln = 0;
        b.x2 = b.x;
        b.y2 = b.y;
        def.phases[0].enter?.(b, this);
      }
      return;
    }
    if (b.invuln > 0) b.invuln -= dt;
    def.phases[b.phase].update?.(b, this, dt);
  }

  private bossStep(b: Enemy, ev: StepEvent): void {
    if (b.state !== 1 || b.invuln > 0) return;
    b.phaseSteps++;
    BOSSES[b.boss!].phases[b.phase].step(b, this, ev);
  }

  private bossPhaseCheck(b: Enemy): void {
    const def = BOSSES[b.boss!];
    const frac = b.hp / b.maxHp;
    while (b.phase < def.phases.length - 1 && frac <= def.phases[b.phase].until) {
      b.phase++;
      b.phaseSteps = 0;
      b.invuln = 6 * this.stepDur;
      this.lasers = this.lasers.filter((l) => l.owner !== b);
      this.freezeT = 0;
      for (let i = 0; i < this.eb.count; i++) this.eb.flags[i] &= ~BF_FROZEN;
      this.clearBullets(0, 0, 999, true);
      this.emit({ t: 'bossPhase', phase: b.phase });
      this.emit({ t: 'shake', amount: 0.9 });
      this.emit({ t: 'flash', color: '#ffffff', amount: 0.45 });
      this.emit({ t: 'ripple', x: b.x, y: b.y, amount: 1 });
      if (b.phase === def.phases.length - 1) this.emit({ t: 'music', cue: { intensity: 4 } });
      def.phases[b.phase].enter?.(b, this);
    }
  }

  damageEnemy(e: Enemy, dmg: number, x: number, y: number, crit: boolean, canChain: boolean, quiet = false): void {
    if (!e.alive || e.invuln > 0) return;
    e.hp -= dmg;
    e.flash = 0.07;
    if (!quiet && this.hitFx <= 0) {
      this.hitFx = 0.02;
      this.emit({ t: 'hit', x, y, c: e.color, crit });
    }
    if (e.kind === 'boss') {
      if (e.hp <= 0 && e.phase >= BOSSES[e.boss!].phases.length - 1) this.killBoss(e);
      else {
        if (e.hp <= 0) e.hp = 1;
        this.bossPhaseCheck(e);
      }
      return;
    }
    if (e.hp <= 0) {
      this.killEnemy(e);
      return;
    }
    const s = this.player.stats;
    if (canChain && s.chainChance > 0 && e.chainCd <= 0 && this.rng.next() < s.chainChance) {
      e.chainCd = 0.18;
      this.chainLightning(e, dmg * 1.2, s.chainTargets);
    }
  }

  private chainLightning(from: Enemy, dmg: number, targets: number): void {
    const pts = [from.x, from.y];
    const hit = new Set<number>([from.id]);
    let cur = from;
    for (let k = 0; k < targets; k++) {
      let best: Enemy | null = null;
      let bd = 18 * 18;
      for (const e of this.enemies) {
        if (!e.alive || hit.has(e.id)) continue;
        const dx = e.x - cur.x;
        const dy = e.y - cur.y;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      if (!best) break;
      hit.add(best.id);
      pts.push(best.x, best.y);
      this.damageEnemy(best, dmg, best.x, best.y, false, false, true);
      cur = best;
    }
    if (pts.length > 2) this.emit({ t: 'lightning', pts });
  }

  private killEnemy(e: Enemy): void {
    e.alive = false;
    this.stats.kills++;
    this.chain++;
    this.chainT = 2.6;
    this.stats.maxChain = Math.max(this.stats.maxChain, this.chain);
    const pts = e.score * this.mult;
    this.addScore(pts);
    this.addResonance(0.6 + e.size * 0.9);
    this.emit({ t: 'kill', x: e.x, y: e.y, size: e.size, c: e.color, kind: e.kind, elite: e.elite, score: Math.round(pts * this.diff.scoreMul) });
    if (e.size >= 2) this.emit({ t: 'shake', amount: 0.25 + 0.1 * e.size });
    if (e.size >= 3) this.hitStop = Math.max(this.hitStop, 0.035);
    const n = e.notes;
    for (let k = 0; k < n; k++) {
      const a = this.rng.range(0, TAU);
      const sp = this.rng.range(4, 12);
      this.pickups.spawn(e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp + 8, 0);
    }
    const heartChance = e.elite ? 0.3 : e.kind === 'bulwark' || e.kind === 'carrier' ? 0.15 : 0;
    if (heartChance > 0 && this.rng.next() < heartChance) this.pickups.spawn(e.x, e.y, 0, 10, 1);
    ENEMIES[e.kind as Exclude<typeof e.kind, 'boss'>].death?.(e, this);
  }

  private killBoss(b: Enemy): void {
    b.alive = false;
    this.boss = null;
    this.gravity = 0;
    this.freezeT = 0;
    this.lasers = [];
    this.stats.bosses++;
    this.stats.kills++;
    this.addScore(b.score);
    this.clearBullets(0, 0, 999, true);
    for (const e of this.enemies) if (e.alive && e.kind !== 'boss') this.killEnemy(e);
    for (let k = 0; k < 40; k++) {
      const a = this.rng.range(0, TAU);
      const sp = this.rng.range(6, 22);
      this.pickups.spawn(b.x, b.y, Math.cos(a) * sp, Math.sin(a) * sp + 6, 0);
    }
    this.pickups.spawn(b.x, b.y, 0, 8, 1);
    this.slowT = 1.4;
    this.slowScale = 0.3;
    this.emit({ t: 'bossDefeated', x: b.x, y: b.y, id: b.boss! });
    this.emit({ t: 'shake', amount: 2 });
    this.emit({ t: 'flash', color: '#ffffff', amount: 0.9 });
    this.emit({ t: 'ripple', x: b.x, y: b.y, amount: 1.4 });
    this.popup(b.x, b.y, `+${Math.round(b.score * this.diff.scoreMul).toLocaleString()}`, 'score');
    this.director.bossDefeated();
  }

  /* ------------------------------------------------------------ */
  /* bullets                                                       */
  /* ------------------------------------------------------------ */

  private updateEnemyBullets(dt: number): void {
    const eb = this.eb;
    const p = this.player;
    const s = p.stats;
    const hb = this.diff.hitbox;
    const gr = s.grazeRadius;
    const frozen = this.freezeT > 0;
    const orbN = p.alive ? s.orbitals : 0;
    const halfW = this.W / 2 + 6;
    const halfH = this.H / 2 + 8;
    for (let i = eb.count - 1; i >= 0; i--) {
      eb.life[i] += dt;
      if (eb.life[i] > eb.ttl[i]) {
        eb.remove(i);
        continue;
      }
      if (frozen && eb.flags[i] & BF_FROZEN) continue;
      const life = eb.life[i];
      switch (eb.bhv[i]) {
        case Bhv.StopReaim: {
          if (life < eb.p1[i]) {
            const k = Math.max(0, 1 - dt / Math.max(0.01, eb.p1[i] - life + dt));
            eb.vx[i] *= k;
            eb.vy[i] *= k;
          } else if (life >= eb.p2[i] && eb.p3[i] > 0) {
            const a = Math.atan2(p.y - eb.y[i], p.x - eb.x[i]);
            eb.vx[i] = Math.cos(a) * eb.p3[i] * this.bulletSpeed;
            eb.vy[i] = Math.sin(a) * eb.p3[i] * this.bulletSpeed;
            eb.p3[i] = 0;
            eb.bhv[i] = Bhv.None;
          } else {
            eb.vx[i] = 0;
            eb.vy[i] = 0;
          }
          break;
        }
        case Bhv.Split:
          if (life >= eb.p1[i]) {
            const n = eb.p2[i];
            const sp = eb.p3[i] * this.bulletSpeed;
            const off = Math.atan2(eb.vy[i], eb.vx[i]);
            const x = eb.x[i];
            const y = eb.y[i];
            const c = eb.color[i];
            eb.remove(i);
            for (let k = 0; k < n; k++) {
              const a = off + (k / n) * TAU;
              eb.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, 0.55, 1.55, c, Shape.Orb, 10);
            }
            this.emit({ t: 'bulletBurst', x, y, c, n });
            continue;
          }
          break;
        case Bhv.Wave:
          eb.angv[i] = eb.p1[i] * Math.sin(life * eb.p2[i]);
          break;
        case Bhv.Inward: {
          const dx = eb.p2[i] - eb.x[i];
          const dy = eb.p3[i] - eb.y[i];
          if (dx * dx + dy * dy < eb.p1[i] * eb.p1[i]) {
            eb.remove(i);
            continue;
          }
          break;
        }
        case Bhv.Seek:
          if (life < eb.p2[i]) {
            const a = Math.atan2(eb.vy[i], eb.vx[i]);
            const want = Math.atan2(p.y - eb.y[i], p.x - eb.x[i]);
            let d = want - a;
            d = Math.atan2(Math.sin(d), Math.cos(d));
            const turn = clamp(d, -eb.p1[i] * dt, eb.p1[i] * dt);
            const sp = Math.hypot(eb.vx[i], eb.vy[i]);
            eb.vx[i] = Math.cos(a + turn) * sp;
            eb.vy[i] = Math.sin(a + turn) * sp;
          }
          break;
        case Bhv.Delay:
          if (life < eb.p1[i]) continue;
          if (eb.p2[i] > 0) {
            const a = Math.atan2(eb.vy[i], eb.vx[i]);
            eb.vx[i] = Math.cos(a) * eb.p2[i];
            eb.vy[i] = Math.sin(a) * eb.p2[i];
            eb.p2[i] = 0;
          }
          break;
        default:
          break;
      }
      const av = eb.angv[i];
      if (av !== 0) {
        const c = Math.cos(av * dt);
        const sn = Math.sin(av * dt);
        const vx = eb.vx[i];
        eb.vx[i] = vx * c - eb.vy[i] * sn;
        eb.vy[i] = vx * sn + eb.vy[i] * c;
      }
      const ac = eb.acc[i];
      if (ac !== 0) {
        const sp = Math.hypot(eb.vx[i], eb.vy[i]);
        if (sp > 1e-4) {
          const ns = clamp(sp + ac * dt, 0, eb.maxV[i]);
          eb.vx[i] *= ns / sp;
          eb.vy[i] *= ns / sp;
        }
      }
      eb.x[i] += eb.vx[i] * dt;
      eb.y[i] += eb.vy[i] * dt;
      const x = eb.x[i];
      const y = eb.y[i];
      if (eb.bhv[i] !== Bhv.Inward && (x < -halfW || x > halfW || y < -halfH || y > halfH + 10)) {
        eb.remove(i);
        continue;
      }
      if (!p.alive) continue;
      // orbitals absorb bullets
      if (orbN > 0) {
        let absorbed = false;
        for (let k = 0; k < orbN; k++) {
          if (p.orbCd[k] > 0) continue;
          const ox = x - p.orbX[k];
          const oy = y - p.orbY[k];
          const rr = eb.r[i] + 1.2;
          if (ox * ox + oy * oy < rr * rr) {
            p.orbCd[k] = 0.55;
            absorbed = true;
            break;
          }
        }
        if (absorbed) {
          this.emit({ t: 'bulletBurst', x, y, c: eb.color[i], n: 3 });
          eb.remove(i);
          continue;
        }
      }
      const dx = x - p.x;
      const dy = y - p.y;
      const d2 = dx * dx + dy * dy;
      const rh = eb.r[i] + hb;
      if (d2 < rh * rh) {
        if (p.invuln <= 0 && !this.invincible) {
          eb.remove(i);
          this.hurtPlayer();
        }
        continue;
      }
      if (!(eb.flags[i] & BF_GRAZED)) {
        const rg = eb.r[i] + gr;
        if (d2 < rg * rg) {
          eb.flags[i] |= BF_GRAZED;
          this.graze(x, y, d2 < (rh + 0.9) * (rh + 0.9));
        }
      }
    }
  }

  private graze(x: number, y: number, close: boolean): void {
    const p = this.player;
    this.stats.grazes++;
    this.addScore(10 * this.mult);
    this.addResonance(3.4 * p.stats.grazeGain);
    if (this.chain > 0) this.chainT = Math.max(this.chainT, 1.2);
    if (this.grazeCd <= 0) {
      this.grazeCd = 0.05;
      this.emit({ t: 'graze', x, y });
    }
    if (close && p.stats.dilation && p.dilationCd <= 0) {
      p.dilationCd = 5;
      this.slowT = 0.55;
      this.slowScale = 0.35;
      this.popup(p.x, p.y + 4, 'SLOW', 'info');
    }
  }

  private nearestEnemy(x: number, y: number): Enemy | null {
    let best: Enemy | null = null;
    let bd = Infinity;
    for (const e of this.enemies) {
      if (!e.alive || e.y > 54 || e.invuln > 50) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private updatePlayerBullets(dt: number): void {
    const pb = this.pb;
    const s = this.player.stats;
    for (let i = pb.count - 1; i >= 0; i--) {
      pb.life[i] += dt;
      if (pb.kind[i] === PB_MISSILE) {
        const tgt = this.nearestEnemy(pb.x[i], pb.y[i]);
        let a = Math.atan2(pb.vy[i], pb.vx[i]);
        if (tgt) {
          const want = Math.atan2(tgt.y - pb.y[i], tgt.x - pb.x[i]);
          let d = want - a;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          a += clamp(d, -7 * dt, 7 * dt);
        }
        const sp = Math.min(155, Math.hypot(pb.vx[i], pb.vy[i]) + 190 * dt);
        pb.vx[i] = Math.cos(a) * sp;
        pb.vy[i] = Math.sin(a) * sp;
      }
      pb.x[i] += pb.vx[i] * dt;
      pb.y[i] += pb.vy[i] * dt;
      const x = pb.x[i];
      const y = pb.y[i];
      if (pb.life[i] > pb.ttl[i] || y > 56 || y < -56 || x < -34 || x > 34) {
        pb.remove(i);
        continue;
      }
      const br = pb.r[i];
      for (const e of this.enemies) {
        if (!e.alive || e.invuln > 50) continue;
        if (e.id === pb.hitA[i] || e.id === pb.hitB[i]) continue;
        const dx = e.x - x;
        const dy = e.y - y;
        const rr = e.r + br;
        if (dx * dx + dy * dy < rr * rr) {
          let dmg = pb.dmg[i];
          let crit = false;
          if (s.critChance > 0 && this.rng.next() < s.critChance) {
            dmg *= s.critMul;
            crit = true;
          }
          this.damageEnemy(e, dmg, x, y, crit, true);
          if (pb.pierce[i] > 0) {
            pb.pierce[i]--;
            pb.hitB[i] = pb.hitA[i];
            pb.hitA[i] = e.id;
          } else {
            pb.remove(i);
          }
          break;
        }
      }
    }
  }

  private updateLasers(dt: number): void {
    const p = this.player;
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const l = this.lasers[i];
      l.t += dt;
      if (l.owner) {
        if (!l.owner.alive) {
          this.lasers.splice(i, 1);
          continue;
        }
        l.x = l.owner.x;
        l.y = l.owner.y;
      }
      l.ang = l.amp !== 0 ? l.base + l.amp * Math.sin(l.t * l.freq * TAU * 0.5) : l.ang + l.angv * dt;
      if (l.warm > 0) {
        l.warm -= dt;
        continue;
      }
      l.life -= dt;
      if (l.life <= 0) {
        this.lasers.splice(i, 1);
        continue;
      }
      if (!p.alive) continue;
      const ex = l.x + Math.cos(l.ang) * l.len;
      const ey = l.y + Math.sin(l.ang) * l.len;
      const hw = l.width * 0.32 + this.diff.hitbox;
      if (segDist2(p.x, p.y, l.x, l.y, ex, ey) < hw * hw) this.hurtPlayer();
    }
  }

  /* ------------------------------------------------------------ */
  /* pickups                                                       */
  /* ------------------------------------------------------------ */

  vacuumPickups(): void {
    for (let i = 0; i < this.pickups.count; i++) this.pickups.magnet[i] = 1;
  }

  private updatePickups(dt: number): void {
    const pk = this.pickups;
    const p = this.player;
    const mr = p.stats.magnet;
    const vacuum = this.director.phase === 'waveClear' || this.director.phase === 'bossDead' || this.director.phase === 'sectorClear';
    for (let i = pk.count - 1; i >= 0; i--) {
      pk.life[i] += dt;
      const dx = p.x - pk.x[i];
      const dy = p.y - pk.y[i];
      const d2 = dx * dx + dy * dy;
      if (p.alive && (pk.magnet[i] || vacuum || d2 < mr * mr || pk.kind[i] === 2)) {
        if (pk.kind[i] !== 2 || pk.life[i] > 0.25) {
          pk.magnet[i] = 1;
          const d = Math.sqrt(d2) || 1;
          const acc = 320;
          pk.vx[i] += (dx / d) * acc * dt;
          pk.vy[i] += (dy / d) * acc * dt;
          const sp = Math.hypot(pk.vx[i], pk.vy[i]);
          const max = 110;
          if (sp > max) {
            pk.vx[i] *= max / sp;
            pk.vy[i] *= max / sp;
          }
        }
      } else {
        pk.vy[i] = Math.max(-16, pk.vy[i] - 24 * dt);
        pk.vx[i] *= 1 - 1.5 * dt;
      }
      pk.x[i] += pk.vx[i] * dt;
      pk.y[i] += pk.vy[i] * dt;
      if (p.alive && d2 < 2.6 * 2.6) {
        this.collect(i);
        continue;
      }
      if (pk.y[i] < -58 || pk.life[i] > 14) pk.remove(i);
    }
  }

  private collect(i: number): void {
    const pk = this.pickups;
    const p = this.player;
    const kind = pk.kind[i];
    const x = pk.x[i];
    const y = pk.y[i];
    pk.remove(i);
    if (kind === 1) {
      if (p.hp < p.stats.maxHp) {
        p.hp++;
        this.popup(x, y + 3, '+1 HP', 'heal');
      } else {
        this.addScore(2000 * this.mult);
        this.popup(x, y + 3, '+2000', 'score');
      }
      this.emit({ t: 'pickup', x, y, kind: 'heart', n: 0 });
      return;
    }
    this.addScore((kind === 2 ? 10 : 25) * this.mult);
    this.addResonance(kind === 2 ? 0.25 : 0.7);
    this.pickupCombo++;
    this.pickupComboT = 0.45;
    this.emit({ t: 'pickup', x, y, kind: 'note', n: this.pickupCombo });
  }

  /* ------------------------------------------------------------ */
  /* run flow hooks                                                */
  /* ------------------------------------------------------------ */

  sectorCleared(index: number): void {
    const flawless = this.sectorHits === 0;
    const bonus = 10000 * (index + 1) + (flawless ? 25000 * (index + 1) : 0);
    this.addScore(bonus);
    if (flawless) this.stats.flawlessSectors++;
    const p = this.player;
    if (p.hp < p.stats.maxHp) p.hp++;
    this.emit({ t: 'sectorClear', index, bonus: Math.round(bonus * this.diff.scoreMul), flawless });
  }

  choose(id: UpgradeId): void {
    this.director.choose(id);
  }

  finish(win: boolean): void {
    this.over = true;
    this.won = win;
    this.emit({ t: win ? 'victory' : 'gameOver' });
  }
}
