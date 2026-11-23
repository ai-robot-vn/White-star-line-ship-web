import * as THREE from 'three';
import { ParticlePool, sampleOceanWaveHeight } from './oceanAndSky';
import { SoundEngine } from './audio';
import {
  bakeAndMergeMeshes,
  buildBox,
  buildCylinder,
  buildExtrudedShapeMesh,
  buildLatheMesh,
  buildTorusXY,
  makePBR,
  makeUnlitColorMat,
  MathUtils,
  setEulerXYZ,
  Shape2D,
} from './threeHelpers';
import { CraftMode, RadarBlip, VESSEL_SPECS, VesselId } from './types';

export interface ReefEntity {
  id: string;
  group: THREE.Group;
  x: number;
  z: number;
  radius: number;
  height: number;
  warned: boolean;
  nearMissAwarded: boolean;
  hitCooldown: number;
  hasBuoy: boolean;
  buoyLightMat: THREE.MeshBasicMaterial | null;
}

interface PatrolBoatEntity {
  group: THREE.Group;
  redBar: THREE.Mesh;
  blueBar: THREE.Mesh;
  redMat: THREE.MeshBasicMaterial;
  blueMat: THREE.MeshBasicMaterial;
  propL: THREE.Object3D;
  propR: THREE.Object3D;
  active: boolean;
  x: number;
  z: number;
  vx: number;
  vz: number;
  headingRad: number;
  speed: number;
  roll: number;
  hitCooldown: number;
}

interface ChopperEntity {
  group: THREE.Group;
  mainRotor: THREE.Object3D;
  tailRotor: THREE.Object3D;
  searchBeam: THREE.Mesh;
  active: boolean;
  x: number;
  y: number;
  z: number;
  orbitAngle: number;
}

interface MissionMarker {
  group: THREE.Group;
  ring: THREE.Mesh;
  beam: THREE.Mesh;
  x: number;
  z: number;
  collected: boolean;
}

export interface SandboxUpdateInput {
  dt: number;
  worldDt: number; // scaled by Captain's Focus slow-mo
  simTime: number;
  vesselId: VesselId;
  shipX: number;
  shipZ: number;
  shipHeadingRad: number;
  shipKnots: number;
  shipHalfBeam: number;
  inHarborZone: boolean;
  heldKeys: Set<string>;
  submarines?: ReadonlyArray<{ x: number; z: number; sunk: boolean }>;
  icebergs?: ReadonlyArray<{ x: number; z: number }>;
}

export interface SandboxUpdateResult {
  scoreDelta: number;
  nearMissDelta: number;
  warningText: string | null;
  warningSide: number;
  eventText: string | null;
  reefHit: {
    hitX: number;
    hitZ: number;
    nx: number;
    nz: number;
    overlap: number;
    rawDmg: number;
    floodJump: number;
    isBow: boolean;
    sideSign: number;
  } | null;
  patrolImpactOnShip: {
    hitX: number;
    hitZ: number;
    nx: number;
    nz: number;
  } | null;
}

export type MissionType = 'slalom' | 'rescue' | 'daredevil' | 'evade';

const MISSION_ORDER: MissionType[] = ['slalom', 'rescue', 'daredevil', 'evade'];

export class GtaSandboxSystem {
  private readonly scene: THREE.Scene;
  private readonly particles: ParticlePool;
  private readonly sound: SoundEngine;
  private readonly isSoftwareGl: boolean;

  private readonly root = new THREE.Group();
  private readonly sharedGeos: THREE.BufferGeometry[] = [];
  private readonly sharedMats: THREE.Material[] = [];

  // Shared materials
  private readonly reefRockMat: THREE.MeshPhysicalMaterial;
  private readonly reefFoamMat: THREE.MeshBasicMaterial;
  private readonly buoyRedMat: THREE.MeshPhysicalMaterial;
  private readonly buoySteelMat: THREE.MeshPhysicalMaterial;
  private readonly whiteFiberglassMat: THREE.MeshPhysicalMaterial;
  private readonly navyAccentMat: THREE.MeshPhysicalMaterial;
  private readonly teakMat: THREE.MeshPhysicalMaterial;
  private readonly darkGlassMat: THREE.MeshPhysicalMaterial;
  private readonly chromeMat: THREE.MeshPhysicalMaterial;
  private readonly outboardMat: THREE.MeshPhysicalMaterial;
  private readonly cgOrangeMat: THREE.MeshPhysicalMaterial;
  private readonly cgDarkMat: THREE.MeshPhysicalMaterial;
  private readonly markerRingMat: THREE.MeshBasicMaterial;
  private readonly markerBeamMat: THREE.MeshBasicMaterial;
  private readonly rescueRaftMat: THREE.MeshPhysicalMaterial;

  // Reefs (Concordia signature coastal granite shoals)
  private readonly reefs: ReefEntity[] = [];
  private readonly reefAutopilotList: Array<{ x: number; z: number; radius: number }> = [];

  // Boardable Speedboat ("Leonida Scarab 38")
  private readonly speedboatGroup = new THREE.Group();
  private readonly speedboatPropL = new THREE.Group();
  private readonly speedboatPropR = new THREE.Group();
  private readonly speedboatFlameL: THREE.Mesh;
  private readonly speedboatFlameR: THREE.Mesh;
  public activeCraft: CraftMode = 'ship';
  public speedboatX = -24;
  public speedboatY = 0;
  public speedboatZ = -34;
  public speedboatVy = 0;
  public speedboatHeading = 0;
  public speedboatKnots = 0;
  private speedboatRoll = 0;
  private speedboatPitch = 0;
  public speedboatNitroPct = 100;
  private speedboatAirTime = 0;
  private speedboatWasAirborne = false;
  private speedboatSprayAccum = 0;
  private speedboatHitCooldown = 0;

  // GTA 6 Wanted & Coast Guard Pursuit
  public wantedLevel = 0;
  private heatPoints = 0;
  public wantedEvading = false;
  public wantedCooldownPct = 0;
  private evasionTimer = 0;
  private noWakeHeatCooldown = 0;
  private sirenCooldown = 0;
  private readonly patrolBoats: PatrolBoatEntity[] = [];
  private readonly chopper: ChopperEntity;

  // Cash, RP, Special Focus & Missions
  public cash = 1500;
  public rep = 0;
  public specialFocusPct = 100;
  public specialFocusActive = false;
  public stuntText: string | null = null;
  private stuntTimer = 0;

  private missionCursor = 0;
  private activeMission: MissionType | null = null;
  public activeMissionTitle: string | null = null;
  public activeMissionStep: string | null = null;
  public activeMissionTimerSec: number | null = null;
  private missionTimeLeft = 0;
  private missionProgress = 0;
  private missionTarget = 0;
  public missionBannerText: string | null = null;
  public missionBannerSub: string | null = null;
  private missionBannerTimer = 0;
  private readonly missionMarkers: MissionMarker[] = [];

  // Pre-allocated Radar Blip pool (zero GC)
  private readonly radarBlipPool: RadarBlip[] = Array.from({ length: 48 }, () => ({
    dx: 0,
    dz: 0,
    kind: 'hazard',
  }));
  private activeBlipCount = 0;

