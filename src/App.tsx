import { useEffect, useRef, useState } from 'react';
import { EndModal } from './components/EndModal';
import { GameHUD } from './components/GameHUD';
import { TitleOverlay } from './components/TitleOverlay';
import { TitanicEngine } from './game/TitanicEngine';
import {
  DEFAULT_TELEGRAPH_INDEX,
  TARGET_VOYAGE_NM,
  TELEGRAPH_NOTCHES,
  TelemetrySnapshot,
} from './game/types';

const INITIAL_TELEMETRY: TelemetrySnapshot = {
  vesselId: 'titanic',
  vesselName: 'RMS Titanic',
  vesselShortName: 'Titanic',
  vesselBerthLabel: 'Berth 44',
  phase: 'title',
  cameraMode: 'wheelhouse',
  focusSpotId: 'wheelhouse',
  focusSpotLabel: 'Wheelhouse Helm',
  focusSpotCategory: 'exterior',
  headingDeg: 0,
  rudderDeg: 0,
  speedKnots: TELEGRAPH_NOTCHES[DEFAULT_TELEGRAPH_INDEX].targetKnots,
  telegraphIndex: DEFAULT_TELEGRAPH_INDEX,
  distanceNm: 0,
  targetDistanceNm: TARGET_VOYAGE_NM,
  hullIntegrity: 100,
  floodingPct: 0,
  waterIngressRate: 0,
  compartmentsBreached: 0,
  sinkProgress: 0,
  lifeboatsLaunched: 0,
  aftermathSeconds: 0,
  carpathiaStage: 'waiting',
  carpathiaEtaSec: 60,
  carpathiaDistanceM: 460,
  survivorsRescued: 0,
  boatsRecovered: 0,
  carpathiaSunk: false,
  focusCarpathia: false,
  aftermathFocus: 'lifeboats',
  inHarborZone: true,
  zoneLabel: 'SOUTHAMPTON BERTH 44 & CHANNEL',
  score: 0,
  bestScore: 0,
  nearMissCount: 0,
  combo: 1,
  searchlightActive: false,
  searchlightCooldownPct: 0,
  icebergWarning: null,
  icebergsInField: 0,
  threatMode: 'icebergs',
  submarinesSunk: 0,
  activeTorpedoes: 0,
  lastEventText: null,
  autopilotEnabled: false,
  bowPanicActive: false,
  endlessMode: false,
  isMuted: false,
  isMusicMuted: false,
  voyageTimeSec: 0,
  skyPhaseLabel: 'DAYLIGHT',
  playerOverboard: false,
  wantedLevel: 0,
  wantedEvading: false,
  wantedCooldownPct: 0,
  cash: 1500,
  rep: 0,
  specialFocusPct: 100,
  specialFocusActive: false,
  activeCraft: 'ship',
  speedboatKnots: 0,
  speedboatNitroPct: 100,
  radioStation: 'oceanfm',
  radioStationName: 'OceanFM',
  activeMissionTitle: null,
  activeMissionStep: null,
  activeMissionTimerSec: null,
  missionBannerText: null,
  missionBannerSub: null,
  stuntText: null,
  radarHeadingRad: 0,
  radarBlips: [],
};

export default function App() {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<TitanicEngine | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot>(INITIAL_TELEMETRY);
  const [damageFlash, setDamageFlash] = useState(0);

  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    const engine = new TitanicEngine(
      mountEl,
      (snap) => setTelemetry(snap),
      (strength) => setDamageFlash(strength),
    );
    engineRef.current = engine;

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const showGameHud =
    telemetry.phase === 'playing' ||
    telemetry.phase === 'paused' ||
    telemetry.phase === 'sinking' ||
    telemetry.phase === 'aftermath' ||
    telemetry.phase === 'victory' ||
    telemetry.phase === 'gameover';

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#050b14]">
      {/* Isolated WebGL Mount Container — React UI updates never tear down or re-render the canvas */}
      <div
        ref={canvasMountRef}
        className="absolute inset-0 w-full h-full"
      />

      {/* Brief Crimson Impact Vignette on Collision */}
      {damageFlash > 0.01 && (
        <div
          className="fixed inset-0 pointer-events-none z-20"
          style={{
            opacity: damageFlash * 0.65,
            background:
              'radial-gradient(circle at center, transparent 45%, rgba(185, 28, 28, 0.85) 100%)',
          }}
        />
      )}

      {telemetry.phase === 'title' && (
        <TitleOverlay
          bestScore={telemetry.bestScore}
          selectedVessel={telemetry.vesselId}
          onSelectVessel={(id) => engineRef.current?.selectVessel(id, false)}
          onStart={() => engineRef.current?.startGame()}
          onStartNight={() => engineRef.current?.startNightVoyage()}
        />
      )}

      {showGameHud && (
        <GameHUD
          telemetry={telemetry}
          onSelectVessel={(id) => engineRef.current?.selectVessel(id, true)}
          onSelectTelegraph={(idx) => engineRef.current?.setTelegraphIndex(idx)}
          onSetRudder={(deg) => engineRef.current?.setManualRudder(deg)}
          onToggleAutopilot={() => engineRef.current?.toggleAutopilot()}
          onTriggerSearchlight={() => engineRef.current?.triggerSearchlight()}
          onToggleCamera={() => engineRef.current?.toggleCameraMode()}
          onFocusSpot={(spotId) => engineRef.current?.focusVesselSpot(spotId)}
          onTogglePause={() => engineRef.current?.togglePause()}
          onToggleMute={() => engineRef.current?.toggleMute()}
          onToggleMusic={() => engineRef.current?.toggleMusicMute()}
          onSkipSinking={() => engineRef.current?.skipSinking()}
          onFastForwardRescue={() => engineRef.current?.fastForwardRescueWait()}
          onFocusAftermath={(target) => engineRef.current?.focusAftermathTarget(target)}
          onOpenReport={() => engineRef.current?.openVoyageReport()}
          onRestart={() => engineRef.current?.startGame()}
          onReturnToShip={() => engineRef.current?.returnPlayerToShip()}
          onToggleSpeedboat={() => engineRef.current?.toggleSpeedboat()}
          onToggleFocus={() => engineRef.current?.toggleSpecialFocus()}
          onCycleMission={() => engineRef.current?.startOrCycleMission()}
          onCycleRadio={() => engineRef.current?.cycleRadioStation()}
        />
      )}

      <EndModal
        telemetry={telemetry}
        onRestart={() => engineRef.current?.startGame()}
        onResume={() => engineRef.current?.togglePause()}
        onContinueEndless={() => engineRef.current?.continueEndless()}
        onObserveAftermath={() => engineRef.current?.closeVoyageReportToAftermath()}
        onReturnTitle={() => engineRef.current?.returnToTitle()}
      />
    </main>
  );
}
