/**
 * Presentation of the simulation with Three.js. Reads World state every frame, turns game
 * events into particles/shockwaves/screen effects and drives the post-processing stack.
 */
import * as THREE from 'three';
import { damp, hexToRgb } from '../core/math';
import type { Quality } from '../core/save';
import type { Enemy } from '../game/entity';
import type { BossId } from '../game/ids';
import { SECTORS, SHIPS, type Palette } from '../game/sectors';
import { Shape, type GameEvent } from '../game/types';
import { BEAM_WIDTH } from '../game/upgrades';
import { PB_ECHO, PB_MISSILE, PB_NOVA, PB_SPREAD } from '../game/weapons';
import type { World } from '../game/world';
import { Background } from './background';
import { SegmentBatch, SpriteBatch, SpriteShape } from './batches';
import { BossView, EnemyView, Part, setLineViewport, ShipView } from './meshes';
import { Particles, PKind } from './particles';
import { Post } from './post';

const FOV = 45;
const TAN = Math.tan((FOV * Math.PI) / 360);

interface Shock {
  x: number;
  y: number;
  t: number;
  dur: number;
  r0: number;
  r1: number;
  c: THREE.Color;
  w: number;
  a: number;
}

interface Bolt {
  pts: number[];
  t: number;
  dur: number;
  c: THREE.Color;
}

interface Ripple {
  u: number;
  v: number;
  t: number;
  amp: number;
}

export interface FrameInfo {
  /** 0..1, peaks on each beat */
  beat: number;
  /** loudness 0..1 */
  level: number;
}

