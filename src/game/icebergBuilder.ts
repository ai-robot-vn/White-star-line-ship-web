import * as THREE from 'three';
import {
  commitInstanceColors,
  commitInstanceMatrices,
  createInstancedSlot,
  InstancedSlot,
  MathUtils,
  setInstanceColorHex,
  writeInstanceMatrix,
} from './threeHelpers';
import { sampleOceanWaveHeight } from './oceanAndSky';
import { ProceduralTextureSet } from './textures';
import { IcebergVariant } from './types';

export interface IcebergEntity {
  id: number;
  variant: IcebergVariant;
  x: number;
  z: number;
  vx: number;
  vz: number;
  rotY: number;
  rotSpeed: number;
  scale: number;
  collisionRadius: number;
  warned: boolean;
  nearMissAwarded: boolean;
  hitCooldown: number;
  phase: number;
  colorTint: number;
  instanceIdx: number;
}

const MAX_VISIBLE_PER_VARIANT = 1050;
const MAX_FOAM_COLLARS = 220;

function seeded(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function ridgeFbm(x: number, y: number, z: number, seed: number): number {
  let sum = 0;
  let amp = 0.55;
  let freq = 1.0;
  for (let i = 0; i < 4; i++) {
    const n = Math.sin(x * freq * 1.7 + seed * 3.1 + Math.cos(z * freq * 1.5))
      * Math.cos(y * freq * 1.9 - seed * 2.4 + Math.sin(x * freq * 1.3));
    const ridge = 1.0 - Math.abs(n);
    sum += ridge * ridge * amp;
    freq *= 2.1;
    amp *= 0.48;
  }
  return sum;
}

function createSculptedIcebergGeometry(
  variant: IcebergVariant,
  isSoftwareGl: boolean,
): THREE.BufferGeometry {
  const detail = isSoftwareGl ? 2 : 3;
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const seed = variant === 'growler' ? 1.7 : variant === 'tabular' ? 4.3 : 8.9;

  for (let i = 0; i < count; i++) {
    let vx = pos.getX(i);
    let vy = pos.getY(i);
    let vz = pos.getZ(i);

    const f1 = ridgeFbm(vx, vy, vz, seed);
    const f2 = Math.cos(vx * 3.2 - vy * 2.1 + seed) * Math.sin(vz * 3.4 + vy * 1.8);
    const horizAngle = Math.atan2(vz, vx);
    const facet = 0.88 + 0.16 * Math.sin(horizAngle * 5.0 + seed) + 0.10 * Math.cos(horizAngle * 9.0);

    if (variant === 'growler') {
      vx *= (8.4 + f1 * 3.2) * facet;
      vz *= (7.6 + f1 * 2.8) * facet;
      vy = vy > 0 ? vy * (4.4 + f1 * 2.4) : vy * 4.8;
      if (vy > 2.8) vy += f2 * 0.9;
    } else if (variant === 'tabular') {
      vx *= (12.8 + f1 * 3.8) * facet;
      vz *= (10.4 + f1 * 3.4) * facet;
      if (vy > 0.25) {
        vy = 5.4 + Math.min(2.4, vy * 2.1) + f1 * 1.45 + f2 * 0.45;
      } else {
        vy *= 6.6;
      }
      // Subtle wave-cut waterline undercut shelf
      if (vy > -1.4 && vy < 1.2) {
        vx *= 0.91;
        vz *= 0.91;
      }
    } else {
      const spire = vy > 0.15 ? 1.0 - Math.min(0.68, vy * 0.56) : 1.05;
      vx *= (10.8 + f1 * 3.6) * spire * facet;
      vz *= (9.8 + f1 * 3.2) * spire * facet;
      vy = vy > 0 ? Math.pow(vy, 0.82) * (15.5 + f1 * 4.2) : vy * 8.2;
      if (vy > 3.5 && Math.sin(horizAngle * 2.0) > 0.2) {
        vy *= 0.72;
      }
    }

    pos.setXYZ(i, vx, vy, vz);

    // Rich vertex shading: deep glacial sapphire waterline undercut -> frost blue -> crisp wind-packed snow crown
    const hNorm = MathUtils.clamp((vy + 3.0) / 14.0, 0, 1);
    const deepShade = MathUtils.clamp(0.74 + f1 * 0.24, 0.65, 1.05);
    const r = MathUtils.lerp(0.42, 0.96, Math.pow(hNorm, 0.75)) * deepShade;
    const g = MathUtils.lerp(0.68, 0.98, Math.pow(hNorm, 0.7)) * deepShade;
    const b = MathUtils.lerp(0.84, 1.0, Math.pow(hNorm, 0.6)) * deepShade;
    colors[i * 3] = Math.min(1, r);
    colors[i * 3 + 1] = Math.min(1, g);
    colors[i * 3 + 2] = Math.min(1, b);
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function createGlacialIceMaterial(textures: ProceduralTextureSet): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    name: 'iceberg_glacial_mat',
    map: textures.iceAlbedo,
    normalMap: textures.iceNormal,
    normalScale: new THREE.Vector2(1.4, 1.4),
    roughnessMap: textures.iceRoughness,
    roughness: 0.42,
    metalness: 0.04,
    clearcoat: 0.28,
    clearcoatRoughness: 0.26,
    envMapIntensity: 0.44,
    vertexColors: true,
    flatShading: false,
  });

  // Custom shader injection: wet glossy waterline glaze + icy turquoise edge subsurface glow
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vIceWorldPos;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vec4 iceWp = vec4(transformed, 1.0);
         #ifdef USE_INSTANCING
           iceWp = instanceMatrix * iceWp;
         #endif
         iceWp = modelMatrix * iceWp;
         vIceWorldPos = iceWp.xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vIceWorldPos;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         // Wet glassy glaze near the North Atlantic waterline (y in -1.5..1.6m)
         float wetBand = 1.0 - smoothstep(0.0, 1.85, abs(vIceWorldPos.y));
         roughnessFactor = mix(roughnessFactor, 0.14, wetBand * 0.85);`,
      )
      .replace(
        '#include <dithering_fragment>',
        `// Subtle subsurface turquoise glow at waterline fractures
         float iceEdgeGlow = (1.0 - smoothstep(-1.5, 4.5, vIceWorldPos.y)) * 0.14;
         gl_FragColor.rgb += vec3(0.08, 0.34, 0.46) * iceEdgeGlow;
         #include <dithering_fragment>`,
      );
  };

  return mat;
}

