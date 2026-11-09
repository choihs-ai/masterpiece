/** Player weapon systems. Fire timing is phase-locked to the beat. */
import type { StepEvent } from '../core/beat';
import { damp, DEG, TAU } from '../core/math';
import { Shape } from './types';
import { BEAM_DPS, BEAM_WIDTH, MISSILES_PER_BAR, NOVA_COUNT, ORBITAL_DPS, SUB_DAMAGE, SUB_RADIUS } from './upgrades';
import type { World } from './world';

const BOLT_SPEED = 165;

export const PB_MAIN = 0;
export const PB_MISSILE = 1;
export const PB_NOVA = 2;
export const PB_WING = 3;
export const PB_ECHO = 4;
export const PB_SPREAD = 5;

function bolt(w: World, x: number, y: number, ang: number, dmg: number, kind: number, speed = BOLT_SPEED): void {
  const i = w.pb.spawn(x, y, Math.cos(ang) * speed, Math.sin(ang) * speed, 0.9, kind === PB_SPREAD ? 0.8 : 1, 0, Shape.Bolt, 1.1);
  if (i < 0) return;
  w.pb.dmg[i] = dmg;
  w.pb.pierce[i] = w.player.stats.pierce;
  w.pb.kind[i] = kind;
}

export function fireVolley(w: World, mul = 1, echo = false): void {
  const p = w.player;
  const s = p.stats;
  const dmg = s.damage * mul;
  const n = s.streams;
  const gap = 1.25;
  for (let i = 0; i < n; i++) bolt(w, p.x + (i - (n - 1) / 2) * gap, p.y + 2.4, Math.PI / 2, dmg, echo ? PB_ECHO : PB_MAIN);
  if (echo) return;
  for (let k = 1; k <= s.spread; k++) {
    for (const sg of [-1, 1]) bolt(w, p.x + sg * 0.8, p.y + 1.5, Math.PI / 2 + sg * k * 10 * DEG, dmg * 0.6, PB_SPREAD);
  }
  if (s.wingmen > 0) {
    for (const [wx, wy] of [
      [p.wingLX, p.wingLY],
      [p.wingRX, p.wingRY],
    ]) {
      if (s.wingmen >= 2) {
        bolt(w, wx - 0.6, wy + 1.4, Math.PI / 2, dmg * 0.7, PB_WING);
        bolt(w, wx + 0.6, wy + 1.4, Math.PI / 2, dmg * 0.7, PB_WING);
      } else bolt(w, wx, wy + 1.4, Math.PI / 2, dmg * 0.7, PB_WING);
    }
  }
  if (s.echo > 0) p.echoQueue.push({ t: w.time + 2 * w.stepDur, mul: 0.5 * s.echo });
}

function missile(w: World, side: number): void {
  const p = w.player;
  const a = Math.PI / 2 + side * (0.7 + w.rng.range(0, 0.5));
  const i = w.pb.spawn(p.x + side * 1.6, p.y + 0.5, Math.cos(a) * 55, Math.sin(a) * 55, 1.1, 1.3, 0, Shape.Missile, 3);
  if (i < 0) return;
  w.pb.dmg[i] = 3 * p.stats.damage;
  w.pb.kind[i] = PB_MISSILE;
}

