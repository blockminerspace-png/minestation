import React, { useState, useEffect, useMemo, useId } from 'react';
import { Sparkles } from 'lucide-react';
import { WheelItem } from '../types';

interface WheelProps {
  items: WheelItem[];
  mustSpin: boolean;
  targetWinner: WheelItem | null;
  onStopSpinning: () => void;
}

const Wheel: React.FC<WheelProps> = ({ items, mustSpin, targetWinner, onStopSpinning }) => {
  const ptrGradId = `wp-${useId().replace(/:/g, '')}`;
  const [rotation, setRotation] = useState(0);
  const totalWeight = useMemo(
    () => Math.max(1e-9, items.reduce((a, b) => a + Math.max(0, Number(b.weight) || 0), 0)),
    [items]
  );

  const gradientParts: string[] = [];
  let currentDeg = 0;
  if (items.length > 0) {
    items.forEach((item) => {
      const deg = (Math.max(0, Number(item.weight) || 0) / totalWeight) * 360;
      const color = item.color || '#334155';
      gradientParts.push(`${color} ${currentDeg}deg ${currentDeg + deg}deg`);
      currentDeg += deg;
    });
  } else {
    gradientParts.push('#334155 0deg 360deg');
  }

  const backgroundStyle = `conic-gradient(${gradientParts.join(', ')})`;
  const n = Math.max(1, items.length);
  const sliceDeg = 360 / n;
  /** Linhas finas entre fatias (girar com o disco). */
  const sliceDividers =
    items.length > 0
      ? `repeating-conic-gradient(from 0deg at 50% 50%, transparent 0deg ${sliceDeg - 0.75}deg, rgba(15,23,42,0.5) ${sliceDeg - 0.75}deg ${sliceDeg}deg)`
      : undefined;

  useEffect(() => {
    if (mustSpin && targetWinner && items.length > 0) {
      let winnerStart = 0;
      let winnerSize = 0;
      for (const item of items) {
        const deg = (Math.max(0, Number(item.weight) || 0) / totalWeight) * 360;
        if (item.id === targetWinner.id) {
          winnerSize = deg;
          break;
        }
        winnerStart += deg;
      }

      const winnerCenter = winnerStart + winnerSize / 2;
      const extraSpins = 1800;
      const targetRotation = extraSpins + (360 - winnerCenter);

      const currentMod = rotation % 360;
      const dist = targetRotation - currentMod;
      const finalRotation = rotation + dist + (dist < 0 ? 360 : 0);

      setRotation(finalRotation);

      const timer = setTimeout(() => {
        onStopSpinning();
      }, 3000);
      return () => clearTimeout(timer);
    }
    // rotation omitido de propósito: só reage a novo giro (mustSpin/targetWinner/items).
  }, [mustSpin, targetWinner, items, onStopSpinning, totalWeight]);

  return (
    <div
      className="relative mx-auto aspect-square w-[min(25rem,calc(100vw-1rem))] max-w-md flex items-center justify-center font-sans transition-all sm:w-[min(26rem,calc(100vw-2rem))]"
      role="img"
      aria-label="Roleta de prémios"
    >
      {/* Brilho exterior */}
      <div
        className="pointer-events-none absolute -inset-3 rounded-full bg-gradient-to-b from-amber-500/20 via-orange-600/10 to-transparent blur-2xl sm:-inset-4"
        aria-hidden
      />

      {/* Ponteiro (SVG único por instância para evitar colisão de gradient id) */}
      <div
        className="absolute left-1/2 z-30 -translate-x-1/2 drop-shadow-[0_6px_16px_rgba(0,0,0,0.7)]"
        style={{ top: 'clamp(-1.75rem, -5vw, -1.1rem)' }}
        aria-hidden
      >
        <svg width="44" height="48" viewBox="0 0 44 48" className="mx-auto block">
          <defs>
            <linearGradient id={ptrGradId} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#fef08a" />
              <stop offset="40%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#92400e" />
            </linearGradient>
          </defs>
          <path
            d="M22 2 L40 42 Q22 36 4 42 Z"
            fill={`url(#${ptrGradId})`}
            stroke="rgba(15,23,42,0.7)"
            strokeWidth="1.35"
            strokeLinejoin="round"
          />
          <circle cx="22" cy="36" r="4" fill="#0f172a" stroke="#fcd34d" strokeWidth="1" />
        </svg>
      </div>

      {/* Moldura dupla */}
      <div
        className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-400/50 via-amber-700/35 to-slate-950 p-[7px] shadow-[0_20px_50px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.12)] ring-1 ring-black/50 sm:p-[8px]"
        aria-hidden
      >
        <div className="h-full w-full rounded-full bg-gradient-to-b from-slate-900 via-slate-950 to-black p-[3px] shadow-inner">
          <div
            className="relative h-full w-full rounded-full border border-slate-800/90 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
            style={{
              transform: `rotate(${rotation}deg)`,
              transition: 'transform 4000ms cubic-bezier(0.2, 0.82, 0.15, 1)',
              willChange: 'transform'
            }}
          >
            {/* Disco de cor */}
            <div
              className="absolute inset-0 z-0 overflow-hidden rounded-full shadow-[inset_0_0_36px_rgba(0,0,0,0.5)]"
              style={{
                background: items.length > 0 ? backgroundStyle : '#1e293b'
              }}
            />
            {/* Vinheta + brilho interno */}
            <div
              className="pointer-events-none absolute inset-0 z-[1] rounded-full"
              style={{
                background:
                  'radial-gradient(circle at 35% 28%, rgba(255,255,255,0.14) 0%, transparent 42%), radial-gradient(circle at 50% 50%, transparent 48%, rgba(0,0,0,0.35) 100%)'
              }}
            />
            {/* Divisores */}
            {sliceDividers ? (
              <div
                className="pointer-events-none absolute inset-0 z-[2] rounded-full"
                style={{ background: sliceDividers }}
              />
            ) : null}

            {items.map((item, index) => {
              let startDeg = 0;
              for (let i = 0; i < index; i++) {
                const w = Math.max(0, Number(items[i].weight));
                startDeg += (w / totalWeight) * 360;
              }
              const wCur = Math.max(0, Number(item.weight));
              const sliceAngle = (wCur / totalWeight) * 360;
              const midDeg = startDeg + sliceAngle / 2;
              const halfSlice = Math.min(sliceAngle / 2, 89);
              const chordFactor = Math.sin((halfSlice * Math.PI) / 180);
              const maxLabelPx = Math.min(220, Math.max(104, 72 + chordFactor * 165));

              return (
                <div
                  key={`${item.id}-${index}`}
                  className="pointer-events-none absolute z-[3] overflow-visible"
                  style={{
                    left: '50%',
                    bottom: '50%',
                    width: `${maxLabelPx}px`,
                    height: '50%',
                    transformOrigin: '50% 100%',
                    /** Um único transform: pivô no centro da roda (base do braço). */
                    transform: `translateX(-50%) rotate(${midDeg}deg)`
                  }}
                >
                  {/*
                    Braço vai do centro (base) à borda (topo). Rótulo junto à borda: top % baixo.
                  */}
                  <div className="absolute left-0 right-0 top-[5%] flex justify-center sm:top-[4%]">
                    <span
                      title={item.label}
                      className="line-clamp-2 max-h-[3.6rem] rounded-lg border border-white/25 bg-slate-950/90 px-2.5 py-1.5 text-center font-sans text-[10px] font-semibold leading-snug tracking-tight text-white shadow-[0_4px_16px_rgba(0,0,0,0.5)] backdrop-blur-md sm:max-h-[4rem] sm:px-3 sm:py-2 sm:text-[11px] sm:leading-snug"
                      style={{
                        width: `${maxLabelPx}px`,
                        minWidth: `${maxLabelPx}px`,
                        maxWidth: `${maxLabelPx}px`,
                        transform: `rotate(${-midDeg}deg)`,
                        textShadow: '0 1px 3px rgba(0,0,0,0.92)',
                        overflowWrap: 'break-word',
                        wordBreak: 'normal'
                      }}
                    >
                      {item.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Centro */}
      <div className="pointer-events-none absolute z-20 flex h-[4.75rem] w-[4.75rem] items-center justify-center sm:h-[5.25rem] sm:w-[5.25rem]">
        <div
          className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-500/25 to-orange-600/10 blur-md"
          aria-hidden
        />
        <div className="relative flex h-full w-full items-center justify-center rounded-full border-2 border-amber-500/35 bg-gradient-to-br from-slate-600 via-slate-800 to-slate-950 shadow-[inset_0_2px_14px_rgba(0,0,0,0.55),0_10px_28px_rgba(0,0,0,0.55),0_0_0_1px_rgba(251,191,36,0.2)] ring-2 ring-slate-950/80">
          <Sparkles
            className="h-8 w-8 text-amber-200 drop-shadow-[0_0_10px_rgba(251,191,36,0.45)] sm:h-9 sm:w-9"
            strokeWidth={2}
            aria-hidden
          />
        </div>
      </div>
    </div>
  );
};

export default Wheel;
