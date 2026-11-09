/**
 * Web Audio synthesis engine: mixer graph, drum machine, synth voices and sound effects.
 * Every sound is synthesised at runtime — there are no audio files.
 */
import type { ToneDef } from './composer';
import { midiToFreq } from './theory';

type Channels = {
  drums: GainNode;
  bass: GainNode;
  pad: GainNode;
  arp: GainNode;
  lead: GainNode;
  stab: GainNode;
};

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
}

const PAN_SLOTS = [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75];

export class AudioEngine {
  ctx: AudioContext | null = null;
  private noise!: AudioBuffer;
  private master!: GainNode;
  private comp!: DynamicsCompressorNode;
  private musicSum!: GainNode;
  private musicFilter!: BiquadFilterNode;
  private musicVol!: GainNode;
  private sfxVol!: GainNode;
  private pump!: GainNode;
  private kickBus!: WaveShaperNode;
  private bassDrive!: WaveShaperNode;
  private bassDriveIn!: GainNode;
  ch!: Channels;
  private revSend!: GainNode;
  private dlySend!: GainNode;
  private sfxRevSend!: GainNode;
  private delay!: DelayNode;
  private panners: StereoPannerNode[] = [];
  private analyser!: AnalyserNode;
  private analyserData: Uint8Array<ArrayBuffer> | null = null;
  private lastLeadEnd = -1;
  private lastLeadMidi = 0;
  volumes: Volumes = { master: 0.8, music: 0.8, sfx: 0.75 };

  get ready(): boolean {
    return this.ctx !== null;
  }

  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  get time(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Output latency estimate (seconds) used to align visuals with what is heard. */
  get latency(): number {
    if (!this.ctx) return 0;
    const c = this.ctx as AudioContext & { outputLatency?: number };
    const l = (c.outputLatency || 0) + (c.baseLatency || 0);
    return Math.min(0.12, Math.max(0, l));
  }

  /** Must be called from a user gesture (iOS requirement). */
  init(): boolean {
    if (this.ctx) {
      void this.ctx.resume();
      return true;
    }
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const AC = w.AudioContext || w.webkitAudioContext;
    if (!AC) return false;
    try {
      // Let iOS play Web Audio even with the ringer switch on silent (Safari 16.4+).
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'playback';
    } catch {
      /* optional */
    }
    let ctx: AudioContext;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      return false;
    }
    this.ctx = ctx;
    this.build(ctx);
    // iOS unlock: start a silent buffer inside the gesture.
    const b = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(ctx.destination);
    s.start(0);
    void ctx.resume();
    return true;
  }

  /** Re-unlock on later gestures (iOS may only honour touchend/click). */
  unlock(): void {
    const c = this.ctx;
    if (!c) return;
    if (c.state !== 'running') void c.resume();
    try {
      const b = c.createBuffer(1, 1, 22050);
      const s = c.createBufferSource();
      s.buffer = b;
      s.connect(c.destination);
      s.start(0);
    } catch {
      /* ignore */
    }
  }

  resume(): Promise<void> {
    return this.ctx ? this.ctx.resume() : Promise.resolve();
  }

  suspend(): Promise<void> {
    return this.ctx ? this.ctx.suspend() : Promise.resolve();
  }

