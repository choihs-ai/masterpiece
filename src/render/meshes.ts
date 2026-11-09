/**
 * Procedural neon models: dark glassy fills with thick glowing edges (LineSegments2).
 * No external assets — every ship, enemy and boss is built from primitives here.
 */
import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { BossId, EnemyId } from '../game/ids';

/** Registry so line widths can follow the viewport size. */
export const lineMaterials = new Set<LineMaterial>();
let lineScale = 2;
let resW = 1;
let resH = 1;

export function setLineViewport(w: number, h: number, pxPerUnit: number): void {
  resW = w;
  resH = h;
  lineScale = Math.max(1.4, Math.min(5, pxPerUnit * 0.2));
  for (const m of lineMaterials) {
    m.resolution.set(w, h);
    m.linewidth = lineScale * ((m.userData.w as number) ?? 1);
  }
}

export function lineMat(color: THREE.ColorRepresentation, width = 1): LineMaterial {
  const m = new LineMaterial({ color: new THREE.Color(color), linewidth: lineScale * width, transparent: true, depthWrite: false });
  m.userData.w = width;
  m.resolution.set(resW, resH);
  lineMaterials.add(m);
  return m;
}

export function disposeLineMat(m: LineMaterial): void {
  lineMaterials.delete(m);
  m.dispose();
}

const edgeCache = new Map<string, LineSegmentsGeometry>();

function edges(key: string, g: THREE.BufferGeometry, angle = 1): LineSegmentsGeometry {
  const cached = edgeCache.get(key);
  if (cached) return cached;
  const e = new THREE.EdgesGeometry(g, angle);
  const lg = new LineSegmentsGeometry().setPositions(e.attributes.position.array as Float32Array);
  e.dispose();
  edgeCache.set(key, lg);
  return lg;
}

/** A neon part: dark fill + bright edges sharing one transform. */
export class Part {
  readonly obj = new THREE.Group();
  readonly fill: THREE.Mesh;
  readonly line: LineSegments2;
  readonly lineMat: LineMaterial;
  readonly fillMat: THREE.MeshBasicMaterial;

  constructor(key: string, geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, width = 1, fillAlpha = 0.88) {
    this.fillMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.1), transparent: true, opacity: fillAlpha, depthWrite: true });
    this.fill = new THREE.Mesh(geo, this.fillMat);
    this.lineMat = lineMat(color, width);
    this.line = new LineSegments2(edges(key, geo), this.lineMat);
    this.line.frustumCulled = false;
    this.fill.frustumCulled = false;
    this.obj.add(this.fill, this.line);
  }

  setColor(c: THREE.Color, flash: number): void {
    this.lineMat.color.copy(c).lerp(WHITE, flash);
    this.fillMat.color.copy(c).multiplyScalar(0.1 + flash * 0.5);
  }

  dispose(): void {
    disposeLineMat(this.lineMat);
    this.fillMat.dispose();
  }
}

const WHITE = new THREE.Color(1, 1, 1);
const geoCache = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

/* ------------------------------------------------------------------ */
/* Player ship                                                         */
/* ------------------------------------------------------------------ */

export function shipGeometry(): THREE.BufferGeometry {
  return geo('ship', () => {
    const s = new THREE.Shape();
    s.moveTo(0, 2.9);
    s.lineTo(0.55, 0.9);
    s.lineTo(2.1, -1.5);
    s.lineTo(1.9, -2.0);
    s.lineTo(0.65, -1.15);
    s.lineTo(0, -1.6);
    s.lineTo(-0.65, -1.15);
    s.lineTo(-1.9, -2.0);
    s.lineTo(-2.1, -1.5);
    s.lineTo(-0.55, 0.9);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.7, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.22, bevelSegments: 1 });
    g.translate(0, 0, -0.35);
    return g;
  });
}

export class ShipView {
  readonly obj = new THREE.Group();
  readonly hull: Part;
  readonly canopy: Part;

  constructor(color: string, scale = 1) {
    this.hull = new Part('ship', shipGeometry(), color, 1.1, 0.92);
    const cg = geo('canopy', () => new THREE.OctahedronGeometry(0.55).scale(0.7, 1.4, 0.6));
    this.canopy = new Part('canopy', cg, '#ffffff', 0.8, 0.6);
    this.canopy.obj.position.set(0, 0.6, 0.5);
    this.obj.add(this.hull.obj, this.canopy.obj);
    this.obj.scale.setScalar(scale);
  }

  setColor(c: THREE.Color): void {
    this.hull.setColor(c, 0);
  }
}

