/**
 * Structure-of-arrays bullet pool. Bullets are packed densely (swap-remove), which keeps
 * updates cache-friendly and lets the renderer upload contiguous ranges.
 */
export const enum Bhv {
  None = 0,
  /** decelerate to a stop at p1 seconds, re-aim at the player at p2 seconds with speed p3 */
  StopReaim = 1,
  /** split into p2 bullets (ring) with speed p3 at p1 seconds */
  Split = 2,
  /** sinusoidal wiggle: angular velocity = p1 * sin(life * p2) */
  Wave = 3,
  /** travel toward point (p2, p3) and vanish within p1 units of it */
  Inward = 4,
  /** gently steer toward the player at p1 rad/s until p2 seconds */
  Seek = 5,
  /** wait (speed 0) until p1 seconds, then fly with speed p2 along current heading */
  Delay = 6,
}

export const BF_GRAZED = 1;
export const BF_FROZEN = 2;

export class BulletPool {
  readonly cap: number;
  count = 0;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  acc: Float32Array;
  angv: Float32Array;
  maxV: Float32Array;
  r: Float32Array;
  vis: Float32Array;
  life: Float32Array;
  ttl: Float32Array;
  p1: Float32Array;
  p2: Float32Array;
  p3: Float32Array;
  dmg: Float32Array;
  bhv: Uint8Array;
  color: Uint8Array;
  shape: Uint8Array;
  flags: Uint8Array;
  pierce: Uint8Array;
  kind: Uint8Array;
  hitA: Int32Array;
  hitB: Int32Array;

  constructor(cap: number) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.acc = new Float32Array(cap);
    this.angv = new Float32Array(cap);
    this.maxV = new Float32Array(cap);
    this.r = new Float32Array(cap);
    this.vis = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.ttl = new Float32Array(cap);
    this.p1 = new Float32Array(cap);
    this.p2 = new Float32Array(cap);
    this.p3 = new Float32Array(cap);
    this.dmg = new Float32Array(cap);
    this.bhv = new Uint8Array(cap);
    this.color = new Uint8Array(cap);
    this.shape = new Uint8Array(cap);
    this.flags = new Uint8Array(cap);
    this.pierce = new Uint8Array(cap);
    this.kind = new Uint8Array(cap);
    this.hitA = new Int32Array(cap);
    this.hitB = new Int32Array(cap);
  }

  /** Returns the index of the new bullet, or -1 if the pool is full. */
  spawn(x: number, y: number, vx: number, vy: number, r: number, vis: number, color: number, shape: number, ttl = 12): number {
    if (this.count >= this.cap) return -1;
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.acc[i] = 0;
    this.angv[i] = 0;
    this.maxV[i] = 400;
    this.r[i] = r;
    this.vis[i] = vis;
    this.life[i] = 0;
    this.ttl[i] = ttl;
    this.p1[i] = 0;
    this.p2[i] = 0;
    this.p3[i] = 0;
    this.dmg[i] = 1;
    this.bhv[i] = 0;
    this.color[i] = color;
    this.shape[i] = shape;
    this.flags[i] = 0;
    this.pierce[i] = 0;
    this.kind[i] = 0;
    this.hitA[i] = -1;
    this.hitB[i] = -1;
    return i;
  }

  remove(i: number): void {
    const j = --this.count;
    if (i === j) return;
    this.x[i] = this.x[j];
    this.y[i] = this.y[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.acc[i] = this.acc[j];
    this.angv[i] = this.angv[j];
    this.maxV[i] = this.maxV[j];
    this.r[i] = this.r[j];
    this.vis[i] = this.vis[j];
    this.life[i] = this.life[j];
    this.ttl[i] = this.ttl[j];
    this.p1[i] = this.p1[j];
    this.p2[i] = this.p2[j];
    this.p3[i] = this.p3[j];
    this.dmg[i] = this.dmg[j];
    this.bhv[i] = this.bhv[j];
    this.color[i] = this.color[j];
    this.shape[i] = this.shape[j];
    this.flags[i] = this.flags[j];
    this.pierce[i] = this.pierce[j];
    this.kind[i] = this.kind[j];
    this.hitA[i] = this.hitA[j];
    this.hitB[i] = this.hitB[j];
  }

  clear(): void {
    this.count = 0;
  }
}

/** Collectable notes and hearts. */
export class PickupPool {
  readonly cap: number;
  count = 0;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  life: Float32Array;
  kind: Uint8Array; // 0 note, 1 heart, 2 small note (from cleared bullets)
  magnet: Uint8Array;

  constructor(cap: number) {
    this.cap = cap;
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
    this.vx = new Float32Array(cap);
    this.vy = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.kind = new Uint8Array(cap);
    this.magnet = new Uint8Array(cap);
  }

  spawn(x: number, y: number, vx: number, vy: number, kind: number): number {
    if (this.count >= this.cap) return -1;
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = 0;
    this.kind[i] = kind;
    this.magnet[i] = 0;
    return i;
  }

  remove(i: number): void {
    const j = --this.count;
    if (i === j) return;
    this.x[i] = this.x[j];
    this.y[i] = this.y[j];
    this.vx[i] = this.vx[j];
    this.vy[i] = this.vy[j];
    this.life[i] = this.life[j];
    this.kind[i] = this.kind[j];
    this.magnet[i] = this.magnet[j];
  }

  clear(): void {
    this.count = 0;
  }
}
