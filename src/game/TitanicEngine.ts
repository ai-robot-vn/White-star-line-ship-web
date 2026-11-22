import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SoundEngine } from './audio';
import { buildCarpathiaShip, CARPATHIA_BREAK_Z, CarpathiaRig } from './carpathiaBuilder';
import {
  CruiseAwarenessContext,
  FloatingLifeboatHazard,
} from './charactersBuilder';
import { buildSouthamptonHarbor, HarborRig } from './harborBuilder';
import { IcebergEntity, IcebergFactory } from './icebergBuilder';
import {
  createOceanAndSky,
  OceanAndSkyRig,
  ParticlePool,
  sampleOceanWaveHeight,
} from './oceanAndSky';
import { buildOceanLinerShip } from './shipVariants';
import { BREAK_Z, TitanicShipRig } from './shipBuilder';
import { createProceduralTextures, ProceduralTextureSet } from './textures';
import {
  colorFromHex,
  createNorthAtlanticEnvironment,
  MathUtils,
  setEulerXYZ,
} from './threeHelpers';
import {
  AftermathFocusTarget,
  CameraMode,
  CarpathiaStage,
  DEFAULT_TELEGRAPH_INDEX,
  GamePhase,
  getEffectiveTelegraphKnots,
  getVesselSpotSpec,
  IcebergVariant,
  TARGET_VOYAGE_NM,
  TELEGRAPH_NOTCHES,
  TelemetrySnapshot,
  VESSEL_SPECS,
  VESSEL_SPOTS,
  VesselId,
  VesselSpotId,
} from './types';

// Pre-allocated math helpers (zero per-frame GC)
const _vFwd = new THREE.Vector3();
const _vRight = new THREE.Vector3();
const _vCamTarget = new THREE.Vector3();
const _vCamPos = new THREE.Vector3();
const _vLookDir = new THREE.Vector3();
const _vFocusLocal = new THREE.Vector3();
const _vFocusWorld = new THREE.Vector3();
const _vBoatWorld = new THREE.Vector3();
const _mCamRoll = new THREE.Matrix4();

const BEST_SCORE_KEY = 'titanic_bridge_best_score_v1';
const TOTAL_PATH_ICEBERGS = 2800;

const HULL_CHECK_POINTS: Array<{ zLocal: number; radius: number }> = [
  { zLocal: -72, radius: 4.2 },
  { zLocal: -54, radius: 8.8 },
  { zLocal: -32, radius: 12.6 },
  { zLocal: -6, radius: 13.8 },
  { zLocal: 45, radius: 13.9 },
  { zLocal: 105, radius: 13.8 },
  { zLocal: 155, radius: 12.0 },
  { zLocal: 184, radius: 6.5 },
];

const CARPATHIA_HULL_POINTS: Array<{ zLocal: number; radius: number }> = [
  { zLocal: -60, radius: 7.4 },
  { zLocal: 0, radius: 9.8 },
  { zLocal: 60, radius: 8.2 },
];

interface AuxVesselState {
  id: 'carpathia';
  label: string;
  hp: number;
  maxHp: number;
  status: 'intact' | 'sinking' | 'sunk';
  sinkProgress: number;
  broken: boolean;
  listDir: -1 | 1;
  groanCooldown: number;
  hitCooldown: number;
}

export class TitanicEngine {
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly fog: THREE.FogExp2;
  private readonly envRig: { envMap: THREE.Texture; dispose: () => void };
  private readonly composer: EffectComposer | null;
  private readonly bloomPass: UnrealBloomPass | null;
  private readonly outputPass: OutputPass | null;
  private readonly smaaPass: SMAAPass | null;
  private readonly isSoftwareGl: boolean;
  private readonly resizeObserver: ResizeObserver | null = null;

  private readonly textures: ProceduralTextureSet;
  private ship: TitanicShipRig;
  private selectedVessel: VesselId = 'titanic';
  private activeBreakZ = BREAK_Z;
  private readonly activeHullCheckPoints = HULL_CHECK_POINTS.map((p) => ({ ...p }));
  private readonly autopilotEvalZones = [-72, -28, 45, 145];
  private readonly autopilotEvalRadii = [5.4, 13.4, 14.2, 13.0];
  private readonly carpathia: CarpathiaRig;
  private readonly harbor: HarborRig;
  private readonly oceanAndSky: OceanAndSkyRig;
  private readonly iceFactory: IcebergFactory;
  private readonly particles: ParticlePool;
  public readonly sound: SoundEngine;

  private readonly hemiLight: THREE.HemisphereLight;
  private readonly moonKeyLight: THREE.DirectionalLight;
  private readonly rimLight: THREE.DirectionalLight;
  private readonly searchSpotLight: THREE.SpotLight;

  // Game & Simulation State
  private phase: GamePhase = 'title';
  private cameraMode: CameraMode = 'wheelhouse';
  private endlessMode = false;

  private shipX = 0;
  private shipZ = 0;
  private headingRad = 0;
  private yawRate = 0;
  private rudderDeg = 0;
  private manualRudderTarget: number | null = null;
  private wheelVisualAngle = 0;
  private rollAngle = 0;

  private telegraphIndex = DEFAULT_TELEGRAPH_INDEX;
  private speedKnots = getEffectiveTelegraphKnots('titanic', DEFAULT_TELEGRAPH_INDEX);
  private distanceNm = 0;
  private hullIntegrity = 100;
  private floodingPct = 0;
  private waterIngressRate = 0;
  private listDirection = 1;
  private sinkProgress = 0;
  private sinkDropY = 0;
  private sinkPitch = 0;
  private sinkList = 0;
  private powerLevel = 1;
  private groanCooldown = 0;
  private lifeboatsLaunched = 0;
  private aftermathSeconds = 0;
  private carpathiaStage: CarpathiaStage = 'waiting';
  private carpathiaDistanceM = 460;
  private carpathiaWhistlePlayed = false;
  private rescueCompleteWhistlePlayed = false;
  private survivorsRescued = 0;
  private boatsRecovered = 0;
  private focusCarpathia = false;
  private aftermathFocus: AftermathFocusTarget = 'lifeboats';
  private flareCooldown = 4.0;
  private score = 0;
  private bestScore = 0;
  private nearMissCount = 0;
  private combo = 1;

  // Searchlight sweep & ability
  private searchlightTimer = 0;
  private searchlightCooldown = 0;
  private readonly searchlightDuration = 5.5;
  private readonly searchlightMaxCooldown = 8.0;

  // Juice: hitstop, shake, flashes, lookouts
  private hitstopTimer = 0;
  private shakeIntensity = 0;
  private damageFlashTimer = 0;
  private eventText: string | null = null;
  private eventTimer = 0;
  private icebergWarning: string | null = null;

  // Free 360° mouse orbit, zoom & vessel focus spot / interior walk camera
  private focusSpotIndex = 0;
  private camFocusLocal = new THREE.Vector3(0, 14.78, 1.32);
  private interiorWalkOffset = new THREE.Vector3();
  private orbitYaw = 0;
  private orbitPitch = 0.085;
  private orbitDistance = 0;
  private targetOrbitYaw = 0;
  private targetOrbitPitch = 0.085;
  private targetOrbitDistance = 0;
  private userAdjustedCameraInSink = false;
  private autoFocusedSinkLifeboats = false;
  private hasBrokenInTwo = false;
  private autoFocusedBreakup = false;
  private isPointerDown = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private pointerDragDist = 0;

  // On-foot walking cadence
  private walkBobPhase = 0;
  private isWalkingOnFoot = false;

  // Dynamic 60-second Daylight-to-Darkness Sky Progression & Collision Cooldowns
  private nightMix = 0;
  private voyageElapsedSec = 0;
  private startedInNight = false;
  private rescueDawnMix = 0;
  private wheelhouseFloodLevel = 0;
  private initialIceSeeded = false;
  private readonly obstacleCooldowns = new Map<string, number>();
  private readonly floatingBoatHazards: FloatingLifeboatHazard[] = [];
  private readonly tempSkyColor = new THREE.Color();
  private readonly tempColorA = new THREE.Color();
  private readonly tempColorB = new THREE.Color();
  private readonly sceneClearColor = new THREE.Color(0x9ec4db);

  // Pre-allocated consciousness & awareness state (zero per-frame GC)
  private readonly cruiseAwareness: CruiseAwarenessContext = {};
  private bridgeOrderTimer = 0;
  private closestHazardSide = 0;
  private carpathiaAvoidX = 0;
  private carpathiaAvoidZ = 0;
  private carpathiaSteerYaw = 0;
  private carpathiaHeadingRad = 0;
  private autopilotEnabled = false;
  private autopilotTargetRudder = 0;
  private autopilotSpeedCooldown = 0;
  private bowPanicActive = false;
  private panicShoutCooldown = 0;

  private readonly carpathiaState: AuxVesselState = {
    id: 'carpathia',
    label: 'RMS CARPATHIA',
    hp: 140,
    maxHp: 140,
    status: 'intact',
    sinkProgress: 0,
    broken: false,
    listDir: -1,
    groanCooldown: 0,
    hitCooldown: 0,
  };

  // Iceberg management (thousands of GPU-instanced icebergs along the path)
  private readonly icebergs: IcebergEntity[] = [];
  private readonly nearbyAutopilotBergs: IcebergEntity[] = [];
  private sprayAccum = 0;
  private helmTickAccum = 0;

  // Input & loop state
  private readonly heldKeys = new Set<string>();
  private simTime = 0;
  private lastFrameMs = 0;
  private disposed = false;
  private telemetryAccum = 0;
  private rafId = 0;
  private softTimerId = 0;

  private readonly onTelemetry: (snap: TelemetrySnapshot) => void;
  private readonly onDamageFlash: (strength: number) => void;

  constructor(
    container: HTMLElement,
    onTelemetry: (snap: TelemetrySnapshot) => void,
    onDamageFlash: (strength: number) => void,
  ) {
    this.container = container;
    this.onTelemetry = onTelemetry;
    this.onDamageFlash = onDamageFlash;
    this.sound = new SoundEngine();

    try {
      const saved = localStorage.getItem(BEST_SCORE_KEY);
      if (saved) this.bestScore = parseInt(saved, 10) || 0;
    } catch {
      this.bestScore = 0;
    }

    // 1. Software WebGL detection
    this.isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    // 2. Pure Three.js WebGLRenderer & Canvas Setup
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.canvas.style.outline = 'none';
    container.appendChild(this.canvas);

    const width = Math.max(1, container.clientWidth || window.innerWidth);
    const height = Math.max(1, container.clientHeight || window.innerHeight);
    const pixelRatio = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      stencil: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.96;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // 3. Scene & Camera (+X starboard, +Y up, -Z bow)
    this.scene = new THREE.Scene();
    this.scene.background = this.sceneClearColor;
    this.fog = new THREE.FogExp2(0x9ec4db, 0.00095);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(62, width / height, 0.15, 1800);
    this.camera.position.set(0, 14.78, 1.32);
    this.camera.up.set(0, 1, 0);

    // 4. Calibrated Procedural North Atlantic PMREM Environment (crisp maritime sheen, zero glare hotspots)
    this.envRig = createNorthAtlanticEnvironment(this.renderer);
    this.scene.environment = this.envRig.envMap;
    this.scene.environmentIntensity = 0.45;

    // 5. Balanced 3-Point Warm/Cool Lighting (morphs cleanly from April Noon to Arctic Night)
    this.hemiLight = new THREE.HemisphereLight(0xcce7ff, 0x4d5a4f, 0.86);
    this.scene.add(this.hemiLight);

    this.moonKeyLight = new THREE.DirectionalLight(0xfff3d8, 2.05);
    this.moonKeyLight.position.set(110, 145, -240);
    this.moonKeyLight.target.position.set(0, 0, 45);
    this.scene.add(this.moonKeyLight);
    this.scene.add(this.moonKeyLight.target);

    this.rimLight = new THREE.DirectionalLight(0x9bc4e8, 0.56);
    this.rimLight.position.set(-120, 60, 100);
    this.rimLight.target.position.set(0, 0, 0);
    this.scene.add(this.rimLight);
    this.scene.add(this.rimLight.target);

    // 6. Build Assets
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy() || 4;
    this.textures = createProceduralTextures(maxAniso);

    this.oceanAndSky = createOceanAndSky(this.scene, this.isSoftwareGl);
    this.harbor = buildSouthamptonHarbor(this.scene, this.textures, this.isSoftwareGl);
    this.ship = buildOceanLinerShip(this.scene, this.textures, this.isSoftwareGl, this.selectedVessel, false);
    this.carpathia = buildCarpathiaShip(this.scene, this.textures, this.isSoftwareGl);

    // Searchlight SpotLight attached to forward bridge roof (sinks with bow half)
    this.searchSpotLight = new THREE.SpotLight(
      0xeef8ff,
      42,
      520,
      Math.PI / 9.5,
      0.48,
      1.0,
    );
    this.searchSpotLight.position.set(0, 16.25, -1.5);
    this.searchSpotLight.target = this.ship.searchlightTarget;
    this.ship.bowContent.add(this.searchSpotLight);
    this.syncActiveVesselDimensions();
    this.harbor.setActiveVessel(this.selectedVessel);

    this.iceFactory = new IcebergFactory(this.scene, this.textures, this.isSoftwareGl);
    this.particles = new ParticlePool(this.scene, 320);

    // 7. Crisp PCFSoft Shadow Map
    if (!this.isSoftwareGl) {
      this.moonKeyLight.castShadow = true;
      this.moonKeyLight.shadow.mapSize.set(1536, 1536);
      this.moonKeyLight.shadow.camera.near = 20;
      this.moonKeyLight.shadow.camera.far = 650;
      this.moonKeyLight.shadow.camera.left = -155;
      this.moonKeyLight.shadow.camera.right = 155;
      this.moonKeyLight.shadow.camera.top = 155;
      this.moonKeyLight.shadow.camera.bottom = -155;
      this.moonKeyLight.shadow.bias = -0.0005;
      this.moonKeyLight.shadow.normalBias = 0.02;

      for (const obj of this.ship.shadowCasters) {
        obj.castShadow = true;
      }
      for (const obj of this.harbor.shadowCasters) {
        obj.castShadow = true;
      }
      for (const obj of this.carpathia.shadowCasters) {
        obj.castShadow = true;
      }
    }

    // 8. World-Class Glare-Free Post-Processing Pipeline (Hardware WebGL Only)
    if (!this.isSoftwareGl) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.setPixelRatio(pixelRatio);
      this.composer.setSize(width, height);

      const renderPass = new RenderPass(this.scene, this.camera);
      this.composer.addPass(renderPass);

      // Ultra-high 0.98 threshold bloom so only true light sources glow softly — zero glare on brass or ocean
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        0.08,
        0.18,
        0.98,
      );
      this.composer.addPass(this.bloomPass);

      this.outputPass = new OutputPass();
      this.composer.addPass(this.outputPass);

      this.smaaPass = new SMAAPass();
      this.smaaPass.setSize(width * pixelRatio, height * pixelRatio);
      this.composer.addPass(this.smaaPass);

