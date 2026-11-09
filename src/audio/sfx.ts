/**
 * Maps simulation events to sound. Percussive layers play immediately for punch; tonal
 * layers (explosion plucks, pickups, sparkles) are quantised to the 32nd-note grid and
 * pitched to the current chord, so the battle itself plays along with the song.
 */
import { clamp } from '../core/math';
import type { GameEvent } from '../game/types';
import type { Conductor } from './conductor';
import type { AudioEngine } from './engine';
import type { MusicPlayer } from './music';

export class SfxDirector {
  private pluckIdx = 0;
  private lastPickupSlot = -1;
  private lastPluckSlot = -1;
  private pluckInSlot = 0;
  private lastHit = 0;
  private lastBurst = 0;

  constructor(
    private eng: AudioEngine,
    private conductor: Conductor,
    private music: MusicPlayer,
    private halfW: number,
  ) {}

  private pan(x: number): number {
    return clamp(x / this.halfW, -1, 1) * 0.7;
  }

  private grid(frac = 0.5): number {
    const now = this.eng.time;
    return Math.max(now + 0.002, this.conductor.nextGrid(now + 0.004, frac));
  }

  handle(e: GameEvent): void {
    const eng = this.eng;
    if (!eng.ready) return;
    const now = eng.time;
    const chord = this.music.chord();
    switch (e.t) {
      case 'hit':
        if (now - this.lastHit > 0.03) {
          this.lastHit = now;
          eng.hit(now, this.pan(e.x));
        }
        break;
      case 'kill': {
        eng.boom(now, e.size, this.pan(e.x));
        const q = this.grid(0.5);
        const slot = Math.round(q * 1000);
        if (slot === this.lastPluckSlot) {
          if (++this.pluckInSlot > 2) break;
        } else {
          this.lastPluckSlot = slot;
          this.pluckInSlot = 0;
        }
        const oct = e.size === 0 ? 24 : e.size === 1 ? 12 : 0;
        const m = chord[this.pluckIdx++ % chord.length] + oct;
        eng.pluck(q, m, e.elite ? 1 : 0.8, this.pan(e.x), e.size >= 2);
        break;
      }
      case 'playerHit':
        eng.playerHit(now);
        break;
      case 'playerDie':
        eng.impact(now, 1.3);
        eng.playerHit(now);
        break;
      case 'revive':
        eng.impact(now, 0.8);
        eng.arpeggio(now + 0.05, chord, 8, 0.045, 1);
        break;
      case 'graze':
        eng.graze(now, Math.min(100, chord[(this.pluckIdx + 1) % chord.length] + 24));
        break;
      case 'pickup': {
        if (e.kind === 'heart') {
          eng.arpeggio(now, chord, 4, 0.05, 1);
          break;
        }
        const q = this.grid(0.5);
        const slot = Math.round(q * 1000);
        if (slot === this.lastPickupSlot) break;
        this.lastPickupSlot = slot;
        const idx = Math.min(8, e.n - 1);
        const m = chord[idx % chord.length] + 12 * Math.floor(idx / chord.length) + 24;
        eng.bell(q, m, 0.55, this.pan(e.x));
        break;
      }
      case 'pulse':
        eng.pulse(now, e.perfect, chord);
        break;
      case 'charge':
        eng.arpeggio(now, chord, 3, 0.06, 0.8);
        break;
      case 'lightning':
        eng.zap(now, this.pan(e.pts[0]));
        break;
      case 'nova':
        eng.arpeggio(this.grid(0.5), chord, 3, 0.03, 0.6);
        break;
      case 'beam':
        eng.laser(now, e.dur, this.pan(e.x));
        break;
      case 'bulletBurst':
        if (now - this.lastBurst > 0.06) {
          this.lastBurst = now;
          eng.hit(now, this.pan(e.x));
        }
        break;
      case 'laserWarn':
        eng.bell(now, chord[0] + 36, 0.35, this.pan(e.x));
        break;
      case 'bossWarning': {
        const beat = this.conductor.stepDur * 4;
        const t0 = this.grid(4);
        const root = this.music.rootMidi;
        eng.warning(t0, beat, e.beats * 2, root + 12, root + 19);
        break;
      }
      case 'riser': {
        const end = this.conductor.nextGrid(now + 0.02, 16);
        eng.riser(now, Math.max(0.3, end - now));
        break;
      }
      case 'bossStart':
        eng.impact(now, 1);
        break;
      case 'bossPhase':
        eng.impact(now, 0.7);
        eng.arpeggio(now + 0.02, chord, 6, 0.035, 0.8);
        break;
      case 'bossBlast':
        eng.boom(now, 2, this.pan(e.x));
        break;
      case 'bossDefeated':
        eng.impact(now, 1.6);
        for (let i = 1; i <= 6; i++) eng.boom(now + i * 0.17, 3, (i % 2 ? 1 : -1) * 0.4);
        eng.arpeggio(now + 1.1, chord, 9, 0.06, 1);
        break;
      case 'sectorClear':
        eng.arpeggio(this.grid(1), chord, 8, 0.07, 1);
        break;
      case 'upgradeTaken':
        eng.arpeggio(now, chord, 5, 0.04, 0.9);
        break;
      case 'warp': {
        const end = this.conductor.nextGrid(now + 0.02, 16) + this.conductor.stepDur * 16;
        eng.riser(now, Math.max(0.5, end - now));
        break;
      }
      default:
        break;
    }
  }
}
