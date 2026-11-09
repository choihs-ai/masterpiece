/** Regular enemy roster: movement, beat-synced attacks and death behaviour. */
import type { StepEvent } from '../core/beat';
import { DEG, easeOutCubic, TAU } from '../core/math';
import { Bhv } from './bullets';
import type { Enemy } from './entity';
import type { EnemyId } from './ids';
import { aimAt, aimed, dn, fan, ring, shoot, stream } from './patterns';
import { BC, Shape } from './types';
import type { World } from './world';

export type PathKind = 'swoop' | 'dive' | 'uturn' | 'cross' | 'rain' | 'burst';

export interface SpawnSpec {
  kind: EnemyId;
  x: number;
  y?: number;
  path?: PathKind;
  dir?: number;
  hold?: number;
  elite?: boolean;
  shooter?: boolean;
  /** for 'burst' darts: launch angle */
  ang?: number;
}

export interface EnemyDef {
  kind: EnemyId;
  hp: number;
  r: number;
  score: number;
  cost: number;
  notes: number;
  size: number;
  init(e: Enemy, w: World, s: SpawnSpec): void;
  update(e: Enemy, w: World, dt: number): void;
  step?(e: Enemy, w: World, ev: StepEvent): void;
  death?(e: Enemy, w: World): void;
}

const TOP = 58;

/* ---------------- movement helpers ---------------- */

