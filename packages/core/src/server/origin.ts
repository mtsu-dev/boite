import { hostname, networkInterfaces } from 'node:os';

/** The origins of the desktop app's own pages. */
export const SHELL_ORIGINS = ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost'];

export function isAllowedOrigin(origin: string | null, port: number, host: string): boolean {
  if (origin === null) return true;
  if (SHELL_ORIGINS.includes(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.origin !== origin || Number(url.port || (url.protocol === 'https:' ? 443 : 80)) !== port) return false;
    const name = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (['127.0.0.1', 'localhost', '::1'].includes(name)) return true;
    if (host !== '0.0.0.0' && host !== '::') return name === host.toLowerCase();
    if (name === hostname().toLowerCase()) return true;
    return Object.values(networkInterfaces()).some((entries) => entries?.some((entry) => entry.address === name));
  } catch {
    return false;
  }
}
