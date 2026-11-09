/** DOM overlay: menus, HUD, banners, popups. Pure presentation; game logic lives elsewhere. */
import { getLang, t } from '../core/i18n';
import type { Difficulty, Quality, RunRecord, SaveData, Settings, ShipId } from '../core/save';
import { BOSSES } from '../game/bosses';
import type { BossId } from '../game/ids';
import { DIFFICULTY, SECTORS, SHIP_ORDER, SHIPS } from '../game/sectors';
import { describe, UPGRADE_MAP, type UpgradeId } from '../game/upgrades';
import type { World } from '../game/world';
import { iconSvg, LOGO_SVG, PAUSE_SVG, SHIP_SVG } from './icons';

export interface UIHandlers {
  firstTap(): void;
  startRun(o: { ship: ShipId; difficulty: Difficulty; daily: boolean }): void;
  choose(id: UpgradeId): void;
  reroll(): void;
  pause(): void;
  resume(): void;
  retire(): void;
  toMenu(): void;
  retry(): void;
  settingsChanged(s: Settings): void;
  pulse(): void;
  sound(kind: 'move' | 'select' | 'back' | 'error' | 'start'): void;
}

export interface ResultsData {
  win: boolean;
  score: number;
  best: number;
  newRecord: boolean;
  sector: number;
  time: number;
  kills: number;
  grazes: number;
  perfects: number;
  maxChain: number;
  hits: number;
  upgrades: UpgradeId[];
  unlocks: ShipId[];
  daily: boolean;
}

type ScreenId = 'title' | 'select' | 'upgrade' | 'pause' | 'settings' | 'records' | 'help' | 'results';

