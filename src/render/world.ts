/**
 * Environment: physically based sky, infinite shader terrain (canyon / sea stacks /
 * snowy peaks), a reflective ocean, drifting clouds, stars, aurora and rain.
 * Terrain and ocean are displaced on the GPU from a scroll offset, so the world is endless.
 */
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { GROUND_Y } from '../game/sim';
import type { StageDef } from '../game/content';

const NOISE = /* glsl */ `
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
float ridge(vec2 p) {
  float v = 0.0; float a = 0.55;
  for (int i = 0; i < 5; i++) { float n = 1.0 - abs(vnoise(p) * 2.0 - 1.0); v += a * n * n; p = p * 2.07 + vec2(3.1, 1.3); a *= 0.5; }
  return v;
}
uniform float uMode;
float terrainH(vec2 w) {
  int m = int(uMode + 0.5);
  float ax = abs(w.x);
  if (m == 0) {
    float floorH = ${GROUND_Y.toFixed(1)} - 1.2 + fbm(w * 0.06) * 1.4;
    float walls = smoothstep(16.0, 46.0, ax) * (18.0 + ridge(w * 0.012) * 46.0);
    float mesa = smoothstep(0.55, 0.62, fbm(w * 0.008 + 3.0)) * smoothstep(30.0, 60.0, ax) * 22.0;
    return floorH + walls + mesa;
  } else if (m == 1) {
    float stacks = smoothstep(0.58, 0.8, fbm(w * 0.018)) * smoothstep(22.0, 40.0, ax) * 60.0;
    return -16.0 + stacks + fbm(w * 0.05) * 3.0;
  }
  float valley = smoothstep(14.0, 60.0, ax);
  return ${GROUND_Y.toFixed(1)} - 3.0 + valley * (14.0 + ridge(w * 0.009) * 80.0) + fbm(w * 0.05) * 2.0;
}
`;

const TERRAIN_VERT = /* glsl */ `
uniform float uScroll;
varying vec3 vWorld;
varying vec3 vNormal2;
varying float vH;
${NOISE}
void main() {
  vec3 p = position;
  vec2 w = vec2(p.x, p.z - uScroll);
  float h = terrainH(w);
  float e = 1.2;
  float hx = terrainH(w + vec2(e, 0.0));
  float hz = terrainH(w + vec2(0.0, e));
  vNormal2 = normalize(vec3(h - hx, e, h - hz));
  p.y = h;
  vH = h;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const TERRAIN_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSun;
uniform vec3 uSky;
uniform vec3 uGround;
uniform vec3 uC0;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uFog;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uShip;
uniform float uScroll;
uniform float uFlash;
varying vec3 vWorld;
varying vec3 vNormal2;
varying float vH;
${NOISE}
void main() {
  vec3 n = normalize(vNormal2);
  float slope = 1.0 - n.y;
  vec2 w = vec2(vWorld.x, vWorld.z - uScroll);
  float detail = fbm(w * 0.35);
  vec3 base = mix(uC0, uC1, smoothstep(0.18, 0.5, slope + detail * 0.15));
  int m = int(uMode + 0.5);
  float hi = m == 2 ? smoothstep(10.0, 26.0, vH + detail * 6.0) * (1.0 - smoothstep(0.35, 0.6, slope)) : smoothstep(0.62, 0.9, detail) * (1.0 - slope) * 0.35;
  base = mix(base, uC2, hi);
  // strata bands on canyon walls
  if (m == 0) base *= 0.85 + 0.15 * sin(vH * 1.6 + detail * 3.0);
  float diff = max(dot(n, uSunDir), 0.0);
  vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5);
  vec3 col = base * (uSun * diff * 0.9 + amb * 0.55);
  // soft shadow of the ship
  float sd = length(vWorld.xz - vec2(uShip.x, 0.6));
  float hgt = max(uShip.y - vH, 0.0);
  col *= 1.0 - smoothstep(2.6 + hgt * 0.12, 0.4, sd) * 0.45 * (1.0 - smoothstep(4.0, 30.0, hgt));
  col += uFlash * vec3(0.6, 0.65, 0.8) * (0.3 + diff);
  float d = length(vWorld - cameraPosition);
  float f = smoothstep(uFogNear, uFogFar, d);
  f = max(f, smoothstep(30.0, -30.0, vWorld.y + 10.0) * 0.0);
  gl_FragColor = vec4(mix(col, uFog, f), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const OCEAN_VERT = /* glsl */ `
