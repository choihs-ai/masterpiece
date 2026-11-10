/**
 * Procedural PBR models. Every craft is assembled from primitives, merged into two meshes
 * (painted metal + emissive lights) so each model costs two draw calls.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BossId, EnemyKind } from '../game/content';

type G = THREE.BufferGeometry;

function place(g: G, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): G {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  const out = g.index ? g.toNonIndexed() : g.clone();
  out.applyMatrix4(m);
  out.deleteAttribute('uv');
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  return out;
}

function merge(parts: G[]): G {
  const g = mergeGeometries(parts, false)!;
  g.computeBoundingSphere();
  return g;
}

/** Swept wing from a 2D outline, extruded thinly. */
function wing(points: [number, number][], thick = 0.12): G {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 1 });
  g.translate(0, 0, -thick / 2);
  return g;
}

export interface Model {
  group: THREE.Group;
  body: THREE.Mesh;
  glow: THREE.Mesh;
  glowMat: THREE.MeshStandardMaterial;
  bodyMat: THREE.MeshStandardMaterial;
  baseGlow: number;
  /** named sub-groups for animation (rotors, rings, turrets) */
  spin: THREE.Object3D[];
}

function build(body: G, glow: G, bodyMat: THREE.MeshStandardMaterial, glowColor: string, glowIntensity = 3): Model {
  const group = new THREE.Group();
  const glowMat = new THREE.MeshStandardMaterial({ color: '#000000', emissive: glowColor, emissiveIntensity: glowIntensity, roughness: 0.4 });
  const b = new THREE.Mesh(body, bodyMat);
  const gl = new THREE.Mesh(glow, glowMat);
  group.add(b, gl);
  return { group, body: b, glow: gl, glowMat, bodyMat, baseGlow: glowIntensity, spin: [] };
}

const dark = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: '#2b3038', metalness: 0.85, roughness: 0.32 });

/* ------------------------------------------------------------------ */
/* player                                                              */
/* ------------------------------------------------------------------ */

