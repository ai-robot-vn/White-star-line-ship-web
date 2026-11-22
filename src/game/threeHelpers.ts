import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const MathUtils = THREE.MathUtils;

export function colorFromHex(hex: number, out?: THREE.Color): THREE.Color {
  const target = out ?? new THREE.Color();
  target.setHex(hex, THREE.SRGBColorSpace);
  return target;
}

export function setEulerXYZ(obj: THREE.Object3D, x: number, y: number, z: number): void {
  obj.rotation.order = 'XYZ';
  obj.rotation.set(x, y, z);
}

/**
 * Lightweight 2D shape helper matching Three.js Shape for clean extruded hulls,
 * rudders, anchors, blades, and fracture bulkheads.
 */
export class Shape2D {
  public readonly shape = new THREE.Shape();

  public moveTo(x: number, y: number): void {
    this.shape.moveTo(x, y);
  }

  public lineTo(x: number, y: number): void {
    this.shape.lineTo(x, y);
  }

  public quadraticCurveTo(cx: number, cy: number, x: number, y: number, _segs = 10): void {
    this.shape.quadraticCurveTo(cx, cy, x, y);
  }

  public closePath(): void {
    this.shape.closePath();
  }
}

export interface MakePBROptions {
  color?: number;
  emissive?: number;
  emissiveIntensity?: number;
  metallic?: number;
  roughness?: number;
  alpha?: number;
  albedoTex?: THREE.Texture | null;
  bumpTex?: THREE.Texture | null;
  bumpLevel?: number;
  roughnessTex?: THREE.Texture | null;
  emissiveTex?: THREE.Texture | null;
  alphaCutOff?: number;
  doubleSided?: boolean;
  envIntensity?: number;
  anisotropy?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  polygonOffset?: boolean;
  polygonOffsetFactor?: number;
  polygonOffsetUnits?: number;
}

export function makePBR(name: string, opts: MakePBROptions = {}): THREE.MeshPhysicalMaterial {
  const alpha = opts.alpha ?? 1.0;
  const isTransparent = alpha < 0.999;

  const mat = new THREE.MeshPhysicalMaterial({
    name,
    color: opts.color !== undefined ? colorFromHex(opts.color) : new THREE.Color(1, 1, 1),
    emissive: opts.emissive !== undefined ? colorFromHex(opts.emissive) : new THREE.Color(0, 0, 0),
    emissiveIntensity: opts.emissiveIntensity ?? (opts.emissive !== undefined ? 1.0 : 0.0),
    metalness: opts.metallic ?? 0.08,
    roughness: opts.roughness ?? 0.65,
    map: opts.albedoTex ?? null,
    normalMap: opts.bumpTex ?? null,
    normalScale: new THREE.Vector2(
      opts.bumpTex ? (opts.bumpLevel ?? 1.0) : 1.0,
      opts.bumpTex ? (opts.bumpLevel ?? 1.0) : 1.0,
    ),
    roughnessMap: opts.roughnessTex ?? null,
    emissiveMap: opts.emissiveTex ?? null,
    opacity: alpha,
    transparent: isTransparent,
    alphaTest: opts.alphaCutOff ?? 0,
    side: opts.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    envMapIntensity: opts.envIntensity ?? 0.45,
    anisotropy: opts.anisotropy ?? 0,
    clearcoat: opts.clearcoat ?? 0,
    clearcoatRoughness: opts.clearcoatRoughness ?? 0.35,
    polygonOffset: opts.polygonOffset ?? false,
    polygonOffsetFactor: opts.polygonOffsetFactor ?? 0,
    polygonOffsetUnits: opts.polygonOffsetUnits ?? 0,
  });

  if (isTransparent) {
    mat.depthWrite = false;
  }
  return mat;
}

export function makeUnlitColorMat(name: string, hex: number, opacity = 1.0): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    name,
    color: colorFromHex(hex),
    transparent: opacity < 0.999,
    opacity,
    depthWrite: opacity >= 0.999,
  });
}

/**
 * Generates an organic maritime sky-horizon-ocean PMREM environment texture so
 * metallic steel, brass, and glass catch realistic Atlantic horizon reflections
 * without harsh uniform glare hotspots.
 */