uniform float uScroll;
uniform float uTime;
varying vec3 vWorld;
varying vec3 vN;
float wave(vec2 p, vec2 d, float f, float a, float s) { return a * sin(dot(p, d) * f + uTime * s); }
float H(vec2 p) {
  return wave(p, normalize(vec2(0.3, 1.0)), 0.18, 0.9, 1.4) + wave(p, normalize(vec2(-0.7, 0.6)), 0.31, 0.45, 2.1)
    + wave(p, normalize(vec2(0.9, 0.2)), 0.55, 0.22, 2.9) + wave(p, normalize(vec2(-0.2, -1.0)), 0.9, 0.1, 3.7);
}
void main() {
  vec3 p = position;
  vec2 w = vec2(p.x, p.z - uScroll);
  float h = H(w);
  float e = 0.5;
  vN = normalize(vec3(h - H(w + vec2(e, 0.0)), e, h - H(w + vec2(0.0, e))));
  p.y = ${(GROUND_Y - 1.5).toFixed(1)} + h;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const OCEAN_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSun;
uniform vec3 uDeep;
uniform vec3 uSkyRef;
uniform vec3 uFog;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uShip;
uniform float uFlash;
varying vec3 vWorld;
varying vec3 vN;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  vec3 r = reflect(-v, n);
  float spec = pow(max(dot(r, uSunDir), 0.0), 180.0) * 3.0 + pow(max(dot(r, uSunDir), 0.0), 18.0) * 0.25;
  vec3 col = mix(uDeep, uSkyRef, clamp(fres * 1.2 + 0.08, 0.0, 1.0)) + uSun * spec;
  float foam = smoothstep(0.55, 0.95, n.x * 0.6 + n.z * 0.4 + 0.5) * 0.12;
  col += foam;
  float sd = length(vWorld.xz - vec2(uShip.x, 0.6));
  col *= 1.0 - smoothstep(3.0, 0.5, sd) * 0.3;
  col += uFlash * vec3(0.5, 0.55, 0.7);
  float d = length(vWorld - cameraPosition);
  gl_FragColor = vec4(mix(col, uFog, smoothstep(uFogNear, uFogFar, d)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const CLOUD_VERT = /* glsl */ `
attribute vec4 aC; // x, y, z0, size
attribute float aSeed;
uniform float uScroll;
uniform float uSpan;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
void main() {
  float z = mod(aC.z + uScroll * 0.9 + uSpan, uSpan) - uSpan + 30.0;
  vec4 mv = viewMatrix * vec4(aC.x, aC.y, z, 1.0);
  mv.xy += position.xy * aC.w * vec2(1.8, 0.7);
  gl_Position = projectionMatrix * mv;
  vUv = position.xy * 2.0;
  vSeed = aSeed;
  vFade = smoothstep(-uSpan + 30.0, -uSpan + 120.0, z) * smoothstep(25.0, -10.0, z);
}
`;

const CLOUD_FRAG = /* glsl */ `
uniform vec3 uLit;
uniform vec3 uShade;
uniform float uOpacity;
varying vec2 vUv;
varying float vSeed;
varying float vFade;
float h2(vec2 p) { return fract(sin(dot(p, vec2(12.9, 78.2))) * 43758.5); }
float n2(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y); }
void main() {
  vec2 p = vUv;
  float d = length(p * vec2(1.0, 1.25));
  float n = n2(p * 2.5 + vSeed * 7.0) * 0.5 + n2(p * 5.0 + vSeed * 3.0) * 0.3 + n2(p * 10.0) * 0.2;
  float a = smoothstep(1.0, 0.25, d + (n - 0.5) * 0.7);
  vec3 col = mix(uShade, uLit, clamp(p.y * 0.6 + 0.55 + n * 0.3, 0.0, 1.0));
  gl_FragColor = vec4(col, a * uOpacity * vFade);
}
`;

const AURORA_FRAG = /* glsl */ `
uniform float uTime;
uniform float uOn;
varying vec2 vUv;
void main() {
  float x = vUv.x * 6.0;
  float band = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float y = vUv.y - 0.45 - 0.12 * sin(x * 1.3 + uTime * 0.15 + fi * 2.0) - fi * 0.08;
    band += exp(-y * y * 60.0) * (0.5 + 0.5 * sin(x * 7.0 + uTime * 0.6 + fi * 3.0));
  }
  float rays = 0.6 + 0.4 * sin(vUv.x * 120.0 + uTime);
  vec3 col = mix(vec3(0.2, 1.0, 0.6), vec3(0.6, 0.3, 1.0), vUv.y) * band * rays;
  gl_FragColor = vec4(col * uOn * 0.9, 1.0);
}
`;

const c = (h: string): THREE.Color => new THREE.Color(h);

export class World3D {
  readonly group = new THREE.Group();
  private sky = new Sky();
  private terrainMat: THREE.ShaderMaterial;
  private oceanMat: THREE.ShaderMaterial;
  private ocean: THREE.Mesh;
  private cloudMat: THREE.ShaderMaterial;
  private stars: THREE.Points;
  private aurora: THREE.Mesh;
  private rain: THREE.LineSegments;
  readonly sun = new THREE.DirectionalLight('#ffffff', 3);
  readonly hemi = new THREE.HemisphereLight('#ffffff', '#222222', 1);
  readonly sunDir = new THREE.Vector3();
  fog = new THREE.Color();
  private stage: StageDef | null = null;
  flash = 0;

  constructor() {
    this.sky.scale.setScalar(4500);
    this.group.add(this.sky);
    const common = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSun: { value: new THREE.Color() },
      uFog: { value: new THREE.Color() },
      uFogNear: { value: 60 },
      uFogFar: { value: 300 },
      uScroll: { value: 0 },
      uShip: { value: new THREE.Vector3() },
      uFlash: { value: 0 },
    };
    this.terrainMat = new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
      uniforms: {
        ...THREE.UniformsUtils.clone(common),
        uMode: { value: 0 },
        uSky: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uC0: { value: new THREE.Color() },
        uC1: { value: new THREE.Color() },
        uC2: { value: new THREE.Color() },
      },
    });
    const tg = new THREE.PlaneGeometry(420, 560, 200, 240);
    tg.rotateX(-Math.PI / 2);
    tg.translate(0, 0, -250);
    const terrain = new THREE.Mesh(tg, this.terrainMat);
    terrain.frustumCulled = false;
    this.group.add(terrain);

    this.oceanMat = new THREE.ShaderMaterial({
      vertexShader: OCEAN_VERT,
      fragmentShader: OCEAN_FRAG,
      uniforms: {
        ...THREE.UniformsUtils.clone(common),
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color('#06121c') },
        uSkyRef: { value: new THREE.Color('#6b7b90') },
      },
    });
    const og = new THREE.PlaneGeometry(500, 600, 160, 200);
    og.rotateX(-Math.PI / 2);
    og.translate(0, 0, -270);
    this.ocean = new THREE.Mesh(og, this.oceanMat);
    this.ocean.frustumCulled = false;
    this.group.add(this.ocean);

    // clouds
    const N = 70;
    const base = new THREE.PlaneGeometry(1, 1);
    const cg = new THREE.InstancedBufferGeometry();
    cg.index = base.index;
    cg.setAttribute('position', base.getAttribute('position'));
    const A = new Float32Array(N * 4);
    const S = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      A[i * 4] = side * (12 + Math.random() * 110);
      A[i * 4 + 1] = 16 + Math.random() * 45;
      A[i * 4 + 2] = -Math.random() * 520;
      A[i * 4 + 3] = 14 + Math.random() * 26;
      S[i] = Math.random();
    }
    cg.setAttribute('aC', new THREE.InstancedBufferAttribute(A, 4));
    cg.setAttribute('aSeed', new THREE.InstancedBufferAttribute(S, 1));
    cg.instanceCount = N;
    this.cloudMat = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      uniforms: { uScroll: { value: 0 }, uSpan: { value: 520 }, uLit: { value: new THREE.Color() }, uShade: { value: new THREE.Color() }, uOpacity: { value: 0.7 } },
      transparent: true,
      depthWrite: false,
    });
    const clouds = new THREE.Mesh(cg, this.cloudMat);
    clouds.frustumCulled = false;
    clouds.renderOrder = 2;
    this.group.add(clouds);

    // stars
    const sp = new Float32Array(1500 * 3);
    for (let i = 0; i < 1500; i++) {
      const v = new THREE.Vector3().randomDirection();
      v.y = Math.abs(v.y) * 0.9 + 0.05;
      v.normalize().multiplyScalar(2000);
      sp.set([v.x, v.y, v.z], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
    this.group.add(this.stars);

    this.aurora = new THREE.Mesh(
      new THREE.PlaneGeometry(2600, 700),
      new THREE.ShaderMaterial({
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: AURORA_FRAG,
        uniforms: { uTime: { value: 0 }, uOn: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.aurora.position.set(0, 420, -1500);
    this.group.add(this.aurora);

    // rain streaks around the camera
    const R = 500;
    const rp = new Float32Array(R * 6);
    for (let i = 0; i < R; i++) {
      const x = (Math.random() - 0.5) * 80;
      const y = Math.random() * 40 - 6;
      const z = -Math.random() * 120 + 10;
      rp.set([x, y, z, x + 0.3, y - 2.2, z + 2.5], i * 6);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#9fb2d0', transparent: true, opacity: 0.35, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.group.add(this.rain);

    this.group.add(this.sun, this.hemi, this.sun.target);
  }

  /** Apply a stage's look. Returns the sky-only scene for environment lighting. */
  setStage(s: StageDef): void {
    this.stage = s;
    const L = s.look;
    const u = this.sky.material.uniforms;
    u.turbidity.value = L.turbidity;
    u.rayleigh.value = L.rayleigh;
    u.mieCoefficient.value = L.mie;
    u.mieDirectionalG.value = 0.86;
    const phi = THREE.MathUtils.degToRad(90 - L.elevation);
    const theta = THREE.MathUtils.degToRad(L.azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    u.sunPosition.value.copy(this.sunDir);
    const light = this.sunDir.clone();
    if (light.y < 0.15) light.y = 0.15;
    light.normalize();
    this.sun.position.copy(light).multiplyScalar(100);
    this.sun.color.set(L.sun);
    this.sun.intensity = L.sunIntensity;
    this.hemi.color.set(L.hemiSky);
    this.hemi.groundColor.set(L.hemiGround);
    this.hemi.intensity = 1.1;
    this.fog.set(L.fog);
    for (const m of [this.terrainMat, this.oceanMat]) {
      m.uniforms.uSunDir.value.copy(light);
      m.uniforms.uSun.value.set(L.sun).multiplyScalar(L.sunIntensity * 0.45);
      m.uniforms.uFog.value.copy(this.fog);
      m.uniforms.uFogNear.value = L.fogNear;
      m.uniforms.uFogFar.value = L.fogFar;
    }
    const t = this.terrainMat.uniforms;
    t.uMode.value = s.terrain === 'canyon' ? 0 : s.terrain === 'ocean' ? 1 : 2;
    t.uSky.value.set(L.hemiSky);
    t.uGround.value.set(L.hemiGround);
    t.uC0.value.set(L.ground[0]);
    t.uC1.value.set(L.ground[1]);
    t.uC2.value.set(L.ground[2]);
    this.oceanMat.uniforms.uSkyRef.value.copy(this.fog).lerp(c(L.hemiSky), 0.4);
    this.ocean.visible = s.terrain !== 'canyon';
    this.oceanMat.uniforms.uDeep.value.set(s.terrain === 'peaks' ? '#0a1430' : '#071824');
    this.cloudMat.uniforms.uLit.value.set(L.night ? '#7d88c8' : L.sun).lerp(c('#ffffff'), 0.25);
    this.cloudMat.uniforms.uShade.value.copy(this.fog).multiplyScalar(0.7);
    this.cloudMat.uniforms.uOpacity.value = s.terrain === 'ocean' ? 0.9 : 0.6;
    this.stars.visible = L.night || s.terrain === 'ocean';
    (this.stars.material as THREE.PointsMaterial).opacity = L.night ? 0.95 : 0.35;
    (this.aurora.material as THREE.ShaderMaterial).uniforms.uOn.value = L.night ? 1 : 0;
    this.aurora.visible = L.night;
    this.rain.visible = s.terrain === 'ocean';
  }

  /** A sky-only scene used to bake the PBR environment map. */
  envScene(): THREE.Scene {
    const sc = new THREE.Scene();
    const sky = new Sky();
    sky.scale.setScalar(4500);
    const u = sky.material.uniforms;
    const src = this.sky.material.uniforms;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) u[k].value = src[k].value;
    u.sunPosition.value.copy(src.sunPosition.value);
    if (this.sunDir.y < 0.05) u.sunPosition.value.set(this.sunDir.x, 0.05, this.sunDir.z);
    sc.add(sky);
    return sc;
  }

  update(dt: number, time: number, scroll: number, ship: THREE.Vector3, camera: THREE.Camera): void {
    this.flash *= Math.exp(-dt * 6);
    if (this.stage?.terrain === 'ocean' && Math.random() < dt * 0.08) this.flash = 1;
    for (const m of [this.terrainMat, this.oceanMat]) {
      m.uniforms.uScroll.value = scroll;
      m.uniforms.uShip.value.copy(ship);
      m.uniforms.uFlash.value = this.flash * 0.25;
    }
    this.oceanMat.uniforms.uTime.value = time;
    this.cloudMat.uniforms.uScroll.value = scroll;
    (this.aurora.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    this.stars.position.copy(camera.position);
    this.sky.position.copy(camera.position);
    if (this.rain.visible) {
      this.rain.position.z = ((time * 70) % 40) - 10;
      this.rain.position.x = camera.position.x;
    }
  }

  get lightningFlash(): number {
    return this.flash;
  }
}
