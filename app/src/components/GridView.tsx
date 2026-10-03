import { useCallback, useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { deleteRow, exportObject, getRows, insertRow, updateCell } from "../commands";
import type { Cell, FilterArg, RowsResult, StatusInfo } from "../types";
import { Icon } from "./Icons";
import { CellView, cellClass, cellText, isBlob } from "./cell";

const LIMIT = 50;

interface Props {
  name: string;
  kind: "table" | "view";
  hasRowid: boolean;
  onStatus: (s: StatusInfo) => void;
  onSchemaChanged: () => void;
  onImportClick: () => void;
}

interface MenuState {
  x: number;
  y: number;
  rowIdx: number;
  colIdx: number;
}

interface EditState {
  rowIdx: number;
  colIdx: number;
  value: string;
  wasNull: boolean;
}

function placeholderFor(ctype: string): string {
  if (ctype === "INTEGER" || ctype === "REAL") return "= / > / <";
  if (ctype === "BLOB") return "—";
  return "contains";
}

export default function GridView({ name, kind, hasRowid, onStatus, onSchemaChanged, onImportClick }: Props) {
  const [data, setData] = useState<RowsResult | null>(null);
  const [page, setPage] = useState(0);
  const [orderBy, setOrderBy] = useState<string | null>(null);
  const [orderDesc, setOrderDesc] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [applied, setApplied] = useState<FilterArg[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const editable = kind === "table" && hasRowid;

  const reload = useCallback(() => {
    getRows(name, page * LIMIT, LIMIT, orderBy, orderDesc, applied)
      .then((r) => {
        setData(r);
        setError(null);
        const orderSql = orderBy ? ` ORDER BY "${orderBy}"${orderDesc ? " DESC" : ""}` : "";
        const whereSql = applied.length
          ? ` WHERE ${applied.map((f) => `"${f.column}" ~ '${f.value}'`).join(" AND ")}`
          : "";
        onStatus({
          echo: `SELECT * FROM "${name}"${whereSql}${orderSql} LIMIT ${LIMIT} OFFSET ${page * LIMIT}`,
          note: kind === "view" ? "view · read-only" : !hasRowid ? "WITHOUT ROWID · read-only" : undefined,
        });
      })
      .catch((e) => setError(String(e)));
  }, [name, page, orderBy, orderDesc, applied, kind, hasRowid, onStatus]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Reset local state when switching objects
  useEffect(() => {
    setEditing(null);
    setSelected(null);
    setPage(0);
    setOrderBy(null);
    setDrafts({});
    setApplied([]);
  }, [name]);

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  const toggleSort = (col: string) => {
    if (orderBy === col) {
      if (orderDesc) {
        setOrderBy(null);
        setOrderDesc(false);
      } else {
        setOrderDesc(true);
      }
    } else {
      setOrderBy(col);
      setOrderDesc(false);
    }
    setPage(0);
  };

  const applyFilters = () => {
    const list: FilterArg[] = Object.entries(drafts)
      .filter(([, v]) => v.trim() !== "")
      .map(([column, value]) => ({ column, value: value.trim() }));
    setApplied(list);
    setPage(0);
  };

  const clearFilter = (col: string) => {
    setDrafts((d) => {
      const n = { ...d };
      delete n[col];
      return n;
    });
    setApplied((a) => a.filter((f) => f.column !== col));
    setPage(0);
  };

  const startEdit = (rowIdx: number, colIdx: number) => {
    if (!data || !editable) return;
    const v = data.rows[rowIdx]?.[colIdx];
    if (v === undefined || isBlob(v)) return;
    setEditing({ rowIdx, colIdx, value: v === null ? "" : String(v), wasNull: v === null });
  };

  const saveEdit = async () => {
    if (!editing || !data) return;
    const rowid = data.rowids[editing.rowIdx];
    const col = data.columns[editing.colIdx]?.name;
    setEditing(null);
    if (rowid == null || !col) return;
    // Empty input saves NULL only if the cell was NULL; otherwise an empty string
    const value = editing.value === "" && editing.wasNull ? null : editing.value;
    try {
      await updateCell(name, rowid, col, value);
      reload();
    } catch (e) {
      setError(String(e));
    }
  };

  const addRow = async () => {
    try {
      await insertRow(name);
      onSchemaChanged();
      setPage(Math.max(0, Math.ceil((total + 1) / LIMIT) - 1));
    } catch (e) {
      setError(`Cannot add row — the table may have NOT NULL columns without defaults.\n${e}`);
    }
  };

  const removeRow = async (rowIdx: number) => {
    if (!data) return;
    const rowid = data.rowids[rowIdx];
    if (rowid == null) return;
    if (!window.confirm(`Delete row (rowid ${rowid}) from "${name}"?`)) return;
    try {
      await deleteRow(name, rowid);
      onSchemaChanged();
      reload();
    } catch (e) {
      setError(String(e));
    }
  };

  const doExport = async (format: "csv" | "json") => {
    setExportOpen(false);
    try {
      const path = await save({
        defaultPath: `${name}.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (!path) return;
      const r = await exportObject(name, path, format, applied);
      onStatus({ echo: `EXPORT "${name}" → ${path}`, note: `${r.rows} rows exported` });
    } catch (e) {
      setError(String(e));
    }
  };

  const rowObj = (rowIdx: number): Record<string, Cell> => {
    const obj: Record<string, Cell> = {};
    data?.columns.forEach((c, i) => {
      obj[c.name] = data.rows[rowIdx]?.[i] ?? null;
    });
    return obj;
  };

  const copyJson = (rowIdx: number) => {
    navigator.clipboard.writeText(JSON.stringify(rowObj(rowIdx), null, 2));
    setMenu(null);
  };

  const copyCsv = (rowIdx: number) => {
    if (!data) return;
    const vals = data.rows[rowIdx].map((v) => {
      const s = cellText(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    });
    navigator.clipboard.writeText(vals.join(","));
    setMenu(null);
  };

  const setNull = async (rowIdx: number, colIdx: number) => {
    setMenu(null);
    if (!data) return;
    const rowid = data.rowids[rowIdx];
    const col = data.columns[colIdx]?.name;
    if (rowid == null || !col) return;
    try {
      await updateCell(name, rowid, col, null);
      reload();
    } catch (e) {
      setError(String(e));
    }
  };

  const openMenu = (e: React.MouseEvent, rowIdx: number, colIdx: number) => {
    e.preventDefault();
    const rect = wrapRef.current?.getBoundingClientRect();
    const x = rect ? Math.min(e.clientX - rect.left, rect.width - 240) : e.clientX;
    const y = rect ? Math.min(e.clientY - rect.top, rect.height - 260) : e.clientY;
    setSelected(rowIdx);
    setMenu({ x: Math.max(4, x), y: Math.max(4, y), rowIdx, colIdx });
  };

  const menuCell = menu ? data?.rows[menu.rowIdx]?.[menu.colIdx] ?? null : null;

  return (
    <>
      <div className="toolbar">
        <span className="pgmeta" style={{ padding: "0 4px" }}>
          {applied.length > 0
            ? `${applied.length} filter${applied.length > 1 ? "s" : ""} applied`
            : editable
              ? "double-click a cell to edit"
              : "read-only"}
        </span>
        <div className="grow" />
        <div className="toolbar-actions">
          {editable && (
            <button className="btn" onClick={addRow} title="Insert row with default values">
              <Icon name="i-plus" />
              Row
            </button>
          )}
          <button className="btn" onClick={onImportClick} title="Import CSV into this database">
            <Icon name="i-upload" />
            Import
          </button>
          <div style={{ position: "relative" }}>
            <button className="btn" onClick={() => setExportOpen(!exportOpen)} title="Export this table (respects filters)">
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
          <button className="icon-btn" title="Refresh" onClick={reload}>
            <Icon name="i-refresh" />
          </button>
        </div>
      </div>

      {error && (
        <div className="alert-line" style={{ margin: "8px 10px", borderRadius: 0 }}>
          <Icon name="i-alert" />
          <span className="truncate mono" style={{ whiteSpace: "pre-wrap" }}>{error}</span>
          <span className="grow" />
          <button className="btn btn-ghost" style={{ height: 20 }} onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="grid-wrap" ref={wrapRef} onClick={() => { setMenu(null); setExportOpen(false); }}>
        {data && (
          <table className="grid">
            <colgroup>
              <col style={{ width: 46 }} />
              {data.columns.map((c) => (
                <col key={c.name} style={{ width: c.ctype === "INTEGER" && c.name === "id" ? 70 : 180 }} />
              ))}
            </colgroup>
            <thead>
              <tr className="head-row">
                <th className="gutter">#</th>
                {data.columns.map((c) => (
                  <th key={c.name} className={orderBy === c.name ? "th-sorted" : ""} onClick={() => toggleSort(c.name)}>
                    <div className="th-in">
                      <span className="th-name">{c.name}</span>
                      {orderBy === c.name && (
                        <Icon name={orderDesc ? "i-sort-d" : "i-sort-u"} className="icon icon-sm" />
                      )}
                      <span className="th-type">{c.ctype}</span>
                    </div>
                  </th>
                ))}
              </tr>
              <tr className="filter-row">
                <th className="gutter" title="Filter by column — Enter applies, Esc clears">
                  <Icon name="i-filter" className="icon icon-sm" />
                </th>
                {data.columns.map((c) => (
                  <th key={c.name}>
                    <input
                      className={"finput" + (drafts[c.name] ? " has-value" : "")}
                      placeholder={placeholderFor(c.ctype)}
                      disabled={c.ctype === "BLOB"}
                      title={`Filter by ${c.name} — Enter applies, Esc clears`}
                      value={drafts[c.name] ?? ""}
                      onChange={(e) => setDrafts({ ...drafts, [c.name]: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") applyFilters();
                        if (e.key === "Escape") clearFilter(c.name);
                      }}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, ri) => (
                <tr
                  key={ri}
                  className={
                    (selected === ri ? "selected " : "") + (editing?.rowIdx === ri ? "editing-row" : "")
                  }
                  onClick={() => setSelected(ri)}
                >
                  <td className="gutter">{ri + 1 + page * LIMIT}</td>
                  {row.map((v, ci) =>
                    editing?.rowIdx === ri && editing.colIdx === ci ? (
                      <td key={ci} className="cell-editing">
                        <input
                          className="cell-input"
                          value={editing.value}
                          autoFocus
                          spellCheck={false}
                          aria-label={`Edit ${name}.${data.columns[ci]?.name}`}
                          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                          onBlur={saveEdit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEdit();
                            if (e.key === "Escape") setEditing(null);
                          }}
                        />
                      </td>
                    ) : (
                      <td
                        key={ci}
                        className={cellClass(v)}
                        onDoubleClick={() => startEdit(ri, ci)}
                        onContextMenu={(e) => openMenu(e, ri, ci)}
                        title={cellText(v)}
                      >
                        <CellView v={v} />
                      </td>
                    )
                  )}
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td className="gutter">–</td>
                  <td colSpan={Math.max(1, data.columns.length)} style={{ color: "var(--text-3)" }}>
                    {applied.length > 0 ? "No rows match the filters" : `No rows in this ${kind}`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        {!data && !error && <div className="empty-main">Loading…</div>}

        {menu && data && (
          <div className="menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
            <button
              className="menu-item"
              onClick={() => {
                navigator.clipboard.writeText(cellText(menuCell ?? null));
                setMenu(null);
              }}
            >
              <Icon name="i-copy" />
              Copy Cell
              <span className="kbd">⌘C</span>
            </button>
            <button className="menu-item" onClick={() => copyJson(menu.rowIdx)}>
              <Icon name="i-braces" />
              Copy as JSON
              <span className="kbd">⇧⌘C</span>
            </button>
            <button className="menu-item" onClick={() => copyCsv(menu.rowIdx)}>
              <Icon name="i-grid" />
              Copy as CSV
              <span className="kbd">⌥⌘C</span>
            </button>
            <div className="menu-sep" />
            <button
              className={"menu-item" + (editable ? "" : " disabled")}
              onClick={() => setNull(menu.rowIdx, menu.colIdx)}
            >
              <Icon name="i-null" />
              Set NULL
              <span className="kbd">⌥⌫</span>
            </button>
            <button
              className={"menu-item" + (editable ? "" : " disabled")}
              onClick={() => {
                const rowIdx = menu.rowIdx;
                setMenu(null);
                startEdit(rowIdx, menu.colIdx);
              }}
            >
              <Icon name="i-pencil" />
              Edit Cell
              <span className="kbd">⌘E</span>
            </button>
            <button
              className={"menu-item" + (editable ? "" : " disabled")}
              onClick={() => {
                const rowIdx = menu.rowIdx;
                setMenu(null);
                void removeRow(rowIdx);
              }}
            >
              <Icon name="i-x" />
              Delete Row
            </button>
          </div>
        )}
      </div>

      <div className="pager">
        <span>{total.toLocaleString("en-US")} rows</span>
        <span className="pgmeta">
          showing {total === 0 ? 0 : page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)}
        </span>
        <div className="grow" />
        <div className="pager-group">
          <button className="icon-btn" title="First page" disabled={page === 0} onClick={() => setPage(0)}>
            <Icon name="i-chevs-l" />
          </button>
          <button className="icon-btn" title="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)}>
            <Icon name="i-chev-l" />
          </button>
          <input
            className="page-in"
            aria-label="Page"
            value={page + 1}
            onChange={(e) => {
              const p = parseInt(e.target.value, 10);
              if (!Number.isNaN(p)) setPage(Math.min(pages, Math.max(1, p)) - 1);
            }}
          />
          <span className="pgmeta">/ {pages.toLocaleString("en-US")}</span>
          <button className="icon-btn" title="Next page" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            <Icon name="i-chev-r" />
          </button>
          <button className="icon-btn" title="Last page" disabled={page >= pages - 1} onClick={() => setPage(pages - 1)}>
            <Icon name="i-chevs-r" />
          </button>
        </div>
        <div className="grow" />
        <span className="pgmeta">{LIMIT} rows / page</span>
      </div>
    </>
  );
}
