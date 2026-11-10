/**
 * PULSAR — entry point. Wires the musical clock, simulation, renderer, audio and UI.
 *
 * Frame flow:
 *   input → conductor.pump (schedule audio ahead) → dispatch audible steps to the world →
 *   fixed 120 Hz simulation → drain events (render/sfx/ui/music cues) → render → HUD
 */
import './ui/style.css';
import { ENDING_SONG, makeSong, TITLE_SONG } from './audio/composer';
import { Conductor, type StepEvent } from './audio/conductor';
import { AudioEngine } from './audio/engine';
import { MusicPlayer } from './audio/music';
import { SfxDirector } from './audio/sfx';
import { setLang, t } from './core/i18n';
import { hashString } from './core/rng';
import { loadSave, todayKey, writeSave, type Difficulty, type Settings, type ShipId } from './core/save';
import { SECTORS } from './game/sectors';
import type { GameEvent, MusicCue } from './game/types';
import type { UpgradeId } from './game/upgrades';
import { World } from './game/world';
import { Input } from './input/input';
import { GameRenderer } from './render/renderer';
import { dailyShip, UI, type ResultsData } from './ui/ui';
import { Online } from './online';

const save = loadSave();
setLang(save.settings.lang);

const app = document.getElementById('app')!;
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui')!;

/* ------------------------------------------------------------------ */
/* subsystems                                                          */
/* ------------------------------------------------------------------ */

let renderer: GameRenderer;
try {
  renderer = new GameRenderer(canvas, save.settings.quality);
} catch (err) {
  const msg = document.createElement('div');
  msg.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;padding:24px;text-align:center;font:16px system-ui;color:#eef2ff;background:#06051a';
  msg.textContent = 'WebGL를 사용할 수 없어 게임을 실행할 수 없습니다. / WebGL is not available on this device.';
  document.body.append(msg);
  throw err;
}
renderer.settings.shake = save.settings.shake;
renderer.settings.reduceFlashing = save.settings.reduceFlashing;
renderer.setSector(0, true);

const engine = new AudioEngine();
const music = new MusicPlayer(engine);
let useAudioClock = false;
const perfClock = (): number => performance.now() / 1000;
const conductor = new Conductor(() => (useAudioClock ? engine.time : perfClock()), {
  barStart: (s) => music.barStart(s),
  schedule: (s, tm, d) => music.schedule(s, tm, d),
});
const sfx = new SfxDirector(engine, conductor, music, 28);

let world: World | null = null;
let runConfig: { ship: ShipId; difficulty: Difficulty; daily: boolean; seed: number } | null = null;
let playing = false;
let finished = false;
let interrupted = false;
let beatEnv = 0;
let beatTick = false;
let acc = 0;
let lastFrame = performance.now();
let fpsAvg = 60;
let shownPortraitHint = false;

function applyVolumes(s: Settings): void {
  engine.volumes = { master: s.master, music: s.music, sfx: s.sfx };
  engine.applyVolumes();
}
applyVolumes(save.settings);

/* ------------------------------------------------------------------ */
/* UI                                                                  */
/* ------------------------------------------------------------------ */

const ui = new UI(uiRoot, save, {
  firstTap() {
    useAudioClock = engine.init();
    applyVolumes(save.settings);
    music.setSong(makeSong(TITLE_SONG, 7), true);
    music.setIntensity(1);
    engine.setMusicOpen(1, 0.05);
    conductor.start(TITLE_SONG.bpm, 0.12);
    if (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
      setTimeout(() => ui.toast(t('soundHint')), 1200);
    }
  },
  startRun(o) {
    startRun(o.ship, o.difficulty, o.daily);
  },
  choose(id: UpgradeId) {
    if (!world) return;
    world.choose(id);
    ui.show(null);
    renderer.dim = 0;
  },
  reroll() {
    if (!world) return;
    if (world.director.reroll()) {
      engine.ui('select');
      ui.showUpgrades(world);
    } else engine.ui('error');
  },
  pause: () => pause(),
  resume: () => resume(),
  retire() {
    if (!world) return;
    world.finish(false);
    drainEvents();
  },
  toMenu: () => toMenu(),
  retry() {
    if (runConfig) startRun(runConfig.ship, runConfig.difficulty, runConfig.daily);
  },
  settingsChanged(s: Settings) {
    applyVolumes(s);
    renderer.settings.shake = s.shake;
    renderer.settings.reduceFlashing = s.reduceFlashing;
    if (s.quality !== (renderer.autoQuality ? 'auto' : renderer.quality)) renderer.setQuality(s.quality);
    setLang(s.lang);
    writeSave(save);
  },
  pulse: () => tryPulse(),
  sound: (k) => engine.ui(k),
});
ui.dailyKey = todayKey();
const online = new Online();
ui.online = online;
online.onChange = () => ui.refreshRecords();
void online.init();
ui.refresh();
ui.show('title');

