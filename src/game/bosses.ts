/**
 * Bosses. Every attack is written against the 16th-note grid (ev.pos 0..15), so patterns
 * breathe with the soundtrack: fans on the beat, spirals on eighths, walls on downbeats.
 */
import type { StepEvent } from '../core/beat';
import { damp, DEG, TAU } from '../core/math';
import { Bhv } from './bullets';
import type { Enemy } from './entity';
import type { BossId } from './ids';
import { aimAt, aimed, dn, ring, shoot, wall } from './patterns';
import { BC, Shape } from './types';
import type { World } from './world';

export interface BossPhase {
  until: number;
  enter?(b: Enemy, w: World): void;
  step(b: Enemy, w: World, ev: StepEvent): void;
  update?(b: Enemy, w: World, dt: number): void;
}

export interface BossDef {
  id: BossId;
  hp: number;
  r: number;
  score: number;
  homeY: number;
  phases: BossPhase[];
}

/** Pick a new hover target. */
function target(b: Enemy, x: number, y: number): void {
  b.x2 = x;
  b.y2 = y;
}

function drift(b: Enemy, dt: number, rate = 1.1): void {
  b.x += (b.x2 - b.x) * damp(rate, dt);
  b.y += (b.y2 - b.y) * damp(rate, dt);
}

const sparse = (w: World): boolean => w.density < 0.8;

function splitShards(b: Enemy, w: World, ev: StepEvent, speed = 16): void {
  const a = aimAt(w, b.x, b.y);
  for (let k = 0; k < 3; k++) {
    shoot(w, b.x, b.y, a + (k - 1) * 0.36, speed, {
      shape: Shape.Shard,
      size: 'l',
      c: BC.C,
      bhv: Bhv.Split,
      p1: 8 * ev.stepDur,
      p2: dn(w, 6),
      p3: 15,
    });
  }
}

function flare(b: Enemy, w: World, n: number): void {
  const count = dn(w, n);
  for (let k = 0; k < count; k++) {
    shoot(w, b.x, b.y, w.rng.range(0, TAU), w.rng.range(11, 27), { size: w.rng.chance(0.3) ? 'm' : 's', c: BC.A });
  }
  w.emit({ t: 'bossBlast', x: b.x, y: b.y, size: 1 });
}

function tideWall(w: World, side: 0 | 1 | 2, speed: number): void {
  const n = 15;
  const gapSize = w.density < 0.8 ? 4 : 3;
  const gap = side === 0 ? w.rng.int(1, 5) : side === 1 ? w.rng.int(n - 9, n - 5) : w.rng.int(1, n - gapSize - 1);
  wall(w, 53, n, gap, gapSize, speed, { size: 'm', c: BC.A });
}

