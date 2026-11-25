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

/** Only phone numbers made of digits and common separators become tel: links. */
export function telHref(phone: string): string | null {
  const compact = phone.replace(/[\s().-]/g, '');
  return /^\+?\d{6,15}$/.test(compact) ? `tel:${compact}` : null;
}

/** External link that opens in a new tab; returns '' when the URL is not http(s). */
export function externalLink(url: string | undefined, text: string, className = 'link'): string {
  const href = url === undefined ? null : safeHref(url);
  if (!href) return '';
  return `<a class="${className}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)} <span aria-hidden="true">↗</span></a>`;
}
