import * as THREE from 'three';
import {
  InstancedSlot,
  MathUtils,
  Shape2D,
  bakeAndMergeMeshes,
  bakeTransform,
  buildBox,
  buildCapsule,
  buildCylinder,
  buildExtrudedShapeMesh,
  buildLatheMesh,
  buildSphere,
  buildTorusXY,
  buildTubeMesh,
  cloneMeshWithMaterial,
  commitInstanceColors,
  commitInstanceMatrices,
  createInstancedSlot,
  makePBR,
  setEulerXYZ,
  setInstanceColorHex,
  writeZeroInstanceMatrix,
} from './threeHelpers';

export type CharacterRole = 'officer' | 'lookout' | 'gentleman' | 'lady';
export type CharacterGait = 'idle' | 'walk' | 'run';
export type CharacterPersonality = 'calm' | 'curious' | 'social' | 'dutiful';
export type CharacterIntent =
  | 'stroll'
  | 'converse'
  | 'rail_watch'
  | 'brace'
  | 'assist'
  | 'muster_run'
  | 'hold_bow';

export interface CruiseAwarenessContext {
  shipRoll?: number;
  shipPitch?: number;
  harborNear?: boolean;
  hazardSide?: number;
  playerLocalX?: number;
  playerLocalY?: number;
  playerLocalZ?: number;
  bridgeOrderActive?: boolean;
  autopilotActive?: boolean;
  rudderDeg?: number;
  bowPanicActive?: boolean;
}

export interface DeckWaypoint {
  x: number;
  y: number;
  z: number;
  pauseSec?: number;
}

export interface DeckCharacter {
  group: THREE.Group;
  bodyRoot: THREE.Group;
  torsoGroup: THREE.Group;
  headGroup: THREE.Group;
  leftArmHip: THREE.Group;
  leftElbow: THREE.Group;
  rightArmHip: THREE.Group;
  rightElbow: THREE.Group;
  leftLegHip: THREE.Group;
  leftKnee: THREE.Group;
  rightLegHip: THREE.Group;
  rightKnee: THREE.Group;
  skirtMesh: THREE.Mesh | null;
  lifejacket: THREE.Group;
  role: CharacterRole;
  gait: CharacterGait;
  personality: CharacterPersonality;
  panicThreshold: number;
  intent: CharacterIntent;
  decisionTimer: number;
  gazeYaw: number;
  route: DeckWaypoint[];
  musterTarget: DeckWaypoint | null;
  bowTarget?: DeckWaypoint | null;
  helmStation?: { x: number; y: number; z: number; yaw: number; role: 'helmsman' | 'watch_officer' } | null;
  waypointIdx: number;
  pauseTimer: number;
  walkSpeed: number;
  runSpeed: number;
  strideCycle: number;
  phase: number;
  baseRotY: number;
  posX: number;
  posY: number;
  posZ: number;
  isHalfBow: boolean;
}

export interface LifeboatRig {
  side: -1 | 1;
  index: number;
  baseZ: number;
  lowerStart: number;
  lowerDuration: number;
  homeParent: THREE.Group;
  davitForeArm: THREE.Group;
  davitAftArm: THREE.Group;
  ropeFore: THREE.Mesh;
  ropeAft: THREE.Mesh;
  boatGroup: THREE.Group;
  occupantsGroup: THREE.Group;
  oarsGroup: THREE.Group;
  lanternMesh: THREE.Mesh;
  detached: boolean;
  rescued: boolean;
  splashX: number;
  splashZ: number;
  boatX: number;
  boatZ: number;
  boatYaw: number;
}

export interface RescueProgressResult {
  boatsRecovered: number;
  survivorsRescued: number;
  warshipBoatsRecovered: number;
  warshipSurvivorsRescued: number;
  carpathiaBoatsRecovered: number;
  carpathiaSurvivorsRescued: number;
}

export interface WarshipRescueContext {
  active: boolean;
  progress: number;
  root: THREE.Group;
  boardingStationsLocal: Array<{ x: number; y: number; z: number; side: -1 | 1 }>;
}

export interface FloatingLifeboatHazard {
  index: number;
  x: number;
  z: number;
  radius: number;
}

export interface CrewAndLifeboatSystem {
  characters: DeckCharacter[];
  totalCharacterCount: number;
  lifeboats: LifeboatRig[];
  shadowCasters: THREE.Object3D[];
  updateCruising: (
    time: number,
    dt: number,
    floodingPct: number,
    shipRoot?: THREE.Group,
    awareness?: CruiseAwarenessContext,
  ) => void;
  updateSinking: (
    time: number,
    dt: number,
    sinkProgress: number,
    shipRoot: THREE.Group,
    awareness?: CruiseAwarenessContext,
  ) => number;
  updateRescue: (
    time: number,
    dt: number,
    stage: 'waiting' | 'approaching' | 'boarding' | 'complete',
    boardingProgress: number,
    carpathiaRoot: THREE.Group,
    boardingStationsLocal: Array<{ x: number; y: number; z: number; side: -1 | 1 }>,
    shipRoot: THREE.Group,
    warshipRescue?: WarshipRescueContext,
  ) => RescueProgressResult;
  getFloatingLifeboats: (out: FloatingLifeboatHazard[]) => void;
  reset: () => void;
  setLanternPower: (power: number) => void;
  dispose: () => void;
}

type CrowdKind = 'crew' | 'gentleman' | 'lady';

interface CrowdActor {
  kind: CrowdKind;
  allIdx: number;
  roleIdx: number;
  personality: CharacterPersonality;
  panicThreshold: number;
  intent: CharacterIntent;
  decisionTimer: number;
  gazeYaw: number;
  peerYaw: number;
  startX: number;
  startY: number;
  startZ: number;
  endX: number;
  endY: number;
  endZ: number;
  musterX: number;
  musterY: number;
  musterZ: number;
  bowPanicX: number;
  bowPanicY: number;
  bowPanicZ: number;
  bowPanicYaw: number;
  posX: number;
  posY: number;
  posZ: number;
  rotY: number;
  baseRotY: number;
  goingForward: boolean;
  isWalker: boolean;
  pauseTimer: number;
  walkSpeed: number;
  runSpeed: number;
  strideCycle: number;
  phase: number;
  scaleH: number;
  scaleW: number;
}

// Pre-allocated math helpers & zero-GC spatial hash grid
const _tmpWorldPos = new THREE.Vector3();
const _vPos = new THREE.Vector3();
const _vScale = new THREE.Vector3();
const _vOne = new THREE.Vector3(1, 1, 1);
const _euler = new THREE.Euler(0, 0, 0, 'XYZ');
const _qRot = new THREE.Quaternion();
const _pelvisMat = new THREE.Matrix4();
const _torsoMat = new THREE.Matrix4();
const _headMat = new THREE.Matrix4();
const _localMat = new THREE.Matrix4();
const _partMat = new THREE.Matrix4();
const _invMat = new THREE.Matrix4();

