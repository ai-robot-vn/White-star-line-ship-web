import React, { useEffect, useState } from 'react';
import {
  Anchor,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Compass,
  Droplets,
  Eye,
  EyeOff,
  FastForward,
  HelpCircle,
  Layers,
  LifeBuoy,
  Minus,
  Music,
  Navigation,
  Pause,
  Plus,
  Search,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  AftermathFocusTarget,
  getVesselSpots,
  TELEGRAPH_NOTCHES,
  TelemetrySnapshot,
  VESSEL_ORDER,
  VESSEL_SPECS,
  VesselId,
  VesselSpotId,
} from '../game/types';

interface GameHUDProps {
  telemetry: TelemetrySnapshot;
  onSelectTelegraph?: (idx: number) => void;
  onSetRudder: (deg: number | null) => void;
  onToggleAutopilot: () => void;
  onTriggerSearchlight: () => void;
  onToggleCamera: () => void;
  onFocusSpot: (spotId: VesselSpotId) => void;
  onTogglePause: () => void;
  onToggleMute: () => void;
  onToggleMusic: () => void;
  onSkipSinking: () => void;
  onFastForwardRescue: () => void;
  onFocusAftermath: (target: AftermathFocusTarget) => void;
  onOpenReport: () => void;
  onRestart: () => void;
  onSelectVessel?: (vesselId: VesselId) => void;
}

const GUIDE_SEEN_KEY = 'titanic_button_guide_seen_v1';

function getCardinalLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

