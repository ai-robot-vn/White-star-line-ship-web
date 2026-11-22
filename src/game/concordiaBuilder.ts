import * as THREE from 'three';
import {
  InstancedSlot,
  MathUtils,
  Shape2D,
  bakeTransform,
  buildBox,
  buildCylinder,
  buildDisc,
  buildExtrudedShapeMesh,
  buildLatheMesh,
  buildPlane,
  buildSphere,
  buildTorusXY,
  buildTubeMesh,
  cloneMeshWithMaterial,
  commitInstanceMatrices,
  createInstancedSlot,
  makePBR,
  setEulerXYZ,
  writeInstanceMatrix,
} from './threeHelpers';
import { createCrewAndLifeboats, CrewAndLifeboatSystem } from './charactersBuilder';
import { TitanicShipRig } from './shipBuilder';
import { ProceduralTextureSet } from './textures';

export const CONCORDIA_BREAK_Z = 98.0;

/**
 * Evaluates true 1:1 scale Costa Concordia cruise ship hull half-beam (max 17.75m / 35.5m beam)
 * and sheer height from Bow Stem (z = -80.0) to Transom Stern (z = +210.2) -> 290.2m LOA.
 */
function sampleConcordiaStation(z: number): {
  beam: number;
  sheerY: number;
  flareFactor: number;
} {
  let beam = 17.75;
  let flareFactor = 0.04;

  if (z < -12) {
    // Graceful flared bow stem (-80 to -12)
    const t = MathUtils.clamp((z - -80.0) / 68.0, 0, 1);
    beam = 17.75 * Math.pow(Math.sin((t * Math.PI) / 2), 0.72);
    flareFactor = 0.24 * (1 - t) + 0.04;
  } else if (z > 165) {
    // Broad modern cruise stern tapering cleanly to stepped transom (165 to 210.2)
    const t = MathUtils.clamp((210.2 - z) / 45.2, 0, 1);
    const minTransomFrac = 0.56;
    const smoothT = minTransomFrac + (1 - minTransomFrac) * Math.pow(Math.sin((t * Math.PI) / 2), 0.65);
    beam = 17.75 * smoothT;
    flareFactor = 0.09 * (1 - t) + 0.03;
  }

  // Modern cruise ship continuous sheer with slight forward bow sweep
  let sheerY = 10.6;
  if (z < -36) {
    const t = MathUtils.clamp((-36 - z) / 44.0, 0, 1);
    sheerY = 10.6 + t * 1.45;
  } else if (z > 186) {
    const t = MathUtils.clamp((z - 186) / 24.2, 0, 1);
    sheerY = 10.6 + t * 0.4;
  }

  return { beam, sheerY, flareFactor };
}

function sampleConcordiaKeelY(z: number): number {
  if (z < -68) {
    const t = MathUtils.clamp((-68 - z) / 12.0, 0, 1);
    return -7.2 + 2.6 * t * t;
  }
  if (z > 175) {
    if (z <= 198) {
      const t = (z - 175) / 23.0;
      return -7.2 + 3.4 * Math.pow(t, 1.35);
    }
    const u = MathUtils.clamp((z - 198) / 12.2, 0, 1);
    return -3.8 + 4.9 * Math.pow(u, 0.9);
  }
  return -7.2;
}

function buildConcordiaHullSection(
  name: string,
  zSamples: number[],
  yLevels: number,
  yMinFrac: number,
  yMaxFrac: number,
): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const includeKeel = yMinFrac <= 0.001;
  const isLowerBand = includeKeel && yMaxFrac < 0.5;
  const isUpperBand = !includeKeel && yMaxFrac > 0.9;

  const evalVertex = (z: number, side: number, frac: number): [number, number, number, number, number] => {
    const { beam, sheerY, flareFactor } = sampleConcordiaStation(z);
    const vCoord = (z + 80.0) / 290.2;
    const yKeel = sampleConcordiaKeelY(z);
    const yTop = sheerY;

    let y: number;
    if (isLowerBand) {
      const yMaxWL = Math.min(0.32, yTop - 0.1);
      const yHigh = Math.max(yKeel + 0.02, yMaxWL);
      const localU = yMaxFrac > 0 ? frac / yMaxFrac : 0;
      y = MathUtils.lerp(yKeel, yHigh, localU);
    } else if (isUpperBand) {
      const yLow = Math.min(yTop - 0.04, Math.max(yKeel, 0.28));
      const localU = (frac - yMinFrac) / Math.max(0.001, 1.0 - yMinFrac);
      y = MathUtils.lerp(yLow, yTop, localU);
    } else {
      y = MathUtils.lerp(yKeel, yTop, frac);
    }

    const totalDepth = Math.max(0.35, yTop - yKeel);
    const hullFrac = MathUtils.clamp((y - yKeel) / totalDepth, 0, 1);

    let widthRatio: number;
    if (hullFrac < 0.24) {
      widthRatio = Math.sin(((hullFrac / 0.24) * Math.PI) / 2) * 0.92;
    } else {
      const up = (hullFrac - 0.24) / 0.76;
      widthRatio = 0.92 + up * 0.08 + up * up * flareFactor;
    }

    const bowRake = z <= -78.0 ? -(hullFrac * 2.15) : 0;
    const x = side * beam * widthRatio;
    return [x, y, z + bowRake, vCoord * 8.0, hullFrac];
  };

  if (includeKeel) {
    const ringPts = yLevels * 2 + 1;
    for (let zi = 0; zi < zSamples.length; zi++) {
      const z = zSamples[zi];
      for (let j = yLevels; j >= 1; j--) {
        const frac = MathUtils.lerp(yMinFrac, yMaxFrac, j / yLevels);
        const [x, y, zz, u, v] = evalVertex(z, -1, frac);
        positions.push(x, y, zz);
        uvs.push(u, v);
      }
      const [kx, ky, kz, ku, kv] = evalVertex(z, 0, yMinFrac);
      positions.push(kx, ky, kz);
      uvs.push(ku, kv);
      for (let j = 1; j <= yLevels; j++) {
        const frac = MathUtils.lerp(yMinFrac, yMaxFrac, j / yLevels);
        const [x, y, zz, u, v] = evalVertex(z, 1, frac);
        positions.push(x, y, zz);
        uvs.push(u, v);
      }
    }
    for (let zi = 0; zi < zSamples.length - 1; zi++) {
      for (let ri = 0; ri < ringPts - 1; ri++) {
        const a = zi * ringPts + ri;
        const b = (zi + 1) * ringPts + ri;
        const c = (zi + 1) * ringPts + (ri + 1);
        const d = zi * ringPts + (ri + 1);
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }
  } else {
    const sidePts = yLevels + 1;
    for (const side of [-1, 1] as const) {
      const baseVertex = positions.length / 3;
      for (let zi = 0; zi < zSamples.length; zi++) {
        const z = zSamples[zi];
        for (let j = 0; j <= yLevels; j++) {
          const frac = MathUtils.lerp(yMinFrac, yMaxFrac, j / yLevels);
          const [x, y, zz, u, v] = evalVertex(z, side, frac);
          positions.push(x, y, zz);
          uvs.push(u, v);
        }
      }
      for (let zi = 0; zi < zSamples.length - 1; zi++) {
        for (let ri = 0; ri < sidePts - 1; ri++) {
          const a = baseVertex + zi * sidePts + ri;
          const b = baseVertex + (zi + 1) * sidePts + ri;
          const c = baseVertex + (zi + 1) * sidePts + (ri + 1);
          const d = baseVertex + zi * sidePts + (ri + 1);
          if (side > 0) {
            indices.push(a, b, d);
            indices.push(b, c, d);
          } else {
            indices.push(a, d, b);
            indices.push(b, d, c);
          }
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo);
  mesh.name = name;
  return mesh;
}

function buildConcordiaWeatherDeck(
  name: string,
  zStations: number[],
  yOffset = 0.05,
  inset = 0.35,
  customY?: number,
): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < zStations.length; i++) {
    const z = zStations[i];
    const { beam, sheerY, flareFactor } = sampleConcordiaStation(z);
    const halfW = Math.max(0.28, beam * (1 + flareFactor * 0.72) - inset);
    const y = (customY !== undefined ? customY : sheerY) + yOffset;
    const v = (z + 80.0) / 290.2;
    positions.push(-halfW, y, z);
    uvs.push(0, v * 12);
    positions.push(halfW, y, z);
    uvs.push(halfW / 7, v * 12);
  }
  for (let i = 0; i < zStations.length - 1; i++) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i + 1) * 2;
    const d = (i + 1) * 2 + 1;
    indices.push(a, c, b);
    indices.push(b, c, d);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo);
  mesh.name = name;
  return mesh;
}

function buildBronzePropeller(
  name: string,
  trackMesh: <T extends THREE.Mesh>(m: T, parent?: THREE.Object3D, castShadow?: boolean) => T,
  trackProtoGeo: (g: THREE.BufferGeometry) => void,
  bronzeMat: THREE.Material,
  bladeCount: number,
  radius: number,
): THREE.Group {
  const prop = new THREE.Group();
  prop.name = name;
  const hub = trackMesh(buildCylinder(`${name}_hub`, 0.42, 0.56, 1.35, 16), prop);
  hub.material = bronzeMat;
  hub.rotation.x = Math.PI / 2;

  const bladeShape = new Shape2D();
  bladeShape.moveTo(0, 0);
  bladeShape.quadraticCurveTo(radius * 0.48, radius * 0.42, radius * 0.34, radius * 0.88, 10);
  bladeShape.quadraticCurveTo(0, radius * 1.04, -radius * 0.34, radius * 0.72, 10);
  bladeShape.quadraticCurveTo(-radius * 0.4, radius * 0.3, 0, 0, 8);
  bladeShape.closePath();

  const bladeProto = buildExtrudedShapeMesh(`${name}_bladeProto`, bladeShape, 0.09, 0.02);
  trackProtoGeo(bladeProto.geometry);

  for (let b = 0; b < bladeCount; b++) {
    const pivot = new THREE.Group();
    pivot.name = `${name}_piv_${b}`;
    prop.add(pivot);
    pivot.rotation.z = (b * Math.PI * 2) / bladeCount;
    const blade = trackMesh(cloneMeshWithMaterial(bladeProto, `${name}_b_${b}`, bronzeMat), pivot);
    blade.rotation.y = 0.56;
    blade.position.y = 0.25;
  }
  return prop;
}

