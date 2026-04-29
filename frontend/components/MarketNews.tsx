import React, { useEffect, useState } from 'react';
import { getSystemNews } from '../services/api';
import { SystemNews } from '../types';

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

    return (
        <div className="bg-slate-900/80 border-t border-b border-cyan-500/20 py-2 px-4 flex flex-wrap justify-center items-center gap-6 overflow-hidden backdrop-blur-sm z-20">
            <div className="flex flex-wrap justify-center gap-4 w-full max-w-5xl">
                {displayAds.length > 0 ? (
                    displayAds.map(ad => (
                        <a
                            key={ad.id}
                            href={ad.link || '#'}
                            target={ad.link ? "_blank" : "_self"}
                            rel="noopener noreferrer"
                            className="relative group overflow-hidden rounded-lg border border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.1)] transition-all hover:shadow-[0_0_20px_rgba(6,182,212,0.2)] hover:border-cyan-400/50 flex-shrink-0 w-[320px] h-[50px] block"
                        >
                            {ad.imageUrl ? (
                                <img src={ad.imageUrl} alt={ad.text} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                            ) : (
                                <div className="w-full h-full bg-slate-950 flex items-center justify-center p-2 text-center">
                                    <span className="text-[10px] text-cyan-400 font-bold uppercase truncate">{ad.text}</span>
                                </div>
                            )}
                        </a>
                    ))
                ) : (
                    placeholders.map(p => (
                        <div key={p.id} className={`relative group overflow-hidden rounded-lg border ${p.color === 'cyan' ? 'border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.1)] hover:border-cyan-400/50' : 'border-purple-500/30 shadow-[0_0_15px_rgba(168,85,247,0.1)] hover:border-purple-400/50'} transition-all flex-shrink-0 w-[320px] h-[50px]`}>
                            <img src={p.img} alt={p.label} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                            <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-1 pointer-events-none">
                                <span className={`text-[10px] ${p.color === 'cyan' ? 'text-cyan-400' : 'text-purple-400'} font-bold tracking-tighter uppercase`}>{p.label}</span>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