export function createNorthAtlanticEnvironment(renderer: THREE.WebGLRenderer): {
  envMap: THREE.Texture;
  dispose: () => void;
} {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();

  const skyGeo = new THREE.SphereGeometry(40, 32, 24);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {},
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 zenith = vec3(0.14, 0.27, 0.44);
        vec3 horizon = vec3(0.46, 0.56, 0.66);
        vec3 seaDeep = vec3(0.04, 0.08, 0.13);
        vec3 seaHoriz = vec3(0.16, 0.24, 0.32);

        vec3 col;
        if (y >= 0.0) {
          float h = pow(1.0 - clamp(y, 0.0, 1.0), 2.8);
          col = mix(zenith, horizon, h);
          // Soft broad cloud/sunlight bounce (no tight blinding spot)
          vec3 keyDir = normalize(vec3(0.32, 0.44, -0.84));
          float sunGlow = pow(max(dot(d, keyDir), 0.0), 6.0);
          col += vec3(0.28, 0.25, 0.20) * sunGlow;
        } else {
          float dSea = smoothstep(0.0, -0.45, y);
          col = mix(seaHoriz, seaDeep, dSea);
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  envScene.add(skyDome);

  const rt = pmrem.fromScene(envScene, 0.04);
  skyGeo.dispose();
  skyMat.dispose();
  pmrem.dispose();

  return {
    envMap: rt.texture,
    dispose: () => {
      rt.dispose();
    },
  };
}

export function bakeTransform(mesh: THREE.Mesh): void {
  mesh.updateMatrix();
  mesh.geometry.applyMatrix4(mesh.matrix);
  mesh.position.set(0, 0, 0);
  mesh.rotation.set(0, 0, 0);
  mesh.scale.set(1, 1, 1);
  mesh.updateMatrix();
}

export function buildBox(name: string, w: number, h: number, d: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo);
  mesh.name = name;
  return mesh;
}

export function buildCylinder(
  name: string,
  topR: number,
  botR: number,
  height: number,
  segs = 14,
  openEnded = false,
  arcFrac = 1.0,
): THREE.Mesh {
  const thetaLen = arcFrac < 0.999 ? Math.PI * 2 * arcFrac : Math.PI * 2;
  const geo = new THREE.CylinderGeometry(
    topR,
    botR,
    height,
    Math.max(3, segs),
    1,
    openEnded,
    0,
    thetaLen,
  );
  const mesh = new THREE.Mesh(geo);
  mesh.name = name;
  return mesh;
}

export function buildCapsule(
  name: string,
  radius: number,
  totalHeight: number,
  radialSegs = 8,
): THREE.Mesh {
  const cylLen = Math.max(0.01, totalHeight - radius * 2);
  const geo = new THREE.CapsuleGeometry(radius, cylLen, 4, Math.max(4, radialSegs));
  const mesh = new THREE.Mesh(geo);
  mesh.name = name;
  return mesh;
}

export function createCanvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  opts?: { wrap?: boolean; repeatU?: number; repeatV?: number; srgb?: boolean },
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    draw(ctx);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = opts?.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opts?.wrap) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(opts.repeatU ?? 1, opts.repeatV ?? 1);
  } else {
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
  }
  tex.needsUpdate = true;
  return tex;
}

export function buildSphere(
  name: string,
  radius: number,
  widthSegs = 12,
  heightSegs = 10,
  arcVert = 1.0,
): THREE.Mesh {
  const thetaLength = arcVert < 0.99 ? Math.PI * arcVert : Math.PI;
  const geo = new THREE.SphereGeometry(
    radius,
    Math.max(4, widthSegs),
    Math.max(3, heightSegs),
    0,
    Math.PI * 2,
    0,
    thetaLength,
  );
  const mesh = new THREE.Mesh(geo);
  mesh.name = name;
  return mesh;
}

export function buildPlane(name: string, w: number, h: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(w, h);
  const mesh = new THREE.Mesh(geo);
  mesh.name = name;
  return mesh;
}

export function buildDisc(name: string, radius: number, segs = 18): THREE.Mesh {
  const geo = new THREE.CircleGeometry(radius, Math.max(6, segs));
  const mesh = new THREE.Mesh(geo);
  mesh.name = name;
  return mesh;
}

export function buildTorusXY(
  name: string,
  majorR: number,
  tubeR: number,
  radialSegs = 8,
  tubularSegs = 22,
  arc = Math.PI * 2,
): THREE.Mesh {
  const geo = new THREE.TorusGeometry(
    majorR,
    tubeR,
    Math.max(3, radialSegs),
    Math.max(6, tubularSegs),
    arc,
  );
  const mesh = new THREE.Mesh(geo);
  mesh.name = name;
  return mesh;
}

export function buildLatheMesh(
  name: string,
  pts: THREE.Vector2[],
  segs = 16,
): THREE.Mesh {
  const geo = new THREE.LatheGeometry(pts, Math.max(6, segs));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo);
  mesh.name = name;
  return mesh;
}

export function buildTubeMesh(
  name: string,
  pts: THREE.Vector3[],
  tubularSegs: number,
  radius: number,
  radialSegs = 8,
  catmull = true,
): THREE.Mesh {
  let curve: THREE.Curve<THREE.Vector3>;
  if (pts.length === 2 && !catmull) {
    curve = new THREE.LineCurve3(pts[0], pts[1]);
  } else {
    curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.35);
  }
  const geo = new THREE.TubeGeometry(curve, Math.max(1, tubularSegs), radius, Math.max(4, radialSegs), false);
  const mesh = new THREE.Mesh(geo);
  mesh.name = name;
  return mesh;
}

