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
  colorFromHex,
  commitInstanceMatrices,
  createInstancedSlot,
  makePBR,
  setEulerXYZ,
  writeInstanceMatrix,
} from './threeHelpers';
import { createCrewAndLifeboats, CrewAndLifeboatSystem } from './charactersBuilder';
import { TitanicShipRig } from './shipBuilder';
import { ProceduralTextureSet } from './textures';

export const LUSITANIA_BREAK_Z = 78.0;

/**
 * Evaluates true 1:1 scale RMS Lusitania hull half-beam (max 13.4m / 26.8m beam)
 * and sheer height from Bow Stem (z = -66.0) to Counter Stern (z = +173.8) -> 239.8m LOA.
 * Signature Cunard flush shelter deck (no Titanic open well decks) with raised forecastle.
 */
function sampleLusitaniaStation(z: number): {
  beam: number;
  sheerY: number;
  flareFactor: number;
} {
  let beam = 13.4;
  let flareFactor = 0.055;

  if (z < -8) {
    const t = MathUtils.clamp((z - -66.0) / 58.0, 0, 1);
    beam = 13.4 * Math.pow(Math.sin((t * Math.PI) / 2), 0.76);
    flareFactor = 0.25 * (1 - t) + 0.05;
  } else if (z > 120) {
    const t = MathUtils.clamp((173.8 - z) / 53.8, 0, 1);
    beam = 13.4 * Math.pow(Math.sin((t * Math.PI) / 2), 0.66);
    flareFactor = 0.14 * (1 - t) + 0.04;
  }

  let sheerY = 7.45;
  if (z < -31.5) {
    const t = MathUtils.clamp((-31.5 - z) / 34.5, 0, 1);
    sheerY = 9.05 + t * 1.05;
  } else if (z > 152.0) {
    const t = MathUtils.clamp((z - 152.0) / 21.8, 0, 1);
    sheerY = 7.45 + t * 1.0;
  }

  return { beam, sheerY, flareFactor };
}

function sampleLusitaniaKeelY(z: number): number {
  if (z < -56) {
    const t = MathUtils.clamp((-56 - z) / 10.0, 0, 1);
    return -6.5 + 2.7 * t * t;
  }
  if (z > 148) {
    if (z <= 164) {
      const t = (z - 148) / 16.0;
      return -6.5 + 2.3 * Math.pow(t, 1.3);
    }
    const u = MathUtils.clamp((z - 164) / 9.8, 0, 1);
    return -4.2 + 7.6 * Math.pow(u, 0.85);
  }
  return -6.5;
}

