/**
 * Esconde um `<img>` quando o asset não carrega (404 da pasta `/img/...` removida ou URL inválido).
 * Mantém o layout estável usando `visibility: hidden` em vez de remover o nó — útil quando o slot
 * tem fallback de emoji/ícone via CSS atrás do `<img>`.
 *
 * Quando o caller quer remover totalmente o `<img>` (sem fallback irmão), passar `mode: 'remove'`.
 */
export type ImageFallbackMode = 'hide' | 'remove';

export function handleImageError(
  ev: React.SyntheticEvent<HTMLImageElement, Event>,
  mode: ImageFallbackMode = 'hide'
): void {
  const node = ev.currentTarget;
  if (!node) return;
  /** Evita loops de erro se um fallback `onerror` repetidamente disparar (browsers fazem isto com `src`). */
  node.onerror = null;
  if (mode === 'remove') {
    node.remove();
    return;
  }
  node.style.visibility = 'hidden';
  node.style.opacity = '0';
}
