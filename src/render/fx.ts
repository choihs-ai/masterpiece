/**
 * Effects: one instanced billboard batch (bullets, shots, markers, glows, fireballs, beams)
 * and a GPU particle system simulated in the vertex shader.
 */
import * as THREE from 'three';

export const enum Sh {
  Orb = 0,
  Streak = 1,
  Ring = 2,
  Lock = 3,
  Glow = 4,
  Fire = 5,
  Cross = 6,
  Beam = 7,
}

const BB_VERT = /* glsl */ `
attribute vec4 aP;   // x y z shape
attribute vec4 aV;   // dir xyz, stretch length
attribute vec4 aS;   // width, alpha, param, rot
attribute vec3 aC;
varying vec2 vUv;
varying vec3 vCol;
varying float vShape;
varying float vA;
varying float vParam;
void main() {
  vec4 mv = viewMatrix * vec4(aP.xyz, 1.0);
  vec2 c = position.xy;
  float w = aS.x;
  vec2 off;
  if (aV.w > 0.0) {
    vec3 d = (viewMatrix * vec4(aV.xyz, 0.0)).xyz;
    vec2 sd = d.xy;
    float l = length(sd);
    vec2 dir = l > 1e-4 ? sd / l : vec2(0.0, 1.0);
    vec2 n = vec2(-dir.y, dir.x);
    // project the stretch so far objects shorten naturally
    off = dir * c.y * (w + aV.w * l) + n * c.x * w;
  } else {
    float r = aS.w;
    float cs = cos(r);
    float sn = sin(r);
    off = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * w;
  }
  mv.xy += off;
  gl_Position = projectionMatrix * mv;
  vUv = c * 2.0;
  vCol = aC;
  vShape = aP.w;
  vA = aS.y;
  vParam = aS.z;
}
`;