const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
const fmtTime = (s: number): string => {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function dailyShip(dateKey: string): ShipId {
  let h = 0;
  for (const c of dateKey) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SHIP_ORDER[h % SHIP_ORDER.length];
}

export class UI {
  readonly root: HTMLElement;
  private screens = new Map<ScreenId, HTMLElement>();
  private active: ScreenId | null = null;
  private settingsReturn: ScreenId | null = null;
  private hud!: HTMLElement;
  private banners!: HTMLElement;
  private popups!: HTMLElement;
  private fpsEl!: HTMLElement;
  private popPool: HTMLElement[] = [];
  private popIdx = 0;
  private started = false;
  private shipSel: ShipId = 'echo';
  private diffSel: Difficulty = 'normal';
  private hudCache = { score: -1, mult: '', hp: -1, maxHp: -1, reso: -1, charges: -1, maxCharges: -1, bossHp: -2, sector: -1, wide: false };
  private bossName = '';
  private hudEls!: {
    score: HTMLElement;
    mult: HTMLElement;
    hp: HTMLElement;
    reso: HTMLElement;
    pulse: HTMLElement;
    pulseCount: HTMLElement;
    boss: HTMLElement;
    bossFill: HTMLElement;
    bossName: HTMLElement;
    bossPct: HTMLElement;
    bossNotches: HTMLElement;
    sector: HTMLElement;
  };
  dailyKey = '';

  constructor(
    root: HTMLElement,
    private save: SaveData,
    private h: UIHandlers,
  ) {
    this.root = root;
    this.shipSel = 'echo';
    this.build();
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  /* ------------------------------------------------------------ */
  /* construction                                                  */
  /* ------------------------------------------------------------ */

  private build(): void {
    this.root.innerHTML = '';
    const ids: ScreenId[] = ['title', 'select', 'upgrade', 'pause', 'settings', 'records', 'help', 'results'];
    for (const id of ids) {
      const s = el('section', `screen${id === 'title' ? '' : ' scrim'}`);
      s.id = id;
      s.setAttribute('aria-hidden', 'true');
      this.screens.set(id, s);
    }
    this.hud = el('div');
    this.hud.id = 'hud';
    this.banners = el('div');
    this.banners.id = 'banners';
    this.popups = el('div');
    this.popups.id = 'popups';
    this.fpsEl = el('div', 'fps');
    this.fpsEl.hidden = !this.save.settings.showFps;
    this.root.append(this.hud, this.banners, this.popups, ...this.screens.values(), this.fpsEl);
    for (let i = 0; i < 18; i++) {
      const p = el('div', 'pop');
      p.hidden = true;
      p.addEventListener('animationend', () => (p.hidden = true));
      this.popups.append(p);
      this.popPool.push(p);
    }
    this.renderTitle();
    this.renderHud();
  }

  /** Re-render every screen (language change). */
  refresh(): void {
    const act = this.active;
    this.renderTitle();
    this.renderHud();
    if (act === 'settings') this.renderSettings();
    if (act === 'select') this.renderSelect();
    if (act === 'records') this.renderRecords();
    if (act === 'help') this.renderHelp();
  }

  private screen(id: ScreenId): HTMLElement {
    return this.screens.get(id)!;
  }

  show(id: ScreenId | null): void {
    for (const [sid, s] of this.screens) {
      const on = sid === id;
      s.classList.toggle('show', on);
      s.setAttribute('aria-hidden', on ? 'false' : 'true');
      if ('inert' in s) (s as HTMLElement & { inert: boolean }).inert = !on;
    }
    this.active = id;
    if (id) {
      requestAnimationFrame(() => {
        const s = this.screen(id);
        const first = s.querySelector<HTMLElement>('[data-autofocus]') ?? s.querySelector<HTMLElement>('button:not([disabled])');
        if (first && !matchMedia('(pointer: coarse)').matches) first.focus({ preventScroll: true });
      });
    }
  }

  get current(): ScreenId | null {
    return this.active;
  }

  private bind(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('[data-act]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.act(b.dataset.act!, b);
      });
    });
  }

  private act(a: string, b: HTMLElement): void {
    const snd = (k: 'select' | 'back' | 'move'): void => this.h.sound(k);
    switch (a) {
      case 'play':
        snd('select');
        this.renderSelect();
        this.show('select');
        break;
      case 'daily':
        this.h.sound('start');
        this.h.startRun({ ship: dailyShip(this.dailyKey), difficulty: 'normal', daily: true });
        break;
      case 'records':
        snd('select');
        this.renderRecords();
        this.show('records');
        break;
      case 'settings':
        snd('select');
        this.settingsReturn = this.active;
        this.renderSettings();
        this.show('settings');
        break;
      case 'help':
        snd('select');
        this.renderHelp();
        this.show('help');
        break;
      case 'back':
        snd('back');
        if (this.active === 'settings' && this.settingsReturn && this.settingsReturn !== 'settings') this.show(this.settingsReturn);
        else this.show('title');
        break;
      case 'ship': {
        const id = b.dataset.id as ShipId;
        if (!this.save.unlocks[id]) {
          this.h.sound('error');
          return;
        }
        snd('move');
        this.shipSel = id;
        this.screen('select')
          .querySelectorAll('.ship-card')
          .forEach((c) => c.classList.toggle('selected', (c as HTMLElement).dataset.id === id));
        break;
      }
      case 'diff': {
        snd('move');
        this.diffSel = b.dataset.id as Difficulty;
        this.screen('select')
          .querySelectorAll('.seg button')
          .forEach((c) => c.classList.toggle('on', (c as HTMLElement).dataset.id === this.diffSel));
        const hint = this.screen('select').querySelector('.hint');
        if (hint) hint.textContent = t(`diffd.${this.diffSel}`);
        break;
      }
      case 'launch':
        this.h.sound('start');
        this.h.startRun({ ship: this.shipSel, difficulty: this.diffSel, daily: false });
        break;
      case 'choose':
        this.h.choose(b.dataset.id as UpgradeId);
        break;
      case 'reroll':
        this.h.reroll();
        break;
      case 'resume':
        snd('select');
        this.h.resume();
        break;
      case 'retire':
        snd('back');
        this.h.retire();
        break;
      case 'menu':
        snd('back');
        this.h.toMenu();
        break;
      case 'retry':
        this.h.sound('start');
        this.h.retry();
        break;
      case 'pause':
        this.h.pause();
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------ */
  /* title                                                         */
  /* ------------------------------------------------------------ */

  private renderTitle(): void {
    const s = this.screen('title');
    const best = Math.max(this.save.best.easy, this.save.best.normal, this.save.best.hard);
    s.innerHTML = `
      ${LOGO_SVG}
      <p class="tagline">${t('tagline')}</p>
      <div class="tap-start" ${this.started ? 'hidden' : ''}>${t('tapToStart')}</div>
      <div class="menu" ${this.started ? '' : 'hidden'}>
        <button class="btn primary" data-act="play" data-autofocus>${t('play')}</button>
        <button class="btn" data-act="daily">${t('daily')}<span class="sub">${this.dailyKey}</span></button>
        <button class="btn" data-act="records">${t('records')}${best ? `<span class="sub">${t('best')} ${fmt(best)}</span>` : ''}</button>
        <button class="btn" data-act="help">${t('howto')}</button>
        <button class="btn" data-act="settings">${t('settings')}</button>
      </div>
      <p class="story" ${this.started ? 'hidden' : ''}>${t('story')}</p>
      <p class="foot">${t('credits')} · ${t('version')}</p>
    `;
    this.bind(s);
    if (!this.started) {
      const tap = (e: Event): void => {
        e.preventDefault();
        if (this.started) return;
        this.started = true;
        s.removeEventListener('pointerdown', tap);
        this.h.firstTap();
        s.querySelector<HTMLElement>('.tap-start')!.hidden = true;
        s.querySelector<HTMLElement>('.story')!.hidden = true;
        const menu = s.querySelector<HTMLElement>('.menu')!;
        menu.hidden = false;
        menu.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 500, easing: 'cubic-bezier(.2,.9,.2,1)' });
        if (!matchMedia('(pointer: coarse)').matches) menu.querySelector<HTMLElement>('button')?.focus();
      };
      s.addEventListener('pointerdown', tap);
      this.firstTapHandler = tap;
    }
  }

  private firstTapHandler: ((e: Event) => void) | null = null;

  /** Keyboard/gamepad equivalent of the first tap. */
  triggerFirstTap(): void {
    if (!this.started && this.firstTapHandler) this.firstTapHandler(new Event('pointerdown'));
  }

  get hasStarted(): boolean {
    return this.started;
  }

  beatPulse(): void {
    if (this.active !== 'title') return;
    const s = this.screen('title');
    s.classList.remove('beat');
    void s.offsetWidth;
    s.classList.add('beat');
  }

  /* ------------------------------------------------------------ */
  /* ship select                                                   */
  /* ------------------------------------------------------------ */

  private renderSelect(): void {
    const s = this.screen('select');
    if (!this.save.unlocks[this.shipSel]) this.shipSel = 'echo';
    const cards = SHIP_ORDER.map((id) => {
      const d = SHIPS[id];
      const locked = !this.save.unlocks[id];
      const hp = d.hp + DIFFICULTY[this.diffSel].hpBonus;
      const bars = `<div class="bars">
          <span>${t('stat.hp')}</span><div class="bar"><i style="width:${(d.hp / 7) * 100}%"></i></div>
          <span>${t('stat.speed')}</span><div class="bar"><i style="width:${(d.speed / 1.15) * 100}%"></i></div>
          <span>${t('stat.power')}</span><div class="bar"><i style="width:${id === 'volt' ? 92 : id === 'echo' ? 72 : 60}%"></i></div>
        </div>`;
      return `<button class="ship-card ${id === this.shipSel ? 'selected' : ''} ${locked ? 'locked' : ''}" data-act="ship" data-id="${id}" style="--sc:${d.color};color:${d.color}" aria-pressed="${id === this.shipSel}">
          ${SHIP_SVG}
          <span class="name">${t(`ship.${id}`)}${locked ? ` · ${t('locked')}` : ''}</span>
          <span class="desc">${locked ? `<span class="lock-note">${t(`unlock.${id}`)}</span>` : t(`shipd.${id}`)}</span>
          ${locked ? '' : bars}
          <span hidden>${hp}</span>
        </button>`;
    }).join('');
    const diffs = (['easy', 'normal', 'hard'] as Difficulty[])
      .map((d) => `<button class="${d === this.diffSel ? 'on' : ''}" data-act="diff" data-id="${d}">${t(`diff.${d}`)}</button>`)
      .join('');
    s.innerHTML = `
      <div class="eyebrow">${t('selectShip')}</div>
      <div class="ships">${cards}</div>
      <div class="eyebrow" style="margin-top:6px">${t('difficulty')}</div>
      <div class="seg" role="group">${diffs}</div>
      <div class="hint">${t(`diffd.${this.diffSel}`)}</div>
      <div class="row">
        <button class="btn ghost" data-act="back">${t('back')}</button>
        <button class="btn primary" data-act="launch" data-autofocus>${t('launch')}</button>
      </div>`;
    this.bind(s);
  }

  /* ------------------------------------------------------------ */
  /* upgrades                                                      */
  /* ------------------------------------------------------------ */

  showUpgrades(w: World): void {
    const s = this.screen('upgrade');
    const d = w.director;
    const p = w.player;
    const cards = d.offers
      .map((id, i) => {
        const def = UPGRADE_MAP[id];
        const lv = p.level(id);
        const desc = describe(id, p.levels, SHIPS[p.ship], w.diff);
        const max = Math.min(def.max, 6);
        let pips = '';
        if (id !== 'repair') {
          for (let k = 0; k < max; k++) pips += `<i class="${k < lv ? 'on' : k === lv ? 'next' : ''}"></i>`;
        }
        return `<button class="card ${def.rarity}" data-act="choose" data-id="${id}" ${i === 0 ? 'data-autofocus' : ''}>
            <span class="key">${i + 1}</span>
            <span class="top"><span class="icon">${iconSvg(id)}</span>
              <span><span class="rarity">${t(`rar.${def.rarity}`)}</span><br/><span class="title">${t(`up.${id}`)}</span></span></span>
            <span class="desc">${t(`upd.${id}`, desc)}</span>
            <span class="pips">${pips}${lv === 0 && id !== 'repair' ? `<span class="new">${t('newTag')}</span>` : ''}</span>
          </button>`;
      })
      .join('');
    s.innerHTML = `
      <div class="eyebrow">${d.offerBoss ? t('upgradeBoss') : `${t('sector')} ${d.sector + 1} · ${t('wave')} ${d.wave + 1}`}</div>
      <h2>${t('upgradeTitle')}</h2>
      <div class="cards">${cards}</div>
      <button class="btn ghost small" data-act="reroll" ${d.rerolls > 0 ? '' : 'disabled'}>${t('reroll', { n: d.rerolls })}</button>`;
    this.bind(s);
    this.show('upgrade');
  }

  /* ------------------------------------------------------------ */
  /* pause / settings / records / help                             */
  /* ------------------------------------------------------------ */

  showPause(w: World): void {
    const s = this.screen('pause');
    const ups = Object.entries(w.player.levels)
      .filter(([, v]) => (v ?? 0) > 0)
      .map(([id]) => `<span title="${t(`up.${id}`)}">${iconSvg(id as UpgradeId)}</span>`)
      .join('');
    s.innerHTML = `
      <div class="eyebrow">${t('sector')} ${w.director.sector + 1} · ${t(`${SECTORS[w.director.sector].key}.name`)}</div>
      <h2>${t('paused')}</h2>
      <div class="upgrade-strip">${ups}</div>
      <div class="menu">
        <button class="btn primary" data-act="resume" data-autofocus>${t('resume')}</button>
        <button class="btn" data-act="settings">${t('settings')}</button>
        <button class="btn" data-act="retire">${t('retire')}</button>
      </div>`;
    this.bind(s);
    this.show('pause');
  }

  private renderSettings(): void {
    const s = this.screen('settings');
    const st = this.save.settings;
    const slider = (key: 'master' | 'music' | 'sfx', label: string): string =>
      `<div class="field"><label for="set-${key}">${label}</label><div class="ctl"><input id="set-${key}" type="range" min="0" max="100" step="5" value="${Math.round(st[key] * 100)}" style="--p:${st[key] * 100}%" data-key="${key}"/><span class="val">${Math.round(st[key] * 100)}</span></div></div>`;
    const toggle = (key: 'shake' | 'reduceFlashing' | 'showFps', label: string): string =>
      `<div class="field"><label>${label}</label><button class="toggle ${st[key] ? 'on' : ''}" id="set-${key}" data-toggle="${key}" aria-pressed="${st[key]}">${st[key] ? t('on') : t('off')}</button></div>`;
    const qs = (['auto', 'high', 'medium', 'low'] as Quality[])
      .map((q) => `<button class="${st.quality === q ? 'on' : ''}" data-quality="${q}">${t(`q.${q}`)}</button>`)
      .join('');
    s.innerHTML = `
      <div class="panel">
        <div class="form">
          <h2>${t('settings')}</h2>
          ${slider('master', t('set.master'))}
          ${slider('music', t('set.music'))}
          ${slider('sfx', t('set.sfx'))}
          <div class="field"><label>${t('set.quality')}</label><div class="seg">${qs}</div></div>
          ${toggle('shake', t('set.shake'))}
          ${toggle('reduceFlashing', t('set.flash'))}
          <div class="field"><label for="set-sens">${t('set.sens')}</label><div class="ctl"><input id="set-sens" type="range" min="60" max="220" step="5" value="${Math.round(st.sensitivity * 100)}" style="--p:${((st.sensitivity - 0.6) / 1.6) * 100}%" data-key="sensitivity"/><span class="val">${st.sensitivity.toFixed(2)}</span></div></div>
          <div class="field"><label>${t('set.lang')}</label><div class="seg"><button class="${getLang() === 'ko' ? 'on' : ''}" data-lang="ko">한국어</button><button class="${getLang() === 'en' ? 'on' : ''}" data-lang="en">English</button></div></div>
          ${toggle('showFps', t('set.fps'))}
          <div class="row"><button class="btn" data-act="back" data-autofocus>${t('back')}</button></div>
        </div>
      </div>`;
    this.bind(s);
    s.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const key = inp.dataset.key as 'master' | 'music' | 'sfx' | 'sensitivity';
        const v = Number(inp.value) / 100;
        st[key] = v;
        const val = inp.parentElement!.querySelector('.val')!;
        val.textContent = key === 'sensitivity' ? v.toFixed(2) : String(Math.round(v * 100));
        const pct = key === 'sensitivity' ? ((v - 0.6) / 1.6) * 100 : v * 100;
        inp.style.setProperty('--p', `${pct}%`);
        this.h.settingsChanged(st);
      });
    });
    s.querySelectorAll<HTMLElement>('[data-toggle]').forEach((b) => {
      b.addEventListener('click', () => {
        const key = b.dataset.toggle as 'shake' | 'reduceFlashing' | 'showFps';
        st[key] = !st[key];
        b.classList.toggle('on', st[key]);
        b.setAttribute('aria-pressed', String(st[key]));
        b.textContent = st[key] ? t('on') : t('off');
        this.fpsEl.hidden = !st.showFps;
        this.h.sound('move');
        this.h.settingsChanged(st);
      });
    });
    s.querySelectorAll<HTMLElement>('[data-quality]').forEach((b) => {
      b.addEventListener('click', () => {
        st.quality = b.dataset.quality as Quality;
        s.querySelectorAll('[data-quality]').forEach((x) => x.classList.toggle('on', x === b));
        this.h.sound('move');
        this.h.settingsChanged(st);
      });
    });
    s.querySelectorAll<HTMLElement>('[data-lang]').forEach((b) => {
      b.addEventListener('click', () => {
        st.lang = b.dataset.lang as 'ko' | 'en';
        this.h.sound('move');
        this.h.settingsChanged(st);
        this.refresh();
        this.show('settings');
      });
    });
  }

  private renderRecords(): void {
    const s = this.screen('records');
    const sv = this.save;
    const hist = sv.history
      .slice(0, 10)
      .map(
        (r: RunRecord) =>
          `<div><span class="meta">${r.date} · ${t(`ship.${r.ship}`)} · ${r.daily ? t('daily') : t(`diff.${r.diff}`)} · ${r.win ? '★' : `S${r.sector + 1}`}</span><span></span><b>${fmt(r.score)}</b></div>`,
      )
      .join('');
    s.innerHTML = `
      <div class="panel">
        <div class="form">
          <h2>${t('records')}</h2>
          <div class="eyebrow">${t('rec.best')}</div>
          <div class="rec-grid">
            ${(['easy', 'normal', 'hard'] as Difficulty[]).map((d) => `<div><span>${t(`diff.${d}`)}</span><b>${fmt(sv.best[d])}</b></div>`).join('')}
          </div>
          <div class="rec-grid">
            <div><span>${t('rec.runs')}</span><b>${fmt(sv.stats.runs)}</b></div>
            <div><span>${t('rec.victories')}</span><b>${fmt(sv.stats.victories)}</b></div>
            <div><span>${t('rec.bosses')}</span><b>${fmt(sv.stats.bossesDefeated)}</b></div>
            <div><span>${t('rec.kills')}</span><b>${fmt(sv.stats.kills)}</b></div>
            <div><span>${t('rec.perfects')}</span><b>${fmt(sv.stats.perfectPulses)}</b></div>
            <div><span>${t('rec.time')}</span><b>${fmtTime(sv.stats.playTime)}</b></div>
          </div>
          <div class="eyebrow">${t('rec.history')}</div>
          <div class="history">${hist || `<p class="hint">${t('rec.empty')}</p>`}</div>
          <div class="row"><button class="btn" data-act="back" data-autofocus>${t('back')}</button></div>
        </div>
      </div>`;
    this.bind(s);
  }

  private renderHelp(): void {
    const s = this.screen('help');
    s.innerHTML = `
      <div class="panel">
        <div class="howto">
          <h2>${t('howto')}</h2>
          <div><h3>${t('howTitleControls')}</h3><ul>
            <li>${t('how.move')}</li><li>${t('how.pulse')}</li><li>${t('how.keys')}</li><li>${t('how.pad')}</li></ul></div>
          <div><h3>${t('howTitleRules')}</h3><ul>
            <li>${t('how.beat')}</li><li>${t('how.hitbox')}</li><li>${t('how.graze')}</li><li>${t('how.perfect')}</li><li>${t('how.chain')}</li></ul></div>
          <div class="row"><button class="btn" data-act="back" data-autofocus>${t('back')}</button></div>
        </div>
      </div>`;
    this.bind(s);
  }

  /* ------------------------------------------------------------ */
  /* results                                                       */
  /* ------------------------------------------------------------ */

  showResults(r: ResultsData): void {
    const s = this.screen('results');
    const rank = rankOf(r);
    const unlocks = r.unlocks.map((id) => `<div class="badge" style="animation:none">${t('unlocked', { name: t(`ship.${id}`) })}</div>`).join('');
    const ups = r.upgrades.map((id) => `<span title="${t(`up.${id}`)}">${iconSvg(id)}</span>`).join('');
    s.innerHTML = `
      <div class="results">
        <div class="eyebrow">${r.daily ? t('daily') : ''}</div>
        <h2>${r.win ? t('victory') : t('gameOver')}</h2>
        ${r.win ? `<p class="story">${t('victoryText')}</p>` : ''}
        <div class="rank">${rank}</div>
        <div class="final-score">0</div>
        ${r.newRecord ? `<div class="badge">${t('newRecord')}</div>` : `<div class="hint">${t('best')} ${fmt(r.best)}</div>`}
        ${unlocks}
        <div class="stats">
          <div><span>${t('res.sector')}</span><b>${r.win ? '★' : r.sector + 1} / 5</b></div>
          <div><span>${t('res.time')}</span><b>${fmtTime(r.time)}</b></div>
          <div><span>${t('res.kills')}</span><b>${fmt(r.kills)}</b></div>
          <div><span>${t('res.grazes')}</span><b>${fmt(r.grazes)}</b></div>
          <div><span>${t('res.perfects')}</span><b>${fmt(r.perfects)}</b></div>
          <div><span>${t('res.maxChain')}</span><b>${fmt(r.maxChain)}</b></div>
        </div>
        <div class="upgrade-strip">${ups}</div>
        <div class="row">
          <button class="btn ghost" data-act="menu">${t('menu')}</button>
          <button class="btn primary" data-act="retry" data-autofocus>${t('retry')}</button>
        </div>
        ${r.win ? `<p class="foot">${t('credits')}</p>` : ''}
      </div>`;
    this.bind(s);
    this.show('results');
    const scoreEl = s.querySelector<HTMLElement>('.final-score')!;
    const t0 = performance.now();
    const dur = 1400;
    const tick = (now: number): void => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      scoreEl.textContent = fmt(r.score * e);
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------ */
  /* HUD                                                           */
  /* ------------------------------------------------------------ */

  private renderHud(): void {
    this.hud.innerHTML = `
      <div class="hud-top">
        <div class="score-box"><span class="score">0</span><span class="mult">×1.00</span></div>
        <div class="hud-right">
          <div class="hp"></div>
          <button class="icon-btn" data-act="pause" aria-label="${t('paused')}">${PAUSE_SVG}</button>
        </div>
      </div>
      <div class="sector-tag"></div>
      <div class="boss-bar"><div class="bname"><span class="bn"></span><span class="bp"></span></div><div class="track"><div class="fill"></div><div class="notches"></div></div></div>
      <div class="hud-bottom">
        <div class="reso"><span class="label">${t('resonance')}</span><div class="meter"><i></i></div></div>
        <button class="pulse-btn interactive" aria-label="${t('pulse')}"><span class="ring"></span><span class="key">SPACE</span><span class="count">1</span><span class="lbl">PULSE</span></button>
      </div>`;
    this.bind(this.hud);
    const pulseBtn = this.hud.querySelector<HTMLElement>('.pulse-btn')!;
    pulseBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.h.pulse();
    });
    const q = <T extends HTMLElement>(sel: string): T => this.hud.querySelector<T>(sel)!;
    this.hudEls = {
      score: q('.score'),
      mult: q('.mult'),
      hp: q('.hp'),
      reso: q('.reso .meter i'),
      pulse: pulseBtn,
      pulseCount: q('.pulse-btn .count'),
      boss: q('.boss-bar'),
      bossFill: q('.boss-bar .fill'),
      bossName: q('.boss-bar .bn'),
      bossPct: q('.boss-bar .bp'),
      bossNotches: q('.boss-bar .notches'),
      sector: q('.sector-tag'),
    };
    const keyHint = pulseBtn.querySelector<HTMLElement>('.key')!;
    keyHint.hidden = matchMedia('(pointer: coarse)').matches;
    this.hudCache = { score: -1, mult: '', hp: -1, maxHp: -1, reso: -1, charges: -1, maxCharges: -1, bossHp: -2, sector: -1, wide: false };
  }

  showHud(on: boolean): void {
    this.hud.classList.toggle('show', on);
  }

  layout(rect: { left: number; top: number; width: number; height: number }, viewW: number): void {
    const r = this.root.style;
    r.setProperty('--field-left', `${rect.left}px`);
    r.setProperty('--field-top', `${Math.max(0, rect.top)}px`);
    r.setProperty('--field-width', `${rect.width}px`);
    r.setProperty('--field-height', `${Math.min(window.innerHeight - Math.max(0, rect.top), rect.height)}px`);
    const wide = rect.left > 250 && viewW > 900;
    if (wide !== this.hudCache.wide) {
      this.hudCache.wide = wide;
      this.hud.classList.toggle('wide', wide);
    }
  }

  updateHud(w: World, beat: boolean): void {
    const c = this.hudCache;
    const E = this.hudEls;
    const p = w.player;
    if (w.score !== c.score) {
      c.score = w.score;
      E.score.textContent = fmt(w.score);
    }
    const m = `×${w.mult.toFixed(2)}`;
    if (m !== c.mult) {
      c.mult = m;
      E.mult.textContent = m;
      E.mult.classList.toggle('hot', w.mult >= 3);
    }
    if (p.hp !== c.hp || p.stats.maxHp !== c.maxHp) {
      c.hp = p.hp;
      c.maxHp = p.stats.maxHp;
      let html = '';
      for (let i = 0; i < c.maxHp; i++) html += `<i class="${i < p.hp ? '' : 'off'}"></i>`;
      E.hp.innerHTML = html;
      E.hp.classList.toggle('danger', p.hp === 1);
    }
    const reso = p.charges >= p.stats.maxCharges ? 100 : Math.floor(p.resonance);
    if (reso !== c.reso) {
      c.reso = reso;
      E.reso.style.width = `${reso}%`;
      E.pulse.style.setProperty('--fill', `${reso}%`);
    }
    if (p.charges !== c.charges || p.stats.maxCharges !== c.maxCharges) {
      c.charges = p.charges;
      c.maxCharges = p.stats.maxCharges;
      E.pulseCount.textContent = String(p.charges);
      E.pulse.classList.toggle('ready', p.charges > 0);
    }
    if (beat && p.charges > 0) {
      E.pulse.classList.remove('beat');
      void E.pulse.offsetWidth;
      E.pulse.classList.add('beat');
    }
    const b = w.boss;
    const bossHp = b ? (b.state === 1 ? Math.max(0, b.hp / b.maxHp) : 2) : -1;
    if (Math.abs(bossHp - c.bossHp) > 0.002) {
      c.bossHp = bossHp;
      E.boss.classList.toggle('show', !!b && b.state === 1);
      if (b) {
        const name = t(`boss.${b.boss}`);
        if (name !== this.bossName) {
          this.bossName = name;
          E.bossName.textContent = name;
          const def = BOSSES[b.boss as BossId];
          E.bossNotches.innerHTML = def.phases
            .slice(0, -1)
            .map((ph) => `<i class="notch" style="left:${ph.until * 100}%"></i>`)
            .join('');
        }
        const frac = Math.min(1, bossHp);
        E.bossFill.style.transform = `scaleX(${frac})`;
        E.bossPct.textContent = `${Math.ceil(frac * 100)}%`;
      } else this.bossName = '';
    }
    if (w.director.sector !== c.sector) {
      c.sector = w.director.sector;
      E.sector.textContent = `${t('sector')} ${c.sector + 1} · ${t(`${SECTORS[c.sector].key}.name`)}`;
    }
    E.sector.style.opacity = b ? '0' : '1';
  }

  setFps(fps: number): void {
    if (!this.fpsEl.hidden) this.fpsEl.textContent = `${Math.round(fps)} fps`;
  }

  /* ------------------------------------------------------------ */
  /* transient messages                                            */
  /* ------------------------------------------------------------ */

  banner(kind: 'sector' | 'wave' | 'warn' | 'clear', big: string, small = '', note = ''): void {
    const b = el('div', `banner${kind === 'warn' ? ' warn' : ''}`);
    b.innerHTML = `${small ? `<div class="small">${small}</div>` : ''}<div class="big">${big}</div>${note ? `<div class="note">${note}</div>` : ''}`;
    b.addEventListener('animationend', (e) => {
      if (e.target === b) b.remove();
    });
    this.banners.append(b);
    while (this.banners.children.length > 3) this.banners.firstElementChild?.remove();
  }

  clearBanners(): void {
    this.banners.innerHTML = '';
  }

  popup(x: number, y: number, text: string, kind: string): void {
    const p = this.popPool[this.popIdx++ % this.popPool.length];
    p.hidden = false;
    p.className = `pop ${kind}`;
    p.textContent = text;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.animation = 'none';
    void p.offsetWidth;
    p.style.animation = '';
  }

  toast(text: string): void {
    const tst = el('div', 'toast', text);
    tst.addEventListener('animationend', () => tst.remove());
    this.root.append(tst);
  }

  resumePrompt(onTap: () => void): void {
    const d = el('div', 'resume-tap', t('tapResume'));
    d.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      d.remove();
      onTap();
    });
    this.root.append(d);
  }

  /* ------------------------------------------------------------ */
  /* keyboard / gamepad navigation                                 */
  /* ------------------------------------------------------------ */

  private onKey(e: KeyboardEvent): void {
    if (!this.active) return;
    if (!this.started && this.active === 'title') {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.triggerFirstTap();
      }
      return;
    }
    if (this.active === 'upgrade' && ['1', '2', '3'].includes(e.key)) {
      const b = this.screen('upgrade').querySelectorAll<HTMLElement>('.card')[Number(e.key) - 1];
      b?.click();
      return;
    }
    if (e.key === 'Escape') {
      if (this.active === 'pause') this.h.resume();
      else if (['settings', 'records', 'help', 'select'].includes(this.active)) this.act('back', document.body);
      return;
    }
    const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key];
    if (dir) {
      const tgt = e.target as HTMLElement;
      if (tgt instanceof HTMLInputElement && (dir === 'left' || dir === 'right')) return;
      e.preventDefault();
      this.nav(dir);
    }
  }

  nav(dir: string): void {
    if (!this.active) return;
    if (dir === 'ok') {
      const a = document.activeElement as HTMLElement | null;
      if (a && this.screen(this.active).contains(a)) a.click();
      else this.triggerFirstTap();
      return;
    }
    if (dir === 'back') {
      if (this.active === 'pause') this.h.resume();
      else if (['settings', 'records', 'help', 'select'].includes(this.active)) this.act('back', document.body);
      return;
    }
    const s = this.screen(this.active);
    const items = Array.from(s.querySelectorAll<HTMLElement>('button:not([disabled]), input')).filter((x) => x.offsetParent !== null);
    if (!items.length) return;
    const cur = items.indexOf(document.activeElement as HTMLElement);
    const step = dir === 'up' || dir === 'left' ? -1 : 1;
    const next = cur < 0 ? 0 : (cur + step + items.length) % items.length;
    items[next].focus();
    this.h.sound('move');
  }
}

export function rankOf(r: { win: boolean; sector: number; hits: number; perfects: number; maxChain: number }): string {
  let pts = r.sector * 18 + (r.win ? 30 : 0) + Math.min(10, r.perfects) + Math.min(12, r.maxChain / 12) - r.hits * 2.5;
  if (r.win && r.hits === 0) return 'S+';
  pts = Math.max(0, pts);
  if (pts >= 100) return 'S';
  if (pts >= 75) return 'A';
  if (pts >= 50) return 'B';
  if (pts >= 25) return 'C';
  return 'D';
}
