export type VesselId = 'titanic' | 'britannic' | 'concordia';

export interface VesselSpec {
  id: VesselId;
  name: string;
  shortName: string;
  line: string;
  berthLabel: string;
  berthX: number;
  berthZ: number;
  lengthM: number;
  beamM: number;
  halfBeam: number;
  bowZ: number;
  sternZ: number;
  breakZ: number;
  fullKnots: number;
  flankKnots: number;
  turnMultiplier: number;
  hullResilience: number;
  telegraphBrand: string;
  specSummary: string;
}

export const VESSEL_ORDER: VesselId[] = ['titanic', 'britannic', 'concordia'];

export const VESSEL_SPECS: Record<VesselId, VesselSpec> = {
  titanic: {
    id: 'titanic',
    name: 'RMS Titanic',
    shortName: 'Titanic',
    line: 'White Star Line',
    berthLabel: 'Berth 44',
    berthX: 0,
    berthZ: 0,
    lengthM: 269.1,
    beamM: 28.0,
    halfBeam: 14.0,
    bowZ: -74.0,
    sternZ: 195.1,
    breakZ: 90.0,
    fullKnots: 22,
    flankKnots: 30,
    turnMultiplier: 1.0,
    hullResilience: 1.0,
    telegraphBrand: 'WHITE STAR',
    specSummary: 'White Star Flagship · 269.1m · Iceberg Alley · Balanced Helm',
  },
  britannic: {
    id: 'britannic',
    name: 'HMHS Britannic',
    shortName: 'Britannic',
    line: 'White Star Hospital',
    berthLabel: 'Berth 40',
    berthX: -109,
    berthZ: 0,
    lengthM: 269.1,
    beamM: 28.6,
    halfBeam: 14.3,
    bowZ: -74.0,
    sternZ: 195.1,
    breakZ: 90.0,
    fullKnots: 21,
    flankKnots: 29,
    turnMultiplier: 0.96,
    hullResilience: 1.25,
    telegraphBrand: 'WHITE STAR',
    specSummary: 'Hospital Ship · 269.1m · U-Boat Patrol · +25% Reinforced Hull',
  },
  concordia: {
    id: 'concordia',
    name: 'Costa Concordia',
    shortName: 'Concordia',
    line: 'Costa Crociere',
    berthLabel: 'Berth 38',
    berthX: -219.5,
    berthZ: 0,
    lengthM: 290.2,
    beamM: 35.5,
    halfBeam: 17.75,
    bowZ: -80.0,
    sternZ: 210.2,
    breakZ: 98.0,
    fullKnots: 20,
    flankKnots: 26,
    turnMultiplier: 1.24,
    hullResilience: 1.08,
    telegraphBrand: 'COSTA CROCIERE',
    specSummary: 'Mega Cruise Liner · 290.2m · Twin Azipods · Granite Reefs · +24% Helm',
  },
};

export type GamePhase =
  | 'title'
  | 'playing'
  | 'paused'
  | 'sinking'
  | 'aftermath'
  | 'victory'
  | 'gameover';

export type CameraMode = 'wheelhouse' | 'bridgeWing';

export type VesselSpotId =
  | 'wheelhouse'
  | 'bow'
  | 'crowsNest'
  | 'lifeboats'
  | 'funnels'
  | 'stern'
  | 'staircase'
  | 'marconi'
  | 'lounge'
  | 'dining'
  | 'engine';

export interface VesselSpotSpec {
  id: VesselSpotId;
  category: 'exterior' | 'interior';
  label: string;
  shortLabel: string;
  localTarget: [number, number, number];
  defaultOrbitYaw: number;
  defaultOrbitPitch: number;
  defaultDistance: number;
  minDistance: number;
  walkBounds?: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
}

