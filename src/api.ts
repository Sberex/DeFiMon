// Only the public server origin belongs in VITE_* variables. Never provider keys.
export function publicApiBase(value = '') {
  const input = value.trim();
  if (!input) return '';
  const url = new URL(input);
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '') || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) throw new Error('Use the public HTTPS server origin for VITE_API_BASE_URL.');
  return url.origin;
}
const apiBase = publicApiBase(import.meta.env.VITE_API_BASE_URL);
export const liveApiMissing = import.meta.env.VITE_STATIC_HOSTING === 'true' && !apiBase;
export const liveApiMessage = 'Live wallet checks are not configured on this public page yet. You can explore the example dashboard below.';
export function apiUrl(path: string) {
  if (liveApiMissing) throw new Error(liveApiMessage);
  return `${apiBase}${path}`;
}
