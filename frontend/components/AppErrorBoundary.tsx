import React, { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { err: Error | null };

/**
 * Evita ecrã totalmente vazio se algum componente da árvore rebentar no render.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(e: Error): State {
    return { err: e };
  }

  componentDidCatch(e: Error, info: ErrorInfo): void {
    console.error('[AppErrorBoundary]', e?.message || e, info?.componentStack);
  }

  render(): ReactNode {
    if (this.state.err) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-6 bg-[#0f0c08] text-slate-200 p-8 font-sans">
          <p className="text-center text-amber-400/95 text-sm max-w-md leading-relaxed">
            Ocorreu um erro ao mostrar a página. Isto não bloqueia o servidor — normalmente basta recarregar.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg border border-amber-500/50 bg-amber-600/25 px-5 py-2.5 text-sm font-bold text-amber-100 hover:bg-amber-600/40 transition"
          >
            Recarregar página
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