export function playerShip(accent: string): Model {
  // fuselage: lathe profile along the y axis, rotated so the nose points to -z
  const prof: THREE.Vector2[] = [
    [0, -3.2],
    [0.18, -2.7],
    [0.42, -1.6],
    [0.62, -0.2],
    [0.66, 0.9],
    [0.55, 1.8],
    [0.38, 2.3],
    [0, 2.35],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const fus = new THREE.LatheGeometry(prof, 14);
  const hull: G[] = [place(fus, 0, 0, 0, -Math.PI / 2, 0, 0, 1, 1, 0.75)];
  const wingG = wing([
    [0.3, 0.9],
    [3.6, 1.6],
    [3.9, 1.9],
    [3.6, 2.15],
    [0.4, 2.0],
  ]);
  hull.push(place(wingG, 0, -0.1, 0, Math.PI / 2, 0, 0.06));
  hull.push(place(wingG, 0, -0.1, 0, Math.PI / 2, Math.PI, -0.06));
  const canard = wing([
    [0.3, -1.5],
    [1.3, -1.0],
    [1.3, -0.8],
    [0.3, -0.7],
  ]);
  hull.push(place(canard, 0, 0.05, 0, Math.PI / 2, 0, 0));
  hull.push(place(canard, 0, 0.05, 0, Math.PI / 2, Math.PI, 0));
  const fin = wing([
    [0, 1.2],
    [1.3, 2.2],
    [1.3, 2.5],
    [0, 2.3],
  ], 0.08);
  hull.push(place(fin, 0.42, 0.3, 0, 0, Math.PI / 2, -0.35));
  hull.push(place(fin, -0.42, 0.3, 0, 0, Math.PI / 2, 0.35));
  const nacelle = new THREE.CylinderGeometry(0.34, 0.42, 2.2, 12);
  hull.push(place(nacelle, 1.05, -0.12, 1.3, Math.PI / 2, 0, 0));
  hull.push(place(nacelle, -1.05, -0.12, 1.3, Math.PI / 2, 0, 0));
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#dfe3ea', metalness: 0.55, roughness: 0.28 });
  // accents + engines + canopy rim are emissive
  const glow: G[] = [];
  const ring = new THREE.TorusGeometry(0.33, 0.08, 6, 16);
  glow.push(place(ring, 1.05, -0.12, 2.42));
  glow.push(place(ring, -1.05, -0.12, 2.42));
  const stripe = new THREE.BoxGeometry(2.9, 0.04, 0.12);
  glow.push(place(stripe, 2.2, -0.02, 1.62, 0, -0.2, 0.06));
  glow.push(place(stripe, -2.2, -0.02, 1.62, 0, 0.2, -0.06));
  glow.push(place(new THREE.SphereGeometry(0.1, 8, 6), 3.75, -0.0, 1.95));
  glow.push(place(new THREE.SphereGeometry(0.1, 8, 6), -3.75, -0.0, 1.95));
  const m = build(merge(hull), merge(glow), bodyMat, accent, 4);
  const canopyMat = new THREE.MeshPhysicalMaterial({ color: '#0d1830', metalness: 0.2, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.05 });
  const canopy = new THREE.Mesh(place(new THREE.SphereGeometry(0.5, 16, 10), 0, 0.42, -0.9, 0, 0, 0, 0.75, 0.55, 1.9), canopyMat);
  m.group.add(canopy);
  const trim = new THREE.Mesh(merge([place(new THREE.BoxGeometry(0.5, 0.36, 2.4), 0, -0.3, 0.1)]), dark());
  m.group.add(trim);
  return m;
}

/* ------------------------------------------------------------------ */
/* enemies                                                             */
/* ------------------------------------------------------------------ */

export function enemyModel(kind: EnemyKind, glow: string): Model {
  const body: G[] = [];
  const lit: G[] = [];
  const spinParts: G[] = [];
  switch (kind) {
    case 'wasp': {
      body.push(place(new THREE.IcosahedronGeometry(0.75, 1), 0, 0, 0, 0, 0, 0, 1, 0.8, 1.2));
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        body.push(place(new THREE.BoxGeometry(2.2, 0.06, 0.5), Math.cos(a) * 1.1, Math.sin(a) * 1.1, 0.2, 0, 0, a));
      }
      lit.push(place(new THREE.SphereGeometry(0.28, 10, 8), 0, 0, -0.85));
      break;
    }
    case 'hornet': {
      body.push(place(new THREE.ConeGeometry(0.55, 3.2, 6), 0, 0, 0, -Math.PI / 2));
      body.push(place(wing([
        [0, 0.6],
        [2.4, -0.8],
        [2.6, -0.4],
        [0, 1.4],
      ]), 0, 0, 0, Math.PI / 2, 0, 0.1));
      body.push(place(wing([
        [0, 0.6],
        [2.4, -0.8],
        [2.6, -0.4],
        [0, 1.4],
      ]), 0, 0, 0, Math.PI / 2, Math.PI, -0.1));
      lit.push(place(new THREE.BoxGeometry(4.6, 0.05, 0.12), 0, 0.02, 0.6));
      lit.push(place(new THREE.SphereGeometry(0.3, 10, 8), 0, 0, 1.5));
      break;
    }
    case 'lantern': {
      body.push(place(new THREE.OctahedronGeometry(1.6, 0), 0, 0, 0, 0, 0, 0, 1, 1.5, 1));
      spinParts.push(place(new THREE.TorusGeometry(2.4, 0.16, 6, 28), 0, 0, 0, Math.PI / 2));
      spinParts.push(place(new THREE.TorusGeometry(2.0, 0.12, 6, 24), 0, 0, 0, 0.3, 0.6));
      lit.push(place(new THREE.SphereGeometry(0.9, 16, 12)));
      break;
    }
    case 'mine': {
      body.push(place(new THREE.IcosahedronGeometry(1, 1)));
      for (let k = 0; k < 8; k++) {
        const v = new THREE.Vector3().randomDirection();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
        const e = new THREE.Euler().setFromQuaternion(q);
        body.push(place(new THREE.ConeGeometry(0.22, 0.9, 6), v.x * 1.1, v.y * 1.1, v.z * 1.1, e.x, e.y, e.z));
        lit.push(place(new THREE.SphereGeometry(0.1, 6, 4), v.x * 1.55, v.y * 1.55, v.z * 1.55));
      }
      break;
    }
    case 'turret': {
      body.push(place(new THREE.CylinderGeometry(1.5, 1.8, 0.8, 10), 0, -0.4, 0));
      body.push(place(new THREE.SphereGeometry(1.1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0, 0));
      body.push(place(new THREE.CylinderGeometry(0.16, 0.16, 2.2, 8), 0.4, 0.6, -0.9, -Math.PI / 2.6));
      body.push(place(new THREE.CylinderGeometry(0.16, 0.16, 2.2, 8), -0.4, 0.6, -0.9, -Math.PI / 2.6));
      lit.push(place(new THREE.BoxGeometry(1.2, 0.12, 0.12), 0, 0.5, -0.9));
      break;
    }
    case 'bulwark': {
      body.push(place(new THREE.BoxGeometry(5, 2, 6.5), 0, 0, 0));
      body.push(place(new THREE.BoxGeometry(3, 1.4, 3), 0, 1.5, 0.8));
      body.push(place(new THREE.CylinderGeometry(0.9, 1.1, 5.5, 10), 3.4, -0.3, 0.4, Math.PI / 2));
      body.push(place(new THREE.CylinderGeometry(0.9, 1.1, 5.5, 10), -3.4, -0.3, 0.4, Math.PI / 2));
      body.push(place(new THREE.ConeGeometry(2.6, 2.5, 4), 0, 0, -4.3, -Math.PI / 2, Math.PI / 4));
      for (let k = -2; k <= 2; k++) lit.push(place(new THREE.BoxGeometry(0.5, 0.18, 0.1), k * 0.9, 0.3, -3.27));
      lit.push(place(new THREE.TorusGeometry(0.75, 0.12, 6, 16), 3.4, -0.3, 3.2));
      lit.push(place(new THREE.TorusGeometry(0.75, 0.12, 6, 16), -3.4, -0.3, 3.2));
      break;
    }
  }
  const m = build(merge(body), merge(lit), dark(), glow, 3.5);
  if (spinParts.length) {
    const s = new THREE.Mesh(merge(spinParts), m.bodyMat);
    m.group.add(s);
    m.spin.push(s);
  }
  return m;
}

/* ------------------------------------------------------------------ */
/* bosses                                                              */
/* ------------------------------------------------------------------ */

export function bossModel(id: BossId, glow: string): Model {
  const body: G[] = [];
  const lit: G[] = [];
  const mat = new THREE.MeshStandardMaterial({ color: '#3a3f4a', metalness: 0.8, roughness: 0.38 });
  switch (id) {
    case 'colossus': {
      body.push(place(new THREE.BoxGeometry(12, 3.2, 14), 0, 0, 0));
      body.push(place(new THREE.ConeGeometry(6.4, 7, 4), 0, 0, -10, -Math.PI / 2, Math.PI / 4, 0, 1, 1, 0.5));
      body.push(place(new THREE.BoxGeometry(6, 2.2, 8), 0, 2.4, 1.5));
      body.push(place(new THREE.BoxGeometry(22, 0.8, 5), 0, -0.4, 2.5));
      for (const s of [-1, 1]) {
        body.push(place(new THREE.CylinderGeometry(1.4, 1.8, 9, 12), s * 5.2, -1.4, 3, Math.PI / 2));
        lit.push(place(new THREE.TorusGeometry(1.3, 0.2, 8, 20), s * 5.2, -1.4, 7.6));
      }
      for (let k = 0; k < 7; k++) lit.push(place(new THREE.BoxGeometry(0.7, 0.25, 0.1), -3 + k, 0.6, -7.06));
      lit.push(place(new THREE.SphereGeometry(1.2, 16, 12), 0, 0, -7.4));
      break;
    }
    case 'maelstrom': {
      body.push(place(new THREE.TorusGeometry(8, 1.1, 10, 48)));
      body.push(place(new THREE.TorusGeometry(10.2, 0.25, 6, 64)));
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        body.push(place(new THREE.BoxGeometry(0.4, 2.6, 0.6), Math.cos(a) * 9.1, Math.sin(a) * 9.1, 0, 0, 0, a));
      }
      body.push(place(new THREE.IcosahedronGeometry(3, 1)));
      lit.push(place(new THREE.TorusGeometry(8, 0.22, 6, 64), 0, 0, -1.05));
      lit.push(place(new THREE.SphereGeometry(1.8, 20, 14), 0, 0, -1.6));
      break;
    }
    case 'warden':
    default: {
      body.push(place(new THREE.OctahedronGeometry(3, 0), 0, 0, 0, 0, 0, 0, 1, 2.1, 1));
      body.push(place(new THREE.TorusGeometry(6.5, 0.18, 6, 64), 0, 0, 0, 0.2));
      body.push(place(new THREE.TorusGeometry(9.5, 0.12, 6, 64), 0, 0, 0, -0.3, 0.4));
      lit.push(place(new THREE.OctahedronGeometry(1.8, 0), 0, 0, -0.4, 0, 0, 0, 1, 2, 1));
      break;
    }
  }
  const m = build(merge(body), merge(lit), mat, glow, 4);
  if (id === 'warden') {
    m.bodyMat.color.set('#b8c6ff');
    m.bodyMat.metalness = 0.3;
    m.bodyMat.roughness = 0.08;
  }
  return m;
}

