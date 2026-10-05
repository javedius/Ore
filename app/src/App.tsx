import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { closeDb, getSchema, openDb } from "./commands";
import { addRecent } from "./recents";
import { toggleTheme } from "./theme";
import type { DbInfo, Schema, StatusInfo, Tab } from "./types";
import { Icon, IconSprite } from "./components/Icons";
import { fmtSize } from "./components/cell";
import EmptyState from "./components/EmptyState";
import Sidebar from "./components/Sidebar";
import GridView from "./components/GridView";
import SqlView from "./components/SqlView";
import ImportDialog from "./components/ImportDialog";

function ThemeToggle() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || "dark");
  // Keep the toggle in sync when the theme is switched from the menu
  useEffect(() => {
    const onTheme = (e: Event) => setTheme((e as CustomEvent<"dark" | "light">).detail);
    window.addEventListener("ore-theme-change", onTheme);
    return () => window.removeEventListener("ore-theme-change", onTheme);
  }, []);
  const set = (t: "dark" | "light") => {
    toggleTheme();
    setTheme(t);
  };
  return (
    <div className="theme-toggle" role="group" aria-label="Theme">
      <button aria-pressed={theme === "dark"} onClick={() => set("dark")}>
        <Icon name="i-moon" className="icon icon-sm" />
        Dark
      </button>
      <button aria-pressed={theme === "light"} onClick={() => set("light")}>
        <Icon name="i-sun" className="icon icon-sm" />
        Light
      </button>
    </div>
  );
}

