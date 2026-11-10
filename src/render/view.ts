/** 3D presentation of the Sim: camera rig, lighting/env, models, effects, post-processing. */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { damp } from '../core/math';
import type { Quality } from '../core/save';
import { STAGES, type EnemyKind } from '../game/content';
import type { Enemy, Sim, SimEvent } from '../game/sim';
import { Billboards, Particles3D, Sh } from './fx';
import { bossModel, enemyModel, partModel, playerShip, type Model } from './models';
import { World3D } from './world';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uAberr: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uSpeed: { value: 0 },
    uDim: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uAberr; uniform float uFlash; uniform vec3 uFlashColor;
    uniform float uSpeed; uniform float uDim; uniform float uAspect; varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      vec2 dir = uv - vec2(0.5, 0.55);
      vec3 col = vec3(0.0);
      // radial speed blur (warp / boost)
      if (uSpeed > 0.01) {
        for (int i = 0; i < 8; i++) col += texture2D(tDiffuse, uv - dir * float(i) * 0.012 * uSpeed).rgb;
        col /= 8.0;
      } else {
        float ca = uAberr * 0.012 + 0.0006;
        col = vec3(texture2D(tDiffuse, uv + dir * ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - dir * ca).b);
      }
      float v = smoothstep(1.05, 0.35, length((uv - 0.5) * vec2(uAspect * 0.75, 1.0)));
      col *= mix(0.62, 1.0, v);
      col = mix(col, uFlashColor, uFlash * 0.35) + uFlashColor * uFlash * 0.2;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l) * 0.5, uDim * 0.6);
      col += (h(uv * 300.0 + fract(uTime) * 17.0) - 0.5) * 0.018;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

interface View {
  m: Model;
  kind: string;
}

const C = (h: string): THREE.Color => new THREE.Color(h);