/* ------------------------------------------------------------------ */
/* Enemies                                                             */
/* ------------------------------------------------------------------ */

function enemyGeometry(kind: EnemyId): { key: string; g: THREE.BufferGeometry }[] {
  switch (kind) {
    case 'dart':
      return [{ key: 'dart', g: geo('dart', () => new THREE.ConeGeometry(1.5, 3.4, 3).rotateX(Math.PI)) }];
    case 'weaver':
      return [{ key: 'weaver', g: geo('weaver', () => new THREE.IcosahedronGeometry(1.9, 0)) }];
    case 'mine': {
      const a = geo('mineA', () => new THREE.TetrahedronGeometry(1.8));
      const b = geo('mineB', () => new THREE.TetrahedronGeometry(1.8).rotateY(Math.PI / 2).rotateX(Math.PI));
      return [
        { key: 'mineA', g: a },
        { key: 'mineB', g: b },
      ];
    }
    case 'sentinel':
      return [
        { key: 'sentinel', g: geo('sentinel', () => new THREE.OctahedronGeometry(2.4).scale(1, 1.35, 1)) },
        { key: 'sentinelCore', g: geo('sentinelCore', () => new THREE.OctahedronGeometry(0.9)) },
      ];
    case 'lancer':
      return [{ key: 'lancer', g: geo('lancer', () => new THREE.OctahedronGeometry(1.5).scale(0.6, 1.9, 0.6)) }];
    case 'spinner':
      return [
        { key: 'spinner', g: geo('spinner', () => new THREE.TorusGeometry(2.3, 0.55, 5, 10)) },
        { key: 'spinnerCore', g: geo('spinnerCore', () => new THREE.IcosahedronGeometry(0.9, 0)) },
      ];
    case 'sniper':
      return [
        { key: 'sniper', g: geo('sniper', () => new THREE.TorusGeometry(2.1, 0.32, 4, 14)) },
        { key: 'sniperEye', g: geo('sniperEye', () => new THREE.OctahedronGeometry(1.0)) },
      ];
    case 'splitter':
      return [{ key: 'splitter', g: geo('splitter', () => new THREE.DodecahedronGeometry(2.6)) }];
    case 'bulwark':
      return [
        { key: 'bulwark', g: geo('bulwark', () => new THREE.BoxGeometry(4.4, 4.4, 4.4)) },
        { key: 'bulwarkRing', g: geo('bulwarkRing', () => new THREE.TorusGeometry(4.2, 0.25, 3, 24)) },
      ];
    case 'carrier':
    default:
      return [
        { key: 'carrier', g: geo('carrier', () => new THREE.CylinderGeometry(4.2, 4.2, 1.8, 6).rotateX(Math.PI / 2)) },
        { key: 'carrierPod', g: geo('carrierPod', () => new THREE.OctahedronGeometry(1.4).scale(1, 1.6, 1)) },
      ];
  }
}

export class EnemyView {
  readonly obj = new THREE.Group();
  readonly parts: Part[] = [];
  readonly elite: Part | null = null;
  kind: EnemyId;

  constructor(kind: EnemyId, color: string, elite: boolean) {
    this.kind = kind;
    const gs = enemyGeometry(kind);
    gs.forEach(({ key, g }, i) => {
      const p = new Part(key, g, color, i === 0 ? 1 : 0.8);
      this.parts.push(p);
      this.obj.add(p.obj);
    });
    if (kind === 'carrier' && this.parts[1]) {
      const pod2 = new Part('carrierPod', gs[1].g, color, 0.8);
      this.parts.push(pod2);
      this.obj.add(pod2.obj);
      this.parts[1].obj.position.set(-4.4, 0, 0);
      pod2.obj.position.set(4.4, 0, 0);
    }
    if (elite) {
      const e = new Part(gs[0].key, gs[0].g, '#ffd75e', 0.7, 0);
      e.obj.scale.setScalar(1.25);
      (this as { elite: Part | null }).elite = e;
      this.obj.add(e.obj);
    }
  }

