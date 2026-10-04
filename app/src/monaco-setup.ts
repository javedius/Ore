// Lazy Monaco bootstrap: bundles monaco locally (no CDN), wires up the
// web workers and defines the Caliper editor themes. Returns the monaco
// namespace once everything is ready.
import { loader } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";

type MonacoApi = typeof Monaco;

let monacoPromise: Promise<MonacoApi> | null = null;

export function initMonaco(): Promise<MonacoApi> {
  if (!monacoPromise) {
    monacoPromise = (async () => {
      const monaco = await import("monaco-editor");
      self.MonacoEnvironment = {
        getWorker(_workerId: string, label: string) {
          const src =
            label === "sql"
              ? new URL("monaco-editor/esm/vs/language/sql/sql.worker.js", import.meta.url)
              : new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url);
          return new Worker(src, { type: "module" });
        },
      };

      monaco.editor.defineTheme("ore-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "keyword.sql", foreground: "53C7B4" },
          { token: "string.sql", foreground: "D9A85B" },
          { token: "comment.sql", foreground: "7C8986", fontStyle: "italic" },
          { token: "number.sql", foreground: "DDE4E2" },
        ],
        colors: {
          "editor.background": "#101415",
          "editor.foreground": "#DDE4E2",
          "editorLineNumber.foreground": "#7C8986",
          "editor.lineHighlightBackground": "#1F2324",
          "editorCursor.foreground": "#53C7B4",
          "editor.selectionBackground": "#233F3C",
        },
      });
      monaco.editor.defineTheme("ore-light", {
        base: "vs",
        inherit: true,
        rules: [
          { token: "keyword.sql", foreground: "0C6D60" },
          { token: "string.sql", foreground: "8F6415" },
          { token: "comment.sql", foreground: "6A7874", fontStyle: "italic" },
          { token: "number.sql", foreground: "1C2624" },
        ],
        colors: {
          "editor.background": "#F7F9F8",
          "editor.foreground": "#1C2624",
          "editorLineNumber.foreground": "#6A7874",
          "editor.lineHighlightBackground": "#EBEFED",
          "editorCursor.foreground": "#0C6D60",
          "editor.selectionBackground": "#D1E3E1",
        },
      });

      loader.config({ monaco });
      return monaco;
    })();
  }
  return monacoPromise;
}

const KEYWORDS = [
  "SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET",
  "JOIN", "LEFT JOIN", "INNER JOIN", "ON", "AS", "AND", "OR", "NOT", "NULL", "IS",
  "IN", "LIKE", "BETWEEN", "DISTINCT", "INSERT INTO", "VALUES", "UPDATE", "SET",
  "DELETE FROM", "CREATE TABLE", "CREATE VIEW", "CREATE INDEX", "CREATE TRIGGER",
  "DROP TABLE", "DROP VIEW", "DROP INDEX", "ALTER TABLE", "PRIMARY KEY",
  "FOREIGN KEY", "REFERENCES", "INTEGER", "REAL", "TEXT", "BLOB",
  "COUNT", "SUM", "AVG", "MIN", "MAX", "CASE", "WHEN", "THEN", "ELSE", "END",
];

export interface SchemaForCompletion {
  tables: { name: string; columns: { name: string; ctype: string }[] }[];
}

/// Register schema-aware completion once per Monaco instance. The provider
/// reads live schema data through the getter, so refreshes are picked up.
export function registerSqlCompletions(
  monaco: MonacoApi,
  getSchema: () => SchemaForCompletion,
): void {
  monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: [".", " "],
    provideCompletionItems(model: Monaco.editor.ITextModel, position: Monaco.Position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const { tables } = getSchema();
      const suggestions: Monaco.languages.CompletionItem[] = [
        ...tables.map((t) => ({
          label: t.name,
          kind: monaco.languages.CompletionItemKind.Struct,
          insertText: t.name,
          detail: "table",
          range,
        })),
        ...tables.flatMap((t) =>
          t.columns.map((c) => ({
            label: c.name,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: c.name,
            detail: `${t.name} · ${c.ctype}`,
            range,
          }))
        ),
        ...KEYWORDS.map((k) => ({
          label: k,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: k,
          range,
        })),
      ];
      return { suggestions };
    },
  });
}