const BB_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
varying float vShape;
varying float vA;
varying float vParam;
uniform float uTime;
float h2(vec2 p) { return fract(sin(dot(p, vec2(12.9, 78.2))) * 43758.5); }
float n2(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y); }
void main() {
  int s = int(vShape + 0.5);
  float d = length(vUv);
  vec3 col;
  if (s == 0) {
    float core = smoothstep(0.42, 0.28, d);
    float glow = exp(-d * d * 3.5);
    col = vCol * glow * 1.6 + vec3(1.0) * core * 1.4;
  } else if (s == 1) {
    float g = exp(-vUv.x * vUv.x * 6.0) * smoothstep(1.0, 0.1, abs(vUv.y));
    col = vCol * g * 1.4 + vec3(1.0) * exp(-vUv.x * vUv.x * 40.0) * smoothstep(1.0, 0.3, abs(vUv.y)) * 0.8;
  } else if (s == 2) {
    float ring = smoothstep(0.09, 0.0, abs(d - 0.8));
    col = vCol * ring * 1.6;
  } else if (s == 3) {
    float a = abs(vUv.x);
    float b = abs(vUv.y);
    float box = step(0.82, max(a, b)) * step(max(a, b), 0.95);
    float corner = step(0.55, min(a, b));
    col = vCol * box * corner * 2.0;
  } else if (s == 4) {
    float g = exp(-d * d * 4.0);
    col = vCol * g * g;
  } else if (s == 5) {
    float t = vParam;
    float n = n2(vUv * 3.0 + t * 4.0) * 0.6 + n2(vUv * 7.0 - t * 3.0) * 0.4;
    float m = smoothstep(1.0, 0.2, d + (n - 0.5) * 0.8);
    vec3 hot = mix(vec3(1.0, 0.95, 0.8), vCol, smoothstep(0.0, 0.7, d + t * 0.6));
    hot = mix(hot, vec3(0.15, 0.12, 0.12), smoothstep(0.45, 1.0, t + d * 0.3));
    col = hot * m * (1.6 - t);
  } else if (s == 6) {
    float a = abs(vUv.x);
    float b = abs(vUv.y);
    float cr = (step(a, 0.05) * step(0.35, b) + step(b, 0.05) * step(0.35, a)) * step(max(a, b), 0.9);
    float ring = smoothstep(0.06, 0.0, abs(d - 0.55)) * 0.5;
    col = vCol * (cr + ring) * 1.5;
  } else {
    float x = abs(vUv.x);
    float flick = 0.85 + 0.15 * sin(uTime * 50.0 + vUv.y * 40.0);
    col = (vCol * exp(-x * x * 4.0) * 1.3 + vec3(1.0) * smoothstep(0.3, 0.0, x) * 1.2) * flick;
  }
  gl_FragColor = vec4(col * vA, 0.0);
}
`;

export class Billboards {
  readonly mesh: THREE.Mesh;
  private geo = new THREE.InstancedBufferGeometry();
  private P: Float32Array;
  private V: Float32Array;
  private S: Float32Array;
  private C: Float32Array;
  private attrs: THREE.InstancedBufferAttribute[];
  readonly mat: THREE.ShaderMaterial;
  n = 0;

  constructor(readonly cap: number, order: number, depthTest = true) {
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.P = new Float32Array(cap * 4);
    this.V = new Float32Array(cap * 4);
    this.S = new Float32Array(cap * 4);
    this.C = new Float32Array(cap * 3);
    const mk = (a: Float32Array, k: number): THREE.InstancedBufferAttribute => new THREE.InstancedBufferAttribute(a, k).setUsage(THREE.DynamicDrawUsage);
    this.attrs = [mk(this.P, 4), mk(this.V, 4), mk(this.S, 4), mk(this.C, 3)];
    ['aP', 'aV', 'aS', 'aC'].forEach((n, i) => this.geo.setAttribute(n, this.attrs[i]));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: BB_VERT,
      fragmentShader: BB_FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      depthTest,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
  }

  begin(): void {
    this.n = 0;
  }

  push(x: number, y: number, z: number, shape: number, w: number, a: number, r: number, g: number, b: number, dx = 0, dy = 0, dz = 0, stretch = 0, param = 0, rot = 0): void {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.P.set([x, y, z, shape], i * 4);
    this.V.set([dx, dy, dz, stretch], i * 4);
    this.S.set([w, a, param, rot], i * 4);
    this.C.set([r, g, b], i * 3);
  }

  end(time: number): void {
    this.geo.instanceCount = this.n;
    this.mat.uniforms.uTime.value = time;
    if (!this.n) return;
    const k = [4, 4, 4, 3];
    this.attrs.forEach((a, j) => {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.n * k[j]);
      a.needsUpdate = true;
    });
  }
}

/* ------------------------------------------------------------------ */

const P_VERT = /* glsl */ `
attribute vec4 aP;  // x y z t0
attribute vec4 aV;  // vx vy vz drag
attribute vec4 aL;  // life size0 size1 gravity
attribute vec4 aC;  // r g b kind
uniform float uTime;
uniform float uScroll;
varying vec2 vUv;
varying vec3 vCol;
varying float vT;
varying float vK;
void main() {
  float age = uTime - aP.w;
  float t = age / aL.x;
  if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float k = aV.w;
  float f = k > 0.001 ? (1.0 - exp(-k * age)) / k : age;
  vec3 p = aP.xyz + aV.xyz * f + vec3(0.0, -0.5 * aL.w * age * age, 0.0);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float size = mix(aL.y, aL.z, t);
  vec2 c = position.xy;
  if (aC.w > 0.5 && aC.w < 1.5) {
    vec3 v = aV.xyz * exp(-k * age);
    vec2 sd = (viewMatrix * vec4(v, 0.0)).xy;
    float l = length(sd);
    vec2 dir = l > 1e-3 ? sd / l : vec2(0.0, 1.0);
    vec2 n = vec2(-dir.y, dir.x);
    mv.xy += dir * c.y * (size + l * 0.03) + n * c.x * size * 0.3;
  } else {
    mv.xy += c * size;
  }
  gl_Position = projectionMatrix * mv;
  vUv = c * 2.0;
  vCol = aC.rgb;
  vT = t;
  vK = aC.w;
}
`;

const P_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
varying float vT;
varying float vK;
void main() {
  float d = length(vUv);
  int k = int(vK + 0.5);
  float a = k == 1 ? exp(-vUv.x * vUv.x * 5.0) * smoothstep(1.0, 0.3, abs(vUv.y)) : exp(-d * d * 4.0);
  float fade = (1.0 - vT) * (1.0 - vT);
  vec3 col = k == 2 ? vCol * (1.0 - vT * 0.6) : mix(vCol, vec3(1.0), max(0.0, 0.5 - vT));
  if (k == 2) {
    // smoke: dark, uses premultiplied over-blend approximation via low intensity
    gl_FragColor = vec4(col * a * fade * 0.35, 0.0);
    return;
  }
  gl_FragColor = vec4(col * a * fade * 1.4, 0.0);
}
`;

