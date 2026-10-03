use crate::schema::{column_exists, object_exists};
use crate::state::AppDb;
use crate::util::quote_ident;
use serde::Deserialize;
use tauri::State;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellEdit {
    table: String,
    rowid: i64,
    column: String,
    value: Option<String>,
}

#[tauri::command(async)]
pub fn update_cell(edit: CellEdit, db: State<'_, AppDb>) -> Result<(), String> {
    let guard = db.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("No database is open")?;
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

#[tauri::command(async)]
pub fn insert_row(table: String, db: State<'_, AppDb>) -> Result<i64, String> {
    let guard = db.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("No database is open")?;
    if !object_exists(conn, &table) {
        return Err(format!("Unknown table: {}", table));
    }
    let sql = format!("INSERT INTO {} DEFAULT VALUES", quote_ident(&table));
    conn.execute(&sql, []).map_err(crate::util::db_err)?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command(async)]
pub fn delete_row(table: String, rowid: i64, db: State<'_, AppDb>) -> Result<(), String> {
    let guard = db.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("No database is open")?;
    if !object_exists(conn, &table) {
        return Err(format!("Unknown table: {}", table));
    }
    let sql = format!("DELETE FROM {} WHERE rowid = ?1", quote_ident(&table));
    conn.execute(&sql, [rowid]).map_err(crate::util::db_err)?;
    Ok(())
}
