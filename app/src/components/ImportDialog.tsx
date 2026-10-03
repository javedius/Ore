import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { csvPreview, importCsv } from "../commands";
import type { CsvPreview, Schema } from "../types";
import { Icon } from "./Icons";
import { fmtSize } from "./cell";

const DELIMS: Array<{ label: string; value: string }> = [
  { label: "Comma ( , )", value: "," },
  { label: "Semicolon ( ; )", value: ";" },
  { label: "Tab", value: "\t" },
  { label: "Pipe ( | )", value: "|" },
];

interface Props {
  schema: Schema;
  dbFileName: string;
  onClose: () => void;
  onDone: (table: string, imported: number) => void;
}

export default function ImportDialog({ schema, dbFileName, onClose, onDone }: Props) {
  const [path, setPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [delim, setDelim] = useState(",");
  const [hasHeader, setHasHeader] = useState(true);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [newTable, setNewTable] = useState("");
  const [existingTable, setExistingTable] = useState(schema.tables[0]?.name ?? "");
  const [mapping, setMapping] = useState<(string | null)[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickFile = async () => {
    try {
      const file = await open({
        multiple: false,
        filters: [{ name: "CSV", extensions: ["csv", "tsv", "txt"] }],
      });
      if (typeof file === "string") {
        setPath(file);
        setNewTable(
          file.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_]+/g, "_") || "imported"
        );
      }
    } catch {
      /* dialog cancelled */
    }
  };

  // Preview on file/option change
  useEffect(() => {
    if (!path) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    csvPreview(path, delim, hasHeader)
      .then(setPreview)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [path, delim, hasHeader]);

  // Default mapping: headers for a new table, auto-match for an existing one
  useEffect(() => {
    if (!preview) return;
    if (mode === "new") {
      setMapping(preview.headers.map((h) => (h.trim() ? h.trim() : null)));
    } else {
      const cols = schema.tables.find((t) => t.name === existingTable)?.columns ?? [];
      setMapping(
        preview.headers.map(
          (h) => cols.find((c) => c.name.toLowerCase() === h.trim().toLowerCase())?.name ?? null
        )
      );
    }
  }, [preview, mode, existingTable, schema.tables]);

  const autoMatched = mapping.filter(Boolean).length;
  const targetCols =
    mode === "existing"
      ? schema.tables.find((t) => t.name === existingTable)?.columns.map((c) => c.name) ?? []
      : [];

  const run = async () => {
    if (!path || !preview) return;
    const table = mode === "new" ? newTable.trim() : existingTable;
    if (!table) {
      setError("Table name is empty");
      return;
    }
    if (mapping.every((m) => !m || !m.trim())) {
      setError("Map at least one column");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await importCsv({
        path,
        table,
        createTable: mode === "new",
        delimiter: delim,
        hasHeader,
        mapping,
      });
      onDone(table, r.imported);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="dialog import-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dlg-head">
          <Icon name="i-upload" />
          <span className="dlg-title">Import CSV into {dbFileName}</span>
          <span className="grow" />
          <button className="icon-btn" onClick={onClose}>
            <Icon name="i-x" />
          </button>
        </div>

        <div className="dlg-body">
          <div className="dlg-sec">
            <div className="dlg-sec-title">File</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button className="btn" onClick={pickFile}>
                <Icon name="i-folder" />
                Choose CSV…
              </button>
              <span className="pgmeta truncate">{path ?? "no file selected"}</span>
            </div>
          </div>

          {loading && <div className="dlg-sec pgmeta">Reading preview…</div>}

          {error && (
            <div className="dlg-sec">
              <div className="alert-line">
                <Icon name="i-alert" />
                <span className="truncate mono">{error}</span>
              </div>
            </div>
          )}

          {preview && (
            <>
              <div className="dlg-sec">
                <div className="dlg-sec-title">Options</div>
                <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                  <label className="check" style={{ gap: 8 }}>
                    Delimiter
                    <select
                      className="input"
                      style={{ width: 150 }}
                      value={delim}
                      onChange={(e) => setDelim(e.target.value)}
                    >
                      {DELIMS.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="chip">UTF-8</span>
                  <label className="check">
                    <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
                    First row is headers
                  </label>
                </div>
              </div>

              <div className="dlg-sec">
                <div className="dlg-sec-title">Preview — first {preview.rows.length} rows</div>
                <div className="preview-table">
                  <table className="grid">
                    <thead>
                      <tr className="head-row">
                        <th className="gutter">#</th>
                        {preview.headers.map((h, i) => (
                          <th key={i}>
                            <div className="th-in">
                              <span className="th-name">{h.trim() || `col${i}`}</span>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, ri) => (
                        <tr key={ri}>
                          <td className="gutter">{ri + 1}</td>
                          {row.map((v, ci) => (
                            <td key={ci}>
                              <span className="cellv">{v === "" ? <span className="cell-null">NULL</span> : v}</span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pgmeta" style={{ marginTop: 6 }}>
                  {preview.totalRows.toLocaleString("en-US")} data rows · {fmtSize(preview.sizeBytes)} · empty fields → NULL
                </div>
              </div>

              <div className="dlg-sec">
                <div className="dlg-sec-title">Destination</div>
                <label className="radio">
                  <input type="radio" name="dest" checked={mode === "new"} onChange={() => setMode("new")} />
                  New table — named
                  <input
                    className="input mono"
                    style={{ width: 180 }}
                    value={newTable}
                    onChange={(e) => setNewTable(e.target.value)}
                  />
                  <span className="rmeta">column types are inferred from data</span>
                </label>
                <label className="radio">
                  <input type="radio" name="dest" checked={mode === "existing"} onChange={() => setMode("existing")} />
                  Existing table —
                  <select
                    className="input"
                    style={{ width: 180 }}
                    value={existingTable}
                    onChange={(e) => setExistingTable(e.target.value)}
                  >
                    {schema.tables.map((t) => (
                      <option key={t.name}>{t.name}</option>
                    ))}
                  </select>
                  {mode === "existing" && (
                    <span className="chip chip-accent" style={{ marginLeft: 8 }}>
                      {autoMatched} of {preview.headers.length} auto-matched
                    </span>
                  )}
                </label>
              </div>

              {mode === "existing" && (
                <div className="dlg-sec">
                  <div className="dlg-sec-title">Column mapping</div>
                  {preview.headers.map((h, i) => (
                    <div className="map-row" key={i}>
                      <span className="map-src" title={h}>{h.trim() || `col${i}`}</span>
                      <Icon name="i-chev-r" className="icon icon-sm map-arrow" />
                      <select
                        className="input"
                        style={{ width: 200 }}
                        value={mapping[i] ?? ""}
                        onChange={(e) =>
                          setMapping((m) => m.map((v, j) => (j === i ? e.target.value || null : v)))
                        }
                      >
                        <option value="">— ignore —</option>
                        {targetCols.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}

              {mode === "new" && (
                <div className="dlg-sec">
                  <div className="dlg-sec-title">Columns (from headers, editable)</div>
                  {preview.headers.map((h, i) => (
                    <div className="map-row" key={i}>
                      <span className="map-src" title={h}>{h.trim() || `col${i}`}</span>
                      <Icon name="i-chev-r" className="icon icon-sm map-arrow" />
                      <input
                        className="input"
                        style={{ width: 200 }}
                        value={mapping[i] ?? ""}
                        placeholder={`col${i}`}
                        onChange={(e) => setMapping((m) => m.map((v, j) => (j === i ? e.target.value : v)))}
                      />
                    </div>
                  ))}
                  <div className="msg-hint" style={{ marginTop: 8 }}>
                    Empty name — column is skipped. Types: INTEGER / REAL / TEXT inferred from values.
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="dlg-foot">
          <span className="footnote">
            {preview ? `${preview.totalRows.toLocaleString("en-US")} rows · single transaction · rollback on error` : ""}
          </span>
          <span className="grow" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !preview || loading} onClick={run}>
            {busy ? "Importing…" : preview ? `Import ${preview.totalRows.toLocaleString("en-US")} rows` : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
