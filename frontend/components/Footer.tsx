import React from 'react';

export const Footer: React.FC = () => {
    return (
        <footer className="py-6 text-center text-slate-500 dark:text-slate-500 text-xs bg-slate-50 dark:bg-[#0f0c08] border-t border-slate-200 dark:border-amber-900/35 shrink-0 transition-colors duration-300">
            <div className="max-w-7xl mx-auto px-4">
                <p className="font-semibold bg-gradient-to-r from-amber-500 to-orange-600 dark:from-amber-300 dark:to-amber-500 bg-clip-text text-transparent tracking-widest">V0.5 // Genesis DAO</p>
                <p className="mt-2 text-slate-600 dark:text-slate-400">&copy; {new Date().getFullYear()} Genesis Miner. Todos os direitos reservados.</p>
                <p className="mt-1 opacity-80">Operando na rede Polygon PoS.</p>
            </div>
        </footer>
    );
};
