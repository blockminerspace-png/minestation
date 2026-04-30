import React from 'react';

export const Footer: React.FC = () => {
    return (
        <footer className="py-6 text-center text-slate-500 dark:text-slate-600 text-xs bg-slate-50 dark:bg-slate-950/50 border-t border-slate-200 dark:border-slate-900 shrink-0 transition-colors duration-300">
            <div className="max-w-7xl mx-auto px-4">
                <p>&copy; 2024 Genesis Miner. Todos os direitos reservados.</p>
                <p className="mt-1 opacity-70">Operando na rede Polygon PoS.</p>
            </div>
        </footer>
    );
};
