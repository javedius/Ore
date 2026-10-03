import { useState } from "react";
import type { DbInfo, Schema, TableInfo } from "../types";
import { Icon } from "./Icons";

interface Props {
  db: DbInfo;
  schema: Schema;
  activeName: string | null;
  onOpen: (name: string, kind: "table" | "view") => void;
  onRefresh: () => void;
}

function RowCount({ n }: { n: number }) {
  return <span className="tmeta">{n >= 0 ? n.toLocaleString("en-US") : "…"}</span>;
}

export default function Sidebar({ db, schema, activeName, onOpen, onRefresh }: Props) {
  const [filter, setFilter] = useState("");
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const f = filter.trim().toLowerCase();
  const match = (n: string) => !f || n.toLowerCase().includes(f);

  const toggleTable = (n: string) =>
    setExpandedTables((prev) => {
      const s = new Set(prev);
      if (s.has(n)) s.delete(n);
      else s.add(n);
      return s;
    });

  const toggleSection = (n: string) =>
    setCollapsed((prev) => {
      const s = new Set(prev);
      if (s.has(n)) s.delete(n);
      else s.add(n);
      return s;
    });

  const sectionHead = (key: string, icon: string, label: string, count: number) => (
    <button className="tree-section-head" onClick={() => toggleSection(key)}>
      <Icon name={collapsed.has(key) ? "i-chev-r" : "i-chev-d"} className="icon icon-sm" />
      <Icon name={icon} />
      {label}
      <span className="cnt">{count}</span>
    </button>
  );

  const tableItems = (items: TableInfo[], kind: "table" | "view") => (
    <>
      {items.map((t) => (
        <div key={t.name}>
          <div
            className={"tree-item" + (activeName === t.name ? " active" : "")}
            onClick={() => {
              toggleTable(t.name);
              onOpen(t.name, kind);
            }}
          >
            <Icon name={expandedTables.has(t.name) ? "i-chev-d" : "i-chev-r"} className="icon icon-sm" />
            <Icon name={kind === "table" ? "i-table" : "i-eye"} />
            <span className="truncate">{t.name}</span>
            <RowCount n={t.rowCount} />
          </div>
          {expandedTables.has(t.name) &&
            t.columns.map((c) => (
              <div key={c.name} className="tree-col">
                {c.pk && <Icon name="i-key" />}
                <span className="truncate">{c.name}</span>
                <span className="ctype">{c.ctype}</span>
                {c.pk && <span className="badge-pk">PK</span>}
              </div>
            ))}
        </div>
      ))}
    </>
  );

  const tables = schema.tables.filter((t) => match(t.name));
  const views = schema.views.filter((v) => match(v.name));

  return (
    <aside className="sidebar">
      <div className="sb-head">
        <Icon name="i-db" />
        <div className="grow">
          <div className="sb-dbname truncate">{db.name}</div>
          <div className="sb-dbmeta">SQLite {db.sqliteVersion} · {db.journalMode.toUpperCase()}</div>
        </div>
        <button className="icon-btn" title="Refresh schema" onClick={onRefresh}>
          <Icon name="i-refresh" />
        </button>
      </div>

      <div className="sb-filter">
        <div className="search">
          <Icon name="i-search" className="icon icon-sm" />
          <input placeholder="Filter schema…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      </div>

      <nav className="tree">
        {sectionHead("tables", "i-table", "Tables", schema.tables.length)}
        {!collapsed.has("tables") && tableItems(tables, "table")}

        {sectionHead("views", "i-eye", "Views", schema.views.length)}
        {!collapsed.has("views") && tableItems(views, "view")}

        {sectionHead("indexes", "i-list", "Indexes", schema.indexes.length)}
        {!collapsed.has("indexes") &&
          schema.indexes.filter((i) => match(i.name)).map((i) => (
            <div key={i.name} className="tree-item">
              <span className="leaf-spacer" />
              <Icon name="i-list" />
              <span className="truncate">{i.name}</span>
            </div>
          ))}

        {sectionHead("triggers", "i-zap", "Triggers", schema.triggers.length)}
        {!collapsed.has("triggers") &&
          schema.triggers.filter((t) => match(t.name)).map((t) => (
            <div key={t.name} className="tree-item">
              <span className="leaf-spacer" />
              <Icon name="i-zap" />
              <span className="truncate">{t.name}</span>
            </div>
          ))}
      </nav>
    </aside>
  );
}
