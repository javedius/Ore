import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { openDb, pathExists } from "../commands";
import type { DbInfo } from "../types";

const RECENTS_KEY = "caliper-recents";

interface Recent {
  path: string;
  name: string;
  ts: number;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function loadRecents(): Recent[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as Recent[]) : [];
  } catch {
    return [];
  }
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function EmptyState({ onOpened }: { onOpened: (db: DbInfo) => void }) {
  const [recents, setRecents] = useState<Recent[]>(loadRecents);
  const [missing, setMissing] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    // Mark recent files that no longer exist on disk (inside Tauri only)
    if (!isTauri()) return;
    for (const r of recents) {
      pathExists(r.path).then((ok) => setMissing((m) => ({ ...m, [r.path]: !ok })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doOpen = useCallback(
    async (path: string) => {
      if (!isTauri()) {
        setError("This preview runs outside Tauri — launch the app to open databases.");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const db = await openDb(path);
        const next = [
          { path, name: db.name, ts: Date.now() },
          ...loadRecents().filter((r) => r.path !== path),
        ].slice(0, 8);
        setRecents(next);
        try {
          localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
        } catch {
          /* private mode — not critical */
        }
        onOpened(db);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [onOpened]
  );

  const pickFile = useCallback(async () => {
    try {
      const file = await open({
        multiple: false,
        filters: [{ name: "SQLite database", extensions: ["db", "sqlite", "sqlite3", "db3"] }],
      });
      if (typeof file === "string") await doOpen(file);
    } catch {
      /* dialog cancelled */
    }
  }, [doOpen]);

  // Drag&drop of a database file onto the window
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((ev) => {
        if (ev.payload.type === "over") {
          setDragOver(true);
        } else if (ev.payload.type === "drop") {
          setDragOver(false);
          const p = ev.payload.paths[0];
          if (p) void doOpen(p);
        } else {
          setDragOver(false);
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [doOpen]);

  const clearRecents = () => {
    setRecents([]);
    try {
      localStorage.removeItem(RECENTS_KEY);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="app">
      <div className="es-body">
        <div className="es-col">
          <div className={"dropzone" + (dragOver ? " is-over" : "")} onClick={busy ? undefined : pickFile}>
            <svg className="dz-icon"><use href="#i-db" /></svg>
            <div className="dz-title">{busy ? "Opening…" : "Drop a SQLite file here"}</div>
            <div className="dz-sub">.db · .sqlite · .sqlite3</div>
            <div className="dz-actions" onClick={(e) => e.stopPropagation()}>
              <button className="btn btn-primary" disabled={busy} onClick={pickFile}>
                Open Database…
              </button>
            </div>
          </div>

          {error && (
            <div className="alert-line">
              <svg className="icon"><use href="#i-alert" /></svg>
              <span className="truncate">{error}</span>
            </div>
          )}

          {recents.length > 0 && (
            <div className="recents">
              <div className="recents-head">
                Recent
                <span className="grow" />
                <button className="btn btn-ghost" style={{ height: 20, padding: "0 6px", fontSize: 11 }} onClick={clearRecents}>
                  Clear
                </button>
              </div>
              {recents.map((r) => (
                <div key={r.path} className={"recent-item" + (missing[r.path] ? " is-missing" : "")} onClick={busy ? undefined : () => doOpen(r.path)}>
                  <svg className="icon recent-icon"><use href={missing[r.path] ? "#i-file" : "#i-db"} /></svg>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="recent-name">{r.name}</div>
                    <div className="recent-path truncate">{r.path}</div>
                  </div>
                  <div className="recent-meta">
                    {timeAgo(r.ts)}
                    {missing[r.path] && <><br />file moved</>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="es-hint">Everything runs locally — your files never leave this machine.</p>
        </div>
      </div>
    </div>
  );
}
