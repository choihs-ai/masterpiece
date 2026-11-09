/** Enemy bullet pattern helpers. Speeds/counts are scaled by difficulty and sector. */
import { TAU } from '../core/math';
import { BC, Shape } from './types';
import { Bhv } from './bullets';
import type { World } from './world';

export interface BOpts {
  shape?: Shape;
  c?: BC;
  size?: 's' | 'm' | 'l';
  acc?: number;
  angv?: number;
  maxV?: number;
  ttl?: number;
  bhv?: Bhv;
  p1?: number;
  p2?: number;
  p3?: number;
}

const SIZE = {
  s: { r: 0.55, vis: 1.8 },
  m: { r: 0.9, vis: 2.6 },
  l: { r: 1.45, vis: 3.9 },
};

export function aimAt(w: World, x: number, y: number): number {
  return Math.atan2(w.player.y - y, w.player.x - x);
}

/** Scale a count by density (never below 1). */
export function dn(w: World, n: number): number {
  return Math.max(1, Math.round(n * w.density));
}

/** Scale a fan count, keeping it odd so the centre bullet stays aimed. */
export function dnOdd(w: World, n: number): number {
  const v = Math.max(1, Math.round(n * Math.min(1.25, Math.max(0.6, w.density))));
  return v % 2 === 0 ? v + (w.density < 1 ? -1 : 1) : v;
}

export function shoot(w: World, x: number, y: number, ang: number, speed: number, o: BOpts = {}): number {
  const sz = SIZE[o.size ?? (o.shape === Shape.Rice ? 's' : 'm')];
  const sp = speed * w.bulletSpeed;
  let vis = sz.vis;
  let r = sz.r;
  if (o.shape === Shape.Rice) {
    vis *= 0.9;
    r *= 0.85;
  }
  const i = w.eb.spawn(x, y, Math.cos(ang) * sp, Math.sin(ang) * sp, r, vis, o.c ?? BC.A, o.shape ?? Shape.Orb, o.ttl ?? 14);
  if (i < 0) return i;
  if (o.acc) w.eb.acc[i] = o.acc * w.bulletSpeed;
  if (o.angv) w.eb.angv[i] = o.angv;
  if (o.maxV) w.eb.maxV[i] = o.maxV * w.bulletSpeed;
  if (o.bhv) {
    w.eb.bhv[i] = o.bhv;
    w.eb.p1[i] = o.p1 ?? 0;
    w.eb.p2[i] = o.p2 ?? 0;
    w.eb.p3[i] = o.p3 ?? 0;
  }
  return i;
}

export function ring(w: World, x: number, y: number, count: number, speed: number, offset = 0, o: BOpts = {}): void {
  const n = dn(w, count);
  for (let k = 0; k < n; k++) shoot(w, x, y, offset + (k / n) * TAU, speed, o);
}

export function fan(w: World, x: number, y: number, ang: number, count: number, spread: number, speed: number, o: BOpts = {}): void {
  if (count <= 1) {
    shoot(w, x, y, ang, speed, o);
    return;
  }
  for (let k = 0; k < count; k++) shoot(w, x, y, ang - spread / 2 + (spread * k) / (count - 1), speed, o);
}

export function aimed(w: World, x: number, y: number, count: number, spread: number, speed: number, o: BOpts = {}): void {
  fan(w, x, y, aimAt(w, x, y), dnOdd(w, count), spread, speed, o);
}

/** A line of bullets along one heading with increasing speed (reads as a "stream"). */
export function stream(w: World, x: number, y: number, ang: number, count: number, speed: number, step: number, o: BOpts = {}): void {
  for (let k = 0; k < count; k++) shoot(w, x, y, ang, speed + k * step, o);
}

/** Horizontal wall of bullets moving down with a gap the player must find. */
export function wall(w: World, y: number, count: number, gapAt: number, gapSize: number, speed: number, o: BOpts = {}): void {
  const W = w.W - 2;
  for (let k = 0; k < count; k++) {
    if (k >= gapAt && k < gapAt + gapSize) continue;
    const x = -W / 2 + (W * k) / (count - 1);
    shoot(w, x, y, -Math.PI / 2, speed, o);
  }
}