export const VESSEL_SPOTS: VesselSpotSpec[] = [
  {
    id: 'wheelhouse',
    category: 'exterior',
    label: 'Wheelhouse Helm',
    shortLabel: 'HELM',
    localTarget: [0, 14.78, 1.32],
    defaultOrbitYaw: 0,
    defaultOrbitPitch: 0.085,
    defaultDistance: 0,
    minDistance: 0,
    walkBounds: { minX: -3.6, maxX: 3.6, minZ: -1.1, maxZ: 2.3 },
  },
  {
    id: 'bow',
    category: 'exterior',
    label: 'Bow & Forecastle',
    shortLabel: 'BOW',
    localTarget: [0, 11.2, -56],
    defaultOrbitYaw: 0.45,
    defaultOrbitPitch: 0.16,
    defaultDistance: 36,
    minDistance: 0,
    walkBounds: { minX: -6.5, maxX: 6.5, minZ: -68, maxZ: -36 },
  },
  {
    id: 'crowsNest',
    category: 'exterior',
    label: "Crow's Nest Lookout",
    shortLabel: 'MAST',
    localTarget: [0, 26.8, -22.5],
    defaultOrbitYaw: 0.25,
    defaultOrbitPitch: 0.14,
    defaultDistance: 20,
    minDistance: 0,
  },
  {
    id: 'lifeboats',
    category: 'exterior',
    label: 'Boat Deck & Lifeboats',
    shortLabel: 'BOATS',
    localTarget: [12.5, 13.8, 28],
    defaultOrbitYaw: 1.05,
    defaultOrbitPitch: 0.18,
    defaultDistance: 38,
    minDistance: 0,
    walkBounds: { minX: -12.6, maxX: 12.6, minZ: 4, maxZ: 86 },
  },
  {
    id: 'funnels',
    category: 'exterior',
    label: 'Full 269m Ship & Funnels',
    shortLabel: 'SHIP',
    localTarget: [0, 19.0, 62],
    defaultOrbitYaw: 0.85,
    defaultOrbitPitch: 0.22,
    defaultDistance: 138,
    minDistance: 4,
  },
  {
    id: 'stern',
    category: 'exterior',
    label: 'Cruiser Stern & Propellers',
    shortLabel: 'STERN',
    localTarget: [0, 10.2, 180],
    defaultOrbitYaw: 2.55,
    defaultOrbitPitch: 0.2,
    defaultDistance: 46,
    minDistance: 0,
    walkBounds: { minX: -7.5, maxX: 7.5, minZ: 170, maxZ: 192 },
  },
  {
    id: 'staircase',
    category: 'interior',
    label: 'Grand Staircase Atrium',
    shortLabel: 'STAIRS',
    localTarget: [0, 11.4, 36.2],
    defaultOrbitYaw: 0,
    defaultOrbitPitch: 0.12,
    defaultDistance: 0,
    minDistance: 0,
    walkBounds: { minX: -4.8, maxX: 4.8, minZ: 28.6, maxZ: 38.0 },
  },
  {
    id: 'marconi',
    category: 'interior',
    label: 'Marconi Wireless & Gym',
    shortLabel: 'MARCONI',
    localTarget: [0, 14.3, 48.2],
    defaultOrbitYaw: 0.28,
    defaultOrbitPitch: 0.08,
    defaultDistance: 0,
    minDistance: 0,
    walkBounds: { minX: -4.6, maxX: 4.6, minZ: 42.8, maxZ: 50.6 },
  },
  {
    id: 'lounge',
    category: 'interior',
    label: 'A-Deck Lounge & Promenade',
    shortLabel: 'LOUNGE',
    localTarget: [0, 11.35, 73.5],
    defaultOrbitYaw: 0.35,
    defaultOrbitPitch: 0.06,
    defaultDistance: 0,
    minDistance: 0,
    walkBounds: { minX: -12.4, maxX: 12.4, minZ: 64.5, maxZ: 81.0 },
  },
  {
    id: 'dining',
    category: 'interior',
    label: 'D-Deck First Class Dining',
    shortLabel: 'DINING',
    localTarget: [0, 4.15, 53.0],
    defaultOrbitYaw: 0.22,
    defaultOrbitPitch: 0.07,
    defaultDistance: 0,
    minDistance: 0,
    walkBounds: { minX: -10.5, maxX: 10.5, minZ: 41.0, maxZ: 64.5 },
  },
  {
    id: 'engine',
    category: 'interior',
    label: 'Reciprocating Engine Room',
    shortLabel: 'ENGINE',
    localTarget: [0, 2.2, 108.0],
    defaultOrbitYaw: 0.18,
    defaultOrbitPitch: 0.1,
    defaultDistance: 0,
    minDistance: 0,
    walkBounds: { minX: -8.6, maxX: 8.6, minZ: 95.0, maxZ: 120.5 },
  },
];

