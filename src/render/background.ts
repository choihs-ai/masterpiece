/**
 * Layered space backdrop: a full-screen sky shader (gradient, nebula, a signature celestial
 * feature per sector), parallax starfield with warp streaks, a beat-reactive grid and
 * drifting wireframe scenery.
 */
import * as THREE from 'three';
import { RNG } from '../core/rng';
import type { Palette, SectorDef } from '../game/sectors';

const SKY_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy * 2.0, 0.9999, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uNebA;
uniform vec3 uNebB;
uniform vec3 uAccent;
uniform sampler2D uNoise;
uniform float uTime;
uniform float uBeat;
uniform float uAspect;
uniform float uScroll;
uniform float uModeA;
uniform float uModeB;
uniform float uModeMix;
uniform float uWarp;
varying vec2 vUv;

vec3 feature(float mode, vec2 uv, vec2 p) {
  int m = int(mode + 0.5);
  float t = uTime;
  if (m == 0) {
    // aurora curtains
    float band = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float x = p.x * (1.4 + fi * 0.5) + t * (0.07 + fi * 0.03) + fi * 2.1;
      float y = uv.y - 0.62 - 0.08 * sin(x * 2.3 + t * 0.2) - fi * 0.07;
      band += exp(-y * y * 90.0) * (0.55 + 0.45 * sin(x * 9.0 + t * 0.7 + fi));
    }
    return mix(uNebA, uNebB, 0.5 + 0.5 * sin(p.x * 1.3 + t * 0.1)) * band * 0.35;
  } else if (m == 1) {
    // caustic light from the surface
    vec2 q = p * 6.0;
    float c = sin(q.x + sin(q.y * 1.3 + t * 0.6) * 1.4) * sin(q.y * 1.1 - t * 0.4 + sin(q.x * 0.8 + t * 0.3));
    c = pow(abs(c), 6.0);
    return uNebA * c * 0.35 * smoothstep(0.0, 1.0, uv.y);
  } else if (m == 2) {
    // cathedral light shafts
    float ang = atan(p.x, 1.35 - uv.y);
    float rays = pow(abs(sin(ang * 11.0 + t * 0.12)), 10.0) + pow(abs(sin(ang * 7.0 - t * 0.08)), 14.0) * 0.6;
    return mix(uNebA, uNebB, 0.5) * rays * 0.22 * smoothstep(0.15, 1.0, uv.y);
  } else if (m == 3) {
    // the red giant
    vec2 c = vec2(0.32 * uAspect, 1.02);
    float d = length(p - c);
    float n = texture2D(uNoise, (p - c) * 1.6 + vec2(t * 0.01, 0.0)).r;
    float disc = smoothstep(0.43, 0.415, d);
    vec3 surf = mix(uNebB, vec3(1.0, 0.75, 0.4), n * 0.8) * (0.55 + 0.45 * n);
    float corona = exp(-max(d - 0.42, 0.0) * 5.0) * 0.55;
    return surf * disc * 0.65 + uNebA * corona * (1.0 - disc);
  } else {
    // event horizon
    vec2 c = vec2(0.0, 0.86);
    vec2 q = p - c;
    float d = length(q * vec2(1.0, 1.0));
    float disk = length(vec2(q.x, q.y * 4.2));
    float ang = atan(q.y * 4.2, q.x);
    float swirl = texture2D(uNoise, vec2(ang * 0.25 + t * 0.03, disk * 0.6)).r;
    float ring = exp(-pow((disk - 0.33) * 5.5, 2.0)) * (0.5 + swirl);
    float photon = exp(-pow((d - 0.13) * 42.0, 2.0));
    vec3 col = mix(uNebB, uNebA, smoothstep(0.2, 0.6, disk)) * ring * 0.6 + vec3(1.0, 0.9, 0.7) * photon * 0.9;
    return col;
  }
}

