/**
 * Musical clock. Schedules 16th-note steps slightly ahead of time (for sample-accurate audio)
 * and later dispatches the same steps to the game when they become audible, so gameplay
 * events land exactly on the beat the player hears. Works with any clock source, which lets
 * tests drive it with simulated time.
 */
import type { StepEvent } from '../core/beat';
export type { StepEvent };

export interface ConductorHooks {
  /** Called once at every bar start before scheduling it; may return a new tempo. */
  barStart?: (step: number) => number | void;
  schedule?: (step: number, time: number, stepDur: number) => void;
}

const RING = 512;

export class Conductor {
  bpm = 120;
  stepDur = 60 / 120 / 4;
  private anchorStep = 0;
  private anchorTime = 0;
  nextSched = 0;
  nextDispatch = 0;
  private times = new Float64Array(RING);
  private durs = new Float32Array(RING);
  lookahead = 0.16;
  running = false;

  constructor(
    public clock: () => number,
    public hooks: ConductorHooks = {},
  ) {}

  start(bpm: number, delay = 0.08): void {
    this.bpm = bpm;
    this.stepDur = 60 / bpm / 4;
    this.anchorStep = 0;
    this.anchorTime = this.clock() + delay;
    this.nextSched = 0;
    this.nextDispatch = 0;
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  timeOf(step: number): number {
    return this.anchorTime + (step - this.anchorStep) * this.stepDur;
  }

  setTempo(bpm: number, atStep: number): void {
    this.anchorTime = this.timeOf(atStep);
    this.anchorStep = atStep;
    this.bpm = bpm;
    this.stepDur = 60 / bpm / 4;
  }

  /** Schedule audio for all steps inside the lookahead window. */
  pump(): void {
    if (!this.running) return;
    const now = this.clock();
    // If we stalled (tab hiccup), shift the timeline instead of bursting late notes.
    const late = now - this.timeOf(this.nextSched);
    if (late > 0.06) {
      this.anchorTime += late + 0.02;
    }
    const horizon = now + this.lookahead;
    let guard = 0;
    while (this.timeOf(this.nextSched) <= horizon && guard++ < 64) {
      const s = this.nextSched;
      if ((s & 15) === 0 && this.hooks.barStart) {
        const b = this.hooks.barStart(s);
        if (b && b !== this.bpm) this.setTempo(b, s);
      }
      const t = this.timeOf(s);
      this.times[s % RING] = t;
      this.durs[s % RING] = this.stepDur;
      this.hooks.schedule?.(s, t, this.stepDur);
      this.nextSched++;
    }
  }

  /** Move steps that have become audible into `out`. */
  dispatch(audibleNow: number, out: StepEvent[]): void {
    while (this.nextDispatch < this.nextSched && this.times[this.nextDispatch % RING] <= audibleNow) {
      const s = this.nextDispatch++;
      out.push({
        step: s,
        pos: s & 15,
        beat: s >> 2,
        bar: s >> 4,
        time: this.times[s % RING],
        stepDur: this.durs[s % RING],
      });
    }
  }

  /** Next grid time strictly after `t`. `frac` is in steps (0.5 = 32nd note). */
  nextGrid(t: number, frac = 0.5): number {
    const unit = this.stepDur * frac;
    const k = Math.ceil((t - this.anchorTime) / unit + 1e-6);
    return this.anchorTime + k * unit;
  }

  /** Continuous position in steps at time t. */
  stepPos(t: number): number {
    return this.anchorStep + (t - this.anchorTime) / this.stepDur;
  }

  /** Signed seconds from t to the nearest beat (negative = beat is ahead... i.e. pressed early). */
  beatOffset(t: number): number {
    const beats = this.stepPos(t) / 4;
    const nearest = Math.round(beats);
    return (beats - nearest) * 4 * this.stepDur;
  }

  /** 0..1 phase inside the current beat (0 = on the beat). */
  beatPhase(t: number): number {
    const b = this.stepPos(t) / 4;
    return b - Math.floor(b);
  }
}
