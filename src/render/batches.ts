/**
 * Instanced quad batches. One draw call each for: enemy bullets, player bullets, pickups,
 * glows/shockwaves and line segments (lasers, lightning, telegraphs).
 */
import * as THREE from 'three';

export const enum SpriteShape {
  Orb = 0,
  Rice = 1,
  Star = 2,
  Ring = 3,
  Shard = 4,
  Bolt = 5,
  Missile = 6,
  Note = 7,
  Heart = 8,
  Glow = 9,
  Shock = 10,
  Hitbox = 11,
}

const SPRITE_VERT = /* glsl */ `
attribute vec4 iA; // x, y, rot, shape
attribute vec4 iB; // w, h, param, alpha
attribute vec3 iC; // colour
uniform float uZ;
varying vec2 vUv;
varying vec3 vCol;
varying float vShape;
varying float vAlpha;
varying float vParam;
void main() {
  vUv = position.xy * 2.0;
  float c = cos(iA.z);
  float s = sin(iA.z);
  vec2 p = position.xy * vec2(iB.x, iB.y) * 2.0;
  p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(iA.x + p.x, iA.y + p.y, uZ, 1.0);
  vCol = iC;
  vShape = iA.w;
  vAlpha = iB.w;
  vParam = iB.z;
}
`;

const SPRITE_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
varying float vShape;
varying float vAlpha;
varying float vParam;
uniform float uTime;

float heart(vec2 p) {
  p.y = -p.y * 1.1 + 0.25;
  p.x = abs(p.x);
  float a = atan(p.x, p.y) / 3.14159;
  float r = length(p);
  float h = abs(a);
  float d = (13.0 * h - 22.0 * h * h + 10.0 * h * h * h) / (6.0 - 5.0 * h);
  return r - d * 0.55;
}

