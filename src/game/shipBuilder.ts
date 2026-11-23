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
import { ProceduralTextureSet } from './textures';

export const BREAK_Z = 90.0;

export interface TitanicShipRig {
  root: THREE.Group;
  hullMeshGroup: THREE.Group;
  bowGroup: THREE.Group;
  sternGroup: THREE.Group;
  bowContent: THREE.Group;
  sternContent: THREE.Group;
  helmWheel: THREE.Group;
  compassCard: THREE.Mesh;
  telegraphLever: THREE.Group;
  telegraphLeverPort: THREE.Group;
  searchlightHead: THREE.Group;
  searchlightOrigin: THREE.Object3D;
  searchlightTarget: THREE.Object3D;
  rudderNeedle: THREE.Mesh;
  clinometerNeedle: THREE.Mesh;
  warmBridgeLight: THREE.PointLight;
  shadowCasters: THREE.Object3D[];
  crewAndLifeboats: CrewAndLifeboatSystem;
  setPowerLevel: (power: number) => void;
  setActiveInteriorSpot: (spotId: string, insideDryCompartment: boolean, powerLevel: number) => void;
  setEngineSpeed: (knots: number, dt: number) => void;
  setWheelhouseFloodLevel: (level: number, fadeFactor?: number) => void;
  setBreakupVisual: (broken: boolean, emberPower?: number) => void;
  setSearchlightBeam: (power: number, wide: boolean) => void;
  dispose: () => void;
}

/**
 * Evaluates true 1:1 scale RMS Titanic hull half-beam (max 14.0m / 28m beam)
 * and sheer height from Bow Stem (z = -74.0) to Cruiser Stern (z = +195.1) -> 269.1m LOA.
 */
function sampleHullStation(
  z: number,
  beamScale = 1.0,
): {
  beam: number;
  sheerY: number;
  flareFactor: number;
} {
  let beam = 14.0;
  let flareFactor = 0.06;

  if (z < -16) {
    // Full ocean-liner forward entrance (-74 to -16) with smooth rounded cutwater stem
    const t = MathUtils.clamp((z - -74) / 58, 0, 1);
    beam = 14.0 * Math.pow(Math.sin((t * Math.PI) / 2), 0.58);
    flareFactor = 0.24 * (1 - t) + 0.05;
  } else if (z > 136 && z <= 185) {
    // Graceful Olympic-class elliptical cruiser stern transition (+136 to +185)
    const t = MathUtils.clamp((195.1 - z) / 59.1, 0, 1);
    beam = 14.0 * Math.pow(Math.sin((t * Math.PI) / 2), 0.5);
    flareFactor = 0.14 * (1 - t) + 0.04;
  } else if (z > 185) {
    // Broad rounded elliptical counter stern arc (+185 to +195.1) — zero sharp point
    const tAnchor = (195.1 - 185.0) / 59.1;
    const anchorBeam = 14.0 * Math.pow(Math.sin((tAnchor * Math.PI) / 2), 0.5);
    const u = MathUtils.clamp((z - 185.0) / 10.1, 0, 1);
    beam = anchorBeam * Math.sqrt(Math.max(0, 1 - u * u));
    flareFactor = 0.14;
  }

  let sheerY = 6.8;
  if (z < -35) {
    // Forecastle deck sheer rise
    const t = MathUtils.clamp((-35 - z) / 39, 0, 1);
    sheerY = 9.0 + t * 1.1;
  } else if (z < -10) {
    // Forward well deck
    sheerY = 6.5;
  } else if (z > 148 && z < 170) {
    // Aft well deck
    sheerY = 6.5;
  } else if (z >= 170) {
    // Poop deck sheer rise
    const t = MathUtils.clamp((z - 170) / 25.1, 0, 1);
    sheerY = 8.2 + t * 0.9;
  }

  return { beam: beam * beamScale, sheerY, flareFactor };
}

/**
 * Evaluates Olympic-class keel elevation profile (flat midships -6.5m,
 * sweeping forefoot at bow stem, and graceful rising overhanging counter stern).
 */
function sampleKeelY(z: number): number {
  if (z < -64) {
    const t = MathUtils.clamp((-64 - z) / 10.0, 0, 1);
    return -6.5 + 2.7 * t * t;
  }
  if (z > 168) {
    if (z <= 185) {
      const t = (z - 168) / 17.0;
      return -6.5 + 2.3 * Math.pow(t, 1.3);
    }
    const u = MathUtils.clamp((z - 185) / 10.1, 0, 1);
    return -4.2 + 8.0 * Math.pow(u, 0.92);
  }
  return -6.5;
}

/**
 * Builds a watertight lofted 3D hull surface split at the waterline (y = 0.22m)
 * or full depth while honoring sampleKeelY(z) for a true overhanging counter stern.
 */
