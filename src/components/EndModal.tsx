import React from 'react';
import { TelemetrySnapshot } from '../game/types';

interface EndModalProps {
  telemetry: TelemetrySnapshot;
  onRestart: () => void;
  onResume: () => void;
  onContinueEndless: () => void;
  onObserveAftermath: () => void;
  onReturnTitle: () => void;
}

export const EndModal: React.FC<EndModalProps> = ({
  telemetry,
  onRestart,
  onResume,
  onContinueEndless,
  onObserveAftermath,
  onReturnTitle,
}) => {
  const { phase } = telemetry;
  if (phase !== 'paused' && phase !== 'victory' && phase !== 'gameover') {
    return null;
  }

  const isPaused = phase === 'paused';
  const isVictory = phase === 'victory';

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-6 bg-slate-950/75 font-sans-ui">
      <div className="apple-glass-panel rounded-3xl max-w-md w-full p-7 md:p-8 text-center">
        <div className="text-[10px] tracking-[0.22em] uppercase text-amber-200 font-semibold mb-2">
          {isPaused
            ? 'Bridge Watch Paused'
            : isVictory
              ? 'Open Water Reached'
              : 'North Atlantic · 41°43′N 49°56′W'}
        </div>

        <h2 className="font-display text-3xl font-bold text-white tracking-wide mb-3">
          {isPaused
            ? 'Hold Course'
            : isVictory
              ? 'Safe Passage'
              : 'Voyage Log'}
        </h2>

        <p className="text-sm text-slate-200/90 mb-6 leading-relaxed">
          {isPaused
            ? 'Orders are standing by in the wheelhouse.'
            : isVictory
              ? telemetry.threatMode === 'submarines'
                ? `You guided ${telemetry.vesselName} safely through hostile Atlantic U-boat waters while her gun crew sank ${telemetry.submarinesSunk} enemy ${telemetry.submarinesSunk === 1 ? 'submarine' : 'submarines'}.`
                : telemetry.threatMode === 'reefs'
                  ? `You navigated ${telemetry.vesselName} cleanly past the granite coastal reefs and Coast Guard patrols with her twin-azipod hull intact.`
                  : `You guided ${telemetry.vesselName} swiftly through thousands of Atlantic icebergs with her reinforced hull intact.`
              : telemetry.vesselId === 'britannic'
                ? telemetry.carpathiaStage === 'complete'
                  ? `HMHS Britannic rolled over onto her starboard beam and sank intact beneath the waves after a U-boat torpedo strike, while RMS Carpathia rescued all 712 survivors from the 16 lifeboats.`
                  : telemetry.carpathiaStage === 'boarding'
                    ? `HMHS Britannic capsized intact to starboard. RMS Carpathia is alongside with boarding ladders lowered (${telemetry.survivorsRescued} / 712 survivors aboard so far).`
                    : telemetry.carpathiaStage === 'approaching'
                      ? `HMHS Britannic capsized intact to starboard. RMS Carpathia is steaming carefully through open Atlantic waters toward the 16 waiting lifeboats (${telemetry.carpathiaDistanceM} m away).`
                      : `HMHS Britannic suffered a lethal U-boat torpedo breach, capsized to starboard, and sank intact while 16 lifeboats pulled away to await RMS Carpathia.`
                : telemetry.vesselId === 'concordia'
                  ? telemetry.carpathiaStage === 'complete'
                    ? `Costa Concordia tore her hull on the granite reef shelf and capsized 68° onto her starboard beam, resting half-submerged while RMS Carpathia rescued all 712 survivors from the 16 lifeboats.`
                    : telemetry.carpathiaStage === 'boarding'
                      ? `Costa Concordia capsized 68° onto her starboard beam on the granite reef shelf. RMS Carpathia is alongside with boarding ladders lowered (${telemetry.survivorsRescued} / 712 survivors aboard so far).`
                      : telemetry.carpathiaStage === 'approaching'
                        ? `Costa Concordia capsized 68° onto her starboard beam on the granite reef. RMS Carpathia is steaming through coastal waters toward the 16 waiting lifeboats (${telemetry.carpathiaDistanceM} m away).`
                        : `Costa Concordia struck a submerged granite reef, heeled sharply, and capsized 68° onto her starboard beam while 16 lifeboats pulled away to await RMS Carpathia.`
                  : telemetry.carpathiaStage === 'complete'
                    ? `${telemetry.vesselShortName} broke amidships and sank beneath the Atlantic, while RMS Carpathia steamed through the ice field and rescued all 712 survivors from the 16 lifeboats.`
                    : telemetry.carpathiaStage === 'boarding'
                      ? `${telemetry.vesselShortName} sank beneath the Atlantic. RMS Carpathia is alongside with boarding ladders lowered (${telemetry.survivorsRescued} / 712 survivors aboard so far).`
                      : telemetry.carpathiaStage === 'approaching'
                        ? `${telemetry.vesselShortName} sank beneath the Atlantic. RMS Carpathia is threading carefully through the icebergs toward the 16 waiting lifeboats (${telemetry.carpathiaDistanceM} m away).`
                        : `${telemetry.vesselShortName} broke amidships and slipped beneath the freezing Atlantic while 16 lifeboats pulled away to await RMS Carpathia.`}
        </p>

        {/* Voyage Summary Readout */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6 apple-glass-subtle p-3.5 rounded-2xl">
          <div>
            <div className="text-[10px] tracking-[0.12em] uppercase text-slate-300/75">Distance</div>
            <div className="text-sm font-bold text-white tabular-nums">
              {telemetry.distanceNm.toFixed(1)} NM
            </div>
          </div>
          <div>
            <div className="text-[10px] tracking-[0.12em] uppercase text-slate-300/75">
              {phase === 'gameover'
                ? 'Rescued'
                : telemetry.threatMode === 'submarines'
                  ? 'U-Boats Sunk'
                  : 'Near Misses'}
            </div>
            <div className="text-sm font-bold text-amber-200 tabular-nums">
              {phase === 'gameover'
                ? `${telemetry.survivorsRescued}/712`
                : telemetry.threatMode === 'submarines'
                  ? telemetry.submarinesSunk
                  : telemetry.nearMissCount}
            </div>
          </div>
          <div>
            <div className="text-[10px] tracking-[0.12em] uppercase text-slate-300/75">Cash / RP</div>
            <div className="text-sm font-bold text-emerald-300 tabular-nums">
              ${telemetry.cash.toLocaleString()}
            </div>
            <div className="text-[10px] font-semibold text-sky-300 tabular-nums">
              {telemetry.rep.toLocaleString()} RP
            </div>
          </div>
          <div>
            <div className="text-[10px] tracking-[0.12em] uppercase text-slate-300/75">Score</div>
            <div className="text-sm font-bold text-white tabular-nums">
              {telemetry.score.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col gap-2.5">
          {isPaused && (
            <button
              type="button"
              onClick={onResume}
              className="apple-glass-gold hover:brightness-110 w-full py-3 text-amber-50 font-semibold tracking-[0.12em] uppercase text-xs rounded-2xl cursor-pointer transition-all"
            >
              Resume Watch [Esc]
            </button>
          )}

          {isVictory && (
            <button
              type="button"
              onClick={onContinueEndless}
              className="apple-glass-gold hover:brightness-110 w-full py-3 text-amber-50 font-semibold tracking-[0.12em] uppercase text-xs rounded-2xl cursor-pointer transition-all"
            >
              Continue Endless Night Watch
            </button>
          )}

          <button
            type="button"
            onClick={onRestart}
            className={`w-full py-3 font-semibold tracking-[0.12em] uppercase text-xs rounded-2xl cursor-pointer transition-all ${
              isPaused || isVictory
                ? 'apple-glass-subtle hover:bg-white/15 text-amber-100'
                : 'apple-glass-gold hover:brightness-110 text-amber-50'
            }`}
          >
            {isPaused ? 'Restart Voyage' : 'Sail Again [Enter]'}
          </button>

          {phase === 'gameover' && (
            <button
              type="button"
              onClick={onObserveAftermath}
              className="apple-glass-subtle hover:bg-white/15 w-full py-2.5 text-amber-100 font-semibold tracking-[0.12em] uppercase text-[11px] rounded-2xl cursor-pointer transition-colors"
            >
              Return To Ocean View
            </button>
          )}

          <button
            type="button"
            onClick={onReturnTitle}
            className="w-full py-2.5 bg-transparent hover:bg-white/10 text-slate-300 font-semibold tracking-[0.12em] uppercase text-[11px] rounded-2xl cursor-pointer transition-colors"
          >
            Return To Bridge Title
          </button>
        </div>
      </div>
    </div>
  );
};