const C = (hex: string): THREE.Color => new THREE.Color(hex);

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private post: Post;
  private bg: Background;
  private eb = new SpriteBatch(3000, 'premul', 1.4, 60);
  private pbatch = new SpriteBatch(1400, 'add', 0.8, 35);
  private picks = new SpriteBatch(800, 'premul', 0.9, 40);
  private glows = new SpriteBatch(300, 'add', -1.5, 5);
  private fx = new SpriteBatch(200, 'add', 1.2, 55);
  private segs = new SegmentBatch(400, 0.7, 38);
  private particles: Particles;
  private ship: ShipView;
  private wings: ShipView[] = [];
  private orbs: Part[] = [];
  private views = new Map<number, EnemyView>();
  private pool = new Map<string, EnemyView[]>();
  private boss: BossView | null = null;
  private bossId: BossId | null = null;
  private shocks: Shock[] = [];
  private bolts: Bolt[] = [];
  private ripples: Ripple[] = [];
  private curtains: THREE.Mesh[] = [];
  private shake = 0;
  private flash = 0;
  private flashColor = new THREE.Color(1, 1, 1);
  private aberration = 0;
  private glitch = 0;
  private palette: Palette = SECTORS[0].palette;
  private pal = {
    bullet: [C('#ff3d7f'), C('#ffb13b'), C('#c07bff'), C('#ffffff')],
    enemy: [C('#ff4fa3'), C('#ffb347')],
    accent: C('#5ef2ff'),
    ship: C('#5ef2ff'),
  };
  private shipColor = '#5ef2ff';
  camDist = 120;
  width = 1;
  height = 1;
  pixelRatio = 1;
  quality: Exclude<Quality, 'auto'> = 'high';
  autoQuality = true;
  private frameAvg = 1 / 60;
  private frameCount = 0;
  onQualityChange?: (q: Exclude<Quality, 'auto'>) => void;
  settings = { shake: true, reduceFlashing: false };
  private time = 0;
  private warp = 0;
  dim = 0;
  private tmpV = new THREE.Vector3();
  private bossFlash = 0;
  private attractT = 0;

  constructor(readonly canvas: HTMLCanvasElement, quality: Quality) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 1, 2000);
    this.camera.position.set(0, 0, 120);
    this.bg = new Background(this.palette, 120);
    this.scene.add(this.bg.group);
    this.particles = new Particles(6000);
    for (const b of [this.glows, this.pbatch, this.picks, this.segs, this.eb, this.fx]) this.scene.add(b.mesh);
    this.scene.add(this.particles.mesh);
    this.ship = new ShipView(this.shipColor);
    this.ship.obj.renderOrder = 45;
    this.scene.add(this.ship.obj);
    for (let i = 0; i < 2; i++) {
      const w = new ShipView(this.shipColor, 0.5);
      w.obj.visible = false;
      this.wings.push(w);
      this.scene.add(w.obj);
    }
    const curtainMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, depthTest: false });
    for (const s of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), curtainMat);
      m.position.set(s * (28 + 200), 0, 2);
      m.renderOrder = 58;
      this.curtains.push(m);
      this.scene.add(m);
    }
    this.post = new Post(this.renderer, this.scene, this.camera);
    this.setQuality(quality);
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    this.resize();
  }

  /* ---------------------------------------------------------------- */
  /* configuration                                                     */
  /* ---------------------------------------------------------------- */

  setQuality(q: Quality): void {
    this.autoQuality = q === 'auto';
    let eff: Exclude<Quality, 'auto'>;
    if (q === 'auto') {
      const mobile = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700;
      eff = mobile ? 'medium' : 'high';
    } else eff = q;
    this.applyQuality(eff);
  }

  private applyQuality(q: Exclude<Quality, 'auto'>): void {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.pixelRatio = q === 'high' ? Math.min(dpr, 2) : q === 'medium' ? Math.min(dpr, 1.5) : 1;
    this.post.bloom.enabled = q !== 'low';
    this.post.bloomScale = q === 'high' ? 0.5 : 0.35;
    this.particles.density = q === 'high' ? 1 : q === 'medium' ? 0.7 : 0.4;
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h, this.pixelRatio);
    const aspect = w / h;
    const fitH = Math.max(106, 60 / aspect);
    this.camDist = fitH / (2 * TAN);
    this.camera.aspect = aspect;
    this.camera.position.z = this.camDist;
    this.camera.far = this.camDist + 1200;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    const db = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    setLineViewport(db.x, db.y, db.y / fitH);
    const visibleW = fitH * aspect;
    void visibleW;
  }

  setShip(id: string): void {
    this.shipColor = SHIPS[id as keyof typeof SHIPS].color;
    this.pal.ship.set(this.shipColor);
    this.ship.setColor(this.pal.ship);
    for (const w of this.wings) w.setColor(this.pal.ship);
  }

  setSector(i: number, instant = false): void {
    const s = SECTORS[i];
    this.palette = s.palette;
    this.bg.setSector(s, this.camDist, instant);
    const p = s.palette;
    this.pal.bullet[0].set(p.bulletA);
    this.pal.bullet[1].set(p.bulletB);
    this.pal.bullet[2].set(p.bulletC);
    this.pal.enemy[0].set(p.enemyA);
    this.pal.enemy[1].set(p.enemyB);
    this.pal.accent.set(p.accent);
  }

  /** CSS-pixel position of a world point. */
  worldToScreen(x: number, y: number): { x: number; y: number } {
    this.camera.updateMatrixWorld();
    this.tmpV.set(x, y, 0).project(this.camera);
    return { x: (this.tmpV.x * 0.5 + 0.5) * this.width, y: (-this.tmpV.y * 0.5 + 0.5) * this.height };
  }

  /** Screen rectangle of the playfield in CSS pixels. */
  fieldRect(): { left: number; top: number; width: number; height: number } {
    const a = this.worldToScreen(-28, 50);
    const b = this.worldToScreen(28, -50);
    return { left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y };
  }

  /** World units per CSS pixel at the playfield plane (for touch dragging). */
  get unitsPerPixel(): number {
    return (2 * this.camDist * TAN) / this.height;
  }

  /* ---------------------------------------------------------------- */
  /* events                                                            */
  /* ---------------------------------------------------------------- */

  private shock(x: number, y: number, r0: number, r1: number, dur: number, c: THREE.Color, w = 0.12, a = 1): void {
    if (this.shocks.length > 60) this.shocks.shift();
    this.shocks.push({ x, y, t: 0, dur, r0, r1, c: c.clone(), w, a });
  }

  private ripple(x: number, y: number, amp: number): void {
    if (this.settings.reduceFlashing) amp *= 0.4;
    this.tmpV.set(x, y, 0).project(this.camera);
    if (this.ripples.length >= 4) this.ripples.shift();
    this.ripples.push({ u: this.tmpV.x * 0.5 + 0.5, v: this.tmpV.y * 0.5 + 0.5, t: 0, amp });
  }

  private addShake(a: number): void {
    this.shake = Math.min(3, this.shake + a);
  }

  private addFlash(color: string, a: number): void {
    const k = this.settings.reduceFlashing ? 0.2 : 1;
    this.flashColor.set(color);
    this.flash = Math.min(1, Math.max(this.flash, a * k));
  }

  handle(e: GameEvent, world: World | null): void {
    const P = this.particles;
    switch (e.t) {
      case 'hit': {
        const c = e.crit ? C('#fff3a0') : this.pal.enemy[e.c] ?? this.pal.accent;
        P.burst(e.x, e.y, e.crit ? 6 : 3, 10, 30, c, { life: 0.25, size: 0.5, drag: 6, spread: 2.4, dir: -Math.PI / 2 });
        break;
      }
      case 'kill': {
        const c = this.pal.enemy[e.c] ?? this.pal.accent;
        const n = [14, 22, 34, 56][Math.min(3, e.size)];
        const sp = [22, 28, 34, 42][Math.min(3, e.size)];
        P.burst(e.x, e.y, n, sp * 0.3, sp, c, { life: 0.7, size: 0.8 + e.size * 0.2, drag: 3.2 });
        P.burst(e.x, e.y, n * 0.5, 4, sp * 0.5, C('#ffffff'), { kind: PKind.Dot, life: 0.35, size: 1.4 + e.size * 0.5, drag: 5 });
        P.burst(e.x, e.y, 4 + e.size * 3, 6, 18, c, { kind: PKind.Square, life: 1.1, size: 0.6 + e.size * 0.15, drag: 1.5 });
        this.shock(e.x, e.y, 0.5, 5 + e.size * 3.5, 0.35 + e.size * 0.06, c, 0.1);
        if (e.elite) this.shock(e.x, e.y, 1, 12, 0.5, C('#ffd75e'), 0.08);
        break;
      }
      case 'playerHit':
        P.burst(e.x, e.y, 40, 10, 50, C('#ff4060'), { life: 0.8, size: 1 });
        this.shock(e.x, e.y, 1, 16, 0.5, C('#ff4060'), 0.14);
        this.aberration = 1;
        this.glitch = this.settings.reduceFlashing ? 0 : 1;
        break;
      case 'playerDie':
        P.burst(e.x, e.y, 120, 10, 70, this.pal.ship, { life: 1.4, size: 1.2, drag: 2 });
        P.burst(e.x, e.y, 60, 5, 40, C('#ffffff'), { kind: PKind.Dot, life: 0.8, size: 2, drag: 3 });
        this.shock(e.x, e.y, 1, 40, 1.2, this.pal.ship, 0.1);
        this.ripple(e.x, e.y, 1.5);
        this.addShake(2.5);
        this.aberration = 1.5;
        break;
      case 'revive':
        this.shock(e.x, e.y, 1, 60, 1, C('#ffe08a'), 0.1);
        P.burst(e.x, e.y, 80, 20, 60, C('#ffe08a'), { life: 1, size: 1 });
        this.addFlash('#ffe08a', 0.6);
        break;
      case 'graze':
        P.burst(e.x, e.y, 2, 6, 16, C('#ffffff'), { life: 0.22, size: 0.45, drag: 6 });
        break;
      case 'pickup':
        if (e.kind === 'heart') {
          this.shock(e.x, e.y, 0.5, 6, 0.4, C('#ff5d8f'), 0.15);
          P.burst(e.x, e.y, 16, 6, 20, C('#ff5d8f'), { kind: PKind.Dot, life: 0.5, size: 0.9 });
        } else P.burst(e.x, e.y, 1, 2, 6, C('#ffe08a'), { kind: PKind.Dot, life: 0.25, size: 0.7 });
        break;
      case 'pulse': {
        const c = e.perfect ? C('#ffffff') : this.pal.accent;
        this.shock(e.x, e.y, 1, e.radius, e.perfect ? 0.6 : 0.5, c, 0.06);
        this.shock(e.x, e.y, 1, e.radius * 0.7, 0.45, this.pal.accent, 0.12, 0.7);
        if (e.perfect) this.shock(e.x, e.y, 1, e.radius * 1.15, 0.75, C('#ffe08a'), 0.03);
        P.burst(e.x, e.y, e.perfect ? 90 : 50, 20, e.perfect ? 90 : 65, c, { life: 0.7, size: 0.9, drag: 2.5 });
        this.ripple(e.x, e.y, e.perfect ? 1.3 : 0.9);
        this.addFlash(e.perfect ? '#ffffff' : this.palette.accent, e.perfect ? 0.45 : 0.25);
        break;
      }
      case 'charge':
        if (world) this.shock(world.player.x, world.player.y, 7, 2, 0.35, this.pal.accent, 0.2);
        break;
      case 'lightning':
        this.bolts.push({ pts: e.pts, t: 0, dur: 0.2, c: C('#bfe6ff') });
        for (let i = 2; i < e.pts.length; i += 2) P.burst(e.pts[i], e.pts[i + 1], 5, 5, 20, C('#bfe6ff'), { life: 0.3, size: 0.5 });
        break;
      case 'sub':
        this.shock(e.x, e.y, 1, e.r, 0.28, this.pal.ship, 0.18, 0.7);
        break;
      case 'nova':
        this.shock(e.x, e.y, 1, 22, 0.45, this.pal.accent, 0.08);
        break;
      case 'bulletBurst': {
        const c = this.pal.bullet[e.c] ?? this.pal.accent;
        P.burst(e.x, e.y, Math.min(8, e.n), 4, 14, c, { kind: PKind.Dot, life: 0.3, size: 0.8 });
        break;
      }
      case 'shake':
        this.addShake(e.amount);
        break;
      case 'flash':
        this.addFlash(e.color, e.amount);
        break;
      case 'ripple':
        this.ripple(e.x, e.y, e.amount);
        break;
      case 'bossStart':
        this.shock(0, 32, 2, 50, 0.9, this.pal.enemy[0], 0.06);
        break;
      case 'bossPhase':
        if (world?.boss) {
          this.shock(world.boss.x, world.boss.y, 2, 45, 0.8, C('#ffffff'), 0.06);
          P.burst(world.boss.x, world.boss.y, 60, 10, 50, this.pal.enemy[0], { life: 1, size: 1 });
        }
        this.bossFlash = 1;
        break;
      case 'bossBlast':
        this.shock(e.x, e.y, 2, 16, 0.4, this.pal.bullet[0], 0.12, 0.8);
        break;
      case 'bossDefeated':
        for (let k = 0; k < 7; k++) {
          setTimeout(() => {
            const x = e.x + (Math.random() - 0.5) * 14;
            const y = e.y + (Math.random() - 0.5) * 10;
            P.burst(x, y, 50, 10, 55, this.pal.enemy[k % 2], { life: 1, size: 1.1 });
            P.burst(x, y, 20, 4, 30, C('#ffffff'), { kind: PKind.Dot, life: 0.5, size: 2.2 });
            this.shock(x, y, 1, 18, 0.5, this.pal.enemy[k % 2], 0.1);
            this.addShake(0.6);
          }, k * 170);
        }
        setTimeout(() => {
          P.burst(e.x, e.y, 220, 15, 95, C('#ffffff'), { life: 1.6, size: 1.3, drag: 1.6 });
          P.burst(e.x, e.y, 80, 5, 40, this.pal.accent, { kind: PKind.Square, life: 2, size: 1, drag: 1 });
          this.shock(e.x, e.y, 2, 90, 1.4, C('#ffffff'), 0.05);
          this.ripple(e.x, e.y, 1.6);
          this.addFlash('#ffffff', 0.9);
          this.addShake(2.5);
        }, 1150);
        break;
      case 'warp':
        break;
      default:
        break;
    }
  }

  /* ---------------------------------------------------------------- */
  /* per-frame                                                         */
  /* ---------------------------------------------------------------- */

  private acquireView(e: Enemy): EnemyView {
    let v = this.views.get(e.id);
    if (v) return v;
    const key = `${e.kind}${e.elite ? '*' : ''}`;
    const list = this.pool.get(key);
    v = list && list.length ? list.pop()! : new EnemyView(e.kind, this.palette.enemyA, e.elite);
    v.obj.visible = true;
    v.obj.renderOrder = 20;
    if (!v.obj.parent) this.scene.add(v.obj);
    this.views.set(e.id, v);
    return v;
  }

  private releaseView(id: number, v: EnemyView): void {
    v.obj.visible = false;
    this.views.delete(id);
    const key = `${v.kind}${v.elite ? '*' : ''}`;
    let list = this.pool.get(key);
    if (!list) this.pool.set(key, (list = []));
    if (list.length < 24) list.push(v);
    else {
      this.scene.remove(v.obj);
      v.dispose();
    }
  }

  private syncBoss(w: World | null): void {
    const b = w?.boss ?? null;
    if (!b) {
      if (this.boss) {
        this.scene.remove(this.boss.obj);
        this.boss.dispose();
        this.boss = null;
        this.bossId = null;
      }
      return;
    }
    if (!this.boss || this.bossId !== b.boss) {
      if (this.boss) {
        this.scene.remove(this.boss.obj);
        this.boss.dispose();
      }
      this.boss = new BossView(b.boss!, this.palette.enemyA, this.palette.enemyB);
      this.bossId = b.boss;
      this.boss.obj.renderOrder = 22;
      this.scene.add(this.boss.obj);
    }
    this.boss.obj.position.set(b.x, b.y, 0);
    const rage = b.phase >= 2 ? 0.5 : 0;
    this.boss.animate(b.t, b.phase, this.pal.enemy[0], this.pal.enemy[1], Math.max(b.flash * 8, this.bossFlash), rage);
    this.glows.push(b.x, b.y, 0, SpriteShape.Glow, b.r * 3.4, b.r * 3.4, 0, 0.55 + this.bossFlash * 0.5, this.pal.enemy[0].r, this.pal.enemy[0].g, this.pal.enemy[0].b);
  }

  render(w: World | null, dt: number, info: FrameInfo): void {
    this.time += dt;
    const simTime = w ? w.time : this.time;
    this.particles.update(simTime);
    this.trackPerformance(dt, !!w);

    // warp factor follows the run phase
    const wantWarp = w && w.director.phase === 'warp' ? 1 : 0;
    this.warp += (wantWarp - this.warp) * damp(wantWarp ? 1.4 : 2.5, dt);
    this.bg.warp = this.warp;
    this.bg.update(dt, this.time, info.beat, this.camera.aspect, 1);

    this.glows.begin();
    this.fx.begin();
    this.segs.begin();
    this.eb.begin();
    this.pbatch.begin();
    this.picks.begin();

    const visibleW = (2 * this.camDist * TAN) * this.camera.aspect;
    for (const c of this.curtains) c.visible = !!w && visibleW > 62;
    if (w) this.drawWorld(w, dt, info);
    else this.drawAttract(dt);

    // shockwaves
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i];
      s.t += dt;
      const k = s.t / s.dur;
      if (k >= 1) {
        this.shocks.splice(i, 1);
        continue;
      }
      const e = 1 - Math.pow(1 - k, 3);
      const r = s.r0 + (s.r1 - s.r0) * e;
      this.fx.push(s.x, s.y, 0, SpriteShape.Shock, r, r, s.w, (1 - k) * s.a, s.c.r, s.c.g, s.c.b);
    }
    // lightning
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      if (b.t >= b.dur) {
        this.bolts.splice(i, 1);
        continue;
      }
      const a = 1 - b.t / b.dur;
      for (let k = 0; k + 3 < b.pts.length; k += 2) {
        const x1 = b.pts[k];
        const y1 = b.pts[k + 1];
        const x2 = b.pts[k + 2];
        const y2 = b.pts[k + 3];
        let px = x1;
        let py = y1;
        const n = 5;
        for (let j = 1; j <= n; j++) {
          const t = j / n;
          const jx = j === n ? 0 : (Math.random() - 0.5) * 2.2;
          const jy = j === n ? 0 : (Math.random() - 0.5) * 2.2;
          const nx = x1 + (x2 - x1) * t + jx;
          const ny = y1 + (y2 - y1) * t + jy;
          this.segs.push(px, py, nx, ny, 0.35, a, 0, b.c.r, b.c.g, b.c.b);
          px = nx;
          py = ny;
        }
      }
    }

    this.glows.end(this.time);
    this.fx.end(this.time);
    this.segs.end(this.time);
    this.eb.end(this.time);
    this.pbatch.end(this.time);
    this.picks.end(this.time);

    // camera shake
    const sh = this.settings.shake ? this.shake : this.shake * 0.15;
    this.camera.position.x = (Math.random() - 0.5) * sh * 1.2;
    this.camera.position.y = (Math.random() - 0.5) * sh * 1.2;
    this.camera.rotation.z = (Math.random() - 0.5) * sh * 0.006;
    this.shake *= Math.exp(-dt * 7);
    if (this.shake < 0.01) this.shake = 0;

    // post uniforms
    const u = this.post.u;
    this.flash *= Math.exp(-dt * 5);
    this.aberration *= Math.exp(-dt * 4);
    this.glitch *= Math.exp(-dt * 6);
    this.bossFlash *= Math.exp(-dt * 4);
    u.uTime.value = this.time;
    u.uFlash.value = this.flash;
    u.uFlashColor.value.copy(this.flashColor);
    u.uAberration.value = this.aberration + this.warp * 0.6;
    u.uGlitch.value = this.glitch;
    u.uDim.value = this.dim;
    for (let i = 0; i < 4; i++) {
      const r = this.ripples[i];
      const v = u.uRipples.value[i];
      if (r) {
        r.t += dt / 0.9;
        v.set(r.u, r.v, Math.min(1, r.t), r.t < 1 ? r.amp : 0);
      } else v.set(0, 0, 0, 0);
    }
    this.ripples = this.ripples.filter((r) => r.t < 1);
    this.post.bloom.strength = this.post.baseStrength * (1 + info.beat * 0.12);
    this.post.render(dt);
  }

  private drawAttract(dt: number): void {
    this.attractT += dt;
    const t = this.attractT;
    this.ship.obj.visible = true;
    this.ship.obj.position.set(Math.sin(t * 0.6) * 3, -this.camDist * TAN + 11 + Math.sin(t * 1.1) * 1.2, 6);
    this.ship.obj.rotation.set(-0.35, Math.sin(t * 0.6) * 0.5, 0);
    this.ship.obj.scale.setScalar(1.9);
    for (const wv of this.wings) wv.obj.visible = false;
    for (const o of this.orbs) o.obj.visible = false;
    for (const [id, v] of this.views) this.releaseView(id, v);
    this.syncBoss(null);
    const p = this.ship.obj.position;
    this.glows.push(p.x, p.y - 4.5, 0, SpriteShape.Glow, 4, 6, 0, 0.8, this.pal.ship.r, this.pal.ship.g, this.pal.ship.b);
    if (Math.random() < 0.9) {
      this.particles.emit(p.x + (Math.random() - 0.5) * 1.2, p.y - 4.4, (Math.random() - 0.5) * 3, -26 - Math.random() * 10, 2, 0, 0.5, 1.4, 0.2, this.pal.ship.r, this.pal.ship.g, this.pal.ship.b, PKind.Ember);
    }
  }

  private drawWorld(w: World, dt: number, info: FrameInfo): void {
    const p = w.player;
    const pal = this.pal;
    this.ship.obj.scale.setScalar(1);
    // player
    const blink = p.invuln > 0 && Math.floor(w.time * 18) % 2 === 0;
    this.ship.obj.visible = p.alive && !blink;
    this.ship.obj.position.set(p.x, p.y, 0);
    this.ship.obj.rotation.set(-0.15, p.bank * 0.75, 0);
    if (p.alive) {
      const engineA = 0.65 + Math.sin(this.time * 40) * 0.15 + info.beat * 0.25;
      this.glows.push(p.x, p.y - 2.2, 0, SpriteShape.Glow, 2.2, 3.4, 0, engineA, pal.ship.r, pal.ship.g, pal.ship.b);
      this.glows.push(p.x, p.y, 0, SpriteShape.Glow, 5, 5, 0, 0.25 + info.beat * 0.2, pal.ship.r, pal.ship.g, pal.ship.b);
      const n = this.quality === 'low' ? 1 : 2;
      for (let k = 0; k < n; k++) {
        this.particles.emit(p.x + (Math.random() - 0.5) * 0.9, p.y - 2, (Math.random() - 0.5) * 4, -22 - Math.random() * 12, 3, 0, 0.32, 0.9, 0.1, pal.ship.r, pal.ship.g, pal.ship.b, PKind.Ember);
      }
      // hitbox + graze ring
      this.fx.push(p.x, p.y, 0, SpriteShape.Hitbox, 1.0, 1.0, 0, 1, pal.ship.r, pal.ship.g, pal.ship.b);
      if (p.focus) this.fx.push(p.x, p.y, 0, SpriteShape.Shock, p.stats.grazeRadius, p.stats.grazeRadius, 0.04, 0.35, pal.ship.r, pal.ship.g, pal.ship.b);
      if (p.invuln > 0) this.fx.push(p.x, p.y, 0, SpriteShape.Shock, 3.6, 3.6, 0.08, 0.5, pal.accent.r, pal.accent.g, pal.accent.b);
    }
    // wingmen
    const wingOn = p.alive && p.stats.wingmen > 0;
    const wpos = [
      [p.wingLX, p.wingLY],
      [p.wingRX, p.wingRY],
    ];
    this.wings.forEach((wv, i) => {
      wv.obj.visible = wingOn && !blink;
      if (!wingOn) return;
      wv.obj.position.set(wpos[i][0], wpos[i][1], 0);
      wv.obj.rotation.set(-0.15, p.bank * 0.6, 0);
      this.glows.push(wpos[i][0], wpos[i][1] - 1.2, 0, SpriteShape.Glow, 1.2, 2, 0, 0.6, pal.ship.r, pal.ship.g, pal.ship.b);
    });
    // orbitals
    const orbN = p.alive ? p.stats.orbitals : 0;
    while (this.orbs.length < orbN) {
      const o = new Part('orb', new THREE.IcosahedronGeometry(0.9, 0), this.shipColor, 0.8);
      o.obj.renderOrder = 44;
      this.orbs.push(o);
      this.scene.add(o.obj);
    }
    this.orbs.forEach((o, i) => {
      o.obj.visible = i < orbN;
      if (i >= orbN) return;
      o.obj.position.set(p.orbX[i], p.orbY[i], 0);
      o.obj.rotation.set(this.time * 3, this.time * 2, 0);
      const ready = p.orbCd[i] <= 0;
      o.setColor(pal.ship, ready ? 0.2 : 0);
      this.glows.push(p.orbX[i], p.orbY[i], 0, SpriteShape.Glow, 2.6, 2.6, 0, ready ? 0.7 : 0.25, pal.ship.r, pal.ship.g, pal.ship.b);
    });

    // enemies
    const seen = new Set<number>();
    for (const e of w.enemies) {
      if (!e.alive || e.kind === 'boss') continue;
      seen.add(e.id);
      const v = this.acquireView(e);
      v.obj.position.set(e.x, e.y, 0);
      const appear = Math.min(1, e.t * 3);
      v.obj.scale.setScalar(0.4 + 0.6 * appear);
      const c = pal.enemy[e.color] ?? pal.enemy[0];
      v.animate(e.t, e.spin, c, e.flash > 0 ? 1 : 0);
      this.glows.push(e.x, e.y, 0, SpriteShape.Glow, e.r * 2.8, e.r * 2.8, 0, 0.42 + (e.flash > 0 ? 0.4 : 0), c.r, c.g, c.b);
      if (e.tele) {
        const ex = e.x + Math.cos(e.aim) * 120;
        const ey = e.y + Math.sin(e.aim) * 120;
        this.segs.push(e.x, e.y, ex, ey, 0.35, 0.8, 2, 1, 0.25, 0.3);
      }
    }
    for (const [id, v] of this.views) if (!seen.has(id)) this.releaseView(id, v);
    this.syncBoss(w);

    // boss lasers
    for (const l of w.lasers) {
      const c = pal.bullet[l.c] ?? pal.bullet[0];
      const ex = l.x + Math.cos(l.ang) * l.len;
      const ey = l.y + Math.sin(l.ang) * l.len;
      if (l.warm > 0) {
        this.segs.push(l.x, l.y, ex, ey, 0.3, 0.55 + 0.45 * Math.sin(this.time * 30), 2, c.r, c.g, c.b);
      } else {
        this.segs.push(l.x, l.y, ex, ey, l.width * 1.3, 1, 1, c.r, c.g, c.b, l.t);
        this.particles.emit(l.x, l.y, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, 3, 0, 0.3, 1.2, 0.2, c.r, c.g, c.b, PKind.Dot);
      }
    }

    // player beam
    if (p.beamT > 0 && p.alive) {
      const a = Math.min(1, p.beamT * 6);
      const wdt = BEAM_WIDTH[p.stats.beam];
      this.segs.push(p.x, p.y + 2, p.x, 60, wdt * 0.9, a, 1, pal.ship.r, pal.ship.g, pal.ship.b, 1);
      this.glows.push(p.x, p.y + 3, 0, SpriteShape.Glow, wdt * 1.8, wdt * 1.8, 0, a, 1, 1, 1);
    }

    // enemy bullets
    const eb = w.eb;
    const frozenCol = C('#e6dcff');
    for (let i = 0; i < eb.count; i++) {
      const sh = eb.shape[i];
      const vis = eb.vis[i];
      const frozen = (eb.flags[i] & 2) !== 0 && w.freezeT > 0;
      const c = frozen ? frozenCol : pal.bullet[eb.color[i]] ?? pal.bullet[0];
      const spawnK = Math.min(1, eb.life[i] * 10);
      const s = vis * (0.6 + 0.4 * spawnK);
      if (sh === Shape.Rice || sh === Shape.Shard) {
        const ang = Math.atan2(eb.vy[i], eb.vx[i]) - Math.PI / 2;
        const wR = sh === Shape.Rice ? 0.62 : 0.8;
        const hR = sh === Shape.Rice ? 1.3 : 1.25;
        this.eb.push(eb.x[i], eb.y[i], ang, sh === Shape.Rice ? SpriteShape.Rice : SpriteShape.Shard, s * wR, s * hR, 0, 1, c.r, c.g, c.b);
      } else {
        this.eb.push(eb.x[i], eb.y[i], 0, SpriteShape.Orb, s, s, 0, 1, c.r, c.g, c.b);
      }
    }

    // player bullets
    const pb = w.pb;
    for (let i = 0; i < pb.count; i++) {
      const k = pb.kind[i];
      if (k === PB_MISSILE) {
        const ang = Math.atan2(pb.vy[i], pb.vx[i]) - Math.PI / 2;
        this.pbatch.push(pb.x[i], pb.y[i], ang, SpriteShape.Missile, 0.8, 1.4, 0, 1, 1, 0.75, 0.3);
        if (Math.random() < 0.5) this.particles.emit(pb.x[i], pb.y[i], -pb.vx[i] * 0.05, -pb.vy[i] * 0.05, 4, 0, 0.25, 0.7, 0.1, 1, 0.6, 0.25, PKind.Dot);
      } else {
        const ang = Math.atan2(pb.vy[i], pb.vx[i]) - Math.PI / 2;
        const echo = k === PB_ECHO;
        const nova = k === PB_NOVA;
        const c = nova ? pal.accent : pal.ship;
        const a = echo ? 0.5 : k === PB_SPREAD ? 0.8 : 1;
        this.pbatch.push(pb.x[i], pb.y[i], ang, SpriteShape.Bolt, nova ? 0.7 : 0.55, nova ? 1.6 : 2.3, 0, a, c.r, c.g, c.b);
      }
    }

    // pickups
    const pk = w.pickups;
    for (let i = 0; i < pk.count; i++) {
      const kind = pk.kind[i];
      if (kind === 1) this.picks.push(pk.x[i], pk.y[i], 0, SpriteShape.Heart, 1.7, 1.7, i, 1, 1, 0.36, 0.56);
      else if (kind === 0) this.picks.push(pk.x[i], pk.y[i], pk.life[i] * 2, SpriteShape.Note, 1.15, 1.15, i, 1, 1, 0.82, 0.42);
      else this.picks.push(pk.x[i], pk.y[i], 0, SpriteShape.Note, 0.75, 0.75, i, 0.9, pal.accent.r, pal.accent.g, pal.accent.b);
    }

    // pulse wave
    if (w.pulse) {
      const pu = w.pulse;
      const c = pu.perfect ? C('#ffffff') : pal.accent;
      this.fx.push(pu.x, pu.y, 0, SpriteShape.Shock, pu.r, pu.r, 0.05, 1 - pu.t / pu.dur, c.r, c.g, c.b);
    }

    // field edges pulse with the beat
    const ea = 0.1 + info.beat * 0.22;
    const ac = pal.accent;
    this.segs.push(-28.2, -52, -28.2, 52, 0.18, ea, 0, ac.r, ac.g, ac.b);
    this.segs.push(28.2, -52, 28.2, 52, 0.18, ea, 0, ac.r, ac.g, ac.b);
  }

  private trackPerformance(dt: number, playing: boolean): void {
    if (!this.autoQuality || !playing) return;
    this.frameAvg += (Math.min(dt, 0.1) - this.frameAvg) * 0.02;
    this.frameCount++;
    if (this.frameCount > 240 && this.frameAvg > 1 / 42 && this.quality !== 'low') {
      this.frameCount = 0;
      this.frameAvg = 1 / 60;
      this.applyQuality(this.quality === 'high' ? 'medium' : 'low');
      this.onQualityChange?.(this.quality);
    }
  }

  clearEffects(): void {
    this.shocks = [];
    this.bolts = [];
    this.ripples = [];
    this.particles.clear();
    this.shake = 0;
    this.flash = 0;
  }

  /** Used by UI colour accents. */
  get accentRgb(): [number, number, number] {
    return hexToRgb(this.palette.accent);
  }
}
