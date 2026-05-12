import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ExternalLink,
  Grid3X3,
  Play,
  LogOut,
  Maximize2,
  Minimize2,
  Settings,
  Info
} from 'lucide-react';

/** URL canónica — alinhar com `dashboard.service` e cartão BlockMiner no dashboard. */
const BLOCKMINER_EMBED_URL = 'https://blockminer.space/';

export type PartnerGamesPageProps = {
  onGoToYoutubePartners: () => void;
};

/**
 * Sessão de jogo estilo hub: viewport central, «Correr jogo» para iniciar o iframe,
 * barra de controlo (sair, ecrã inteio, site do parceiro). Vitrine YouTube em `/partners`.
 */
export const PartnerGamesPage: React.FC<PartnerGamesPageProps> = ({ onGoToYoutubePartners }) => {
  const [gameStarted, setGameStarted] = useState(false);
  const [iframeSrc, setIframeSrc] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  const runGame = useCallback(() => {
    setGameStarted(true);
    setIframeSrc(BLOCKMINER_EMBED_URL);
  }, []);

  const stopGame = useCallback(() => {
    setGameStarted(false);
    setIframeSrc('');
  }, []);

  useEffect(() => {
    const onFs = () => {
      const el = shellRef.current;
      setFullscreen(!!document.fullscreenElement && document.fullscreenElement === el);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = shellRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      /* ignorar — política do browser / iframe */
    }
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [settingsOpen]);

  return (
    <div className="w-full flex flex-col gap-4 text-slate-100 pb-6 px-2 sm:px-4 pt-1 min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          onClick={onGoToYoutubePartners}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800/80 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800 transition-colors"
        >
          ← Parceiros YouTube
        </button>
      </div>

      <section
        aria-label="Sessão de jogos BlockMiner"
        className="w-full max-w-5xl mx-auto flex flex-col gap-0 rounded-2xl border border-slate-700/90 bg-slate-950/80 overflow-hidden shadow-2xl shadow-black/50 ring-1 ring-violet-500/15"
      >
        {/* Cabeçalho da sessão */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-2 min-w-0">
            <Grid3X3 size={18} className="shrink-0 text-violet-400" aria-hidden />
            <h2 className="text-base sm:text-lg font-black tracking-tight text-white truncate">Jogos BlockMiner</h2>
            <span
              className="relative shrink-0 text-slate-500 hover:text-violet-300"
              title="O jogo corre dentro do site do parceiro. Se não carregar, desativa o bloqueador de anúncios para blockminer.space ou abre o site numa nova janela."
            >
              <Info size={16} className="cursor-help" aria-hidden />
            </span>
          </div>
          <a
            href={BLOCKMINER_EMBED_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-violet-500/35 bg-violet-600/15 px-2.5 py-1.5 text-[11px] font-bold text-violet-100 hover:bg-violet-600/30 transition-colors"
          >
            <ExternalLink size={12} className="shrink-0" />
            Site do parceiro
          </a>
        </div>

        {/* Viewport do jogo */}
        <div
          ref={shellRef}
          className="relative w-full aspect-[16/10] min-h-[280px] max-h-[min(72vh,720px)] bg-black"
        >
          {iframeSrc ? (
            <iframe
              title="BlockMiner"
              src={iframeSrc}
              className="absolute inset-0 h-full w-full border-0 bg-black"
              allow="fullscreen; clipboard-read; clipboard-write; payment"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : null}

          {!gameStarted && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-gradient-to-b from-slate-950 via-black to-slate-950 px-4">
              <p className="text-center text-sm text-slate-400 max-w-md">
                Carrega o hub do parceiro aqui. Alguns bloqueadores impedem o iframe até confirmares.
              </p>
              <button
                type="button"
                onClick={runGame}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-8 py-3.5 text-sm font-black uppercase tracking-wide text-white shadow-lg shadow-violet-900/40 ring-2 ring-violet-400/30 hover:brightness-110 active:scale-[0.99] transition-transform"
              >
                <Play size={22} className="fill-white shrink-0" aria-hidden />
                Correr jogo
              </button>
            </div>
          )}
        </div>

        {/* Barra de controlo (estilo sessão) */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 sm:px-4 py-3 border-t border-slate-800 bg-slate-900/95">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={onGoToYoutubePartners}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800/90 px-2.5 py-2 text-[11px] sm:text-xs font-bold text-slate-200 hover:bg-slate-800 transition-colors"
              title="Sair da sessão de jogos"
            >
              <LogOut size={16} className="shrink-0 opacity-90" />
              Sair
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800/90 px-2.5 py-2 text-[11px] sm:text-xs font-bold text-slate-200 hover:bg-slate-800 transition-colors"
              title={fullscreen ? 'Sair do ecrã inteiro' : 'Ecrã inteio'}
            >
              {fullscreen ? <Minimize2 size={16} className="shrink-0" /> : <Maximize2 size={16} className="shrink-0" />}
              {fullscreen ? 'Janela' : 'Ecrã inteio'}
            </button>
            <div className="relative" ref={settingsRef}>
              <button
                type="button"
                onClick={() => setSettingsOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800/90 px-2.5 py-2 text-[11px] sm:text-xs font-bold text-slate-200 hover:bg-slate-800 transition-colors"
                title="Opções"
                aria-expanded={settingsOpen}
              >
                <Settings size={16} className="shrink-0" />
                Opções
              </button>
              {settingsOpen && (
                <div className="absolute bottom-full left-0 mb-2 z-20 w-[min(92vw,280px)] rounded-xl border border-slate-600 bg-slate-900 p-3 shadow-xl text-xs text-slate-300 space-y-2">
                  <p>Se o jogo não aparecer, permite <strong className="text-white">blockminer.space</strong> no bloqueador de anúncios ou abre o site diretamente.</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <a
                      href={BLOCKMINER_EMBED_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg bg-violet-600/30 px-2 py-1.5 font-bold text-violet-100 hover:bg-violet-600/45"
                    >
                      <ExternalLink size={12} />
                      Abrir site
                    </a>
                    {gameStarted && (
                      <button
                        type="button"
                        onClick={() => {
                          stopGame();
                          setSettingsOpen(false);
                        }}
                        className="rounded-lg border border-slate-600 px-2 py-1.5 font-bold text-slate-300 hover:bg-slate-800"
                      >
                        Parar iframe
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 justify-end">
            <div className="flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-950/80 px-3 py-1.5">
              <span className="text-[10px] uppercase font-bold text-slate-500">Sessão</span>
              <span className={`text-xs font-black ${gameStarted ? 'text-emerald-400' : 'text-slate-500'}`}>
                {gameStarted ? 'Ativa' : 'Parada'}
              </span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-950/80 px-3 py-1.5">
              <span className="text-[10px] uppercase font-bold text-slate-500">Recompensas</span>
              <span className="text-xs font-mono font-bold text-amber-400/90" title="Saldo e recompensas do parceiro só no site blockminer.space">
                —
              </span>
            </div>
          </div>
        </div>
      </section>

      <p className="text-center text-[11px] text-slate-500 max-w-xl mx-auto px-2">
        Recompensas e anúncios do parceiro são contabilizados no <strong className="text-slate-400">blockminer.space</strong>, não no Genesis Miner.
      </p>
    </div>
  );
};
