use crate::rows::build_filters;
use crate::schema::{column_exists, object_exists, pragma_columns};
use crate::state::{DbThread, ExportArgs, ImportArgs};
use crate::util::{cell_to_text, db_err, quote_ident, value_to_json};
use rusqlite::{params_from_iter, Connection};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use tauri::State;
use tokio::sync::oneshot;

// --- CSV reading ---

fn csv_reader(
    path: &str,
    delimiter: u8,
) -> Result<csv::Reader<std::io::BufReader<std::fs::File>>, String> {
    let file = fs::File::open(path).map_err(|e| format!("Cannot open file: {}", e))?;
    Ok(csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .has_headers(false)
        .flexible(true)
        .from_reader(std::io::BufReader::new(file)))
}

fn read_records(path: &str, delimiter: u8) -> Result<Vec<Vec<String>>, String> {
    let mut rdr = csv_reader(path, delimiter)?;
    let mut out = Vec::new();
    for rec in rdr.records() {
        let rec = rec.map_err(|e| format!("CSV parse error (is the file UTF-8?): {}", e))?;
        out.push(rec.iter().map(|s| s.to_string()).collect());
    }
    if out.is_empty() {
        return Err("File is empty".into());
    }
    Ok(out)
}

// --- Preview ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvPreview {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub total_rows: i64,
    pub size_bytes: u64,
}

#[tauri::command(async)]
pub fn csv_preview(path: String, delimiter: String, has_header: bool) -> Result<CsvPreview, String> {
    let d = delimiter.bytes().next().unwrap_or(b',');
    let records = read_records(&path, d)?;
    let size_bytes = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

    let headers: Vec<String> = match has_header {
        true => records[0].clone(),
        false => (0..records[0].len()).map(|i| format!("col{}", i)).collect(),
    };
    let data_rows: Vec<Vec<String>> = records
        .iter()
        .enumerate()
        .skip(if has_header { 1 } else { 0 })
        .take(5)
        .map(|(_, r)| r.clone())
        .collect();
    let total_rows = records.len() as i64 - if has_header { 1 } else { 0 };

    Ok(CsvPreview {
        headers,
        rows: data_rows,
        total_rows,
        size_bytes,
    })
}

// --- Import ---

/// Infer a column type from its values: INTEGER -> REAL -> TEXT.
fn infer_type(records: &[Vec<String>], col: usize, has_header: bool) -> &'static str {
    let mut all_int = true;
    let mut all_real = true;
    let mut any = false;
    for (i, rec) in records.iter().enumerate() {
        if i == 0 && has_header {
            continue;
        }
        let v = rec.get(col).map(|s| s.trim()).unwrap_or("");
        if v.is_empty() {
            continue;
        }
        any = true;
        if v.parse::<i64>().is_err() {
            all_int = false;
        }
        if v.parse::<f64>().is_err() {
            all_real = false;
            all_int = false;
        }
        if !all_real && !all_int {
            return "TEXT";
        }
    }
    if !any {
        "TEXT"
    } else if all_int {
        "INTEGER"
    } else if all_real {
        "REAL"
    } else {
        "TEXT"
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: i64,
}

#[tauri::command(async)]
pub(crate) fn import_csv_impl(conn: &Connection, args: &ImportArgs) -> Result<ImportResult, String> {
    let d = args.delimiter.bytes().next().unwrap_or(b',');

    if args.table.trim().is_empty() {
        return Err("Table name is empty".into());
    }
    if args.create_table {
        if object_exists(conn, &args.table) {
            return Err(format!("Table \"{}\" already exists", args.table));
        }
    } else if !object_exists(conn, &args.table) {
        return Err(format!("Unknown table: {}", args.table));
    }

    let mapped: Vec<(usize, String)> = args
        .mapping
        .iter()
        .enumerate()
        .filter_map(|(i, m)| m.clone().map(|c| (i, c)))
        .collect();
    if !args.create_table {
        if mapped.is_empty() {
            return Err("No columns mapped".into());
        }
        for (_, c) in &mapped {
            if !column_exists(conn, &args.table, c) {
                return Err(format!("Unknown column: {}", c));
            }
        }
    }

    let records = read_records(&args.path, d)?;

    // New table — created with inferred types; duplicate names get a suffix
    if args.create_table {
        let mut defs = Vec::new();
        let mut used = std::collections::HashSet::new();
        for (src_idx, col_name) in &mapped {
            let mut name = col_name.trim().to_string();
            if name.is_empty() {
                name = format!("col{}", src_idx);
            }
            let base = name.clone();
            let mut k = 2;
            while used.contains(&name) {
                name = format!("{}_{}", base, k);
                k += 1;
            }
            used.insert(name.clone());
            let ty = infer_type(&records, *src_idx, args.has_header);
            defs.push(format!("{} {}", quote_ident(&name), ty));
        }
        let ddl = format!("CREATE TABLE {} ({})", quote_ident(&args.table), defs.join(", "));
        conn.execute_batch(&ddl).map_err(db_err)?;
    }

    let tx = conn.unchecked_transaction().map_err(db_err)?;
    let insert_sql = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        quote_ident(&args.table),
        mapped.iter().map(|(_, c)| quote_ident(c)).collect::<Vec<_>>().join(", "),
        vec!["?"; mapped.len()].join(", ")
    );
    let mut imported = 0i64;
    let start_idx = if args.has_header { 1 } else { 0 };
    {
        let mut stmt = tx.prepare(&insert_sql).map_err(db_err)?;
        for (ri, rec) in records.iter().enumerate().skip(start_idx) {
            let mut vals: Vec<Option<String>> = Vec::with_capacity(mapped.len());
            for (src_idx, _) in &mapped {
                let raw = rec.get(*src_idx).map(|s| s.trim()).unwrap_or("").to_string();
                vals.push(if raw.is_empty() { None } else { Some(raw) });
            }
            stmt.execute(params_from_iter(vals.iter()))
                .map_err(|e| format!("Row {}: {}", ri + 1, e))?;
            imported += 1;
        }
    }
    tx.commit().map_err(db_err)?;
    Ok(ImportResult { imported })
}