export const BOSSES: Record<BossId, BossDef> = {
  herald: {
    id: 'herald',
    hp: 1000,
    r: 6.2,
    score: 50000,
    homeY: 30,
    phases: [
      {
        until: 0.66,
        step(b, w, ev) {
          if (ev.pos === 0 || ev.pos === 8) aimed(w, b.x, b.y - 2, 5, 50 * DEG, 22, { size: 'm', c: BC.A });
          if (ev.pos === 4 || ev.pos === 12) {
            b.u0 += 0.17;
            ring(w, b.x, b.y, 18, 16, b.u0, { size: 's', c: BC.B });
          }
          if (ev.pos === 0 && ev.bar % 2 === 0) target(b, w.rng.range(-14, 14), w.rng.range(26, 34));
        },
        update(b, _w, dt) {
          drift(b, dt);
        },
      },
      {
        until: 0.3,
        step(b, w, ev) {
          if (ev.pos % (sparse(w) ? 4 : 2) === 0) {
            b.u1 += 0.29;
            for (let k = 0; k < 3; k++) shoot(w, b.x, b.y, b.u1 + (k * TAU) / 3, 19, { shape: Shape.Rice, c: BC.B });
          }
          if (ev.pos === 0) aimed(w, b.x, b.y, 3, 30 * DEG, 15, { size: 'l', c: BC.A });
        },
        update(b, _w, dt) {
          target(b, 12 * Math.sin(b.t * 0.5), 30);
          drift(b, dt, 1.6);
        },
      },
      {
        until: 0,
        step(b, w, ev) {
          if (ev.pos % 4 === 0) {
            b.u0 += 0.13;
            const s = ev.beat % 2 === 0 ? 1 : -1;
            ring(w, b.x, b.y, 22, 17, b.u0, { size: 's', c: BC.C, angv: 0.35 * s });
          }
          if (ev.pos === 6 || ev.pos === 14) aimed(w, b.x, b.y, 3, 16 * DEG, 30, { shape: Shape.Rice, c: BC.A });
          if (ev.pos === 0 && ev.bar % 2 === 0) target(b, w.rng.range(-10, 10), w.rng.range(28, 33));
        },
        update(b, _w, dt) {
          drift(b, dt);
        },
      },
    ],
  },

  tidecaller: {
    id: 'tidecaller',
    hp: 2000,
    r: 6.8,
    score: 100000,
    homeY: 31,
    phases: [
      {
        until: 0.65,
        step(b, w, ev) {
          if (ev.pos === 0) tideWall(w, 2, 13);
          if (ev.pos % 4 === 0) {
            for (const s of [-1, 1]) {
              shoot(w, b.x + s * 6, b.y - 1, -Math.PI / 2 + s * 0.42, 18, {
                shape: Shape.Rice,
                c: BC.B,
                bhv: Bhv.Wave,
                p1: 1.8,
                p2: 4,
              });
            }
          }
          if (ev.pos === 0 && ev.bar % 2 === 0) target(b, w.rng.range(-12, 12), w.rng.range(28, 34));
        },
        update(b, _w, dt) {
          drift(b, dt);
        },
      },
      {
        until: 0.3,
        step(b, w, ev) {
          if (ev.pos % (sparse(w) ? 4 : 2) === 0) {
            b.u1 += 0.22;
            for (const s of [1, -1]) {
              for (let k = 0; k < 2; k++) {
                shoot(w, b.x, b.y, s * b.u1 + k * Math.PI, 15, { size: 's', c: s > 0 ? BC.C : BC.B, angv: 0.55 * s });
              }
            }
          }
          if (ev.pos === 4 || ev.pos === 12) aimed(w, b.x, b.y, 3, 22 * DEG, 21, { size: 'm', c: BC.A });
        },
        update(b, _w, dt) {
          target(b, 9 * Math.sin(b.t * 0.6), 31 + 2 * Math.sin(b.t * 1.1));
          drift(b, dt, 1.5);
        },
      },
      {
        until: 0,
        step(b, w, ev) {
          if (ev.pos === 0) tideWall(w, 0, 15);
          if (ev.pos === 8) tideWall(w, 1, 15);
          if (ev.pos === 4) {
            const a = aimAt(w, b.x, b.y);
            for (let k = 0; k < 3; k++) {
              shoot(w, b.x, b.y, a + (k - 1) * 0.5, 12, { size: 'l', c: BC.B, bhv: Bhv.Split, p1: 1.3, p2: dn(w, 8), p3: 14 });
            }
          }
        },
        update(b, _w, dt) {
          target(b, 6 * Math.sin(b.t * 0.4), 32);
          drift(b, dt);
        },
      },
    ],
  },

  archon: {
    id: 'archon',
    hp: 3300,
    r: 6.6,
    score: 150000,
    homeY: 31,
    phases: [
      {
        until: 0.66,
        step(b, w, ev) {
          if (ev.pos === 0 || ev.pos === 8) splitShards(b, w, ev);
          if (ev.pos === 4 || ev.pos === 12) aimed(w, b.x, b.y, 7, 60 * DEG, 24, { shape: Shape.Rice, c: BC.A });
          if (ev.pos === 0 && ev.bar % 2 === 0) target(b, w.rng.range(-14, 14), w.rng.range(27, 34));
        },
        update(b, _w, dt) {
          drift(b, dt);
        },
      },
      {
        until: 0.33,
        enter(b, w) {
          const warm = 4 * w.stepDur;
          w.addLaser(b, -Math.PI / 2 - 0.6, 0.45, 0.55, 2.4, warm, BC.A);
          w.addLaser(b, -Math.PI / 2 + 0.6, -0.45, 0.55, 2.4, warm, BC.A);
          target(b, 0, 32);
        },
        step(b, w, ev) {
          if (ev.pos % 4 === 0) {
            b.u0 += 0.2;
            ring(w, b.x, b.y, 14, 15, b.u0, { size: 's', c: BC.B });
          }
        },
        update(b, _w, dt) {
          target(b, 7 * Math.sin(b.t * 0.35), 32);
          drift(b, dt, 0.8);
        },
      },
      {
        until: 0,
        enter(b, w) {
          const warm = 4 * w.stepDur;
          w.addLaser(b, -Math.PI / 2, 0.38, 0.5, 2.2, warm, BC.A);
          w.addLaser(b, -Math.PI / 2 - 0.85, 0.36, 0.72, 2.2, warm, BC.C);
          w.addLaser(b, -Math.PI / 2 + 0.85, -0.36, 0.72, 2.2, warm, BC.C);
          target(b, 0, 33);
        },
        step(b, w, ev) {
          if (ev.pos % 4 === 0) {
            b.u1 += 0.12;
            for (let k = 0; k < 6; k++) shoot(w, b.x, b.y, b.u1 + (k * Math.PI) / 3, 17, { shape: Shape.Rice, c: BC.B, angv: 0.4 });
          }
          if (ev.pos === 10) aimed(w, b.x, b.y, 3, 20 * DEG, 22, { size: 'm', c: BC.A });
        },
        update(b, _w, dt) {
          drift(b, dt, 0.8);
        },
      },
    ],
  },

  tyrant: {
    id: 'tyrant',
    hp: 4800,
    r: 7.6,
    score: 200000,
    homeY: 30,
    phases: [
      {
        until: 0.66,
        step(b, w, ev) {
          if (ev.pos === 0) flare(b, w, 34);
          if (ev.pos >= 8 && ev.pos <= 14 && ev.pos % 2 === 0) shoot(w, b.x, b.y, aimAt(w, b.x, b.y), 26, { shape: Shape.Rice, c: BC.B });
          if (ev.pos === 0 && ev.bar % 2 === 1) target(b, w.rng.range(-13, 13), w.rng.range(27, 33));
        },
        update(b, _w, dt) {
          drift(b, dt);
        },
      },
      {
        until: 0.33,
        step(b, w, ev) {
          if (ev.pos % 4 === 0) {
            const n = dn(w, 20);
            const half = (ev.beat % 2) * (Math.PI / n);
            ring(w, b.x, b.y, 20, 14, half + b.u0, { size: 'm', c: BC.C });
          }
          if (ev.pos === 0 && ev.bar % 2 === 0) {
            for (const s of [-1, 1]) w.spawnEnemy({ kind: 'lancer', x: s * 18, y: 40 });
          }
          if (ev.pos === 2 || ev.pos === 10) aimed(w, b.x, b.y, 3, 18 * DEG, 28, { shape: Shape.Rice, c: BC.A });
        },
        update(b, _w, dt) {
          target(b, 10 * Math.sin(b.t * 0.45), 30);
          drift(b, dt);
        },
      },
      {
        until: 0,
        step(b, w, ev) {
          if (ev.pos === 0) {
            b.u0 += 0.11;
            ring(w, b.x, b.y, 28, 24, b.u0, {
              size: 'm',
              c: BC.B,
              bhv: Bhv.StopReaim,
              p1: 0.5,
              p2: 16 * ev.stepDur,
              p3: 20,
            });
          }
          if (ev.pos === 8) {
            const n = dn(w, 6);
            for (let k = 0; k < n; k++) shoot(w, w.rng.range(-26, 26), 53, -Math.PI / 2 + w.rng.range(-0.1, 0.1), 17, { size: 's', c: BC.C });
          }
          if (ev.pos === 4 || ev.pos === 12) aimed(w, b.x, b.y, 3, 24 * DEG, 22, { size: 'm', c: BC.A });
        },
        update(b, _w, dt) {
          target(b, 8 * Math.sin(b.t * 0.3), 31);
          drift(b, dt);
        },
      },
    ],
  },

  silence: {
    id: 'silence',
    hp: 8500,
    r: 7.4,
    score: 400000,
    homeY: 30,
    phases: [
      {
        until: 0.72,
        step(b, w, ev) {
          if (ev.pos === 0 || ev.pos === 8) {
            const n = dn(w, 26);
            const gapAt = w.rng.int(0, n - 1);
            const gap = w.density < 0.8 ? 4 : 3;
            for (let k = 0; k < n; k++) {
              if ((k - gapAt + n) % n < gap) continue;
              const a = b.u0 + (k * TAU) / n;
              const R = 50;
              shoot(w, b.x + Math.cos(a) * R, b.y + Math.sin(a) * R, a + Math.PI, 13, {
                size: 'm',
                c: BC.C,
                bhv: Bhv.Inward,
                p1: 4,
                p2: b.x,
                p3: b.y,
                ttl: 7,
              });
            }
            b.u0 += 0.1;
          }
          if (ev.pos % 4 === 2) aimed(w, b.x, b.y, 3, 14 * DEG, 20, { size: 's', c: BC.B });
        },
        update(b, w, dt) {
          w.gravity = 5;
          target(b, 4 * Math.sin(b.t * 0.3), 30);
          drift(b, dt, 0.6);
        },
      },
      {
        until: 0.45,
        step(b, w, ev) {
          if (ev.pos === 0 && ev.bar % 2 === 0) {
            w.freezeBullets(4 * ev.stepDur);
          } else if (w.freezeT <= 0 && ev.pos % 2 === 0) {
            b.u1 += 0.26;
            for (let k = 0; k < 2; k++) shoot(w, b.x, b.y, b.u1 + k * Math.PI, 16, { shape: Shape.Rice, c: BC.A });
          }
          if (ev.pos === 8) ring(w, b.x, b.y, 16, 12, b.u1, { size: 'm', c: BC.B });
        },
        update(b, w, dt) {
          w.gravity = 4;
          target(b, 10 * Math.sin(b.t * 0.4), 31);
          drift(b, dt, 0.8);
        },
      },
      {
        until: 0.18,
        step(b, w, ev) {
          const k = ev.bar % 4;
          if (k === 0 && ev.pos % 4 === 0) {
            b.u0 += 0.13;
            ring(w, b.x, b.y, 22, 17, b.u0, { size: 's', c: BC.C, angv: 0.35 * (ev.beat % 2 ? 1 : -1) });
          }
          if (k === 1 && (ev.pos === 0 || ev.pos === 8)) tideWall(w, ev.pos === 0 ? 0 : 1, 14);
          if (k === 2 && (ev.pos === 0 || ev.pos === 8)) splitShards(b, w, ev, 15);
          if (k === 3 && ev.pos === 0) flare(b, w, 30);
          if (ev.pos === 12) aimed(w, b.x, b.y, 3, 20 * DEG, 22, { size: 'm', c: BC.A });
        },
        update(b, w, dt) {
          w.gravity = 0;
          target(b, 11 * Math.sin(b.t * 0.5), 31);
          drift(b, dt);
        },
      },
      {
        until: 0,
        step(b, w, ev) {
          if (ev.pos % (sparse(w) ? 4 : 2) === 0) {
            b.u1 += 0.21;
            for (let k = 0; k < 4; k++) {
              shoot(w, b.x, b.y, b.u1 + (k * Math.PI) / 2, 15, { shape: Shape.Rice, c: BC.A });
              shoot(w, b.x, b.y, -b.u1 + (k * Math.PI) / 2 + Math.PI / 4, 15, { shape: Shape.Rice, c: BC.B });
            }
          }
          if (ev.pos === 0) {
            b.u0 += 0.2;
            ring(w, b.x, b.y, 30, 9, b.u0, { size: 'l', c: BC.C });
          }
        },
        update(b, w, dt) {
          w.gravity = 0;
          target(b, 0, 32);
          drift(b, dt, 0.7);
        },
      },
    ],
  },
};
