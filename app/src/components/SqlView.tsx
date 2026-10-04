import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { execSql, saveText, stopQuery } from "../commands";
import type { HistoryEntry, SqlResult, StatusInfo } from "../types";
import { Icon } from "./Icons";
import { CellView, cellClass, cellText, isBlob } from "./cell";

const HIST_KEY = "caliper-history";

interface Props {
  onStatus: (s: StatusInfo) => void;
  onSchemaChanged: () => void;
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HIST_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

export default function SqlView({ onStatus, onSchemaChanged }: Props) {
  const [sql, setSql] = useState("SELECT name, type FROM sqlite_master ORDER BY type, name");
  const [result, setResult] = useState<SqlResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pane, setPane] = useState<"results" | "messages">("results");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);

  const pushHistory = (entry: { sql: string; ok: boolean; meta: string }) => {
    setHistory((prev) => {
      const next: HistoryEntry[] = [{ id: Date.now(), ts: Date.now(), ...entry }, ...prev].slice(0, 50);
      try {
        localStorage.setItem(HIST_KEY, JSON.stringify(next));
      } catch {
        /* noop */
      }
      return next;
    });
  };

  const run = async () => {
    if (!sql.trim() || running) return;
    setRunning(true);
    try {
      const res = await execSql(sql);
      setResult(res);
      setError(null);
      setPane(res.kind === "query" ? "results" : "messages");
      const meta =
        res.kind === "exec"
          ? `${res.rowsAffected} row(s) affected`
          : `${res.rows.length} row(s) · ${res.elapsedMs} ms`;
      onStatus({ echo: sql.replace(/\s+/g, " "), ms: res.elapsedMs, note: meta });
      pushHistory({ sql, ok: true, meta });
      if (res.kind === "exec") onSchemaChanged();
    } catch (e) {
      setError(String(e));
      setResult(null);
      setPane("messages");
      onStatus({ echo: sql.replace(/\s+/g, " "), note: "error" });
      pushHistory({ sql, ok: false, meta: String(e) });
    } finally {
      setRunning(false);
    }
  };

  const clearHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem(HIST_KEY);
    } catch {
      /* noop */
    }
  };

  const [exportOpen, setExportOpen] = useState(false);
  const csvEscape = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

  const doExport = async (format: "csv" | "json") => {
    setExportOpen(false);
    if (!result || result.kind !== "query") return;
    try {
      const path = await save({
        defaultPath: `query-result.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!path) return;
      const content =
        format === "json"
          ? JSON.stringify(
              result.rows.map((row) => {
                const obj: Record<string, unknown> = {};
                result.columns.forEach((c, i) => {
                  const v = row[i];
                  obj[c] = isBlob(v) ? `BLOB (${v.__blob__} B)` : v;
                });
                return obj;
              }),
              null,
              2
            )
          : [
              result.columns.map(csvEscape).join(","),
              ...result.rows.map((r) => r.map((v) => csvEscape(cellText(v))).join(",")),
            ].join("\n");
      await saveText(path, content);
      onStatus({ echo: `EXPORT result → ${path}`, note: `${result.rows.length} rows exported` });
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="sql-layout">
      <div className="ed-pane">
        <div className="toolbar">
          <button className="btn btn-primary" onClick={run} disabled={running}>
            <Icon name="i-play" />
            Run
            <span className="kbd">⌘⏎</span>
          </button>
          <button
            className="btn"
            disabled={!running}
            onClick={() => {
              void stopQuery();
            }}
            title="Interrupt the running statement"
          >
            Stop
          </button>
          <div className="grow" />
          {result && (
            <span className="pgmeta">
              {result.kind === "query"
                ? `${result.rows.length} rows · ${result.elapsedMs} ms`
                : `${result.rowsAffected} rows affected`}
            </span>
          )}
        </div>

        <textarea
          className="sql-input"
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void run();
            }
          }}
          spellCheck={false}
          placeholder="Type SQL and press ⌘/Ctrl+Enter…"
        />

        <div className="result">
          <div className="rtabs">
            <button className={"rtab" + (pane === "results" ? " active" : "")} onClick={() => setPane("results")}>
              Results
              {result?.kind === "query" && <span className="cnt">{result.rows.length}</span>}
            </button>
            <button className={"rtab" + (pane === "messages" ? " active" : "")} onClick={() => setPane("messages")}>
              Messages
              {error && <span className="sdot sdot-err" />}
            </button>
            <div className="grow" />
            {result && <span className="resmeta">{result.elapsedMs} ms</span>}
            {result?.kind === "query" && result.rows.length > 0 && (
              <div style={{ position: "relative", alignSelf: "center", marginRight: 8 }}>
                <button className="btn" onClick={() => setExportOpen(!exportOpen)} title="Export the result (first 1000 rows)">
                  <Icon name="i-download" />
                  Export
                  <Icon name="i-chev-d" className="icon icon-sm" />
                </button>
                {exportOpen && (
                  <div className="menu" style={{ right: 0, top: 32 }} onClick={(e) => e.stopPropagation()}>
                    <button className="menu-item" onClick={() => doExport("csv")}>
                      <Icon name="i-grid" />
                      CSV
                    </button>
                    <button className="menu-item" onClick={() => doExport("json")}>
                      <Icon name="i-braces" />
                      JSON
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {pane === "results" && result?.kind === "query" && (
            <div className="grid-wrap result-grid">
              <table className="grid">
                <colgroup>
                  <col style={{ width: 46 }} />
                  {result.columns.map((_c, i) => (
                    <col key={i} style={{ width: 200 }} />
                  ))}
                </colgroup>
                <thead>
                  <tr className="head-row">
                    <th className="gutter">#</th>
                    {result.columns.map((c, i) => (
                      <th key={i}>
                        <div className="th-in">
                          <span className="th-name">{c}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, ri) => (
                    <tr key={ri}>
                      <td className="gutter">{ri + 1}</td>
                      {row.map((v, ci) => (
                        <td key={ci} className={cellClass(v)} title={v === null ? "NULL" : String(v)}>
                          <CellView v={v} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.rows.length === 0 && (
                <div className="empty-main">0 rows — query executed in {result.elapsedMs} ms</div>
              )}
            </div>
          )}

          {pane === "messages" && (
            <div className="msg-pane">
              {error ? (
                <>
                  <div className="msg-title">
                    <Icon name="i-alert" />
                    Error
                  </div>
                  <div className="msg-box">{error}</div>
                  <div className="msg-hint">Check the statement syntax — the message comes from SQLite itself.</div>
                </>
              ) : result?.kind === "exec" ? (
                <>
                  <div className="msg-title" style={{ color: "var(--accent)" }}>
                    <Icon name="i-check" />
                    Done
                  </div>
                  <div className="msg-box">
                    {result.rowsAffected} row(s) affected · {result.elapsedMs} ms
                  </div>
                  <div className="msg-hint">
                    Schema changes are picked up automatically. History is kept on the right.
                  </div>
                </>
              ) : (
                <div className="msg-hint">
                  Run a statement with <b>⌘/Ctrl+Enter</b>. SELECT results appear in the Results tab,
                  DDL/DML confirmations — here. Only the first statement of the editor runs.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <aside className="rail">
        <div className="rail-head">
          <Icon name="i-clock" />
          History
          <span className="grow" />
          {history.length > 0 && (
            <button className="btn btn-ghost" style={{ height: 20, padding: "0 6px", fontSize: 11 }} onClick={clearHistory}>
              Clear
            </button>
          )}
        </div>
        <div className="hist-list">
          {history.length === 0 && (
            <div style={{ padding: 12, color: "var(--text-3)", fontSize: 12 }}>No queries yet</div>
          )}
          {history.map((h) => (
            <div key={h.id} className="hist-item" onClick={() => setSql(h.sql)} title="Click to load into editor">
              <div className="hist-top">
                <span className={"sdot " + (h.ok ? "sdot-ok" : "sdot-err")} />
                {new Date(h.ts).toLocaleTimeString()}
              </div>
              <div className="hist-sql">{h.sql}</div>
              <div className={"hist-meta" + (h.ok ? "" : " err")}>{h.meta}</div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
