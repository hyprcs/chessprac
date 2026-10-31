import type { Site } from '../types';
import { getWithBackoff, type HttpConfig } from './http';

/** Looks the username up on the site; returns its canonical spelling, or null if there's no such player. */
export async function findAccount(site: Site, username: string, cfg: HttpConfig = {}): Promise<string | null> {
  const u = encodeURIComponent(username.trim().toLowerCase());
  const url = site === 'chesscom' ? `https://api.chess.com/pub/player/${u}` : `https://lichess.org/api/user/${u}`;
  const res = await getWithBackoff(url, 'application/json', cfg, site === 'chesscom' ? 10_000 : 60_000);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${site === 'chesscom' ? 'chess.com' : 'Lichess'}: HTTP ${res.status}`);
  const data = await res.json();
  if (data.disabled || data.closed) return null;
  return data.username ?? username;
}
