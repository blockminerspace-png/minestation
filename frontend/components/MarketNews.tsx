import React, { useEffect, useState } from 'react';
import { getSystemNews } from '../services/api';
import { SystemNews } from '../types';
import { RemoteBannerImage } from './RemoteBannerImage';

export const MarketNews: React.FC = () => {
    const [ads, setAds] = useState<SystemNews[]>([]);

    useEffect(() => {
        const loadAds = async () => {
            const list = await getSystemNews();
            // Filter only horizontal and active
            setAds(list.filter(n => n.adType === 'horizontal' && n.active));
        };
        loadAds();
        const interval = setInterval(loadAds, 30000); // Refresh every 30s
        return () => clearInterval(interval);
    }, []);

    // Fallback placeholders if no ads are configured
    const placeholders = [
        { id: 'p1', img: '/brain/c5bf420e-fa44-42f3-b118-ac4247fdd4b0/ad_placeholder_premium_1.png', label: 'Power Ad', color: 'cyan' },
        { id: 'p2', img: '/brain/c5bf420e-fa44-42f3-b118-ac4247fdd4b0/ad_placeholder_premium_2.png', label: 'Premium Spot', color: 'purple' }
    ];

    const displayAds = ads.length > 0 ? ads.slice(0, 2) : [];

    const bannerImgClass =
        'max-h-[88px] sm:max-h-[112px] md:max-h-[128px] w-auto max-w-full object-contain object-center block transition-opacity duration-300 group-hover:opacity-95';

    return (
        <div className="bg-slate-900/80 border-t border-b border-amber-500/20 py-2.5 px-3 sm:px-4 flex flex-wrap justify-center items-center gap-4 sm:gap-6 overflow-hidden backdrop-blur-sm z-20">
            <div className="flex flex-wrap justify-center items-center gap-3 sm:gap-5 w-full max-w-none">
                {displayAds.length > 0 ? (
                    displayAds.map(ad => (
                        <a
                            key={ad.id}
                            href={ad.link || '#'}
                            target={ad.link ? "_blank" : "_self"}
                            rel="noopener noreferrer"
                            className="relative group flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-amber-500/30 bg-slate-950/90 px-2 py-1.5 min-h-[48px] shadow-[0_0_15px_rgba(245,158,11,0.1)] transition-all hover:shadow-[0_0_20px_rgba(245,158,11,0.2)] hover:border-amber-400/50 max-w-[min(640px,calc(100vw-1.5rem))] sm:max-w-[min(calc(50%-0.75rem),720px)]"
                        >
                            {ad.imageUrl ? (
                                <RemoteBannerImage
                                    src={ad.imageUrl}
                                    alt={ad.text}
                                    className={bannerImgClass}
                                    failureHint="Banner indisponível"
                                />
                            ) : (
                                <div className="min-h-[44px] w-full min-w-[200px] max-w-[320px] bg-slate-950 flex items-center justify-center p-2 text-center">
                                    <span className="text-[10px] text-amber-400 font-bold uppercase truncate">{ad.text}</span>
                                </div>
                            )}
                        </a>
                    ))
                ) : (
                    placeholders.map(p => (
                        <div
                            key={p.id}
                            className={`relative group flex shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-slate-950/90 px-2 py-1.5 min-h-[48px] max-w-[min(640px,calc(100vw-1.5rem))] sm:max-w-[min(calc(50%-0.75rem),720px)] ${
                                p.color === 'cyan'
                                    ? 'border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.1)] hover:border-amber-400/50'
                                    : 'border-orange-500/30 shadow-[0_0_15px_rgba(194,65,12,0.1)] hover:border-orange-400/50'
                            } transition-all`}
                        >
                            <RemoteBannerImage src={p.img} alt={p.label} className={bannerImgClass} failureHint="Placeholder" />
                            <div className="pointer-events-none absolute inset-0 flex items-end bg-gradient-to-t from-slate-900/60 to-transparent p-1 opacity-0 transition-opacity group-hover:opacity-100">
                                <span
                                    className={`text-[10px] ${p.color === 'cyan' ? 'text-amber-400' : 'text-orange-400'} font-bold tracking-tighter uppercase`}
                                >
                                    {p.label}
                                </span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
