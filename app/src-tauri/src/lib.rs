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
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
            use tauri::Emitter;

            let about = PredefinedMenuItem::about(app, Some("Ore"), None)?;
            let quit = MenuItem::with_id(app, "menu-quit", "Quit Ore", true, Some("CmdOrCtrl+Q"))?;
            let app_menu = Submenu::with_items(app, "Ore", true, &[&about, &quit])?;

            let open_item =
                MenuItem::with_id(app, "menu-open-db", "Open Database…", true, Some("CmdOrCtrl+O"))?;
            let close_item =
                MenuItem::with_id(app, "menu-close-db", "Close Database", true, Some("CmdOrCtrl+Shift+W"))?;
            let refresh_item =
                MenuItem::with_id(app, "menu-refresh", "Refresh Schema", true, Some("F5"))?;
            let import_item =
                MenuItem::with_id(app, "menu-import", "Import CSV…", true, Some("CmdOrCtrl+I"))?;
            let sep = PredefinedMenuItem::separator(app)?;
            let file_menu = Submenu::with_items(
                app,
                "File",
                true,
                &[&open_item, &close_item, &sep, &refresh_item, &import_item],
            )?;

            let theme_item =
                MenuItem::with_id(app, "menu-theme", "Toggle Dark/Light", true, Some("CmdOrCtrl+Shift+L"))?;
            let view_menu = Submenu::with_items(app, "View", true, &[&theme_item])?;

            let help_menu = Submenu::with_items(app, "Help", true, &[&about])?;

            let menu = Menu::with_items(app, &[&app_menu, &file_menu, &view_menu, &help_menu])?;
            app.set_menu(menu)?;

            app.on_menu_event(move |app, event| {
                match event.id().as_ref() {
                    "menu-open-db" => {
                        let _ = app.emit("menu-open-db", ());
                    }
                    "menu-close-db" => {
                        let _ = app.emit("menu-close-db", ());
                    }
                    "menu-refresh" => {
                        let _ = app.emit("menu-refresh", ());
                    }
                    "menu-import" => {
                        let _ = app.emit("menu-import", ());
                    }
                    "menu-theme" => {
                        let _ = app.emit("menu-theme", ());
                    }
                    "menu-quit" => app.exit(0),
                    _ => {}
                }
            });

            Ok(())
        })
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