  animate(t: number, spin: number, color: THREE.Color, flash: number): void {
    for (const p of this.parts) p.setColor(color, flash);
    const [a, b] = this.parts;
    switch (this.kind) {
      case 'dart':
        a.obj.rotation.set(0, spin, 0);
        break;
      case 'lancer':
        this.obj.rotation.z = spin;
        a.obj.rotation.y = t * 4;
        break;
      case 'mine':
        a.obj.rotation.set(spin, spin * 0.7, 0);
        b.obj.rotation.set(-spin * 0.6, spin, 0);
        break;
      case 'spinner':
        a.obj.rotation.set(0.4, 0, spin * 2);
        b.obj.rotation.set(spin, spin, 0);
        break;
      case 'sniper':
        a.obj.rotation.set(Math.sin(t) * 0.3, 0, spin);
        b.obj.rotation.set(0, spin * 3, 0);
        break;
      case 'bulwark':
        a.obj.rotation.set(spin * 0.6, spin, 0.3);
        b.obj.rotation.set(1.2, 0, spin * 2);
        break;
      case 'carrier':
        a.obj.rotation.set(0, 0, spin);
        if (this.parts[1]) this.parts[1].obj.rotation.y = t * 2;
        if (this.parts[2]) this.parts[2].obj.rotation.y = -t * 2;
        break;
      default:
        a.obj.rotation.set(spin * 0.8, spin, 0);
        if (b) b.obj.rotation.set(-spin * 1.5, spin * 2, 0);
        break;
    }
    if (this.elite) {
      this.elite.obj.rotation.copy(a.obj.rotation);
      this.elite.lineMat.opacity = 0.6 + 0.4 * Math.sin(t * 8);
    }
  }

