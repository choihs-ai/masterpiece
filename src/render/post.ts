/** Post-processing: bloom + a final pass (shockwave ripples, chromatic aberration, glitch, flash, vignette, grain). */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uAberration: { value: 0 },
    uGlitch: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(1, 1, 1) },
    uVignette: { value: 0.35 },
    uDim: { value: 0 },
    uRipples: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uAspect;
    uniform float uAberration;
    uniform float uGlitch;
    uniform float uFlash;
    uniform vec3 uFlashColor;
    uniform float uVignette;
    uniform float uDim;
    uniform vec4 uRipples[4];
    varying vec2 vUv;

    float hash(float n) { return fract(sin(n) * 43758.5453); }

    void main() {
      vec2 uv = vUv;
      for (int i = 0; i < 4; i++) {
        vec4 r = uRipples[i];
        if (r.w <= 0.0) continue;
        vec2 d = uv - r.xy;
        d.x *= uAspect;
        float dist = length(d);
        float radius = r.z * 0.85;
        float wv = dist - radius;
        float amt = exp(-wv * wv * 220.0) * r.w * (1.0 - r.z);
        vec2 dir = dist > 1e-4 ? d / dist : vec2(0.0);
        uv -= vec2(dir.x / uAspect, dir.y) * amt * 0.028;
      }
      if (uGlitch > 0.001) {
        float band = floor(uv.y * 28.0);
        float n = hash(band * 91.7 + floor(uTime * 24.0) * 13.1);
        if (n > 0.62) uv.x += (n - 0.81) * 0.07 * uGlitch;
      }
      vec2 dir = uv - 0.5;
      float ca = uAberration * 0.011 + 0.0007;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * ca).b;
      float v = smoothstep(1.0, 0.3, length(dir * vec2(uAspect * 0.72, 1.0)));
      col *= mix(1.0 - uVignette, 1.0, v);
      col = mix(col, uFlashColor, uFlash * 0.42) + uFlashColor * uFlash * 0.25;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(l) * 0.45, uDim * 0.65);
      float g = hash(dot(uv, vec2(12.9898, 78.233)) + fract(uTime) * 61.0);
      col += (g - 0.5) * 0.022;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

export class Post {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly final: ShaderPass;
  bloomScale = 0.5;
  baseStrength = 0.95;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const ext = renderer.extensions;
    const hdr = ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float');
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), this.baseStrength, 0.5, 0.78);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());
  }

  get u(): (typeof FinalShader)['uniforms'] {
    return this.final.uniforms as unknown as (typeof FinalShader)['uniforms'];
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.bloom.setSize(Math.max(1, Math.round(w * pixelRatio * this.bloomScale)), Math.max(1, Math.round(h * pixelRatio * this.bloomScale)));
    this.u.uAspect.value = w / Math.max(1, h);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }
}
