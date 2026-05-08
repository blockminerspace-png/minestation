import { Upgrade } from '../types';

const base = (import.meta as any).env.VITE_API_URL || 'http://localhost:3001/api';

const FALLBACK_NEWS = [
  "Mercado Nanit instável devido a tempestades solares.",
  "Hackers utilizam torradeiras para mineração ilegal.",
  "Nanit dispara após rumor de adoção por IAs rebeldes.",
  "Analistas confusos com flutuação quântica do valor.",
  "Preço da eletricidade sobe 500% no setor industrial.",
  "Novo vírus 'Miner.exe' detectado em implantes neurais.",
  "Sindicato das IAs exige pagamento em Nanit puro.",
  "Falha na Matrix causa duplicação de blocos.",
  "Baleia misteriosa movimenta 1 trilhão de Nanits.",
  "Start-up promete mineração usando energia estática de gatos.",
  "Governo tenta taxar transações mentais de cripto.",
  "Protocolo 'Hardcore' ativado: escassez aumenta.",
  "Jovem fica rico achando carteira antiga em HD sucateado.",
  "Mercado lateraliza enquanto traders dormem.",
  "Sinal de satélite financeiro interceptado por piratas."
];

const getRandomFallback = () => {
  return FALLBACK_NEWS[Math.floor(Math.random() * FALLBACK_NEWS.length)];
};

export const generateMarketNews = async (totalProduction: number): Promise<string> => {
  try {
    const res = await fetch(`${base}/gemini/generate-news`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totalProduction })
    });
    const data = await res.json();
    if (data.fallback) return getRandomFallback();
    return data.text || getRandomFallback();
  } catch (error) {
    console.warn("Gemini Proxy News Error:", error);
    return getRandomFallback();
  }
};

export const generateItemImage = async (upgrade: Upgrade): Promise<string | null> => {
  // Image generation proxy not implemented in backend yet as it's not currently used
  return null;
};

export const getFortunePrediction = async (prizeLabel: string): Promise<string> => {
  try {
    const res = await fetch(`${base}/gemini/fortune`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prizeLabel })
    });
    const data = await res.json();
    return data.text || "O destino é incerto, mas a sorte sorri para os corajosos.";
  } catch (error) {
    console.warn("Gemini Proxy Fortune Error:", error);
    return "O futuro está nebuloso neste momento.";
  }
};

