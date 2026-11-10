import { describe, expect, it } from 'vitest';
import { STAGES } from '../src/game/content';
import { Sim } from '../src/game/sim';

interface Opts {
  seed: number;
  diff: 'easy' | 'normal' | 'hard';
  invincible: boolean;
  maxSeconds?: number;
}

function pilot(s: Sim): void {
  const p = s.player;
  let fx = 0;
  let fy = 0;
  const b = s.eb;
  for (let i = 0; i < b.count; i++) {
    if (b.z[i] < -25 || b.z[i] > 1) continue;
    const t = -b.z[i] / Math.max(1, b.vz[i]);
    const dx = p.x - (b.x[i] + b.vx[i] * t);
    const dy = p.y - (b.y[i] + b.vy[i] * t);
    const d2 = dx * dx + dy * dy;
    if (d2 < 16) {
      fx += dx / (d2 + 0.3);
      fy += dy / (d2 + 0.3);
    }
  }
  let tx = 0;
  let ty = 5;
  let best = Infinity;
  for (const e of s.enemies) {
    if (!e.alive || e.z > -10 || e.invuln > 50) continue;
    const d = Math.abs(e.x - p.x) + Math.abs(e.y - p.y);
    if (d < best) {
      best = d;
      tx = e.x;
      ty = e.y;
    }
  }
  fx += (tx - p.x) * 0.05;
  fy += (Math.max(1, Math.min(10, ty)) - p.y) * 0.05;
  for (const bm of s.beams) {
    const dx = p.x - bm.x;
    fx += Math.sign(dx || 1) * (Math.abs(dx) < 5 ? 3 : 0);
  }
  const l = Math.hypot(fx, fy);
  s.input.mx = l > 0.05 ? fx / l : 0;
  s.input.my = l > 0.05 ? fy / l : 0;
  if (p.locks.length >= p.stats.maxLocks) {
    s.input.fire = true;
    s.input.firePerfect = Math.random() < 0.3;
  }
}

function run(o: Opts) {
  const s = new Sim(o.seed, o.diff);
  s.invincible = o.invincible;
  s.start();
  const dt = 1 / 120;
  let t = 0;
  let step = 0;
  let stepDur = 60 / STAGES[0].song.bpm / 4;
  let next = 0;
  let pending: number | null = null;
  const bossTimes: number[] = [];
  let bossStart = 0;
  let nan = false;
  let maxEb = 0;
  while (t < (o.maxSeconds ?? 1800) && !s.over) {
    while (next <= t) {
      if ((step & 15) === 0 && pending) {
        stepDur = 60 / pending / 4;
        pending = null;
      }
      s.onStep({ step, pos: step & 15, beat: step >> 2, bar: step >> 4, time: next, stepDur });
      step++;
      next += stepDur;
    }
    pilot(s);
    s.update(dt);
    t += dt;
    for (const e of s.events) {
      if (e.t === 'music' && typeof e.cue.song === 'number') pending = STAGES[e.cue.song].song.bpm;
      if (e.t === 'bossStart') bossStart = t;
      if (e.t === 'bossDefeated') bossTimes.push(Math.round(t - bossStart));
    }
    s.events.length = 0;
    if (s.paused && s.phase === 'upgrade') s.choose(s.offers[0]);
    maxEb = Math.max(maxEb, s.eb.count);
    if (!Number.isFinite(s.player.x)) nan = true;
  }
  return { s, t, bossTimes, nan, maxEb };
}

describe('SKYRIFT simulation', () => {
  it('an invincible pilot clears all stages', () => {
    const r = run({ seed: 5, diff: 'normal', invincible: true });
    console.log('[invincible]', { phase: r.s.phase, stage: r.s.stage, paused: r.s.paused, offers: r.s.offers.join(','), seconds: Math.round(r.t), bossTimes: r.bossTimes, kills: r.s.stats.kills, score: r.s.score, maxEb: r.maxEb, ups: r.s.stats.upgrades.join(',') });
    expect(r.nan).toBe(false);
    expect(r.s.won).toBe(true);
    expect(r.s.stats.bosses).toBe(3);
  });
  it('a mortal pilot ends the run cleanly on each difficulty', () => {
    for (const diff of ['easy', 'normal', 'hard'] as const) {
      const r = run({ seed: 11, diff, invincible: false });
      console.log(`[bot ${diff}]`, { seconds: Math.round(r.t), stage: r.s.stats.stage + 1, bosses: r.s.stats.bosses, hits: r.s.stats.hits, won: r.s.won });
      expect(r.s.over).toBe(true);
    }
  });
});
