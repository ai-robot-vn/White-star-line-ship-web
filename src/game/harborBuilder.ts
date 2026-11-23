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
  buildTubeMesh,
  commitInstanceColors,
  commitInstanceMatrices,
  createCanvasTexture,
  createInstancedSlot,
  makePBR,
  setEulerXYZ,
  setInstanceColorHex,
  writeInstanceMatrix,
  writeZeroInstanceMatrix,
} from './threeHelpers';
import { buildOceanLinerShip } from './shipVariants';
import { TitanicShipRig } from './shipBuilder';
import { ProceduralTextureSet } from './textures';
import { VesselId, VESSEL_ORDER, VESSEL_SPECS } from './types';

export interface HarborCircleObstacle {
  id: string;
  kind: 'tug' | 'pilot' | 'lifeboat' | 'buoy' | 'pier';
  x: number;
  z: number;
  radius: number;
  label: string;
  active: boolean;
}

export interface HarborBoxObstacle {
  id: string;
  kind: 'quay' | 'breakwater';
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  label: string;
}

export interface EscortBreakEvent {
  id: string;
  label: string;
  x: number;
  z: number;
  phase: 'impact' | 'snap';
}

export interface HarborRig {
  root: THREE.Group;
  hawsersGroup: THREE.Group;
  shadowCasters: THREE.Object3D[];
  setActiveVessel: (vesselId: VesselId) => void;
  update: (
    simTime: number,
    shipX: number,
    shipZ: number,
    headingRad: number,
    speedKnots: number,
    floodingPct: number,
    nightMix: number,
    dt?: number,
    escortActive?: boolean,
  ) => void;
  resetEscorts: () => void;
  triggerEscortStrike: (id: string) => EscortBreakEvent | null;
  consumeBreakEvents: () => readonly EscortBreakEvent[];
  getEscortStates: () => ReadonlyArray<{
    id: string;
    status: 'active' | 'sinking' | 'sunk';
    x: number;
    z: number;
    radius: number;
    label: string;
  }>;
  getCircleObstacles: () => readonly HarborCircleObstacle[];
  getBoxObstacles: () => readonly HarborBoxObstacle[];
  dispose: () => void;
}

function createTerminalSignTexture(
  title: string,
  subtitle: string,
  accentHex = '#d4af5a',
  bgHex = '#182433',
): THREE.CanvasTexture {
  const w = 1024;
  const h = 192;
  return createCanvasTexture(
    w,
    h,
    (ctx) => {
      ctx.fillStyle = bgHex;
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = accentHex;
      ctx.lineWidth = 8;
      ctx.strokeRect(10, 10, w - 20, h - 20);

      ctx.fillStyle = '#f3ead3';
      ctx.font = 'bold 50px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(title, w / 2, 74);

      ctx.fillStyle = accentHex;
      ctx.font = 'bold 25px sans-serif';
      ctx.fillText(subtitle, w / 2, 134);
    },
    { wrap: false },
  );
}

function createDockClockTexture(): THREE.CanvasTexture {
  return createCanvasTexture(
    256,
    256,
    (ctx) => {
      ctx.fillStyle = '#f7efda';
      ctx.beginPath();
      ctx.arc(128, 128, 120, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#2d241b';
      ctx.lineWidth = 10;
      ctx.stroke();

      ctx.save();
      ctx.translate(128, 128);
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        ctx.strokeStyle = '#1b1610';
        ctx.lineWidth = i % 3 === 0 ? 6 : 3;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 86, Math.sin(a) * 86);
        ctx.lineTo(Math.cos(a) * 108, Math.sin(a) * 108);
        ctx.stroke();
      }
      ctx.strokeStyle = '#1b1610';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(0, 6);
      ctx.lineTo(0, -68);
      ctx.stroke();
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(0, 8);
      ctx.lineTo(0, -90);
      ctx.stroke();
      ctx.restore();
    },
    { wrap: false },
  );
}

function createStoneMasonryTexture(): THREE.CanvasTexture {
  return createCanvasTexture(
    512,
    512,
    (ctx) => {
      ctx.fillStyle = '#6f7378';
      ctx.fillRect(0, 0, 512, 512);
      const rows = 16;
      const rowH = 512 / rows;
      for (let r = 0; r < rows; r++) {
        const cols = 8;
        const colW = 512 / cols;
        const offset = (r % 2) * (colW * 0.5);
        for (let c = -1; c <= cols; c++) {
          const shade = 95 + ((r * 19 + c * 31) % 28);
          ctx.fillStyle = `rgb(${shade}, ${shade + 2}, ${shade + 5})`;
          ctx.fillRect(c * colW + offset + 2, r * rowH + 2, colW - 4, rowH - 4);
        }
      }
    },
    { wrap: true, repeatU: 16, repeatV: 2 },
  );
}

function createBrickWallTexture(): THREE.CanvasTexture {
  return createCanvasTexture(
    512,
    512,
    (ctx) => {
      ctx.fillStyle = '#8b8378';
      ctx.fillRect(0, 0, 512, 512);
      const rows = 24;
      const rowH = 512 / rows;
      const cols = 12;
      const colW = 512 / cols;
      for (let r = 0; r < rows; r++) {
        const off = (r % 2) * (colW * 0.5);
        for (let c = -1; c <= cols; c++) {
          const v = (r * 17 + c * 29) % 26;
          ctx.fillStyle = `rgb(${102 + v}, ${49 + Math.floor(v * 0.55)}, ${37 + Math.floor(v * 0.45)})`;
          ctx.fillRect(c * colW + off + 1.5, r * rowH + 1.5, colW - 3, rowH - 3);
        }
      }
    },
    { wrap: true, repeatU: 5, repeatV: 2 },
  );
}