export function onStepWeapons(w: World, ev: StepEvent): void {
  const p = w.player;
  if (!p.alive || !w.firing) return;
  const s = p.stats;
  p.beatDur = ev.stepDur * 4;
  const onBeat = ev.pos % 4 === 0;
  if (onBeat) {
    fireVolley(w);
    p.gunTimer = 0;
    p.gunShots = 1;
  }
  if (s.missiles > 0 && onBeat) {
    const perBeat = MISSILES_PER_BAR[s.missiles] / 4;
    const n = perBeat >= 1 ? perBeat : (ev.pos / 4) % 2 === 0 ? 1 : 0;
    for (let k = 0; k < n; k++) missile(w, k % 2 === 0 ? -1 : 1);
  }
  if (s.nova > 0 && ev.pos === 0 && ev.bar % 2 === 0) {
    const n = NOVA_COUNT[s.nova];
    const off = w.rng.range(0, TAU);
    for (let k = 0; k < n; k++) bolt(w, p.x, p.y, off + (k / n) * TAU, 2 * s.damage, PB_NOVA, 95);
    w.emit({ t: 'nova', x: p.x, y: p.y });
  }
  if (s.beam > 0 && ev.pos === 0) {
    p.beamT = ev.stepDur * 4;
    w.emit({ t: 'beam', x: p.x, y: p.y, dur: p.beamT });
  }
  if (s.sub > 0 && onBeat) {
    const r = SUB_RADIUS[s.sub];
    const dmg = SUB_DAMAGE[s.sub] * s.damage;
    for (const e of w.enemies) {
      if (!e.alive) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      if (dx * dx + dy * dy < (r + e.r) * (r + e.r)) w.damageEnemy(e, dmg, e.x, e.y, false, false);
    }
    w.emit({ t: 'sub', x: p.x, y: p.y, r });
  }
}

export function updateWeapons(w: World, dt: number): void {
  const p = w.player;
  if (!p.alive) return;
  const s = p.stats;

  // main gun: fill the beat with evenly spaced shots between beat-synced volleys
  if (w.firing) {
    const interval = p.beatDur / s.shotsPerBeat;
    p.gunTimer += dt;
    while (p.gunTimer >= interval && p.gunShots < s.shotsPerBeat) {
      p.gunTimer -= interval;
      p.gunShots++;
      fireVolley(w);
    }
  }

  // echoes
  if (p.echoQueue.length) {
    for (let i = p.echoQueue.length - 1; i >= 0; i--) {
      if (p.echoQueue[i].t <= w.time) {
        if (w.firing) fireVolley(w, p.echoQueue[i].mul, true);
        p.echoQueue.splice(i, 1);
      }
    }
  }

  // wingmen trail behind with a little lag
  const k = damp(9, dt);
  p.wingLX += (p.x - 6 - p.wingLX) * k;
  p.wingLY += (p.y - 1.5 - p.wingLY) * k;
  p.wingRX += (p.x + 6 - p.wingRX) * k;
  p.wingRY += (p.y - 1.5 - p.wingRY) * k;

  // orbitals
  if (s.orbitals > 0) {
    p.orbAngle += dt * 2.7;
    const n = s.orbitals;
    for (let i = 0; i < n; i++) {
      const a = p.orbAngle + (i / n) * TAU;
      p.orbX[i] = p.x + Math.cos(a) * 6.5;
      p.orbY[i] = p.y + Math.sin(a) * 6.5;
      p.orbCd[i] = Math.max(0, p.orbCd[i] - dt);
    }
    const dmg = ORBITAL_DPS * s.damage * dt;
    for (const e of w.enemies) {
      if (!e.alive) continue;
      for (let i = 0; i < n; i++) {
        const dx = e.x - p.orbX[i];
        const dy = e.y - p.orbY[i];
        const rr = e.r + 1.3;
        if (dx * dx + dy * dy < rr * rr) w.damageEnemy(e, dmg, p.orbX[i], p.orbY[i], false, false, true);
      }
    }
  }

  // beam
  if (p.beamT > 0) {
    p.beamT -= dt;
    const half = BEAM_WIDTH[s.beam] / 2;
    const dmg = BEAM_DPS[s.beam] * s.damage * dt;
    for (const e of w.enemies) {
      if (!e.alive || e.y < p.y) continue;
      if (Math.abs(e.x - p.x) < half + e.r) w.damageEnemy(e, dmg, e.x, e.y - e.r, false, false, true);
    }
    const eb = w.eb;
    for (let i = eb.count - 1; i >= 0; i--) {
      if (eb.y[i] > p.y && Math.abs(eb.x[i] - p.x) < half && eb.vis[i] < 3) {
        if ((i & 3) === 0) w.pickups.spawn(eb.x[i], eb.y[i], 0, 0, 2);
        eb.remove(i);
      }
    }
  }
}