function bez(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

function setPath(e: Enemy, kind: PathKind, x: number, dir: number, y: number, speedMul: number): void {
  switch (kind) {
    case 'swoop':
      e.x0 = x;
      e.y0 = TOP;
      e.x1 = x;
      e.y1 = 8;
      e.x2 = x * 0.1 + dir * 12;
      e.y2 = -14;
      e.x3 = dir * 42;
      e.y3 = -26;
      e.dur = 4.2;
      break;
    case 'dive':
      e.x0 = x;
      e.y0 = TOP;
      e.x1 = x;
      e.y1 = 22;
      e.x2 = x;
      e.y2 = 2;
      e.x3 = x + dir * 36;
      e.y3 = -62;
      e.dur = 3.6;
      break;
    case 'uturn':
      e.x0 = x;
      e.y0 = TOP;
      e.x1 = x;
      e.y1 = -16;
      e.x2 = x + dir * 18;
      e.y2 = -16;
      e.x3 = x + dir * 18;
      e.y3 = TOP + 6;
      e.dur = 4.8;
      break;
    case 'cross':
      e.x0 = -dir * 36;
      e.y0 = y;
      e.x1 = -dir * 12;
      e.y1 = y - 8;
      e.x2 = dir * 12;
      e.y2 = y + 4;
      e.x3 = dir * 38;
      e.y3 = y - 4;
      e.dur = 3.8;
      break;
    case 'rain':
    default:
      e.x0 = x;
      e.y0 = TOP;
      e.x1 = x;
      e.y1 = 28;
      e.x2 = x + dir * 4;
      e.y2 = -4;
      e.x3 = x + dir * 6;
      e.y3 = -62;
      e.dur = 4.6;
      break;
  }
  e.dur /= speedMul;
  e.x = e.x0;
  e.y = e.y0;
}

function followPath(e: Enemy, w: World): void {
  const t = Math.min(1, e.t / e.dur);
  const nx = bez(e.x0, e.x1, e.x2, e.x3, t);
  const ny = bez(e.y0, e.y1, e.y2, e.y3, t);
  e.vx = nx - e.x;
  e.vy = ny - e.y;
  e.x = nx;
  e.y = ny;
  if (t >= 1) w.removeEnemy(e);
}

/** Generic "fly in → hold → leave" behaviour used by most mid-size enemies. */
function enterHold(e: Enemy, w: World, dt: number, exitSpeed = 22): void {
  if (e.state === 0) {
    const t = Math.min(1, e.t / e.dur);
    const k = easeOutCubic(t);
    e.x = e.x0 + (e.x1 - e.x0) * k;
    e.y = e.y0 + (e.y1 - e.y0) * k;
    if (t >= 1) {
      e.state = 1;
      e.stateSteps = 0;
    }
  } else if (e.state === 1) {
    // gentle hover
    e.y = e.y1 + Math.sin(e.t * 1.3 + e.id) * 0.8;
    e.x = e.x1 + Math.sin(e.t * 0.7 + e.id * 1.7) * 1.2;
    if (e.stateSteps >= e.hold) {
      e.state = 2;
      e.stateT = 0;
    }
  } else {
    e.stateT += dt;
    e.vy += exitSpeed * dt;
    e.y += e.vy * dt;
    if (e.y > TOP + 8) w.removeEnemy(e);
  }
}

function setEnter(e: Enemy, x: number, holdY: number, dur: number, fromX = x, fromY = TOP): void {
  e.x0 = fromX;
  e.y0 = fromY;
  e.x1 = x;
  e.y1 = holdY;
  e.x = fromX;
  e.y = fromY;
  e.dur = dur;
}

const holding = (e: Enemy): boolean => e.state === 1;

/* ---------------- definitions ---------------- */

export const ENEMIES: Record<Exclude<EnemyId, 'boss'>, EnemyDef> = {
  dart: {
    kind: 'dart',
    hp: 3,
    r: 1.7,
    score: 100,
    cost: 1,
    notes: 1,
    size: 0,
    init(e, w, s) {
      if (s.path === 'burst') {
        e.state = 9;
        e.vx = Math.cos(s.ang ?? 0) * 26;
        e.vy = Math.sin(s.ang ?? 0) * 26;
        e.x = s.x;
        e.y = s.y ?? 30;
      } else {
        setPath(e, s.path ?? 'swoop', s.x, s.dir ?? 1, s.y ?? 30, w.speedMul);
      }
      e.shooter = !!s.shooter;
      e.spinRate = 3;
    },
    update(e, w, dt) {
      if (e.state === 9) {
        e.vx *= 1 - 0.9 * dt;
        e.vy -= 18 * dt;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        if (e.y < -60 || Math.abs(e.x) > 44) w.removeEnemy(e);
        return;
      }
      followPath(e, w);
    },
    step(e, w, ev) {
      if (!e.shooter && !e.elite) return;
      if (ev.pos % 4 !== 0 || e.y > 48 || e.y < -20) return;
      if (e.steps >= 6 && e.u0 < (e.elite ? 3 : 1)) {
        e.u0++;
        if (e.elite) aimed(w, e.x, e.y, 3, 26 * DEG, 20, { size: 's', c: BC.A });
        else shoot(w, e.x, e.y, aimAt(w, e.x, e.y), 19, { size: 's', c: BC.A });
        w.emit({ t: 'enemyShoot', x: e.x, y: e.y, size: 0 });
      }
    },
  },

  weaver: {
    kind: 'weaver',
    hp: 8,
    r: 2,
    score: 200,
    cost: 2,
    notes: 2,
    size: 1,
    init(e, w, s) {
      e.x0 = s.x;
      e.x = s.x;
      e.y = TOP;
      e.vy = -9 * w.speedMul;
      e.u1 = (s.dir ?? 1) * 1.3;
      e.spinRate = 1.5;
    },
    update(e, w, dt) {
      e.y += e.vy * dt;
      e.x = e.x0 + 9 * Math.sin(e.t * 1.5 + e.u1);
      if (e.y < -60) w.removeEnemy(e);
    },
    step(e, w, ev) {
      if (ev.pos % 4 !== 0 || e.steps < 4 || e.y > 50) return;
      const n = e.elite ? 3 : 1;
      fan(w, e.x, e.y, -Math.PI / 2, n, 30 * DEG, 13, { size: 'm', c: BC.B });
    },
  },

  mine: {
    kind: 'mine',
    hp: 5,
    r: 1.9,
    score: 150,
    cost: 1.5,
    notes: 1,
    size: 1,
    init(e, w, s) {
      e.x = s.x;
      e.y = TOP;
      e.vy = -7 * w.speedMul;
      e.vx = (s.dir ?? 1) * 2.5;
      e.spinRate = 2.2;
    },
    update(e, w, dt) {
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      if (e.y < -60) w.removeEnemy(e);
    },
    step(e, w, ev) {
      // fuse: detonates on a downbeat after ~1.5 bars on screen
      if (e.steps >= 24 && ev.pos % 8 === 0 && e.y < 48) {
        ring(w, e.x, e.y, e.elite ? 16 : 10, 13, e.id * 0.7, { size: 's', c: BC.C });
        w.emit({ t: 'bulletBurst', x: e.x, y: e.y, c: BC.C, n: 10 });
        w.removeEnemy(e, true);
      }
    },
    death(e, w) {
      ring(w, e.x, e.y, e.elite ? 12 : 7, 11, e.id * 0.7, { size: 's', c: BC.C });
    },
  },

  sentinel: {
    kind: 'sentinel',
    hp: 16,
    r: 2.6,
    score: 300,
    cost: 5,
    notes: 3,
    size: 1,
    init(e, w, s) {
      setEnter(e, s.x, s.y ?? 30, 1.4);
      e.hold = s.hold ?? 64;
      e.spinRate = 0.9;
    },
    update(e, w, dt) {
      enterHold(e, w, dt);
    },
    step(e, w, ev) {
      if (!holding(e)) return;
      if (ev.pos === 0 || ev.pos === 8) {
        aimed(w, e.x, e.y, e.elite ? 5 : 3, (e.elite ? 40 : 24) * DEG, 20, { size: 'm', c: BC.A });
        w.emit({ t: 'enemyShoot', x: e.x, y: e.y, size: 1 });
      }
    },
  },

  lancer: {
    kind: 'lancer',
    hp: 7,
    r: 1.9,
    score: 250,
    cost: 2.5,
    notes: 2,
    size: 0,
    init(e, w, s) {
      setEnter(e, s.x, s.y ?? 36, 0.9);
      e.spinRate = 0;
    },
    update(e, w, dt) {
      if (e.state === 0) {
        enterHold(e, w, dt);
        e.aim = aimAt(w, e.x, e.y);
      } else if (e.state === 1) {
        // tracking: aim follows the player until locked
        if (e.u0 === 0) e.aim = aimAt(w, e.x, e.y);
        e.x += Math.sin(e.t * 9) * 0.02;
      } else if (e.state === 3) {
        const sp = 78 * w.speedMul;
        e.vx = Math.cos(e.aim) * sp;
        e.vy = Math.sin(e.aim) * sp;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        if (e.y < -62 || e.y > 66 || Math.abs(e.x) > 46) w.removeEnemy(e);
      }
      e.spin = e.aim + Math.PI / 2;
    },
    step(e, w, ev) {
      if (e.state !== 1 || ev.pos % 4 !== 0) return;
      if (e.u0 === 0 && e.stateSteps >= 6) {
        e.u0 = 1; // lock aim, show telegraph for one beat
        e.tele = 1;
        w.emit({ t: 'laserWarn', x: e.x, y: e.y });
      } else if (e.u0 === 1 && e.stateSteps >= 10) {
        e.state = 3;
        e.tele = 0;
        if (e.elite) fan(w, e.x, e.y, e.aim + Math.PI, 3, 50 * DEG, 14, { size: 's', c: BC.B });
        w.emit({ t: 'enemyShoot', x: e.x, y: e.y, size: 1 });
      }
    },
  },

  spinner: {
    kind: 'spinner',
    hp: 26,
    r: 2.8,
    score: 400,
    cost: 7,
    notes: 4,
    size: 2,
    init(e, w, s) {
      setEnter(e, s.x, s.y ?? 24, 1.5);
      e.hold = s.hold ?? 80;
      e.spinRate = 2;
      e.u1 = Math.random() * TAU;
    },
    update(e, w, dt) {
      enterHold(e, w, dt);
    },
    step(e, w, ev) {
      if (!holding(e)) return;
      // two bars on, one bar off
      const cycle = Math.floor(e.stateSteps / 16) % 3;
      if (cycle === 2 || ev.pos % 2 !== 0) return;
      const arms = e.elite ? 4 : 3;
      e.u1 += 13 * DEG * e.dir;
      for (let k = 0; k < arms; k++) {
        shoot(w, e.x, e.y, e.u1 + (k / arms) * TAU, 16, { shape: Shape.Rice, c: BC.B });
      }
    },
  },

  sniper: {
    kind: 'sniper',
    hp: 18,
    r: 2.3,
    score: 450,
    cost: 6,
    notes: 3,
    size: 1,
    init(e, w, s) {
      const dir = s.dir ?? 1;
      setEnter(e, dir * 20, s.y ?? 38, 1.3, dir * 36, s.y ?? 38);
      e.hold = s.hold ?? 96;
      e.spinRate = 0.4;
      e.dir = dir;
    },
    update(e, w, dt) {
      enterHold(e, w, dt);
      if (e.tele === 0) e.aim = aimAt(w, e.x, e.y);
    },
    step(e, w, ev) {
      if (!holding(e)) return;
      const inBar = e.stateSteps % 32;
      if (ev.pos === 0 && inBar < 16 && e.tele === 0) {
        e.aim = aimAt(w, e.x, e.y);
        e.tele = 1;
        e.u2 = e.stateSteps;
        w.emit({ t: 'laserWarn', x: e.x, y: e.y });
      } else if (e.tele === 1 && e.stateSteps - e.u2 >= 4 && ev.pos % 4 === 0) {
        e.tele = 0;
        stream(w, e.x, e.y, e.aim, e.elite ? 7 : 5, 28, 4, { shape: Shape.Rice, c: BC.C });
        if (e.elite) {
          stream(w, e.x, e.y, e.aim + 8 * DEG, 4, 26, 4, { shape: Shape.Rice, c: BC.C });
          stream(w, e.x, e.y, e.aim - 8 * DEG, 4, 26, 4, { shape: Shape.Rice, c: BC.C });
        }
        w.emit({ t: 'enemyShoot', x: e.x, y: e.y, size: 1 });
      }
    },
  },

  splitter: {
    kind: 'splitter',
    hp: 22,
    r: 2.7,
    score: 500,
    cost: 7,
    notes: 3,
    size: 2,
    init(e, w, s) {
      setEnter(e, s.x, s.y ?? 30, 1.4);
      e.hold = s.hold ?? 72;
      e.spinRate = 1.1;
    },
    update(e, w, dt) {
      enterHold(e, w, dt);
    },
    step(e, w, ev) {
      if (!holding(e)) return;
      if (ev.pos === 4 || ev.pos === 12) aimed(w, e.x, e.y, e.elite ? 3 : 2, 14 * DEG, 21, { size: 'm', c: BC.A });
    },
    death(e, w) {
      const n = e.elite ? 5 : 3;
      for (let k = 0; k < n; k++) {
        const a = -Math.PI / 2 + (k - (n - 1) / 2) * 0.9 + Math.PI;
        w.spawnEnemy({ kind: 'dart', x: e.x, y: e.y, path: 'burst', ang: a + Math.PI, shooter: false });
      }
    },
  },

  bulwark: {
    kind: 'bulwark',
    hp: 70,
    r: 3.6,
    score: 900,
    cost: 12,
    notes: 7,
    size: 3,
    init(e, w, s) {
      setEnter(e, s.x, s.y ?? 27, 2.4);
      e.hold = s.hold ?? 128;
      e.spinRate = 0.5;
    },
    update(e, w, dt) {
      enterHold(e, w, dt, 12);
    },
    step(e, w, ev) {
      if (!holding(e)) return;
      if (ev.pos === 0 || ev.pos === 8) {
        e.u1 += ev.pos === 0 ? 9 * DEG : 0;
        const off = e.u1 + (ev.pos === 8 ? Math.PI / dn(w, 20) : 0);
        ring(w, e.x, e.y, 20, 13, off, { size: 'm', c: BC.B });
        w.emit({ t: 'enemyShoot', x: e.x, y: e.y, size: 2 });
      }
      if (e.elite && (ev.pos === 4 || ev.pos === 12)) shoot(w, e.x, e.y, aimAt(w, e.x, e.y), 15, { size: 'l', c: BC.A });
    },
  },

  carrier: {
    kind: 'carrier',
    hp: 140,
    r: 4.2,
    score: 1600,
    cost: 18,
    notes: 10,
    size: 3,
    init(e, w, s) {
      setEnter(e, s.x, s.y ?? 34, 2.6);
      e.hold = s.hold ?? 128;
      e.spinRate = 0.3;
    },
    update(e, w, dt) {
      enterHold(e, w, dt, 10);
    },
    step(e, w, ev) {
      if (!holding(e)) return;
      if (ev.pos === 0 && w.enemies.length < 40) {
        for (const d of [-1, 1]) w.spawnEnemy({ kind: 'dart', x: e.x + d * 5, path: 'dive', dir: d, shooter: true, y: e.y });
      }
      if (ev.pos === 6 || ev.pos === 14) stream(w, e.x, e.y, aimAt(w, e.x, e.y), 3, 19, 3.5, { size: 'm', c: BC.A });
      if (ev.pos === 10) ring(w, e.x, e.y, 14, 12, e.t, { shape: Shape.Rice, c: BC.C, bhv: Bhv.Wave, p1: 1.4, p2: 3 });
    },
  },
};

/** Cubic-path darts spawned from carriers start mid-screen; fix their path origin. */
export function adjustSpawnOrigin(e: Enemy, s: SpawnSpec): void {
  if (s.y !== undefined && e.kind === 'dart' && s.path === 'dive') {
    e.y0 = s.y;
    e.y1 = s.y - 14;
    e.y2 = s.y - 30;
    e.y = s.y;
  }
}
