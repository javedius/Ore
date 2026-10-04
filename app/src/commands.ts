import { invoke } from "@tauri-apps/api/core";
import type {
  CsvPreview,
  DbInfo,
  ExportResult,
  FilterArg,
  ImportResult,
  RowsResult,
  Schema,
  SqlResult,
} from "./types";

export const openDb = (path: string) => invoke<DbInfo>("open_db", { path });
export const closeDb = () => invoke<void>("close_db");
export const getSchema = () => invoke<Schema>("get_schema");

export const getRows = (
  object: string,
  offset: number,
  limit: number,
  orderBy: string | null,
  orderDesc: boolean,
  filters: FilterArg[]
) => invoke<RowsResult>("get_rows", { object, offset, limit, orderBy, orderDesc, filters });

export const execSql = (sql: string) => invoke<SqlResult>("exec_sql", { sql });

export const updateCell = (
  table: string,
  rowid: number,
  column: string,
  value: string | null
) => invoke<void>("update_cell", { edit: { table, rowid, column, value } });

export const insertRow = (table: string) => invoke<number>("insert_row", { table });
export const deleteRow = (table: string, rowid: number) =>
  invoke<void>("delete_row", { table, rowid });
export const pathExists = (path: string) => invoke<boolean>("path_exists", { path });
export const stopQuery = () => invoke<void>("stop_query");

export const csvPreview = (path: string, delimiter: string, hasHeader: boolean) =>
  invoke<CsvPreview>("csv_preview", { path, delimiter, hasHeader });

export const importCsv = (args: {
  path: string;
  table: string;
  createTable: boolean;
  delimiter: string;
  hasHeader: boolean;
  mapping: (string | null)[];
}) => invoke<ImportResult>("import_csv", { args });

export const exportObject = (
  object: string,
  path: string,
  format: "csv" | "json",
  filters: FilterArg[]
) => invoke<ExportResult>("export_object", { args: { object, path, format, filters } });

export const saveText = (path: string, content: string) =>
  invoke<void>("save_text", { path, content });
