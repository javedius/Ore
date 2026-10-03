use std::fs;
use std::path::Path;

/// Проверка существования файла (недавние файлы в empty state).
#[tauri::command(async)]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Сохранение произвольного текста (экспорт результата SQL-запроса готовит фронтенд).
#[tauri::command(async)]
pub fn save_text(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}