void main() {
  vec2 uv = vUv;
  vec2 p = vec2((uv.x - 0.5) * uAspect, uv.y);
  vec3 col = mix(uBottom, uTop, smoothstep(-0.1, 1.1, uv.y));
  vec4 n1 = texture2D(uNoise, p * 0.75 + vec2(0.0, uScroll * 0.012));
  vec4 n2 = texture2D(uNoise, p * 1.55 + vec2(0.37, uScroll * 0.03) + n1.xy * 0.18);
  float neb = smoothstep(0.45, 1.05, n1.r * 0.62 + n2.g * 0.58);
  vec3 nebCol = mix(uNebA, uNebB, smoothstep(0.3, 0.75, n2.b));
  col += nebCol * neb * (0.075 + 0.025 * uBeat);
  vec3 f = mix(feature(uModeA, uv, p), feature(uModeB, uv, p), uModeMix);
  col += f * 0.45;
  if (uModeA > 3.5 || uModeB > 3.5) {
    // the black hole swallows light behind it
    float w = uModeA > 3.5 ? 1.0 - uModeMix : uModeMix;
    float d = length(p - vec2(0.0, 0.86));
    col *= mix(1.0, smoothstep(0.1, 0.135, d), w);
  }
  float vig = smoothstep(1.25, 0.35, length((uv - 0.5) * vec2(uAspect * 0.7, 1.0)));
  col *= mix(0.35, 1.0, vig);
  col += uAccent * uWarp * 0.08;
  gl_FragColor = vec4(col, 1.0);
}
`;

const STAR_VERT = /* glsl */ `
attribute vec4 aA; // x, y0, z, size
attribute vec4 aB; // span, speed, phase, tint
uniform float uScroll;
uniform float uWarp;
uniform float uTime;
varying vec2 vUv;
varying float vTw;
varying float vTint;
void main() {
  float span = aB.x;
  float y = mod(aA.y - uScroll * aB.y + span * 0.5, span) - span * 0.5;
  float stretch = 1.0 + uWarp * 26.0 * aB.y;
  vec2 c = position.xy * vec2(aA.w, aA.w * stretch);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(aA.x + c.x, y + c.y + uWarp * aA.w * stretch * 0.4, aA.z, 1.0);
  vUv = position.xy * 2.0;
  vTw = 0.65 + 0.35 * sin(uTime * (1.5 + aB.z) + aB.z * 10.0);
  vTint = aB.w;
}
`;

const STAR_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uAccent;
varying vec2 vUv;
varying float vTw;
varying float vTint;
void main() {
  float d = length(vUv);
  float a = exp(-d * d * 5.0);
  vec3 c = mix(uColor, uAccent, vTint);
  gl_FragColor = vec4(c * a * vTw * 0.9, 1.0);
}
`;

const GRID_VERT = /* glsl */ `
varying vec2 vPos;
void main() {
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GRID_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uScroll;
uniform float uBeat;
uniform float uMode;
uniform float uFade;
uniform float uTime;
varying vec2 vPos;
float gridLine(vec2 g) {
  vec2 f = abs(fract(g - 0.5) - 0.5) / max(fwidth(g), vec2(1e-4));
  return 1.0 - min(min(f.x, f.y), 1.0);
}
void main() {
  int m = int(uMode + 0.5);
  vec2 pos = vPos;
  float line;
  if (m == 4) {
    vec2 c = vec2(0.0, 120.0);
    vec2 q = pos - c;
    float r = length(q);
    float a = atan(q.y, q.x);
    vec2 g = vec2(r / 14.0 - uScroll * 0.08, a * 6.0 / 3.14159);
    line = gridLine(g);
  } else {
    if (m == 1) pos.x += sin(pos.y * 0.05 + uTime * 0.5) * 6.0;
    vec2 g = pos / 9.0 + vec2(0.0, uScroll * 0.1);
    if (m == 2) {
      vec2 r = vec2(g.x * 0.866 + g.y * 0.5, g.y);
      line = max(gridLine(r), gridLine(vec2(g.x * 0.866 - g.y * 0.5, g.y)));
    } else {
      line = gridLine(g);
    }
  }
  float mask = smoothstep(260.0, 30.0, length(vPos * vec2(0.8, 0.55)));
  float scan = smoothstep(14.0, 0.0, abs(mod(vPos.y + uTime * 26.0, 220.0) - 110.0));
  vec3 col = uColor * line * mask * (0.045 + 0.09 * uBeat + scan * 0.06) * uFade;
  gl_FragColor = vec4(col, 1.0);
}
`;