const GRID_COLS = 12;
const GRID_ROWS = 96;
const _gridHead = new Int32Array(GRID_COLS * GRID_ROWS);
const _gridNext = new Int32Array(700);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildRealisticLifeboatHullMesh(name: string): THREE.Mesh {
  const zStations = 14;
  const uStations = 11;
  const halfLen = 3.1;
  const maxHalfBeam = 0.94;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let zi = 0; zi <= zStations; zi++) {
    const t = zi / zStations;
    const z = MathUtils.lerp(-halfLen, halfLen, t);
    const beamEnv = Math.pow(Math.sin(t * Math.PI), 0.68);
    const sheerRaise = Math.pow(Math.abs(t - 0.5) * 2, 2.2) * 0.28;

    for (let ui = 0; ui <= uStations; ui++) {
      const s = (ui / uStations) * 2 - 1;
      const absS = Math.abs(s);
      const flare = Math.pow(absS, 0.72);
      const x = Math.sign(s) * flare * maxHalfBeam * beamEnv;
      const y = -0.44 + Math.pow(absS, 1.85) * (0.86 + sheerRaise);
      positions.push(x, y, z);
      uvs.push(t * 3, ui / uStations);
    }
  }

  const stride = uStations + 1;
  for (let zi = 0; zi < zStations; zi++) {
    for (let ui = 0; ui < uStations; ui++) {
      const a = zi * stride + ui;
      const b = (zi + 1) * stride + ui;
      const c = (zi + 1) * stride + (ui + 1);
      const d = zi * stride + (ui + 1);
      indices.push(a, b, d);
      indices.push(b, c, d);
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

export interface CrewAndLifeboatOptions {
  scaleX?: number;
  scaleZ?: number;
  boatZStations?: number[];
  boatBaseX?: number;
  deckBoundsZ?: [number, number];
}

export function createCrewAndLifeboats(
  _scene: THREE.Scene,
  bowContent: THREE.Group,
  sternContent: THREE.Group,
  whitePaintMat: THREE.Material,
  teakDeckMat: THREE.Material,
  breakZ = 90.0,
  options?: CrewAndLifeboatOptions,
): CrewAndLifeboatSystem {
  const scaleX = options?.scaleX ?? 1.0;
  const scaleZ = options?.scaleZ ?? 1.0;
  const boatBaseX = options?.boatBaseX ?? 12.95 * scaleX;
  const deckBoundsZ = options?.deckBoundsZ ?? [-78, 200];
  const boatZStations = options?.boatZStations ?? [8.5, 18.2, 27.9, 37.6, 102.0, 111.7, 121.4, 131.1];
  const fwdBoatZ = boatZStations.slice(0, 4);
  const aftBoatZ = boatZStations.slice(4, 8);
  const mapX = (x: number) => x * scaleX;
  const mapZ = (z: number) => (Math.abs(z) < 3.5 ? z : z * scaleZ);
  const mapWp = (wp: DeckWaypoint): DeckWaypoint => ({
    ...wp,
    x: mapX(wp.x),
    z: mapZ(wp.z),
  });
  const meshes: THREE.Mesh[] = [];
  const materials: THREE.Material[] = [];
  const shadowCasters: THREE.Object3D[] = [];
  const rootGroups: THREE.Group[] = [];

  const trackMesh = <T extends THREE.Mesh>(m: T, parent?: THREE.Object3D, castShadow = false): T => {
    meshes.push(m);
    if (parent) parent.add(m);
    if (castShadow) shadowCasters.push(m);
    return m;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  // =========================================================================
  // REALISTIC FABRICS, SKIN, HAIR & LIFEJACKET MATERIALS
  // =========================================================================
  const officerNavyMat = trackMat(makePBR('char_officerNavy', { color: 0x131d2f, roughness: 0.68, metallic: 0.06, envIntensity: 0.35 }));
  const officerTrouserMat = trackMat(makePBR('char_officerTrouser', { color: 0x0f1624, roughness: 0.72, metallic: 0.04, envIntensity: 0.35 }));
  const officerGoldMat = trackMat(makePBR('char_officerGold', { color: 0xd9ad4e, roughness: 0.42, metallic: 0.80, envIntensity: 0.38 }));
  const shirtWhiteMat = trackMat(makePBR('char_shirtWhite', { color: 0xf1ede4, roughness: 0.62, metallic: 0.02, envIntensity: 0.35 }));
  const capBlackVisorMat = trackMat(makePBR('char_capVisor', { color: 0x0b0e14, roughness: 0.32, metallic: 0.12, envIntensity: 0.38 }));
  const skinTones = [
    trackMat(makePBR('char_skin0', { color: 0xe2b698, roughness: 0.68, metallic: 0.01, envIntensity: 0.3 })),
    trackMat(makePBR('char_skin1', { color: 0xd7a786, roughness: 0.70, metallic: 0.01, envIntensity: 0.3 })),
    trackMat(makePBR('char_skin2', { color: 0xebbda0, roughness: 0.66, metallic: 0.01, envIntensity: 0.3 })),
  ];
  const hairMats = [
    trackMat(makePBR('char_hair0', { color: 0x241913, roughness: 0.85, metallic: 0.01, envIntensity: 0.25 })),
    trackMat(makePBR('char_hair1', { color: 0x452d1d, roughness: 0.84, metallic: 0.01, envIntensity: 0.25 })),
    trackMat(makePBR('char_hair2', { color: 0x6b5c50, roughness: 0.82, metallic: 0.01, envIntensity: 0.25 })),
  ];
  const bootLeatherMat = trackMat(makePBR('char_boot', { color: 0x161210, roughness: 0.48, metallic: 0.08, envIntensity: 0.35 }));
  const gentlemanCoatMats = [
    trackMat(makePBR('char_gcoat0', { color: 0x1d232d, roughness: 0.76, metallic: 0.02, envIntensity: 0.3 })),
    trackMat(makePBR('char_gcoat1', { color: 0x362a21, roughness: 0.78, metallic: 0.02, envIntensity: 0.3 })),
    trackMat(makePBR('char_gcoat2', { color: 0x29323a, roughness: 0.74, metallic: 0.02, envIntensity: 0.3 })),
    trackMat(makePBR('char_gcoat3', { color: 0x423a32, roughness: 0.78, metallic: 0.02, envIntensity: 0.3 })),
  ];
  const ladyCoatMats = [
    trackMat(makePBR('char_lcoat0', { color: 0x5c212c, roughness: 0.72, metallic: 0.02, envIntensity: 0.3 })),
    trackMat(makePBR('char_lcoat1', { color: 0x233d4b, roughness: 0.72, metallic: 0.02, envIntensity: 0.3 })),
    trackMat(makePBR('char_lcoat2', { color: 0x4a3d56, roughness: 0.72, metallic: 0.02, envIntensity: 0.3 })),
    trackMat(makePBR('char_lcoat3', { color: 0xa38767, roughness: 0.72, metallic: 0.02, envIntensity: 0.3 })),
    trackMat(makePBR('char_lcoat4', { color: 0x25443a, roughness: 0.74, metallic: 0.02, envIntensity: 0.3 })),
  ];
  const lifejacketMat = trackMat(makePBR('char_lifejacket', { color: 0xebe0c7, roughness: 0.84, metallic: 0.01, envIntensity: 0.3 }));
  const strapMat = trackMat(makePBR('char_strap', { color: 0x7c6a4c, roughness: 0.88, metallic: 0.01, envIntensity: 0.25 }));
  const ropeMat = trackMat(makePBR('char_rope', { color: 0x9c8259, roughness: 0.90, metallic: 0.01, envIntensity: 0.25 }));
  const boatLanternMat = trackMat(
    makePBR('char_boatLantern', {
      color: 0xffe4a3,
      emissive: 0xffa73b,
      emissiveIntensity: 1.15,
      roughness: 0.32,
      envIntensity: 0.25,
    }),
  );

  const instClothMat = trackMat(makePBR('char_instCloth', { color: 0xffffff, roughness: 0.74, metallic: 0.04, envIntensity: 0.32 }));
  const instSkinMat = trackMat(makePBR('char_instSkin', { color: 0xffffff, roughness: 0.68, metallic: 0.01, envIntensity: 0.3 }));
  const instHairMat = trackMat(makePBR('char_instHair', { color: 0xffffff, roughness: 0.85, metallic: 0.01, envIntensity: 0.25 }));

  // =========================================================================
  // SCULPTED ANATOMICAL TEMPLATE MESHES (Cloned / Instanced into Hero & Crowd)
  // =========================================================================
  const tmps: THREE.Mesh[] = [];
  const mkTmp = (m: THREE.Mesh): THREE.Mesh => {
    m.visible = false;
    tmps.push(m);
    return m;
  };

  const coatTorsoProto = mkTmp(
    buildLatheMesh(
      'proto_coatTorso',
      [
        new THREE.Vector2(0.155, -0.18),
        new THREE.Vector2(0.135, -0.02),
        new THREE.Vector2(0.168, 0.24),
        new THREE.Vector2(0.19, 0.43),
        new THREE.Vector2(0.085, 0.51),
        new THREE.Vector2(0.068, 0.56),
      ],
      14,
    ),
  );
  coatTorsoProto.scale.set(1.12, 1.0, 0.78);
  bakeTransform(coatTorsoProto);

  const ladyBodiceProto = mkTmp(
    buildLatheMesh(
      'proto_ladyBodice',
      [
        new THREE.Vector2(0.115, -0.04),
        new THREE.Vector2(0.105, 0.04),
        new THREE.Vector2(0.145, 0.24),
        new THREE.Vector2(0.155, 0.42),
        new THREE.Vector2(0.075, 0.5),
        new THREE.Vector2(0.06, 0.55),
      ],
      14,
    ),
  );
  ladyBodiceProto.scale.set(1.08, 1.0, 0.76);
  bakeTransform(ladyBodiceProto);

  const skirtProto = mkTmp(
    buildLatheMesh(
      'proto_skirt',
      [
        new THREE.Vector2(0.28, -0.82),
        new THREE.Vector2(0.25, -0.58),
        new THREE.Vector2(0.2, -0.32),
        new THREE.Vector2(0.145, -0.1),
        new THREE.Vector2(0.118, 0.02),
      ],
      14,
    ),
  );
  skirtProto.scale.set(1.05, 1.0, 0.92);
  bakeTransform(skirtProto);

  const upperArmProto = mkTmp(
    buildLatheMesh(
      'proto_upperArm',
      [
        new THREE.Vector2(0.048, -0.27),
        new THREE.Vector2(0.056, -0.12),
        new THREE.Vector2(0.068, 0.0),
        new THREE.Vector2(0.03, 0.03),
      ],
      10,
    ),
  );

  const forearmProto = mkTmp(
    buildLatheMesh(
      'proto_forearm',
      [
        new THREE.Vector2(0.042, -0.24),
        new THREE.Vector2(0.05, -0.1),
        new THREE.Vector2(0.048, 0.0),
      ],
      10,
    ),
  );

  const handProto = mkTmp(buildSphere('proto_hand', 0.04, 8, 8));
  handProto.scale.set(0.85, 1.25, 0.65);
  bakeTransform(handProto);

  const thighProto = mkTmp(
    buildLatheMesh(
      'proto_thigh',
      [
        new THREE.Vector2(0.066, -0.4),
        new THREE.Vector2(0.082, -0.2),
        new THREE.Vector2(0.092, 0.0),
      ],
      10,
    ),
  );

  const shinProto = mkTmp(
    buildLatheMesh(
      'proto_shin',
      [
        new THREE.Vector2(0.045, -0.38),
        new THREE.Vector2(0.058, -0.18),
        new THREE.Vector2(0.065, 0.0),
      ],
      10,
    ),
  );

  const bootShape = new Shape2D();
  bootShape.moveTo(-0.042, -0.05);
  bootShape.lineTo(0.042, -0.05);
  bootShape.quadraticCurveTo(0.046, 0.08, 0.034, 0.17, 6);
  bootShape.quadraticCurveTo(0, 0.21, -0.034, 0.17, 6);
  bootShape.quadraticCurveTo(-0.046, 0.08, -0.042, -0.05, 6);
  bootShape.closePath();
  const bootProto = mkTmp(buildExtrudedShapeMesh('proto_boot', bootShape, 0.065, 0.012));
  bootProto.rotation.x = -Math.PI / 2;
  bakeTransform(bootProto);

  const neckProto = mkTmp(buildCylinder('proto_neck', 0.054, 0.064, 0.11, 10));
  const craniumProto = mkTmp(buildSphere('proto_cranium', 0.105, 12, 10));
  craniumProto.scale.set(0.92, 1.12, 1.0);
  bakeTransform(craniumProto);

  const jawProto = mkTmp(buildSphere('proto_jaw', 0.078, 10, 8));
  jawProto.scale.set(0.88, 0.9, 0.95);
  bakeTransform(jawProto);

  const noseProto = mkTmp(buildCylinder('proto_nose', 0, 0.018, 0.045, 6));
  noseProto.rotation.x = -Math.PI / 2;
  bakeTransform(noseProto);

  const hairCapProto = mkTmp(buildSphere('proto_hairCap', 0.11, 10, 8, 0.58));
  hairCapProto.scale.set(0.94, 1.08, 1.04);
  bakeTransform(hairCapProto);

  const officerCapCrownProto = mkTmp(
    buildLatheMesh(
      'proto_officerCap',
      [
        new THREE.Vector2(0.106, 0.0),
        new THREE.Vector2(0.112, 0.04),
        new THREE.Vector2(0.135, 0.085),
        new THREE.Vector2(0.125, 0.105),
        new THREE.Vector2(0.0, 0.112),
      ],
      12,
    ),
  );
  const capVisorProto = mkTmp(buildCylinder('proto_capVisor', 0.108, 0.115, 0.014, 10, false, 0.38));
  const capBadgeProto = mkTmp(buildSphere('proto_capBadge', 0.018, 6, 6));

  const bowlerCrownProto = mkTmp(buildSphere('proto_bowler', 0.112, 10, 8, 0.54));
  const gentBrimProto = mkTmp(
    buildLatheMesh(
      'proto_gentBrim',
      [
        new THREE.Vector2(0.105, 0.0),
        new THREE.Vector2(0.155, -0.01),
        new THREE.Vector2(0.165, 0.012),
      ],
      12,
    ),
  );
  const ladyBrimProto = mkTmp(
    buildLatheMesh(
      'proto_ladyBrim',
      [
        new THREE.Vector2(0.105, 0.0),
        new THREE.Vector2(0.24, -0.025),
        new THREE.Vector2(0.26, -0.015),
      ],
      14,
    ),
  );

  const collarProto = mkTmp(buildCylinder('proto_collar', 0, 0.095, 0.14, 8));
  collarProto.scale.set(1.0, 1.0, 0.45);
  bakeTransform(collarProto);

  const buttonProto = mkTmp(buildSphere('proto_button', 0.014, 6, 6));
  const corkRibProto = mkTmp(buildCapsule('proto_corkRib', 0.038, 0.246, 8));
  const vestStrapProto = mkTmp(buildCylinder('proto_vestStrap', 0.014, 0.014, 0.34, 6));

  // Merged Instanced Crowd Prototypes
  const instHeadSkinProto = mkTmp(
    bakeAndMergeMeshes('proto_instHeadSkin', [
      { mesh: neckProto, ty: 0.02 },
      { mesh: craniumProto, ty: 0.14 },
      { mesh: jawProto, ty: 0.085, tz: -0.025 },
      { mesh: noseProto, ty: 0.13, tz: -0.105 },
    ]),
  );
  const instHairProto = mkTmp(
    bakeAndMergeMeshes('proto_instHair', [{ mesh: hairCapProto, rx: 0.18, ty: 0.155, tz: 0.01 }]),
  );
  const instArmProto = mkTmp(
    bakeAndMergeMeshes('proto_instArm', [
      { mesh: upperArmProto },
      { mesh: forearmProto, rx: 0.22, ty: -0.27 },
      { mesh: handProto, ty: -0.52, tz: -0.055 },
    ]),
  );
  const instLegProto = mkTmp(
    bakeAndMergeMeshes('proto_instLeg', [
      { mesh: thighProto },
      { mesh: shinProto, ty: -0.4 },
      { mesh: bootProto, ty: -0.81, tz: 0.01 },
    ]),
  );
  const instTorsoProto = mkTmp(bakeAndMergeMeshes('proto_instTorso', [{ mesh: coatTorsoProto }]));
  const instSkirtProto = mkTmp(bakeAndMergeMeshes('proto_instSkirt', [{ mesh: skirtProto, ty: -0.02 }]));
  const instHatGentProto = mkTmp(
    bakeAndMergeMeshes('proto_instHatGent', [
      { mesh: bowlerCrownProto, ty: 0.21 },
      { mesh: gentBrimProto, ty: 0.21 },
    ]),
  );
  const instHatLadyProto = mkTmp(
    bakeAndMergeMeshes('proto_instHatLady', [
      { mesh: bowlerCrownProto, sx: 0.95, sy: 0.75, sz: 0.95, ty: 0.215 },
      { mesh: ladyBrimProto, ty: 0.215 },
    ]),
  );
  const instHatCrewProto = mkTmp(
    bakeAndMergeMeshes('proto_instHatCrew', [
      { mesh: officerCapCrownProto, sx: 0.94, sy: 0.94, sz: 0.94, ty: 0.21 },
      { mesh: capVisorProto, rx: -0.14, ry: -Math.PI * 0.88, ty: 0.205, tz: -0.02 },
    ]),
  );
  const instVestProto = mkTmp(
    bakeAndMergeMeshes('proto_instVest', [
      { mesh: corkRibProto, tx: -0.095, ty: 0.21, tz: -0.145 },
      { mesh: corkRibProto, tx: 0, ty: 0.21, tz: -0.145 },
      { mesh: corkRibProto, tx: 0.095, ty: 0.21, tz: -0.145 },
      { mesh: corkRibProto, tx: -0.095, ty: 0.21, tz: 0.145 },
      { mesh: corkRibProto, tx: 0, ty: 0.21, tz: 0.145 },
      { mesh: corkRibProto, tx: 0.095, ty: 0.21, tz: 0.145 },
      { mesh: vestStrapProto, rx: Math.PI / 2, tx: -0.11, ty: 0.36 },
      { mesh: vestStrapProto, rx: Math.PI / 2, tx: 0.11, ty: 0.36 },
    ]),
  );

  // =========================================================================
  // 1. 14 FULL-RIG HERO CREW & OFFICERS
  // =========================================================================
  const characters: DeckCharacter[] = [];
  let charUid = 0;

  const clonePart = (proto: THREE.Mesh, name: string, mat: THREE.Material, parent: THREE.Object3D): THREE.Mesh => {
    return trackMesh(cloneMeshWithMaterial(proto, name, mat, parent));
  };

  const spawnCharacter = (
    role: CharacterRole,
    route: DeckWaypoint[],
    gait: CharacterGait,
    variantIdx: number,
    musterTarget: DeckWaypoint | null,
    initialRotY = 0,
  ): DeckCharacter => {
    const uid = charUid++;
    const scaledRoute = route.map(mapWp);
    const scaledMuster = musterTarget ? mapWp(musterTarget) : null;
    const start = scaledRoute[0];
    const group = new THREE.Group();
    group.name = `hero_${uid}`;
    group.position.set(start.x, start.y, start.z);
    group.rotation.y = initialRotY;

    const bodyRoot = new THREE.Group();
    bodyRoot.name = `hero_${uid}_root`;
    group.add(bodyRoot);
    bodyRoot.position.y = 0.85;

    const coatMat =
      role === 'officer' || role === 'lookout'
        ? officerNavyMat
        : role === 'gentleman'
          ? gentlemanCoatMats[variantIdx % gentlemanCoatMats.length]
          : ladyCoatMats[variantIdx % ladyCoatMats.length];
    const legMat =
      role === 'officer' || role === 'lookout'
        ? officerTrouserMat
        : gentlemanCoatMats[(variantIdx + 1) % gentlemanCoatMats.length];
    const skinMat = skinTones[variantIdx % skinTones.length];
    const hairMat = hairMats[variantIdx % hairMats.length];

    const torsoGroup = new THREE.Group();
    torsoGroup.name = `hero_${uid}_torso`;
    bodyRoot.add(torsoGroup);

    clonePart(role === 'lady' ? ladyBodiceProto : coatTorsoProto, `hero_${uid}_torsoM`, coatMat, torsoGroup);
    const shirtCollar = clonePart(collarProto, `hero_${uid}_collar`, shirtWhiteMat, torsoGroup);
    shirtCollar.rotation.x = Math.PI;
    shirtCollar.position.set(0, 0.46, -0.075);

    if (role === 'officer' || role === 'gentleman') {
      for (let bi = 0; bi < 3; bi++) {
        for (const bx of [-0.036, 0.036]) {
          const btn = clonePart(
            buttonProto,
            `hero_${uid}_btn_${bi}_${bx}`,
            role === 'officer' ? officerGoldMat : coatMat,
            torsoGroup,
          );
          btn.position.set(bx, 0.06 + bi * 0.11, -0.128);
        }
      }
      if (role === 'officer') {
        for (const ex of [-0.18, 0.18]) {
          const ep = clonePart(corkRibProto, `hero_${uid}_ep_${ex}`, officerGoldMat, torsoGroup);
          ep.scale.set(0.55, 0.45, 0.55);
          ep.rotation.z = Math.PI / 2;
          ep.position.set(ex, 0.45, 0);
        }
      }
    }

    const headGroup = new THREE.Group();
    headGroup.name = `hero_${uid}_head`;
    torsoGroup.add(headGroup);
    headGroup.position.set(0, 0.57, 0);

    const neck = clonePart(neckProto, `hero_${uid}_neck`, skinMat, headGroup);
    neck.position.y = 0.02;
    const cranium = clonePart(craniumProto, `hero_${uid}_cranium`, skinMat, headGroup);
    cranium.position.y = 0.14;
    const jaw = clonePart(jawProto, `hero_${uid}_jaw`, skinMat, headGroup);
    jaw.position.set(0, 0.085, -0.025);
    const nose = clonePart(noseProto, `hero_${uid}_nose`, skinMat, headGroup);
    nose.position.set(0, 0.13, -0.105);
    const hair = clonePart(hairCapProto, `hero_${uid}_hair`, hairMat, headGroup);
    hair.position.set(0, 0.155, 0.01);
    hair.rotation.x = 0.18;

    if (role === 'officer') {
      const cap = clonePart(officerCapCrownProto, `hero_${uid}_cap`, shirtWhiteMat, headGroup);
      cap.position.set(0, 0.21, 0);
      const visor = clonePart(capVisorProto, `hero_${uid}_visor`, capBlackVisorMat, headGroup);
      visor.position.set(0, 0.21, -0.02);
      setEulerXYZ(visor, -0.14, -Math.PI * 0.88, 0);
      const badge = clonePart(capBadgeProto, `hero_${uid}_badge`, officerGoldMat, headGroup);
      badge.position.set(0, 0.255, -0.115);
    } else if (role === 'lookout') {
      const cap = clonePart(officerCapCrownProto, `hero_${uid}_cap`, officerNavyMat, headGroup);
      cap.position.set(0, 0.21, 0);
      cap.scale.set(0.92, 0.92, 0.92);
      const visor = clonePart(capVisorProto, `hero_${uid}_visor`, capBlackVisorMat, headGroup);
      visor.position.set(0, 0.205, -0.02);
      visor.rotation.y = -Math.PI * 0.88;
    } else if (role === 'gentleman') {
      const bowler = clonePart(bowlerCrownProto, `hero_${uid}_bowler`, coatMat, headGroup);
      bowler.position.y = 0.21;
      const brim = clonePart(gentBrimProto, `hero_${uid}_brim`, coatMat, headGroup);
      brim.position.y = 0.21;
    } else {
      const crown = clonePart(bowlerCrownProto, `hero_${uid}_lcrown`, coatMat, headGroup);
      crown.position.y = 0.215;
      crown.scale.set(0.95, 0.75, 0.95);
      const brim = clonePart(ladyBrimProto, `hero_${uid}_lbrim`, coatMat, headGroup);
      brim.position.y = 0.215;
    }

    const makeArm = (side: -1 | 1) => {
      const shoulder = new THREE.Group();
      shoulder.name = `hero_${uid}_sh_${side}`;
      torsoGroup.add(shoulder);
      shoulder.position.set(side * (role === 'lady' ? 0.17 : 0.205), 0.41, 0);

      clonePart(upperArmProto, `hero_${uid}_ua_${side}`, coatMat, shoulder);

      const elbow = new THREE.Group();
      elbow.name = `hero_${uid}_el_${side}`;
      shoulder.add(elbow);
      elbow.position.set(0, -0.27, 0);

      clonePart(forearmProto, `hero_${uid}_fa_${side}`, coatMat, elbow);
      const hand = clonePart(handProto, `hero_${uid}_ha_${side}`, skinMat, elbow);
      hand.position.set(0, -0.26, 0);
      return { shoulder, elbow };
    };
    const leftArm = makeArm(-1);
    const rightArm = makeArm(1);

    const makeLeg = (side: -1 | 1) => {
      const hip = new THREE.Group();
      hip.name = `hero_${uid}_hip_${side}`;
      bodyRoot.add(hip);
      hip.position.set(side * 0.095, -0.04, 0);

      clonePart(thighProto, `hero_${uid}_th_${side}`, legMat, hip);

      const knee = new THREE.Group();
      knee.name = `hero_${uid}_kn_${side}`;
      hip.add(knee);
      knee.position.set(0, -0.4, 0);

      clonePart(shinProto, `hero_${uid}_sn_${side}`, legMat, knee);
      const boot = clonePart(bootProto, `hero_${uid}_bt_${side}`, bootLeatherMat, knee);
      boot.position.set(0, -0.42, 0.01);
      return { hip, knee };
    };
    const leftLeg = makeLeg(-1);
    const rightLeg = makeLeg(1);

    let skirtMesh: THREE.Mesh | null = null;
    if (role === 'lady') {
      skirtMesh = clonePart(skirtProto, `hero_${uid}_skirt`, coatMat, bodyRoot);
      skirtMesh.position.y = -0.02;
    }

    const lifejacket = new THREE.Group();
    lifejacket.name = `hero_${uid}_lj`;
    torsoGroup.add(lifejacket);
    for (const zSide of [-0.145, 0.145]) {
      for (const rx of [-0.095, 0, 0.095]) {
        const rib = clonePart(corkRibProto, `hero_${uid}_ljr_${zSide}_${rx}`, lifejacketMat, lifejacket);
        rib.position.set(rx, 0.21, zSide);
      }
    }
    for (const sx of [-0.11, 0.11]) {
      const strap = clonePart(vestStrapProto, `hero_${uid}_ljs_${sx}`, strapMat, lifejacket);
      strap.rotation.x = Math.PI / 2;
      strap.position.set(sx, 0.36, 0);
    }
    lifejacket.visible = false;

    const targetParent = start.z < breakZ ? bowContent : sternContent;
    targetParent.add(group);
    rootGroups.push(group);

    const personalityList: CharacterPersonality[] = ['dutiful', 'curious', 'calm', 'social'];
    const ch: DeckCharacter = {
      group,
      bodyRoot,
      torsoGroup,
      headGroup,
      leftArmHip: leftArm.shoulder,
      leftElbow: leftArm.elbow,
      rightArmHip: rightArm.shoulder,
      rightElbow: rightArm.elbow,
      leftLegHip: leftLeg.hip,
      leftKnee: leftLeg.knee,
      rightLegHip: rightLeg.hip,
      rightKnee: rightLeg.knee,
      skirtMesh,
      lifejacket,
      role,
      gait,
      personality: role === 'officer' || role === 'lookout' ? 'dutiful' : personalityList[variantIdx % 4],
      panicThreshold: role === 'officer' ? 28 : 16 + (variantIdx % 5) * 4,
      intent: gait === 'idle' ? 'rail_watch' : 'stroll',
      decisionTimer: 1.5 + (variantIdx % 4) * 0.8,
      gazeYaw: 0,
      route: scaledRoute,
      musterTarget: scaledMuster,
      waypointIdx: scaledRoute.length > 1 ? 1 : 0,
      pauseTimer: 0,
      walkSpeed: role === 'officer' ? 1.55 : 1.35 + (variantIdx % 3) * 0.18,
      runSpeed: 3.9 + (variantIdx % 4) * 0.32,
      strideCycle: variantIdx * 1.1,
      phase: (start.x * 1.7 + start.z * 0.9) % (Math.PI * 2),
      baseRotY: initialRotY,
      posX: start.x,
      posY: start.y,
      posZ: start.z,
      isHalfBow: start.z < breakZ,
    };
    characters.push(ch);
    return ch;
  };

  // 1-2: Wheelhouse Watch Officers
  const qmOfficer = spawnCharacter(
    'officer',
    [
      { x: 1.55, y: 13.06, z: -0.35, pauseSec: 2.2 },
      { x: 1.65, y: 13.06, z: 0.75, pauseSec: 1.6 },
      { x: 0.95, y: 13.06, z: 0.85, pauseSec: 2.5 },
    ],
    'walk',
    0,
    null,
    0.2,
  );
  qmOfficer.helmStation = { x: -0.4, y: 13.06, z: 0.62, yaw: -0.22, role: 'helmsman' };

  const bridgeWatchOfficer = spawnCharacter(
    'officer',
    [
      { x: -1.45, y: 13.06, z: 0.1, pauseSec: 2.4 },
      { x: -1.9, y: 13.06, z: 1.4, pauseSec: 2.0 },
    ],
    'walk',
    1,
    null,
    -0.2,
  );
  bridgeWatchOfficer.helmStation = { x: 0.86, y: 13.06, z: 0.16, yaw: 0.08, role: 'watch_officer' };

  // 3-4: Port & Starboard Bridge Wing Officers
  const stbdWingOfficer = spawnCharacter(
    'officer',
    [
      { x: 7.4, y: 13.06, z: -0.5, pauseSec: 1.4 },
      { x: 14.3, y: 13.06, z: -0.5, pauseSec: 2.8 },
    ],
    'walk',
    2,
    { x: 11.4, y: 12.88, z: 9.0 },
  );
  stbdWingOfficer.bowTarget = mapWp({ x: 10.6, y: 12.88, z: -7.5, pauseSec: 0 });

  const portWingOfficer = spawnCharacter(
    'officer',
    [
      { x: -7.4, y: 13.06, z: -0.5, pauseSec: 1.6 },
      { x: -14.3, y: 13.06, z: -0.5, pauseSec: 2.5 },
    ],
    'walk',
    3,
    { x: -11.4, y: 12.88, z: 9.0 },
  );
  portWingOfficer.bowTarget = mapWp({ x: -10.6, y: 12.88, z: -7.5, pauseSec: 0 });

  // 5-6: Crow's Nest Lookouts
  spawnCharacter('lookout', [{ x: -0.3, y: 25.4, z: -22.55 }], 'idle', 0, null, 0.08);
  spawnCharacter('lookout', [{ x: 0.3, y: 25.4, z: -22.45 }], 'idle', 1, null, -0.08);

  // 7-8: Forecastle Anchor Watch Crewmen
  const bowWatchPort = spawnCharacter(
    'officer',
    [
      { x: -2.2, y: 9.2, z: -56.0, pauseSec: 2.0 },
      { x: -5.4, y: 9.2, z: -38.0, pauseSec: 1.5 },
    ],
    'walk',
    4,
    { x: -9.5, y: 12.88, z: 10.0 },
  );
  bowWatchPort.bowTarget = mapWp({ x: -1.65, y: 10.02, z: -69.2, pauseSec: 0 });

  const bowWatchStbd = spawnCharacter(
    'officer',
    [
      { x: 2.2, y: 9.2, z: -59.0, pauseSec: 2.2 },
      { x: 5.2, y: 9.2, z: -39.0, pauseSec: 1.8 },
    ],
    'walk',
    5,
    { x: 9.5, y: 12.88, z: 10.0 },
  );
  bowWatchStbd.bowTarget = mapWp({ x: 1.65, y: 10.02, z: -69.2, pauseSec: 0 });

  // 9-10: Aft Docking Bridge Watch Officers
  spawnCharacter(
    'officer',
    [
      { x: -4.8, y: 10.52, z: 172.5, pauseSec: 2.4 },
      { x: 4.8, y: 10.52, z: 172.5, pauseSec: 2.4 },
    ],
    'walk',
    6,
    { x: -9.5, y: 12.88, z: 130.0 },
  );
  spawnCharacter(
    'officer',
    [
      { x: 1.6, y: 10.52, z: 172.4, pauseSec: 3.0 },
      { x: -1.6, y: 10.52, z: 172.6, pauseSec: 2.8 },
    ],
    'walk',
    7,
    { x: 9.5, y: 12.88, z: 130.0 },
  );

  // 11-14: Boat Deck Quartermasters
  const fwdQmStbd = spawnCharacter(
    'officer',
    [
      { x: 11.1, y: 12.88, z: 9.0, pauseSec: 1.8 },
      { x: 11.1, y: 12.88, z: 36.5, pauseSec: 1.8 },
    ],
    'walk',
    8,
    { x: 11.4, y: 12.88, z: 18.2 },
  );
  fwdQmStbd.bowTarget = mapWp({ x: 10.2, y: 12.88, z: 3.8, pauseSec: 0 });

  const fwdQmPort = spawnCharacter(
    'officer',
    [
      { x: -11.1, y: 12.88, z: 36.5, pauseSec: 1.8 },
      { x: -11.1, y: 12.88, z: 9.0, pauseSec: 1.8 },
    ],
    'walk',
    9,
    { x: -11.4, y: 12.88, z: 18.2 },
  );
  fwdQmPort.bowTarget = mapWp({ x: -10.2, y: 12.88, z: 3.8, pauseSec: 0 });

  spawnCharacter(
    'officer',
    [
      { x: 11.1, y: 12.88, z: 102.0, pauseSec: 1.8 },
      { x: 11.1, y: 12.88, z: 130.0, pauseSec: 1.8 },
    ],
    'walk',
    10,
    { x: 11.4, y: 12.88, z: 111.7 },
  );
  spawnCharacter(
    'officer',
    [
      { x: -11.1, y: 12.88, z: 130.0, pauseSec: 1.8 },
      { x: -11.1, y: 12.88, z: 102.0, pauseSec: 1.8 },
    ],
    'walk',
    11,
    { x: -11.4, y: 12.88, z: 111.7 },
  );

  // =========================================================================
  // 2. INSTANCED ARTICULATED PASSENGERS & CREW
  // =========================================================================
  const rand = mulberry32(19120414);

  const skinPalette = [0xe4b99b, 0xd8a888, 0xecc0a3, 0xcf9b7a, 0xf0cbb2];
  const hairPalette = [0x1c1410, 0x3b2619, 0x5c4230, 0x7b6b5e, 0xa89f96];
  const gentCoatPalette = [0x1a2029, 0x2f251e, 0x26313a, 0x3d352d, 0x242934, 0x4b3b2d];
  const ladyDressPalette = [0x61222e, 0x223e4d, 0x4b3d59, 0x9c8060, 0x24463b, 0x7c4632, 0x314a63];
  const trouserPalette = [0x121720, 0x1e2024, 0x2a2622, 0x18212b];

  interface HalfCrowdBatch {
    halfContent: THREE.Group;
    actors: CrowdActor[];
    ladyCount: number;
    gentCount: number;
    crewCount: number;
    torsoInst: InstancedSlot;
    headInst: InstancedSlot;
    hairInst: InstancedSlot;
    leftArmInst: InstancedSlot;
    rightArmInst: InstancedSlot;
    leftLegInst: InstancedSlot;
    rightLegInst: InstancedSlot;
    vestInst: InstancedSlot;
    skirtInst: InstancedSlot;
    hatLadyInst: InstancedSlot;
    hatGentInst: InstancedSlot;
    hatCrewInst: InstancedSlot;
  }

  interface ActorSeedSpec {
    kind: CrowdKind;
    startX: number;
    startY: number;
    startZ: number;
    endX: number;
    endY: number;
    endZ: number;
    musterX: number;
    musterY: number;
    musterZ: number;
    isWalker: boolean;
    facingYaw?: number;
  }

  const fwdSeeds: ActorSeedSpec[] = [];
  const aftSeeds: ActorSeedSpec[] = [];

  const pickKind = (crewWeight: number): CrowdKind => {
    const r = rand();
    if (r < crewWeight) return 'crew';
    return r < crewWeight + (1 - crewWeight) * 0.52 ? 'gentleman' : 'lady';
  };

  for (let i = 0; i < 42; i++) {
    const side: -1 | 1 = i % 2 === 0 ? 1 : -1;
    const isCourtyard = i % 5 === 0;
    const kind = pickKind(0.16);
    if (isCourtyard) {
      const band = i % 3;
      const czMin = band === 0 ? 19.6 : band === 1 ? 52.5 : 82.5;
      const czMax = band === 0 ? 26.8 : band === 1 ? 62.5 : 87.5;
      const cSide: -1 | 1 = (i >> 1) % 2 === 0 ? 1 : -1;
      const x0 = cSide * MathUtils.lerp(5.8, 10.8, rand());
      const z0 = MathUtils.lerp(czMin, czMax, rand());
      const x1 = cSide * MathUtils.lerp(5.8, 11.0, rand());
      const z1 = MathUtils.lerp(czMin, czMax, rand());
      const mSide: -1 | 1 = x0 >= 0 ? 1 : -1;
      const boatZ = fwdBoatZ[i % 4];
      fwdSeeds.push({
        kind,
        startX: mapX(x0),
        startY: 12.88,
        startZ: mapZ(z0),
        endX: mapX(x1),
        endY: 12.88,
        endZ: mapZ(z1),
        musterX: mapX(mSide * (10.5 + rand() * 1.1)),
        musterY: 12.88,
        musterZ: boatZ + (rand() - 0.5) * 4.4,
        isWalker: rand() < 0.52,
        facingYaw: rand() * Math.PI * 2,
      });
    } else {
      const laneX = side * (7.6 + rand() * 3.5);
      const z0 = MathUtils.lerp(4.0, 86.5, rand());
      const span = MathUtils.lerp(12, 34, rand()) * (rand() < 0.5 ? 1 : -1);
      const z1 = MathUtils.clamp(z0 + span, 3.0, 87.5);
      const boatZ = fwdBoatZ[i % 4];
      fwdSeeds.push({
        kind,
        startX: mapX(laneX),
        startY: 12.88,
        startZ: mapZ(z0),
        endX: mapX(side * (7.6 + rand() * 3.5)),
        endY: 12.88,
        endZ: mapZ(z1),
        musterX: mapX(side * (10.4 + rand() * 1.2)),
        musterY: 12.88,
        musterZ: boatZ + (rand() - 0.5) * 4.4,
        isWalker: rand() < 0.68,
        facingYaw: side > 0 ? -Math.PI / 2 : Math.PI / 2,
      });
    }
  }

  for (let i = 0; i < 24; i++) {
    const side: -1 | 1 = i % 2 === 0 ? 1 : -1;
    const kind = pickKind(0.12);
    const x0 = side * (11.95 + rand() * 0.9);
    const z0 = MathUtils.lerp(-6.5, 86.5, rand());
    const z1 = MathUtils.clamp(z0 + (rand() < 0.5 ? 1 : -1) * (14 + rand() * 26), -6.5, 87.0);
    fwdSeeds.push({
      kind,
      startX: mapX(x0),
      startY: 9.86,
      startZ: mapZ(z0),
      endX: mapX(side * (11.95 + rand() * 0.9)),
      endY: 9.86,
      endZ: mapZ(z1),
      musterX: mapX(side * (12.1 + rand() * 0.8)),
      musterY: 9.86,
      musterZ: mapZ(MathUtils.lerp(6, 44, rand())),
      isWalker: rand() < 0.65,
      facingYaw: side > 0 ? -Math.PI / 2 : Math.PI / 2,
    });
  }

  for (let i = 0; i < 20; i++) {
    const side: -1 | 1 = i % 2 === 0 ? 1 : -1;
    const kind = pickKind(0.24);
    const isCrossAisle = i % 4 === 0;
    const x0 = isCrossAisle ? MathUtils.lerp(-9.5, 9.5, rand()) : side * (4.4 + rand() * 5.8);
    const z0 = isCrossAisle
      ? i % 8 === 0
        ? MathUtils.lerp(-33.5, -31.8, rand())
        : MathUtils.lerp(-24.8, -21.8, rand())
      : MathUtils.lerp(-33.2, -11.4, rand());
    const x1 = isCrossAisle ? MathUtils.clamp(x0 + (rand() - 0.5) * 8, -9.8, 9.8) : side * (4.4 + rand() * 5.6);
    const z1 = isCrossAisle ? z0 : MathUtils.clamp(z0 + (rand() - 0.5) * 14, -33.2, -11.4);
    const mSide: -1 | 1 = x0 >= 0 ? 1 : -1;
    fwdSeeds.push({
      kind,
      startX: mapX(x0),
      startY: 6.62,
      startZ: mapZ(z0),
      endX: mapX(x1),
      endY: 6.62,
      endZ: mapZ(z1),
      musterX: mapX(mSide * (11.8 + rand() * 0.9)),
      musterY: 9.86,
      musterZ: mapZ(MathUtils.lerp(-4, 24, rand())),
      isWalker: rand() < 0.58,
      facingYaw: rand() * Math.PI * 2,
    });
  }

  for (let i = 0; i < 12; i++) {
    const kind = pickKind(0.45);
    const z0 = MathUtils.lerp(-64.5, -37.0, rand());
    const t0 = MathUtils.clamp((z0 + 68) / 33, 0, 1);
    const maxW0 = MathUtils.lerp(1.9, 9.2, t0);
    let x0 = (rand() * 2 - 1) * maxW0;
    if (Math.abs(z0 + 55) < 2.2 && Math.abs(Math.abs(x0) - 3.4) < 1.3) {
      x0 = Math.sign(x0 || 1) * 5.5;
    }
    const z1 = MathUtils.clamp(z0 + (rand() - 0.5) * 10, -64.5, -37.0);
    const t1 = MathUtils.clamp((z1 + 68) / 33, 0, 1);
    const maxW1 = MathUtils.lerp(1.9, 9.2, t1);
    const x1 = (rand() * 2 - 1) * maxW1;
    fwdSeeds.push({
      kind,
      startX: mapX(x0),
      startY: 9.2,
      startZ: mapZ(z0),
      endX: mapX(x1),
      endY: 9.2,
      endZ: mapZ(z1),
      musterX: mapX((x0 >= 0 ? 1 : -1) * (8.2 + rand() * 2.4)),
      musterY: 9.2,
      musterZ: mapZ(MathUtils.lerp(-44, -37, rand())),
      isWalker: rand() < 0.5,
      facingYaw: rand() * Math.PI * 2,
    });
  }

  for (let i = 0; i < 26; i++) {
    const side: -1 | 1 = i % 2 === 0 ? 1 : -1;
    const isCourtyard = i % 4 === 0;
    const kind = pickKind(0.15);
    const boatZ = aftBoatZ[i % 4];
    if (isCourtyard) {
      const zMin = i % 8 === 0 ? 111.5 : 133.0;
      const zMax = i % 8 === 0 ? 119.5 : 135.2;
      const cSide: -1 | 1 = (i >> 1) % 2 === 0 ? 1 : -1;
      const x0 = zMin < 120 ? cSide * MathUtils.lerp(5.8, 10.5, rand()) : MathUtils.lerp(-10.5, 10.5, rand());
      const z0 = MathUtils.lerp(zMin, zMax, rand());
      aftSeeds.push({
        kind,
        startX: mapX(x0),
        startY: 12.88,
        startZ: mapZ(z0),
        endX: mapX(
          zMin < 120
            ? cSide * MathUtils.lerp(5.8, 10.8, rand())
            : MathUtils.clamp(x0 + (rand() - 0.5) * 7, -10.8, 10.8),
        ),
        endY: 12.88,
        endZ: mapZ(MathUtils.lerp(zMin, zMax, rand())),
        musterX: mapX((x0 >= 0 ? 1 : -1) * (10.5 + rand() * 1.1)),
        musterY: 12.88,
        musterZ: boatZ + (rand() - 0.5) * 4.2,
        isWalker: rand() < 0.55,
        facingYaw: rand() * Math.PI * 2,
      });
    } else {
      const z0 = MathUtils.lerp(93.0, 145.0, rand());
      const z1 = MathUtils.clamp(z0 + (rand() < 0.5 ? 1 : -1) * (10 + rand() * 24), 93.0, 145.5);
      aftSeeds.push({
        kind,
        startX: mapX(side * (7.3 + rand() * 3.8)),
        startY: 12.88,
        startZ: mapZ(z0),
        endX: mapX(side * (7.3 + rand() * 3.8)),
        endY: 12.88,
        endZ: mapZ(z1),
        musterX: mapX(side * (10.4 + rand() * 1.2)),
        musterY: 12.88,
        musterZ: boatZ + (rand() - 0.5) * 4.2,
        isWalker: rand() < 0.66,
        facingYaw: side > 0 ? -Math.PI / 2 : Math.PI / 2,
      });
    }
  }

  for (let i = 0; i < 16; i++) {
    const side: -1 | 1 = i % 2 === 0 ? 1 : -1;
    const kind = pickKind(0.12);
    const z0 = MathUtils.lerp(92.5, 144.0, rand());
    const z1 = MathUtils.clamp(z0 + (rand() < 0.5 ? 1 : -1) * (10 + rand() * 22), 92.5, 144.5);
    aftSeeds.push({
      kind,
      startX: mapX(side * (11.95 + rand() * 0.85)),
      startY: 9.86,
      startZ: mapZ(z0),
      endX: mapX(side * (11.95 + rand() * 0.85)),
      endY: 9.86,
      endZ: mapZ(z1),
      musterX: mapX(side * (12.1 + rand() * 0.8)),
      musterY: 9.86,
      musterZ: mapZ(MathUtils.lerp(100, 134, rand())),
      isWalker: rand() < 0.64,
      facingYaw: side > 0 ? -Math.PI / 2 : Math.PI / 2,
    });
  }

  for (let i = 0; i < 14; i++) {
    const side: -1 | 1 = i % 2 === 0 ? 1 : -1;
    const kind = pickKind(0.22);
    const x0 = side * (4.3 + rand() * 5.4);
    const z0 = MathUtils.lerp(149.2, 168.5, rand());
    aftSeeds.push({
      kind,
      startX: mapX(x0),
      startY: 6.62,
      startZ: mapZ(z0),
      endX: mapX(side * (4.3 + rand() * 5.2)),
      endY: 6.62,
      endZ: mapZ(MathUtils.clamp(z0 + (rand() - 0.5) * 12, 149.2, 168.5)),
      musterX: mapX(side * (11.8 + rand() * 0.8)),
      musterY: 9.86,
      musterZ: mapZ(MathUtils.lerp(126, 143, rand())),
      isWalker: rand() < 0.56,
      facingYaw: rand() * Math.PI * 2,
    });
  }

  for (let i = 0; i < 12; i++) {
    const kind = pickKind(0.18);
    const z0 = MathUtils.lerp(174.5, 190.5, rand());
    const t0 = MathUtils.clamp((193 - z0) / 19, 0, 1);
    const maxW0 = MathUtils.lerp(2.4, 8.6, t0);
    const x0 = (rand() * 2 - 1) * maxW0;
    const z1 = MathUtils.clamp(z0 + (rand() - 0.5) * 9, 174.5, 190.5);
    const t1 = MathUtils.clamp((193 - z1) / 19, 0, 1);
    const maxW1 = MathUtils.lerp(2.4, 8.6, t1);
    const x1 = (rand() * 2 - 1) * maxW1;
    aftSeeds.push({
      kind,
      startX: mapX(x0),
      startY: 8.4,
      startZ: mapZ(z0),
      endX: mapX(x1),
      endY: 8.4,
      endZ: mapZ(z1),
      musterX: mapX((x0 >= 0 ? 1 : -1) * (4.0 + rand() * 3.6)),
      musterY: 8.4,
      musterZ: mapZ(MathUtils.lerp(174.5, 184.0, rand())),
      isWalker: rand() < 0.52,
      facingYaw: rand() * Math.PI * 2,
    });
  }

  const instancedMeshes: THREE.InstancedMesh[] = [];

  let batchUid = 0;
  const createHalfCrowdBatch = (
    halfContent: THREE.Group,
    seeds: ActorSeedSpec[],
  ): HalfCrowdBatch => {
    const bid = batchUid++;
    const n = seeds.length;
    const actors: CrowdActor[] = [];
    const ladyIndices: number[] = [];
    const gentIndices: number[] = [];
    const crewIndices: number[] = [];

    for (let i = 0; i < n; i++) {
      const s = seeds[i];
      let roleIdx = 0;
      if (s.kind === 'lady') {
        roleIdx = ladyIndices.length;
        ladyIndices.push(i);
      } else if (s.kind === 'gentleman') {
        roleIdx = gentIndices.length;
        gentIndices.push(i);
      } else {
        roleIdx = crewIndices.length;
        crewIndices.push(i);
      }
      const dx = s.endX - s.startX;
      const dz = s.endZ - s.startZ;
      const initialYaw = s.isWalker && Math.hypot(dx, dz) > 0.2 ? Math.atan2(-dx, -dz) : s.facingYaw ?? 0;

      let bowPanicX = s.startX;
      let bowPanicY = s.startY;
      let bowPanicZ = s.startZ;
      let bowPanicYaw = 0;
      const isFwdBatch = halfContent === bowContent;

      if (isFwdBatch) {
        const bSide = s.startX >= 0 ? 1 : -1;
        if (i % 3 === 0) {
          const zBow = MathUtils.lerp(-69.5 * scaleZ, -38.0 * scaleZ, rand());
          const tBow = MathUtils.clamp((zBow / scaleZ + 74) / 64, 0, 1);
          const beam = 14.0 * scaleX * Math.pow(Math.sin((tBow * Math.PI) / 2), 0.78);
          const flare = 0.26 * (1 - tBow) + 0.05;
          const railX = Math.max(0.65, beam * (1 + flare) - 0.85);
          const sheerT = MathUtils.clamp((-35 - zBow / scaleZ) / 39, 0, 1);
          bowPanicX = bSide * MathUtils.clamp(railX - rand() * 0.75, 0.45, railX);
          bowPanicY = 9.16 + sheerT * 1.02;
          bowPanicZ = zBow;
          bowPanicYaw = Math.atan2(-bSide * 0.75, 0.66);
        } else if (i % 3 === 1) {
          bowPanicX = bSide * MathUtils.lerp(8.2, 11.4, rand()) * scaleX;
          bowPanicY = 6.62;
          bowPanicZ = MathUtils.lerp(-32.0, -12.5, rand()) * scaleZ;
          bowPanicYaw = Math.atan2(-bSide * 0.5, 0.85);
        } else {
          bowPanicX = bSide * MathUtils.lerp(8.2, 11.8, rand()) * scaleX;
          bowPanicY = 12.88;
          bowPanicZ = MathUtils.lerp(3.5, 17.5, rand()) * scaleZ;
          bowPanicYaw = Math.atan2(-bSide * 0.35, 0.94);
        }
      } else {
        const bSide = s.startX >= 0 ? 1 : -1;
        if (s.startY > 11.0) {
          bowPanicX = bSide * MathUtils.lerp(7.2, 11.4, rand()) * scaleX;
          bowPanicY = 12.88;
          bowPanicZ = MathUtils.lerp(91.5, 101.0, rand()) * scaleZ;
        } else if (s.startY > 9.0) {
          bowPanicX = bSide * MathUtils.lerp(11.6, 12.8, rand()) * scaleX;
          bowPanicY = 9.86;
          bowPanicZ = MathUtils.lerp(91.5, 102.0, rand()) * scaleZ;
        } else {
          bowPanicX = bSide * MathUtils.lerp(3.8, 9.2, rand()) * scaleX;
          bowPanicY = s.startY;
          bowPanicZ =
            s.startZ < 170 * scaleZ
              ? MathUtils.lerp(149.2, 154.0, rand()) * scaleZ
              : MathUtils.lerp(171.2, 175.0, rand()) * scaleZ;
        }
        bowPanicYaw = Math.atan2(-bSide * 0.3, 0.95);
      }

      const personalityPool: CharacterPersonality[] =
        s.kind === 'crew' ? ['dutiful', 'calm'] : ['curious', 'social', 'calm'];
      const personality = personalityPool[Math.floor(rand() * personalityPool.length)];
      const panicThreshold =
        s.kind === 'crew' ? 24 + Math.floor(rand() * 18) : 11 + Math.floor(rand() * 24);

      actors.push({
        kind: s.kind,
        allIdx: i,
        roleIdx,
        personality,
        panicThreshold,
        intent: s.isWalker ? 'stroll' : Math.abs(s.startX) > 8.4 ? 'rail_watch' : 'converse',
        decisionTimer: 1.0 + rand() * 3.8,
        gazeYaw: 0,
        peerYaw: initialYaw,
        startX: s.startX,
        startY: s.startY,
        startZ: s.startZ,
        endX: s.endX,
        endY: s.endY,
        endZ: s.endZ,
        musterX: s.musterX,
        musterY: s.musterY,
        musterZ: s.musterZ,
        bowPanicX,
        bowPanicY,
        bowPanicZ,
        bowPanicYaw,
        posX: s.startX,
        posY: s.startY,
        posZ: s.startZ,
        rotY: initialYaw,
        baseRotY: initialYaw,
        goingForward: true,
        isWalker: s.isWalker,
        pauseTimer: rand() * 1.8,
        walkSpeed: s.kind === 'crew' ? 1.45 + rand() * 0.28 : 1.15 + rand() * 0.34,
        runSpeed: 3.55 + rand() * 0.95,
        strideCycle: rand() * Math.PI * 2,
        phase: rand() * Math.PI * 2,
        scaleH: 0.92 + rand() * 0.14,
        scaleW: s.kind === 'lady' ? 0.88 + rand() * 0.1 : 0.94 + rand() * 0.12,
      });
    }

    const coloredSlots: InstancedSlot[] = [];
    const makeSlot = (
      proto: THREE.Mesh,
      name: string,
      mat: THREE.Material,
      count: number,
      withColor: boolean,
    ): InstancedSlot => {
      const c = Math.max(1, count);
      const slot = createInstancedSlot(`crowd_${bid}_${name}`, proto.geometry, mat, c, withColor, halfContent);
      instancedMeshes.push(slot.mesh);
      if (count === 0) {
        writeZeroInstanceMatrix(slot, 0);
        commitInstanceMatrices(slot, 0);
      }
      if (withColor) coloredSlots.push(slot);
      return slot;
    };

    const torsoInst = makeSlot(instTorsoProto, 'torso', instClothMat, n, true);
    const headInst = makeSlot(instHeadSkinProto, 'head', instSkinMat, n, true);
    const hairInst = makeSlot(instHairProto, 'hair', instHairMat, n, true);
    const leftArmInst = makeSlot(instArmProto, 'larm', instClothMat, n, true);
    const rightArmInst = makeSlot(instArmProto, 'rarm', instClothMat, n, true);
    const leftLegInst = makeSlot(instLegProto, 'lleg', instClothMat, n, true);
    const rightLegInst = makeSlot(instLegProto, 'rleg', instClothMat, n, true);
    const vestInst = makeSlot(instVestProto, 'vest', lifejacketMat, n, false);

    const skirtInst = makeSlot(instSkirtProto, 'skirt', instClothMat, ladyIndices.length, true);
    const hatLadyInst = makeSlot(instHatLadyProto, 'hatLady', instClothMat, ladyIndices.length, true);
    const hatGentInst = makeSlot(instHatGentProto, 'hatGent', instClothMat, gentIndices.length, true);
    const hatCrewInst = makeSlot(instHatCrewProto, 'hatCrew', instClothMat, crewIndices.length, true);

    for (let i = 0; i < n; i++) {
      const actor = actors[i];
      const skinHex = skinPalette[Math.floor(rand() * skinPalette.length)];
      const hairHex = hairPalette[Math.floor(rand() * hairPalette.length)];
      let coatHex = 0x131d2f;
      let trouserHex = 0x0f1624;
      let hatHex = 0x131d2f;

      if (actor.kind === 'gentleman') {
        coatHex = gentCoatPalette[Math.floor(rand() * gentCoatPalette.length)];
        trouserHex = trouserPalette[Math.floor(rand() * trouserPalette.length)];
        hatHex = coatHex;
      } else if (actor.kind === 'lady') {
        coatHex = ladyDressPalette[Math.floor(rand() * ladyDressPalette.length)];
        trouserHex = coatHex;
        hatHex = coatHex;
      } else {
        const isSteward = i % 3 === 0;
        coatHex = isSteward ? 0xdcd7cb : 0x152033;
        trouserHex = 0x0e1522;
        hatHex = i % 5 === 0 ? 0xf0ece0 : 0x141d2c;
      }

      setInstanceColorHex(torsoInst, i, coatHex);
      setInstanceColorHex(leftArmInst, i, coatHex);
      setInstanceColorHex(rightArmInst, i, coatHex);
      setInstanceColorHex(leftLegInst, i, trouserHex);
      setInstanceColorHex(rightLegInst, i, trouserHex);
      setInstanceColorHex(headInst, i, skinHex);
      setInstanceColorHex(hairInst, i, hairHex);

      if (actor.kind === 'lady') {
        setInstanceColorHex(skirtInst, actor.roleIdx, coatHex);
        setInstanceColorHex(hatLadyInst, actor.roleIdx, hatHex);
      } else if (actor.kind === 'gentleman') {
        setInstanceColorHex(hatGentInst, actor.roleIdx, hatHex);
      } else {
        setInstanceColorHex(hatCrewInst, actor.roleIdx, hatHex);
      }
    }

    for (const slot of coloredSlots) {
      commitInstanceColors(slot);
    }

    return {
      halfContent,
      actors,
      ladyCount: ladyIndices.length,
      gentCount: gentIndices.length,
      crewCount: crewIndices.length,
      torsoInst,
      headInst,
      hairInst,
      leftArmInst,
      rightArmInst,
      leftLegInst,
      rightLegInst,
      vestInst,
      skirtInst,
      hatLadyInst,
      hatGentInst,
      hatCrewInst,
    };
  };

  const fwdBatch = createHalfCrowdBatch(bowContent, fwdSeeds);
  const aftBatch = createHalfCrowdBatch(sternContent, aftSeeds);
  const batches = [fwdBatch, aftBatch];

  const writeActorMatrices = (
    batch: HalfCrowdBatch,
    a: CrowdActor,
    moving: boolean,
    isRunning: boolean,
    showVest: boolean,
    time: number,
    checkSubmerged: boolean,
    shipRoll: number,
    waving: boolean,
  ) => {
    if (checkSubmerged) {
      batch.halfContent.updateWorldMatrix(true, false);
      _vPos.set(a.posX, a.posY, a.posZ).applyMatrix4(batch.halfContent.matrixWorld);
      if (_vPos.y < -0.95) {
        const idx = a.allIdx;
        writeZeroInstanceMatrix(batch.torsoInst, idx);
        writeZeroInstanceMatrix(batch.headInst, idx);
        writeZeroInstanceMatrix(batch.hairInst, idx);
        writeZeroInstanceMatrix(batch.leftArmInst, idx);
        writeZeroInstanceMatrix(batch.rightArmInst, idx);
        writeZeroInstanceMatrix(batch.leftLegInst, idx);
        writeZeroInstanceMatrix(batch.rightLegInst, idx);
        writeZeroInstanceMatrix(batch.vestInst, idx);
        if (a.kind === 'lady') {
          writeZeroInstanceMatrix(batch.skirtInst, a.roleIdx);
          writeZeroInstanceMatrix(batch.hatLadyInst, a.roleIdx);
        } else if (a.kind === 'gentleman') {
          writeZeroInstanceMatrix(batch.hatGentInst, a.roleIdx);
        } else {
          writeZeroInstanceMatrix(batch.hatCrewInst, a.roleIdx);
        }
        return;
      }
    }

    const c = a.strideCycle;
    const strideAmp = moving ? (isRunning ? 0.72 : 0.4) : 0;
    const armAmp = moving ? (isRunning ? 0.85 : 0.34) : 0;
    const bob = moving
      ? Math.abs(Math.sin(c)) * (isRunning ? 0.07 : 0.025) - (isRunning ? 0.035 : 0)
      : Math.sin(time * 1.6 + a.phase) * 0.006;

    const isConversing = !moving && a.intent === 'converse';
    const isBracing = !moving && a.intent === 'brace';
    const isHoldingBow = !moving && a.intent === 'hold_bow';
    const isScreamingRun = moving && isRunning && a.intent === 'hold_bow';

    const torsoPitch = moving
      ? isRunning
        ? -0.24
        : -0.05
      : isHoldingBow
        ? -0.15 + Math.sin(time * 9.0 + a.phase) * 0.025
        : isBracing
          ? -0.04
          : 0;
    const torsoRoll = isBracing || isHoldingBow ? -shipRoll * 0.72 : -shipRoll * 0.25;
    const torsoYaw = moving
      ? Math.sin(c) * (isRunning ? 0.12 : 0.05)
      : isHoldingBow
        ? Math.sin(time * 6.5 + a.phase) * 0.07
        : isConversing
          ? Math.sin(time * 1.2 + a.phase) * 0.12
          : Math.sin(time * 0.65 + a.phase) * 0.05;
    const headPitch = isHoldingBow
      ? -0.22 + Math.sin(time * 11.0 + a.phase) * 0.08
      : isScreamingRun
        ? -0.16 + Math.sin(time * 10.0 + a.phase) * 0.07
        : 0;
    const headYaw = moving
      ? MathUtils.clamp(a.gazeYaw * 0.4 + Math.sin(time * (isRunning ? 5.2 : 0.9) + a.phase) * 0.18, -0.75, 0.75)
      : isHoldingBow
        ? Math.sin(time * 7.5 + a.phase * 1.7) * 0.35
        : MathUtils.clamp(a.gazeYaw + Math.sin(time * 0.95 + a.phase * 1.3) * 0.24, -0.85, 0.85);

    const swingL = moving ? Math.sin(c) * strideAmp : 0;
    const swingR = -swingL;

    // 1. Pelvis matrix
    _euler.set(0, a.rotY, 0, 'XYZ');
    _qRot.setFromEuler(_euler);
    _pelvisMat.compose(
      _vPos.set(a.posX, a.posY + (0.85 + bob) * a.scaleH, a.posZ),
      _qRot,
      _vScale.set(a.scaleW, a.scaleH, a.scaleW),
    );

    // Legs
    _euler.set(swingL, 0, isBracing || isHoldingBow ? -0.11 : 0, 'XYZ');
    _qRot.setFromEuler(_euler);
    _localMat.compose(_vPos.set(-0.095, -0.04, 0), _qRot, _vOne);
    _partMat.multiplyMatrices(_pelvisMat, _localMat);
    batch.leftLegInst.mesh.setMatrixAt(a.allIdx, _partMat);

    _euler.set(swingR, 0, isBracing || isHoldingBow ? 0.11 : 0, 'XYZ');
    _qRot.setFromEuler(_euler);
    _localMat.compose(_vPos.set(0.095, -0.04, 0), _qRot, _vOne);
    _partMat.multiplyMatrices(_pelvisMat, _localMat);
    batch.rightLegInst.mesh.setMatrixAt(a.allIdx, _partMat);

    if (a.kind === 'lady') {
      _euler.set(moving ? Math.sin(c) * (isRunning ? 0.14 : 0.07) : 0, 0, 0, 'XYZ');
      _qRot.setFromEuler(_euler);
      _localMat.compose(_vPos.set(0, 0, 0), _qRot, _vOne);
      _partMat.multiplyMatrices(_pelvisMat, _localMat);
      batch.skirtInst.mesh.setMatrixAt(a.roleIdx, _partMat);
    }

    // 2. Torso matrix
    _euler.set(torsoPitch, torsoYaw, torsoRoll, 'XYZ');
    _qRot.setFromEuler(_euler);
    _localMat.compose(
      _vPos.set(0, 0, 0),
      _qRot,
      _vScale.set(a.kind === 'lady' ? 0.9 : 1, 1, a.kind === 'lady' ? 0.92 : 1),
    );
    _torsoMat.multiplyMatrices(_pelvisMat, _localMat);
    batch.torsoInst.mesh.setMatrixAt(a.allIdx, _torsoMat);

    if (showVest) {
      batch.vestInst.mesh.setMatrixAt(a.allIdx, _torsoMat);
    } else {
      writeZeroInstanceMatrix(batch.vestInst, a.allIdx);
    }

    // Arms
    const armX = a.kind === 'lady' ? 0.17 : 0.205;
    const leftPitch = isHoldingBow
      ? 1.34 + Math.sin(time * 8.5 + a.phase) * 0.06
      : isScreamingRun
        ? 0.9 + swingR * 0.55
        : moving
          ? swingR * armAmp
          : isConversing
            ? 0.42 + Math.sin(time * 2.8 + a.phase) * 0.24
            : isBracing
              ? 0.22
              : Math.sin(time * 0.9 + a.phase) * 0.04;
    _euler.set(leftPitch, 0, isHoldingBow ? -0.14 : isBracing ? 0.28 : 0.09, 'XYZ');
    _qRot.setFromEuler(_euler);
    _localMat.compose(_vPos.set(-armX, 0.41, 0), _qRot, _vOne);
    _partMat.multiplyMatrices(_torsoMat, _localMat);
    batch.leftArmInst.mesh.setMatrixAt(a.allIdx, _partMat);

    const rightPitch = isHoldingBow
      ? 1.34 + Math.cos(time * 8.5 + a.phase) * 0.06
      : isScreamingRun
        ? 0.9 + swingL * 0.55
        : moving
          ? swingL * armAmp
          : waving
            ? 2.25 + Math.sin(time * 5.2 + a.phase) * 0.42
            : isConversing
              ? 0.36 + Math.cos(time * 2.4 + a.phase) * 0.2
              : isBracing
                ? 0.22
                : -Math.sin(time * 0.9 + a.phase) * 0.04;
    _euler.set(rightPitch, 0, isHoldingBow ? 0.14 : waving ? -0.35 : isBracing ? -0.28 : -0.09, 'XYZ');
    _qRot.setFromEuler(_euler);
    _localMat.compose(_vPos.set(armX, 0.41, 0), _qRot, _vOne);
    _partMat.multiplyMatrices(_torsoMat, _localMat);
    batch.rightArmInst.mesh.setMatrixAt(a.allIdx, _partMat);

    // 3. Head matrix
    _euler.set(headPitch, headYaw, 0, 'XYZ');
    _qRot.setFromEuler(_euler);
    _localMat.compose(_vPos.set(0, 0.57, 0), _qRot, _vOne);
    _headMat.multiplyMatrices(_torsoMat, _localMat);

    batch.headInst.mesh.setMatrixAt(a.allIdx, _headMat);
    batch.hairInst.mesh.setMatrixAt(a.allIdx, _headMat);

    if (a.kind === 'lady') {
      batch.hatLadyInst.mesh.setMatrixAt(a.roleIdx, _headMat);
    } else if (a.kind === 'gentleman') {
      batch.hatGentInst.mesh.setMatrixAt(a.roleIdx, _headMat);
    } else {
      batch.hatCrewInst.mesh.setMatrixAt(a.roleIdx, _headMat);
    }
  };

  let crowdFrameParity = 0;

  const stepCrowdBatch = (
    batch: HalfCrowdBatch,
    dt: number,
    time: number,
    floodingPct: number,
    forceEmergencyRun: boolean,
    checkSubmerged: boolean,
    awareness?: CruiseAwarenessContext,
  ) => {
    if (dt > 0) crowdFrameParity = (crowdFrameParity + 1) & 1;
    const actors = batch.actors;
    const n = actors.length;
    const shipRoll = awareness?.shipRoll ?? 0;
    const harborNear = awareness?.harborNear ?? false;
    const hazardSide = awareness?.hazardSide ?? 0;
    const bowPanicActive = Boolean(awareness?.bowPanicActive) && !forceEmergencyRun;
    const hasPlayer = awareness?.playerLocalX !== undefined && awareness?.playerLocalZ !== undefined;
    const playerX = awareness?.playerLocalX ?? 0;
    const playerY = awareness?.playerLocalY ?? 0;
    const playerZ = awareness?.playerLocalZ ?? 0;

    _gridHead.fill(-1);
    for (let i = 0; i < n; i++) {
      const a = actors[i];
      const col = Math.max(0, Math.min(GRID_COLS - 1, Math.floor((a.posX + 18) / 3)));
      const row = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor((a.posZ + 78) / 3)));
      const cell = row * GRID_COLS + col;
      _gridNext[i] = _gridHead[cell];
      _gridHead[cell] = i;
    }

    for (let i = 0; i < n; i++) {
      const a = actors[i];
      const individualPanic = forceEmergencyRun || (!bowPanicActive && floodingPct >= a.panicThreshold);
      const showVest = forceEmergencyRun || floodingPct >= Math.max(8, a.panicThreshold - 4);
      let moving = false;
      let waving = false;

      const col0 = Math.max(0, Math.min(GRID_COLS - 1, Math.floor((a.posX + 18) / 3)));
      const row0 = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor((a.posZ + 78) / 3)));
      let avoidX = 0;
      let avoidZ = 0;
      let nearestPeerDist = 99;
      let nearestPeerX = 0;
      let nearestPeerZ = 0;

      for (let rr = Math.max(0, row0 - 1); rr <= Math.min(GRID_ROWS - 1, row0 + 1); rr++) {
        for (let cc = Math.max(0, col0 - 1); cc <= Math.min(GRID_COLS - 1, col0 + 1); cc++) {
          let j = _gridHead[rr * GRID_COLS + cc];
          while (j !== -1) {
            if (j !== i) {
              const p = actors[j];
              if (Math.abs(p.posY - a.posY) < 1.2) {
                const dx = a.posX - p.posX;
                const dz = a.posZ - p.posZ;
                const d2 = dx * dx + dz * dz;
                if (d2 < 1.5 && d2 > 0.0004) {
                  const d = Math.sqrt(d2);
                  const push = (1.22 - d) * 1.4;
                  avoidX += (dx / d) * push;
                  avoidZ += (dz / d) * push;
                }
                if (d2 < nearestPeerDist * nearestPeerDist && d2 > 0.25) {
                  nearestPeerDist = Math.sqrt(d2);
                  nearestPeerX = p.posX;
                  nearestPeerZ = p.posZ;
                }
              }
            }
            j = _gridNext[j];
          }
        }
      }

      a.decisionTimer -= dt;
      if (bowPanicActive) {
        a.intent = 'hold_bow';
      } else if (individualPanic) {
        a.intent = 'muster_run';
      } else if (Math.abs(shipRoll) > 0.048 && !a.isWalker) {
        a.intent = 'brace';
      } else if (a.decisionTimer <= 0) {
        a.decisionTimer = 2.2 + ((i * 17) % 10) * 0.35;
        if (!a.isWalker) {
          if (harborNear && Math.abs(a.posX) > 8.4) {
            a.intent = 'rail_watch';
          } else if (nearestPeerDist < 2.5 && a.personality !== 'dutiful') {
            a.intent = 'converse';
            a.peerYaw = Math.atan2(-(nearestPeerX - a.posX), -(nearestPeerZ - a.posZ));
          } else {
            a.intent = a.personality === 'curious' ? 'rail_watch' : 'stroll';
          }
        } else if (a.intent === 'converse') {
          a.intent = 'stroll';
        } else if (a.personality === 'social' && nearestPeerDist < 1.9 && (i + Math.floor(time)) % 4 === 0) {
          a.intent = 'converse';
          a.pauseTimer = 2.2;
          a.peerYaw = Math.atan2(-(nearestPeerX - a.posX), -(nearestPeerZ - a.posZ));
        }
      }

      let targetGaze = 0;
      if (hasPlayer && Math.abs(a.posY - (playerY - 1.55)) < 2.1) {
        const pdx = playerX - a.posX;
        const pdz = playerZ - a.posZ;
        if (pdx * pdx + pdz * pdz < 46) {
          const worldYaw = Math.atan2(-pdx, -pdz);
          let rel = worldYaw - a.rotY;
          while (rel > Math.PI) rel -= Math.PI * 2;
          while (rel < -Math.PI) rel += Math.PI * 2;
          targetGaze = MathUtils.clamp(rel, -0.85, 0.85);
        }
      } else if (hazardSide !== 0 && a.personality === 'curious') {
        targetGaze = hazardSide * 0.55;
      }
      a.gazeYaw = MathUtils.damp(a.gazeYaw, targetGaze, 4.5, Math.max(dt, 0.016));

      if (bowPanicActive) {
        const dx = a.bowPanicX - a.posX;
        const dz = a.bowPanicZ - a.posZ;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.42) {
          moving = true;
          const panicRun = a.runSpeed * 1.24;
          const step = Math.min(dist, panicRun * dt);
          let dirX = dx / dist + avoidX * 0.35;
          let dirZ = dz / dist + avoidZ * 0.35;
          const dLen = Math.hypot(dirX, dirZ) || 1;
          dirX /= dLen;
          dirZ /= dLen;
          a.posX += dirX * step;
          a.posZ += dirZ * step;
          a.posY = MathUtils.damp(a.posY, a.bowPanicY, 6, dt);
          const desiredYaw = Math.atan2(-dirX, -dirZ);
          let dy = desiredYaw - a.rotY;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          a.rotY += dy * Math.min(1, dt * 8);
          a.strideCycle += panicRun * dt * 2.8;
        } else {
          a.posY = MathUtils.damp(a.posY, a.bowPanicY, 6, dt);
          let dy = a.bowPanicYaw - a.rotY;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          a.rotY += dy * Math.min(1, dt * 6);
        }
      } else if (individualPanic) {
        const dx = a.musterX - a.posX;
        const dz = a.musterZ - a.posZ;
        const dist = Math.hypot(dx, dz);
        if (dist > 0.35) {
          moving = true;
          const step = Math.min(dist, a.runSpeed * dt);
          let dirX = dx / dist + avoidX * 0.45;
          let dirZ = dz / dist + avoidZ * 0.45;
          const dLen = Math.hypot(dirX, dirZ) || 1;
          dirX /= dLen;
          dirZ /= dLen;
          a.posX += dirX * step;
          a.posZ += dirZ * step;
          a.posY = MathUtils.damp(a.posY, a.musterY, 5, dt);
          const desiredYaw = Math.atan2(-dirX, -dirZ);
          let dy = desiredYaw - a.rotY;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          a.rotY += dy * Math.min(1, dt * 6);
          a.strideCycle += a.runSpeed * dt * 2.65;
        }
      } else if (a.intent === 'converse' && a.pauseTimer > 0) {
        a.pauseTimer -= dt;
        let dy = a.peerYaw - a.rotY;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        a.rotY += dy * Math.min(1, dt * 4);
      } else if (a.isWalker) {
        const tx = a.goingForward ? a.endX : a.startX;
        const ty = a.goingForward ? a.endY : a.startY;
        const tz = a.goingForward ? a.endZ : a.startZ;
        const dx = tx - a.posX;
        const dz = tz - a.posZ;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.35) {
          if (a.pauseTimer <= 0) a.pauseTimer = 1.4 + (i % 3) * 0.6;
          a.pauseTimer -= dt;
          if (a.pauseTimer <= 0) a.goingForward = !a.goingForward;
          if (harborNear && Math.abs(a.posX) > 8.8 && i % 3 === 0) {
            waving = true;
          }
        } else {
          moving = true;
          const moveSpd = a.walkSpeed;
          const step = Math.min(dist, moveSpd * dt);
          let dirX = dx / dist + avoidX * 0.55;
          let dirZ = dz / dist + avoidZ * 0.55;
          const dLen = Math.hypot(dirX, dirZ) || 1;
          dirX /= dLen;
          dirZ /= dLen;
          a.posX += dirX * step;
          a.posZ += dirZ * step;
          a.posY = MathUtils.damp(a.posY, ty, 5, dt);
          const desiredYaw = Math.atan2(-dirX, -dirZ);
          let dy = desiredYaw - a.rotY;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          a.rotY += dy * Math.min(1, dt * 6);
          a.strideCycle += moveSpd * dt * 3.1;
        }
      } else if (a.intent === 'rail_watch' && harborNear) {
        const railYaw = a.posX >= 0 ? -Math.PI / 2 : Math.PI / 2;
        let dy = railYaw - a.rotY;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        a.rotY += dy * Math.min(1, dt * 3);
        waving = a.posX > 8.0 || i % 4 === 0;
      }

      if (
        dt === 0 ||
        moving ||
        bowPanicActive ||
        individualPanic ||
        forceEmergencyRun ||
        waving ||
        checkSubmerged ||
        ((i + crowdFrameParity) & 1) === 0
      ) {
        writeActorMatrices(
          batch,
          a,
          moving,
          (individualPanic || bowPanicActive) && moving,
          showVest,
          time,
          checkSubmerged,
          shipRoll,
          waving,
        );
      }
    }

    commitInstanceMatrices(batch.torsoInst, n);
    commitInstanceMatrices(batch.headInst, n);
    commitInstanceMatrices(batch.hairInst, n);
    commitInstanceMatrices(batch.leftArmInst, n);
    commitInstanceMatrices(batch.rightArmInst, n);
    commitInstanceMatrices(batch.leftLegInst, n);
    commitInstanceMatrices(batch.rightLegInst, n);
    commitInstanceMatrices(batch.vestInst, n);
    commitInstanceMatrices(batch.skirtInst, batch.ladyCount);
    commitInstanceMatrices(batch.hatLadyInst, batch.ladyCount);
    commitInstanceMatrices(batch.hatGentInst, batch.gentCount);
    commitInstanceMatrices(batch.hatCrewInst, batch.crewCount);
  };

  for (const batch of batches) {
    stepCrowdBatch(batch, 0, 0, 0, false, false);
  }

  // =========================================================================
  // 3. 16 MAIN LIFEBOATS (8 PORT, 8 STARBOARD) ON WELIN QUADRANT DAVITS
  // =========================================================================
  const lifeboats: LifeboatRig[] = [];
  const boatHullProto = mkTmp(buildRealisticLifeboatHullMesh('proto_boatHull'));
  const boatGunwaleProto = mkTmp(buildTorusXY('proto_boatGunwale', 0.92, 0.052, 6, 20));
  boatGunwaleProto.scale.set(1.0, 3.25, 1.0);
  bakeTransform(boatGunwaleProto);
  boatGunwaleProto.rotation.x = Math.PI / 2;
  bakeTransform(boatGunwaleProto);

  const thwartProto = mkTmp(buildBox('proto_thwart', 1.32, 0.06, 0.28));
  const keelProto = mkTmp(buildBox('proto_keel', 0.1, 0.12, 6.2));
  const oarShaftProto = mkTmp(buildCylinder('proto_oarShaft', 0.022, 0.024, 2.8, 6));
  const oarBladeProto = mkTmp(buildBox('proto_oarBlade', 0.11, 0.52, 0.02));
  const pulleyProto = mkTmp(buildCylinder('proto_pulley', 0.14, 0.14, 0.08, 10));
  pulleyProto.rotation.z = Math.PI / 2;
  bakeTransform(pulleyProto);

  const makeWelinDavitProto = (side: -1 | 1) =>
    mkTmp(
      buildTubeMesh(
        `proto_davit_${side}`,
        [
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(side * 0.1, 1.0, 0),
          new THREE.Vector3(side * 0.36, 1.9, 0),
          new THREE.Vector3(side * 0.85, 2.32, 0),
          new THREE.Vector3(side * 1.18, 2.2, 0),
        ],
        12,
        0.09,
        8,
      ),
    );
  const davitProtoPort = makeWelinDavitProto(-1);
  const davitProtoStbd = makeWelinDavitProto(1);

  const davitRackProto = mkTmp(buildBox('proto_davitRack', 0.95, 0.22, 0.24));
  const davitSectorShape = new Shape2D();
  davitSectorShape.moveTo(-0.34, 0);
  davitSectorShape.lineTo(0.34, 0);
  davitSectorShape.lineTo(0.18, 0.56);
  davitSectorShape.lineTo(-0.18, 0.56);
  davitSectorShape.closePath();
  const davitSectorProto = mkTmp(buildExtrudedShapeMesh('proto_davitSector', davitSectorShape, 0.14));
  davitSectorProto.position.z = -0.07;
  bakeTransform(davitSectorProto);

  const ropeProto = mkTmp(buildCylinder('proto_rope', 0.026, 0.026, 1.0, 6));
  const lanternProto = mkTmp(buildSphere('proto_lantern', 0.13, 8, 8));

  const davitRackX = boatBaseX - 0.67;
  const davitArmX = boatBaseX - 0.8;

  for (const side of [-1, 1] as const) {
    for (let b = 0; b < boatZStations.length; b++) {
      const bz = boatZStations[b];
      const homeParent = bz < breakZ ? bowContent : sternContent;

      const makeDavitArm = (dz: number) => {
        const rack = clonePart(davitRackProto, `lb_${side}_${b}_rack_${dz}`, officerNavyMat, homeParent);
        rack.position.set(side * davitRackX, 12.92, bz + dz);

        const arm = new THREE.Group();
        arm.name = `lb_${side}_${b}_davit_${dz}`;
        homeParent.add(arm);
        arm.position.set(side * davitArmX, 12.84, bz + dz);

        const sector = clonePart(davitSectorProto, `lb_${side}_${b}_sec_${dz}`, whitePaintMat, arm);
        sector.position.y = 0.08;

        const swanNeck = clonePart(
          side < 0 ? davitProtoPort : davitProtoStbd,
          `lb_${side}_${b}_neck_${dz}`,
          whitePaintMat,
          arm,
        );
        shadowCasters.push(swanNeck);

        const block = clonePart(pulleyProto, `lb_${side}_${b}_blk_${dz}`, officerNavyMat, arm);
        block.position.set(side * 1.16, 2.12, 0);
        return arm;
      };
      const davitForeArm = makeDavitArm(-2.65);
      const davitAftArm = makeDavitArm(2.65);

      for (const cz of [-1.75, 1.75]) {
        const chock = clonePart(thwartProto, `lb_${side}_${b}_chock_${cz}`, teakDeckMat, homeParent);
        chock.scale.set(0.85, 9.5, 0.72);
        chock.position.set(side * boatBaseX, 13.15, bz + cz);
      }

      const isEmergencyCutter = b === 0;
      const initSwing = isEmergencyCutter ? 0.22 : 0;
      const initBoatX = side * (isEmergencyCutter ? boatBaseX + 1.13 : boatBaseX);
      davitForeArm.rotation.z = -side * initSwing;
      davitAftArm.rotation.z = -side * initSwing;

      const ropeFore = clonePart(ropeProto, `lb_${side}_${b}_ropeF`, ropeMat, homeParent);
      ropeFore.position.set(initBoatX, 14.52, bz - 2.65);
      ropeFore.scale.set(1, 0.92, 1);

      const ropeAft = clonePart(ropeProto, `lb_${side}_${b}_ropeA`, ropeMat, homeParent);
      ropeAft.position.set(initBoatX, 14.52, bz + 2.65);
      ropeAft.scale.set(1, 0.92, 1);

      const boatGroup = new THREE.Group();
      boatGroup.name = `lb_${side}_${b}_boat`;
      homeParent.add(boatGroup);
      boatGroup.position.set(initBoatX, 13.85, bz);
      rootGroups.push(boatGroup);

      const hull = clonePart(boatHullProto, `lb_${side}_${b}_hull`, whitePaintMat, boatGroup);
      shadowCasters.push(hull);

      const keel = clonePart(keelProto, `lb_${side}_${b}_keel`, teakDeckMat, boatGroup);
      keel.position.y = -0.44;

      const gunwale = clonePart(boatGunwaleProto, `lb_${side}_${b}_gunwale`, teakDeckMat, boatGroup);
      gunwale.position.y = 0.4;

      for (const tz of [-1.6, -0.55, 0.55, 1.6]) {
        const thw = clonePart(thwartProto, `lb_${side}_${b}_thw_${tz}`, teakDeckMat, boatGroup);
        thw.position.set(0, 0.22, tz);
        thw.scale.x = Math.abs(tz) > 1.2 ? 0.7 : 1.0;
      }

      const occupantsGroup = new THREE.Group();
      occupantsGroup.name = `lb_${side}_${b}_occ`;
      boatGroup.add(occupantsGroup);
      occupantsGroup.visible = false;
      for (let oi = -2; oi <= 2; oi++) {
        const seatX = oi % 2 === 0 ? 0.22 : -0.22;
        const seatZ = oi * 0.92;
        const occMat = oi === 0 ? officerNavyMat : gentlemanCoatMats[(b + oi + 6) % gentlemanCoatMats.length];

        const torso = clonePart(coatTorsoProto, `lb_${side}_${b}_ot_${oi}`, occMat, occupantsGroup);
        torso.scale.set(0.86, 0.86, 0.86);
        torso.position.set(seatX, 0.42, seatZ);

        for (const zOff of [-0.12, 0.12]) {
          for (const rx of [-0.07, 0, 0.07]) {
            const rib = clonePart(corkRibProto, `lb_${side}_${b}_or_${oi}_${zOff}_${rx}`, lifejacketMat, occupantsGroup);
            rib.scale.set(0.84, 0.84, 0.84);
            rib.position.set(seatX + rx, 0.58, seatZ + zOff);
          }
        }

        const hd = clonePart(craniumProto, `lb_${side}_${b}_oh_${oi}`, skinTones[(b + oi + 5) % skinTones.length], occupantsGroup);
        hd.position.set(seatX, 0.94, seatZ);
      }

      const oarsGroup = new THREE.Group();
      oarsGroup.name = `lb_${side}_${b}_oars`;
      boatGroup.add(oarsGroup);
      oarsGroup.visible = false;
      for (const oarSide of [-1, 1]) {
        for (const oz of [-0.95, 0.0, 0.95]) {
          const oarPivot = new THREE.Group();
          oarPivot.name = `lb_${side}_${b}_op_${oarSide}_${oz}`;
          oarsGroup.add(oarPivot);
          oarPivot.position.set(oarSide * 0.78, 0.42, oz);
          const shaft = clonePart(oarShaftProto, `lb_${side}_${b}_os_${oarSide}_${oz}`, teakDeckMat, oarPivot);
          shaft.rotation.z = oarSide * 1.15;
          shaft.position.set(oarSide * 1.15, -0.4, 0);
          const blade = clonePart(oarBladeProto, `lb_${side}_${b}_ob_${oarSide}_${oz}`, teakDeckMat, oarPivot);
          blade.rotation.z = oarSide * 1.15;
          blade.position.set(oarSide * 2.45, -0.95, 0);
        }
      }

      const lanternMesh = clonePart(lanternProto, `lb_${side}_${b}_lantern`, boatLanternMat, boatGroup);
      lanternMesh.position.set(0, 0.74, -2.8);
      lanternMesh.visible = false;

      const isForwardBoat = bz < breakZ;
      lifeboats.push({
        side,
        index: b,
        baseZ: bz,
        lowerStart: isForwardBoat
          ? 0.02 + b * 0.036 + (side > 0 ? 0.01 : 0)
          : 0.07 + (b - 4) * 0.042 + (side > 0 ? 0.012 : 0),
        lowerDuration: isForwardBoat ? 0.22 : 0.24,
        homeParent,
        davitForeArm,
        davitAftArm,
        ropeFore,
        ropeAft,
        boatGroup,
        occupantsGroup,
        oarsGroup,
        lanternMesh,
        detached: false,
        rescued: false,
        splashX: side * 17.5,
        splashZ: bz,
        boatX: side * 17.5,
        boatZ: bz,
        boatYaw: side * 0.25,
      });
    }
  }

  // =========================================================================
  // ARTICULATED WALKING / RUNNING KINEMATICS & CONSCIOUS HERO CHARACTERS
  // =========================================================================
  const animateLimbGait = (
    ch: DeckCharacter,
    speedFactor: number,
    isRunning: boolean,
    time: number,
    awareness?: CruiseAwarenessContext,
    holdingBow = false,
  ) => {
    const hazardSide = awareness?.hazardSide ?? 0;
    const shipRoll = awareness?.shipRoll ?? 0;
    const bridgeOrderActive = awareness?.bridgeOrderActive ?? false;
    const autopilotActive = Boolean(awareness?.autopilotActive);
    const rudderNorm = MathUtils.clamp((awareness?.rudderDeg ?? 0) / 35, -1, 1);

    if (speedFactor < 0.05) {
      ch.bodyRoot.position.y = 0.85 + Math.sin(time * 1.7 + ch.phase) * 0.008;
      const tX = MathUtils.damp(
        ch.torsoGroup.rotation.x,
        holdingBow ? -0.14 : autopilotActive && ch.helmStation?.role === 'helmsman' ? -0.06 : 0,
        8,
        0.03,
      );
      const tZ = MathUtils.damp(ch.torsoGroup.rotation.z, -shipRoll * 0.55, 6, 0.04);
      const tY =
        autopilotActive && ch.helmStation?.role === 'helmsman'
          ? rudderNorm * 0.1
          : Math.sin(time * 0.6 + ch.phase) * 0.04;
      setEulerXYZ(ch.torsoGroup, tX, tY, tZ);

      ch.leftLegHip.rotation.x = MathUtils.damp(ch.leftLegHip.rotation.x, 0, 8, 0.03);
      ch.rightLegHip.rotation.x = MathUtils.damp(ch.rightLegHip.rotation.x, 0, 8, 0.03);
      ch.leftKnee.rotation.x = MathUtils.damp(ch.leftKnee.rotation.x, 0.04, 8, 0.03);
      ch.rightKnee.rotation.x = MathUtils.damp(ch.rightKnee.rotation.x, 0.04, 8, 0.03);

      if (autopilotActive && ch.helmStation?.role === 'helmsman') {
        setEulerXYZ(ch.leftArmHip, 1.18 - rudderNorm * 0.34, 0.08, -0.18);
        setEulerXYZ(ch.rightArmHip, 1.18 + rudderNorm * 0.34, -0.08, 0.18);
        ch.leftElbow.rotation.x = 0.52;
        ch.rightElbow.rotation.x = 0.52;
        ch.headGroup.rotation.y = MathUtils.damp(
          ch.headGroup.rotation.y,
          hazardSide * 0.35 + rudderNorm * 0.18,
          5,
          0.05,
        );
      } else if (holdingBow) {
        setEulerXYZ(ch.leftArmHip, 1.32 + Math.sin(time * 8 + ch.phase) * 0.05, 0, -0.14);
        setEulerXYZ(ch.rightArmHip, 1.32 + Math.cos(time * 8 + ch.phase) * 0.05, 0, 0.14);
        ch.leftElbow.rotation.x = 0.42;
        ch.rightElbow.rotation.x = 0.42;
        ch.headGroup.rotation.y = MathUtils.damp(ch.headGroup.rotation.y, Math.sin(time * 6.5 + ch.phase) * 0.38, 6, 0.05);
      } else if (ch.role === 'lookout') {
        setEulerXYZ(ch.leftArmHip, 1.15, 0, 0.25);
        setEulerXYZ(ch.rightArmHip, 1.15, 0, -0.25);
        ch.leftElbow.rotation.x = 1.4;
        ch.rightElbow.rotation.x = 1.4;
        const scanTarget = hazardSide !== 0 ? hazardSide * 0.62 : Math.sin(time * 0.8 + ch.phase) * 0.45;
        ch.headGroup.rotation.y = MathUtils.damp(ch.headGroup.rotation.y, scanTarget, 5, 0.05);
      } else {
        const saluteGesture = bridgeOrderActive || (autopilotActive && ch.helmStation?.role === 'watch_officer') ? 0.58 : 0;
        setEulerXYZ(ch.leftArmHip, Math.sin(time * 0.8 + ch.phase) * 0.04, 0, 0.08);
        setEulerXYZ(ch.rightArmHip, -Math.sin(time * 0.8 + ch.phase) * 0.04 + saluteGesture, 0, -0.08);
        ch.leftElbow.rotation.x = 0.14;
        ch.rightElbow.rotation.x = saluteGesture > 0 ? 0.95 : 0.14;
        const lookBias = bridgeOrderActive ? -0.45 : hazardSide * 0.4;
        ch.headGroup.rotation.y = MathUtils.damp(
          ch.headGroup.rotation.y,
          lookBias + Math.sin(time * 0.95 + ch.phase * 1.4) * 0.25,
          4,
          0.05,
        );
      }
      return;
    }

    const c = ch.strideCycle;
    const strideAmp = isRunning ? 0.82 : 0.44;
    const armAmp = isRunning ? 0.95 : 0.38;
    const bobAmp = isRunning ? 0.075 : 0.028;

    ch.bodyRoot.position.y = 0.85 + Math.abs(Math.sin(c)) * bobAmp - (isRunning ? 0.04 : 0);
    const tX = isRunning ? -0.24 : -0.05;
    const tZ = MathUtils.damp(ch.torsoGroup.rotation.z, -shipRoll * 0.35, 6, 0.04);
    const tY = Math.sin(c) * (isRunning ? 0.14 : 0.06);
    setEulerXYZ(ch.torsoGroup, tX, tY, tZ);

    const swingL = Math.sin(c) * strideAmp;
    const swingR = -swingL;
    ch.leftLegHip.rotation.x = swingL;
    ch.rightLegHip.rotation.x = swingR;

    ch.leftKnee.rotation.x = -Math.max(0.05, Math.cos(c) * (isRunning ? 1.15 : 0.58) + 0.15);
    ch.rightKnee.rotation.x = -Math.max(0.05, -Math.cos(c) * (isRunning ? 1.15 : 0.58) + 0.15);

    setEulerXYZ(ch.leftArmHip, swingR * armAmp, 0, 0.09);
    setEulerXYZ(ch.rightArmHip, swingL * armAmp, 0, -0.09);
    const elbowBend = isRunning ? 1.42 : 0.28;
    ch.leftElbow.rotation.x = elbowBend + Math.max(0, Math.sin(c)) * 0.25;
    ch.rightElbow.rotation.x = elbowBend + Math.max(0, -Math.sin(c)) * 0.25;

    if (ch.skirtMesh) {
      ch.skirtMesh.rotation.x = Math.sin(c) * (isRunning ? 0.16 : 0.08);
    }
    ch.headGroup.rotation.y = isRunning ? Math.sin(time * 4.5 + ch.phase) * 0.18 : Math.sin(time * 0.8 + ch.phase) * 0.12;
  };

  const stepCharacterMovement = (
    ch: DeckCharacter,
    dt: number,
    time: number,
    emergencyRun: boolean,
    awareness?: CruiseAwarenessContext,
  ) => {
    const autopilotActive = Boolean(awareness?.autopilotActive) && !emergencyRun;
    const bowPanicActive = Boolean(awareness?.bowPanicActive) && !emergencyRun;

    if (autopilotActive && ch.helmStation) {
      const dx = ch.helmStation.x - ch.posX;
      const dz = ch.helmStation.z - ch.posZ;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.12) {
        const step = Math.min(dist, ch.walkSpeed * 1.35 * dt);
        const dirX = dx / dist;
        const dirZ = dz / dist;
        ch.posX += dirX * step;
        ch.posZ += dirZ * step;
        ch.posY = MathUtils.damp(ch.posY, ch.helmStation.y, 6, dt);
        ch.group.position.set(ch.posX, ch.posY, ch.posZ);
        const desiredYaw = Math.atan2(-dirX, -dirZ);
        let dy = desiredYaw - ch.group.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        ch.group.rotation.y += dy * Math.min(1, dt * 8);
        ch.strideCycle += ch.walkSpeed * 1.35 * dt * 3.2;
        animateLimbGait(ch, 1, false, time, awareness);
      } else {
        ch.posX = ch.helmStation.x;
        ch.posZ = ch.helmStation.z;
        ch.group.position.set(ch.posX, ch.helmStation.y, ch.posZ);
        let dy = ch.helmStation.yaw - ch.group.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        ch.group.rotation.y += dy * Math.min(1, dt * 7);
        animateLimbGait(ch, 0, false, time, awareness);
      }
      return;
    }

    if (bowPanicActive && ch.bowTarget) {
      const dx = ch.bowTarget.x - ch.posX;
      const dz = ch.bowTarget.z - ch.posZ;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.35) {
        const step = Math.min(dist, ch.runSpeed * 1.15 * dt);
        const dirX = dx / dist;
        const dirZ = dz / dist;
        ch.posX += dirX * step;
        ch.posZ += dirZ * step;
        ch.posY = MathUtils.damp(ch.posY, ch.bowTarget.y, 6, dt);
        ch.group.position.set(ch.posX, ch.posY, ch.posZ);
        const desiredYaw = Math.atan2(-dirX, -dirZ);
        let dy = desiredYaw - ch.group.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        ch.group.rotation.y += dy * Math.min(1, dt * 7);
        ch.strideCycle += ch.runSpeed * 1.15 * dt * 2.65;
        animateLimbGait(ch, 1, true, time, awareness, true);
      } else {
        const railYaw = Math.atan2(-Math.sign(ch.posX || 1) * 0.45, 0.89);
        let dy = railYaw - ch.group.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        ch.group.rotation.y += dy * Math.min(1, dt * 6);
        animateLimbGait(ch, 0, false, time, awareness, true);
      }
      return;
    }

    if (ch.route.length <= 1 && !(emergencyRun && ch.musterTarget)) {
      animateLimbGait(ch, 0, false, time, awareness);
      return;
    }

    let target: DeckWaypoint;
    let isRunning = false;

    if (emergencyRun && ch.musterTarget) {
      target = ch.musterTarget;
      isRunning = true;
    } else {
      target = ch.route[ch.waypointIdx];
    }

    const dx = target.x - ch.posX;
    const dz = target.z - ch.posZ;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.35) {
      if (emergencyRun && ch.musterTarget) {
        animateLimbGait(ch, 0, false, time, awareness);
        return;
      }
      if (ch.pauseTimer <= 0) {
        ch.pauseTimer = target.pauseSec ?? 1.5;
      }
      ch.pauseTimer -= dt;
      animateLimbGait(ch, 0, false, time, awareness);
      if (ch.pauseTimer <= 0) {
        ch.waypointIdx = (ch.waypointIdx + 1) % ch.route.length;
      }
      return;
    }

    const moveSpeed = isRunning ? ch.runSpeed : ch.walkSpeed;
    const step = Math.min(dist, moveSpeed * dt);
    const dirX = dx / dist;
    const dirZ = dz / dist;

    ch.posX += dirX * step;
    ch.posZ += dirZ * step;
    ch.posY = MathUtils.damp(ch.posY, target.y, 6, dt);
    ch.group.position.set(ch.posX, ch.posY, ch.posZ);

    const desiredYaw = Math.atan2(-dirX, -dirZ);
    let deltaYaw = desiredYaw - ch.group.rotation.y;
    while (deltaYaw > Math.PI) deltaYaw -= Math.PI * 2;
    while (deltaYaw < -Math.PI) deltaYaw += Math.PI * 2;
    ch.group.rotation.y += deltaYaw * Math.min(1, dt * 7);

    ch.strideCycle += moveSpeed * dt * (isRunning ? 2.65 : 3.2);
    animateLimbGait(ch, 1, isRunning, time, awareness);
  };

  const animateLifeboatsProgress = (
    time: number,
    dt: number,
    progress: number,
    shipRoot: THREE.Group,
  ): number => {
    shipRoot.updateWorldMatrix(true, false);
    _invMat.copy(shipRoot.matrixWorld).invert();
    let launchedCount = 0;

    for (let li = 0; li < lifeboats.length; li++) {
      const lb = lifeboats[li];
      const localT = MathUtils.clamp((progress - lb.lowerStart) / lb.lowerDuration, 0, 1);
      if (localT <= 0.001) continue;

      lb.occupantsGroup.visible = true;
      lb.lanternMesh.visible = true;

      const baseSwing = lb.index === 0 ? 0.22 : 0;
      const swingT = MathUtils.clamp(localT / 0.22, 0, 1);
      const davitSwing = MathUtils.lerp(baseSwing, 0.44, swingT);
      lb.davitForeArm.rotation.z = -lb.side * davitSwing;
      lb.davitAftArm.rotation.z = -lb.side * davitSwing;

      const xOut = MathUtils.lerp(
        lb.side * (lb.index === 0 ? boatBaseX + 1.13 : boatBaseX),
        lb.side * (boatBaseX + 4.25),
        swingT,
      );
      const boatWaterY = 0.38 + Math.sin(time * 1.4 + lb.index) * 0.14;

      lb.davitForeArm.updateWorldMatrix(true, false);
      lb.davitForeArm.getWorldPosition(_tmpWorldPos);
      _tmpWorldPos.applyMatrix4(_invMat);
      const davitTopWorldY = _tmpWorldPos.y + 2.13;

      const lowerT = MathUtils.clamp((localT - 0.18) / 0.64, 0, 1);
      const targetBoatWorldY = MathUtils.lerp(
        Math.max(boatWaterY, davitTopWorldY - 1.1),
        boatWaterY,
        lowerT,
      );

      const onWater = lowerT >= 0.96 || targetBoatWorldY <= boatWaterY + 0.18;

      if (onWater) {
        launchedCount++;
        if (!lb.detached) {
          lb.detached = true;
          lb.boatGroup.updateWorldMatrix(true, false);
          lb.boatGroup.getWorldPosition(_tmpWorldPos);
          _tmpWorldPos.applyMatrix4(_invMat);
          lb.splashX = lb.side * Math.max(boatBaseX + 4.55, Math.abs(_tmpWorldPos.x));
          lb.splashZ = _tmpWorldPos.z;
          lb.boatX = lb.splashX;
          lb.boatZ = lb.splashZ;
          lb.boatYaw = lb.side * 0.35;
          shipRoot.add(lb.boatGroup);
          lb.ropeFore.visible = false;
          lb.ropeAft.visible = false;
          lb.oarsGroup.visible = true;
        }

        const rowT = MathUtils.clamp((localT - 0.78) / 0.22, 0, 1);
        const goalX = lb.splashX + lb.side * (8.5 + rowT * 8.0 + Math.max(0, progress - lb.lowerStart) * 42);
        const goalZ = lb.splashZ + (lb.index - 3.5) * 2.2;
        let vx = goalX - lb.boatX;
        let vz = goalZ - lb.boatZ;

        if (Math.abs(lb.boatX) < boatBaseX + 5.5 && lb.boatZ > deckBoundsZ[0] && lb.boatZ < deckBoundsZ[1]) {
          vx += lb.side * 12.0;
        }
        for (let oj = 0; oj < lifeboats.length; oj++) {
          if (oj === li || !lifeboats[oj].detached) continue;
          const ob = lifeboats[oj];
          const sx = lb.boatX - ob.boatX;
          const sz = lb.boatZ - ob.boatZ;
          const sd = Math.hypot(sx, sz);
          if (sd < 9.5 && sd > 0.05) {
            const push = ((9.5 - sd) / 9.5) * 6.5;
            vx += (sx / sd) * push;
            vz += (sz / sd) * push;
          }
        }
        const vLen = Math.hypot(vx, vz);
        if (vLen > 0.2 && dt > 0) {
          const step = Math.min(vLen, 5.2 * dt);
          lb.boatX += (vx / vLen) * step;
          lb.boatZ += (vz / vLen) * step;
          const targetYaw = Math.atan2(-vx, -vz);
          let dy = targetYaw - lb.boatYaw;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          lb.boatYaw += dy * Math.min(1, dt * 3.0);
        }

        lb.boatGroup.position.set(lb.boatX, boatWaterY, lb.boatZ);
        setEulerXYZ(
          lb.boatGroup,
          Math.sin(time * 1.5 + lb.index) * 0.04,
          lb.boatYaw,
          Math.cos(time * 1.2 + lb.index) * 0.05,
        );
        const rowSweep = Math.sin(time * 2.8 + lb.index);
        const oarChildren = lb.oarsGroup.children;
        for (let oi = 0; oi < oarChildren.length; oi++) {
          const oar = oarChildren[oi];
          setEulerXYZ(oar, Math.cos(time * 2.8 + lb.index) * 0.16, rowSweep * 0.35, 0);
        }
      } else {
        const dropBelowDavit = Math.max(0, davitTopWorldY - targetBoatWorldY);
        const localY = Math.min(13.85, 14.95 - dropBelowDavit);
        lb.boatGroup.position.set(xOut, localY, lb.baseZ);

        const halfPivot = lb.homeParent.parent;
        const halfPitch = halfPivot ? halfPivot.rotation.x : 0;
        const roll = halfPivot?.parent ? halfPivot.parent.rotation.z : 0;
        setEulerXYZ(lb.boatGroup, -halfPitch * 0.55, 0, -roll * 0.7);

        const ropeTop = 14.95;
        const ropeBot = lb.boatGroup.position.y + 0.4;
        const ropeLen = Math.max(0.2, ropeTop - ropeBot);
        const ropeMidY = (ropeTop + ropeBot) * 0.5;

        lb.ropeFore.visible = true;
        lb.ropeFore.position.set(xOut, ropeMidY, lb.baseZ - 2.65);
        lb.ropeFore.scale.set(1, ropeLen, 1);

        lb.ropeAft.visible = true;
        lb.ropeAft.position.set(xOut, ropeMidY, lb.baseZ + 2.65);
        lb.ropeAft.scale.set(1, ropeLen, 1);
      }
    }

    return launchedCount;
  };

  const updateCruising = (
    time: number,
    dt: number,
    floodingPct: number,
    shipRoot?: THREE.Group,
    awareness?: CruiseAwarenessContext,
  ) => {
    const bowPanic = Boolean(awareness?.bowPanicActive);
    for (const ch of characters) {
      const chPanic = !bowPanic && floodingPct >= ch.panicThreshold;
      ch.lifejacket.visible = floodingPct >= Math.max(12, ch.panicThreshold - 4);
      stepCharacterMovement(ch, dt, time, chPanic, awareness);
    }
    for (const batch of batches) {
      stepCrowdBatch(batch, dt, time, floodingPct, false, false, awareness);
    }
    if (shipRoot && floodingPct >= 14) {
      const earlyProgress = MathUtils.clamp(((floodingPct - 14) / 86) * 0.38, 0, 0.38);
      animateLifeboatsProgress(time, dt, earlyProgress, shipRoot);
    }
  };

  const updateSinking = (
    time: number,
    dt: number,
    sinkProgress: number,
    shipRoot: THREE.Group,
    awareness?: CruiseAwarenessContext,
  ): number => {
    shipRoot.updateWorldMatrix(true, false);

    for (const ch of characters) {
      ch.lifejacket.visible = true;
      stepCharacterMovement(ch, dt, time, true, awareness);
      ch.group.updateWorldMatrix(true, false);
      ch.group.getWorldPosition(_tmpWorldPos);
      ch.group.visible = _tmpWorldPos.y > -0.95;
    }
    for (const batch of batches) {
      stepCrowdBatch(batch, dt, time, 100, true, true, awareness);
    }

    return animateLifeboatsProgress(time, dt, sinkProgress, shipRoot);
  };

  const updateRescue = (
    time: number,
    dt: number,
    stage: 'waiting' | 'approaching' | 'boarding' | 'complete',
    boardingProgress: number,
    carpathiaRoot: THREE.Group,
    boardingStationsLocal: Array<{ x: number; y: number; z: number; side: -1 | 1 }>,
    shipRoot: THREE.Group,
    warshipRescue?: WarshipRescueContext,
  ): RescueProgressResult => {
    shipRoot.updateWorldMatrix(true, false);
    _invMat.copy(shipRoot.matrixWorld).invert();
    carpathiaRoot.updateWorldMatrix(true, false);
    if (warshipRescue) {
      warshipRescue.root.updateWorldMatrix(true, false);
    }

    let warshipBoatsRecovered = 0;
    let carpathiaBoatsRecovered = 0;
    let warshipFrac = 0;
    let carpathiaFrac = 0;

    const warshipBoatTotal = warshipRescue ? 8 : 0;
    const carpathiaBoatTotal = lifeboats.length - warshipBoatTotal;

    for (let i = 0; i < lifeboats.length; i++) {
      const lb = lifeboats[i];
      if (!lb.detached) {
        lb.detached = true;
        shipRoot.add(lb.boatGroup);
        lb.ropeFore.visible = false;
        lb.ropeAft.visible = false;
        lb.oarsGroup.visible = true;
        lb.lanternMesh.visible = true;
        lb.boatX = lb.boatGroup.position.x;
        lb.boatZ = lb.boatGroup.position.z;
      }

      const assignedToWarship = Boolean(warshipRescue) && i % 2 === 0;
      const boatWaterY = 0.38 + Math.sin(time * 1.4 + lb.index + i * 0.3) * 0.14;

      const isActiveRescue = assignedToWarship
        ? Boolean(warshipRescue?.active)
        : stage === 'boarding' || stage === 'complete';

      if (!isActiveRescue) {
        lb.occupantsGroup.visible = true;
        lb.rescued = false;
        let sepX = Math.sin(time * 0.25 + i) * 0.18;
        let sepZ = Math.cos(time * 0.2 + i) * 0.18;
        for (let oj = 0; oj < lifeboats.length; oj++) {
          if (oj === i || !lifeboats[oj].detached) continue;
          const sx = lb.boatGroup.position.x - lifeboats[oj].boatGroup.position.x;
          const sz = lb.boatGroup.position.z - lifeboats[oj].boatGroup.position.z;
          const sd = Math.hypot(sx, sz);
          if (sd < 9.0 && sd > 0.05) {
            sepX += (sx / sd) * 1.4;
            sepZ += (sz / sd) * 1.4;
          }
        }
        const idleX = lb.boatGroup.position.x + sepX * dt;
        const idleZ = lb.boatGroup.position.z + sepZ * dt;
        lb.boatGroup.position.set(idleX, boatWaterY, idleZ);
        lb.boatX = idleX;
        lb.boatZ = idleZ;
        lb.boatYaw = lb.side * 0.55 + Math.sin(time * 0.3 + i) * 0.08;
        setEulerXYZ(
          lb.boatGroup,
          Math.sin(time * 1.3 + i) * 0.045,
          lb.boatYaw,
          Math.cos(time * 1.1 + i) * 0.055,
        );
        const sweep = Math.sin(time * 1.5 + i) * 0.18;
        const oarChildren = lb.oarsGroup.children;
        for (let oi = 0; oi < oarChildren.length; oi++) {
          const oar = oarChildren[oi];
          setEulerXYZ(oar, Math.cos(time * 1.5 + i) * 0.08, sweep, 0);
        }
        continue;
      }

      const orderIdx = assignedToWarship ? Math.floor(i / 2) : warshipRescue ? Math.floor(i / 2) : i;
      const vesselRoot = assignedToWarship ? warshipRescue!.root : carpathiaRoot;
      const vesselStations = assignedToWarship ? warshipRescue!.boardingStationsLocal : boardingStationsLocal;
      const vesselProgress = assignedToWarship ? warshipRescue!.progress : boardingProgress;

      const waveIdx = Math.floor(orderIdx / 4);
      const slotIdx = orderIdx % vesselStations.length;
      const st = vesselStations[slotIdx];

      const waveSpan = assignedToWarship || warshipRescue ? 0.34 : 0.16;
      const tStart = waveIdx * waveSpan;
      const tDock = tStart + 0.22;
      const tUnloadDone = Math.min(0.96, tDock + 0.22);

      const isUnloaded = vesselProgress >= tUnloadDone;
      const isDocking = vesselProgress >= tStart;

      const targetLocalX = isUnloaded
        ? st.side * (16.2 + waveIdx * 3.6)
        : st.x + st.side * (1.25 + (waveIdx % 2) * 0.35);
      const targetLocalZ = isUnloaded ? 52 + waveIdx * 11 + (slotIdx % 2) * 7 : st.z;

      _tmpWorldPos
        .set(targetLocalX, boatWaterY, targetLocalZ)
        .applyMatrix4(vesselRoot.matrixWorld)
        .applyMatrix4(_invMat);

      let dx = _tmpWorldPos.x - lb.boatGroup.position.x;
      let dz = _tmpWorldPos.z - lb.boatGroup.position.z;
      const dist = Math.hypot(dx, dz);
      const isMoving = isDocking && dist > 1.1;

      if (isMoving) {
        for (let oj = 0; oj < lifeboats.length; oj++) {
          if (oj === i || !lifeboats[oj].detached) continue;
          const sx = lb.boatGroup.position.x - lifeboats[oj].boatGroup.position.x;
          const sz = lb.boatGroup.position.z - lifeboats[oj].boatGroup.position.z;
          const sd = Math.hypot(sx, sz);
          if (sd < 7.2 && sd > 0.05) {
            dx += (sx / sd) * 3.0;
            dz += (sz / sd) * 3.0;
          }
        }
        const mDist = Math.hypot(dx, dz) || 1;
        const speed = isUnloaded ? 4.2 : 7.4;
        const step = Math.min(dist, speed * dt);
        lb.boatGroup.position.x += (dx / mDist) * step;
        lb.boatGroup.position.z += (dz / mDist) * step;
        lb.boatX = lb.boatGroup.position.x;
        lb.boatZ = lb.boatGroup.position.z;
        const targetYaw = Math.atan2(-dx, -dz);
        let dy = targetYaw - lb.boatYaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        lb.boatYaw += dy * Math.min(1, dt * 3.5);
      }

      lb.boatGroup.position.y = boatWaterY;
      setEulerXYZ(
        lb.boatGroup,
        Math.sin(time * 1.4 + i) * 0.035,
        lb.boatYaw,
        Math.cos(time * 1.1 + i) * 0.04,
      );

      const rowAmp = isMoving ? 0.38 : 0.06;
      const rowSweep = Math.sin(time * (isMoving ? 3.1 : 1.1) + i) * rowAmp;
      const oarChildren = lb.oarsGroup.children;
      for (let oi = 0; oi < oarChildren.length; oi++) {
        const oar = oarChildren[oi];
        setEulerXYZ(oar, Math.cos(time * (isMoving ? 3.1 : 1.1) + i) * (isMoving ? 0.16 : 0.04), rowSweep, 0);
      }

      const unloadProgress = MathUtils.clamp((vesselProgress - tDock) / Math.max(0.05, tUnloadDone - tDock), 0, 1);
      if (unloadProgress >= 0.85 || (dist < 4.5 && vesselProgress >= tUnloadDone * 0.92)) {
        lb.rescued = true;
      }

      if (lb.rescued) {
        lb.occupantsGroup.visible = false;
        if (assignedToWarship) {
          warshipBoatsRecovered += 1;
          warshipFrac += 1;
        } else {
          carpathiaBoatsRecovered += 1;
          carpathiaFrac += 1;
        }
      } else {
        lb.occupantsGroup.visible = true;
        if (vesselProgress > tDock && dist < 8.5) {
          if (assignedToWarship) warshipFrac += unloadProgress * 0.85;
          else carpathiaFrac += unloadProgress * 0.85;
        }
      }
    }

    const warshipSurvivorsRescued =
      warshipBoatTotal > 0 ? Math.min(356, Math.round((warshipFrac / warshipBoatTotal) * 356)) : 0;
    const carpathiaShare = warshipBoatTotal > 0 ? 356 : 712;
    const carpathiaSurvivorsRescued = Math.min(
      carpathiaShare,
      Math.round((carpathiaFrac / Math.max(1, carpathiaBoatTotal)) * carpathiaShare),
    );
    const boatsRecovered = warshipBoatsRecovered + carpathiaBoatsRecovered;
    const survivorsRescued = Math.min(712, warshipSurvivorsRescued + carpathiaSurvivorsRescued);

    return {
      boatsRecovered,
      survivorsRescued,
      warshipBoatsRecovered,
      warshipSurvivorsRescued,
      carpathiaBoatsRecovered,
      carpathiaSurvivorsRescued,
    };
  };

  const getFloatingLifeboats = (out: FloatingLifeboatHazard[]) => {
    out.length = 0;
    for (let i = 0; i < lifeboats.length; i++) {
      const lb = lifeboats[i];
      if (!lb.detached) continue;
      lb.boatGroup.updateWorldMatrix(true, false);
      lb.boatGroup.getWorldPosition(_tmpWorldPos);
      out.push({
        index: i,
        x: _tmpWorldPos.x,
        z: _tmpWorldPos.z,
        radius: 3.8,
      });
    }
  };

  const reset = () => {
    for (const ch of characters) {
      const start = ch.route[0];
      ch.posX = start.x;
      ch.posY = start.y;
      ch.posZ = start.z;
      ch.waypointIdx = ch.route.length > 1 ? 1 : 0;
      ch.pauseTimer = 0;
      ch.group.visible = true;
      ch.lifejacket.visible = false;
      ch.group.position.set(start.x, start.y, start.z);
      ch.group.rotation.y = ch.baseRotY;
      ch.bodyRoot.position.y = 0.85;
      ch.bodyRoot.rotation.set(0, 0, 0);
      setEulerXYZ(ch.torsoGroup, 0, 0, 0);
    }

    for (const batch of batches) {
      for (const a of batch.actors) {
        a.posX = a.startX;
        a.posY = a.startY;
        a.posZ = a.startZ;
        a.rotY = a.baseRotY;
        a.goingForward = true;
        a.pauseTimer = 0;
        a.intent = a.isWalker ? 'stroll' : 'rail_watch';
      }
      stepCrowdBatch(batch, 0, 0, 0, false, false);
    }

    for (const lb of lifeboats) {
      if (lb.detached) {
        lb.homeParent.add(lb.boatGroup);
        lb.detached = false;
      }
      lb.rescued = false;
      lb.boatX = lb.side * (boatBaseX + 4.55);
      lb.boatZ = lb.baseZ;
      lb.boatYaw = lb.side * 0.25;
      const isCutter = lb.index === 0;
      const cutterSwing = isCutter ? 0.22 : 0;
      const cutterX = lb.side * (isCutter ? boatBaseX + 1.13 : boatBaseX);
      lb.davitForeArm.rotation.set(0, 0, -lb.side * cutterSwing);
      lb.davitAftArm.rotation.set(0, 0, -lb.side * cutterSwing);
      lb.ropeFore.visible = true;
      lb.ropeFore.position.set(cutterX, 14.52, lb.baseZ - 2.65);
      lb.ropeFore.scale.set(1, 0.92, 1);
      lb.ropeAft.visible = true;
      lb.ropeAft.position.set(cutterX, 14.52, lb.baseZ + 2.65);
      lb.ropeAft.scale.set(1, 0.92, 1);
      lb.occupantsGroup.visible = false;
      lb.oarsGroup.visible = false;
      lb.lanternMesh.visible = false;
      lb.boatGroup.position.set(cutterX, 13.85, lb.baseZ);
      setEulerXYZ(lb.boatGroup, 0, 0, 0);
    }
  };

  const setLanternPower = (power: number) => {
    boatLanternMat.emissiveIntensity = 0.55 + 1.15 * MathUtils.clamp(power, 0, 1);
  };

  const dispose = () => {
    const geos = new Set<THREE.BufferGeometry>();
    for (const m of meshes) geos.add(m.geometry);
    for (const t of tmps) geos.add(t.geometry);
    for (const im of instancedMeshes) {
      geos.add(im.geometry);
      im.dispose();
      im.removeFromParent();
    }
    geos.forEach((g) => g.dispose());
    for (const g of rootGroups) g.removeFromParent();
    for (const m of meshes) m.removeFromParent();
    materials.forEach((m) => m.dispose());
  };

  return {
    characters,
    totalCharacterCount: characters.length + fwdBatch.actors.length + aftBatch.actors.length,
    lifeboats,
    shadowCasters,
    updateCruising,
    updateSinking,
    updateRescue,
    getFloatingLifeboats,
    reset,
    setLanternPower,
    dispose,
  };
}