function formatClock(totalSec: number): string {
  const clamped = Math.max(0, Math.floor(totalSec));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const GameHUD: React.FC<GameHUDProps> = ({
  telemetry,
  onSelectTelegraph,
  onSetRudder,
  onToggleAutopilot,
  onTriggerSearchlight,
  onFocusSpot,
  onTogglePause,
  onToggleMute,
  onToggleMusic,
  onSkipSinking,
  onFastForwardRescue,
  onFocusAftermath,
  onOpenReport,
  onRestart,
  onSelectVessel,
}) => {
  const [panelsVisible, setPanelsVisible] = useState(true);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(GUIDE_SEEN_KEY) !== '1';
    } catch {
      return true;
    }
  });

  const dismissGuide = () => {
    setGuideOpen(false);
    try {
      localStorage.setItem(GUIDE_SEEN_KEY, '1');
    } catch {
      // ignore storage errors
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyH' && !e.repeat) {
        setPanelsVisible((prev) => !prev);
      } else if (e.code === 'KeyG' && !e.repeat) {
        setGuideOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const isSinking = telemetry.phase === 'sinking';
  const isAftermath = telemetry.phase === 'aftermath';
  const isPlaying = telemetry.phase === 'playing' || telemetry.phase === 'paused';

  const sinkingStageText =
    telemetry.sinkProgress < 0.4
      ? 'BOW FLOODING — STERN RISING ABOVE SEA'
      : telemetry.sinkProgress < 0.56
        ? 'HULL FRACTURED AT MIDSHIPS — BREAKING IN TWO'
        : telemetry.sinkProgress < 0.78
          ? 'BOW SUBMERGED — STERN REARING VERTICAL'
          : 'FINAL PLUNGE — SLOW DEEP-SEA DESCENT';

  const hullPct = telemetry.hullIntegrity;
  const hullColor =
    hullPct > 60 ? '#34d399' : hullPct > 30 ? '#fbbf24' : '#ef4444';

  const floodPct = telemetry.floodingPct;
  const floodColor = floodPct > 75 ? '#ef4444' : '#38bdf8';

  const currentNotch = TELEGRAPH_NOTCHES[telemetry.telegraphIndex] ?? TELEGRAPH_NOTCHES[4];

  const nudgeRudder = (deltaDeg: number) => {
    const next = Math.max(-35, Math.min(35, telemetry.rudderDeg + deltaDeg));
    onSetRudder(next);
  };

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-3.5 md:p-5 font-sans-ui">
      {/* TOP PERIMETER BAR */}
      <div className="flex items-start justify-between gap-3">
        {/* Top-Left: Hull Integrity, Sky Phase & Distance */}
        <div
          className={`transition-all duration-200 ease-out ${
            panelsVisible
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 -translate-y-2 pointer-events-none'
          }`}
        >
          <div className="apple-glass-panel px-4 py-3 rounded-2xl min-w-[248px]">
            <div className="flex items-center justify-between text-[11px] font-semibold tracking-[0.06em] text-slate-200 mb-2">
              <span>{telemetry.vesselShortName} · Hull Integrity</span>
              <span className="font-bold tabular-nums text-xs" style={{ color: hullColor }}>
                {hullPct}%
              </span>
            </div>

            <div className="grid grid-cols-5 gap-1.5 mb-2.5">
              {[0, 1, 2, 3, 4].map((idx) => {
                const compThreshold = (5 - idx) * 20;
                const intact = hullPct >= compThreshold - 10;
                return (
                  <div
                    key={idx}
                    className="h-2 rounded-md transition-colors duration-200"
                    style={{
                      backgroundColor: intact ? hullColor : 'rgba(239, 68, 68, 0.34)',
                      border: '1px solid rgba(255,255,255,0.16)',
                    }}
                  />
                );
              })}
            </div>

            {(floodPct > 0 || isSinking || isAftermath) && (
              <div className="mb-2.5">
                <div className="flex items-center justify-between text-[10px] font-semibold tracking-[0.06em] mb-1">
                  <span className="flex items-center gap-1 text-sky-300">
                    <Droplets className="w-3 h-3" />
                    Flooding
                  </span>
                  <span className="font-bold tabular-nums" style={{ color: floodColor }}>
                    {floodPct}%
                    {!isSinking && telemetry.waterIngressRate > 0 && ` (+${telemetry.waterIngressRate}%/s)`}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-white/10 rounded-md overflow-hidden border border-white/10">
                  <div
                    className="h-full transition-all duration-150 rounded-md"
                    style={{ width: `${floodPct}%`, backgroundColor: floodColor }}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-200 tabular-nums pt-1 border-t border-white/10">
              <span className="text-slate-300/90 text-[10px] truncate max-w-[165px]">
                {telemetry.endlessMode ? 'Endless Watch' : telemetry.zoneLabel}
              </span>
              <span className="font-semibold text-amber-200 shrink-0">
                {telemetry.distanceNm.toFixed(1)}
                {!telemetry.endlessMode && ` / ${telemetry.targetDistanceNm.toFixed(1)} NM`}
                {telemetry.endlessMode && ' NM'}
              </span>
            </div>
          </div>
        </div>

        {/* Top-Center: Clean Compass, Speed, Sky Time & Active Alerts */}
        <div
          className={`flex flex-col items-center gap-2 transition-all duration-200 ease-out ${
            panelsVisible
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 -translate-y-2 pointer-events-none'
          }`}
        >
          <div className="apple-glass-panel px-4 py-2 rounded-2xl flex items-center gap-3">
            <Compass className="w-4 h-4 text-amber-200 shrink-0" />
            <div className="text-sm font-semibold tracking-[0.08em] text-white tabular-nums whitespace-nowrap">
              {String(telemetry.headingDeg).padStart(3, '0')}° {getCardinalLabel(telemetry.headingDeg)}
            </div>
            <div className="h-3.5 w-[1px] bg-white/20" />
            <div className="text-xs font-semibold tracking-[0.06em] text-amber-200 tabular-nums whitespace-nowrap">
              {telemetry.speedKnots} KTS
            </div>
            {isPlaying && (
              <>
                <div className="h-3.5 w-[1px] bg-white/20 hidden sm:block" />
                <div className="hidden sm:block text-[11px] font-medium text-slate-200/90 tabular-nums whitespace-nowrap">
                  {formatClock(telemetry.voyageTimeSec)} · {telemetry.skyPhaseLabel}
                </div>
              </>
            )}
          </div>

          {isSinking ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <div className="apple-glass-danger px-4 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.1em] uppercase text-red-100">
                ▲ {sinkingStageText}
              </div>
              <div className="apple-glass-panel px-3.5 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.08em] text-amber-100 tabular-nums">
                Lifeboats: {telemetry.lifeboatsLaunched} / 16
              </div>
            </div>
          ) : isAftermath ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {telemetry.carpathiaSunk && (
                <div className="apple-glass-danger px-3.5 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.1em] uppercase text-red-100">
                  ▲ RMS Carpathia Struck — Sinking
                </div>
              )}

              {!telemetry.carpathiaSunk && telemetry.carpathiaStage === 'waiting' && (
                <>
                  <div className="apple-glass-panel px-3.5 py-1.5 rounded-xl text-[11px] font-semibold text-sky-200 flex items-center gap-1.5 tabular-nums">
                    <Anchor className="w-3.5 h-3.5 text-sky-300" />
                    Lifeboats Afloat: {telemetry.lifeboatsLaunched} / 16
                  </div>
                  <div className="apple-glass-panel px-3.5 py-1.5 rounded-xl text-[11px] font-semibold text-amber-200 flex items-center gap-1.5 tabular-nums">
                    <Clock className="w-3.5 h-3.5 text-amber-200" />
                    RMS Carpathia In {formatClock(telemetry.carpathiaEtaSec)}
                  </div>
                </>
              )}

              {!telemetry.carpathiaSunk && telemetry.carpathiaStage === 'approaching' && (
                <div className="apple-glass-panel px-3.5 py-1.5 rounded-xl text-[11px] font-semibold text-sky-200 flex items-center gap-2 tabular-nums">
                  <Anchor className="w-3.5 h-3.5 text-sky-300" />
                  <span>Carpathia Approaching · {telemetry.carpathiaDistanceM} M</span>
                  <span className="text-amber-100">· Aboard {telemetry.survivorsRescued} / 712</span>
                </div>
              )}

              {!telemetry.carpathiaSunk && telemetry.carpathiaStage === 'boarding' && (
                <div className="apple-glass-panel px-3.5 py-1.5 rounded-xl text-[11px] font-semibold text-emerald-200 flex items-center gap-2 tabular-nums">
                  <LifeBuoy className="w-3.5 h-3.5 text-emerald-300" />
                  <span>Boarding Survivors · {telemetry.survivorsRescued} / 712</span>
                </div>
              )}

              {!telemetry.carpathiaSunk && telemetry.carpathiaStage === 'complete' && (
                <div className="apple-glass-panel px-4 py-1.5 rounded-xl text-[11px] font-semibold text-emerald-200 flex items-center gap-1.5">
                  <LifeBuoy className="w-3.5 h-3.5 text-emerald-300" />
                  Rescue Complete — 712 Survivors Aboard RMS Carpathia
                </div>
              )}
            </div>
          ) : (
            <>
              {telemetry.icebergWarning && (
                <div className="apple-glass-danger px-4 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.12em] uppercase text-red-100">
                  ▲ {telemetry.icebergWarning}
                </div>
              )}

              {telemetry.bowPanicActive && !telemetry.lastEventText && (
                <div className="apple-glass-danger px-4 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.1em] uppercase text-red-100">
                  ▲ Passengers Rushing To The Bow
                </div>
              )}

              {telemetry.lastEventText && !telemetry.icebergWarning && (
                <div className="apple-glass-panel px-4 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.06em] text-amber-100">
                  {telemetry.lastEventText}
                </div>
              )}
            </>
          )}
        </div>

        {/* Top-Right: Score & Minimal Utility Buttons */}
        <div className="flex items-start gap-2">
          <div
            className={`apple-glass-panel px-4 py-2 rounded-2xl text-right transition-all duration-200 ease-out ${
              panelsVisible
                ? 'opacity-100 translate-y-0'
                : 'opacity-0 -translate-y-2 pointer-events-none'
            }`}
          >
            <div className="flex items-center justify-end gap-2 text-[10px] font-semibold tracking-[0.1em] uppercase text-slate-300/90">
              <span>Score</span>
              {telemetry.combo > 1 && (
                <span className="text-amber-300 font-bold tabular-nums">×{telemetry.combo}</span>
              )}
            </div>
            <div className="text-base font-bold text-white tabular-nums">
              {telemetry.score.toLocaleString()}
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5 pointer-events-auto">
            <div className="flex items-center gap-1.5">
              {isPlaying && (
                <button
                  type="button"
                  onClick={() => (guideOpen ? dismissGuide() : setGuideOpen(true))}
                  title="Control Guide (G)"
                  className={`apple-glass-panel hover:bg-white/15 px-3 py-2 rounded-xl text-[11px] font-semibold cursor-pointer transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                    guideOpen ? 'text-amber-200' : 'text-slate-100'
                  }`}
                >
                  <HelpCircle className="w-3.5 h-3.5 text-amber-200" />
                  <span>Guide</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setPanelsVisible((v) => !v)}
                title="Show / Hide HUD (H)"
                className="apple-glass-panel hover:bg-white/15 px-3 py-2 rounded-xl text-[11px] font-semibold text-slate-100 cursor-pointer transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {panelsVisible ? (
                  <>
                    <EyeOff className="w-3.5 h-3.5 text-amber-200" />
                    <span className="hidden sm:inline">Hide HUD</span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5 text-amber-200" />
                    <span>Show HUD</span>
                  </>
                )}
              </button>
            </div>

            <div
              className={`flex items-center gap-1.5 transition-all duration-200 ease-out ${
                panelsVisible
                  ? 'opacity-100 translate-y-0'
                  : 'opacity-0 -translate-y-2 pointer-events-none'
              }`}
            >
              {isPlaying && (
                <button
                  type="button"
                  onClick={onTogglePause}
                  title="Pause (Esc)"
                  className="apple-glass-panel hover:bg-white/15 p-2 rounded-xl text-amber-100 cursor-pointer transition-colors"
                >
                  <Pause className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={onToggleMusic}
                title={telemetry.isMusicMuted ? 'Play Background Music' : 'Mute Background Music'}
                aria-label="Toggle Background Music"
                className={`apple-glass-panel hover:bg-white/15 p-2 rounded-xl cursor-pointer transition-colors ${
                  telemetry.isMusicMuted ? 'text-slate-400' : 'text-amber-100'
                }`}
              >
                <Music className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onToggleMute}
                title="Mute / Unmute All Audio (M)"
                aria-label="Mute All Audio"
                className="apple-glass-panel hover:bg-white/15 p-2 rounded-xl text-amber-100 cursor-pointer transition-colors"
              >
                {telemetry.isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM BAR */}
      <div
        className={`transition-all duration-200 ease-out ${
          panelsVisible
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-3 pointer-events-none'
        }`}
      >
        {isSinking ? (
          <div className="flex flex-col items-center gap-2">
            <div className="pointer-events-auto apple-glass-panel rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-center gap-1.5 max-w-[95vw]">
              <button
                type="button"
                onClick={() => setViewsOpen((v) => !v)}
                className="apple-glass-subtle hover:bg-white/15 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-amber-100 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Layers className="w-3.5 h-3.5" />
                Views ({telemetry.focusSpotLabel})
              </button>
              <button
                type="button"
                onClick={onSkipSinking}
                className="apple-glass-gold hover:brightness-110 flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-amber-50 text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0"
              >
                <FastForward className="w-3.5 h-3.5" />
                Skip To Aftermath
              </button>
            </div>

            {viewsOpen && (
              <div className="pointer-events-auto apple-glass-panel rounded-2xl p-3 max-w-[92vw] flex flex-wrap items-center justify-center gap-1.5">
                {getVesselSpots(telemetry.vesselId).map((spot) => {
                  const active = telemetry.focusSpotId === spot.id;
                  return (
                    <button
                      key={spot.id}
                      type="button"
                      onClick={() => {
                        onFocusSpot(spot.id);
                        setViewsOpen(false);
                      }}
                      className={`px-3 py-1 text-[11px] font-medium rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        active
                          ? 'apple-glass-gold text-amber-50'
                          : 'apple-glass-subtle text-slate-200 hover:bg-white/15'
                      }`}
                    >
                      {spot.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : isAftermath ? (
          <div className="flex flex-col items-center gap-2">
            <div className="pointer-events-auto apple-glass-panel rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-center gap-2 max-w-[95vw]">
              <button
                type="button"
                onClick={() => onFocusAftermath('lifeboats')}
                className={`px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  telemetry.aftermathFocus === 'lifeboats'
                    ? 'apple-glass-gold text-amber-50'
                    : 'apple-glass-subtle text-slate-200 hover:bg-white/15'
                }`}
              >
                Lifeboats
              </button>
              {telemetry.carpathiaStage !== 'waiting' && (
                <button
                  type="button"
                  onClick={() => onFocusAftermath('carpathia')}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    telemetry.aftermathFocus === 'carpathia'
                      ? 'apple-glass-gold text-amber-50'
                      : 'apple-glass-subtle text-slate-200 hover:bg-white/15'
                  }`}
                >
                  RMS Carpathia
                </button>
              )}
              {telemetry.carpathiaStage === 'waiting' && (
                <button
                  type="button"
                  onClick={onFastForwardRescue}
                  className="apple-glass-subtle hover:bg-white/15 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sky-200 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <FastForward className="w-3.5 h-3.5" />
                  Skip Wait
                </button>
              )}
              <button
                type="button"
                onClick={onOpenReport}
                className="apple-glass-subtle hover:bg-white/15 px-3.5 py-1.5 rounded-xl text-amber-100 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Voyage Report
              </button>
              <button
                type="button"
                onClick={onRestart}
                className="apple-glass-gold hover:brightness-110 px-4 py-1.5 rounded-xl text-amber-50 text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0"
              >
                Sail Again
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            {/* FIRST-PLAY ON-SCREEN BUTTON GUIDANCE (non-blocking above dock) */}
            {guideOpen && !dockCollapsed && (
              <div className="pointer-events-none w-full max-w-[920px] px-2">
                <div className="apple-glass-panel rounded-2xl p-3.5 md:p-4">
                  <div className="flex items-center justify-between gap-3 mb-2.5 pb-2 border-b border-white/12">
                    <div className="text-xs font-semibold text-amber-100">
                      Bridge Controls Guide — Try any button below or dismiss to sail unobstructed
                    </div>
                    <button
                      type="button"
                      onClick={dismissGuide}
                      className="pointer-events-auto apple-glass-gold hover:brightness-110 inline-flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-semibold text-amber-50 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <span>Got It</span>
                      <X className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5 text-[11px] leading-snug">
                    <div>
                      <div className="font-semibold text-amber-200">1. Helm Steering</div>
                      <div className="text-slate-200/85">
                        Turn Port or Starboard (<span className="text-white font-medium">← / →</span>) or drag slider. Click degree label to center.
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold text-amber-200">2. Engine Speed</div>
                      <div className="text-slate-200/85">
                        Tap <span className="text-white font-medium">− / +</span> (<span className="text-white font-medium">Z / X</span>) to adjust speed from Astern to Flank.
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold text-amber-200">3. Autopilot</div>
                      <div className="text-slate-200/85">
                        Toggle (<span className="text-white font-medium">T</span>) so bridge officers steer cleanly around icebergs.
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold text-amber-200">4. Searchlight</div>
                      <div className="text-slate-200/85">
                        Press (<span className="text-white font-medium">Space</span>) to sweep a forward beam in twilight &amp; darkness.
                      </div>
                    </div>
                    <div className="col-span-2 md:col-span-1">
                      <div className="font-semibold text-amber-200">5. Views &amp; Decks</div>
                      <div className="text-slate-200/85">
                        Open camera stations or walk decks (<span className="text-white font-medium">W A S D</span> + drag to look).
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* COLLAPSIBLE VIEWS & DECKS DRAWER (only rendered when clicked) */}
            {viewsOpen && !dockCollapsed && (
              <div className="pointer-events-auto apple-glass-panel rounded-2xl p-3.5 max-w-[740px] w-[94vw]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-amber-200">
                    Camera Stations &amp; Walkable Interior Decks (W/A/S/D to Walk · V to Cycle)
                  </span>
                  <button
                    type="button"
                    onClick={() => setViewsOpen(false)}
                    aria-label="Close Views Drawer"
                    className="text-slate-300 hover:text-white p-1 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {onSelectVessel && (
                  <div className="flex flex-wrap items-center gap-1.5 mb-2 pb-2 border-b border-white/10">
                    <span className="text-[10px] font-semibold text-amber-200/90 mr-1">Take Helm:</span>
                    {VESSEL_ORDER.map((id) => {
                      const spec = VESSEL_SPECS[id];
                      const active = telemetry.vesselId === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => {
                            if (id !== telemetry.vesselId) {
                              onSelectVessel(id);
                            }
                            setViewsOpen(false);
                          }}
                          className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                            active
                              ? 'apple-glass-gold text-amber-50'
                              : 'apple-glass-subtle text-slate-200 hover:bg-white/15'
                          }`}
                        >
                          {spec.name} ({spec.berthLabel})
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  <span className="text-[10px] font-semibold text-slate-300/80 mr-1">Exterior:</span>
                  {getVesselSpots(telemetry.vesselId)
                    .filter((s) => s.category === 'exterior')
                    .map((spot) => {
                      const active = telemetry.focusSpotId === spot.id;
                      return (
                        <button
                          key={spot.id}
                          type="button"
                          onClick={() => {
                            onFocusSpot(spot.id);
                            setViewsOpen(false);
                          }}
                          className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                            active
                              ? 'apple-glass-gold text-amber-50'
                              : 'apple-glass-subtle text-slate-200 hover:bg-white/15'
                          }`}
                        >
                          {spot.label}
                        </button>
                      );
                    })}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-white/10">
                  <span className="text-[10px] font-semibold text-amber-200/90 mr-1">Interior:</span>
                  {getVesselSpots(telemetry.vesselId)
                    .filter((s) => s.category === 'interior')
                    .map((spot) => {
                      const active = telemetry.focusSpotId === spot.id;
                      return (
                        <button
                          key={spot.id}
                          type="button"
                          onClick={() => {
                            onFocusSpot(spot.id);
                            setViewsOpen(false);
                          }}
                          className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                            active
                              ? 'apple-glass-gold text-amber-50'
                              : 'apple-glass-subtle text-amber-100/90 hover:bg-white/15'
                          }`}
                        >
                          {spot.label}
                        </button>
                      );
                    })}
                </div>
              </div>
            )}

            {/* MINIMALIST SINGLE-ROW HELM DOCK */}
            <div className="flex flex-col items-center gap-1.5">
              <button
                type="button"
                onClick={() => setDockCollapsed((v) => !v)}
                className="pointer-events-auto apple-glass-panel hover:bg-white/15 flex items-center gap-1.5 px-3 py-1 rounded-xl text-[10px] font-semibold text-amber-100 cursor-pointer transition-colors whitespace-nowrap shrink-0"
              >
                {dockCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {dockCollapsed ? 'Show Controls' : 'Hide Controls'}
              </button>

              {!dockCollapsed && (
                <div className="pointer-events-auto apple-glass-panel rounded-2xl px-3.5 py-2.5 flex flex-wrap items-center justify-center gap-2.5 md:gap-3 max-w-[96vw]">
                  {/* 1. Minimalist Helm Steering */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => nudgeRudder(-10)}
                      title="Turn Port (Left)"
                      aria-label="Steer Port"
                      className="apple-glass-subtle hover:bg-white/15 p-1.5 rounded-lg text-slate-100 cursor-pointer transition-colors shrink-0"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>

                    <input
                      type="range"
                      min={-35}
                      max={35}
                      value={telemetry.rudderDeg}
                      onChange={(e) => onSetRudder(Number(e.target.value))}
                      onPointerUp={() => onSetRudder(null)}
                      aria-label="Helm Rudder Angle"
                      className="w-24 md:w-28 accent-amber-300 cursor-pointer"
                    />

                    <button
                      type="button"
                      onClick={() => nudgeRudder(10)}
                      title="Turn Starboard (Right)"
                      aria-label="Steer Starboard"
                      className="apple-glass-subtle hover:bg-white/15 p-1.5 rounded-lg text-slate-100 cursor-pointer transition-colors shrink-0"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onSetRudder(0)}
                      title="Center Helm Amidships"
                      className="px-2 py-1 rounded-lg hover:bg-white/10 text-[11px] font-semibold text-slate-100 w-[78px] text-center tabular-nums cursor-pointer transition-colors whitespace-nowrap shrink-0"
                    >
                      {telemetry.rudderDeg === 0
                        ? 'Center 0°'
                        : telemetry.rudderDeg < 0
                          ? `Port ${Math.abs(telemetry.rudderDeg)}°`
                          : `Stbd ${telemetry.rudderDeg}°`}
                    </button>
                  </div>

                  <div className="hidden sm:block h-5 w-[1px] bg-white/15" />

                  {/* 2. Minimalist Engine Speed Stepper */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onSelectTelegraph?.(telemetry.telegraphIndex - 1)}
                      disabled={telemetry.telegraphIndex <= 0}
                      title="Decrease Speed (X)"
                      aria-label="Decrease Speed"
                      className="apple-glass-subtle hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed p-1.5 rounded-lg text-slate-100 cursor-pointer transition-colors shrink-0"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>

                    <div className="px-2 py-1 text-[11px] font-semibold text-amber-100 tabular-nums text-center min-w-[104px] whitespace-nowrap shrink-0">
                      {currentNotch.shortLabel} · {telemetry.speedKnots} KTS
                    </div>

                    <button
                      type="button"
                      onClick={() => onSelectTelegraph?.(telemetry.telegraphIndex + 1)}
                      disabled={telemetry.telegraphIndex >= TELEGRAPH_NOTCHES.length - 1}
                      title="Increase Speed (Z)"
                      aria-label="Increase Speed"
                      className="apple-glass-subtle hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed p-1.5 rounded-lg text-slate-100 cursor-pointer transition-colors shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="hidden sm:block h-5 w-[1px] bg-white/15" />

                  {/* 3. Autopilot Toggle */}
                  <button
                    type="button"
                    onClick={onToggleAutopilot}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      telemetry.autopilotEnabled
                        ? 'bg-emerald-500/25 border border-emerald-300/50 text-emerald-100'
                        : 'apple-glass-subtle hover:bg-white/15 text-slate-100'
                    }`}
                  >
                    <Navigation className="w-3.5 h-3.5" />
                    <span>{telemetry.autopilotEnabled ? 'Autopilot On' : 'Autopilot'}</span>
                  </button>

                  {/* 4. Searchlight Sweep */}
                  <button
                    type="button"
                    onClick={onTriggerSearchlight}
                    disabled={telemetry.searchlightActive || telemetry.searchlightCooldownPct > 0}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      telemetry.searchlightActive
                        ? 'bg-sky-400/25 border border-sky-200/60 text-white cursor-pointer'
                        : telemetry.searchlightCooldownPct > 0
                          ? 'apple-glass-subtle text-slate-400 cursor-not-allowed opacity-70'
                          : 'apple-glass-subtle hover:bg-white/15 text-slate-100 cursor-pointer'
                    }`}
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span>
                      {telemetry.searchlightActive
                        ? 'Sweeping'
                        : telemetry.searchlightCooldownPct > 0
                          ? `Wait ${Math.ceil(telemetry.searchlightCooldownPct * 8)}s`
                          : 'Searchlight'}
                    </span>
                  </button>

                  {/* 5. Views & Decks Drawer Toggle */}
                  <button
                    type="button"
                    onClick={() => setViewsOpen((v) => !v)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      viewsOpen
                        ? 'apple-glass-gold text-amber-50'
                        : 'apple-glass-subtle hover:bg-white/15 text-amber-100'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Views</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
