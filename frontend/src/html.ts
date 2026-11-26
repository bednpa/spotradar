/** Tiny HTML helpers shared by all render modules (no other imports, so no cycles). */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only http(s) links are rendered as hrefs. */
export function safeHref(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null;
}

/** External link that opens in a new tab; returns '' when the URL is not http(s). */
export function externalLink(url: string | undefined, text: string, className = 'link'): string {
  const href = url === undefined ? null : safeHref(url);
  if (!href) return '';
  return `<a class="${className}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)} <span aria-hidden="true">↗</span></a>`;
}
