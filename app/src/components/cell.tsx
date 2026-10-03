import type { Cell } from "../types";

export function blobLabel(n: number): string {
  return n < 1024 ? `BLOB (${n} B)` : `BLOB (${(n / 1024).toFixed(1)} KB)`;
}

export function isBlob(v: Cell): v is { __blob__: number } {
  return v !== null && typeof v === "object" && "__blob__" in v;
}

export function cellText(v: Cell): string {
  if (v === null) return "NULL";
  if (isBlob(v)) return blobLabel(v.__blob__);
  return String(v);
}

export function isDateLike(v: Cell): boolean {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/.test(v);
}

/** Класс td по типу значения (дата/число — моноширинные). */
export function cellClass(v: Cell): string {
  if (v === null || isBlob(v)) return "";
  if (typeof v === "number") return "num";
  if (isDateLike(v)) return "c-date";
  return "";
}

export function CellView({ v }: { v: Cell }) {
  if (v === null) return <span className="cell-null">NULL</span>;
  if (isBlob(v)) return <span className="cell-blob">{blobLabel(v.__blob__)}</span>;
  return <span className="cellv">{String(v)}</span>;
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
