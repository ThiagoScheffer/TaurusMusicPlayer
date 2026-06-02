//! Taurus Music Player - Rust Backend
//! 
//! This module provides the core Tauri application functionality for the music player,
//! including tray icon management, global shortcuts, and window behavior.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri_plugin_log::{Target, TargetKind};

#[derive(Default)]
struct AppState {
    last_click: Mutex<Option<Instant>>,
    is_window_visible: Mutex<bool>,
}

const DOUBLE_CLICK_TIMEOUT_MS: u64 = 500;
const WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "main_tray";
const APP_NAME: &str = "Taurus Codewave";

#[tauri::command]
fn set_tray_tooltip(app: AppHandle, current_track: Option<String>) -> Result<(), String> {
    let tooltip = match current_track {
        Some(track) if !track.trim().is_empty() => format!("{}\nNow Playing: {}", APP_NAME, track.trim()),
        _ => APP_NAME.to_string(),
    };

    let tray = app.tray_by_id(TRAY_ID).ok_or_else(|| "Tray not found".to_string())?;
    tray.set_tooltip(Some(tooltip)).map_err(|e| e.to_string())
}

pub fn run() {
    let state = Arc::new(AppState::default());
    let state_for_setup = state.clone();
    let state_for_window = state.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Debug)
                .targets([Target::new(TargetKind::Stdout)])
                .build(),
        )
        .invoke_handler(tauri::generate_handler![set_tray_tooltip])
        .setup(move |app| {
            let state_clone = state_for_setup.clone();

            if let Err(e) = app.global_shortcut().on_shortcut("Ctrl+Alt+P", move |app, _, _| {
                if let Err(err) = app.emit_to(WINDOW_LABEL, "global-shortcut://play-pause", ()) {
                    log::error!("Failed to emit play/pause shortcut event: {}", err);
                }
            }) {
                log::error!("Failed to register Ctrl+Alt+P global shortcut: {}", e);
                return Err(Box::new(e));
            }
            if let Err(e) = app.global_shortcut().on_shortcut("Ctrl+Alt+N", move |app, _, _| {
                if let Err(err) = app.emit_to(WINDOW_LABEL, "global-shortcut://next-track", ()) {
                    log::error!("Failed to emit next-track shortcut event: {}", err);
                }
            }) {
                log::error!("Failed to register Ctrl+Alt+N global shortcut: {}", e);
                return Err(Box::new(e));
            }
            if let Err(e) = app.global_shortcut().on_shortcut("Ctrl+Alt+B", move |app, _, _| {
                if let Err(err) = app.emit_to(WINDOW_LABEL, "global-shortcut://previous-track", ()) {
                    log::error!("Failed to emit previous-track shortcut event: {}", err);
                }
            }) {
                log::error!("Failed to register Ctrl+Alt+B global shortcut: {}", e);
                return Err(Box::new(e));
            }
            if let Err(e) = app.global_shortcut().on_shortcut("Ctrl+Alt+M", move |app, _, _| {
                if let Err(err) = app.emit_to(WINDOW_LABEL, "global-shortcut://toggle-mute", ()) {
                    log::error!("Failed to emit toggle-mute shortcut event: {}", err);
                }
            }) {
                log::error!("Failed to register Ctrl+Alt+M global shortcut: {}", e);
                return Err(Box::new(e));
            }

            let show_hide_item = MenuItem::with_id(app, "show_hide", "Show / Hide", true, None::<&str>)?;
            let play_pause_item = MenuItem::with_id(app, "play_pause", "Play / Pause", true, None::<&str>)?;
            let next_item = MenuItem::with_id(app, "next_track", "Next Track", true, None::<&str>)?;
            let prev_item = MenuItem::with_id(app, "previous_track", "Previous Track", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

            let menu = Menu::with_items(
                app,
                &[&show_hide_item, &play_pause_item, &next_item, &prev_item, &quit_item],
            )?;

            let show_hide_id = show_hide_item.id().clone();
            let play_pause_id = play_pause_item.id().clone();
            let next_id = next_item.id().clone();
            let prev_id = prev_item.id().clone();
            let quit_id = quit_item.id().clone();

            let mut tray_builder = TrayIconBuilder::with_id(TRAY_ID)
                .menu(&menu)
                .tooltip(APP_NAME)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(move |tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } => {
                        let now = Instant::now();
                        let double_click = {
                            let mut last_click = state_clone.last_click.lock().unwrap();
                            if let Some(last) = *last_click {
                                if now.duration_since(last)
                                    < Duration::from_millis(DOUBLE_CLICK_TIMEOUT_MS)
                                {
                                    *last_click = None;
                                    true
                                } else {
                                    *last_click = Some(now);
                                    false
                                }
                            } else {
                                *last_click = Some(now);
                                false
                            }
                        };

                        if double_click {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
                                match window.is_visible() {
                                    Ok(true) => {
                                        if let Err(e) = window.hide() {
                                            log::error!("Failed to hide window: {}", e);
                                        }
                                    }
                                    Ok(false) => {
                                        if let Err(e) = window.show() {
                                            log::error!("Failed to show window: {}", e);
                                        } else if let Err(e) = window.set_focus() {
                                            log::error!("Failed to focus window: {}", e);
                                        }
                                    }
                                    Err(e) => log::error!("Failed to query window visibility: {}", e),
                                }
                            }
                        }
                    }
                    _ => {}
                })
                .on_menu_event(move |app_handle, event| {
                    if event.id() == &show_hide_id {
                        if let Some(window) = app_handle.get_webview_window(WINDOW_LABEL) {
                            match window.is_visible() {
                                Ok(true) => {
                                    if let Err(e) = window.hide() {
                                        log::error!("Failed to hide window from tray menu: {}", e);
                                    }
                                }
                                Ok(false) => {
                                    if let Err(e) = window.show() {
                                        log::error!("Failed to show window from tray menu: {}", e);
                                    } else if let Err(e) = window.set_focus() {
                                        log::error!("Failed to focus window from tray menu: {}", e);
                                    }
                                }
                                Err(e) => log::error!("Failed to query window visibility: {}", e),
                            }
                        }
                    } else if event.id() == &play_pause_id {
                        if let Err(err) = app_handle.emit_to(WINDOW_LABEL, "global-shortcut://play-pause", ()) {
                            log::error!("Failed to emit tray play/pause event: {}", err);
                        }
                    } else if event.id() == &next_id {
                        if let Err(err) = app_handle.emit_to(WINDOW_LABEL, "global-shortcut://next-track", ()) {
                            log::error!("Failed to emit tray next-track event: {}", err);
                        }
                    } else if event.id() == &prev_id {
                        if let Err(err) = app_handle.emit_to(WINDOW_LABEL, "global-shortcut://previous-track", ()) {
                            log::error!("Failed to emit tray previous-track event: {}", err);
                        }
                    } else if event.id() == &quit_id {
                        app_handle.exit(0);
                    }
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            } else {
                match Image::from_bytes(include_bytes!("../icons/32x32.png")) {
                    Ok(icon) => {
                        tray_builder = tray_builder.icon(icon);
                        log::info!("Using fallback tray icon bytes");
                    }
                    Err(err) => {
                        log::error!("Failed to load fallback tray icon: {}", err);
                    }
                }
            }

            match tray_builder.build(app) {
                Ok(_tray) => log::info!("Tray icon created successfully"),
                Err(e) => {
                    log::error!("Failed to create tray icon: {}", e);
                    return Err(Box::new(e));
                }
            }

            Ok(())
        })
        .on_window_event(move |window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                if let Err(e) = window.hide() {
                    log::error!("Failed to hide window on close: {}", e);
                } else if let Ok(mut visible) = state_for_window.is_window_visible.lock() {
                    *visible = false;
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
