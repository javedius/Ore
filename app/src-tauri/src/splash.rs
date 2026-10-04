use tauri::Manager;

/// Закрыть сплэш-окно и показать главное (вызывается фронтендом после монтирования).
#[tauri::command(async)]
pub fn close_splashscreen(app: tauri::AppHandle) {
    if let Some(splash) = app.get_webview_window("splashscreen") {
        let _ = splash.close();
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
    }
}
