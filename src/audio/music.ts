/**
 * Music player: turns Song bars into scheduled synth notes, step by step, driven by the
 * Conductor. Handles intensity changes (with drum fills and crashes), song/tempo changes at
 * bar boundaries, sidechain pumping and the player's gun as a rhythmic layer.
 */
import { clamp } from '../core/math';
import type { BarScore, Song } from './composer';
import type { AudioEngine } from './engine';

export class MusicPlayer {
  song: Song | null = null;
  private pending: Song | null = null;
  intensity = 0;
  target = 0;
  private section: 'A' | 'B' = 'A';
  private sectionBar = -1;
  private score: BarScore | null = null;
  private crashNow = false;
  private chordTones: number[] = [57, 60, 64];
  private gunIdx = 0;
  /** suppress drums and bass (tension / aftermath) */
  dropout = false;
  /** suppress every new note */
  silent = false;
  heartbeat = false;
  gun = { active: false, power: 1 };
  barCount = 0;

  constructor(private eng: AudioEngine) {}

  setSong(song: Song, immediate = false): void {
    if (immediate || !this.song) {
      this.song = song;
      this.pending = null;
      this.sectionBar = -1;
      this.eng.setDelayTime(song.bpm);
    } else {
      this.pending = song;
    }
  }

  get pendingBpm(): number | null {
    return this.pending ? this.pending.bpm : null;
  }

  setIntensity(n: number): void {
    this.target = clamp(Math.round(n), 0, 4);
  }

  /** Conductor hook: bar boundary. Returns a new tempo when the song changes. */
  barStart(_step: number): number | void {
    let bpm: number | undefined;
    if (this.pending) {
      this.song = this.pending;
      this.pending = null;
      this.sectionBar = -1;
      bpm = this.song.bpm;
      this.eng.setDelayTime(bpm);
    }
    if (!this.song) return bpm;
    const prev = this.intensity;
    this.intensity = this.target;
    const sec = this.song.sectionFor(this.intensity);
    if (sec !== this.section || this.sectionBar < 0) {
      this.section = sec;
      this.sectionBar = 0;
    } else {
      this.sectionBar++;
    }
    this.barCount++;
    this.score = this.song.bar(this.sectionBar, this.intensity);
    this.chordTones = this.song.chordTones(sec, this.sectionBar);
    this.crashNow = (this.intensity > prev && this.intensity >= 2) || (this.intensity >= 3 && this.sectionBar % 8 === 0);
    return bpm;
  }

  /** Conductor hook: schedule everything that starts on this 16th step. */
  schedule(step: number, t: number, stepDur: number): void {
    const e = this.eng;
    if (!this.song || !this.score || !e.ready) return;
    const pos = step & 15;
    if (this.heartbeat && pos === 0) e.heartbeat(t);
    if (this.silent) return;
    const st = this.song.style;
    const tone = st.tone;
    const sc = this.score;
    const tt = t + (pos % 2 === 1 ? st.swing * stepDur : 0);
    const fillPending = this.target > this.intensity;
    const bigFill = fillPending && this.target >= 3 && this.intensity < 3;
    const fillStart = bigFill ? 8 : 12;
    const inFill = fillPending && pos >= fillStart;

    if (!this.dropout) {
      if (pos === 0 && this.crashNow) e.crash(t, 0.9);
      let k = sc.kick[pos];
      if (bigFill && pos >= 8) k = pos === 8 || pos === 12 ? 0.9 : 0;
      if (k > 0) e.kick(t, k, tone.kickPitch);
      if (inFill) {
        const prog = (pos - fillStart) / (15 - fillStart);
        const v = 0.35 + 0.6 * prog;
        if (st.toms) {
          e.tom(tt, 52 - Math.floor(prog * 4) * 3, v);
          if (bigFill && pos >= 12) e.tom(tt + stepDur / 2, 50 - Math.floor(prog * 4) * 3, v * 0.8);
        } else {
          st.clap ? e.clap(tt, v) : e.snare(tt, v);
          if (bigFill && pos >= 12) e.snare(tt + stepDur / 2, v * 0.85);
        }
      } else if (sc.snare[pos] > 0) {
        st.clap ? e.clap(tt, sc.snare[pos]) : e.snare(tt, sc.snare[pos]);
      }
      if (sc.hat[pos] > 0) e.hat(tt, sc.hat[pos], false, tone.hatTone);
      if (sc.ohat[pos] > 0) e.hat(tt, sc.ohat[pos], true, tone.hatTone);
      if (sc.perc[pos] > 0) e.shaker(tt, sc.perc[pos]);
      for (const n of sc.bass) if (n.step === pos) e.bass(tt, n.midi, n.dur * stepDur, n.vel, tone);
    }
    for (const n of sc.arp) if (n.step === pos) e.arp(tt, n.midi, n.dur * stepDur, n.vel, tone);
    for (const n of sc.lead) if (n.step === pos) e.lead(tt, n.midi, n.dur * stepDur, n.vel, tone);
    for (const n of sc.counter) if (n.step === pos) e.lead(tt, n.midi, n.dur * stepDur, n.vel, tone, true);
    for (const c of sc.pad) if (c.step === pos) e.pad(tt, c.midis, c.dur * stepDur, c.vel, tone);
    for (const c of sc.stab) if (c.step === pos) e.stab(tt, c.midis, c.dur * stepDur, c.vel, tone);

    if (this.gun.active) {
      const m = this.chordTones[this.gunIdx++ % this.chordTones.length] + 24;
      e.gunTick(t, m, this.gun.power * (pos % 4 === 0 ? 1 : 0.7));
    }
  }

  /** Chord tones (MIDI) of the bar currently being scheduled, for pitching effects. */
  chord(): number[] {
    return this.chordTones;
  }

  get rootMidi(): number {
    return this.song ? this.song.spec.root : 57;
  }
}