void main() {
  int sh = int(vShape + 0.5);
  float d = length(vUv);
  vec3 col = vec3(0.0);
  float a = 0.0;
  if (sh == 0 || sh == 1 || sh == 2 || sh == 3) {
    // enemy orb / rice: white-hot core, coloured rim, dark edge, soft glow
    float core = smoothstep(0.44, 0.34, d);
    float rim = smoothstep(0.64, 0.5, d);
    float edge = smoothstep(0.74, 0.64, d) - rim;
    float glow = exp(-d * d * 3.2) * 0.55;
    col = vCol * (rim * 1.12 + glow * 0.8) + vec3(1.0) * core * 0.82;
    a = clamp(rim + edge * 0.55, 0.0, 1.0);
  } else if (sh == 4) {
    float dd = abs(vUv.x) * 1.35 + abs(vUv.y);
    float core = smoothstep(0.42, 0.3, dd);
    float rim = smoothstep(0.7, 0.55, dd);
    float glow = exp(-d * d * 3.0) * 0.5;
    col = vCol * (rim * 1.15 + glow * 0.8) + vec3(1.0) * core * 0.85;
    a = clamp(rim, 0.0, 1.0);
  } else if (sh == 5) {
    // player bolt: additive streak
    float g = exp(-vUv.x * vUv.x * 7.0) * smoothstep(1.0, 0.2, abs(vUv.y));
    float core = exp(-vUv.x * vUv.x * 40.0) * smoothstep(0.9, 0.0, abs(vUv.y));
    col = vCol * g * 0.85 + vec3(1.0) * core * 0.55;
    a = 0.0;
  } else if (sh == 6) {
    float dd = abs(vUv.x) * 2.0 + abs(vUv.y);
    float core = smoothstep(0.8, 0.5, dd);
    col = vCol * (core * 1.4 + exp(-d * d * 3.0) * 0.6) + vec3(1.0) * smoothstep(0.4, 0.1, dd) * 0.6;
    a = 0.0;
  } else if (sh == 7) {
    float dd = abs(vUv.x) * 1.15 + abs(vUv.y);
    float core = smoothstep(0.5, 0.38, dd);
    float glow = exp(-d * d * 4.0) * 0.6;
    float sparkle = 0.75 + 0.25 * sin(uTime * 9.0 + vParam * 6.0);
    col = vCol * (core * 1.5 + glow) * sparkle + vec3(1.0) * smoothstep(0.22, 0.05, dd) * 0.8;
    a = core * 0.85;
  } else if (sh == 8) {
    float h = heart(vUv * 1.25);
    float core = smoothstep(0.02, -0.04, h);
    float glow = exp(-max(h, 0.0) * 9.0) * 0.6;
    col = vCol * (core * 1.4 + glow) + vec3(1.0) * smoothstep(-0.12, -0.3, h) * 0.5;
    a = core * 0.9;
  } else if (sh == 9) {
    float g = exp(-d * d * 4.0);
    col = vCol * g * g * 1.1;
    a = 0.0;
  } else if (sh == 10) {
    float w = max(0.02, vParam);
    float ring = exp(-pow((d - (1.0 - w)) / w, 2.0) * 2.2) * smoothstep(1.0, 0.96, d);
    col = vCol * ring * 1.4;
    a = 0.0;
  } else if (sh == 11) {
    float core = smoothstep(0.42, 0.3, d);
    float ring = smoothstep(0.08, 0.0, abs(d - 0.78));
    col = vec3(1.0) * core + vCol * ring * 1.2;
    a = core;
  }
  gl_FragColor = vec4(col * vAlpha, a * vAlpha);
}
`;

export class SpriteBatch {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private a: Float32Array;
  private b: Float32Array;
  private c: Float32Array;
  private aAttr: THREE.InstancedBufferAttribute;
  private bAttr: THREE.InstancedBufferAttribute;
  private cAttr: THREE.InstancedBufferAttribute;
  readonly material: THREE.ShaderMaterial;
  count = 0;

  constructor(
    readonly cap: number,
    blending: 'add' | 'premul',
    z: number,
    renderOrder: number,
  ) {
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.a = new Float32Array(cap * 4);
    this.b = new Float32Array(cap * 4);
    this.c = new Float32Array(cap * 3);
    this.aAttr = new THREE.InstancedBufferAttribute(this.a, 4).setUsage(THREE.DynamicDrawUsage);
    this.bAttr = new THREE.InstancedBufferAttribute(this.b, 4).setUsage(THREE.DynamicDrawUsage);
    this.cAttr = new THREE.InstancedBufferAttribute(this.c, 3).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iA', this.aAttr);
    this.geo.setAttribute('iB', this.bAttr);
    this.geo.setAttribute('iC', this.cAttr);
    this.geo.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      vertexShader: SPRITE_VERT,
      fragmentShader: SPRITE_FRAG,
      uniforms: { uZ: { value: z }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: blending === 'add' ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
      blendEquation: THREE.AddEquation,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  begin(): void {
    this.count = 0;
  }

  push(x: number, y: number, rot: number, shape: number, w: number, h: number, param: number, alpha: number, r: number, g: number, b: number): void {
    if (this.count >= this.cap) return;
    const i = this.count++;
    const i4 = i * 4;
    const i3 = i * 3;
    this.a[i4] = x;
    this.a[i4 + 1] = y;
    this.a[i4 + 2] = rot;
    this.a[i4 + 3] = shape;
    this.b[i4] = w;
    this.b[i4 + 1] = h;
    this.b[i4 + 2] = param;
    this.b[i4 + 3] = alpha;
    this.c[i3] = r;
    this.c[i3 + 1] = g;
    this.c[i3 + 2] = b;
  }

  end(time: number): void {
    const n = this.count;
    this.geo.instanceCount = n;
    this.material.uniforms.uTime.value = time;
    if (n === 0) return;
    for (const [attr, size] of [
      [this.aAttr, 4],
      [this.bAttr, 4],
      [this.cAttr, 3],
    ] as const) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * size);
      attr.needsUpdate = true;
    }
  }
}

const SEG_VERT = /* glsl */ `
attribute vec4 sA; // x1 y1 x2 y2
attribute vec4 sB; // width, alpha, style, seed
attribute vec3 sC;
uniform float uZ;
varying vec2 vUv;
varying vec3 vCol;
varying float vAlpha;
varying float vStyle;
varying float vLen;
varying float vSeed;
void main() {
  vec2 p1 = sA.xy;
  vec2 p2 = sA.zw;
  vec2 d = p2 - p1;
  float len = max(length(d), 1e-4);
  vec2 dir = d / len;
  vec2 n = vec2(-dir.y, dir.x);
  float w = sB.x;
  float t = position.y + 0.5;
  vec2 p = p1 + dir * (t * (len + w) - w * 0.5) + n * position.x * w * 2.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, uZ, 1.0);
  vUv = vec2(position.x * 2.0, t);
  vCol = sC;
  vAlpha = sB.y;
  vStyle = sB.z;
  vLen = len;
  vSeed = sB.w;
}
`;

const SEG_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
varying float vAlpha;
varying float vStyle;
varying float vLen;
varying float vSeed;
uniform float uTime;
void main() {
  float x = abs(vUv.x);
  int st = int(vStyle + 0.5);
  vec3 col;
  if (st == 0) {
    col = vCol * (exp(-x * x * 5.0) * 0.9 + smoothstep(0.3, 0.0, x) * 1.2);
  } else if (st == 1) {
    float flick = 0.85 + 0.15 * sin(uTime * 60.0 + vUv.y * vLen * 0.8 + vSeed);
    float core = smoothstep(0.35, 0.05, x);
    col = (vCol * exp(-x * x * 3.0) * 1.3 + vec3(1.0) * core * 1.2) * flick;
  } else {
    float dash = step(0.45, fract(vUv.y * vLen * 0.35 - uTime * 3.0));
    col = vCol * dash * smoothstep(1.0, 0.0, x) * 1.3;
  }
  gl_FragColor = vec4(col * vAlpha, 0.0);
}
`;

