/**
 * GPU particle system: particles are written once into a ring buffer and simulated entirely
 * in the vertex shader (closed-form drag + gravity), so thousands cost almost no CPU.
 */
import * as THREE from 'three';

export const enum PKind {
  Dot = 0,
  Spark = 1,
  Square = 2,
  Ember = 3,
}

const VERT = /* glsl */ `
attribute vec4 aP;   // x, y, spawnTime, kind
attribute vec4 aV;   // vx, vy, drag, gravity
attribute vec4 aL;   // life, size0, size1, spin
attribute vec3 aC;
uniform float uTime;
varying vec2 vUv;
varying vec3 vCol;
varying float vT;
varying float vKind;
void main() {
  float age = uTime - aP.z;
  float t = age / aL.x;
  if (t < 0.0 || t > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float drag = aV.z;
  float f = drag > 0.001 ? (1.0 - exp(-drag * age)) / drag : age;
  vec2 pos = aP.xy + aV.xy * f + vec2(0.0, -0.5 * aV.w * age * age);
  vec2 vel = aV.xy * exp(-drag * age) + vec2(0.0, -aV.w * age);
  float size = mix(aL.y, aL.z, t);
  vec2 c = position.xy;
  vec2 off;
  int k = int(aP.w + 0.5);
  if (k == 1) {
    float sp = length(vel);
    vec2 dir = sp > 0.01 ? vel / sp : vec2(0.0, 1.0);
    vec2 n = vec2(-dir.y, dir.x);
    off = dir * c.y * (size * 0.6 + sp * 0.045) + n * c.x * size * 0.32;
  } else {
    float a = aL.w * age;
    float cs = cos(a);
    float sn = sin(a);
    off = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos + off, 0.4, 1.0);
  vUv = c * 2.0;
  vCol = aC;
  vT = t;
  vKind = aP.w;
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
varying float vT;
varying float vKind;
void main() {
  int k = int(vKind + 0.5);
  float d = length(vUv);
  float a;
  if (k == 1) {
    a = exp(-vUv.x * vUv.x * 6.0) * smoothstep(1.0, 0.3, abs(vUv.y));
  } else if (k == 2) {
    a = step(max(abs(vUv.x), abs(vUv.y)), 0.7);
  } else {
    a = exp(-d * d * 4.0);
  }
  float fade = (1.0 - vT);
  fade *= fade;
  vec3 hot = mix(vCol, vec3(1.0), max(0.0, 0.6 - vT) * (k == 3 ? 1.2 : 0.6));
  gl_FragColor = vec4(hot * a * fade * 1.25, 0.0);
}
`;

export class Particles {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private P: Float32Array;
  private V: Float32Array;
  private L: Float32Array;
  private C: Float32Array;
  private attrs: THREE.InstancedBufferAttribute[];
  private head = 0;
  private dirtyMin = Infinity;
  private dirtyMax = -1;
  readonly material: THREE.ShaderMaterial;
  time = 0;
  /** 0..1 multiplier applied to emission counts (quality setting) */
  density = 1;

  constructor(readonly cap: number) {
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.P = new Float32Array(cap * 4);
    this.V = new Float32Array(cap * 4);
    this.L = new Float32Array(cap * 4);
    this.C = new Float32Array(cap * 3);
    for (let i = 0; i < cap; i++) {
      this.P[i * 4 + 2] = -1e6;
      this.L[i * 4] = 1;
    }
    const mk = (arr: Float32Array, n: number): THREE.InstancedBufferAttribute => new THREE.InstancedBufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    this.attrs = [mk(this.P, 4), mk(this.V, 4), mk(this.L, 4), mk(this.C, 3)];
    this.geo.setAttribute('aP', this.attrs[0]);
    this.geo.setAttribute('aV', this.attrs[1]);
    this.geo.setAttribute('aL', this.attrs[2]);
    this.geo.setAttribute('aC', this.attrs[3]);
    this.geo.instanceCount = cap;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
  }

  emit(
    x: number,
    y: number,
    vx: number,
    vy: number,
    drag: number,
    gravity: number,
    life: number,
    s0: number,
    s1: number,
    r: number,
    g: number,
    b: number,
    kind: number,
    spin = 0,
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    const i4 = i * 4;
    this.P[i4] = x;
    this.P[i4 + 1] = y;
    this.P[i4 + 2] = this.time;
    this.P[i4 + 3] = kind;
    this.V[i4] = vx;
    this.V[i4 + 1] = vy;
    this.V[i4 + 2] = drag;
    this.V[i4 + 3] = gravity;
    this.L[i4] = life;
    this.L[i4 + 1] = s0;
    this.L[i4 + 2] = s1;
    this.L[i4 + 3] = spin;
    this.C[i * 3] = r;
    this.C[i * 3 + 1] = g;
    this.C[i * 3 + 2] = b;
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
  }

  /** Radial burst. */
  burst(
    x: number,
    y: number,
    n: number,
    speedMin: number,
    speedMax: number,
    color: THREE.Color,
    opts: { kind?: number; life?: number; size?: number; drag?: number; gravity?: number; spread?: number; dir?: number } = {},
  ): void {
    const count = Math.max(1, Math.round(n * this.density));
    const kind = opts.kind ?? PKind.Spark;
    const life = opts.life ?? 0.6;
    const size = opts.size ?? 0.7;
    const drag = opts.drag ?? 3;
    const spread = opts.spread ?? Math.PI * 2;
    const dir = opts.dir ?? 0;
    for (let k = 0; k < count; k++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const sp = speedMin + Math.random() * (speedMax - speedMin);
      this.emit(
        x,
        y,
        Math.cos(a) * sp,
        Math.sin(a) * sp,
        drag,
        opts.gravity ?? 0,
        life * (0.6 + Math.random() * 0.6),
        size * (0.7 + Math.random() * 0.6),
        size * 0.15,
        color.r,
        color.g,
        color.b,
        kind,
        (Math.random() - 0.5) * 10,
      );
    }
  }

  update(time: number): void {
    this.time = time;
    this.material.uniforms.uTime.value = time;
    if (this.dirtyMax < 0) return;
    const sizes = [4, 4, 4, 3];
    const lo = this.dirtyMin;
    const hi = this.dirtyMax;
    this.attrs.forEach((attr, k) => {
      attr.clearUpdateRanges();
      attr.addUpdateRange(lo * sizes[k], (hi - lo + 1) * sizes[k]);
      attr.needsUpdate = true;
    });
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
  }

  clear(): void {
    for (let i = 0; i < this.cap; i++) this.P[i * 4 + 2] = -1e6;
    this.dirtyMin = 0;
    this.dirtyMax = this.cap - 1;
  }
}
