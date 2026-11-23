import React from 'react';
import { VESSEL_ORDER, VESSEL_SPECS, VesselId } from '../game/types';

interface TitleOverlayProps {
  bestScore: number;
  selectedVessel: VesselId;
  onSelectVessel: (vesselId: VesselId) => void;
  onStart: () => void;
  onStartNight: () => void;
}

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  bestScore,
  selectedVessel,
  onSelectVessel,
  onStart,
  onStartNight,
}) => {
  const activeSpec = VESSEL_SPECS[selectedVessel];

  return (
    <div className="fixed inset-0 z-20 flex flex-col justify-between pointer-events-none px-6 py-6 md:px-10 md:py-8 font-sans-ui">
      {/* Subtle vignette framing the sunlit Southampton harbor & docked ocean liners */}
      <div
        className="fixed inset-0 -z-10 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 50% 48%, rgba(5,11,20,0.04) 30%, rgba(4,9,17,0.68) 100%)',
        }}
      />

      {/* Top Maritime Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="apple-glass-panel px-4 py-2 rounded-2xl">
          <span className="text-[11px] tracking-[0.16em] uppercase text-amber-200 font-semibold">
            Southampton {activeSpec.berthLabel} · {activeSpec.line} · Direct Helm Command
          </span>
        </div>

        {bestScore > 0 && (
          <div className="apple-glass-panel px-4 py-2 rounded-2xl text-right">
            <div className="text-[10px] tracking-[0.16em] uppercase text-slate-300/80">
              Record Voyage
            </div>
            <div className="text-base font-bold text-white tabular-nums">
              {bestScore.toLocaleString()} PTS
            </div>
          </div>
        )}
      </div>

      {/* Center Frosted Glass Title Card */}
      <div className="my-auto flex flex-col items-center text-center max-w-3xl mx-auto w-full">
        <div className="apple-glass-panel px-6 py-7 md:px-10 md:py-8 rounded-3xl pointer-events-auto w-full">
          <svg
            viewBox="0 0 560 128"
            className="w-full max-w-[460px] mx-auto mb-3"
            aria-label={`${activeSpec.name}: Bridge Watch`}
          >
            <line x1="28" y1="22" x2="208" y2="22" stroke="#e6c373" strokeWidth="1.2" opacity="0.65" />
            <line x1="352" y1="22" x2="532" y2="22" stroke="#e6c373" strokeWidth="1.2" opacity="0.65" />
            <g transform="translate(280, 22)">
              <circle r="15" fill="none" stroke="#e6c373" strokeWidth="1.5" />
              <polygon
                points="0,-11 3,-3 11,0 3,3 0,11 -3,3 -11,0 -3,-3"
                fill="#f6dfa4"
              />
            </g>
            <text
              x="280"
              y="66"
              textAnchor="middle"
              fill="#f8fafc"
              fontFamily="Cinzel, Georgia, serif"
              fontSize="36"
              fontWeight="700"
              letterSpacing="6"
            >
              {activeSpec.name.toUpperCase()}
            </text>
            <text
              x="280"
              y="96"
              textAnchor="middle"
              fill="#f3d48c"
              fontFamily="-apple-system, BlinkMacSystemFont, 'Plus Jakarta Sans', sans-serif"
              fontSize="14"
              fontWeight="600"
              letterSpacing="8"
            >
              SOUTHAMPTON FLEET WATCH
            </text>
            <line x1="90" y1="112" x2="470" y2="112" stroke="#e6c373" strokeWidth="1" opacity="0.5" />
          </svg>

          <p className="text-xs md:text-sm text-slate-200/90 max-w-xl mx-auto mb-5 leading-relaxed">
            Command three historic ocean liners moored side by side in Southampton Port as daylight turns to night in one minute. Thread North Atlantic icebergs aboard Titanic, battle U-boats on Britannic, or navigate granite reefs on Costa Concordia—plus launch the Scarab 38 speedboat (B), outrun 1–5★ Coast Guard pursuits, run contracts (G), engage Captain&apos;s Focus (U), and tune ship radio (R).
          </p>

          {/* 3-Ship Fleet Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-6 text-left">
            {VESSEL_ORDER.map((id) => {
              const spec = VESSEL_SPECS[id];
              const isSelected = selectedVessel === id;
              const accentClass =
                id === 'britannic'
                  ? 'text-emerald-300'
                  : id === 'concordia'
                    ? 'text-amber-300'
                    : 'text-sky-200';
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelectVessel(id)}
                  aria-pressed={isSelected}
                  className={`px-3.5 py-3 rounded-2xl transition-all cursor-pointer border ${
                    isSelected
                      ? 'apple-glass-gold border-amber-300/60 shadow-lg'
                      : 'apple-glass-subtle border-white/12 hover:bg-white/12'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-bold tracking-wide text-white uppercase">
                      {spec.name}
                    </span>
                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${accentClass}`}>
                      {spec.berthLabel}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-200/85 leading-snug">
                    {spec.specSummary}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onStart}
              className="apple-glass-gold hover:brightness-110 active:scale-[0.99] inline-flex items-center justify-center px-8 py-3.5 text-amber-50 font-semibold tracking-[0.12em] uppercase text-sm rounded-2xl transition-all cursor-pointer whitespace-nowrap shrink-0"
            >
              Helm {activeSpec.shortName} At {activeSpec.berthLabel}
            </button>
            <button
              type="button"
              onClick={onStartNight}
              className="apple-glass-subtle hover:bg-white/15 inline-flex items-center justify-center px-5 py-3.5 text-slate-100 font-semibold tracking-[0.1em] uppercase text-xs rounded-2xl transition-all cursor-pointer whitespace-nowrap shrink-0"
            >
              Night Watch Challenge
            </button>
          </div>
        </div>
      </div>

      {/* Control Hint Bar */}
      <div className="flex justify-center">
        <div className="apple-glass-panel px-5 py-2 rounded-2xl text-xs tracking-[0.06em] text-slate-200/90 text-center">
          ← / → Steer &nbsp;·&nbsp; Z / X Speed &nbsp;·&nbsp; B Speedboat &nbsp;·&nbsp; U Focus &nbsp;·&nbsp; G Contract &nbsp;·&nbsp; R Radio &nbsp;·&nbsp; T Autopilot &nbsp;·&nbsp; V Views &amp; Walk
        </div>
      </div>
    </div>
  );
};
