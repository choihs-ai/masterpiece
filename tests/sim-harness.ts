/** Headless driver: runs the simulation with a virtual musical clock and a scripted pilot. */
import { SECTORS } from '../src/game/sectors';
import { World, type WorldOptions } from '../src/game/world';
import type { GameEvent } from '../src/game/types';

export interface SimResult {
  world: World;
  seconds: number;
  events: Map<string, number>;
  bossTimes: number[];
  maxEnemyBullets: number;
  maxPlayerBullets: number;
  nan: boolean;
}

export interface SimOptions extends WorldOptions {
  invincible?: boolean;
  pilot?: 'still' | 'dodge';
  maxSeconds?: number;
  pickFirst?: boolean;
}

/** Simple potential-field pilot: avoid nearby bullets, drift under the closest enemy. */
function pilot(w: World): void {
  const p = w.player;
  let fx = 0;
  let fy = 0;
  const eb = w.eb;
  for (let i = 0; i < eb.count; i++) {
    const dx = p.x - eb.x[i];
    const dy = p.y - eb.y[i];
    const d2 = dx * dx + dy * dy;
    if (d2 < 100) {
      // project motion: bullets moving toward us matter more
      const approach = -(dx * eb.vx[i] + dy * eb.vy[i]) / (Math.sqrt(d2) + 1e-3);
      const wgt = (1 + Math.max(0, approach) * 0.08) / (d2 + 0.5);
      fx += dx * wgt;
      fy += dy * wgt;
    }
  }
  let target = 0;
  let best = Infinity;
  for (const e of w.enemies) {
    if (!e.alive) continue;
    const d = Math.abs(e.x - p.x) + Math.max(0, e.y - 40) * 0.5;
    if (d < best) {
      best = d;
      target = e.x;
    }
  }
  fx += (target - p.x) * 0.02;
  fy += (-34 - p.y) * 0.03;
  for (const e of w.enemies) {
    if (!e.alive) continue;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 200) {
      fx += (dx / (d2 + 1)) * 3;
      fy += (dy / (d2 + 1)) * 3;
    }
  }
  const l = Math.hypot(fx, fy);
  w.input.mx = l > 0.02 ? fx / l : 0;
  w.input.my = l > 0.02 ? fy / l : 0;
  w.input.focus = l < 0.3;
}

export function simulate(o: SimOptions): SimResult {
  const w = new World(o);
  w.invincible = !!o.invincible;
  w.start();
  const dt = 1 / 120;
  let t = 0;
  let step = 0;
  let stepDur = 60 / SECTORS[o.startSector ?? 0].song.bpm / 4;
  let nextStepAt = 0;
  let pendingBpm: number | null = null;
  const events = new Map<string, number>();
  const bossTimes: number[] = [];
  let bossStart = -1;
  let maxEB = 0;
  let maxPB = 0;
  let nan = false;
  const maxSeconds = o.maxSeconds ?? 60 * 40;
  while (t < maxSeconds && !w.over) {
    while (nextStepAt <= t) {
      if ((step & 15) === 0 && pendingBpm) {
        stepDur = 60 / pendingBpm / 4;
        pendingBpm = null;
      }
      w.onStep({ step, pos: step & 15, beat: step >> 2, bar: step >> 4, time: nextStepAt, stepDur });
      step++;
      nextStepAt += stepDur;
    }
    if (o.pilot === 'dodge' && w.player.alive) pilot(w);
    w.update(dt);
    t += dt;
    for (const e of w.events as GameEvent[]) {
      events.set(e.t, (events.get(e.t) ?? 0) + 1);
      if (e.t === 'music' && typeof e.cue.song === 'number') pendingBpm = SECTORS[e.cue.song].song.bpm;
      if (e.t === 'bossStart') bossStart = t;
      if (e.t === 'bossDefeated' && bossStart >= 0) bossTimes.push(Math.round(t - bossStart));
    }
    w.events.length = 0;
    if (w.paused && w.director.phase === 'upgrade') {
      const offers = w.director.offers;
      w.choose(o.pickFirst === false ? offers[offers.length - 1] : offers[0]);
    }
    maxEB = Math.max(maxEB, w.eb.count);
    maxPB = Math.max(maxPB, w.pb.count);
    if (!Number.isFinite(w.player.x) || !Number.isFinite(w.player.y)) nan = true;
    for (let i = 0; i < w.eb.count; i++) if (!Number.isFinite(w.eb.x[i])) nan = true;
  }
  return { world: w, seconds: t, events, bossTimes, maxEnemyBullets: maxEB, maxPlayerBullets: maxPB, nan };
}