const CONCORDIA_SPOT_OVERRIDES: Partial<Record<VesselSpotId, Partial<VesselSpotSpec>>> = {
  wheelhouse: {
    label: 'Panoramic Bridge & Wings',
    localTarget: [0, 28.25, -0.45],
    walkBounds: { minX: -18.5, maxX: 18.5, minZ: -1.4, maxZ: 2.2 },
  },
  bow: {
    label: 'Foredeck & Bulbous Bow',
    localTarget: [0, 12.2, -56],
    walkBounds: { minX: -6.5, maxX: 6.5, minZ: -74, maxZ: -20 },
  },
  crowsNest: {
    label: 'Radar Mast & Satcom',
    shortLabel: 'RADAR',
    localTarget: [0, 39.5, 5.8],
    defaultDistance: 24,
  },
  lifeboats: {
    label: 'Deck 4 SOLAS Boats',
    localTarget: [16.4, 12.8, 36],
    defaultDistance: 44,
    walkBounds: { minX: -16.2, maxX: 16.2, minZ: 12, maxZ: 96 },
  },
  funnels: {
    label: 'Full 290m Ship & Costa Funnel',
    localTarget: [0, 22.0, 68],
    defaultDistance: 152,
  },
  stern: {
    label: 'Aft Lido Terraces & Azipods',
    localTarget: [0, 17.6, 188],
    defaultDistance: 52,
    walkBounds: { minX: -10.5, maxX: 10.5, minZ: 176, maxZ: 204 },
  },
  staircase: {
    label: 'Europa Grand Atrium',
    shortLabel: 'ATRIUM',
    localTarget: [0, 15.2, 42.0],
    walkBounds: { minX: -6.5, maxX: 6.5, minZ: 33.5, maxZ: 50.5 },
  },
  marconi: {
    label: 'GMDSS Radio & Radar Room',
    shortLabel: 'GMDSS',
    localTarget: [0, 28.1, 6.2],
    walkBounds: { minX: -4.8, maxX: 4.8, minZ: 3.6, maxZ: 8.8 },
  },
  lounge: {
    label: 'Lido Magrodome Pool Deck',
    shortLabel: 'LIDO',
    localTarget: [0, 25.4, 72.0],
    walkBounds: { minX: -12.5, maxX: 12.5, minZ: 56.5, maxZ: 87.5 },
  },
  dining: {
    label: 'Ristorante Milano Dining',
    shortLabel: 'DINING',
    localTarget: [0, 6.4, 58.0],
    walkBounds: { minX: -12.4, maxX: 12.4, minZ: 43.0, maxZ: 73.0 },
  },
  engine: {
    label: 'Diesel-Electric Wärtsilä Room',
    shortLabel: 'DIESEL',
    localTarget: [0, 2.2, 122.0],
    walkBounds: { minX: -9.8, maxX: 9.8, minZ: 109.5, maxZ: 134.5 },
  },
};

export function getVesselSpotSpec(vesselId: VesselId, spotId: VesselSpotId): VesselSpotSpec {
  const base = VESSEL_SPOTS.find((s) => s.id === spotId) ?? VESSEL_SPOTS[0];
  if (vesselId !== 'concordia') return base;
  const ov = CONCORDIA_SPOT_OVERRIDES[spotId];
  if (!ov) return base;
  return {
    ...base,
    ...ov,
  };
}

export function getVesselSpots(vesselId: VesselId): VesselSpotSpec[] {
  if (vesselId !== 'concordia') return VESSEL_SPOTS;
  return VESSEL_SPOTS.map((s) => getVesselSpotSpec(vesselId, s.id));
}

export type TelegraphNotch = 'ASTERN' | 'STOP' | 'SLOW' | 'HALF' | 'FULL' | 'FLANK';

export interface TelegraphSpec {
  id: TelegraphNotch;
  label: string;
  shortLabel: string;
  targetKnots: number;
  leverAngle: number; // radians on Chadburn dial
}

export const TELEGRAPH_NOTCHES: TelegraphSpec[] = [
  { id: 'ASTERN', label: 'FULL ASTERN', shortLabel: 'ASTERN', targetKnots: -8, leverAngle: -1.15 },
  { id: 'STOP', label: 'ALL STOP', shortLabel: 'STOP', targetKnots: 0, leverAngle: -0.68 },
  { id: 'SLOW', label: 'SLOW AHEAD', shortLabel: 'SLOW', targetKnots: 8, leverAngle: -0.22 },
  { id: 'HALF', label: 'HALF AHEAD', shortLabel: 'HALF', targetKnots: 14, leverAngle: 0.25 },
  { id: 'FULL', label: 'FULL AHEAD', shortLabel: 'FULL', targetKnots: 22, leverAngle: 0.72 },
  { id: 'FLANK', label: 'FLANK SPEED', shortLabel: 'FLANK', targetKnots: 30, leverAngle: 1.18 },
];