/** Destructible boss sub-parts. */
export function partModel(id: BossId, glow: string): Model {
  const body: G[] = [];
  const lit: G[] = [];
  if (id === 'colossus') {
    body.push(place(new THREE.SphereGeometry(1.6, 16, 10)));
    body.push(place(new THREE.CylinderGeometry(0.3, 0.3, 3.4, 8), 0.5, 0, -1.7, Math.PI / 2));
    body.push(place(new THREE.CylinderGeometry(0.3, 0.3, 3.4, 8), -0.5, 0, -1.7, Math.PI / 2));
    lit.push(place(new THREE.SphereGeometry(0.45, 10, 8), 0, 0.2, -1.5));
  } else if (id === 'maelstrom') {
    body.push(place(new THREE.CylinderGeometry(1.3, 1.6, 2.4, 8), 0, 0, 0, Math.PI / 2));
    lit.push(place(new THREE.TorusGeometry(1.05, 0.2, 8, 20), 0, 0, -1.25));
    lit.push(place(new THREE.SphereGeometry(0.55, 10, 8), 0, 0, -1.2));
  } else {
    body.push(place(new THREE.OctahedronGeometry(1.2, 0), 0, 0, 0, 0, 0, 0, 0.8, 1.9, 0.8));
    lit.push(place(new THREE.OctahedronGeometry(0.55, 0), 0, 0, -0.2, 0, 0, 0, 1, 2, 1));
  }
  const m = build(merge(body), merge(lit), id === 'warden'
    ? new THREE.MeshStandardMaterial({ color: '#c8d4ff', metalness: 0.3, roughness: 0.08 })
    : new THREE.MeshStandardMaterial({ color: '#4a505c', metalness: 0.8, roughness: 0.35 }), glow, 4);
  return m;
}
