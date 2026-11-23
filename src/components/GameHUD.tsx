import React, { useEffect, useRef, useState } from 'react';
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
  Flame,
  HelpCircle,
  Layers,
  LifeBuoy,
  Minus,
  Music,
  Navigation,
  Pause,
  Plus,
  Radio,
  Search,
  Ship,
  Star,
  Target,
  Volume2,
  VolumeX,
  X,
  Zap,
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
  onReturnToShip?: () => void;
  onToggleSpeedboat?: () => void;
  onToggleFocus?: () => void;
  onCycleMission?: () => void;
  onCycleRadio?: () => void;
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
  onReturnToShip,
  onToggleSpeedboat,
  onToggleFocus,
  onCycleMission,
  onCycleRadio,
}) => {
  const [panelsVisible, setPanelsVisible] = useState(true);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [policeBlink, setPoliceBlink] = useState(false);
  const radarCanvasRef = useRef<HTMLCanvasElement | null>(null);
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
      } else if ((e.code === 'Slash' || e.code === 'F1') && !e.repeat) {
        e.preventDefault();
        setGuideOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (telemetry.wantedLevel <= 0) {
      setPoliceBlink(false);
      return;
    }
    const id = window.setInterval(() => {
      setPoliceBlink((prev) => !prev);
    }, 320);
    return () => window.clearInterval(id);
  }, [telemetry.wantedLevel]);

  const isSinking = telemetry.phase === 'sinking';
  const isAftermath = telemetry.phase === 'aftermath';
  const isPlaying = telemetry.phase === 'playing' || telemetry.phase === 'paused';

  useEffect(() => {
    const canvas = radarCanvasRef.current;
    if (!canvas || !isPlaying || !panelsVisible) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const radius = w * 0.47;
    const radarRangeM = 580;
    const scale = radius / radarRangeM;

    ctx.clearRect(0, 0, w, h);

    // Dark maritime sonar background
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, radius);
    grad.addColorStop(0, telemetry.specialFocusActive ? 'rgba(12, 46, 68, 0.94)' : 'rgba(9, 20, 36, 0.94)');
    grad.addColorStop(1, 'rgba(4, 10, 20, 0.97)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Range rings
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.lineWidth = 1;
    for (const frac of [0.38, 0.72]) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius * frac, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(cx - radius, cy);
    ctx.lineTo(cx + radius, cy);
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx, cy + radius);
    ctx.stroke();

    // Forward field-of-view cone
    ctx.fillStyle = 'rgba(251, 191, 36, 0.08)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, -Math.PI * 0.5 - 0.42, -Math.PI * 0.5 + 0.42);
    ctx.closePath();
    ctx.fill();

    // Blips rotated by -radarHeadingRad so player heading is always UP
    const cosH = Math.cos(-telemetry.radarHeadingRad);
    const sinH = Math.sin(-telemetry.radarHeadingRad);

    for (let i = 0; i < telemetry.radarBlips.length; i++) {
      const b = telemetry.radarBlips[i];
      const rx = b.dx * cosH - b.dz * sinH;
      const rz = b.dx * sinH + b.dz * cosH;
      let px = cx + rx * scale;
      let py = cy + rz * scale;
      const dist = Math.hypot(px - cx, py - cy);
      if (dist > radius - 4) {
        const clampRatio = (radius - 4) / dist;
        px = cx + (px - cx) * clampRatio;
        py = cy + (py - cy) * clampRatio;
      }

      if (b.kind === 'hazard') {
        ctx.fillStyle = telemetry.threatMode === 'reefs' ? '#f59e0b' : '#7dd3fc';
        ctx.fillRect(px - 2, py - 2, 4, 4);
      } else if (b.kind === 'sub') {
        ctx.fillStyle = '#fb7185';
        ctx.beginPath();
        ctx.moveTo(px, py - 3.5);
        ctx.lineTo(px + 3, py + 2.5);
        ctx.lineTo(px - 3, py + 2.5);
        ctx.closePath();
        ctx.fill();
      } else if (b.kind === 'police') {
        ctx.fillStyle = policeBlink ? '#ef4444' : '#3b82f6';
        ctx.beginPath();
        ctx.arc(px, py, 3.2, 0, Math.PI * 2);
        ctx.fill();
      } else if (b.kind === 'chopper') {
        ctx.strokeStyle = policeBlink ? '#38bdf8' : '#f87171';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(px - 3.5, py - 3.5);
        ctx.lineTo(px + 3.5, py + 3.5);
        ctx.moveTo(px + 3.5, py - 3.5);
        ctx.lineTo(px - 3.5, py + 3.5);
        ctx.stroke();
      } else if (b.kind === 'mission') {
        ctx.fillStyle = '#facc15';
        ctx.strokeStyle = '#fef08a';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(px, py, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (b.kind === 'speedboat' || b.kind === 'ship') {
        ctx.fillStyle = '#34d399';
        ctx.beginPath();
        ctx.arc(px, py, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Player center heading arrow
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 6);
    ctx.lineTo(cx + 4.5, cy + 4.5);
    ctx.lineTo(cx, cy + 2);
    ctx.lineTo(cx - 4.5, cy + 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // North indicator on rim
    const nx = cx + Math.sin(-telemetry.radarHeadingRad) * (radius - 7);
    const ny = cy - Math.cos(-telemetry.radarHeadingRad) * (radius - 7);
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny);

    ctx.restore();

    // Outer ring border
    ctx.strokeStyle = telemetry.wantedLevel > 0
      ? policeBlink
        ? 'rgba(239, 68, 68, 0.85)'
        : 'rgba(59, 130, 246, 0.85)'
      : 'rgba(255, 255, 255, 0.24)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }, [
    isPlaying,
    panelsVisible,
    policeBlink,
    telemetry.radarBlips,
    telemetry.radarHeadingRad,
    telemetry.specialFocusActive,
    telemetry.threatMode,
    telemetry.wantedLevel,
  ]);

  const sinkingStageText =
    telemetry.vesselId === 'britannic'
      ? telemetry.sinkProgress < 0.30
        ? 'TORPEDO FLOODING — HEAVY STARBOARD LIST'
        : telemetry.sinkProgress < 0.68
          ? 'INTACT HULL CAPSIZING ONTO STARBOARD BEAM'
          : 'CAPSIZED TO STARBOARD — PORT PROPELLERS ABOVE WAVES'
      : telemetry.vesselId === 'concordia'
        ? telemetry.sinkProgress < 0.30
          ? 'REEF BREACH — SHARP STARBOARD LIST'
          : telemetry.sinkProgress < 0.68
            ? 'CAPSIZING ONTO GRANITE REEF SHELF'
            : 'HALF-SUBMERGED ON STARBOARD BEAM — EVACUATING LIFEBOATS'
        : telemetry.sinkProgress < 0.4
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
                {telemetry.activeCraft === 'speedboat'
                  ? `Scarab 38 · ${telemetry.speedboatKnots} KTS`
                  : telemetry.endlessMode
                    ? 'Endless Watch'
                    : telemetry.threatMode === 'submarines'
                      ? `${telemetry.zoneLabel} · U-Boats ${telemetry.submarinesSunk}`
                      : telemetry.zoneLabel}
              </span>
              <span className="font-semibold text-amber-200 shrink-0">
                {telemetry.distanceNm.toFixed(1)}
                {!telemetry.endlessMode && ` / ${telemetry.targetDistanceNm.toFixed(1)} NM`}
                {telemetry.endlessMode && ' NM'}
              </span>
            </div>
          </div>
        </div>

        {/* Top-Center: Clean Compass, Speed, Sky Time, Active Contracts & Alerts */}
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
              {telemetry.activeCraft === 'speedboat' ? telemetry.speedboatKnots : telemetry.speedKnots} KTS
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
              {telemetry.missionBannerText && (
                <div className="apple-glass-gold px-5 py-2 rounded-2xl text-center">
                  <div className="text-xs font-bold tracking-[0.14em] uppercase text-amber-50">
                    {telemetry.missionBannerText}
                  </div>
                  {telemetry.missionBannerSub && (
                    <div className="text-[11px] font-medium text-amber-100/90 mt-0.5">
                      {telemetry.missionBannerSub}
                    </div>
                  )}
                </div>
              )}

              {telemetry.stuntText && (
                <div className="apple-glass-panel px-4 py-1 rounded-xl text-[11px] font-bold tracking-[0.1em] uppercase text-sky-200">
                  {telemetry.stuntText}
                </div>
              )}

              {telemetry.activeMissionTitle && (
                <div className="apple-glass-panel px-4 py-1.5 rounded-xl flex items-center gap-2.5 text-[11px]">
                  <Target className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                  <span className="font-bold text-amber-200 uppercase tracking-wider">
                    {telemetry.activeMissionTitle}
                  </span>
                  {telemetry.activeMissionStep && (
                    <span className="text-slate-100/90">{telemetry.activeMissionStep}</span>
                  )}
                  {telemetry.activeMissionTimerSec !== null && (
                    <span className="font-bold text-rose-300 tabular-nums">
                      {Math.ceil(telemetry.activeMissionTimerSec)}s
                    </span>
                  )}
                </div>
              )}

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

              {telemetry.lastEventText && !telemetry.icebergWarning && !telemetry.missionBannerText && (
                <div className="apple-glass-panel px-4 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.06em] text-amber-100">
                  {telemetry.lastEventText}
                </div>
              )}
            </>
          )}

          {telemetry.playerOverboard && onReturnToShip && (
            <button
              type="button"
              onClick={onReturnToShip}
              className="pointer-events-auto apple-glass-gold hover:brightness-110 px-4 py-1.5 rounded-xl text-[11px] font-semibold tracking-[0.06em] text-amber-50 cursor-pointer transition-all"
            >
              Man Overboard — Return Aboard (V)
            </button>
          )}
        </div>

        {/* Top-Right: Wanted Stars, Cash/RP, Score, Radio & Utility Buttons */}
        <div className="flex items-start gap-2">
          <div
            className={`flex flex-col items-end gap-1.5 transition-all duration-200 ease-out ${
              panelsVisible
                ? 'opacity-100 translate-y-0'
                : 'opacity-0 -translate-y-2 pointer-events-none'
            }`}
          >
            <div className="apple-glass-panel px-3.5 py-2 rounded-2xl text-right min-w-[168px]">
              <div className="flex items-center justify-end gap-3">
                <div>
                  <div className="text-[10px] font-semibold tracking-[0.08em] uppercase text-emerald-300/90">
                    Cash
                  </div>
                  <div className="text-sm font-bold text-emerald-300 tabular-nums">
                    ${telemetry.cash.toLocaleString()}
                  </div>
                </div>
                <div className="h-6 w-[1px] bg-white/15" />
                <div>
                  <div className="text-[10px] font-semibold tracking-[0.08em] uppercase text-sky-300/90">
                    RP
                  </div>
                  <div className="text-sm font-bold text-sky-200 tabular-nums">
                    {telemetry.rep.toLocaleString()}
                  </div>
                </div>
                <div className="h-6 w-[1px] bg-white/15" />
                <div>
                  <div className="flex items-center justify-end gap-1 text-[10px] font-semibold tracking-[0.08em] uppercase text-slate-300/90">
                    <span>Score</span>
                    {telemetry.combo > 1 && (
                      <span className="text-amber-300 font-bold tabular-nums">×{telemetry.combo}</span>
                    )}
                  </div>
                  <div className="text-sm font-bold text-white tabular-nums">
                    {telemetry.score.toLocaleString()}
                  </div>
                </div>
              </div>

              {/* 1-5 Wanted Stars & Evasion Bar */}
              {telemetry.wantedLevel > 0 && (
                <div className="mt-1.5 pt-1.5 border-t border-white/12 flex flex-col items-end gap-1">
                  <div className="flex items-center gap-1" aria-label={`Wanted Level ${telemetry.wantedLevel} Stars`}>
                    {[1, 2, 3, 4, 5].map((starIdx) => {
                      const active = starIdx <= telemetry.wantedLevel;
                      const activeColor = !active
                        ? 'text-slate-600/60'
                        : telemetry.wantedEvading
                          ? policeBlink
                            ? 'text-slate-200 fill-slate-200'
                            : 'text-amber-300 fill-amber-300'
                          : policeBlink
                            ? 'text-red-400 fill-red-400'
                            : 'text-sky-400 fill-sky-400';
                      return <Star key={starIdx} className={`w-3.5 h-3.5 ${activeColor}`} />;
                    })}
                    <span className="ml-1 text-[10px] font-bold tracking-wider uppercase text-slate-100">
                      {telemetry.wantedEvading ? 'Evading' : 'Pursuit'}
                    </span>
                  </div>
                  {telemetry.wantedEvading && (
                    <div className="w-full h-1 bg-white/10 rounded overflow-hidden">
                      <div
                        className="h-full bg-amber-300 transition-all duration-150"
                        style={{ width: `${Math.round(telemetry.wantedCooldownPct * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {isPlaying && onCycleRadio && (
              <button
                type="button"
                onClick={onCycleRadio}
                title="Cycle Ship Radio Station (R)"
                className="pointer-events-auto apple-glass-panel hover:bg-white/15 px-3 py-1 rounded-xl text-[11px] font-semibold text-amber-100 flex items-center gap-1.5 cursor-pointer transition-colors whitespace-nowrap shrink-0"
              >
                <Radio className="w-3.5 h-3.5 text-amber-300" />
                <span>{telemetry.radioStationName}</span>
              </button>
            )}
          </div>

          <div className="flex flex-col items-end gap-1.5 pointer-events-auto">
            <div className="flex items-center gap-1.5">
              {isPlaying && (
                <button
                  type="button"
                  onClick={() => (guideOpen ? dismissGuide() : setGuideOpen(true))}
                  title="Control Guide (/)"
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

      {/* BOTTOM-LEFT GTA RADAR MINIMAP + FOCUS / NITRO METERS */}
      {isPlaying && panelsVisible && (
        <div className="fixed left-3.5 bottom-[126px] xl:bottom-5 z-10 pointer-events-none flex flex-col items-center gap-1.5">
          <div className="apple-glass-panel p-1.5 rounded-full">
            <canvas
              ref={radarCanvasRef}
              width={120}
              height={120}
              className="w-[96px] h-[96px] md:w-[116px] md:h-[116px] block rounded-full"
            />
          </div>
          <div className="apple-glass-panel px-2.5 py-1.5 rounded-xl w-[124px] flex flex-col gap-1">
            <div className="flex items-center justify-between text-[9px] font-semibold uppercase tracking-wider text-sky-200">
              <span>Focus [U]</span>
              <span className="tabular-nums">{Math.round(telemetry.specialFocusPct)}%</span>
            </div>
            <div className="h-1 w-full bg-white/10 rounded overflow-hidden">
              <div
                className="h-full transition-all duration-100"
                style={{
                  width: `${Math.round(telemetry.specialFocusPct)}%`,
                  backgroundColor: telemetry.specialFocusActive ? '#38bdf8' : '#fbbf24',
                }}
              />
            </div>
            {telemetry.activeCraft === 'speedboat' && (
              <>
                <div className="flex items-center justify-between text-[9px] font-semibold uppercase tracking-wider text-amber-200 mt-0.5">
                  <span>Nitro [Shift]</span>
                  <span className="tabular-nums">{Math.round(telemetry.speedboatNitroPct)}%</span>
                </div>
                <div className="h-1 w-full bg-white/10 rounded overflow-hidden">
                  <div
                    className="h-full bg-orange-400 transition-all duration-100"
                    style={{ width: `${Math.round(telemetry.speedboatNitroPct)}%` }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}

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

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 text-[11px] leading-snug">
                    <div>
                      <div className="font-semibold text-amber-200">1. Helm &amp; Speed</div>
                      <div className="text-slate-200/85">
                        Steer (<span className="text-white font-medium">← / →</span>), speed (<span className="text-white font-medium">Z / X</span>), or click <span className="text-white font-medium">T</span> for Autopilot.
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold text-amber-200">2. Scarab 38 Speedboat</div>
                      <div className="text-slate-200/85">
                        Press <span className="text-white font-medium">B</span> to launch &amp; drive (<span className="text-white font-medium">W/A/S/D</span>), <span className="text-white font-medium">Shift</span> for Nitro &amp; wave jumps!
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold text-amber-200">3. Contracts &amp; Focus</div>
                      <div className="text-slate-200/85">
                        Start contracts (<span className="text-white font-medium">G</span>), trigger Captain&apos;s Focus slow-mo (<span className="text-white font-medium">U</span>), or tune Radio (<span className="text-white font-medium">R</span>).
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold text-amber-200">4. Explore &amp; Searchlight</div>
                      <div className="text-slate-200/85">
                        Sweep Searchlight (<span className="text-white font-medium">F</span>), switch decks (<span className="text-white font-medium">V</span>), walk &amp; jump (<span className="text-white font-medium">Space</span>).
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
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
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
                          : 'Light'}
                    </span>
                  </button>

                  {/* 5. Board / Return from Leonida Scarab 38 Speedboat */}
                  {onToggleSpeedboat && (
                    <button
                      type="button"
                      onClick={onToggleSpeedboat}
                      title="Board / Return from Scarab 38 Speedboat (B)"
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        telemetry.activeCraft === 'speedboat'
                          ? 'apple-glass-gold text-amber-50'
                          : 'apple-glass-subtle hover:bg-white/15 text-sky-100'
                      }`}
                    >
                      {telemetry.activeCraft === 'speedboat' ? (
                        <>
                          <Ship className="w-3.5 h-3.5" />
                          <span>Ship [B]</span>
                        </>
                      ) : (
                        <>
                          <Flame className="w-3.5 h-3.5 text-amber-300" />
                          <span>Speedboat [B]</span>
                        </>
                      )}
                    </button>
                  )}

                  {/* 6. Captain's Focus Slow-Motion */}
                  {onToggleFocus && (
                    <button
                      type="button"
                      onClick={onToggleFocus}
                      title="Toggle Captain's Focus Time-Dilation (U)"
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        telemetry.specialFocusActive
                          ? 'bg-sky-400/30 border border-sky-300/60 text-white'
                          : 'apple-glass-subtle hover:bg-white/15 text-sky-100'
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5 text-sky-300" />
                      <span>Focus [U]</span>
                    </button>
                  )}

                  {/* 7. GTA Contracts */}
                  {onCycleMission && (
                    <button
                      type="button"
                      onClick={onCycleMission}
                      title="Start or Cycle Maritime Contract (G)"
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        telemetry.activeMissionTitle
                          ? 'apple-glass-gold text-amber-50'
                          : 'apple-glass-subtle hover:bg-white/15 text-amber-100'
                      }`}
                    >
                      <Target className="w-3.5 h-3.5 text-amber-300" />
                      <span>{telemetry.activeMissionTitle ? 'Next [G]' : 'Contract [G]'}</span>
                    </button>
                  )}

                  {/* 8. Views & Decks Drawer Toggle */}
                  <button
                    type="button"
                    onClick={() => setViewsOpen((v) => !v)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
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