function buildLusitaniaHullSection(
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
    const { beam, sheerY, flareFactor } = sampleLusitaniaStation(z);
    const vCoord = (z + 66.0) / 239.8;
    const yKeel = sampleLusitaniaKeelY(z);
    const yTop = sheerY;

    let y: number;
    if (isLowerBand) {
      const yMaxWL = Math.min(0.26, yTop - 0.08);
      const yHigh = Math.max(yKeel + 0.02, yMaxWL);
      const localU = yMaxFrac > 0 ? frac / yMaxFrac : 0;
      y = MathUtils.lerp(yKeel, yHigh, localU);
    } else if (isUpperBand) {
      const yLow = Math.min(yTop - 0.04, Math.max(yKeel, 0.22));
      const localU = (frac - yMinFrac) / Math.max(0.001, 1.0 - yMinFrac);
      y = MathUtils.lerp(yLow, yTop, localU);
    } else {
      y = MathUtils.lerp(yKeel, yTop, frac);
    }

    const totalDepth = Math.max(0.35, yTop - yKeel);
    const hullFrac = MathUtils.clamp((y - yKeel) / totalDepth, 0, 1);

    let widthRatio: number;
    if (hullFrac < 0.28) {
      widthRatio = Math.sin(((hullFrac / 0.28) * Math.PI) / 2) * 0.88;
    } else {
      const up = (hullFrac - 0.28) / 0.72;
      widthRatio = 0.88 + up * 0.12 + up * up * flareFactor;
    }

    if (z > 160) {
      const sternU = MathUtils.clamp((z - 160) / 13.8, 0, 1);
      widthRatio *= 1.0 - sternU * 0.08 * (1.0 - hullFrac);
    }

    const bowRake = z <= -64.0 ? -(hullFrac * 1.75) : 0;
    const x = side * beam * widthRatio;
    return [x, y, z + bowRake, vCoord * 7.5, hullFrac];
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

function buildLusitaniaWeatherDeck(
  name: string,
  zSamples: number[],
  yTopOffset = 0.04,
  thickness = 0.42,
  edgeExpand = 0.04,
): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringPts = 5;

  for (let zi = 0; zi < zSamples.length; zi++) {
    const z = zSamples[zi];
    const { beam, sheerY, flareFactor } = sampleLusitaniaStation(z);
    const halfW = Math.max(0.05, beam * (1 + flareFactor) + edgeExpand);
    const bowRake = z <= -64.0 ? -1.75 : 0;
    const zz = z + bowRake;
    const yTop = sheerY + yTopOffset;
    const yBot = yTop - thickness;
    const vCoord = (z + 66.0) / 239.8;

    positions.push(-halfW, yBot, zz);
    uvs.push(0, vCoord * 11);
    positions.push(-halfW, yTop, zz);
    uvs.push(0.15, vCoord * 11);
    positions.push(0, yTop + 0.08, zz);
    uvs.push(0.5, vCoord * 11);
    positions.push(halfW, yTop, zz);
    uvs.push(0.85, vCoord * 11);
    positions.push(halfW, yBot, zz);
    uvs.push(1.0, vCoord * 11);
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

  const addEndCap = (zi: number, flip: boolean) => {
    const base = zi * ringPts;
    if (flip) {
      indices.push(base + 0, base + 1, base + 2);
      indices.push(base + 0, base + 2, base + 3);
      indices.push(base + 0, base + 3, base + 4);
    } else {
      indices.push(base + 0, base + 2, base + 1);
      indices.push(base + 0, base + 3, base + 2);
      indices.push(base + 0, base + 4, base + 3);
    }
  };
  addEndCap(0, false);
  addEndCap(zSamples.length - 1, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo);
  mesh.name = name;
  return mesh;
}

function buildCurvedFootprint(
  name: string,
  halfWidth: number,
  zMin: number,
  zMax: number,
  height: number,
  bowCurveLen: number,
  aftCurveLen: number,
  bevel = 0.08,
): THREE.Mesh {
  const shape = new Shape2D();
  const yFront = -zMin;
  const yBack = -zMax;
  shape.moveTo(-halfWidth, yFront - bowCurveLen);
  shape.quadraticCurveTo(-halfWidth, yFront, 0, yFront, 10);
  shape.quadraticCurveTo(halfWidth, yFront, halfWidth, yFront - bowCurveLen, 10);
  shape.lineTo(halfWidth, yBack + aftCurveLen);
  shape.quadraticCurveTo(halfWidth, yBack, 0, yBack, 10);
  shape.quadraticCurveTo(-halfWidth, yBack, -halfWidth, yBack + aftCurveLen, 10);
  shape.closePath();

  const mesh = buildExtrudedShapeMesh(name, shape, height, bevel);
  mesh.rotation.x = -Math.PI / 2;
  bakeTransform(mesh);
  return mesh;
}

function buildBronzePropeller(
  name: string,
  trackMesh: <T extends THREE.Mesh>(m: T, parent?: THREE.Object3D) => T,
  trackProtoGeo: (geo: THREE.BufferGeometry) => void,
  bronzeMat: THREE.Material,
  bladeCount: number,
  radius: number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = name;

  const hub = trackMesh(
    buildLatheMesh(
      `${name}_hub`,
      [
        new THREE.Vector2(0.0, -0.42),
        new THREE.Vector2(0.28, -0.32),
        new THREE.Vector2(0.34, 0.14),
        new THREE.Vector2(0.22, 0.44),
        new THREE.Vector2(0.0, 0.54),
      ],
      14,
    ),
    group,
  );
  hub.rotation.x = Math.PI / 2;
  bakeTransform(hub);
  hub.material = bronzeMat;

  const bladeShape = new Shape2D();
  bladeShape.moveTo(0, 0);
  bladeShape.quadraticCurveTo(radius * 0.36, radius * 0.35, radius * 0.24, radius * 0.85, 8);
  bladeShape.quadraticCurveTo(0, radius * 1.04, -radius * 0.25, radius * 0.82, 8);
  bladeShape.quadraticCurveTo(-radius * 0.30, radius * 0.35, 0, 0, 8);

  const bladeProto = buildExtrudedShapeMesh(`${name}_bladeProto`, bladeShape, 0.065, 0.018);
  bladeProto.material = bronzeMat;
  trackProtoGeo(bladeProto.geometry);

  for (let i = 0; i < bladeCount; i++) {
    const pivot = new THREE.Group();
    pivot.name = `${name}_bPiv_${i}`;
    group.add(pivot);
    pivot.rotation.z = (i * Math.PI * 2) / bladeCount;
    const blade = trackMesh(
      i === 0 ? bladeProto : cloneMeshWithMaterial(bladeProto, `${name}_blade_${i}`, bronzeMat),
      pivot,
    );
    blade.rotation.y = 0.45;
  }
  return group;
}

export function buildLusitaniaShip(
  scene: THREE.Scene,
  textures: ProceduralTextureSet,
  _isSoftwareGl: boolean,
  companionOnly = false,
): TitanicShipRig {
  const root = new THREE.Group();
  root.name = 'lusitania_root';
  scene.add(root);

  const hullMeshGroup = new THREE.Group();
  hullMeshGroup.name = 'lusitania_hullMeshGroup';
  root.add(hullMeshGroup);

  const bowGroup = new THREE.Group();
  bowGroup.name = 'lusitania_bowGroup';
  bowGroup.position.set(0, 0, LUSITANIA_BREAK_Z);
  hullMeshGroup.add(bowGroup);

  const bowContent = new THREE.Group();
  bowContent.name = 'lusitania_bowContent';
  bowContent.position.set(0, 0, -LUSITANIA_BREAK_Z);
  bowGroup.add(bowContent);

  const sternGroup = new THREE.Group();
  sternGroup.name = 'lusitania_sternGroup';
  sternGroup.position.set(0, 0, LUSITANIA_BREAK_Z);
  hullMeshGroup.add(sternGroup);

  const sternContent = new THREE.Group();
  sternContent.name = 'lusitania_sternContent';
  sternContent.position.set(0, 0, -LUSITANIA_BREAK_Z);
  sternGroup.add(sternContent);

  const trackedMeshes: THREE.Mesh[] = [];
  const instancedSlots: InstancedSlot[] = [];
  const protoGeos: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const shadowCasters: THREE.Object3D[] = [];
  let uid = 0;
  const nextId = (prefix: string) => `lus_${prefix}_${uid++}`;

  const trackMesh = <T extends THREE.Mesh>(
    m: T,
    parent?: THREE.Object3D,
    castShadow = false,
  ): T => {
    trackedMeshes.push(m);
    if (parent) parent.add(m);
    m.receiveShadow = true;
    if (castShadow) {
      m.castShadow = true;
      shadowCasters.push(m);
    }
    return m;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };
  const trackProtoGeo = (g: THREE.BufferGeometry): void => {
    protoGeos.push(g);
  };
  const makeSlot = (
    name: string,
    proto: THREE.Mesh,
    mat: THREE.Material,
    count: number,
    parent: THREE.Object3D,
  ): InstancedSlot => {
    trackProtoGeo(proto.geometry);
    const slot = createInstancedSlot(name, proto.geometry, mat, count, false, parent);
    slot.mesh.receiveShadow = true;
    instancedSlots.push(slot);
    return slot;
  };

  // =========================================================================
  // CUNARD GREYHOUND PBR MATERIALS
  // =========================================================================
  const mahoganyMat = trackMat(
    makePBR('lus_mahogany', {
      albedoTex: textures.mahoganyAlbedo,
      roughnessTex: textures.mahoganyRoughness,
      roughness: 0.46,
      metallic: 0.04,
      envIntensity: 0.42,
      clearcoat: 0.25,
      clearcoatRoughness: 0.32,
    }),
  );
  const brassMat = trackMat(
    makePBR('lus_brass', {
      color: 0xc99c46,
      metallic: 0.82,
      roughness: 0.44,
      anisotropy: 0.65,
      envIntensity: 0.36,
    }),
  );
  const bronzeMat = trackMat(
    makePBR('lus_bronze', {
      color: 0xb8863d,
      metallic: 0.84,
      roughness: 0.38,
      anisotropy: 0.55,
      envIntensity: 0.52,
    }),
  );
  const darkIronMat = trackMat(
    makePBR('lus_darkIron', {
      color: 0x181e27,
      metallic: 0.62,
      roughness: 0.52,
      envIntensity: 0.46,
    }),
  );
  const teakDeckMat = trackMat(
    makePBR('lus_teak', {
      albedoTex: textures.teakDeckAlbedo,
      bumpTex: textures.teakDeckNormal,
      bumpLevel: 1.05,
      roughnessTex: textures.teakDeckRoughness,
      roughness: 0.82,
      metallic: 0.02,
      envIntensity: 0.45,
    }),
  );
  const steelHullMat = trackMat(
    makePBR('lus_steelHull', {
      color: 0xd4dce6,
      albedoTex: textures.steelHullAlbedo,
      bumpTex: textures.steelHullNormal,
      bumpLevel: 1.45,
      roughnessTex: textures.steelHullRoughness,
      roughness: 0.58,
      metallic: 0.20,
      doubleSided: true,
      envIntensity: 0.46,
    }),
  );
  const antiFoulMat = trackMat(
    makePBR('lus_antiFoul', {
      color: 0x761d17,
      bumpTex: textures.steelHullNormal,
      bumpLevel: 0.85,
      roughnessTex: textures.steelHullRoughness,
      roughness: 0.66,
      metallic: 0.12,
      doubleSided: true,
      envIntensity: 0.38,
    }),
  );
  const spruceMastMat = trackMat(
    makePBR('lus_spruce', {
      color: 0x9c6d38,
      roughness: 0.56,
      metallic: 0.04,
      envIntensity: 0.40,
    }),
  );
  const interiorMarbleMat = trackMat(
    makePBR('lus_marble', {
      albedoTex: textures.interiorMarbleAlbedo,
      roughnessTex: textures.interiorMarbleRoughness,
      roughness: 0.48,
      metallic: 0.05,
      envIntensity: 0.40,
    }),
  );
  const interiorPanelMat = trackMat(
    makePBR('lus_panel', {
      albedoTex: textures.interiorPanelAlbedo,
      roughness: 0.64,
      metallic: 0.04,
      doubleSided: true,
      envIntensity: 0.40,
    }),
  );
  const crimsonVelvetMat = trackMat(
    makePBR('lus_velvet', {
      color: 0x6f1925,
      roughness: 0.88,
      metallic: 0.02,
      envIntensity: 0.30,
    }),
  );
  const linenClothMat = trackMat(
    makePBR('lus_linen', {
      color: 0xeae4d6,
      roughness: 0.80,
      metallic: 0.02,
      envIntensity: 0.36,
    }),
  );
  const engineGreenMat = trackMat(
    makePBR('lus_engGreen', {
      color: 0x1e3f35,
      roughness: 0.52,
      metallic: 0.44,
      envIntensity: 0.44,
    }),
  );
  const polishedSteelMat = trackMat(
    makePBR('lus_polSteel', {
      color: 0xbcc5d0,
      roughness: 0.40,
      metallic: 0.82,
      anisotropy: 0.5,
      envIntensity: 0.48,
    }),
  );
  const pipeLaggingMat = trackMat(
    makePBR('lus_pipeLagging', {
      color: 0xd9d2c2,
      roughness: 0.70,
      metallic: 0.06,
      envIntensity: 0.38,
    }),
  );
  const whitePaintMat = trackMat(
    makePBR('lus_whitePaint', {
      color: 0xe6e3da,
      roughness: 0.66,
      metallic: 0.03,
      envIntensity: 0.46,
    }),
  );
  const creamTrimMat = trackMat(
    makePBR('lus_creamTrim', {
      color: 0xf1eee6,
      roughness: 0.60,
      metallic: 0.04,
      envIntensity: 0.44,
    }),
  );
  const roofSlateMat = trackMat(
    makePBR('lus_roofSlate', {
      color: 0x3b434d,
      roughness: 0.86,
      metallic: 0.04,
      envIntensity: 0.28,
    }),
  );
  const cunardFunnelMat = trackMat(
    makePBR('lus_cunardFunnel', {
      color: 0xffffff,
      albedoTex: textures.cunardFunnelAlbedo,
      bumpTex: textures.buffFunnelNormal,
      bumpLevel: 0.9,
      roughnessTex: textures.buffFunnelRoughness,
      roughness: 0.56,
      metallic: 0.06,
      envIntensity: 0.42,
    }),
  );
  const ventThroatMat = trackMat(
    makePBR('lus_ventThroat', {
      color: 0x991b1b,
      roughness: 0.72,
      metallic: 0.04,
      doubleSided: true,
      envIntensity: 0.32,
    }),
  );
  const bridgeGlassMat = trackMat(
    makePBR('lus_bridgeGlass', {
      color: 0xb4cde0,
      metallic: 0.04,
      roughness: 0.26,
      alpha: 0.12,
      doubleSided: true,
      envIntensity: 0.20,
    }),
  );
  const warmGlowMat = trackMat(
    makePBR('lus_warmGlow', {
      color: 0xe6cfa0,
      emissive: 0xffad48,
      emissiveIntensity: 0.12,
      roughness: 0.42,
      metallic: 0.05,
      envIntensity: 0.32,
    }),
  );
  const portholeGlowMat = trackMat(
    makePBR('lus_portholeGlow', {
      color: 0x1c2630,
      emissive: 0xffb454,
      emissiveIntensity: 0.0,
      roughness: 0.36,
      metallic: 0.08,
      envIntensity: 0.30,
    }),
  );
  const portLightMat = trackMat(
    makePBR('lus_portLight', {
      color: 0xff3b3b,
      emissive: 0xdc2626,
      emissiveIntensity: 1.2,
      roughness: 0.32,
      envIntensity: 0.28,
    }),
  );
  const starboardLightMat = trackMat(
    makePBR('lus_stbdLight', {
      color: 0x34d399,
      emissive: 0x10b981,
      emissiveIntensity: 1.2,
      roughness: 0.32,
      envIntensity: 0.28,
    }),
  );

  const railPostProto = buildCylinder('lus_railPostProto', 0.032, 0.036, 1.02, 6);
  railPostProto.material = whitePaintMat;
  trackProtoGeo(railPostProto.geometry);

  const buildRailSegment = (
    tgt: THREE.Object3D,
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
  ) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.2) return;
    const midX = (x0 + x1) * 0.5;
    const midY = (y0 + y1) * 0.5;
    const midZ = (z0 + z1) * 0.5;
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    const pitch = -Math.atan2(y1 - y0, len);
    for (const hOff of [0.34, 0.68, 1.0]) {
      const bar = trackMesh(buildCylinder(nextId('rail'), 0.024, 0.024, len, 6), tgt);
      bar.material = hOff > 0.9 ? spruceMastMat : whitePaintMat;
      bar.position.set(midX, midY + hOff, midZ);
      setEulerXYZ(bar, Math.PI / 2 + pitch, yaw, 0);
    }
    const posts = Math.max(2, Math.floor(len / 2.6) + 1);
    for (let i = 0; i < posts; i++) {
      const t = i / (posts - 1);
      const post = trackMesh(cloneMeshWithMaterial(railPostProto, nextId('rpost'), whitePaintMat), tgt);
      post.position.set(
        MathUtils.lerp(x0, x1, t),
        MathUtils.lerp(y0, y1, t) + 0.51,
        MathUtils.lerp(z0, z1, t),
      );
    }
  };

  // =========================================================================
  // 1. TRUE 239.8m x 26.8m FLUSH-DECK LOFTED HULL (SPLIT AT BREAK_Z = 78)
  // =========================================================================
  const fwdHullZStations = [
    -66.0, -64.0, -60.0, -55.0, -49.0, -42.0, -35.0, -31.56, -31.44, -22.0, -10.0, 6.0, 24.0, 42.0, 60.0, LUSITANIA_BREAK_Z,
  ];
  const aftHullZStations = [
    LUSITANIA_BREAK_Z, 94.0, 110.0, 124.0, 138.0, 152.0, 162.0, 169.0, 173.8,
  ];

  const fwdSheerSegments: { tag: string; zList: number[] }[] = [
    { tag: 'fc', zList: [-66.0, -64.0, -60.0, -55.0, -49.0, -42.0, -31.56] },
    { tag: 'fs', zList: [-31.44, -22.0, -10.0, 6.0, 24.0, 42.0, 60.0, LUSITANIA_BREAK_Z] },
  ];
  const aftSheerSegments: { tag: string; zList: number[] }[] = [
    { tag: 'as', zList: [LUSITANIA_BREAK_Z, 94.0, 110.0, 124.0, 138.0, 152.0, 162.0, 169.0, 173.8] },
  ];

  for (const [label, stations, sheerSegs, targetGrp] of [
    ['fwd', fwdHullZStations, fwdSheerSegments, bowContent],
    ['aft', aftHullZStations, aftSheerSegments, sternContent],
  ] as const) {
    const upperHull = trackMesh(
      buildLusitaniaHullSection(`lusHullUpper_${label}`, stations, 8, 0.36, 1.0),
      targetGrp,
      true,
    );
    upperHull.material = steelHullMat;

    const lowerHull = trackMesh(
      buildLusitaniaHullSection(`lusHullLower_${label}`, stations, 5, 0.0, 0.37),
      targetGrp,
      false,
    );
    lowerHull.material = antiFoulMat;
    lowerHull.scale.set(0.999, 1, 0.9995);

    for (const side of [-1, 1]) {
      for (const seg of sheerSegs) {
        const stripePts: THREE.Vector3[] = [];
        const strakePts: THREE.Vector3[] = [];
        for (const z of seg.zList) {
          const { beam, sheerY, flareFactor } = sampleLusitaniaStation(z);
          const xTop = side * (beam * (1 + flareFactor) + 0.03);
          stripePts.push(new THREE.Vector3(xTop, sheerY - 0.14, z <= -64.0 ? z - 1.6 : z));
          const xStrake = side * (beam * (1 + flareFactor * 0.94) + 0.035);
          strakePts.push(new THREE.Vector3(xStrake, sheerY - 0.58, z <= -64.0 ? z - 1.5 : z));
        }
        // Crisp white Cunard sheer line
        const stripe = trackMesh(
          buildTubeMesh(`lusWhiteStripe_${label}_${seg.tag}_${side}`, stripePts, 24, 0.06, 6, true),
          targetGrp,
        );
        stripe.material = creamTrimMat;

        const rubStrake = trackMesh(
          buildTubeMesh(`lusStrake_${label}_${seg.tag}_${side}`, strakePts, 24, 0.075, 6, true),
          targetGrp,
        );
        rubStrake.material = darkIronMat;
      }
    }
  }

  // Draft marks
  for (let di = 0; di < 6; di++) {
    const bowMark = trackMesh(buildBox(nextId('bowDraft'), 0.2, 0.14, 0.38), bowContent);
    bowMark.material = whitePaintMat;
    bowMark.position.set(0, -3.5 + di * 0.72, -64.6 - di * 0.22);

    const sternMark = trackMesh(buildBox(nextId('sternDraft'), 0.34, 0.14, 0.38), sternContent);
    sternMark.material = whitePaintMat;
    sternMark.position.set(0, -3.4 + di * 0.72, 167.2);
  }

  // Stern Skeg, Balanced Rudder & Quadruple 4-Blade Bronze Propellers
  const skegShape = new Shape2D();
  skegShape.moveTo(148.0, -6.5);
  skegShape.lineTo(164.0, -5.0);
  skegShape.lineTo(167.4, -5.0);
  skegShape.lineTo(167.4, -3.4);
  skegShape.lineTo(163.5, -2.0);
  skegShape.lineTo(168.2, 0.2);
  skegShape.lineTo(164.0, 0.5);
  skegShape.lineTo(148.0, -4.0);
  skegShape.closePath();
  const skegMesh = trackMesh(buildExtrudedShapeMesh('lus_sternSkeg', skegShape, 0.42, 0), sternContent);
  skegMesh.rotation.y = Math.PI / 2;
  bakeTransform(skegMesh);
  skegMesh.material = antiFoulMat;
  skegMesh.position.set(-0.21, 0, 0);

  const rudderShape = new Shape2D();
  rudderShape.moveTo(0, -5.0);
  rudderShape.lineTo(2.9, -4.7);
  rudderShape.quadraticCurveTo(3.3, -2.4, 3.0, 0.25, 10);
  rudderShape.lineTo(0, 0.45);
  rudderShape.closePath();
  const sternRudder = trackMesh(buildExtrudedShapeMesh('lus_rudder', rudderShape, 0.32, 0.05), sternContent);
  sternRudder.rotation.y = -Math.PI / 2;
  bakeTransform(sternRudder);
  sternRudder.material = antiFoulMat;
  sternRudder.position.set(0.16, 0, 167.6);

  for (const side of [-1, 1] as const) {
    const innerProp = buildBronzePropeller(`lus_inProp_${side}`, trackMesh, trackProtoGeo, bronzeMat, 4, 2.05);
    sternContent.add(innerProp);
    innerProp.position.set(side * 2.6, -2.55, 165.0);

    const outerProp = buildBronzePropeller(`lus_outProp_${side}`, trackMesh, trackProtoGeo, bronzeMat, 4, 2.15);
    sternContent.add(outerProp);
    outerProp.position.set(side * 5.6, -2.35, 162.0);

    for (const [bx, bz] of [[2.4, 159.5], [4.5, 156.8]] as const) {
      const boss = trackMesh(buildCylinder(nextId('boss'), 0.28, 0.46, 11.5, 10), sternContent);
      boss.material = antiFoulMat;
      setEulerXYZ(boss, Math.PI / 2, 0, side * -0.14);
      boss.position.set(side * bx, -2.25, bz);
    }
    const aStrut = trackMesh(buildBox(nextId('aStrut'), 3.8, 0.26, 0.58), sternContent);
    aStrut.material = antiFoulMat;
    aStrut.position.set(side * 3.4, -1.75, 163.2);
    aStrut.rotation.z = side * 0.28;
  }

  // =========================================================================
  // 2. FLUSH CUNARD WEATHER DECKS + RAISED FORECASTLE & SUPERSTRUCTURE
  // =========================================================================
  const forecastleTeak = trackMesh(
    buildLusitaniaWeatherDeck('lus_forecastleTeak', [-66.0, -62.0, -56.0, -49.0, -42.0, -35.5, -31.56], 0.05, 0.45, -0.02),
    bowContent,
  );
  forecastleTeak.material = teakDeckMat;

  const forecastleBreak = trackMesh(
    buildCurvedFootprint('lus_fcBreak', 11.4, -32.2, -31.2, 2.65, 0.15, 0.08, 0),
    bowContent,
  );
  forecastleBreak.material = whitePaintMat;
  forecastleBreak.position.y = 7.05;

  // Flush continuous forward & aft shelter decks
  const fwdShelterFore = trackMesh(
    buildLusitaniaWeatherDeck('lus_fwdShelterFore', [-31.44, -22.0, -10.0, 6.0, 23.8], 0.04, 0.45, 0.0),
    bowContent,
  );
  fwdShelterFore.material = teakDeckMat;

  const fwdShelterAft = trackMesh(
    buildLusitaniaWeatherDeck('lus_fwdShelterAft', [36.0, 56.0, LUSITANIA_BREAK_Z + 0.02], 0.04, 0.45, 0.0),
    bowContent,
  );
  fwdShelterAft.material = teakDeckMat;

  for (const side of [-1, 1] as const) {
    const stairWing = trackMesh(buildBox(nextId('stairWing'), 8.0, 0.44, 12.2), bowContent);
    stairWing.material = teakDeckMat;
    stairWing.position.set(side * 9.3, 7.25, 29.9);
  }

  const aftShelterDeck = trackMesh(
    buildLusitaniaWeatherDeck('lus_aftShelter', [LUSITANIA_BREAK_Z - 0.02, 81.2], 0.04, 0.45, 0.0),
    sternContent,
  );
  aftShelterDeck.material = teakDeckMat;

  for (const side of [-1, 1] as const) {
    const engWing = trackMesh(buildBox(nextId('engWing'), 4.8, 0.44, 26.2), sternContent);
    engWing.material = teakDeckMat;
    engWing.position.set(side * 10.9, 7.25, 94.0);
  }

  const aftFlushDeck = trackMesh(
    buildLusitaniaWeatherDeck('lus_aftFlush', [107.0, 124.0, 138.0, 152.0, 162.0, 169.0, 173.8], 0.05, 0.45, -0.02),
    sternContent,
  );
  aftFlushDeck.material = teakDeckMat;

  // Forecastle Capstans & Chains
  const capstanLathe = buildLatheMesh(
    'lus_capstanProto',
    [
      new THREE.Vector2(0.8, 0),
      new THREE.Vector2(0.76, 0.2),
      new THREE.Vector2(0.48, 0.46),
      new THREE.Vector2(0.45, 0.78),
      new THREE.Vector2(0.66, 1.05),
      new THREE.Vector2(0.6, 1.2),
      new THREE.Vector2(0, 1.24),
    ],
    16,
  );
  trackProtoGeo(capstanLathe.geometry);
  for (const cx of [-3.1, 3.1]) {
    const capstan = trackMesh(cloneMeshWithMaterial(capstanLathe, nextId('cap'), darkIronMat), bowContent, true);
    capstan.position.set(cx, 9.25, -49.0);
    const brassCap = trackMesh(buildCylinder(nextId('capBrass'), 0.52, 0.6, 0.14, 14), bowContent);
    brassCap.material = brassMat;
    brassCap.position.set(cx, 10.5, -49.0);
  }

  // Sculpted Anchor Chains
  const chainProto = buildTorusXY('lus_chain', 0.12, 0.04, 6, 12);
  const chainSlot = makeSlot('lus_anchorChain', chainProto, darkIronMat, 68, bowContent);
  let cIdx = 0;
  for (const side of [-1, 1]) {
    for (let li = 0; li < 34; li++) {
      const t = li / 33;
      writeInstanceMatrix(
        chainSlot,
        cIdx++,
        MathUtils.lerp(side * 2.8, side * 1.2, t),
        9.32,
        MathUtils.lerp(-50.5, -60.5, t),
        li % 2 === 0 ? Math.PI / 2 : 0,
        0,
        0,
      );
    }
  }
  commitInstanceMatrices(chainSlot, cIdx);

  // Stockless Bower Anchors
  const anchorShankProto = buildBox('lus_ankShank', 0.24, 2.2, 0.28);
  trackProtoGeo(anchorShankProto.geometry);
  const anchorFlukeProto = buildBox('lus_ankFluke', 1.15, 0.85, 0.24);
  trackProtoGeo(anchorFlukeProto.geometry);
  for (const side of [-1, 1]) {
    const { beam, sheerY } = sampleLusitaniaStation(-58.0);
    const shank = trackMesh(cloneMeshWithMaterial(anchorShankProto, nextId('ankS'), darkIronMat), bowContent);
    shank.position.set(side * (beam * 0.96), sheerY - 2.35, -58.0);
    shank.rotation.z = side * 0.18;
    const fluke = trackMesh(cloneMeshWithMaterial(anchorFlukeProto, nextId('ankF'), darkIronMat), bowContent);
    fluke.position.set(side * (beam * 0.96), sheerY - 3.1, -58.0);
    fluke.rotation.z = side * 0.18;
  }

  // Forward Breakwater V-Shield on Forecastle + Brass Bell
  for (const side of [-1, 1]) {
    const bw = trackMesh(buildBox(nextId('bw'), 5.8, 0.92, 0.16), bowContent);
    bw.material = whitePaintMat;
    bw.position.set(side * 2.65, 9.75, -52.5);
    bw.rotation.y = side * -0.44;
  }
  const bellArch = trackMesh(buildTorusXY('lus_bellArch', 0.5, 0.05, 8, 16, Math.PI), bowContent);
  bellArch.material = darkIronMat;
  bellArch.position.set(0, 10.05, -43.0);
  const shipBell = trackMesh(buildCylinder('lus_bell', 0.13, 0.25, 0.38, 14), bowContent);
  shipBell.material = brassMat;
  shipBell.position.set(0, 10.28, -43.0);

  // Weather Deck Perimeter Railings
  for (const side of [-1, 1]) {
    const fcPts: THREE.Vector3[] = [];
    for (const z of [-65.0, -56.0, -45.0, -32.2]) {
      const { beam, sheerY, flareFactor } = sampleLusitaniaStation(z);
      fcPts.push(new THREE.Vector3(side * (beam * (1 + flareFactor) - 0.12), sheerY, z));
    }
    for (let i = 0; i < fcPts.length - 1; i++) {
      buildRailSegment(bowContent, fcPts[i].x, fcPts[i].y, fcPts[i].z, fcPts[i + 1].x, fcPts[i + 1].y, fcPts[i + 1].z);
    }

    const fwdPts: THREE.Vector3[] = [];
    for (const z of [-31.0, -20.0, -9.0]) {
      const { beam, sheerY, flareFactor } = sampleLusitaniaStation(z);
      fwdPts.push(new THREE.Vector3(side * (beam * (1 + flareFactor) - 0.12), sheerY, z));
    }
    for (let i = 0; i < fwdPts.length - 1; i++) {
      buildRailSegment(bowContent, fwdPts[i].x, fwdPts[i].y, fwdPts[i].z, fwdPts[i + 1].x, fwdPts[i + 1].y, fwdPts[i + 1].z);
    }

    const aftPts: THREE.Vector3[] = [];
    for (const z of [126.0, 142.0, 158.0, 172.5]) {
      const { beam, sheerY, flareFactor } = sampleLusitaniaStation(z);
      aftPts.push(new THREE.Vector3(side * (beam * (1 + flareFactor) - 0.12), sheerY, z));
    }
    for (let i = 0; i < aftPts.length - 1; i++) {
      buildRailSegment(sternContent, aftPts[i].x, aftPts[i].y, aftPts[i].z, aftPts[i + 1].x, aftPts[i + 1].y, aftPts[i + 1].z);
    }
  }

  // =========================================================================
  // 3. CUNARD WHITE SUPERSTRUCTURE WALLS, PROMENADE DECKS & BOAT DECK
  // =========================================================================
  const buildHollowDeckBox = (
    tgt: THREE.Object3D,
    halfW: number,
    yBase: number,
    height: number,
    zFront: number,
    zBack: number,
    bowCurve: number,
    aftCurve: number,
  ) => {
    const fWall = trackMesh(
      buildCurvedFootprint(nextId('fw'), halfW, zFront, zFront + 0.55, height, bowCurve, 0.05, 0.04),
      tgt,
      true,
    );
    fWall.material = whitePaintMat;
    fWall.position.y = yBase;

    const bWall = trackMesh(
      buildCurvedFootprint(nextId('bw'), halfW, zBack - 0.55, zBack, height, 0.05, aftCurve, 0.04),
      tgt,
      true,
    );
    bWall.material = whitePaintMat;
    bWall.position.y = yBase;

    for (const side of [-1, 1] as const) {
      const sWall = trackMesh(
        buildBox(nextId('sw'), 0.42, height, zBack - zFront - 0.4),
        tgt,
        true,
      );
      sWall.material = whitePaintMat;
      sWall.position.set(side * (halfW - 0.21), yBase + height * 0.5, (zFront + zBack) * 0.5);
    }
  };

  // B-Deck Superstructure (-8..126) split at BREAK_Z=78
  buildHollowDeckBox(bowContent, 12.6, 7.45, 2.48, -8.5, LUSITANIA_BREAK_Z - 0.05, 2.8, 0.0);
  buildHollowDeckBox(sternContent, 12.6, 7.45, 2.48, LUSITANIA_BREAK_Z + 0.05, 125.0, 0.0, 3.2);

  // Promenade A-Deck (-7.5..124)
  for (const [z0, z1, bc, ac, tgt] of [
    [-7.5, 24.4, 2.8, 0.0, bowContent],
    [35.6, 55.2, 0.0, 0.0, bowContent],
    [71.8, LUSITANIA_BREAK_Z + 0.02, 0.0, 0.0, bowContent],
    [LUSITANIA_BREAK_Z - 0.02, 81.2, 0.0, 0.0, sternContent],
    [107.0, 124.2, 0.0, 3.4, sternContent],
  ] as const) {
    const aFlr = trackMesh(
      buildCurvedFootprint(nextId('aFlr'), 12.7, z0, z1, 0.28, bc, ac, 0),
      tgt,
    );
    aFlr.material = teakDeckMat;
    aFlr.position.y = 9.93;
  }
  for (const side of [-1, 1] as const) {
    const aStairWing = trackMesh(buildBox(nextId('aStW'), 7.4, 0.28, 11.4), bowContent);
    aStairWing.material = teakDeckMat;
    aStairWing.position.set(side * 9.0, 10.07, 30.0);

    const aLoungeWing = trackMesh(buildBox(nextId('aLngW'), 2.1, 0.28, 16.8), bowContent);
    aLoungeWing.material = teakDeckMat;
    aLoungeWing.position.set(side * 11.65, 10.07, 63.5);

    const aEngWing = trackMesh(buildBox(nextId('aEngW'), 4.6, 0.28, 26.0), sternContent);
    aEngWing.material = teakDeckMat;
    aEngWing.position.set(side * 10.4, 10.07, 94.0);
  }

  // A-Deck Cabin Inner Walls (-6.5..120)
  buildHollowDeckBox(bowContent, 10.6, 9.95, 2.75, -7.0, LUSITANIA_BREAK_Z - 0.05, 2.4, 0.0);
  buildHollowDeckBox(sternContent, 10.6, 9.95, 2.75, LUSITANIA_BREAK_Z + 0.05, 121.0, 0.0, 2.8);

  // Boat Deck Teak Floor (-8..122)
  for (const [z0, z1, bc, ac, tgt] of [
    [-8.0, 24.4, 2.8, 0.0, bowContent],
    [35.6, LUSITANIA_BREAK_Z + 0.02, 0.0, 0.0, bowContent],
    [LUSITANIA_BREAK_Z - 0.02, 122.0, 0.0, 3.2, sternContent],
  ] as const) {
    const bFlr = trackMesh(
      buildCurvedFootprint(nextId('bFlr'), 12.6, z0, z1, 0.3, bc, ac, 0),
      tgt,
    );
    bFlr.material = teakDeckMat;
    bFlr.position.y = 12.6;
  }
  for (const side of [-1, 1] as const) {
    const bStairWing = trackMesh(buildBox(nextId('bStW'), 7.4, 0.3, 11.4), bowContent);
    bStairWing.material = teakDeckMat;
    bStairWing.position.set(side * 8.9, 12.75, 30.0);
  }

  // A-Deck Stanchions & Promenade Railings
  const stanchionProto = buildCylinder('lus_stanchionProto', 0.09, 0.13, 2.75, 10);
  const fwdStanchions: Array<[number, number, number]> = [];
  const aftStanchions: Array<[number, number, number]> = [];
  for (const side of [-1, 1]) {
    for (let sz = 44.0; sz <= 118.0; sz += 4.2) {
      if (Math.abs(sz - LUSITANIA_BREAK_Z) < 0.8) continue;
      if (sz < LUSITANIA_BREAK_Z) fwdStanchions.push([side * 12.35, 11.32, sz]);
      else aftStanchions.push([side * 12.35, 11.32, sz]);
    }
    buildRailSegment(bowContent, side * 12.45, 9.95, 42.0, side * 12.45, 9.95, LUSITANIA_BREAK_Z - 0.1);
    buildRailSegment(sternContent, side * 12.45, 9.95, LUSITANIA_BREAK_Z + 0.1, side * 12.45, 9.95, 120.0);
  }
  [
    { list: fwdStanchions, tgt: bowContent, tag: 'fwd' },
    { list: aftStanchions, tgt: sternContent, tag: 'aft' },
  ].forEach(({ list, tgt, tag }) => {
    if (list.length === 0) return;
    const slot = makeSlot(`lus_stanchions_${tag}`, stanchionProto, whitePaintMat, list.length, tgt);
    for (let i = 0; i < list.length; i++) {
      writeInstanceMatrix(slot, i, list[i][0], list[i][1], list[i][2], 0, 0, 0);
    }
    commitInstanceMatrices(slot, list.length);
  });

  // Boat Deck Houses + Cornices + Slate Roofs
  const deckhouses: Array<[number, number, number, number]> = [
    [6.1, 2.8, 17.5, 2.4],
    [5.8, 56.0, 71.5, 2.15],
    [5.6, 80.5, 96.5, 2.15],
    [5.3, 103.5, 116.5, 2.05],
  ];
  for (const [hw, z0, z1, h] of deckhouses) {
    const tgt = z0 < LUSITANIA_BREAK_Z ? bowContent : sternContent;
    const house = trackMesh(
      buildCurvedFootprint(nextId('dh'), hw, z0, z1, h, 0.75, 0.75, 0.08),
      tgt,
      true,
    );
    house.material = whitePaintMat;
    house.position.y = 12.88;

    const eave = trackMesh(
      buildCurvedFootprint(nextId('dhEave'), hw + 0.3, z0 - 0.2, z1 + 0.2, 0.18, 0.78, 0.78, 0.04),
      tgt,
    );
    eave.material = whitePaintMat;
    eave.position.y = 12.88 + h - 0.04;

    const roofTop = trackMesh(
      buildCurvedFootprint(nextId('dhRoof'), hw + 0.14, z0 - 0.05, z1 + 0.05, 0.08, 0.75, 0.75, 0.02),
      tgt,
    );
    roofTop.material = roofSlateMat;
    roofTop.position.y = 12.88 + h + 0.12;
  }

  // Boat Deck Marconi Wireless Cabin Walls (z = 36.2..44.6)
  const marconiFloor = trackMesh(buildBox('lus_marconiFloor', 10.2, 0.14, 8.4), bowContent);
  marconiFloor.material = interiorMarbleMat;
  marconiFloor.position.set(0, 12.92, 40.4);
  const marconiRoof = trackMesh(buildBox('lus_marconiRoof', 10.8, 0.24, 8.8), bowContent, true);
  marconiRoof.material = whitePaintMat;
  marconiRoof.position.set(0, 15.02, 40.4);
  const marconiRoofSlate = trackMesh(buildBox('lus_marconiSlate', 10.5, 0.08, 8.5), bowContent);
  marconiRoofSlate.material = roofSlateMat;
  marconiRoofSlate.position.set(0, 15.16, 40.4);

  for (const side of [-1, 1] as const) {
    const mWain = trackMesh(buildBox(nextId('mWain'), 0.28, 0.9, 8.4), bowContent);
    mWain.material = whitePaintMat;
    mWain.position.set(side * 5.0, 13.34, 40.4);
    const mHead = trackMesh(buildBox(nextId('mHead'), 0.28, 0.42, 8.4), bowContent);
    mHead.material = whitePaintMat;
    mHead.position.set(side * 5.0, 14.78, 40.4);
  }
  for (const mz of [36.3, 44.5]) {
    const mEnd = trackMesh(buildBox(nextId('mEnd'), 10.2, 2.15, 0.28), bowContent);
    mEnd.material = interiorPanelMat;
    mEnd.position.set(0, 13.98, mz);
  }

  // Grand Staircase Glass Dome Skylight at z = 30.0
  const domePlinth = trackMesh(buildCylinder('lus_domePlinth', 2.85, 2.95, 0.36, 22), bowContent);
  domePlinth.material = whitePaintMat;
  domePlinth.scale.set(1.05, 1, 1.32);
  domePlinth.position.set(0, 15.05, 30.0);
  const domeGlass = trackMesh(buildSphere('lus_domeGlass', 2.55, 18, 12, 0.48), bowContent);
  domeGlass.material = warmGlowMat;
  domeGlass.scale.set(1.05, 0.72, 1.32);
  domeGlass.position.set(0, 15.12, 30.0);
  const domeRim = trackMesh(buildTorusXY('lus_domeRim', 2.55, 0.14, 8, 24), bowContent);
  domeRim.material = creamTrimMat;
  domeRim.rotation.x = Math.PI / 2;
  domeRim.scale.set(1.05, 1.32, 1);
  domeRim.position.set(0, 15.12, 30.0);

  // Open Navigating Bridge Walkway & Wing Cabs
  const navWalkway = trackMesh(
    buildCurvedFootprint('lus_navWalk', 14.7, -2.5, -1.55, 0.28, 0.25, 0.1, 0),
    bowContent,
  );
  navWalkway.material = teakDeckMat;
  navWalkway.position.y = 12.6;
  const centerFrontDodger = trackMesh(
    buildCurvedFootprint('lus_dodger', 4.48, -2.48, -2.26, 1.08, 0.16, 0.06, 0.01),
    bowContent,
  );
  centerFrontDodger.material = whitePaintMat;
  centerFrontDodger.position.y = 12.88;
  const bridgeWingDeck = trackMesh(
    buildCurvedFootprint('lus_wingDeck', 14.7, -2.3, 1.8, 0.3, 0.35, 0.35, 0),
    bowContent,
  );
  bridgeWingDeck.material = teakDeckMat;
  bridgeWingDeck.position.y = 12.6;

  for (const side of [-1, 1]) {
    const wingWall = trackMesh(
      buildCurvedFootprint(nextId('wingW'), 5.1, -2.25, -1.85, 1.24, 0.12, 0.12, 0.02),
      bowContent,
    );
    wingWall.material = whitePaintMat;
    wingWall.position.set(side * 9.5, 12.88, 0);
    buildRailSegment(bowContent, side * 4.45, 12.9, 1.72, side * 14.55, 12.9, 1.72);
    const wingCab = trackMesh(
      buildCurvedFootprint(nextId('wingCab'), 0.44, -2.25, 1.75, 1.32, 0.22, 0.22, 0.03),
      bowContent,
    );
    wingCab.material = whitePaintMat;
    wingCab.position.set(side * 14.48, 12.88, 0);

    const navLight = trackMesh(buildSphere(nextId('navLight'), 0.2, 12, 12), bowContent);
    navLight.material = side < 0 ? portLightMat : starboardLightMat;
    navLight.position.set(side * 14.62, 14.34, -1.86);
  }

  // =========================================================================
  // 4. 4 TALLER SLENDER CUNARD VERMILION-RED FUNNELS + 18 COWL VENTILATORS
  // =========================================================================
  const funnelZPositions = [14.0, 42.0, 70.0, 98.0];
  const funnelShaftProto = buildCylinder('lus_fShaftProto', 2.28, 2.72, 18.6, 28);
  funnelShaftProto.material = cunardFunnelMat;
  trackProtoGeo(funnelShaftProto.geometry);

  const funnelFidleyProto = buildCurvedFootprint('lus_fFidProto', 3.15, -3.2, 3.2, 1.15, 0.5, 0.5, 0.06);
  funnelFidleyProto.material = whitePaintMat;
  trackProtoGeo(funnelFidleyProto.geometry);

  const funnelBandProto = buildCylinder('lus_fBandProto', 2.38, 2.32, 4.1, 28);
  funnelBandProto.material = darkIronMat;
  trackProtoGeo(funnelBandProto.geometry);

  const funnelRingProto = buildTorusXY('lus_fRingProto', 2.40, 0.07, 6, 28);
  funnelRingProto.rotation.x = Math.PI / 2;
  bakeTransform(funnelRingProto);
  funnelRingProto.material = darkIronMat;
  trackProtoGeo(funnelRingProto.geometry);

  const funnelLipProto = buildTorusXY('lus_fLipProto', 2.34, 0.14, 8, 28);
  funnelLipProto.rotation.x = Math.PI / 2;
  bakeTransform(funnelLipProto);
  funnelLipProto.material = darkIronMat;
  trackProtoGeo(funnelLipProto.geometry);

  const funnelFlueProto = buildDisc('lus_fFlueProto', 2.15, 24);
  funnelFlueProto.rotation.x = -Math.PI / 2;
  bakeTransform(funnelFlueProto);
  funnelFlueProto.material = darkIronMat;
  trackProtoGeo(funnelFlueProto.geometry);

  const funnelPipeProto = buildCylinder('lus_fPipeProto', 0.14, 0.16, 19.6, 10);
  funnelPipeProto.material = brassMat;
  trackProtoGeo(funnelPipeProto.geometry);

  funnelZPositions.forEach((fz, fIdx) => {
    const tgt = fz < LUSITANIA_BREAK_Z ? bowContent : sternContent;

    const fidley = trackMesh(
      fIdx === 0 ? funnelFidleyProto : cloneMeshWithMaterial(funnelFidleyProto, `lus_fidley_${fIdx}`, whitePaintMat),
      tgt,
      true,
    );
    fidley.position.set(0, 12.68, fz);

    const funnelGroup = new THREE.Group();
    funnelGroup.name = `lus_funnelGroup_${fIdx}`;
    tgt.add(funnelGroup);
    funnelGroup.position.set(0, 12.88, fz);
    funnelGroup.rotation.x = 0.092;
    funnelGroup.scale.set(0.84, 1, 1.12);

    const shaft = trackMesh(
      fIdx === 0 ? funnelShaftProto : cloneMeshWithMaterial(funnelShaftProto, `lus_fShaft_${fIdx}`, cunardFunnelMat),
      funnelGroup,
      true,
    );
    shaft.position.y = 8.4;

    const topBand = trackMesh(
      fIdx === 0 ? funnelBandProto : cloneMeshWithMaterial(funnelBandProto, `lus_fBand_${fIdx}`, darkIronMat),
      funnelGroup,
    );
    topBand.position.y = 19.2;

    for (const ry of [14.8, 16.0]) {
      const ring = trackMesh(cloneMeshWithMaterial(funnelRingProto, nextId('fRing'), darkIronMat), funnelGroup);
      ring.position.y = ry;
    }

    const topLip = trackMesh(
      fIdx === 0 ? funnelLipProto : cloneMeshWithMaterial(funnelLipProto, `lus_fLip_${fIdx}`, darkIronMat),
      funnelGroup,
    );
    topLip.position.y = 21.25;

    const darkFlue = trackMesh(
      fIdx === 0 ? funnelFlueProto : cloneMeshWithMaterial(funnelFlueProto, `lus_fFlue_${fIdx}`, darkIronMat),
      funnelGroup,
    );
    darkFlue.position.y = 21.08;

    [-0.32, 0.32].forEach((px, pIdx) => {
      const pipe = trackMesh(
        fIdx === 0 && pIdx === 0 ? funnelPipeProto : cloneMeshWithMaterial(funnelPipeProto, `lus_fPipe_${fIdx}_${pIdx}`, brassMat),
        funnelGroup,
      );
      pipe.position.set(px, 9.4, -2.6);
    });

    const guyAnchors: Array<[number, number, number, number]> = [
      [-1.75, -1.75, -10.5, -7.2],
      [1.75, -1.75, 10.5, -7.2],
      [-2.05, 0.1, -10.8, 0.2],
      [2.05, 0.1, 10.8, 0.2],
      [-1.75, 1.85, -10.5, 7.6],
      [1.75, 1.85, 10.5, 7.6],
    ];
    for (const [tx, tz, bx, bz] of guyAnchors) {
      const topPt = new THREE.Vector3(tx, 31.2, fz + tz * 1.12 + 1.6);
      const botPt = new THREE.Vector3(bx, 12.9, fz + bz);
      const wire = trackMesh(buildTubeMesh(nextId('guyWire'), [topPt, botPt], 1, 0.042, 6, false), tgt);
      wire.material = darkIronMat;
    }
  });

  // 18 Prominent Cunard Boat Deck Cowl/Dorade Ventilators (signature silhouette detail)
  const cowlStandProto = buildCylinder('lus_cowlStand', 0.32, 0.38, 1.95, 12);
  cowlStandProto.material = whitePaintMat;
  trackProtoGeo(cowlStandProto.geometry);
  const cowlHoodProto = buildSphere('lus_cowlHood', 0.68, 14, 10, 0.6);
  cowlHoodProto.material = whitePaintMat;
  trackProtoGeo(cowlHoodProto.geometry);
  const cowlThroatProto = buildDisc('lus_cowlThroat', 0.52, 12);
  cowlThroatProto.material = ventThroatMat;
  trackProtoGeo(cowlThroatProto.geometry);

  const ventZStations = [8.5, 19.5, 25.0, 36.5, 48.0, 62.0, 74.5, 90.0, 105.0];
  for (const side of [-1, 1] as const) {
    for (let vi = 0; vi < ventZStations.length; vi++) {
      const vz = ventZStations[vi];
      const tgtV = vz < LUSITANIA_BREAK_Z ? bowContent : sternContent;
      const vx = side * 4.85;
      const stand = trackMesh(cloneMeshWithMaterial(cowlStandProto, nextId('cowlS'), whitePaintMat), tgtV, true);
      stand.position.set(vx, 13.85, vz);
      const hood = trackMesh(cloneMeshWithMaterial(cowlHoodProto, nextId('cowlH'), whitePaintMat), tgtV);
      hood.position.set(vx, 14.95, vz);
      hood.rotation.x = Math.PI / 2;
      const throat = trackMesh(cloneMeshWithMaterial(cowlThroatProto, nextId('cowlT'), ventThroatMat), tgtV);
      throat.position.set(vx, 14.95, vz - 0.32);
      throat.rotation.y = Math.PI;
    }
  }

  // Crew & 16 Lifeboats (or static instanced lifeboats when moored companion)
  let crewAndLifeboats: CrewAndLifeboatSystem;
  const boatStations = [7.5, 16.0, 24.5, 33.0, 88.0, 96.5, 105.0, 113.5];

  if (!companionOnly) {
    crewAndLifeboats = createCrewAndLifeboats(
      scene,
      bowContent,
      sternContent,
      whitePaintMat,
      teakDeckMat,
      LUSITANIA_BREAK_Z,
      {
        scaleX: 0.94,
        scaleZ: 0.87,
        boatZStations: boatStations,
        boatBaseX: 12.15,
        deckBoundsZ: [-68, 176],
      },
    );
    for (let i = 0; i < crewAndLifeboats.shadowCasters.length; i++) {
      shadowCasters.push(crewAndLifeboats.shadowCasters[i]);
    }
  } else {
    const staticBoatProto = buildBox('lus_staticBoatProto', 1.75, 0.82, 5.8);
    const fwdStaticBoats = makeSlot('lus_staticBoatsFwd', staticBoatProto, whitePaintMat, 8, bowContent);
    const aftStaticBoats = makeSlot('lus_staticBoatsAft', staticBoatProto, whitePaintMat, 8, sternContent);
    let fi = 0;
    let ai = 0;
    for (const side of [-1, 1] as const) {
      for (let b = 0; b < boatStations.length; b++) {
        const bz = boatStations[b];
        const bx = side * (b === 0 ? 12.95 : 12.15);
        if (bz < LUSITANIA_BREAK_Z) writeInstanceMatrix(fwdStaticBoats, fi++, bx, 13.85, bz, 0, 0, 0);
        else writeInstanceMatrix(aftStaticBoats, ai++, bx, 13.85, bz, 0, 0, 0);
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

  // =========================================================================
  // 5. PORTHOLES, WINDOWS, MASTS, NAMEPLATES & CUNARD FLAGS
  // =========================================================================
  const portholePositions: Array<{ x: number; y: number; z: number; rotY: number }> = [];
  for (const side of [-1, 1]) {
    for (let z = -52; z <= 162; z += 4.0) {
      const { beam, sheerY } = sampleLusitaniaStation(z);
      const { beam: beamNext } = sampleLusitaniaStation(z + 1.5);
      const slopeAngle = Math.atan2((beamNext - beam) * side, 1.5);
      const yKeel = sampleLusitaniaKeelY(z);
      for (const dy of [1.4, 3.0, 4.5]) {
        const x = side * (beam * 0.99 + 0.08);
        const y = sheerY - dy;
        if (y > Math.max(1.2, yKeel + 0.85)) {
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
  const portholeProto = buildDisc('lus_portholeProto', 0.23, 12);
  const brassRimProto = buildTorusXY('lus_brassRimProto', 0.255, 0.042, 6, 12);
  [
    { list: portholePositions.filter((p) => p.z < LUSITANIA_BREAK_Z), tgt: bowContent, tag: 'fwd' },
    { list: portholePositions.filter((p) => p.z >= LUSITANIA_BREAK_Z), tgt: sternContent, tag: 'aft' },
  ].forEach(({ list, tgt, tag }) => {
    if (list.length === 0) return;
    const pSlot = makeSlot(`lus_porthole_${tag}`, portholeProto, portholeGlowMat, list.length, tgt);
    const rSlot = makeSlot(`lus_portholeRim_${tag}`, brassRimProto, brassMat, list.length, tgt);
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      writeInstanceMatrix(pSlot, i, p.x, p.y, p.z, 0, p.rotY, 0);
      writeInstanceMatrix(rSlot, i, p.x + (p.x > 0 ? 0.018 : -0.018), p.y, p.z, 0, p.rotY, 0);
    }
    commitInstanceMatrices(pSlot, list.length);
    commitInstanceMatrices(rSlot, list.length);
  });

  // Foremast, Crow's Nest, Mainmast & Marconi Aerials
  const foremastLower = trackMesh(buildCylinder('lus_foremastLower', 0.23, 0.37, 22.5, 14), bowContent, true);
  foremastLower.material = spruceMastMat;
  foremastLower.position.set(0, 17.5, -19.5);

  const foremastUpper = trackMesh(buildCylinder('lus_foremastUpper', 0.13, 0.23, 18.8, 12), bowContent, true);
  foremastUpper.material = spruceMastMat;
  foremastUpper.position.set(0, 38.0, -19.5);

  const crowsNest = trackMesh(buildCylinder('lus_crowsNest', 1.0, 0.72, 1.5, 16), bowContent, true);
  crowsNest.material = whitePaintMat;
  crowsNest.position.set(0, 25.0, -19.5);

  const yardarm = trackMesh(buildCylinder('lus_yardarm', 0.08, 0.11, 11.8, 10), bowContent);
  yardarm.material = spruceMastMat;
  yardarm.rotation.z = Math.PI / 2;
  yardarm.position.set(0, 35.2, -19.5);

  const mainMastLower = trackMesh(buildCylinder('lus_mainMastLower', 0.22, 0.34, 21.0, 14), sternContent);
  mainMastLower.material = spruceMastMat;
  mainMastLower.position.set(0, 17.4, 122.0);
  mainMastLower.rotation.x = 0.06;

  const mainMastUpper = trackMesh(buildCylinder('lus_mainMastUpper', 0.13, 0.22, 18.8, 12), sternContent);
  mainMastUpper.material = spruceMastMat;
  mainMastUpper.position.set(0, 37.0, 123.2);
  mainMastUpper.rotation.x = 0.06;

  const stayMat = trackMat(
    new THREE.MeshLambertMaterial({ name: 'lus_stayMat', color: colorFromHex(0x4b5868) }),
  );
  const addCable = (tgt: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radius = 0.044) => {
    const c = trackMesh(buildTubeMesh(nextId('cable'), [a, b], 1, radius, 6, false), tgt);
    c.material = stayMat;
  };
  addCable(bowContent, new THREE.Vector3(0, 43.8, -19.5), new THREE.Vector3(0, 10.3, -64.5), 0.054);
  for (const sx of [-9.8, 9.8]) {
    addCable(bowContent, new THREE.Vector3(0, 40.0, -19.5), new THREE.Vector3(sx, 9.2, -37), 0.045);
    addCable(bowContent, new THREE.Vector3(0, 26.2, -19.5), new THREE.Vector3(sx * 1.15, 7.5, -22), 0.045);
    addCable(sternContent, new THREE.Vector3(0, 40.0, 123.3), new THREE.Vector3(sx * 0.88, 7.6, 118), 0.045);
  }
  const marconiAerialsGroup = new THREE.Group();
  marconiAerialsGroup.name = 'lus_marconiAerials';
  hullMeshGroup.add(marconiAerialsGroup);
  for (const mx of [-1.2, -0.4, 0.4, 1.2]) {
    addCable(marconiAerialsGroup, new THREE.Vector3(mx, 46.0, -19.5), new THREE.Vector3(mx, 45.4, 123.5), 0.042);
  }

  // Nameplates ("LUSITANIA" / "LUSITANIA LIVERPOOL")
  const bowNameMat = trackMat(
    makePBR('lus_bowName', {
      albedoTex: textures.hullNameplateLusitaniaBow,
      alphaCutOff: 0.08,
      roughness: 0.44,
      metallic: 0.56,
      doubleSided: true,
      envIntensity: 0.36,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  const sternNameMat = trackMat(
    makePBR('lus_sternName', {
      albedoTex: textures.hullNameplateLusitaniaStern,
      alphaCutOff: 0.08,
      roughness: 0.44,
      metallic: 0.56,
      doubleSided: true,
      envIntensity: 0.36,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  const evalHullSurfaceX = (z: number, y: number): number => {
    const { beam, sheerY, flareFactor } = sampleLusitaniaStation(z);
    const yKeel = sampleLusitaniaKeelY(z);
    const hullFrac = MathUtils.clamp((y - yKeel) / Math.max(0.35, sheerY - yKeel), 0, 1);
    let wr: number;
    if (hullFrac < 0.28) wr = Math.sin(((hullFrac / 0.28) * Math.PI) / 2) * 0.88;
    else {
      const up = (hullFrac - 0.28) / 0.72;
      wr = 0.88 + up * 0.12 + up * up * flareFactor;
    }
    return beam * wr;
  };
  for (const side of [-1, 1]) {
    const bz = -50.5;
    const by = 8.75;
    const bxFront = evalHullSurfaceX(bz - 3.6, by);
    const bxAft = evalHullSurfaceX(bz + 3.6, by);
    const bowPlane = trackMesh(buildPlane(nextId('bowName'), 8.8, 1.35), bowContent);
    bowPlane.material = bowNameMat;
    bowPlane.position.set(side * ((bxFront + bxAft) * 0.5 + 0.12), by, bz);
    bowPlane.rotation.y = (side > 0 ? Math.PI / 2 : -Math.PI / 2) - Math.atan2((bxAft - bxFront) * side, 7.2);

    const sz = 160.5;
    const sy = 6.2;
    const sxFront = evalHullSurfaceX(sz - 2.9, sy);
    const sxAft = evalHullSurfaceX(sz + 2.9, sy);
    const sternPlane = trackMesh(buildPlane(nextId('sternName'), 7.4, 1.2), sternContent);
    sternPlane.material = sternNameMat;
    sternPlane.position.set(side * ((sxFront + sxAft) * 0.5 + 0.12), sy, sz);
    sternPlane.rotation.y = (side > 0 ? Math.PI / 2 : -Math.PI / 2) - Math.atan2((sxAft - sxFront) * side, 5.8);
  }

  // Bow & Stern Flags (Cunard Burgee + Red Ensign)
  const bowStaff = trackMesh(buildCylinder('lus_bowStaff', 0.04, 0.07, 5.2, 8), bowContent);
  bowStaff.material = whitePaintMat;
  bowStaff.position.set(0, 11.9, -65.7);
  const cunardFlagMat = trackMat(
    makePBR('lus_cunardFlag', {
      albedoTex: textures.cunardBurgee,
      alphaCutOff: 0.1,
      roughness: 0.72,
      metallic: 0.02,
      doubleSided: true,
      envIntensity: 0.3,
    }),
  );
  const cunardFlag = trackMesh(buildPlane('lus_cunardFlagPlane', 2.4, 1.2), bowContent);
  cunardFlag.material = cunardFlagMat;
  cunardFlag.position.set(0.04, 13.8, -64.5);
  cunardFlag.rotation.y = Math.PI / 2 + 0.14;

  const sternStaff = trackMesh(buildCylinder('lus_sternStaff', 0.045, 0.08, 6.2, 8), sternContent);
  sternStaff.material = whitePaintMat;
  sternStaff.position.set(0, 11.0, 173.0);
  sternStaff.rotation.x = 0.18;
  const ensignMat = trackMat(
    makePBR('lus_ensign', {
      albedoTex: textures.redEnsignFlag,
      roughness: 0.72,
      metallic: 0.02,
      doubleSided: true,
      envIntensity: 0.3,
    }),
  );
  const ensignFlag = trackMesh(buildPlane('lus_ensignFlag', 3.2, 1.6), sternContent);
  ensignFlag.material = ensignMat;
  ensignFlag.position.set(0.04, 12.9, 174.9);
  ensignFlag.rotation.y = Math.PI / 2 + 0.12;

  // =========================================================================
  // 6. TORN FRACTURE BULKHEADS AT BREAK_Z = 78.0
  // =========================================================================
  const tornSteelMat = trackMat(
    makePBR('lus_tornSteel', { color: 0x1e2228, roughness: 0.78, metallic: 0.62, doubleSided: true, envIntensity: 0.36 }),
  );
  const tornRustMat = trackMat(
    makePBR('lus_tornRust', { color: 0x3b261d, roughness: 0.84, metallic: 0.45, envIntensity: 0.32 }),
  );
  const breakEmberMat = trackMat(
    makePBR('lus_breakEmber', { color: 0xffa44d, emissive: 0xff6a1a, emissiveIntensity: 1.2, roughness: 0.45, envIntensity: 0.25 }),
  );

  const buildFractureCap = (label: string, dirZ: -1 | 1): THREE.Group => {
    const cap = new THREE.Group();
    cap.name = `lus_breakCap_${label}`;
    cap.position.set(0, 0, LUSITANIA_BREAK_Z - dirZ * 0.18);

    const hullFaceShape = new Shape2D();
    hullFaceShape.moveTo(0, -6.5);
    hullFaceShape.quadraticCurveTo(11.2, -5.9, 11.7, -2.5, 10);
    hullFaceShape.lineTo(13.4, 7.4);
    hullFaceShape.lineTo(12.6, 7.4);
    hullFaceShape.lineTo(12.6, 9.9);
    hullFaceShape.lineTo(10.6, 9.95);
    hullFaceShape.lineTo(10.6, 12.6);
    hullFaceShape.lineTo(-10.6, 12.6);
    hullFaceShape.lineTo(-10.6, 9.95);
    hullFaceShape.lineTo(-12.6, 9.9);
    hullFaceShape.lineTo(-12.6, 7.4);
    hullFaceShape.lineTo(-13.4, 7.4);
    hullFaceShape.lineTo(-11.7, -2.5);
    hullFaceShape.quadraticCurveTo(-11.2, -5.9, 0, -6.5, 10);

    const faceMesh = trackMesh(buildExtrudedShapeMesh(`lus_bFace_${label}`, hullFaceShape, 0.55, 0), cap);
    faceMesh.material = tornSteelMat;
    faceMesh.position.z = dirZ > 0 ? -0.35 : -0.2;

    for (const dy of [-2.2, 1.4, 4.4, 7.45, 9.95, 12.65]) {
      const w = dy < 6 ? 23.6 : dy < 9.5 ? 25.0 : 21.0;
      const slab = trackMesh(buildBox(nextId('bSlab'), w, 0.28, 1.3), cap);
      slab.material = tornRustMat;
      slab.position.set(0, dy, dirZ * 0.3);
    }
    for (const [ex, ey] of [[-4.4, 3.2], [4.4, 3.2], [-6.0, 8.2], [6.0, 8.2], [0, 11.1]]) {
      const ember = trackMesh(buildPlane(nextId('bEmber'), 3.0, 1.4), cap);
      ember.material = breakEmberMat;
      ember.position.set(ex, ey, dirZ * 0.35);
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
  // 7. WHEELHOUSE AT [0, 12.9, 0] WITH CUNARD CHADBURN TELEGRAPHS
  // =========================================================================
  const wheelhouse = new THREE.Group();
  wheelhouse.name = 'lus_wheelhouse';
  bowContent.add(wheelhouse);
  wheelhouse.position.set(0, 12.9, 0);

  const whFloor = trackMesh(
    buildCurvedFootprint('lus_whFloor', 4.55, -1.65, 3.0, 0.16, 0.58, 0.22, 0.03),
    wheelhouse,
  );
  whFloor.material = teakDeckMat;
  const frontWainscot = trackMesh(
    buildCurvedFootprint('lus_frontWain', 4.45, -1.7, -1.2, 1.05, 0.58, 0.05, 0.04),
    wheelhouse,
  );
  frontWainscot.material = mahoganyMat;
  frontWainscot.position.y = 0.1;
  const sillTrim = trackMesh(
    buildCurvedFootprint('lus_sillTrim', 4.5, -1.73, -1.18, 0.07, 0.58, 0.05, 0.02),
    wheelhouse,
  );
  sillTrim.material = brassMat;
  sillTrim.position.y = 1.14;
  const frontHeader = trackMesh(
    buildCurvedFootprint('lus_frontHead', 4.55, -1.73, -1.18, 0.3, 0.58, 0.05, 0.04),
    wheelhouse,
  );
  frontHeader.material = mahoganyMat;
  frontHeader.position.y = 2.68;
  const whRoof = trackMesh(
    buildCurvedFootprint('lus_whRoof', 4.7, -1.8, 3.15, 0.2, 0.62, 0.25, 0.05),
    wheelhouse,
  );
  whRoof.material = mahoganyMat;
  whRoof.position.y = 2.95;

  for (const mx of [-4.2, -2.55, -1.05, 1.05, 2.55, 4.2]) {
    const zArc = -1.38 - (1 - Math.pow(mx / 4.5, 2)) * 0.22;
    const mullion = trackMesh(buildCylinder(nextId('whMull'), 0.055, 0.065, 1.62, 10), wheelhouse);
    mullion.material = mahoganyMat;
    mullion.position.set(mx, 1.94, zArc);
    const bStrip = trackMesh(buildCylinder(nextId('whBSt'), 0.022, 0.022, 1.62, 8), wheelhouse);
    bStrip.material = brassMat;
    bStrip.position.set(mx, 1.94, zArc + 0.05);
  }
  for (const side of [-1, 1]) {
    const sideLower = trackMesh(buildBox(nextId('whSL'), 0.22, 1.16, 4.4), wheelhouse);
    sideLower.material = mahoganyMat;
    sideLower.position.set(side * 4.4, 0.58, 0.85);
    const sideHeader = trackMesh(buildBox(nextId('whSH'), 0.22, 0.38, 4.4), wheelhouse);
    sideHeader.material = mahoganyMat;
    sideHeader.position.set(side * 4.4, 2.82, 0.85);
    const sideGlass = trackMesh(buildPlane(nextId('whSG'), 3.6, 1.62), wheelhouse);
    sideGlass.material = bridgeGlassMat;
    sideGlass.renderOrder = 2;
    sideGlass.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    sideGlass.position.set(side * 4.4, 1.94, 0.45);
  }
  const aftWall = trackMesh(buildBox('lus_whAftWall', 8.8, 2.95, 0.24), wheelhouse);
  aftWall.material = mahoganyMat;
  aftWall.position.set(0, 1.48, 2.95);

  const clinoFaceMat = trackMat(
    makePBR('lus_clinoFace', {
      albedoTex: textures.clinometerDial,
      emissiveTex: textures.clinometerDial,
      emissive: 0xffd79a,
      emissiveIntensity: 0.45,
      roughness: 0.48,
      envIntensity: 0.25,
    }),
  );
  const clinoFace = trackMesh(buildDisc('lus_clinoFace', 0.13, 18), wheelhouse);
  clinoFace.material = clinoFaceMat;
  clinoFace.position.set(0, 2.79, -1.125);
  const clinometerNeedle = trackMesh(buildBox('lus_clinoNeedle', 0.016, 0.1, 0.01), wheelhouse);
  clinometerNeedle.material = portLightMat;
  clinometerNeedle.position.set(0, 2.79, -1.115);

  const helmPedProto = buildLatheMesh(
    'lus_helmPedProto',
    [
      new THREE.Vector2(0.28, 0),
      new THREE.Vector2(0.24, 0.12),
      new THREE.Vector2(0.16, 0.25),
      new THREE.Vector2(0.13, 0.72),
      new THREE.Vector2(0.2, 0.96),
      new THREE.Vector2(0.18, 1.08),
    ],
    16,
  );
  helmPedProto.material = mahoganyMat;
  trackProtoGeo(helmPedProto.geometry);

  const helmBase = trackMesh(helmPedProto, wheelhouse, true);
  helmBase.position.set(0, 0.06, 0.18);
  const helmCollar = trackMesh(buildCylinder('lus_helmCollar', 0.19, 0.19, 0.12, 16), wheelhouse);
  helmCollar.material = brassMat;
  helmCollar.position.set(0, 1.05, 0.18);
  const rudderNeedle = trackMesh(buildBox('lus_rudderNeedle', 0.03, 0.04, 0.1), wheelhouse);
  rudderNeedle.material = portLightMat;
  rudderNeedle.position.set(0, 1.16, 0.02);

  const helmWheel = new THREE.Group();
  helmWheel.name = 'lus_helmWheel';
  wheelhouse.add(helmWheel);
  helmWheel.position.set(0, 1.06, 0.28);
  const wheelRim = trackMesh(buildTorusXY('lus_helmRim', 0.46, 0.042, 12, 32), helmWheel);
  wheelRim.material = mahoganyMat;
  const wheelHub = trackMesh(buildCylinder('lus_helmHub', 0.095, 0.095, 0.13, 16), helmWheel);
  wheelHub.material = brassMat;
  wheelHub.rotation.x = Math.PI / 2;
  const spokeProto = buildCylinder('lus_spokeProto', 0.02, 0.026, 0.92, 8);
  trackProtoGeo(spokeProto.geometry);
  for (let i = 0; i < 4; i++) {
    const spoke = trackMesh(cloneMeshWithMaterial(spokeProto, `lus_spoke_${i}`, i === 0 ? brassMat : mahoganyMat), helmWheel);
    spoke.rotation.z = (i * Math.PI) / 4;
  }

  const binnacleGroup = new THREE.Group();
  wheelhouse.add(binnacleGroup);
  binnacleGroup.position.set(-0.92, 0.06, -0.32);
  trackMesh(cloneMeshWithMaterial(helmPedProto, 'lus_binnaclePed', mahoganyMat), binnacleGroup);
  const binnacleHood = trackMesh(buildCylinder('lus_binnHood', 0.21, 0.19, 0.22, 16), binnacleGroup);
  binnacleHood.material = brassMat;
  binnacleHood.position.y = 1.02;
  const compassCardMat = trackMat(
    makePBR('lus_compassCard', {
      albedoTex: textures.compassDial,
      emissiveTex: textures.compassDial,
      emissive: 0xffca7a,
      emissiveIntensity: 0.65,
      roughness: 0.48,
      envIntensity: 0.25,
    }),
  );
  const compassMount = new THREE.Group();
  binnacleGroup.add(compassMount);
  compassMount.position.set(0, 1.14, 0.02);
  compassMount.rotation.x = -Math.PI / 2 + 0.22;
  const compassCard = trackMesh(buildDisc('lus_compassCard', 0.165, 22), compassMount);
  compassCard.material = compassCardMat;

  // Dual CUNARD LINE Chadburn Telegraphs
  const telegraphPedProto = buildLatheMesh(
    'lus_telPedProto',
    [
      new THREE.Vector2(0.21, 0),
      new THREE.Vector2(0.18, 0.14),
      new THREE.Vector2(0.09, 0.35),
      new THREE.Vector2(0.075, 0.78),
      new THREE.Vector2(0.11, 0.98),
    ],
    14,
  );
  trackProtoGeo(telegraphPedProto.geometry);

  const telegraphDialMats: THREE.MeshPhysicalMaterial[] = [];
  const makeTelegraph = (xPos: number, idx: number): THREE.Group => {
    const tGroup = new THREE.Group();
    wheelhouse.add(tGroup);
    tGroup.position.set(xPos, 0.06, -0.32);
    trackMesh(cloneMeshWithMaterial(telegraphPedProto, `lus_tPed_${idx}`, brassMat), tGroup);

    const drum = trackMesh(buildCylinder(nextId('tDrum'), 0.23, 0.23, 0.16, 18), tGroup);
    drum.material = brassMat;
    drum.rotation.z = Math.PI / 2;
    drum.position.y = 1.12;

    const dialMat = trackMat(
      makePBR(`lus_telDial_${idx}`, {
        albedoTex: textures.telegraphDialCunard,
        emissiveTex: textures.telegraphDialCunard,
        emissive: 0xffd79a,
        emissiveIntensity: 0.55,
        roughness: 0.46,
        envIntensity: 0.25,
      }),
    );
    telegraphDialMats.push(dialMat);
    const dialFace = trackMesh(buildDisc(nextId('tDialFace'), 0.205, 22), tGroup);
    dialFace.material = dialMat;
    dialFace.rotation.y = xPos > 0 ? -Math.PI / 2 : Math.PI / 2;
    dialFace.position.set(xPos > 0 ? -0.085 : 0.085, 1.12, 0);

    const leverPivot = new THREE.Group();
    tGroup.add(leverPivot);
    leverPivot.position.set(xPos > 0 ? -0.1 : 0.1, 1.12, 0);
    const arm = trackMesh(buildCylinder(nextId('tArm'), 0.015, 0.018, 0.34, 8), leverPivot);
    arm.material = brassMat;
    arm.position.y = 0.17;
    const handle = trackMesh(buildCylinder(nextId('tHandle'), 0.026, 0.026, 0.14, 10), leverPivot);
    handle.material = mahoganyMat;
    handle.rotation.z = Math.PI / 2;
    handle.position.y = 0.34;
    return leverPivot;
  };
  const telegraphLever = makeTelegraph(0.98, 0);
  const telegraphLeverPort = makeTelegraph(-1.65, 1);

  const warmBridgeLight = new THREE.PointLight(0xffad58, 6.5, 14.0, 1.0);
  warmBridgeLight.position.set(0, 15.4, 0.1);
  bowContent.add(warmBridgeLight);

  const boatDeckGlowFwd = new THREE.PointLight(0xffb86b, 18.0, 115, 1.0);
  boatDeckGlowFwd.position.set(0, 16.5, 36);
  bowContent.add(boatDeckGlowFwd);

  const whFloodMat = trackMat(
    makePBR('lus_whFlood', {
      color: 0x092238,
      roughness: 0.25,
      metallic: 0.22,
      alpha: 0.84,
      doubleSided: true,
      envIntensity: 0.32,
    }),
  );
  const whFloodMesh = trackMesh(buildPlane('lus_whFloodMesh', 8.7, 5.0), wheelhouse);
  whFloodMesh.material = whFloodMat;
  whFloodMesh.rotation.x = -Math.PI / 2;
  whFloodMesh.position.set(0, 0.02, 0.45);
  whFloodMesh.visible = false;

  // =========================================================================
  // 8. ACCESSIBLE CUNARD INTERIOR DECKS & PARSONS TURBINE ENGINE ROOM
  // =========================================================================
  const turbineRotors: THREE.Group[] = [];
  let stairLight: THREE.PointLight | null = null;
  let marconiLight: THREE.PointLight | null = null;
  let loungeLight: THREE.PointLight | null = null;
  let diningLight: THREE.PointLight | null = null;
  let engineLight: THREE.PointLight | null = null;

  if (!companionOnly) {
    // A. Grand Staircase Atrium (z = 24.6..35.4, camera eye [0, 11.4, 30.2])
    const stairGroup = new THREE.Group();
    bowContent.add(stairGroup);
    for (const wallX of [-5.2, 5.2]) {
      const sWall = trackMesh(buildBox(nextId('sWall'), 0.24, 10.6, 11.0), stairGroup);
      sWall.material = mahoganyMat;
      sWall.position.set(wallX, 7.6, 30.0);
    }
    for (const ez of [24.6, 35.4]) {
      const eWall = trackMesh(buildBox(nextId('sEWall'), 10.6, 10.6, 0.24), stairGroup);
      eWall.material = mahoganyMat;
      eWall.position.set(0, 7.6, ez);
    }
    for (const ly of [2.4, 7.2, 10.0, 12.88]) {
      const landing = trackMesh(buildBox(nextId('stLand'), 10.2, 0.22, 3.0), stairGroup);
      landing.material = interiorMarbleMat;
      landing.position.set(0, ly - 0.08, 33.8);
    }
    for (const [yBot, yTop, zStart] of [[2.4, 7.2, 26.8], [7.2, 10.0, 27.0], [10.0, 12.88, 27.2]] as const) {
      for (let s = 0; s < 10; s++) {
        const t = s / 9;
        const step = trackMesh(buildBox(nextId('stStep'), 2.4, 0.16, 0.34), stairGroup);
        step.material = mahoganyMat;
        step.position.set(0, MathUtils.lerp(yBot, yTop, t), zStart + t * 4.2);
      }
    }
    const clockDial = trackMesh(buildDisc('lus_stClock', 0.58, 18), stairGroup);
    clockDial.material = warmGlowMat;
    clockDial.position.set(0, 11.45, 24.82);

    stairLight = new THREE.PointLight(0xffcb7d, 18.0, 26, 1.0);
    stairLight.position.set(0, 13.8, 30.0);
    bowContent.add(stairLight);

    // B. Marconi Wireless Cabin (z = 36.2..44.6, camera eye [0, 14.2, 41.4])
    const marconiGroup = new THREE.Group();
    bowContent.add(marconiGroup);
    const radioDesk = trackMesh(buildBox('lus_radioDesk', 2.4, 0.82, 1.0), marconiGroup);
    radioDesk.material = mahoganyMat;
    radioDesk.position.set(1.8, 13.38, 39.2);
    const sparkCoil = trackMesh(buildBox('lus_sparkCoil', 0.9, 0.62, 0.52), marconiGroup);
    sparkCoil.material = darkIronMat;
    sparkCoil.position.set(1.8, 14.08, 39.0);
    const sparkGlow = trackMesh(buildSphere('lus_sparkGlow', 0.11, 8, 8), marconiGroup);
    sparkGlow.material = warmGlowMat;
    sparkGlow.position.set(1.8, 14.2, 39.3);

    marconiLight = new THREE.PointLight(0xffd28c, 14.0, 18, 1.0);
    marconiLight.position.set(0.2, 14.68, 40.4);
    bowContent.add(marconiLight);

    // C. A-Deck Lounge & Promenade (z = 55.4..71.6, camera eye [0, 11.35, 64.0])
    const loungeGroup = new THREE.Group();
    bowContent.add(loungeGroup);
    const loungeFloor = trackMesh(buildBox('lus_loungeFlr', 20.4, 0.14, 16.0), loungeGroup);
    loungeFloor.material = crimsonVelvetMat;
    loungeFloor.position.set(0, 10.02, 63.5);
    for (const lz of [55.5, 71.5]) {
      const endWall = trackMesh(buildBox(nextId('lngEnd'), 20.4, 2.68, 0.28), loungeGroup);
      endWall.material = interiorPanelMat;
      endWall.position.set(0, 11.3, lz);
    }
    for (const sx of [-5.8, 0, 5.8]) {
      for (const sz of [60.0, 67.0]) {
        const tbl = trackMesh(buildCylinder(nextId('lngTbl'), 0.9, 0.9, 0.08, 14), loungeGroup);
        tbl.material = mahoganyMat;
        tbl.position.set(sx, 10.75, sz);
        const lamp = trackMesh(buildSphere(nextId('lngLamp'), 0.15, 8, 8), loungeGroup);
        lamp.material = warmGlowMat;
        lamp.position.set(sx, 10.98, sz);
      }
    }
    loungeLight = new THREE.PointLight(0xffcb78, 16.0, 26, 1.0);
    loungeLight.position.set(0, 12.25, 63.8);
    bowContent.add(loungeLight);

    // D. D-Deck Saloon Dining (z = 35.5..58.5, camera eye [0, 4.15, 47.0])
    const diningGroup = new THREE.Group();
    bowContent.add(diningGroup);
    const diningFlr = trackMesh(buildBox('lus_diningFlr', 22.0, 0.22, 23.0), diningGroup);
    diningFlr.material = interiorMarbleMat;
    diningFlr.position.set(0, 2.32, 47.0);
    const diningCeil = trackMesh(buildBox('lus_diningCeil', 22.0, 0.2, 23.0), diningGroup);
    diningCeil.material = creamTrimMat;
    diningCeil.position.set(0, 6.4, 47.0);
    for (const dz of [35.6, 58.4]) {
      const dWall = trackMesh(buildBox(nextId('dinW'), 22.0, 4.0, 0.28), diningGroup);
      dWall.material = interiorPanelMat;
      dWall.position.set(0, 4.35, dz);
    }
    for (const side of [-1, 1]) {
      const sWall = trackMesh(buildBox(nextId('dinSX'), 0.28, 4.0, 23.0), diningGroup);
      sWall.material = interiorPanelMat;
      sWall.position.set(side * 10.95, 4.35, 47.0);
    }
    const tableSpots: Array<[number, number]> = [];
    for (const tx of [-7.8, -3.9, 0, 3.9, 7.8]) {
      for (let tz = 38.0; tz <= 56.0; tz += 4.5) tableSpots.push([tx, tz]);
    }
    const dTableProto = buildBox('lus_dTable', 1.65, 0.14, 1.65);
    const dLampProto = buildSphere('lus_dLamp', 0.11, 8, 8);
    const tmSlot = makeSlot('lus_dinTables', dTableProto, linenClothMat, tableSpots.length, diningGroup);
    const lmSlot = makeSlot('lus_dinLamps', dLampProto, warmGlowMat, tableSpots.length, diningGroup);
    for (let i = 0; i < tableSpots.length; i++) {
      writeInstanceMatrix(tmSlot, i, tableSpots[i][0], 3.16, tableSpots[i][1], 0, 0, 0);
      writeInstanceMatrix(lmSlot, i, tableSpots[i][0], 3.44, tableSpots[i][1], 0, 0, 0);
    }
    commitInstanceMatrices(tmSlot, tableSpots.length);
    commitInstanceMatrices(lmSlot, tableSpots.length);

    diningLight = new THREE.PointLight(0xffcc7e, 20.0, 32, 1.0);
    diningLight.position.set(0, 5.75, 47.0);
    bowContent.add(diningLight);

    // E. Parsons Steam Turbine Engine Room (z = 81.0..107.0, camera eye [0, 2.2, 94.0])
    const engineGroup = new THREE.Group();
    sternContent.add(engineGroup);
    const engFloor = trackMesh(buildBox('lus_engFloor', 18.0, 0.35, 26.0), engineGroup);
    engFloor.material = darkIronMat;
    engFloor.position.set(0, -3.55, 94.0);
    for (const ez of [81.0, 107.0]) {
      const bulk = trackMesh(buildBox(nextId('engBulk'), 18.0, 13.0, 0.35), engineGroup);
      bulk.material = darkIronMat;
      bulk.position.set(0, 2.95, ez);
    }
    for (const side of [-1, 1]) {
      const casSide = trackMesh(buildBox(nextId('engCas'), 0.32, 13.0, 26.0), engineGroup);
      casSide.material = darkIronMat;
      casSide.position.set(side * 8.8, 2.95, 94.0);
      const catwalk = trackMesh(buildBox(nextId('engCat'), 1.75, 0.14, 24.8), engineGroup);
      catwalk.material = polishedSteelMat;
      catwalk.position.set(side * 7.8, 1.65, 94.0);

      // Twin High-Pressure & Low-Pressure Parsons Steam Turbine Drums
      const bed = trackMesh(buildBox(nextId('turbBed'), 4.2, 1.3, 18.5), engineGroup);
      bed.material = engineGreenMat;
      bed.position.set(side * 3.6, -2.75, 94.0);

      const casing = trackMesh(buildCylinder(nextId('turbCase'), 1.85, 2.15, 13.5, 20), engineGroup);
      casing.material = engineGreenMat;
      casing.rotation.x = Math.PI / 2;
      casing.position.set(side * 3.6, -1.15, 94.0);

      const rotorGrp = new THREE.Group();
      engineGroup.add(rotorGrp);
      rotorGrp.position.set(side * 3.6, -1.15, 94.0);
      const shaft = trackMesh(buildCylinder(nextId('tShaft'), 0.34, 0.34, 21.0, 12), rotorGrp);
      shaft.material = polishedSteelMat;
      shaft.rotation.x = Math.PI / 2;
      for (let ti = 0; ti < 5; ti++) {
        const ring = trackMesh(buildTorusXY(nextId('tRing'), 1.95, 0.08, 8, 22), rotorGrp);
        ring.material = brassMat;
        ring.position.z = -5.6 + ti * 2.8;
      }
      turbineRotors.push(rotorGrp);

      const steamHeader = trackMesh(buildCylinder(nextId('steamH'), 0.42, 0.42, 20.5, 14), engineGroup);
      steamHeader.material = pipeLaggingMat;
      steamHeader.rotation.x = Math.PI / 2;
      steamHeader.position.set(side * 3.6, 5.2, 94.0);
    }
    engineLight = new THREE.PointLight(0xffbe66, 22.0, 32, 1.0);
    engineLight.position.set(0, 6.4, 94.0);
    sternContent.add(engineLight);
  }

  // Searchlight & Controls
  const slPedestal = trackMesh(buildCylinder('lus_slPed', 0.14, 0.24, 0.34, 12), bowContent);
  slPedestal.material = brassMat;
  slPedestal.position.set(0, 16.02, -1.2);
  const searchlightHead = new THREE.Group();
  bowContent.add(searchlightHead);
  searchlightHead.position.set(0, 16.28, -1.2);
  const slHousing = trackMesh(buildCylinder('lus_slHous', 0.32, 0.28, 0.72, 14), searchlightHead);
  slHousing.material = brassMat;
  slHousing.rotation.x = Math.PI / 2;
  const slLens = trackMesh(buildDisc('lus_slLens', 0.27, 14), searchlightHead);
  slLens.material = warmGlowMat;
  slLens.rotation.y = Math.PI;
  slLens.position.z = -0.37;
  const searchlightOrigin = new THREE.Object3D();
  searchlightOrigin.position.set(0, 0, -0.4);
  searchlightHead.add(searchlightOrigin);

  const beamUniforms = { uOpacity: { value: 0.0 } };
  let searchlightBeam: THREE.Mesh | null = null;
  if (!companionOnly) {
    const beamGeo = new THREE.CylinderGeometry(0.28, 8.6, 125, 24, 1, true);
    beamGeo.rotateX(Math.PI / 2);
    beamGeo.translate(0, 0, -62.9);
    const beamMat = trackMat(
      new THREE.ShaderMaterial({
        name: 'lus_searchlightBeam',
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
            gl_FragColor = vec4(0.84, 0.93, 1.0, a);
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
  searchlightTarget.position.set(0, 1.5, -150);

  let enginePhase = 0;
  const setEngineSpeed = (knots: number, dt: number) => {
    if (companionOnly) return;
    enginePhase += knots * dt * 1.35;
    for (let i = 0; i < turbineRotors.length; i++) {
      turbineRotors[i].rotation.z = enginePhase * (i === 0 ? 1 : -1);
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
      if (stairOn) stairLight.intensity = 18.0 * p;
    }
    if (marconiLight) {
      marconiLight.visible = marconiOn;
      if (marconiOn) marconiLight.intensity = 14.0 * p;
    }
    if (loungeLight) {
      loungeLight.visible = loungeOn;
      if (loungeOn) loungeLight.intensity = 16.0 * p;
    }
    if (diningLight) {
      diningLight.visible = diningOn;
      if (diningOn) diningLight.intensity = 20.0 * p;
    }
    if (engineLight) {
      engineLight.visible = engineOn;
      if (engineOn) engineLight.intensity = 22.0 * p;
    }
  };

  const setPowerLevel = (power: number) => {
    const p = MathUtils.clamp(power, 0, 1);
    warmBridgeLight.intensity = companionOnly ? 0 : 6.5 * p;
    warmBridgeLight.visible = !companionOnly && p > 0.03;
    boatDeckGlowFwd.intensity = companionOnly ? 0 : 18.0 * p;
    boatDeckGlowFwd.visible = !companionOnly && p > 0.08;
    warmGlowMat.emissiveIntensity = 0.06 + 0.68 * p;
    portholeGlowMat.emissiveIntensity = 0.72 * p;
    compassCardMat.emissiveIntensity = 0.06 + 0.32 * p;
    clinoFaceMat.emissiveIntensity = 0.04 + 0.22 * p;
    for (const dm of telegraphDialMats) {
      dm.emissiveIntensity = 0.06 + 0.26 * p;
    }
    portLightMat.emissiveIntensity = 0.85 * p;
    starboardLightMat.emissiveIntensity = 0.85 * p;
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
    marconiAerialsGroup.visible = !broken;
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
    boatDeckGlowFwd.dispose();
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
