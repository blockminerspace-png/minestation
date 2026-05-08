import React, { useCallback, useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';

export type RemoteBannerImageProps = {
  src: string;
  alt: string;
  /** Classes da tag `img` em carga bem-sucedida (ex.: `w-full h-full object-cover`). */
  className?: string;
  /** Texto curto no estado de falha (404, 502, 522 da origem/CDN, bloqueio, URL inválida). */
  failureHint?: string;
  /** Tipografia menor para miniaturas no admin. */
  compact?: boolean;
};

/**
 * Banner remoto com fallback explícito: `onError` cobre 404, 5xx (502), 522 (Cloudflare),
 * timeouts e respostas HTML em vez de imagem — o browser não distingue o código no `img`.
 */
export function RemoteBannerImage({
  src,
  alt,
  className = 'w-full h-full object-cover',
  failureHint = 'Banner indisponível',
  compact = false
}: RemoteBannerImageProps) {
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setBroken(false);
  }, [src]);

  const onError = useCallback(() => {
    setBroken(true);
  }, []);

  if (!src.trim() || broken) {
    return (
      <div
        className="flex w-full h-full min-h-0 flex-col items-center justify-center gap-0.5 bg-slate-950 text-amber-500/90 overflow-hidden p-0.5"
        title="Não foi possível carregar o banner (404, 502, 522 ou URL inválida / CDN)."
        role="img"
        aria-label={alt ? `${alt} — ${failureHint}` : failureHint}
      >
        <ImageOff className={compact ? 'w-2.5 h-2.5 opacity-70 shrink-0' : 'w-3.5 h-3.5 opacity-70 shrink-0'} aria-hidden />
        <span
          className={`font-bold uppercase text-center leading-tight line-clamp-3 ${
            compact ? 'text-[6px] px-0.5' : 'text-[7px] sm:text-[8px] px-0.5'
          }`}
        >
          {failureHint}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={onError}
    />
  );
}
