use crate::rows::{exec_sql_impl, get_rows_impl, FilterArg, RowsResult, SqlResult};
use crate::schema::{build_schema, DbInfo, Schema};
use crate::util::db_err;
use rusqlite::{Connection, InterruptHandle, OpenFlags};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};
use std::time::Duration;
use tauri::State;
use tokio::sync::{mpsc, oneshot};

type Responder<T> = oneshot::Sender<Result<T, String>>;

// --- Request payloads (deserialized straight from the frontend) ---

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellEdit {
    pub table: String,
    pub rowid: i64,
    pub column: String,
    pub value: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportArgs {
    pub path: String,
    pub table: String,
    pub create_table: bool,
    pub delimiter: String,
    pub has_header: bool,
    /// csv column i -> table column (None — skip)
    pub mapping: Vec<Option<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportArgs {
    pub object: String,
    pub path: String,
    pub format: String, // "csv" | "json"
    pub filters: Option<Vec<FilterArg>>,
}

// --- Requests processed by the dedicated DB thread ---

pub enum DbRequest {
    Open { path: String, reply: Responder<DbInfo> },
    Close { reply: Responder<()> },
    GetSchema { reply: Responder<Schema> },
    GetRows {
        object: String,
        offset: i64,
        limit: i32,
        order_by: Option<String>,
        order_desc: bool,
        filters: Option<Vec<FilterArg>>,
        reply: Responder<RowsResult>,
    },
    ExecSql { sql: String, reply: Responder<SqlResult> },
    UpdateCell { edit: CellEdit, reply: Responder<()> },
    InsertRow { table: String, reply: Responder<i64> },
    DeleteRow { table: String, rowid: i64, reply: Responder<()> },
    ImportCsv { args: ImportArgs, reply: Responder<i64> },
    ExportObject { args: ExportArgs, reply: Responder<i64> },
}

/// Handle to the dedicated DB thread. The connection lives on that thread;
/// the UI side only holds the request channel and the interrupt guard.
#[derive(Clone)]
pub struct DbThread {
    tx: mpsc::Sender<DbRequest>,
    interrupt: Arc<InterruptGuard>,
}

pub struct InterruptGuard {
    handle: Mutex<Option<InterruptHandle>>,
    busy: AtomicBool,
}

impl InterruptGuard {
    fn set(&self, handle: Option<InterruptHandle>) {
        *self.handle.lock().unwrap() = handle;
    }

    fn set_busy(&self, busy: bool) {
        self.busy.store(busy, Ordering::SeqCst);
    }
}

impl DbThread {
    fn send(&self, req: DbRequest) -> Result<(), String> {
        self.tx.try_send(req).map_err(|_| "Database thread is not running".into())
    }

    pub(crate) async fn call<T>(&self, req: DbRequest, reply: oneshot::Receiver<Result<T, String>>) -> Result<T, String> {
        self.send(req)?;
        rx_result(reply).await
    }

    /// Interrupt the running statement, but only while something is actually
    /// executing — a stale Stop press must not cancel the next query.
    fn interrupt_if_busy(&self) {
        if self.interrupt.busy.load(Ordering::SeqCst) {
            if let Some(h) = &*self.interrupt.handle.lock().unwrap() {
                h.interrupt();
            }
        }
    }
}

async fn rx_result<T>(rx: oneshot::Receiver<Result<T, String>>) -> Result<T, String> {
    rx.await.map_err(|_| "Database thread dropped the request".to_string())?
}

/// Spawn the DB thread and return its handle.
pub fn spawn_db_thread() -> DbThread {
    let (tx, mut rx) = mpsc::channel::<DbRequest>(64);
    let interrupt: Arc<InterruptGuard> = Arc::new(InterruptGuard {
        handle: Mutex::new(None),
        busy: AtomicBool::new(false),
    });
    let int = Arc::clone(&interrupt);

    std::thread::Builder::new()
        .name("ore-db".into())
        .spawn(move || {
            let mut conn: Option<Connection> = None;
            // Row counts per object, invalidated on any write through the app.
            let mut counts: HashMap<String, i64> = HashMap::new();
            while let Some(req) = rx.blocking_recv() {
                match req {
                    DbRequest::Open { path, reply } => {
                        match open_connection(&path) {
                            Ok((c, info)) => {
                                int.set(Some(c.get_interrupt_handle()));
                                let _ = conn.insert(c);
                                counts.clear();
                                let _ = reply.send(Ok(info));
                            }
                            Err(e) => {
                                int.set(None);
                                let _ = reply.send(Err(e));
                            }
                        }
                    }
                    DbRequest::Close { reply } => {
                        int.set(None);
                        conn = None;
                        counts.clear();
                        let _ = reply.send(Ok(()));
                    }
                    DbRequest::GetSchema { reply } => {
                        with_conn(&mut conn, reply, |c| build_schema(c));
                    }
                    DbRequest::GetRows { object, offset, limit, order_by, order_desc, filters, reply } => {
                        int.set_busy(true);
                        with_conn(&mut conn, reply, |c| {
                            get_rows_impl(c, &object, offset, limit, order_by.as_deref(), order_desc, filters.as_deref(), &mut counts)
                        });
                        int.set_busy(false);
                    }
                    DbRequest::ExecSql { sql, reply } => {
                        int.set_busy(true);
                        with_conn(&mut conn, reply, |c| exec_sql_impl(c, &sql));
                        int.set_busy(false);
                        counts.clear();
                    }
                    DbRequest::UpdateCell { edit, reply } => {
                        with_conn(&mut conn, reply, |c| crate::edit::update_cell_impl(c, &edit));
                    }
                    DbRequest::InsertRow { table, reply } => {
                        with_conn(&mut conn, reply, |c| crate::edit::insert_row_impl(c, &table));
                        counts.clear();
                    }
                    DbRequest::DeleteRow { table, rowid, reply } => {
                        with_conn(&mut conn, reply, |c| crate::edit::delete_row_impl(c, &table, rowid));
                        counts.clear();
                    }
                    DbRequest::ImportCsv { args, reply } => {
                        int.set_busy(true);
                        with_conn(&mut conn, reply, |c| crate::csv_io::import_csv_impl(c, &args).map(|r| r.imported));
                        int.set_busy(false);
                        counts.clear();
                    }
                    DbRequest::ExportObject { args, reply } => {
                        int.set_busy(true);
                        with_conn(&mut conn, reply, |c| crate::csv_io::export_object_impl(c, &args).map(|r| r.rows));
                        int.set_busy(false);
                    }
                }
            }
        })
        .expect("failed to spawn ore-db thread");

    DbThread { tx, interrupt }
}

fn with_conn<T>(
    conn: &mut Option<Connection>,
    reply: oneshot::Sender<Result<T, String>>,
    f: impl FnOnce(&Connection) -> Result<T, String>,
) {
    let result = match conn.as_ref() {
        Some(c) => f(c),
        None => Err("No database is open".into()),
    };
    let _ = reply.send(result);
}

fn open_connection(path: &str) -> Result<(Connection, DbInfo), String> {
    if !Path::new(path).exists() {
        return Err(format!("File not found: {}", path));
    }
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .map_err(db_err)?;
    conn.busy_timeout(Duration::from_secs(5)).map_err(db_err)?;

    // The first query fails with NOTADB if the file is not a SQLite database
    let fallback_name = Path::new(path).file_name().and_then(|s| s.to_str()).unwrap_or(path).to_string();
    let sqlite_version: String = conn
        .query_row("SELECT sqlite_version()", [], |r| r.get(0))
        .map_err(|_| format!("{} is not a SQLite database", fallback_name))?;
    let journal_mode: String = conn
        .query_row("PRAGMA journal_mode", [], |r| r.get(0))
        .unwrap_or_default();
    let size_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let schema = build_schema(&conn)?;

    Ok((
        conn,
        DbInfo {
            path: path.to_string(),
            name: fallback_name,
            size_bytes,
            sqlite_version,
            journal_mode,
            schema,
        },
    ))
}

// --- Thin commands: forward to the DB thread and await the reply ---

#[tauri::command(async)]
pub async fn open_db(path: String, db: State<'_, DbThread>) -> Result<DbInfo, String> {
    let (tx, rx) = oneshot::channel();
    db.call(DbRequest::Open { path, reply: tx }, rx).await
}

#[tauri::command(async)]
pub async fn close_db(db: State<'_, DbThread>) -> Result<(), String> {
    let (tx, rx) = oneshot::channel();
    db.call(DbRequest::Close { reply: tx }, rx).await
}

#[tauri::command(async)]
pub async fn get_schema(db: State<'_, DbThread>) -> Result<Schema, String> {
    let (tx, rx) = oneshot::channel();
    db.call(DbRequest::GetSchema { reply: tx }, rx).await
}

/// Stop button: interrupt the running statement, if any.
#[tauri::command(async)]
pub async fn stop_query(db: State<'_, DbThread>) -> Result<(), String> {
    db.interrupt_if_busy();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Stop must cancel a running statement and report it as an error.
    #[test]
    fn interrupt_cancels_running_query() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let db = spawn_db_thread();

            let db_file = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/ore-interrupt-test.db");
            let _ = std::fs::remove_file(&db_file);
            // Create a real database file (Open uses no CREATE flag)
            {
                let c = Connection::open(&db_file).unwrap();
                c.execute_batch("CREATE TABLE t(x)").unwrap();
            }
            let (tx, rx) = oneshot::channel();
            db.call(
                DbRequest::Open { path: db_file.to_string_lossy().into_owned(), reply: tx },
                rx,
            )
            .await
            .unwrap();

            let long_query = "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c) \
                              SELECT count(*) FROM c";
            let db2 = db.clone();
            let worker = tokio::spawn(async move {
                let (tx, rx) = oneshot::channel();
                let res = db2
                    .call(DbRequest::ExecSql { sql: long_query.to_string(), reply: tx }, rx)
                    .await;
                let err = res.expect_err("the long query must be interrupted");
                assert!(
                    err.to_lowercase().contains("interrupt"),
                    "unexpected error: {}",
                    err
                );
            });

            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            db.interrupt_if_busy();
            worker.await.unwrap();

            // The connection must stay usable after an interrupt.
            let (tx, rx) = oneshot::channel();
            let n = db
                .call(
                    DbRequest::ExecSql { sql: "SELECT 40+2".into(), reply: tx },
                    rx,
                )
                .await
                .unwrap();
            assert_eq!(n.rows, vec![vec![serde_json::json!(42)]]);

            let (tx, rx) = oneshot::channel();
            db.call(DbRequest::Close { reply: tx }, rx).await.unwrap();
            let _ = std::fs::remove_file(&db_file);
        });
    }

    /// The unfiltered row count is cached and invalidated on writes through
    /// the app; a filtered count is always computed fresh.
    #[test]
    fn row_count_cache_is_invalidated_on_writes() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let db = spawn_db_thread();

            let db_file = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/ore-count-test.db");
            let _ = std::fs::remove_file(&db_file);
            {
                let c = Connection::open(&db_file).unwrap();
                c.execute_batch("CREATE TABLE t(x INTEGER); INSERT INTO t VALUES (1),(2),(3);")
                    .unwrap();
            }
            let (tx, rx) = oneshot::channel();
            db.call(DbRequest::Open { path: db_file.to_string_lossy().into_owned(), reply: tx }, rx)
                .await
                .unwrap();

            async fn total(db: &DbThread, filters: Option<Vec<FilterArg>>) -> i64 {
                let (tx, rx) = oneshot::channel();
                db.call(
                    DbRequest::GetRows {
                        object: "t".into(),
                        offset: 0,
                        limit: 50,
                        order_by: None,
                        order_desc: false,
                        filters,
                        reply: tx,
                    },
                    rx,
                )
                .await
                .unwrap()
                .total
            }

            assert_eq!(total(&db, None).await, 3); // cached
            assert_eq!(total(&db, None).await, 3); // served from cache

            let (tx, rx) = oneshot::channel();
            db.call(DbRequest::InsertRow { table: "t".into(), reply: tx }, rx).await.unwrap();
            assert_eq!(total(&db, None).await, 4); // cache invalidated

            assert_eq!(
                total(&db, Some(vec![FilterArg { column: "x".into(), value: ">2".into() }])).await,
                1
            );
            assert_eq!(
                total(&db, Some(vec![FilterArg { column: "x".into(), value: ">2".into() }])).await,
                1
            );

            let (tx, rx) = oneshot::channel();
            db.call(DbRequest::DeleteRow { table: "t".into(), rowid: 4, reply: tx }, rx).await.unwrap();
            assert_eq!(total(&db, None).await, 3);

            let (tx, rx) = oneshot::channel();
            db.call(DbRequest::ExecSql { sql: "DELETE FROM t".into(), reply: tx }, rx).await.unwrap();
            assert_eq!(total(&db, None).await, 0);

            let (tx, rx) = oneshot::channel();
            db.call(DbRequest::Close { reply: tx }, rx).await.unwrap();
            let _ = std::fs::remove_file(&db_file);
        });
    }
}
