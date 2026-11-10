import { describe, expect, it } from 'vitest';
import { RNG, hashString } from '../src/core/rng';
import { Scale, voiceLead } from '../src/audio/theory';
import { Song, STYLES, makeSong, parseRhythm, type StyleId } from '../src/audio/composer';
import { Conductor, type StepEvent } from '../src/audio/conductor';
import { STAGES } from '../src/game/content';

describe('rng', () => {
  it('is deterministic and in range', () => {
    const a = new RNG(5);
    const b = new RNG(5);
    for (let i = 0; i < 1000; i++) {
      const x = a.next();
      expect(x).toBe(b.next());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(new RNG(1).int(3, 3)).toBe(3);
    expect(hashString('pulsar')).toBe(hashString('pulsar'));
  });
});

describe('music theory', () => {
  it('maps scale degrees across octaves', () => {
    const am = new Scale(57, 'aeolian');
    expect(am.note(0)).toBe(57);
    expect(am.note(2)).toBe(60);
    expect(am.note(7)).toBe(69);
    expect(am.note(-1)).toBe(55);
    expect(am.chord(5)).toEqual([65, 69, 72]); // F major in A minor
  });
  it('finds chord tones', () => {
    const am = new Scale(57, 'aeolian');
    expect(am.isChordTone(4, 0)).toBe(true);
    expect(am.isChordTone(1, 0)).toBe(false);
    expect(am.isChordTone(am.nearestChordTone(1, 0), 0)).toBe(true);
  });
  it('voice-leads inside the range with small motion', () => {
    const v1 = voiceLead([57, 60, 64], null, 52, 72);
    const v2 = voiceLead([53, 57, 60], v1, 52, 72);
    for (const n of [...v1, ...v2]) {
      expect(n).toBeGreaterThanOrEqual(52);
      expect(n).toBeLessThanOrEqual(72);
    }
    const move = v2.reduce((s, n, i) => s + Math.abs(n - v1[i]), 0);
    expect(move).toBeLessThanOrEqual(6);
  });
});

describe('composer', () => {
  it('parses rhythms', () => {
    expect(parseRhythm('x--x....x-------')).toEqual([
      { step: 0, dur: 3 },
      { step: 3, dur: 1 },
      { step: 8, dur: 8 },
    ]);
  });
  it('produces valid bars for every style and intensity', () => {
    for (const style of Object.keys(STYLES) as StyleId[]) {
      const song = new Song({ seed: 3, style, root: 57, mode: style === 'ending' ? 'ionian' : 'aeolian', bpm: 120 });
      for (let lvl = 0; lvl <= 4; lvl++) {
        for (let bar = 0; bar < 8; bar++) {
          const b = song.bar(bar, lvl);
          expect(b.kick.length).toBe(16);
          for (const list of [b.bass, b.arp, b.lead, b.counter]) {
            for (const n of list) {
              expect(n.step).toBeGreaterThanOrEqual(0);
              expect(n.step).toBeLessThan(16);
              expect(n.dur).toBeGreaterThan(0);
              expect(n.midi).toBeGreaterThan(20);
              expect(n.midi).toBeLessThan(108);
              expect(Number.isFinite(n.vel)).toBe(true);
            }
          }
          if (STYLES[style].lead[lvl]) expect(b.lead.length).toBeGreaterThan(0);
        }
      }
    }
  });
  it('is deterministic per seed', () => {
    const a = makeSong(STAGES[2].song, 77).bar(3, 3);
    const b = makeSong(STAGES[2].song, 77).bar(3, 3);
    expect(a.lead).toEqual(b.lead);
  });
});

describe('conductor', () => {
  it('schedules ahead and dispatches in order, across a tempo change', () => {
    let now = 0;
    const scheduled: number[] = [];
    const c = new Conductor(() => now, {
      barStart: (s) => (s === 16 ? 140 : undefined),
      schedule: (s) => scheduled.push(s),
    });
    c.start(120, 0);
    const out: StepEvent[] = [];
    for (let i = 0; i < 400; i++) {
      now += 0.01;
      c.pump();
      c.dispatch(now, out);
    }
    expect(scheduled.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].step).toBe(out[i - 1].step + 1);
      expect(out[i].time).toBeGreaterThan(out[i - 1].time);
    }
    const before = out.find((e) => e.step === 15)!;
    const after = out.find((e) => e.step === 17)!;
    expect(before.stepDur).toBeCloseTo(60 / 120 / 4);
    expect(after.stepDur).toBeCloseTo(60 / 140 / 4);
    expect(c.nextGrid(0.3, 1)).toBeGreaterThan(0.3);
  });
});

