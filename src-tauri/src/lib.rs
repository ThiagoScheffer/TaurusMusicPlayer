//! Taurus Music Player - Rust Backend
//! 
//! This module provides the core Tauri application functionality for the music player,
//! including tray icon management, global shortcuts, and window behavior.

pub mod playback;

use std::io::{BufRead, BufReader, Read, Write};
use std::process::Child;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri_plugin_log::{Target, TargetKind};

#[derive(Default)]
struct AppState {
    last_click: Mutex<Option<Instant>>,
    is_window_visible: Mutex<bool>,
}

#[derive(Default)]
struct ExternalAudioState {
    controller: Mutex<Option<ExternalAudioController>>,
    next_request_id: AtomicU64,
}

struct ExternalAudioController {
    child: Child,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    ipc_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalAudioSnapshot {
    track_id: String,
    current: Option<f64>,
    duration: Option<f64>,
    is_playing: bool,
    is_paused: bool,
    loading: bool,
    seekable: bool,
    ended: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
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

impl ExternalAudioState {
    fn request_id(&self) -> u64 {
        self.next_request_id.fetch_add(1, Ordering::Relaxed) + 1
    }
}

impl ExternalAudioSnapshot {
    fn loading(track_id: String) -> Self {
        Self {
            track_id,
            current: Some(0.0),
            duration: None,
            is_playing: false,
            is_paused: false,
            loading: true,
            seekable: false,
            ended: false,
            error: None,
        }
    }
}

fn kill_audio_child(child: &mut Child) {
    if let Err(error) = child.kill() {
        log::debug!("mpv process was already stopped or could not be killed: {}", error);
    }
    if let Err(error) = child.wait() {
        log::debug!("Failed to wait for mpv process shutdown: {}", error);
    }
}

fn stop_audio_controller(controller: &mut ExternalAudioController) {
    let _ = write_mpv_json(
        &controller.writer,
        json!({"command": ["quit"], "request_id": 0}),
    );
    kill_audio_child(&mut controller.child);
    cleanup_ipc_path(&controller.ipc_path);
}

fn write_mpv_json(writer: &Arc<Mutex<Box<dyn Write + Send>>>, payload: Value) -> Result<(), String> {
    let mut guard = writer
        .lock()
        .map_err(|_| "mpv IPC writer lock was poisoned".to_string())?;
    let line = format!("{payload}\n");
    guard
        .write_all(line.as_bytes())
        .and_then(|_| guard.flush())
        .map_err(|error| format!("Failed to send command to mpv IPC: {error}"))
}

fn emit_external_audio_state(app: &AppHandle, snapshot: &ExternalAudioSnapshot) {
    if let Err(error) = app.emit_to(WINDOW_LABEL, "external-audio://state", snapshot.clone()) {
        log::error!("Failed to emit external audio state: {}", error);
    }
}

fn unique_ipc_path(track_id: &str) -> String {
    let safe_track_id = track_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(32)
        .collect::<String>();
    let suffix = format!("{}-{}", std::process::id(), unique_millis());

    #[cfg(windows)]
    {
        format!(r"\\.\pipe\taurus-codewave-{safe_track_id}-{suffix}")
    }

    #[cfg(not(windows))]
    {
        std::env::temp_dir()
            .join(format!("taurus-codewave-{safe_track_id}-{suffix}.sock"))
            .to_string_lossy()
            .into_owned()
    }
}

fn unique_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

#[cfg(windows)]
fn cleanup_ipc_path(_path: &str) {
    // Windows mpv IPC uses named pipes, which are process-owned and do not need
    // filesystem cleanup like Unix socket paths.
}

#[cfg(not(windows))]
fn cleanup_ipc_path(path: &str) {
    let _ = std::fs::remove_file(path);
}

#[cfg(windows)]
fn connect_mpv_ipc(path: &str) -> Result<(Box<dyn Read + Send>, Box<dyn Write + Send>), String> {
    use std::fs::OpenOptions;

    let started = Instant::now();
    loop {
        match OpenOptions::new().read(true).write(true).open(path) {
            Ok(file) => {
                let reader = file
                    .try_clone()
                    .map_err(|error| format!("Failed to clone mpv named pipe: {error}"))?;
                return Ok((Box::new(reader), Box::new(file)));
            }
            Err(error) if started.elapsed() < Duration::from_secs(5) => {
                log::debug!("Waiting for mpv IPC pipe '{}': {}", path, error);
                thread::sleep(Duration::from_millis(50));
            }
            Err(error) => return Err(format!("Timed out connecting to mpv IPC pipe '{path}': {error}")),
        }
    }
}

#[cfg(not(windows))]
fn connect_mpv_ipc(path: &str) -> Result<(Box<dyn Read + Send>, Box<dyn Write + Send>), String> {
    use std::os::unix::net::UnixStream;

    let started = Instant::now();
    loop {
        match UnixStream::connect(path) {
            Ok(stream) => {
                let reader = stream
                    .try_clone()
                    .map_err(|error| format!("Failed to clone mpv IPC socket: {error}"))?;
                return Ok((Box::new(reader), Box::new(stream)));
            }
            Err(error) if started.elapsed() < Duration::from_secs(5) => {
                log::debug!("Waiting for mpv IPC socket '{}': {}", path, error);
                thread::sleep(Duration::from_millis(50));
            }
            Err(error) => return Err(format!("Timed out connecting to mpv IPC socket '{path}': {error}")),
        }
    }
}

fn spawn_mpv_state_reader(app: AppHandle, track_id: String, reader: Box<dyn Read + Send>) {
    thread::spawn(move || {
        let mut snapshot = ExternalAudioSnapshot::loading(track_id);
        let reader = BufReader::new(reader);

        for line in reader.lines() {
            let Ok(line) = line else {
                break;
            };
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                continue;
            };

            if apply_mpv_event(&mut snapshot, &value) {
                emit_external_audio_state(&app, &snapshot);
            }
        }

        snapshot.loading = false;
        snapshot.is_playing = false;
        snapshot.is_paused = true;
        if !snapshot.ended {
            snapshot.error = Some("mpv IPC stream closed".to_string());
        }
        emit_external_audio_state(&app, &snapshot);
    });
}

fn apply_mpv_event(snapshot: &mut ExternalAudioSnapshot, value: &Value) -> bool {
    let Some(event) = value.get("event").and_then(Value::as_str) else {
        return false;
    };

    match event {
        "file-loaded" => {
            snapshot.loading = false;
            snapshot.ended = false;
            true
        }
        "end-file" => {
            snapshot.loading = false;
            snapshot.is_playing = false;
            snapshot.is_paused = true;
            snapshot.ended = true;
            true
        }
        "shutdown" => {
            snapshot.loading = false;
            snapshot.is_playing = false;
            snapshot.is_paused = true;
            true
        }
        "property-change" => apply_property_change(snapshot, value),
        _ => false,
    }
}

fn apply_property_change(snapshot: &mut ExternalAudioSnapshot, value: &Value) -> bool {
    let Some(name) = value.get("name").and_then(Value::as_str) else {
        return false;
    };
    let data = value.get("data").unwrap_or(&Value::Null);

    match name {
        "time-pos" | "playback-time" => {
            snapshot.current = data.as_f64();
            true
        }
        "duration" => {
            snapshot.duration = data.as_f64();
            snapshot.seekable = snapshot.duration.unwrap_or(0.0) > 0.0;
            true
        }
        "pause" => {
            let paused = data.as_bool().unwrap_or(false);
            snapshot.is_paused = paused;
            snapshot.is_playing = !paused && !snapshot.loading && !snapshot.ended;
            true
        }
        "mute" | "volume" => true,
        "idle-active" => {
            snapshot.loading = data.as_bool().unwrap_or(false);
            true
        }
        "eof-reached" => {
            snapshot.ended = data.as_bool().unwrap_or(false);
            if snapshot.ended {
                snapshot.is_playing = false;
                snapshot.is_paused = true;
            }
            true
        }
        _ => false,
    }
}

fn observe_mpv_properties(state: &ExternalAudioState, writer: &Arc<Mutex<Box<dyn Write + Send>>>) -> Result<(), String> {
    for property in ["time-pos", "playback-time", "duration", "pause", "mute", "volume", "idle-active", "eof-reached"] {
        let request_id = state.request_id();
        write_mpv_json(
            writer,
            json!({
                "command": ["observe_property", request_id, property],
                "request_id": request_id
            }),
        )?;
    }
    Ok(())
}

#[tauri::command]
fn play_external_audio(
    app: AppHandle,
    state: State<'_, ExternalAudioState>,
    url: String,
    track_id: String,
) -> Result<(), String> {
    let mut guard = state
        .controller
        .lock()
        .map_err(|_| "External audio state lock was poisoned".to_string())?;

    if let Some(mut controller) = guard.take() {
        stop_audio_controller(&mut controller);
    }

    let ipc_path = unique_ipc_path(&track_id);
    cleanup_ipc_path(&ipc_path);
    let mut child = playback::play_youtube_audio_with_ipc(&url, &ipc_path).map_err(|error| error.to_string())?;
    let (reader, writer) = match connect_mpv_ipc(&ipc_path) {
        Ok(parts) => parts,
        Err(error) => {
            kill_audio_child(&mut child);
            cleanup_ipc_path(&ipc_path);
            return Err(error);
        }
    };

    let writer = Arc::new(Mutex::new(writer));
    let snapshot = ExternalAudioSnapshot::loading(track_id.clone());
    emit_external_audio_state(&app, &snapshot);
    spawn_mpv_state_reader(app, track_id.clone(), reader);
    observe_mpv_properties(&state, &writer)?;

    *guard = Some(ExternalAudioController {
        child,
        writer,
        ipc_path,
    });
    Ok(())
}

#[tauri::command]
fn pause_external_audio(state: State<'_, ExternalAudioState>) -> Result<(), String> {
    let guard = state
        .controller
        .lock()
        .map_err(|_| "External audio state lock was poisoned".to_string())?;
    let controller = guard
        .as_ref()
        .ok_or_else(|| "No external audio process is running".to_string())?;
    write_mpv_json(
        &controller.writer,
        json!({"command": ["set_property", "pause", true], "request_id": state.request_id()}),
    )
}

#[tauri::command]
fn resume_external_audio(state: State<'_, ExternalAudioState>) -> Result<(), String> {
    let guard = state
        .controller
        .lock()
        .map_err(|_| "External audio state lock was poisoned".to_string())?;
    let controller = guard
        .as_ref()
        .ok_or_else(|| "No external audio process is running".to_string())?;
    write_mpv_json(
        &controller.writer,
        json!({"command": ["set_property", "pause", false], "request_id": state.request_id()}),
    )
}

#[tauri::command]
fn stop_external_audio(state: State<'_, ExternalAudioState>) -> Result<(), String> {
    let mut guard = state
        .controller
        .lock()
        .map_err(|_| "External audio state lock was poisoned".to_string())?;
    if let Some(mut controller) = guard.take() {
        stop_audio_controller(&mut controller);
    }
    Ok(())
}

#[tauri::command]
fn set_external_audio_volume(state: State<'_, ExternalAudioState>, volume: u8) -> Result<(), String> {
    let volume = volume.min(100);
    let guard = state
        .controller
        .lock()
        .map_err(|_| "External audio state lock was poisoned".to_string())?;
    let Some(controller) = guard.as_ref() else {
        return Ok(());
    };
    write_mpv_json(
        &controller.writer,
        json!({"command": ["set_property", "volume", volume], "request_id": state.request_id()}),
    )
}

#[tauri::command]
fn set_external_audio_muted(state: State<'_, ExternalAudioState>, muted: bool) -> Result<(), String> {
    let guard = state
        .controller
        .lock()
        .map_err(|_| "External audio state lock was poisoned".to_string())?;
    let Some(controller) = guard.as_ref() else {
        return Ok(());
    };
    write_mpv_json(
        &controller.writer,
        json!({"command": ["set_property", "mute", muted], "request_id": state.request_id()}),
    )
}

#[tauri::command]
fn seek_external_audio(state: State<'_, ExternalAudioState>, seconds: f64) -> Result<(), String> {
    let seconds = seconds.max(0.0);
    let guard = state
        .controller
        .lock()
        .map_err(|_| "External audio state lock was poisoned".to_string())?;
    let controller = guard
        .as_ref()
        .ok_or_else(|| "No external audio process is running".to_string())?;
    write_mpv_json(
        &controller.writer,
        json!({"command": ["seek", seconds, "absolute"], "request_id": state.request_id()}),
    )
}

#[cfg(windows)]
fn optimize_webview2_for_audio_only() {
    const KEY: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";
    const AUDIO_ONLY_FLAGS: &[&str] = &[
        "--disable-gpu",
        "--disable-accelerated-video-decode",
        "--disable-accelerated-video-encode",
    ];

    // WebView2 GPU flags are Windows-only and must be set before WebView2/Tauri
    // initializes. This app is audio-only, so reducing GPU/video acceleration
    // memory is intentional for this workload.
    let mut args = std::env::var(KEY).unwrap_or_default();
    for flag in AUDIO_ONLY_FLAGS {
        if !args.split_whitespace().any(|existing| existing == *flag) {
            if !args.trim().is_empty() {
                args.push(' ');
            }
            args.push_str(flag);
        }
    }

    std::env::set_var(KEY, args);
}

pub fn run() {
    #[cfg(windows)]
    optimize_webview2_for_audio_only();

    let state = Arc::new(AppState::default());
    let state_for_setup = state.clone();
    let state_for_window = state.clone();

    tauri::Builder::default()
        .manage(ExternalAudioState::default())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Debug)
                .targets([Target::new(TargetKind::Stdout)])
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            set_tray_tooltip,
            play_external_audio,
            pause_external_audio,
            resume_external_audio,
            stop_external_audio,
            set_external_audio_volume,
            set_external_audio_muted,
            seek_external_audio
        ])
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
                        let state = app_handle.state::<ExternalAudioState>();
                        if let Ok(mut guard) = state.controller.lock() {
                            if let Some(mut controller) = guard.take() {
                                stop_audio_controller(&mut controller);
                            }
                        }
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
