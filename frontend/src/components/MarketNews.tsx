import React, { useEffect, useMemo, useState } from 'react';
import { getSystemNews } from '../services/api';
import { SystemNews } from '../types';
import { RemoteBannerImage } from './RemoteBannerImage';
import { UI_PLACEHOLDER_ADS } from '../constants/assetPaths';

function clampAdDurationSeconds(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return 60;
  return Math.min(3600, Math.floor(n));
}

export const MarketNews: React.FC = () => {
  const [ads, setAds] = useState<SystemNews[]>([]);
  const [horizontalSlot, setHorizontalSlot] = useState(0);

  useEffect(() => {
    const loadAds = async () => {
      const list = await getSystemNews();
      setAds(list.filter((n) => n.adType === 'horizontal' && n.active));
    };
    loadAds();
    const interval = setInterval(loadAds, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const n = ads.length;
    if (n === 0) {
      setHorizontalSlot(0);
      return;
    }
    setHorizontalSlot((s) => s % n);
  }, [ads]);

  useEffect(() => {
    const n = ads.length;
    if (n === 0) return;
    const idx = ((horizontalSlot % n) + n) % n;
    const sec = clampAdDurationSeconds(ads[idx]?.duration);
    const ms = Math.max(3000, sec * 1000);
    const t = window.setTimeout(() => {
      setHorizontalSlot((s) => (s + 1) % n);
    }, ms);
    return () => clearTimeout(t);
  }, [ads, horizontalSlot]);

  const { leftAd, rightAd } = useMemo(() => {
    const n = ads.length;
    if (n === 0) {
      return { leftAd: null as SystemNews | null, rightAd: null as SystemNews | null };
    }
    const left = ads[horizontalSlot % n];
    const right = n > 1 ? ads[(horizontalSlot + 1) % n] : left;
    return { leftAd: left, rightAd: right };
  }, [ads, horizontalSlot]);

  const placeholders = [
    { id: 'p1', img: UI_PLACEHOLDER_ADS.premium1, label: 'Power Ad', color: 'cyan' },
    { id: 'p2', img: UI_PLACEHOLDER_ADS.premium2, label: 'Premium Spot', color: 'purple' }
  ];

  const displayPair: [SystemNews, SystemNews] | null =
    leftAd && rightAd ? [leftAd, rightAd] : null;

  return (
    <div className="bg-slate-900/80 border-t border-b border-amber-500/20 py-2 px-4 flex flex-wrap justify-center items-center gap-6 overflow-hidden backdrop-blur-sm z-20">
      <div className="flex flex-wrap justify-center gap-4 w-full max-w-5xl">
        {displayPair ? (
          displayPair.map((ad, i) => (
            <a
              key={`${horizontalSlot}-${i}-${ad.id}`}
              href={ad.link || '#'}
              target={ad.link ? '_blank' : '_self'}
              rel="noopener noreferrer"
              className="relative group overflow-hidden rounded-lg border border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.1)] transition-all hover:shadow-[0_0_20px_rgba(245,158,11,0.2)] hover:border-amber-400/50 flex-shrink-0 w-[320px] h-[50px] block"
            >
              {ad.imageUrl ? (
                <RemoteBannerImage
                  src={ad.imageUrl}
                  alt={ad.text}
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                  failureHint="Banner indisponível"
                />
              ) : (
                <div className="w-full h-full bg-slate-950 flex items-center justify-center p-2 text-center">
                  <span className="text-[10px] text-amber-400 font-bold uppercase truncate">{ad.text}</span>
                </div>
              )}
            </a>
          ))
        ) : (
          placeholders.map((p) => (
            <div
              key={p.id}
              className={`relative group overflow-hidden rounded-lg border ${p.color === 'cyan' ? 'border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.1)] hover:border-amber-400/50' : 'border-orange-500/30 shadow-[0_0_15px_rgba(194,65,12,0.1)] hover:border-orange-400/50'} transition-all flex-shrink-0 w-[320px] h-[50px]`}
            >
              <RemoteBannerImage
                src={p.img}
                alt={p.label}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                failureHint="Placeholder"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-1 pointer-events-none">
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