renderer.onQualityChange = () => ui.toast(t('qualityLowered'));

const input = new Input(canvas, {
  onPulse: () => tryPulse(),
  onPause: () => {
    if (!world || finished) return;
    if (ui.current === 'pause') resume();
    else if (!ui.current) pause();
  },
});

function layout(): void {
  renderer.resize();
  ui.layout(renderer.fieldRect(), window.innerWidth);
}
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', () => setTimeout(layout, 200));
layout();

/* ------------------------------------------------------------------ */
/* run lifecycle                                                       */
/* ------------------------------------------------------------------ */

function songFor(cue: number | 'title' | 'ending', seed: number) {
  if (cue === 'title') return makeSong(TITLE_SONG, 7);
  if (cue === 'ending') return makeSong(ENDING_SONG, seed + 99);
  return makeSong(SECTORS[cue].song, seed + cue * 7919);
}

function applyCue(cue: NonNullable<MusicCue>): void {
  if (cue.song !== undefined) music.setSong(songFor(cue.song, world ? world.seed : 1));
  if (cue.intensity !== undefined) music.setIntensity(cue.intensity);
  if (cue.dropout !== undefined) music.dropout = cue.dropout;
  if (cue.silent !== undefined) music.silent = cue.silent;
  if (cue.open !== undefined) engine.setMusicOpen(cue.open, cue.open < 1 ? 0.3 : 0.15);
}

function startRun(ship: ShipId, difficulty: Difficulty, daily: boolean): void {
  if (!ui.hasStarted) ui.triggerFirstTap();
  const seed = daily ? hashString(`pulsar-${todayKey()}`) : (Math.random() * 2 ** 32) >>> 0;
  runConfig = { ship, difficulty, daily, seed };
  world = new World({ seed, ship, difficulty, daily });
  world.start();
  finished = false;
  playing = true;
  acc = 0;
  renderer.clearEffects();
  renderer.setShip(ship);
  renderer.setSector(0, true);
  renderer.dim = 0;
  ui.clearBanners();
  ui.show(null);
  ui.showHud(true);
  input.reset();
  input.enabled = true;
  music.silent = false;
  music.dropout = false;
  drainEvents();
  if (!shownPortraitHint && matchMedia('(pointer: coarse)').matches && innerWidth > innerHeight) {
    shownPortraitHint = true;
    ui.toast(t('portraitHint'));
  }
}

function pause(): void {
  if (!world || finished || world.paused) return;
  world.paused = true;
  playing = false;
  input.enabled = false;
  renderer.dim = 0.5;
  engine.setMusicOpen(0.28);
  music.gun.active = false;
  ui.showPause(world);
}

function resume(): void {
  if (!world || finished) return;
  void engine.resume();
  ui.show(null);
  renderer.dim = 0;
  if (world.director.phase === 'upgrade') {
    ui.showUpgrades(world);
    return;
  }
  world.paused = false;
  playing = true;
  input.enabled = true;
  input.reset();
  engine.setMusicOpen(1);
}

function toMenu(): void {
  world = null;
  playing = false;
  finished = false;
  input.enabled = false;
  renderer.dim = 0;
  renderer.clearEffects();
  renderer.setSector(0, false);
  ui.showHud(false);
  ui.clearBanners();
  music.dropout = false;
  music.silent = false;
  music.heartbeat = false;
  music.gun.active = false;
  music.setSong(makeSong(TITLE_SONG, 7));
  music.setIntensity(1);
  engine.setMusicOpen(1);
  ui.refresh();
  ui.show('title');
}

function tryPulse(): void {
  if (!world || !playing || finished || world.paused) return;
  const p = world.player;
  if (!p.alive) return;
  if (p.charges < 1 || world.pulse) {
    engine.ui('error');
    return;
  }
  const audible = useAudioClock ? engine.time - engine.latency : perfClock();
  const off = Math.abs(conductor.beatOffset(audible));
  world.input.pulse = true;
  world.input.pulsePerfect = off <= p.stats.perfectWindow;
}