export class GameView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.3, 6000);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private final: ShaderPass;
  private world3d = new World3D();
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private ship: Model;
  private flame: THREE.Mesh;
  private drones: Model[] = [];
  private views = new Map<number, View>();
  private pool = new Map<string, Model[]>();
  private bb = new Billboards(4000, 30);
  private hud = new Billboards(200, 40, false);
  private parts = new Particles3D(7000);
  private stageIndex = -1;
  private time = 0;
  private shake = 0;
  private flash = 0;
  private flashColor = new THREE.Color();
  private aberr = 0;
  private camPos = new THREE.Vector3(0, 7, 13);
  private camLook = new THREE.Vector3(0, 4, -40);
  private shipPos = new THREE.Vector3();
  private trailL: THREE.Vector3[] = [];
  private trailR: THREE.Vector3[] = [];
  private fireballs: { x: number; y: number; z: number; t: number; dur: number; size: number }[] = [];
  private lights: THREE.PointLight[] = [];
  private lightT: number[] = [];
  private colA = C('#ff4a6a');
  private colB = C('#ffd04a');
  private accent = C('#ffb35c');
  private enemyGlow = '#ff3b2f';
  private boom = C('#ffb050');
  width = 1;
  height = 1;
  pixelRatio = 1;
  quality: Exclude<Quality, 'auto'> = 'high';
  auto = true;
  dim = 0;
  settings = { shake: true, reduceFlashing: false };
  private frameAvg = 1 / 60;
  private frames = 0;
  onQualityChange?: () => void;
  private tmp = new THREE.Vector3();

  constructor(readonly canvas: HTMLCanvasElement, quality: Quality) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.add(this.world3d.group);
    this.scene.fog = new THREE.Fog('#000000', 60, 300);
    this.ship = playerShip('#5ef2ff');
    this.scene.add(this.ship.group);
    const flameMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPow: { value: 1 } },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uTime; uniform float uPow; varying vec3 vP;
        void main(){ float t = clamp(vP.y / -2.4 + 0.5, 0.0, 1.0); float fl = 0.8 + 0.2 * sin(uTime * 60.0 + vP.y * 9.0);
          vec3 c = mix(vec3(1.0), vec3(0.3, 0.8, 1.0), t) * (1.0 - t) * 2.2 * fl * uPow; gl_FragColor = vec4(c, 0.0); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const flameGeo = new THREE.ConeGeometry(0.3, 2.4, 10, 1, true);
    flameGeo.rotateX(Math.PI / 2);
    const fl = new THREE.Group();
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(flameGeo, flameMat);
      f.position.set(s * 1.05, -0.12, 3.6);
      fl.add(f);
    }
    this.flame = fl.children[0] as THREE.Mesh;
    this.ship.group.add(fl);
    for (let i = 0; i < 2; i++) {
      const d = playerShip('#5ef2ff');
      d.group.scale.setScalar(0.45);
      d.group.visible = false;
      this.drones.push(d);
      this.scene.add(d.group);
    }
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight('#ffa060', 0, 40, 2);
      this.lights.push(l);
      this.lightT.push(0);
      this.scene.add(l);
    }
    this.scene.add(this.bb.mesh, this.hud.mesh, this.parts.mesh);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const ext = this.renderer.extensions;
    const hdr = ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float');
    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.65, 0.6, 0.85);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());
    this.setQuality(quality);
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    this.setStage(0);
  }

  setQuality(q: Quality): void {
    this.auto = q === 'auto';
    const mobile = matchMedia('(pointer: coarse)').matches;
    this.apply(q === 'auto' ? (mobile ? 'medium' : 'high') : q);
  }

  private apply(q: Exclude<Quality, 'auto'>): void {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.pixelRatio = q === 'high' ? Math.min(dpr, 2) : q === 'medium' ? Math.min(dpr, 1.4) : Math.min(dpr, 1);
    this.bloom.enabled = q !== 'low';
    this.parts.density = q === 'high' ? 1 : q === 'medium' ? 0.7 : 0.4;
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth || innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || innerHeight);
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    this.bloom.setSize(Math.round(w * this.pixelRatio * 0.5), Math.round(h * this.pixelRatio * 0.5));
    this.camera.aspect = w / h;
    // keep the corridor in view on tall phones
    this.camera.fov = w / h < 0.75 ? 74 : 62;
    this.camera.updateProjectionMatrix();
    (this.final.uniforms as typeof FinalShader.uniforms).uAspect.value = w / h;
  }

  setStage(i: number): void {
    if (i === this.stageIndex) return;
    this.stageIndex = i;
    const s = STAGES[i];
    this.world3d.setStage(s);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.set(s.look.fog);
    fog.near = s.look.fogNear;
    fog.far = s.look.fogFar * 1.2;
    this.renderer.toneMappingExposure = s.look.exposure * 1.9;
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.world3d.envScene(), 0.02);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = s.look.night ? 0.6 : 1;
    this.colA.set(s.look.bulletA);
    this.colB.set(s.look.bulletB);
    this.accent.set(s.look.accent);
    this.enemyGlow = s.look.enemyGlow;
    for (const v of this.views.values()) v.m.glowMat.emissive.set(this.enemyGlow);
  }

  /* -------------------------------------------------------------- */

  private model(e: Enemy): Model {
    const key = e.kind === 'boss' || e.kind === 'part' ? `${e.kind}:${e.boss}` : e.kind;
    const list = this.pool.get(key);
    let m = list?.pop();
    if (!m) {
      m = e.kind === 'boss' ? bossModel(e.boss!, this.enemyGlow) : e.kind === 'part' ? partModel(e.boss!, this.enemyGlow) : enemyModel(e.kind as EnemyKind, this.enemyGlow);
      this.scene.add(m.group);
    }
    m.glowMat.emissive.set(this.enemyGlow);
    m.group.visible = true;
    return m;
  }

  private release(id: number, v: View): void {
    v.m.group.visible = false;
    this.views.delete(id);
    let list = this.pool.get(v.kind);
    if (!list) this.pool.set(v.kind, (list = []));
    list.push(v.m);
  }

  private light(x: number, y: number, z: number, color: THREE.Color, power: number): void {
    let k = 0;
    for (let i = 1; i < this.lights.length; i++) if (this.lightT[i] < this.lightT[k]) k = i;
    const l = this.lights[k];
    l.position.set(x, y, z);
    l.color.copy(color);
    l.intensity = power;
    this.lightT[k] = 0.35;
  }

  handle(e: SimEvent, sim: Sim | null): void {
    const P = this.parts;
    switch (e.t) {
      case 'hit':
        P.burst(e.x, e.y, e.z, e.big ? 10 : 3, e.big ? 18 : 10, e.big ? this.boom : C('#ffe2b0'), { life: 0.35, size: 0.25, drag: 5, vz: 20 });
        break;
      case 'kill': {
        const s = Math.max(0.6, e.size);
        this.fireballs.push({ x: e.x, y: e.y, z: e.z, t: 0, dur: 0.6 + s * 0.15, size: 2.2 + s * 1.8 });
        P.burst(e.x, e.y, e.z, 30 + s * 20, 14 + s * 6, this.boom, { life: 0.9, size: 0.35, drag: 2, vz: 25 });
        P.burst(e.x, e.y, e.z, 10 + s * 6, 6, C('#3a3a3a'), { kind: 2, life: 1.6, size: 1.6 + s, drag: 1, vz: 30 });
        P.burst(e.x, e.y, e.z, 6 + s * 4, 18, C('#ffffff'), { kind: 0, life: 0.5, size: 0.4, drag: 1, grav: 18, vz: 20 });
        this.light(e.x, e.y + 1, e.z, this.boom, 30 + s * 30);
        if (e.size >= 2) this.shakeAdd(0.3 * e.size);
        break;
      }
      case 'boom':
        this.fireballs.push({ x: e.x, y: e.y, z: e.z, t: 0, dur: 0.45, size: 1.8 + e.size });
        P.burst(e.x, e.y, e.z, 14, 12, this.boom, { life: 0.6, size: 0.3, vz: 20 });
        break;
      case 'playerHit':
        if (sim) P.burst(sim.player.x, sim.player.y, 0, 50, 16, C('#ff4050'), { life: 0.8, size: 0.3 });
        this.aberr = 1;
        break;
      case 'playerDie':
        if (sim) {
          const p = sim.player;
          this.fireballs.push({ x: p.x, y: p.y, z: 0, t: 0, dur: 1.2, size: 7 });
          P.burst(p.x, p.y, 0, 150, 26, this.boom, { life: 1.4, size: 0.5 });
          this.light(p.x, p.y, 2, this.boom, 120);
        }
        this.shakeAdd(2.5);
        break;
      case 'graze':
        P.burst(e.x, e.y, 0.5, 3, 6, C('#ffffff'), { life: 0.25, size: 0.15, drag: 6 });
        break;
      case 'missiles':
        if (sim) P.burst(sim.player.x, sim.player.y, 0, 20, 8, C('#ffffff'), { kind: 2, life: 0.8, size: 1.2, vz: 10 });
        if (e.perfect) this.flashAdd('#ffffff', 0.3);
        break;
      case 'roll':
        break;
      case 'nova':
        if (sim) P.burst(sim.player.x, sim.player.y, 0, 80, 26, this.accent, { life: 0.6, size: 0.3 });
        break;
      case 'shake':
        this.shakeAdd(e.amount);
        break;
      case 'flash':
        this.flashAdd(e.color, e.amount);
        break;
      case 'bossDefeated':
        for (let k = 0; k < 8; k++) {
          setTimeout(() => {
            const x = e.x + (Math.random() - 0.5) * 14;
            const y = e.y + (Math.random() - 0.5) * 8;
            this.fireballs.push({ x, y, z: e.z + Math.random() * 6, t: 0, dur: 0.9, size: 7 });
            P.burst(x, y, e.z, 60, 24, this.boom, { life: 1.2, size: 0.5 });
            this.light(x, y, e.z + 8, this.boom, 140);
            this.shakeAdd(0.7);
          }, k * 160);
        }
        break;
      default:
        break;
    }
  }

  private shakeAdd(a: number): void {
    this.shake = Math.min(3, this.shake + a);
  }

  private flashAdd(color: string, a: number): void {
    this.flashColor.set(color);
    this.flash = Math.max(this.flash, a * (this.settings.reduceFlashing ? 0.25 : 1));
  }

  /** Screen position (CSS px) of a world point; null when behind the camera. */
  project(x: number, y: number, z: number): { x: number; y: number } | null {
    this.tmp.set(x, y, z).project(this.camera);
    if (this.tmp.z > 1) return null;
    return { x: (this.tmp.x * 0.5 + 0.5) * this.width, y: (-this.tmp.y * 0.5 + 0.5) * this.height };
  }

  /** World units per CSS pixel at the ship plane, for drag steering. */
  get unitsPerPixel(): number {
    const d = this.camPos.z;
    return (2 * d * Math.tan((this.camera.fov * Math.PI) / 360)) / this.height;
  }

  /* -------------------------------------------------------------- */

  render(sim: Sim | null, dt: number, beat: number): void {
    this.time += dt;
    const simTime = sim ? sim.time : this.time;
    this.parts.update(simTime);
    this.bb.begin();
    this.hud.begin();
    const scroll = sim ? sim.scroll : this.time * 30;

    // ship pose
    const p = sim?.player;
    const px = p ? p.x : Math.sin(this.time * 0.5) * 3;
    const py = p ? p.y : 4 + Math.sin(this.time * 0.8) * 0.8;
    this.shipPos.set(px, py, 0);
    const bank = p ? p.bank : Math.sin(this.time * 0.5) * 0.3;
    const pitch = p ? p.pitch : 0;
    const rollT = p && p.roll > 0 ? (1 - p.roll / 0.5) * Math.PI * 2 * -p.rollDir : 0;
    const blink = p && p.invuln > 0 && p.roll <= 0 && Math.floor(this.time * 16) % 2 === 0;
    this.ship.group.visible = !p || (p.alive && !blink);
    this.ship.group.position.copy(this.shipPos);
    this.ship.group.rotation.set(pitch * 0.35, -bank * 0.25, bank * 0.9 + rollT, 'YXZ');
    (this.flame.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
    (this.flame.material as THREE.ShaderMaterial).uniforms.uPow.value = 1 + beat * 0.4 + (sim?.phase === 'warp' ? 1 : 0);

    // camera rig
    const warp = sim?.phase === 'warp' ? 1 : 0;
    const tgtCam = this.tmp.set(px * 0.55, py * 0.55 + 3.6, 13.5 - warp * 3);
    this.camPos.lerp(tgtCam, damp(4, dt));
    this.camLook.lerp(new THREE.Vector3(px * 0.75, py * 0.8 + 1.2, -40), damp(5, dt));
    const sh = this.settings.shake ? this.shake : this.shake * 0.2;
    this.camera.position.set(this.camPos.x + (Math.random() - 0.5) * sh * 0.5, this.camPos.y + (Math.random() - 0.5) * sh * 0.5, this.camPos.z);
    this.camera.lookAt(this.camLook);
    this.camera.rotateZ(-bank * 0.12);
    const baseFov = this.camera.aspect < 0.75 ? 74 : 62;
    this.camera.fov += (baseFov + warp * 18 - this.camera.fov) * damp(3, dt);
    this.camera.updateProjectionMatrix();
    this.shake *= Math.exp(-dt * 6);

    this.world3d.update(dt, this.time, scroll, this.shipPos, this.camera);

    // contrails
    this.ship.group.updateMatrixWorld();
    const wl = new THREE.Vector3(-3.75, 0, 1.95).applyMatrix4(this.ship.group.matrixWorld);
    const wr = new THREE.Vector3(3.75, 0, 1.95).applyMatrix4(this.ship.group.matrixWorld);
    for (const [arr, v] of [
      [this.trailL, wl],
      [this.trailR, wr],
    ] as const) {
      for (const q of arr) q.z += 42 * dt * (1 + warp * 3);
      arr.unshift(v.clone());
      if (arr.length > 18) arr.pop();
      if (this.ship.group.visible) {
        for (let i = 0; i < arr.length - 1; i++) {
          const a = arr[i];
          const b = arr[i + 1];
          const al = (1 - i / arr.length) * 0.35;
          this.bb.push((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, Sh.Streak, 0.06, al, 0.8, 0.9, 1, b.x - a.x, b.y - a.y, b.z - a.z, 0.5);
        }
      }
    }
    // engine sparks
    if (this.ship.group.visible && Math.random() < 0.7) {
      const e = new THREE.Vector3((Math.random() < 0.5 ? -1 : 1) * 1.05, -0.12, 3.9).applyMatrix4(this.ship.group.matrixWorld);
      this.parts.emit(e.x, e.y, e.z, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, 30, 2, 0.3, 0.25, 0.05, 0, C('#8fe8ff'), 0);
    }

    if (sim) this.drawSim(sim, dt);
    else {
      for (const [id, v] of this.views) this.release(id, v);
      for (const d of this.drones) d.group.visible = false;
    }

    // fireballs
    for (let i = this.fireballs.length - 1; i >= 0; i--) {
      const f = this.fireballs[i];
      f.t += dt;
      f.z += 30 * dt;
      const k = f.t / f.dur;
      if (k >= 1) {
        this.fireballs.splice(i, 1);
        continue;
      }
      this.bb.push(f.x, f.y, f.z, Sh.Fire, f.size * (0.5 + k * 0.8), 1, 1, 0.55, 0.2, 0, 0, 0, 0, k, f.x);
    }
    for (let i = 0; i < this.lights.length; i++) {
      this.lightT[i] -= dt;
      this.lights[i].intensity *= Math.exp(-dt * 9);
    }

    this.bb.end(this.time);
    this.hud.end(this.time);

    const u = this.final.uniforms as typeof FinalShader.uniforms;
    this.flash *= Math.exp(-dt * 5);
    this.aberr *= Math.exp(-dt * 4);
    u.uTime.value = this.time;
    u.uFlash.value = this.flash + this.world3d.lightningFlash * 0.15;
    u.uFlashColor.value.copy(this.flashColor);
    u.uAberr.value = this.aberr;
    u.uSpeed.value += ((warp ? 1 : 0) - u.uSpeed.value) * damp(2, dt);
    u.uDim.value = this.dim;
    this.bloom.strength = 0.6 + beat * 0.12;
    this.composer.render(dt);
    this.track(dt, !!sim);
  }

  private drawSim(sim: Sim, dt: number): void {
    const p = sim.player;
    // drones
    this.drones.forEach((d, i) => {
      d.group.visible = p.alive && p.stats.drones > 0;
      const s = i === 0 ? -1 : 1;
      d.group.position.set(p.x + s * 4.2, p.y + 1.2, 0.5);
      d.group.rotation.set(0, 0, p.bank * 0.6 + Math.sin(this.time * 3 + i) * 0.1);
    });

    // enemies
    const seen = new Set<number>();
    for (const e of sim.enemies) {
      if (!e.alive) continue;
      seen.add(e.id);
      let v = this.views.get(e.id);
      if (!v) {
        v = { m: this.model(e), kind: e.kind === 'boss' || e.kind === 'part' ? `${e.kind}:${e.boss}` : e.kind };
        this.views.set(e.id, v);
      }
      const g = v.m.group;
      g.position.set(e.x, e.y, e.z);
      const sc = e.u2 ? 1.2 : 1;
      g.scale.setScalar(sc);
      switch (e.kind) {
        case 'wasp':
          g.rotation.set(0, 0, e.t * 6);
          break;
        case 'mine':
          g.rotation.set(e.t * 1.5, e.t * 2, 0);
          break;
        case 'lantern':
          g.rotation.set(0, e.t * 0.6, 0);
          for (const s of v.m.spin) s.rotation.set(e.t * 1.5, e.t * 2.1, 0);
          break;
        case 'boss':
          g.rotation.set(0, Math.sin(e.t * 0.3) * 0.15, e.boss === 'maelstrom' ? e.t * 0.3 : Math.sin(e.t * 0.5) * 0.08);
          break;
        case 'part':
          g.rotation.set(0, 0, e.boss === 'warden' ? e.t * 2 : 0);
          break;
        case 'turret':
          g.rotation.set(0, Math.atan2(p.x - e.x, -e.z) * 0.6, 0);
          break;
        default:
          g.rotation.set(0, 0, e.roll * 0.8);
      }
      const pulse = e.kind === 'lantern' || e.kind === 'boss' ? 0.5 + 0.5 * Math.sin(e.t * 5) : 0;
      v.m.glowMat.emissiveIntensity = v.m.baseGlow * (1 + pulse) + (e.flash > 0 ? 8 : 0);
      v.m.glowMat.emissive.set(e.flash > 0 ? '#ffffff' : this.enemyGlow);
      if (e.kind === 'boss' && e.invuln > 50) v.m.glowMat.emissiveIntensity *= 0.4;
    }
    for (const [id, v] of this.views) if (!seen.has(id)) this.release(id, v);

    // player shots
    const s = sim.shots;
    for (let i = 0; i < s.count; i++) {
      const drone = s.c[i] === 1;
      this.bb.push(s.x[i], s.y[i], s.z[i], Sh.Streak, 0.22, 1, drone ? 0.6 : 0.4, drone ? 1 : 0.9, 1, s.vx[i], s.vy[i], s.vz[i], 0.03);
    }
    // missiles
    for (const m of sim.missiles) {
      this.bb.push(m.x, m.y, m.z, Sh.Orb, 0.45, 1, 1, 0.8, 0.5);
      this.parts.emit(m.x, m.y, m.z, 0, 0, 0, 1, 0.7, 0.5, 1.4, -1, C('#9a9a9a'), 2);
      this.parts.emit(m.x, m.y, m.z, -m.vx * 0.05, -m.vy * 0.05, -m.vz * 0.05, 3, 0.15, 0.4, 0.1, 0, C('#ffb060'), 0);
    }
    // enemy bullets + impact markers
    const b = sim.eb;
    for (let i = 0; i < b.count; i++) {
      const col = b.c[i] === 0 ? this.colA : this.colB;
      const r = b.r[i];
      this.bb.push(b.x[i], b.y[i], b.z[i], Sh.Orb, r * 1.9, 1, col.r, col.g, col.b, b.vx[i], b.vy[i], b.vz[i], 0.012);
      const z = b.z[i];
      if (z < 0 && z > -38 && b.vz[i] > 1) {
        const t = -z / b.vz[i];
        const mx = b.x[i] + b.vx[i] * t;
        const my = b.y[i] + b.vy[i] * t;
        const near = Math.hypot(mx - p.x, my - p.y);
        if (near < 7) {
          const a = (1 - -z / 38) * (1 - near / 7) * 0.9;
          this.hud.push(mx, my, 0, Sh.Ring, r + 0.5, a, 1, 0.25, 0.3);
        }
      }
    }
    // beams
    for (const bm of sim.beams) {
      const warm = bm.warm > 0;
      const col = warm ? C('#ff6070') : this.colA;
      this.bb.push(bm.x, bm.y, -60, Sh.Beam, warm ? 0.12 : bm.r * 0.8, warm ? 0.5 + 0.5 * Math.sin(this.time * 30) : 1, col.r, col.g, col.b, 0, 0, 1, 140);
    }
    // lock-on brackets + reticle
    if (p.alive) {
      const counts = new Map<number, number>();
      for (const id of p.locks) counts.set(id, (counts.get(id) ?? 0) + 1);
      for (const [id, n] of counts) {
        const e = sim.enemies.find((x) => x.id === id);
        if (!e) continue;
        this.hud.push(e.x, e.y, e.z, Sh.Lock, e.r * 1.6 + n * 0.3, 1, 1, 0.3, 0.25, 0, 0, 0, 0, 0, this.time * 2);
      }
      this.hud.push(p.x, p.y + 0.2, -55, Sh.Cross, 2.2, 0.7, this.accent.r, this.accent.g, this.accent.b);
    }
  }

  private track(dt: number, playing: boolean): void {
    if (!this.auto || !playing) return;
    this.frameAvg += (Math.min(dt, 0.1) - this.frameAvg) * 0.02;
    if (++this.frames > 240 && this.frameAvg > 1 / 40 && this.quality !== 'low') {
      this.frames = 0;
      this.frameAvg = 1 / 60;
      this.apply(this.quality === 'high' ? 'medium' : 'low');
      this.onQualityChange?.();
    }
  }

  clear(): void {
    this.fireballs = [];
    this.shake = 0;
    this.flash = 0;
  }
}
