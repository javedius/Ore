/** Recent databases, persisted in localStorage. */

export const RECENTS_KEY = "caliper-recents";

export interface Recent {
  path: string;
  name: string;
  ts: number;
}

export function loadRecents(): Recent[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as Recent[]) : [];
  } catch {
    return [];
  }
}

export function addRecent(path: string, name: string): Recent[] {
  const next = [
    { path, name, ts: Date.now() },
    ...loadRecents().filter((r) => r.path !== path),
  ].slice(0, 8);
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* noop */
  }
  return next;
}

export function clearRecents(): void {
  try {
    localStorage.removeItem(RECENTS_KEY);
  } catch {
    /* noop */
  }
}
