import * as THREE from 'three';
import {
  InstancedSlot,
  MathUtils,
  Shape2D,
  bakeAndMergeMeshes,
  bakeTransform,
  buildBox,
  buildCylinder,
  buildDisc,
  buildExtrudedShapeMesh,
  buildPlane,
  buildSphere,
  buildTorusXY,
  buildTubeMesh,
  commitInstanceColors,
  commitInstanceMatrices,
  createInstancedSlot,
  makePBR,
  setInstanceColorHex,
  writeInstanceMatrix,
  writeZeroInstanceMatrix,
} from './threeHelpers';
import { ProceduralTextureSet } from './textures';

export const CARPATHIA_BREAK_Z = 10.0;

export interface CarpathiaRig {
  root: THREE.Group;
  hullMeshGroup: THREE.Group;
  bowGroup: THREE.Group;
  sternGroup: THREE.Group;
  shadowCasters: THREE.Object3D[];
  boardingStationsLocal: Array<{ x: number; y: number; z: number; side: -1 | 1 }>;
  setRescueState: (
    time: number,
    boardedRatio: number,
    laddersDeployed: boolean,
    searchlightSweep: boolean,
  ) => void;
  setBreakupVisual: (broken: boolean, emberPower?: number) => void;
  reset: () => void;
  dispose: () => void;
}

function sampleCarpathiaStation(z: number): {
  beam: number;
  sheerY: number;
  flare: number;
} {
  let beam = 9.8;
  let flare = 0.05;

  if (z < -26) {
    const t = MathUtils.clamp((z - -85) / 59, 0, 1);
    beam = 9.8 * Math.pow(Math.sin((t * Math.PI) / 2), 0.78);
    flare = 0.24 * (1 - t) + 0.04;
  } else if (z > 42) {
    const t = MathUtils.clamp((85 - z) / 43, 0, 1);
    beam = 9.8 * Math.pow(Math.sin((t * Math.PI) / 2), 0.68);
    flare = 0.14 * (1 - t) + 0.04;
  }

  let sheerY = 5.6;
  if (z < -48) {
    const t = MathUtils.clamp((-48 - z) / 37, 0, 1);
    sheerY = 7.4 + t * 0.8;
  } else if (z < -30) {
    sheerY = 5.4;
  } else if (z > 52) {
    const t = MathUtils.clamp((z - 52) / 33, 0, 1);
    sheerY = 6.4 + t * 0.75;
  }

  return { beam, sheerY, flare };
}

