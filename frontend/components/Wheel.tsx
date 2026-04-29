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
        <div className="relative w-96 h-96 flex items-center justify-center my-8 scale-100 md:scale-110 transition-all">
            {/* Pointer (Top Center) */}
            <div className="absolute -top-5 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[16px] border-l-transparent border-r-[16px] border-r-transparent border-t-[32px] border-t-white z-20 drop-shadow-[0_4px_4px_rgba(0,0,0,0.5)] filter drop-shadow-lg" />

            {/* The Wheel */}
            <div
                className="w-full h-full rounded-full border-[8px] border-slate-800 shadow-[0_0_50px_rgba(0,0,0,0.5)] relative overflow-hidden transition-transform duration-[4000ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] will-change-transform"
                style={{
                    background: items.length > 0 ? backgroundStyle : '#1e293b',
                    transform: `rotate(${rotation}deg)`
                }}
            >
                {/* Segment Labels & Images */}
                {items.map((item, index) => {
                    // Re-calculate angles for rendering text
                    let startDeg = 0;
                    for (let i = 0; i < index; i++) {
                        startDeg += (items[i].weight / totalWeight) * 360;
                    }
                    const sliceDeg = (item.weight / totalWeight) * 360;
                    const midDeg = startDeg + sliceDeg / 2;

                    return (
                        <div
                            key={item.id}
                            className="absolute top-0 left-1/2 w-48 -ml-24 h-1/2 origin-bottom flex flex-col items-center justify-start pt-8 leading-none"
                            style={{ transform: `rotate(${midDeg}deg)` }}
                        >
                            <div className="flex flex-col-reverse items-center justify-end gap-3 rotate-90 origin-center whitespace-nowrap">
                                <span
                                    className="text-[14px] font-bold text-white uppercase tracking-tighter drop-shadow-md px-2 py-1 rounded bg-black/30 max-w-[160px] truncate text-center"
                                    style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}
                                >
                                    {item.label}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Central Hub */}
            <div className="absolute w-20 h-20 bg-gradient-to-br from-slate-700 to-slate-900 rounded-full border-[4px] border-slate-600 z-10 flex items-center justify-center shadow-[inset_0_2px_10px_rgba(0,0,0,0.5),0_10px_20px_rgba(0,0,0,0.5)]">
                <div className="text-center">
                    <div className="text-2xl">🎰</div>
                </div>
            </div>
        </div>
    );
};

export default Wheel;
