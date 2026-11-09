import { describe, expect, it } from 'vitest';
import { simulate } from './sim-harness';

describe('full run simulation', () => {
  it('an invincible pilot clears all five sectors and reaches victory', () => {
    const r = simulate({ seed: 1234, ship: 'echo', difficulty: 'normal', invincible: true, pilot: 'dodge' });
    console.log('[invincible normal]', {
      seconds: Math.round(r.seconds),
      bossTimes: r.bossTimes,
      score: r.world.score,
      kills: r.world.stats.kills,
      maxEB: r.maxEnemyBullets,
      maxPB: r.maxPlayerBullets,
      upgrades: r.world.stats.upgrades.join(','),
    });
    expect(r.nan).toBe(false);
    expect(r.world.won).toBe(true);
    expect(r.world.stats.bosses).toBe(5);
    expect(r.events.get('upgradeOffer')).toBeGreaterThanOrEqual(13);
    expect(r.seconds).toBeLessThan(60 * 30);
  });

  it('works on every difficulty and ship', () => {
    for (const difficulty of ['easy', 'hard'] as const) {
      for (const ship of ['aegis', 'volt'] as const) {
        const r = simulate({ seed: 99, ship, difficulty, invincible: true, pilot: 'dodge', pickFirst: false });
        expect(r.nan).toBe(false);
        expect(r.world.won).toBe(true);
      }
    }
  });

  it('a dodging pilot without invincibility survives a while and the run ends cleanly', () => {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const r = simulate({ seed: 7, ship: 'echo', difficulty, pilot: 'dodge' });
      console.log(`[bot ${difficulty}]`, {
        seconds: Math.round(r.seconds),
        sector: r.world.stats.sector + 1,
        bosses: r.world.stats.bosses,
        hits: r.world.stats.hits,
        grazes: r.world.stats.grazes,
        won: r.world.won,
        bossTimes: r.bossTimes,
      });
      expect(r.world.over).toBe(true);
      expect(r.seconds).toBeGreaterThan(30);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = simulate({ seed: 42, ship: 'echo', difficulty: 'normal', invincible: true, pilot: 'still', maxSeconds: 120 });
    const b = simulate({ seed: 42, ship: 'echo', difficulty: 'normal', invincible: true, pilot: 'still', maxSeconds: 120 });
    expect(a.world.score).toBe(b.world.score);
    expect(a.world.stats.kills).toBe(b.world.stats.kills);
  });
});
