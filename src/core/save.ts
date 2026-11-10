/** Persistent player data. Every storage access is guarded so the game runs without storage. */
export type Difficulty = 'easy' | 'normal' | 'hard';
export type Quality = 'auto' | 'high' | 'medium' | 'low';
export type Lang = 'ko' | 'en';
export type ShipId = 'echo' | 'aegis' | 'volt';

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  quality: Quality;
  shake: boolean;
  reduceFlashing: boolean;
  sensitivity: number;
  lang: Lang;
  showFps: boolean;
}

export interface RunRecord {
  score: number;
  sector: number;
  diff: Difficulty;
  ship: ShipId;
  date: string;
  win: boolean;
  daily: boolean;
}

export interface SaveData {
  v: 1;
  settings: Settings;
  best: Record<Difficulty, number>;
  bestSector: Record<Difficulty, number>;
  daily: { date: string; best: number };
  stats: {
    runs: number;
    kills: number;
    victories: number;
    playTime: number;
    perfectPulses: number;
    bossesDefeated: number;
    grazes: number;
  };
  unlocks: Record<ShipId, boolean>;
  seenHelp: boolean;
  history: RunRecord[];
}

const KEY = 'pulsar.save.v1';

function detectLang(): Lang {
  try {
    const l = (navigator.language || 'ko').toLowerCase();
    return l.startsWith('ko') ? 'ko' : 'en';
  } catch {
    return 'ko';
  }
}

export function defaultSave(): SaveData {
  return {
    v: 1,
    settings: {
      master: 0.8,
      music: 0.8,
      sfx: 0.75,
      quality: 'auto',
      shake: true,
      reduceFlashing: false,
      sensitivity: 1.25,
      lang: detectLang(),
      showFps: false,
    },
    best: { easy: 0, normal: 0, hard: 0 },
    bestSector: { easy: 0, normal: 0, hard: 0 },
    daily: { date: '', best: 0 },
    stats: { runs: 0, kills: 0, victories: 0, playTime: 0, perfectPulses: 0, bossesDefeated: 0, grazes: 0 },
    unlocks: { echo: true, aegis: false, volt: false },
    seenHelp: false,
    history: [],
  };
}

function merge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== 'object' || Array.isArray(base)) {
    return (over === undefined ? base : (over as T)) ?? base;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const k of Object.keys(base as object)) {
    const bv = (base as Record<string, unknown>)[k];
    const ov = (over as Record<string, unknown>)[k];
    if (ov === undefined) continue;
    if (bv && typeof bv === 'object' && !Array.isArray(bv)) out[k] = merge(bv, ov);
    else if (typeof bv === typeof ov || bv === null) out[k] = ov;
  }
  return out as T;
}

export function loadSave(): SaveData {
  const base = defaultSave();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    const data = merge(base, parsed);
    data.unlocks.echo = true;
    if (!Array.isArray(data.history)) data.history = [];
    return data;
  } catch {
    return base;
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable: progress lives for this session only */
  }
}

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
