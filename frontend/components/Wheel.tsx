import React, { useState, useEffect } from 'react';
import { WheelItem } from '../types';

interface WheelProps {
    items: WheelItem[];
    mustSpin: boolean;
    targetWinner: WheelItem | null;
    onStopSpinning: () => void;
}

const Wheel: React.FC<WheelProps> = ({ items, mustSpin, targetWinner, onStopSpinning }) => {
    const [rotation, setRotation] = useState(0);
    const totalWeight = items.reduce((a, b) => a + b.weight, 0);

    // Calculate gradients for the wheel segments
    const gradientParts: string[] = [];
    let currentDeg = 0;
    // We map segments to render them via conic-gradient
    if (items.length > 0) {
        items.forEach(item => {
            const deg = (item.weight / totalWeight) * 360;
            // Use item color or fallback
            const color = item.color || '#334155';
            gradientParts.push(`${color} ${currentDeg}deg ${currentDeg + deg}deg`);
            currentDeg += deg;
        });
    } else {
        gradientParts.push('#334155 0deg 360deg'); // Empty gray wheel
    }

    const backgroundStyle = `conic-gradient(${gradientParts.join(', ')})`;

    useEffect(() => {
        if (mustSpin && targetWinner && items.length > 0) {
            // 1. Calculate target angle for the winner
            let winnerStart = 0;
            let winnerSize = 0;
            for (const item of items) {
                const deg = (item.weight / totalWeight) * 360;
                if (item.id === targetWinner.id) {
                    winnerSize = deg;
                    break;
                }
                winnerStart += deg;
            }

            // The winner segment center
            const winnerCenter = winnerStart + (winnerSize / 2);

            // We want the winnerCenter to align with the pointer at 0deg (top).
            // Since CSS rotates clockwise, to bring a generic angle X to 0, we rotate by (360 - X).
            // We also add extra spins (e.g. 5 full variances = 1800deg) for effect.
            const extraSpins = 1800; // 5 * 360
            const targetRotation = extraSpins + (360 - winnerCenter);

            // Advance from current rotation to the next target
            // Ensure we always spin forward significantly
            const currentMod = rotation % 360;
            const dist = targetRotation - currentMod;
            const finalRotation = rotation + dist + (dist < 0 ? 360 : 0);

            setRotation(finalRotation);

            const timer = setTimeout(() => {
                onStopSpinning();
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [mustSpin, targetWinner, items, onStopSpinning]);

    return (
        <div className="relative mx-auto aspect-square w-[min(22rem,calc(100vw-1.25rem))] max-w-sm flex items-center justify-center font-sans transition-all sm:w-[min(22rem,calc(100vw-2.5rem))]">
            {/* Pointer — alinhado à paleta do site */}
            <div
                className="absolute left-1/2 z-20 -translate-x-1/2"
                style={{ top: 'clamp(-1.35rem, -4vw, -0.85rem)' }}
            >
                <div
                    className="h-0 w-0 border-l-[14px] border-l-transparent border-r-[14px] border-r-transparent border-t-[26px] border-t-amber-400 drop-shadow-[0_3px_6px_rgba(0,0,0,0.55)]"
                    style={{ filter: 'drop-shadow(0 0 8px rgba(251,191,36,0.45))' }}
                />
            </div>

            {/* Moldura + disco: fundo (com clip) à parte dos rótulos para não cortar o texto na borda */}
            <div
                className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-500/40 via-orange-600/30 to-slate-900 p-[6px] shadow-[0_12px_40px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)]"
                aria-hidden
            >
                <div
                    className="relative h-full w-full rounded-full border border-slate-900/90"
                    style={{
                        transform: `rotate(${rotation}deg)`,
                        transition: 'transform 4000ms cubic-bezier(0.2, 0.8, 0.2, 1)',
                        willChange: 'transform'
                    }}
                >
                    <div
                        className="absolute inset-0 z-0 overflow-hidden rounded-full shadow-[inset_0_0_28px_rgba(0,0,0,0.45)]"
                        style={{
                            background: items.length > 0 ? backgroundStyle : '#1e293b'
                        }}
                    />
                    {/* Raios a partir do centro: texto horizontal, dentro do círculo (sem clip nos rótulos) */}
                    {items.map((item, index) => {
                        let startDeg = 0;
                        for (let i = 0; i < index; i++) {
                            startDeg += (items[i].weight / totalWeight) * 360;
                        }
                        const sliceDeg = (item.weight / totalWeight) * 360;
                        const midDeg = startDeg + sliceDeg / 2;

                        return (
                            <div
                                key={item.id}
                                className="pointer-events-none absolute bottom-1/2 left-1/2 z-[1] flex h-[50%] w-0 origin-bottom"
                                style={{ transform: `translateX(-50%) rotate(${midDeg}deg)` }}
                            >
                                <div className="relative flex w-[8.5rem] max-w-[38vw] -translate-x-1/2 flex-col items-center justify-end self-center pb-[22%] sm:w-[9.25rem] sm:max-w-[40vw] sm:pb-[20%]">
                                    <span
                                        title={item.label}
                                        className="line-clamp-3 w-full hyphens-auto break-words rounded-md border border-white/15 bg-black/60 px-1.5 py-1 text-center font-sans text-[8.5px] font-semibold leading-[1.2] text-white shadow-md backdrop-blur-sm sm:text-[9.5px]"
                                        style={{
                                            transform: `rotate(${-midDeg}deg)`,
                                            textShadow: '0 1px 2px rgba(0,0,0,0.95)'
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

            {/* Centro */}
            <div className="pointer-events-none absolute z-[15] flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full border-[3px] border-amber-900/40 bg-gradient-to-br from-slate-700 via-slate-800 to-slate-950 shadow-[inset_0_2px_12px_rgba(0,0,0,0.55),0_8px_20px_rgba(0,0,0,0.5),0_0_0_1px_rgba(251,191,36,0.12)] sm:h-20 sm:w-20">
                <span className="text-xl sm:text-2xl" aria-hidden>
                    🎰
                </span>
            </div>
        </div>
    );
};

export default Wheel;