export class SegmentBatch {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private a: Float32Array;
  private b: Float32Array;
  private c: Float32Array;
  private attrs: THREE.InstancedBufferAttribute[];
  readonly material: THREE.ShaderMaterial;
  count = 0;

  constructor(
    readonly cap: number,
    z: number,
    renderOrder: number,
  ) {
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.a = new Float32Array(cap * 4);
    this.b = new Float32Array(cap * 4);
    this.c = new Float32Array(cap * 3);
    const A = new THREE.InstancedBufferAttribute(this.a, 4).setUsage(THREE.DynamicDrawUsage);
    const B = new THREE.InstancedBufferAttribute(this.b, 4).setUsage(THREE.DynamicDrawUsage);
    const C = new THREE.InstancedBufferAttribute(this.c, 3).setUsage(THREE.DynamicDrawUsage);
    this.attrs = [A, B, C];
    this.geo.setAttribute('sA', A);
    this.geo.setAttribute('sB', B);
    this.geo.setAttribute('sC', C);
    this.material = new THREE.ShaderMaterial({
      vertexShader: SEG_VERT,
      fragmentShader: SEG_FRAG,
      uniforms: { uZ: { value: z }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  begin(): void {
    this.count = 0;
  }

  push(x1: number, y1: number, x2: number, y2: number, width: number, alpha: number, style: number, r: number, g: number, b: number, seed = 0): void {
    if (this.count >= this.cap) return;
    const i = this.count++;
    const i4 = i * 4;
    const i3 = i * 3;
    this.a[i4] = x1;
    this.a[i4 + 1] = y1;
    this.a[i4 + 2] = x2;
    this.a[i4 + 3] = y2;
    this.b[i4] = width;
    this.b[i4 + 1] = alpha;
    this.b[i4 + 2] = style;
    this.b[i4 + 3] = seed;
    this.c[i3] = r;
    this.c[i3 + 1] = g;
    this.c[i3 + 2] = b;
  }

  end(time: number): void {
    const n = this.count;
    this.geo.instanceCount = n;
    this.material.uniforms.uTime.value = time;
    if (n === 0) return;
    const sizes = [4, 4, 3];
    this.attrs.forEach((attr, k) => {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, n * sizes[k]);
      attr.needsUpdate = true;
    });
  }
}