export class Particles3D {
  readonly mesh: THREE.Mesh;
  private P: Float32Array;
  private V: Float32Array;
  private L: Float32Array;
  private C: Float32Array;
  private attrs: THREE.InstancedBufferAttribute[];
  private head = 0;
  private lo = Infinity;
  private hi = -1;
  readonly mat: THREE.ShaderMaterial;
  time = 0;
  density = 1;

  constructor(readonly cap: number) {
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    this.P = new Float32Array(cap * 4).fill(0);
    for (let i = 0; i < cap; i++) this.P[i * 4 + 3] = -1e6;
    this.V = new Float32Array(cap * 4);
    this.L = new Float32Array(cap * 4).fill(1);
    this.C = new Float32Array(cap * 4);
    const mk = (a: Float32Array): THREE.InstancedBufferAttribute => new THREE.InstancedBufferAttribute(a, 4).setUsage(THREE.DynamicDrawUsage);
    this.attrs = [mk(this.P), mk(this.V), mk(this.L), mk(this.C)];
    ['aP', 'aV', 'aL', 'aC'].forEach((n, i) => g.setAttribute(n, this.attrs[i]));
    g.instanceCount = cap;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: P_VERT,
      fragmentShader: P_FRAG,
      uniforms: { uTime: { value: 0 }, uScroll: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, drag: number, life: number, s0: number, s1: number, grav: number, col: THREE.Color, kind: number): void {
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    this.P.set([x, y, z, this.time], i * 4);
    this.V.set([vx, vy, vz, drag], i * 4);
    this.L.set([life, s0, s1, grav], i * 4);
    this.C.set([col.r, col.g, col.b, kind], i * 4);
    if (i < this.lo) this.lo = i;
    if (i > this.hi) this.hi = i;
  }

  burst(x: number, y: number, z: number, n: number, speed: number, col: THREE.Color, o: { kind?: number; life?: number; size?: number; drag?: number; grav?: number; vz?: number } = {}): void {
    const count = Math.max(1, Math.round(n * this.density));
    for (let k = 0; k < count; k++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(speed * (0.3 + Math.random() * 0.7));
      const life = (o.life ?? 0.8) * (0.6 + Math.random() * 0.7);
      const s = (o.size ?? 0.5) * (0.6 + Math.random() * 0.8);
      this.emit(x, y, z, v.x, v.y, v.z + (o.vz ?? 0), o.drag ?? 2.5, life, s, s * 0.2, o.grav ?? 0, col, o.kind ?? 1);
    }
  }

  update(time: number): void {
    this.time = time;
    this.mat.uniforms.uTime.value = time;
    if (this.hi < 0) return;
    const lo = this.lo;
    const n = this.hi - lo + 1;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(lo * 4, n * 4);
      a.needsUpdate = true;
    }
    this.lo = Infinity;
    this.hi = -1;
  }
}