export function getEffectiveTelegraphKnots(vesselId: VesselId, telegraphIndex: number): number {
  const spec = VESSEL_SPECS[vesselId];
  const base = (TELEGRAPH_NOTCHES[telegraphIndex] ?? TELEGRAPH_NOTCHES[4]).targetKnots;
  if (telegraphIndex === 4) return spec.fullKnots;
  if (telegraphIndex === 5) return spec.flankKnots;
  return base;
}

export type IcebergVariant = 'growler' | 'tabular' | 'pinnacle';
export type CarpathiaStage = 'waiting' | 'approaching' | 'boarding' | 'complete';
export type AftermathFocusTarget = 'lifeboats' | 'carpathia';

export type CraftMode = 'ship' | 'speedboat';
export type RadioStationId = 'oceanfm' | 'leonida' | 'lounge' | 'off';

export interface RadarBlip {
  dx: number; // relative to player world X (meters)
  dz: number; // relative to player world Z (meters)
  kind: 'hazard' | 'police' | 'chopper' | 'mission' | 'speedboat' | 'ship' | 'sub';
}

export interface TelemetrySnapshot {
  vesselId: VesselId;
  vesselName: string;
  vesselShortName: string;
  vesselBerthLabel: string;
  phase: GamePhase;
  cameraMode: CameraMode;
  focusSpotId: VesselSpotId;
  focusSpotLabel: string;
  focusSpotCategory: 'exterior' | 'interior';
  headingDeg: number;
  rudderDeg: number; // -35 (Port) to +35 (Starboard)
  speedKnots: number;
  telegraphIndex: number;
  distanceNm: number;
  targetDistanceNm: number;
  hullIntegrity: number; // 0 to 100
  floodingPct: number; // 0 to 100
  waterIngressRate: number; // % per second
  compartmentsBreached: number; // 0 to 5
  sinkProgress: number; // 0 to 1 during sinking sequence
  lifeboatsLaunched: number;
  aftermathSeconds: number;
  carpathiaStage: CarpathiaStage;
  carpathiaEtaSec: number;
  carpathiaDistanceM: number;
  survivorsRescued: number;
  boatsRecovered: number;
  carpathiaSunk: boolean;
  focusCarpathia: boolean;
  aftermathFocus: AftermathFocusTarget;
  inHarborZone: boolean;
  zoneLabel: string;
  score: number;
  bestScore: number;
  nearMissCount: number;
  combo: number;
  searchlightActive: boolean;
  searchlightCooldownPct: number; // 0 = ready, 1 = cooling
  icebergWarning: string | null;
  icebergsInField: number;
  threatMode: 'icebergs' | 'submarines' | 'reefs';
  submarinesSunk: number;
  activeTorpedoes: number;
  lastEventText: string | null;
  autopilotEnabled: boolean;
  bowPanicActive: boolean;
  endlessMode: boolean;
  isMuted: boolean;
  isMusicMuted: boolean;
  voyageTimeSec: number;
  skyPhaseLabel: string;
  playerOverboard: boolean;
  // GTA 6 Sandbox & Open-World Systems
  wantedLevel: number; // 0 to 5 stars
  wantedEvading: boolean;
  wantedCooldownPct: number; // 0 to 1 evasion progress
  cash: number;
  rep: number;
  specialFocusPct: number; // 0 to 100
  specialFocusActive: boolean;
  activeCraft: CraftMode;
  speedboatKnots: number;
  speedboatNitroPct: number;
  radioStation: RadioStationId;
  radioStationName: string;
  activeMissionTitle: string | null;
  activeMissionStep: string | null;
  activeMissionTimerSec: number | null;
  missionBannerText: string | null;
  missionBannerSub: string | null;
  stuntText: string | null;
  radarHeadingRad: number;
  radarBlips: RadarBlip[];
}

export const DEFAULT_TELEGRAPH_INDEX = 4;
export const TARGET_VOYAGE_NM = 3.0;