export function buildConcordiaShip(
  scene: THREE.Scene,
  textures: ProceduralTextureSet,
  _isSoftwareGl: boolean,
  companionOnly = false,
): TitanicShipRig {
  const trackedMeshes: THREE.Mesh[] = [];
  const materials: THREE.Material[] = [];
  const protoGeos: THREE.BufferGeometry[] = [];
  const instancedSlots: InstancedSlot[] = [];
  const shadowCasters: THREE.Object3D[] = [];
  let uid = 0;
  const nextId = (prefix: string) => `conc_${prefix}_${uid++}`;

  const trackMesh = <T extends THREE.Mesh>(m: T, parent?: THREE.Object3D, castShadow = false): T => {
    trackedMeshes.push(m);
    if (parent) parent.add(m);
    if (castShadow) shadowCasters.push(m);
    return m;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };
  const trackProtoGeo = (g: THREE.BufferGeometry) => {
    protoGeos.push(g);
  };
  const makeSlot = (
    name: string,
    protoMesh: THREE.Mesh,
    mat: THREE.Material,
    count: number,
    parent: THREE.Object3D,
  ): InstancedSlot => {
    trackProtoGeo(protoMesh.geometry);
    const slot = createInstancedSlot(name, protoMesh.geometry, mat, Math.max(1, count), false, parent);
    instancedSlots.push(slot);
    return slot;
  };

  // Root & Split Hull Hierarchy
  const root = new THREE.Group();
  root.name = 'concordia_root';
  scene.add(root);

  const hullMeshGroup = new THREE.Group();
  hullMeshGroup.name = 'concordia_hull';
  root.add(hullMeshGroup);

  const bowGroup = new THREE.Group();
  bowGroup.name = 'concordia_bow';
  hullMeshGroup.add(bowGroup);
  bowGroup.position.set(0, 0, CONCORDIA_BREAK_Z);
  const bowContent = new THREE.Group();
  bowContent.name = 'concordia_bowContent';
  bowGroup.add(bowContent);
  bowContent.position.set(0, 0, -CONCORDIA_BREAK_Z);

  const sternGroup = new THREE.Group();
  sternGroup.name = 'concordia_stern';
  hullMeshGroup.add(sternGroup);
  sternGroup.position.set(0, 0, CONCORDIA_BREAK_Z);
  const sternContent = new THREE.Group();
  sternContent.name = 'concordia_sternContent';
  sternGroup.add(sternContent);
  sternContent.position.set(0, 0, -CONCORDIA_BREAK_Z);

  // =========================================================================
  // PBR MATERIALS (Modern Costa Crociere White, Navy, Yellow & SOLAS Orange)
  // =========================================================================
  const hullWhiteMat = trackMat(
    makePBR('conc_hullWhite', {
      color: 0xf4f5f7,
      roughness: 0.42,
      metallic: 0.14,
      envIntensity: 0.46,
    }),
  );
  const antiFoulMat = trackMat(
    makePBR('conc_antiFoul', {
      color: 0x7e1c20,
      roughness: 0.62,
      metallic: 0.12,
      envIntensity: 0.38,
    }),
  );
  const costaNavyMat = trackMat(
    makePBR('conc_costaNavy', {
      color: 0x0b326b,
      roughness: 0.40,
      metallic: 0.16,
      envIntensity: 0.44,
    }),
  );
  const costaYellowMat = trackMat(
    makePBR('conc_costaYellow', {
      color: 0xf4c41c,
      roughness: 0.44,
      metallic: 0.10,
      envIntensity: 0.42,
    }),
  );
  const costaFunnelMat = trackMat(
    makePBR('conc_costaFunnel', {
      color: 0xffffff,
      albedoTex: textures.costaFunnelAlbedo,
      bumpTex: textures.buffFunnelNormal,
      bumpLevel: 0.65,
      roughness: 0.46,
      metallic: 0.10,
      envIntensity: 0.44,
    }),
  );
  const solasOrangeMat = trackMat(
    makePBR('conc_solasOrange', {
      color: 0xf97316,
      roughness: 0.42,
      metallic: 0.08,
      envIntensity: 0.40,
    }),
  );
  const teakDeckMat = trackMat(
    makePBR('conc_teak', {
      albedoTex: textures.teakDeckAlbedo,
      bumpTex: textures.teakDeckNormal,
      bumpLevel: 1.0,
      roughnessTex: textures.teakDeckRoughness,
      roughness: 0.80,
      metallic: 0.02,
      envIntensity: 0.34,
    }),
  );
  const lidoBlueMat = trackMat(
    makePBR('conc_lidoFloor', {
      color: 0x2f7ba6,
      roughness: 0.56,
      metallic: 0.04,
      envIntensity: 0.38,
    }),
  );
  const poolWaterMat = trackMat(
    makePBR('conc_poolWater', {
      color: 0x1fd1f9,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.52,
      roughness: 0.14,
      metallic: 0.08,
      alpha: 0.88,
      envIntensity: 0.52,
    }),
  );
  const whiteSuperMat = trackMat(
    makePBR('conc_whiteSuper', {
      color: 0xf2f4f7,
      roughness: 0.52,
      metallic: 0.05,
      envIntensity: 0.44,
    }),
  );
  const darkCharcoalMat = trackMat(
    makePBR('conc_darkCharcoal', {
      color: 0x1e2530,
      roughness: 0.46,
      metallic: 0.52,
      envIntensity: 0.42,
    }),
  );
  const darkGlassMat = trackMat(
    makePBR('conc_darkGlass', {
      color: 0x12324d,
      roughness: 0.16,
      metallic: 0.35,
      alpha: 0.72,
      doubleSided: true,
      envIntensity: 0.50,
    }),
  );
  const clearGlassMat = trackMat(
    makePBR('conc_clearGlass', {
      color: 0xaad8f5,
      roughness: 0.14,
      metallic: 0.25,
      alpha: 0.34,
      doubleSided: true,
      envIntensity: 0.44,
    }),
  );
  const portholeGlowMat = trackMat(
    makePBR('conc_portholeGlow', {
      color: 0x1e3852,
      emissive: 0xffd58f,
      emissiveIntensity: 0.85,
      roughness: 0.26,
      metallic: 0.24,
      envIntensity: 0.36,
    }),
  );
  const brassMat = trackMat(
    makePBR('conc_brass', {
      color: 0xdfb256,
      roughness: 0.36,
      metallic: 0.84,
      anisotropy: 0.65,
      envIntensity: 0.40,
    }),
  );
  const bronzeMat = trackMat(
    makePBR('conc_bronze', {
      color: 0xc29248,
      roughness: 0.42,
      metallic: 0.84,
      anisotropy: 0.5,
      envIntensity: 0.36,
    }),
  );
  const chromeMat = trackMat(
    makePBR('conc_chrome', {
      color: 0xd9e1ea,
      roughness: 0.26,
      metallic: 0.88,
      anisotropy: 0.5,
      envIntensity: 0.48,
    }),
  );
  const mahoganyMat = trackMat(
    makePBR('conc_mahogany', {
      albedoTex: textures.mahoganyAlbedo,
      roughnessTex: textures.mahoganyRoughness,
      roughness: 0.46,
      metallic: 0.04,
      envIntensity: 0.40,
    }),
  );
  const interiorMarbleMat = trackMat(
    makePBR('conc_marble', {
      albedoTex: textures.interiorMarbleAlbedo,
      roughnessTex: textures.interiorMarbleRoughness,
      roughness: 0.40,
      metallic: 0.06,
      envIntensity: 0.42,
    }),
  );
  const crimsonCarpetMat = trackMat(
    makePBR('conc_carpet', {
      color: 0x7b1d2e,
      roughness: 0.86,
      metallic: 0.02,
      envIntensity: 0.32,
    }),
  );
  const linenClothMat = trackMat(
    makePBR('conc_linen', {
      color: 0xf4efe3,
      roughness: 0.78,
      metallic: 0.02,
      envIntensity: 0.36,
    }),
  );
  const engineTealMat = trackMat(
    makePBR('conc_engTeal', {
      color: 0x195363,
      roughness: 0.48,
      metallic: 0.48,
      envIntensity: 0.44,
    }),
  );
  const warmGlowMat = trackMat(
    makePBR('conc_warmGlow', {
      color: 0xfff0cc,
      emissive: 0xffb858,
      emissiveIntensity: 1.0,
      roughness: 0.32,
      envIntensity: 0.25,
    }),
  );
  const ecdisScreenMat = trackMat(
    makePBR('conc_ecdis', {
      color: 0x164e63,
      emissive: 0x22d3ee,
      emissiveIntensity: 0.88,
      roughness: 0.28,
      envIntensity: 0.30,
    }),
  );
  const portLightMat = trackMat(
    makePBR('conc_portLight', {
      color: 0xff2b2b,
      emissive: 0xff1e1e,
      emissiveIntensity: 1.0,
      roughness: 0.3,
      envIntensity: 0.25,
    }),
  );
  const starboardLightMat = trackMat(
    makePBR('conc_stbdLight', {
      color: 0x22e873,
      emissive: 0x17e668,
      emissiveIntensity: 1.0,
      roughness: 0.3,
      envIntensity: 0.25,
    }),
  );

  // =========================================================================
  // 1. LOFTED MODERN CRUISE HULL + BULBOUS BOW + COSTA NAVY SHEER BAND
  // =========================================================================
  const fwdZ: number[] = [];
  for (let z = -80; z <= CONCORDIA_BREAK_Z; z += 4.5) fwdZ.push(z);
  if (fwdZ[fwdZ.length - 1] !== CONCORDIA_BREAK_Z) fwdZ.push(CONCORDIA_BREAK_Z);

  const aftZ: number[] = [CONCORDIA_BREAK_Z];
  for (let z = CONCORDIA_BREAK_Z + 4; z <= 210.2; z += 4.5) aftZ.push(z);
  if (aftZ[aftZ.length - 1] < 210.15) aftZ.push(210.2);

  const bowLower = trackMesh(buildConcordiaHullSection('conc_bowLower', fwdZ, 7, 0.0, 0.42), bowContent, true);
  bowLower.material = antiFoulMat;
  const bowUpper = trackMesh(buildConcordiaHullSection('conc_bowUpper', fwdZ, 8, 0.42, 1.0), bowContent, true);
  bowUpper.material = hullWhiteMat;

  const sternLower = trackMesh(buildConcordiaHullSection('conc_sternLower', aftZ, 7, 0.0, 0.42), sternContent, true);
  sternLower.material = antiFoulMat;
  const sternUpper = trackMesh(buildConcordiaHullSection('conc_sternUpper', aftZ, 8, 0.42, 1.0), sternContent, true);
  sternUpper.material = hullWhiteMat;

  // Sculpted bulbous bow below the forefoot (signature modern cruise ship feature)
  const bulbousBow = trackMesh(buildSphere('conc_bulbousBow', 1.0, 18, 14), bowContent);
  bulbousBow.material = antiFoulMat;
  bulbousBow.scale.set(2.35, 2.05, 7.4);
  bulbousBow.position.set(0, -3.55, -77.6);

  // Costa Crociere signature deep-navy hull sheer band & scarlet waterline stripe
  for (const seg of [
    { zList: fwdZ, tgt: bowContent, tag: 'fwd' },
    { zList: aftZ, tgt: sternContent, tag: 'aft' },
  ]) {
    for (const side of [-1, 1] as const) {
      const sheerBandPts: THREE.Vector3[] = [];
      const wlStripePts: THREE.Vector3[] = [];
      for (let i = 0; i < seg.zList.length; i += 2) {
        const zz = seg.zList[i];
        const { beam, sheerY, flareFactor } = sampleConcordiaStation(zz);
        const topX = side * (beam * (1 + flareFactor * 0.94) + 0.08);
        sheerBandPts.push(new THREE.Vector3(topX, sheerY - 0.55, zz));
        const yKeel = sampleConcordiaKeelY(zz);
        if (yKeel < 0.1) {
          const wlFrac = MathUtils.clamp((0.36 - yKeel) / Math.max(0.4, sheerY - yKeel), 0, 1);
          const wlWr = wlFrac < 0.24 ? Math.sin(((wlFrac / 0.24) * Math.PI) / 2) * 0.92 : 0.92 + ((wlFrac - 0.24) / 0.76) * 0.08;
          wlStripePts.push(new THREE.Vector3(side * (beam * wlWr + 0.08), 0.36, zz));
        }
      }
      if (sheerBandPts.length >= 2) {
        const navyBand = trackMesh(
          buildTubeMesh(`conc_navyBand_${seg.tag}_${side}`, sheerBandPts, 32, 0.34, 6, false),
          seg.tgt,
        );
        navyBand.material = costaNavyMat;
      }
      if (wlStripePts.length >= 2) {
        const wlLine = trackMesh(
          buildTubeMesh(`conc_wlLine_${seg.tag}_${side}`, wlStripePts, 28, 0.11, 6, false),
          seg.tgt,
        );
        wlLine.material = costaNavyMat;
      }
    }
  }

  // Stepped Transom Stern Bulkhead Plate & Mooring Galleries
  const transomPlate = trackMesh(buildBox('conc_transomPlate', 19.8, 9.6, 1.4), sternContent, true);
  transomPlate.material = hullWhiteMat;
  transomPlate.position.set(0, 5.8, 209.2);

  const transomNavy = trackMesh(buildBox('conc_transomNavy', 20.1, 1.35, 1.5), sternContent);
  transomNavy.material = costaNavyMat;
  transomNavy.position.set(0, 10.1, 209.2);

  // Twin Podded Azipod Propulsion Units + Twin Stern Rudder Skeg & Bow Thrusters
  const propSpinners: THREE.Group[] = [];
  for (const side of [-1, 1] as const) {
    const podStrut = trackMesh(buildBox(nextId('podStrut'), 0.72, 2.4, 2.8), sternContent);
    podStrut.material = costaNavyMat;
    podStrut.position.set(side * 6.4, -3.2, 191.5);

    const podNacelle = trackMesh(buildCylinder(nextId('podBody'), 1.05, 1.15, 5.8, 16), sternContent);
    podNacelle.material = costaNavyMat;
    podNacelle.rotation.x = Math.PI / 2;
    podNacelle.position.set(side * 6.4, -4.4, 191.5);

    const prop = buildBronzePropeller(`conc_azipodProp_${side}`, trackMesh, trackProtoGeo, bronzeMat, 5, 2.65);
    sternContent.add(prop);
    prop.position.set(side * 6.4, -4.4, 188.4);
    propSpinners.push(prop);

    // Bow thruster tunnels
    const btTunnel = trackMesh(buildCylinder(nextId('btTun'), 0.88, 0.88, 0.45, 14), bowContent);
    btTunnel.material = darkCharcoalMat;
    btTunnel.rotation.z = Math.PI / 2;
    btTunnel.position.set(side * 3.8, -2.5, -62.0);
  }

  // =========================================================================
  // 2. BOW MOORING DECK, AFT POOP & MULTI-TIER BALCONY SUPERSTRUCTURE
  // =========================================================================
  const bowMooringDeck = trackMesh(
    buildConcordiaWeatherDeck('conc_bowDeck', [-80.0, -72.0, -60.0, -48.0, -34.0, -18.0], 0.04, 0.35),
    bowContent,
  );
  bowMooringDeck.material = lidoBlueMat;

  // Bow Mooring Winches & Twin Anchors
  for (const side of [-1, 1] as const) {
    const winch = trackMesh(buildCylinder(nextId('winch'), 0.75, 0.75, 1.6, 12), bowContent);
    winch.material = darkCharcoalMat;
    winch.rotation.z = Math.PI / 2;
    winch.position.set(side * 2.8, 11.4, -64.0);

    const anchorPocket = trackMesh(buildBox(nextId('anchor'), 0.65, 2.2, 1.6), bowContent);
    anchorPocket.material = darkCharcoalMat;
    anchorPocket.position.set(side * 4.4, 7.6, -69.5);

    const navWing = trackMesh(buildBox(nextId('bowRail'), 0.14, 1.05, 58), bowContent);
    navWing.material = whiteSuperMat;
    navWing.position.set(side * 7.2, 11.4, -46);
  }

  // Deck 4 Boat Embarkation Promenade (y = 11.4) + Deck 4 Superstructure Core
  const boatPromFwd = trackMesh(buildBox('conc_boatPromFwd', 33.4, 0.35, 118.0), bowContent);
  boatPromFwd.material = teakDeckMat;
  boatPromFwd.position.set(0, 11.2, 39.0);

  const boatPromAft = trackMesh(buildBox('conc_boatPromAft', 33.0, 0.35, 92.0), sternContent);
  boatPromAft.material = teakDeckMat;
  boatPromAft.position.set(0, 11.2, 144.0);

  // Recessed Main Cabin Tiers (Decks 5..9: y = 11.4 .. 23.8)
  // Forward block (-16 .. CONCORDIA_BREAK_Z) & Aft block (CONCORDIA_BREAK_Z .. 190)
  const buildCabinBlock = (
    tgt: THREE.Object3D,
    tag: string,
    zStart: number,
    zEnd: number,
    deckCount: number,
    yBase: number,
    blockHalfW: number,
    balconyOuterW: number,
  ) => {
    const len = zEnd - zStart;
    const zMid = (zStart + zEnd) * 0.5;
    const deckH = 2.55;

    // Inner cabin core
    const core = trackMesh(buildBox(`conc_core_${tag}`, blockHalfW * 2, deckCount * deckH, len), tgt, true);
    core.material = whiteSuperMat;
    core.position.set(0, yBase + (deckCount * deckH) * 0.5, zMid);

    // Horizontal balcony deck slabs
    for (let d = 0; d <= deckCount; d++) {
      const dy = yBase + d * deckH;
      const slab = trackMesh(buildBox(nextId(`slab_${tag}_${d}`), balconyOuterW * 2, 0.24, len + 0.3), tgt);
      slab.material = whiteSuperMat;
      slab.position.set(0, dy, zMid);

      if (d < deckCount) {
        // Long glowing glass balcony door strips on port & starboard cabin walls
        for (const side of [-1, 1] as const) {
          const glassStrip = trackMesh(buildBox(nextId(`glass_${tag}_${d}`), 0.16, 1.85, len - 1.5), tgt);
          glassStrip.material = portholeGlowMat;
          glassStrip.position.set(side * (blockHalfW + 0.04), dy + 1.2, zMid);

          // Tinted glass balcony balustrade rail along outer edge
          const balust = trackMesh(buildBox(nextId(`bal_${tag}_${d}`), 0.08, 1.02, len - 0.8), tgt);
          balust.material = clearGlassMat;
          balust.position.set(side * (balconyOuterW - 0.12), dy + 0.62, zMid);

          const capRail = trackMesh(buildBox(nextId(`capR_${tag}_${d}`), 0.12, 0.08, len - 0.6), tgt);
          capRail.material = whiteSuperMat;
          capRail.position.set(side * (balconyOuterW - 0.12), dy + 1.15, zMid);
        }
      }
    }

    // Instanced vertical balcony divider partitions along both sides
    const divProto = buildBox(`conc_divProto_${tag}`, balconyOuterW - blockHalfW, deckH - 0.2, 0.14);
    const bayStep = 4.6;
    const bayCountPerSide = Math.max(1, Math.floor((len - 2) / bayStep));
    const totalDivs = bayCountPerSide * deckCount * 2;
    const divSlot = makeSlot(`conc_balDivs_${tag}`, divProto, whiteSuperMat, totalDivs, tgt);
    let di = 0;
    for (let d = 0; d < deckCount; d++) {
      const dy = yBase + d * deckH + deckH * 0.5;
      for (const side of [-1, 1] as const) {
        for (let b = 0; b < bayCountPerSide; b++) {
          const bz = zStart + 1.5 + b * bayStep;
          writeInstanceMatrix(
            divSlot,
            di++,
            side * ((blockHalfW + balconyOuterW) * 0.5),
            dy,
            bz,
            0,
            0,
            0,
          );
        }
      }
    }
    commitInstanceMatrices(divSlot, di);
  };

  // Forward Superstructure Tiers (Deck 5-8: y=13.5..23.7, z=-18..98)
  buildCabinBlock(bowContent, 'fwdTiers', -16.0, CONCORDIA_BREAK_Z - 0.1, 4, 13.6, 13.8, 16.5);
  // Bow Rounded Observation Lounge / Theatre Front (-24..-15, y=11.4..23.8)
  for (let d = 0; d < 4; d++) {
    const obsY = 13.6 + d * 2.55;
    const obsFront = trackMesh(buildCylinder(nextId('obsF'), 13.6 - d * 0.65, 13.9 - d * 0.65, 2.45, 22, false, 0.52), bowContent, true);
    obsFront.material = whiteSuperMat;
    obsFront.rotation.y = Math.PI;
    obsFront.position.set(0, obsY + 1.25, -16.0);

    const obsGlass = trackMesh(buildCylinder(nextId('obsG'), 13.72 - d * 0.65, 13.72 - d * 0.65, 1.55, 22, false, 0.5), bowContent);
    obsGlass.material = portholeGlowMat;
    obsGlass.rotation.y = Math.PI;
    obsGlass.position.set(0, obsY + 1.25, -16.15);
  }

  // Aft Superstructure Tiers (Deck 5-8: y=13.6..23.8, z=98..182)
  buildCabinBlock(sternContent, 'aftTiers', CONCORDIA_BREAK_Z + 0.1, 178.0, 4, 13.6, 13.4, 16.0);

  // Upper Promenade / Spa Deck 9-10 forward of Bridge & Midships (z = -6 .. 98)
  const deck9Fwd = trackMesh(buildBox('conc_deck9Fwd', 31.2, 2.8, 102.0), bowContent, true);
  deck9Fwd.material = whiteSuperMat;
  deck9Fwd.position.set(0, 25.2, 46.5);

  const deck9Teak = trackMesh(buildBox('conc_deck9Teak', 31.4, 0.22, 102.0), bowContent);
  deck9Teak.material = teakDeckMat;
  deck9Teak.position.set(0, 23.85, 46.5);

  // Aft Lido Terrace Pool & Stepped Sundecks (z = 178 .. 205)
  for (let s = 0; s < 3; s++) {
    const sy = 11.4 + s * 2.6;
    const sz = 196.0 - s * 7.5;
    const sw = 24.0 + s * 2.2;
    const terrace = trackMesh(buildBox(nextId('aftTer'), sw, 2.5, 11.0), sternContent, true);
    terrace.material = whiteSuperMat;
    terrace.position.set(0, sy + 1.25, sz);
    const tTeak = trackMesh(buildBox(nextId('aftTerTeak'), sw - 0.6, 0.18, 10.4), sternContent);
    tTeak.material = teakDeckMat;
    tTeak.position.set(0, sy + 2.54, sz);
  }
  const aftPool = trackMesh(buildBox('conc_aftPool', 9.2, 0.22, 6.2), sternContent);
  aftPool.material = poolWaterMat;
  aftPool.position.set(0, 16.58, 186.5);

  // =========================================================================
  // 3. LIDO MAGRODOME POOL DECK (z = 56..88, y = 24.0) & UPPER SUN PLAZA
  // =========================================================================
  const lidoPoolDeck = trackMesh(buildBox('conc_lidoDeck', 27.6, 0.35, 36.0), bowContent);
  lidoPoolDeck.material = teakDeckMat;
  lidoPoolDeck.position.set(0, 23.95, 72.0);

  const mainLidoPool = trackMesh(buildBox('conc_mainPool', 10.6, 0.24, 17.5), bowContent);
  mainLidoPool.material = poolWaterMat;
  mainLidoPool.position.set(0, 24.16, 72.0);

  // Glazed Arch Magrodome Roof over Lido Pool
  const magroRibCount = 7;
  for (let ri = 0; ri < magroRibCount; ri++) {
    const rz = 57.0 + ri * 5.0;
    const archPts: THREE.Vector3[] = [];
    for (let ai = 0; ai <= 14; ai++) {
      const th = (ai / 14) * Math.PI;
      archPts.push(new THREE.Vector3(Math.cos(th) * 13.6, 24.2 + Math.sin(th) * 6.6, rz));
    }
    const archRib = trackMesh(buildTubeMesh(nextId('magroRib'), archPts, 16, 0.22, 6, false), bowContent);
    archRib.material = whiteSuperMat;
  }
  const magroGlassCanopy = trackMesh(buildCylinder('conc_magroCanopy', 13.45, 13.45, 30.2, 20, true, 0.5), bowContent);
  magroGlassCanopy.material = clearGlassMat;
  setEulerXYZ(magroGlassCanopy, Math.PI / 2, 0, -Math.PI / 2);
  magroGlassCanopy.scale.set(0.49, 1.0, 1.0);
  magroGlassCanopy.position.set(0, 24.2, 72.0);

  // Mid-aft Funnel Plaza Deck (z = 98..154, y = 24.0) + Costa Water Slide
  const funnelDeck = trackMesh(buildBox('conc_funnelDeck', 26.8, 0.35, 58.0), sternContent);
  funnelDeck.material = lidoBlueMat;
  funnelDeck.position.set(0, 23.95, 127.0);

  const slidePts = [
    new THREE.Vector3(5.2, 32.5, 128.0),
    new THREE.Vector3(8.5, 30.0, 134.0),
    new THREE.Vector3(9.4, 27.2, 141.0),
    new THREE.Vector3(4.5, 25.0, 147.0),
  ];
  const waterSlide = trackMesh(buildTubeMesh('conc_waterSlide', slidePts, 18, 0.55, 8, false), sternContent);
  waterSlide.material = costaYellowMat;

  // =========================================================================
  // 4. ICONIC YELLOW COSTA CROCIERE "C" FUNNEL (z = 114, y = 24..46)
  // =========================================================================
  const funnelGroup = new THREE.Group();
  funnelGroup.name = 'conc_funnel';
  sternContent.add(funnelGroup);
  funnelGroup.position.set(0, 24.0, 114.0);

  const funnelBasePlinth = trackMesh(buildBox('conc_funnelPlinth', 9.2, 3.2, 16.5), funnelGroup, true);
  funnelBasePlinth.material = whiteSuperMat;
  funnelBasePlinth.position.set(0, 1.6, 0);

  const funnelCasing = trackMesh(buildCylinder('conc_funnelCasing', 3.45, 4.35, 16.5, 24), funnelGroup, true);
  funnelCasing.material = costaFunnelMat;
  funnelCasing.scale.set(0.76, 1.0, 1.48);
  funnelCasing.rotation.x = 0.08;
  funnelCasing.position.set(0, 11.2, 0.6);

  const funnelNavyCrown = trackMesh(buildCylinder('conc_funnelCrown', 3.35, 3.55, 3.2, 24), funnelGroup);
  funnelNavyCrown.material = costaNavyMat;
  funnelNavyCrown.scale.set(0.77, 1.0, 1.49);
  funnelNavyCrown.rotation.x = 0.08;
  funnelNavyCrown.position.set(0, 18.2, 1.15);

  const funnelRim = trackMesh(buildCylinder('conc_funnelRim', 3.42, 3.32, 0.9, 24), funnelGroup);
  funnelRim.material = darkCharcoalMat;
  funnelRim.scale.set(0.77, 1.0, 1.49);
  funnelRim.rotation.x = 0.08;
  funnelRim.position.set(0, 20.1, 1.3);

  for (const ex of [-1.2, 1.2]) {
    const exhaustPipe = trackMesh(buildCylinder(nextId('exhaust'), 0.65, 0.72, 2.2, 12), funnelGroup);
    exhaustPipe.material = darkCharcoalMat;
    exhaustPipe.position.set(ex, 20.8, 1.35);
  }

  // =========================================================================
  // 5. DECK 4 SOLAS ORANGE LIFEBOATS, FLAGS & BOW/STERN NAMEPLATES
  // =========================================================================
  let crewAndLifeboats: CrewAndLifeboatSystem;
  const boatStations = [16.0, 30.0, 44.0, 58.0, 108.0, 122.0, 136.0, 150.0];

  if (!companionOnly) {
    crewAndLifeboats = createCrewAndLifeboats(
      scene,
      bowContent,
      sternContent,
      whiteSuperMat,
      teakDeckMat,
      CONCORDIA_BREAK_Z,
      {
        scaleX: 17.75 / 14.0,
        scaleZ: 1.07,
        boatZStations: boatStations,
        boatBaseX: 16.45,
        deckBoundsZ: [-80, 210],
        bridgeDeckY: 26.8,
        boatDeckY: 11.4,
        promenadeDeckY: 13.6,
        wellDeckY: 10.6,
        forecastleDeckY: 10.8,
        aftDeckY: 16.5,
        poopDeckY: 16.5,
        crowsNestY: 40.5,
        crowsNestZ: 4.0,
        davitDeckY: 11.4,
        lifeboatHullColorHex: 0xf97316,
      },
    );
    for (let i = 0; i < crewAndLifeboats.shadowCasters.length; i++) {
      shadowCasters.push(crewAndLifeboats.shadowCasters[i]);
    }
  } else {
    const staticBoatProto = buildBox('conc_staticBoatProto', 2.05, 1.05, 6.2);
    const fwdStaticBoats = makeSlot('conc_staticBoatsFwd', staticBoatProto, solasOrangeMat, 8, bowContent);
    const aftStaticBoats = makeSlot('conc_staticBoatsAft', staticBoatProto, solasOrangeMat, 8, sternContent);
    let fi = 0;
    let ai = 0;
    for (const side of [-1, 1] as const) {
      for (let b = 0; b < boatStations.length; b++) {
        const bz = boatStations[b];
        const bx = side * (b === 0 ? 17.58 : 16.45);
        if (bz < CONCORDIA_BREAK_Z) writeInstanceMatrix(fwdStaticBoats, fi++, bx, 12.41, bz, 0, 0, 0);
        else writeInstanceMatrix(aftStaticBoats, ai++, bx, 12.41, bz, 0, 0, 0);
      }
    }
    commitInstanceMatrices(fwdStaticBoats, fi);
    commitInstanceMatrices(aftStaticBoats, ai);
    crewAndLifeboats = {
      characters: [],
      totalCharacterCount: 0,
      lifeboats: [],
      shadowCasters: [],
      updateCruising: () => {},
      updateSinking: () => 0,
      updateRescue: () => ({
        boatsRecovered: 0,
        survivorsRescued: 0,
        warshipBoatsRecovered: 0,
        warshipSurvivorsRescued: 0,
        carpathiaBoatsRecovered: 0,
        carpathiaSurvivorsRescued: 0,
      }),
      getFloatingLifeboats: (out) => {
        out.length = 0;
      },
      reset: () => {},
      setLanternPower: () => {},
      dispose: () => {},
    };
  }

  // Lower hull portholes along Decks 1 & 2
  const portholePositions: Array<{ x: number; y: number; z: number; rotY: number }> = [];
  for (const side of [-1, 1] as const) {
    for (let z = -54; z <= 194; z += 4.6) {
      const { beam, sheerY } = sampleConcordiaStation(z);
      const { beam: beamNext } = sampleConcordiaStation(z + 1.5);
      const slopeAngle = Math.atan2((beamNext - beam) * side, 1.5);
      const yKeel = sampleConcordiaKeelY(z);
      for (const dy of [2.4, 4.6]) {
        const x = side * (beam * 0.99 + 0.08);
        const y = sheerY - dy;
        if (y > Math.max(1.4, yKeel + 1.1)) {
          portholePositions.push({
            x,
            y,
            z,
            rotY: (side > 0 ? Math.PI / 2 : -Math.PI / 2) - slopeAngle,
          });
        }
      }
    }
  }
  const portholeProto = buildDisc('conc_portholeProto', 0.25, 10);
  [
    { list: portholePositions.filter((p) => p.z < CONCORDIA_BREAK_Z), tgt: bowContent, tag: 'fwd' },
    { list: portholePositions.filter((p) => p.z >= CONCORDIA_BREAK_Z), tgt: sternContent, tag: 'aft' },
  ].forEach(({ list, tgt, tag }) => {
    if (list.length === 0) return;
    const pSlot = makeSlot(`conc_porthole_${tag}`, portholeProto, portholeGlowMat, list.length, tgt);
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      writeInstanceMatrix(pSlot, i, p.x, p.y, p.z, 0, p.rotY, 0);
    }
    commitInstanceMatrices(pSlot, list.length);
  });

  // Costa Concordia Hull Nameplates ("COSTA CONCORDIA" / "COSTA CONCORDIA GENOVA")
  const bowNameMat = trackMat(
    makePBR('conc_bowName', {
      albedoTex: textures.hullNameplateConcordiaBow,
      alphaCutOff: 0.08,
      roughness: 0.42,
      metallic: 0.28,
      doubleSided: true,
      envIntensity: 0.36,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  const sternNameMat = trackMat(
    makePBR('conc_sternName', {
      albedoTex: textures.hullNameplateConcordiaStern,
      alphaCutOff: 0.08,
      roughness: 0.42,
      metallic: 0.28,
      doubleSided: true,
      envIntensity: 0.36,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );

  const evalHullSurfaceX = (z: number, y: number): number => {
    const { beam, sheerY, flareFactor } = sampleConcordiaStation(z);
    const yKeel = sampleConcordiaKeelY(z);
    const hullFrac = MathUtils.clamp((y - yKeel) / Math.max(0.35, sheerY - yKeel), 0, 1);
    const wr = hullFrac < 0.24 ? Math.sin(((hullFrac / 0.24) * Math.PI) / 2) * 0.92 : 0.92 + ((hullFrac - 0.24) / 0.76) * (0.08 + flareFactor * ((hullFrac - 0.24) / 0.76));
    return beam * wr;
  };
  for (const side of [-1, 1] as const) {
    const bz = -50.0;
    const by = 8.4;
    const bxFront = evalHullSurfaceX(bz - 4.0, by);
    const bxAft = evalHullSurfaceX(bz + 4.0, by);
    const bowPlane = trackMesh(buildPlane(nextId('bowName'), 11.4, 1.55), bowContent);
    bowPlane.material = bowNameMat;
    bowPlane.position.set(side * ((bxFront + bxAft) * 0.5 + 0.14), by, bz);
    bowPlane.rotation.y = (side > 0 ? Math.PI / 2 : -Math.PI / 2) - Math.atan2((bxAft - bxFront) * side, 8.0);
  }
  const sternNamePlane = trackMesh(buildPlane('conc_sternTransomName', 11.5, 1.6), sternContent);
  sternNamePlane.material = sternNameMat;
  sternNamePlane.position.set(0, 7.6, 209.95);

  // Bow Flag (Costa Crociere Blue/Yellow) & Stern Flag (Italian Civil Ensign)
  const bowStaff = trackMesh(buildCylinder('conc_bowStaff', 0.045, 0.075, 5.4, 8), bowContent);
  bowStaff.material = whiteSuperMat;
  bowStaff.position.set(0, 14.3, -78.2);
  const costaFlagMat = trackMat(
    makePBR('conc_costaFlag', {
      albedoTex: textures.costaFlag,
      roughness: 0.70,
      metallic: 0.02,
      doubleSided: true,
      envIntensity: 0.34,
    }),
  );
  const costaFlagPlane = trackMesh(buildPlane('conc_costaFlagPlane', 2.6, 1.5), bowContent);
  costaFlagPlane.material = costaFlagMat;
  costaFlagPlane.position.set(0.05, 16.0, -76.9);
  costaFlagPlane.rotation.y = Math.PI / 2 + 0.12;

  const sternStaff = trackMesh(buildCylinder('conc_sternStaff', 0.05, 0.08, 6.2, 8), sternContent);
  sternStaff.material = whiteSuperMat;
  sternStaff.position.set(0, 13.6, 208.5);
  sternStaff.rotation.x = 0.16;
  const italianFlagMat = trackMat(
    makePBR('conc_italianEnsign', {
      albedoTex: textures.italianEnsignFlag,
      roughness: 0.70,
      metallic: 0.02,
      doubleSided: true,
      envIntensity: 0.34,
    }),
  );
  const italianFlagPlane = trackMesh(buildPlane('conc_italianFlagPlane', 3.4, 2.0), sternContent);
  italianFlagPlane.material = italianFlagMat;
  italianFlagPlane.position.set(0.05, 15.6, 210.4);
  italianFlagPlane.rotation.y = Math.PI / 2 + 0.1;

  // =========================================================================
  // 6. TORN FRACTURE BULKHEADS AT CONCORDIA_BREAK_Z = 98.0
  // =========================================================================
  const tornSteelMat = trackMat(
    makePBR('conc_tornSteel', { color: 0x1e2228, roughness: 0.78, metallic: 0.62, doubleSided: true, envIntensity: 0.36 }),
  );
  const tornRustMat = trackMat(
    makePBR('conc_tornRust', { color: 0x45291e, roughness: 0.84, metallic: 0.45, envIntensity: 0.32 }),
  );
  const breakEmberMat = trackMat(
    makePBR('conc_breakEmber', { color: 0xffa44d, emissive: 0xff6a1a, emissiveIntensity: 1.2, roughness: 0.45, envIntensity: 0.25 }),
  );

  const buildFractureCap = (label: string, dirZ: -1 | 1): THREE.Group => {
    const cap = new THREE.Group();
    cap.name = `conc_breakCap_${label}`;
    cap.position.set(0, 0, CONCORDIA_BREAK_Z - dirZ * 0.18);

    const hullFaceShape = new Shape2D();
    hullFaceShape.moveTo(0, -7.2);
    hullFaceShape.quadraticCurveTo(15.2, -6.4, 16.4, -2.5, 10);
    hullFaceShape.lineTo(17.75, 10.6);
    hullFaceShape.lineTo(14.5, 10.6);
    hullFaceShape.lineTo(14.5, 24.0);
    hullFaceShape.lineTo(-14.5, 24.0);
    hullFaceShape.lineTo(-14.5, 10.6);
    hullFaceShape.lineTo(-17.75, 10.6);
    hullFaceShape.lineTo(-16.4, -2.5);
    hullFaceShape.quadraticCurveTo(-15.2, -6.4, 0, -7.2, 10);

    const faceMesh = trackMesh(buildExtrudedShapeMesh(`conc_bFace_${label}`, hullFaceShape, 0.58, 0), cap);
    faceMesh.material = tornSteelMat;
    faceMesh.position.z = dirZ > 0 ? -0.35 : -0.2;

    for (const dy of [-2.4, 2.2, 6.8, 11.2, 16.5, 21.5]) {
      const w = dy < 11 ? 31.0 : 27.6;
      const slab = trackMesh(buildBox(nextId('bSlab'), w, 0.32, 1.3), cap);
      slab.material = tornRustMat;
      slab.position.set(0, dy, dirZ * 0.3);
    }
    for (const [ex, ey] of [[-5.6, 3.6], [5.6, 3.6], [-7.5, 12.2], [7.5, 12.2], [0, 18.2]]) {
      const ember = trackMesh(buildPlane(nextId('bEmber'), 3.4, 1.6), cap);
      ember.material = breakEmberMat;
      ember.position.set(ex, ey, dirZ * 0.36);
      if (dirZ < 0) ember.rotation.y = Math.PI;
    }
    cap.visible = false;
    return cap;
  };
  const bowBreakCap = companionOnly ? new THREE.Group() : buildFractureCap('bow', 1);
  if (!companionOnly) bowContent.add(bowBreakCap);
  const sternBreakCap = companionOnly ? new THREE.Group() : buildFractureCap('stern', -1);
  if (!companionOnly) sternContent.add(sternBreakCap);

  // =========================================================================
  // 7. PANORAMIC NAVIGATION BRIDGE AT [0, 26.8, 0] WITH WIDE DOCKING WINGS
  // =========================================================================
  const wheelhouse = new THREE.Group();
  wheelhouse.name = 'conc_wheelhouse';
  bowContent.add(wheelhouse);
  wheelhouse.position.set(0, 26.8, 0);

  // Extended bridge wings (39.6m total span -> +/- 19.8m beyond 17.75m hull beam!)
  const bridgeFloor = trackMesh(buildBox('conc_whFloor', 39.6, 0.24, 6.2), wheelhouse, true);
  bridgeFloor.material = darkCharcoalMat;
  bridgeFloor.position.set(0, -0.1, 0.8);

  const bridgeWingGlass = trackMesh(buildBox('conc_whRoof', 39.8, 0.26, 6.8), wheelhouse, true);
  bridgeWingGlass.material = whiteSuperMat;
  bridgeWingGlass.position.set(0, 3.05, 1.0);

  // Center Panoramic Helm House + Sloped Front Windshield
  const whFrontLower = trackMesh(buildBox('conc_whFrontL', 13.8, 1.08, 0.32), wheelhouse);
  whFrontLower.material = whiteSuperMat;
  whFrontLower.position.set(0, 0.54, -1.65);

  const whFrontWin = trackMesh(buildBox('conc_whFrontW', 13.4, 1.85, 0.1), wheelhouse);
  whFrontWin.material = clearGlassMat;
  whFrontWin.position.set(0, 1.98, -1.52);
  whFrontWin.rotation.x = -0.14;

  const whFrontHeader = trackMesh(buildBox('conc_whFrontH', 14.0, 0.36, 0.38), wheelhouse);
  whFrontHeader.material = whiteSuperMat;
  whFrontHeader.position.set(0, 2.86, -1.4);

  for (const mx of [-6.4, -4.1, -1.8, 1.8, 4.1, 6.4]) {
    const mullion = trackMesh(buildBox(nextId('whMull'), 0.13, 1.9, 0.16), wheelhouse);
    mullion.material = darkCharcoalMat;
    mullion.position.set(mx, 1.95, -1.54);
    mullion.rotation.x = -0.14;
  }

  for (const side of [-1, 1] as const) {
    // Bridge wing outer enclosures & glass screens
    const wingWall = trackMesh(buildBox(nextId('wingWall'), 13.2, 1.15, 0.22), wheelhouse);
    wingWall.material = whiteSuperMat;
    wingWall.position.set(side * 13.2, 0.58, -1.4);

    const wingGlass = trackMesh(buildBox(nextId('wingGlass'), 13.0, 1.4, 0.08), wheelhouse);
    wingGlass.material = clearGlassMat;
    wingGlass.position.set(side * 13.2, 1.85, -1.4);

    // Wing docking thrusters / repeater consoles + Port/Starboard Nav Lights
    const wingConsole = trackMesh(buildBox(nextId('wingCons'), 1.1, 1.05, 0.72), wheelhouse);
    wingConsole.material = darkCharcoalMat;
    wingConsole.position.set(side * 18.4, 0.54, -0.5);

    const navHouse = trackMesh(buildBox(nextId('navHouse'), 0.65, 1.0, 0.9), wheelhouse);
    navHouse.material = whiteSuperMat;
    navHouse.position.set(side * 19.65, 1.65, -0.8);

    const navBulb = trackMesh(buildSphere(nextId('navBulb'), 0.22, 10, 10), wheelhouse);
    navBulb.material = side < 0 ? portLightMat : starboardLightMat;
    navBulb.position.set(side * 19.85, 1.68, -1.15);
  }

  // Modern Costa Curved Console Desk + ECDIS Radar Displays + Helm Wheel + Dual Telegraphs
  const bridgeDesk = trackMesh(buildBox('conc_helmDesk', 7.4, 0.88, 1.05), wheelhouse);
  bridgeDesk.material = darkCharcoalMat;
  bridgeDesk.position.set(0, 0.44, -0.78);

  const deskWoodTrim = trackMesh(buildBox('conc_deskTrim', 7.45, 0.08, 1.1), wheelhouse);
  deskWoodTrim.material = mahoganyMat;
  deskWoodTrim.position.set(0, 0.89, -0.78);

  for (const sx of [-2.4, -1.1, 1.1, 2.4]) {
    const ecdis = trackMesh(buildBox(nextId('ecdis'), 0.68, 0.44, 0.08), wheelhouse);
    ecdis.material = ecdisScreenMat;
    ecdis.position.set(sx, 1.14, -0.92);
    ecdis.rotation.x = -0.35;
  }

  // Overhead rudder & clinometer gauges
  const overheadBar = trackMesh(buildBox('conc_overBar', 2.6, 0.28, 0.28), wheelhouse);
  overheadBar.material = darkCharcoalMat;
  overheadBar.position.set(0, 2.65, -0.98);
  const rudderNeedle = trackMesh(buildBox('conc_rudNeedle', 0.045, 0.16, 0.05), wheelhouse);
  rudderNeedle.material = chromeMat;
  rudderNeedle.position.set(0, 2.64, -0.82);

  const clinoDialMat = trackMat(
    makePBR('conc_clinoDial', {
      albedoTex: textures.clinometerDial,
      emissiveTex: textures.clinometerDial,
      emissive: 0xffe4b3,
      emissiveIntensity: 0.4,
      roughness: 0.42,
      envIntensity: 0.25,
    }),
  );
  const clinoFace = trackMesh(buildDisc('conc_clinoFace', 0.15, 20), wheelhouse);
  clinoFace.material = clinoDialMat;
  clinoFace.position.set(0.75, 2.64, -0.82);
  const clinometerNeedle = trackMesh(buildBox('conc_clinoNeedle', 0.02, 0.12, 0.03), wheelhouse);
  clinometerNeedle.material = brassMat;
  clinometerNeedle.position.set(0.75, 2.64, -0.8);

  // Helm Stand & Compact Modern Yacht/Cruise Wheel
  const helmStand = trackMesh(buildBox('conc_helmStand', 0.52, 0.96, 0.44), wheelhouse);
  helmStand.material = darkCharcoalMat;
  helmStand.position.set(0, 0.48, -0.15);

  const helmWheel = new THREE.Group();
  helmWheel.name = 'conc_helmWheel';
  wheelhouse.add(helmWheel);
  helmWheel.position.set(0, 1.08, -0.35);
  helmWheel.rotation.x = -0.16;
  const wheelRim = trackMesh(buildTorusXY('conc_wheelRim', 0.34, 0.036, 12, 24), helmWheel);
  wheelRim.material = chromeMat;
  const wheelHub = trackMesh(buildCylinder('conc_wheelHub', 0.08, 0.08, 0.11, 16), helmWheel);
  wheelHub.material = brassMat;
  wheelHub.rotation.x = Math.PI / 2;
  for (let i = 0; i < 3; i++) {
    const spoke = trackMesh(buildCylinder(nextId('spoke'), 0.018, 0.022, 0.64, 8), helmWheel);
    spoke.material = chromeMat;
    spoke.rotation.z = (i * Math.PI) / 3;
  }

  // Compass Binnacle
  const compassCardMat = trackMat(
    makePBR('conc_compassCard', {
      albedoTex: textures.compassDial,
      emissiveTex: textures.compassDial,
      emissive: 0xbae6fd,
      emissiveIntensity: 0.65,
      roughness: 0.44,
      envIntensity: 0.25,
    }),
  );
  const compassHousing = trackMesh(buildCylinder('conc_compassHous', 0.19, 0.22, 0.24, 16), wheelhouse);
  compassHousing.material = chromeMat;
  compassHousing.position.set(-0.78, 0.98, -0.58);
  const compassMount = new THREE.Group();
  wheelhouse.add(compassMount);
  compassMount.position.set(-0.78, 1.11, -0.58);
  compassMount.rotation.x = -Math.PI / 2 + 0.18;
  const compassCard = trackMesh(buildDisc('conc_compassCardMesh', 0.16, 22), compassMount);
  compassCard.material = compassCardMat;

  // Dual COSTA CROCIERE Propulsion Telegraphs
  const telegraphDialMats: THREE.MeshPhysicalMaterial[] = [];
  const makeTelegraph = (xPos: number, idx: number): THREE.Group => {
    const tGroup = new THREE.Group();
    wheelhouse.add(tGroup);
    tGroup.position.set(xPos, 0.9, -0.45);
    const base = trackMesh(buildBox(nextId('tBase'), 0.28, 0.22, 0.36), tGroup);
    base.material = darkCharcoalMat;
    const drum = trackMesh(buildCylinder(nextId('tDrum'), 0.18, 0.18, 0.15, 18), tGroup);
    drum.material = brassMat;
    drum.rotation.z = Math.PI / 2;
    drum.position.y = 0.22;

    const dialMat = trackMat(
      makePBR(`conc_telDial_${idx}`, {
        albedoTex: textures.telegraphDialCosta,
        emissiveTex: textures.telegraphDialCosta,
        emissive: 0xffe4a3,
        emissiveIntensity: 0.55,
        roughness: 0.44,
        envIntensity: 0.25,
      }),
    );
    telegraphDialMats.push(dialMat);
    const dialFace = trackMesh(buildDisc(nextId('tDialFace'), 0.16, 22), tGroup);
    dialFace.material = dialMat;
    dialFace.rotation.y = xPos > 0 ? -Math.PI / 2 : Math.PI / 2;
    dialFace.position.set(xPos > 0 ? -0.08 : 0.08, 0.22, 0);

    const leverPivot = new THREE.Group();
    tGroup.add(leverPivot);
    leverPivot.position.set(xPos > 0 ? -0.095 : 0.095, 0.22, 0);
    const arm = trackMesh(buildCylinder(nextId('tArm'), 0.014, 0.017, 0.29, 8), leverPivot);
    arm.material = chromeMat;
    arm.position.y = 0.145;
    const handle = trackMesh(buildCylinder(nextId('tHandle'), 0.025, 0.025, 0.13, 10), leverPivot);
    handle.material = darkCharcoalMat;
    handle.rotation.z = Math.PI / 2;
    handle.position.y = 0.29;
    return leverPivot;
  };
  const telegraphLever = makeTelegraph(0.75, 0);
  const telegraphLeverPort = makeTelegraph(-1.35, 1);

  const warmBridgeLight = new THREE.PointLight(0xffcb80, 6.5, 16.0, 1.0);
  warmBridgeLight.position.set(0, 29.4, 0.3);
  bowContent.add(warmBridgeLight);

  const deckGlowFwd = new THREE.PointLight(0xffe1aa, 18.0, 120, 1.0);
  deckGlowFwd.position.set(0, 26.0, 58);
  bowContent.add(deckGlowFwd);

  const whFloodMat = trackMat(
    makePBR('conc_whFlood', {
      color: 0x092238,
      roughness: 0.25,
      metallic: 0.22,
      alpha: 0.84,
      doubleSided: true,
      envIntensity: 0.32,
    }),
  );
  const whFloodMesh = trackMesh(buildPlane('conc_whFloodMesh', 13.4, 5.6), wheelhouse);
  whFloodMesh.material = whFloodMat;
  whFloodMesh.rotation.x = -Math.PI / 2;
  whFloodMesh.position.set(0, 0.02, 0.6);
  whFloodMesh.visible = false;

  // Radar Mast, Rotating X/S-Band Scanners & Twin White SATCOM Radomes above Bridge Roof
  const radarMast = trackMesh(buildCylinder('conc_radarMast', 0.35, 0.85, 14.5, 12), bowContent, true);
  radarMast.material = whiteSuperMat;
  radarMast.position.set(0, 36.8, 5.5);
  radarMast.rotation.x = 0.12;

  const mastPlatform = trackMesh(buildBox('conc_mastPlat', 7.2, 0.25, 2.2), bowContent);
  mastPlatform.material = whiteSuperMat;
  mastPlatform.position.set(0, 39.2, 5.8);

  const radarScanners: THREE.Group[] = [];
  for (const [rx, ry, rz, span] of [[-2.1, 39.6, 5.8, 3.6], [2.1, 41.2, 6.0, 2.8]] as const) {
    const rPed = trackMesh(buildCylinder(nextId('rPed'), 0.22, 0.26, 0.6, 10), bowContent);
    rPed.material = whiteSuperMat;
    rPed.position.set(rx, ry - 0.35, rz);
    const barGrp = new THREE.Group();
    bowContent.add(barGrp);
    barGrp.position.set(rx, ry, rz);
    const bar = trackMesh(buildBox(nextId('rBar'), span, 0.22, 0.32), barGrp);
    bar.material = whiteSuperMat;
    radarScanners.push(barGrp);
  }
  for (const dx of [-5.2, 5.2]) {
    const radome = trackMesh(buildSphere(nextId('radome'), 1.55, 16, 12), bowContent, true);
    radome.material = whiteSuperMat;
    radome.position.set(dx, 31.6, 8.5);
  }

  // =========================================================================
  // 8. ACCESSIBLE MODERN INTERIORS & DIESEL-ELECTRIC PROPULSION ROOM
  // =========================================================================
  const dieselFlywheels: THREE.Group[] = [];
  let stairLight: THREE.PointLight | null = null;
  let marconiLight: THREE.PointLight | null = null;
  let loungeLight: THREE.PointLight | null = null;
  let diningLight: THREE.PointLight | null = null;
  let engineLight: THREE.PointLight | null = null;

  if (!companionOnly) {
    // A. Europa Grand Atrium (z = 32..52, eye [0, 15.2, 42.0])
    const atriumGrp = new THREE.Group();
    bowContent.add(atriumGrp);
    const atriumFlr = trackMesh(buildBox('conc_atrFlr', 16.2, 0.28, 21.0), atriumGrp);
    atriumFlr.material = interiorMarbleMat;
    atriumFlr.position.set(0, 13.45, 42.0);
    for (const ax of [-8.0, 8.0]) {
      const aWall = trackMesh(buildBox(nextId('atrWall'), 0.28, 11.5, 21.0), atriumGrp);
      aWall.material = whiteSuperMat;
      aWall.position.set(ax, 19.2, 42.0);
    }
    for (const az of [31.6, 52.4]) {
      const aEnd = trackMesh(buildBox(nextId('atrEnd'), 16.2, 11.5, 0.28), atriumGrp);
      aEnd.material = mahoganyMat;
      aEnd.position.set(0, 19.2, az);
    }
    // Panoramic glass elevator shafts & golden skylight ring
    for (const ex of [-4.6, 4.6]) {
      const shaft = trackMesh(buildCylinder(nextId('elevShaft'), 1.15, 1.15, 10.6, 12), atriumGrp);
      shaft.material = clearGlassMat;
      shaft.position.set(ex, 18.8, 33.4);
      const liftCar = trackMesh(buildCylinder(nextId('liftCar'), 0.95, 0.95, 2.2, 12), atriumGrp);
      liftCar.material = warmGlowMat;
      liftCar.position.set(ex, 17.8, 33.4);
    }
    const atrChandelier = trackMesh(buildTorusXY('conc_atrChand', 2.4, 0.18, 8, 24), atriumGrp);
    atrChandelier.material = warmGlowMat;
    atrChandelier.rotation.x = Math.PI / 2;
    atrChandelier.position.set(0, 22.8, 42.0);

    stairLight = new THREE.PointLight(0xffd28a, 24.0, 32, 1.0);
    stairLight.position.set(0, 21.5, 42.0);
    bowContent.add(stairLight);

    // B. Bridge Radio & Radar Center (z = 3.6..9.2, eye [0, 28.1, 6.2])
    const radioGrp = new THREE.Group();
    bowContent.add(radioGrp);
    const radFlr = trackMesh(buildBox('conc_radFlr', 11.0, 0.2, 6.4), radioGrp);
    radFlr.material = darkCharcoalMat;
    radFlr.position.set(0, 26.68, 6.2);
    const chartTbl = trackMesh(buildBox('conc_chartTbl', 3.4, 0.92, 1.6), radioGrp);
    chartTbl.material = mahoganyMat;
    chartTbl.position.set(0, 27.2, 5.2);
    const gmdssRack = trackMesh(buildBox('conc_gmdss', 4.6, 1.85, 0.85), radioGrp);
    gmdssRack.material = darkCharcoalMat;
    gmdssRack.position.set(0, 27.65, 8.6);
    const radScreen = trackMesh(buildBox('conc_radScr', 1.4, 0.82, 0.08), radioGrp);
    radScreen.material = ecdisScreenMat;
    radScreen.position.set(0, 28.05, 8.15);

    marconiLight = new THREE.PointLight(0xbae6fd, 16.0, 20, 1.0);
    marconiLight.position.set(0, 29.2, 6.2);
    bowContent.add(marconiLight);

    // C. Lido Magrodome Pool Deck (z = 56..88, eye [0, 25.4, 72.0])
    const loungerProto = buildBox('conc_loungerProto', 0.8, 0.35, 2.0);
    const lSlot = makeSlot('conc_loungers', loungerProto, whiteSuperMat, 12, bowContent);
    let li = 0;
    for (const lx of [-8.8, 8.8]) {
      for (let lz = 61; lz <= 81; lz += 4.0) {
        writeInstanceMatrix(lSlot, li++, lx, 24.3, lz, 0, lx > 0 ? -Math.PI / 2 : Math.PI / 2, 0);
      }
    }
    commitInstanceMatrices(lSlot, li);
    loungeLight = new THREE.PointLight(0x5eead4, 24.0, 36, 1.0);
    loungeLight.position.set(0, 28.8, 72.0);
    bowContent.add(loungeLight);

    // D. Ristorante Milano Dining (z = 42..74, eye [0, 6.4, 58.0])
    const diningGrp = new THREE.Group();
    bowContent.add(diningGrp);
    const dinFlr = trackMesh(buildBox('conc_dinFlr', 27.6, 0.25, 32.0), diningGrp);
    dinFlr.material = crimsonCarpetMat;
    dinFlr.position.set(0, 4.65, 58.0);
    const dinCeil = trackMesh(buildBox('conc_dinCeil', 27.6, 0.22, 32.0), diningGrp);
    dinCeil.material = whiteSuperMat;
    dinCeil.position.set(0, 9.2, 58.0);
    for (const dz of [42.0, 74.0]) {
      const dWall = trackMesh(buildBox(nextId('dinW'), 27.6, 4.5, 0.3), diningGrp);
      dWall.material = mahoganyMat;
      dWall.position.set(0, 6.9, dz);
    }
    for (const side of [-1, 1] as const) {
      const sWall = trackMesh(buildBox(nextId('dinS'), 0.3, 4.5, 32.0), diningGrp);
      sWall.material = mahoganyMat;
      sWall.position.set(side * 13.7, 6.9, 58.0);
    }
    const tableSpots: Array<[number, number]> = [];
    for (const tx of [-9.5, -4.8, 0, 4.8, 9.5]) {
      for (let tz = 46; tz <= 70; tz += 5.0) tableSpots.push([tx, tz]);
    }
    const dTblProto = buildCylinder('conc_dTblProto', 0.95, 0.95, 0.12, 14);
    const dLampProto = buildSphere('conc_dLampProto', 0.12, 8, 8);
    const tmSlot = makeSlot('conc_dinTables', dTblProto, linenClothMat, tableSpots.length, diningGrp);
    const lmSlot = makeSlot('conc_dinLamps', dLampProto, warmGlowMat, tableSpots.length, diningGrp);
    for (let i = 0; i < tableSpots.length; i++) {
      writeInstanceMatrix(tmSlot, i, tableSpots[i][0], 5.55, tableSpots[i][1], 0, 0, 0);
      writeInstanceMatrix(lmSlot, i, tableSpots[i][0], 5.82, tableSpots[i][1], 0, 0, 0);
    }
    commitInstanceMatrices(tmSlot, tableSpots.length);
    commitInstanceMatrices(lmSlot, tableSpots.length);
    diningLight = new THREE.PointLight(0xffcb78, 22.0, 36, 1.0);
    diningLight.position.set(0, 8.4, 58.0);
    bowContent.add(diningLight);

    // E. Diesel-Electric Propulsion Room (z = 108..136, eye [0, 2.2, 122.0])
    const engineGrp = new THREE.Group();
    sternContent.add(engineGrp);
    const engFlr = trackMesh(buildBox('conc_engFlr', 22.0, 0.35, 28.0), engineGrp);
    engFlr.material = darkCharcoalMat;
    engFlr.position.set(0, -3.55, 122.0);
    for (const ez of [108.0, 136.0]) {
      const bulk = trackMesh(buildBox(nextId('engB'), 22.0, 13.5, 0.35), engineGrp);
      bulk.material = darkCharcoalMat;
      bulk.position.set(0, 3.1, ez);
    }
    for (const side of [-1, 1] as const) {
      const casSide = trackMesh(buildBox(nextId('engSide'), 0.35, 13.5, 28.0), engineGrp);
      casSide.material = darkCharcoalMat;
      casSide.position.set(side * 10.8, 3.1, 122.0);
      const catwalk = trackMesh(buildBox(nextId('engCat'), 1.85, 0.14, 26.8), engineGrp);
      catwalk.material = chromeMat;
      catwalk.position.set(side * 9.5, 1.65, 122.0);

      // 3 twin rows of Wärtsilä V12 diesel-generator prime movers
      for (const gz of [113.5, 122.0, 130.5]) {
        const block = trackMesh(buildBox(nextId('genBlk'), 3.4, 3.2, 6.2), engineGrp);
        block.material = engineTealMat;
        block.position.set(side * 4.5, -1.8, gz);

        const altDrum = trackMesh(buildCylinder(nextId('altDrum'), 1.15, 1.15, 2.2, 16), engineGrp);
        altDrum.material = brassMat;
        altDrum.rotation.x = Math.PI / 2;
        altDrum.position.set(side * 4.5, -2.0, gz + 3.4);

        const fwGrp = new THREE.Group();
        engineGrp.add(fwGrp);
        fwGrp.position.set(side * 4.5, -2.0, gz + 4.6);
        const fw = trackMesh(buildCylinder(nextId('flyw'), 1.35, 1.35, 0.25, 18), fwGrp);
        fw.material = chromeMat;
        fw.rotation.x = Math.PI / 2;
        dieselFlywheels.push(fwGrp);
      }
    }
    engineLight = new THREE.PointLight(0x7dd3fc, 24.0, 36, 1.0);
    engineLight.position.set(0, 6.6, 122.0);
    sternContent.add(engineLight);
  }

  // =========================================================================
  // 9. BRIDGE ROOF SEARCHLIGHT & VOLUMETRIC BEAM (y = 30.2, z = -1.2)
  // =========================================================================
  const slPedestal = trackMesh(buildCylinder('conc_slPed', 0.16, 0.25, 0.34, 12), bowContent);
  slPedestal.material = chromeMat;
  slPedestal.position.set(0, 30.02, -1.2);
  const searchlightHead = new THREE.Group();
  bowContent.add(searchlightHead);
  searchlightHead.position.set(0, 30.28, -1.2);
  const slHousing = trackMesh(buildCylinder('conc_slHous', 0.34, 0.28, 0.74, 14), searchlightHead);
  slHousing.material = whiteSuperMat;
  slHousing.rotation.x = Math.PI / 2;
  const slLens = trackMesh(buildDisc('conc_slLens', 0.28, 14), searchlightHead);
  slLens.material = warmGlowMat;
  slLens.rotation.y = Math.PI;
  slLens.position.z = -0.38;
  const searchlightOrigin = new THREE.Object3D();
  searchlightOrigin.position.set(0, 0, -0.42);
  searchlightHead.add(searchlightOrigin);

  const beamUniforms = { uOpacity: { value: 0.0 } };
  let searchlightBeam: THREE.Mesh | null = null;
  if (!companionOnly) {
    const beamGeo = new THREE.CylinderGeometry(0.3, 9.2, 130, 24, 1, true);
    beamGeo.rotateX(Math.PI / 2);
    beamGeo.translate(0, 0, -65.4);
    const beamMat = trackMat(
      new THREE.ShaderMaterial({
        name: 'conc_searchlightBeam',
        uniforms: beamUniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vNormalView;
          varying vec3 vViewPos;
          void main() {
            vUv = uv;
            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
            vViewPos = -mvPos.xyz;
            vNormalView = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * mvPos;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uOpacity;
          varying vec2 vUv;
          varying vec3 vNormalView;
          varying vec3 vViewPos;
          void main() {
            float distFade = pow(clamp(vUv.y, 0.0, 1.0), 1.65);
            vec3 v = normalize(vViewPos);
            float rim = pow(abs(dot(normalize(vNormalView), v)), 1.45);
            float a = uOpacity * distFade * rim;
            gl_FragColor = vec4(0.86, 0.94, 1.0, a);
          }
        `,
      }),
    );
    searchlightBeam = trackMesh(new THREE.Mesh(beamGeo, beamMat), searchlightHead);
    searchlightBeam.receiveShadow = false;
    searchlightBeam.castShadow = false;
    searchlightBeam.renderOrder = 4;
    searchlightBeam.visible = false;
  }

  const searchlightTarget = new THREE.Object3D();
  bowContent.add(searchlightTarget);
  searchlightTarget.position.set(0, 1.5, -160);

  let enginePhase = 0;
  let radarPhase = 0;
  const setEngineSpeed = (knots: number, dt: number) => {
    radarPhase += dt * 2.2;
    for (let i = 0; i < radarScanners.length; i++) {
      radarScanners[i].rotation.y = radarPhase * (i === 0 ? 1 : -1.35);
    }
    if (companionOnly) return;
    enginePhase += knots * dt * 1.4;
    for (let i = 0; i < dieselFlywheels.length; i++) {
      dieselFlywheels[i].rotation.z = enginePhase * (i % 2 === 0 ? 1 : -1);
    }
    for (let i = 0; i < propSpinners.length; i++) {
      propSpinners[i].rotation.z = enginePhase * (i === 0 ? 1 : -1);
    }
  };

  if (stairLight) stairLight.visible = false;
  if (marconiLight) marconiLight.visible = false;
  if (loungeLight) loungeLight.visible = false;
  if (diningLight) diningLight.visible = false;
  if (engineLight) engineLight.visible = false;

  const setActiveInteriorSpot = (spotId: string, insideDryCompartment: boolean, powerLevel: number) => {
    if (companionOnly) return;
    const p = MathUtils.clamp(Math.max(0.28, powerLevel), 0, 1);
    const stairOn = insideDryCompartment && spotId === 'staircase';
    const marconiOn = insideDryCompartment && spotId === 'marconi';
    const loungeOn = insideDryCompartment && spotId === 'lounge';
    const diningOn = insideDryCompartment && spotId === 'dining';
    const engineOn = insideDryCompartment && spotId === 'engine';
    if (stairLight) {
      stairLight.visible = stairOn;
      if (stairOn) stairLight.intensity = 24.0 * p;
    }
    if (marconiLight) {
      marconiLight.visible = marconiOn;
      if (marconiOn) marconiLight.intensity = 16.0 * p;
    }
    if (loungeLight) {
      loungeLight.visible = loungeOn;
      if (loungeOn) loungeLight.intensity = 24.0 * p;
    }
    if (diningLight) {
      diningLight.visible = diningOn;
      if (diningOn) diningLight.intensity = 22.0 * p;
    }
    if (engineLight) {
      engineLight.visible = engineOn;
      if (engineOn) engineLight.intensity = 24.0 * p;
    }
  };

  const setPowerLevel = (power: number) => {
    const p = MathUtils.clamp(power, 0, 1);
    warmBridgeLight.intensity = companionOnly ? 0 : 6.5 * p;
    warmBridgeLight.visible = !companionOnly && p > 0.03;
    deckGlowFwd.intensity = companionOnly ? 0 : 18.0 * p;
    deckGlowFwd.visible = !companionOnly && p > 0.08;
    warmGlowMat.emissiveIntensity = 0.08 + 0.72 * p;
    portholeGlowMat.emissiveIntensity = 0.14 + 0.78 * p;
    poolWaterMat.emissiveIntensity = 0.25 + 0.45 * p;
    compassCardMat.emissiveIntensity = 0.1 + 0.35 * p;
    clinoFaceMat.emissiveIntensity = 0.08 + 0.25 * p;
    for (const dm of telegraphDialMats) {
      dm.emissiveIntensity = 0.1 + 0.3 * p;
    }
    portLightMat.emissiveIntensity = 0.9 * p;
    starboardLightMat.emissiveIntensity = 0.9 * p;
    crewAndLifeboats.setLanternPower(p);
  };

  const setWheelhouseFloodLevel = (level: number, fadeFactor = 1.0) => {
    if (companionOnly) return;
    const l = MathUtils.clamp(level, 0, 1);
    const fade = MathUtils.clamp(fadeFactor, 0, 1);
    if (l <= 0.01 || fade <= 0.02) {
      whFloodMesh.visible = false;
      return;
    }
    whFloodMesh.visible = true;
    whFloodMat.opacity = 0.84 * fade;
    whFloodMesh.position.y = 0.14 + l * 1.65;
  };

  const setBreakupVisual = (broken: boolean, emberPower = 0) => {
    bowBreakCap.visible = !companionOnly && broken;
    sternBreakCap.visible = !companionOnly && broken;
    breakEmberMat.emissiveIntensity = broken ? MathUtils.clamp(emberPower, 0, 1.5) : 0;
  };

  const setSearchlightBeam = (power: number, wide: boolean) => {
    if (!searchlightBeam) return;
    const p = MathUtils.clamp(power, 0, 1);
    const active = p > 0.04;
    searchlightBeam.visible = active;
    if (!active) return;
    beamUniforms.uOpacity.value = (wide ? 0.14 : 0.05) * p;
    const widthScale = wide ? 1.28 : 0.85;
    searchlightBeam.scale.set(widthScale, widthScale, wide ? 1.15 : 0.85);
  };

  const dispose = () => {
    crewAndLifeboats.dispose();
    warmBridgeLight.dispose();
    deckGlowFwd.dispose();
    stairLight?.dispose();
    marconiLight?.dispose();
    loungeLight?.dispose();
    diningLight?.dispose();
    engineLight?.dispose();

    const geos = new Set<THREE.BufferGeometry>();
    for (const m of trackedMeshes) geos.add(m.geometry);
    for (const g of protoGeos) geos.add(g);
    for (const s of instancedSlots) {
      geos.add(s.mesh.geometry);
      s.mesh.dispose();
      s.mesh.removeFromParent();
    }
    geos.forEach((g) => g.dispose());
    for (const m of trackedMeshes) m.removeFromParent();
    for (const mat of materials) mat.dispose();
    root.removeFromParent();
  };

  return {
    root,
    hullMeshGroup,
    bowGroup,
    sternGroup,
    bowContent,
    sternContent,
    helmWheel,
    compassCard,
    telegraphLever,
    telegraphLeverPort,
    searchlightHead,
    searchlightOrigin,
    searchlightTarget,
    rudderNeedle,
    clinometerNeedle,
    warmBridgeLight,
    shadowCasters,
    crewAndLifeboats,
    setPowerLevel,
    setActiveInteriorSpot,
    setEngineSpeed,
    setWheelhouseFloodLevel,
    setBreakupVisual,
    setSearchlightBeam,
    dispose,
  };
}