function buildLoftedHullSection(
  name: string,
  zSamples: number[],
  yLevels: number,
  yMinFrac: number,
  yMaxFrac: number,
  beamScale = 1.0,
): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const includeKeel = yMinFrac <= 0.001;
  const isLowerBand = includeKeel && yMaxFrac < 0.5;
  const isUpperBand = !includeKeel && yMaxFrac > 0.9;

  const evalVertex = (z: number, side: number, frac: number): [number, number, number, number, number] => {
    const { beam, sheerY, flareFactor } = sampleHullStation(z, beamScale);
    const vCoord = (z + 74) / 269.1;
    const yKeel = sampleKeelY(z);
    const yTop = sheerY;

    let y: number;
    if (isLowerBand) {
      const yMaxWL = Math.min(0.24, yTop - 0.08);
      const yHigh = Math.max(yKeel + 0.02, yMaxWL);
      const localU = yMaxFrac > 0 ? frac / yMaxFrac : 0;
      y = MathUtils.lerp(yKeel, yHigh, localU);
    } else if (isUpperBand) {
      const yLow = Math.min(yTop - 0.04, Math.max(yKeel, 0.20));
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

    if (z > 180) {
      const sternU = MathUtils.clamp((z - 180) / 15.1, 0, 1);
      widthRatio *= 1.0 - sternU * 0.08 * (1.0 - hullFrac);
    }

    const stemU = MathUtils.clamp((-64.0 - z) / 10.0, 0, 1);
    const bowRake = -0.45 * stemU * hullFrac;
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

/**
 * Builds a hull-conforming solid weather deck slab directly from sampleHullStation(z)
 * with top, underside, and side skirt so decks meet the outer hull sheer with zero gaps.
 */
function buildLoftedWeatherDeck(
  name: string,
  zSamples: number[],
  yTopOffset = 0.04,
  thickness = 0.42,
  edgeExpand = 0.04,
  beamScale = 1.0,
): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringPts = 5;

  for (let zi = 0; zi < zSamples.length; zi++) {
    const z = zSamples[zi];
    const { beam, sheerY, flareFactor } = sampleHullStation(z, beamScale);
    const halfW = Math.max(0.05, beam * (1 + flareFactor) + edgeExpand);
    const stemU = MathUtils.clamp((-64.0 - z) / 10.0, 0, 1);
    const bowRake = -0.45 * stemU;
    const zz = z + bowRake;
    const yTop = sheerY + yTopOffset;
    const yBot = yTop - thickness;
    const vCoord = (z + 74) / 269.1;

    positions.push(-halfW, yBot, zz);
    uvs.push(0, vCoord * 12);
    positions.push(-halfW, yTop, zz);
    uvs.push(0.15, vCoord * 12);
    positions.push(0, yTop + 0.08, zz);
    uvs.push(0.5, vCoord * 12);
    positions.push(halfW, yTop, zz);
    uvs.push(0.85, vCoord * 12);
    positions.push(halfW, yBot, zz);
    uvs.push(1.0, vCoord * 12);
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

/**
 * Helper to create a curved superstructure/deckhouse footprint extruded vertically along +Y.
 */
function buildCurvedDeckhouseMesh(
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

/**
 * Builds a sculpted 3- or 4-blade manganese-bronze marine propeller.
 */
function buildPropellerGroup(
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
        new THREE.Vector2(0.0, -0.45),
        new THREE.Vector2(0.32, -0.34),
        new THREE.Vector2(0.38, 0.14),
        new THREE.Vector2(0.24, 0.48),
        new THREE.Vector2(0.0, 0.58),
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
  bladeShape.quadraticCurveTo(radius * 0.38, radius * 0.35, radius * 0.25, radius * 0.85, 8);
  bladeShape.quadraticCurveTo(0, radius * 1.05, -radius * 0.26, radius * 0.82, 8);
  bladeShape.quadraticCurveTo(-radius * 0.32, radius * 0.35, 0, 0, 8);

  const bladeProto = buildExtrudedShapeMesh(`${name}_bladeProto`, bladeShape, 0.07, 0.02);
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

export function buildTitanicShip(
  scene: THREE.Scene,
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean,
): TitanicShipRig {
  return buildOlympicShip(scene, textures, isSoftwareGl, 'titanic', false);
}

export function buildOlympicShip(
  scene: THREE.Scene,
  textures: ProceduralTextureSet,
  _isSoftwareGl: boolean,
  variant: 'titanic' | 'britannic' = 'titanic',
  companionOnly = false,
): TitanicShipRig {
  const isBritannic = variant === 'britannic';
  const beamScale = isBritannic ? 14.3 / 14.0 : 1.0;

  const root = new THREE.Group();
  root.name = `${variant}_root`;
  scene.add(root);

  const hullMeshGroup = new THREE.Group();
  hullMeshGroup.name = `${variant}_hullMeshGroup`;
  root.add(hullMeshGroup);

  // Articulated Bow & Stern halves pivoted at the midships fracture line (z = BREAK_Z)
  const bowGroup = new THREE.Group();
  bowGroup.name = 'titanic_bowGroup';
  bowGroup.position.set(0, 0, BREAK_Z);
  hullMeshGroup.add(bowGroup);

  const bowContent = new THREE.Group();
  bowContent.name = 'titanic_bowContent';
  bowContent.position.set(0, 0, -BREAK_Z);
  bowGroup.add(bowContent);

  const sternGroup = new THREE.Group();
  sternGroup.name = 'titanic_sternGroup';
  sternGroup.position.set(0, 0, BREAK_Z);
  hullMeshGroup.add(sternGroup);

  const sternContent = new THREE.Group();
  sternContent.name = 'titanic_sternContent';
  sternContent.position.set(0, 0, -BREAK_Z);
  sternGroup.add(sternContent);

  const trackedMeshes: THREE.Mesh[] = [];
  const instancedSlots: InstancedSlot[] = [];
  const protoGeos: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const shadowCasters: THREE.Object3D[] = [];
  let uid = 0;
  const nextId = (prefix: string) => `${prefix}_${uid++}`;

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
  // WORLD-CLASS PBR MATERIALS (CALIBRATED ANISOTROPY & ZERO BLOOM/GLARE)
  // =========================================================================
  const mahoganyMat = trackMat(
    makePBR('titanic_mahogany', {
      albedoTex: textures.mahoganyAlbedo,
      roughnessTex: textures.mahoganyRoughness,
      roughness: 0.46,
      metallic: 0.04,
      envIntensity: 0.42,
      clearcoat: 0.25,
      clearcoatRoughness: 0.32,
    }),
  );

  // Brushed anisotropic marine brass — rich warm sheen without blinding circular specular orbs
  const brassMat = trackMat(
    makePBR('titanic_brass', {
      color: 0xc99c46,
      metallic: 0.82,
      roughness: 0.44,
      anisotropy: 0.65,
      envIntensity: 0.36,
    }),
  );

  const bronzeMat = trackMat(
    makePBR('titanic_bronze', {
      color: 0xb8863d,
      metallic: 0.84,
      roughness: 0.38,
      anisotropy: 0.55,
      envIntensity: 0.52,
    }),
  );

  const darkIronMat = trackMat(
    makePBR('titanic_darkIron', {
      color: 0x1a212b,
      metallic: 0.62,
      roughness: 0.52,
      envIntensity: 0.46,
    }),
  );

  const teakDeckMat = trackMat(
    makePBR('titanic_teak', {
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
    isBritannic
      ? makePBR('britannic_whiteHull', {
          color: 0xf1f4f7,
          bumpTex: textures.steelHullNormal,
          bumpLevel: 1.35,
          roughnessTex: textures.steelHullRoughness,
          roughness: 0.56,
          metallic: 0.14,
          doubleSided: true,
          envIntensity: 0.38,
        })
      : makePBR('titanic_steelHull', {
          color: 0xd4dce6,
          albedoTex: textures.steelHullAlbedo,
          bumpTex: textures.steelHullNormal,
          bumpLevel: 1.45,
          roughnessTex: textures.steelHullRoughness,
          roughness: 0.60,
          metallic: 0.20,
          doubleSided: true,
          envIntensity: 0.46,
        }),
  );

  const spruceMastMat = trackMat(
    makePBR('titanic_spruce', {
      color: 0xa6743c,
      roughness: 0.56,
      metallic: 0.04,
      envIntensity: 0.40,
    }),
  );

  const interiorMarbleMat = trackMat(
    makePBR('titanic_marble', {
      albedoTex: textures.interiorMarbleAlbedo,
      roughnessTex: textures.interiorMarbleRoughness,
      roughness: 0.48,
      metallic: 0.05,
      envIntensity: 0.40,
    }),
  );

  const interiorPanelMat = trackMat(
    makePBR('titanic_panel', {
      albedoTex: textures.interiorPanelAlbedo,
      roughness: 0.64,
      metallic: 0.04,
      doubleSided: true,
      envIntensity: 0.40,
    }),
  );

  const crimsonVelvetMat = trackMat(
    makePBR('titanic_velvet', {
      color: 0x6b1822,
      roughness: 0.88,
      metallic: 0.02,
      envIntensity: 0.30,
    }),
  );

  const linenClothMat = trackMat(
    makePBR('titanic_linen', {
      color: 0xeae4d6,
      roughness: 0.80,
      metallic: 0.02,
      envIntensity: 0.36,
    }),
  );

  const engineGreenMat = trackMat(
    makePBR('titanic_engGreen', {
      color: 0x1e3f35,
      roughness: 0.52,
      metallic: 0.44,
      envIntensity: 0.44,
    }),
  );

  const polishedSteelMat = trackMat(
    makePBR('titanic_polSteel', {
      color: 0xbcc5d0,
      roughness: 0.40,
      metallic: 0.82,
      anisotropy: 0.5,
      envIntensity: 0.48,
    }),
  );

  const antiFoulMat = trackMat(
    makePBR('titanic_antiFoul', {
      color: 0x681c1e,
      bumpTex: textures.steelHullNormal,
      bumpLevel: 0.85,
      roughnessTex: textures.steelHullRoughness,
      roughness: 0.68,
      metallic: 0.12,
      doubleSided: true,
      envIntensity: 0.38,
    }),
  );

  const whitePaintMat = trackMat(
    makePBR('titanic_whitePaint', {
      color: 0xe2ded4,
      roughness: 0.68,
      metallic: 0.03,
      envIntensity: 0.46,
    }),
  );

  const creamTrimMat = trackMat(
    makePBR('titanic_creamTrim', {
      color: 0xd4cdbc,
      roughness: 0.64,
      metallic: 0.04,
      envIntensity: 0.46,
    }),
  );

  const goldStripeMat = trackMat(
    makePBR('titanic_goldStripe', {
      color: isBritannic ? 0x1b7a4b : 0xc99c42,
      roughness: isBritannic ? 0.52 : 0.46,
      metallic: isBritannic ? 0.12 : 0.68,
      envIntensity: 0.40,
    }),
  );

  const hospitalGreenMat = trackMat(
    makePBR('britannic_hospitalGreen', {
      color: 0x1b7a4b,
      roughness: 0.52,
      metallic: 0.10,
      doubleSided: true,
      envIntensity: 0.36,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );

  // Textured White Star Line buff funnel enamel with rivet bands and soot patina
  const buffFunnelMat = trackMat(
    makePBR('titanic_buffFunnel', {
      color: 0xffffff,
      albedoTex: textures.buffFunnelAlbedo,
      bumpTex: textures.buffFunnelNormal,
      bumpLevel: 0.9,
      roughnessTex: textures.buffFunnelRoughness,
      roughness: 0.62,
      metallic: 0.04,
      envIntensity: 0.42,
    }),
  );

  // HMHS Britannic hospital ship funnels match the reference photo: continuous warm White Star buff all the way up with only subtle soot weathering on the top exhaust lip
  const britannicFunnelLipMat = trackMat(
    makePBR('britannic_sootFunnelLip', {
      color: 0x6f5c43,
      albedoTex: textures.buffFunnelAlbedo,
      bumpTex: textures.buffFunnelNormal,
      bumpLevel: 0.72,
      roughnessTex: textures.buffFunnelRoughness,
      roughness: 0.74,
      metallic: 0.04,
      envIntensity: 0.34,
    }),
  );
  const funnelBandMat = isBritannic ? buffFunnelMat : darkIronMat;
  const funnelLipMat = isBritannic ? britannicFunnelLipMat : darkIronMat;

  const pipeLaggingMat = trackMat(
    makePBR('titanic_pipeLagging', {
      color: 0xd9d2c2,
      roughness: 0.70,
      metallic: 0.06,
      envIntensity: 0.38,
    }),
  );

  const ventThroatMat = trackMat(
    makePBR('titanic_ventThroat', {
      color: 0x7e1d1d,
      roughness: 0.76,
      metallic: 0.04,
      doubleSided: true,
      envIntensity: 0.32,
    }),
  );

  const bridgeGlassMat = trackMat(
    makePBR('titanic_bridgeGlass', {
      color: 0xb4cde0,
      metallic: 0.04,
      roughness: 0.26,
      alpha: 0.12,
      doubleSided: true,
      envIntensity: 0.20,
    }),
  );

  const warmGlowMat = trackMat(
    makePBR('titanic_warmGlow', {
      color: 0xe6cfa0,
      emissive: 0xffad48,
      emissiveIntensity: 0.12,
      roughness: 0.42,
      metallic: 0.05,
      envIntensity: 0.32,
    }),
  );

  const portholeGlowMat = trackMat(
    makePBR('titanic_portholeGlow', {
      color: 0x1c2630,
      emissive: 0xffb454,
      emissiveIntensity: 0.0,
      roughness: 0.36,
      metallic: 0.08,
      envIntensity: 0.30,
    }),
  );

  const portLightMat = trackMat(
    makePBR('titanic_portLight', {
      color: 0xff3b3b,
      emissive: 0xdc2626,
      emissiveIntensity: 1.2,
      roughness: 0.32,
      envIntensity: 0.28,
    }),
  );

  const starboardLightMat = trackMat(
    makePBR('titanic_stbdLight', {
      color: 0x34d399,
      emissive: 0x10b981,
      emissiveIntensity: 1.2,
      roughness: 0.32,
      envIntensity: 0.28,
    }),
  );

  // =========================================================================
  // 1. TRUE 269.1m x 28m LOFTED HULL (SPLIT AT BREAK_Z = 90) + RUDDER + PROPS
  // =========================================================================
  const fwdHullZStations = [
    -74, -73.7, -73.2, -72.2, -70.5, -68, -64, -58, -51, -43, -35.06, -34.94, -26, -18, -10.06, -9.94, 6, 26, 46, 66, 86, BREAK_Z,
  ];
  const aftHullZStations = [
    BREAK_Z, 106, 126, 136, 147.94, 148.06, 159, 169.94, 170.06, 178, 184, 188, 191, 193.2, 194.4, 195.1,
  ];

  const fwdSheerSegments: { tag: string; zList: number[] }[] = [
    { tag: 'fc', zList: [-74, -73.2, -71.5, -68, -63, -57, -50, -42, -35.06] },
    { tag: 'fw', zList: [-34.94, -26, -18, -10.06] },
    { tag: 'fb', zList: [-9.94, 6, 26, 46, 66, 86, BREAK_Z] },
  ];
  const aftSheerSegments: { tag: string; zList: number[] }[] = [
    { tag: 'ab', zList: [BREAK_Z, 106, 126, 136, 147.94] },
    { tag: 'aw', zList: [148.06, 159, 169.94] },
    { tag: 'ap', zList: [170.06, 178, 184, 188.5, 191.5, 193.5, 194.6, 195.1] },
  ];

  for (const [label, stations, sheerSegs, targetGrp] of [
    ['fwd', fwdHullZStations, fwdSheerSegments, bowContent],
    ['aft', aftHullZStations, aftSheerSegments, sternContent],
  ] as const) {
    const upperHull = trackMesh(
      buildLoftedHullSection(`hullUpper_${label}`, stations, 8, 0.36, 1.0, beamScale),
      targetGrp,
      true,
    );
    upperHull.material = steelHullMat;

    const lowerHull = trackMesh(
      buildLoftedHullSection(`hullLower_${label}`, stations, 5, 0.0, 0.37, beamScale),
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
          const { beam, sheerY, flareFactor } = sampleHullStation(z, beamScale);
          const stemU = MathUtils.clamp((-64.0 - z) / 10.0, 0, 1);
          const bowRakeTop = -0.45 * stemU;
          const xTop = side * (beam * (1 + flareFactor) + 0.025);
          stripePts.push(new THREE.Vector3(xTop, sheerY - 0.14, z + bowRakeTop));
          const xStrake = side * (beam * (1 + flareFactor * 0.94) + 0.03);
          strakePts.push(new THREE.Vector3(xStrake, sheerY - 0.62, z + bowRakeTop * 0.93));
        }
        if (!isBritannic) {
          const stripe = trackMesh(
            buildTubeMesh(`goldStripe_${label}_${seg.tag}_${side}`, stripePts, 28, 0.048, 6, true),
            targetGrp,
          );
          stripe.material = goldStripeMat;
        }

        const rubbingStrake = trackMesh(
          buildTubeMesh(`rubStrake_${label}_${seg.tag}_${side}`, strakePts, 28, 0.075, 6, true),
          targetGrp,
        );
        rubbingStrake.material = darkIronMat;
      }

      if (isBritannic) {
        // Continuous Emerald-Green Hospital Ship Band conforming along the white hull sheer
        const bandZ = label === 'fwd'
          ? [-70, -64, -56, -46, -35, -24, -10, 6, 26, 48, 70, BREAK_Z]
          : [BREAK_Z, 108, 126, 144, 158, 172, 184, 191];
        const bPos: number[] = [];
        const bUvs: number[] = [];
        const bIdx: number[] = [];
        for (let zi = 0; zi < bandZ.length; zi++) {
          const z = bandZ[zi];
          const { beam, sheerY, flareFactor } = sampleHullStation(z, beamScale);
          const yKeel = sampleKeelY(z);
          const yBot = Math.max(1.25, sheerY - 2.65);
          const yTop = Math.max(yBot + 0.85, sheerY - 1.35);
          const u = zi / Math.max(1, bandZ.length - 1);
          for (let yi = 0; yi < 2; yi++) {
            const y = yi === 0 ? yBot : yTop;
            const frac = MathUtils.clamp((y - yKeel) / Math.max(0.35, sheerY - yKeel), 0, 1);
            let wr: number;
            if (frac < 0.28) {
              wr = Math.sin(((frac / 0.28) * Math.PI) / 2) * 0.88;
            } else {
              const up = (frac - 0.28) / 0.72;
              wr = 0.88 + up * 0.12 + up * up * flareFactor;
            }
            if (z > 180) {
              const sternU = MathUtils.clamp((z - 180) / 15.1, 0, 1);
              wr *= 1.0 - sternU * 0.08 * (1.0 - frac);
            }
            bPos.push(side * (beam * wr + 0.055), y, z);
            bUvs.push(u * 8, yi);
          }
        }
        for (let zi = 0; zi < bandZ.length - 1; zi++) {
          const a = zi * 2;
          const b = (zi + 1) * 2;
          const c = (zi + 1) * 2 + 1;
          const d = zi * 2 + 1;
          if (side > 0) bIdx.push(a, b, d, b, c, d);
          else bIdx.push(a, d, b, b, d, c);
        }
        const bandGeo = new THREE.BufferGeometry();
        bandGeo.setAttribute('position', new THREE.Float32BufferAttribute(bPos, 3));
        bandGeo.setAttribute('uv', new THREE.Float32BufferAttribute(bUvs, 2));
        bandGeo.setIndex(bIdx);
        bandGeo.computeVertexNormals();
        const bandMesh = trackMesh(new THREE.Mesh(bandGeo, hospitalGreenMat), targetGrp);
        bandMesh.name = `britBand_${label}_${side}`;
      }
    }
  }

  // Crisp white hull draft gauge markings along bow stem & sternpost
  for (let di = 0; di < 6; di++) {
    const bowMark = trackMesh(buildBox(nextId('bowDraft'), 0.22, 0.14, 0.42), bowContent);
    bowMark.material = whitePaintMat;
    bowMark.position.set(0, -3.6 + di * 0.72, -73.4 - di * 0.06);

    const sternMark = trackMesh(buildBox(nextId('sternDraft'), 0.36, 0.14, 0.42), sternContent);
    sternMark.material = whitePaintMat;
    sternMark.position.set(0, -3.5 + di * 0.72, 188.45);
  }

  // Sculpted Sternpost Skeg, Balanced Rudder & Triple Propellers
  const skegShape = new Shape2D();
  skegShape.moveTo(168.0, -6.5);
  skegShape.lineTo(185.0, -5.0);
  skegShape.lineTo(188.6, -5.0);
  skegShape.lineTo(188.6, -3.5);
  skegShape.lineTo(184.5, -2.0);
  skegShape.lineTo(189.5, 0.2);
  skegShape.lineTo(185.0, 0.5);
  skegShape.lineTo(168.0, -4.0);
  skegShape.closePath();
  const skegMesh = trackMesh(buildExtrudedShapeMesh('sternSkeg', skegShape, 0.44, 0), sternContent);
  skegMesh.rotation.y = Math.PI / 2;
  bakeTransform(skegMesh);
  skegMesh.material = antiFoulMat;
  skegMesh.position.set(-0.22, 0, 0);

  const rudderShape = new Shape2D();
  rudderShape.moveTo(0, -5.0);
  rudderShape.lineTo(3.1, -4.7);
  rudderShape.quadraticCurveTo(3.5, -2.4, 3.2, 0.25, 10);
  rudderShape.lineTo(0, 0.45);
  rudderShape.closePath();
  const sternRudder = trackMesh(buildExtrudedShapeMesh('sternRudder', rudderShape, 0.34, 0.06), sternContent);
  sternRudder.rotation.y = -Math.PI / 2;
  bakeTransform(sternRudder);
  sternRudder.material = antiFoulMat;
  sternRudder.position.set(0.17, 0, 188.7);

  const centerProp = buildPropellerGroup('centerProp', trackMesh, trackProtoGeo, bronzeMat, 4, 1.85);
  sternContent.add(centerProp);
  centerProp.position.set(0, -2.65, 186.6);

  for (const side of [-1, 1]) {
    const wingProp = buildPropellerGroup(`wingProp_${side}`, trackMesh, trackProtoGeo, bronzeMat, 3, 2.45);
    sternContent.add(wingProp);
    wingProp.position.set(side * 4.25, -2.45, 183.4);

    const boss = trackMesh(buildCylinder(nextId('boss'), 0.32, 0.52, 12.2, 10), sternContent);
    boss.material = antiFoulMat;
    setEulerXYZ(boss, Math.PI / 2, 0, side * -0.15);
    boss.position.set(side * 3.1, -2.3, 177.8);

    const aStrut = trackMesh(buildBox(nextId('aStrut'), 2.6, 0.28, 0.65), sternContent);
    aStrut.material = antiFoulMat;
    aStrut.position.set(side * 2.45, -1.8, 182.8);
    aStrut.rotation.z = side * 0.32;
  }

  // =========================================================================
  // 2. FORECASTLE, FORWARD WELL DECK, SHELTER DECK, AFT WELL & POOP DECKS
  // =========================================================================
  const forecastleTeak = trackMesh(
    buildLoftedWeatherDeck('forecastleTeak', [-74, -73.2, -71.5, -68, -64, -56, -48, -40, -35.06], 0.05, 0.45, -0.02, beamScale),
    bowContent,
  );
  forecastleTeak.material = teakDeckMat;

  const forecastleBreak = trackMesh(
    buildCurvedDeckhouseMesh('forecastleBreak', 12.2 * beamScale, -35.6, -34.7, 2.95, 0.15, 0.08, 0),
    bowContent,
  );
  forecastleBreak.material = whitePaintMat;
  forecastleBreak.position.y = 6.35;

  const fwdWellDeck = trackMesh(
    buildLoftedWeatherDeck('fwdWellDeck', [-34.94, -30, -24, -17, -10.5, -10.06], 0.06, 0.42, -0.02, beamScale),
    bowContent,
  );
  fwdWellDeck.material = teakDeckMat;

  const fwdShelterFore = trackMesh(
    buildLoftedWeatherDeck('fwdShelterFore', [-9.94, 10, 27.6], 0.04, 0.45, 0.0, beamScale),
    bowContent,
  );
  fwdShelterFore.material = teakDeckMat;

  const fwdShelterAft = trackMesh(
    buildLoftedWeatherDeck('fwdShelterAft', [39.0, 65, BREAK_Z + 0.02], 0.04, 0.45, 0.0, beamScale),
    bowContent,
  );
  fwdShelterAft.material = teakDeckMat;

  for (const side of [-1, 1] as const) {
    const stairCWing = trackMesh(buildBox(nextId('stairCWing'), 8.5, 0.44, 11.8), bowContent);
    stairCWing.material = teakDeckMat;
    stairCWing.position.set(side * 9.85, 6.62, 33.3);
  }

  const aftShelterForeBand = trackMesh(
    buildLoftedWeatherDeck('aftShelterForeBand', [BREAK_Z - 0.02, 93.6], 0.04, 0.45, 0.0, beamScale),
    sternContent,
  );
  aftShelterForeBand.material = teakDeckMat;

  const aftShelterAft = trackMesh(
    buildLoftedWeatherDeck('aftShelterAft', [122.0, 134, 144, 147.94], 0.04, 0.45, 0.0, beamScale),
    sternContent,
  );
  aftShelterAft.material = teakDeckMat;

  for (const side of [-1, 1] as const) {
    const engCWing = trackMesh(buildBox(nextId('engCWing'), 4.9, 0.44, 28.6), sternContent);
    engCWing.material = teakDeckMat;
    engCWing.position.set(side * 11.65, 6.62, 107.8);
  }

  const fwdBridgeBreak = trackMesh(
    buildCurvedDeckhouseMesh('fwdBridgeBreak', 13.8 * beamScale, -10.2, -6.2, 3.15, 0.8, 0.1, 0),
    bowContent,
  );
  fwdBridgeBreak.material = whitePaintMat;
  fwdBridgeBreak.position.y = 6.5;

  const aftBridgeBreak = trackMesh(
    buildCurvedDeckhouseMesh('aftBridgeBreak', 13.2 * beamScale, 143.5, 148.2, 3.15, 0.1, 0.9, 0),
    sternContent,
  );
  aftBridgeBreak.material = whitePaintMat;
  aftBridgeBreak.position.y = 6.5;

  const aftWellDeck = trackMesh(
    buildLoftedWeatherDeck('aftWellDeck', [148.06, 153, 159, 165, 169.94], 0.06, 0.42, -0.02, beamScale),
    sternContent,
  );
  aftWellDeck.material = teakDeckMat;

  const poopBreak = trackMesh(
    buildCurvedDeckhouseMesh('poopBreak', 10.6 * beamScale, 169.6, 170.5, 2.25, 0.08, 0.15, 0),
    sternContent,
  );
  poopBreak.material = whitePaintMat;
  poopBreak.position.y = 6.35;

  const poopDeck = trackMesh(
    buildLoftedWeatherDeck('poopDeck', [170.06, 175, 180, 185, 188.5, 191.2, 193.3, 194.4, 195.1], 0.06, 0.44, -0.02, beamScale),
    sternContent,
  );
  poopDeck.material = teakDeckMat;

  // Aft Docking Bridge on Poop Deck
  const aftDockDeck = trackMesh(
    buildCurvedDeckhouseMesh('aftDockDeck', 7.6, 171.6, 173.4, 0.24, 0.2, 0.2, 0.03),
    sternContent,
  );
  aftDockDeck.material = teakDeckMat;
  aftDockDeck.position.y = 10.28;
  for (const sx of [-6.8, -3.0, 3.0, 6.8]) {
    const leg = trackMesh(buildCylinder(nextId('aftLeg'), 0.11, 0.14, 2.05, 8), sternContent);
    leg.material = whitePaintMat;
    leg.position.set(sx, 9.28, 172.5);
  }
  const aftHelmPed = trackMesh(buildCylinder('aftHelmPed', 0.14, 0.22, 0.92, 12), sternContent);
  aftHelmPed.material = mahoganyMat;
  aftHelmPed.position.set(0, 10.96, 172.5);
  const aftHelmWheel = trackMesh(buildTorusXY('aftHelmWheel', 0.32, 0.04, 8, 20), sternContent);
  aftHelmWheel.material = mahoganyMat;
  aftHelmWheel.position.set(0, 11.42, 172.34);
  const aftHelmHub = trackMesh(buildCylinder('aftHelmHub', 0.06, 0.06, 0.14, 10), sternContent);
  aftHelmHub.material = brassMat;
  aftHelmHub.rotation.x = Math.PI / 2;
  aftHelmHub.position.set(0, 11.42, 172.34);
  for (let si = 0; si < 4; si++) {
    const sp = trackMesh(buildCylinder(nextId('aftSpoke'), 0.015, 0.015, 0.64, 6), sternContent);
    sp.material = brassMat;
    sp.position.set(0, 11.42, 172.34);
    sp.rotation.z = (si * Math.PI) / 4;
  }
  const aftBinnacle = trackMesh(buildCylinder('aftBinnacle', 0.12, 0.16, 0.96, 12), sternContent);
  aftBinnacle.material = brassMat;
  aftBinnacle.position.set(-1.1, 10.98, 172.3);
  for (const dz of [-0.82, 0.82]) {
    const aftBridgeRail = trackMesh(buildCylinder(nextId('aftBRail'), 0.04, 0.04, 15.0, 8), sternContent);
    aftBridgeRail.material = whitePaintMat;
    aftBridgeRail.rotation.z = Math.PI / 2;
    aftBridgeRail.position.set(0, 11.35, 172.5 + dz);
  }
  for (const ax of [-7.4, -3.7, 3.7, 7.4]) {
    for (const dz of [-0.82, 0.82]) {
      const aftPost = trackMesh(buildCylinder(nextId('aftPost'), 0.04, 0.04, 0.88, 6), sternContent);
      aftPost.material = whitePaintMat;
      aftPost.position.set(ax, 10.92, 172.5 + dz);
    }
  }

  // Turned Lathe Steam Capstans, Linked Chains & Bow Anchor Crane
  const capstanLathe = buildLatheMesh(
    'capstanProto',
    [
      new THREE.Vector2(0.85, 0),
      new THREE.Vector2(0.82, 0.2),
      new THREE.Vector2(0.52, 0.48),
      new THREE.Vector2(0.48, 0.82),
      new THREE.Vector2(0.7, 1.1),
      new THREE.Vector2(0.65, 1.24),
      new THREE.Vector2(0, 1.28),
    ],
    18,
  );
  capstanLathe.material = darkIronMat;
  trackProtoGeo(capstanLathe.geometry);
  for (let i = 0; i < 2; i++) {
    const cx = i === 0 ? -3.4 : 3.4;
    const capstan = trackMesh(
      i === 0 ? capstanLathe : cloneMeshWithMaterial(capstanLathe, `capstan_${i}`, darkIronMat),
      bowContent,
      true,
    );
    capstan.position.set(cx, 9.2, -55.0);

    const brassCap = trackMesh(buildCylinder(nextId('capBrass'), 0.55, 0.64, 0.14, 16), bowContent);
    brassCap.material = brassMat;
    brassCap.position.set(cx, 10.5, -55.0);
  }

  // Linked Anchor Chains (InstancedMesh)
  const chainProto = buildTorusXY('anchorChain', 0.13, 0.042, 6, 12);
  const chainSlot = makeSlot('anchorChain', chainProto, darkIronMat, 84, bowContent);
  let cIdx = 0;
  for (const side of [-1, 1]) {
    for (let li = 0; li < 42; li++) {
      const t = li / 41;
      writeInstanceMatrix(
        chainSlot,
        cIdx++,
        MathUtils.lerp(side * 3.1, side * 1.4, t),
        9.26,
        MathUtils.lerp(-55.5, -67.5, t),
        li % 2 === 0 ? Math.PI / 2 : 0.2,
        0.14 * side,
        0,
      );
    }
  }
  commitInstanceMatrices(chainSlot, cIdx);

  // Curved Gooseneck Anchor Crane + Cable + Spare Stockless Anchor
  const anchorCrane = trackMesh(
    buildTubeMesh(
      'anchorCrane',
      [
        new THREE.Vector3(0, 9.2, -66.2),
        new THREE.Vector3(0, 12.0, -66.3),
        new THREE.Vector3(0, 13.3, -67.3),
        new THREE.Vector3(0, 13.7, -69.5),
        new THREE.Vector3(0, 13.4, -70.8),
      ],
      18,
      0.22,
      10,
      true,
    ),
    bowContent,
  );
  anchorCrane.material = whitePaintMat;
  const craneCable = trackMesh(buildCylinder('craneCable', 0.028, 0.028, 2.8, 6), bowContent);
  craneCable.material = darkIronMat;
  craneCable.position.set(0, 12.0, -70.8);

  const buildAnchorGroup = (label: string): THREE.Group => {
    const aGrp = new THREE.Group();
    aGrp.name = label;
    const shank = trackMesh(
      buildLatheMesh(
        `${label}_shank`,
        [
          new THREE.Vector2(0.13, 0),
          new THREE.Vector2(0.16, 0.9),
          new THREE.Vector2(0.11, 1.85),
          new THREE.Vector2(0.19, 2.05),
        ],
        10,
      ),
      aGrp,
    );
    shank.material = darkIronMat;
    shank.position.y = -0.9;

    const crownShape = new Shape2D();
    crownShape.moveTo(-0.82, 0.4);
    crownShape.quadraticCurveTo(-0.6, -0.28, 0, -0.36, 8);
    crownShape.quadraticCurveTo(0.6, -0.28, 0.82, 0.4, 8);
    crownShape.lineTo(0.52, 0.48);
    crownShape.quadraticCurveTo(0.36, -0.02, 0, -0.06, 6);
    crownShape.quadraticCurveTo(-0.36, -0.02, -0.52, 0.48, 6);
    crownShape.closePath();
    const crown = trackMesh(buildExtrudedShapeMesh(`${label}_crown`, crownShape, 0.25, 0.045), aGrp);
    crown.material = darkIronMat;
    crown.position.set(0, -0.78, -0.125);
    return aGrp;
  };

  for (const side of [-1, 1]) {
    const { beam, sheerY, flareFactor } = sampleHullStation(-65);
    const yHawse = sheerY - 2.05;
    const yKeelHawse = sampleKeelY(-65);
    const hullFracHawse = MathUtils.clamp((yHawse - yKeelHawse) / Math.max(0.35, sheerY - yKeelHawse), 0, 1);
    const upHawse = (hullFracHawse - 0.28) / 0.72;
    const xHullHawse = beam * (0.88 + upHawse * 0.12 + upHawse * upHawse * flareFactor);

    // Dark recessed steel hawsepipe pocket & flush bolster collar
    const hawsePocket = trackMesh(buildCylinder(nextId('hawsePocket'), 0.56, 0.64, 0.48, 14), bowContent);
    hawsePocket.material = darkIronMat;
    setEulerXYZ(hawsePocket, 0, -side * 0.32, Math.PI / 2);
    hawsePocket.position.set(side * (xHullHawse - 0.14), yHawse, -65);

    const bolsterPlate = trackMesh(buildCylinder(nextId('bolster'), 0.84, 0.94, 0.24, 16), bowContent);
    bolsterPlate.material = darkIronMat;
    setEulerXYZ(bolsterPlate, 0, -side * 0.32, Math.PI / 2);
    bolsterPlate.position.set(side * (xHullHawse + 0.02), yHawse, -65);

    const hawseRing = trackMesh(buildTorusXY(nextId('hawse'), 0.54, 0.13, 8, 16), bowContent);
    hawseRing.material = darkIronMat;
    hawseRing.rotation.y = Math.PI / 2 - side * 0.32;
    hawseRing.position.set(side * (xHullHawse + 0.09), yHawse, -65);

    // Bower anchor tucked snugly flush into the bolster recess
    const anchor = buildAnchorGroup(`anchor_${side}`);
    bowContent.add(anchor);
    anchor.position.set(side * (xHullHawse + 0.16), yHawse - 0.34, -65);
    anchor.rotation.y = Math.PI / 2 - side * 0.32;
    anchor.rotation.z = side * 0.08;
  }

  // Historical 3rd centerline bow stemhead hawse chock & cast-iron roller
  const centerHawseChock = trackMesh(buildBox('centerHawseChock', 1.12, 0.52, 0.95), bowContent);
  centerHawseChock.material = darkIronMat;
  centerHawseChock.position.set(0, 9.42, -73.45);
  const centerHawseRing = trackMesh(buildTorusXY('centerHawseRing', 0.38, 0.11, 8, 16), bowContent);
  centerHawseRing.material = darkIronMat;
  centerHawseRing.position.set(0, 9.42, -73.92);

  // V-shaped curved steel forecastle wave-breakwater ahead of forward hatches
  for (const side of [-1, 1] as const) {
    const bwArm = trackMesh(buildBox(nextId('breakwater'), 8.2, 0.98, 0.16), bowContent);
    bwArm.material = whitePaintMat;
    bwArm.position.set(side * 3.88, 9.65, -46.2);
    bwArm.rotation.y = -side * 0.36;

    const bwCap = trackMesh(buildBox(nextId('bwCap'), 8.24, 0.12, 0.24), bowContent);
    bwCap.material = teakDeckMat;
    bwCap.position.set(side * 3.88, 10.16, -46.2);
    bwCap.rotation.y = -side * 0.36;

    for (let bi = 1; bi <= 3; bi++) {
      const bf = bi * 2.2;
      const brace = trackMesh(buildBox(nextId('bwBrace'), 0.12, 0.84, 0.65), bowContent);
      brace.material = whitePaintMat;
      brace.position.set(side * bf * Math.cos(0.36), 9.58, -47.4 + bf * Math.sin(0.36) + 0.4);
      brace.rotation.y = -side * 0.36;
    }
  }

  const spareAnchor = buildAnchorGroup('spareAnchor');
  bowContent.add(spareAnchor);
  spareAnchor.rotation.x = Math.PI / 2;
  spareAnchor.position.set(0, 9.38, -64.0);

  // Cargo Hatches & 8 Electric Luffing Cargo Cranes
  for (const hz of [-28.5, -18.0, 155.0, 163.5]) {
    const parentGrp = hz < BREAK_Z ? bowContent : sternContent;
    const hatchCoaming = trackMesh(
      buildCurvedDeckhouseMesh(nextId('hatchCoam'), 3.2, hz - 2.6, hz + 2.6, 0.85, 0.22, 0.22, 0.06),
      parentGrp,
    );
    hatchCoaming.material = whitePaintMat;
    hatchCoaming.position.y = 6.55;

    const hatchCover = trackMesh(
      buildCurvedDeckhouseMesh(nextId('hatchCov'), 2.95, hz - 2.4, hz + 2.4, 0.22, 0.16, 0.16, 0.05),
      parentGrp,
    );
    hatchCover.material = teakDeckMat;
    hatchCover.position.y = 7.42;
  }

  const craneBoomPts = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 3.6, 0),
    new THREE.Vector3(0, 5.2, 1.45),
    new THREE.Vector3(0, 5.8, 3.85),
  ];
  const craneBoomProto = buildTubeMesh('craneBoomProto', craneBoomPts, 12, 0.16, 8, true);
  craneBoomProto.material = whitePaintMat;
  trackProtoGeo(craneBoomProto.geometry);

  const cranePedProto = buildCylinder('cranePedProto', 0.36, 0.48, 1.4, 10);
  cranePedProto.material = whitePaintMat;
  trackProtoGeo(cranePedProto.geometry);

  const craneSheaveProto = buildCylinder('craneSheaveProto', 0.18, 0.18, 0.1, 10);
  craneSheaveProto.rotation.z = Math.PI / 2;
  bakeTransform(craneSheaveProto);
  craneSheaveProto.material = darkIronMat;
  trackProtoGeo(craneSheaveProto.geometry);

  const craneCableProto = buildCylinder('craneCableProto', 0.025, 0.025, 3.6, 6);
  craneCableProto.material = darkIronMat;
  trackProtoGeo(craneCableProto.geometry);

  const craneSpots = [
    [-7.2, 6.6, -24.5, -0.45],
    [7.2, 6.6, -24.5, 0.45],
    [-7.6, 6.6, -14.2, -0.55],
    [7.6, 6.6, -14.2, 0.55],
    [-7.2, 6.6, 152.0, 2.6],
    [7.2, 6.6, 152.0, -2.6],
    [-6.6, 6.6, 165.5, 2.75],
    [6.6, 6.6, 165.5, -2.75],
  ];
  craneSpots.forEach(([cx, cy, cz, ry], idx) => {
    const crGrp = new THREE.Group();
    crGrp.name = `cargoCrane_${idx}`;
    (cz < BREAK_Z ? bowContent : sternContent).add(crGrp);
    crGrp.position.set(cx, cy, cz);
    crGrp.rotation.y = ry;
    const ped = trackMesh(
      idx === 0 ? cranePedProto : cloneMeshWithMaterial(cranePedProto, `cranePed_${idx}`, whitePaintMat),
      crGrp,
    );
    ped.position.y = 0.7;
    const boom = trackMesh(
      idx === 0 ? craneBoomProto : cloneMeshWithMaterial(craneBoomProto, `craneBoom_${idx}`, whitePaintMat),
      crGrp,
    );
    const sheave = trackMesh(
      idx === 0 ? craneSheaveProto : cloneMeshWithMaterial(craneSheaveProto, `craneSheave_${idx}`, darkIronMat),
      crGrp,
    );
    sheave.position.set(0, 5.8, 3.85);
    const hoistCable = trackMesh(
      idx === 0 ? craneCableProto : cloneMeshWithMaterial(craneCableProto, `craneCab_${idx}`, darkIronMat),
      crGrp,
    );
    hoistCable.position.set(0, 4.0, 3.85);
    void boom;
  });

  // Turned Goose-Neck Cowl Ventilators along Decks
  const cowlBellProto = buildLatheMesh(
    'cowlBellProto',
    [
      new THREE.Vector2(0.28, 0),
      new THREE.Vector2(0.28, 0.28),
      new THREE.Vector2(0.44, 0.62),
      new THREE.Vector2(0.64, 0.82),
      new THREE.Vector2(0.56, 0.86),
      new THREE.Vector2(0.32, 0.52),
      new THREE.Vector2(0.2, 0.12),
    ],
    16,
  );
  cowlBellProto.material = ventThroatMat;
  trackProtoGeo(cowlBellProto.geometry);

  const cowlNeckProto = buildTubeMesh(
    'cowlNeckProto',
    [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.95, 0), new THREE.Vector3(0, 1.5, -0.4)],
    10,
    0.24,
    10,
    true,
  );
  cowlNeckProto.material = whitePaintMat;
  trackProtoGeo(cowlNeckProto.geometry);

  const ventSpots = [
    [-7.8, 6.6, -31, 0],
    [7.8, 6.6, -31, 0],
    [-8.2, 6.6, -15, Math.PI],
    [8.2, 6.6, -15, Math.PI],
    [-6.2, 12.88, 40.2, 0],
    [6.2, 12.88, 40.2, 0],
    [-5.2, 12.88, 56.0, Math.PI],
    [5.2, 12.88, 56.0, Math.PI],
    [-5.2, 12.88, 86.0, 0],
    [5.2, 12.88, 86.0, 0],
    [-5.2, 12.88, 115.0, Math.PI],
    [5.2, 12.88, 115.0, Math.PI],
    [-7.5, 6.6, 159, 0],
    [7.5, 6.6, 159, 0],
  ];
  ventSpots.forEach(([vx, vy, vz, rotY], idx) => {
    const vGrp = new THREE.Group();
    vGrp.name = `vent_${idx}`;
    (vz < BREAK_Z ? bowContent : sternContent).add(vGrp);
    vGrp.position.set(vx, vy, vz);
    vGrp.rotation.y = rotY;
    trackMesh(
      idx === 0 ? cowlNeckProto : cloneMeshWithMaterial(cowlNeckProto, `cowlNeck_${idx}`, whitePaintMat),
      vGrp,
    );
    const bell = trackMesh(
      idx === 0 ? cowlBellProto : cloneMeshWithMaterial(cowlBellProto, `cowlBell_${idx}`, ventThroatMat),
      vGrp,
    );
    bell.rotation.x = -Math.PI / 2;
    bell.position.set(0, 1.5, -0.4);
  });

  // White Turned Railings along Forecastle, Forward Well Deck, Aft Well Deck & Poop Deck
  const buildRailSegment = (
    targetGrp: THREE.Object3D,
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
  ) => {
    for (const barOff of [0.38, 0.72, 1.04]) {
      const rail = trackMesh(
        buildTubeMesh(
          nextId('railBar'),
          [new THREE.Vector3(x1, y1 + barOff, z1), new THREE.Vector3(x2, y2 + barOff, z2)],
          1,
          0.04,
          6,
          false,
        ),
        targetGrp,
      );
      rail.material = barOff > 0.95 ? teakDeckMat : whitePaintMat;
    }
  };

  const addHullEdgeRail = (targetGrp: THREE.Object3D, zList: number[]) => {
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < zList.length; i++) {
        const z = zList[i];
        const { beam, sheerY, flareFactor } = sampleHullStation(z, beamScale);
        const rx = side * Math.max(0, beam * (1 + flareFactor) - 0.16);
        const ry = sheerY + 0.06;
        const stemU = MathUtils.clamp((-64.0 - z) / 10.0, 0, 1);
        const rz = z - 0.45 * stemU;
        const post = trackMesh(buildCylinder(nextId('rPost'), 0.052, 0.052, 1.08, 8), targetGrp);
        post.material = whitePaintMat;
        post.position.set(rx, ry + 0.52, rz);
        if (i < zList.length - 1) {
          const nz = zList[i + 1];
          const next = sampleHullStation(nz, beamScale);
          const nrx = side * Math.max(0, next.beam * (1 + next.flareFactor) - 0.16);
          const nry = next.sheerY + 0.06;
          const nStemU = MathUtils.clamp((-64.0 - nz) / 10.0, 0, 1);
          const nrz = nz - 0.45 * nStemU;
          buildRailSegment(targetGrp, rx, ry, rz, nrx, nry, nrz);
        }
      }
    }
  };
  addHullEdgeRail(bowContent, [-74.0, -72.8, -70.5, -66.0, -58.0]);
  addHullEdgeRail(sternContent, [170.5, 178.0, 184.5, 189.0, 192.2, 194.1, 195.0]);

  const addHullBulwark = (targetGrp: THREE.Object3D, zList: number[], height = 1.06) => {
    const wallH = height - 0.08;
    for (const side of [-1, 1] as const) {
      const outerPos: number[] = [];
      const outerIdx: number[] = [];
      const innerPos: number[] = [];
      const innerIdx: number[] = [];
      const railPts: THREE.Vector3[] = [];
      for (let i = 0; i < zList.length; i++) {
        const z = zList[i];
        const { beam, sheerY, flareFactor } = sampleHullStation(z);
        const rx = side * Math.max(0.2, beam * (1 + flareFactor) - 0.04);
        const rxIn = side * Math.max(0.1, Math.abs(rx) - 0.12);
        const yBot = sheerY - 0.05;
        const yTop = sheerY + wallH;
        outerPos.push(rx, yBot, z, rx, yTop, z);
        innerPos.push(rxIn, yBot, z, rxIn, yTop, z);
        railPts.push(new THREE.Vector3((rx + rxIn) * 0.5, yTop + 0.04, z));
        if (i < zList.length - 1) {
          const a = i * 2;
          const b = (i + 1) * 2;
          if (side > 0) {
            outerIdx.push(a, a + 1, b, b, a + 1, b + 1);
            innerIdx.push(a, b, a + 1, b, b + 1, a + 1);
          } else {
            outerIdx.push(a, b, a + 1, b, b + 1, a + 1);
            innerIdx.push(a, a + 1, b, b, a + 1, b + 1);
          }
        }
      }
      const makeWall = (pos: number[], idx: number[], mat: THREE.Material) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setIndex(idx);
        geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, mat);
        m.name = nextId('bulwark');
        trackMesh(m, targetGrp);
      };
      makeWall(outerPos, outerIdx, steelHullMat);
      makeWall(innerPos, innerIdx, whitePaintMat);

      const cap = trackMesh(buildTubeMesh(nextId('bulwarkCap'), railPts, zList.length * 4, 0.07, 6, true), targetGrp);
      cap.material = teakDeckMat;
    }
  };
  addHullBulwark(bowContent, [-58, -50, -42, -35.2], 1.04);
  addHullBulwark(bowContent, [-34.6, -26, -18, -10.5], 1.12);
  addHullBulwark(sternContent, [148.5, 155, 162, 169.5], 1.12);

  // =========================================================================
  // 3. 158-METER MULTI-TIER SUPERSTRUCTURE (HOLLOW AROUND ACCESSIBLE INTERIORS)
  // =========================================================================
  for (const [z0, z1, bc, ac, bv, tgt] of [
    [-10.0, 27.55, 3.0, 0.0, 0.0, bowContent],
    [38.95, BREAK_Z + 0.02, 0.0, 0.0, 0.0, bowContent],
    [BREAK_Z - 0.02, 93.55, 0.0, 0.0, 0.0, sternContent],
    [121.95, 148.0, 0.0, 4.0, 0.0, sternContent],
  ] as const) {
    const bSeg = trackMesh(
      buildCurvedDeckhouseMesh(nextId('bSeg'), 13.45, z0, z1, 2.9, bc, ac, bv),
      tgt,
      true,
    );
    bSeg.material = whitePaintMat;
    bSeg.position.y = 6.72;
  }
  for (const side of [-1, 1] as const) {
    const bStairWing = trackMesh(buildBox(nextId('bStairW'), 7.85, 2.9, 11.55), bowContent);
    bStairWing.material = whitePaintMat;
    bStairWing.position.set(side * 9.52, 8.17, 33.25);

    const bEngWing = trackMesh(buildBox(nextId('bEngW'), 4.25, 2.9, 28.5), sternContent);
    bEngWing.material = whitePaintMat;
    bEngWing.position.set(side * 11.32, 8.17, 107.75);
  }

  for (const [z0, z1, bc, ac, bv, tgt] of [
    [-10.4, 27.55, 3.0, 0.0, 0.0, bowContent],
    [38.95, BREAK_Z + 0.02, 0.0, 0.0, 0.0, bowContent],
    [BREAK_Z - 0.02, 148.4, 0.0, 4.0, 0.0, sternContent],
  ] as const) {
    const aFlr = trackMesh(
      buildCurvedDeckhouseMesh(nextId('aFlr'), 13.6, z0, z1, 0.28, bc, ac, bv),
      tgt,
    );
    aFlr.material = teakDeckMat;
    aFlr.position.y = 9.58;
  }
  for (const side of [-1, 1] as const) {
    const aStairFlr = trackMesh(buildBox(nextId('aStairFlr'), 8.0, 0.28, 11.55), bowContent);
    aStairFlr.material = teakDeckMat;
    aStairFlr.position.set(side * 9.6, 9.72, 33.25);
  }

  for (const [z0, z1, bc, ac, bv, tgt] of [
    [-9.2, 27.55, 2.6, 0.0, 0.0, bowContent],
    [38.95, 64.05, 0.0, 0.0, 0.0, bowContent],
    [81.45, BREAK_Z + 0.02, 0.0, 0.0, 0.0, bowContent],
    [BREAK_Z - 0.02, 146.5, 0.0, 3.4, 0.0, sternContent],
  ] as const) {
    const aWall = trackMesh(
      buildCurvedDeckhouseMesh(nextId('aWall'), 11.35, z0, z1, 2.82, bc, ac, bv),
      tgt,
      true,
    );
    aWall.material = whitePaintMat;
    aWall.position.y = 9.82;
  }
  for (const side of [-1, 1] as const) {
    const aStairWing = trackMesh(buildBox(nextId('aStairW'), 5.75, 2.82, 11.55), bowContent);
    aStairWing.material = whitePaintMat;
    aStairWing.position.set(side * 8.47, 11.23, 33.25);

    const loungeSill = trackMesh(buildBox(nextId('loungeSill'), 0.42, 0.92, 17.6), bowContent);
    loungeSill.material = whitePaintMat;
    loungeSill.position.set(side * 11.14, 10.28, 72.75);

    const loungeHeader = trackMesh(buildBox(nextId('loungeHead'), 0.42, 0.42, 17.6), bowContent);
    loungeHeader.material = whitePaintMat;
    loungeHeader.position.set(side * 11.14, 12.44, 72.75);

    for (let wz = 64.5; wz <= 81.2; wz += 2.8) {
      const pier = trackMesh(buildBox(nextId('loungePier'), 0.42, 1.38, 0.55), bowContent);
      pier.material = whitePaintMat;
      pier.position.set(side * 11.14, 11.42, wz);
    }

    const loungePane = trackMesh(buildPlane(nextId('loungePane'), 17.2, 1.35), bowContent);
    loungePane.material = bridgeGlassMat;
    loungePane.renderOrder = 2;
    loungePane.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    loungePane.position.set(side * 11.18, 11.42, 72.75);
  }

  // Boat Deck Teak Floor
  for (const [z0, z1, bc, ac, bv, tgt] of [
    [-10.2, 27.55, 3.0, 0.0, 0.0, bowContent],
    [38.95, BREAK_Z + 0.02, 0.0, 0.0, 0.0, bowContent],
    [BREAK_Z - 0.02, 148.4, 0.0, 4.0, 0.0, sternContent],
  ] as const) {
    const bFlr = trackMesh(
      buildCurvedDeckhouseMesh(nextId('boatFlr'), 13.7, z0, z1, 0.3, bc, ac, bv),
      tgt,
    );
    bFlr.material = teakDeckMat;
    bFlr.position.y = 12.58;
  }
  for (const side of [-1, 1] as const) {
    const boatStairFlr = trackMesh(buildBox(nextId('boatStairFlr'), 8.1, 0.3, 11.55), bowContent);
    boatStairFlr.material = teakDeckMat;
    boatStairFlr.position.set(side * 9.65, 12.73, 33.25);
  }

  // Turned A-Deck Open Promenade Stanchion Pillars (InstancedMesh)
  const stanchionProto = buildLatheMesh(
    'stanchionProto',
    [
      new THREE.Vector2(0.13, 0),
      new THREE.Vector2(0.09, 0.35),
      new THREE.Vector2(0.075, 1.4),
      new THREE.Vector2(0.1, 2.55),
      new THREE.Vector2(0.14, 2.8),
    ],
    10,
  );
  const fwdStanchionPos: Array<[number, number, number]> = [];
  const aftStanchionPos: Array<[number, number, number]> = [];
  for (const side of [-1, 1]) {
    for (let sz = 60.2; sz <= 145.5; sz += 4.3) {
      if (Math.abs(sz - BREAK_Z) < 0.8) continue;
      if (sz < BREAK_Z) fwdStanchionPos.push([side * 13.25, 9.82, sz]);
      else aftStanchionPos.push([side * 13.25, 9.82, sz]);
    }
    buildRailSegment(bowContent, side * 13.38, 9.86, 58.05, side * 13.38, 9.86, BREAK_Z - 0.12);
    buildRailSegment(sternContent, side * 13.38, 9.86, BREAK_Z + 0.12, side * 13.38, 9.86, 146.5);
  }
  [
    { list: fwdStanchionPos, tgt: bowContent, tag: 'fwd' },
    { list: aftStanchionPos, tgt: sternContent, tag: 'aft' },
  ].forEach(({ list, tgt, tag }) => {
    if (list.length === 0) return;
    const slot = makeSlot(`stanchions_${tag}`, stanchionProto, whitePaintMat, list.length, tgt);
    for (let i = 0; i < list.length; i++) {
      writeInstanceMatrix(slot, i, list[i][0], list[i][1], list[i][2], 0, 0, 0);
    }
    commitInstanceMatrices(slot, list.length);
  });

  // Boat Deck Teak Benches (InstancedMesh)
  const benchProto = buildBox('benchProto', 0.7, 0.58, 2.4);
  const fwdBenchPos: Array<[number, number, number]> = [];
  const aftBenchPos: Array<[number, number, number]> = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 12; i++) {
      const bz = 6 + i * 11.5;
      if (bz < BREAK_Z) fwdBenchPos.push([side * 8.2, 13.15, bz]);
      else aftBenchPos.push([side * 8.2, 13.15, bz]);
    }
  }
  [
    { list: fwdBenchPos, tgt: bowContent, tag: 'fwd' },
    { list: aftBenchPos, tgt: sternContent, tag: 'aft' },
  ].forEach(({ list, tgt, tag }) => {
    if (list.length === 0) return;
    const slot = makeSlot(`benches_${tag}`, benchProto, teakDeckMat, list.length, tgt);
    for (let i = 0; i < list.length; i++) {
      writeInstanceMatrix(slot, i, list[i][0], list[i][1], list[i][2], 0, 0, 0);
    }
    commitInstanceMatrices(slot, list.length);
  });

  // Boat Deck Exterior Houses + Cornice Roofs + Dark Slate Decking + Windows & Teak Doors
  const roofSlateMat = trackMat(
    makePBR('titanic_roofSlate', {
      color: 0x3b434d,
      roughness: 0.86,
      metallic: 0.04,
      envIntensity: 0.28,
    }),
  );

  const deckhouses: Array<[number, number, number, number]> = [
    [6.6, 2.95, 19.4, 2.5],
    [6.2, 64.0, 81.5, 2.15],
    [6.0, 92.5, 109.5, 2.15],
    [5.8, 121.5, 132.5, 2.2],
    [5.5, 135.5, 145.0, 2.0],
  ];
  const dhDoorsFwd: Array<[number, number, number]> = [];
  const dhDoorsAft: Array<[number, number, number]> = [];
  const dhWinsFwd: Array<{ x: number; y: number; z: number; side: number }> = [];
  const dhWinsAft: Array<{ x: number; y: number; z: number; side: number }> = [];

  for (const [hw, z0, z1, h] of deckhouses) {
    const tgt = z0 < BREAK_Z ? bowContent : sternContent;
    const house = trackMesh(
      buildCurvedDeckhouseMesh(nextId('deckhouse'), hw, z0, z1, h, 0.8, 0.8, 0.08),
      tgt,
      true,
    );
    house.material = whitePaintMat;
    house.position.y = 12.86;

    // Overhanging cornice eave & dark tarred roof cap
    const eave = trackMesh(
      buildCurvedDeckhouseMesh(nextId('dhEave'), hw + 0.32, z0 - 0.22, z1 + 0.22, 0.18, 0.82, 0.82, 0.04),
      tgt,
    );
    eave.material = whitePaintMat;
    eave.position.y = 12.86 + h - 0.04;

    const roofTop = trackMesh(
      buildCurvedDeckhouseMesh(nextId('dhRoof'), hw + 0.14, z0 - 0.06, z1 + 0.06, 0.08, 0.8, 0.8, 0.02),
      tgt,
    );
    roofTop.material = roofSlateMat;
    roofTop.position.y = 12.86 + h + 0.12;

    for (const side of [-1, 1] as const) {
      for (let wz = z0 + 2.1; wz <= z1 - 2.1; wz += 2.65) {
        const isDoor = Math.abs(wz - (z0 + z1) * 0.5) < 1.2;
        if (isDoor) {
          (z0 < BREAK_Z ? dhDoorsFwd : dhDoorsAft).push([side * (hw + 0.08), 13.82, wz]);
        } else {
          (z0 < BREAK_Z ? dhWinsFwd : dhWinsAft).push({ x: side * (hw + 0.07), y: 13.98, z: wz, side });
        }
        // Subtle vertical structural pilaster between bays
        if (wz + 1.32 < z1 - 0.8) {
          const pilaster = trackMesh(buildBox(nextId('dhPil'), 0.09, h - 0.14, 0.18), tgt);
          pilaster.material = creamTrimMat;
          pilaster.position.set(side * (hw + 0.03), 12.86 + h * 0.5, wz + 1.32);
        }
      }
    }
  }
  const dhDoorProto = buildBox('dhDoorProto', 0.06, 1.85, 0.82);
  const dhFrameProto = buildBox('dhFrameProto', 0.05, 0.80, 0.94);
  const dhGlassProto = buildPlane('dhGlassProto', 0.86, 0.72);
  [
    { doors: dhDoorsFwd, wins: dhWinsFwd, tgt: bowContent, tag: 'fwd' },
    { doors: dhDoorsAft, wins: dhWinsAft, tgt: sternContent, tag: 'aft' },
  ].forEach(({ doors, wins, tgt, tag }) => {
    if (doors.length > 0) {
      const slot = makeSlot(`dhDoor_${tag}`, dhDoorProto, mahoganyMat, doors.length, tgt);
      for (let i = 0; i < doors.length; i++) {
        writeInstanceMatrix(slot, i, doors[i][0], doors[i][1], doors[i][2], 0, 0, 0);
      }
      commitInstanceMatrices(slot, doors.length);
    }
    if (wins.length > 0) {
      const fSlot = makeSlot(`dhFrame_${tag}`, dhFrameProto, creamTrimMat, wins.length, tgt);
      const gSlot = makeSlot(`dhGlass_${tag}`, dhGlassProto, portholeGlowMat, wins.length, tgt);
      for (let i = 0; i < wins.length; i++) {
        const w = wins[i];
        writeInstanceMatrix(fSlot, i, w.x, w.y, w.z, 0, 0, 0);
        writeInstanceMatrix(
          gSlot,
          i,
          w.x + w.side * 0.035,
          w.y,
          w.z,
          0,
          w.side > 0 ? Math.PI / 2 : -Math.PI / 2,
          0,
        );
      }
      commitInstanceMatrices(fSlot, wins.length);
      commitInstanceMatrices(gSlot, wins.length);
    }
  });

  // Elevated Midships Compass / Docking Bridge Platform between Funnels #2 & #3 (z = 72..75)
  const midBridgeDeck = trackMesh(buildBox('midBridgeDeck', 7.4, 0.16, 2.8), bowContent);
  midBridgeDeck.material = teakDeckMat;
  midBridgeDeck.position.set(0, 16.58, 73.2);
  for (const sx of [-3.3, 0, 3.3]) {
    for (const sz of [72.0, 74.4]) {
      const leg = trackMesh(buildCylinder(nextId('midLeg'), 0.08, 0.10, 1.55, 8), bowContent);
      leg.material = whitePaintMat;
      leg.position.set(sx, 15.8, sz);
    }
  }
  buildRailSegment(bowContent, -3.65, 16.66, 71.85, 3.65, 16.66, 71.85);
  buildRailSegment(bowContent, -3.65, 16.66, 74.55, 3.65, 16.66, 74.55);
  buildRailSegment(bowContent, -3.65, 16.66, 71.85, -3.65, 16.66, 74.55);
  buildRailSegment(bowContent, 3.65, 16.66, 71.85, 3.65, 16.66, 74.55);
  const midBinnacle = trackMesh(buildCylinder('midBinnacle', 0.14, 0.18, 0.96, 12), bowContent);
  midBinnacle.material = mahoganyMat;
  midBinnacle.position.set(0, 17.12, 73.2);
  const midBinHood = trackMesh(buildSphere('midBinHood', 0.17, 10, 10), bowContent);
  midBinHood.material = brassMat;
  midBinHood.position.set(0, 17.66, 73.2);

  // Pitched Multi-Pane Glazed Engine Room Skylight atop Engine Casing (z = 100..108)
  const engSkyCoaming = trackMesh(buildBox('engSkyCoaming', 4.4, 0.52, 7.6), sternContent);
  engSkyCoaming.material = whitePaintMat;
  engSkyCoaming.position.set(0, 15.32, 103.8);
  for (const side of [-1, 1] as const) {
    const pitchRoof = trackMesh(buildBox(nextId('engSkyPitch'), 2.35, 0.12, 7.4), sternContent);
    pitchRoof.material = bridgeGlassMat;
    pitchRoof.renderOrder = 2;
    pitchRoof.position.set(side * 1.05, 15.78, 103.8);
    pitchRoof.rotation.z = -side * 0.34;
    for (let rz = 100.6; rz <= 107.0; rz += 1.6) {
      const mull = trackMesh(buildBox(nextId('engSkyMull'), 2.38, 0.16, 0.10), sternContent);
      mull.material = whitePaintMat;
      mull.position.set(side * 1.05, 15.79, rz);
      mull.rotation.z = -side * 0.34;
    }
  }
  const engSkyRidge = trackMesh(buildCylinder('engSkyRidge', 0.08, 0.08, 7.55, 8), sternContent);
  engSkyRidge.material = whitePaintMat;
  engSkyRidge.rotation.x = Math.PI / 2;
  engSkyRidge.position.set(0, 16.16, 103.8);

  // Hollow Forward Grand Staircase Boat-Deck Enclosure (z = 27.6..38.8) beneath the Dome
  for (const side of [-1, 1] as const) {
    const stairSideWall = trackMesh(buildBox(nextId('stairSW'), 0.45, 2.28, 11.4), bowContent);
    stairSideWall.material = whitePaintMat;
    stairSideWall.position.set(side * 6.05, 14.0, 33.2);
  }
  for (const endZ of [27.7, 38.7]) {
    const stairEndWall = trackMesh(buildBox(nextId('stairEW'), 12.5, 2.28, 0.45), bowContent);
    stairEndWall.material = whitePaintMat;
    stairEndWall.position.set(0, 14.0, endZ);
  }
  for (const ez of [28.7, 37.7]) {
    const roofRimZ = trackMesh(buildBox(nextId('roofRimZ'), 12.4, 0.24, 2.2), bowContent);
    roofRimZ.material = whitePaintMat;
    roofRimZ.position.set(0, 15.05, ez);
  }
  for (const side of [-1, 1] as const) {
    const roofRimX = trackMesh(buildBox(nextId('roofRimX'), 3.3, 0.24, 7.2), bowContent);
    roofRimX.material = whitePaintMat;
    roofRimX.position.set(side * 4.55, 15.05, 33.2);
  }

  // Hollow Marconi Wireless Room & Gymnasium on Boat Deck
  const marconiFloor = trackMesh(buildBox('marconiFloor', 11.4, 0.14, 9.4), bowContent);
  marconiFloor.material = interiorMarbleMat;
  marconiFloor.position.set(0, 12.92, 46.75);

  const marconiRoof = trackMesh(buildBox('marconiRoof', 12.2, 0.24, 9.9), bowContent, true);
  marconiRoof.material = whitePaintMat;
  marconiRoof.position.set(0, 15.04, 46.75);

  const marconiRoofDeck = trackMesh(buildBox('marconiRoofDeck', 11.9, 0.08, 9.6), bowContent);
  marconiRoofDeck.material = roofSlateMat;
  marconiRoofDeck.position.set(0, 15.19, 46.75);

  // Marconi Wireless Porcelain Lead-In Insulator Trunk & Bushings
  const marconiTrunk = trackMesh(buildBox('marconiTrunk', 1.65, 0.34, 0.72), bowContent);
  marconiTrunk.material = whitePaintMat;
  marconiTrunk.position.set(0, 15.38, 46.65);
  for (const ix of [-0.52, 0.52]) {
    const bushing = trackMesh(buildCylinder(nextId('marcBush'), 0.11, 0.14, 0.28, 10), bowContent);
    bushing.material = creamTrimMat;
    bushing.position.set(ix, 15.65, 46.65);
    const tip = trackMesh(buildSphere(nextId('marcTip'), 0.08, 8, 8), bowContent);
    tip.material = brassMat;
    tip.position.set(ix, 15.82, 46.65);
  }

  for (const side of [-1, 1] as const) {
    const mWain = trackMesh(buildBox(nextId('mWain'), 0.3, 0.9, 9.4), bowContent);
    mWain.material = whitePaintMat;
    mWain.position.set(side * 5.65, 13.34, 46.75);
    const mHead = trackMesh(buildBox(nextId('mHead'), 0.3, 0.42, 9.4), bowContent);
    mHead.material = whitePaintMat;
    mHead.position.set(side * 5.65, 14.8, 46.75);
    for (const pz of [42.2, 44.5, 46.8, 49.0, 51.3]) {
      const mPier = trackMesh(buildBox(nextId('mPier'), 0.3, 1.1, 0.45), bowContent);
      mPier.material = whitePaintMat;
      mPier.position.set(side * 5.65, 14.22, pz);
    }
  }
  for (const mz of [42.05, 51.45]) {
    const mEnd = trackMesh(buildBox(nextId('mEnd'), 11.6, 2.15, 0.3), bowContent);
    mEnd.material = interiorPanelMat;
    mEnd.position.set(0, 13.98, mz);
  }

  // Twin Sculpted Glowing Grand Staircase Stained-Glass Dome Skylights with Cupola Ribs
  for (const dz of [33.2, 127.0]) {
    const dy = dz < 60 ? 15.14 : 15.1;
    const tgt = dz < BREAK_Z ? bowContent : sternContent;

    const plinth = trackMesh(buildCylinder(nextId('domePlinth'), 3.05, 3.15, 0.36, 24), tgt);
    plinth.material = whitePaintMat;
    plinth.scale.set(1.1, 1, 1.38);
    plinth.position.set(0, dy - 0.08, dz);

    const domeGlass = trackMesh(buildSphere(nextId('domeGlass'), 2.7, 20, 14, 0.48), tgt);
    domeGlass.material = warmGlowMat;
    domeGlass.scale.set(1.1, 0.72, 1.38);
    domeGlass.position.set(0, dy, dz);

    const domeRim = trackMesh(buildTorusXY(nextId('domeRim'), 2.7, 0.16, 8, 28), tgt);
    domeRim.material = creamTrimMat;
    domeRim.rotation.x = Math.PI / 2;
    domeRim.scale.set(1.1, 1.38, 1);
    domeRim.position.set(0, dy, dz);

    // Wrought-iron structural glazing arches + brass cupola finial
    for (let ri = 0; ri < 4; ri++) {
      const rib = trackMesh(buildTorusXY(nextId('domeRib'), 2.73, 0.06, 6, 24), tgt);
      rib.material = darkIronMat;
      rib.scale.set(1.1, 0.73, 1.38);
      rib.rotation.y = (ri * Math.PI) / 4;
      rib.position.set(0, dy, dz);
    }
    const cupolaCap = trackMesh(buildCylinder(nextId('domeCap'), 0.28, 0.56, 0.24, 14), tgt);
    cupolaCap.material = creamTrimMat;
    cupolaCap.position.set(0, dy + 1.96, dz);
    const finial = trackMesh(buildSphere(nextId('domeFinial'), 0.16, 10, 10), tgt);
    finial.material = brassMat;
    finial.position.set(0, dy + 2.22, dz);
  }

  // Open Navigating Bridge Front Walkway, Canvas Dodger, Wing Cabs & Nav Light Boxes
  const navWalkway = trackMesh(
    buildCurvedDeckhouseMesh('navWalkway', 15.4, -2.5, -1.55, 0.28, 0.25, 0.1, 0),
    bowContent,
  );
  navWalkway.material = teakDeckMat;
  navWalkway.position.y = 12.58;

  const centerFrontDodger = trackMesh(
    buildCurvedDeckhouseMesh('centerFrontDodger', 4.48, -2.48, -2.26, 1.08, 0.16, 0.06, 0.01),
    bowContent,
  );
  centerFrontDodger.material = whitePaintMat;
  centerFrontDodger.position.y = 12.86;

  const bridgeWingDeck = trackMesh(
    buildCurvedDeckhouseMesh('bridgeWingDeck', 15.4, -2.3, 1.8, 0.3, 0.35, 0.35, 0),
    bowContent,
  );
  bridgeWingDeck.material = teakDeckMat;
  bridgeWingDeck.position.y = 12.58;

  const wingKneePts = [new THREE.Vector3(0, -1.85, 0), new THREE.Vector3(1.45, -1.1, 0), new THREE.Vector3(2.9, -0.04, 0)];
  const wingKneeProto = buildTubeMesh('wingKneeProto', wingKneePts, 10, 0.16, 8, true);
  wingKneeProto.material = whitePaintMat;
  trackProtoGeo(wingKneeProto.geometry);

  let kneeCounter = 0;
  for (const side of [-1, 1]) {
    const wingWall = trackMesh(
      buildCurvedDeckhouseMesh(nextId('wingWall'), 5.55, -2.25, -1.85, 1.24, 0.12, 0.12, 0.02),
      bowContent,
    );
    wingWall.material = whitePaintMat;
    wingWall.position.set(side * 9.85, 12.86, 0);

    buildRailSegment(bowContent, side * 4.45, 12.88, 1.72, side * 15.25, 12.88, 1.72);
    for (const px of [6.5, 9.5, 12.5, 15.1]) {
      const wPost = trackMesh(buildCylinder(nextId('wPost'), 0.045, 0.045, 1.06, 6), bowContent);
      wPost.material = whitePaintMat;
      wPost.position.set(side * px, 13.4, 1.72);
    }

    const wingCab = trackMesh(
      buildCurvedDeckhouseMesh(nextId('wingCab'), 0.45, -2.25, 1.75, 1.32, 0.22, 0.22, 0.03),
      bowContent,
    );
    wingCab.material = whitePaintMat;
    wingCab.position.set(side * 15.15, 12.86, 0);

    for (const kz of [-1.5, 0.9]) {
      const knee = trackMesh(
        kneeCounter === 0 ? wingKneeProto : cloneMeshWithMaterial(wingKneeProto, `wingKnee_${kneeCounter}`, whitePaintMat),
        bowContent,
      );
      kneeCounter++;
      knee.position.set(side * 12.3, 12.68, kz);
      knee.scale.x = side;
    }

    const navScreenBack = trackMesh(buildBox(nextId('navBack'), 0.1, 0.62, 0.72), bowContent);
    navScreenBack.material = whitePaintMat;
    navScreenBack.position.set(side * 15.05, 14.34, -1.78);
    const navScreenBottom = trackMesh(buildBox(nextId('navBot'), 0.56, 0.08, 0.72), bowContent);
    navScreenBottom.material = whitePaintMat;
    navScreenBottom.position.set(side * 15.28, 14.04, -1.78);
    const navScreenAft = trackMesh(buildBox(nextId('navAft'), 0.56, 0.62, 0.08), bowContent);
    navScreenAft.material = whitePaintMat;
    navScreenAft.position.set(side * 15.28, 14.34, -1.44);

    const navLight = trackMesh(buildSphere(nextId('navLight'), 0.20, 12, 12), bowContent);
    navLight.material = side < 0 ? portLightMat : starboardLightMat;
    navLight.position.set(side * 15.32, 14.34, -1.86);
  }

  // =========================================================================
  // 4. ALL 4 TOWERING ELLIPTICAL OLYMPIC-CLASS FUNNELS (~20m ABOVE BOAT DECK)
  // =========================================================================
  const funnelZPositions = [23.2, 56.0, 86.0, 115.0];
  const funnelShaftProto = buildCylinder('funnelShaftProto', 2.65, 3.12, 17.2, 32);
  funnelShaftProto.material = buffFunnelMat;
  trackProtoGeo(funnelShaftProto.geometry);

  const funnelFidleyProto = buildCurvedDeckhouseMesh('funnelFidleyProto', 3.45, -3.55, 3.55, 1.15, 0.55, 0.55, 0.06);
  funnelFidleyProto.material = whitePaintMat;
  trackProtoGeo(funnelFidleyProto.geometry);

  const funnelBandProto = buildCylinder('funnelBandProto', 2.74, 2.68, 3.6, 32);
  funnelBandProto.material = funnelBandMat;
  trackProtoGeo(funnelBandProto.geometry);

  const funnelLipProto = buildTorusXY('funnelLipProto', 2.7, 0.14, 8, 32);
  funnelLipProto.rotation.x = Math.PI / 2;
  bakeTransform(funnelLipProto);
  funnelLipProto.material = funnelLipMat;
  trackProtoGeo(funnelLipProto.geometry);

  const funnelFlueProto = buildDisc('funnelFlueProto', 2.5, 28);
  funnelFlueProto.rotation.x = -Math.PI / 2;
  bakeTransform(funnelFlueProto);
  funnelFlueProto.material = darkIronMat;
  trackProtoGeo(funnelFlueProto.geometry);

  const funnelSeamProto = buildTorusXY('funnelSeamProto', 2.88, 0.055, 6, 32);
  funnelSeamProto.rotation.x = Math.PI / 2;
  bakeTransform(funnelSeamProto);
  funnelSeamProto.material = buffFunnelMat;
  trackProtoGeo(funnelSeamProto.geometry);

  const funnelPipeProto = buildCylinder('funnelPipeProto', 0.16, 0.18, 18.6, 10);
  funnelPipeProto.material = brassMat;
  trackProtoGeo(funnelPipeProto.geometry);

  const whistleBellProto = buildCylinder('whistleBellProto', 0.26, 0.14, 0.56, 12);
  whistleBellProto.material = brassMat;
  trackProtoGeo(whistleBellProto.geometry);

  const grateBarProto = buildBox('grateBarProto', 4.95, 0.09, 0.14);
  grateBarProto.material = darkIronMat;
  trackProtoGeo(grateBarProto.geometry);

  const ladderRungProto = buildBox('ladderRungProto', 0.45, 0.05, 0.08);
  ladderRungProto.material = darkIronMat;
  trackProtoGeo(ladderRungProto.geometry);

  funnelZPositions.forEach((fz, fIdx) => {
    const tgt = fz < BREAK_Z ? bowContent : sternContent;

    const fidley = trackMesh(
      fIdx === 0 ? funnelFidleyProto : cloneMeshWithMaterial(funnelFidleyProto, `fidley_${fIdx}`, whitePaintMat),
      tgt,
      true,
    );
    fidley.position.set(0, 12.65, fz);

    for (const fSide of [-1, 1]) {
      const skyBox = trackMesh(buildBox(nextId('skyBox'), 0.56, 0.3, 3.2), tgt);
      skyBox.material = whitePaintMat;
      skyBox.position.set(fSide * 2.95, 13.86, fz);
      const skyPane = trackMesh(buildBox(nextId('skyPane'), 0.46, 0.08, 3.0), tgt);
      skyPane.material = darkIronMat;
      skyPane.position.set(fSide * 2.95, 14.02, fz);

      // Recessed boiler-room air intake louver grille on fidley side wall
      const louver = trackMesh(buildBox(nextId('fidLouver'), 0.10, 0.56, 3.8), tgt);
      louver.material = darkIronMat;
      louver.position.set(fSide * 3.44, 13.28, fz);
    }

    const funnelGroup = new THREE.Group();
    funnelGroup.name = `funnelGroup_${fIdx}`;
    tgt.add(funnelGroup);
    funnelGroup.position.set(0, 12.85, fz);
    funnelGroup.rotation.x = 0.088;
    funnelGroup.scale.set(0.86, 1, 1.15);

    const shaft = trackMesh(
      fIdx === 0 ? funnelShaftProto : cloneMeshWithMaterial(funnelShaftProto, `fShaft_${fIdx}`, buffFunnelMat),
      funnelGroup,
      true,
    );
    shaft.position.y = 7.6;

    [3.5, 7.6, 11.8, 15.2].forEach((sy, sIdx) => {
      const seam = trackMesh(
        fIdx === 0 && sIdx === 0 ? funnelSeamProto : cloneMeshWithMaterial(funnelSeamProto, `fSeam_${fIdx}_${sIdx}`, buffFunnelMat),
        funnelGroup,
      );
      seam.position.y = sy;
      const sc = 1.04 - sy * 0.008;
      seam.scale.set(sc, sc, sc);
    });

    const topBand = trackMesh(
      fIdx === 0 ? funnelBandProto : cloneMeshWithMaterial(funnelBandProto, `fBand_${fIdx}`, funnelBandMat),
      funnelGroup,
    );
    topBand.position.y = 17.8;

    const topLip = trackMesh(
      fIdx === 0 ? funnelLipProto : cloneMeshWithMaterial(funnelLipProto, `fLip_${fIdx}`, funnelLipMat),
      funnelGroup,
    );
    topLip.position.y = 19.62;

    const darkFlue = trackMesh(
      fIdx === 0 ? funnelFlueProto : cloneMeshWithMaterial(funnelFlueProto, `fFlue_${fIdx}`, darkIronMat),
      funnelGroup,
    );
    darkFlue.position.y = 19.44;

    for (let gi = 0; gi < 4; gi++) {
      const bar = trackMesh(
        fIdx === 0 && gi === 0 ? grateBarProto : cloneMeshWithMaterial(grateBarProto, `fGrate_${fIdx}_${gi}`, darkIronMat),
        funnelGroup,
      );
      bar.position.y = 19.52;
      bar.rotation.y = (gi * Math.PI) / 4;
    }

    [-0.35, 0.35].forEach((px, pIdx) => {
      const pipe = trackMesh(
        fIdx === 0 && pIdx === 0 ? funnelPipeProto : cloneMeshWithMaterial(funnelPipeProto, `fPipe_${fIdx}_${pIdx}`, brassMat),
        funnelGroup,
      );
      pipe.position.set(px, 8.5, -2.96);

      const chime = trackMesh(
        fIdx === 0 && pIdx === 0 ? whistleBellProto : cloneMeshWithMaterial(whistleBellProto, `fWhistle_${fIdx}_${pIdx}`, brassMat),
        funnelGroup,
      );
      chime.position.set(px, 16.5, -3.15);

      const steamPipe = trackMesh(
        cloneMeshWithMaterial(funnelPipeProto, `fSteam_${fIdx}_${pIdx}`, darkIronMat),
        funnelGroup,
      );
      steamPipe.scale.set(0.62, 0.96, 0.62);
      steamPipe.position.set(px * 0.9, 8.2, 2.95);
    });

    let rungIdx = 0;
    for (let ly = 2.0; ly <= 17.5; ly += 0.95) {
      const rung = trackMesh(
        fIdx === 0 && rungIdx === 0
          ? ladderRungProto
          : cloneMeshWithMaterial(ladderRungProto, `fRung_${fIdx}_${rungIdx}`, darkIronMat),
        funnelGroup,
      );
      rungIdx++;
      rung.position.set(0, ly, 3.02 - ly * 0.02);
    }

    const dzFore = fz < 30 ? -9.8 : fz > 100 ? -8.2 : -7.5;
    const dzMid = fz < 30 ? -0.15 : fz > 100 ? 1.5 : 0.4;
    const dzAft = fz < 30 ? 9.6 : fz === 86 ? 3.4 : fz > 100 ? 11.2 : 8.2;
    const guyAnchors: Array<[number, number, number, number]> = [
      [-1.95, -1.95, -11.4, dzFore],
      [1.95, -1.95, 11.4, dzFore],
      [-2.32, 0.1, -11.7, dzMid],
      [2.32, 0.1, 11.7, dzMid],
      [-1.95, 2.05, -11.4, dzAft],
      [1.95, 2.05, 11.4, dzAft],
    ];
    for (const [tx, tz, bx, bz] of guyAnchors) {
      const topPt = new THREE.Vector3(tx, 29.8, fz + tz * 1.15 + 1.49);
      const botPt = new THREE.Vector3(bx, 12.9, fz + bz);
      const wire = trackMesh(buildTubeMesh(nextId('guyWire'), [topPt, botPt], 1, 0.044, 6, false), tgt);
      wire.material = darkIronMat;
    }
  });

  // Animated Walking & Running Crew, Passengers & 16 Sculpted Lifeboats (or static lifeboats when moored companion)
  let crewAndLifeboats: CrewAndLifeboatSystem;
  const boatStations = [8.5, 18.2, 27.9, 37.6, 102.0, 111.7, 121.4, 131.1];
  const boatX = isBritannic ? 13.2 : 12.95;

  if (!companionOnly) {
    crewAndLifeboats = createCrewAndLifeboats(
      scene,
      bowContent,
      sternContent,
      whitePaintMat,
      teakDeckMat,
      BREAK_Z,
      {
        scaleX: isBritannic ? 1.02 : 1.0,
        scaleZ: 1.0,
        boatBaseX: boatX,
      },
    );
    for (let i = 0; i < crewAndLifeboats.shadowCasters.length; i++) {
      shadowCasters.push(crewAndLifeboats.shadowCasters[i]);
    }
  } else {
    const staticBoatProto = buildBox('staticBoatProto', 1.85, 0.85, 6.2);
    const fwdStaticBoats = makeSlot('staticBoatsFwd', staticBoatProto, whitePaintMat, 8, bowContent);
    const aftStaticBoats = makeSlot('staticBoatsAft', staticBoatProto, whitePaintMat, 8, sternContent);
    let fi = 0;
    let ai = 0;
    for (const side of [-1, 1] as const) {
      for (let b = 0; b < boatStations.length; b++) {
        const bz = boatStations[b];
        const bx = side * (b === 0 ? boatX + 0.9 : boatX);
        if (bz < BREAK_Z) writeInstanceMatrix(fwdStaticBoats, fi++, bx, 13.85, bz, 0, 0, 0);
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

  // HMHS Britannic Towering Arched Steel Gantry Davits (8 pairs along Boat Deck)
  if (isBritannic) {
    const gantryPostProto = buildTubeMesh(
      'britGantryPost',
      [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.05, 3.6, 0),
        new THREE.Vector3(0.45, 5.8, 0),
        new THREE.Vector3(1.55, 7.1, 0),
        new THREE.Vector3(2.45, 7.25, 0),
      ],
      12,
      0.13,
      8,
      false,
    );
    trackProtoGeo(gantryPostProto.geometry);
    const gantryBeamProto = buildBox('britGantryBeam', 0.24, 0.28, 6.2);
    trackProtoGeo(gantryBeamProto.geometry);
    const gantryBraceProto = buildBox('britGantryBrace', 0.16, 1.35, 0.16);
    trackProtoGeo(gantryBraceProto.geometry);

    for (const side of [-1, 1] as const) {
      for (let b = 0; b < boatStations.length; b++) {
        const bz = boatStations[b];
        const tgtG = bz < BREAK_Z ? bowContent : sternContent;
        const gx = side * 12.0;

        for (const dz of [-2.85, 2.85]) {
          const post = trackMesh(
            cloneMeshWithMaterial(gantryPostProto, `britGanPost_${side}_${b}_${dz}`, whitePaintMat),
            tgtG,
          );
          post.position.set(gx, 12.88, bz + dz);
          if (side < 0) post.scale.x = -1;

          const brace = trackMesh(
            cloneMeshWithMaterial(gantryBraceProto, `britGanBrace_${side}_${b}_${dz}`, darkIronMat),
            tgtG,
          );
          brace.position.set(side * 13.7, 19.35, bz + dz);
        }
        const topBeam = trackMesh(
          cloneMeshWithMaterial(gantryBeamProto, `britGanBeam_${side}_${b}`, whitePaintMat),
          tgtG,
        );
        topBeam.position.set(side * 13.8, 20.1, bz);
      }
    }
  }

  // =========================================================================
  // 5. HULL BRASS PORTHOLES & RECTANGULAR WHITE STAR LINE WINDOWS
  // =========================================================================
  const portholePositions: Array<{ x: number; y: number; z: number; rotY: number }> = [];
  for (const side of [-1, 1]) {
    for (let z = -58; z <= 184; z += 4.2) {
      const { beam, sheerY } = sampleHullStation(z, beamScale);
      const { beam: beamNext } = sampleHullStation(z + 1.5, beamScale);
      const slopeAngle = Math.atan2((beamNext - beam) * side, 1.5);
      const yKeel = sampleKeelY(z);

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

  const fwdPortholes = portholePositions.filter((p) => p.z < BREAK_Z);
  const aftPortholes = portholePositions.filter((p) => p.z >= BREAK_Z);
  const portholeProto = buildDisc('portholeProto', 0.24, 12);
  const brassRimProto = buildTorusXY('brassRimProto', 0.265, 0.045, 6, 12);

  [
    { list: fwdPortholes, tgt: bowContent, tag: 'fwd' },
    { list: aftPortholes, tgt: sternContent, tag: 'aft' },
  ].forEach(({ list, tgt, tag }) => {
    if (list.length === 0) return;
    const pSlot = makeSlot(`porthole_${tag}`, portholeProto, portholeGlowMat, list.length, tgt);
    const rSlot = makeSlot(`portholeRim_${tag}`, brassRimProto, brassMat, list.length, tgt);
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      writeInstanceMatrix(pSlot, i, p.x, p.y, p.z, 0, p.rotY, 0);
      writeInstanceMatrix(rSlot, i, p.x + (p.x > 0 ? 0.018 : -0.018), p.y, p.z, 0, p.rotY, 0);
    }
    commitInstanceMatrices(pSlot, list.length);
    commitInstanceMatrices(rSlot, list.length);
  });

  // Rectangular Multi-Pane Cabin & Promenade Windows (InstancedMesh)
  const rectWindows: Array<{ x: number; y: number; z: number; rotY: number; sy: number }> = [];
  for (const side of [-1, 1]) {
    for (let z = -7.0; z <= 144.0; z += 2.65) {
      if (Math.abs(z - BREAK_Z) < 0.85) continue;
      rectWindows.push({
        x: side * 13.52,
        y: 8.32,
        z,
        rotY: side > 0 ? Math.PI / 2 : -Math.PI / 2,
        sy: 0.95,
      });
      if (z < 64.0 || z > 81.5) {
        rectWindows.push({
          x: side * 11.46,
          y: 11.30,
          z,
          rotY: side > 0 ? Math.PI / 2 : -Math.PI / 2,
          sy: 1.12,
        });
      }
    }
  }
  for (let wx = -10.5; wx <= 10.5; wx += 2.62) {
    const bU = 1 - Math.sqrt(Math.max(0.02, 1 - Math.abs(wx) / 13.45));
    const bArcZ = -10.08 + 3.0 * bU * bU;
    const bSlopeZ = Math.sign(wx) * ((3.0 * bU) / (13.45 * Math.sqrt(Math.max(0.02, 1 - Math.abs(wx) / 13.45))));
    rectWindows.push({ x: wx, y: 8.32, z: bArcZ, rotY: Math.PI - Math.atan2(bSlopeZ, 1), sy: 0.95 });

    if (Math.abs(wx) <= 8.5) {
      const aU = 1 - Math.sqrt(Math.max(0.02, 1 - Math.abs(wx) / 11.35));
      const aArcZ = -9.28 + 2.6 * aU * aU;
      const aSlopeZ = Math.sign(wx) * ((2.6 * aU) / (11.35 * Math.sqrt(Math.max(0.02, 1 - Math.abs(wx) / 11.35))));
      rectWindows.push({ x: wx, y: 11.30, z: aArcZ, rotY: Math.PI - Math.atan2(aSlopeZ, 1), sy: 1.08 });
    }
  }

  const rectWinGlassProto = buildPlane('rectWinGlassProto', 1.14, 0.92);
  const rectWinFrameProto = buildBox('rectWinFrameProto', 1.26, 1.04, 0.06);
  const rectWinMuntinProto = buildBox('rectWinMuntinProto', 0.06, 0.96, 0.08);
  [
    { list: rectWindows.filter((w) => w.z < BREAK_Z), tgt: bowContent, tag: 'fwd' },
    { list: rectWindows.filter((w) => w.z >= BREAK_Z), tgt: sternContent, tag: 'aft' },
  ].forEach(({ list, tgt, tag }) => {
    if (list.length === 0) return;
    const gSlot = makeSlot(`wGlass_${tag}`, rectWinGlassProto, portholeGlowMat, list.length, tgt);
    const fSlot = makeSlot(`wFrame_${tag}`, rectWinFrameProto, creamTrimMat, list.length, tgt);
    const mSlot = makeSlot(`wMuntin_${tag}`, rectWinMuntinProto, whitePaintMat, list.length, tgt);
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      const nx = Math.sin(w.rotY);
      const nz = Math.cos(w.rotY);
      writeInstanceMatrix(fSlot, i, w.x, w.y, w.z, 0, w.rotY, 0, 1, w.sy, 1);
      writeInstanceMatrix(mSlot, i, w.x, w.y, w.z, 0, w.rotY, 0, 1, w.sy, 1);
      writeInstanceMatrix(gSlot, i, w.x + nx * 0.036, w.y, w.z + nz * 0.036, 0, w.rotY, 0, 1, w.sy, 1);
    }
    commitInstanceMatrices(gSlot, list.length);
    commitInstanceMatrices(fSlot, list.length);
    commitInstanceMatrices(mSlot, list.length);
  });

  // =========================================================================
  // 6. 2-STAGE STEEL/SPRUCE FOREMAST, CROW'S NEST, MAINMAST & MARCONI AERIALS
  // =========================================================================
  const foremastLower = trackMesh(buildCylinder('foremastLower', 0.24, 0.39, 23.2, 14), bowContent, true);
  foremastLower.material = buffFunnelMat;
  foremastLower.position.set(0, 17.6, -22.5);

  const foremastUpper = trackMesh(buildCylinder('foremastUpper', 0.14, 0.24, 19.6, 12), bowContent, true);
  foremastUpper.material = spruceMastMat;
  foremastUpper.position.set(0, 38.8, -22.5);

  const foremastTable = trackMesh(buildCylinder('foremastTable', 0.46, 0.32, 0.42, 12), bowContent);
  foremastTable.material = whitePaintMat;
  foremastTable.position.set(0, 29.2, -22.5);

  const foremastCollar = trackMesh(buildCylinder('foremastCollar', 0.46, 0.62, 0.72, 14), bowContent);
  foremastCollar.material = whitePaintMat;
  foremastCollar.position.set(0, 6.72, -22.5);

  const crowsNest = trackMesh(buildCylinder('crowsNest', 1.05, 0.76, 1.55, 18), bowContent, true);
  crowsNest.material = whitePaintMat;
  crowsNest.position.set(0, 25.8, -22.5);

  const crowsNestFloor = trackMesh(buildCylinder('crowsNestFloor', 0.76, 0.76, 0.16, 18), bowContent);
  crowsNestFloor.material = teakDeckMat;
  crowsNestFloor.position.set(0, 25.08, -22.5);

  const crowsNestRim = trackMesh(buildTorusXY('crowsNestRim', 1.05, 0.09, 8, 24), bowContent);
  crowsNestRim.material = teakDeckMat;
  crowsNestRim.rotation.x = Math.PI / 2;
  crowsNestRim.position.set(0, 26.58, -22.5);

  const mastLanternCap = trackMesh(buildCylinder('mastLanternCap', 0.11, 0.13, 0.24, 10), bowContent);
  mastLanternCap.material = darkIronMat;
  mastLanternCap.position.set(0, 31.8, -22.84);
  const mastLantern = trackMesh(buildSphere('mastLantern', 0.095, 10, 10), bowContent);
  mastLantern.material = warmGlowMat;
  mastLantern.position.set(0, 31.78, -22.92);

  const yardarm = trackMesh(buildCylinder('yardarm', 0.08, 0.12, 12.6, 10), bowContent);
  yardarm.material = spruceMastMat;
  yardarm.rotation.z = Math.PI / 2;
  yardarm.position.set(0, 36.2, -22.5);

  const mainMastLower = trackMesh(buildCylinder('mainMastLower', 0.23, 0.36, 21.5, 14), sternContent);
  mainMastLower.material = buffFunnelMat;
  mainMastLower.position.set(0, 17.8, 177.4);
  mainMastLower.rotation.x = 0.06;

  const mainMastUpper = trackMesh(buildCylinder('mainMastUpper', 0.14, 0.23, 19.6, 12), sternContent);
  mainMastUpper.material = spruceMastMat;
  mainMastUpper.position.set(0, 37.9, 178.6);
  mainMastUpper.rotation.x = 0.06;

  const mainMastCollar = trackMesh(buildCylinder('mainMastCollar', 0.44, 0.6, 0.72, 14), sternContent);
  mainMastCollar.material = whitePaintMat;
  mainMastCollar.position.set(0, 8.6, 176.86);

  const mainYardarm = trackMesh(buildCylinder('mainYardarm', 0.08, 0.12, 11.0, 10), sternContent);
  mainYardarm.material = spruceMastMat;
  mainYardarm.rotation.z = Math.PI / 2;
  mainYardarm.position.set(0, 36.0, 178.52);

  const sternLanternCap = trackMesh(buildCylinder('sternLanternCap', 0.10, 0.12, 0.22, 10), sternContent);
  sternLanternCap.material = darkIronMat;
  sternLanternCap.position.set(0, 31.5, 178.48);
  const sternLantern = trackMesh(buildSphere('sternLantern', 0.088, 10, 10), sternContent);
  sternLantern.material = warmGlowMat;
  sternLantern.position.set(0, 31.48, 178.55);

  // Matte steel rigging stays (zero specular glare)
  const stayMat = trackMat(
    new THREE.MeshLambertMaterial({
      name: 'titanic_stayMat',
      color: colorFromHex(0x4b5868),
    }),
  );

  const addCable = (tgt: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radius = 0.046) => {
    const c = trackMesh(buildTubeMesh(nextId('cable'), [a, b], 1, radius, 6, false), tgt);
    c.material = stayMat;
  };
  addCable(bowContent, new THREE.Vector3(0, 44.5, -22.5), new THREE.Vector3(0, 10.3, -72.5), 0.056);
  for (const sx of [-10.5, 10.5]) {
    addCable(bowContent, new THREE.Vector3(0, 41.0, -22.5), new THREE.Vector3(sx, 9.2, -42), 0.048);
    addCable(bowContent, new THREE.Vector3(0, 27.0, -22.5), new THREE.Vector3(sx * 1.15, 6.8, -25), 0.048);
    addCable(bowContent, new THREE.Vector3(0, 27.0, -22.5), new THREE.Vector3(sx * 1.15, 6.8, -19), 0.048);
    addCable(sternContent, new THREE.Vector3(0, 41.0, 178.8), new THREE.Vector3(sx * 0.85, 8.6, 173), 0.048);
    addCable(sternContent, new THREE.Vector3(0, 41.0, 178.8), new THREE.Vector3(sx * 0.85, 8.6, 181), 0.048);
  }

  const marconiAerialsGroup = new THREE.Group();
  marconiAerialsGroup.name = 'marconiAerialsGroup';
  hullMeshGroup.add(marconiAerialsGroup);
  for (const mx of [-1.4, -0.46, 0.46, 1.4]) {
    addCable(marconiAerialsGroup, new THREE.Vector3(mx, 46.8, -22.5), new THREE.Vector3(mx, 46.2, 179.0), 0.044);
  }

  // =========================================================================
  // 6A. AUTHENTIC OLYMPIC-CLASS SHIP DETAILS
  // =========================================================================
  const bowNameMat = trackMat(
    makePBR(`${variant}_bowName`, {
      albedoTex: isBritannic ? textures.hullNameplateBritannicBow : textures.hullNameplateBow,
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
    makePBR(`${variant}_sternName`, {
      albedoTex: isBritannic ? textures.hullNameplateBritannicStern : textures.hullNameplateStern,
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
    const { beam, sheerY, flareFactor } = sampleHullStation(z, beamScale);
    const yKeel = sampleKeelY(z);
    const hullFrac = MathUtils.clamp((y - yKeel) / Math.max(0.35, sheerY - yKeel), 0, 1);
    let wr: number;
    if (hullFrac < 0.28) {
      wr = Math.sin(((hullFrac / 0.28) * Math.PI) / 2) * 0.88;
    } else {
      const up = (hullFrac - 0.28) / 0.72;
      wr = 0.88 + up * 0.12 + up * up * flareFactor;
    }
    if (z > 180) {
      const sternU = MathUtils.clamp((z - 180) / 15.1, 0, 1);
      wr *= 1.0 - sternU * 0.08 * (1.0 - hullFrac);
    }
    return beam * wr;
  };

  const yBowPlate = (sampleHullStation(-65.5, beamScale).sheerY + sampleHullStation(-59.5, beamScale).sheerY) * 0.5 - 1.25;
  const xBowFore = evalHullSurfaceX(-65.2, yBowPlate);
  const xBowAft = evalHullSurfaceX(-59.8, yBowPlate);
  const bowSlopeYaw = Math.atan2(xBowAft - xBowFore, 5.4);

  let redCrossMat: THREE.MeshPhysicalMaterial | null = null;
  if (isBritannic) {
    redCrossMat = trackMat(
      makePBR('britannic_redCross', {
        albedoTex: textures.redCrossEmblem,
        emissiveTex: textures.redCrossEmblem,
        emissive: 0xffffff,
        emissiveIntensity: 0.22,
        roughness: 0.42,
        metallic: 0.04,
        doubleSided: true,
        envIntensity: 0.34,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
  }

  for (const side of [-1, 1] as const) {
    const bowPlate = trackMesh(buildPlane(nextId('bowPlate'), 5.8, 1.45), bowContent);
    bowPlate.material = bowNameMat;
    bowPlate.position.set(side * ((xBowFore + xBowAft) * 0.5 + 0.12), yBowPlate, -62.5);
    bowPlate.rotation.y = (side > 0 ? Math.PI / 2 : -Math.PI / 2) + side * bowSlopeYaw;

    const ySternPlate = 7.35;
    const sb1 = evalHullSurfaceX(183.8, ySternPlate);
    const sb2 = evalHullSurfaceX(188.6, ySternPlate);
    const sternYaw = Math.atan2(sb2 - sb1, 4.8);
    const sternPlate = trackMesh(buildPlane(nextId('sternPlate'), 4.6, 1.45), sternContent);
    sternPlate.material = sternNameMat;
    sternPlate.position.set(side * ((sb1 + sb2) * 0.5 + 0.12), ySternPlate, 186.2);
    sternPlate.rotation.y = (side > 0 ? Math.PI / 2 : -Math.PI / 2) + side * sternYaw;

    if (redCrossMat) {
      for (const cz of [-24.0, 52.0, 132.0]) {
        const tgtC = cz < BREAK_Z ? bowContent : sternContent;
        const cy = sampleHullStation(cz, beamScale).sheerY - 2.05;
        const cx1 = evalHullSurfaceX(cz - 3.6, cy);
        const cx2 = evalHullSurfaceX(cz + 3.6, cy);
        const cYaw = Math.atan2(cx2 - cx1, 7.2);
        const crossPlate = trackMesh(buildPlane(nextId('britCrossHull'), 7.6, 3.6), tgtC);
        crossPlate.material = redCrossMat;
        crossPlate.position.set(side * ((cx1 + cx2) * 0.5 + 0.14), cy, cz);
        crossPlate.rotation.y = (side > 0 ? Math.PI / 2 : -Math.PI / 2) + side * cYaw;
      }

      const signBoard = trackMesh(buildBox(nextId('britCrossSign'), 0.22, 1.85, 3.6), bowContent);
      signBoard.material = redCrossMat;
      signBoard.position.set(side * 12.6, 14.55, 73.0);
      for (const sz of [-1.45, 1.45]) {
        const stn = trackMesh(buildCylinder(nextId('britSignPost'), 0.06, 0.06, 1.7, 6), bowContent);
        stn.material = whitePaintMat;
        stn.position.set(side * 12.6, 13.7, 73.0 + sz);
      }
    }
  }

  // Geared Anchor Windlass Machinery
  const windlassGroup = new THREE.Group();
  windlassGroup.name = 'windlassGroup';
  bowContent.add(windlassGroup);
  windlassGroup.position.set(0, 9.2, -59.5);
  const windlassShaft = trackMesh(buildCylinder('windlassShaft', 0.24, 0.24, 5.8, 12), windlassGroup);
  windlassShaft.material = darkIronMat;
  windlassShaft.rotation.z = Math.PI / 2;
  windlassShaft.position.y = 0.65;
  for (const gx of [-2.2, -0.7, 0.7, 2.2]) {
    const gw = trackMesh(buildCylinder(nextId('windGear'), 0.68, 0.68, 0.24, 18), windlassGroup);
    gw.material = Math.abs(gx) < 1 ? bronzeMat : darkIronMat;
    gw.rotation.z = Math.PI / 2;
    gw.position.set(gx, 0.65, 0);
  }
  for (const px of [-2.75, 0, 2.75]) {
    const ped = trackMesh(buildBox(nextId('windPed'), 0.38, 0.9, 1.15), windlassGroup);
    ped.material = darkIronMat;
    ped.position.set(px, 0.45, 0);
  }

  // Twin-Horn Cast-Iron Mooring Bollards (InstancedMesh)
  const bollardPlateProto = buildBox('bollardPlateProto', 0.55, 0.1, 1.1);
  const bollardHornProto = buildCylinder('bollardHornProto', 0.14, 0.12, 0.55, 10);
  const addBollards = (tgt: THREE.Object3D, spots: Array<[number, number, number, number]>, tag: string) => {
    const pSlot = makeSlot(`bPlate_${tag}`, bollardPlateProto, darkIronMat, spots.length, tgt);
    const hSlot = makeSlot(`bHorn_${tag}`, bollardHornProto, darkIronMat, spots.length * 2, tgt);
    let hIdx = 0;
    for (let i = 0; i < spots.length; i++) {
      const [bx, by, bz, ry] = spots[i];
      writeInstanceMatrix(pSlot, i, bx, by + 0.05, bz, 0, ry, 0);
      for (const dz of [-0.28, 0.28]) {
        writeInstanceMatrix(hSlot, hIdx++, bx + Math.sin(ry) * dz, by + 0.34, bz + Math.cos(ry) * dz, 0, ry, 0);
      }
    }
    commitInstanceMatrices(pSlot, spots.length);
    commitInstanceMatrices(hSlot, hIdx);
  };
  addBollards(
    bowContent,
    [
      [-4.2, 9.2, -61.0, 0.32],
      [4.2, 9.2, -61.0, -0.32],
      [-7.6, 9.2, -49.5, 0.24],
      [7.6, 9.2, -49.5, -0.24],
      [-10.6, 9.2, -38.5, 0.12],
      [10.6, 9.2, -38.5, -0.12],
      [-11.8, 6.62, -31.5, 0],
      [11.8, 6.62, -31.5, 0],
      [-11.8, 6.62, -13.5, 0],
      [11.8, 6.62, -13.5, 0],
    ],
    'fwd',
  );
  addBollards(
    sternContent,
    [
      [-11.4, 6.62, 151.5, 0],
      [11.4, 6.62, 151.5, 0],
      [-11.2, 6.62, 166.5, 0],
      [11.2, 6.62, 166.5, 0],
      [-9.2, 8.4, 176.5, -0.18],
      [9.2, 8.4, 176.5, 0.18],
      [-6.6, 8.4, 187.5, -0.35],
      [6.6, 8.4, 187.5, 0.35],
    ],
    'aft',
  );

  // Electric Cargo Winches & Rigged Mast Cargo Derrick Booms
  for (const [wx, wy, wz] of [
    [-4.3, 6.62, -23.0],
    [4.3, 6.62, -23.0],
    [-4.2, 6.62, 159.2],
    [4.2, 6.62, 159.2],
  ]) {
    const wGrp = new THREE.Group();
    wGrp.name = nextId('winch');
    (wz < BREAK_Z ? bowContent : sternContent).add(wGrp);
    wGrp.position.set(wx, wy, wz);
    const frame = trackMesh(buildBox(nextId('wFrame'), 1.65, 0.85, 1.25), wGrp);
    frame.material = darkIronMat;
    frame.position.y = 0.42;
    const drum = trackMesh(buildCylinder(nextId('wDrum'), 0.42, 0.42, 1.35, 12), wGrp);
    drum.material = bronzeMat;
    drum.rotation.z = Math.PI / 2;
    drum.position.y = 0.92;
  }
  for (const side of [-1, 1]) {
    addCable(bowContent, new THREE.Vector3(side * 0.48, 10.6, -22.5), new THREE.Vector3(side * 0.56, 21.2, -23.1), 0.052);
    addCable(sternContent, new THREE.Vector3(side * 0.46, 10.6, 177.8), new THREE.Vector3(side * 0.54, 21.0, 177.2), 0.052);
  }

  // Forward Half-Enclosed A-Deck Promenade (z = -7.5..58.0)
  for (const side of [-1, 1]) {
    const waist = trackMesh(buildBox(nextId('waist'), 0.14, 1.06, 65.5), bowContent);
    waist.material = whitePaintMat;
    waist.position.set(side * 13.36, 10.38, 25.25);

    const topPlate = trackMesh(buildBox(nextId('topPlate'), 0.14, 0.42, 65.5), bowContent);
    topPlate.material = whitePaintMat;
    topPlate.position.set(side * 13.36, 12.40, 25.25);

    const midBar = trackMesh(buildBox(nextId('midBar'), 0.08, 0.09, 65.5), bowContent);
    midBar.material = whitePaintMat;
    midBar.position.set(side * 13.36, 11.55, 25.25);

    const screenGlass = trackMesh(buildPlane(nextId('scrGlass'), 65.3, 1.24), bowContent);
    screenGlass.material = bridgeGlassMat;
    screenGlass.renderOrder = 2;
    screenGlass.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    screenGlass.position.set(side * 13.38, 11.56, 25.25);

    const endScreen = trackMesh(buildBox(nextId('endScr'), 2.2, 2.78, 0.16), bowContent);
    endScreen.material = whitePaintMat;
    endScreen.position.set(side * 12.35, 11.24, -7.45);
  }
  const fwdScreenProto = buildBox('fwdScreenMullions', 0.14, 2.78, 0.28);
  const mulSlot = makeSlot('fwdScreenMullions', fwdScreenProto, whitePaintMat, 34 * 2, bowContent);
  let mIdx = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 34; i++) {
      writeInstanceMatrix(mulSlot, mIdx++, side * 13.38, 11.24, -7.2 + i * 1.97, 0, 0, 0);
    }
  }
  commitInstanceMatrices(mulSlot, mIdx);

  // Continuous Boat Deck Teak-Capped Railings
  for (const side of [-1, 1]) {
    buildRailSegment(bowContent, side * 13.48, 12.88, -9.2, side * 13.48, 12.88, BREAK_Z - 0.12);
    buildRailSegment(sternContent, side * 13.48, 12.88, BREAK_Z + 0.12, side * 13.48, 12.88, 147.2);
  }
  buildRailSegment(sternContent, -12.6, 12.88, 147.8, 12.6, 12.88, 147.8);

  // 4 Engelhardt Collapsible Lifeboats
  const collapHullProto = buildCurvedDeckhouseMesh('collapHullProto', 0.95, -2.55, 2.55, 0.56, 0.72, 0.72, 0.05);
  collapHullProto.material = teakDeckMat;
  trackProtoGeo(collapHullProto.geometry);

  const collapCovProto = buildCurvedDeckhouseMesh('collapCovProto', 0.9, -2.4, 2.4, 0.18, 0.65, 0.65, 0.04);
  collapCovProto.material = creamTrimMat;
  trackProtoGeo(collapCovProto.geometry);

  [
    [-4.3, 15.38, 11.2],
    [4.3, 15.38, 11.2],
    [-9.4, 12.88, 8.2],
    [9.4, 12.88, 8.2],
  ].forEach(([cx, cy, cz], idx) => {
    const cg = new THREE.Group();
    cg.name = `collap_${idx}`;
    bowContent.add(cg);
    cg.position.set(cx, cy, cz);
    trackMesh(
      idx === 0 ? collapHullProto : cloneMeshWithMaterial(collapHullProto, `collapH_${idx}`, teakDeckMat),
      cg,
    );
    const cov = trackMesh(
      idx === 0 ? collapCovProto : cloneMeshWithMaterial(collapCovProto, `collapC_${idx}`, creamTrimMat),
      cg,
    );
    cov.position.y = 0.56;
  });

  // 36 Slatted Teak Steamer Chairs & 24 Red-and-White Lifebuoy Rings (InstancedMesh)
  const chairBackProto = buildBox('chairBackProto', 0.56, 0.06, 1.48);
  const chairLegProto = buildBox('chairLegProto', 0.54, 0.42, 0.78);
  const chairSpots: Array<{ x: number; y: number; z: number; ry: number }> = [];
  for (const side of [-1, 1]) {
    for (let z = 0; z <= 138; z += 8.6) {
      if (Math.abs(z - BREAK_Z) < 1.2) continue;
      chairSpots.push({ x: side * 11.78, y: 9.86, z, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
    }
  }
  [
    { list: chairSpots.filter((c) => c.z < BREAK_Z), tgt: bowContent, tag: 'fwd' },
    { list: chairSpots.filter((c) => c.z >= BREAK_Z), tgt: sternContent, tag: 'aft' },
  ].forEach(({ list, tgt, tag }) => {
    if (list.length === 0) return;
    const bSlot = makeSlot(`chairB_${tag}`, chairBackProto, teakDeckMat, list.length, tgt);
    const lSlot = makeSlot(`chairL_${tag}`, chairLegProto, darkIronMat, list.length, tgt);
    for (let i = 0; i < list.length; i++) {
      const sp = list[i];
      const tilt = sp.x > 0 ? -0.32 : 0.32;
      writeInstanceMatrix(bSlot, i, sp.x, sp.y + 0.42, sp.z, 0, sp.ry, tilt);
      writeInstanceMatrix(lSlot, i, sp.x, sp.y + 0.21, sp.z, 0, sp.ry, 0);
    }
    commitInstanceMatrices(bSlot, list.length);
    commitInstanceMatrices(lSlot, list.length);
  });

  const lifebuoyProto = buildTorusXY('lifebuoyProto', 0.36, 0.085, 8, 16);
  const lifebuoyBandProto = buildCylinder('lifebuoyBandProto', 0.092, 0.092, 0.16, 8);
  lifebuoyBandProto.rotation.z = Math.PI / 2;
  bakeTransform(lifebuoyBandProto);

  const lifebuoyMat = trackMat(makePBR('titanic_lifebuoy', { color: 0xefece6, roughness: 0.56, envIntensity: 0.38 }));
  const buoyBandMat = trackMat(makePBR('titanic_buoyBand', { color: 0xb91c1c, roughness: 0.52, envIntensity: 0.38 }));
  const buoySpots: Array<{ x: number; y: number; z: number; ry: number }> = [];
  for (const side of [-1, 1]) {
    buoySpots.push({ x: side * 15.66, y: 13.72, z: -0.4, ry: side > 0 ? Math.PI / 2 : -Math.PI / 2 });
    for (let z = 6; z <= 142; z += 14.5) {
      if (Math.abs(z - BREAK_Z) < 1.2) continue;
      buoySpots.push({ x: side * 13.48, y: 10.42, z, ry: side > 0 ? Math.PI / 2 : -Math.PI / 2 });
    }
    buoySpots.push({ x: side * 9.5, y: 9.0, z: 181.5, ry: side > 0 ? Math.PI / 2 : -Math.PI / 2 });
  }
  [
    { list: buoySpots.filter((b) => b.z < BREAK_Z), tgt: bowContent, tag: 'fwd' },
    { list: buoySpots.filter((b) => b.z >= BREAK_Z), tgt: sternContent, tag: 'aft' },
  ].forEach(({ list, tgt, tag }) => {
    if (list.length === 0) return;
    const rSlot = makeSlot(`buoyRing_${tag}`, lifebuoyProto, lifebuoyMat, list.length, tgt);
    const bSlot = makeSlot(`buoyBand_${tag}`, lifebuoyBandProto, buoyBandMat, list.length, tgt);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      writeInstanceMatrix(rSlot, i, b.x, b.y, b.z, 0, b.ry, 0);
      writeInstanceMatrix(bSlot, i, b.x, b.y + 0.36, b.z, 0, b.ry, 0);
    }
    commitInstanceMatrices(rSlot, list.length);
    commitInstanceMatrices(bSlot, list.length);
  });

  // Pitched Glazed Skylights atop Lounge & Smoking Room + Marconi Lead-In Spreader
  for (const sz of [69.0, 76.5, 97.5, 105.0]) {
    const tgtSkylight = sz < BREAK_Z ? bowContent : sternContent;
    const coaming = trackMesh(buildBox(nextId('skyCoam'), 2.35, 0.42, 4.4), tgtSkylight);
    coaming.material = whitePaintMat;
    coaming.position.set(0, 15.12, sz);
    const pane = trackMesh(buildBox(nextId('skyPaneG'), 2.05, 0.24, 4.1), tgtSkylight);
    pane.material = bridgeGlassMat;
    pane.renderOrder = 2;
    pane.position.set(0, 15.32, sz);
  }
  const spreader = trackMesh(buildCylinder('spreader', 0.075, 0.075, 3.2, 8), marconiAerialsGroup);
  spreader.material = whitePaintMat;
  spreader.rotation.z = Math.PI / 2;
  spreader.position.set(0, 46.5, 46.65);
  addCable(marconiAerialsGroup, new THREE.Vector3(-0.56, 46.5, 46.65), new THREE.Vector3(-0.52, 15.82, 46.65), 0.044);
  addCable(marconiAerialsGroup, new THREE.Vector3(0.56, 46.5, 46.65), new THREE.Vector3(0.52, 15.82, 46.65), 0.044);

  // Forecastle White Star Burgee Mast & Cruiser Stern Red Ensign Flagstaff
  const bowStaff = trackMesh(buildCylinder('bowStaff', 0.04, 0.075, 5.4, 8), bowContent);
  bowStaff.material = whitePaintMat;
  bowStaff.position.set(0, 11.9, -73.7);
  const wsFlagMat = trackMat(
    makePBR(`${variant}_wsFlag`, {
      albedoTex: isBritannic ? textures.hospitalRedCrossFlag : textures.whiteStarPennant,
      alphaCutOff: isBritannic ? 0 : 0.1,
      roughness: 0.72,
      metallic: 0.02,
      doubleSided: true,
      envIntensity: 0.30,
    }),
  );
  const wsFlag = trackMesh(buildPlane('wsFlag', 2.4, 1.2), bowContent);
  wsFlag.material = wsFlagMat;
  wsFlag.position.set(0.04, 13.9, -72.5);
  wsFlag.rotation.y = Math.PI / 2 + 0.14;

  const sternStaff = trackMesh(buildCylinder('sternStaff', 0.045, 0.08, 6.4, 8), sternContent);
  sternStaff.material = whitePaintMat;
  sternStaff.position.set(0, 11.5, 194.2);
  sternStaff.rotation.x = 0.18;
  const ensignMat = trackMat(
    makePBR('titanic_ensign', {
      albedoTex: textures.redEnsignFlag,
      roughness: 0.72,
      metallic: 0.02,
      doubleSided: true,
      envIntensity: 0.30,
    }),
  );
  const ensignFlag = trackMesh(buildPlane('ensignFlag', 3.2, 1.6), sternContent);
  ensignFlag.material = ensignMat;
  ensignFlag.position.set(0.04, 13.5, 196.1);
  ensignFlag.rotation.y = Math.PI / 2 + 0.12;

  // =========================================================================
  // 6B. EXPOSED TORN STEEL INTERIOR FRACTURE CROSS-SECTIONS (AT z = BREAK_Z)
  // =========================================================================
  const tornSteelMat = trackMat(
    makePBR('titanic_tornSteel', {
      color: 0x1e2228,
      roughness: 0.78,
      metallic: 0.62,
      doubleSided: true,
      envIntensity: 0.36,
    }),
  );
  const tornRustedIronMat = trackMat(
    makePBR('titanic_tornRust', {
      color: 0x3b261d,
      roughness: 0.84,
      metallic: 0.45,
      envIntensity: 0.32,
    }),
  );
  const breakEmberMat = trackMat(
    makePBR('titanic_breakEmber', {
      color: 0xffa44d,
      emissive: 0xff6a1a,
      emissiveIntensity: 1.2,
      roughness: 0.45,
      envIntensity: 0.25,
    }),
  );

  const buildFractureBulkhead = (label: string, dirZ: -1 | 1): THREE.Group => {
    const cap = new THREE.Group();
    cap.name = `breakCap_${label}`;
    cap.position.set(0, 0, BREAK_Z - dirZ * 0.18);

    const hullFaceShape = new Shape2D();
    hullFaceShape.moveTo(0, -6.5);
    hullFaceShape.quadraticCurveTo(11.8, -5.9, 12.3, -2.5, 10);
    hullFaceShape.lineTo(14.0, 6.8);
    hullFaceShape.lineTo(13.4, 6.8);
    hullFaceShape.lineTo(13.4, 9.6);
    hullFaceShape.lineTo(11.35, 9.8);
    hullFaceShape.lineTo(11.35, 12.6);
    hullFaceShape.lineTo(-11.35, 12.6);
    hullFaceShape.lineTo(-11.35, 9.8);
    hullFaceShape.lineTo(-13.4, 9.6);
    hullFaceShape.lineTo(-13.4, 6.8);
    hullFaceShape.lineTo(-14.0, 6.8);
    hullFaceShape.lineTo(-12.3, -2.5);
    hullFaceShape.quadraticCurveTo(-11.8, -5.9, 0, -6.5, 10);

    const faceMesh = trackMesh(buildExtrudedShapeMesh(`bFace_${label}`, hullFaceShape, 0.55, 0), cap);
    faceMesh.material = tornSteelMat;
    faceMesh.position.z = dirZ > 0 ? -0.35 : -0.2;

    for (const dy of [-2.2, 1.4, 4.4, 6.85, 9.75, 12.65]) {
      const w = dy < 6 ? 25.0 : dy < 9 ? 26.4 : 22.4;
      const slab = trackMesh(buildBox(nextId('bSlab'), w, 0.28, 1.35), cap);
      slab.material = tornRustedIronMat;
      slab.position.set(0, dy, dirZ * 0.32);
    }
    for (let rx = -10.5; rx <= 10.5; rx += 3.5) {
      const rib = trackMesh(buildBox(nextId('bRib'), 0.28, 16.2, 0.95), cap);
      rib.material = tornSteelMat;
      rib.position.set(rx, 2.2, dirZ * 0.25);
      rib.rotation.z = (rx / 12) * dirZ * 0.08;
    }

    for (let ji = 0; ji < 16; ji++) {
      const xPos = -12.6 + ji * 1.68;
      const yPos = -3.8 + ((ji * 7) % 15) * 1.05;
      const jutLen = 0.65 + ((ji * 13) % 7) * 0.28;
      const shard = trackMesh(buildCylinder(nextId('bShard'), 0.0, 0.42 + (ji % 3) * 0.18, jutLen, 4), cap);
      shard.material = ji % 2 === 0 ? tornSteelMat : tornRustedIronMat;
      setEulerXYZ(shard, dirZ * (Math.PI / 2 + ((ji % 5) - 2) * 0.14), 0, ((ji % 4) - 1.5) * 0.22);
      shard.position.set(xPos, yPos, dirZ * (jutLen * 0.45 + 0.15));
    }

    for (const [ex, ey] of [
      [-4.8, 3.2],
      [4.8, 3.2],
      [-6.5, 8.2],
      [6.5, 8.2],
      [0, 11.1],
    ]) {
      const ember = trackMesh(buildPlane(nextId('bEmber'), 3.2, 1.45), cap);
      ember.material = breakEmberMat;
      ember.position.set(ex, ey, dirZ * 0.36);
      if (dirZ < 0) ember.rotation.y = Math.PI;
    }

    cap.visible = false;
    return cap;
  };

  const bowBreakCap = companionOnly ? new THREE.Group() : buildFractureBulkhead('bow', 1);
  if (!companionOnly) bowContent.add(bowBreakCap);

  const sternBreakCap = companionOnly ? new THREE.Group() : buildFractureBulkhead('stern', -1);
  if (!companionOnly) sternContent.add(sternBreakCap);

  // =========================================================================
  // 7. WHEELHOUSE INTERIOR (Mahogany, Brass, Chart Table, Helm, Telegraphs)
  // =========================================================================
  const wheelhouse = new THREE.Group();
  wheelhouse.name = 'wheelhouse';
  bowContent.add(wheelhouse);
  wheelhouse.position.set(0, 12.9, 0);

  const whFloor = trackMesh(
    buildCurvedDeckhouseMesh('whFloor', 4.55, -1.65, 3.0, 0.16, 0.58, 0.22, 0.03),
    wheelhouse,
  );
  whFloor.material = teakDeckMat;

  const frontWainscot = trackMesh(
    buildCurvedDeckhouseMesh('frontWainscot', 4.45, -1.7, -1.2, 1.05, 0.58, 0.05, 0.04),
    wheelhouse,
  );
  frontWainscot.material = mahoganyMat;
  frontWainscot.position.y = 0.1;

  const sillTrim = trackMesh(
    buildCurvedDeckhouseMesh('sillTrim', 4.5, -1.73, -1.18, 0.07, 0.58, 0.05, 0.02),
    wheelhouse,
  );
  sillTrim.material = brassMat;
  sillTrim.position.y = 1.14;

  const frontHeader = trackMesh(
    buildCurvedDeckhouseMesh('frontHeader', 4.55, -1.73, -1.18, 0.3, 0.58, 0.05, 0.04),
    wheelhouse,
  );
  frontHeader.material = mahoganyMat;
  frontHeader.position.y = 2.68;

  const whRoof = trackMesh(
    buildCurvedDeckhouseMesh('whRoof', 4.7, -1.8, 3.15, 0.2, 0.62, 0.25, 0.05),
    wheelhouse,
  );
  whRoof.material = mahoganyMat;
  whRoof.position.y = 2.95;

  // Monkey Island Roof Compass Platform
  const monkeyDeck = trackMesh(buildBox('monkeyDeck', 4.4, 0.1, 3.0), wheelhouse);
  monkeyDeck.material = teakDeckMat;
  monkeyDeck.position.set(0, 3.16, 0.85);
  buildRailSegment(wheelhouse, -2.2, 3.21, -0.65, 2.2, 3.21, -0.65);
  buildRailSegment(wheelhouse, -2.2, 3.21, 2.35, 2.2, 3.21, 2.35);
  buildRailSegment(wheelhouse, -2.2, 3.21, -0.65, -2.2, 3.21, 2.35);
  buildRailSegment(wheelhouse, 2.2, 3.21, -0.65, 2.2, 3.21, 2.35);
  for (const mx of [-2.2, 0, 2.2]) {
    for (const mz of [-0.65, 0.85, 2.35]) {
      const mPost = trackMesh(buildCylinder(nextId('mPost'), 0.035, 0.035, 1.04, 6), wheelhouse);
      mPost.material = whitePaintMat;
      mPost.position.set(mx, 3.72, mz);
    }
  }
  const stdBinnaclePed = trackMesh(buildCylinder('stdBinnaclePed', 0.16, 0.22, 1.05, 12), wheelhouse);
  stdBinnaclePed.material = mahoganyMat;
  stdBinnaclePed.position.set(0, 3.72, 0.95);
  const stdBinnacleDome = trackMesh(buildSphere('stdBinnacleDome', 0.18, 12, 10), wheelhouse);
  stdBinnacleDome.material = brassMat;
  stdBinnacleDome.position.set(0, 4.30, 0.95);
  for (const px of [-1.55, 1.55]) {
    const pelorus = trackMesh(buildCylinder(nextId('pelorus'), 0.08, 0.12, 1.0, 10), wheelhouse);
    pelorus.material = brassMat;
    pelorus.position.set(px, 3.7, -0.1);
  }

  for (const bz of [-0.5, 0.55, 1.65]) {
    const beam = trackMesh(buildBox(nextId('whBeam'), 8.7, 0.12, 0.16), wheelhouse);
    beam.material = mahoganyMat;
    beam.position.set(0, 2.9, bz);
  }

  for (const mx of [-4.2, -2.55, -1.05, 1.05, 2.55, 4.2]) {
    const zArc = -1.38 - (1 - Math.pow(mx / 4.5, 2)) * 0.22;
    const mullion = trackMesh(buildCylinder(nextId('whMullion'), 0.055, 0.065, 1.62, 10), wheelhouse);
    mullion.material = mahoganyMat;
    mullion.position.set(mx, 1.94, zArc);

    const brassStrip = trackMesh(buildCylinder(nextId('whBStrip'), 0.022, 0.022, 1.62, 8), wheelhouse);
    brassStrip.material = brassMat;
    brassStrip.position.set(mx, 1.94, zArc + 0.05);
  }

  for (const side of [-1, 1]) {
    const sideLower = trackMesh(buildBox(nextId('whSideLow'), 0.22, 1.16, 4.4), wheelhouse);
    sideLower.material = mahoganyMat;
    sideLower.position.set(side * 4.4, 0.58, 0.85);

    const sideHeader = trackMesh(buildBox(nextId('whSideHead'), 0.22, 0.38, 4.4), wheelhouse);
    sideHeader.material = mahoganyMat;
    sideHeader.position.set(side * 4.4, 2.82, 0.85);

    const aftPost = trackMesh(buildBox(nextId('whAftPost'), 0.24, 1.85, 0.85), wheelhouse);
    aftPost.material = mahoganyMat;
    aftPost.position.set(side * 4.4, 1.94, 2.65);

    for (const wz of [-0.5, 0.55, 1.55]) {
      const sMullion = trackMesh(buildBox(nextId('whSMull'), 0.16, 1.66, 0.12), wheelhouse);
      sMullion.material = mahoganyMat;
      sMullion.position.set(side * 4.4, 1.94, wz);
    }
    const sideGlass = trackMesh(buildPlane(nextId('whSideGlass'), 3.6, 1.62), wheelhouse);
    sideGlass.material = bridgeGlassMat;
    sideGlass.renderOrder = 2;
    sideGlass.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    sideGlass.position.set(side * 4.4, 1.94, 0.45);
  }

  for (const ax of [-2.85, 2.85]) {
    const aftWallPanel = trackMesh(buildBox(nextId('whAftWall'), 3.3, 2.95, 0.24), wheelhouse);
    aftWallPanel.material = mahoganyMat;
    aftWallPanel.position.set(ax, 1.48, 2.95);
  }
  const aftDoorHeader = trackMesh(buildBox('whAftDoorHead', 2.5, 0.72, 0.24), wheelhouse);
  aftDoorHeader.material = mahoganyMat;
  aftDoorHeader.position.set(0, 2.6, 2.95);
  const aftDoorPanel = trackMesh(buildBox('whAftDoor', 2.35, 2.25, 0.14), wheelhouse);
  aftDoorPanel.material = mahoganyMat;
  aftDoorPanel.position.set(0, 1.15, 3.0);

  const frontGlassBounds = [-4.35, -2.55, -1.05, 1.05, 2.55, 4.35];
  for (let gi = 0; gi < frontGlassBounds.length - 1; gi++) {
    const x0 = frontGlassBounds[gi];
    const x1 = frontGlassBounds[gi + 1];
    const z0 = -1.38 - (1 - Math.pow(x0 / 4.5, 2)) * 0.22;
    const z1 = -1.38 - (1 - Math.pow(x1 / 4.5, 2)) * 0.22;
    const paneW = Math.hypot(x1 - x0, z1 - z0);
    const frontPane = trackMesh(buildPlane(nextId('whFrontGlass'), paneW, 1.6), wheelhouse);
    frontPane.material = bridgeGlassMat;
    frontPane.renderOrder = 2;
    frontPane.position.set((x0 + x1) * 0.5, 1.94, (z0 + z1) * 0.5);
    frontPane.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
  }

  // Brass Clinometer
  const clinoCase = trackMesh(buildCylinder('clinoCase', 0.15, 0.15, 0.06, 20), wheelhouse);
  clinoCase.material = brassMat;
  clinoCase.rotation.x = Math.PI / 2;
  clinoCase.position.set(0, 2.79, -1.16);

  const clinoFaceMat = trackMat(
    makePBR('titanic_clinoFace', {
      albedoTex: textures.clinometerDial,
      emissiveTex: textures.clinometerDial,
      emissive: 0xffd79a,
      emissiveIntensity: 0.45,
      roughness: 0.48,
      envIntensity: 0.25,
    }),
  );
  const clinoFace = trackMesh(buildDisc('clinoFace', 0.13, 20), wheelhouse);
  clinoFace.material = clinoFaceMat;
  clinoFace.position.set(0, 2.79, -1.125);

  const clinometerNeedle = trackMesh(buildBox('clinometerNeedle', 0.016, 0.1, 0.01), wheelhouse);
  clinometerNeedle.material = portLightMat;
  clinometerNeedle.position.set(0, 2.79, -1.115);

  // Turned Lathe Ship's Helm Pedestal & 8-Spoke Wheel
  const helmPedProto = buildLatheMesh(
    'helmPedProto',
    [
      new THREE.Vector2(0.28, 0),
      new THREE.Vector2(0.24, 0.12),
      new THREE.Vector2(0.16, 0.25),
      new THREE.Vector2(0.13, 0.72),
      new THREE.Vector2(0.2, 0.96),
      new THREE.Vector2(0.18, 1.08),
    ],
    18,
  );
  helmPedProto.material = mahoganyMat;
  trackProtoGeo(helmPedProto.geometry);

  const helmBase = trackMesh(helmPedProto, wheelhouse, true);
  helmBase.position.set(0, 0.06, 0.18);

  const helmCollar = trackMesh(buildCylinder('helmCollar', 0.19, 0.19, 0.12, 18), wheelhouse);
  helmCollar.material = brassMat;
  helmCollar.position.set(0, 1.05, 0.18);

  const helmIndicatorPlate = trackMesh(buildBox('helmIndPlate', 0.36, 0.04, 0.12), wheelhouse);
  helmIndicatorPlate.material = brassMat;
  helmIndicatorPlate.position.set(0, 1.13, 0.02);

  const rudderNeedle = trackMesh(buildBox('rudderNeedle', 0.03, 0.04, 0.1), wheelhouse);
  rudderNeedle.material = portLightMat;
  rudderNeedle.position.set(0, 1.16, 0.02);

  const helmWheel = new THREE.Group();
  helmWheel.name = 'helmWheel';
  wheelhouse.add(helmWheel);
  helmWheel.position.set(0, 1.06, 0.28);

  const wheelRim = trackMesh(buildTorusXY('helmRim', 0.46, 0.042, 14, 36), helmWheel);
  wheelRim.material = mahoganyMat;
  const wheelOuterBrass = trackMesh(buildTorusXY('helmOuterBrass', 0.46, 0.016, 8, 36), helmWheel);
  wheelOuterBrass.material = brassMat;
  wheelOuterBrass.position.z = 0.03;
  const wheelInnerBrass = trackMesh(buildTorusXY('helmInnerBrass', 0.28, 0.018, 10, 28), helmWheel);
  wheelInnerBrass.material = brassMat;

  const wheelHub = trackMesh(buildCylinder('helmHub', 0.095, 0.095, 0.13, 18), helmWheel);
  wheelHub.material = brassMat;
  wheelHub.rotation.x = Math.PI / 2;

  const spokeProto = buildLatheMesh(
    'helmSpokeProto',
    [
      new THREE.Vector2(0.026, 0),
      new THREE.Vector2(0.018, 0.35),
      new THREE.Vector2(0.028, 0.5),
      new THREE.Vector2(0.022, 0.62),
    ],
    10,
  );
  trackProtoGeo(spokeProto.geometry);
  for (let i = 0; i < 8; i++) {
    const spokeMat = i === 0 ? brassMat : mahoganyMat;
    const spoke = trackMesh(
      i === 0 ? spokeProto : cloneMeshWithMaterial(spokeProto, `helmSpoke_${i}`, spokeMat),
      helmWheel,
    );
    spoke.material = spokeMat;
    spoke.rotation.z = (i * Math.PI) / 4;
  }

  // Kelvin Compass Binnacle
  const binnacleGroup = new THREE.Group();
  binnacleGroup.name = 'binnacleGroup';
  wheelhouse.add(binnacleGroup);
  binnacleGroup.position.set(-0.92, 0.06, -0.32);

  const binnaclePed = trackMesh(cloneMeshWithMaterial(helmPedProto, 'binnaclePed', mahoganyMat), binnacleGroup);
  const binnacleHood = trackMesh(buildCylinder('binnacleHood', 0.21, 0.19, 0.22, 18), binnacleGroup);
  binnacleHood.material = brassMat;
  binnacleHood.position.y = 1.02;
  void binnaclePed;

  for (const sx of [-0.27, 0.27]) {
    const sphere = trackMesh(buildSphere(nextId('binnSph'), 0.075, 14, 14), binnacleGroup);
    sphere.material = brassMat;
    sphere.position.set(sx, 0.98, 0);
  }

  const compassCardMat = trackMat(
    makePBR('titanic_compassCard', {
      albedoTex: textures.compassDial,
      emissiveTex: textures.compassDial,
      emissive: 0xffca7a,
      emissiveIntensity: 0.65,
      roughness: 0.48,
      envIntensity: 0.25,
    }),
  );
  // Dedicated tilted mount so compassCard rotates purely around local Z (card normal)
  const compassMount = new THREE.Group();
  compassMount.name = 'compassMount';
  binnacleGroup.add(compassMount);
  compassMount.position.set(0, 1.14, 0.02);
  compassMount.rotation.x = -Math.PI / 2 + 0.22;
  const compassCard = trackMesh(buildDisc('compassCard', 0.165, 24), compassMount);
  compassCard.material = compassCardMat;

  // Dual Ornate Lathed Chadburn Engine Order Telegraphs
  const telegraphPedProto = buildLatheMesh(
    'telegraphPedProto',
    [
      new THREE.Vector2(0.21, 0),
      new THREE.Vector2(0.18, 0.14),
      new THREE.Vector2(0.09, 0.35),
      new THREE.Vector2(0.075, 0.78),
      new THREE.Vector2(0.11, 0.98),
    ],
    16,
  );
  telegraphPedProto.material = brassMat;
  trackProtoGeo(telegraphPedProto.geometry);

  const telegraphDialMats: THREE.MeshPhysicalMaterial[] = [];
  const makeTelegraph = (xPos: number, idx: number): THREE.Group => {
    const tGroup = new THREE.Group();
    tGroup.name = `telegraph_${idx}`;
    wheelhouse.add(tGroup);
    tGroup.position.set(xPos, 0.06, -0.32);

    trackMesh(
      idx === 0 ? telegraphPedProto : cloneMeshWithMaterial(telegraphPedProto, `tPed_${idx}`, brassMat),
      tGroup,
    );

    const drum = trackMesh(buildCylinder(nextId('tDrum'), 0.23, 0.23, 0.16, 20), tGroup);
    drum.material = brassMat;
    drum.rotation.z = Math.PI / 2;
    drum.position.y = 1.12;

    const dialMat = trackMat(
      makePBR(`titanic_telDial_${idx}`, {
        albedoTex: textures.telegraphDial,
        emissiveTex: textures.telegraphDial,
        emissive: 0xffd79a,
        emissiveIntensity: 0.55,
        roughness: 0.46,
        envIntensity: 0.25,
      }),
    );
    telegraphDialMats.push(dialMat);
    const dialFace = trackMesh(buildDisc(nextId('tDialFace'), 0.205, 24), tGroup);
    dialFace.material = dialMat;
    dialFace.rotation.y = xPos > 0 ? -Math.PI / 2 : Math.PI / 2;
    dialFace.position.set(xPos > 0 ? -0.085 : 0.085, 1.12, 0);

    const leverPivot = new THREE.Group();
    leverPivot.name = `tLever_${idx}`;
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

  // Aft Chart Table with Rolled Maritime Chart
  const chartTableTop = trackMesh(buildBox('chartTableTop', 2.1, 0.08, 0.95), wheelhouse);
  chartTableTop.material = mahoganyMat;
  chartTableTop.position.set(-2.4, 0.96, 1.75);
  for (const lx of [-3.35, -1.45]) {
    for (const lz of [1.35, 2.15]) {
      const leg = trackMesh(buildCylinder(nextId('ctLeg'), 0.035, 0.028, 0.92, 8), wheelhouse);
      leg.material = mahoganyMat;
      leg.position.set(lx, 0.48, lz);
    }
  }
  const rolledChart = trackMesh(buildCylinder('rolledChart', 0.055, 0.055, 0.72, 10), wheelhouse);
  rolledChart.material = creamTrimMat;
  rolledChart.rotation.z = Math.PI / 2;
  rolledChart.position.set(-2.4, 1.05, 1.65);

  // Brass Speaking Tube
  const speakTube = trackMesh(
    buildTubeMesh(
      'speakingTube',
      [
        new THREE.Vector3(-1.35, 0.06, -1.24),
        new THREE.Vector3(-1.35, 1.05, -1.24),
        new THREE.Vector3(-1.35, 1.44, -1.16),
        new THREE.Vector3(-1.3, 1.54, -1.04),
      ],
      16,
      0.024,
      8,
      true,
    ),
    wheelhouse,
  );
  speakTube.material = brassMat;
  const speakFlange = trackMesh(buildCylinder('speakFlange', 0.055, 0.065, 0.06, 10), wheelhouse);
  speakFlange.material = brassMat;
  speakFlange.position.set(-1.35, 0.08, -1.24);
  const speakMouth = trackMesh(buildCylinder('speakMouth', 0.048, 0.024, 0.08, 12), wheelhouse);
  speakMouth.material = brassMat;
  speakMouth.rotation.x = Math.PI / 2 - 0.3;
  speakMouth.position.set(-1.29, 1.55, -1.01);

  for (const lx of [-1.4, 1.4]) {
    const fixture = trackMesh(buildCylinder(nextId('whFix'), 0.08, 0.11, 0.14, 10), wheelhouse);
    fixture.material = brassMat;
    fixture.position.set(lx, 2.88, -0.3);

    const bulb = trackMesh(buildSphere(nextId('whBulb'), 0.055, 10, 10), wheelhouse);
    bulb.material = warmGlowMat;
    bulb.position.set(lx, 2.79, -0.3);
  }

  const warmBridgeLight = new THREE.PointLight(0xffad58, 6.5, 14.0, 1.0);
  warmBridgeLight.name = 'warmBridgeLight';
  warmBridgeLight.position.set(0, 15.4, 0.1);
  bowContent.add(warmBridgeLight);

  const boatDeckGlowFwd = new THREE.PointLight(0xffb86b, 18.0, 115, 1.0);
  boatDeckGlowFwd.name = 'boatDeckGlowFwd';
  boatDeckGlowFwd.position.set(0, 16.5, 42);
  bowContent.add(boatDeckGlowFwd);

  const whFloodMat = trackMat(
    makePBR('titanic_whFlood', {
      color: 0x092238,
      roughness: 0.25,
      metallic: 0.22,
      alpha: 0.84,
      doubleSided: true,
      envIntensity: 0.32,
    }),
  );
  const whFloodMesh = trackMesh(buildPlane('whFloodMesh', 8.7, 5.0), wheelhouse);
  whFloodMesh.material = whFloodMat;
  whFloodMesh.rotation.x = -Math.PI / 2;
  whFloodMesh.position.set(0, 0.02, 0.45);
  whFloodMesh.visible = false;

  // =========================================================================
  // 8. ACCESSIBLE HISTORICAL INTERIOR DECKS & PROPULSION SPACES
  // =========================================================================
  const crankshafts: THREE.Group[] = [];
  const pistonRods: THREE.Mesh[] = [];
  let stairLight: THREE.PointLight | null = null;
  let marconiLight: THREE.PointLight | null = null;
  let loungeLight: THREE.PointLight | null = null;
  let diningLight: THREE.PointLight | null = null;
  let engineLight: THREE.PointLight | null = null;

  if (!companionOnly) {
  // --- A. FIRST CLASS GRAND STAIRCASE ATRIUM ---
  const stairGroup = new THREE.Group();
  stairGroup.name = 'stairGroup';
  bowContent.add(stairGroup);

  for (const wallX of [-5.58, 5.58]) {
    const sWall = trackMesh(buildBox(nextId('sWall'), 0.24, 10.6, 11.3), stairGroup);
    sWall.material = mahoganyMat;
    sWall.position.set(wallX, 7.6, 33.2);
  }
  const sFwdWall = trackMesh(buildBox('sFwdWall', 11.3, 10.6, 0.24), stairGroup);
  sFwdWall.material = mahoganyMat;
  sFwdWall.position.set(0, 7.6, 27.65);
  const sAftWall = trackMesh(buildBox('sAftWall', 11.3, 10.6, 0.24), stairGroup);
  sAftWall.material = mahoganyMat;
  sAftWall.position.set(0, 7.6, 38.75);

  for (const ly of [2.4, 6.74, 9.86, 12.88]) {
    const mainLanding = trackMesh(buildBox(nextId('stLanding'), 11.0, 0.22, 3.2), stairGroup);
    mainLanding.material = interiorMarbleMat;
    mainLanding.position.set(0, ly - 0.08, 37.1);
    if (ly > 3) {
      const foreGallery = trackMesh(buildBox(nextId('stGal'), 11.0, 0.22, 2.6), stairGroup);
      foreGallery.material = mahoganyMat;
      foreGallery.position.set(0, ly - 0.08, 29.0);

      const balRail = trackMesh(buildBox(nextId('stBalRail'), 10.8, 0.1, 0.14), stairGroup);
      balRail.material = brassMat;
      balRail.position.set(0, ly + 0.92, 30.3);
      for (let bx = -4.8; bx <= 4.8; bx += 1.2) {
        const post = trackMesh(buildCylinder(nextId('stBalPost'), 0.035, 0.045, 0.92, 6), stairGroup);
        post.material = brassMat;
        post.position.set(bx, ly + 0.46, 30.3);
      }
    }
  }

  const stepProto = buildBox('stairStepProto', 2.6, 0.16, 0.34);
  stepProto.material = mahoganyMat;
  trackProtoGeo(stepProto.geometry);

  let stepIdx = 0;
  for (const [yBot, yTop, zStart, zDir] of [
    [2.4, 6.74, 30.4, 1],
    [6.74, 9.86, 30.6, 1],
    [9.86, 12.88, 30.8, 1],
  ] as const) {
    const steps = 11;
    for (let s = 0; s < steps; s++) {
      const t = s / (steps - 1);
      const sy = MathUtils.lerp(yBot, yTop, t);
      const sz = zStart + zDir * t * 4.4;
      const step = trackMesh(
        stepIdx === 0 ? stepProto : cloneMeshWithMaterial(stepProto, `stStep_${stepIdx}`, mahoganyMat),
        stairGroup,
      );
      stepIdx++;
      step.position.set(0, sy, sz);
    }
    for (const sx of [-1.28, 1.28]) {
      const incline = trackMesh(buildBox(nextId('stInc'), 0.08, 0.12, 5.4), stairGroup);
      incline.material = brassMat;
      incline.position.set(sx, (yBot + yTop) * 0.5 + 0.72, zStart + 2.2);
      incline.rotation.x = Math.atan2(yTop - yBot, 4.4);
    }
  }

  const clockFrame = trackMesh(buildBox('stClockFrame', 2.8, 2.2, 0.25), stairGroup);
  clockFrame.material = mahoganyMat;
  clockFrame.position.set(0, 11.4, 27.85);
  const clockDial = trackMesh(buildDisc('stClockDial', 0.62, 20), stairGroup);
  clockDial.material = warmGlowMat;
  clockDial.position.set(0, 11.45, 28.0);
  const newelPed = trackMesh(buildCylinder('stNewelPed', 0.22, 0.28, 1.25, 10), stairGroup);
  newelPed.material = bronzeMat;
  newelPed.position.set(0, 10.5, 30.4);
  const newelGlobe = trackMesh(buildSphere('stNewelGlobe', 0.24, 12, 12), stairGroup);
  newelGlobe.material = warmGlowMat;
  newelGlobe.position.set(0, 11.32, 30.4);

  stairLight = new THREE.PointLight(0xffcb7d, 18.0, 26, 1.0);
  stairLight.name = 'stairLight';
  stairLight.position.set(0, 13.9, 33.2);
  bowContent.add(stairLight);

  // --- B. MARCONI WIRELESS SHACK & GYMNASIUM ---
  const marconiGroup = new THREE.Group();
  marconiGroup.name = 'marconiGroup';
  bowContent.add(marconiGroup);

  const radioDesk = trackMesh(buildBox('radioDesk', 2.6, 0.82, 1.05), marconiGroup);
  radioDesk.material = mahoganyMat;
  radioDesk.position.set(2.4, 13.38, 45.2);
  const sparkCoilBox = trackMesh(buildBox('sparkCoilBox', 0.95, 0.65, 0.55), marconiGroup);
  sparkCoilBox.material = darkIronMat;
  sparkCoilBox.position.set(2.4, 14.1, 44.95);
  const sparkGlow = trackMesh(buildSphere('sparkGlow', 0.11, 8, 8), marconiGroup);
  sparkGlow.material = warmGlowMat;
  sparkGlow.position.set(2.4, 14.2, 45.28);
  const morseKey = trackMesh(buildBox('morseKey', 0.24, 0.08, 0.36), marconiGroup);
  morseKey.material = brassMat;
  morseKey.position.set(2.1, 13.84, 45.55);

  const gymDivider = trackMesh(buildBox('gymDivider', 0.2, 2.05, 6.2), marconiGroup);
  gymDivider.material = interiorPanelMat;
  gymDivider.position.set(-0.6, 13.98, 45.2);
  for (const gz of [44.2, 48.0]) {
    const cycleFrame = trackMesh(buildTorusXY(nextId('cycle'), 0.36, 0.045, 8, 16), marconiGroup);
    cycleFrame.material = darkIronMat;
    cycleFrame.rotation.y = Math.PI / 2;
    cycleFrame.position.set(-3.1, 13.45, gz);
    const handle = trackMesh(buildCylinder(nextId('cycH'), 0.03, 0.03, 0.68, 8), marconiGroup);
    handle.material = brassMat;
    handle.position.set(-3.1, 13.86, gz - 0.25);
    handle.rotation.z = Math.PI / 2;
  }
  marconiLight = new THREE.PointLight(0xffd28c, 14.0, 18, 1.0);
  marconiLight.name = 'marconiLight';
  marconiLight.position.set(0.5, 14.72, 46.8);
  bowContent.add(marconiLight);

  // --- C. A-DECK FIRST CLASS LOUNGE ---
  const loungeGroup = new THREE.Group();
  loungeGroup.name = 'loungeGroup';
  bowContent.add(loungeGroup);

  const loungeFloor = trackMesh(buildBox('loungeFloor', 21.6, 0.14, 17.3), loungeGroup);
  loungeFloor.material = crimsonVelvetMat;
  loungeFloor.position.set(0, 9.88, 72.75);

  for (const lz of [64.15, 81.35]) {
    const endWall = trackMesh(buildBox(nextId('lngEnd'), 21.8, 2.68, 0.28), loungeGroup);
    endWall.material = interiorPanelMat;
    endWall.position.set(0, 11.2, lz);
  }
  const fireplace = trackMesh(buildBox('lngFireplace', 3.2, 1.9, 0.65), loungeGroup);
  fireplace.material = interiorMarbleMat;
  fireplace.position.set(0, 10.85, 64.5);
  const hearthGlow = trackMesh(buildBox('lngHearth', 1.1, 0.68, 0.28), loungeGroup);
  hearthGlow.material = warmGlowMat;
  hearthGlow.position.set(0, 10.35, 64.82);

  for (const sx of [-6.4, 0, 6.4]) {
    for (const sz of [68.8, 76.2]) {
      const tableTop = trackMesh(buildCylinder(nextId('lngTblTop'), 0.95, 0.95, 0.08, 16), loungeGroup);
      tableTop.material = mahoganyMat;
      tableTop.position.set(sx, 10.65, sz);
      const tableLeg = trackMesh(buildCylinder(nextId('lngTblLeg'), 0.12, 0.28, 0.72, 10), loungeGroup);
      tableLeg.material = mahoganyMat;
      tableLeg.position.set(sx, 10.28, sz);
      const lamp = trackMesh(buildSphere(nextId('lngLamp'), 0.16, 10, 10), loungeGroup);
      lamp.material = warmGlowMat;
      lamp.position.set(sx, 10.88, sz);

      for (const side of [-1, 1]) {
        const sofa = trackMesh(buildBox(nextId('lngSofa'), 1.75, 0.62, 0.85), loungeGroup);
        sofa.material = crimsonVelvetMat;
        sofa.position.set(sx, 10.22, sz + side * 1.45);
      }
    }
  }
  loungeLight = new THREE.PointLight(0xffcb78, 16.0, 26, 1.0);
  loungeLight.name = 'loungeLight';
  loungeLight.position.set(0, 12.25, 72.8);
  bowContent.add(loungeLight);

  // --- D. D-DECK FIRST CLASS DINING SALOON ---
  const diningGroup = new THREE.Group();
  diningGroup.name = 'diningGroup';
  bowContent.add(diningGroup);

  const diningFloor = trackMesh(buildBox('diningFloor', 23.6, 0.22, 27.0), diningGroup);
  diningFloor.material = interiorMarbleMat;
  diningFloor.position.set(0, 2.32, 53.0);

  const diningCeiling = trackMesh(buildBox('diningCeiling', 23.6, 0.2, 27.0), diningGroup);
  diningCeiling.material = creamTrimMat;
  diningCeiling.position.set(0, 6.4, 53.0);

  for (const dz of [39.6, 66.4]) {
    const dWall = trackMesh(buildBox(nextId('dinWallZ'), 23.6, 4.0, 0.28), diningGroup);
    dWall.material = interiorPanelMat;
    dWall.position.set(0, 4.35, dz);
  }
  for (const side of [-1, 1]) {
    const sWall = trackMesh(buildBox(nextId('dinWallX'), 0.28, 4.0, 27.0), diningGroup);
    sWall.material = interiorPanelMat;
    sWall.position.set(side * 11.75, 4.35, 53.0);
    for (let wz = 42.5; wz <= 63.5; wz += 4.2) {
      const bay = trackMesh(buildPlane(nextId('dinBay'), 2.1, 1.7), diningGroup);
      bay.material = warmGlowMat;
      bay.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      bay.position.set(side * 11.58, 4.75, wz);
    }
  }

  const dColProto = buildCylinder('dColProto', 0.28, 0.34, 4.0, 12);
  dColProto.material = creamTrimMat;
  trackProtoGeo(dColProto.geometry);

  let colIdx = 0;
  for (const cx of [-6.8, -2.4, 2.4, 6.8]) {
    for (let cz = 43.0; cz <= 63.0; cz += 5.0) {
      const col = trackMesh(
        colIdx === 0 ? dColProto : cloneMeshWithMaterial(dColProto, `dinCol_${colIdx}`, creamTrimMat),
        diningGroup,
      );
      colIdx++;
      col.position.set(cx, 4.35, cz);
    }
  }

  const diningTableSpots: Array<[number, number]> = [];
  for (const tx of [-8.8, -4.6, 0, 4.6, 8.8]) {
    for (let tz = 42.2; tz <= 63.8; tz += 4.3) {
      diningTableSpots.push([tx, tz]);
    }
  }
  const dTableProto = buildBox('dinTables', 1.75, 0.14, 1.75);
  const dLampProto = buildSphere('dinLamps', 0.11, 8, 8);
  const dChairProto = buildBox('dinChairs', 0.54, 0.72, 0.54);

  const tmSlot = makeSlot('dinTables', dTableProto, linenClothMat, diningTableSpots.length, diningGroup);
  const lmSlot = makeSlot('dinLamps', dLampProto, warmGlowMat, diningTableSpots.length, diningGroup);
  const cmSlot = makeSlot('dinChairs', dChairProto, crimsonVelvetMat, diningTableSpots.length * 4, diningGroup);
  let dcIdx = 0;
  for (let i = 0; i < diningTableSpots.length; i++) {
    const [tx, tz] = diningTableSpots[i];
    writeInstanceMatrix(tmSlot, i, tx, 3.16, tz, 0, 0, 0);
    writeInstanceMatrix(lmSlot, i, tx, 3.44, tz, 0, 0, 0);
    for (const [ox, oz] of [
      [-1.08, 0],
      [1.08, 0],
      [0, -1.08],
      [0, 1.08],
    ]) {
      writeInstanceMatrix(cmSlot, dcIdx++, tx + ox, 2.78, tz + oz, 0, 0, 0);
    }
  }
  commitInstanceMatrices(tmSlot, diningTableSpots.length);
  commitInstanceMatrices(lmSlot, diningTableSpots.length);
  commitInstanceMatrices(cmSlot, dcIdx);

  diningLight = new THREE.PointLight(0xffcc7e, 20.0, 32, 1.0);
  diningLight.name = 'diningLight';
  diningLight.position.set(0, 5.75, 53.0);
  bowContent.add(diningLight);

  // --- E. AFT RECIPROCATING STEAM ENGINE ROOM ---
  const engineRoomGroup = new THREE.Group();
  engineRoomGroup.name = 'engineRoomGroup';
  sternContent.add(engineRoomGroup);

  const engFloor = trackMesh(buildBox('engFloor', 19.0, 0.35, 28.0), engineRoomGroup);
  engFloor.material = darkIronMat;
  engFloor.position.set(0, -3.55, 107.7);

  for (const ez of [93.7, 121.7]) {
    const bulk = trackMesh(buildBox(nextId('engBulk'), 19.0, 13.0, 0.35), engineRoomGroup);
    bulk.material = darkIronMat;
    bulk.position.set(0, 2.95, ez);
  }
  for (const side of [-1, 1]) {
    const casingSide = trackMesh(buildBox(nextId('engCasing'), 0.32, 13.0, 28.0), engineRoomGroup);
    casingSide.material = darkIronMat;
    casingSide.position.set(side * 9.3, 2.95, 107.7);

    for (const cy of [1.65, 5.45]) {
      const catwalk = trackMesh(buildBox(nextId('engCat'), 1.85, 0.14, 26.8), engineRoomGroup);
      catwalk.material = polishedSteelMat;
      catwalk.position.set(side * 8.2, cy, 107.7);
      const rail = trackMesh(buildBox(nextId('engRail'), 0.06, 0.92, 26.8), engineRoomGroup);
      rail.material = brassMat;
      rail.position.set(side * 7.3, cy + 0.48, 107.7);
    }
  }

  for (const side of [-1, 1]) {
    const engX = side * 3.8;
    const bedplate = trackMesh(buildBox(nextId('engBed'), 4.2, 1.2, 20.5), engineRoomGroup);
    bedplate.material = engineGreenMat;
    bedplate.position.set(engX, -2.8, 107.7);

    const crankGrp = new THREE.Group();
    crankGrp.name = nextId('crank');
    engineRoomGroup.add(crankGrp);
    crankGrp.position.set(engX, -1.6, 107.7);
    const shaft = trackMesh(buildCylinder(nextId('crShaft'), 0.28, 0.28, 22.5, 12), crankGrp);
    shaft.material = polishedSteelMat;
    shaft.rotation.x = Math.PI / 2;
    for (let ci = 0; ci < 4; ci++) {
      const cz = -6.75 + ci * 4.5;
      const web = trackMesh(buildBox(nextId('crWeb'), 0.38, 1.35, 0.55), crankGrp);
      web.material = polishedSteelMat;
      web.position.set(0, 0.45, cz);
      web.rotation.z = (ci * Math.PI) / 2;
    }
    crankshafts.push(crankGrp);

    for (let ci = 0; ci < 4; ci++) {
      const cz = 101.0 + ci * 4.5;
      const cylRadius = 0.95 + (ci === 3 ? 0.35 : ci === 0 ? -0.15 : 0.1);
      const cylinder = trackMesh(buildCylinder(nextId('engCyl'), cylRadius, cylRadius, 3.4, 18), engineRoomGroup);
      cylinder.material = engineGreenMat;
      cylinder.position.set(engX, 5.2, cz);

      const head = trackMesh(
        buildCylinder(nextId('engHead'), cylRadius * 1.04, cylRadius * 1.04, 0.38, 18),
        engineRoomGroup,
      );
      head.material = brassMat;
      head.position.set(engX, 7.05, cz);

      for (const ax of [-1.55, 1.55]) {
        const frameLeg = trackMesh(buildBox(nextId('engLeg'), 0.45, 6.2, 0.52), engineRoomGroup);
        frameLeg.material = engineGreenMat;
        frameLeg.position.set(engX + ax, 0.8, cz);
        frameLeg.rotation.z = ax > 0 ? 0.12 : -0.12;
      }

      const rod = trackMesh(buildCylinder(nextId('engRod'), 0.14, 0.14, 4.6, 10), engineRoomGroup);
      rod.material = polishedSteelMat;
      rod.position.set(engX, 1.35, cz);
      pistonRods.push(rod);
    }

    const steamMain = trackMesh(buildCylinder(nextId('steamMain'), 0.36, 0.36, 23.0, 14), engineRoomGroup);
    steamMain.material = pipeLaggingMat;
    steamMain.rotation.x = Math.PI / 2;
    steamMain.position.set(engX, 7.65, 107.7);
    for (let fz = 97.5; fz <= 118.0; fz += 4.1) {
      const flange = trackMesh(buildCylinder(nextId('stFlange'), 0.44, 0.44, 0.14, 14), engineRoomGroup);
      flange.material = brassMat;
      flange.rotation.x = Math.PI / 2;
      flange.position.set(engX, 7.65, fz);
    }
  }

  const turbineCasing = trackMesh(buildCylinder('turbineCasing', 1.55, 1.72, 4.6, 18), engineRoomGroup);
  turbineCasing.material = engineGreenMat;
  turbineCasing.rotation.x = Math.PI / 2;
  turbineCasing.position.set(0, -1.75, 118.4);
  const turbinePed = trackMesh(buildBox('turbinePed', 3.4, 1.3, 5.0), engineRoomGroup);
  turbinePed.material = darkIronMat;
  turbinePed.position.set(0, -2.85, 118.4);
  for (const tz of [116.5, 118.4, 120.3]) {
    const tBand = trackMesh(buildTorusXY(nextId('tBand'), 1.66, 0.06, 8, 22), engineRoomGroup);
    tBand.material = brassMat;
    tBand.position.set(0, -1.75, tz);
  }
  const controlStand = trackMesh(buildBox('controlStand', 1.9, 0.95, 1.1), engineRoomGroup);
  controlStand.material = darkIronMat;
  controlStand.position.set(0, -2.92, 105.5);
  for (const gx of [-0.5, 0, 0.5]) {
    const gauge = trackMesh(buildCylinder(nextId('engGauge'), 0.14, 0.14, 0.08, 12), engineRoomGroup);
    gauge.material = brassMat;
    gauge.rotation.x = Math.PI / 2;
    gauge.position.set(gx, -2.18, 105.5);
  }
  for (const side of [-1, 1]) {
    for (const lz of [98.5, 105.5, 112.5, 118.5]) {
      const lamp = trackMesh(buildSphere(nextId('engLamp'), 0.14, 8, 8), engineRoomGroup);
      lamp.material = warmGlowMat;
      lamp.position.set(side * 8.9, 6.2, lz);
    }
  }

  engineLight = new THREE.PointLight(0xffbe66, 22.0, 32, 1.0);
  engineLight.name = 'engineLight';
  engineLight.position.set(0, 6.8, 108.0);
  sternContent.add(engineLight);
  }

  // =========================================================================
  // 9. EXTRA EXTERIOR BRIDGE & FORECASTLE CLARITY DETAILS
  // =========================================================================
  const bellArch = trackMesh(buildTorusXY('bellArch', 0.55, 0.055, 8, 16, Math.PI), bowContent);
  bellArch.material = darkIronMat;
  bellArch.position.set(0, 10.1, -48.5);
  for (const bx of [-0.55, 0.55]) {
    const leg = trackMesh(buildCylinder(nextId('bellLeg'), 0.045, 0.06, 0.95, 8), bowContent);
    leg.material = darkIronMat;
    leg.position.set(bx, 9.65, -48.5);
  }
  const shipBell = trackMesh(buildCylinder('shipBell', 0.14, 0.28, 0.42, 14), bowContent);
  shipBell.material = brassMat;
  shipBell.position.set(0, 10.35, -48.5);

  for (const side of [-1, 1]) {
    const wingTelPed = trackMesh(buildCylinder(nextId('wingTelPed'), 0.1, 0.16, 0.98, 12), bowContent);
    wingTelPed.material = brassMat;
    wingTelPed.position.set(side * 14.3, 13.38, -1.65);
    const wingTelHead = trackMesh(buildCylinder(nextId('wingTelHead'), 0.2, 0.2, 0.14, 16), bowContent);
    wingTelHead.material = brassMat;
    wingTelHead.rotation.z = Math.PI / 2;
    wingTelHead.position.set(side * 14.3, 13.95, -1.65);
  }

  let enginePhase = 0;
  const setEngineSpeed = (knots: number, dt: number) => {
    if (companionOnly) return;
    enginePhase += knots * dt * 0.65;
    for (let i = 0; i < crankshafts.length; i++) {
      crankshafts[i].rotation.z = enginePhase * (i === 0 ? 1 : -1);
    }
    for (let i = 0; i < pistonRods.length; i++) {
      const cyc = enginePhase + (i % 4) * (Math.PI / 2);
      pistonRods[i].position.y = 1.25 + Math.sin(cyc) * 0.72;
    }
  };

  // Bridge Roof Searchlight Projector, Brass Yoke Pedestal & Volumetric Fresnel Beam Cone
  const slPedestal = trackMesh(buildCylinder('slPedestal', 0.14, 0.24, 0.34, 12), bowContent);
  slPedestal.material = brassMat;
  slPedestal.position.set(0, 16.02, -1.2);

  const searchlightHead = new THREE.Group();
  searchlightHead.name = 'searchlightHead';
  bowContent.add(searchlightHead);
  searchlightHead.position.set(0, 16.28, -1.2);
  const slHousing = trackMesh(buildCylinder('slHousing', 0.32, 0.28, 0.72, 14), searchlightHead);
  slHousing.material = brassMat;
  slHousing.rotation.x = Math.PI / 2;
  const slLens = trackMesh(buildDisc('slLens', 0.27, 14), searchlightHead);
  slLens.material = warmGlowMat;
  slLens.rotation.y = Math.PI;
  slLens.position.z = -0.37;

  const searchlightOrigin = new THREE.Object3D();
  searchlightOrigin.name = 'searchlightOrigin';
  searchlightOrigin.position.set(0, 0, -0.4);
  searchlightHead.add(searchlightOrigin);

  // Subtle Volumetric Fresnel Searchlight Cone (zero harsh solid polygon edges)
  const beamUniforms = {
    uOpacity: { value: 0.0 },
  };
  let searchlightBeam: THREE.Mesh | null = null;
  if (!companionOnly) {
    const beamGeo = new THREE.CylinderGeometry(0.28, 8.6, 125, 24, 1, true);
    beamGeo.rotateX(Math.PI / 2);
    beamGeo.translate(0, 0, -62.9);
    const beamMat = trackMat(
      new THREE.ShaderMaterial({
        name: 'titanic_searchlightBeam',
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
    searchlightBeam.name = 'searchlightBeam';
    searchlightBeam.receiveShadow = false;
    searchlightBeam.castShadow = false;
    searchlightBeam.renderOrder = 4;
    searchlightBeam.visible = false;
  }

  const searchlightTarget = new THREE.Object3D();
  searchlightTarget.name = 'searchlightTarget';
  bowContent.add(searchlightTarget);
  searchlightTarget.position.set(0, 1.5, -150);

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
    if (redCrossMat) {
      redCrossMat.emissiveIntensity = 0.08 + 0.32 * p;
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