export function buildSouthamptonHarbor(
  scene: THREE.Scene,
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean,
): HarborRig {
  const meshes: THREE.Mesh[] = [];
  const instancedMeshes: THREE.InstancedMesh[] = [];
  const extraGeos: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const ownTextures: THREE.Texture[] = [];
  const shadowCasters: THREE.Object3D[] = [];

  const trackMesh = <T extends THREE.Mesh>(
    m: T,
    parent?: THREE.Object3D,
    castShadow = false,
    receiveShadow = false,
  ): T => {
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

  const root = new THREE.Group();
  root.name = 'harbor_root';
  scene.add(root);

  const stoneTex = createStoneMasonryTexture();
  ownTextures.push(stoneTex);
  const brickTex = createBrickWallTexture();
  ownTextures.push(brickTex);
  const signTex44 = createTerminalSignTexture(
    'WHITE STAR LINE · BERTH 44',
    'SOUTHAMPTON WHITE STAR DOCK · NO. 44 SHED',
    '#d4af5a',
    '#182433',
  );
  ownTextures.push(signTex44);
  const signTex40 = createTerminalSignTexture(
    'WHITE STAR HOSPITAL · BERTH 40',
    'HMHS BRITANNIC · HOSPITAL QUAY EAST',
    '#34d399',
    '#132b24',
  );
  ownTextures.push(signTex40);
  const signTex38 = createTerminalSignTexture(
    'COSTA CROCIERE · BERTH 38',
    'COSTA CONCORDIA · CRUISE QUAY WEST',
    '#f4c41c',
    '#073573',
  );
  ownTextures.push(signTex38);
  const signTex36 = createTerminalSignTexture(
    'HARBOR PATROL · BERTH 36',
    'COAST GUARD & TENDER WHARF',
    '#38bdf8',
    '#0e1b2d',
  );
  ownTextures.push(signTex36);
  const clockTex = createDockClockTexture();
  ownTextures.push(clockTex);

  const graniteMat = trackMat(makePBR('harbor_granite', { albedoTex: stoneTex, color: 0xa2a6aa, roughness: 0.88, metallic: 0.05, envIntensity: 0.35 }));
  const copingStoneMat = trackMat(makePBR('harbor_coping', { color: 0x94979b, roughness: 0.82, metallic: 0.06, envIntensity: 0.35 }));
  const cobbleDeckMat = trackMat(makePBR('harbor_cobble', { color: 0x5c6065, roughness: 0.92, metallic: 0.04, envIntensity: 0.3 }));
  const timberPilingMat = trackMat(makePBR('harbor_timber', { color: 0x2c2017, roughness: 0.9, metallic: 0.05, envIntensity: 0.3 }));
  const brickMat = trackMat(makePBR('harbor_brickMat', { albedoTex: brickTex, color: 0x9f5949, roughness: 0.86, metallic: 0.04, envIntensity: 0.35 }));
  const limestoneMat = trackMat(makePBR('harbor_limestone', { color: 0xc8bfa9, roughness: 0.78, metallic: 0.04, envIntensity: 0.38 }));
  const slateRoofMat = trackMat(makePBR('harbor_slate', { color: 0x28313d, roughness: 0.72, metallic: 0.14, envIntensity: 0.4 }));
  const craneSteelMat = trackMat(makePBR('harbor_craneSteel', { color: 0x3b444c, roughness: 0.48, metallic: 0.65, envIntensity: 0.45 }));
  const darkIronMat = trackMat(makePBR('harbor_darkIron', { color: 0x1b2027, roughness: 0.46, metallic: 0.68, envIntensity: 0.45 }));
  const creamPaintMat = trackMat(makePBR('harbor_cream', { color: 0xe8e2d4, roughness: 0.58, metallic: 0.06, envIntensity: 0.45 }));
  const buffFunnelMat = trackMat(makePBR('harbor_buff', { color: 0xc99a5d, roughness: 0.58, metallic: 0.12, envIntensity: 0.42 }));
  const rustRedMat = trackMat(makePBR('harbor_rustRed', { color: 0x7c241d, roughness: 0.68, metallic: 0.16, envIntensity: 0.38 }));
  const lswrGreenMat = trackMat(makePBR('harbor_lswrGreen', { color: 0x3b593f, roughness: 0.5, metallic: 0.25, envIntensity: 0.42 }));
  const coachMaroonMat = trackMat(makePBR('harbor_coachMaroon', { color: 0x562321, roughness: 0.54, metallic: 0.12, envIntensity: 0.4 }));
  const brassMat = trackMat(makePBR('harbor_brass', { color: 0xd8aa4c, roughness: 0.42, metallic: 0.82, anisotropy: 0.65, envIntensity: 0.36 }));
  const greenHillMat = trackMat(makePBR('harbor_hill', { color: 0x3e5435, roughness: 0.94, metallic: 0.02, envIntensity: 0.25 }));
  const headlandRockMat = trackMat(makePBR('harbor_rock', { color: 0x565a5e, roughness: 0.9, metallic: 0.05, envIntensity: 0.28 }));
  const terminalSignMat44 = trackMat(makePBR('harbor_termSignMat44', { albedoTex: signTex44, roughness: 0.5, metallic: 0.1, envIntensity: 0.4 }));
  const terminalSignMat40 = trackMat(makePBR('harbor_termSignMat40', { albedoTex: signTex40, roughness: 0.5, metallic: 0.1, envIntensity: 0.4 }));
  const terminalSignMat38 = trackMat(makePBR('harbor_termSignMat38', { albedoTex: signTex38, roughness: 0.5, metallic: 0.1, envIntensity: 0.4 }));
  const terminalSignMat36 = trackMat(makePBR('harbor_termSignMat36', { albedoTex: signTex36, roughness: 0.5, metallic: 0.1, envIntensity: 0.4 }));
  const clockFaceMat = trackMat(makePBR('harbor_clockMat', { albedoTex: clockTex, emissive: 0xffe1a0, emissiveIntensity: 0.3, roughness: 0.42, envIntensity: 0.35 }));
  const warmLanternMat = trackMat(makePBR('harbor_lanternMat', { color: 0xffd78c, emissive: 0xffb44c, emissiveIntensity: 0.25, roughness: 0.35, envIntensity: 0.3 }));

  const beaconConeMat = trackMat(
    new THREE.MeshBasicMaterial({
      name: 'harbor_beaconConeMat',
      color: 0xffd27a,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );

  const hawserMat = trackMat(makePBR('harbor_hawser', { color: 0x9b845e, roughness: 0.92, metallic: 0.02, envIntensity: 0.3 }));

  // =========================================================================
  // 1. SOUTHAMPTON WHITE STAR DOCK (OCEAN DOCK) — 3-SIDED ENCLOSED TIDAL BASIN
  // =========================================================================
  const eastQuayLen = 434;
  const eastQuayCenterZ = 41;
  const quayWall = trackMesh(buildBox('harbor_eastQuay', 72, 9.2, eastQuayLen), root, false, true);
  quayWall.material = graniteMat;
  quayWall.position.set(55.5, -0.4, eastQuayCenterZ);

  const quayApron = trackMesh(buildBox('harbor_eastApron', 72.4, 0.32, eastQuayLen + 0.4), root, false, true);
  quayApron.material = cobbleDeckMat;
  quayApron.position.set(55.5, 4.25, eastQuayCenterZ);

  const eastCoping = trackMesh(buildBox('harbor_eastCoping', 1.15, 0.5, eastQuayLen + 0.6), root, false, true);
  eastCoping.material = copingStoneMat;
  eastCoping.position.set(19.95, 4.22, eastQuayCenterZ);

  const eastPierHead = trackMesh(buildCylinder('harbor_eastPier', 16, 17, 9.4, 20), root, false, true);
  eastPierHead.material = graniteMat;
  eastPierHead.position.set(35.5, -0.35, -176);

  const eastPierCoping = trackMesh(buildCylinder('harbor_eastPierCoping', 16.4, 16.4, 0.45, 20), root);
  eastPierCoping.material = copingStoneMat;
  eastPierCoping.position.set(35.5, 4.25, -176);

  const dockWatchHouse = trackMesh(buildBox('harbor_watchHouse', 7.2, 4.8, 8.6), root, true);
  dockWatchHouse.material = brickMat;
  dockWatchHouse.position.set(38, 6.75, -174);

  const dockWatchRoof = trackMesh(buildCylinder('harbor_watchRoof', 0, 6.2, 2.6, 4), root);
  dockWatchRoof.material = slateRoofMat;
  dockWatchRoof.rotation.y = Math.PI / 4;
  dockWatchRoof.position.set(38, 10.4, -174);

  const signalMast = trackMesh(buildCylinder('harbor_sigMast', 0.14, 0.26, 16, 8), root);
  signalMast.material = creamPaintMat;
  signalMast.position.set(27, 12.2, -177);

  const signalArm = trackMesh(buildBox('harbor_sigArm', 4.4, 0.22, 0.22), root);
  signalArm.material = creamPaintMat;
  signalArm.position.set(27, 17.5, -177);

  const tideBall = trackMesh(buildSphere('harbor_tideBall', 0.62, 10, 10), root);
  tideBall.material = rustRedMat;
  tideBall.position.set(25.2, 16.2, -177);

  // North Basin Head Cross-Quay (spans Berth 44, Berth 40, Berth 38 & Berth 36: x in [-466, +92])
  const northQuay = trackMesh(buildBox('harbor_northQuay', 558, 9.2, 62), root, false, true);
  northQuay.material = graniteMat;
  northQuay.position.set(-187, -0.4, 287);

  const northApron = trackMesh(buildBox('harbor_northApron', 558.4, 0.32, 62.4), root, false, true);
  northApron.material = cobbleDeckMat;
  northApron.position.set(-187, 4.25, 287);

  const northCoping = trackMesh(buildBox('harbor_northCoping', 426, 0.5, 1.2), root);
  northCoping.material = copingStoneMat;
  northCoping.position.set(-193, 4.22, 256.2);

  // Clock Tower
  const clockTower = new THREE.Group();
  clockTower.name = 'harbor_clockTower';
  root.add(clockTower);
  clockTower.position.set(-22, 4.35, 272);
  const towerBase = trackMesh(buildBox('harbor_towerBase', 11, 22, 11), clockTower, true);
  towerBase.material = brickMat;
  towerBase.position.y = 11;
  const towerQuoin = trackMesh(buildBox('harbor_towerQuoin', 11.6, 1.4, 11.6), clockTower);
  towerQuoin.material = limestoneMat;
  towerQuoin.position.y = 18.5;
  const belfry = trackMesh(buildBox('harbor_belfry', 8.8, 5.2, 8.8), clockTower);
  belfry.material = limestoneMat;
  belfry.position.y = 24.4;
  const clockCupola = trackMesh(buildCylinder('harbor_cupola', 0, 5.6, 5.8, 8), clockTower);
  clockCupola.material = slateRoofMat;
  clockCupola.position.y = 29.8;

  for (const [cx, cz, ry] of [
    [0, -5.56, Math.PI],
    [0, 5.56, 0],
    [-5.56, 0, -Math.PI / 2],
    [5.56, 0, Math.PI / 2],
  ]) {
    const face = trackMesh(buildDisc(`harbor_clockDial_${cx}_${cz}`, 1.75, 20), clockTower);
    face.material = clockFaceMat;
    face.position.set(cx, 15.2, cz);
    face.rotation.y = ry;
  }

  const northHall = trackMesh(buildBox('harbor_northHall', 58, 11, 20), root);
  northHall.material = brickMat;
  northHall.position.set(-76, 9.8, 274);
  const northHallRoof = trackMesh(buildBox('harbor_northHallRoof', 60, 2.2, 22), root);
  northHallRoof.material = slateRoofMat;
  northHallRoof.position.set(-76, 16.2, 274);

  // Central Pier (separating HMHS Britannic Berth 40 at x=-109 & Costa Concordia Berth 38 at x=-219.5)
  const westQuay = trackMesh(buildBox('harbor_westQuay', 67.6, 9.2, 446), root, false, true);
  westQuay.material = graniteMat;
  westQuay.position.set(-162.2, -0.4, 35);
  const westApron = trackMesh(buildBox('harbor_westApron', 68.0, 0.32, 446.4), root, false, true);
  westApron.material = cobbleDeckMat;
  westApron.position.set(-162.2, 4.25, 35);
  const westCoping = trackMesh(buildBox('harbor_westCoping', 1.15, 0.5, 446.4), root);
  westCoping.material = copingStoneMat;
  westCoping.position.set(-128.4, 4.22, 35);
  const westCopingOuter = trackMesh(buildBox('harbor_westCopingOuter', 1.15, 0.5, 446.4), root);
  westCopingOuter.material = copingStoneMat;
  westCopingOuter.position.set(-196.0, 4.22, 35);
  const westPierHead = trackMesh(buildCylinder('harbor_westPier', 14, 15, 9.4, 20), root);
  westPierHead.material = graniteMat;
  westPierHead.position.set(-142, -0.35, -188);
  const westPierHeadOuter = trackMesh(buildCylinder('harbor_westPierOuter', 14, 15, 9.4, 20), root);
  westPierHeadOuter.material = graniteMat;
  westPierHeadOuter.position.set(-182, -0.35, -188);

  // West Cruise Pier (separating Costa Concordia Berth 38 at x=-219.5 & Patrol Wharf Berth 36 at x=-359)
  const farWestQuay = trackMesh(buildBox('harbor_farWestQuay', 64.0, 9.2, 446), root, false, true);
  farWestQuay.material = graniteMat;
  farWestQuay.position.set(-304.0, -0.4, 35);
  const farWestApron = trackMesh(buildBox('harbor_farWestApron', 64.4, 0.32, 446.4), root, false, true);
  farWestApron.material = cobbleDeckMat;
  farWestApron.position.set(-304.0, 4.25, 35);
  const farWestCoping = trackMesh(buildBox('harbor_farWestCoping', 1.15, 0.5, 446.4), root);
  farWestCoping.material = copingStoneMat;
  farWestCoping.position.set(-272.4, 4.22, 35);
  const farWestCopingWest = trackMesh(buildBox('harbor_farWestCopingW', 1.15, 0.5, 446.4), root);
  farWestCopingWest.material = copingStoneMat;
  farWestCopingWest.position.set(-335.6, 4.22, 35);
  const farWestPierHead = trackMesh(buildCylinder('harbor_farWestPier', 14, 15, 9.4, 20), root);
  farWestPierHead.material = graniteMat;
  farWestPierHead.position.set(-288, -0.35, -188);
  const farWestPierHeadOuter = trackMesh(buildCylinder('harbor_farWestPierOuter', 14, 15, 9.4, 20), root);
  farWestPierHeadOuter.material = graniteMat;
  farWestPierHeadOuter.position.set(-320, -0.35, -188);

  // Far-West Outer Quay (flanking Costa Concordia port slip at Berth 36: x in [-466, -406])
  const outerWestQuay = trackMesh(buildBox('harbor_outerWestQuay', 60, 9.2, 446), root, false, true);
  outerWestQuay.material = graniteMat;
  outerWestQuay.position.set(-436, -0.4, 35);
  const outerWestApron = trackMesh(buildBox('harbor_outerWestApron', 60.4, 0.32, 446.4), root, false, true);
  outerWestApron.material = cobbleDeckMat;
  outerWestApron.position.set(-436, 4.25, 35);
  const outerWestCoping = trackMesh(buildBox('harbor_outerWestCoping', 1.15, 0.5, 446.4), root);
  outerWestCoping.material = copingStoneMat;
  outerWestCoping.position.set(-406.4, 4.22, 35);
  const outerWestPierHead = trackMesh(buildCylinder('harbor_outerWestPier', 14, 15, 9.4, 20), root);
  outerWestPierHead.material = graniteMat;
  outerWestPierHead.position.set(-422, -0.35, -188);

  // Timber Fender Pilings (Instanced across all 4 berths + North Basin)
  const fenderProto = buildBox('harbor_fendersProto', 0.45, 7.6, 0.48);
  extraGeos.push(fenderProto.geometry);
  const fenderCount = 54 * 6 + 52;
  const fenderSlot = createInstancedSlot('harbor_fenders', fenderProto.geometry, timberPilingMat, fenderCount, false, root);
  instancedMeshes.push(fenderSlot.mesh);
  let fIdx = 0;
  for (let i = 0; i < 54; i++) {
    writeInstanceMatrix(fenderSlot, fIdx++, 19.25, 1.0, -168 + i * 7.8, 0, 0, 0);
  }
  for (let i = 0; i < 54; i++) {
    writeInstanceMatrix(fenderSlot, fIdx++, -127.75, 1.0, -172 + i * 7.8, 0, 0, 0);
  }
  for (let i = 0; i < 54; i++) {
    writeInstanceMatrix(fenderSlot, fIdx++, -196.45, 1.0, -172 + i * 7.8, 0, 0, 0);
  }
  for (let i = 0; i < 54; i++) {
    writeInstanceMatrix(fenderSlot, fIdx++, -271.55, 1.0, -172 + i * 7.8, 0, 0, 0);
  }
  for (let i = 0; i < 54; i++) {
    writeInstanceMatrix(fenderSlot, fIdx++, -336.45, 1.0, -172 + i * 7.8, 0, 0, 0);
  }
  for (let i = 0; i < 54; i++) {
    writeInstanceMatrix(fenderSlot, fIdx++, -405.55, 1.0, -172 + i * 7.8, 0, 0, 0);
  }
  for (let i = 0; i < 52; i++) {
    writeInstanceMatrix(fenderSlot, fIdx++, -400 + i * 7.8, 1.0, 255.7, 0, Math.PI / 2, 0);
  }
  commitInstanceMatrices(fenderSlot, fenderCount);

  // Cast-Iron Mooring Bollards across all 4 berths
  const bollardZList = [-160, -115, -70, -25, 20, 68, 118, 165, 212];
  const bollardProfile = [
    new THREE.Vector2(0.36, 0),
    new THREE.Vector2(0.32, 0.14),
    new THREE.Vector2(0.2, 0.22),
    new THREE.Vector2(0.22, 0.72),
    new THREE.Vector2(0.3, 0.85),
    new THREE.Vector2(0.26, 0.96),
  ];
  const bollardProto = buildLatheMesh('harbor_bollardsProto', bollardProfile, 12);
  extraGeos.push(bollardProto.geometry);
  const bollardSlot = createInstancedSlot('harbor_bollards', bollardProto.geometry, darkIronMat, bollardZList.length * 6, false, root);
  instancedMeshes.push(bollardSlot.mesh);
  let bolIdx = 0;
  for (const bz of bollardZList) {
    writeInstanceMatrix(bollardSlot, bolIdx++, 20.9, 4.35, bz, 0, 0, 0);
    writeInstanceMatrix(bollardSlot, bolIdx++, -129.6, 4.35, bz, 0, 0, 0);
    writeInstanceMatrix(bollardSlot, bolIdx++, -194.6, 4.35, bz, 0, 0, 0);
    writeInstanceMatrix(bollardSlot, bolIdx++, -273.5, 4.35, bz, 0, 0, 0);
    writeInstanceMatrix(bollardSlot, bolIdx++, -334.6, 4.35, bz, 0, 0, 0);
    writeInstanceMatrix(bollardSlot, bolIdx++, -407.5, 4.35, bz, 0, 0, 0);
  }
  commitInstanceMatrices(bollardSlot, bollardZList.length * 6);

  // Mooring Hawsers & Retractable Passenger Embarkation Gangways per Berth
  interface BerthMooringRig {
    hawsers: THREE.Group;
    gangways: THREE.Group;
    retractDeltaX: number;
  }
  const buildBerthMooring = (
    vesselId: VesselId,
    hullEdgeX: number,
    bollardX: number,
    gangwayCenterX: number,
    retractDeltaX: number,
    zPairs: Array<[number, number, number]>,
    gangwayZs: [number, number],
  ): BerthMooringRig => {
    const hawsers = new THREE.Group();
    hawsers.name = `harbor_hawsers_${vesselId}`;
    root.add(hawsers);
    for (let hi = 0; hi < zPairs.length; hi++) {
      const [dxHull, sy, sz] = zPairs[hi];
      const sx = hullEdgeX + dxHull;
      const p0 = new THREE.Vector3(sx, sy, sz);
      const p1 = new THREE.Vector3((sx + bollardX) * 0.5, (sy + 4.8) * 0.5 - 0.65, sz + 3);
      const p2 = new THREE.Vector3(bollardX, 4.85, sz + 6);
      const rope = trackMesh(buildTubeMesh(`harbor_hawser_${vesselId}_${hi}`, [p0, p1, p2], 10, 0.09, 6), hawsers);
      rope.material = hawserMat;
    }

    const gangways = new THREE.Group();
    gangways.name = `harbor_gangways_${vesselId}`;
    root.add(gangways);
    for (const gz of gangwayZs) {
      const brow = new THREE.Group();
      brow.name = `harbor_brow_${vesselId}_${gz}`;
      gangways.add(brow);
      brow.position.set(0, 5.2, gz);
      const floor = trackMesh(buildBox(`harbor_browFlr_${vesselId}_${gz}`, 8.2, 0.24, 2.4), brow);
      floor.material = timberPilingMat;
      floor.position.set(gangwayCenterX, 0, 0);
      for (const sideZ of [-1.1, 1.1]) {
        const rail = trackMesh(buildBox(`harbor_browRail_${vesselId}_${gz}_${sideZ}`, 8.2, 1.05, 0.12), brow);
        rail.material = creamPaintMat;
        rail.position.set(gangwayCenterX, 0.62, sideZ);
      }
      const canopy = trackMesh(buildBox(`harbor_browCanopy_${vesselId}_${gz}`, 8.4, 0.16, 2.7), brow);
      canopy.material = slateRoofMat;
      canopy.position.set(gangwayCenterX, 2.25, 0);
    }

    return { hawsers, gangways, retractDeltaX };
  };

  const berthMoorings: Record<VesselId, BerthMooringRig> = {
    titanic: buildBerthMooring(
      'titanic',
      0,
      20.9,
      17.6,
      5.8,
      [
        [12.2, 8.8, -42],
        [13.8, 7.6, -15],
        [14.0, 7.2, 22],
        [14.0, 7.2, 74],
        [13.8, 7.2, 125],
        [11.6, 7.6, 168],
      ],
      [16, 110],
    ),
    britannic: buildBerthMooring(
      'britannic',
      -109,
      -129.6,
      -126.2,
      -5.8,
      [
        [-12.4, 8.8, -42],
        [-14.0, 7.6, -15],
        [-14.2, 7.2, 22],
        [-14.2, 7.2, 74],
        [-14.0, 7.2, 125],
        [-11.8, 7.6, 168],
      ],
      [16, 110],
    ),
    concordia: buildBerthMooring(
      'concordia',
      -219.5,
      -194.6,
      -199.0,
      5.8,
      [
        [13.4, 10.2, -48],
        [16.8, 9.6, -15],
        [17.5, 9.2, 24],
        [17.5, 9.2, 78],
        [17.0, 9.2, 134],
        [14.2, 9.4, 182],
      ],
      [20, 114],
    ),
  };
  const hawsersGroup = berthMoorings.titanic.hawsers;

  // =========================================================================
  // 2. LSWR BOAT TRAIN RAILWAYS, STEAM LOCOMOTIVE & PULLMAN CARRIAGES
  // =========================================================================
  for (const trackX of [22.8, 26.8]) {
    for (const rOff of [-0.72, 0.72]) {
      const rail = trackMesh(buildBox(`harbor_rail_${trackX}_${rOff}`, 0.11, 0.14, 405), root);
      rail.material = darkIronMat;
      rail.position.set(trackX + rOff, 4.44, 42);
    }
  }
  const sleeperProto = buildBox('harbor_sleepersProto', 2.1, 0.1, 0.24);
  extraGeos.push(sleeperProto.geometry);
  const sleeperSlot = createInstancedSlot('harbor_sleepers', sleeperProto.geometry, timberPilingMat, 360, false, root);
  instancedMeshes.push(sleeperSlot.mesh);
  let sIdx = 0;
  for (const trackX of [22.8, 26.8]) {
    for (let sz = -152; sz <= 240; sz += 2.2) {
      if (sIdx >= 360) break;
      writeInstanceMatrix(sleeperSlot, sIdx++, trackX, 4.38, sz, 0, 0, 0);
    }
  }
  const activeSleeperCount = sIdx;
  while (sIdx < 360) {
    writeZeroInstanceMatrix(sleeperSlot, sIdx++);
  }
  commitInstanceMatrices(sleeperSlot, activeSleeperCount);

  // 1912 LSWR Steam Boat Train
  const trainGroup = new THREE.Group();
  trainGroup.name = 'harbor_train';
  root.add(trainGroup);
  trainGroup.position.set(26.8, 4.5, 42);

  const locoGroup = new THREE.Group();
  locoGroup.name = 'harbor_loco';
  trainGroup.add(locoGroup);
  locoGroup.position.set(0, 0, -40);
  const chassis = trackMesh(buildBox('harbor_locoChassis', 2.25, 0.7, 9.6), locoGroup);
  chassis.material = darkIronMat;
  chassis.position.y = 0.75;
  const boiler = trackMesh(buildCylinder('harbor_boiler', 0.92, 0.92, 6.2, 18), locoGroup, true);
  boiler.material = lswrGreenMat;
  boiler.rotation.x = Math.PI / 2;
  boiler.position.set(0, 2.05, -0.8);
  const smokebox = trackMesh(buildCylinder('harbor_smokebox', 0.94, 0.94, 1.5, 18), locoGroup);
  smokebox.material = darkIronMat;
  smokebox.rotation.x = Math.PI / 2;
  smokebox.position.set(0, 2.05, -4.3);
  const steamDome = trackMesh(buildSphere('harbor_steamDome', 0.45, 12, 10), locoGroup);
  steamDome.material = brassMat;
  steamDome.position.set(0, 2.95, -0.5);
  const stack = trackMesh(buildCylinder('harbor_stack', 0.24, 0.28, 1.5, 12), locoGroup);
  stack.material = darkIronMat;
  stack.position.set(0, 3.35, -4.2);
  const locoCab = trackMesh(buildBox('harbor_locoCab', 2.38, 2.25, 2.4), locoGroup);
  locoCab.material = lswrGreenMat;
  locoCab.position.set(0, 2.22, 3.2);
  const cabRoof = trackMesh(buildCylinder('harbor_cabRoof', 1.4, 1.4, 2.6, 12, false, 0.26), locoGroup);
  cabRoof.material = creamPaintMat;
  setEulerXYZ(cabRoof, Math.PI / 2, 0, Math.PI * 0.24);
  cabRoof.position.set(0, 2.2, 3.2);

  for (const wz of [-3.4, -1.5, 0.6, 2.6]) {
    for (const wx of [-1.06, 1.06]) {
      const w = trackMesh(buildCylinder(`harbor_lwheel_${wz}_${wx}`, 0.55, 0.55, 0.18, 14), locoGroup);
      w.material = darkIronMat;
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.55, wz);
    }
  }
  const headlamp = trackMesh(buildSphere('harbor_headlamp', 0.18, 8, 8), locoGroup);
  headlamp.material = warmLanternMat;
  headlamp.position.set(0, 1.45, -5.05);

  const tender = trackMesh(buildBox('harbor_tender', 2.3, 1.85, 6.2), trainGroup);
  tender.material = lswrGreenMat;
  tender.position.set(0, 1.55, -31.5);

  for (let c = 0; c < 4; c++) {
    const cz = -18 + c * 18.8;
    const bogie = trackMesh(buildBox(`harbor_bogie_${c}`, 2.2, 0.72, 17.2), trainGroup);
    bogie.material = darkIronMat;
    bogie.position.set(0, 0.52, cz);
    const body = trackMesh(buildBox(`harbor_cbody_${c}`, 2.48, 2.2, 17.6), trainGroup, true);
    body.material = coachMaroonMat;
    body.position.set(0, 1.98, cz);
    const upper = trackMesh(buildBox(`harbor_cupper_${c}`, 2.51, 0.92, 17.55), trainGroup);
    upper.material = creamPaintMat;
    upper.position.set(0, 2.48, cz);
    const roof = trackMesh(buildBox(`harbor_croof_${c}`, 2.58, 0.36, 17.8), trainGroup);
    roof.material = slateRoofMat;
    roof.position.set(0, 3.24, cz);
    const cler = trackMesh(buildBox(`harbor_ccler_${c}`, 1.25, 0.34, 16.8), trainGroup);
    cler.material = creamPaintMat;
    cler.position.set(0, 3.55, cz);
  }

  // =========================================================================
  // 3. WHITE STAR OCEAN TERMINAL SHEDS
  // =========================================================================
  let whIdx = 0;
  const buildWarehouse = (
    xCenter: number,
    zCenter: number,
    length: number,
    facingSign: -1 | 1,
    signMat?: THREE.Material,
    oppSignMat?: THREE.Material,
  ) => {
    const id = whIdx++;
    const shed = new THREE.Group();
    shed.name = `harbor_shed_${id}`;
    root.add(shed);
    shed.position.set(xCenter, 4.35, zCenter);

    const body = trackMesh(buildBox(`harbor_shedBody_${id}`, 23, 10.6, length), shed, true, true);
    body.material = brickMat;
    body.position.y = 5.3;

    const cornice = trackMesh(buildBox(`harbor_shedCornice_${id}`, 23.8, 0.95, length + 0.8), shed);
    cornice.material = limestoneMat;
    cornice.position.y = 10.5;

    const bayCount = Math.max(3, Math.floor(length / 16));
    for (let i = 0; i <= bayCount; i++) {
      const pz = -length * 0.5 + (i / bayCount) * length;
      const pilaster = trackMesh(buildBox(`harbor_shedPil_${id}_${i}`, 0.65, 10.2, 1.1), shed);
      pilaster.material = limestoneMat;
      pilaster.position.set(facingSign * 11.55, 5.1, pz);

      if (i < bayCount) {
        const doorZ = pz + (length / bayCount) * 0.5;
        const arch = trackMesh(buildBox(`harbor_shedArch_${id}_${i}`, 0.45, 5.4, 5.4), shed);
        arch.material = darkIronMat;
        arch.position.set(facingSign * 11.45, 2.7, doorZ);

        const transom = trackMesh(buildBox(`harbor_shedTransom_${id}_${i}`, 0.35, 1.4, 4.4), shed);
        transom.material = warmLanternMat;
        transom.position.set(facingSign * 11.5, 7.6, doorZ);
      }
    }

    const roofShape = new Shape2D();
    roofShape.moveTo(-12.2, 0);
    roofShape.lineTo(12.2, 0);
    roofShape.lineTo(0, 5.4);
    roofShape.closePath();
    const roof = trackMesh(buildExtrudedShapeMesh(`harbor_shedRoof_${id}`, roofShape, length + 1.2), shed, true);
    roof.material = slateRoofMat;
    roof.position.z = -(length + 1.2) * 0.5;
    bakeTransform(roof);
    roof.position.y = 10.85;

    const ridge = trackMesh(buildBox(`harbor_shedRidge_${id}`, 3.4, 1.4, length * 0.76), shed);
    ridge.material = limestoneMat;
    ridge.position.y = 15.8;

    if (signMat) {
      const signBoard = trackMesh(buildBox(`harbor_signBoard_${id}`, 0.35, 4.4, 28), shed);
      signBoard.material = darkIronMat;
      signBoard.position.set(facingSign * 11.85, 12.8, 0);
      const signFace = trackMesh(buildPlane(`harbor_signFace_${id}`, 27.6, 4.2), shed);
      signFace.material = signMat;
      signFace.rotation.y = facingSign < 0 ? -Math.PI / 2 : Math.PI / 2;
      signFace.position.set(facingSign * 12.06, 12.8, 0);
    }
    if (oppSignMat) {
      const oppSign = -facingSign;
      const signBoard = trackMesh(buildBox(`harbor_signBoardOpp_${id}`, 0.35, 4.4, 28), shed);
      signBoard.material = darkIronMat;
      signBoard.position.set(oppSign * 11.85, 12.8, 0);
      const signFace = trackMesh(buildPlane(`harbor_signFaceOpp_${id}`, 27.6, 4.2), shed);
      signFace.material = oppSignMat;
      signFace.rotation.y = oppSign < 0 ? -Math.PI / 2 : Math.PI / 2;
      signFace.position.set(oppSign * 12.06, 12.8, 0);
    }
  };

  buildWarehouse(53, -95, 86, -1);
  buildWarehouse(53, 32, 132, -1, terminalSignMat44);
  buildWarehouse(53, 165, 92, -1);
  buildWarehouse(-162.2, -68, 96, 1);
  buildWarehouse(-162.2, 56, 126, 1, terminalSignMat40, terminalSignMat38);
  buildWarehouse(-162.2, 185, 76, 1);
  buildWarehouse(-304, -50, 96, 1, undefined, terminalSignMat36);
  buildWarehouse(-304, 120, 120, 1);
  buildWarehouse(-434, -50, 96, 1);
  buildWarehouse(-434, 120, 120, 1);

  // =========================================================================
  // 4. STOTHERT & PITT DOCKSIDE ELECTRIC PORTAL GANTRY CRANES
  // =========================================================================
  let crIdx = 0;
  const buildGantryCrane = (xPos: number, zPos: number, dirSign: -1 | 1) => {
    const id = crIdx++;
    const crane = new THREE.Group();
    crane.name = `harbor_crane_${id}`;
    root.add(crane);
    crane.position.set(xPos, 4.35, zPos);

    for (const lx of [-2.4, 2.4]) {
      for (const lz of [-2.8, 2.8]) {
        const leg = trackMesh(buildBox(`harbor_cleg_${id}_${lx}_${lz}`, 0.45, 9.6, 0.45), crane, true);
        leg.material = craneSteelMat;
        leg.position.set(lx * 0.85, 4.8, lz * 0.85);
        leg.rotation.z = lx > 0 ? 0.08 : -0.08;

        const bogie = trackMesh(buildBox(`harbor_cbogie_${id}_${lx}_${lz}`, 0.75, 0.65, 1.35), crane);
        bogie.material = darkIronMat;
        bogie.position.set(lx * 0.92, 0.35, lz * 0.85);
      }
    }

    const deck = trackMesh(buildBox(`harbor_cdeck_${id}`, 4.9, 0.9, 5.4), crane);
    deck.material = craneSteelMat;
    deck.position.y = 9.8;

    const cab = trackMesh(buildBox(`harbor_ccab_${id}`, 3.8, 3.4, 4.2), crane, true);
    cab.material = darkIronMat;
    cab.position.set(-dirSign * 0.4, 11.9, 0);

    const cabWin = trackMesh(buildBox(`harbor_ccabWin_${id}`, 0.18, 1.4, 2.4), crane);
    cabWin.material = warmLanternMat;
    cabWin.position.set(dirSign * 1.52, 12.1, 0);

    // Counterweight ballast block & winch drum
    const counterWt = trackMesh(buildBox(`harbor_cwt_${id}`, 1.8, 2.0, 3.4), crane);
    counterWt.material = copingStoneMat;
    counterWt.position.set(-dirSign * 2.1, 11.4, 0);

    // Twin lattice jib chords + diagonal cross-bracing
    for (const jz of [-0.42, 0.42]) {
      const chord = trackMesh(buildBox(`harbor_cboom_${id}_${jz}`, 0.24, 19.2, 0.24), crane, true);
      chord.material = craneSteelMat;
      chord.position.set(dirSign * 5.8, 19.0, jz);
      chord.rotation.z = -dirSign * 0.62;
    }
    for (let bi = 0; bi < 6; bi++) {
      const f = (bi + 0.5) / 6;
      const brace = trackMesh(buildBox(`harbor_cbrace_${id}_${bi}`, 0.12, 0.12, 0.96), crane);
      brace.material = darkIronMat;
      brace.position.set(dirSign * (1.2 + f * 9.5), 11.8 + f * 14.5, 0);
      brace.rotation.x = bi % 2 === 0 ? 0.55 : -0.55;
    }

    const tieRod = trackMesh(buildCylinder(`harbor_ctie_${id}`, 0.06, 0.06, 15.5, 6), crane);
    tieRod.material = darkIronMat;
    tieRod.position.set(dirSign * 4.6, 19.6, 0);
    tieRod.rotation.z = -dirSign * 1.08;

    const cable = trackMesh(buildCylinder(`harbor_ccable_${id}`, 0.035, 0.035, 11.5, 6), crane);
    cable.material = darkIronMat;
    cable.position.set(dirSign * 11.0, 20.4, 0);

    const hookBlock = trackMesh(buildBox(`harbor_chook_${id}`, 0.55, 0.78, 0.55), crane);
    hookBlock.material = buffFunnelMat;
    hookBlock.position.set(dirSign * 11.0, 14.6, 0);
  };

  buildGantryCrane(25.0, -84, -1);
  buildGantryCrane(25.0, 42, -1);
  buildGantryCrane(25.0, 138, -1);
  buildGantryCrane(-134.5, -18, 1);
  buildGantryCrane(-134.5, 118, 1);
  buildGantryCrane(-190.0, -15, -1);
  buildGantryCrane(-190.0, 110, -1);

  for (let lz = -135; lz <= 205; lz += 34) {
    const post = trackMesh(buildCylinder(`harbor_lampPost_${lz}`, 0.08, 0.16, 4.6, 8), root);
    post.material = darkIronMat;
    post.position.set(30.8, 6.65, lz);
    const globe = trackMesh(buildSphere(`harbor_lampGlobe_${lz}`, 0.28, 8, 8), root);
    globe.material = warmLanternMat;
    globe.position.set(30.8, 9.05, lz);

    const postWest = trackMesh(buildCylinder(`harbor_lampPostW_${lz}`, 0.08, 0.16, 4.6, 8), root);
    postWest.material = darkIronMat;
    postWest.position.set(-277.0, 6.65, lz);
    const globeWest = trackMesh(buildSphere(`harbor_lampGlobeW_${lz}`, 0.28, 8, 8), root);
    globeWest.material = warmLanternMat;
    globeWest.position.set(-277.0, 9.05, lz);

    const postConc = trackMesh(buildCylinder(`harbor_lampPostC_${lz}`, 0.08, 0.16, 4.6, 8), root);
    postConc.material = darkIronMat;
    postConc.position.set(-331.0, 6.65, lz);
    const globeConc = trackMesh(buildSphere(`harbor_lampGlobeC_${lz}`, 0.28, 8, 8), root);
    globeConc.material = warmLanternMat;
    globeConc.position.set(-331.0, 9.05, lz);

    const postOuter = trackMesh(buildCylinder(`harbor_lampPostO_${lz}`, 0.08, 0.16, 4.6, 8), root);
    postOuter.material = darkIronMat;
    postOuter.position.set(-410.0, 6.65, lz);
    const globeOuter = trackMesh(buildSphere(`harbor_lampGlobeO_${lz}`, 0.28, 8, 8), root);
    globeOuter.material = warmLanternMat;
    globeOuter.position.set(-410.0, 9.05, lz);

    const crate = trackMesh(buildBox(`harbor_crate_${lz}`, 1.4, 1.1, 1.8), root);
    crate.material = buffFunnelMat;
    crate.position.set(34.5, 4.9, lz + 6);
    crate.rotation.y = (lz % 7) * 0.25;
  }

  // =========================================================================
  // 5. HISTORIC & MODERN LINERS DOCKED IN SOUTHAMPTON (TITANIC, BRITANNIC, COSTA CONCORDIA)
  // =========================================================================
  const companionRigs: Record<VesselId, TitanicShipRig> = {
    titanic: buildOceanLinerShip(scene, textures, isSoftwareGl, 'titanic', true),
    britannic: buildOceanLinerShip(scene, textures, isSoftwareGl, 'britannic', true),
    concordia: buildOceanLinerShip(scene, textures, isSoftwareGl, 'concordia', true),
  };

  for (const vesselId of VESSEL_ORDER) {
    const rig = companionRigs[vesselId];
    const spec = VESSEL_SPECS[vesselId];
    root.add(rig.root);
    rig.root.position.set(spec.berthX, 0, spec.berthZ);
    rig.root.rotation.set(0, 0, 0);
    rig.setPowerLevel(0.05);
    rig.setSearchlightBeam(0, false);
    if (!isSoftwareGl) {
      for (const obj of rig.shadowCasters) {
        obj.castShadow = true;
        shadowCasters.push(obj);
      }
    }
  }
  let activeVesselId: VesselId = 'titanic';

  // =========================================================================
  // 6. 64 CONSCIOUS DOCKSIDE WELL-WISHERS & PORTERS ON BERTH 44 APRON
  // =========================================================================
  const DOCK_CROWD_COUNT = 64;
  interface DockCitizenMind {
    baseX: number;
    baseZ: number;
    x: number;
    z: number;
    yaw: number;
    phase: number;
    walkRange: number;
    waveEagerness: number;
    isPorter: boolean;
  }
  const dockCitizens: DockCitizenMind[] = [];
  for (let i = 0; i < DOCK_CROWD_COUNT; i++) {
    const isPorter = i % 4 === 0;
    const bx = isPorter ? 21.5 + (i % 3) * 0.9 : 29.8 + (i % 5) * 1.1;
    const bz = -68 + ((i * 23) % 245);
    dockCitizens.push({
      baseX: bx,
      baseZ: bz,
      x: bx,
      z: bz,
      yaw: Math.PI / 2,
      phase: i * 0.85,
      walkRange: isPorter ? 2.4 : 1.2,
      waveEagerness: 0.65 + ((i * 7) % 10) * 0.05,
      isPorter,
    });
  }

  const citTorsoProto = buildCylinder('harbor_citTorso', 0.16, 0.14, 0.72, 8);
  citTorsoProto.position.set(0, 1.08, 0);
  bakeTransform(citTorsoProto);

  const citLegsProto = buildCylinder('harbor_citLegs', 0.12, 0.1, 0.76, 8);
  citLegsProto.position.set(0, 0.38, 0);
  bakeTransform(citLegsProto);

  const citHeadProto = buildSphere('harbor_citHead', 0.115, 8, 8);
  citHeadProto.position.set(0, 1.56, 0);
  bakeTransform(citHeadProto);

  const citArmProto = buildCylinder('harbor_citArm', 0.045, 0.04, 0.56, 6);
  citArmProto.position.set(0, -0.24, 0);
  bakeTransform(citArmProto);

  extraGeos.push(citTorsoProto.geometry, citLegsProto.geometry, citHeadProto.geometry, citArmProto.geometry);

  const citClothMat = trackMat(makePBR('harbor_citCloth', { color: 0xffffff, roughness: 0.75, metallic: 0.02, envIntensity: 0.35 }));
  const citSkinMat = trackMat(makePBR('harbor_citSkin', { color: 0xe6bca0, roughness: 0.68, metallic: 0.02, envIntensity: 0.35 }));

  const citTorsoSlot = createInstancedSlot('harbor_citTorsoInst', citTorsoProto.geometry, citClothMat, DOCK_CROWD_COUNT, true, root);
  const citLegsSlot = createInstancedSlot('harbor_citLegsInst', citLegsProto.geometry, citClothMat, DOCK_CROWD_COUNT, true, root);
  const citHeadSlot = createInstancedSlot('harbor_citHeadInst', citHeadProto.geometry, citSkinMat, DOCK_CROWD_COUNT, false, root);
  const citArmSlot = createInstancedSlot('harbor_citArmInst', citArmProto.geometry, citClothMat, DOCK_CROWD_COUNT, true, root);
  instancedMeshes.push(citTorsoSlot.mesh, citLegsSlot.mesh, citHeadSlot.mesh, citArmSlot.mesh);

  const dockPalette = [0x1c2532, 0x3b2c22, 0x5c232d, 0x243e4d, 0x4b3d57, 0x26443b, 0xc9beab];
  for (let i = 0; i < DOCK_CROWD_COUNT; i++) {
    const colHex = dockCitizens[i].isPorter ? 0x1e2c40 : dockPalette[i % dockPalette.length];
    setInstanceColorHex(citTorsoSlot, i, colHex);
    setInstanceColorHex(citArmSlot, i, colHex);
    setInstanceColorHex(citLegsSlot, i, 0x141820);
  }
  commitInstanceColors(citTorsoSlot);
  commitInstanceColors(citArmSlot);
  commitInstanceColors(citLegsSlot);

  // =========================================================================
  // 7. CONSCIOUS SMALLER HARBOR VESSELS POSITIONED ON EITHER SIDE OF TITANIC
  // =========================================================================
  const escTornSteelMat = trackMat(makePBR('harbor_escTornSteel', { color: 0x1c2128, roughness: 0.78, metallic: 0.6, doubleSided: true }));
  const escTornRustMat = trackMat(makePBR('harbor_escTornRust', { color: 0x4b241d, roughness: 0.88, metallic: 0.32, doubleSided: true }));
  const escEmberMat = trackMat(makePBR('harbor_escEmber', { color: 0x381508, emissive: 0xff6b21, emissiveIntensity: 0.9, roughness: 0.55, doubleSided: true }));

  interface EscortVesselRig {
    id: string;
    kind: 'tug' | 'pilot' | 'lifeboat';
    label: string;
    preferredSide: -1 | 1;
    preferredAlong: number;
    preferredLatDist: number;
    group: THREE.Group;
    hullRollGroup: THREE.Group;
    bowGroup: THREE.Group;
    sternGroup: THREE.Group;
    bowCap: THREE.Group;
    sternCap: THREE.Group;
    oars: THREE.Group[];
    lanternMesh: THREE.Mesh;
    initX: number;
    initZ: number;
    initYaw: number;
    x: number;
    z: number;
    yaw: number;
    roll: number;
    curSpeed: number;
    maxSpeed: number;
    radius: number;
    phase: number;
    aiState: 'standby_flank' | 'escort_flank' | 'evade_titanic' | 'evade_obstacle' | 'rescue_standby';
    status: 'active' | 'sinking' | 'sunk';
    sinkElapsed: number;
    broken: boolean;
    listDir: -1 | 1;
  }

  const escorts: EscortVesselRig[] = [];
  const pendingBreakEvents: EscortBreakEvent[] = [];

  const tugBowShape = new Shape2D();
  tugBowShape.moveTo(-3.55, 0);
  tugBowShape.lineTo(3.55, 0);
  tugBowShape.quadraticCurveTo(3.15, -7.2, 0, -14, 12);
  tugBowShape.quadraticCurveTo(-3.15, -7.2, -3.55, 0, 12);
  tugBowShape.closePath();

  const tugSternShape = new Shape2D();
  tugSternShape.moveTo(-3.55, 0);
  tugSternShape.quadraticCurveTo(-3.25, 10.6, 0, 13.5, 12);
  tugSternShape.quadraticCurveTo(3.25, 10.6, 3.55, 0, 12);
  tugSternShape.lineTo(-3.55, 0);
  tugSternShape.closePath();

  const buildEscortCap = (prefix: string, halfW: number, yMin: number, yMax: number, dirZ: -1 | 1): THREE.Group => {
    const cap = new THREE.Group();
    cap.name = prefix;
    const plate = trackMesh(buildPlane(`${prefix}_plate`, halfW * 1.92, yMax - yMin), cap);
    plate.material = escTornSteelMat;
    plate.position.set(0, (yMin + yMax) * 0.5, dirZ * 0.04);
    if (dirZ < 0) plate.rotation.y = Math.PI;

    const frame = trackMesh(buildBox(`${prefix}_frame`, halfW * 1.82, 0.16, 0.35), cap);
    frame.material = escTornRustMat;
    frame.position.set(0, yMax - 0.12, dirZ * 0.12);

    const ember = trackMesh(buildPlane(`${prefix}_ember`, halfW * 0.95, (yMax - yMin) * 0.42), cap);
    ember.material = escEmberMat;
    ember.position.set(0, (yMin + yMax) * 0.52, dirZ * 0.09);
    if (dirZ < 0) ember.rotation.y = Math.PI;

    for (let si = 0; si < 5; si++) {
      const sx = -halfW * 0.72 + si * (halfW * 0.36);
      const sy = MathUtils.lerp(yMin + 0.3, yMax - 0.2, ((si * 3) % 5) / 4);
      const shard = trackMesh(buildCylinder(`${prefix}_shard_${si}`, 0, 0.18, 0.58, 4), cap);
      shard.material = si % 2 === 0 ? escTornSteelMat : escTornRustMat;
      shard.rotation.x = dirZ * (Math.PI / 2);
      shard.position.set(sx, sy, dirZ * 0.25);
    }

    cap.visible = false;
    return cap;
  };

  const buildSteamVessel = (
    id: string,
    label: string,
    preferredSide: -1 | 1,
    preferredAlong: number,
    preferredLatDist: number,
    x: number,
    z: number,
    yaw: number,
    maxSpeed: number,
    phase: number,
    isPilot = false,
  ) => {
    const tug = new THREE.Group();
    tug.name = `harbor_${id}`;
    root.add(tug);
    tug.position.set(x, 0, z);
    setEulerXYZ(tug, 0, yaw, 0);
    const sc = isPilot ? 0.88 : 1.0;
    tug.scale.set(sc, sc, sc);

    const hullRollGroup = new THREE.Group();
    hullRollGroup.name = `harbor_${id}_roll`;
    tug.add(hullRollGroup);

    const bowGroup = new THREE.Group();
    bowGroup.name = `harbor_${id}_bow`;
    hullRollGroup.add(bowGroup);
    const sternGroup = new THREE.Group();
    sternGroup.name = `harbor_${id}_stern`;
    hullRollGroup.add(sternGroup);

    const upperMat = isPilot ? creamPaintMat : darkIronMat;

    const lowerBow = trackMesh(buildExtrudedShapeMesh(`harbor_${id}_lbow`, tugBowShape, 2.0), bowGroup);
    lowerBow.material = rustRedMat;
    lowerBow.rotation.x = Math.PI / 2;
    bakeTransform(lowerBow);
    lowerBow.position.y = 0.6;

    const upperBow = trackMesh(buildExtrudedShapeMesh(`harbor_${id}_ubow`, tugBowShape, 1.8), bowGroup, true);
    upperBow.material = upperMat;
    upperBow.rotation.x = Math.PI / 2;
    bakeTransform(upperBow);
    upperBow.position.y = 2.4;

    const deckBow = trackMesh(buildBox(`harbor_${id}_dbow`, 5.6, 0.25, 11), bowGroup);
    deckBow.material = buffFunnelMat;
    deckBow.position.set(0, 2.52, -5.5);

    const cabin = trackMesh(buildBox(`harbor_${id}_cabin`, 3.4, 2.6, 5.2), bowGroup, true);
    cabin.material = creamPaintMat;
    cabin.position.set(0, 3.8, -3.2);

    const roof = trackMesh(buildBox(`harbor_${id}_roof`, 3.9, 0.28, 5.8), bowGroup);
    roof.material = darkIronMat;
    roof.position.set(0, 5.2, -3.2);

    const mast = trackMesh(buildCylinder(`harbor_${id}_mast`, 0.08, 0.14, 9.2, 8), bowGroup);
    mast.material = buffFunnelMat;
    mast.position.set(0, 7.2, -6.4);

    const tugLamp = trackMesh(buildSphere(`harbor_${id}_lamp`, 0.24, 8, 8), bowGroup);
    tugLamp.material = warmLanternMat;
    tugLamp.position.set(0, 11.4, -6.4);

    const bowCap = buildEscortCap(`harbor_${id}_bcap`, 3.45, -1.35, 2.55, 1);
    bowGroup.add(bowCap);

    // Stern half
    const lowerStern = trackMesh(buildExtrudedShapeMesh(`harbor_${id}_lstern`, tugSternShape, 2.0), sternGroup);
    lowerStern.material = rustRedMat;
    lowerStern.rotation.x = Math.PI / 2;
    bakeTransform(lowerStern);
    lowerStern.position.y = 0.6;

    const upperStern = trackMesh(buildExtrudedShapeMesh(`harbor_${id}_ustern`, tugSternShape, 1.8), sternGroup, true);
    upperStern.material = upperMat;
    upperStern.rotation.x = Math.PI / 2;
    bakeTransform(upperStern);
    upperStern.position.y = 2.4;

    const deckStern = trackMesh(buildBox(`harbor_${id}_dstern`, 5.6, 0.25, 11), sternGroup);
    deckStern.material = buffFunnelMat;
    deckStern.position.set(0, 2.52, 5.5);

    const funnel = trackMesh(buildCylinder(`harbor_${id}_funnel`, 0.68, 0.78, 6.2, 16), sternGroup, true);
    funnel.material = isPilot ? rustRedMat : buffFunnelMat;
    funnel.position.set(0, 5.8, 2.2);
    funnel.rotation.x = 0.08;

    const funnelCap = trackMesh(buildCylinder(`harbor_${id}_fcap`, 0.7, 0.7, 1.3, 16), sternGroup);
    funnelCap.material = darkIronMat;
    funnelCap.position.set(0, 8.4, 2.4);
    funnelCap.rotation.x = 0.08;

    const sternCap = buildEscortCap(`harbor_${id}_scap`, 3.45, -1.35, 2.55, -1);
    sternGroup.add(sternCap);

    escorts.push({
      id,
      kind: isPilot ? 'pilot' : 'tug',
      label,
      preferredSide,
      preferredAlong,
      preferredLatDist,
      group: tug,
      hullRollGroup,
      bowGroup,
      sternGroup,
      bowCap,
      sternCap,
      oars: [],
      lanternMesh: tugLamp,
      initX: x,
      initZ: z,
      initYaw: yaw,
      x,
      z,
      yaw,
      roll: 0,
      curSpeed: 0,
      maxSpeed,
      radius: isPilot ? 6.2 : 7.0,
      phase,
      aiState: 'standby_flank',
      status: 'active',
      sinkElapsed: 0,
      broken: false,
      listDir: escorts.length % 2 === 0 ? 1 : -1,
    });
  };

  buildSteamVessel('tug_port_fwd', 'HARBOR ESCORT TUG HECTOR', -1, -78, 44, -240, -210, 0.03, 9.5, 0.4, false);
  buildSteamVessel('tug_port_aft', 'HARBOR ESCORT TUG NEPTUNE', -1, 68, 46, -68, -220, 0.02, 9.2, 1.8, false);
  buildSteamVessel('pilot_cutter', 'SOUTHAMPTON PILOT CUTTER', 1, -118, 44, 44, -224, -0.04, 10.6, 1.2, true);
  buildSteamVessel('tug_stbd_fwd', 'HARBOR ESCORT TUG VULCAN', 1, -48, 42, 41, -295, -0.03, 9.8, 2.3, false);

  // Floating Wooden Harbor Lifeboats
  const hBoatBowShape = new Shape2D();
  hBoatBowShape.moveTo(-1.55, 0);
  hBoatBowShape.lineTo(1.55, 0);
  hBoatBowShape.quadraticCurveTo(1.45, -2.5, 0, -4.6, 10);
  hBoatBowShape.quadraticCurveTo(-1.45, -2.5, -1.55, 0, 10);
  hBoatBowShape.closePath();

  const hBoatSternShape = new Shape2D();
  hBoatSternShape.moveTo(-1.55, 0);
  hBoatSternShape.quadraticCurveTo(-1.45, 2.6, 0, 4.6, 10);
  hBoatSternShape.quadraticCurveTo(1.45, 2.6, 1.55, 0, 10);
  hBoatSternShape.lineTo(-1.55, 0);
  hBoatSternShape.closePath();

  const harborBoatSpecs: Array<{
    id: string;
    label: string;
    side: -1 | 1;
    along: number;
    lat: number;
    x: number;
    z: number;
    yaw: number;
  }> = [
    { id: 'harbor_lifeboat_0', label: 'PORT HARBOR CUTTER', side: -1, along: -36, lat: 46, x: -145, z: -245, yaw: 0.12 },
    { id: 'harbor_lifeboat_1', label: 'PORT CHANNEL LIFEBOAT', side: -1, along: -85, lat: 50, x: -155, z: -365, yaw: -0.08 },
    { id: 'harbor_lifeboat_2', label: 'STARBOARD HARBOR LIFEBOAT', side: 1, along: -65, lat: 48, x: 48, z: -385, yaw: 0.08 },
  ];

  for (let i = 0; i < harborBoatSpecs.length; i++) {
    const spec = harborBoatSpecs[i];
    const lb = new THREE.Group();
    lb.name = `harbor_${spec.id}`;
    root.add(lb);
    lb.position.set(spec.x, 0.2, spec.z);
    setEulerXYZ(lb, 0, spec.yaw, 0);

    const hullRollGroup = new THREE.Group();
    hullRollGroup.name = `harbor_${spec.id}_roll`;
    lb.add(hullRollGroup);

    const bowGroup = new THREE.Group();
    bowGroup.name = `harbor_${spec.id}_bow`;
    hullRollGroup.add(bowGroup);
    const sternGroup = new THREE.Group();
    sternGroup.name = `harbor_${spec.id}_stern`;
    hullRollGroup.add(sternGroup);

    const hullBow = trackMesh(buildExtrudedShapeMesh(`harbor_${spec.id}_hbow`, hBoatBowShape, 0.92), bowGroup);
    hullBow.material = creamPaintMat;
    hullBow.rotation.x = Math.PI / 2;
    bakeTransform(hullBow);
    hullBow.position.y = 0.52;

    const gunwaleBow = trackMesh(buildBox(`harbor_${spec.id}_gbow`, 2.4, 0.12, 3.2), bowGroup);
    gunwaleBow.material = buffFunnelMat;
    gunwaleBow.position.set(0, 0.52, -1.6);

    const lantern = trackMesh(buildSphere(`harbor_${spec.id}_lamp`, 0.18, 8, 8), bowGroup);
    lantern.material = warmLanternMat;
    lantern.position.set(0, 1.12, -3.2);

    const bowCap = buildEscortCap(`harbor_${spec.id}_bcap`, 1.48, -0.4, 0.56, 1);
    bowGroup.add(bowCap);

    const hullStern = trackMesh(buildExtrudedShapeMesh(`harbor_${spec.id}_hstern`, hBoatSternShape, 0.92), sternGroup);
    hullStern.material = creamPaintMat;
    hullStern.rotation.x = Math.PI / 2;
    bakeTransform(hullStern);
    hullStern.position.y = 0.52;

    const gunwaleStern = trackMesh(buildBox(`harbor_${spec.id}_gstern`, 2.4, 0.12, 3.2), sternGroup);
    gunwaleStern.material = buffFunnelMat;
    gunwaleStern.position.set(0, 0.52, 1.6);

    const sternCap = buildEscortCap(`harbor_${spec.id}_scap`, 1.48, -0.4, 0.56, -1);
    sternGroup.add(sternCap);

    const oars: THREE.Group[] = [];
    for (const s of [-1, 1]) {
      for (const oz of [-1.2, 0.8]) {
        const oar = new THREE.Group();
        oar.name = `harbor_${spec.id}_oar_${s}_${oz}`;
        (oz < 0 ? bowGroup : sternGroup).add(oar);
        oar.position.set(s * 1.25, 0.56, oz);
        const blade = trackMesh(buildCylinder(`harbor_${spec.id}_oblade_${s}_${oz}`, 0.03, 0.04, 2.8, 6), oar);
        blade.material = buffFunnelMat;
        blade.rotation.z = s * 1.15;
        blade.position.set(s * 1.1, -0.36, 0);
        oars.push(oar);
      }
    }

    escorts.push({
      id: spec.id,
      kind: 'lifeboat',
      label: spec.label,
      preferredSide: spec.side,
      preferredAlong: spec.along,
      preferredLatDist: spec.lat,
      group: lb,
      hullRollGroup,
      bowGroup,
      sternGroup,
      bowCap,
      sternCap,
      oars,
      lanternMesh: lantern,
      initX: spec.x,
      initZ: spec.z,
      initYaw: spec.yaw,
      x: spec.x,
      z: spec.z,
      yaw: spec.yaw,
      roll: 0,
      curSpeed: 0,
      maxSpeed: 5.2,
      radius: 4.2,
      phase: i * 1.7,
      aiState: 'standby_flank',
      status: 'active',
      sinkElapsed: 0,
      broken: false,
      listDir: i % 2 === 0 ? -1 : 1,
    });
  }

  // =========================================================================
  // 8. HARBOR CHANNEL BUOYS (6 BOBBING BELL BUOYS IN SOUTHAMPTON WATER)
  // =========================================================================
  const buoys: Array<{ group: THREE.Group; phase: number }> = [];
  const buoyProfile = [
    new THREE.Vector2(0.01, -0.5),
    new THREE.Vector2(1.45, 0.0),
    new THREE.Vector2(1.55, 0.55),
    new THREE.Vector2(0.65, 0.9),
    new THREE.Vector2(0.45, 1.8),
    new THREE.Vector2(0.1, 2.9),
  ];
  const portBuoyMat = trackMat(makePBR('harbor_portBuoy', { color: 0xb43025, roughness: 0.52, metallic: 0.25 }));
  const stbdBuoyMat = trackMat(makePBR('harbor_stbdBuoy', { color: 0x246b4c, roughness: 0.52, metallic: 0.25 }));

  for (const bz of [-255, -355, -455]) {
    for (const side of [-1, 1]) {
      const bGroup = new THREE.Group();
      bGroup.name = `harbor_buoy_${side}_${bz}`;
      root.add(bGroup);
      bGroup.position.set(side < 0 ? -388 : 58, 0.15, bz);
      const hull = trackMesh(buildLatheMesh(`harbor_buoyHull_${side}_${bz}`, buoyProfile, 12), bGroup);
      hull.material = side < 0 ? portBuoyMat : stbdBuoyMat;

      const cage = trackMesh(buildCylinder(`harbor_buoyCage_${side}_${bz}`, 0.32, 0.36, 0.75, 8), bGroup);
      cage.material = darkIronMat;
      cage.position.y = 3.2;

      const beacon = trackMesh(buildSphere(`harbor_buoyLamp_${side}_${bz}`, 0.24, 10, 10), bGroup);
      beacon.material = warmLanternMat;
      beacon.position.y = 3.7;

      buoys.push({ group: bGroup, phase: bz * 0.03 + side });
    }
  }

  // =========================================================================
  // 9. STONE BREAKWATER ARMS & CALSHOT-STYLE LIGHTHOUSES AT WIDENED 488M HARBOR MOUTH
  // =========================================================================
  const beaconRotors: THREE.Group[] = [];
  const towerProfile = [
    new THREE.Vector2(4.2, 0),
    new THREE.Vector2(3.5, 6),
    new THREE.Vector2(2.8, 16),
    new THREE.Vector2(3.3, 16.6),
    new THREE.Vector2(3.3, 17.6),
  ];
  for (const side of [-1, 1]) {
    const lhX = side < 0 ? -410 : 78;
    const mole = trackMesh(buildBox(`harbor_mole_${side}`, 260, 7.5, 18), root, false, true);
    mole.material = graniteMat;
    mole.position.set(lhX + side * 130, 1.6, -515);
    mole.rotation.y = side * -0.14;

    const head = trackMesh(buildCylinder(`harbor_lhHead_${side}`, 13.5, 15.2, 8.2, 20), root);
    head.material = copingStoneMat;
    head.position.set(lhX, 1.8, -497);

    const tower = trackMesh(buildLatheMesh(`harbor_lhTower_${side}`, towerProfile, 20), root, true);
    tower.material = creamPaintMat;
    tower.position.set(lhX, 5.8, -497);

    const band = trackMesh(buildCylinder(`harbor_lhBand_${side}`, 3.05, 3.25, 3.6, 20), root);
    band.material = rustRedMat;
    band.position.set(lhX, 17.0, -497);

    const lantern = trackMesh(buildCylinder(`harbor_lhLantern_${side}`, 2.1, 2.1, 3.1, 14), root);
    lantern.material = warmLanternMat;
    lantern.position.set(lhX, 24.8, -497);

    const dome = trackMesh(buildCylinder(`harbor_lhDome_${side}`, 0, 2.5, 2.2, 16), root);
    dome.material = darkIronMat;
    dome.position.set(lhX, 27.3, -497);

    const rotor = new THREE.Group();
    rotor.name = `harbor_lhRotor_${side}`;
    root.add(rotor);
    rotor.position.set(lhX, 24.8, -497);
    const beamMesh = trackMesh(buildCylinder(`harbor_lhBeam_${side}`, 0, 6.5, 68, 16, true), rotor);
    beamMesh.material = beaconConeMat;
    beamMesh.position.set(0, -34, 0);
    bakeTransform(beamMesh);
    beamMesh.rotation.x = Math.PI / 2;
    bakeTransform(beamMesh);
    beaconRotors.push(rotor);
  }

  // =========================================================================
  // 10. SCULPTED HAMPSHIRE COASTLINE, CRAGGY CLIFFS & GREEN HEADLANDS
  // =========================================================================
  const shoreHills: Array<[number, number, number, number, number, boolean]> = [
    [175, -390, 95, 26, 175, false],
    [195, -140, 115, 32, 230, false],
    [185, 110, 110, 28, 220, false],
    [175, 320, 130, 26, 170, false],
    [-565, -390, 140, 34, 210, true],
    [-595, -110, 160, 38, 280, false],
    [-580, 170, 145, 30, 240, true],
    [-190, 420, 320, 32, 140, false],
  ];
  for (let hi = 0; hi < shoreHills.length; hi++) {
    const [hx, hz, rx, ry, rz, rocky] = shoreHills[hi];
    const geo = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.56);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let vi = 0; vi < pos.count; vi++) {
      const vx = pos.getX(vi);
      const vy = pos.getY(vi);
      const vz = pos.getZ(vi);
      const ridge =
        Math.sin(vx * 4.3 + hi * 1.7) * Math.cos(vz * 3.8 + hi) * (rocky ? 0.22 : 0.11) +
        Math.sin((vx + vz) * 7.1 + hi * 2.3) * (rocky ? 0.12 : 0.05);
      const scaleRadial = 1 + ridge * Math.min(1, vy * 2.2);
      const cragY = vy + Math.max(0, ridge * 0.35) * (vy > 0.15 ? 1 : 0);
      pos.setXYZ(vi, vx * scaleRadial, cragY, vz * scaleRadial);
    }
    geo.computeVertexNormals();
    const hill = trackMesh(new THREE.Mesh(geo, rocky ? headlandRockMat : greenHillMat), root, false, true);
    hill.name = `harbor_hill_${hi}`;
    hill.position.set(hx, -2, hz);
    hill.scale.set(rx, ry, rz);
  }

  // Pre-allocated collision arrays
  const circleObstacles: HarborCircleObstacle[] = [];
  for (const e of escorts) {
    circleObstacles.push({
      id: e.id,
      kind: e.kind,
      x: e.x,
      z: e.z,
      radius: e.radius,
      label: e.label,
      active: true,
    });
  }
  for (let i = 0; i < buoys.length; i++) {
    const b = buoys[i];
    circleObstacles.push({
      id: `buoy_${i}`,
      kind: 'buoy',
      x: b.group.position.x,
      z: b.group.position.z,
      radius: 2.2,
      label: 'CHANNEL BELL BUOY',
      active: true,
    });
  }
  for (const side of [-1, 1]) {
    circleObstacles.push({
      id: side < 0 ? 'pier_port' : 'pier_stbd',
      kind: 'pier',
      x: side < 0 ? -410 : 78,
      z: -497,
      radius: 15.2,
      label: 'BREAKWATER LIGHTHOUSE PIER',
      active: true,
    });
  }

  const companionHullBoxes: Record<VesselId, HarborBoxObstacle> = {
    titanic: { id: 'companion_titanic', kind: 'quay', minX: 99999, maxX: 99999, minZ: 99999, maxZ: 99999, label: 'MOORED LINER RMS TITANIC' },
    britannic: { id: 'companion_britannic', kind: 'quay', minX: -123.3, maxX: -94.7, minZ: -72, maxZ: 193, label: 'MOORED LINER HMHS BRITANNIC' },
    concordia: { id: 'companion_concordia', kind: 'quay', minX: -237.25, maxX: -201.75, minZ: -78, maxZ: 208, label: 'MOORED LINER COSTA CONCORDIA' },
  };

  const boxObstacles: HarborBoxObstacle[] = [
    { id: 'berth_44_quay', kind: 'quay', minX: 19.3, maxX: 92.0, minZ: -176.0, maxZ: 258.0, label: 'BERTH 44 GRANITE QUAY WALL' },
    { id: 'central_pier_quay', kind: 'quay', minX: -196.0, maxX: -128.4, minZ: -188.0, maxZ: 258.0, label: 'BERTH 40 / 38 CENTRAL QUAY PIER' },
    { id: 'far_west_quay', kind: 'quay', minX: -336.0, maxX: -272.0, minZ: -188.0, maxZ: 258.0, label: 'BERTH 38 / 36 CRUISE QUAY PIER' },
    { id: 'outer_west_quay', kind: 'quay', minX: -466.0, maxX: -406.0, minZ: -188.0, maxZ: 258.0, label: 'BERTH 36 OUTER QUAY WALL' },
    { id: 'north_basin_quay', kind: 'quay', minX: -466.0, maxX: 92.0, minZ: 255.8, maxZ: 318.0, label: 'WHITE STAR DOCK NORTH QUAY' },
    { id: 'breakwater_port', kind: 'breakwater', minX: -670, maxX: -410, minZ: -535, maxZ: -496, label: 'PORT STONE BREAKWATER MOLE' },
    { id: 'breakwater_stbd', kind: 'breakwater', minX: 78, maxX: 340, minZ: -535, maxZ: -496, label: 'STARBOARD STONE BREAKWATER MOLE' },
    companionHullBoxes.titanic,
    companionHullBoxes.britannic,
    companionHullBoxes.concordia,
  ];

  const setActiveVessel = (vesselId: VesselId) => {
    activeVesselId = vesselId;
    for (const id of VESSEL_ORDER) {
      const isActive = id === vesselId;
      companionRigs[id].root.visible = !isActive;
      const spec = VESSEL_SPECS[id];
      const box = companionHullBoxes[id];
      if (isActive) {
        box.minX = 99999;
        box.maxX = 99999;
        box.minZ = 99999;
        box.maxZ = 99999;
      } else {
        box.minX = spec.berthX - spec.halfBeam;
        box.maxX = spec.berthX + spec.halfBeam;
        box.minZ = spec.bowZ + 2;
        box.maxZ = spec.sternZ - 2;
      }
      berthMoorings[id].hawsers.visible = true;
      berthMoorings[id].gangways.position.x = 0;
      berthMoorings[id].gangways.visible = true;
    }
  };
  setActiveVessel('titanic');

  const triggerEscortStrike = (id: string): EscortBreakEvent | null => {
    const idx = escorts.findIndex((item) => item.id === id);
    if (idx === -1) return null;
    const e = escorts[idx];
    if (e.status !== 'active') return null;
    e.status = 'sinking';
    e.sinkElapsed = 0;
    e.broken = false;
    e.bowCap.visible = false;
    e.sternCap.visible = false;
    circleObstacles[idx].active = false;
    const ev: EscortBreakEvent = { id: e.id, label: e.label, x: e.x, z: e.z, phase: 'impact' };
    pendingBreakEvents.push(ev);
    return ev;
  };

  const resetEscorts = () => {
    for (const id of VESSEL_ORDER) {
      berthMoorings[id].gangways.position.x = 0;
      berthMoorings[id].hawsers.visible = true;
    }
    pendingBreakEvents.length = 0;
    for (let i = 0; i < escorts.length; i++) {
      const e = escorts[i];
      e.x = e.initX;
      e.z = e.initZ;
      e.yaw = e.initYaw;
      e.roll = 0;
      e.curSpeed = 0;
      e.aiState = 'standby_flank';
      e.status = 'active';
      e.sinkElapsed = 0;
      e.broken = false;
      e.group.visible = true;
      e.group.position.set(e.x, e.kind === 'lifeboat' ? 0.2 : 0, e.z);
      setEulerXYZ(e.group, 0, e.yaw, 0);
      e.hullRollGroup.rotation.set(0, 0, 0);
      e.bowGroup.position.set(0, 0, 0);
      e.bowGroup.rotation.set(0, 0, 0);
      e.sternGroup.position.set(0, 0, 0);
      e.sternGroup.rotation.set(0, 0, 0);
      e.bowCap.visible = false;
      e.sternCap.visible = false;
      circleObstacles[i].x = e.x;
      circleObstacles[i].z = e.z;
      circleObstacles[i].active = true;
    }
  };

  const stepVesselConsciousness = (
    simTime: number,
    shipX: number,
    shipZ: number,
    headingRad: number,
    speedKnots: number,
    floodingPct: number,
    dt: number,
    escortActive: boolean,
  ) => {
    const fwdX = Math.sin(headingRad);
    const fwdZ = -Math.cos(headingRad);
    const rightX = Math.cos(headingRad);
    const rightZ = Math.sin(headingRad);
    const shipWorldSpd = speedKnots * 2.15;

    for (let i = 0; i < escorts.length; i++) {
      const e = escorts[i];

      if (e.status === 'sunk') {
        e.group.visible = false;
        continue;
      }

      if (e.status === 'sinking') {
        if (dt > 0) {
          e.sinkElapsed += dt;
          e.curSpeed = MathUtils.damp(e.curSpeed, 0, 1.4, dt);
          e.x -= Math.sin(e.yaw) * e.curSpeed * dt;
          e.z -= Math.cos(e.yaw) * e.curSpeed * dt;
        }
        const p = MathUtils.clamp(e.sinkElapsed / 9.5, 0, 1);
        const dropScale = e.kind === 'lifeboat' ? 0.45 : 1.0;

        if (p < 0.24) {
          const s1 = p / 0.24;
          const pitch = MathUtils.lerp(0, -0.34, s1);
          const dropY = MathUtils.lerp(0, -1.6 * dropScale, s1);
          e.hullRollGroup.rotation.z = e.listDir * MathUtils.lerp(0.08, 0.28, s1);
          e.bowGroup.position.y = dropY;
          e.bowGroup.rotation.x = pitch;
          e.sternGroup.position.y = dropY;
          e.sternGroup.rotation.x = pitch;
        } else {
          if (!e.broken) {
            e.broken = true;
            e.bowCap.visible = true;
            e.sternCap.visible = true;
            pendingBreakEvents.push({ id: e.id, label: e.label, x: e.x, z: e.z, phase: 'snap' });
          }
          const bowT = MathUtils.clamp((p - 0.24) / 0.45, 0, 1);
          e.bowGroup.rotation.x = MathUtils.lerp(-0.34, -0.92, bowT);
          e.bowGroup.position.y = MathUtils.lerp(-1.6 * dropScale, -16.5 * dropScale, bowT);

          if (p < 0.42) {
            const settleT = (p - 0.24) / 0.18;
            e.sternGroup.rotation.x = MathUtils.lerp(-0.34, -0.06, settleT);
            e.sternGroup.position.y = MathUtils.lerp(-1.6 * dropScale, -0.6 * dropScale, settleT);
          } else {
            const plungeT = (p - 0.42) / 0.58;
            e.sternGroup.rotation.x = MathUtils.lerp(-0.06, -1.32, plungeT);
            e.sternGroup.position.y = MathUtils.lerp(-0.6 * dropScale, -22.0 * dropScale, Math.pow(plungeT, 1.15));
          }
          e.hullRollGroup.rotation.z = e.listDir * MathUtils.lerp(0.28, 0.14, (p - 0.24) / 0.76);
        }

        e.group.position.set(e.x, e.kind === 'lifeboat' ? 0.2 : 0, e.z);
        setEulerXYZ(e.group, 0, e.yaw, 0);
        if (p >= 1) {
          e.status = 'sunk';
          e.group.visible = false;
        }
        continue;
      }

      if (escortActive && dt > 0) {
        const dxShip = e.x - shipX;
        const dzShip = e.z - shipZ;
        const alongAhead = dxShip * fwdX + dzShip * fwdZ;
        const lateral = dxShip * rightX + dzShip * rightZ;

        let chosenSide: -1 | 1 = e.preferredSide;
        if (Math.abs(lateral) < 22 && alongAhead > -205 && alongAhead < 145) {
          chosenSide = lateral >= 0 ? 1 : -1;
        }
        const inBerthSlip = e.z > -172 && shipZ > -145;
        if (chosenSide === 1 && inBerthSlip && e.x < 19) {
          chosenSide = -1;
        }

        const flankDist = floodingPct > 20 ? 54 : e.preferredLatDist;
        let targetAlong = e.preferredAlong;
        if (e.kind === 'lifeboat') {
          targetAlong = MathUtils.clamp(-alongAhead, -95, 65);
        }

        let targetX = shipX + fwdX * -targetAlong + rightX * (chosenSide * flankDist);
        let targetZ = shipZ + fwdZ * -targetAlong + rightZ * (chosenSide * flankDist);

        if (e.preferredSide === 1 && shipZ > -135) {
          targetX = Math.max(targetX, 38);
          targetZ = Math.min(targetZ, -195);
        }
        if (e.z < -535 && e.kind !== 'lifeboat') {
          targetX = e.x + chosenSide * 45;
          targetZ = e.z - 60;
        }

        let steerX = targetX - e.x;
        let steerZ = targetZ - e.z;
        const distToSlot = Math.hypot(steerX, steerZ) || 1;
        steerX /= distToSlot;
        steerZ /= distToSlot;

        let desiredSpeed = e.kind === 'lifeboat' ? 2.4 : Math.min(e.maxSpeed, Math.max(3.2, Math.abs(shipWorldSpd) * 0.92 + 2.2));
        if (shipZ > -12 && Math.abs(speedKnots) < 0.6) {
          desiredSpeed = e.kind === 'lifeboat' ? 1.4 : 0.8;
        }
        e.aiState = floodingPct > 20 ? 'rescue_standby' : distToSlot < 22 ? 'escort_flank' : 'standby_flank';

        const predAlong = alongAhead - shipWorldSpd * 3.5;
        const nearHullLong = alongAhead > -208 && alongAhead < 105;
        const nearPredLong = predAlong > -208 && predAlong < 125;
        const safeLat = 15.5 + e.radius + 9.0;
        let avoidX = 0;
        let avoidZ = 0;

        if ((nearHullLong || nearPredLong) && Math.abs(lateral) < safeLat) {
          e.aiState = 'evade_titanic';
          const awaySide = lateral >= 0 ? 1 : -1;
          const urgency = 1 - Math.abs(lateral) / safeLat;
          avoidX += rightX * awaySide * (2.6 + urgency * 3.8);
          avoidZ += rightZ * awaySide * (2.6 + urgency * 3.8);
          if (alongAhead > 55) {
            avoidX += fwdX * 1.4;
            avoidZ += fwdZ * 1.4;
          }
          desiredSpeed = e.maxSpeed * 1.32;
        }

        let struckObject = false;
        for (let b = 0; b < boxObstacles.length; b++) {
          const box = boxObstacles[b];
          const cx = MathUtils.clamp(e.x, box.minX, box.maxX);
          const cz = MathUtils.clamp(e.z, box.minZ, box.maxZ);
          const vx = e.x - cx;
          const vz = e.z - cz;
          const d = Math.hypot(vx, vz);
          if (d < e.radius * 0.72) {
            struckObject = true;
            break;
          }
          const margin = e.radius + 7.5;
          if (d < margin) {
            e.aiState = 'evade_obstacle';
            const nx = d > 0.01 ? vx / d : 0;
            const nz = d > 0.01 ? vz / d : -1;
            const push = ((margin - d) / margin) * 3.8;
            avoidX += nx * push;
            avoidZ += nz * push;
          }
        }

        if (!struckObject) {
          for (let j = 0; j < circleObstacles.length; j++) {
            if (j === i) continue;
            const ob = circleObstacles[j];
            if (!ob.active) continue;
            const vx = e.x - ob.x;
            const vz = e.z - ob.z;
            const d = Math.hypot(vx, vz);
            if (d < (e.radius + ob.radius) * 0.78) {
              struckObject = true;
              if (j < escorts.length) {
                triggerEscortStrike(ob.id);
              }
              break;
            }
            const minSep = e.radius + ob.radius + 11.0;
            if (d < minSep && d > 0.01) {
              const push = ((minSep - d) / minSep) * 2.8;
              avoidX += (vx / d) * push;
              avoidZ += (vz / d) * push;
            }
          }
        }

        if (struckObject) {
          triggerEscortStrike(e.id);
          continue;
        }

        const combX = steerX * 0.85 + avoidX;
        const combZ = steerZ * 0.85 + avoidZ;
        const combLen = Math.hypot(combX, combZ);

        if (combLen > 0.05) {
          const targetYaw = Math.atan2(-combX, -combZ);
          let dy = targetYaw - e.yaw;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          const turnRate = e.aiState === 'evade_titanic' ? 2.6 : 1.45;
          const yawDelta = MathUtils.clamp(dy, -turnRate * dt, turnRate * dt);
          e.yaw += yawDelta;
          e.roll = MathUtils.damp(e.roll, (-yawDelta / Math.max(dt, 0.01)) * 0.045, 5, dt);
        }

        e.curSpeed = MathUtils.damp(e.curSpeed, desiredSpeed, 2.2, dt);
        e.x -= Math.sin(e.yaw) * e.curSpeed * dt;
        e.z -= Math.cos(e.yaw) * e.curSpeed * dt;

        if (e.z > -184 && e.z < 258) {
          if (e.x >= -128.4 && e.x < 19.3) {
            e.x = MathUtils.clamp(e.x, -120, 12.5);
          } else if (e.x <= -196.0 && e.x > -272.0) {
            e.x = MathUtils.clamp(e.x, -264, -203);
          } else if (e.x <= -336.0 && e.x > -406.0) {
            e.x = MathUtils.clamp(e.x, -398, -342);
          } else {
            e.z = -194;
          }
        }
        e.group.position.x = e.x;
        e.group.position.z = e.z;
      }

      const bobAmp = e.kind === 'lifeboat' ? 0.14 : 0.16;
      e.group.position.y = (e.kind === 'lifeboat' ? 0.22 : 0) + Math.sin(simTime * 1.5 + e.phase) * bobAmp;
      setEulerXYZ(e.group, Math.cos(simTime * 0.9 + e.phase) * 0.015, e.yaw, 0);
      e.hullRollGroup.rotation.z = e.roll + Math.sin(simTime * 1.1 + e.phase) * 0.025;

      if (e.oars.length > 0) {
        const oarSpeed = e.aiState === 'evade_titanic' ? 4.2 : 2.3;
        const oarSweep = Math.sin(simTime * oarSpeed + e.phase) * 0.3;
        for (let oi = 0; oi < e.oars.length; oi++) {
          e.oars[oi].rotation.y = oarSweep;
        }
      }

      circleObstacles[i].x = e.x;
      circleObstacles[i].z = e.z;
    }
  };

  const stepDockCrowdConsciousness = (
    simTime: number,
    shipX: number,
    shipZ: number,
  ) => {
    const departed = shipZ < -12;
    for (let i = 0; i < DOCK_CROWD_COUNT; i++) {
      const c = dockCitizens[i];
      const pace = departed ? 0.35 : 0.7;
      c.z = c.baseZ + Math.sin(simTime * pace + c.phase) * c.walkRange;
      c.x = c.baseX + Math.cos(simTime * 0.45 + c.phase) * 0.35;

      const targetYaw = Math.atan2(shipX - c.x, shipZ + 35 - c.z);
      c.yaw = targetYaw;

      const py = 4.35 + Math.abs(Math.sin(simTime * 2.2 + c.phase)) * 0.015;
      writeInstanceMatrix(citTorsoSlot, i, c.x, py, c.z, 0, c.yaw, 0);
      writeInstanceMatrix(citLegsSlot, i, c.x, py, c.z, 0, c.yaw, 0);
      writeInstanceMatrix(citHeadSlot, i, c.x, py, c.z, 0, c.yaw, 0);

      const waveFreq = departed ? 5.2 : 2.6;
      const armPitch = -Math.PI * 0.78 + Math.sin(simTime * waveFreq * c.waveEagerness + c.phase) * 0.42;
      writeInstanceMatrix(
        citArmSlot,
        i,
        c.x - Math.cos(c.yaw) * 0.21,
        5.75,
        c.z + Math.sin(c.yaw) * 0.21,
        armPitch,
        c.yaw,
        0.18,
      );
    }
    commitInstanceMatrices(citTorsoSlot, DOCK_CROWD_COUNT);
    commitInstanceMatrices(citLegsSlot, DOCK_CROWD_COUNT);
    commitInstanceMatrices(citHeadSlot, DOCK_CROWD_COUNT);
    commitInstanceMatrices(citArmSlot, DOCK_CROWD_COUNT);
  };

  const update = (
    simTime: number,
    shipX: number,
    shipZ: number,
    headingRad: number,
    speedKnots: number,
    floodingPct: number,
    nightMix: number,
    dt = 0.016,
    escortActive = false,
  ) => {
    const activeBerth = berthMoorings[activeVesselId];
    const castOff = shipZ < -12 || Math.abs(speedKnots) > 0.65;
    activeBerth.hawsers.visible = shipZ > -16;
    const gangwayTargetX = castOff ? activeBerth.retractDeltaX : 0;
    activeBerth.gangways.position.x = MathUtils.damp(
      activeBerth.gangways.position.x,
      gangwayTargetX,
      3.2,
      Math.max(dt, 0.016),
    );

    const compLight = MathUtils.lerp(0.05, 0.88, MathUtils.smoothstep(nightMix, 0.25, 0.88));
    for (let vi = 0; vi < VESSEL_ORDER.length; vi++) {
      const id = VESSEL_ORDER[vi];
      const rig = companionRigs[id];
      if (!rig.root.visible) continue;
      rig.root.position.y = Math.sin(simTime * 0.82 + vi * 1.4) * 0.11;
      rig.root.rotation.z = Math.sin(simTime * 0.68 + vi * 1.1) * 0.007;
      rig.setPowerLevel(compLight);
    }

    stepVesselConsciousness(simTime, shipX, shipZ, headingRad, speedKnots, floodingPct, dt, escortActive);
    stepDockCrowdConsciousness(simTime, shipX, shipZ);

    for (const buoy of buoys) {
      buoy.group.position.y = 0.12 + Math.sin(simTime * 1.9 + buoy.phase) * 0.22;
      setEulerXYZ(
        buoy.group,
        Math.cos(simTime * 1.3 + buoy.phase) * 0.07,
        0,
        Math.sin(simTime * 1.5 + buoy.phase) * 0.09,
      );
    }

    beaconRotors.forEach((r, idx) => {
      r.rotation.y = simTime * (idx === 0 ? 0.55 : -0.55) + idx * 1.8;
    });
    beaconConeMat.opacity = 0.04 + nightMix * 0.16;
    warmLanternMat.emissiveIntensity = 0.06 + nightMix * 0.8;
  };

  const dispose = () => {
    for (const id of VESSEL_ORDER) {
      companionRigs[id].dispose();
    }
    const geos = new Set<THREE.BufferGeometry>();
    for (const g of extraGeos) geos.add(g);
    for (const m of meshes) geos.add(m.geometry);
    for (const im of instancedMeshes) {
      geos.add(im.geometry);
      im.dispose();
    }
    geos.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    ownTextures.forEach((t) => t.dispose());
    root.removeFromParent();
  };

  const escortStatesOut: Array<{
    id: string;
    status: 'active' | 'sinking' | 'sunk';
    x: number;
    z: number;
    radius: number;
    label: string;
  }> = escorts.map((e) => ({
    id: e.id,
    status: e.status,
    x: e.x,
    z: e.z,
    radius: e.radius,
    label: e.label,
  }));

  const getEscortStates = () => {
    for (let i = 0; i < escorts.length; i++) {
      escortStatesOut[i].status = escorts[i].status;
      escortStatesOut[i].x = escorts[i].x;
      escortStatesOut[i].z = escorts[i].z;
    }
    return escortStatesOut;
  };

  const outBreakEvents: EscortBreakEvent[] = [];
  const consumeBreakEvents = (): readonly EscortBreakEvent[] => {
    outBreakEvents.length = 0;
    for (let i = 0; i < pendingBreakEvents.length; i++) {
      outBreakEvents.push(pendingBreakEvents[i]);
    }
    pendingBreakEvents.length = 0;
    return outBreakEvents;
  };

  return {
    root,
    hawsersGroup,
    shadowCasters,
    setActiveVessel,
    update,
    resetEscorts,
    triggerEscortStrike,
    consumeBreakEvents,
    getEscortStates,
    getCircleObstacles: () => circleObstacles,
    getBoxObstacles: () => boxObstacles,
    dispose,
  };
}