  constructor(
    scene: THREE.Scene,
    particles: ParticlePool,
    sound: SoundEngine,
    isSoftwareGl: boolean,
  ) {
    this.scene = scene;
    this.particles = particles;
    this.sound = sound;
    this.isSoftwareGl = isSoftwareGl;
    this.root.name = 'gta_sandbox_root';
    this.scene.add(this.root);

    this.reefRockMat = makePBR('reef_granite_mat', {
      color: 0x4b5159,
      roughness: 0.92,
      metallic: 0.04,
      envIntensity: 0.35,
    });
    this.reefFoamMat = makeUnlitColorMat('reef_foam_mat', 0xdbeeff, 0.48);
    this.buoyRedMat = makePBR('reef_buoy_red', {
      color: 0xd93832,
      roughness: 0.38,
      metallic: 0.12,
      clearcoat: 0.45,
    });
    this.buoySteelMat = makePBR('reef_buoy_steel', {
      color: 0x252c36,
      roughness: 0.45,
      metallic: 0.72,
    });
    this.whiteFiberglassMat = makePBR('sb_fiberglass_white', {
      color: 0xf4f7fb,
      roughness: 0.18,
      metallic: 0.06,
      clearcoat: 0.9,
      clearcoatRoughness: 0.12,
    });
    this.navyAccentMat = makePBR('sb_navy_accent', {
      color: 0x0e2a47,
      roughness: 0.22,
      metallic: 0.18,
      clearcoat: 0.85,
    });
    this.teakMat = makePBR('sb_teak_deck', {
      color: 0x8f5b34,
      roughness: 0.68,
      metallic: 0.02,
    });
    this.darkGlassMat = makePBR('sb_tinted_glass', {
      color: 0x0a1828,
      roughness: 0.08,
      metallic: 0.22,
      clearcoat: 1.0,
      alpha: 0.76,
    });
    this.chromeMat = makePBR('sb_chrome', {
      color: 0xe2e8f0,
      roughness: 0.14,
      metallic: 0.95,
      anisotropy: 0.6,
    });
    this.outboardMat = makePBR('sb_outboard_mat', {
      color: 0x1b212a,
      roughness: 0.28,
      metallic: 0.55,
      clearcoat: 0.5,
    });
    this.cgOrangeMat = makePBR('cg_orange_mat', {
      color: 0xe85925,
      roughness: 0.26,
      metallic: 0.12,
      clearcoat: 0.65,
    });
    this.cgDarkMat = makePBR('cg_dark_mat', {
      color: 0x1a2638,
      roughness: 0.35,
      metallic: 0.45,
    });
    this.markerRingMat = makeUnlitColorMat('mission_ring_mat', 0xfacc15, 0.9);
    this.markerBeamMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.rescueRaftMat = makePBR('rescue_raft_mat', {
      color: 0xf97316,
      roughness: 0.48,
      metallic: 0.05,
    });

    this.sharedMats.push(
      this.reefRockMat,
      this.reefFoamMat,
      this.buoyRedMat,
      this.buoySteelMat,
      this.whiteFiberglassMat,
      this.navyAccentMat,
      this.teakMat,
      this.darkGlassMat,
      this.chromeMat,
      this.outboardMat,
      this.cgOrangeMat,
      this.cgDarkMat,
      this.markerRingMat,
      this.markerBeamMat,
      this.rescueRaftMat,
    );

    const flames = this.buildSpeedboatMesh();
    this.speedboatFlameL = flames.flameL;
    this.speedboatFlameR = flames.flameR;
    this.root.add(this.speedboatGroup);

    for (let i = 0; i < 3; i++) {
      const pb = this.buildPatrolBoatMesh(i);
      pb.group.visible = false;
      this.root.add(pb.group);
      this.patrolBoats.push(pb);
    }

    this.chopper = this.buildChopperMesh();
    this.chopper.group.visible = false;
    this.root.add(this.chopper.group);
  }

