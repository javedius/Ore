use rusqlite::types::ValueRef;
use serde_json::{json, Value};

pub fn db_err(e: rusqlite::Error) -> String {
    e.to_string()
}

/// Идентификатор в двойных кавычках (внутренние кавычки удваиваются).
pub fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

/// Значение SQLite → JSON для фронтенда (BLOB отдаётся размером в байтах).
pub fn value_to_json(v: ValueRef<'_>) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => json!({ "__blob__": b.len() }),
    }
}

/// Значение SQLite → текст для CSV-экспорта (BLOB — hex-литералом x'...').
pub fn cell_to_text(v: ValueRef<'_>) -> String {
    match v {
        ValueRef::Null => String::new(),
        ValueRef::Integer(i) => i.to_string(),
        ValueRef::Real(f) => f.to_string(),
        ValueRef::Text(t) => String::from_utf8_lossy(t).into_owned(),
        ValueRef::Blob(b) => format!(
            "x'{}'",
            b.iter().map(|b| format!("{:02x}", b)).collect::<String>()
        ),
    }
}
