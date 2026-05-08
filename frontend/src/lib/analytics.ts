/** Mesmo ID que em `index.html` (gtag.js). */
const GA_MEASUREMENT_ID = 'G-JBHPLPLLDG';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * GA4 numa SPA: o primeiro `page_view` vem do `gtag('config')` no HTML.
 * Cada mudança de ecrã sem reload precisa de um novo `config` com `page_path`.
 */
export function trackSpaPageView(pagePath: string, pageTitle?: string): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') return;
  const path = pagePath.startsWith('/') ? pagePath : `/${pagePath}`;
  window.gtag('config', GA_MEASUREMENT_ID, {
    page_path: path,
    page_title: pageTitle || path
  });
}
