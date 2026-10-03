//! Ore — кроссплатформенный редактор SQLite.
//!
//! Модули по зонам ответственности:
//! - `util`   — мелкие хелперы (кавычки идентификаторов, конвертация значений)
//! - `state`  — открытое соединение с БД (Tauri-managed состояние)
//! - `schema` — типы схемы, интроспекция, open/close/get_schema
//! - `rows`   — чтение данных: фильтры, пагинация, exec_sql
//! - `edit`   — правка данных: update/insert/delete по rowid
//! - `csv_io` — импорт/экспорт CSV и JSON
//! - `files`  — простые файловые команды

mod csv_io;
mod edit;
mod files;
mod rows;
mod schema;
mod state;
mod util;

use state::AppDb;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppDb::default())
        .invoke_handler(tauri::generate_handler![
            schema::open_db,
            schema::close_db,
            schema::get_schema,
            rows::get_rows,
            rows::exec_sql,
            edit::update_cell,
            edit::insert_row,
            edit::delete_row,
            files::path_exists,
            csv_io::csv_preview,
            csv_io::import_csv,
            csv_io::export_object,
            files::save_text
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
