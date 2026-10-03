use std::fs;
use std::path::Path;

/// Check file existence (recent files in the empty state).
#[tauri::command(async)]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Save arbitrary text (the SQL result export is composed by the frontend).
#[tauri::command(async)]
pub fn save_text(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}