// --- Export ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub rows: i64,
}

#[tauri::command(async)]
pub(crate) fn export_object_impl(conn: &Connection, args: &ExportArgs) -> Result<ExportResult, String> {
    if !object_exists(conn, &args.object) {
        return Err(format!("Unknown object: {}", args.object));
    }
    let (where_sql, vals) = build_filters(conn, &args.object, args.filters.as_deref().unwrap_or(&[]))?;
    let cols = pragma_columns(conn, &args.object)?;
    let mut stmt = conn
        .prepare(&format!("SELECT * FROM {}{}", quote_ident(&args.object), where_sql))
        .map_err(db_err)?;
    let mut rows = stmt.query(params_from_iter(vals.iter())).map_err(db_err)?;
    let mut count = 0i64;

    if args.format == "json" {
        let mut out: Vec<Value> = Vec::new();
        while let Some(row) = rows.next().map_err(db_err)? {
            let mut m = serde_json::Map::new();
            for (i, c) in cols.iter().enumerate() {
                m.insert(c.name.clone(), value_to_json(row.get_ref(i).map_err(db_err)?));
            }
            out.push(Value::Object(m));
            count += 1;
        }
        fs::write(&args.path, serde_json::to_string(&out).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    } else {
        let file = fs::File::create(&args.path).map_err(|e| format!("Cannot create file: {}", e))?;
        let mut wtr = csv::WriterBuilder::new().from_writer(file);
        wtr.write_record(cols.iter().map(|c| c.name.clone()))
            .map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(db_err)? {
            let mut rec = Vec::with_capacity(cols.len());
            for i in 0..cols.len() {
                rec.push(cell_to_text(row.get_ref(i).map_err(db_err)?));
            }
            wtr.write_record(&rec).map_err(|e| e.to_string())?;
            count += 1;
        }
        wtr.flush().map_err(|e| e.to_string())?;
    }
    Ok(ExportResult { rows: count })
}

// --- Thin commands: forward to the DB thread and await the reply ---

#[tauri::command(async)]
pub async fn import_csv(
    args: ImportArgs,
    db: State<'_, DbThread>,
) -> Result<ImportResult, String> {
    let (tx, rx) = oneshot::channel();
    db.call(crate::state::DbRequest::ImportCsv { args, reply: tx }, rx)
        .await
        .map(|imported| ImportResult { imported })
}

#[tauri::command(async)]
pub async fn export_object(
    args: ExportArgs,
    db: State<'_, DbThread>,
) -> Result<ExportResult, String> {
    let (tx, rx) = oneshot::channel();
    db.call(crate::state::DbRequest::ExportObject { args, reply: tx }, rx)
        .await
        .map(|rows| ExportResult { rows })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infer_type_over_csv_columns() {
        let records = vec![
            vec!["id".into(), "name".into(), "total".into()],
            vec!["1".into(), "Ada".into(), "12.5".into()],
            vec!["2".into(), "".into(), "7".into()],
        ];
        assert_eq!(infer_type(&records, 0, true), "INTEGER");
        assert_eq!(infer_type(&records, 1, true), "TEXT");
        assert_eq!(infer_type(&records, 2, true), "REAL");
    }
}
