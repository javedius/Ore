export interface ColumnInfo {
  name: string;
  ctype: string;
  pk: boolean;
  notnull: boolean;
}

export interface TableInfo {
  name: string;
  kind: "table" | "view";
  rowCount: number;
  hasRowid: boolean;
  columns: ColumnInfo[];
}

export interface NamedObj {
  name: string;
}

export interface Schema {
  tables: TableInfo[];
  views: TableInfo[];
  indexes: NamedObj[];
  triggers: NamedObj[];
}

export interface DbInfo {
  path: string;
  name: string;
  sizeBytes: number;
  sqliteVersion: string;
  journalMode: string;
  schema: Schema;
}

/** Cell value from Rust: NULL | number | string | BLOB (byte size) */
export type Cell = null | number | string | { __blob__: number };

export interface RowsResult {
  columns: ColumnInfo[];
  rows: Cell[][];
  rowids: (number | null)[];
  total: number;
}

export interface SqlResult {
  kind: "query" | "exec";
  columns: string[];
  rows: Cell[][];
  rowsAffected: number;
  elapsedMs: number;
}

export interface HistoryEntry {
  id: number;
  sql: string;
  ts: number;
  ok: boolean;
  meta: string;
}

export interface Tab {
  id: string;
  kind: "table" | "view" | "sql";
  name: string;
}

export interface StatusInfo {
  echo?: string;
  ms?: number;
  note?: string;
}

export interface FilterArg {
  column: string;
  value: string;
}

export interface CsvPreview {
  headers: string[];
  rows: string[][];
  totalRows: number;
  sizeBytes: number;
}

export interface ImportResult {
  imported: number;
}

export interface ExportResult {
  rows: number;
}