function makeNoise(size: number, seed: number): THREE.DataTexture {
  const rng = new RNG(seed);
  const data = new Uint8Array(size * size * 4);
  const periods = [4, 8, 16, 32, 64];
  const amps = [0.5, 0.26, 0.13, 0.07, 0.04];
  const fade = (t: number): number => t * t * (3 - 2 * t);
  for (let ch = 0; ch < 3; ch++) {
    const grids = periods.map((p) => {
      const g = new Float32Array(p * p);
      for (let i = 0; i < g.length; i++) g[i] = rng.next();
      return g;
    });
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let v = 0;
        for (let o = 0; o < periods.length; o++) {
          const p = periods[o];
          const fx = (x / size) * p;
          const fy = (y / size) * p;
          const x0 = Math.floor(fx);
          const y0 = Math.floor(fy);
          const tx = fade(fx - x0);
          const ty = fade(fy - y0);
          const g = grids[o];
          const a = g[(y0 % p) * p + (x0 % p)];
          const b = g[(y0 % p) * p + ((x0 + 1) % p)];
          const c = g[((y0 + 1) % p) * p + (x0 % p)];
          const d = g[((y0 + 1) % p) * p + ((x0 + 1) % p)];
          v += amps[o] * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty);
        }
        data[(y * size + x) * 4 + ch] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
    }
  }
  for (let i = 0; i < size * size; i++) data[i * 4 + 3] = 255;
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

interface SceneryItem {
  obj: THREE.LineSegments;
  speed: number;
  spin: THREE.Vector3;
  span: number;
}

const col = (hex: string): THREE.Color => new THREE.Color(hex);

export class Background {
  readonly group = new THREE.Group();
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private starMat: THREE.ShaderMaterial;
  private grid: THREE.Mesh;
  private gridMat: THREE.ShaderMaterial;
  private scenery: SceneryItem[] = [];
  private sceneryGroup = new THREE.Group();
  private sceneryMat: THREE.LineBasicMaterial;
  private from: Palette;
  private to: Palette;
  private mix = 1;
  readonly noise: THREE.DataTexture;
  scroll = 0;
  warp = 0;
  private rng = new RNG(77);
  private sceneryKind = '';