  private trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.sharedGeos.push(g);
    return g;
  }

  private trackMat<T extends THREE.Material>(m: T): T {
    this.sharedMats.push(m);
    return m;
  }

  // =========================================================================
  // 1. SCULPTED PROCEDURAL 3D MODELS (Speedboat, CG Interceptor, Chopper, Reefs)
  // =========================================================================
  private createSteppedVHullGeometry(
    length: number,
    halfBeam: number,
    depth: number,
    chineY: number,
  ): THREE.BufferGeometry {
    // Lofted 10-station stepped-V hull with sharp bow stem, flared chines, and transom
    const stations = [
      { z: -length * 0.52, w: 0.02, keel: 0.45, chine: 0.85, gunwale: depth * 0.95 },
      { z: -length * 0.42, w: halfBeam * 0.34, keel: -0.18, chine: 0.25, gunwale: depth * 0.92 },
      { z: -length * 0.26, w: halfBeam * 0.72, keel: -0.52, chine: chineY, gunwale: depth * 0.88 },
      { z: -length * 0.05, w: halfBeam * 0.94, keel: -0.62, chine: chineY - 0.06, gunwale: depth * 0.84 },
      { z: length * 0.16, w: halfBeam, keel: -0.58, chine: chineY - 0.08, gunwale: depth * 0.80 },
      { z: length * 0.34, w: halfBeam * 0.98, keel: -0.54, chine: chineY - 0.08, gunwale: depth * 0.78 },
      { z: length * 0.48, w: halfBeam * 0.92, keel: -0.48, chine: chineY - 0.05, gunwale: depth * 0.75 },
    ];

    // Cross-section ring: 7 vertices per station:
    // 0: port gunwale, 1: port chine, 2: port strake, 3: keel, 4: stbd strake, 5: stbd chine, 6: stbd gunwale
    const cols = 7;
    const rows = stations.length;
    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];

    for (let r = 0; r < rows; r++) {
      const s = stations[r];
      const v = r / (rows - 1);
      const pts: Array<[number, number]> = [
        [-s.w, s.gunwale],
        [-s.w * 0.95, s.chine],
        [-s.w * 0.46, (s.chine + s.keel) * 0.48],
        [0, s.keel],
        [s.w * 0.46, (s.chine + s.keel) * 0.48],
        [s.w * 0.95, s.chine],
        [s.w, s.gunwale],
      ];
      for (let c = 0; c < cols; c++) {
        pos.push(pts[c][0], pts[c][1], s.z);
        uvs.push(c / (cols - 1), v);
      }
    }

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const d = (r + 1) * cols + c;
        const e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }

    // Cap stern transom
    const lastRow = (rows - 1) * cols;
    const sternCenterIdx = pos.length / 3;
    const lastS = stations[rows - 1];
    pos.push(0, (lastS.gunwale + lastS.keel) * 0.5, lastS.z);
    uvs.push(0.5, 1);
    for (let c = 0; c < cols - 1; c++) {
      idx.push(lastRow + c, sternCenterIdx, lastRow + c + 1);
    }

    // Top deck cap
    for (let r = 0; r < rows - 1; r++) {
      const lp0 = r * cols;
      const sp0 = r * cols + (cols - 1);
      const lp1 = (r + 1) * cols;
      const sp1 = (r + 1) * cols + (cols - 1);
      idx.push(lp0, sp0, lp1, sp0, sp1, lp1);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return this.trackGeo(geo);
  }

  private buildSpeedboatMesh(): { flameL: THREE.Mesh; flameR: THREE.Mesh } {
    this.speedboatGroup.name = 'leonida_scarab_speedboat';

    // 1. Stepped-V Fiberglass Hull (13.2m LOA x 3.5m Beam)
    const hullGeo = this.createSteppedVHullGeometry(13.2, 1.75, 1.55, 0.08);
    const hull = new THREE.Mesh(hullGeo, this.whiteFiberglassMat);
    this.speedboatGroup.add(hull);

    // 2. Navy Racing Hull Chine Stripe + Foredeck Accent
    const stripeShape = new Shape2D();
    stripeShape.moveTo(-1.76, 0.72);
    stripeShape.lineTo(1.76, 0.72);
    stripeShape.lineTo(1.62, 1.15);
    stripeShape.lineTo(-1.62, 1.15);
    stripeShape.closePath();
    const stripeMesh = buildExtrudedShapeMesh('sb_accent_strip', stripeShape, 9.2, 0.04);
    this.trackGeo(stripeMesh.geometry);
    stripeMesh.material = this.navyAccentMat;
    stripeMesh.position.set(0, 0.14, -3.1);
    this.speedboatGroup.add(stripeMesh);

    // 3. Recessed Teak Cockpit Sole + Aft Sunpad
    const teakDeck = buildBox('sb_teak_cockpit', 2.45, 0.14, 6.2);
    this.trackGeo(teakDeck.geometry);
    teakDeck.material = this.teakMat;
    teakDeck.position.set(0, 1.16, 2.3);
    this.speedboatGroup.add(teakDeck);

    // 4. Sculpted Helm Console + Twin Bolster Seats + Steering Wheel
    const helmConsole = buildBox('sb_helm_console', 1.45, 0.72, 0.85);
    this.trackGeo(helmConsole.geometry);
    helmConsole.material = this.whiteFiberglassMat;
    helmConsole.position.set(0, 1.52, 0.45);
    this.speedboatGroup.add(helmConsole);

    const mfdMat = this.trackMat(makeUnlitColorMat('sb_mfd_glow', 0x38bdf8, 0.95));
    const mfdScreen = buildBox('sb_mfd', 0.56, 0.24, 0.06);
    this.trackGeo(mfdScreen.geometry);
    mfdScreen.material = mfdMat;
    mfdScreen.position.set(-0.22, 1.72, 0.86);
    mfdScreen.rotation.x = -0.35;
    this.speedboatGroup.add(mfdScreen);

    const wheel = buildTorusXY('sb_wheel', 0.2, 0.028, 8, 18);
    this.trackGeo(wheel.geometry);
    wheel.material = this.chromeMat;
    wheel.position.set(0.32, 1.72, 0.92);
    wheel.rotation.x = -0.32;
    this.speedboatGroup.add(wheel);

    for (const side of [-0.62, 0.62]) {
      const seatBase = buildBox('sb_seat_base', 0.62, 0.52, 0.62);
      const seatBack = buildBox('sb_seat_back', 0.62, 0.72, 0.16);
      this.trackGeo(seatBase.geometry);
      this.trackGeo(seatBack.geometry);
      const seatMerged = bakeAndMergeMeshes('sb_seat', [
        { mesh: seatBase, tx: side, ty: 1.48, tz: 1.85 },
        { mesh: seatBack, tx: side, ty: 1.92, tz: 2.12, rx: -0.15 },
      ]);
      this.trackGeo(seatMerged.geometry);
      seatMerged.material = this.cgOrangeMat;
      this.speedboatGroup.add(seatMerged);
    }

    // 5. Wraparound Tinted Windshield + Brushed Aluminum Radar Arch
    const wsShape = new Shape2D();
    wsShape.moveTo(-1.55, 0);
    wsShape.lineTo(-1.05, 0.72);
    wsShape.lineTo(1.05, 0.72);
    wsShape.lineTo(1.55, 0);
    wsShape.lineTo(1.38, -0.08);
    wsShape.lineTo(0.95, 0.56);
    wsShape.lineTo(-0.95, 0.56);
    wsShape.lineTo(-1.38, -0.08);
    wsShape.closePath();
    const wsGlass = buildExtrudedShapeMesh('sb_windshield', wsShape, 1.25, 0.03);
    this.trackGeo(wsGlass.geometry);
    wsGlass.material = this.darkGlassMat;
    wsGlass.position.set(0, 1.28, -0.75);
    wsGlass.rotation.x = -0.46;
    this.speedboatGroup.add(wsGlass);

    const arch = buildTorusXY('sb_arch', 1.48, 0.075, 8, 22, Math.PI);
    this.trackGeo(arch.geometry);
    arch.material = this.chromeMat;
    arch.position.set(0, 1.42, 2.75);
    arch.rotation.x = -0.22;
    this.speedboatGroup.add(arch);

    // 6. Dual V8 Outboards + Spinning Bronze Props + Nitro Flames
    const flameMat = this.trackMat(makeUnlitColorMat('sb_nitro_flame', 0x38bdf8, 0.92));
    const flameGeo = this.trackGeo(new THREE.ConeGeometry(0.18, 1.35, 10));
    flameGeo.rotateX(Math.PI / 2);

    const createOutboard = (xOff: number, propGroup: THREE.Group): THREE.Mesh => {
      const cowl = buildLatheMesh(
        'sb_cowl',
        [
          new THREE.Vector2(0, 0),
          new THREE.Vector2(0.28, 0.08),
          new THREE.Vector2(0.32, 0.55),
          new THREE.Vector2(0.22, 0.92),
          new THREE.Vector2(0, 0.98),
        ],
        12,
      );
      const leg = buildBox('sb_leg', 0.14, 0.95, 0.34);
      this.trackGeo(cowl.geometry);
      this.trackGeo(leg.geometry);
      const ob = bakeAndMergeMeshes('sb_outboard', [
        { mesh: cowl, ty: 0.45, tz: 0 },
        { mesh: leg, ty: -0.22, tz: 0.05 },
      ]);
      this.trackGeo(ob.geometry);
      ob.material = this.outboardMat;
      ob.position.set(xOff, 0.95, 6.45);
      this.speedboatGroup.add(ob);

      propGroup.position.set(xOff, 0.28, 6.72);
      for (let b = 0; b < 3; b++) {
        const blade = buildBox('sb_prop_blade', 0.24, 0.05, 0.08);
        this.trackGeo(blade.geometry);
        blade.material = this.chromeMat;
        blade.rotation.z = (b * Math.PI * 2) / 3;
        blade.position.set(Math.cos(blade.rotation.z) * 0.12, Math.sin(blade.rotation.z) * 0.12, 0);
        propGroup.add(blade);
      }
      this.speedboatGroup.add(propGroup);

      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(xOff, 0.72, 7.25);
      flame.visible = false;
      this.speedboatGroup.add(flame);
      return flame;
    };

    const flameL = createOutboard(-0.56, this.speedboatPropL);
    const flameR = createOutboard(0.56, this.speedboatPropR);
    return { flameL, flameR };
  }

  private buildPatrolBoatMesh(idx: number): PatrolBoatEntity {
    const group = new THREE.Group();
    group.name = `cg_interceptor_${idx}`;

    const hullGeo = this.createSteppedVHullGeometry(18.5, 2.55, 2.3, 0.12);
    const hull = new THREE.Mesh(hullGeo, this.whiteFiberglassMat);
    group.add(hull);

    // Signature Coast Guard Orange & Navy Racing Slash
    const slash = buildBox('cg_stripe', 5.2, 0.55, 2.2);
    this.trackGeo(slash.geometry);
    slash.material = this.cgOrangeMat;
    slash.position.set(0, 1.15, -3.2);
    slash.rotation.x = 0.28;
    group.add(slash);

    // Armored Patrol Cabin & Tinted Bridge Windshield
    const cabin = buildBox('cg_cabin', 3.4, 1.85, 5.4);
    const roof = buildBox('cg_roof', 3.65, 0.22, 5.8);
    this.trackGeo(cabin.geometry);
    this.trackGeo(roof.geometry);
    const cabinMerged = bakeAndMergeMeshes('cg_cabin_merged', [
      { mesh: cabin, ty: 2.35, tz: -0.4 },
      { mesh: roof, ty: 3.35, tz: -0.4 },
    ]);
    this.trackGeo(cabinMerged.geometry);
    cabinMerged.material = this.whiteFiberglassMat;
    group.add(cabinMerged);

    const visor = buildBox('cg_visor', 3.44, 0.78, 5.45);
    this.trackGeo(visor.geometry);
    visor.material = this.darkGlassMat;
    visor.position.set(0, 2.68, -0.45);
    group.add(visor);

    // Radar Dome + Arch + Flashing Red/Blue Lightbar
    const radome = buildCylinder('cg_radome', 0.42, 0.48, 0.36, 14);
    this.trackGeo(radome.geometry);
    radome.material = this.whiteFiberglassMat;
    radome.position.set(0, 3.72, -1.2);
    group.add(radome);

    const redMat = this.trackMat(makeUnlitColorMat(`cg_red_${idx}`, 0xff2233, 1.0));
    const blueMat = this.trackMat(makeUnlitColorMat(`cg_blue_${idx}`, 0x2277ff, 1.0));
    const barGeo = this.trackGeo(new THREE.BoxGeometry(1.15, 0.26, 0.36));
    const redBar = new THREE.Mesh(barGeo, redMat);
    const blueBar = new THREE.Mesh(barGeo, blueMat);
    redBar.position.set(-0.62, 3.62, 1.35);
    blueBar.position.set(0.62, 3.62, 1.35);
    group.add(redBar, blueBar);

    const propL = new THREE.Group();
    const propR = new THREE.Group();
    propL.position.set(-0.85, 0.2, 8.8);
    propR.position.set(0.85, 0.2, 8.8);
    for (const pg of [propL, propR]) {
      const hub = buildCylinder('cg_prop', 0.14, 0.14, 0.3, 8);
      hub.rotation.x = Math.PI / 2;
      this.trackGeo(hub.geometry);
      hub.material = this.chromeMat;
      pg.add(hub);
      group.add(pg);
    }

    return {
      group,
      redBar,
      blueBar,
      redMat,
      blueMat,
      propL,
      propR,
      active: false,
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      headingRad: 0,
      speed: 0,
      roll: 0,
      hitCooldown: 0,
    };
  }

  private buildChopperMesh(): ChopperEntity {
    const group = new THREE.Group();
    group.name = 'cg_pursuit_chopper';

    // Fuselage pod (Lathe streamlined shell scaled to helicopter profile)
    const pod = buildLatheMesh(
      'heli_pod',
      [
        new THREE.Vector2(0, -3.4),
        new THREE.Vector2(0.85, -2.6),
        new THREE.Vector2(1.35, -1.2),
        new THREE.Vector2(1.42, 0.6),
        new THREE.Vector2(1.05, 2.2),
        new THREE.Vector2(0, 3.1),
      ],
      16,
    );
    pod.rotation.x = Math.PI / 2;
    this.trackGeo(pod.geometry);
    pod.material = this.cgDarkMat;
    group.add(pod);

    const stripe = buildBox('heli_orange_band', 2.9, 0.55, 2.4);
    this.trackGeo(stripe.geometry);
    stripe.material = this.cgOrangeMat;
    stripe.position.set(0, -0.1, 0.3);
    group.add(stripe);

    const canopy = buildBox('heli_canopy', 2.2, 0.95, 2.2);
    this.trackGeo(canopy.geometry);
    canopy.material = this.darkGlassMat;
    canopy.position.set(0, 0.28, -1.35);
    group.add(canopy);

    // Tail boom + vertical fin + skids
    const boom = buildCylinder('heli_boom', 0.22, 0.42, 6.4, 10);
    const fin = buildBox('heli_fin', 0.14, 1.55, 0.95);
    const skidL = buildCylinder('heli_skidL', 0.08, 0.08, 4.8, 8);
    const skidR = buildCylinder('heli_skidR', 0.08, 0.08, 4.8, 8);
    this.trackGeo(boom.geometry);
    this.trackGeo(fin.geometry);
    this.trackGeo(skidL.geometry);
    this.trackGeo(skidR.geometry);
    const frame = bakeAndMergeMeshes('heli_frame', [
      { mesh: boom, ty: 0.35, tz: 5.2, rx: Math.PI / 2 },
      { mesh: fin, ty: 1.0, tz: 8.1, rx: -0.25 },
      { mesh: skidL, tx: -1.15, ty: -1.55, tz: -0.1, rx: Math.PI / 2 },
      { mesh: skidR, tx: 1.15, ty: -1.55, tz: -0.1, rx: Math.PI / 2 },
    ]);
    this.trackGeo(frame.geometry);
    frame.material = this.chromeMat;
    group.add(frame);

    // 4-Blade Main Rotor
    const mainRotor = new THREE.Group();
    mainRotor.position.set(0, 1.65, 0);
    const bladeGeo = this.trackGeo(new THREE.BoxGeometry(11.6, 0.05, 0.34));
    const b1 = new THREE.Mesh(bladeGeo, this.cgDarkMat);
    const b2 = new THREE.Mesh(bladeGeo, this.cgDarkMat);
    b2.rotation.y = Math.PI / 2;
    mainRotor.add(b1, b2);
    group.add(mainRotor);

    // Tail Rotor
    const tailRotor = new THREE.Group();
    tailRotor.position.set(0.28, 0.95, 8.2);
    const tailBladeGeo = this.trackGeo(new THREE.BoxGeometry(0.06, 1.85, 0.18));
    const tb = new THREE.Mesh(tailBladeGeo, this.cgOrangeMat);
    tailRotor.add(tb);
    group.add(tailRotor);

    // Helicopter Sweeping Searchlight Cone
    const beamGeo = this.trackGeo(new THREE.ConeGeometry(9.5, 44, 16, 1, true));
    beamGeo.translate(0, -22, 0);
    const beamMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xe6f9ff,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const searchBeam = new THREE.Mesh(beamGeo, beamMat);
    searchBeam.position.set(0, -0.9, -2.1);
    group.add(searchBeam);

    return {
      group,
      mainRotor,
      tailRotor,
      searchBeam,
      active: false,
      x: 0,
      y: 38,
      z: 0,
      orbitAngle: 0,
    };
  }

  private buildSculptedGraniteRockGeo(seed: number, radius: number, height: number): THREE.BufferGeometry {
    const geo = new THREE.IcosahedronGeometry(1.0, this.isSoftwareGl ? 1 : 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);
      const ang = Math.atan2(z, x);
      const ridge =
        1.0 +
        0.28 * Math.sin(ang * 3 + seed * 1.7) +
        0.18 * Math.cos(ang * 5 - seed * 2.3) +
        0.16 * Math.sin(y * 4.5 + seed);
      x *= radius * ridge;
      z *= radius * (2.0 - ridge * 0.92);
      // Flat submerged base, craggy spire top
      y = y > 0 ? Math.pow(y, 0.85) * height * (0.85 + 0.25 * Math.sin(seed + ang * 2)) : y * 4.5 - 2.0;
      pos.setXYZ(i, x, y, z);
    }
    geo.computeVertexNormals();
    return geo;
  }

  // =========================================================================
  // 2. CONCORDIA COASTAL GRANITE REEFS & SEA STACKS
  // =========================================================================
  public clearReefs(): void {
    for (const r of this.reefs) {
      r.group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
        }
      });
      r.buoyLightMat?.dispose();
      this.root.remove(r.group);
    }
    this.reefs.length = 0;
    this.reefAutopilotList.length = 0;
  }

  private getReefFairwayX(z: number): number {
    const taper = MathUtils.smoothstep(-z, 540, 880);
    return (-95 + Math.sin(z * 0.0048) * 145 + Math.cos(z * 0.011) * 48) * taper;
  }

  public seedReefField(shipX: number, shipZ: number, startInNight: boolean): void {
    this.clearReefs();

    const startZ = -780;
    const endZ = -3980;
    const rows = 44;
    const cols = 12;
    const widthX = 1480;
    const cellW = widthX / cols;
    const cellH = (startZ - endZ) / rows;
    const fairwayHalfW = 54;

    let seed = 1;
    for (let row = 0; row < rows; row++) {
      const zCenter = startZ - (row + 0.5) * cellH;
      for (let col = 0; col < cols; col++) {
        seed++;
        const r1 = ((Math.sin(seed * 127.1 + 91.7) * 43758.5453) % 1 + 1) % 1;
        const r2 = ((Math.sin(seed * 269.5 + 17.3) * 43758.5453) % 1 + 1) % 1;
        const r3 = ((Math.sin(seed * 419.2 + 53.1) * 43758.5453) % 1 + 1) % 1;
        // Keep ~36% occupancy so granite islands are dramatic & evenly distributed without blocking navigation
        if (r1 > 0.36) continue;

        const z = zCenter + (r2 - 0.5) * (cellH * 0.45);
        let x = -widthX * 0.5 - 110 + (col + 0.5) * cellW + (r3 - 0.5) * (cellW * 0.42);
        const fairX = this.getReefFairwayX(z);
        const rel = x - fairX;
        if (Math.abs(rel) < fairwayHalfW) {
          x = fairX + (rel >= 0 ? 1 : -1) * (fairwayHalfW + 10 + r2 * 18);
        }

        if (Math.hypot(x - shipX, z - shipZ) < 155) continue;
        if (startInNight && Math.hypot(x, z + 850) < 165) continue;

        const radius = 10 + r2 * 15;
        const height = 6 + r3 * 22;
        const group = new THREE.Group();
        group.position.set(x, 0, z);

        const mainRock = new THREE.Mesh(
          this.buildSculptedGraniteRockGeo(seed, radius, height),
          this.reefRockMat,
        );
        group.add(mainRock);

        // Secondary flanking shelf boulder
        const subRock = new THREE.Mesh(
          this.buildSculptedGraniteRockGeo(seed + 77, radius * 0.62, height * 0.48),
          this.reefRockMat,
        );
        subRock.position.set((r1 - 0.5) * radius * 0.9, -0.5, (r3 - 0.5) * radius * 0.9);
        group.add(subRock);

        // Surf foam collar ring around rock waterline
        const foamRing = new THREE.Mesh(
          new THREE.RingGeometry(radius * 0.88, radius * 1.24, 20),
          this.reefFoamMat,
        );
        foamRing.rotation.x = -Math.PI / 2;
        foamRing.position.y = 0.24;
        group.add(foamRing);

        // Coastal hazard warning beacon buoy on reefs nearest the fairway
        let buoyLightMat: THREE.MeshBasicMaterial | null = null;
        const hasBuoy = Math.abs(x - fairX) < fairwayHalfW + 38 && row % 3 === 0;
        if (hasBuoy) {
          const bOffX = x > fairX ? -radius - 4.5 : radius + 4.5;
          const bBase = buildCylinder('reef_buoy_base', 1.1, 1.35, 1.4, 10);
          bBase.material = this.buoyRedMat;
          bBase.position.set(bOffX, 0.3, 0);
          const bTower = buildCylinder('reef_buoy_tower', 0.22, 0.45, 2.8, 8);
          bTower.material = this.buoySteelMat;
          bTower.position.set(bOffX, 2.1, 0);
          buoyLightMat = makeUnlitColorMat(`buoy_lamp_${seed}`, 0xff4422, 1.0);
          const bLamp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), buoyLightMat);
          bLamp.position.set(bOffX, 3.65, 0);
          group.add(bBase, bTower, bLamp);
        }

        this.root.add(group);
        this.reefs.push({
          id: `reef_${seed}`,
          group,
          x,
          z,
          radius: radius * 0.92,
          height,
          warned: false,
          nearMissAwarded: false,
          hitCooldown: 0,
          hasBuoy,
          buoyLightMat,
        });
      }
    }
  }

  public getReefAutopilotObstacles(): ReadonlyArray<{ x: number; z: number; radius: number }> {
    return this.reefAutopilotList;
  }

  // =========================================================================
  // 3. GTA 6 CONTROLS: SPEEDBOAT, FOCUS, WANTED, MISSIONS
  // =========================================================================
  public resetForVoyage(vesselId: VesselId): void {
    this.activeCraft = 'ship';
    const spec = VESSEL_SPECS[vesselId];
    this.speedboatX = spec.berthX + (vesselId === 'titanic' ? -24 : 26);
    this.speedboatZ = -34;
    this.speedboatY = 0;
    this.speedboatVy = 0;
    this.speedboatHeading = 0;
    this.speedboatKnots = 0;
    this.speedboatRoll = 0;
    this.speedboatPitch = 0;
    this.speedboatNitroPct = 100;
    this.speedboatAirTime = 0;
    this.speedboatWasAirborne = false;
    this.speedboatGroup.position.set(this.speedboatX, 0, this.speedboatZ);
    this.speedboatGroup.rotation.set(0, 0, 0);

    this.wantedLevel = 0;
    this.heatPoints = 0;
    this.wantedEvading = false;
    this.wantedCooldownPct = 0;
    this.evasionTimer = 0;
    this.noWakeHeatCooldown = 0;
    for (const pb of this.patrolBoats) {
      pb.active = false;
      pb.group.visible = false;
    }
    this.chopper.active = false;
    this.chopper.group.visible = false;

    this.specialFocusPct = 100;
    this.specialFocusActive = false;
    this.stuntText = null;
    this.stuntTimer = 0;
    this.clearMissionMarkers();
    this.activeMission = null;
    this.activeMissionTitle = null;
    this.activeMissionStep = null;
    this.activeMissionTimerSec = null;
    this.missionBannerText = null;
    this.missionBannerSub = null;
    this.missionBannerTimer = 0;
    if (vesselId !== 'concordia') {
      this.clearReefs();
    }
  }

  public addHeat(starsDelta: number, reason: string): string {
    const prev = this.wantedLevel;
    this.heatPoints = Math.min(5, this.heatPoints + starsDelta);
    this.wantedLevel = Math.min(5, Math.max(1, Math.ceil(this.heatPoints)));
    this.wantedEvading = false;
    this.evasionTimer = 0;
    this.wantedCooldownPct = 0;
    if (this.wantedLevel > prev) {
      this.sound.playWantedChime();
    }
    return `★${this.wantedLevel} WANTED: ${reason}`;
  }

  public toggleSpeedboat(shipX: number, shipZ: number, shipHeadingRad: number): {
    boarded: boolean;
    eventText: string;
  } {
    if (this.activeCraft === 'ship') {
      this.activeCraft = 'speedboat';
      // If liner sailed far ahead of moored tender, deploy tender right alongside liner's beam
      if (Math.hypot(this.speedboatX - shipX, this.speedboatZ - shipZ) > 260) {
        const rightX = Math.cos(shipHeadingRad);
        const rightZ = Math.sin(shipHeadingRad);
        this.speedboatX = shipX + rightX * 32;
        this.speedboatZ = shipZ + rightZ * 32;
        this.speedboatHeading = shipHeadingRad;
        this.speedboatKnots = 18;
      }
      this.sound.playHelmTick();
      return {
        boarded: true,
        eventText: 'BOARDED LEONIDA SCARAB 38 SPEEDBOAT — W/A/S/D TO DRIVE · SHIFT NITRO',
      };
    }
    this.activeCraft = 'ship';
    this.sound.playTelegraphBell();
    return {
      boarded: false,
      eventText: 'RETURNED TO OCEAN LINER BRIDGE COMMAND',
    };
  }

  public toggleSpecialFocus(): boolean {
    if (this.specialFocusActive) {
      this.specialFocusActive = false;
      this.sound.playFocusActivate(false);
      return false;
    }
    if (this.specialFocusPct < 15) return false;
    this.specialFocusActive = true;
    this.sound.playFocusActivate(true);
    return true;
  }

  private clearMissionMarkers(): void {
    for (const m of this.missionMarkers) {
      this.root.remove(m.group);
    }
    this.missionMarkers.length = 0;
  }

  public startOrCycleMission(
    px: number,
    pz: number,
    headingRad: number,
  ): { title: string; eventText: string } {
    this.clearMissionMarkers();
    const kind = MISSION_ORDER[this.missionCursor % MISSION_ORDER.length];
    this.missionCursor++;
    this.activeMission = kind;
    this.missionProgress = 0;

    const fwdX = Math.sin(headingRad);
    const fwdZ = -Math.cos(headingRad);
    const rightX = Math.cos(headingRad);
    const rightZ = Math.sin(headingRad);

    if (kind === 'slalom') {
      this.activeMissionTitle = 'CONTRACT: CHANNEL SLALOM';
      this.missionTarget = 6;
      this.missionTimeLeft = 95;
      this.activeMissionStep = 'Thread Beacon Gates: 0 / 6';
      for (let i = 0; i < 6; i++) {
        const dist = 140 + i * 165;
        const lat = Math.sin(i * 1.15) * 75;
        const mx = px + fwdX * dist + rightX * lat;
        const mz = pz + fwdZ * dist + rightZ * lat;
        this.spawnGateMarker(mx, mz, false);
      }
    } else if (kind === 'rescue') {
      this.activeMissionTitle = 'CONTRACT: MAYDAY RESCUE';
      this.missionTarget = 3;
      this.missionTimeLeft = 90;
      this.activeMissionStep = 'Recover Distress Rafts: 0 / 3';
      for (let i = 0; i < 3; i++) {
        const dist = 160 + i * 190;
        const lat = (i - 1) * 95;
        const mx = px + fwdX * dist + rightX * lat;
        const mz = pz + fwdZ * dist + rightZ * lat;
        this.spawnGateMarker(mx, mz, true);
      }
    } else if (kind === 'daredevil') {
      this.activeMissionTitle = 'CONTRACT: DAREDEVIL THREAD';
      this.missionTarget = 3;
      this.missionTimeLeft = 100;
      this.activeMissionStep = 'Clean Near-Misses: 0 / 3';
    } else {
      this.activeMissionTitle = 'CONTRACT: LOSE THE HEAT';
      this.missionTarget = 1;
      this.missionTimeLeft = 90;
      if (this.wantedLevel < 2) {
        this.addHeat(2, 'HARBOR SMUGGLING INTERCEPT');
      }
      this.activeMissionStep = `Evade ★${this.wantedLevel} Coast Guard Pursuit`;
    }

    this.activeMissionTimerSec = Math.ceil(this.missionTimeLeft);
    this.missionBannerText = this.activeMissionTitle;
    this.missionBannerSub = this.activeMissionStep;
    this.missionBannerTimer = 3.2;
    this.sound.playTelegraphBell();
    return {
      title: this.activeMissionTitle,
      eventText: `${this.activeMissionTitle} — ${this.activeMissionStep}`,
    };
  }

  private spawnGateMarker(x: number, z: number, isRaft: boolean): void {
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    const ringGeo = this.trackGeo(new THREE.TorusGeometry(isRaft ? 5.5 : 10.5, 0.55, 8, 24));
    const ring = new THREE.Mesh(ringGeo, this.markerRingMat);
    if (isRaft) {
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.7;
      const raft = buildBox('rescue_raft', 4.6, 0.85, 3.0);
      this.trackGeo(raft.geometry);
      raft.material = this.rescueRaftMat;
      raft.position.y = 0.35;
      group.add(raft);
    } else {
      ring.position.y = 6.5;
    }

    const beamGeo = this.trackGeo(new THREE.CylinderGeometry(isRaft ? 1.6 : 2.8, isRaft ? 2.4 : 4.2, 48, 12, 1, true));
    const beam = new THREE.Mesh(beamGeo, this.markerBeamMat);
    beam.position.y = 24;
    group.add(ring, beam);

    this.root.add(group);
    this.missionMarkers.push({ group, ring, beam, x, z, collected: false });
  }

  private completeMission(rewardCash: number, rewardRep: number): void {
    this.cash += rewardCash;
    this.rep += rewardRep;
    this.missionBannerText = 'MISSION PASSED!';
    this.missionBannerSub = `${this.activeMissionTitle ?? 'CONTRACT'} · +$${rewardCash.toLocaleString()} · +${rewardRep} RP`;
    this.missionBannerTimer = 4.2;
    this.activeMission = null;
    this.activeMissionTitle = null;
    this.activeMissionStep = null;
    this.activeMissionTimerSec = null;
    this.clearMissionMarkers();
    this.sound.playMissionPassed();
  }

  private failMission(): void {
    this.missionBannerText = 'CONTRACT EXPIRED';
    this.missionBannerSub = 'Press [G] to accept a new maritime contract';
    this.missionBannerTimer = 3.2;
    this.activeMission = null;
    this.activeMissionTitle = null;
    this.activeMissionStep = null;
    this.activeMissionTimerSec = null;
    this.clearMissionMarkers();
  }

  // =========================================================================
  // 4. PER-FRAME SANDBOX SIMULATION UPDATE
  // =========================================================================
  public update(input: SandboxUpdateInput): SandboxUpdateResult {
    const res: SandboxUpdateResult = {
      scoreDelta: 0,
      nearMissDelta: 0,
      warningText: null,
      warningSide: 0,
      eventText: null,
      reefHit: null,
      patrolImpactOnShip: null,
    };

    const { dt, worldDt, simTime, shipX, shipZ, shipHeadingRad, shipKnots, inHarborZone } = input;

    // 1. Special Focus Drain & Recharge
    if (this.specialFocusActive) {
      this.specialFocusPct = Math.max(0, this.specialFocusPct - dt * 15.5);
      if (this.specialFocusPct <= 0) {
        this.specialFocusActive = false;
        this.sound.playFocusActivate(false);
      }
    } else {
      this.specialFocusPct = Math.min(100, this.specialFocusPct + dt * 4.2);
    }

    if (this.stuntTimer > 0) {
      this.stuntTimer = Math.max(0, this.stuntTimer - dt);
      if (this.stuntTimer <= 0) this.stuntText = null;
    }
    if (this.missionBannerTimer > 0) {
      this.missionBannerTimer = Math.max(0, this.missionBannerTimer - dt);
      if (this.missionBannerTimer <= 0) {
        this.missionBannerText = null;
        this.missionBannerSub = null;
      }
    }

    // 2. Speedboat Physics & Wave-Jumping
    this.stepSpeedboat(dt, simTime, input.heldKeys, res);

    // Determine active craft position for Wanted pursuit, Mission beacons & Radar
    const activeX = this.activeCraft === 'speedboat' ? this.speedboatX : shipX;
    const activeZ = this.activeCraft === 'speedboat' ? this.speedboatZ : shipZ;
    const activeHeading = this.activeCraft === 'speedboat' ? this.speedboatHeading : shipHeadingRad;
    const activeKnots = this.activeCraft === 'speedboat' ? this.speedboatKnots : shipKnots;

    // 3. No-Wake Zone Speeding Check inside Southampton Harbor
    if (this.noWakeHeatCooldown > 0) {
      this.noWakeHeatCooldown = Math.max(0, this.noWakeHeatCooldown - dt);
    }
    const noWakeLimit = this.activeCraft === 'speedboat' ? 30 : 14.5;
    if (inHarborZone && Math.abs(activeKnots) > noWakeLimit && this.noWakeHeatCooldown <= 0) {
      this.noWakeHeatCooldown = 9.5;
      if (this.wantedLevel < 2) {
        res.eventText = this.addHeat(1, 'NO-WAKE ZONE SPEEDING');
      }
    }

    // 4. Costa Concordia Granite Reefs (wrap, warning, collision, near-miss)
    if (input.vesselId === 'concordia' && this.reefs.length > 0) {
      this.stepReefs(worldDt, simTime, shipX, shipZ, shipHeadingRad, shipKnots, input.shipHalfBeam, res);
    } else {
      this.reefAutopilotList.length = 0;
    }

    // 5. Wanted Pursuit Units (Coast Guard Interceptors & Helicopter)
    this.stepWantedPursuit(worldDt, simTime, activeX, activeZ, activeHeading, shipX, shipZ, shipHeadingRad, res);

    // 6. Active Contract / Mission Tracking
    this.stepActiveMission(dt, simTime, activeX, activeZ, res);

    // 7. Build Zero-GC Radar Blips relative to active player craft
    this.buildRadarBlips(activeX, activeZ, input);

    return res;
  }

  private stepSpeedboat(
    dt: number,
    simTime: number,
    heldKeys: Set<string>,
    res: SandboxUpdateResult,
  ): void {
    if (this.speedboatHitCooldown > 0) {
      this.speedboatHitCooldown = Math.max(0, this.speedboatHitCooldown - dt);
    }

    const isDriving = this.activeCraft === 'speedboat';
    let targetKnots = 0;
    let steerInput = 0;
    let nitroUsing = false;

    if (isDriving) {
      const fwd =
        (heldKeys.has('KeyW') || heldKeys.has('ArrowUp') || heldKeys.has('KeyZ') ? 1 : 0) -
        (heldKeys.has('KeyS') || heldKeys.has('ArrowDown') || heldKeys.has('KeyX') ? 1 : 0);
      steerInput =
        (heldKeys.has('KeyD') || heldKeys.has('ArrowRight') || heldKeys.has('KeyE') ? 1 : 0) -
        (heldKeys.has('KeyA') || heldKeys.has('ArrowLeft') || heldKeys.has('KeyQ') ? 1 : 0);
      const wantNitro = heldKeys.has('ShiftLeft') || heldKeys.has('ShiftRight');
      nitroUsing = wantNitro && fwd > 0 && this.speedboatNitroPct > 2;

      if (nitroUsing) {
        this.speedboatNitroPct = Math.max(0, this.speedboatNitroPct - dt * 26);
        targetKnots = 84;
      } else {
        this.speedboatNitroPct = Math.min(100, this.speedboatNitroPct + dt * 11);
        targetKnots = fwd > 0 ? 60 : fwd < 0 ? -16 : 0;
      }
    } else {
      this.speedboatNitroPct = Math.min(100, this.speedboatNitroPct + dt * 14);
      targetKnots = 0;
    }

    this.speedboatKnots = MathUtils.damp(this.speedboatKnots, targetKnots, nitroUsing ? 3.2 : 2.1, dt);
    const turnAuthority = 0.25 + 0.75 * Math.min(1, Math.abs(this.speedboatKnots) / 28);
    const revSign = this.speedboatKnots < -1 ? -0.75 : 1;
    const yawRate = steerInput * 1.48 * turnAuthority * revSign;
    this.speedboatHeading += yawRate * dt;

    const worldSpd = this.speedboatKnots * 1.55;
    const fwdX = Math.sin(this.speedboatHeading);
    const fwdZ = -Math.cos(this.speedboatHeading);
    this.speedboatX += fwdX * worldSpd * dt;
    this.speedboatZ += fwdZ * worldSpd * dt;

    const waveY = sampleOceanWaveHeight(this.speedboatX, this.speedboatZ, simTime);
    const waveAhead = sampleOceanWaveHeight(this.speedboatX + fwdX * 4.5, this.speedboatZ + fwdZ * 4.5, simTime);

    // Launch off wave crests when charging at high knots
    if (this.speedboatY <= waveY + 0.14) {
      if (this.speedboatWasAirborne && this.speedboatAirTime >= 0.42) {
        const bonus = 250;
        this.cash += bonus;
        this.rep += 75;
        res.scoreDelta += 300;
        this.stuntText = `WAVE JUMP STUNT +$${bonus}`;
        this.stuntTimer = 2.6;
        this.sound.playNearMissChime();
      }
      this.speedboatAirTime = 0;
      this.speedboatWasAirborne = false;

      if (isDriving && this.speedboatKnots > 46 && waveY > 0.24 && waveAhead < waveY - 0.06) {
        this.speedboatVy = Math.max(this.speedboatVy, (this.speedboatKnots / 64) * 5.8);
      } else {
        this.speedboatY = waveY;
        this.speedboatVy = 0;
      }
    } else {
      this.speedboatAirTime += dt;
      this.speedboatWasAirborne = true;
    }

    if (this.speedboatY > waveY + 0.02 || this.speedboatVy > 0) {
      this.speedboatVy -= 15.5 * dt;
      this.speedboatY += this.speedboatVy * dt;
      if (this.speedboatY < waveY) {
        this.speedboatY = waveY;
        this.speedboatVy = 0;
        this.particles.burstIceImpact(this.speedboatX, waveY + 0.3, this.speedboatZ, 12);
      }
    }

    const targetRoll = -yawRate * 0.26 + Math.sin(simTime * 2.1) * 0.03;
    const targetPitch = MathUtils.clamp((waveAhead - waveY) * 0.18 + this.speedboatVy * 0.035 + (this.speedboatKnots / 84) * 0.06, -0.22, 0.28);
    this.speedboatRoll = MathUtils.damp(this.speedboatRoll, targetRoll, 7, dt);
    this.speedboatPitch = MathUtils.damp(this.speedboatPitch, targetPitch, 7, dt);

    this.speedboatGroup.position.set(this.speedboatX, this.speedboatY, this.speedboatZ);
    setEulerXYZ(this.speedboatGroup, this.speedboatPitch, -this.speedboatHeading, this.speedboatRoll);

    this.speedboatPropL.rotation.z += dt * (8 + Math.abs(this.speedboatKnots) * 0.9);
    this.speedboatPropR.rotation.z -= dt * (8 + Math.abs(this.speedboatKnots) * 0.9);
    this.speedboatFlameL.visible = nitroUsing;
    this.speedboatFlameR.visible = nitroUsing;
    if (nitroUsing) {
      const flicker = 0.85 + Math.random() * 0.45;
      this.speedboatFlameL.scale.set(1, 1, flicker);
      this.speedboatFlameR.scale.set(1, 1, flicker);
    }

    // Wake spray particles behind speedboat
    if (Math.abs(this.speedboatKnots) > 12 && this.speedboatY <= waveY + 0.35) {
      this.speedboatSprayAccum += dt * Math.abs(this.speedboatKnots) * 0.45;
      while (this.speedboatSprayAccum >= 1) {
        this.speedboatSprayAccum -= 1;
        this.particles.emit(
          this.speedboatX - fwdX * 6.5 + (Math.random() - 0.5) * 1.6,
          waveY + 0.35,
          this.speedboatZ - fwdZ * 6.5 + (Math.random() - 0.5) * 1.6,
          (Math.random() - 0.5) * 2.5,
          1.2 + Math.random() * 1.8,
          (Math.random() - 0.5) * 2.5,
          0.42,
          0.55,
          7.5,
          nitroUsing ? 0x7dd3fc : 0xe0f2fe,
        );
      }
    }

    this.sound.playSpeedboatEngine(this.speedboatKnots, nitroUsing, isDriving);
  }

  private stepReefs(
    dt: number,
    simTime: number,
    shipX: number,
    shipZ: number,
    headingRad: number,
    speedKnots: number,
    halfBeam: number,
    res: SandboxUpdateResult,
  ): void {
    const fwdX = Math.sin(headingRad);
    const fwdZ = -Math.cos(headingRad);
    const rightX = Math.cos(headingRad);
    const rightZ = Math.sin(headingRad);
    const spanZ = 3200;

    this.reefAutopilotList.length = 0;
    let closestDist = Infinity;

    for (let i = 0; i < this.reefs.length; i++) {
      const r = this.reefs[i];
      if (r.hitCooldown > 0) r.hitCooldown = Math.max(0, r.hitCooldown - dt);

      // Wrap far-aft reefs ahead into endless channel
      if (r.z - shipZ > 440) {
        const oldFair = this.getReefFairwayX(r.z);
        const rel = r.x - oldFair;
        r.z -= spanZ;
        r.x = this.getReefFairwayX(r.z) + rel;
        r.group.position.set(r.x, 0, r.z);
        r.warned = false;
        r.nearMissAwarded = false;
        r.hitCooldown = 0;
      }

      if (r.buoyLightMat) {
        const flash = Math.sin(simTime * 3.8 + i) > 0.35 ? 1.0 : 0.25;
        r.buoyLightMat.color.setRGB(flash, flash * 0.28, flash * 0.12);
      }

      const dx = r.x - shipX;
      const dz = r.z - shipZ;
      if (Math.abs(dx) < 380 && Math.abs(dz) < 560) {
        this.reefAutopilotList.push({ x: r.x, z: r.z, radius: r.radius });
      }
      if (Math.abs(dx) > 310 || Math.abs(dz) > 310) continue;

      const ahead = dx * fwdX + dz * fwdZ;
      const lateral = dx * rightX + dz * rightZ;

      if (ahead > 75 && ahead < 265 && Math.abs(lateral) < r.radius + halfBeam + 12) {
        if (ahead < closestDist) {
          closestDist = ahead;
          res.warningSide = Math.abs(lateral) < 6 ? 0 : lateral < 0 ? -1 : 1;
          res.warningText =
            Math.abs(lateral) < 10
              ? 'GRANITE REEF DEAD AHEAD'
              : lateral < 0
                ? 'REEF SHOAL OFF PORT BOW'
                : 'REEF SHOAL OFF STARBOARD BOW';
        }
        if (!r.warned && ahead < 200) {
          r.warned = true;
          this.sound.playLookoutBell();
        }
      }

      // Check liner hull collision along bow/mid/stern stations
      if (r.hitCooldown <= 0) {
        const stations = [-76, -34, 48, 128, 195];
        const stationRad = [6.5, 14.2, halfBeam, halfBeam, 11.0];
        for (let p = 0; p < stations.length; p++) {
          const px = shipX + fwdX * -stations[p];
          const pz = shipZ + fwdZ * -stations[p];
          const vx = px - r.x;
          const vz = pz - r.z;
          const dist = Math.hypot(vx, vz);
          const minAllowed = r.radius + stationRad[p];
          if (dist < minAllowed) {
            r.hitCooldown = 1.85;
            r.nearMissAwarded = true;
            const spdRatio = Math.max(0.35, Math.abs(speedKnots) / 20);
            const nx = dist > 0.001 ? vx / dist : -rightX;
            const nz = dist > 0.001 ? vz / dist : -rightZ;
            res.reefHit = {
              hitX: (px + r.x) * 0.5,
              hitZ: (pz + r.z) * 0.5,
              nx,
              nz,
              overlap: minAllowed - dist + 2.4,
              rawDmg: (p === 0 ? 48 : 38) * spdRatio + 18,
              floodJump: p === 0 ? 26 : 18,
              isBow: p === 0,
              sideSign: lateral,
            };
            break;
          }
        }
      }

      // Speedboat collision with reef -> bounce + stun + spark
      if (this.activeCraft === 'speedboat' && this.speedboatHitCooldown <= 0) {
        const sd = Math.hypot(this.speedboatX - r.x, this.speedboatZ - r.z);
        if (sd < r.radius + 2.6) {
          this.speedboatHitCooldown = 0.8;
          const nx = sd > 0.01 ? (this.speedboatX - r.x) / sd : 1;
          const nz = sd > 0.01 ? (this.speedboatZ - r.z) / sd : 0;
          this.speedboatX = r.x + nx * (r.radius + 3.2);
          this.speedboatZ = r.z + nz * (r.radius + 3.2);
          this.speedboatKnots *= -0.35;
          this.particles.burstIceImpact(this.speedboatX, 1.2, this.speedboatZ, 16);
          this.sound.playCollisionImpact(0.45);
        }
      }

      // Clean Passage Near-Miss
      if (!r.nearMissAwarded && ahead < 18 && ahead > -195) {
        const clearance = Math.abs(lateral) - (r.radius + halfBeam);
        if (clearance > 0 && clearance < 18) {
          r.nearMissAwarded = true;
          this.cash += 350;
          this.rep += 60;
          res.scoreDelta += 350;
          res.nearMissDelta += 1;
          this.sound.playNearMissChime();
          res.eventText = 'REEF THREAD +$350';
          if (this.activeMission === 'daredevil') {
            this.advanceDaredevilMission();
          }
        }
      }
    }
  }

  public advanceDaredevilMission(): void {
    if (this.activeMission !== 'daredevil') return;
    this.missionProgress += 1;
    this.activeMissionStep = `Clean Near-Misses: ${this.missionProgress} / ${this.missionTarget}`;
    if (this.missionProgress >= this.missionTarget) {
      this.completeMission(1800, 500);
    }
  }

  private stepWantedPursuit(
    dt: number,
    simTime: number,
    activeX: number,
    activeZ: number,
    activeHeading: number,
    shipX: number,
    shipZ: number,
    shipHeading: number,
    res: SandboxUpdateResult,
  ): void {
    const desiredBoats = this.wantedLevel >= 4 ? 3 : this.wantedLevel >= 2 ? 2 : this.wantedLevel >= 1 ? 1 : 0;
    const desiredChopper = this.wantedLevel >= 3;

    if (this.wantedLevel > 0) {
      if (this.sirenCooldown > 0) this.sirenCooldown -= dt;
      else {
        this.sirenCooldown = 2.6;
        this.sound.playPoliceSirenPulse();
      }
    }

    let closestUnitDist = Infinity;

    for (let i = 0; i < this.patrolBoats.length; i++) {
      const pb = this.patrolBoats[i];
      if (i < desiredBoats) {
        if (!pb.active) {
          pb.active = true;
          pb.group.visible = true;
          const ang = activeHeading + (i - 1) * 0.9 + Math.PI * 0.72;
          pb.x = activeX + Math.sin(ang) * 185;
          pb.z = activeZ - Math.cos(ang) * 185;
          pb.headingRad = activeHeading;
          pb.speed = 32;
          pb.hitCooldown = 0;
        }
      } else if (pb.active) {
        pb.active = false;
        pb.group.visible = false;
      }

      if (!pb.active) continue;
      if (pb.hitCooldown > 0) pb.hitCooldown = Math.max(0, pb.hitCooldown - dt);

      // Chase & intercept target point slightly ahead of player craft
      const leadX = activeX + Math.sin(activeHeading) * (this.activeCraft === 'speedboat' ? 18 : 28);
      const leadZ = activeZ - Math.cos(activeHeading) * (this.activeCraft === 'speedboat' ? 18 : 28);
      const tx = leadX + (i - 1) * 26;
      const tz = leadZ + (i === 0 ? -18 : 22);

      const dx = tx - pb.x;
      const dz = tz - pb.z;
      const dist = Math.hypot(dx, dz);
      const desiredHeading = Math.atan2(dx, -dz);
      let dH = (desiredHeading - pb.headingRad) % (Math.PI * 2);
      if (dH > Math.PI) dH -= Math.PI * 2;
      if (dH < -Math.PI) dH += Math.PI * 2;
      pb.headingRad += MathUtils.clamp(dH, -1.65 * dt, 1.65 * dt);

      const targetSpd = this.wantedLevel >= 3 ? 52 : 42;
      pb.speed = MathUtils.damp(pb.speed, dist > 20 ? targetSpd : 22, 2.5, dt);
      const wSpd = pb.speed * 1.35;
      pb.x += Math.sin(pb.headingRad) * wSpd * dt;
      pb.z += -Math.cos(pb.headingRad) * wSpd * dt;

      const wY = sampleOceanWaveHeight(pb.x, pb.z, simTime);
      pb.roll = MathUtils.damp(pb.roll, -dH * 0.18 + Math.sin(simTime * 2.3 + i) * 0.04, 6, dt);
      pb.group.position.set(pb.x, wY, pb.z);
      setEulerXYZ(pb.group, Math.cos(simTime * 2.1 + i) * 0.03, -pb.headingRad, pb.roll);

      // Alternating Police Lightbar Flash
      const flashA = Math.sin(simTime * 14 + i) > 0;
      pb.redMat.color.setRGB(flashA ? 1.0 : 0.18, flashA ? 0.12 : 0.03, flashA ? 0.16 : 0.03);
      pb.blueMat.color.setRGB(!flashA ? 0.12 : 0.04, !flashA ? 0.45 : 0.08, !flashA ? 1.0 : 0.22);
      pb.propL.rotation.z += dt * 18;
      pb.propR.rotation.z -= dt * 18;

      const playerDist = Math.hypot(pb.x - activeX, pb.z - activeZ);
      if (playerDist < closestUnitDist) closestUnitDist = playerDist;

      // Ram / Contact check against Speedboat or Ocean Liner
      if (pb.hitCooldown <= 0) {
        if (this.activeCraft === 'speedboat' && playerDist < 8.5) {
          pb.hitCooldown = 1.4;
          const nx = playerDist > 0.01 ? (this.speedboatX - pb.x) / playerDist : 1;
          const nz = playerDist > 0.01 ? (this.speedboatZ - pb.z) / playerDist : 0;
          this.speedboatX += nx * 5.0;
          this.speedboatZ += nz * 5.0;
          this.speedboatKnots *= 0.4;
          this.particles.burstIceImpact(pb.x, 1.5, pb.z, 18);
          this.sound.playCollisionImpact(0.5);
          res.eventText = this.addHeat(1, 'RAMMED COAST GUARD INTERCEPTOR');
        } else {
          // Check vs main Ocean Liner bow/mid
          const fwdX = Math.sin(shipHeading);
          const fwdZ = -Math.cos(shipHeading);
          for (const zOff of [-68, 0, 90]) {
            const hx = shipX + fwdX * -zOff;
            const hz = shipZ + fwdZ * -zOff;
            const hd = Math.hypot(pb.x - hx, pb.z - hz);
            if (hd < 21.0) {
              pb.hitCooldown = 2.2;
              const nx = hd > 0.01 ? (pb.x - hx) / hd : 1;
              const nz = hd > 0.01 ? (pb.z - hz) / hd : 0;
              pb.x = hx + nx * 24.0;
              pb.z = hz + nz * 24.0;
              this.particles.burstIceImpact(pb.x, 1.8, pb.z, 20);
              res.patrolImpactOnShip = { hitX: pb.x, hitZ: pb.z, nx: -nx, nz: -nz };
              res.eventText = this.addHeat(1, 'STRUCK COAST GUARD VESSEL');
              break;
            }
          }
        }
      }
    }

    // 3★+ Helicopter
    if (desiredChopper) {
      if (!this.chopper.active) {
        this.chopper.active = true;
        this.chopper.group.visible = true;
        this.chopper.x = activeX - 180;
        this.chopper.z = activeZ - 180;
        this.chopper.y = 38;
      }
      this.chopper.orbitAngle += dt * 0.48;
      const targetX = activeX + Math.cos(this.chopper.orbitAngle) * 52;
      const targetZ = activeZ + Math.sin(this.chopper.orbitAngle) * 52;
      this.chopper.x = MathUtils.damp(this.chopper.x, targetX, 1.8, dt);
      this.chopper.z = MathUtils.damp(this.chopper.z, targetZ, 1.8, dt);
      const targetRotY = Math.atan2(this.chopper.x - activeX, this.chopper.z - activeZ);
      this.chopper.group.position.set(this.chopper.x, this.chopper.y + Math.sin(simTime * 1.4) * 1.2, this.chopper.z);
      setEulerXYZ(this.chopper.group, -0.14, targetRotY, Math.sin(simTime * 0.9) * 0.08);
      this.chopper.mainRotor.rotation.y += dt * 28;
      this.chopper.tailRotor.rotation.x += dt * 34;

      const cDist = Math.hypot(this.chopper.x - activeX, this.chopper.z - activeZ);
      if (cDist < closestUnitDist) closestUnitDist = cDist;
    } else if (this.chopper.active) {
      this.chopper.active = false;
      this.chopper.group.visible = false;
    }

    // GTA Wanted Evasion Cooldown
    if (this.wantedLevel > 0) {
      if (closestUnitDist > 210 || (this.wantedLevel < 3 && closestUnitDist > 165)) {
        this.wantedEvading = true;
        this.evasionTimer += dt;
        this.wantedCooldownPct = Math.min(1, this.evasionTimer / 11.0);
        if (this.evasionTimer >= 11.0) {
          this.wantedLevel = 0;
          this.heatPoints = 0;
          this.wantedEvading = false;
          this.wantedCooldownPct = 0;
          this.evasionTimer = 0;
          this.cash += 500;
          this.rep += 150;
          res.scoreDelta += 500;
          res.eventText = 'HEAT EVADED +$500';
          this.sound.playNearMissChime();
          if (this.activeMission === 'evade') {
            this.completeMission(2000, 600);
          }
        }
      } else {
        this.wantedEvading = false;
        this.evasionTimer = Math.max(0, this.evasionTimer - dt * 0.65);
        this.wantedCooldownPct = Math.min(1, this.evasionTimer / 11.0);
      }
    }
  }

  private stepActiveMission(
    dt: number,
    simTime: number,
    px: number,
    pz: number,
    res: SandboxUpdateResult,
  ): void {
    if (!this.activeMission) return;

    this.missionTimeLeft -= dt;
    this.activeMissionTimerSec = Math.max(0, Math.ceil(this.missionTimeLeft));

    for (let i = 0; i < this.missionMarkers.length; i++) {
      const m = this.missionMarkers[i];
      if (m.collected) continue;
      m.ring.rotation.y = simTime * 1.4 + i;
      const dist = Math.hypot(px - m.x, pz - m.z);
      const triggerR = this.activeCraft === 'speedboat' ? 16.5 : 28.0;
      if (dist < triggerR) {
        m.collected = true;
        m.group.visible = false;
        this.missionProgress += 1;
        this.sound.playNearMissChime();
        res.scoreDelta += 250;
        this.cash += 150;

        if (this.activeMission === 'slalom') {
          this.activeMissionStep = `Thread Beacon Gates: ${this.missionProgress} / ${this.missionTarget}`;
          if (this.missionProgress >= this.missionTarget) {
            this.completeMission(1200, 300);
            return;
          }
        } else if (this.activeMission === 'rescue') {
          this.activeMissionStep = `Recover Distress Rafts: ${this.missionProgress} / ${this.missionTarget}`;
          if (this.missionProgress >= this.missionTarget) {
            this.completeMission(1500, 400);
            return;
          }
        }
      }
    }

    if (this.missionTimeLeft <= 0) {
      this.failMission();
    }
  }

  private buildRadarBlips(px: number, pz: number, input: SandboxUpdateInput): void {
    const maxRangeSq = 650 * 650;
    let count = 0;
    const pushBlip = (wx: number, wz: number, kind: RadarBlip['kind']) => {
      if (count >= this.radarBlipPool.length) return;
      const dx = wx - px;
      const dz = wz - pz;
      if (dx * dx + dz * dz > maxRangeSq) return;
      const b = this.radarBlipPool[count++];
      b.dx = dx;
      b.dz = dz;
      b.kind = kind;
    };

    // Other craft (Ship when on speedboat, Speedboat when on ship)
    if (this.activeCraft === 'speedboat') {
      pushBlip(input.shipX, input.shipZ, 'ship');
    } else {
      pushBlip(this.speedboatX, this.speedboatZ, 'speedboat');
    }

    // Active missions
    for (let i = 0; i < this.missionMarkers.length; i++) {
      const m = this.missionMarkers[i];
      if (!m.collected) pushBlip(m.x, m.z, 'mission');
    }

    // Police boats & chopper
    for (let i = 0; i < this.patrolBoats.length; i++) {
      if (this.patrolBoats[i].active) pushBlip(this.patrolBoats[i].x, this.patrolBoats[i].z, 'police');
    }
    if (this.chopper.active) {
      pushBlip(this.chopper.x, this.chopper.z, 'chopper');
    }

    // Submarines
    if (input.submarines) {
      for (let i = 0; i < input.submarines.length; i++) {
        const s = input.submarines[i];
        if (!s.sunk) pushBlip(s.x, s.z, 'sub');
      }
    }

    // Reefs or closest Icebergs
    if (input.vesselId === 'concordia') {
      for (let i = 0; i < this.reefs.length; i++) {
        pushBlip(this.reefs[i].x, this.reefs[i].z, 'hazard');
      }
    } else if (input.icebergs) {
      for (let i = 0; i < input.icebergs.length && count < this.radarBlipPool.length; i++) {
        pushBlip(input.icebergs[i].x, input.icebergs[i].z, 'hazard');
      }
    }

    this.activeBlipCount = count;
  }

  public getRadarBlips(): RadarBlip[] {
    return this.radarBlipPool.slice(0, this.activeBlipCount);
  }

  public dispose(): void {
    this.clearReefs();
    this.clearMissionMarkers();
    for (const g of this.sharedGeos) g.dispose();
    for (const m of this.sharedMats) m.dispose();
    this.sharedGeos.length = 0;
    this.sharedMats.length = 0;
    this.scene.remove(this.root);
  }
}