function buildLoftedHull(
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

  const evalVertex = (z: number, side: number, frac: number): [number, number, number, number, number] => {
    const { beam, sheerY, flare } = sampleCarpathiaStation(z);
    const vCoord = (z + 85) / 170;
    const y = MathUtils.lerp(-5.2, sheerY, frac);
    let widthRatio: number;
    if (frac < 0.28) {
      widthRatio = Math.sin(((frac / 0.28) * Math.PI) / 2) * 0.88;
    } else {
      const up = (frac - 0.28) / 0.72;
      widthRatio = 0.88 + up * 0.12 + up * up * flare;
    }
    const bowRake = z <= -82 ? -(frac * 1.3) : 0;
    return [side * beam * widthRatio, y, z + bowRake, vCoord * 6, frac];
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

function buildCarpathiaWeatherDeck(
  name: string,
  zSamples: number[],
  yTopOffset = 0.06,
  thickness = 0.36,
  edgeExpand = 0.0,
): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const ringPts = 5;

  for (let zi = 0; zi < zSamples.length; zi++) {
    const z = zSamples[zi];
    const { beam, sheerY, flare } = sampleCarpathiaStation(z);
    const halfW = Math.max(0.05, beam * (1 + flare) + edgeExpand);
    const bowRake = z <= -82 ? -1.3 : 0;
    const zz = z + bowRake;
    const yTop = sheerY + yTopOffset;
    const yBot = yTop - thickness;
    const vCoord = (z + 85) / 170;

    positions.push(-halfW, yBot, zz);
    uvs.push(0, vCoord * 9);
    positions.push(-halfW, yTop, zz);
    uvs.push(0.15, vCoord * 9);
    positions.push(0, yTop + 0.06, zz);
    uvs.push(0.5, vCoord * 9);
    positions.push(halfW, yTop, zz);
    uvs.push(0.85, vCoord * 9);
    positions.push(halfW, yBot, zz);
    uvs.push(1.0, vCoord * 9);
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

  const addCap = (zi: number, flip: boolean) => {
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
  addCap(0, false);
  addCap(zSamples.length - 1, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo);
  mesh.name = name;
  return mesh;
}

function buildCurvedHouse(
  name: string,
  halfWidth: number,
  zMin: number,
  zMax: number,
  height: number,
  curveLenFore = 0.65,
  curveLenAft = curveLenFore,
): THREE.Mesh {
  const shape = new Shape2D();
  const yFront = -zMin;
  const yBack = -zMax;
  if (curveLenFore > 0.01) {
    shape.moveTo(-halfWidth, yFront - curveLenFore);
    shape.quadraticCurveTo(-halfWidth, yFront, 0, yFront, 12);
    shape.quadraticCurveTo(halfWidth, yFront, halfWidth, yFront - curveLenFore, 12);
  } else {
    shape.moveTo(-halfWidth, yFront);
    shape.lineTo(halfWidth, yFront);
  }
  if (curveLenAft > 0.01) {
    shape.lineTo(halfWidth, yBack + curveLenAft);
    shape.quadraticCurveTo(halfWidth, yBack, 0, yBack, 12);
    shape.quadraticCurveTo(-halfWidth, yBack, -halfWidth, yBack + curveLenAft, 12);
  } else {
    shape.lineTo(halfWidth, yBack);
    shape.lineTo(-halfWidth, yBack);
  }
  shape.closePath();

  const isSplitFace = curveLenFore <= 0.01 || curveLenAft <= 0.01;
  const mesh = buildExtrudedShapeMesh(name, shape, height, isSplitFace ? 0 : 0.04);
  mesh.rotation.x = -Math.PI / 2;
  bakeTransform(mesh);
  return mesh;
}

export function buildCarpathiaShip(
  scene: THREE.Scene,
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean,
): CarpathiaRig {
  const root = new THREE.Group();
  root.name = 'carpathia_root';
  root.visible = false;
  scene.add(root);

  const hullMeshGroup = new THREE.Group();
  hullMeshGroup.name = 'carpathia_hullMeshGroup';
  root.add(hullMeshGroup);

  const bowGroup = new THREE.Group();
  bowGroup.name = 'carpathia_bowGroup';
  bowGroup.position.set(0, 0, CARPATHIA_BREAK_Z);
  hullMeshGroup.add(bowGroup);
  const bowContent = new THREE.Group();
  bowContent.name = 'carpathia_bowContent';
  bowContent.position.set(0, 0, -CARPATHIA_BREAK_Z);
  bowGroup.add(bowContent);

  const sternGroup = new THREE.Group();
  sternGroup.name = 'carpathia_sternGroup';
  sternGroup.position.set(0, 0, CARPATHIA_BREAK_Z);
  hullMeshGroup.add(sternGroup);
  const sternContent = new THREE.Group();
  sternContent.name = 'carpathia_sternContent';
  sternContent.position.set(0, 0, -CARPATHIA_BREAK_Z);
  sternGroup.add(sternContent);

  const meshes: THREE.Mesh[] = [];
  const instancedMeshes: THREE.InstancedMesh[] = [];
  const materials: THREE.Material[] = [];
  const shadowCasters: THREE.Object3D[] = [];

  const trackMesh = <T extends THREE.Mesh>(m: T, parent?: THREE.Object3D, castShadow = false, receiveShadow = false): T => {
    meshes.push(m);
    if (parent) parent.add(m);
    if (castShadow && !isSoftwareGl) {
      m.castShadow = true;
      shadowCasters.push(m);
    }
    if (receiveShadow) m.receiveShadow = true;
    return m;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  // Cunard Line Materials (crisp, balanced albedo & restrained specular)
  const steelHullMat = trackMat(
    makePBR('carp_steelHull', {
      albedoTex: textures.steelHullAlbedo,
      bumpTex: textures.steelHullNormal,
      bumpLevel: 1.15,
      roughnessTex: textures.steelHullRoughness,
      color: 0x161c24,
      roughness: 0.56,
      metallic: 0.24,
      doubleSided: true,
      envIntensity: 0.50,
    }),
  );
  const antiFoulMat = trackMat(
    makePBR('carp_antiFoul', {
      color: 0x6b1b1e,
      bumpTex: textures.steelHullNormal,
      bumpLevel: 0.75,
      roughness: 0.68,
      metallic: 0.12,
      doubleSided: true,
      envIntensity: 0.42,
    }),
  );
  const whiteMat = trackMat(
    makePBR('carp_white', { color: 0xdfdacf, roughness: 0.68, metallic: 0.03, envIntensity: 0.48 }),
  );
  const teakMat = trackMat(
    makePBR('carp_teak', {
      albedoTex: textures.teakDeckAlbedo,
      bumpTex: textures.teakDeckNormal,
      roughnessTex: textures.teakDeckRoughness,
      roughness: 0.82,
      metallic: 0.02,
      envIntensity: 0.46,
    }),
  );
  const cunardRedMat = trackMat(
    makePBR('carp_cunardRed', { color: 0xb83626, roughness: 0.58, metallic: 0.06, envIntensity: 0.46 }),
  );
  const blackBandMat = trackMat(
    makePBR('carp_blackBand', { color: 0x12161d, roughness: 0.54, metallic: 0.4, envIntensity: 0.46 }),
  );
  const mastBuffMat = trackMat(
    makePBR('carp_mastBuff', { color: 0xc29658, roughness: 0.62, metallic: 0.06, envIntensity: 0.42 }),
  );
  const brassMat = trackMat(
    makePBR('carp_brass', {
      color: 0xd4a64e,
      roughness: 0.44,
      metallic: 0.82,
      anisotropy: 0.65,
      envIntensity: 0.36,
    }),
  );
  const warmGlowMat = trackMat(
    makePBR('carp_warmGlow', {
      color: 0xffe4aa,
      emissive: 0xffaa42,
      emissiveIntensity: 1.25,
      roughness: 0.35,
      metallic: 0.02,
      envIntensity: 0.3,
    }),
  );
  const portRedMat = trackMat(
    makePBR('carp_portRed', {
      color: 0xff4242,
      emissive: 0xef4444,
      emissiveIntensity: 1.5,
      roughness: 0.35,
    }),
  );
  const stbdGreenMat = trackMat(
    makePBR('carp_stbdGreen', {
      color: 0x34d399,
      emissive: 0x10b981,
      emissiveIntensity: 1.5,
      roughness: 0.35,
    }),
  );
  const stayMat = trackMat(
    new THREE.MeshLambertMaterial({
      name: 'carp_stayMat',
      color: 0x4b5868,
    }),
  );

  const tornSteelMat = trackMat(
    makePBR('carp_tornSteel', {
      color: 0x1c222a,
      roughness: 0.72,
      metallic: 0.6,
      doubleSided: true,
    }),
  );
  const tornRustMat = trackMat(
    makePBR('carp_tornRust', {
      color: 0x4d251a,
      roughness: 0.86,
      metallic: 0.32,
      doubleSided: true,
    }),
  );
  const breakEmberMat = trackMat(
    makePBR('carp_breakEmber', {
      color: 0xff9f45,
      emissive: 0xff5a1f,
      emissiveIntensity: 0,
      roughness: 0.4,
      doubleSided: true,
    }),
  );

  // =========================================================================
  // 1. LOFTED 170m CUNARD HULL (SPLIT AT CARPATHIA_BREAK_Z), DECKS & SUPERSTRUCTURE
  // =========================================================================
  const fwdHullZ = [
    -85, -80, -72, -62, -50, -48.2, -48, -40, -30.2, -30, -16, 0, CARPATHIA_BREAK_Z,
  ];
  const aftHullZ = [CARPATHIA_BREAK_Z, 18, 36, 51.8, 52, 66, 77, 85];

  for (const [label, stations, targetGrp] of [
    ['bow', fwdHullZ, bowContent],
    ['stern', aftHullZ, sternContent],
  ] as const) {
    const upperHull = trackMesh(
      buildLoftedHull(`carp_upperHull_${label}`, stations, 7, 0.36, 1.0),
      targetGrp,
      true,
      true,
    );
    upperHull.material = steelHullMat;

    const lowerHull = trackMesh(
      buildLoftedHull(`carp_lowerHull_${label}`, stations, 4, 0.0, 0.37),
      targetGrp,
    );
    lowerHull.material = antiFoulMat;
    lowerHull.scale.set(0.999, 1, 0.9995);
  }

  // Bow gold "CARPATHIA" nameplates flush against port & starboard flare
  const carpNameMat = trackMat(
    makePBR('carp_nameplate', {
      albedoTex: textures.hullNameplateCarpathia,
      alphaCutOff: 0.08,
      roughness: 0.38,
      metallic: 0.55,
      doubleSided: true,
      envIntensity: 0.45,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );

  const { beam: cb1 } = sampleCarpathiaStation(-73);
  const { beam: cb2 } = sampleCarpathiaStation(-67);
  const carpBowYaw = Math.atan2(cb2 - cb1, 6.0);
  for (const side of [-1, 1] as const) {
    const plate = trackMesh(buildPlane(`carp_name_${side}`, 5.8, 1.45), bowContent);
    plate.material = carpNameMat;
    plate.position.set(side * ((cb1 + cb2) * 0.5 + 0.06), 6.2, -70.0);
    plate.rotation.y = (side > 0 ? Math.PI / 2 : -Math.PI / 2) + side * carpBowYaw;
  }

  // Hull-conforming Forecastle, Forward Well Deck, Midships Weather Deck & Poop Teak Decks
  const foreDeck = trackMesh(
    buildCarpathiaWeatherDeck('carp_foreDeck', [-85, -80, -72, -62, -52, -48], 0.05, 0.4, -0.02),
    bowContent,
    false,
    true,
  );
  foreDeck.material = teakMat;

  const fwdWellDeck = trackMesh(
    buildCarpathiaWeatherDeck('carp_fwdWellDeck', [-48, -43, -37, -30], 0.06, 0.38, -0.02),
    bowContent,
    false,
    true,
  );
  fwdWellDeck.material = teakMat;

  const mainPromenadeBow = trackMesh(
    buildCarpathiaWeatherDeck('carp_mainPromBow', [-30, -16, 0, CARPATHIA_BREAK_Z], 0.06, 0.42, 0.0),
    bowContent,
    false,
    true,
  );
  mainPromenadeBow.material = teakMat;

  const mainPromenadeStern = trackMesh(
    buildCarpathiaWeatherDeck('carp_mainPromStern', [CARPATHIA_BREAK_Z, 18, 36, 52], 0.06, 0.42, 0.0),
    sternContent,
    false,
    true,
  );
  mainPromenadeStern.material = teakMat;

  const poopDeck = trackMesh(
    buildCarpathiaWeatherDeck('carp_poopDeck', [52, 60, 70, 79, 85], 0.06, 0.4, -0.02),
    sternContent,
    false,
    true,
  );
  poopDeck.material = teakMat;

  // Break Bulkhead Walls
  const foreBreakWall = trackMesh(
    buildCurvedHouse('carp_foreBreakWall', 8.4, -48.4, -47.6, 2.35, 0.15),
    bowContent,
  );
  foreBreakWall.material = whiteMat;
  foreBreakWall.position.y = 5.35;

  const wellHatchCoaming = trackMesh(
    buildCurvedHouse('carp_wellHatch', 2.5, -42.5, -35.5, 0.72, 0.25),
    bowContent,
  );
  wellHatchCoaming.material = whiteMat;
  wellHatchCoaming.position.y = 5.42;

  const wellHatchCover = trackMesh(
    buildCurvedHouse('carp_wellCover', 2.3, -42.2, -35.8, 0.2, 0.2),
    bowContent,
  );
  wellHatchCover.material = teakMat;
  wellHatchCover.position.y = 6.14;

  const poopBreakWall = trackMesh(
    buildCurvedHouse('carp_poopBreak', 8.6, 51.6, 52.5, 1.4, 0.15),
    sternContent,
  );
  poopBreakWall.material = whiteMat;
  poopBreakWall.position.y = 5.5;

  // Hull-conforming Perimeter Railings
  let railIdx = 0;
  const addCarpRailSeg = (
    targetGrp: THREE.Group,
    x1: number,
    y1: number,
    z1: number,
    x2: number,
    y2: number,
    z2: number,
  ) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dy, dz);
    for (const off of [0.36, 0.68, 0.98]) {
      const bar = trackMesh(buildCylinder(`carp_rail_${railIdx++}`, 0.036, 0.036, len, 6), targetGrp);
      bar.material = off > 0.9 ? teakMat : whiteMat;
      bar.position.set((x1 + x2) * 0.5, (y1 + y2) * 0.5 + off, (z1 + z2) * 0.5);
      bar.rotation.x = Math.PI / 2;
      bar.rotation.z = -Math.atan2(dx, dz);
    }
  };
  const addCarpHullRail = (targetGrp: THREE.Group, zList: number[]) => {
    for (const side of [-1, 1] as const) {
      for (let i = 0; i < zList.length; i++) {
        const z = zList[i];
        const { beam, sheerY, flare } = sampleCarpathiaStation(z);
        const rx = side * Math.max(0, beam * (1 + flare) - 0.15);
        const ry = sheerY + 0.06;
        const post = trackMesh(buildCylinder(`carp_rpost_${railIdx++}`, 0.045, 0.045, 1.0, 6), targetGrp);
        post.material = whiteMat;
        post.position.set(rx, ry + 0.5, z <= -82 ? z - 1.25 : z);
        if (i < zList.length - 1) {
          const nz = zList[i + 1];
          const nxSt = sampleCarpathiaStation(nz);
          const nrx = side * Math.max(0, nxSt.beam * (1 + nxSt.flare) - 0.15);
          addCarpRailSeg(
            targetGrp,
            rx,
            ry,
            z <= -82 ? z - 1.25 : z,
            nrx,
            nxSt.sheerY + 0.06,
            nz <= -82 ? nz - 1.25 : nz,
          );
        }
      }
    }
  };
  addCarpHullRail(bowContent, [-84.5, -76, -65, -55, -48.3]);
  addCarpHullRail(bowContent, [-47.5, -39, -30.5]);
  addCarpHullRail(sternContent, [52.5, 62, 72, 80, 84.5]);

  // Midships Superstructure (Bridge Deck, Boat Deck & Promenade Roof)
  const bHouseBow = trackMesh(
    buildCurvedHouse('carp_bHouseBow', 8.9, -29.0, CARPATHIA_BREAK_Z, 2.8, 1.0, 0),
    bowContent,
    true,
  );
  bHouseBow.material = whiteMat;
  bHouseBow.position.y = 5.62;

  const bHouseStern = trackMesh(
    buildCurvedHouse('carp_bHouseStern', 8.9, CARPATHIA_BREAK_Z, 46.0, 2.8, 0, 1.0),
    sternContent,
    true,
  );
  bHouseStern.material = whiteMat;
  bHouseStern.position.y = 5.62;

  const boatDeckFloorBow = trackMesh(
    buildCurvedHouse('carp_boatDeckBow', 9.35, -29.5, CARPATHIA_BREAK_Z, 0.26, 1.0, 0),
    bowContent,
  );
  boatDeckFloorBow.material = teakMat;
  boatDeckFloorBow.position.y = 8.42;

  const boatDeckFloorStern = trackMesh(
    buildCurvedHouse('carp_boatDeckStern', 9.35, CARPATHIA_BREAK_Z, 46.5, 0.26, 0, 1.0),
    sternContent,
  );
  boatDeckFloorStern.material = teakMat;
  boatDeckFloorStern.position.y = 8.42;

  // Boat Deck Teak-Capped Railings
  for (const side of [-1, 1] as const) {
    addCarpRailSeg(bowContent, side * 9.2, 8.68, -28.0, side * 9.2, 8.68, CARPATHIA_BREAK_Z);
    addCarpRailSeg(sternContent, side * 9.2, 8.68, CARPATHIA_BREAK_Z, side * 9.2, 8.68, 45.0);
    for (let pz = -26; pz <= 44; pz += 7.0) {
      const bPost = trackMesh(
        buildCylinder(`carp_bdpost_${side}_${pz}`, 0.045, 0.045, 0.98, 6),
        pz <= CARPATHIA_BREAK_Z ? bowContent : sternContent,
      );
      bPost.material = whiteMat;
      bPost.position.set(side * 9.2, 9.16, pz);
    }
  }

  const aHouseBow = trackMesh(
    buildCurvedHouse('carp_aHouseBow', 7.1, -21.5, CARPATHIA_BREAK_Z, 2.45, 0.7, 0),
    bowContent,
  );
  aHouseBow.material = whiteMat;
  aHouseBow.position.y = 8.66;

  const aHouseStern = trackMesh(
    buildCurvedHouse('carp_aHouseStern', 7.1, CARPATHIA_BREAK_Z, 38.5, 2.45, 0, 0.7),
    sternContent,
  );
  aHouseStern.material = whiteMat;
  aHouseStern.position.y = 8.66;

  const aDeckRoofBow = trackMesh(
    buildCurvedHouse('carp_aRoofBow', 7.35, -22.0, CARPATHIA_BREAK_Z, 0.24, 0.7, 0),
    bowContent,
  );
  aDeckRoofBow.material = teakMat;
  aDeckRoofBow.position.y = 11.1;

  const aDeckRoofStern = trackMesh(
    buildCurvedHouse('carp_aRoofStern', 7.35, CARPATHIA_BREAK_Z, 39.0, 0.24, 0, 0.7),
    sternContent,
  );
  aDeckRoofStern.material = teakMat;
  aDeckRoofStern.position.y = 11.1;

  // Wheelhouse, Enclosed Bridge Wing Cabs & Cantilevered Support Knees
  const bridgeWingDeck = trackMesh(
    buildCurvedHouse('carp_bridgeWingDeck', 10.8, -23.2, -20.0, 0.28, 0.25),
    bowContent,
  );
  bridgeWingDeck.material = teakMat;
  bridgeWingDeck.position.y = 11.08;

  for (const sx of [-6.8, -3.6, 3.6, 6.8]) {
    const sup = trackMesh(buildCylinder(`carp_bsup_${sx}`, 0.11, 0.14, 2.65, 8), bowContent);
    sup.material = whiteMat;
    sup.position.set(sx, 9.85, -22.2);
  }

  const bridgeHouse = trackMesh(
    buildCurvedHouse('carp_bridgeHouse', 4.2, -23.3, -18.5, 2.38, 0.35),
    bowContent,
  );
  bridgeHouse.material = whiteMat;
  bridgeHouse.position.y = 11.32;

  const bridgeRoof = trackMesh(
    buildCurvedHouse('carp_bridgeRoof', 4.4, -23.5, -18.3, 0.18, 0.35),
    bowContent,
  );
  bridgeRoof.material = teakMat;
  bridgeRoof.position.y = 13.7;

  const bridgeWinCenter = trackMesh(buildBox('carp_bridgeWin', 5.6, 0.68, 0.14), bowContent);
  bridgeWinCenter.material = warmGlowMat;
  bridgeWinCenter.position.set(0, 12.65, -23.32);

  const slBase = trackMesh(buildCylinder('carp_slBase', 0.14, 0.22, 0.36, 10), bowContent);
  slBase.material = brassMat;
  slBase.position.set(-4.5, 13.78, -21.0);

  for (const side of [-1, 1] as const) {
    const wingWall = trackMesh(
      buildCurvedHouse(`carp_wingWall_${side}`, 3.3, -23.15, -22.8, 1.12, 0.1),
      bowContent,
    );
    wingWall.material = whiteMat;
    wingWall.position.set(side * 7.45, 11.34, 0);

    addCarpRailSeg(bowContent, side * 4.2, 11.36, -20.1, side * 10.65, 11.36, -20.1);

    const wingCab = trackMesh(
      buildCurvedHouse(`carp_wingCab_${side}`, 0.42, -23.1, -20.1, 1.18, 0.15),
      bowContent,
    );
    wingCab.material = whiteMat;
    wingCab.position.set(side * 10.55, 11.34, 0);

    const nav = trackMesh(buildSphere(`carp_nav_${side}`, 0.24, 10, 10), bowContent);
    nav.material = side < 0 ? portRedMat : stbdGreenMat;
    nav.position.set(side * 10.65, 12.62, -22.4);
  }

  // =========================================================================
  // 2. SINGLE TOWERING CUNARD FUNNEL + FIDLEY CASING + 4 TILTED SCHOONER MASTS
  // =========================================================================
  const fidleyBase = trackMesh(buildCurvedHouse('carp_fidley', 2.9, 1.6, 9.9, 0.95, 0.5), bowContent);
  fidleyBase.material = whiteMat;
  fidleyBase.position.y = 11.2;

  const funnelGroup = new THREE.Group();
  funnelGroup.name = 'carp_funnelGroup';
  bowContent.add(funnelGroup);
  funnelGroup.position.set(0, 11.45, 6.0);
  funnelGroup.rotation.x = 0.075;
  funnelGroup.scale.set(0.86, 1, 1.15);

  const funnelShaft = trackMesh(buildCylinder('carp_funnelShaft', 2.15, 2.52, 13.4, 28), funnelGroup, true);
  funnelShaft.material = cunardRedMat;
  funnelShaft.position.y = 5.8;

  const topBlackBand = trackMesh(buildCylinder('carp_funnelTopBand', 2.2, 2.15, 3.0, 28), funnelGroup);
  topBlackBand.material = blackBandMat;
  topBlackBand.position.y = 13.8;

  const funnelTopLip = trackMesh(buildTorusXY('carp_funnelLip', 2.18, 0.11, 8, 28), funnelGroup);
  funnelTopLip.material = blackBandMat;
  funnelTopLip.rotation.x = Math.PI / 2;
  funnelTopLip.position.y = 15.32;

  const funnelFlueCap = trackMesh(buildDisc('carp_funnelCap', 2.02, 24), funnelGroup);
  funnelFlueCap.material = blackBandMat;
  funnelFlueCap.rotation.x = -Math.PI / 2;
  funnelFlueCap.position.y = 15.18;

  for (const by of [8.2, 10.4]) {
    const thinBand = trackMesh(buildCylinder(`carp_funnelThinBand_${by}`, 2.3, 2.32, 0.36, 28), funnelGroup);
    thinBand.material = blackBandMat;
    thinBand.position.y = by;
  }

  const whistlePipe = trackMesh(buildCylinder('carp_whistle', 0.12, 0.14, 14.8, 8), funnelGroup);
  whistlePipe.material = brassMat;
  whistlePipe.position.set(0, 6.8, -2.38);

  let guyIdx = 0;
  for (const [tx, tz, bx, bz] of [
    [-1.8, 4.8, -8.5, 2.0],
    [1.8, 4.8, 8.5, 2.0],
    [-1.8, 7.6, -8.5, 9.8],
    [1.8, 7.6, 8.5, 9.8],
  ]) {
    const guy = trackMesh(
      buildTubeMesh(
        `carp_guy_${guyIdx++}`,
        [new THREE.Vector3(tx, 24.4, tz + 1.0), new THREE.Vector3(bx, 8.72, bz)],
        3,
        0.028,
        5,
        false,
      ),
      bowContent,
    );
    guy.material = stayMat;
  }

  // 4 Tall Cunard Schooner Masts
  const mastZList = [-46.0, -15.0, 28.0, 60.0];
  const mastTilt = 0.05;
  const mastTops: Array<THREE.Vector3> = [];

  for (let m = 0; m < mastZList.length; m++) {
    const mz = mastZList[m];
    const targetGrp = mz <= CARPATHIA_BREAK_Z ? bowContent : sternContent;
    const baseY = m === 0 ? 5.2 : m === 3 ? 6.4 : 11.1;
    const mastGrp = new THREE.Group();
    mastGrp.name = `carp_mastGrp_${m}`;
    targetGrp.add(mastGrp);
    mastGrp.position.set(0, baseY, mz);
    mastGrp.rotation.x = mastTilt;

    const collar = trackMesh(buildCylinder(`carp_mcollar_${m}`, 0.4, 0.54, 0.65, 12), mastGrp);
    collar.material = whiteMat;
    collar.position.y = 0.32;

    const mastLenAboveBase = 36.5 - baseY;
    const mast = trackMesh(buildCylinder(`carp_mast_${m}`, 0.14, 0.3, 31.6, 12), mastGrp);
    mast.material = mastBuffMat;
    mast.scale.y = mastLenAboveBase / 31.6;
    mast.position.y = mastLenAboveBase * 0.5;

    if (m === 0 || m === 2) {
      const yard = trackMesh(buildCylinder(`carp_yard_${m}`, 0.06, 0.09, 9.6, 8), mastGrp);
      yard.material = mastBuffMat;
      yard.rotation.z = Math.PI / 2;
      yard.position.set(0, 27.5 - baseY, 0);

      const mastLamp = trackMesh(buildSphere(`carp_mlamp_${m}`, 0.24, 10, 10), mastGrp);
      mastLamp.material = warmGlowMat;
      mastLamp.position.set(0, 25.0 - baseY, -0.26);
    }

    const topWorldY = baseY + mastLenAboveBase * Math.cos(mastTilt);
    const topWorldZ = mz + mastLenAboveBase * Math.sin(mastTilt);
    mastTops.push(new THREE.Vector3(0, topWorldY, topWorldZ));

    const stayH = 29.0 - baseY;
    const stayY = baseY + stayH * Math.cos(mastTilt);
    const stayZ = mz + stayH * Math.sin(mastTilt);
    const anchorY = m === 0 ? 5.4 : m === 3 ? 6.6 : 8.72;
    const anchorX = m === 0 ? 8.0 : m === 3 ? 6.8 : 9.1;
    for (const sx of [-anchorX, anchorX]) {
      const stay = trackMesh(
        buildTubeMesh(
          `carp_mstay_${m}_${sx}`,
          [new THREE.Vector3(0, stayY, stayZ), new THREE.Vector3(sx, anchorY, mz + 3)],
          3,
          0.03,
          5,
          false,
        ),
        targetGrp,
      );
      stay.material = stayMat;
    }
  }

  const aerialsGroup = new THREE.Group();
  aerialsGroup.name = 'carp_aerials';
  bowContent.add(aerialsGroup);
  for (const ax of [-0.45, 0.45]) {
    const aerial = trackMesh(
      buildTubeMesh(
        `carp_aerial_${ax}`,
        [
          new THREE.Vector3(ax, mastTops[0].y - 0.3, mastTops[0].z),
          new THREE.Vector3(ax, mastTops[3].y - 0.3, mastTops[3].z),
        ],
        3,
        0.024,
        5,
        false,
      ),
      aerialsGroup,
    );
    aerial.material = stayMat;
  }

  // Stern Red Ensign Flag
  const ensignGroup = new THREE.Group();
  ensignGroup.name = 'carp_ensign';
  sternContent.add(ensignGroup);
  ensignGroup.position.set(0, 6.8, 83.8);
  ensignGroup.rotation.x = 0.18;
  const ensignStaff = trackMesh(buildCylinder('carp_ensignStaff', 0.04, 0.07, 5.2, 8), ensignGroup);
  ensignStaff.material = whiteMat;
  ensignStaff.position.y = 2.6;

  const ensignFlagMat = trackMat(
    makePBR('carp_ensignFlagMat', {
      albedoTex: textures.redEnsignFlag,
      roughness: 0.72,
      metallic: 0.02,
      doubleSided: true,
      envIntensity: 0.4,
    }),
  );
  const ensignFlag = trackMesh(buildPlane('carp_ensignFlag', 2.8, 1.4), ensignGroup);
  ensignFlag.material = ensignFlagMat;
  ensignFlag.position.set(0.02, 4.4, 1.4);
  ensignFlag.rotation.y = Math.PI / 2;

  // 8 Stowed Cunard Lifeboats
  const cDavitPts = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.2, 1.2, 0),
    new THREE.Vector3(0.75, 1.85, 0),
  ];
  for (const side of [-1, 1] as const) {
    for (const lbz of [-10, 4, 18, 32]) {
      const boatParent = lbz <= CARPATHIA_BREAK_Z ? bowContent : sternContent;
      for (const dz of [-2.3, 2.3]) {
        const dv = trackMesh(buildTubeMesh(`carp_dv_${side}_${lbz}_${dz}`, cDavitPts, 8, 0.07, 6), boatParent);
        dv.material = whiteMat;
        dv.position.set(side * 8.15, 8.65, lbz + dz);
        dv.scale.x = side;
      }
      const chock = trackMesh(buildBox(`carp_chock_${side}_${lbz}`, 1.1, 0.42, 3.6), boatParent);
      chock.material = teakMat;
      chock.position.set(side * 8.65, 8.85, lbz);

      const cb = trackMesh(buildCurvedHouse(`carp_boat_${side}_${lbz}`, 0.85, -2.7, 2.7, 0.65, 0.9), boatParent);
      cb.material = whiteMat;
      cb.position.set(side * 8.65, 9.05, lbz);
    }
  }

  // =========================================================================
  // 2B. JAGGED INTERNAL FRACTURE BULKHEADS AT z = CARPATHIA_BREAK_Z
  // =========================================================================
  const buildFractureBulkhead = (label: string, dirZ: -1 | 1): THREE.Group => {
    const cap = new THREE.Group();
    cap.name = `carp_breakCap_${label}`;
    cap.position.set(0, 0, CARPATHIA_BREAK_Z);

    const { beam, sheerY } = sampleCarpathiaStation(CARPATHIA_BREAK_Z);
    const hullFaceShape = new Shape2D();
    hullFaceShape.moveTo(0, -5.0);
    hullFaceShape.quadraticCurveTo(beam * 0.85, -3.4, beam * 0.98, 0.8, 10);
    hullFaceShape.lineTo(beam * 1.02, sheerY);
    hullFaceShape.lineTo(8.9, sheerY);
    hullFaceShape.lineTo(8.9, 8.42);
    hullFaceShape.lineTo(7.1, 8.42);
    hullFaceShape.lineTo(7.1, 11.1);
    hullFaceShape.lineTo(-7.1, 11.1);
    hullFaceShape.lineTo(-7.1, 8.42);
    hullFaceShape.lineTo(-8.9, 8.42);
    hullFaceShape.lineTo(-8.9, sheerY);
    hullFaceShape.lineTo(-beam * 1.02, sheerY);
    hullFaceShape.lineTo(-beam * 0.98, 0.8);
    hullFaceShape.quadraticCurveTo(-beam * 0.85, -3.4, 0, -5.0, 10);
    hullFaceShape.closePath();

    const plate = trackMesh(buildExtrudedShapeMesh(`carp_bplate_${label}`, hullFaceShape, 0.08), cap);
    plate.material = tornSteelMat;
    plate.position.z = -dirZ * 0.08 - 0.04;

    for (const dy of [-2.2, 0.8, 3.4, 5.65, 8.45, 11.1]) {
      const w = dy < 6 ? 18.2 : dy < 9 ? 17.6 : 14.0;
      const slab = trackMesh(buildBox(`carp_bslab_${label}_${dy}`, w, 0.24, 0.95), cap);
      slab.material = tornRustMat;
      slab.position.set(0, dy, dirZ * 0.2);
    }

    for (let ji = 0; ji < 12; ji++) {
      const xPos = -8.6 + ji * 1.56;
      const yPos = -3.4 + ((ji * 5) % 12) * 1.15;
      const jutLen = 0.55 + ((ji * 11) % 6) * 0.24;
      const shard = trackMesh(
        buildCylinder(`carp_bshard_${label}_${ji}`, 0, 0.34 + (ji % 3) * 0.14, jutLen, 4),
        cap,
      );
      shard.material = ji % 2 === 0 ? tornSteelMat : tornRustMat;
      shard.rotation.x = dirZ * (Math.PI / 2 + ((ji % 5) - 2) * 0.14);
      shard.rotation.z = ((ji % 4) - 1.5) * 0.22;
      shard.position.set(xPos, yPos, dirZ * (jutLen * 0.45 + 0.1));
    }

    for (const [ex, ey] of [
      [-3.5, 2.2],
      [3.5, 2.2],
      [-4.2, 6.8],
      [4.2, 6.8],
    ]) {
      const ember = trackMesh(buildPlane(`carp_bember_${label}_${ex}_${ey}`, 2.4, 1.2), cap);
      ember.material = breakEmberMat;
      ember.position.set(ex, ey, dirZ * 0.25);
      if (dirZ < 0) ember.rotation.y = Math.PI;
    }

    cap.visible = false;
    return cap;
  };

  const bowBreakCap = buildFractureBulkhead('bow', 1);
  bowContent.add(bowBreakCap);
  const sternBreakCap = buildFractureBulkhead('stern', -1);
  sternContent.add(sternBreakCap);

  // =========================================================================
  // 3. WARM PORTHOLES, RESCUE FLOODLIGHTS & 4 BOARDING GANGWAY LADDERS
  // =========================================================================
  const phBow: Array<{ x: number; y: number; z: number; ry: number; sx: number }> = [];
  const phStern: Array<{ x: number; y: number; z: number; ry: number; sx: number }> = [];
  const pushPh = (p: { x: number; y: number; z: number; ry: number; sx: number }) => {
    if (p.z <= CARPATHIA_BREAK_Z) phBow.push(p);
    else phStern.push(p);
  };
  for (const side of [-1, 1]) {
    for (let z = -66; z <= 74; z += 4.5) {
      const { beam, sheerY } = sampleCarpathiaStation(z);
      const { beam: beamNext } = sampleCarpathiaStation(z + 1.5);
      const slopeAngle = Math.atan2((beamNext - beam) * side, 1.5);
      pushPh({
        x: side * (beam * 0.99 + 0.05),
        y: sheerY - 1.5,
        z,
        ry: (side > 0 ? Math.PI / 2 : -Math.PI / 2) - slopeAngle,
        sx: 1,
      });
    }
    for (let z = -27; z <= 44; z += 3.2) {
      pushPh({
        x: side * 8.97,
        y: 7.12,
        z,
        ry: side > 0 ? Math.PI / 2 : -Math.PI / 2,
        sx: 1.7,
      });
    }
    for (let z = -20; z <= 37; z += 3.2) {
      pushPh({
        x: side * 7.17,
        y: 9.88,
        z,
        ry: side > 0 ? Math.PI / 2 : -Math.PI / 2,
        sx: 1.7,
      });
    }
  }
  const phProto = buildDisc('carp_portholeProto', 0.24, 10);
  for (const [label, list, targetGrp] of [
    ['bow', phBow, bowContent],
    ['stern', phStern, sternContent],
  ] as const) {
    if (list.length === 0) continue;
    const phSlot = createInstancedSlot(`carp_portholes_${label}`, phProto.geometry, warmGlowMat, list.length, false, targetGrp);
    instancedMeshes.push(phSlot.mesh);
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      writeInstanceMatrix(phSlot, i, p.x, p.y, p.z, 0, p.ry, 0, p.sx, 1, 1);
    }
    commitInstanceMatrices(phSlot, list.length);
  }

  const deckGlowLight = new THREE.PointLight(0xffbe73, 12.0, 120, 1.0);
  deckGlowLight.name = 'carp_deckGlow';
  deckGlowLight.position.set(0, 14.5, 6);
  bowContent.add(deckGlowLight);

  const rescueSpotTarget = new THREE.Object3D();
  rescueSpotTarget.position.set(-22, 0.5, 6);
  bowContent.add(rescueSpotTarget);

  const rescueSpot = new THREE.SpotLight(0xedf7ff, 110, 260, Math.PI / 8, 0.45, 1.0);
  rescueSpot.name = 'carp_rescueSpot';
  rescueSpot.position.set(-4.5, 14.0, -21.0);
  rescueSpot.target = rescueSpotTarget;
  bowContent.add(rescueSpot);

  // 4 Illuminated Side Boarding Jacob's Ladders
  const boardingStationsLocal: Array<{ x: number; y: number; z: number; side: -1 | 1 }> = [
    { x: -10.8, y: 0.4, z: -8.0, side: -1 },
    { x: -10.8, y: 0.4, z: 22.0, side: -1 },
    { x: 10.8, y: 0.4, z: -8.0, side: 1 },
    { x: 10.8, y: 0.4, z: 22.0, side: 1 },
  ];
  const bowLaddersGroup = new THREE.Group();
  bowLaddersGroup.name = 'carp_bowLadders';
  bowContent.add(bowLaddersGroup);
  bowLaddersGroup.visible = false;

  const sternLaddersGroup = new THREE.Group();
  sternLaddersGroup.name = 'carp_sternLadders';
  sternContent.add(sternLaddersGroup);
  sternLaddersGroup.visible = false;

  for (let sIdx = 0; sIdx < boardingStationsLocal.length; sIdx++) {
    const st = boardingStationsLocal[sIdx];
    const g = new THREE.Group();
    g.name = `carp_ladder_${sIdx}`;
    (st.z <= CARPATHIA_BREAK_Z ? bowLaddersGroup : sternLaddersGroup).add(g);
    g.position.set(st.side * 9.85, 3.2, st.z);

    const upperLanding = trackMesh(buildBox(`carp_uLand_${sIdx}`, 1.5, 0.16, 1.8), g);
    upperLanding.material = teakMat;
    upperLanding.position.set(-st.side * 0.4, 2.48, 0);

    for (const rz of [-0.42, 0.42]) {
      const rope = trackMesh(buildCylinder(`carp_lrope_${sIdx}_${rz}`, 0.035, 0.035, 6.2, 6), g);
      rope.material = stayMat;
      rope.position.set(st.side * 0.25, 0, rz);
    }
    for (let r = 0; r < 11; r++) {
      const rung = trackMesh(buildBox(`carp_lrung_${sIdx}_${r}`, 0.18, 0.06, 0.95), g);
      rung.material = teakMat;
      rung.position.set(st.side * 0.25, -2.5 + r * 0.52, 0);
    }
    const stage = trackMesh(buildBox(`carp_lstage_${sIdx}`, 1.1, 0.14, 1.6), g);
    stage.material = teakMat;
    stage.position.set(st.side * 0.55, -2.4, 0);

    const lamp = trackMesh(buildSphere(`carp_llamp_${sIdx}`, 0.18, 8, 8), g);
    lamp.material = warmGlowMat;
    lamp.position.set(st.side * 0.55, -1.65, 0.65);
  }

  // =========================================================================
  // 4. CARPATHIA CREW + 160 RESCUED TITANIC SURVIVORS (SPLIT BOW & STERN)
  // =========================================================================
  const tmpTorso = buildCylinder('tmp_carp_torso', 0.16, 0.14, 0.68, 8);
  const tmpLegs = buildCylinder('tmp_carp_legs', 0.12, 0.1, 0.78, 8);
  const bodyProto = bakeAndMergeMeshes('carp_survBodyProto', [
    { mesh: tmpLegs, ty: 0.39 },
    { mesh: tmpTorso, ty: 1.08 },
  ]);
  tmpTorso.geometry.dispose();
  tmpLegs.geometry.dispose();

  const headProto = buildSphere('carp_survHeadProto', 0.11, 8, 8);
  headProto.position.set(0, 1.54, 0);
  bakeTransform(headProto);

  const vestProto = buildCylinder('carp_survVestProto', 0.2, 0.19, 0.38, 10);
  vestProto.position.set(0, 1.15, 0);
  bakeTransform(vestProto);

  const bodyMat = trackMat(makePBR('carp_survBodyMat', { color: 0xffffff, roughness: 0.75, metallic: 0.02 }));
  const headMat = trackMat(makePBR('carp_survHeadMat', { color: 0xe6bca0, roughness: 0.68, metallic: 0.02 }));
  const vestMat = trackMat(makePBR('carp_survVestMat', { color: 0xefe3c8, roughness: 0.85, metallic: 0.02 }));

  const MAX_SURVIVOR_FIGURES = 160;
  interface CarpSurvivorSpot {
    x: number;
    y: number;
    z: number;
    ry: number;
    phase: number;
    onLadder?: number;
    orderIdx: number;
    isStern: boolean;
    localIdx: number;
  }
  const bowSurvSpots: CarpSurvivorSpot[] = [];
  const sternSurvSpots: CarpSurvivorSpot[] = [];

  for (let i = 0; i < MAX_SURVIVOR_FIGURES; i++) {
    const isClimbing = i % 10 === 0;
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
    let spotBase: { x: number; y: number; z: number; ry: number; phase: number; onLadder?: number };
    if (isClimbing) {
      const st = boardingStationsLocal[i % boardingStationsLocal.length];
      spotBase = {
        x: st.side * 10.15,
        y: 1.2 + ((i * 7) % 5) * 0.9,
        z: st.z + ((i % 3) - 1) * 0.25,
        ry: st.side > 0 ? Math.PI / 2 : -Math.PI / 2,
        phase: i * 0.9,
        onLadder: i % boardingStationsLocal.length,
      };
    } else if (i % 3 === 0) {
      spotBase = {
        x: side * (7.6 + ((i * 13) % 13) * 0.1),
        y: 8.68,
        z: -22 + ((i * 19) % 62),
        ry: side > 0 ? -Math.PI / 2 : Math.PI / 2,
        phase: i * 1.3,
      };
    } else {
      spotBase = {
        x: side * (7.2 + ((i * 11) % 17) * 0.1),
        y: 5.66,
        z: -28 + ((i * 23) % 74),
        ry: side > 0 ? -Math.PI / 2 : Math.PI / 2,
        phase: i * 1.1,
      };
    }
    const isStern = spotBase.z > CARPATHIA_BREAK_Z;
    const targetArr = isStern ? sternSurvSpots : bowSurvSpots;
    targetArr.push({
      ...spotBase,
      orderIdx: i,
      isStern,
      localIdx: targetArr.length,
    });
  }

  const coatColors = [0x1c2430, 0x3a2a22, 0x5c232d, 0x243e4d, 0x4b3d57, 0x26443b, 0x8c7355];

  interface SurvBatch {
    spots: CarpSurvivorSpot[];
    bSlot: InstancedSlot;
    hSlot: InstancedSlot;
    vSlot: InstancedSlot;
  }

  const makeSurvBatch = (label: string, spots: CarpSurvivorSpot[], parent: THREE.Group): SurvBatch => {
    const count = Math.max(1, spots.length);
    const bSlot = createInstancedSlot(`carp_survBody_${label}`, bodyProto.geometry, bodyMat, count, true, parent);
    const hSlot = createInstancedSlot(`carp_survHead_${label}`, headProto.geometry, headMat, count, false, parent);
    const vSlot = createInstancedSlot(`carp_survVest_${label}`, vestProto.geometry, vestMat, count, false, parent);
    instancedMeshes.push(bSlot.mesh, hSlot.mesh, vSlot.mesh);

    for (let i = 0; i < spots.length; i++) {
      setInstanceColorHex(bSlot, i, coatColors[spots[i].orderIdx % coatColors.length]);
      writeZeroInstanceMatrix(bSlot, i);
      writeZeroInstanceMatrix(hSlot, i);
      writeZeroInstanceMatrix(vSlot, i);
    }
    commitInstanceColors(bSlot);
    commitInstanceMatrices(bSlot, spots.length);
    commitInstanceMatrices(hSlot, spots.length);
    commitInstanceMatrices(vSlot, spots.length);

    return { spots, bSlot, hSlot, vSlot };
  };

  const bowSurvBatch = makeSurvBatch('bow', bowSurvSpots, bowContent);
  const sternSurvBatch = makeSurvBatch('stern', sternSurvSpots, sternContent);

  // Carpathia's own 18 visible deck crewmen
  const crewSpots: Array<[number, number, number, number]> = [
    [-8.8, 11.36, -21.5, -Math.PI / 2],
    [8.8, 11.36, -21.5, Math.PI / 2],
    [-1.4, 11.36, -22.2, 0],
    [1.4, 11.36, -22.2, 0],
    [-2.5, 7.75, -62.0, 0.2],
    [2.5, 7.75, -62.0, -0.2],
    [-9.2, 5.66, -8.5, -Math.PI / 2],
    [-9.2, 5.66, -7.2, -Math.PI / 2],
    [-9.2, 5.66, 21.5, -Math.PI / 2],
    [-9.2, 5.66, 22.8, -Math.PI / 2],
    [9.2, 5.66, -8.5, Math.PI / 2],
    [9.2, 5.66, -7.2, Math.PI / 2],
    [9.2, 5.66, 21.5, Math.PI / 2],
    [9.2, 5.66, 22.8, Math.PI / 2],
    [-8.6, 8.68, -4.0, -Math.PI / 2],
    [-8.6, 8.68, 20.0, -Math.PI / 2],
    [8.6, 8.68, -4.0, Math.PI / 2],
    [8.6, 8.68, 20.0, Math.PI / 2],
  ];
  const bowCrew = crewSpots.filter((c) => c[2] <= CARPATHIA_BREAK_Z);
  const sternCrew = crewSpots.filter((c) => c[2] > CARPATHIA_BREAK_Z);

  for (const [label, list, targetGrp] of [
    ['bow', bowCrew, bowContent],
    ['stern', sternCrew, sternContent],
  ] as const) {
    const cBodySlot = createInstancedSlot(`carp_crewBody_${label}`, bodyProto.geometry, bodyMat, list.length, true, targetGrp);
    const cHeadSlot = createInstancedSlot(`carp_crewHead_${label}`, headProto.geometry, headMat, list.length, false, targetGrp);
    instancedMeshes.push(cBodySlot.mesh, cHeadSlot.mesh);
    for (let i = 0; i < list.length; i++) {
      const [cx, cy, cz, ry] = list[i];
      setInstanceColorHex(cBodySlot, i, 0x131d2f);
      writeInstanceMatrix(cBodySlot, i, cx, cy, cz, 0, ry, 0, 1, 1, 1);
      writeInstanceMatrix(cHeadSlot, i, cx, cy, cz, 0, ry, 0, 1, 1, 1);
    }
    commitInstanceColors(cBodySlot);
    commitInstanceMatrices(cBodySlot, list.length);
    commitInstanceMatrices(cHeadSlot, list.length);
  }

  const setRescueState = (
    time: number,
    boardedRatio: number,
    laddersDeployed: boolean,
    searchlightSweep: boolean,
  ) => {
    bowLaddersGroup.visible = laddersDeployed;
    sternLaddersGroup.visible = laddersDeployed;

    if (searchlightSweep) {
      const sweepZ = 10 + Math.sin(time * 0.75) * 42;
      rescueSpotTarget.position.set(-55, 0.5, sweepZ);
      rescueSpot.intensity = 150;
    } else {
      rescueSpotTarget.position.set(-22, 0.5, 6);
      rescueSpot.intensity = 90;
    }

    const visibleCount = Math.round(MathUtils.clamp(boardedRatio, 0, 1) * MAX_SURVIVOR_FIGURES);
    for (const batch of [bowSurvBatch, sternSurvBatch]) {
      for (let i = 0; i < batch.spots.length; i++) {
        const sp = batch.spots[i];
        if (sp.orderIdx >= visibleCount) {
          writeZeroInstanceMatrix(batch.bSlot, i);
          writeZeroInstanceMatrix(batch.hSlot, i);
          writeZeroInstanceMatrix(batch.vSlot, i);
        } else {
          const swayY = Math.sin(time * 1.4 + sp.phase) * 0.015;
          let climbOffset = 0;
          if (sp.onLadder !== undefined && laddersDeployed) {
            climbOffset = ((time * 0.55 + sp.phase) % 1) * 2.2;
          }
          const ry = sp.ry + Math.sin(time * 0.8 + sp.phase) * 0.15;
          writeInstanceMatrix(batch.bSlot, i, sp.x, sp.y + swayY + climbOffset, sp.z, 0, ry, 0, 1, 1, 1);
          writeInstanceMatrix(batch.hSlot, i, sp.x, sp.y + swayY + climbOffset, sp.z, 0, ry, 0, 1, 1, 1);
          writeInstanceMatrix(batch.vSlot, i, sp.x, sp.y + swayY + climbOffset, sp.z, 0, ry, 0, 1, 1, 1);
        }
      }
      commitInstanceMatrices(batch.bSlot, batch.spots.length);
      commitInstanceMatrices(batch.hSlot, batch.spots.length);
      commitInstanceMatrices(batch.vSlot, batch.spots.length);
    }
  };

  const setBreakupVisual = (broken: boolean, emberPower = 0) => {
    bowBreakCap.visible = broken;
    sternBreakCap.visible = broken;
    aerialsGroup.visible = !broken;
    breakEmberMat.emissiveIntensity = broken ? MathUtils.clamp(emberPower, 0, 1.4) : 0;
    if (broken && emberPower <= 0.15) {
      warmGlowMat.emissiveIntensity = 0.2;
      deckGlowLight.intensity = 1.5;
      rescueSpot.intensity = 10;
    }
  };

  const reset = () => {
    hullMeshGroup.position.set(0, 0, 0);
    hullMeshGroup.rotation.set(0, 0, 0);
    bowGroup.position.set(0, 0, CARPATHIA_BREAK_Z);
    bowGroup.rotation.set(0, 0, 0);
    sternGroup.position.set(0, 0, CARPATHIA_BREAK_Z);
    sternGroup.rotation.set(0, 0, 0);
    warmGlowMat.emissiveIntensity = 1.25;
    deckGlowLight.intensity = 12.0;
    setBreakupVisual(false, 0);
  };

  return {
    root,
    hullMeshGroup,
    bowGroup,
    sternGroup,
    shadowCasters,
    boardingStationsLocal,
    setRescueState,
    setBreakupVisual,
    reset,
    dispose: () => {
      deckGlowLight.dispose();
      rescueSpot.dispose();
      const geos = new Set<THREE.BufferGeometry>();
      geos.add(phProto.geometry);
      geos.add(bodyProto.geometry);
      geos.add(headProto.geometry);
      geos.add(vestProto.geometry);
      for (const m of meshes) geos.add(m.geometry);
      for (const im of instancedMeshes) {
        geos.add(im.geometry);
        im.dispose();
      }
      geos.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      root.removeFromParent();
    },
  };
}
