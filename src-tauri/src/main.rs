#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

fn presets_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("presets.json"))
}

fn shown_path(data_dir: Option<&Path>, path: &Path) -> String {
    match data_dir.and_then(|dir| path.strip_prefix(dir).ok()) {
        Some(rest) if cfg!(windows) => format!("%APPDATA%\\{}", rest.display()),
        _ => path.display().to_string(),
    }
}

/// 保存先のパスと、presets.json の中身（まだ無ければ None）を返す。
#[tauri::command]
fn load_presets(app: AppHandle) -> Result<(String, Option<String>), String> {
    let path = presets_path(&app)?;
    let shown = shown_path(app.path().data_dir().ok().as_deref(), &path);
    match fs::read_to_string(&path) {
        Ok(json) => Ok((shown, Some(json))),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok((shown, None)),
        Err(e) => Err(format!("{shown}: {e}")),
    }
}

/// 書きかけで止まっても元のファイルが壊れないよう、一時ファイルに書いてから置き換える。
#[tauri::command]
fn save_presets(app: AppHandle, json: String) -> Result<(), String> {
    let path = presets_path(&app)?;
    let shown = shown_path(app.path().data_dir().ok().as_deref(), &path);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("{shown}: {e}"))?;
    }
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, json).map_err(|e| format!("{shown}: {e}"))?;
    fs::rename(&temp, &path).map_err(|e| format!("{shown}: {e}"))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![load_presets, save_presets])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(windows)]
    fn presets_under_appdata_are_shown_without_the_user_name() {
        let data_dir = Path::new(r"C:\Users\example\AppData\Roaming");
        let path = data_dir.join("dev.tsb.damage-calc").join("presets.json");
        assert_eq!(shown_path(Some(data_dir), &path), r"%APPDATA%\dev.tsb.damage-calc\presets.json");
    }
}
