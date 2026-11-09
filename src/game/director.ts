/**
 * Run flow state machine. Every transition happens on bar lines so that sector cards, boss
 * entrances and drops land with the music. Music changes requested during bar N are heard
 * from bar N+1, so cues are sent one bar ahead of the moment they must land.
 */
import type { StepEvent } from '../core/beat';
import { BOSSES } from './bosses';
import { SECTORS } from './sectors';
import { rollOffers, type UpgradeId } from './upgrades';
import { buildWave, type WavePlan } from './waves';
import type { World } from './world';

export type RunPhase =
  | 'intro'
  | 'wave'
  | 'waveClear'
  | 'upgrade'
  | 'prewave'
  | 'bossWarn'
  | 'boss'
  | 'bossDead'
  | 'sectorClear'
  | 'warp'
  | 'victory'
  | 'dead';

export const WAVES_PER_SECTOR = 2;

export class Director {
  phase: RunPhase = 'intro';
  phaseSteps = 0;
  sector = 0;
  wave = 0;
  plan: WavePlan = { entries: [], length: 0 };
  private cursor = 0;
  private waveStep = 0;
  private escalated = false;
  offers: UpgradeId[] = [];
  offerBoss = false;
  rerolls = 1;
  private finished = false;

  constructor(private w: World) {}

  start(sector = 0): void {
    this.sector = sector;
    this.wave = 0;
    this.enter('intro');
    this.w.emit({ t: 'music', cue: { song: sector, intensity: 1, dropout: false, silent: false, open: 1 } });
    this.w.emit({ t: 'sector', index: sector });
  }

  private enter(p: RunPhase): void {
    this.phase = p;
    this.phaseSteps = 0;
  }

  get inCombat(): boolean {
    return this.phase === 'wave' || this.phase === 'boss' || this.phase === 'bossWarn' || this.phase === 'waveClear';
  }

  onStep(ev: StepEvent): void {
    const w = this.w;
    const bar = ev.pos === 0;
    this.phaseSteps++;
    switch (this.phase) {
      case 'intro':
        if (bar && this.phaseSteps >= 32) this.beginWave();
        break;
      case 'wave': {
        while (this.cursor < this.plan.entries.length && this.plan.entries[this.cursor].at <= this.waveStep) {
          w.spawnEnemy(this.plan.entries[this.cursor].spec);
          this.cursor++;
        }
        this.waveStep++;
        if (!this.escalated && this.waveStep >= this.plan.length * 0.35) {
          this.escalated = true;
          w.emit({ t: 'music', cue: { intensity: 2 } });
        }
        const done = this.cursor >= this.plan.entries.length;
        if (done && w.liveEnemies() === 0) {
          this.enter('waveClear');
          w.vacuumPickups();
          w.emit({ t: 'waveClear' });
        } else if (done && this.waveStep > this.plan.length + 16 * 12) {
          w.dismissEnemies();
        }
        break;
      }
      case 'waveClear':
        if (bar && this.phaseSteps >= 10) this.offerUpgrades(false);
        break;
      case 'prewave':
        if (bar && this.phaseSteps >= 2) {
          if (this.wave + 1 < WAVES_PER_SECTOR) {
            this.wave++;
            this.beginWave();
          } else {
            this.enter('bossWarn');
            const id = SECTORS[this.sector].boss;
            w.emit({ t: 'bossWarning', id, beats: 4 });
            w.emit({ t: 'music', cue: { intensity: 2 } });
          }
        }
        break;
      case 'bossWarn':
        if (bar && this.phaseSteps >= 16 && this.phaseSteps < 32) {
          // one bar before the drop: request the boss theme and build tension
          w.emit({ t: 'music', cue: { intensity: 3 } });
          w.emit({ t: 'riser', beats: 4 });
        } else if (bar && this.phaseSteps >= 32) {
          this.enter('boss');
          w.spawnBoss(SECTORS[this.sector].boss);
        }
        break;
      case 'boss':
        break;
      case 'bossDead':
        if (bar && this.phaseSteps >= 32) {
          this.enter('sectorClear');
          w.sectorCleared(this.sector);
        }
        break;
      case 'sectorClear':
        if (bar && this.phaseSteps >= 32) {
          if (this.sector >= SECTORS.length - 1) {
            this.enter('victory');
            w.emit({ t: 'music', cue: { song: 'ending', intensity: 2, dropout: false } });
          } else this.offerUpgrades(true);
        }
        break;
      case 'warp':
        if (this.phaseSteps === 16 && bar) {
          w.emit({ t: 'music', cue: { song: this.sector + 1, intensity: 1, dropout: false } });
        }
        if (bar && this.phaseSteps >= 32) {
          this.sector++;
          this.wave = 0;
          this.rerolls = 1;
          w.enterSector(this.sector);
          this.enter('intro');
          w.emit({ t: 'sector', index: this.sector });
        }
        break;
      case 'victory':
        if (!this.finished && this.phaseSteps >= 64 && bar) {
          this.finished = true;
          w.finish(true);
        }
        break;
      case 'dead':
        if (!this.finished && this.phaseSteps >= 40) {
          this.finished = true;
          w.finish(false);
        }
        break;
      default:
        break;
    }
  }

  private beginWave(): void {
    const w = this.w;
    this.plan = buildWave(w.rng.fork(1000 + this.sector * 10 + this.wave), SECTORS[this.sector], this.wave, w.diff.budget);
    this.cursor = 0;
    this.waveStep = 0;
    this.escalated = false;
    this.enter('wave');
    w.emit({ t: 'wave', sector: this.sector, wave: this.wave });
    w.emit({ t: 'music', cue: { intensity: 1, dropout: false } });
  }

  private offerUpgrades(boss: boolean): void {
    const w = this.w;
    this.offerBoss = boss;
    this.offers = rollOffers(w.rng.fork(5000 + this.sector * 10 + this.wave + (boss ? 7 : 0) + this.rerollSalt), w.player.levels, {
      hp: w.player.hp,
      maxHp: w.player.stats.maxHp,
      boss,
    });
    this.enter('upgrade');
    w.paused = true;
    w.emit({ t: 'upgradeOffer', boss });
    w.emit({ t: 'music', cue: { intensity: 0, open: 0.3 } });
  }

  private rerollSalt = 0;

  reroll(): boolean {
    if (this.phase !== 'upgrade' || this.rerolls <= 0) return false;
    this.rerolls--;
    this.rerollSalt += 101;
    this.offerUpgrades(this.offerBoss);
    return true;
  }

  choose(id: UpgradeId): void {
    if (this.phase !== 'upgrade') return;
    const w = this.w;
    const lv = w.player.apply(id);
    w.stats.upgrades.push(id);
    w.emit({ t: 'upgradeTaken', id, level: lv });
    w.paused = false;
    w.emit({ t: 'music', cue: { open: 1 } });
    if (this.offerBoss) {
      this.enter('warp');
      w.emit({ t: 'warp', to: this.sector + 1 });
      w.emit({ t: 'music', cue: { intensity: 0 } });
    } else {
      this.enter('prewave');
    }
  }

  bossDefeated(): void {
    this.enter('bossDead');
    this.w.emit({ t: 'music', cue: { intensity: 1, dropout: true } });
  }

  playerDied(): void {
    this.enter('dead');
    this.w.emit({ t: 'music', cue: { intensity: 0, open: 0.25, dropout: true } });
  }

  get bossDef() {
    return BOSSES[SECTORS[this.sector].boss];
  }
}