export function buildExtrudedShapeMesh(
  name: string,
  shape2d: Shape2D,
  depth: number,
  bevel = 0,
): THREE.Mesh {
  const hasBevel = bevel > 0.001;
  const geo = new THREE.ExtrudeGeometry(shape2d.shape, {
    depth: Math.max(0.01, depth - (hasBevel ? bevel * 0.5 : 0)),
    bevelEnabled: hasBevel,
    bevelThickness: hasBevel ? bevel * 0.6 : 0,
    bevelSize: hasBevel ? bevel * 0.6 : 0,
    bevelSegments: hasBevel ? 2 : 0,
    curveSegments: 10,
  });
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo);
  mesh.name = name;
  return mesh;
}

export interface MergePartSpec {
  mesh: THREE.Mesh;
  tx?: number;
  ty?: number;
  tz?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

export function bakeAndMergeMeshes(name: string, parts: MergePartSpec[]): THREE.Mesh {
  const geos: THREE.BufferGeometry[] = [];
  const mat4 = new THREE.Matrix4();
  const euler = new THREE.Euler(0, 0, 0, 'XYZ');
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();

  for (const p of parts) {
    const g = p.mesh.geometry.index ? p.mesh.geometry.toNonIndexed() : p.mesh.geometry.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      const count = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    // Keep only position, normal, uv so mergeGeometries never rejects attribute mismatches
    for (const key of Object.keys(g.attributes)) {
      if (key !== 'position' && key !== 'normal' && key !== 'uv') {
        g.deleteAttribute(key);
      }
    }
    pos.set(p.tx ?? 0, p.ty ?? 0, p.tz ?? 0);
    euler.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0, 'XYZ');
    quat.setFromEuler(euler);
    scale.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
    mat4.compose(pos, quat, scale);
    g.applyMatrix4(mat4);
    geos.push(g);
  }

  const merged = mergeGeometries(geos, false) ?? new THREE.BoxGeometry(0.1, 0.1, 0.1);
  for (const g of geos) g.dispose();

  const out = new THREE.Mesh(merged);
  out.name = name;
  return out;
}

/**
 * InstancedMesh wrapper replacing Babylon ThinInstance slots with pre-allocated,
 * zero-GC matrix & color updates. Always sets frustumCulled = false for dynamic spreads.
 */
export interface InstancedSlot {
  mesh: THREE.InstancedMesh;
  count: number;
}

const _instPos = new THREE.Vector3();
const _instQuat = new THREE.Quaternion();
const _instEuler = new THREE.Euler(0, 0, 0, 'XYZ');
const _instScale = new THREE.Vector3();
const _instMat4 = new THREE.Matrix4();
const _instColor = new THREE.Color();

export function createInstancedSlot(
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  count: number,
  withColor = false,
  parent?: THREE.Object3D,
): InstancedSlot {
  const safeCount = Math.max(1, count);
  const im = new THREE.InstancedMesh(geometry, material, safeCount);
  im.name = name;
  im.frustumCulled = false;
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  if (withColor) {
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < safeCount; i++) {
      im.setColorAt(i, white);
    }
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }

  // Initialize hidden (zero scale) until populated
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < safeCount; i++) {
    im.setMatrixAt(i, zero);
  }
  im.instanceMatrix.needsUpdate = true;

  if (parent) parent.add(im);
  return { mesh: im, count: safeCount };
}

export function writeInstanceMatrix(
  slot: InstancedSlot,
  idx: number,
  tx: number,
  ty: number,
  tz: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
): void {
  _instPos.set(tx, ty, tz);
  _instEuler.set(rx, ry, rz, 'XYZ');
  _instQuat.setFromEuler(_instEuler);
  _instScale.set(sx, sy, sz);
  _instMat4.compose(_instPos, _instQuat, _instScale);
  slot.mesh.setMatrixAt(idx, _instMat4);
}

export function writeZeroInstanceMatrix(slot: InstancedSlot, idx: number): void {
  _instMat4.makeScale(0, 0, 0);
  slot.mesh.setMatrixAt(idx, _instMat4);
}

export function setInstanceColorHex(slot: InstancedSlot, idx: number, hex: number): void {
  _instColor.setHex(hex, THREE.SRGBColorSpace);
  slot.mesh.setColorAt(idx, _instColor);
}

export function commitInstanceMatrices(slot: InstancedSlot, activeCount?: number): void {
  if (activeCount !== undefined) {
    slot.mesh.count = Math.min(slot.count, Math.max(0, activeCount));
  }
  slot.mesh.instanceMatrix.needsUpdate = true;
}

export function commitInstanceColors(slot: InstancedSlot): void {
  if (slot.mesh.instanceColor) {
    slot.mesh.instanceColor.needsUpdate = true;
  }
}

export function cloneMeshWithMaterial(
  proto: THREE.Mesh,
  name: string,
  material: THREE.Material,
  parent?: THREE.Object3D,
): THREE.Mesh {
  const m = new THREE.Mesh(proto.geometry, material);
  m.name = name;
  if (parent) parent.add(m);
  return m;
}
