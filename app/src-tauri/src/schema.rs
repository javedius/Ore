use crate::util::{db_err, quote_ident};
use rusqlite::Connection;
use serde::Serialize;

// --- Types sent to the frontend (camelCase via serde) ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub ctype: String,
    pub pk: bool,
    pub notnull: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub name: String,
    pub kind: String, // "table" | "view"
    pub row_count: i64,
    pub has_rowid: bool,
    pub columns: Vec<ColumnInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedObj {
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Schema {
    pub tables: Vec<TableInfo>,
    pub views: Vec<TableInfo>,
    pub indexes: Vec<NamedObj>,
    pub triggers: Vec<NamedObj>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbInfo {
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
    pub sqlite_version: String,
    pub journal_mode: String,
    pub read_only: bool,
    pub schema: Schema,
}

// --- Introspection ---

pub fn pragma_columns(conn: &Connection, name: &str) -> Result<Vec<ColumnInfo>, String> {
    let qname = quote_ident(name);
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({})", qname))
        .map_err(db_err)?;
    let mut rows = stmt.query([]).map_err(db_err)?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(db_err)? {
        let cname: String = row.get("name").map_err(db_err)?;
        let ctype: String = row.get("type").map_err(db_err)?;
        let notnull: i64 = row.get("notnull").map_err(db_err)?;
        let pk: i64 = row.get("pk").map_err(db_err)?;
        out.push(ColumnInfo {
            name: cname,
            ctype: if ctype.is_empty() { "?" } else { &ctype }.to_string(),
            pk: pk > 0,
            notnull: notnull > 0,
        });
    }
    Ok(out)
}

fn table_info(conn: &Connection, name: &str, kind: &str) -> Result<TableInfo, String> {
    let qname = quote_ident(name);
    let columns = pragma_columns(conn, name)?;

    let row_count: i64 = conn
        .query_row(&format!("SELECT COUNT(*) FROM {}", qname), [], |r| r.get(0))
        .unwrap_or(-1);

    let has_rowid = conn
        .prepare(&format!("SELECT rowid FROM {} LIMIT 1", qname))
        .is_ok();

    Ok(TableInfo {
        name: name.to_string(),
        kind: kind.to_string(),
        row_count,
        has_rowid,
        columns,
    })
}

fn names_of_type(conn: &Connection, ty: &str, exclude_auto: bool) -> Result<Vec<String>, String> {
    let sql = match exclude_auto {
        true => format!(
            "SELECT name FROM sqlite_master WHERE type='{}' AND name NOT LIKE 'sqlite_%' ORDER BY name COLLATE NOCASE",
            ty
        ),
        false => format!(
            "SELECT name FROM sqlite_master WHERE type='{}' AND sql IS NOT NULL ORDER BY name COLLATE NOCASE",
            ty
        ),
    };
    let mut stmt = conn.prepare(&sql).map_err(db_err)?;
    let it = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(db_err)?;
    Ok(it.filter_map(Result::ok).collect())
}

pub fn build_schema(conn: &Connection) -> Result<Schema, String> {
    let mut tables = Vec::new();
    for name in names_of_type(conn, "table", true)? {
        tables.push(table_info(conn, &name, "table")?);
    }
    let mut views = Vec::new();
    for name in names_of_type(conn, "view", true)? {
        views.push(table_info(conn, &name, "view")?);
    }
    let indexes: Vec<NamedObj> = names_of_type(conn, "index", false)?
        .into_iter()
        .map(|name| NamedObj { name })
        .collect();
    let triggers: Vec<NamedObj> = names_of_type(conn, "trigger", true)?
        .into_iter()
        .map(|name| NamedObj { name })
        .collect();
    Ok(Schema {
        tables,
        views,
        indexes,
        triggers,
    })
}

/// Check that the object is a table or view (whitelist against injection).
pub fn object_exists(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE name = ?1 AND type IN ('table','view')",
        [name],
        |_| Ok(()),
    )
    .is_ok()
}

pub fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
    let qtable = quote_ident(table);
    let sql = format!("PRAGMA table_info({})", qtable);
    let Ok(mut stmt) = conn.prepare(&sql) else {
        return false;
    };
    let Ok(mut rows) = stmt.query([]) else {
        return false;
    };
    while let Ok(Some(row)) = rows.next() {
        if let Ok(name) = row.get::<_, String>("name") {
            if name == column {
                return true;
            }
        }
    }
    false
}

// --- DB lifecycle commands (open/close/get_schema) live in state.rs,
// --- where the dedicated DB thread owns the connection.
