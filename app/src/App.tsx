import { useCallback, useState } from "react";
import { getSchema } from "./commands";
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
  const set = (t: "dark" | "light") => {
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem("caliper-theme", t);
    } catch {
      /* noop */
    }
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
        <EmptyState onOpened={onOpened} />
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
                    <SqlView onStatus={setStatus} onSchemaChanged={refreshSchema} />
                  ) : (
                    <GridView
                      name={t.name}
                      kind={t.kind === "view" ? "view" : "table"}
                      hasRowid={schema.tables.find((x) => x.name === t.name)?.hasRowid ?? true}
                      onStatus={setStatus}
                      onSchemaChanged={refreshSchema}
                      onImportClick={() => setImportOpen(true)}
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
