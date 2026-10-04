import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { execSql, saveText, stopQuery } from "../commands";
import type { HistoryEntry, SqlOutcome, StatusInfo } from "../types";
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
  const [outcomes, setOutcomes] = useState<SqlOutcome[]>([]);
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
      setOutcomes(res);
      setError(null);
      const hasError = res.some((o) => o.kind === "error");
      const lastQuery = [...res].reverse().find((o) => o.kind === "query");
      setPane(lastQuery && !hasError ? "results" : "messages");
      const rowsTotal = res.filter((o) => o.kind === "query").reduce((a, o) => a + o.rows.length, 0);
      const meta =
        res.length > 1
          ? `${res.length} statements · ${rowsTotal} rows`
          : lastQuery
            ? `${lastQuery.rows.length} row(s) · ${lastQuery.elapsedMs} ms`
            : `${res[0]?.rowsAffected ?? 0} row(s) affected`;
      onStatus({
        echo: sql.replace(/\s+/g, " "),
        ms: res.reduce((a, o) => Math.max(a, o.elapsedMs), 0),
        note: meta,
      });
      pushHistory({ sql, ok: true, meta });
      if (res.some((o) => o.kind === "exec")) onSchemaChanged();
    } catch (e) {
      setError(String(e));
      setOutcomes([]);
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
  const lastQueryOutcome = [...outcomes].reverse().find((o) => o.kind === "query") ?? null;

  const doExport = async (format: "csv" | "json") => {
    setExportOpen(false);
    if (!lastQueryOutcome) return;
    try {
      const path = await save({
        defaultPath: `query-result.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!path) return;
      const content =
        format === "json"
          ? JSON.stringify(
              lastQueryOutcome.rows.map((row) => {
                const obj: Record<string, unknown> = {};
                lastQueryOutcome.columns.forEach((c, i) => {
                  const v = row[i];
                  obj[c] = isBlob(v) ? `BLOB (${v.__blob__} B)` : v;
                });
                return obj;
              }),
              null,
              2
            )
          : [
              lastQueryOutcome.columns.map(csvEscape).join(","),
              ...lastQueryOutcome.rows.map((r) => r.map((v) => csvEscape(cellText(v))).join(",")),
            ].join("\n");
      await saveText(path, content);
      onStatus({ echo: `EXPORT result → ${path}`, note: `${lastQueryOutcome.rows.length} rows exported` });
    } catch (e) {
      setError(String(e));
    }
  };

  const totalRows = outcomes.filter((o) => o.kind === "query").reduce((a, o) => a + o.rows.length, 0);
  const totalMs = outcomes.reduce((a, o) => Math.max(a, o.elapsedMs), 0);

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
          {outcomes.length > 0 && (
            <span className="pgmeta">
              {outcomes.length > 1
                ? `${outcomes.length} statements · ${totalMs} ms`
                : `${totalMs} ms`}
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
          placeholder={"Type SQL and press ⌘/Ctrl+Enter…\nMultiple statements are executed in order."}
        />

        <div className="result">
          <div className="rtabs">
            <button className={"rtab" + (pane === "results" ? " active" : "")} onClick={() => setPane("results")}>
              Results
              {totalRows > 0 && <span className="cnt">{totalRows}</span>}
            </button>
            <button className={"rtab" + (pane === "messages" ? " active" : "")} onClick={() => setPane("messages")}>
              Messages
              {(error || outcomes.some((o) => o.kind === "error")) && <span className="sdot sdot-err" />}
            </button>
            <div className="grow" />
            {outcomes.length > 0 && <span className="resmeta">{totalMs} ms</span>}
            {lastQueryOutcome && lastQueryOutcome.rows.length > 0 && (
              <div style={{ position: "relative", alignSelf: "center", marginRight: 8 }}>
                <button className="btn" onClick={() => setExportOpen(!exportOpen)} title="Export the last result set (first 1000 rows)">
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

          {pane === "results" && (
            <div className="result-scroll">
              {outcomes
                .filter((o) => o.kind === "query")
                .map((o) => (
                  <div key={o.index} className="res-section">
                    <div className="res-head">
                      Statement {o.index} — {o.rows.length} rows · {o.elapsedMs} ms
                    </div>
                    <div className="grid-wrap result-grid">
                      <table className="grid">
                        <colgroup>
                          <col style={{ width: 46 }} />
                          {o.columns.map((_c, i) => (
                            <col key={i} style={{ width: 200 }} />
                          ))}
                        </colgroup>
                        <thead>
                          <tr className="head-row">
                            <th className="gutter">#</th>
                            {o.columns.map((c, i) => (
                              <th key={i}>
                                <div className="th-in">
                                  <span className="th-name">{c}</span>
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {o.rows.map((row, ri) => (
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
                      {o.rows.length === 0 && (
                        <div className="empty-main">0 rows — query executed in {o.elapsedMs} ms</div>
                      )}
                    </div>
                  </div>
                ))}
              {outcomes.length > 0 && totalRows === 0 && pane === "results" && (
                <div className="empty-main">No result sets — see Messages</div>
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
                </>
              ) : outcomes.length === 0 ? (
                <div className="msg-hint">
                  Run statements with <b>⌘/Ctrl+Enter</b>. SELECT results appear in the Results tab,
                  DDL/DML confirmations — here. Statements run in order; the sequence stops at the
                  first error.
                </div>
              ) : (
                outcomes.map((o) => (
                  <div key={o.index} className="msg-outcome">
                    {o.kind === "error" ? (
                      <>
                        <div className="msg-title">
                          <Icon name="i-alert" />
                          Statement {o.index} failed
                        </div>
                        <div className="msg-box">{o.error}</div>
                        <div className="msg-meta truncate">{o.sql}</div>
                      </>
                    ) : o.kind === "exec" ? (
                      <div className="msg-line">
                        <span className="sdot sdot-ok" />
                        Statement {o.index} — <b>{o.rowsAffected} row(s) affected</b> · {o.elapsedMs} ms
                      </div>
                    ) : (
                      <div className="msg-line">
                        <span className="sdot sdot-ok" />
                        Statement {o.index} — {o.rows.length} rows · {o.elapsedMs} ms
                      </div>
                    )}
                  </div>
                ))
              )}
              {!error && outcomes.some((o) => o.kind === "error") && (
                <div className="msg-hint">The sequence stopped at the first failed statement.</div>
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