      this.renderer.compile(this.scene, this.camera);
    } else {
      this.composer = null;
      this.bloomPass = null;
      this.outputPass = null;
      this.smaaPass = null;
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.handleResize();
      });
      this.resizeObserver.observe(this.container);
    }

    // Start Title screen in bright sunlit Southampton Harbor Berth 44
    this.applyAtmosphere(0);
    this.oceanAndSky.update(0, 0, 0, 0, 0, 0, 1.0, 1.0);
    this.updateTitleCamera();
    this.oceanAndSky.updateCameraView(this.camera.position, 0);
    this.harbor.update(0, 0, 0, 0, 0, 0, 0, 0, false);

    this.bindEvents();
    this.sound.startBackgroundMusic();
    this.emitTelemetry();
    this.startLoop();
  }

  private getFairwayCenterX(z: number): number {
    // Taper smoothly from x=0 at Southampton breakwater mouth (-560) into a winding Atlantic ice corridor
    const taper = MathUtils.smoothstep(-z, 560, 860);
    return (Math.sin(z * 0.0042) * 110 + Math.cos(z * 0.0095) * 44) * taper;
  }

  private seedInitialIcebergs(): void {
    if (this.initialIceSeeded || this.icebergs.length > 0) return;
    this.clearIcebergs();

    // Stratified uniform 2D grid across X in [-1180, +1180] and Z in [-780, -4180]
    // Guarantees zero clustering, clean sea-room spacing, and a continuous navigable fairway
    const startZ = -780;
    const endZ = -4180;
    const spanZ = startZ - endZ; // 3400m
    const cols = 48;
    const rows = 62;
    const widthX = 2360;
    const cellW = widthX / cols; // ~49.2m
    const cellH = spanZ / rows; // ~54.8m
    const fairwayHalfW = 48;

    let cellIdx = 0;
    for (let row = 0; row < rows && this.icebergs.length < TOTAL_PATH_ICEBERGS; row++) {
      const zCenter = startZ - (row + 0.5) * cellH;
      const fairwayX = this.getFairwayCenterX(zCenter);

      for (let col = 0; col < cols && this.icebergs.length < TOTAL_PATH_ICEBERGS; col++) {
        cellIdx++;
        const r1 = ((Math.sin(cellIdx * 127.1 + 311.7) * 43758.5453) % 1 + 1) % 1;
        const r2 = ((Math.sin(cellIdx * 269.5 + 183.3) * 43758.5453) % 1 + 1) % 1;
        const r3 = ((Math.sin(cellIdx * 419.2 + 74.9) * 43758.5453) % 1 + 1) % 1;

        // Bounded jitter within cell so bergs never pile into clusters
        const z = zCenter + (r1 - 0.5) * (cellH * 0.48);
        let x = -widthX * 0.5 + (col + 0.5) * cellW + (r2 - 0.5) * (cellW * 0.44);

        const localFairwayX = this.getFairwayCenterX(z);
        const relToFairway = x - localFairwayX;
        if (Math.abs(relToFairway) < fairwayHalfW) {
          // Keep the main navigable channel wide open; only allow 1 sparse solo berg every ~9 rows
          const allowSoloMarker = row % 9 === 4 && col === Math.floor((localFairwayX + widthX * 0.5) / cellW);
          if (allowSoloMarker) {
            x = localFairwayX + (r3 < 0.5 ? -14 : 14);
          } else {
            // Shift cleanly to outer edge of fairway buffer without overlapping neighbor cell
            x = localFairwayX + (relToFairway >= 0 ? 1 : -1) * (fairwayHalfW + 8 + r3 * 12);
          }
        }

        // Keep Night Watch starting pocket around (0, -850) and widened harbor channel exit clear
        if (Math.hypot(x, z - -850) < 130) {
          continue;
        }
        if (z > -920 && x > -265 && x < 75) {
          continue;
        }

        // Pairwise clearance check against recent bergs in adjacent rows so zero icebergs overlap
        const variant: IcebergVariant =
          r2 < 0.42 ? 'growler' : r2 < 0.75 ? 'tabular' : 'pinnacle';
        const scale =
          variant === 'growler'
            ? 0.72 + r3 * 0.68
            : variant === 'tabular'
              ? 0.74 + r3 * 0.72
              : 0.76 + r3 * 0.78;
        const estRad = (variant === 'growler' ? 7.8 : variant === 'tabular' ? 12.2 : 10.6) * scale * 0.92;

        let overlaps = false;
        const checkStart = Math.max(0, this.icebergs.length - cols * 2);
        for (let k = checkStart; k < this.icebergs.length; k++) {
          const other = this.icebergs[k];
          const minDist = estRad + other.collisionRadius + 10.5;
          const dx = x - other.x;
          const dz = z - other.z;
          if (dx * dx + dz * dz < minDist * minDist) {
            overlaps = true;
            break;
          }
        }
        if (overlaps) continue;

        const driftVx = (r2 - 0.5) * 0.28;
        const driftVz = (r3 - 0.5) * 0.24;
        const berg = this.iceFactory.spawnIceberg(variant, x, z, scale, driftVx, driftVz);
        if (berg) {
          this.icebergs.push(berg);
        }
      }
      void fairwayX;
    }

    this.iceFactory.updateTransforms(this.icebergs, this.shipX, this.shipZ, this.simTime);
    this.initialIceSeeded = true;
  }

  private clearIcebergs(): void {
    this.iceFactory.clear();
    this.icebergs.length = 0;
    this.initialIceSeeded = false;
  }

  // =========================================================================
  // VESSEL SELECTION & PUBLIC CONTROLS FOR REACT UI & KEYBOARD
  // =========================================================================
  private syncActiveVesselDimensions(): void {
    const spec = VESSEL_SPECS[this.selectedVessel];
    this.activeBreakZ = spec.breakZ;
    const scaleBow = spec.bowZ / -74.0;
    const scaleStern = spec.sternZ / 195.1;
    const scaleBeam = spec.halfBeam / 14.0;
    for (let i = 0; i < HULL_CHECK_POINTS.length; i++) {
      const base = HULL_CHECK_POINTS[i];
      this.activeHullCheckPoints[i].zLocal = base.zLocal < 0 ? base.zLocal * scaleBow : base.zLocal * scaleStern;
      this.activeHullCheckPoints[i].radius = base.radius * scaleBeam;
    }
    this.autopilotEvalZones[0] = -72 * scaleBow;
    this.autopilotEvalZones[1] = -28 * scaleBow;
    this.autopilotEvalZones[2] = 45 * scaleStern;
    this.autopilotEvalZones[3] = 145 * scaleStern;
    this.autopilotEvalRadii[0] = 5.4 * scaleBeam;
    this.autopilotEvalRadii[1] = 13.4 * scaleBeam;
    this.autopilotEvalRadii[2] = 14.2 * scaleBeam;
    this.autopilotEvalRadii[3] = 13.0 * scaleBeam;
    this.oceanAndSky.setHullDimensions(spec.bowZ, spec.sternZ, spec.halfBeam);
  }

  public selectVessel(vesselId: VesselId, restartIfPlaying = false): void {
    if (vesselId === this.selectedVessel && !restartIfPlaying) return;
    this.sound.unlock();
    this.searchSpotLight.removeFromParent();
    this.ship.dispose();

    this.selectedVessel = vesselId;
    const spec = VESSEL_SPECS[vesselId];
    this.ship = buildOceanLinerShip(this.scene, this.textures, this.isSoftwareGl, vesselId, false);
    this.searchSpotLight.position.set(0, 16.25, -1.5);
    this.searchSpotLight.target = this.ship.searchlightTarget;
    this.ship.bowContent.add(this.searchSpotLight);
    if (!this.isSoftwareGl) {
      for (const obj of this.ship.shadowCasters) {
        obj.castShadow = true;
      }
    }

    this.syncActiveVesselDimensions();
    this.harbor.setActiveVessel(vesselId);

    if (this.phase === 'title') {
      this.shipX = spec.berthX;
      this.shipZ = spec.berthZ;
      this.headingRad = 0;
      this.speedKnots = getEffectiveTelegraphKnots(vesselId, DEFAULT_TELEGRAPH_INDEX);
      this.applyAtmosphere(0);
      this.updateShipVisualRig(0, 0);
      this.populateCruiseAwareness(true);
      this.ship.crewAndLifeboats.updateCruising(this.simTime, 0, 0, this.ship.root, this.cruiseAwareness);
      this.harbor.update(this.simTime, this.shipX, this.shipZ, 0, 0, 0, 0, 0, false);
      this.oceanAndSky.update(this.simTime, this.shipX, this.shipZ, 0, 0, 0, 1.0, 1.0);
      this.updateTitleCamera();
      this.oceanAndSky.updateCameraView(this.camera.position, 0);
      this.sound.playTelegraphBell();
      this.emitTelemetry();
    } else {
      this.beginVoyageCommon(false);
    }
  }

  private resetShipRigPose(): void {
    this.ship.hullMeshGroup.visible = true;
    this.ship.hullMeshGroup.position.set(0, 0, 0);
    this.ship.hullMeshGroup.rotation.set(0, 0, 0);
    this.ship.bowGroup.position.set(0, 0, this.activeBreakZ);
    this.ship.bowGroup.rotation.set(0, 0, 0);
    this.ship.sternGroup.position.set(0, 0, this.activeBreakZ);
    this.ship.sternGroup.rotation.set(0, 0, 0);
    this.ship.setBreakupVisual(false, 0);
    this.ship.setSearchlightBeam(1, false);
    this.ship.crewAndLifeboats.reset();
    this.carpathia.reset();
    this.carpathia.root.visible = false;
    this.resetAuxVesselState(this.carpathiaState);
    this.aftermathSeconds = 0;
    this.carpathiaStage = 'waiting';
    this.carpathiaDistanceM = 460;
    this.carpathiaWhistlePlayed = false;
    this.rescueCompleteWhistlePlayed = false;
    this.survivorsRescued = 0;
    this.boatsRecovered = 0;
    this.focusCarpathia = false;
    this.aftermathFocus = 'lifeboats';
    this.flareCooldown = 4.0;
    this.rescueDawnMix = 0;
    this.wheelhouseFloodLevel = 0;
    this.carpathiaAvoidX = 0;
    this.carpathiaAvoidZ = 0;
    this.carpathiaSteerYaw = 0;
    this.carpathiaHeadingRad = 0;
  }

  private resetAuxVesselState(st: AuxVesselState): void {
    st.hp = st.maxHp;
    st.status = 'intact';
    st.sinkProgress = 0;
    st.broken = false;
    st.groanCooldown = 0;
    st.hitCooldown = 0;
  }

  private beginVoyageCommon(startInNightIceAlley: boolean): void {
    this.sound.unlock();
    this.clearIcebergs();
    this.obstacleCooldowns.clear();
    this.phase = 'playing';
    this.endlessMode = false;
    this.headingRad = 0;
    this.yawRate = 0;
    this.rudderDeg = 0;
    this.manualRudderTarget = null;
    this.wheelVisualAngle = 0;
    this.rollAngle = 0;
    this.distanceNm = 0;
    this.hullIntegrity = 100;
    this.floodingPct = 0;
    this.waterIngressRate = 0;
    this.listDirection = 1;
    this.sinkProgress = 0;
    this.sinkDropY = 0;
    this.sinkPitch = 0;
    this.sinkList = 0;
    this.powerLevel = 1;
    this.groanCooldown = 0;
    this.lifeboatsLaunched = 0;
    this.score = 0;
    this.nearMissCount = 0;
    this.combo = 1;
    this.searchlightTimer = 0;
    this.searchlightCooldown = 0;
    this.hitstopTimer = 0;
    this.shakeIntensity = 0;
    this.damageFlashTimer = 0;
    this.icebergWarning = null;
    this.userAdjustedCameraInSink = false;
    this.autoFocusedSinkLifeboats = false;
    this.hasBrokenInTwo = false;
    this.autoFocusedBreakup = false;
    this.bridgeOrderTimer = 0;
    this.closestHazardSide = 0;
    this.autopilotEnabled = false;
    this.autopilotTargetRudder = 0;
    this.autopilotSpeedCooldown = 0;
    this.bowPanicActive = false;
    this.panicShoutCooldown = 0;

    this.resetShipRigPose();
    this.harbor.setActiveVessel(this.selectedVessel);
    this.harbor.resetEscorts();

    const spec = VESSEL_SPECS[this.selectedVessel];
    this.telegraphIndex = DEFAULT_TELEGRAPH_INDEX;
    this.speedKnots = getEffectiveTelegraphKnots(this.selectedVessel, DEFAULT_TELEGRAPH_INDEX);
    this.voyageElapsedSec = startInNightIceAlley ? 60.0 : 0.0;
    this.startedInNight = startInNightIceAlley;

    if (startInNightIceAlley) {
      this.shipX = 0;
      this.shipZ = -850;
      this.harbor.root.visible = false;
      this.applyAtmosphere(1.0);
      this.ship.setPowerLevel(1);
      this.seedInitialIcebergs();
      this.eventText = `${spec.name.toUpperCase()} · APRIL 14 NIGHT WATCH — ICE FIELD AHEAD`;
    } else {
      // Dock-Start Direct Control right at active Berth (44 / 40 / 38)
      this.shipX = spec.berthX;
      this.shipZ = spec.berthZ;
      this.harbor.root.visible = true;
      this.applyAtmosphere(0);
      this.seedInitialIcebergs();
      this.harbor.update(
        this.simTime,
        this.shipX,
        this.shipZ,
        this.headingRad,
        this.speedKnots,
        this.floodingPct,
        0,
        0,
        false,
      );
      this.eventText = `${spec.name.toUpperCase()} · ${spec.berthLabel.toUpperCase()} — CLEAR BREAKWATERS INTO THE ICE FIELD`;
      this.sound.playSteamWhistle();
    }

    this.eventTimer = 3.6;
    this.ship.setWheelhouseFloodLevel(0);
    this.focusVesselSpot('wheelhouse', false);
    this.sound.playTelegraphBell();
    this.emitTelemetry();
  }

  public startGame(): void {
    this.beginVoyageCommon(false);
  }

  public startNightVoyage(): void {
    this.beginVoyageCommon(true);
  }

  public togglePause(): void {
    if (this.phase === 'playing') {
      this.phase = 'paused';
      this.heldKeys.clear();
      this.emitTelemetry();
    } else if (this.phase === 'paused') {
      this.phase = 'playing';
      this.emitTelemetry();
    }
  }

  public continueEndless(): void {
    if (this.phase === 'victory') {
      this.endlessMode = true;
      this.phase = 'playing';
      this.eventText = 'ENDLESS NIGHT WATCH';
      this.eventTimer = 2.6;
      this.emitTelemetry();
    }
  }

  public skipSinking(): void {
    if (this.phase === 'sinking') {
      this.sinkProgress = 1;
      this.hasBrokenInTwo = true;
      this.ship.setBreakupVisual(true, 0);
      this.ship.bowGroup.position.y = -72;
      this.ship.bowGroup.rotation.x = -0.76;
      this.ship.sternGroup.position.y = -138;
      this.ship.sternGroup.rotation.x = -1.46;
      this.ship.setPowerLevel(0);
      this.ship.setSearchlightBeam(0, false);
      this.ship.hullMeshGroup.visible = false;
      this.lifeboatsLaunched = this.ship.crewAndLifeboats.updateSinking(
        this.simTime,
        0.016,
        1.0,
        this.ship.root,
      );
      this.enterAftermath();
    }
  }

  public openVoyageReport(): void {
    if (this.phase === 'aftermath') {
      this.phase = 'gameover';
      this.emitTelemetry();
    }
  }

  public closeVoyageReportToAftermath(): void {
    if (this.phase === 'gameover') {
      this.phase = 'aftermath';
      this.emitTelemetry();
    }
  }

  public fastForwardRescueWait(): void {
    if (this.phase === 'aftermath' && this.carpathiaStage === 'waiting') {
      this.aftermathSeconds = Math.max(this.aftermathSeconds, 58.0);
      this.emitTelemetry();
    }
  }

  public focusAftermathTarget(target: AftermathFocusTarget): void {
    if (this.phase !== 'aftermath' && this.phase !== 'gameover') return;
    if (target === 'carpathia' && !this.carpathia.root.visible) {
      this.aftermathFocus = 'lifeboats';
    } else {
      this.aftermathFocus = target;
    }
    this.focusCarpathia = this.aftermathFocus === 'carpathia';
    if (this.aftermathFocus === 'carpathia') {
      this.targetOrbitYaw = 0.85;
      this.targetOrbitPitch = 0.16;
      this.targetOrbitDistance = 122;
    } else {
      this.targetOrbitYaw = 0.72;
      this.targetOrbitPitch = 0.22;
      this.targetOrbitDistance = 135;
    }
    this.emitTelemetry();
  }

  public focusOnCarpathia(enable: boolean): void {
    this.focusAftermathTarget(enable ? 'carpathia' : 'lifeboats');
  }

  private enterAftermath(): void {
    this.phase = 'aftermath';
    this.ship.hullMeshGroup.visible = false;
    this.aftermathSeconds = 0;
    this.carpathiaStage = 'waiting';
    this.carpathiaDistanceM = 460;
    this.carpathiaWhistlePlayed = false;
    this.rescueCompleteWhistlePlayed = false;
    this.survivorsRescued = 0;
    this.boatsRecovered = 0;
    this.focusCarpathia = false;
    this.aftermathFocus = 'lifeboats';
    this.flareCooldown = 3.5;
    this.carpathia.root.visible = false;
    if (VESSEL_SPOTS[this.focusSpotIndex].id === 'wheelhouse') {
      this.focusVesselSpot('funnels', false);
    }
    this.eventText = `${VESSEL_SPECS[this.selectedVessel].name.toUpperCase()} SUBMERGED — WAIT FOR RMS CARPATHIA IN THE ICE FIELD`;
    this.eventTimer = 5.5;
    this.saveBestScore();
    this.emitTelemetry();
  }

  public returnToTitle(): void {
    this.phase = 'title';
    this.heldKeys.clear();
    this.clearIcebergs();
    this.obstacleCooldowns.clear();
    const spec = VESSEL_SPECS[this.selectedVessel];
    this.shipX = spec.berthX;
    this.shipZ = spec.berthZ;
    this.headingRad = 0;
    this.rudderDeg = 0;
    this.telegraphIndex = DEFAULT_TELEGRAPH_INDEX;
    this.speedKnots = getEffectiveTelegraphKnots(this.selectedVessel, DEFAULT_TELEGRAPH_INDEX);
    this.hullIntegrity = 100;
    this.floodingPct = 0;
    this.waterIngressRate = 0;
    this.sinkProgress = 0;
    this.sinkDropY = 0;
    this.sinkPitch = 0;
    this.sinkList = 0;
    this.powerLevel = 1;
    this.lifeboatsLaunched = 0;
    this.userAdjustedCameraInSink = false;
    this.autoFocusedSinkLifeboats = false;
    this.hasBrokenInTwo = false;
    this.autoFocusedBreakup = false;
    this.focusSpotIndex = 0;
    this.autopilotEnabled = false;
    this.autopilotTargetRudder = 0;
    this.autopilotSpeedCooldown = 0;
    this.bowPanicActive = false;
    this.panicShoutCooldown = 0;
    this.harbor.root.visible = true;
    this.harbor.setActiveVessel(this.selectedVessel);
    this.harbor.resetEscorts();
    this.voyageElapsedSec = 0;
    this.startedInNight = false;
    this.applyAtmosphere(0);
    this.resetShipRigPose();
    this.ship.setWheelhouseFloodLevel(0);
    this.focusVesselSpot('wheelhouse', false);
    this.emitTelemetry();
  }

  public toggleAutopilot(): void {
    this.sound.unlock();
    if (this.phase !== 'playing') return;
    this.autopilotEnabled = !this.autopilotEnabled;
    this.manualRudderTarget = null;
    this.autopilotSpeedCooldown = 0;
    this.sound.playAutopilotChime(this.autopilotEnabled);
    if (this.autopilotEnabled) {
      this.bridgeOrderTimer = 1.6;
      this.eventText = 'AUTOPILOT ENGAGED — WHEELHOUSE CREW AT THE HELM';
    } else {
      this.eventText = 'AUTOPILOT DISENGAGED — MANUAL HELM CONTROL';
    }
    this.eventTimer = 2.6;
    this.emitTelemetry();
  }

  public setTelegraphIndex(idx: number): void {
    this.sound.unlock();
    const clamped = Math.max(0, Math.min(TELEGRAPH_NOTCHES.length - 1, idx));
    if (clamped !== this.telegraphIndex) {
      this.telegraphIndex = clamped;
      this.bridgeOrderTimer = 1.85;
      this.sound.playTelegraphBell();
      this.eventText = TELEGRAPH_NOTCHES[clamped].label;
      this.eventTimer = 1.6;
      this.emitTelemetry();
    }
  }

  public stepTelegraph(delta: number): void {
    this.setTelegraphIndex(this.telegraphIndex + delta);
  }

  public setManualRudder(deg: number | null): void {
    this.sound.unlock();
    this.manualRudderTarget = deg === null ? null : MathUtils.clamp(deg, -35, 35);
  }

  public triggerSearchlight(): void {
    this.sound.unlock();
    if (this.phase !== 'playing') return;
    if (this.searchlightTimer > 0 || this.searchlightCooldown > 0) return;
    this.searchlightTimer = this.searchlightDuration;
    this.sound.playSteamWhistle();
    this.eventText = 'SEARCHLIGHT SWEEP & WHISTLE';
    this.eventTimer = 2.0;
    this.emitTelemetry();
  }

  public focusVesselSpot(spotId: VesselSpotId, announce = true): void {
    const idx = VESSEL_SPOTS.findIndex((s) => s.id === spotId);
    if (idx === -1) return;
    this.focusSpotIndex = idx;
    const spec = getVesselSpotSpec(this.selectedVessel, VESSEL_SPOTS[idx].id);
    this.interiorWalkOffset.set(0, 0, 0);
    this.targetOrbitYaw = spec.defaultOrbitYaw;
    this.targetOrbitPitch = spec.defaultOrbitPitch;
    this.targetOrbitDistance = spec.defaultDistance;
    if (announce) {
      this.camFocusLocal.set(spec.localTarget[0], spec.localTarget[1], spec.localTarget[2]);
      this.orbitYaw = this.targetOrbitYaw;
      this.orbitPitch = this.targetOrbitPitch;
      this.orbitDistance = this.targetOrbitDistance;
    }
    this.cameraMode = spec.id === 'wheelhouse' ? 'wheelhouse' : 'bridgeWing';

    if (this.phase === 'sinking' && announce) {
      this.userAdjustedCameraInSink = true;
    }
    if (announce && this.phase === 'playing') {
      this.eventText = `${spec.category === 'interior' ? 'INTERIOR' : 'STATION'}: ${spec.label.toUpperCase()}`;
      this.eventTimer = 1.8;
    }
    this.emitTelemetry();
  }

  public cycleFocusSpot(): void {
    const nextIdx = (this.focusSpotIndex + 1) % VESSEL_SPOTS.length;
    this.focusVesselSpot(VESSEL_SPOTS[nextIdx].id, true);
  }

  public toggleCameraMode(): void {
    if (VESSEL_SPOTS[this.focusSpotIndex].id === 'wheelhouse') {
      this.focusVesselSpot('funnels', true);
    } else {
      this.focusVesselSpot('wheelhouse', true);
    }
  }

  public toggleMute(): void {
    this.sound.unlock();
    this.sound.toggleMute();
    this.emitTelemetry();
  }

  public toggleMusicMute(): void {
    this.sound.unlock();
    this.sound.toggleMusicMuted();
    this.emitTelemetry();
  }

  // =========================================================================
  // INPUT & WINDOW EVENTS
  // =========================================================================
  private readonly handleKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    const code = e.code;

    if (code === 'Escape' || code === 'KeyP') {
      if (this.phase === 'playing' || this.phase === 'paused') {
        this.togglePause();
      }
      return;
    }

    if (code === 'KeyM') {
      this.toggleMute();
      return;
    }

    if (this.phase === 'title') {
      if (code === 'Enter' || code === 'Space') {
        e.preventDefault();
        this.startGame();
      }
      return;
    }

    if (this.phase === 'gameover' || this.phase === 'victory' || this.phase === 'aftermath') {
      this.heldKeys.add(code);
      if (code === 'Enter') {
        e.preventDefault();
        this.startGame();
      } else if (code === 'KeyV') {
        e.preventDefault();
        this.cycleFocusSpot();
      } else if (code === 'KeyC') {
        this.toggleCameraMode();
      }
      return;
    }

    if (this.phase === 'sinking') {
      this.heldKeys.add(code);
      if (code === 'KeyV') {
        e.preventDefault();
        this.cycleFocusSpot();
      } else if (code === 'KeyC') {
        this.toggleCameraMode();
      } else if (code === 'Enter' || code === 'Space') {
        e.preventDefault();
        this.skipSinking();
      }
      return;
    }

    if (this.phase !== 'playing') return;

    this.heldKeys.add(code);

    if (code === 'KeyZ' || code === 'ArrowUp') {
      e.preventDefault();
      this.stepTelegraph(1);
    } else if (code === 'KeyX' || code === 'ArrowDown') {
      e.preventDefault();
      this.stepTelegraph(-1);
    } else if (code === 'KeyT') {
      e.preventDefault();
      this.toggleAutopilot();
    } else if (code === 'KeyV') {
      e.preventDefault();
      this.cycleFocusSpot();
    } else if (code === 'Space') {
      e.preventDefault();
      this.triggerSearchlight();
    } else if (code === 'KeyC') {
      this.toggleCameraMode();
    }
  };

  private readonly handleKeyUp = (e: KeyboardEvent) => {
    this.heldKeys.delete(e.code);
  };

  private readonly handleBlur = () => {
    this.heldKeys.clear();
    this.isPointerDown = false;
  };

  private readonly handlePointerDown = (e: PointerEvent) => {
    if (this.phase === 'title' || this.phase === 'paused') return;
    this.sound.unlock();
    this.isPointerDown = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.pointerDragDist = 0;
  };

  private readonly handlePointerMove = (e: PointerEvent) => {
    if (!this.isPointerDown || this.phase === 'title' || this.phase === 'paused') return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.pointerDragDist += Math.hypot(dx, dy);
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.targetOrbitYaw -= dx * 0.0062;
    this.targetOrbitPitch = MathUtils.clamp(
      this.targetOrbitPitch + dy * 0.0045,
      -0.85,
      1.18,
    );
    if (this.phase === 'sinking') {
      this.userAdjustedCameraInSink = true;
    }
  };

  private readonly handlePointerUp = () => {
    this.isPointerDown = false;
  };

  private readonly handleWheel = (e: WheelEvent) => {
    if (this.phase === 'title' || this.phase === 'paused') return;
    e.preventDefault();
    const minDist = VESSEL_SPOTS[this.focusSpotIndex].minDistance;
    const step = e.deltaY * 0.045;
    this.targetOrbitDistance = MathUtils.clamp(
      this.targetOrbitDistance + step,
      minDist,
      260,
    );
    if (this.phase === 'sinking') {
      this.userAdjustedCameraInSink = true;
    }
  };

  private readonly handleResize = () => {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(1, this.container.clientHeight || window.innerHeight);
    const pr = this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 1.5);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(width, height, false);

    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(width, height);
      this.bloomPass?.resolution.set(width, height);
      this.smaaPass?.setSize(width * pr, height * pr);
    }
  };

  private readonly handleFirstGesture = () => {
    this.sound.unlock();
  };

  private bindEvents(): void {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('pointerdown', this.handleFirstGesture, { once: true, passive: true });
    window.addEventListener('keydown', this.handleFirstGesture, { once: true, passive: true });
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
  }

  private unbindEvents(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('pointerdown', this.handleFirstGesture);
    window.removeEventListener('keydown', this.handleFirstGesture);
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
  }

  // =========================================================================
  // MAIN SIMULATION & PACED RENDER LOOP
  // =========================================================================
  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = typeof gl.fenceSync === 'function'
      ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
      : null;

    if (!sync) {
      this.softTimerId = window.setTimeout(() => {
        if (!this.disposed) cb();
      }, 80);
      return;
    }

    gl.flush();
    const poll = () => {
      if (this.disposed) {
        gl.deleteSync(sync);
        return;
      }
      const status = gl.clientWaitSync(sync, 0, 0);
      if (status === gl.WAIT_FAILED || status === gl.TIMEOUT_EXPIRED) {
        this.softTimerId = window.setTimeout(poll, 5);
      } else {
        gl.deleteSync(sync);
        this.softTimerId = window.setTimeout(() => {
          if (!this.disposed) cb();
        }, 80);
      }
    };
    this.softTimerId = window.setTimeout(poll, 5);
  }

  private renderFrame(): void {
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private startLoop(): void {
    this.lastFrameMs = performance.now();

    const tick = () => {
      if (this.disposed) return;

      const now = performance.now();
      const rawDt = Math.max(0.0001, (now - this.lastFrameMs) / 1000);
      this.lastFrameMs = now;
      const dt = Math.min(rawDt, 0.05);

      this.stepSimulation(dt);
      this.renderFrame();

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.rafId = requestAnimationFrame(tick);
      }
    };

    if (this.isSoftwareGl) {
      this.renderFrame();
      this.afterDraw(tick);
    } else {
      this.rafId = requestAnimationFrame(tick);
    }
  }

  private stepSimulation(dt: number): void {
    if (this.phase === 'paused') {
      this.sound.updateShipAmbience(0, false);
      this.sound.setMusicDucked(true);
      return;
    }
    this.sound.setMusicDucked(false);

    // Hitstop freeze for heavy collision impact feel
    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - dt);
      this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 1.4);
      this.updateCamera(dt);
      return;
    }

    this.simTime += dt;

    if (this.damageFlashTimer > 0) {
      this.damageFlashTimer = Math.max(0, this.damageFlashTimer - dt);
      this.onDamageFlash(this.damageFlashTimer / 0.45);
    }

    if (this.eventTimer > 0) {
      this.eventTimer -= dt;
      if (this.eventTimer <= 0) this.eventText = null;
    }

    if (this.bridgeOrderTimer > 0) {
      this.bridgeOrderTimer = Math.max(0, this.bridgeOrderTimer - dt);
    }

    if (this.phase === 'title') {
      // Sunlit Southampton Harbor moored beauty pan on Title Screen
      this.applyAtmosphere(0);
      this.rudderDeg = Math.sin(this.simTime * 0.35) * 4;
      this.wheelVisualAngle = MathUtils.damp(this.wheelVisualAngle, -this.rudderDeg * 0.11, 5, dt);
      this.ship.helmWheel.rotation.z = this.wheelVisualAngle;
      this.updateShipVisualRig(dt, 0);
      this.populateCruiseAwareness(true);
      this.ship.crewAndLifeboats.updateCruising(this.simTime, dt, 0, this.ship.root, this.cruiseAwareness);
      this.harbor.update(this.simTime, this.shipX, this.shipZ, this.headingRad, 0, 0, 0, dt, false);
      this.emitBowSpray(dt, 0, -1, true);
      this.oceanAndSky.update(
        this.simTime,
        this.shipX,
        this.shipZ,
        0,
        0,
        0,
        1.0,
        1.0,
      );
      this.particles.update(dt);
      this.updateTitleCamera();
      this.syncUnderwaterCameraEffects(0, dt);
      this.sound.updateShipAmbience(2, false);
      return;
    }

    if (this.phase === 'sinking') {
      this.stepSinkingSequence(dt);
      return;
    }

    if (this.phase === 'aftermath') {
      this.stepAftermathSequence(dt);
      return;
    }

    if (this.phase === 'victory' || this.phase === 'gameover') {
      this.speedKnots = MathUtils.damp(this.speedKnots, 0, 1.2, dt);
      this.shipZ -= this.speedKnots * 1.5 * dt * Math.cos(this.headingRad);
      this.shipX += this.speedKnots * 1.5 * dt * Math.sin(this.headingRad);
      this.updateShipVisualRig(dt, this.speedKnots);
      if (this.phase === 'victory') {
        this.populateCruiseAwareness(false);
        this.ship.crewAndLifeboats.updateCruising(
          this.simTime,
          dt,
          this.floodingPct,
          this.ship.root,
          this.cruiseAwareness,
        );
      } else {
        this.advanceRescueSimulation(dt);
        this.checkAuxVesselCollisions(dt);
      }
      this.iceFactory.updateTransforms(this.icebergs, this.shipX, this.shipZ, this.simTime);
      this.applyAtmosphere(1.0, this.phase === 'gameover' ? this.rescueDawnMix : 0);
      this.oceanAndSky.update(
        this.simTime,
        this.shipX,
        this.shipZ,
        this.headingRad,
        this.speedKnots,
        1.0,
        this.phase === 'victory' ? 1.0 : 0.0,
        this.phase === 'victory' ? 1.0 : 0.0,
      );
      this.particles.update(dt);
      this.updateCamera(dt);
      this.syncUnderwaterCameraEffects(1.0, dt);
      this.sound.updateShipAmbience(this.speedKnots, false);
      return;
    }

    // =======================================================================
    // ACTIVE GAMEPLAY SIMULATION (Direct Control / Autopilot -> Channel -> Night)
    // =======================================================================
    const prevRudder = this.rudderDeg;
    if (this.autopilotEnabled) {
      this.computeAutopilotCommand(dt);
      this.rudderDeg = MathUtils.damp(this.rudderDeg, this.autopilotTargetRudder, 5.2, dt);
    } else {
      const steerLeft = this.heldKeys.has('ArrowLeft') || this.heldKeys.has('KeyQ');
      const steerRight = this.heldKeys.has('ArrowRight') || this.heldKeys.has('KeyE');

      if (steerLeft && !steerRight) {
        this.manualRudderTarget = null;
        this.rudderDeg = Math.max(-35, this.rudderDeg - 52 * dt);
      } else if (steerRight && !steerLeft) {
        this.manualRudderTarget = null;
        this.rudderDeg = Math.min(35, this.rudderDeg + 52 * dt);
      } else if (this.manualRudderTarget !== null) {
        this.rudderDeg = MathUtils.damp(this.rudderDeg, this.manualRudderTarget, 7, dt);
      } else {
        // Gently relax rudder back toward amidships when keys released
        this.rudderDeg = MathUtils.damp(this.rudderDeg, 0, 1.8, dt);
      }
    }

    if (this.bowPanicActive) {
      this.panicShoutCooldown -= dt;
      if (this.panicShoutCooldown <= 0) {
        this.panicShoutCooldown = 2.6 + Math.random() * 2.2;
        this.sound.playPanicShoutBurst();
      }
    }

    // Subtle mechanical helm spoke sound when steering actively
    if (Math.abs(this.rudderDeg - prevRudder) > 0.1) {
      this.helmTickAccum += Math.abs(this.rudderDeg - prevRudder);
      if (this.helmTickAccum > 9) {
        this.helmTickAccum = 0;
        this.sound.playHelmTick();
      }
    }

    // W / A / S / D & I / J / K / L Smooth Interior & Deck Walking
    this.stepInteriorWalk(dt);

    // Telegraph speed interpolation (responsive liner momentum per vessel class)
    const targetKnots = getEffectiveTelegraphKnots(this.selectedVessel, this.telegraphIndex);
    const accelRate = targetKnots < this.speedKnots ? 0.75 : 0.62;
    this.speedKnots = MathUtils.damp(this.speedKnots, targetKnots, accelRate, dt);

    // Rudder authority scales with speed (with low-speed tug/thruster nudge so dock maneuvering works cleanly)
    const speedAuthority = 0.36 + 0.64 * Math.min(1, Math.abs(this.speedKnots) / 20);
    const reverseSign = this.speedKnots < -1 ? -0.65 : 1;
    const turnMult = VESSEL_SPECS[this.selectedVessel].turnMultiplier;
    const targetYawRate = (this.rudderDeg / 35) * 0.36 * speedAuthority * reverseSign * turnMult;
    this.yawRate = MathUtils.damp(this.yawRate, targetYawRate, 2.4, dt);
    this.headingRad += this.yawRate * dt;

    // Move ship along heading
    const worldSpeed = this.speedKnots * 2.15; // units/sec
    const fwdX = Math.sin(this.headingRad);
    const fwdZ = -Math.cos(this.headingRad);
    this.shipX += fwdX * worldSpeed * dt;
    this.shipZ += fwdZ * worldSpeed * dt;

    // Progress Nautical Miles & Score rapidly toward destination
    if (this.speedKnots > 0.2) {
      const distStep = worldSpeed * dt;
      const nmDelta = distStep / 400;
      this.distanceNm += nmDelta;
      this.score += nmDelta * (120 + this.speedKnots * 6);
    }

    // Exact 60-second (1-minute) daylight -> golden sunset -> twilight -> starry night sky transition
    this.voyageElapsedSec += dt;
    const skyMix = this.startedInNight
      ? 1.0
      : MathUtils.smoothstep(this.voyageElapsedSec, 0, 60.0);
    const harborActive = Math.hypot(this.shipX, this.shipZ) < 1350;
    this.harbor.root.visible = harborActive;
    if (harborActive) {
      this.harbor.update(
        this.simTime,
        this.shipX,
        this.shipZ,
        this.headingRad,
        this.speedKnots,
        this.floodingPct,
        skyMix,
        dt,
        true,
      );
      this.processHarborBreakEvents();
    }

    // Searchlight sweep timers
    if (this.searchlightTimer > 0) {
      this.searchlightTimer -= dt;
      if (this.searchlightTimer <= 0) {
        this.searchlightTimer = 0;
        this.searchlightCooldown = this.searchlightMaxCooldown;
      }
    } else if (this.searchlightCooldown > 0) {
      this.searchlightCooldown = Math.max(0, this.searchlightCooldown - dt);
    }

    // Slow, resilient progressive water ingress only after serious compartment breaches
    if (this.hullIntegrity <= 78) {
      const damageSeverity = (80 - this.hullIntegrity) / 80; // 0.025 -> 1.0
      this.waterIngressRate = 0.28 + damageSeverity * damageSeverity * 1.35;
      this.floodingPct = Math.min(100, this.floodingPct + this.waterIngressRate * dt);
    } else {
      this.waterIngressRate = 0;
    }

    const floodNorm = this.floodingPct / 100;
    this.sinkDropY = -floodNorm * 2.2;
    this.sinkPitch = -floodNorm * 0.088;
    this.sinkList = this.listDirection * floodNorm * 0.095;
    this.wheelhouseFloodLevel = floodNorm > 0.78 ? ((floodNorm - 0.78) / 0.22) * 0.14 : 0;

    // Update Ship Transforms, Crew, Wheel, Telegraph, Bow Spray & Light Rig
    this.updateShipVisualRig(dt, this.speedKnots);
    this.populateCruiseAwareness(skyMix < 0.45);
    this.ship.crewAndLifeboats.updateCruising(
      this.simTime,
      dt,
      this.floodingPct,
      this.ship.root,
      this.cruiseAwareness,
    );
    this.emitBowSpray(dt, fwdX, fwdZ);
    this.applyAtmosphere(skyMix);
    this.oceanAndSky.update(
      this.simTime,
      this.shipX,
      this.shipZ,
      this.headingRad,
      this.speedKnots,
      skyMix,
      1.0,
      1.0,
    );

    // Seed & continuously stream thousands of GPU-instanced icebergs ahead along the path
    if (!this.initialIceSeeded && this.icebergs.length === 0) {
      this.seedInitialIcebergs();
    }
    this.manageIcebergField(dt, worldSpeed, fwdX, fwdZ);

    // Check Collisions with ALL Objects (Tugs, Pilot Vessel, Lifeboats, Quay, Breakwater, Buoys, Icebergs)
    this.checkAllObstacles(dt, fwdX, fwdZ);
    this.checkAuxVesselCollisions(dt);

    this.particles.update(dt);
    this.shakeIntensity = Math.max(0, this.shakeIntensity - dt * 1.9);

    this.updateCamera(dt);
    this.syncUnderwaterCameraEffects(skyMix, dt);
    this.sound.updateShipAmbience(this.speedKnots, true);

    // Check Sinking Trigger (Hull Breached OR Water Overwhelms Bulkheads)
    if (this.hullIntegrity <= 0 || this.floodingPct >= 100) {
      this.triggerSinking();
      return;
    }

    if (!this.endlessMode && this.distanceNm >= TARGET_VOYAGE_NM) {
      this.distanceNm = TARGET_VOYAGE_NM;
      this.score += Math.round(this.hullIntegrity * 25);
      this.phase = 'victory';
      this.saveBestScore();
      this.sound.playSteamWhistle();
      this.emitTelemetry();
      return;
    }

    // Throttled telemetry emission (~12 Hz)
    this.telemetryAccum += dt;
    if (this.telemetryAccum >= 0.08) {
      this.telemetryAccum = 0;
      this.emitTelemetry();
    }
  }

  private populateCruiseAwareness(harborNear: boolean): void {
    this.cruiseAwareness.shipRoll = this.rollAngle;
    this.cruiseAwareness.shipPitch = this.ship.bowGroup.rotation.x;
    this.cruiseAwareness.harborNear = harborNear;
    this.cruiseAwareness.hazardSide = this.closestHazardSide;
    this.cruiseAwareness.bridgeOrderActive = this.bridgeOrderTimer > 0;
    this.cruiseAwareness.autopilotActive = this.autopilotEnabled && this.phase === 'playing';
    this.cruiseAwareness.rudderDeg = this.rudderDeg;
    this.cruiseAwareness.bowPanicActive = this.bowPanicActive && this.phase === 'playing';
    if (this.orbitDistance < 24) {
      this.cruiseAwareness.playerLocalX = this.camFocusLocal.x;
      this.cruiseAwareness.playerLocalY = this.camFocusLocal.y;
      this.cruiseAwareness.playerLocalZ = this.camFocusLocal.z;
    } else {
      this.cruiseAwareness.playerLocalX = undefined;
      this.cruiseAwareness.playerLocalY = undefined;
      this.cruiseAwareness.playerLocalZ = undefined;
    }
  }

  private computeAutopilotCommand(dt: number): void {
    // 10.5-second multi-arc trajectory lookahead over 15 rudder candidates (zero per-frame GC)
    const horizonSteps = 14;
    const stepDt = 0.75;
    const rDamp = 1 - Math.exp(-5.2 * stepDt);
    const yDamp = 1 - Math.exp(-2.4 * stepDt);

    const effectiveKnots =
      Math.abs(this.speedKnots) < 2.5 ? 10 : this.speedKnots;
    const simSpeed = effectiveKnots * 2.15;
    const speedAuthority = 0.36 + 0.64 * Math.min(1, Math.abs(effectiveKnots) / 20);
    const reverseSign = effectiveKnots < -1 ? -0.65 : 1;

    const harborActive = this.harbor.root.visible;
    const circleObs = harborActive ? this.harbor.getCircleObstacles() : null;
    const boxObs = harborActive ? this.harbor.getBoxObstacles() : null;

    // Spatial pre-filter so autopilot scans only nearby icebergs out of the 2,800-berg field
    this.nearbyAutopilotBergs.length = 0;
    for (let i = 0; i < this.icebergs.length; i++) {
      const berg = this.icebergs[i];
      if (Math.abs(berg.z - this.shipZ) < 560 && Math.abs(berg.x - this.shipX) < 360) {
        this.nearbyAutopilotBergs.push(berg);
      }
    }

    let bestDeg = 0;
    let bestScore = -Infinity;
    let bestMinClearance = 999;

    const evalZones = this.autopilotEvalZones;
    const evalRadii = this.autopilotEvalRadii;
    const turnMult = VESSEL_SPECS[this.selectedVessel].turnMultiplier;

    for (let candDeg = -35; candDeg <= 35; candDeg += 5) {
      let sx = this.shipX;
      let sz = this.shipZ;
      let sh = this.headingRad;
      let syr = this.yawRate;
      let sr = this.rudderDeg;

      let minClear = 999;
      let penalty = 0;

      for (let step = 1; step <= horizonSteps; step++) {
        const tSim = step * stepDt;
        sr += (candDeg - sr) * rDamp;
        const targetYr = (sr / 35) * 0.36 * speedAuthority * reverseSign * turnMult;
        syr += (targetYr - syr) * yDamp;
        sh += syr * stepDt;

        const fx = Math.sin(sh);
        const fz = -Math.cos(sh);
        sx += fx * simSpeed * stepDt;
        sz += fz * simSpeed * stepDt;

        // Check nearby drifting icebergs along predicted path
        for (let bIdx = 0; bIdx < this.nearbyAutopilotBergs.length; bIdx++) {
          const berg = this.nearbyAutopilotBergs[bIdx];
          const bx = berg.x + berg.vx * tSim;
          const bz = berg.z + berg.vz * tSim;
          const req = berg.collisionRadius + 16.5;

          for (let h = 0; h < 4; h++) {
            const px = sx + fx * -evalZones[h];
            const pz = sz + fz * -evalZones[h];
            const dist = Math.hypot(px - bx, pz - bz);
            const clear = dist - (berg.collisionRadius + evalRadii[h]);
            if (clear < minClear) minClear = clear;
            if (dist < req + evalRadii[h]) {
              const deficit = req + evalRadii[h] - dist;
              penalty += clear < 5 ? 90000 + deficit * 4500 : deficit * 260;
            }
          }
        }

        // Check Southampton Harbor obstacles & channel walls when harbor is active
        if (circleObs && boxObs) {
          for (let ci = 0; ci < circleObs.length; ci++) {
            const obs = circleObs[ci];
            if (!obs.active) continue;
            const dist = Math.hypot(sx + fx * 42 - obs.x, sz + fz * 42 - obs.z);
            const clear = dist - (obs.radius + 14.2);
            if (clear < minClear) minClear = clear;
            if (clear < 12) {
              penalty += (12 - clear) * (clear < 2 ? 60000 : 280);
            }
          }
          for (let bi = 0; bi < boxObs.length; bi++) {
            const box = boxObs[bi];
            for (let h = 0; h < 4; h++) {
              const px = sx + fx * -evalZones[h];
              const pz = sz + fz * -evalZones[h];
              const cx = MathUtils.clamp(px, box.minX, box.maxX);
              const cz = MathUtils.clamp(pz, box.minZ, box.maxZ);
              const dist = Math.hypot(px - cx, pz - cz);
              const clear = dist - evalRadii[h];
              if (clear < minClear) minClear = clear;
              if (clear < 8) {
                penalty += (8 - clear) * (clear < 1.5 ? 75000 : 340);
              }
            }
          }
        }
      }

      // Keep northbound heading biased cleanly & avoid unnecessary helm oscillation
      let normH = sh % (Math.PI * 2);
      if (normH > Math.PI) normH -= Math.PI * 2;
      if (normH < -Math.PI) normH += Math.PI * 2;

      const channelBias = harborActive && this.shipZ > -560 ? Math.abs(sx) * 0.22 : 0;
      const headingPenalty = Math.abs(normH) * 42;
      const smoothnessPenalty = Math.abs(candDeg - this.autopilotTargetRudder) * 0.45;
      const clearanceBonus = Math.min(60, minClear) * 1.8;

      const score = clearanceBonus - penalty - headingPenalty - channelBias - smoothnessPenalty;
      if (score > bestScore) {
        bestScore = score;
        bestDeg = candDeg;
        bestMinClearance = minClear;
      }
    }

    this.autopilotTargetRudder = bestDeg;

    // Intelligent Wheelhouse Telegraph Management (slows for tight turns, cruises at Flank/Full when clear)
    if (this.autopilotSpeedCooldown > 0) {
      this.autopilotSpeedCooldown = Math.max(0, this.autopilotSpeedCooldown - dt);
    } else {
      let desiredNotch = this.nightMix < 0.35 ? 4 : 5;
      if (bestMinClearance < 3.5) {
        desiredNotch = 1;
      } else if (bestMinClearance < 12) {
        desiredNotch = 2;
      } else if (bestMinClearance < 22) {
        desiredNotch = 3;
      }
      if (this.telegraphIndex <= 2 && bestMinClearance >= 14) {
        desiredNotch = Math.max(desiredNotch, 3);
      }

      if (desiredNotch !== this.telegraphIndex) {
        this.telegraphIndex = desiredNotch;
        this.autopilotSpeedCooldown = 1.65;
        this.bridgeOrderTimer = 1.6;
        this.sound.playTelegraphBell();
      }
    }
  }

  private applyAtmosphere(nightMix: number, dawnBoost = 0): void {
    const n = MathUtils.clamp(nightMix, 0, 1);
    this.nightMix = n;
    const sunsetWeight = Math.sin(n * Math.PI);

    // Sky & Fog color interpolation: April Noon -> Golden Atlantic Sunset -> Arctic Midnight
    colorFromHex(0x9ec4db, this.tempColorA);
    colorFromHex(0x091628, this.tempColorB);
    this.tempSkyColor.copy(this.tempColorA).lerp(
      this.tempColorB,
      MathUtils.smoothstep(n, 0.15, 0.9),
    );
    if (sunsetWeight > 0.01) {
      colorFromHex(0x9f5a3f, this.tempColorA);
      this.tempSkyColor.lerp(this.tempColorA, sunsetWeight * 0.72);
    }
    if (dawnBoost > 0.005) {
      colorFromHex(0x162b4d, this.tempColorA);
      this.tempSkyColor.lerp(this.tempColorA, MathUtils.clamp(dawnBoost, 0, 1));
    }

    this.sceneClearColor.copy(this.tempSkyColor);
    this.fog.color.copy(this.tempSkyColor);
    this.fog.density = MathUtils.lerp(0.00095, 0.0021, n);

    // Hemisphere Light
    colorFromHex(0xcce7ff, this.tempColorA);
    colorFromHex(0x88b8ea, this.tempColorB);
    this.hemiLight.color.copy(this.tempColorA).lerp(this.tempColorB, n);
    if (sunsetWeight > 0.01) {
      colorFromHex(0xe8a47c, this.tempColorA);
      this.hemiLight.color.lerp(this.tempColorA, sunsetWeight * 0.55);
    }
    colorFromHex(0x4d5a4f, this.tempColorA);
    colorFromHex(0x091422, this.tempColorB);
    this.hemiLight.groundColor.copy(this.tempColorA).lerp(this.tempColorB, n);
    this.hemiLight.intensity = MathUtils.lerp(0.86, 0.62, n);

    // Directional Sun-to-Moon Key Light
    colorFromHex(0xfff3d8, this.tempColorA);
    colorFromHex(0xcde4ff, this.tempColorB);
    this.moonKeyLight.color.copy(this.tempColorA).lerp(this.tempColorB, n);
    if (sunsetWeight > 0.01) {
      colorFromHex(0xff9248, this.tempColorA);
      this.moonKeyLight.color.lerp(this.tempColorA, sunsetWeight * 0.78);
    }
    this.moonKeyLight.intensity = MathUtils.lerp(2.05, 1.72, n);

    // Rim Fill Light
    colorFromHex(0x9bc4e8, this.tempColorA);
    colorFromHex(0x4b77a8, this.tempColorB);
    this.rimLight.color.copy(this.tempColorA).lerp(this.tempColorB, n);
    this.rimLight.intensity = MathUtils.lerp(0.56, 0.48, n);

    // Dynamic IBL intensity kept calibrated to eliminate brass/glass glare in daylight & night
    this.scene.environmentIntensity =
      MathUtils.lerp(0.45, 0.24, n) + sunsetWeight * 0.04;

    // Keep exterior portholes dark in bright daylight and softly illuminated by night
    if (this.phase !== 'sinking' && this.phase !== 'aftermath' && this.phase !== 'gameover') {
      this.ship.setPowerLevel(MathUtils.lerp(0.02, 0.92, MathUtils.smoothstep(n, 0.25, 0.88)));
    }
  }

  private getExteriorDeckEyeY(localZ: number): number {
    if (this.selectedVessel === 'lusitania') {
      if (localZ < -31.5) return 11.25; // Raised Forecastle
      if (localZ <= 120.0) return 14.62; // Promenade & Boat Deck
      return 10.1; // Flush Cunard Shelter Aft Deck
    }
    if (localZ < -35.0) return 11.25; // Forecastle Bow
    if (localZ < -9.5) return 8.45; // Forward Well Deck
    if (localZ <= 136.0) return 14.62; // Bridge Wings & Boat Deck Promenade
    if (localZ <= 169.5) return 8.45; // Aft Well Deck
    return 10.45; // Poop & Cruiser Stern Deck
  }

  private getExteriorDeckHalfBeam(localZ: number): number {
    const vSpec = VESSEL_SPECS[this.selectedVessel];
    if (this.selectedVessel === 'lusitania') {
      if (localZ < -31.5) {
        return MathUtils.clamp(((localZ - vSpec.bowZ) / 34.5) * 11.0, 1.8, 11.0);
      }
      if (localZ > 142.0) {
        return MathUtils.clamp(((vSpec.sternZ - localZ) / 31.8) * 10.0, 2.0, 10.0);
      }
      return vSpec.halfBeam - 0.5;
    }
    if (localZ < -35.0) {
      return MathUtils.clamp(((localZ + 73.0) / 38.0) * 11.8, 1.8, 11.8);
    }
    if (localZ > 169.5) {
      return MathUtils.clamp(((194.0 - localZ) / 24.5) * 10.5, 2.2, 10.5);
    }
    return vSpec.halfBeam - 0.6;
  }

  private stepInteriorWalk(dt: number): void {
    const walkFwd =
      (this.heldKeys.has('KeyW') || this.heldKeys.has('KeyI') ? 1 : 0) -
      (this.heldKeys.has('KeyS') || this.heldKeys.has('KeyK') ? 1 : 0);
    const walkStrafe =
      (this.heldKeys.has('KeyD') || this.heldKeys.has('KeyL') ? 1 : 0) -
      (this.heldKeys.has('KeyA') || this.heldKeys.has('KeyJ') ? 1 : 0);

    this.isWalkingOnFoot = walkFwd !== 0 || walkStrafe !== 0;
    if (!this.isWalkingOnFoot) return;

    let spec = getVesselSpotSpec(this.selectedVessel, VESSEL_SPOTS[this.focusSpotIndex].id);
    if (spec.id === 'funnels' || spec.id === 'crowsNest') {
      this.focusVesselSpot('lifeboats', false);
      spec = getVesselSpotSpec(this.selectedVessel, VESSEL_SPOTS[this.focusSpotIndex].id);
    }

    if (this.targetOrbitDistance > 1.5) {
      this.targetOrbitDistance = 0;
    }

    // Walk relative to horizontal camera look direction in ship-local XZ plane
    const lookLocalX = -Math.sin(this.orbitYaw);
    const lookLocalZ = -Math.cos(this.orbitYaw);
    const rightLocalX = Math.cos(this.orbitYaw);
    const rightLocalZ = -Math.sin(this.orbitYaw);

    const moveSpeed = 7.4;
    let vx = lookLocalX * walkFwd + rightLocalX * walkStrafe;
    let vz = lookLocalZ * walkFwd + rightLocalZ * walkStrafe;
    const len = Math.hypot(vx, vz) || 1;
    vx /= len;
    vz /= len;

    this.interiorWalkOffset.x += vx * moveSpeed * dt;
    this.interiorWalkOffset.z += vz * moveSpeed * dt;

    if (spec.category === 'interior' && spec.walkBounds) {
      const minOffX = spec.walkBounds.minX - spec.localTarget[0];
      const maxOffX = spec.walkBounds.maxX - spec.localTarget[0];
      const minOffZ = spec.walkBounds.minZ - spec.localTarget[2];
      const maxOffZ = spec.walkBounds.maxZ - spec.localTarget[2];
      this.interiorWalkOffset.x = MathUtils.clamp(this.interiorWalkOffset.x, minOffX, maxOffX);
      this.interiorWalkOffset.z = MathUtils.clamp(this.interiorWalkOffset.z, minOffZ, maxOffZ);
      this.interiorWalkOffset.y = 0;
    } else {
      const vSpec = VESSEL_SPECS[this.selectedVessel];
      const worldLocalZ = MathUtils.clamp(
        spec.localTarget[2] + this.interiorWalkOffset.z,
        vSpec.bowZ + 5.0,
        vSpec.sternZ - 4.5,
      );
      const halfBeam = this.getExteriorDeckHalfBeam(worldLocalZ);
      const worldLocalX = MathUtils.clamp(
        spec.localTarget[0] + this.interiorWalkOffset.x,
        -halfBeam,
        halfBeam,
      );
      this.interiorWalkOffset.x = worldLocalX - spec.localTarget[0];
      this.interiorWalkOffset.z = worldLocalZ - spec.localTarget[2];
      this.interiorWalkOffset.y = this.getExteriorDeckEyeY(worldLocalZ) - spec.localTarget[1];
    }
  }

  private syncUnderwaterCameraEffects(nightMix: number, dt: number): void {
    const spec = VESSEL_SPOTS[this.focusSpotIndex];
    const compartmentDry =
      this.phase === 'title' ||
      this.phase === 'playing' ||
      this.phase === 'victory' ||
      (this.phase === 'sinking' && spec.id === 'engine' && this.sinkProgress < 0.58);
    const insideDryCompartment =
      compartmentDry &&
      (spec.id === 'dining' ||
        spec.id === 'engine' ||
        spec.id === 'staircase' ||
        spec.id === 'marconi' ||
        spec.id === 'lounge') &&
      this.orbitDistance < 24;

    const waveY = sampleOceanWaveHeight(this.camera.position.x, this.camera.position.z, this.simTime);
    const depthBelowWave = insideDryCompartment ? -1.0 : waveY - this.camera.position.y;
    const underwaterMix = MathUtils.clamp((depthBelowWave + 0.14) / 0.48, 0, 1);

    this.oceanAndSky.updateCameraView(this.camera.position, underwaterMix);
    this.ship.setWheelhouseFloodLevel(this.wheelhouseFloodLevel, 1 - underwaterMix);
    this.ship.setActiveInteriorSpot(spec.id, insideDryCompartment, this.powerLevel);

    if (underwaterMix > 0.005) {
      const depthNorm = MathUtils.clamp(Math.max(0, depthBelowWave) / 45, 0, 1);
      // Cold North Atlantic underwater teal-navy transition (brighter cyan by day, deep arctic teal by night)
      colorFromHex(nightMix < 0.5 ? 0x0b435c : 0x052638, this.tempColorA);
      colorFromHex(0x02111e, this.tempColorB);
      this.tempColorA.lerp(this.tempColorB, depthNorm);

      this.tempSkyColor.copy(this.sceneClearColor).lerp(this.tempColorA, underwaterMix);
      this.sceneClearColor.copy(this.tempSkyColor);
      this.fog.color.copy(this.tempSkyColor);

      const targetUnderDensity = MathUtils.lerp(0.015, 0.024, depthNorm);
      this.fog.density = MathUtils.lerp(this.fog.density, targetUnderDensity, underwaterMix);

      // Filtered aqua ambient light underwater so wheelhouse, hull & ice remain clearly readable
      colorFromHex(nightMix < 0.5 ? 0x5fb4d4 : 0x2f7594, this.tempColorA);
      this.hemiLight.color.lerp(this.tempColorA, underwaterMix * 0.88);
      colorFromHex(0x020c14, this.tempColorA);
      this.hemiLight.groundColor.lerp(this.tempColorA, underwaterMix * 0.9);
      this.hemiLight.intensity = MathUtils.lerp(
        this.hemiLight.intensity,
        1.12 - depthNorm * 0.22,
        underwaterMix,
      );

      colorFromHex(0x7cc8e6, this.tempColorA);
      this.moonKeyLight.color.lerp(this.tempColorA, underwaterMix * 0.72);
      this.moonKeyLight.intensity *= 1 - underwaterMix * (0.28 + depthNorm * 0.35);

      // Emit rising air bubbles outside the submerged cockpit/bow during sinking
      if (this.phase === 'sinking' && underwaterMix > 0.15 && dt > 0 && Math.random() < 0.65) {
        const camX = this.camera.position.x;
        const camY = this.camera.position.y;
        const camZ = this.camera.position.z;
        this.particles.emit(
          camX + (Math.random() - 0.5) * 14,
          camY - 2.5 + Math.random() * 4.5,
          camZ + (Math.random() - 0.5) * 14,
          (Math.random() - 0.5) * 1.4,
          2.2 + Math.random() * 2.8,
          (Math.random() - 0.5) * 1.4,
          0.14 + Math.random() * 0.24,
          1.4 + Math.random() * 0.9,
          -3.6,
          0xbfe9ff,
        );
      }
    }
  }

  private triggerSinking(): void {
    this.hullIntegrity = Math.max(0, this.hullIntegrity);
    this.floodingPct = 100;
    this.waterIngressRate = 0;
    this.autopilotEnabled = false;
    this.phase = 'sinking';
    this.sinkProgress = 0;
    this.hasBrokenInTwo = false;
    this.autoFocusedBreakup = false;
    this.telegraphIndex = 1; // ALL STOP
    this.heldKeys.clear();
    this.icebergWarning = null;
    this.eventText = 'WATER OVERWHELMING BULKHEADS — BOW SUBMERGING';
    this.eventTimer = 5.5;
    this.groanCooldown = 0.3;
    this.sound.playHullGroan(1.0);
    this.sound.playSteamWhistle();
    this.emitTelemetry();
  }

  private stepSinkingSequence(dt: number): void {
    // Sinking speed visibly decelerates once hull reaches 0% integrity and becomes submerged
    const prevP = this.sinkProgress;
    const isSubmerged = this.hullIntegrity <= 0 && prevP >= 0.38;
    const isFullySubmerged = this.hullIntegrity <= 0 && prevP >= 0.72;
    const sinkDuration = isFullySubmerged ? 64.0 : isSubmerged ? 40.0 : 18.0;
    this.sinkProgress = Math.min(1, prevP + dt / sinkDuration);
    const p = this.sinkProgress;

    // Forward momentum bleeds off smoothly as vessel submerges
    this.speedKnots = MathUtils.damp(this.speedKnots, 0, isSubmerged ? 2.4 : 1.0, dt);
    const fwdX = Math.sin(this.headingRad);
    const fwdZ = -Math.cos(this.headingRad);
    const rightX = Math.cos(this.headingRad);
    const rightZ = Math.sin(this.headingRad);
    const worldSpeed = this.speedKnots * 1.3;
    this.shipX += fwdX * worldSpeed * dt;
    this.shipZ += fwdZ * worldSpeed * dt;

    // =========================================================================
    // STAGE 1 (0.00 -> 0.40): Intact hull plunges bow-first while stern rises
    // STAGE 2 (0.40): Hull snaps in two at BREAK_Z = 90 between Funnels #3 & #4
    // STAGE 3 (0.40 -> 0.72): Bow section dives deep; Stern slams back & floods
    // STAGE 4 (0.72 -> 1.00): Stern rears ~83 deg vertical & sinks completely
    // =========================================================================
    if (p < 0.4) {
      const s1 = p / 0.4;
      const e1 = s1 * s1 * (3 - 2 * s1);
      this.sinkPitch = MathUtils.lerp(-0.088, -0.34, e1);
      this.sinkDropY = MathUtils.lerp(-2.2, -26.5, Math.pow(s1, 1.15));
      this.sinkList = this.listDirection * (0.095 + e1 * 0.065);

      const hingeY = this.sinkDropY - this.activeBreakZ * Math.sin(this.sinkPitch);
      this.ship.bowGroup.position.y = hingeY;
      this.ship.bowGroup.rotation.x = this.sinkPitch;
      this.ship.sternGroup.position.y = hingeY;
      this.ship.sternGroup.rotation.x = this.sinkPitch;
    } else {
      if (!this.hasBrokenInTwo) {
        this.hasBrokenInTwo = true;
        this.ship.setBreakupVisual(true, 1.35);
        this.sound.playBreakupSnap();
        this.shakeIntensity = 1.0;
        const shortName = VESSEL_SPECS[this.selectedVessel].shortName.toUpperCase();
        this.eventText = `HULL FRACTURING AT MIDSHIPS — ${shortName} BREAKS IN TWO`;
        this.eventTimer = 5.0;

        // Explosive burst of steam, sparks & torn spray at the fracture plane (z = activeBreakZ)
        const breakWorldX = this.shipX - fwdX * this.activeBreakZ;
        const breakWorldZ = this.shipZ - fwdZ * this.activeBreakZ;
        for (let i = 0; i < 42; i++) {
          const isSpark = i < 14;
          this.particles.emit(
            breakWorldX + (Math.random() - 0.5) * 18,
            4.5 + Math.random() * 14,
            breakWorldZ + (Math.random() - 0.5) * 18,
            (Math.random() - 0.5) * 12,
            4.0 + Math.random() * 10,
            (Math.random() - 0.5) * 12,
            isSpark ? 0.42 : 1.4 + Math.random() * 1.5,
            isSpark ? 0.65 : 1.5 + Math.random() * 0.9,
            isSpark ? 14.0 : 4.2,
            isSpark ? 0xffb347 : 0xdbeafe,
          );
        }

        const inCockpit = VESSEL_SPOTS[this.focusSpotIndex].id === 'wheelhouse';
        if (!inCockpit && !this.userAdjustedCameraInSink && !this.autoFocusedBreakup) {
          this.autoFocusedBreakup = true;
          this.focusVesselSpot('funnels', false);
        }
      }

      const breakHingeY = -26.5 - this.activeBreakZ * Math.sin(-0.34);

      // 1) Forward Bow Section breaks free & plunges deep into the abyss (0.40 -> 0.74)
      const bowT = MathUtils.clamp((p - 0.4) / 0.34, 0, 1);
      const eBow = bowT * bowT * (3 - 2 * bowT);
      this.ship.bowGroup.rotation.x = MathUtils.lerp(-0.34, -0.78, eBow);
      this.ship.bowGroup.position.y = MathUtils.lerp(breakHingeY, -76.0, Math.pow(bowT, 1.18));

      // 2) Stern Section violently slams back down (0.40 -> 0.55), then tilts vertical & plunges completely (0.55 -> 1.00)
      if (p < 0.55) {
        const settleT = (p - 0.4) / 0.15;
        const eSettle = Math.sin(settleT * Math.PI * 0.5);
        this.ship.sternGroup.rotation.x = MathUtils.lerp(-0.34, -0.05, eSettle);
        this.ship.sternGroup.position.y = MathUtils.lerp(breakHingeY, -3.2, eSettle);
        this.sinkList = this.listDirection * MathUtils.lerp(0.16, 0.08, eSettle);
      } else if (p < 0.78) {
        const tiltT = (p - 0.55) / 0.23;
        const eTilt = tiltT * tiltT * (3 - 2 * tiltT);
        this.ship.sternGroup.rotation.x = MathUtils.lerp(-0.05, -1.38, eTilt);
        this.ship.sternGroup.position.y = MathUtils.lerp(-3.2, -56.0, eTilt);
        this.sinkList = this.listDirection * MathUtils.lerp(0.08, 0.03, eTilt);

        if (p > 0.68 && this.eventTimer <= 0.5) {
          this.eventText = 'STERN RISING VERTICAL — FINAL PLUNGE';
          this.eventTimer = 4.0;
        }
      } else {
        const plungeT = (p - 0.78) / 0.22;
        this.ship.sternGroup.rotation.x = MathUtils.lerp(-1.38, -1.46, plungeT);
        this.ship.sternGroup.position.y = MathUtils.lerp(-56.0, -138.0, Math.pow(plungeT, 1.12));
        this.sinkList = this.listDirection * MathUtils.lerp(0.03, 0.0, plungeT);
      }

      // Interior break-cap embers dim as water floods the open bulkheads
      const emberFade = Math.max(0, 1 - (p - 0.4) / 0.16);
      this.ship.setBreakupVisual(true, emberFade * 1.35);
    }

    // Rising cold Atlantic floodwater inside the wheelhouse
    const whFlood = MathUtils.clamp((p - 0.05) / 0.34, 0, 1);
    this.wheelhouseFloodLevel = whFlood;

    // Boiler room flooding causes bridge dynamos to flicker & fail completely shortly after breakup
    if (p < 0.34) {
      this.powerLevel = 1.0 - p * 0.45;
    } else if (p < 0.56) {
      const fade = 1 - (p - 0.34) / 0.22;
      const flicker = 0.3 + 0.7 * Math.abs(Math.sin(this.simTime * 31) * Math.cos(this.simTime * 19));
      this.powerLevel = fade * flicker;
    } else {
      this.powerLevel = 0;
    }
    this.ship.setPowerLevel(this.powerLevel);

    // Periodic hull steel groans & rushing water ambience
    this.groanCooldown -= dt;
    if (this.groanCooldown <= 0 && p < 0.88) {
      this.groanCooldown = 2.4 + Math.random() * 1.4;
      this.sound.playHullGroan(0.75 + p * 0.25);
    }
    this.sound.updateSinkingAmbience(p);

    // Churning white foam & trapped air bursts along submerging bow, break zone & plunging stern
    if (Math.random() < 0.88) {
      const along =
        p < 0.4
          ? MathUtils.lerp(70, -110, p / 0.4)
          : p < 0.74
            ? MathUtils.lerp(-35, -145, (p - 0.4) / 0.34)
            : MathUtils.lerp(-105, -185, (p - 0.74) / 0.26);
      const jitterAlong = along + (Math.random() - 0.5) * 32;
      const sideOff = (Math.random() - 0.5) * 24;
      this.particles.emit(
        this.shipX + fwdX * jitterAlong + rightX * sideOff,
        0.35 + Math.random() * 1.6,
        this.shipZ + fwdZ * jitterAlong + rightZ * sideOff,
        (Math.random() - 0.5) * 5.0,
        2.6 + Math.random() * 5.2,
        (Math.random() - 0.5) * 5.0,
        0.85 + Math.random() * 1.4,
        0.85 + Math.random() * 0.7,
        6.2,
        Math.random() < 0.4 ? 0xe0f2fe : 0x9bd7f5,
      );
    }

    this.stepInteriorWalk(dt);
    this.populateCruiseAwareness(false);
    this.updateShipVisualRig(dt, this.speedKnots);
    this.lifeboatsLaunched = this.ship.crewAndLifeboats.updateSinking(
      this.simTime,
      dt,
      p,
      this.ship.root,
      this.cruiseAwareness,
    );

    // Pull exterior cameras to Boat Deck / Full Ship if user wasn't in the wheelhouse cockpit
    const inCockpit = VESSEL_SPOTS[this.focusSpotIndex].id === 'wheelhouse';
    if (!inCockpit && !this.userAdjustedCameraInSink && !this.autoFocusedSinkLifeboats && p > 0.08) {
      this.autoFocusedSinkLifeboats = true;
      this.focusVesselSpot('funnels', false);
    }

    this.manageIcebergField(dt, worldSpeed, fwdX, fwdZ);
    this.checkAuxVesselCollisions(dt);
    this.applyAtmosphere(1.0);
    this.oceanAndSky.update(
      this.simTime,
      this.shipX,
      this.shipZ,
      this.headingRad,
      this.speedKnots,
      1.0,
      p < 0.16 ? 1.0 : 0.0,
      p < 0.58 ? 1.0 : 0.0,
    );
    this.particles.update(dt);
    this.shakeIntensity = Math.max(0.06 * (1 - p), this.shakeIntensity - dt * 1.4);
    this.updateCamera(dt);
    this.syncUnderwaterCameraEffects(1.0, dt);

    if (this.sinkProgress >= 1) {
      this.enterAftermath();
      return;
    }

    this.telemetryAccum += dt;
    if (this.telemetryAccum >= 0.08) {
      this.telemetryAccum = 0;
      this.emitTelemetry();
    }
  }

  private emitRescueFlare(worldX: number, worldZ: number, colorHex: number): void {
    for (let i = 0; i < 16; i++) {
      this.particles.emit(
        worldX + (Math.random() - 0.5) * 1.6,
        1.2,
        worldZ + (Math.random() - 0.5) * 1.6,
        (Math.random() - 0.5) * 2.4,
        24.0 + Math.random() * 14.0,
        (Math.random() - 0.5) * 2.4,
        0.55 + Math.random() * 0.45,
        1.4 + Math.random() * 0.9,
        9.8,
        colorHex,
      );
    }
    this.sound.playRescueFlare();
  }

  private advanceRescueSimulation(dt: number): void {
    const WAIT_SEC = 60.0;
    const APPROACH_SEC = 34.0;
    const BOARDING_SEC = 40.0;

    this.aftermathSeconds += dt;
    const t = this.aftermathSeconds;

    const fwdX = Math.sin(this.headingRad);
    const fwdZ = -Math.cos(this.headingRad);
    const rightX = Math.cos(this.headingRad);
    const rightZ = Math.sin(this.headingRad);

    let carpLocalX = -220;
    let carpLocalZ = -420;
    let carpLocalYaw = 0.35;
    let boardingProgress = 0;
    let laddersDeployed = false;
    let sweepLight = false;

    if (this.carpathiaState.status === 'intact') {
      if (t < WAIT_SEC) {
        this.carpathiaStage = 'waiting';
        this.carpathia.root.visible = false;
        this.carpathiaDistanceM = 460;

        // Periodic distress flares fired from remaining waiting lifeboats during the 1-minute vigil
        this.flareCooldown -= dt;
        if (this.flareCooldown <= 0) {
          this.flareCooldown = 11.5;
          const boat = this.ship.crewAndLifeboats.lifeboats[Math.floor(Math.random() * 8) * 2 + 1];
          boat.boatGroup.updateWorldMatrix(true, false);
          boat.boatGroup.getWorldPosition(_vBoatWorld);
          this.emitRescueFlare(_vBoatWorld.x, _vBoatWorld.z, 0xd9f99d);
        }
      } else if (t < WAIT_SEC + APPROACH_SEC) {
        this.carpathiaStage = 'approaching';
        const u = MathUtils.clamp((t - WAIT_SEC) / APPROACH_SEC, 0, 1);
        const easeOut = 1 - Math.pow(1 - u, 2.3);
        carpLocalX = MathUtils.lerp(-220, 0, easeOut);
        carpLocalZ = MathUtils.lerp(-420, 56, easeOut);
        carpLocalYaw = MathUtils.lerp(0.48, 0.22, easeOut);
        this.carpathiaDistanceM = Math.round(Math.hypot(carpLocalX, carpLocalZ - 56));
        sweepLight = true;

        this.carpathia.root.visible = true;
        if (!this.carpathiaWhistlePlayed) {
          this.carpathiaWhistlePlayed = true;
          this.sound.playCarpathiaWhistle();
          this.eventText = 'RMS CARPATHIA SIGHTED THROUGH THE ICE FIELD';
          this.eventTimer = 5.5;
          const wx = this.shipX + rightX * carpLocalX + fwdX * -carpLocalZ;
          const wz = this.shipZ + rightZ * carpLocalX + fwdZ * -carpLocalZ;
          this.emitRescueFlare(wx, wz, 0x6ee7b7);
          this.focusAftermathTarget('carpathia');
        }

        this.rescueDawnMix = easeOut * 0.22;

        if (u < 0.85 && Math.random() < 0.45) {
          const bx = this.shipX + rightX * carpLocalX + fwdX * -carpLocalZ;
          const bz = this.shipZ + rightZ * carpLocalX + fwdZ * -carpLocalZ;
          this.particles.emit(
            bx + (Math.random() - 0.5) * 4,
            26.5,
            bz + (Math.random() - 0.5) * 4,
            (Math.random() - 0.5) * 2.0,
            2.2 + Math.random() * 1.2,
            (Math.random() - 0.5) * 2.0,
            1.4,
            2.1,
            -0.6,
            0x2d3644,
          );
        }
      } else if (t < WAIT_SEC + APPROACH_SEC + BOARDING_SEC) {
        if (this.carpathiaStage !== 'boarding') {
          this.carpathiaStage = 'boarding';
          this.sound.playCarpathiaWhistle();
          this.eventText = 'CARPATHIA ALL STOP — BOARDING SURVIVORS';
          this.eventTimer = 5.0;
        }
        carpLocalX = 0;
        carpLocalZ = 56;
        carpLocalYaw = 0.22;
        this.carpathiaDistanceM = 0;
        laddersDeployed = true;
        sweepLight = true;
        this.carpathia.root.visible = true;
        this.rescueDawnMix = 0.22;
        boardingProgress = MathUtils.clamp((t - WAIT_SEC - APPROACH_SEC) / BOARDING_SEC, 0, 1);
      } else {
        if (this.carpathiaStage !== 'complete') {
          this.carpathiaStage = 'complete';
          if (!this.rescueCompleteWhistlePlayed) {
            this.rescueCompleteWhistlePlayed = true;
            this.sound.playCarpathiaWhistle();
          }
          this.eventText = 'RESCUE COMPLETE — ALL 712 SURVIVORS ABOARD';
          this.eventTimer = 7.0;
        }
        carpLocalX = 0;
        carpLocalZ = 56;
        carpLocalYaw = 0.22;
        this.carpathiaDistanceM = 0;
        laddersDeployed = true;
        sweepLight = false;
        this.carpathia.root.visible = true;
        this.rescueDawnMix = 0.22;
        boardingProgress = 1.0;
      }

      if (this.carpathia.root.visible) {
        const baseWorldX = this.shipX + rightX * carpLocalX + fwdX * -carpLocalZ;
        const baseWorldZ = this.shipZ + rightZ * carpLocalX + fwdZ * -carpLocalZ;

        // Conscious iceberg avoidance steering during Carpathia's night approach (spatially pre-filtered)
        let targetAvoidX = 0;
        let targetAvoidZ = 0;
        if (this.carpathiaStage === 'approaching') {
          const approachU = MathUtils.clamp((t - WAIT_SEC) / APPROACH_SEC, 0, 1);
          const fadeOut = 1 - MathUtils.smoothstep(approachU, 0.72, 1.0);
          if (fadeOut > 0.01) {
            const refX = baseWorldX + this.carpathiaAvoidX;
            const refZ = baseWorldZ + this.carpathiaAvoidZ;
            for (let i = 0; i < this.icebergs.length; i++) {
              const b = this.icebergs[i];
              const dx = refX - b.x;
              const dz = refZ - b.z;
              if (Math.abs(dx) > 120 || Math.abs(dz) > 120) continue;
              const dist = Math.hypot(dx, dz);
              const safeDist = b.collisionRadius + 36;
              if (dist < safeDist && dist > 0.05) {
                const push = ((safeDist - dist) / safeDist) * 32 * fadeOut;
                targetAvoidX += (dx / dist) * push;
                targetAvoidZ += (dz / dist) * push;
              }
            }
          }
        }

        this.carpathiaAvoidX = MathUtils.damp(this.carpathiaAvoidX, targetAvoidX, 1.8, dt);
        this.carpathiaAvoidZ = MathUtils.damp(this.carpathiaAvoidZ, targetAvoidZ, 1.8, dt);
        const steerLateral = this.carpathiaAvoidX * rightX + this.carpathiaAvoidZ * rightZ;
        this.carpathiaSteerYaw = MathUtils.damp(
          this.carpathiaSteerYaw,
          MathUtils.clamp(-steerLateral * 0.014, -0.32, 0.32),
          2.0,
          dt,
        );

        const carpWorldX = baseWorldX + this.carpathiaAvoidX;
        const carpWorldZ = baseWorldZ + this.carpathiaAvoidZ;
        const waveY = Math.sin(this.simTime * 0.85) * 0.14;
        const wavePitch = Math.sin(this.simTime * 0.72) * 0.008;
        const waveRoll = Math.cos(this.simTime * 0.62) * 0.012 - this.carpathiaSteerYaw * 0.08;
        const rotY = -this.headingRad + carpLocalYaw + this.carpathiaSteerYaw;
        this.carpathiaHeadingRad = -rotY;
        this.carpathia.root.position.set(carpWorldX, waveY, carpWorldZ);
        setEulerXYZ(this.carpathia.root, wavePitch, rotY, waveRoll);
      }
    } else if (this.carpathiaState.status === 'sinking') {
      this.carpathia.root.visible = true;
      this.stepAuxVesselSinking(
        this.carpathiaState,
        this.carpathia,
        CARPATHIA_BREAK_Z,
        this.carpathia.root.position.x,
        this.carpathia.root.position.z,
        this.carpathiaHeadingRad,
        dt,
        true,
      );
    } else {
      this.carpathia.root.visible = false;
    }

    const activeCarpStage: CarpathiaStage =
      this.carpathiaState.status === 'intact' ? this.carpathiaStage : 'waiting';
    const rescueRes = this.ship.crewAndLifeboats.updateRescue(
      this.simTime,
      dt,
      activeCarpStage,
      this.carpathiaState.status === 'intact' ? boardingProgress : 0,
      this.carpathia.root,
      this.carpathia.boardingStationsLocal,
      this.ship.root,
      undefined,
    );
    this.boatsRecovered = rescueRes.boatsRecovered;
    this.survivorsRescued = rescueRes.survivorsRescued;
    this.lifeboatsLaunched = 16;

    if (this.carpathia.root.visible && this.carpathiaState.status === 'intact') {
      this.carpathia.setRescueState(
        this.simTime,
        rescueRes.carpathiaSurvivorsRescued / 712,
        laddersDeployed,
        sweepLight,
      );
    }
  }

  private stepAftermathSequence(dt: number): void {
    this.ship.hullMeshGroup.visible = false;
    this.speedKnots = MathUtils.damp(this.speedKnots, 0, 1.5, dt);

    const fwdX = Math.sin(this.headingRad);
    const fwdZ = -Math.cos(this.headingRad);
    const rightX = Math.cos(this.headingRad);
    const rightZ = Math.sin(this.headingRad);

    // Gentle residual bubbles over Titanic's resting spot for the first 35 seconds
    if (this.aftermathSeconds < 35 && Math.random() < 0.38) {
      const along = -95 - Math.random() * 85;
      const sideOff = (Math.random() - 0.5) * 26;
      this.particles.emit(
        this.shipX + fwdX * along + rightX * sideOff,
        0.25,
        this.shipZ + fwdZ * along + rightZ * sideOff,
        (Math.random() - 0.5) * 2.2,
        1.5 + Math.random() * 2.8,
        (Math.random() - 0.5) * 2.2,
        0.75 + Math.random() * 0.9,
        1.1 + Math.random() * 0.6,
        3.5,
        0xbfe3f7,
      );
    }

    this.advanceRescueSimulation(dt);
    this.manageIcebergField(dt, 0, fwdX, fwdZ);
    this.checkAuxVesselCollisions(dt);
    this.applyAtmosphere(1.0, this.rescueDawnMix);
    this.oceanAndSky.update(
      this.simTime,
      this.shipX,
      this.shipZ,
      this.headingRad,
      0,
      1.0,
      0.0,
      0.0,
    );
    this.particles.update(dt);
    this.updateCamera(dt);
    this.syncUnderwaterCameraEffects(1.0, dt);
    this.sound.updateShipAmbience(this.carpathiaStage === 'approaching' ? 6 : 0, false);

    this.telemetryAccum += dt;
    if (this.telemetryAccum >= 0.12) {
      this.telemetryAccum = 0;
      this.emitTelemetry();
    }
  }

  private updateShipVisualRig(dt: number, speedKnots: number): void {
    this.ship.root.position.set(this.shipX, 0, this.shipZ);
    this.ship.root.rotation.y = -this.headingRad;

    // Gentle North Atlantic swell pitch + roll + turning heel + flooding trim
    const wavePitch = Math.sin(this.simTime * 0.95) * 0.008 + Math.cos(this.simTime * 0.55) * 0.004;
    const waveRoll = Math.sin(this.simTime * 0.72) * 0.011;
    const turnHeel = -this.yawRate * 0.14;
    this.rollAngle = MathUtils.damp(this.rollAngle, waveRoll + turnHeel + this.sinkList, 4, dt);

    if (this.phase !== 'sinking' && this.phase !== 'aftermath' && this.phase !== 'gameover') {
      const totalPitch = wavePitch + this.sinkPitch;
      const hingeY = this.sinkDropY - this.activeBreakZ * Math.sin(totalPitch);
      const dampedY = MathUtils.damp(this.ship.bowGroup.position.y, hingeY, 3.5, dt);
      const dampedPitch = MathUtils.damp(this.ship.bowGroup.rotation.x, totalPitch, 3.5, dt);
      this.ship.bowGroup.position.y = dampedY;
      this.ship.bowGroup.rotation.x = dampedPitch;
      this.ship.sternGroup.position.y = dampedY;
      this.ship.sternGroup.rotation.x = dampedPitch;
    }

    this.ship.hullMeshGroup.position.y = 0;
    this.ship.hullMeshGroup.rotation.x = 0;
    this.ship.hullMeshGroup.rotation.z = this.rollAngle;

    // Wheelhouse Helm Wheel, Rudder Needle & Overhead Clinometer Pendulum
    const targetWheel = -(this.rudderDeg / 35) * Math.PI * 1.15;
    this.wheelVisualAngle = MathUtils.damp(this.wheelVisualAngle, targetWheel, 10, dt);
    this.ship.helmWheel.rotation.z = this.wheelVisualAngle;
    this.ship.rudderNeedle.position.x = (this.rudderDeg / 35) * 0.14;
    this.ship.clinometerNeedle.rotation.z = -this.rollAngle * 2.2;

    // Compass card rotates opposite to ship heading
    this.ship.compassCard.rotation.z = this.headingRad;

    // Reciprocating Steam Engine Crankshafts & Pistons rotate proportional to speed
    this.ship.setEngineSpeed(speedKnots, dt);

    // Chadburn Telegraph levers glide smoothly to selected notch angle
    const targetLever = TELEGRAPH_NOTCHES[this.telegraphIndex].leverAngle;
    this.ship.telegraphLever.rotation.x = MathUtils.damp(
      this.ship.telegraphLever.rotation.x,
      -targetLever,
      12,
      dt,
    );
    this.ship.telegraphLeverPort.rotation.x = this.ship.telegraphLever.rotation.x;

    // Searchlight beam intensity & sweeping arc (scales with dynamo power)
    const sweepActive = this.searchlightTimer > 0 && this.powerLevel > 0.05;
    if (sweepActive) {
      const sweepX = Math.sin(this.simTime * 1.9) * 38;
      this.ship.searchlightTarget.position.set(sweepX, 2.0, -165);
      this.ship.searchlightHead.rotation.y = -Math.atan2(sweepX, 165);
      this.searchSpotLight.intensity = 420 * this.powerLevel;
      this.searchSpotLight.angle = Math.PI / 7.5;
    } else {
      this.ship.searchlightTarget.position.set(0, 1.5, -155);
      this.ship.searchlightHead.rotation.y = MathUtils.damp(
        this.ship.searchlightHead.rotation.y,
        0,
        5,
        dt,
      );
      this.searchSpotLight.intensity = (speedKnots > 1 ? 56 : 28) * this.powerLevel;
      this.searchSpotLight.angle = Math.PI / 9.5;
    }
    this.ship.setSearchlightBeam(this.powerLevel, sweepActive);

    // Keep sun/moon directional key light aligned with sky arc
    const fwdX = Math.sin(this.headingRad);
    const fwdZ = -Math.cos(this.headingRad);
    const sunArcX = MathUtils.lerp(95, -145, Math.min(1, this.nightMix / 0.65));
    const keyOffsetX = MathUtils.lerp(sunArcX, 115, MathUtils.smoothstep(this.nightMix, 0.56, 1.0));
    const sunSetH = MathUtils.lerp(175, 24, MathUtils.smoothstep(this.nightMix, 0.08, 0.56));
    const keyHeight = MathUtils.lerp(sunSetH, 145, MathUtils.smoothstep(this.nightMix, 0.56, 0.95));
    const tx = this.shipX - fwdX * 45;
    const tz = this.shipZ - fwdZ * 45;
    const kx = tx + keyOffsetX;
    const kz = tz - 245;
    this.moonKeyLight.position.set(kx, keyHeight, kz);
    this.moonKeyLight.target.position.set(tx, 0, tz);
    this.moonKeyLight.target.updateMatrixWorld();
  }

  private emitBowSpray(dt: number, fwdX: number, fwdZ: number, _lightSmokeOnly = false): void {
    const absSpd = Math.abs(this.speedKnots);
    const rightX = Math.cos(this.headingRad);
    const rightZ = Math.sin(this.headingRad);

    if (absSpd < 4) return;
    this.sprayAccum += dt * (absSpd * 0.85);

    const bowDist = Math.abs(VESSEL_SPECS[this.selectedVessel].bowZ) - 1.5;
    while (this.sprayAccum >= 1) {
      this.sprayAccum -= 1;
      const side = Math.random() < 0.5 ? -1 : 1;
      const bowX = this.shipX + fwdX * bowDist + rightX * side * 1.5;
      const bowZ = this.shipZ + fwdZ * bowDist + rightZ * side * 1.5;
      this.particles.emit(
        bowX,
        0.5,
        bowZ,
        rightX * side * (2.5 + Math.random() * 3.5) - fwdX * 2,
        1.8 + Math.random() * 2.5,
        rightZ * side * (2.5 + Math.random() * 3.5) - fwdZ * 2,
        0.45 + Math.random() * 0.55,
        0.55 + Math.random() * 0.35,
        9.5,
        0xd8eefc,
      );
    }
  }

  private damageAuxVessel(
    st: AuxVesselState,
    dmg: number,
    hitX: number,
    hitZ: number,
    reason: string,
    sideSign = 1,
  ): void {
    if (st.status !== 'intact') return;
    this.particles.burstIceImpact(hitX, 3.0, hitZ, 30);
    this.sound.playCollisionImpact(0.65);

    st.hp = Math.max(0, st.hp - Math.round(dmg));
    if (st.hp <= 0) {
      st.status = 'sinking';
      st.sinkProgress = 0;
      st.broken = false;
      st.listDir = sideSign >= 0 ? 1 : -1;
      st.groanCooldown = 0.25;
      this.sound.playHullGroan(0.95);
      this.shakeIntensity = Math.max(this.shakeIntensity, 0.55);
      this.eventText = `${st.label} STRUCK ${reason} — FLOODING & BREAKING APART!`;
      this.eventTimer = 4.6;
      this.emitTelemetry();
    } else {
      this.eventText = `${st.label} STRUCK ${reason} (${Math.round(st.hp)}% HULL)`;
      this.eventTimer = 2.8;
    }
  }

  private stepAuxVesselSinking(
    st: AuxVesselState,
    rig: CarpathiaRig,
    breakZ: number,
    wx: number,
    wz: number,
    headingRad: number,
    dt: number,
    isCarpathia: boolean,
  ): void {
    st.sinkProgress = Math.min(1, st.sinkProgress + dt / 14.5);
    const p = st.sinkProgress;
    const fwdX = Math.sin(headingRad);
    const fwdZ = -Math.cos(headingRad);
    const rightX = Math.cos(headingRad);
    const rightZ = Math.sin(headingRad);

    if (p < 0.28) {
      const s1 = p / 0.28;
      const e1 = s1 * s1 * (3 - 2 * s1);
      const pitch = MathUtils.lerp(0, -0.28, e1);
      const dropY = MathUtils.lerp(0, -14.5, Math.pow(s1, 1.12));
      const list = st.listDir * (0.06 + e1 * 0.12);
      const hingeY = dropY - breakZ * Math.sin(pitch);

      rig.hullMeshGroup.rotation.z = list;
      rig.bowGroup.position.y = hingeY;
      rig.bowGroup.rotation.x = pitch;
      rig.sternGroup.position.y = hingeY;
      rig.sternGroup.rotation.x = pitch;
    } else {
      if (!st.broken) {
        st.broken = true;
        rig.setBreakupVisual(true, 1.35);
        this.sound.playBreakupSnap();
        this.shakeIntensity = Math.max(this.shakeIntensity, 0.72);
        this.eventText = `${st.label} BREAKS IN TWO AT MIDSHIPS!`;
        this.eventTimer = 4.5;

        const breakWorldX = wx - fwdX * breakZ;
        const breakWorldZ = wz - fwdZ * breakZ;
        for (let i = 0; i < 34; i++) {
          const isSpark = i < 12;
          this.particles.emit(
            breakWorldX + (Math.random() - 0.5) * 14,
            3.5 + Math.random() * 10,
            breakWorldZ + (Math.random() - 0.5) * 14,
            (Math.random() - 0.5) * 10,
            3.5 + Math.random() * 8,
            (Math.random() - 0.5) * 10,
            isSpark ? 0.38 : 1.2 + Math.random() * 1.2,
            isSpark ? 0.58 : 1.2 + Math.random() * 0.7,
            isSpark ? 14.0 : 4.2,
            isSpark ? 0xffb347 : 0xdbeafe,
          );
        }
      }

      const startHingeY = -14.5 - breakZ * Math.sin(-0.28);
      const bowT = MathUtils.clamp((p - 0.28) / 0.36, 0, 1);
      const eBow = bowT * bowT * (3 - 2 * bowT);
      rig.bowGroup.rotation.x = MathUtils.lerp(-0.28, -0.82, eBow);
      rig.bowGroup.position.y = MathUtils.lerp(
        startHingeY,
        isCarpathia ? -72.0 : -64.0,
        Math.pow(bowT, 1.15),
      );

      if (p < 0.48) {
        const settleT = (p - 0.28) / 0.2;
        const eSettle = Math.sin(settleT * Math.PI * 0.5);
        rig.sternGroup.rotation.x = MathUtils.lerp(-0.28, -0.05, eSettle);
        rig.sternGroup.position.y = MathUtils.lerp(startHingeY, -3.0, eSettle);
        rig.hullMeshGroup.rotation.z = st.listDir * MathUtils.lerp(0.18, 0.08, eSettle);
      } else if (p < 0.76) {
        const tiltT = (p - 0.48) / 0.28;
        const eTilt = tiltT * tiltT * (3 - 2 * tiltT);
        rig.sternGroup.rotation.x = MathUtils.lerp(-0.05, -1.36, eTilt);
        rig.sternGroup.position.y = MathUtils.lerp(-3.0, -46.0, eTilt);
        rig.hullMeshGroup.rotation.z = st.listDir * MathUtils.lerp(0.08, 0.03, eTilt);
      } else {
        const plungeT = (p - 0.76) / 0.24;
        rig.sternGroup.rotation.x = MathUtils.lerp(-1.36, -1.44, plungeT);
        rig.sternGroup.position.y = MathUtils.lerp(
          -46.0,
          isCarpathia ? -120.0 : -112.0,
          Math.pow(plungeT, 1.12),
        );
        rig.hullMeshGroup.rotation.z = st.listDir * MathUtils.lerp(0.03, 0, plungeT);
      }

      const emberFade = Math.max(0, 1 - (p - 0.28) / 0.2);
      rig.setBreakupVisual(true, emberFade * 1.35);
    }

    st.groanCooldown -= dt;
    if (st.groanCooldown <= 0 && p < 0.85) {
      st.groanCooldown = 2.6 + Math.random() * 1.4;
      this.sound.playHullGroan(0.72);
    }

    // Boiling foam & rising bubbles visible through translucent ocean surface
    if (Math.random() < 0.72) {
      const along = MathUtils.lerp(45, -70, p) + (Math.random() - 0.5) * 24;
      const sideOff = (Math.random() - 0.5) * 16;
      this.particles.emit(
        wx + fwdX * along + rightX * sideOff,
        0.3 + Math.random() * 1.2,
        wz + fwdZ * along + rightZ * sideOff,
        (Math.random() - 0.5) * 3.8,
        2.0 + Math.random() * 3.6,
        (Math.random() - 0.5) * 3.8,
        0.75 + Math.random() * 1.0,
        0.8 + Math.random() * 0.5,
        4.5,
        Math.random() < 0.45 ? 0xe0f2fe : 0x9bd7f5,
      );
    }

    if (p >= 1) {
      st.status = 'sunk';
      rig.root.visible = false;
      this.emitTelemetry();
    }
  }

  private processHarborBreakEvents(): void {
    const events = this.harbor.consumeBreakEvents();
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.phase === 'snap') {
        this.sound.playBreakupSnap();
        for (let k = 0; k < 20; k++) {
          const isSpark = k < 8;
          this.particles.emit(
            ev.x + (Math.random() - 0.5) * 5,
            1.4 + Math.random() * 3,
            ev.z + (Math.random() - 0.5) * 5,
            (Math.random() - 0.5) * 6,
            2.5 + Math.random() * 5,
            (Math.random() - 0.5) * 6,
            isSpark ? 0.35 : 0.8 + Math.random() * 0.6,
            0.7,
            isSpark ? 12.0 : 5.0,
            isSpark ? 0xffb347 : 0xe0f2fe,
          );
        }
      } else {
        this.sound.playCollisionImpact(0.55);
        this.particles.burstIceImpact(ev.x, 1.5, ev.z, 18);
        this.eventText = `${ev.label} STRUCK OBJECT — BREAKING APART & SINKING!`;
        this.eventTimer = 3.6;
      }
    }
  }

  private checkAuxVesselCollisions(dt: number): void {
    if (dt <= 0) return;

    if (!this.carpathia.root.visible || this.carpathiaState.status !== 'intact') return;
    if (this.carpathiaState.hitCooldown > 0) {
      this.carpathiaState.hitCooldown = Math.max(0, this.carpathiaState.hitCooldown - dt);
      return;
    }

    const vx = this.carpathia.root.position.x;
    const vz = this.carpathia.root.position.z;
    const vh = this.carpathiaHeadingRad;
    const vFwdX = Math.sin(vh);
    const vFwdZ = -Math.cos(vh);

    // 1. Strike against nearby Icebergs (spatially pre-filtered)
    for (let bi = 0; bi < this.icebergs.length; bi++) {
      const berg = this.icebergs[bi];
      if (Math.abs(berg.x - vx) > 135 || Math.abs(berg.z - vz) > 135) continue;
      for (let pi = 0; pi < CARPATHIA_HULL_POINTS.length; pi++) {
        const pt = CARPATHIA_HULL_POINTS[pi];
        const px = vx + vFwdX * -pt.zLocal;
        const pz = vz + vFwdZ * -pt.zLocal;
        if (Math.hypot(px - berg.x, pz - berg.z) < berg.collisionRadius + pt.radius * 0.88) {
          this.carpathiaState.hitCooldown = 1.6;
          this.damageAuxVessel(
            this.carpathiaState,
            115,
            (px + berg.x) * 0.5,
            (pz + berg.z) * 0.5,
            'AN ICEBERG',
            1,
          );
          return;
        }
      }
    }
    if (this.carpathiaState.status !== 'intact') return;

    // 2. Strike against Harbor Piers, Breakwaters, Quays & Harbor Escorts
    if (this.harbor.root.visible) {
      const spdRatio = this.carpathiaStage === 'approaching' ? 0.75 : 0.45;
      const circleObs = this.harbor.getCircleObstacles();
      for (let ci = 0; ci < circleObs.length; ci++) {
        const obs = circleObs[ci];
        if (!obs.active) continue;
        for (let pi = 0; pi < CARPATHIA_HULL_POINTS.length; pi++) {
          const pt = CARPATHIA_HULL_POINTS[pi];
          const px = vx + vFwdX * -pt.zLocal;
          const pz = vz + vFwdZ * -pt.zLocal;
          if (Math.hypot(px - obs.x, pz - obs.z) < obs.radius + pt.radius * 0.85) {
            this.carpathiaState.hitCooldown = 1.6;
            if (obs.kind === 'tug' || obs.kind === 'pilot' || obs.kind === 'lifeboat') {
              this.harbor.triggerEscortStrike(obs.id);
              this.processHarborBreakEvents();
            }
            this.damageAuxVessel(
              this.carpathiaState,
              obs.kind === 'pier' ? 110 : 48 * spdRatio + 20,
              (px + obs.x) * 0.5,
              (pz + obs.z) * 0.5,
              obs.label,
              1,
            );
            return;
          }
        }
      }

      const boxObs = this.harbor.getBoxObstacles();
      for (let bi = 0; bi < boxObs.length; bi++) {
        const box = boxObs[bi];
        for (let pi = 0; pi < CARPATHIA_HULL_POINTS.length; pi++) {
          const pt = CARPATHIA_HULL_POINTS[pi];
          const px = vx + vFwdX * -pt.zLocal;
          const pz = vz + vFwdZ * -pt.zLocal;
          const cx = MathUtils.clamp(px, box.minX, box.maxX);
          const cz = MathUtils.clamp(pz, box.minZ, box.maxZ);
          if (Math.hypot(px - cx, pz - cz) < pt.radius * 0.85) {
            this.carpathiaState.hitCooldown = 1.6;
            this.damageAuxVessel(this.carpathiaState, 110, cx, cz, box.label, 1);
            return;
          }
        }
      }
    }
  }

  private manageIcebergField(dt: number, _worldSpeed: number, _fwdX: number, _fwdZ: number): void {
    // Deterministic toroidal grid wrap (3400m span) preserves even non-clustered spacing & open fairway forever
    const spanZ = 3400;
    for (let i = 0; i < this.icebergs.length; i++) {
      const b = this.icebergs[i];
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      b.rotY += b.rotSpeed * dt;
      if (b.hitCooldown > 0) b.hitCooldown = Math.max(0, b.hitCooldown - dt);

      if (b.z - this.shipZ > 450) {
        const oldFairwayX = this.getFairwayCenterX(b.z);
        const relOffset = b.x - oldFairwayX;
        b.z -= spanZ;
        const newFairwayX = this.getFairwayCenterX(b.z);
        b.x = newFairwayX + relOffset;
        b.warned = false;
        b.nearMissAwarded = false;
        b.hitCooldown = 0;
      }
    }

    this.iceFactory.updateTransforms(this.icebergs, this.shipX, this.shipZ, this.simTime);
  }

  private applyHullBreach(
    dmgRaw: number,
    pushNx: number,
    pushNz: number,
    pushDist: number,
    hitX: number,
    hitZ: number,
    speedRatio: number,
    floodJump: number,
    isHeavyBow: boolean,
    label: string,
    sideSign: number,
  ): void {
    // Exceptionally durable reinforced hull scaled by vessel resilience
    this.combo = 1;
    const resilience = VESSEL_SPECS[this.selectedVessel].hullResilience;
    const effectiveDmg = Math.max(1, Math.round((dmgRaw * 0.22) / resilience));
    const effectiveFlood = (floodJump * 0.24) / resilience;
    this.hullIntegrity = Math.max(0, this.hullIntegrity - effectiveDmg);
    this.listDirection = sideSign >= 0 ? 1 : -1;
    this.headingRad += (sideSign >= 0 ? -1 : 1) * (isHeavyBow ? 0.05 : 0.08);
    this.shipX += pushNx * pushDist;
    this.shipZ += pushNz * pushDist;
    this.speedKnots *= isHeavyBow ? 0.45 : 0.72;
    this.floodingPct = Math.min(100, this.floodingPct + effectiveFlood);

    this.hitstopTimer = isHeavyBow ? 0.05 : 0.035;
    this.shakeIntensity = isHeavyBow ? 0.82 : 0.56;
    this.damageFlashTimer = 0.4;
    this.onDamageFlash(0.85);
    this.particles.burstIceImpact(hitX, 3.2, hitZ, isHeavyBow ? 38 : 24);
    this.sound.playCollisionImpact(Math.max(0.45, speedRatio));

    if (!this.autopilotEnabled && label === 'NORTH ATLANTIC ICEBERG') {
      this.bowPanicActive = true;
      this.panicShoutCooldown = 3.2;
      this.sound.playCrowdScreamPanic();
      this.eventText = 'ICEBERG STRIKE — PASSENGERS SCREAMING & RUSHING TO THE BOW!';
      this.eventTimer = 4.6;
    } else {
      this.eventText = `IMPACT: ${label} — REINFORCED HULL AT ${Math.round(this.hullIntegrity)}%`;
      this.eventTimer = 2.8;
    }
    this.emitTelemetry();
  }

  private checkAllObstacles(dt: number, fwdX: number, fwdZ: number): void {
    // Decrement per-obstacle collision cooldowns
    for (const [key, t] of this.obstacleCooldowns) {
      const next = t - dt;
      if (next <= 0) this.obstacleCooldowns.delete(key);
      else this.obstacleCooldowns.set(key, next);
    }

    const rightX = Math.cos(this.headingRad);
    const rightZ = Math.sin(this.headingRad);
    const speedRatio = Math.max(0.35, Math.abs(this.speedKnots) / 20);

    let closestWarningDist = Infinity;
    let closestWarningText: string | null = null;
    let closestHazardSide = 0;

    // -----------------------------------------------------------------------
    // A. Harbor Escort Vessels (Tugs, Pilot Vessel), Harbor Lifeboats, Buoys, Piers, Quay & Breakwaters
    // -----------------------------------------------------------------------
    if (this.harbor.root.visible) {
      const circleObs = this.harbor.getCircleObstacles();
      for (let i = 0; i < circleObs.length; i++) {
        const obs = circleObs[i];
        if (!obs.active) continue;
        const dx = obs.x - this.shipX;
        const dz = obs.z - this.shipZ;
        const ahead = dx * fwdX + dz * fwdZ;
        const lateral = dx * rightX + dz * rightZ;

        if (ahead > 72 && ahead < 185 && Math.abs(lateral) < obs.radius + 15) {
          if (ahead < closestWarningDist) {
            closestWarningDist = ahead;
            closestHazardSide = Math.abs(lateral) < 5 ? 0 : lateral < 0 ? -1 : 1;
            closestWarningText =
              obs.kind === 'lifeboat'
                ? 'LIFEBOAT IN CHANNEL AHEAD'
                : obs.kind === 'tug' || obs.kind === 'pilot'
                  ? `${obs.label} CLOSE AHEAD`
                  : `${obs.label} DEAD AHEAD`;
          }
        }

        if (this.obstacleCooldowns.has(obs.id)) continue;

        for (let p = 0; p < this.activeHullCheckPoints.length; p++) {
          const hp = this.activeHullCheckPoints[p];
          const px = this.shipX + fwdX * -hp.zLocal;
          const pz = this.shipZ + fwdZ * -hp.zLocal;
          const vx = px - obs.x;
          const vz = pz - obs.z;
          const dist = Math.hypot(vx, vz);
          const minAllowed = obs.radius + hp.radius;
          if (dist < minAllowed) {
            this.obstacleCooldowns.set(obs.id, 1.65);
            if (obs.kind === 'tug' || obs.kind === 'pilot' || obs.kind === 'lifeboat') {
              this.harbor.triggerEscortStrike(obs.id);
              this.processHarborBreakEvents();
            }
            const nx = dist > 0.001 ? vx / dist : -rightX;
            const nz = dist > 0.001 ? vz / dist : -rightZ;
            const overlap = minAllowed - dist + 1.6;
            const baseDmg = obs.kind === 'pier' ? 52 : obs.kind === 'tug' || obs.kind === 'pilot' ? 42 : 36;
            this.applyHullBreach(
              baseDmg * speedRatio + 16,
              nx,
              nz,
              overlap,
              (px + obs.x) * 0.5,
              (pz + obs.z) * 0.5,
              speedRatio,
              obs.kind === 'pier' ? 28 : 20,
              p === 0,
              obs.label,
              lateral,
            );
            break;
          }
        }
      }

      const boxObs = this.harbor.getBoxObstacles();
      for (let i = 0; i < boxObs.length; i++) {
        const box = boxObs[i];
        if (this.obstacleCooldowns.has(box.id)) continue;

        for (let p = 0; p < this.activeHullCheckPoints.length; p++) {
          const hp = this.activeHullCheckPoints[p];
          const px = this.shipX + fwdX * -hp.zLocal;
          const pz = this.shipZ + fwdZ * -hp.zLocal;
          const cx = MathUtils.clamp(px, box.minX, box.maxX);
          const cz = MathUtils.clamp(pz, box.minZ, box.maxZ);
          const vx = px - cx;
          const vz = pz - cz;
          const dist = Math.hypot(vx, vz);
          if (dist < hp.radius) {
            this.obstacleCooldowns.set(box.id, 1.65);
            const nx = dist > 0.001 ? vx / dist : -1;
            const nz = dist > 0.001 ? vz / dist : 0;
            const overlap = hp.radius - dist + 1.8;
            this.applyHullBreach(
              44 * speedRatio + 18,
              nx,
              nz,
              overlap,
              cx,
              cz,
              speedRatio,
              24,
              p === 0,
              box.label,
              1,
            );
            break;
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // B. Active Vessel's Own Lowered / Floating Lifeboats During Flooding
    // -----------------------------------------------------------------------
    this.ship.crewAndLifeboats.getFloatingLifeboats(this.floatingBoatHazards);
    for (let i = 0; i < this.floatingBoatHazards.length; i++) {
      const fb = this.floatingBoatHazards[i];
      const key = `ship_lb_${fb.index}`;
      if (this.obstacleCooldowns.has(key)) continue;
      for (let p = 0; p < this.activeHullCheckPoints.length; p++) {
        const hp = this.activeHullCheckPoints[p];
        const px = this.shipX + fwdX * -hp.zLocal;
        const pz = this.shipZ + fwdZ * -hp.zLocal;
        const vx = px - fb.x;
        const vz = pz - fb.z;
        const dist = Math.hypot(vx, vz);
        if (dist < fb.radius + hp.radius) {
          this.obstacleCooldowns.set(key, 1.8);
          const nx = dist > 0.001 ? vx / dist : -rightX;
          const nz = dist > 0.001 ? vz / dist : -rightZ;
          this.applyHullBreach(
            34 * speedRatio + 14,
            nx,
            nz,
            fb.radius + hp.radius - dist + 1.4,
            (px + fb.x) * 0.5,
            (pz + fb.z) * 0.5,
            speedRatio,
            18,
            p === 0,
            'FLOATING LIFEBOAT',
            1,
          );
          break;
        }
      }
    }

    // -----------------------------------------------------------------------
    // B2. RMS Carpathia Rescue Vessel (during aftermath / collision check)
    // -----------------------------------------------------------------------
    if (this.carpathia.root.visible && this.carpathiaState.status === 'intact' && !this.obstacleCooldowns.has('rms_carpathia')) {
      const ch = this.carpathiaHeadingRad;
      const cFwdX = Math.sin(ch);
      const cFwdZ = -Math.cos(ch);
      for (let ci = 0; ci < CARPATHIA_HULL_POINTS.length; ci++) {
        const cp = CARPATHIA_HULL_POINTS[ci];
        const cx = this.carpathia.root.position.x + cFwdX * -cp.zLocal;
        const cz = this.carpathia.root.position.z + cFwdZ * -cp.zLocal;
        for (let p = 0; p < this.activeHullCheckPoints.length; p++) {
          const hp = this.activeHullCheckPoints[p];
          const px = this.shipX + fwdX * -hp.zLocal;
          const pz = this.shipZ + fwdZ * -hp.zLocal;
          const vx = px - cx;
          const vz = pz - cz;
          const dist = Math.hypot(vx, vz);
          const minAllowed = cp.radius + hp.radius;
          if (dist < minAllowed) {
            this.obstacleCooldowns.set('rms_carpathia', 1.85);
            const nx = dist > 0.001 ? vx / dist : -rightX;
            const nz = dist > 0.001 ? vz / dist : -rightZ;
            const lat = (cx - this.shipX) * rightX + (cz - this.shipZ) * rightZ;
            this.damageAuxVessel(
              this.carpathiaState,
              145,
              (px + cx) * 0.5,
              (pz + cz) * 0.5,
              VESSEL_SPECS[this.selectedVessel].name.toUpperCase(),
              lat >= 0 ? -1 : 1,
            );
            this.applyHullBreach(
              48 * speedRatio + 18,
              nx,
              nz,
              minAllowed - dist + 2.0,
              (px + cx) * 0.5,
              (pz + cz) * 0.5,
              speedRatio,
              26,
              p === 0,
              'RMS CARPATHIA',
              lat,
            );
            break;
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // C. Icebergs (Lookout Bell, Hull Breach & Near-Miss Bonus, spatially pre-filtered)
    // -----------------------------------------------------------------------
    for (const berg of this.icebergs) {
      const dx = berg.x - this.shipX;
      const dz = berg.z - this.shipZ;
      if (Math.abs(dx) > 310 || Math.abs(dz) > 310) continue;
      const ahead = dx * fwdX + dz * fwdZ; // +74 is bow tip
      const lateral = dx * rightX + dz * rightZ; // negative = Port, positive = Starboard

      // 1. Crow's Nest Warning Check
      if (ahead > 80 && ahead < 260 && Math.abs(lateral) < berg.collisionRadius + 18) {
        if (ahead < closestWarningDist) {
          closestWarningDist = ahead;
          closestHazardSide = Math.abs(lateral) < 6 ? 0 : lateral < 0 ? -1 : 1;
          closestWarningText =
            Math.abs(lateral) < 9
              ? 'ICEBERG DEAD AHEAD'
              : lateral < 0
                ? 'ICEBERG OFF PORT BOW'
                : 'ICEBERG OFF STARBOARD BOW';
        }
        if (!berg.warned && ahead < 200) {
          berg.warned = true;
          this.sound.playLookoutBell();
        }
      }

      // 2. Multi-point Hull Collision Check
      if (berg.hitCooldown <= 0) {
        let hit = false;
        let hitPtX = 0;
        let hitPtZ = 0;
        let isBowRam = false;

        for (let p = 0; p < this.activeHullCheckPoints.length; p++) {
          const hp = this.activeHullCheckPoints[p];
          const px = this.shipX + fwdX * -hp.zLocal;
          const pz = this.shipZ + fwdZ * -hp.zLocal;
          const dist = Math.hypot(berg.x - px, berg.z - pz);
          if (dist < berg.collisionRadius + hp.radius) {
            hit = true;
            hitPtX = (px + berg.x) * 0.5;
            hitPtZ = (pz + berg.z) * 0.5;
            isBowRam = p === 0 && Math.abs(lateral) < berg.collisionRadius * 0.6;
            break;
          }
        }

        if (hit) {
          berg.hitCooldown = 1.65;
          berg.nearMissAwarded = true;
          const pushSide = lateral >= 0 ? -1 : 1;
          const rawDmg = isBowRam ? 44 * speedRatio + 16 : 30 * speedRatio + 12;
          this.applyHullBreach(
            rawDmg,
            rightX * pushSide,
            rightZ * pushSide,
            2.6,
            hitPtX,
            hitPtZ,
            speedRatio,
            isBowRam ? 24 : 14,
            isBowRam,
            'NORTH ATLANTIC ICEBERG',
            lateral,
          );
          continue;
        }
      }

      // 3. Near-Miss "Clean Passage" Check
      if (!berg.nearMissAwarded && ahead < 18 && ahead > -185) {
        const clearance = Math.abs(lateral) - (berg.collisionRadius + 13.8);
        if (clearance > 0 && clearance < 17) {
          berg.nearMissAwarded = true;
          const pts = 250 * this.combo;
          this.score += pts;
          this.nearMissCount += 1;
          this.combo = Math.min(5, this.combo + 1);
          this.sound.playNearMissChime();
          this.eventText = `CLEAN PASSAGE +${pts}`;
          this.eventTimer = 1.9;
          this.emitTelemetry();
        }
      }
    }

    this.closestHazardSide = closestHazardSide;
    this.icebergWarning = closestWarningText;
  }

  // =========================================================================
  // CAMERA RIG (Title Harbor Sweep + Free 360° Orbit + Wheelhouse & Interior Decks)
  // =========================================================================
  private updateTitleCamera(): void {
    // Graceful sunlit harbor vista from port-bow channel water framing Titanic, Britannic & Lusitania
    const drift = Math.sin(this.simTime * 0.18);
    const camX = this.shipX * 0.65 - 110 + drift * 16;
    const camY = 33.5 + Math.cos(this.simTime * 0.24) * 2.2;
    const camZ = -176 + drift * 14;
    const focusX = this.shipX * 0.62 - 42;

    this.camera.position.set(camX, camY, this.shipZ + camZ);
    this.camera.up.set(0, 1, 0);
    _vCamTarget.set(focusX, 15.0, this.shipZ + 34);
    this.camera.lookAt(_vCamTarget);
  }

  private updateCamera(dt: number): void {
    const spec = getVesselSpotSpec(this.selectedVessel, VESSEL_SPOTS[this.focusSpotIndex].id);
    const vSpec = VESSEL_SPECS[this.selectedVessel];
    const targetX = spec.localTarget[0] + this.interiorWalkOffset.x;
    const targetY = spec.localTarget[1] + this.interiorWalkOffset.y;
    const targetZ = spec.localTarget[2] + this.interiorWalkOffset.z;

    // Smoothly damp focus position & spherical orbit coordinates
    this.camFocusLocal.x = MathUtils.damp(this.camFocusLocal.x, targetX, 7, dt);
    this.camFocusLocal.y = MathUtils.damp(this.camFocusLocal.y, targetY, 7, dt);
    this.camFocusLocal.z = MathUtils.damp(this.camFocusLocal.z, targetZ, 7, dt);
    this.orbitYaw = MathUtils.damp(this.orbitYaw, this.targetOrbitYaw, 7, dt);
    this.orbitPitch = MathUtils.damp(this.orbitPitch, this.targetOrbitPitch, 7, dt);
    this.orbitDistance = MathUtils.damp(this.orbitDistance, this.targetOrbitDistance, 7, dt);

    // Transform local ship spot into world space respecting intact/split bow & stern half transforms
    _vFocusLocal.copy(this.camFocusLocal);

    const isSinkOrAfter =
      this.phase === 'sinking' || this.phase === 'aftermath' || this.phase === 'gameover';
    const isOverviewShip = spec.id === 'funnels' && isSinkOrAfter;

    if (isOverviewShip) {
      // Pan focus smoothly from midships toward the stern plunge site while keeping camera at sea level
      const panT = MathUtils.clamp((this.sinkProgress - 0.42) / 0.42, 0, 1);
      _vFocusLocal.z = MathUtils.lerp(spec.localTarget[2], this.activeBreakZ + 28, panT);
    }

    const useSternHalf = spec.id === 'stern' || spec.id === 'engine';
    const halfGroup = useSternHalf ? this.ship.sternGroup : this.ship.bowGroup;
    const halfY = halfGroup.position.y;
    const halfPitch = halfGroup.rotation.x;
    const hullRoll = this.ship.hullMeshGroup.rotation.z;

    const dzFromBreak = _vFocusLocal.z - this.activeBreakZ;
    const rotY = _vFocusLocal.y * Math.cos(halfPitch) - dzFromBreak * Math.sin(halfPitch);
    const rotZ = this.activeBreakZ + _vFocusLocal.y * Math.sin(halfPitch) + dzFromBreak * Math.cos(halfPitch);
    const shiftedY = halfY + rotY;
    const rolledX = _vFocusLocal.x * Math.cos(hullRoll) - shiftedY * Math.sin(hullRoll);
    const rolledY = _vFocusLocal.x * Math.sin(hullRoll) + shiftedY * Math.cos(hullRoll);

    let worldXLocal = rolledX;
    let worldY = rolledY;
    let worldZLocal = rotZ;

    if (this.phase === 'aftermath' || this.phase === 'gameover') {
      worldXLocal = _vFocusLocal.x;
      worldY = 4.2;
      worldZLocal = _vFocusLocal.z;
    } else if (isOverviewShip) {
      const sternY = this.ship.sternGroup.position.y;
      const sternPitch = this.ship.sternGroup.rotation.x;
      const sternTipWorldY = sternY + 10 * Math.cos(sternPitch) - (vSpec.sternZ - this.activeBreakZ) * Math.sin(sternPitch);
      worldXLocal = _vFocusLocal.x;
      worldY = MathUtils.clamp(Math.max(4.5, sternTipWorldY * 0.38), 3.5, 24.0);
      worldZLocal = _vFocusLocal.z;
    }

    _vFwd.set(Math.sin(this.headingRad), 0, -Math.cos(this.headingRad));
    _vRight.set(Math.cos(this.headingRad), 0, Math.sin(this.headingRad));

    if (
      (this.phase === 'aftermath' || this.phase === 'gameover') &&
      this.aftermathFocus === 'carpathia' &&
      this.carpathia.root.visible
    ) {
      _vFocusWorld.copy(this.carpathia.root.position);
      _vFocusWorld.y = 7.5;
    } else {
      _vFocusWorld.set(this.shipX, worldY, this.shipZ);
      _vFocusWorld.addScaledVector(_vRight, worldXLocal);
      _vFocusWorld.addScaledVector(_vFwd, -worldZLocal);
    }

    // Compute unit look direction in ship-local frame, rotated by ship heading
    const cosP = Math.cos(this.orbitPitch);
    const localDirX = -Math.sin(this.orbitYaw) * cosP;
    const localDirY = -Math.sin(this.orbitPitch);
    const localDirZ = -Math.cos(this.orbitYaw) * cosP;

    _vLookDir.set(0, localDirY, 0);
    _vLookDir.addScaledVector(_vRight, localDirX);
    _vLookDir.addScaledVector(_vFwd, -localDirZ);
    _vLookDir.normalize();

    _vCamPos.copy(_vFocusWorld);
    _vCamPos.addScaledVector(_vLookDir, -this.orbitDistance);

    // Keep exterior cruising/aftermath camera above waves, while allowing cockpit, interior decks & sinking spots underwater
    const isInterior =
      (spec.id === 'wheelhouse' || spec.category === 'interior') && this.orbitDistance < 12;
    const allowUnderwater =
      isInterior ||
      (this.phase === 'sinking' && !isOverviewShip);
    if (!allowUnderwater && this.orbitDistance > 1.5 && _vCamPos.y < 1.25) {
      _vCamPos.y = 1.25;
    } else if (!allowUnderwater && this.orbitDistance <= 1.5 && _vCamPos.y < 0.85) {
      _vCamPos.y = 0.85;
    }

    _vCamTarget.copy(_vCamPos);
    _vCamTarget.addScaledVector(_vLookDir, 40);

    // Apply decaying camera shake
    if (this.shakeIntensity > 0.001) {
      const s = this.shakeIntensity * 0.38;
      _vCamPos.x += (Math.random() - 0.5) * s;
      _vCamPos.y += (Math.random() - 0.5) * s;
      _vCamPos.z += (Math.random() - 0.5) * s;
    }

    // Subtle on-foot camera stride bob while walking ship decks
    if (this.isWalkingOnFoot && this.orbitDistance < 2.0 && dt > 0) {
      this.walkBobPhase += dt * 10.5;
      _vCamPos.y += Math.abs(Math.sin(this.walkBobPhase)) * 0.032;
    }

    // Subtle ship roll feel when standing inside wheelhouse or interior decks
    const rollInfluence = isInterior ? 0.55 : 0.08;
    _mCamRoll.makeRotationAxis(_vLookDir, -(this.rollAngle * rollInfluence));
    this.camera.up.set(0, 1, 0).applyMatrix4(_mCamRoll).normalize();

    this.camera.position.copy(_vCamPos);
    this.camera.lookAt(_vCamTarget);
  }

  private saveBestScore(): void {
    const rounded = Math.round(this.score);
    if (rounded > this.bestScore) {
      this.bestScore = rounded;
      try {
        localStorage.setItem(BEST_SCORE_KEY, String(this.bestScore));
      } catch {
        // ignore storage errors
      }
    }
  }

  private emitTelemetry(): void {
    const rawDeg = MathUtils.radToDeg(this.headingRad) % 360;
    const headingDeg = Math.round((rawDeg + 360) % 360);
    const breached = Math.min(5, Math.floor((100 - this.hullIntegrity) / 20));
    const cooldownPct =
      this.searchlightTimer > 0
        ? 0
        : this.searchlightCooldown > 0
          ? this.searchlightCooldown / this.searchlightMaxCooldown
          : 0;
    const spot = getVesselSpotSpec(this.selectedVessel, VESSEL_SPOTS[this.focusSpotIndex].id);
    const vSpec = VESSEL_SPECS[this.selectedVessel];
    const skyPhaseLabel =
      this.nightMix < 0.18
        ? 'DAYLIGHT'
        : this.nightMix < 0.56
          ? 'SUNSET'
          : this.nightMix < 0.85
            ? 'TWILIGHT'
            : 'NIGHT';
    const inHarborZone = Math.hypot(this.shipX, this.shipZ) < 1350 && this.nightMix < 0.45;
    const zoneLabel =
      Math.hypot(this.shipX, this.shipZ) < 620
        ? `SOUTHAMPTON HARBOR · ${skyPhaseLabel}`
        : `NORTH ATLANTIC · ${skyPhaseLabel}`;

    this.onTelemetry({
      vesselId: this.selectedVessel,
      vesselName: vSpec.name,
      vesselShortName: vSpec.shortName,
      vesselBerthLabel: vSpec.berthLabel,
      phase: this.phase,
      cameraMode: this.cameraMode,
      focusSpotId: spot.id,
      focusSpotLabel: spot.label,
      focusSpotCategory: spot.category,
      headingDeg,
      rudderDeg: Math.round(this.rudderDeg),
      speedKnots: Math.round(this.speedKnots),
      telegraphIndex: this.telegraphIndex,
      distanceNm: Number(this.distanceNm.toFixed(1)),
      targetDistanceNm: TARGET_VOYAGE_NM,
      hullIntegrity: Math.round(this.hullIntegrity),
      floodingPct: Math.round(this.floodingPct),
      waterIngressRate: Number(this.waterIngressRate.toFixed(1)),
      compartmentsBreached: breached,
      sinkProgress: this.sinkProgress,
      lifeboatsLaunched: this.lifeboatsLaunched,
      aftermathSeconds: Math.floor(this.aftermathSeconds),
      carpathiaStage: this.carpathiaStage,
      carpathiaEtaSec: Math.max(0, Math.ceil(60 - this.aftermathSeconds)),
      carpathiaDistanceM: this.carpathiaDistanceM,
      survivorsRescued: this.survivorsRescued,
      boatsRecovered: this.boatsRecovered,
      icebergsInField: this.icebergs.length,
      carpathiaSunk: this.carpathiaState.status !== 'intact',
      focusCarpathia: this.aftermathFocus === 'carpathia',
      aftermathFocus: this.aftermathFocus,
      inHarborZone,
      zoneLabel,
      score: Math.round(this.score),
      bestScore: Math.max(this.bestScore, Math.round(this.score)),
      nearMissCount: this.nearMissCount,
      combo: this.combo,
      searchlightActive: this.searchlightTimer > 0,
      searchlightCooldownPct: cooldownPct,
      icebergWarning: this.icebergWarning,
      lastEventText: this.eventText,
      autopilotEnabled: this.autopilotEnabled,
      bowPanicActive: this.bowPanicActive,
      endlessMode: this.endlessMode,
      isMuted: this.sound.isMuted(),
      isMusicMuted: this.sound.isMusicMuted(),
      voyageTimeSec: Math.floor(this.voyageElapsedSec),
      skyPhaseLabel,
    });
  }

  public dispose(): void {
    this.disposed = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (this.softTimerId) {
      window.clearTimeout(this.softTimerId);
      this.softTimerId = 0;
    }
    this.resizeObserver?.disconnect();
    this.unbindEvents();
    this.sound.dispose();
    this.ship.dispose();
    this.carpathia.dispose();
    this.harbor.dispose();
    this.oceanAndSky.dispose();
    this.iceFactory.dispose();
    this.particles.dispose();
    this.textures.dispose();
    this.envRig.dispose();
    this.bloomPass?.dispose();
    this.outputPass?.dispose();
    this.smaaPass?.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    if (this.canvas.parentElement === this.container) {
      this.container.removeChild(this.canvas);
    }
  }
}