function finishRun(win: boolean): void {
  if (!world || !runConfig) return;
  finished = true;
  playing = false;
  input.enabled = false;
  music.gun.active = false;
  music.heartbeat = false;
  const w = world;
  const st = w.stats;
  const diff = runConfig.difficulty;
  const score = w.score;
  let best: number;
  let newRecord = false;
  if (runConfig.daily) {
    const key = todayKey();
    if (save.daily.date !== key) save.daily = { date: key, best: 0 };
    newRecord = score > save.daily.best;
    save.daily.best = Math.max(save.daily.best, score);
    best = save.daily.best;
  } else {
    newRecord = score > save.best[diff];
    save.best[diff] = Math.max(save.best[diff], score);
    save.bestSector[diff] = Math.max(save.bestSector[diff], st.sector);
    best = save.best[diff];
  }
  save.stats.runs++;
  save.stats.kills += st.kills;
  save.stats.victories += win ? 1 : 0;
  save.stats.playTime += st.time;
  save.stats.perfectPulses += st.perfects;
  save.stats.bossesDefeated += st.bosses;
  save.stats.grazes += st.grazes;
  const unlocks: ShipId[] = [];
  if (st.bosses >= 1 && !save.unlocks.aegis) {
    save.unlocks.aegis = true;
    unlocks.push('aegis');
  }
  if (st.bosses >= 3 && !save.unlocks.volt) {
    save.unlocks.volt = true;
    unlocks.push('volt');
  }
  save.history.unshift({ score, sector: st.sector, diff, ship: runConfig.ship, date: todayKey(), win, daily: runConfig.daily });
  save.history = save.history.slice(0, 20);
  writeSave(save);
  if (!runConfig.daily) void online.submit(score, runConfig.ship, diff, win);
  const data: ResultsData = {
    win,
    score,
    best,
    newRecord: newRecord && score > 0,
    sector: st.sector,
    time: st.time,
    kills: st.kills,
    grazes: st.grazes,
    perfects: st.perfects,
    maxChain: st.maxChain,
    hits: st.hits,
    upgrades: st.upgrades,
    unlocks,
    daily: runConfig.daily,
  };
  setTimeout(
    () => {
      renderer.dim = 0.35;
      ui.showHud(false);
      ui.showResults(data);
    },
    win ? 600 : 300,
  );
  if (!win) {
    music.setIntensity(0);
    engine.setMusicOpen(0.35);
  }
}

/* ------------------------------------------------------------------ */
/* events                                                              */
/* ------------------------------------------------------------------ */

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

function handleEvent(e: GameEvent): void {
  renderer.handle(e, world);
  sfx.handle(e);
  switch (e.t) {
    case 'music':
      applyCue(e.cue);
      break;
    case 'sector': {
      const s = SECTORS[e.index];
      ui.banner('sector', t(`${s.key}.name`), `${t('sector')} ${e.index + 1}`, t(`${s.key}.sub`));
      break;
    }
    case 'warp':
      renderer.setSector(e.to);
      break;
    case 'wave':
      if (e.wave > 0) ui.banner('wave', `${t('wave')} ${e.wave + 1}`, `${t('sector')} ${e.sector + 1}`);
      break;
    case 'waveClear':
      ui.banner('clear', t('waveClear'));
      break;
    case 'bossWarning':
      ui.banner('warn', t('warning'), '', t('approaching', { name: t(`boss.${e.id}`) }));
      break;
    case 'sectorClear':
      ui.banner('clear', t('sectorClear'), e.flawless ? t('flawless') : '', `${t('bonus')} +${fmt(e.bonus)}`);
      break;
    case 'upgradeOffer':
      if (world) {
        renderer.dim = 0.55;
        music.gun.active = false;
        ui.showUpgrades(world);
      }
      break;
    case 'popup': {
      const p = renderer.worldToScreen(e.x, e.y);
      ui.popup(p.x, p.y, e.text, e.kind);
      break;
    }
    case 'kill':
      if (e.size >= 2 || e.elite) {
        const p = renderer.worldToScreen(e.x, e.y);
        ui.popup(p.x, p.y, fmt(e.score), 'score');
      }
      break;
    case 'charge':
      if (world) {
        const p = renderer.worldToScreen(world.player.x, world.player.y + 5);
        ui.popup(p.x, p.y, t('chargeReady'), 'info');
      }
      break;
    case 'gameOver':
      finishRun(false);
      break;
    case 'victory':
      finishRun(true);
      break;
    default:
      break;
  }
}