  private build(c: AudioContext): void {
    // white noise source shared by all noisy instruments
    const len = Math.floor(c.sampleRate * 2);
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;

    this.master = c.createGain();
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 10;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.6;
    this.comp.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(c.destination);

    this.musicSum = c.createGain();
    this.musicFilter = c.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 20000;
    this.musicFilter.Q.value = 0.8;
    this.musicVol = c.createGain();
    this.musicSum.connect(this.musicFilter);
    this.musicFilter.connect(this.musicVol);
    this.musicVol.connect(this.comp);

    this.sfxVol = c.createGain();
    this.sfxVol.connect(this.comp);

    // sidechain "pump" bus
    this.pump = c.createGain();
    this.pump.connect(this.musicSum);

    // reverb (music)
    const rev = c.createConvolver();
    rev.buffer = this.impulse(c, 2.8, 2.6, 0.5);
    this.revSend = c.createGain();
    this.revSend.gain.value = 1;
    this.revSend.connect(rev);
    const revOut = c.createGain();
    revOut.gain.value = 0.55;
    rev.connect(revOut);
    revOut.connect(this.musicSum);

    // tempo-synced delay (music)
    this.delay = c.createDelay(2);
    this.delay.delayTime.value = 0.375;
    const fb = c.createGain();
    fb.gain.value = 0.34;
    const dTone = c.createBiquadFilter();
    dTone.type = 'lowpass';
    dTone.frequency.value = 2800;
    this.dlySend = c.createGain();
    this.dlySend.connect(this.delay);
    this.delay.connect(dTone);
    dTone.connect(fb);
    fb.connect(this.delay);
    const dOut = c.createGain();
    dOut.gain.value = 0.5;
    dTone.connect(dOut);
    dOut.connect(this.musicSum);

    // short room for sound effects
    const sRev = c.createConvolver();
    sRev.buffer = this.impulse(c, 1.3, 3.5, 0.3);
    this.sfxRevSend = c.createGain();
    this.sfxRevSend.connect(sRev);
    const sRevOut = c.createGain();
    sRevOut.gain.value = 0.5;
    sRev.connect(sRevOut);
    sRevOut.connect(this.sfxVol);

    for (const p of PAN_SLOTS) {
      const n = c.createStereoPanner();
      n.pan.value = p;
      n.connect(this.sfxVol);
      this.panners.push(n);
    }

    const mk = (gain: number, dest: AudioNode, rev = 0, dly = 0): GainNode => {
      const g = c.createGain();
      g.gain.value = gain;
      g.connect(dest);
      if (rev > 0) {
        const s = c.createGain();
        s.gain.value = rev;
        g.connect(s);
        s.connect(this.revSend);
      }
      if (dly > 0) {
        const s = c.createGain();
        s.gain.value = dly;
        g.connect(s);
        s.connect(this.dlySend);
      }
      return g;
    };
    this.ch = {
      drums: mk(0.9, this.musicSum, 0.12),
      bass: mk(0.8, this.pump),
      pad: mk(0.55, this.pump, 0.55),
      arp: mk(0.5, this.pump, 0.25, 0.35),
      lead: mk(0.55, this.musicSum, 0.35, 0.22),
      stab: mk(0.5, this.pump, 0.3, 0.12),
    };

    this.kickBus = c.createWaveShaper();
    this.kickBus.curve = this.curve(0.25);
    this.kickBus.connect(this.ch.drums);

    this.bassDriveIn = c.createGain();
    this.bassDrive = c.createWaveShaper();
    this.bassDrive.curve = this.curve(0.6);
    this.bassDrive.oversample = '2x';
    const bdOut = c.createGain();
    bdOut.gain.value = 0.55;
    this.bassDriveIn.connect(this.bassDrive);
    this.bassDrive.connect(bdOut);
    bdOut.connect(this.ch.bass);

    this.applyVolumes();
  }

