import type { BossId, EnemyId } from './ids';

export type PopupKind = 'score' | 'perfect' | 'chain' | 'info' | 'warn' | 'heal' | 'crit';
export type MusicCue =
  | { song?: number | 'title' | 'ending'; intensity?: number; dropout?: boolean; silent?: boolean; open?: number }
  | undefined;

/** Everything the simulation reports to presentation layers (renderer, audio, UI). */
export type GameEvent =
  | { t: 'hit'; x: number; y: number; c: number; crit: boolean }
  | { t: 'kill'; x: number; y: number; size: number; c: number; kind: EnemyId; elite: boolean; score: number }
  | { t: 'playerHit'; x: number; y: number; hp: number }
  | { t: 'playerDie'; x: number; y: number }
  | { t: 'revive'; x: number; y: number }
  | { t: 'graze'; x: number; y: number }
  | { t: 'pickup'; x: number; y: number; kind: 'note' | 'heart'; n: number }
  | { t: 'pulse'; x: number; y: number; perfect: boolean; radius: number }
  | { t: 'charge'; count: number }
  | { t: 'lightning'; pts: number[] }
  | { t: 'sub'; x: number; y: number; r: number }
  | { t: 'nova'; x: number; y: number }
  | { t: 'beam'; x: number; y: number; dur: number }
  | { t: 'bulletBurst'; x: number; y: number; c: number; n: number }
  | { t: 'popup'; x: number; y: number; text: string; kind: PopupKind }
  | { t: 'shake'; amount: number }
  | { t: 'flash'; color: string; amount: number }
  | { t: 'ripple'; x: number; y: number; amount: number }
  | { t: 'sector'; index: number }
  | { t: 'wave'; sector: number; wave: number }
  | { t: 'waveClear' }
  | { t: 'bossWarning'; id: BossId; beats: number }
  | { t: 'riser'; beats: number }
  | { t: 'bossStart'; id: BossId }
  | { t: 'bossPhase'; phase: number }
  | { t: 'bossDefeated'; x: number; y: number; id: BossId }
  | { t: 'bossBlast'; x: number; y: number; size: number }
  | { t: 'sectorClear'; index: number; bonus: number; flawless: boolean }
  | { t: 'upgradeOffer'; boss: boolean }
  | { t: 'upgradeTaken'; id: string; level: number }
  | { t: 'warp'; to: number }
  | { t: 'music'; cue: NonNullable<MusicCue> }
  | { t: 'enemyShoot'; x: number; y: number; size: number }
  | { t: 'laserWarn'; x: number; y: number }
  | { t: 'gameOver' }
  | { t: 'victory' }
  | { t: 'unlock'; ship: string };

/** Bullet colour slots, resolved by the renderer against the active sector palette. */
export const enum BC {
  A = 0,
  B = 1,
  C = 2,
  W = 3,
}

export const enum Shape {
  Orb = 0,
  Rice = 1,
  Star = 2,
  Ring = 3,
  Shard = 4,
  Bolt = 5,
  Missile = 6,
}
