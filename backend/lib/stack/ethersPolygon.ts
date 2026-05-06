import { JsonRpcProvider } from 'ethers';

let polygonProvider: JsonRpcProvider | null = null;

/** Leitura RPC Polygon (ethers v6) — depósitos / leitura de contratos. */
export function getPolygonReadProvider(): JsonRpcProvider | null {
  const url = process.env.POLYGON_RPC?.trim();
  if (!url) return null;
  if (!polygonProvider) {
    polygonProvider = new JsonRpcProvider(url);
  }
  return polygonProvider;
}