  private impulse(c: BaseAudioContext, seconds: number, decay: number, darkness: number): AudioBuffer {
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const white = Math.random() * 2 - 1;
        const k = 0.15 + (1 - darkness) * 0.85 * (1 - t);
        lp += (white - lp) * k;
        d[i] = lp * Math.pow(1 - t, decay) * (i < 40 ? i / 40 : 1);
      }
    }
    return buf;
  }

  private curve(amount: number): Float32Array<ArrayBuffer> {
    const n = 1024;
    const out = new Float32Array(n);
    const k = amount * 60 + 1;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      out[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return out;
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master * 0.9, t, 0.05);
    this.musicVol.gain.setTargetAtTime(this.volumes.music * 0.85, t, 0.05);
    this.sfxVol.gain.setTargetAtTime(this.volumes.sfx * 0.9, t, 0.05);
  }

  /** Muffle the music (pause / menus). 1 = open, 0 = heavily filtered. */
  setMusicOpen(open: number, tau = 0.25): void {
    if (!this.ctx) return;
    const f = 350 * Math.pow(20000 / 350, Math.max(0, Math.min(1, open)));
    this.musicFilter.frequency.setTargetAtTime(f, this.ctx.currentTime, tau);
  }

  setDelayTime(bpm: number): void {
    if (!this.ctx) return;
    const t = (60 / bpm) * 0.75; // dotted eighth
    this.delay.delayTime.setTargetAtTime(t, this.ctx.currentTime, 0.1);
  }

  private meterBuf: Float32Array<ArrayBuffer> | null = null;

  /** Instantaneous output level (diagnostics). */
  meter(): { rms: number; peak: number } {
    if (!this.ctx) return { rms: 0, peak: 0 };
    if (!this.meterBuf) this.meterBuf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    this.analyser.getFloatTimeDomainData(this.meterBuf);
    let s = 0;
    let p = 0;
    for (const v of this.meterBuf) {
      s += v * v;
      p = Math.max(p, Math.abs(v));
    }
    return { rms: Math.sqrt(s / this.meterBuf.length), peak: p };
  }

  /** Smoothed loudness 0..1 for visuals. */
  level(): number {
    if (!this.ctx) return 0;
    if (!this.analyserData) this.analyserData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    this.analyser.getByteFrequencyData(this.analyserData);
    let s = 0;
    const n = Math.min(24, this.analyserData.length);
    for (let i = 0; i < n; i++) s += this.analyserData[i];
    return s / (n * 255);
  }

  /* ---------------------------------------------------------------- */
  /* building blocks                                                   */
  /* ---------------------------------------------------------------- */

  private osc(type: OscillatorType, freq: number, t: number, detuneCents = 0): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (detuneCents) o.detune.setValueAtTime(detuneCents, t);
    return o;
  }

  private noiseSrc(t: number, dur: number): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(t, Math.random() * 1.9);
    s.stop(t + Math.max(0.01, dur));
    return s;
  }

  private filt(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  private gain(v = 0): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = v;
    return g;
  }

  private panNode(pan: number): StereoPannerNode {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < PAN_SLOTS.length; i++) {
      const d = Math.abs(PAN_SLOTS[i] - pan);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return this.panners[best];
  }

  /** Percussive envelope: instant attack, exponential-like decay. */
  private perc(g: AudioParam, t: number, peak: number, tau: number, attack = 0.002): void {
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + attack);
    g.setTargetAtTime(0, t + attack, tau);
  }

  /* ---------------------------------------------------------------- */
  /* drums                                                             */
  /* ---------------------------------------------------------------- */

  kick(t: number, vel: number, pitch = 1): void {
    if (!this.ctx) return;
    const o = this.osc('sine', 155 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(44 * pitch, t + 0.11);
    const g = this.gain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.95 * vel, t + 0.003);
    g.gain.setTargetAtTime(0, t + 0.05, 0.1);
    o.connect(g);
    g.connect(this.kickBus);
    o.start(t);
    o.stop(t + 0.7);
    const n = this.noiseSrc(t, 0.03);
    const hp = this.filt('highpass', 1600);
    const ng = this.gain();
    this.perc(ng.gain, t, 0.22 * vel, 0.006);
    n.connect(hp);
    hp.connect(ng);
    ng.connect(this.ch.drums);
    this.pumpAt(t);
  }

  pumpAt(t: number): void {
    if (!this.ctx) return;
    const g = this.pump.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.32, t);
    g.setTargetAtTime(1, t + 0.02, 0.085);
  }

  snare(t: number, vel: number): void {
    if (!this.ctx) return;
    const n = this.noiseSrc(t, 0.3);
    const bp = this.filt('bandpass', 1900, 0.7);
    const hp = this.filt('highpass', 700);
    const g = this.gain();
    this.perc(g.gain, t, 0.5 * vel, 0.055, 0.001);
    n.connect(bp);
    bp.connect(hp);
    hp.connect(g);
    g.connect(this.ch.drums);
    const o = this.osc('triangle', 200, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    const og = this.gain();
    this.perc(og.gain, t, 0.32 * vel, 0.045);
    o.connect(og);
    og.connect(this.ch.drums);
    o.start(t);
    o.stop(t + 0.3);
  }

  clap(t: number, vel: number): void {
    if (!this.ctx) return;
    const n = this.noiseSrc(t, 0.4);
    const bp = this.filt('bandpass', 1250, 1.1);
    const g = this.gain();
    const p = 0.55 * vel;
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.011;
      g.gain.setValueAtTime(p, tt);
      g.gain.setTargetAtTime(0, tt + 0.001, 0.004);
    }
    g.gain.setValueAtTime(p * 0.9, t + 0.034);
    g.gain.setTargetAtTime(0, t + 0.035, 0.065);
    n.connect(bp);
    bp.connect(g);
    g.connect(this.ch.drums);
  }

  hat(t: number, vel: number, open: boolean, tone = 7500): void {
    if (!this.ctx) return;
    const n = this.noiseSrc(t, open ? 0.5 : 0.08);
    const hp = this.filt('highpass', tone, 0.8);
    const g = this.gain();
    this.perc(g.gain, t, (open ? 0.17 : 0.2) * vel, open ? 0.085 : 0.016, 0.001);
    n.connect(hp);
    hp.connect(g);
    g.connect(this.ch.drums);
  }

  shaker(t: number, vel: number): void {
    if (!this.ctx) return;
    const n = this.noiseSrc(t, 0.06);
    const bp = this.filt('bandpass', 6500, 1.4);
    const g = this.gain();
    this.perc(g.gain, t, 0.16 * vel, 0.014, 0.003);
    n.connect(bp);
    bp.connect(g);
    g.connect(this.ch.drums);
  }

  crash(t: number, vel: number): void {
    if (!this.ctx) return;
    const n = this.noiseSrc(t, 2.2);
    const hp = this.filt('highpass', 3600, 0.5);
    const g = this.gain();
    this.perc(g.gain, t, 0.2 * vel, 0.55, 0.002);
    n.connect(hp);
    hp.connect(g);
    g.connect(this.ch.drums);
    const s = this.gain(0.6);
    g.connect(s);
    s.connect(this.revSend);
  }

  tom(t: number, midi: number, vel: number): void {
    if (!this.ctx) return;
    const f = midiToFreq(midi);
    const o = this.osc('sine', f * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    const g = this.gain();
    this.perc(g.gain, t, 0.5 * vel, 0.12);
    o.connect(g);
    g.connect(this.ch.drums);
    o.start(t);
    o.stop(t + 0.7);
  }

  /* ---------------------------------------------------------------- */
  /* pitched instruments                                               */
  /* ---------------------------------------------------------------- */

  bass(t: number, midi: number, len: number, vel: number, tone: ToneDef): void {
    if (!this.ctx) return;
    const f = midiToFreq(midi);
    const o1 = this.osc(tone.bassWave, f, t, -7);
    const o2 = this.osc(tone.bassWave, f, t, 7);
    const sub = this.osc('sine', f, t);
    const lp = this.filt('lowpass', tone.bassCutoff, tone.bassQ);
    lp.frequency.setValueAtTime(tone.bassCutoff * (1 + tone.bassEnv), t);
    lp.frequency.setTargetAtTime(tone.bassCutoff, t + 0.004, 0.06);
    const g = this.gain();
    const peak = 0.3 * vel;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.005);
    g.gain.setTargetAtTime(peak * 0.75, t + 0.02, 0.1);
    const end = t + Math.max(0.05, len * 0.92);
    g.gain.setTargetAtTime(0, end, 0.025);
    const sg = this.gain(0.5);
    o1.connect(lp);
    o2.connect(lp);
    sub.connect(sg);
    sg.connect(g);
    lp.connect(g);
    g.connect(tone.bassDrive > 0 ? this.bassDriveIn : this.ch.bass);
    for (const o of [o1, o2, sub]) {
      o.start(t);
      o.stop(end + 0.2);
    }
  }

  pad(t: number, midis: number[], len: number, vel: number, tone: ToneDef): void {
    if (!this.ctx) return;
    const gated = len < 0.5;
    const attack = gated ? 0.006 : Math.min(0.45, len * 0.3);
    const release = gated ? 0.04 : 0.7;
    const lp = this.filt('lowpass', tone.padCutoff, 0.6);
    const g = this.gain();
    const peak = (0.16 / Math.sqrt(midis.length)) * vel;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    const end = t + Math.max(attack, len * (gated ? 0.85 : 1));
    g.gain.setValueAtTime(peak, end);
    g.gain.setTargetAtTime(0, end, release / 3);
    const stopAt = end + release * 1.6;
    if (!gated) {
      const lfo = this.osc('sine', 0.18, t);
      const lg = this.gain(tone.padCutoff * 0.35);
      lfo.connect(lg);
      lg.connect(lp.frequency);
      lfo.start(t);
      lfo.stop(stopAt);
    }
    for (const m of midis) {
      const f = midiToFreq(m);
      for (const d of [-tone.padDetune, tone.padDetune]) {
        const o = this.osc(tone.padWave, f, t, d);
        o.connect(lp);
        o.start(t);
        o.stop(stopAt);
      }
    }
    lp.connect(g);
    g.connect(this.ch.pad);
  }

  arp(t: number, midi: number, len: number, vel: number, tone: ToneDef): void {
    if (!this.ctx) return;
    const f = midiToFreq(midi);
    const o = this.osc(tone.arpWave, f, t);
    const o2 = this.osc(tone.arpWave === 'square' ? 'sawtooth' : 'square', f * 2, t, 4);
    const lp = this.filt('lowpass', tone.arpCutoff, 2.5);
    lp.frequency.setValueAtTime(tone.arpCutoff * 2.2, t);
    lp.frequency.setTargetAtTime(tone.arpCutoff * 0.45, t + 0.004, tone.arpDecay * 0.45);
    const g = this.gain();
    const tau = Math.max(tone.arpDecay * 0.6, Math.min(len * 0.6, tone.arpDecay * 2));
    this.perc(g.gain, t, 0.14 * vel, tau, 0.002);
    const g2 = this.gain(0.18);
    o.connect(lp);
    o2.connect(g2);
    g2.connect(lp);
    lp.connect(g);
    g.connect(this.ch.arp);
    const stopAt = t + tau * 6 + 0.05;
    o.start(t);
    o.stop(stopAt);
    o2.start(t);
    o2.stop(stopAt);
  }

  lead(t: number, midi: number, len: number, vel: number, tone: ToneDef, soft = false): void {
    if (!this.ctx) return;
    const f = midiToFreq(midi);
    const wave = soft ? 'triangle' : tone.leadWave;
    const o1 = this.osc(wave, f, t, tone.leadDetune / 2);
    const o2 = this.osc(soft ? 'sine' : wave === 'square' ? 'sawtooth' : 'square', f, t, -tone.leadDetune / 2);
    // portamento between legato notes
    if (!soft && Math.abs(t - this.lastLeadEnd) < 0.03 && this.lastLeadMidi) {
      const pf = midiToFreq(this.lastLeadMidi);
      o1.frequency.setValueAtTime(pf, t);
      o2.frequency.setValueAtTime(pf, t);
      o1.frequency.exponentialRampToValueAtTime(f, t + 0.045);
      o2.frequency.exponentialRampToValueAtTime(f, t + 0.045);
    }
    const lfo = this.osc('sine', 5.4, t);
    const lg = this.gain(0);
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(f * 0.007, t + Math.min(0.35, len));
    lfo.connect(lg);
    lg.connect(o1.frequency);
    lg.connect(o2.frequency);
    const lp = this.filt('lowpass', soft ? tone.leadCutoff * 0.5 : tone.leadCutoff, 1.2);
    const g = this.gain();
    const peak = (soft ? 0.09 : 0.12) * vel;
    const end = t + Math.max(0.06, len * 0.95);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.012);
    g.gain.setTargetAtTime(peak * 0.8, t + 0.03, 0.2);
    g.gain.setTargetAtTime(0, end, 0.06);
    const g2 = this.gain(soft ? 0.4 : 0.55);
    o1.connect(lp);
    o2.connect(g2);
    g2.connect(lp);
    lp.connect(g);
    g.connect(this.ch.lead);
    const stopAt = end + 0.4;
    for (const o of [o1, o2, lfo]) {
      o.start(t);
      o.stop(stopAt);
    }
    if (!soft) {
      this.lastLeadEnd = t + len;
      this.lastLeadMidi = midi;
    }
  }

  stab(t: number, midis: number[], len: number, vel: number, tone: ToneDef): void {
    if (!this.ctx) return;
    const lp = this.filt('lowpass', tone.pluckStab ? 2600 : 3800, 1);
    lp.frequency.setTargetAtTime(tone.pluckStab ? 900 : 1400, t + 0.005, 0.09);
    const g = this.gain();
    this.perc(g.gain, t, ((tone.pluckStab ? 0.11 : 0.09) / Math.sqrt(midis.length)) * vel, tone.pluckStab ? 0.16 : Math.min(0.14, len * 0.5));
    const stopAt = t + 1.2;
    for (const m of midis) {
      const f = midiToFreq(m);
      const dets = tone.pluckStab ? [0] : [-14, 0, 14];
      for (const d of dets) {
        const o = this.osc(tone.pluckStab ? 'triangle' : 'sawtooth', f, t, d);
        o.connect(lp);
        o.start(t);
        o.stop(stopAt);
      }
      if (tone.pluckStab) {
        const o = this.osc('sine', f * 2, t);
        const og = this.gain(0.35);
        o.connect(og);
        og.connect(lp);
        o.start(t);
        o.stop(stopAt);
      }
    }
    lp.connect(g);
    g.connect(this.ch.stab);
  }

  /* ---------------------------------------------------------------- */
  /* sound effects                                                     */
  /* ---------------------------------------------------------------- */

  gunTick(t: number, midi: number, vel: number): void {
    if (!this.ctx) return;
    const n = this.noiseSrc(t, 0.04);
    const hp = this.filt('highpass', 8500, 0.6);
    const g = this.gain();
    this.perc(g.gain, t, 0.05 * vel, 0.01, 0.001);
    n.connect(hp);
    hp.connect(g);
    g.connect(this.sfxVol);
    const o = this.osc('sine', midiToFreq(midi), t);
    const og = this.gain();
    this.perc(og.gain, t, 0.022 * vel, 0.02, 0.001);
    o.connect(og);
    og.connect(this.sfxVol);
    o.start(t);
    o.stop(t + 0.12);
  }

  hit(t: number, pan: number): void {
    if (!this.ctx) return;
    const n = this.noiseSrc(t, 0.05);
    const bp = this.filt('bandpass', 2600, 1.2);
    const g = this.gain();
    this.perc(g.gain, t, 0.06, 0.01, 0.001);
    n.connect(bp);
    bp.connect(g);
    g.connect(this.panNode(pan));
  }

  /** Noise/thump layer of an explosion: played immediately for punch. */
  boom(t: number, size: number, pan: number): void {
    if (!this.ctx) return;
    const out = this.panNode(pan);
    const n = this.noiseSrc(t, 0.4 + size * 0.5);
    const lp = this.filt('lowpass', 5200, 0.8);
    lp.frequency.setTargetAtTime(260, t + 0.01, 0.06 + size * 0.06);
    const g = this.gain();
    this.perc(g.gain, t, 0.16 + size * 0.07, 0.05 + size * 0.06, 0.001);
    n.connect(lp);
    lp.connect(g);
    g.connect(out);
    if (size >= 1) {
      const o = this.osc('sine', 120, t);
      o.frequency.exponentialRampToValueAtTime(36, t + 0.28);
      const og = this.gain();
      this.perc(og.gain, t, 0.12 * size, 0.1 + size * 0.04, 0.002);
      o.connect(og);
      og.connect(this.sfxVol);
      o.start(t);
      o.stop(t + 1);
      const s = this.gain(0.4);
      g.connect(s);
      s.connect(this.sfxRevSend);
    }
  }

  /** Musical layer of an explosion: a pitched pluck quantised to the beat grid. */
  pluck(t: number, midi: number, vel: number, pan: number, long = false): void {
    if (!this.ctx) return;
    const f = midiToFreq(midi);
    const o = this.osc('triangle', f, t);
    const o2 = this.osc('sawtooth', f, t, 6);
    const lp = this.filt('lowpass', 4200, 1.5);
    lp.frequency.setTargetAtTime(900, t + 0.003, long ? 0.25 : 0.08);
    const g = this.gain();
    this.perc(g.gain, t, 0.085 * vel, long ? 0.35 : 0.12, 0.002);
    const g2 = this.gain(0.35);
    o.connect(lp);
    o2.connect(g2);
    g2.connect(lp);
    lp.connect(g);
    g.connect(this.panNode(pan));
    const s = this.gain(0.35);
    g.connect(s);
    s.connect(this.sfxRevSend);
    const stopAt = t + (long ? 2.2 : 0.9);
    o.start(t);
    o.stop(stopAt);
    o2.start(t);
    o2.stop(stopAt);
  }

  bell(t: number, midi: number, vel: number, pan = 0): void {
    if (!this.ctx) return;
    while (midi > 96) midi -= 12;
    const f = midiToFreq(midi);
    const o = this.osc('sine', f, t);
    const o2 = this.osc('sine', f * 2.76, t);
    const g = this.gain();
    this.perc(g.gain, t, 0.07 * vel, 0.13, 0.002);
    const g2 = this.gain(0.28);
    o.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.connect(this.panNode(pan));
    const s = this.gain(0.5);
    g.connect(s);
    s.connect(this.sfxRevSend);
    o.start(t);
    o.stop(t + 0.9);
    o2.start(t);
    o2.stop(t + 0.5);
  }

  graze(t: number, midi: number): void {
    if (!this.ctx) return;
    const o = this.osc('sine', midiToFreq(midi), t);
    const g = this.gain();
    this.perc(g.gain, t, 0.03, 0.045, 0.002);
    o.connect(g);
    g.connect(this.sfxVol);
    o.start(t);
    o.stop(t + 0.3);
  }

  playerHit(t: number): void {
    if (!this.ctx) return;
    const o = this.osc('sawtooth', 96, t);
    const o2 = this.osc('square', 64, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    const sh = this.ctx.createWaveShaper();
    sh.curve = this.curve(0.9);
    const lp = this.filt('lowpass', 2400, 2);
    lp.frequency.setTargetAtTime(240, t + 0.02, 0.12);
    const g = this.gain();
    this.perc(g.gain, t, 0.32, 0.16, 0.002);
    o.connect(sh);
    o2.connect(sh);
    sh.connect(lp);
    lp.connect(g);
    g.connect(this.sfxVol);
    o.start(t);
    o.stop(t + 1);
    o2.start(t);
    o2.stop(t + 1);
    for (let i = 0; i < 3; i++) {
      const tt = t + i * 0.06;
      const n = this.noiseSrc(tt, 0.05);
      const bp = this.filt('bandpass', 900 + i * 700, 1.5);
      const ng = this.gain();
      this.perc(ng.gain, tt, 0.22 - i * 0.05, 0.02, 0.001);
      n.connect(bp);
      bp.connect(ng);
      ng.connect(this.sfxVol);
    }
  }

  pulse(t: number, perfect: boolean, chord: number[]): void {
    if (!this.ctx) return;
    const o = this.osc('sine', 85, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.7);
    const og = this.gain();
    this.perc(og.gain, t, 0.55, 0.3, 0.004);
    o.connect(og);
    og.connect(this.sfxVol);
    o.start(t);
    o.stop(t + 1.6);
    const n = this.noiseSrc(t, 1.2);
    const bp = this.filt('bandpass', 250, 1.4);
    bp.frequency.exponentialRampToValueAtTime(3600, t + 0.22);
    bp.frequency.exponentialRampToValueAtTime(380, t + 0.8);
    const ng = this.gain();
    this.perc(ng.gain, t, 0.3, 0.28, 0.01);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(this.sfxVol);
    const s = this.gain(0.6);
    ng.connect(s);
    s.connect(this.sfxRevSend);
    if (perfect && chord.length) {
      for (let i = 0; i < 7; i++) {
        const m = chord[i % chord.length] + 24 + 12 * Math.floor(i / chord.length);
        this.bell(t + i * 0.035, m, 0.9 - i * 0.06, (i % 2 ? 1 : -1) * 0.4);
      }
    }
  }

  warning(t: number, beatDur: number, beats: number, a: number, b: number): void {
    if (!this.ctx) return;
    for (let i = 0; i < beats; i++) {
      const tt = t + i * beatDur;
      const f = midiToFreq(i % 2 === 0 ? a : b);
      const o = this.osc('sawtooth', f, tt);
      const o2 = this.osc('square', f * 0.5, tt, 5);
      const lp = this.filt('lowpass', 1800, 4);
      lp.frequency.setValueAtTime(600, tt);
      lp.frequency.linearRampToValueAtTime(2400, tt + beatDur * 0.4);
      lp.frequency.linearRampToValueAtTime(700, tt + beatDur * 0.9);
      const g = this.gain();
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(0.09, tt + 0.03);
      g.gain.setValueAtTime(0.09, tt + beatDur * 0.75);
      g.gain.linearRampToValueAtTime(0, tt + beatDur * 0.95);
      const g2 = this.gain(0.5);
      o.connect(lp);
      o2.connect(g2);
      g2.connect(lp);
      lp.connect(g);
      g.connect(this.sfxVol);
      o.start(tt);
      o.stop(tt + beatDur);
      o2.start(tt);
      o2.stop(tt + beatDur);
    }
  }

  riser(t: number, dur: number): void {
    if (!this.ctx) return;
    const n = this.noiseSrc(t, dur + 0.1);
    const bp = this.filt('bandpass', 300, 3);
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = this.gain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.04);
    n.connect(bp);
    bp.connect(g);
    g.connect(this.sfxVol);
    const o = this.osc('sawtooth', 110, t);
    o.frequency.exponentialRampToValueAtTime(880, t + dur);
    const og = this.gain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.045, t + dur);
    og.gain.linearRampToValueAtTime(0, t + dur + 0.03);
    const lp = this.filt('lowpass', 3000);
    o.connect(lp);
    lp.connect(og);
    og.connect(this.sfxVol);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  impact(t: number, big = 1): void {
    if (!this.ctx) return;
    const o = this.osc('sine', 70, t);
    o.frequency.exponentialRampToValueAtTime(26, t + 1.1);
    const og = this.gain();
    this.perc(og.gain, t, 0.6 * big, 0.45, 0.003);
    o.connect(og);
    og.connect(this.sfxVol);
    o.start(t);
    o.stop(t + 2.5);
    const n = this.noiseSrc(t, 2.5);
    const lp = this.filt('lowpass', 2400, 0.7);
    lp.frequency.setTargetAtTime(300, t + 0.05, 0.4);
    const ng = this.gain();
    this.perc(ng.gain, t, 0.3 * big, 0.5, 0.002);
    n.connect(lp);
    lp.connect(ng);
    ng.connect(this.sfxVol);
    const s = this.gain(0.7);
    ng.connect(s);
    s.connect(this.sfxRevSend);
  }

  laser(t: number, dur: number, pan: number): void {
    if (!this.ctx) return;
    const out = this.panNode(pan);
    const o = this.osc('sawtooth', 660, t);
    const o2 = this.osc('sawtooth', 664, t);
    o.frequency.exponentialRampToValueAtTime(220, t + dur);
    o2.frequency.exponentialRampToValueAtTime(222, t + dur);
    const bp = this.filt('bandpass', 2200, 2);
    const g = this.gain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.01);
    g.gain.setValueAtTime(0.07, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const trem = this.osc('square', 28, t);
    const tg = this.gain(0.03);
    trem.connect(tg);
    tg.connect(g.gain);
    o.connect(bp);
    o2.connect(bp);
    bp.connect(g);
    g.connect(out);
    for (const x of [o, o2, trem]) {
      x.start(t);
      x.stop(t + dur + 0.05);
    }
  }

  zap(t: number, pan: number): void {
    if (!this.ctx) return;
    const n = this.noiseSrc(t, 0.16);
    const hp = this.filt('highpass', 2800, 1);
    const g = this.gain();
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < 10; i++) g.gain.setValueAtTime(Math.random() * 0.09, t + i * 0.012);
    g.gain.setValueAtTime(0, t + 0.13);
    n.connect(hp);
    hp.connect(g);
    g.connect(this.panNode(pan));
  }

  arpeggio(t: number, chord: number[], count: number, spacing: number, vel = 0.9): void {
    for (let i = 0; i < count; i++) {
      const m = chord[i % chord.length] + 12 * Math.floor(i / chord.length) + 12;
      this.bell(t + i * spacing, m, vel * (1 - i * 0.04), (i % 2 ? 0.3 : -0.3));
    }
  }

  heartbeat(t: number): void {
    if (!this.ctx) return;
    for (const [dt, v] of [
      [0, 0.32],
      [0.17, 0.22],
    ]) {
      const o = this.osc('sine', 62, t + dt);
      o.frequency.exponentialRampToValueAtTime(40, t + dt + 0.12);
      const g = this.gain();
      this.perc(g.gain, t + dt, v, 0.06, 0.004);
      o.connect(g);
      g.connect(this.sfxVol);
      o.start(t + dt);
      o.stop(t + dt + 0.4);
    }
  }

  ui(kind: 'move' | 'select' | 'back' | 'error' | 'start'): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.005;
    const blip = (f: number, at: number, v: number, type: OscillatorType = 'sine'): void => {
      const o = this.osc(type, f, at);
      const g = this.gain();
      this.perc(g.gain, at, v, 0.035, 0.002);
      o.connect(g);
      g.connect(this.sfxVol);
      o.start(at);
      o.stop(at + 0.25);
    };
    switch (kind) {
      case 'move':
        blip(1320, t, 0.035);
        break;
      case 'select':
        blip(880, t, 0.06);
        blip(1318.5, t + 0.05, 0.06);
        break;
      case 'back':
        blip(784, t, 0.05);
        blip(523.25, t + 0.05, 0.05);
        break;
      case 'error':
        blip(180, t, 0.08, 'square');
        break;
      case 'start':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => blip(f, t + i * 0.06, 0.07, 'triangle'));
        break;
    }
  }
}
