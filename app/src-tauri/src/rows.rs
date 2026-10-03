use crate::schema::{column_exists, object_exists, pragma_columns};
use crate::state::AppDb;
use crate::util::{db_err, quote_ident, value_to_json};
use rusqlite::types::Value as SqlValue;
use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Instant;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowsResult {
    pub columns: Vec<crate::schema::ColumnInfo>,
    pub rows: Vec<Vec<Value>>,
    pub rowids: Vec<Option<i64>>,
    pub total: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlResult {
    pub kind: String, // "query" | "exec"
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    pub rows_affected: i64,
    pub elapsed_ms: u128,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterArg {
    pub column: String,
    pub value: String,
}

fn scalar_value(s: &str) -> SqlValue {
    let t = s.trim();
    if let Ok(i) = t.parse::<i64>() {
        SqlValue::Integer(i)
    } else if let Ok(f) = t.parse::<f64>() {
        SqlValue::Real(f)
    } else {
        SqlValue::Text(t.to_string())
    }
}

/// Префиксные операторы фильтра: `=v`, `>v`, `<v`, иначе — подстрока (LIKE).
/// Колонки не из объекта молча пропускаются (whitelist от инъекций).
pub fn build_filters(
    conn: &Connection,
    object: &str,
    filters: &[FilterArg],
) -> Result<(String, Vec<SqlValue>), String> {
    let mut parts = Vec::new();
    let mut vals = Vec::new();
    for f in filters {
        let t = f.value.trim();
        if t.is_empty() || !column_exists(conn, object, &f.column) {
            continue;
        }
        let (expr, val) = match t.chars().next() {
            Some('=') => (format!("{} = ?", quote_ident(&f.column)), scalar_value(&t[1..])),
            Some('>') => (format!("{} > ?", quote_ident(&f.column)), scalar_value(&t[1..])),
            Some('<') => (format!("{} < ?", quote_ident(&f.column)), scalar_value(&t[1..])),
            _ => (
                format!("{} LIKE ?", quote_ident(&f.column)),
                SqlValue::Text(format!("%{}%", t)),
            ),
        };
        parts.push(expr);
        vals.push(val);
    }
    if parts.is_empty() {
        Ok((String::new(), vals))
    } else {
        Ok((format!(" WHERE {}", parts.join(" AND ")), vals))
    }
}

#[tauri::command(async)]
pub fn get_rows(
    object: String,
    offset: i64,
    limit: i32,
    order_by: Option<String>,
    order_desc: bool,
    filters: Option<Vec<FilterArg>>,
    db: State<'_, AppDb>,
) -> Result<RowsResult, String> {
    let limit = limit.clamp(1, 500) as i64;
    let guard = db.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("No database is open")?;
    if !object_exists(conn, &object) {
        return Err(format!("Unknown object: {}", object));
    }
    let qname = quote_ident(&object);

    let (where_sql, mut qvals) = build_filters(conn, &object, filters.as_deref().unwrap_or(&[]))?;
    qvals.push(SqlValue::Integer(limit));
    qvals.push(SqlValue::Integer(offset as i64));

    let total: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM {}{}", qname, where_sql),
            params_from_iter(qvals.iter()),
            |r| r.get(0),
        )
        .unwrap_or(0);

    let order = match order_by {
        Some(col) if column_exists(conn, &object, &col) => format!(
            " ORDER BY {} {}",
            quote_ident(&col),
            if order_desc { "DESC" } else { "ASC" }
        ),
        _ => String::new(),
    };

    // Основной путь — с rowid (нужен для редактирования); views и WITHOUT ROWID — read-only.
    // Метаданные колонок берём из PRAGMA table_info, они совпадают с SELECT *.
    let pragma_cols = pragma_columns(conn, &object)?;
    let sql_with_rowid = format!(
        "SELECT rowid, * FROM {}{}{} LIMIT ? OFFSET ?",
        qname, where_sql, order
    );
    let (columns, rows, rowids) = match conn.prepare(&sql_with_rowid) {
        Ok(mut stmt) => {
            let mut rows = stmt.query(params_from_iter(qvals.iter())).map_err(db_err)?;
            let mut out_rows = Vec::new();
            let mut out_rowids = Vec::new();
            while let Some(row) = rows.next().map_err(db_err)? {
                out_rowids.push(row.get::<_, Option<i64>>(0).ok().flatten());
                let mut r = Vec::with_capacity(pragma_cols.len());
                for i in 1..=pragma_cols.len() {
                    r.push(value_to_json(row.get_ref(i).map_err(db_err)?));
                }
                out_rows.push(r);
            }
            (pragma_cols, out_rows, out_rowids)
        }
        Err(_) => {
            let sql = format!("SELECT * FROM {}{}{} LIMIT ? OFFSET ?", qname, where_sql, order);
            let mut stmt = conn.prepare(&sql).map_err(db_err)?;
            let mut rows = stmt.query(params_from_iter(qvals.iter())).map_err(db_err)?;
            let mut out_rows = Vec::new();
            while let Some(row) = rows.next().map_err(db_err)? {
                let mut r = Vec::with_capacity(pragma_cols.len());
                for i in 0..pragma_cols.len() {
                    r.push(value_to_json(row.get_ref(i).map_err(db_err)?));
                }
                out_rows.push(r);
            }
            let rowids = vec![None; out_rows.len()];
            (pragma_cols, out_rows, rowids)
        }
    };

    Ok(RowsResult {
        columns,
        rows,
        rowids,
        total,
    })
}

#[tauri::command(async)]
pub fn exec_sql(sql: String, db: State<'_, AppDb>) -> Result<SqlResult, String> {
    let start = Instant::now();
    let guard = db.0.lock().unwrap();
    let conn = guard.as_ref().ok_or("No database is open")?;

    let mut stmt = conn.prepare(&sql).map_err(db_err)?;
    let col_count = stmt.column_count();

    let result = if col_count == 0 {
        let affected = stmt.execute([]).map_err(db_err)?;
        SqlResult {
            kind: "exec".into(),
            columns: Vec::new(),
            rows: Vec::new(),
            rows_affected: affected as i64,
            elapsed_ms: 0,
        }
    } else {
        let columns: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();
        let mut rows = stmt.query([]).map_err(db_err)?;
        let mut out = Vec::new();
        while let Some(row) = rows.next().map_err(db_err)? {
            let mut r = Vec::with_capacity(col_count);
            for i in 0..col_count {
                r.push(value_to_json(row.get_ref(i).map_err(db_err)?));
            }
            out.push(r);
            if out.len() >= 1000 {
                break; // мягкий потолок выборки для UI
            }
        }
        SqlResult {
            kind: "query".into(),
            columns,
            rows: out,
            rows_affected: 0,
            elapsed_ms: 0,
        }
    };

    let elapsed_ms = start.elapsed().as_millis();
    Ok(SqlResult { elapsed_ms, ..result })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_build_where_with_whitelist() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE t (a INTEGER, b TEXT)").unwrap();
        let (sql, vals) = build_filters(
            &conn,
            "t",
            &[
                FilterArg { column: "a".into(), value: ">10".into() },
                FilterArg { column: "b".into(), value: "foo".into() },
                FilterArg { column: "nope".into(), value: "x".into() }, // не из таблицы — отбрасывается
            ],
        )
        .unwrap();
        assert!(sql.contains("\"a\" > ?"), "sql: {}", sql);
        assert!(sql.contains("\"b\" LIKE ?"), "sql: {}", sql);
        assert!(!sql.contains("nope"));
        assert_eq!(vals.len(), 2);
    }

    #[test]
    fn scalar_values_parse_numbers() {
        assert_eq!(scalar_value("42"), SqlValue::Integer(42));
        assert_eq!(scalar_value("1.5"), SqlValue::Real(1.5));
        assert_eq!(scalar_value("abc"), SqlValue::Text("abc".into()));
    }
}