function drainEvents(): void {
  if (!world) return;
  const evs = world.events;
  world.events = [];
  for (const e of evs) handleEvent(e);
}

/* ------------------------------------------------------------------ */
/* lifecycle: visibility & audio interruptions                         */
/* ------------------------------------------------------------------ */

// iOS Safari only unlocks audio on certain gestures; retry on each of them while needed.
for (const ev of ['touchend', 'click', 'keydown']) {
  window.addEventListener(
    ev,
    () => {
      if (engine.ctx && engine.ctx.state !== 'running' && !document.hidden) engine.unlock();
    },
    { passive: true },
  );
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (world && playing) pause();
    void engine.suspend();
  } else {
    void engine.resume();
  }
});

function checkAudioInterrupted(): void {
  if (!useAudioClock || !engine.ctx || interrupted) return;
  const st = engine.ctx.state as string;
  if (st !== 'running' && !document.hidden) {
    interrupted = true;
    if (world && playing) pause();
    ui.resumePrompt(() => {
      void engine.resume().then(() => (interrupted = false));
      setTimeout(() => (interrupted = false), 400);
    });
  }
}

/* ------------------------------------------------------------------ */
/* main loop                                                           */
/* ------------------------------------------------------------------ */

const steps: StepEvent[] = [];
const FIXED = 1 / 120;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  fpsAvg += (1 / Math.max(dt, 1e-3) - fpsAvg) * 0.05;

  input.poll();
  if (!playing) {
    const nav = input.menuPoll();
    if (nav) ui.nav(nav);
  }

  conductor.pump();
  checkAudioInterrupted();
  const audible = useAudioClock ? engine.time - engine.latency : perfClock();
  steps.length = 0;
  if (conductor.running) conductor.dispatch(audible, steps);
  beatTick = false;
  for (const ev of steps) {
    if (ev.pos % 4 === 0) {
      beatEnv = ev.pos === 0 ? 1 : Math.max(beatEnv, 0.7);
      beatTick = true;
      if (!world) ui.beatPulse();
    }
    if (world && !world.paused) world.onStep(ev);
  }
  beatEnv *= Math.exp(-dt * 7);

  if (world) {
    const w = world;
    if (playing && !w.paused) {
      const sens = save.settings.sensitivity;
      const [dx, dy] = input.takeDrag();
      const upp = renderer.unitsPerPixel * sens;
      w.input.dragX += dx * upp;
      w.input.dragY -= dy * upp;
      w.input.mx = input.mx;
      w.input.my = input.my;
      w.input.focus = input.focus;
    } else input.takeDrag();
    acc += dt;
    let n = 0;
    while (acc >= FIXED && n < 10) {
      w.update(FIXED);
      acc -= FIXED;
      n++;
    }
    if (n >= 10) acc = 0;
    drainEvents();
    const firing = playing && !w.paused && w.player.alive && w.firing && !finished;
    music.gun.active = firing;
    music.gun.power = 0.6 + 0.1 * Math.min(4, w.player.stats.streams - 2);
    music.heartbeat = playing && w.player.alive && w.player.hp === 1;
    ui.updateHud(w, beatTick);
  }

  renderer.render(world, dt, { beat: beatEnv, level: 0 });
  ui.setFps(fpsAvg);
}
requestAnimationFrame(frame);

/* ------------------------------------------------------------------ */
/* PWA                                                                 */
/* ------------------------------------------------------------------ */

if (!__SINGLE_FILE__ && 'serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}

// expose a tiny debug hook for automated browser checks
(window as unknown as { __pulsar: unknown }).__pulsar = {
  get world() {
    return world;
  },
  start: (ship: ShipId = 'echo', diff: Difficulty = 'normal') => startRun(ship, diff, false),
  daily: () => startRun(dailyShip(todayKey()), 'normal', true),
  setSector: (i: number) => renderer.setSector(i, true),
  offer: () => {
    if (!world) return;
    (world.director as unknown as { offerUpgrades(b: boolean): void }).offerUpgrades(false);
    drainEvents();
  },
  pause: () => pause(),
  meter: () => ({ ...engine.meter(), state: engine.ctx?.state, audioClock: useAudioClock, bar: music.barCount, intensity: music.intensity }),
  music,
  ui,
  app,
};