  constructor(palette: Palette, camDist: number) {
    this.from = palette;
    this.to = palette;
    this.noise = makeNoise(256, 11);
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uTop: { value: col(palette.bgTop) },
        uBottom: { value: col(palette.bgBottom) },
        uNebA: { value: col(palette.nebulaA) },
        uNebB: { value: col(palette.nebulaB) },
        uAccent: { value: col(palette.accent) },
        uNoise: { value: this.noise },
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uAspect: { value: 1 },
        uScroll: { value: 0 },
        uModeA: { value: 0 },
        uModeB: { value: 0 },
        uModeMix: { value: 0 },
        uWarp: { value: 0 },
      },
      depthWrite: false,
      depthTest: false,
    });
    this.sky = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -100;
    this.group.add(this.sky);

    // stars in three parallax layers
    const layers = [
      { z: -60, n: 160, size: 0.35, speed: 1 },
      { z: -150, n: 220, size: 0.55, speed: 0.55 },
      { z: -320, n: 320, size: 0.9, speed: 0.25 },
    ];
    const total = layers.reduce((s, l) => s + l.n, 0);
    const A = new Float32Array(total * 4);
    const B = new Float32Array(total * 4);
    let k = 0;
    const tanHalf = Math.tan((45 * Math.PI) / 360);
    for (const l of layers) {
      const dist = camDist - l.z;
      const span = 2 * dist * tanHalf * 1.25;
      const spanX = span * 2.4;
      for (let i = 0; i < l.n; i++) {
        A[k * 4] = (this.rng.next() - 0.5) * spanX;
        A[k * 4 + 1] = (this.rng.next() - 0.5) * span;
        A[k * 4 + 2] = l.z;
        A[k * 4 + 3] = l.size * (0.5 + this.rng.next() * 0.9);
        B[k * 4] = span;
        B[k * 4 + 1] = l.speed * 14;
        B[k * 4 + 2] = this.rng.next();
        B[k * 4 + 3] = this.rng.chance(0.18) ? 0.8 : 0;
        k++;
      }
    }
    const base = new THREE.PlaneGeometry(1, 1);
    const sg = new THREE.InstancedBufferGeometry();
    sg.index = base.index;
    sg.setAttribute('position', base.getAttribute('position'));
    sg.setAttribute('aA', new THREE.InstancedBufferAttribute(A, 4));
    sg.setAttribute('aB', new THREE.InstancedBufferAttribute(B, 4));
    sg.instanceCount = total;
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: {
        uScroll: { value: 0 },
        uWarp: { value: 0 },
        uTime: { value: 0 },
        uColor: { value: col(palette.star) },
        uAccent: { value: col(palette.accent) },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    const stars = new THREE.Mesh(sg, this.starMat);
    stars.frustumCulled = false;
    stars.renderOrder = -90;
    this.group.add(stars);

    this.gridMat = new THREE.ShaderMaterial({
      vertexShader: GRID_VERT,
      fragmentShader: GRID_FRAG,
      uniforms: {
        uColor: { value: col(palette.grid) },
        uScroll: { value: 0 },
        uBeat: { value: 0 },
        uMode: { value: 0 },
        uFade: { value: 1 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.grid = new THREE.Mesh(new THREE.PlaneGeometry(700, 500), this.gridMat);
    this.grid.position.z = -70;
    this.grid.renderOrder = -80;
    this.group.add(this.grid);

    this.sceneryMat = new THREE.LineBasicMaterial({
      color: col(palette.grid),
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.sceneryGroup.renderOrder = -70;
    this.group.add(this.sceneryGroup);
  }

  private buildScenery(kind: SectorDef['scenery'], camDist: number): void {
    if (kind === this.sceneryKind) return;
    this.sceneryKind = kind;
    for (const s of this.scenery) {
      this.sceneryGroup.remove(s.obj);
      s.obj.geometry.dispose();
    }
    this.scenery = [];
    const shapes: (() => THREE.BufferGeometry)[] = [];
    switch (kind) {
      case 'aurora':
        shapes.push(() => new THREE.TorusGeometry(7, 0.4, 3, 6), () => new THREE.OctahedronGeometry(4));
        break;
      case 'tide':
        shapes.push(() => new THREE.IcosahedronGeometry(3.5, 1), () => new THREE.TorusGeometry(6, 0.3, 3, 24));
        break;
      case 'crystal':
        shapes.push(() => new THREE.OctahedronGeometry(3).scale(0.6, 2.4, 0.6), () => new THREE.OctahedronGeometry(2).scale(0.5, 2, 0.5));
        break;
      case 'giant':
        shapes.push(() => new THREE.DodecahedronGeometry(3.6), () => new THREE.IcosahedronGeometry(2.6));
        break;
      default:
        shapes.push(() => new THREE.TetrahedronGeometry(3), () => new THREE.TorusGeometry(9, 0.2, 3, 32));
        break;
    }
    const tanHalf = Math.tan((45 * Math.PI) / 360);
    for (let i = 0; i < 14; i++) {
      const z = -30 - this.rng.next() * 120;
      const dist = camDist - z;
      const span = 2 * dist * tanHalf * 1.3;
      const g = shapes[i % shapes.length]();
      const obj = new THREE.LineSegments(new THREE.EdgesGeometry(g, 1), this.sceneryMat);
      g.dispose();
      const side = this.rng.sign();
      obj.position.set(side * (14 + this.rng.next() * span * 0.9), (this.rng.next() - 0.5) * span, z);
      obj.rotation.set(this.rng.next() * 6, this.rng.next() * 6, this.rng.next() * 6);
      const s = 0.7 + this.rng.next() * 1.3;
      obj.scale.setScalar(s);
      obj.frustumCulled = false;
      obj.renderOrder = -70;
      this.sceneryGroup.add(obj);
      this.scenery.push({
        obj,
        speed: (6 + this.rng.next() * 6) * (60 / dist),
        spin: new THREE.Vector3(this.rng.range(-0.3, 0.3), this.rng.range(-0.3, 0.3), this.rng.range(-0.2, 0.2)),
        span,
      });
    }
  }

  setSector(s: SectorDef, camDist: number, instant = false): void {
    if (instant) {
      this.from = s.palette;
      this.to = s.palette;
      this.mix = 1;
      this.skyMat.uniforms.uModeA.value = s.index;
      this.skyMat.uniforms.uModeB.value = s.index;
      this.skyMat.uniforms.uModeMix.value = 0;
    } else {
      this.from = this.currentPalette();
      this.to = s.palette;
      this.mix = 0;
      this.skyMat.uniforms.uModeA.value = this.skyMat.uniforms.uModeMix.value > 0.5 ? this.skyMat.uniforms.uModeB.value : this.skyMat.uniforms.uModeA.value;
      this.skyMat.uniforms.uModeB.value = s.index;
      this.skyMat.uniforms.uModeMix.value = 0;
    }
    this.gridMat.uniforms.uMode.value = s.index;
    this.buildScenery(s.scenery, camDist);
    this.applyPalette();
  }

  private currentPalette(): Palette {
    return this.mix >= 1 ? this.to : this.to;
  }

  private applyPalette(): void {
    const k = this.mix;
    const lerp = (a: string, b: string): THREE.Color => col(a).lerp(col(b), k);
    const u = this.skyMat.uniforms;
    u.uTop.value.copy(lerp(this.from.bgTop, this.to.bgTop));
    u.uBottom.value.copy(lerp(this.from.bgBottom, this.to.bgBottom));
    u.uNebA.value.copy(lerp(this.from.nebulaA, this.to.nebulaA));
    u.uNebB.value.copy(lerp(this.from.nebulaB, this.to.nebulaB));
    u.uAccent.value.copy(lerp(this.from.accent, this.to.accent));
    this.starMat.uniforms.uColor.value.copy(lerp(this.from.star, this.to.star));
    this.starMat.uniforms.uAccent.value.copy(lerp(this.from.accent, this.to.accent));
    this.gridMat.uniforms.uColor.value.copy(lerp(this.from.grid, this.to.grid));
    this.sceneryMat.color.copy(lerp(this.from.grid, this.to.grid));
  }

  update(dt: number, time: number, beat: number, aspect: number, speed: number): void {
    if (this.mix < 1) {
      this.mix = Math.min(1, this.mix + dt / 2.5);
      this.skyMat.uniforms.uModeMix.value = this.mix;
      this.applyPalette();
    }
    this.scroll += dt * speed * (1 + this.warp * 12);
    const u = this.skyMat.uniforms;
    u.uTime.value = time;
    u.uBeat.value = beat;
    u.uAspect.value = aspect;
    u.uScroll.value = this.scroll;
    u.uWarp.value = this.warp;
    this.starMat.uniforms.uScroll.value = this.scroll;
    this.starMat.uniforms.uWarp.value = this.warp;
    this.starMat.uniforms.uTime.value = time;
    this.gridMat.uniforms.uScroll.value = this.scroll;
    this.gridMat.uniforms.uBeat.value = beat;
    this.gridMat.uniforms.uTime.value = time;
    this.gridMat.uniforms.uFade.value = 1 - this.warp * 0.6;
    for (const s of this.scenery) {
      s.obj.position.y -= s.speed * dt * speed * (1 + this.warp * 10);
      if (s.obj.position.y < -s.span / 2 - 10) s.obj.position.y += s.span + 20;
      s.obj.rotation.x += s.spin.x * dt;
      s.obj.rotation.y += s.spin.y * dt;
      s.obj.rotation.z += s.spin.z * dt;
    }
  }
}