export class IcebergFactory {
  private readonly scene: THREE.Scene;
  private readonly mat: THREE.MeshPhysicalMaterial;
  private readonly geos: Record<IcebergVariant, THREE.BufferGeometry>;
  private readonly slots: Record<IcebergVariant, InstancedSlot>;
  private readonly foamGeo: THREE.RingGeometry;
  private readonly foamMat: THREE.MeshBasicMaterial;
  private readonly foamSlot: InstancedSlot;
  private nextId = 1;

  private readonly visibleByVariant: Record<IcebergVariant, IcebergEntity[]> = {
    growler: [],
    tabular: [],
    pinnacle: [],
  };
  private readonly candidateCollars: Array<{ berg: IcebergEntity; distSq: number }> = [];

  constructor(scene: THREE.Scene, textures: ProceduralTextureSet, isSoftwareGl: boolean) {
    this.scene = scene;
    this.mat = createGlacialIceMaterial(textures);

    this.geos = {
      growler: createSculptedIcebergGeometry('growler', isSoftwareGl),
      tabular: createSculptedIcebergGeometry('tabular', isSoftwareGl),
      pinnacle: createSculptedIcebergGeometry('pinnacle', isSoftwareGl),
    };

    this.slots = {
      growler: createInstancedSlot('icebergs_growler', this.geos.growler, this.mat, MAX_VISIBLE_PER_VARIANT, true, scene),
      tabular: createInstancedSlot('icebergs_tabular', this.geos.tabular, this.mat, MAX_VISIBLE_PER_VARIANT, true, scene),
      pinnacle: createInstancedSlot('icebergs_pinnacle', this.geos.pinnacle, this.mat, MAX_VISIBLE_PER_VARIANT, true, scene),
    };

    this.slots.growler.mesh.castShadow = !isSoftwareGl;
    this.slots.tabular.mesh.castShadow = !isSoftwareGl;
    this.slots.pinnacle.mesh.castShadow = !isSoftwareGl;
    this.slots.growler.mesh.receiveShadow = true;
    this.slots.tabular.mesh.receiveShadow = true;
    this.slots.pinnacle.mesh.receiveShadow = true;

    // Translucent wave-wash foam collar ring around nearby icebergs
    this.foamGeo = new THREE.RingGeometry(0.92, 1.24, 24);
    this.foamGeo.rotateX(-Math.PI / 2);
    this.foamMat = new THREE.MeshBasicMaterial({
      color: 0xd6eefc,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.foamSlot = createInstancedSlot('iceberg_foam_collars', this.foamGeo, this.foamMat, MAX_FOAM_COLLARS, false, scene);
  }

  public getShadowMeshes(): THREE.Object3D[] {
    return [this.slots.growler.mesh, this.slots.tabular.mesh, this.slots.pinnacle.mesh];
  }

  public spawnIceberg(
    variant: IcebergVariant,
    x: number,
    z: number,
    scale = 1.0,
    vx = 0,
    vz = 0,
  ): IcebergEntity {
    const id = this.nextId++;
    const baseRadius = variant === 'growler' ? 7.8 : variant === 'tabular' ? 12.2 : 10.6;
    const tintPalette = [0xf2f8fc, 0xe2f1fa, 0xd4eaf7, 0xe8f4fb];
    const colorTint = tintPalette[Math.floor(seeded(id) * tintPalette.length)];

    return {
      id,
      variant,
      x,
      z,
      vx,
      vz,
      rotY: seeded(id * 3.1) * Math.PI * 2,
      rotSpeed: (seeded(id * 7.3) - 0.5) * 0.045,
      scale,
      collisionRadius: baseRadius * scale * 0.92,
      warned: false,
      nearMissAwarded: false,
      hitCooldown: 0,
      phase: seeded(id * 5.7) * Math.PI * 2,
      colorTint,
      instanceIdx: -1,
    };
  }

  public updateTransforms(icebergs: IcebergEntity[], shipX: number, shipZ: number, simTime: number): void {
    this.visibleByVariant.growler.length = 0;
    this.visibleByVariant.tabular.length = 0;
    this.visibleByVariant.pinnacle.length = 0;
    this.candidateCollars.length = 0;

    for (let i = 0; i < icebergs.length; i++) {
      const b = icebergs[i];
      const dx = b.x - shipX;
      const dz = b.z - shipZ;
      if (Math.abs(dx) > 1250 || Math.abs(dz) > 1450) continue;
      const list = this.visibleByVariant[b.variant];
      if (list.length < MAX_VISIBLE_PER_VARIANT) {
        list.push(b);
      }
      const d2 = dx * dx + dz * dz;
      if (d2 < 460 * 460 && this.candidateCollars.length < MAX_FOAM_COLLARS) {
        this.candidateCollars.push({ berg: b, distSq: d2 });
      }
    }

    for (const variant of ['growler', 'tabular', 'pinnacle'] as const) {
      const list = this.visibleByVariant[variant];
      const slot = this.slots[variant];
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        const waveY = sampleOceanWaveHeight(b.x, b.z, simTime);
        const bobY = waveY * 0.65 - 0.25 + Math.sin(simTime * 0.8 + b.phase) * 0.14;
        const pitch = Math.sin(simTime * 0.55 + b.phase) * 0.018;
        const roll = Math.cos(simTime * 0.48 + b.phase) * 0.022;
        writeInstanceMatrix(slot, i, b.x, bobY, b.z, pitch, b.rotY, roll, b.scale, b.scale, b.scale);
        setInstanceColorHex(slot, i, b.colorTint);
      }
      commitInstanceMatrices(slot, list.length);
      commitInstanceColors(slot);
    }

    const fCount = this.candidateCollars.length;
    for (let i = 0; i < fCount; i++) {
      const b = this.candidateCollars[i].berg;
      const waveY = sampleOceanWaveHeight(b.x, b.z, simTime);
      const pulse = 1.0 + 0.08 * Math.sin(simTime * 1.9 + b.phase);
      const rScale = b.collisionRadius * 1.08 * pulse;
      writeInstanceMatrix(this.foamSlot, i, b.x, waveY + 0.11, b.z, 0, b.rotY, 0, rScale, 1, rScale);
    }
    commitInstanceMatrices(this.foamSlot, fCount);
  }

  public clear(): void {
    commitInstanceMatrices(this.slots.growler, 0);
    commitInstanceMatrices(this.slots.tabular, 0);
    commitInstanceMatrices(this.slots.pinnacle, 0);
    commitInstanceMatrices(this.foamSlot, 0);
  }

  public dispose(): void {
    this.geos.growler.dispose();
    this.geos.tabular.dispose();
    this.geos.pinnacle.dispose();
    this.mat.dispose();
    this.foamGeo.dispose();
    this.foamMat.dispose();
    this.scene.remove(
      this.slots.growler.mesh,
      this.slots.tabular.mesh,
      this.slots.pinnacle.mesh,
      this.foamSlot.mesh,
    );
  }
}