export default function App() {
  const [db, setDb] = useState<DbInfo | null>(null);
  const [schema, setSchema] = useState<Schema | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusInfo>({});
  const [importOpen, setImportOpen] = useState(false);
  const [editingInfo, setEditingInfo] = useState<{ table: string; column: string } | null>(null);

  // UI готово — закрываем сплэш и показываем главное окно
  useEffect(() => {
    invoke("close_splashscreen").catch(() => {});
  }, []);

  const refreshSchema = useCallback(() => {
    getSchema()
      .then(setSchema)
      .catch(() => {});
  }, []);

  const onOpened = useCallback((info: DbInfo) => {
    setDb(info);
    setSchema(info.schema);
    const sqlTab: Tab = { id: "sql", kind: "sql", name: "SQL Query" };
    setTabs([sqlTab]);
    setActiveId(sqlTab.id);
    setStatus({});
  }, []);

  const openDatabaseDialog = useCallback(async () => {
    try {
      const file = await openFileDialog({
        multiple: false,
        filters: [{ name: "SQLite database", extensions: ["db", "sqlite", "sqlite3", "db3"] }],
      });
      if (typeof file !== "string") return;
      const info = await openDb(file);
      addRecent(file, info.name);
      onOpened(info);
    } catch (e) {
      setStatus({ note: String(e) });
    }
  }, [onOpened]);

  const closeDatabase = useCallback(async () => {
    try {
      await closeDb();
    } catch {
      /* noop */
    }
    setDb(null);
    setSchema(null);
    setTabs([]);
    setActiveId(null);
    setStatus({});
    setEditingInfo(null);
  }, []);

  // Native menu events (File / View menus are built on the Rust side)
  useEffect(() => {
    const unlisteners = [
      listen("menu-open-db", () => void openDatabaseDialog()),
      listen("menu-close-db", () => void closeDatabase()),
      listen("menu-refresh", () => refreshSchema()),
      listen("menu-import", () => setImportOpen(true)),
      listen("menu-theme", () => toggleTheme()),
    ];
    return () => {
      unlisteners.forEach((p) => void p.then((u) => u()));
    };
  }, [openDatabaseDialog, closeDatabase, refreshSchema]);

  const openObject = useCallback(
    (name: string, kind: "table" | "view") => {
      const id = `${kind}:${name}`;
      setTabs((prev) => {
        if (prev.some((t) => t.id === id)) return prev;
        return [...prev, { id, kind, name }];
      });
      setActiveId(id);
    },
    []
  );

  const openSql = useCallback(() => {
    setActiveId("sql");
    setTabs((prev) =>
      prev.some((t) => t.id === "sql") ? prev : [...prev, { id: "sql", kind: "sql", name: "SQL Query" }]
    );
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      setActiveId((cur) => {
        if (cur !== id) return cur;
        const idx = prev.findIndex((t) => t.id === id);
        return next[Math.min(idx, next.length - 1)]?.id ?? null;
      });
      return next;
    });
  }, []);

  if (!db || !schema) {
    return (
      <>
        <IconSprite />
        <EmptyState onOpened={onOpened} onOpenClick={() => void openDatabaseDialog()} />
      </>
    );
  }

  const active = tabs.find((t) => t.id === activeId) ?? null;

  return (
    <>
      <IconSprite />
      <div className="app">
        <div className="app-body">
          <Sidebar
            db={db}
            schema={schema}
            activeName={active && active.kind !== "sql" ? active.name : null}
            onOpen={openObject}
            onRefresh={refreshSchema}
            onCloseDatabase={() => void closeDatabase()}
          />
          <main className="main">
            <div className="tabbar">
              {tabs.map((t) => (
                <div
                  key={t.id}
                  className={"tab" + (t.id === activeId ? " active" : "")}
                  onClick={() => setActiveId(t.id)}
                >
                  {t.name}
                  {editingInfo && editingInfo.table === t.name && (
                    <span className="dot" title="Unsaved edit" />
                  )}
                  <button
                    className="tclose"
                    title="Close tab"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(t.id);
                    }}
                  >
                    <Icon name="i-x" className="icon icon-sm" />
                  </button>
                </div>
              ))}
              <button className="icon-btn" style={{ alignSelf: "center" }} title="SQL query" onClick={openSql}>
                <Icon name="i-plus" />
              </button>
              <div className="tabbar-actions" />
            </div>

            {db.readOnly && (
              <div
                className="alert-line"
                style={{ background: "var(--warn-dim)", borderColor: "var(--warn)", borderRadius: 0, borderLeft: 0, borderRight: 0 }}
              >
                <span style={{ color: "var(--warn)" }}>
                  <Icon name="i-alert" />
                </span>
                <span>
                  Read-only mode — the file is locked by another program or sits on read-only media.
                  Browsing works; editing is disabled.
                </span>
              </div>
            )}

            {active === null ? (
              <div className="empty-main">Select a table in the sidebar or open the SQL editor</div>
            ) : (
              tabs.map((t) => (
                <div
                  key={t.id}
                  className="tab-panel"
                  style={{ display: t.id === activeId ? "flex" : "none" }}
                >
                  {t.kind === "sql" ? (
                    <SqlView schema={schema} onStatus={setStatus} onSchemaChanged={refreshSchema} />
                  ) : (
                    <GridView
                      name={t.name}
                      kind={t.kind === "view" ? "view" : "table"}
                      hasRowid={schema.tables.find((x) => x.name === t.name)?.hasRowid ?? true}
                      fileReadOnly={db.readOnly}
                      onStatus={setStatus}
                      onSchemaChanged={refreshSchema}
                      onImportClick={() => setImportOpen(true)}
                      onEditState={setEditingInfo}
                    />
                  )}
                </div>
              ))
            )}

            <footer className="statusbar">
              <span className="sb-seg">
                <b style={{ color: "var(--text-2)", fontWeight: 500 }}>
                  {active ? (active.kind === "sql" ? "SQL" : active.name) : "—"}
                </b>
              </span>
              <span className="query-echo mono">{status.echo ?? ""}</span>
              {editingInfo && (
                <span className="editing-chip">
                  <Icon name="i-enter" className="icon icon-sm" />
                  Editing {editingInfo.table}.{editingInfo.column} · ⏎ save · Esc cancel
                </span>
              )}
              {status.note && <span className="sb-seg">{status.note}</span>}
              {status.ms !== undefined && <span className="sb-seg">{status.ms} ms</span>}
              <span className="sb-seg">{fmtSize(db.sizeBytes)}</span>
              <span className="sb-seg">{db.journalMode.toUpperCase()}</span>
              <span className="sb-seg" style={{ paddingLeft: 0 }}>
                <ThemeToggle />
              </span>
            </footer>
          </main>
        </div>

        {importOpen && (
          <ImportDialog
            schema={schema}
            dbFileName={db.name}
            onClose={() => setImportOpen(false)}
            onDone={(table, imported) => {
              setImportOpen(false);
              refreshSchema();
              openObject(table, "table");
              setStatus({ echo: `IMPORT → "${table}"`, note: `${imported} rows imported` });
            }}
          />
        )}
      </div>
    </>
  );
}