  dispose(): void {
    for (const p of this.parts) p.dispose();
    this.elite?.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* Bosses                                                              */
/* ------------------------------------------------------------------ */

export class BossView {
  readonly obj = new THREE.Group();
  readonly parts: Part[] = [];
  private sats: Part[] = [];
  private chains: THREE.Group[] = [];

  constructor(
    readonly id: BossId,
    colorA: string,
    colorB: string,
  ) {
    const add = (p: Part): Part => {
      this.parts.push(p);
      this.obj.add(p.obj);
      return p;
    };
    switch (id) {
      case 'herald': {
        add(new Part('heraldCore', geo('heraldCore', () => new THREE.OctahedronGeometry(4.6)), colorA, 1.4));
        add(new Part('heraldInner', geo('heraldInner', () => new THREE.OctahedronGeometry(2)), colorB, 1));
        for (let i = 0; i < 4; i++) {
          const w = new Part('heraldWing', geo('heraldWing', () => new THREE.ConeGeometry(1.4, 4.2, 3)), colorB, 1);
          this.sats.push(w);
          this.obj.add(w.obj);
        }
        break;
      }
      case 'tidecaller': {
        add(new Part('tideRing', geo('tideRing', () => new THREE.TorusGeometry(5.2, 0.9, 6, 18)), colorA, 1.3));
        add(new Part('tideCore', geo('tideCore', () => new THREE.IcosahedronGeometry(2.6, 0)), colorB, 1.1));
        for (let c = 0; c < 6; c++) {
          const chain = new THREE.Group();
          for (let k = 0; k < 5; k++) {
            const bead = new Part('tideBead', geo('tideBead', () => new THREE.IcosahedronGeometry(0.55, 0)), colorB, 0.7);
            bead.obj.position.y = -k * 1.5;
            chain.add(bead.obj);
            this.sats.push(bead);
          }
          this.chains.push(chain);
          this.obj.add(chain);
        }
        break;
      }
      case 'archon': {
        add(new Part('archonCore', geo('archonCore', () => new THREE.OctahedronGeometry(3.4).scale(0.8, 2.1, 0.8)), colorA, 1.4));
        add(new Part('archonHalo', geo('archonHalo', () => new THREE.TorusGeometry(6, 0.18, 3, 36)), colorB, 0.9));
        for (let i = 0; i < 6; i++) {
          const s = new Part('archonSat', geo('archonSat', () => new THREE.OctahedronGeometry(1).scale(0.6, 1.7, 0.6)), colorB, 0.9);
          this.sats.push(s);
          this.obj.add(s.obj);
        }
        break;
      }
      case 'tyrant': {
        add(new Part('tyrantCore', geo('tyrantCore', () => new THREE.IcosahedronGeometry(5.6, 1)), colorA, 1.3));
        add(new Part('tyrantCorona', geo('tyrantCorona', () => new THREE.TorusGeometry(7.6, 0.3, 3, 40)), colorB, 1));
        for (let i = 0; i < 8; i++) {
          const s = new Part('tyrantSpike', geo('tyrantSpike', () => new THREE.ConeGeometry(0.9, 3.6, 4)), colorB, 0.9);
          this.sats.push(s);
          this.obj.add(s.obj);
        }
        break;
      }
      case 'silence':
      default: {
        const core = add(new Part('silenceCore', geo('silenceCore', () => new THREE.IcosahedronGeometry(5.2, 2)), colorA, 0.9, 1));
        core.fillMat.color.set('#000000');
        add(new Part('silenceDisk', geo('silenceDisk', () => new THREE.TorusGeometry(9, 0.25, 3, 48)), colorB, 1.2));
        add(new Part('silenceDisk2', geo('silenceDisk2', () => new THREE.TorusGeometry(11.5, 0.15, 3, 48)), colorA, 0.8));
        for (let i = 0; i < 6; i++) {
          const s = new Part('silenceShard', geo('silenceShard', () => new THREE.TetrahedronGeometry(1.2)), colorB, 0.9);
          this.sats.push(s);
          this.obj.add(s.obj);
        }
        break;
      }
    }
  }

  animate(t: number, phase: number, colA: THREE.Color, colB: THREE.Color, flash: number, rage: number): void {
    const [a, b, c] = this.parts;
    a.setColor(colA, flash);
    if (b) b.setColor(colB, flash * 0.5);
    if (c) c.setColor(colA, flash * 0.5);
    for (const s of this.sats) s.setColor(colB, flash * 0.4);
    const sp = 1 + phase * 0.5 + rage;
    switch (this.id) {
      case 'herald': {
        a.obj.rotation.set(t * 0.4 * sp, t * 0.7 * sp, 0);
        b.obj.rotation.set(-t * 1.3, t * 1.1, 0);
        this.sats.forEach((s, i) => {
          const ang = t * 0.9 * sp + (i * Math.PI) / 2;
          s.obj.position.set(Math.cos(ang) * 7.2, Math.sin(ang) * 7.2, 0);
          s.obj.rotation.set(0, t * 2, ang - Math.PI / 2);
        });
        break;
      }
      case 'tidecaller': {
        a.obj.rotation.set(1.1 + Math.sin(t * 0.5) * 0.2, 0, t * 0.6 * sp);
        b.obj.rotation.set(t * 0.8, t, 0);
        this.chains.forEach((ch, i) => {
          const ang = (i / this.chains.length) * Math.PI * 2 + t * 0.25;
          ch.position.set(Math.cos(ang) * 5.2, Math.sin(ang) * 1.4 - 2.4, 0);
          ch.children.forEach((bead, k) => {
            bead.position.x = Math.sin(t * 2.2 + k * 0.7 + i) * (0.4 + k * 0.45);
            bead.rotation.set(t * 2, t, 0);
          });
        });
        break;
      }
      case 'archon': {
        a.obj.rotation.set(0, t * 0.8 * sp, Math.sin(t * 0.6) * 0.15);
        b.obj.rotation.set(1.3 + Math.sin(t * 0.7) * 0.2, 0, t * 0.4);
        this.sats.forEach((s, i) => {
          const ang = -t * 0.7 * sp + (i / 6) * Math.PI * 2;
          s.obj.position.set(Math.cos(ang) * 8.4, Math.sin(ang) * 3 + 1, Math.sin(ang) * 2);
          s.obj.rotation.set(0, t * 3, 0);
        });
        break;
      }
      case 'tyrant': {
        const pulse = 1 + Math.sin(t * 6) * 0.04 * sp;
        a.obj.scale.setScalar(pulse);
        a.obj.rotation.set(t * 0.3, t * 0.45 * sp, 0);
        b.obj.rotation.set(0, 0, t * 0.5);
        b.obj.scale.setScalar(1 + Math.sin(t * 3) * 0.06);
        this.sats.forEach((s, i) => {
          const ang = t * 0.35 * sp + (i / 8) * Math.PI * 2;
          const r = 7.4 + Math.sin(t * 5 + i) * 0.6;
          s.obj.position.set(Math.cos(ang) * r, Math.sin(ang) * r, 0);
          s.obj.rotation.set(0, 0, ang - Math.PI / 2);
        });
        break;
      }
      default: {
        a.obj.rotation.set(t * 0.2, t * 0.3, 0);
        a.lineMat.opacity = 0.5 + 0.3 * Math.sin(t * 3);
        b.obj.rotation.set(1.25, 0, t * 0.8 * sp);
        if (c) c.obj.rotation.set(1.3, 0.2, -t * 0.5 * sp);
        this.sats.forEach((s, i) => {
          const ang = t * 1.2 * sp + (i / 6) * Math.PI * 2;
          s.obj.position.set(Math.cos(ang) * 10.5, Math.sin(ang) * 2.6, Math.sin(ang) * 3);
          s.obj.rotation.set(t * 3, t * 2, 0);
        });
        break;
      }
    }
  }

  dispose(): void {
    for (const p of this.parts) p.dispose();
    for (const s of this.sats) s.dispose();
  }
}
