//! Ore — a lightweight cross-platform SQLite editor.
//!
//! Modules by responsibility:
//! - `util`   — small helpers (identifier quoting, value conversion)
//! - `state`  — the open database connection (Tauri-managed state)
//! - `schema` — schema types, introspection, open/close/get_schema
//! - `rows`   — data reading: filters, pagination, exec_sql
//! - `edit`   — data editing: update/insert/delete by rowid
//! - `csv_io` — CSV/JSON import and export
//! - `files`  — simple file commands
//! - `splash` — splashscreen window handling

mod csv_io;
mod edit;
mod files;
mod rows;
mod schema;
mod splash;
mod state;
mod util;

use state::spawn_db_thread;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The SQLite connection lives on a dedicated thread; commands talk to it
    // through the request channel, and Stop interrupts the running statement.
    let db = spawn_db_thread();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(db)
        .invoke_handler(tauri::generate_handler![
            state::open_db,
            state::close_db,
            state::get_schema,
            state::stop_query,
            rows::get_rows,
            rows::exec_sql,
            edit::update_cell,
            edit::insert_row,
            edit::delete_row,
            files::path_exists,
            csv_io::csv_preview,
            csv_io::import_csv,
            csv_io::export_object,
            files::save_text,
            splash::close_splashscreen
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
