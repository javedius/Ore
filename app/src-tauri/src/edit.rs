use crate::schema::{column_exists, object_exists};
use crate::state::{CellEdit, DbThread};
use crate::util::quote_ident;
use rusqlite::Connection;
use tauri::State;
use tokio::sync::oneshot;

pub(crate) fn update_cell_impl(conn: &Connection, edit: &CellEdit) -> Result<(), String> {
    if !object_exists(conn, &edit.table) {
        return Err(format!("Unknown table: {}", edit.table));
    }
    if !column_exists(conn, &edit.table, &edit.column) {
        return Err(format!("Unknown column: {}", edit.column));
    }
    let sql = format!(
        "UPDATE {} SET {} = ?1 WHERE rowid = ?2",
        quote_ident(&edit.table),
        quote_ident(&edit.column)
    );
    let n = conn
        .execute(&sql, rusqlite::params![edit.value, edit.rowid])
        .map_err(crate::util::db_err)?;
    if n == 0 {
        return Err("Row not found".into());
    }
    Ok(())
}

pub(crate) fn insert_row_impl(conn: &Connection, table: &str) -> Result<i64, String> {
    if !object_exists(conn, table) {
        return Err(format!("Unknown table: {}", table));
    }
    let sql = format!("INSERT INTO {} DEFAULT VALUES", quote_ident(table));
    conn.execute(&sql, []).map_err(crate::util::db_err)?;
    Ok(conn.last_insert_rowid())
}

pub(crate) fn delete_row_impl(conn: &Connection, table: &str, rowid: i64) -> Result<(), String> {
    if !object_exists(conn, table) {
        return Err(format!("Unknown table: {}", table));
    }
    let sql = format!("DELETE FROM {} WHERE rowid = ?1", quote_ident(table));
    conn.execute(&sql, [rowid]).map_err(crate::util::db_err)?;
    Ok(())
}

// --- Thin commands: forward to the DB thread and await the reply ---

#[tauri::command(async)]
pub async fn update_cell(edit: CellEdit, db: State<'_, DbThread>) -> Result<(), String> {
    let (tx, rx) = oneshot::channel();
    db.call(crate::state::DbRequest::UpdateCell { edit, reply: tx }, rx).await
}

#[tauri::command(async)]
pub async fn insert_row(table: String, db: State<'_, DbThread>) -> Result<i64, String> {
    let (tx, rx) = oneshot::channel();
    db.call(crate::state::DbRequest::InsertRow { table, reply: tx }, rx).await
}

#[tauri::command(async)]
pub async fn delete_row(table: String, rowid: i64, db: State<'_, DbThread>) -> Result<(), String> {
    let (tx, rx) = oneshot::channel();
    db.call(crate::state::DbRequest::DeleteRow { table, rowid, reply: tx }, rx).await
}
