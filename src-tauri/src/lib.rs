//! Taurus Music Player - Rust Backend
//!
//! This module provides the core Tauri application functionality for the music player,
//! including tray icon management, global shortcuts, and window behavior.

pub mod playback;
pub mod tool_updater;

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStderr};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
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
    process: Mutex<Option<ExternalAudioProcess>>,
    next_ipc_id: AtomicU64,
}

struct ExternalAudioProcess {
    child: Arc<Mutex<Child>>,
    ipc_path: String,
    stop_requested: Arc<AtomicBool>,
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
    idle_active: bool,
    core_idle: bool,
    media_title: Option<String>,
    audio_device: Option<String>,
    error: Option<String>,
}

const DOUBLE_CLICK_TIMEOUT_MS: u64 = 500;
const WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "main_tray";
const APP_NAME: &str = "Taurus Codewave";
const EVENT_PLAY_PAUSE: &str = "global-shortcut://play-pause";
const EVENT_NEXT_TRACK: &str = "global-shortcut://next-track";
const EVENT_PREVIOUS_TRACK: &str = "global-shortcut://previous-track";
const EVENT_TOGGLE_MUTE: &str = "global-shortcut://toggle-mute";
const TRAY_EVENT_PLAY_PAUSE: &str = "tray://play-pause";
const TRAY_EVENT_STOP_TRACK: &str = "tray://stop-track";
const TRAY_EVENT_NEXT_TRACK: &str = "tray://next-track";
const TRAY_EVENT_PREVIOUS_TRACK: &str = "tray://previous-track";

fn playback_tools_root(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join(tool_updater::MANAGED_DIR_NAME))
        .map_err(|error| format!("Cannot resolve the local playback-tool directory: {error}"))
}

#[tauri::command]
fn get_playback_tools_status(
    state: State<'_, tool_updater::PlaybackToolUpdateState>,
) -> tool_updater::PlaybackToolsStatus {
    state.snapshot()
}

#[tauri::command]
fn check_playback_tools_updates(app: AppHandle) -> Result<bool, String> {
    let root = playback_tools_root(&app)?;
    Ok(tool_updater::spawn_update_check(app, root))
}

fn emit_player_control(app: &AppHandle, event: &str, label: &str) {
    // Broadcast instead of targeting only the main window so tray commands still
    // reach the player while the compact window is hidden to the tray.
    if let Err(err) = app.emit(event, ()) {
        log::error!("Failed to emit {label} player control event: {err}");
    }
}

#[tauri::command]
fn set_tray_tooltip(app: AppHandle, current_track: Option<String>) -> Result<(), String> {
    let tooltip = match current_track {
        Some(track) if !track.trim().is_empty() => {
            format!("{}\nNow Playing: {}", APP_NAME, track.trim())
        }
        _ => APP_NAME.to_string(),
    };

    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "Tray not found".to_string())?;
    tray.set_tooltip(Some(tooltip)).map_err(|e| e.to_string())
}

fn kill_audio_child(child: &Arc<Mutex<Child>>) {
    let Ok(mut child) = child.lock() else {
        log::error!("mpv child lock was poisoned during shutdown");
        return;
    };
    if let Err(error) = child.kill() {
        log::debug!(
            "mpv process was already stopped or could not be killed: {}",
            error
        );
    }
    if let Err(error) = child.wait() {
        log::debug!("Failed to wait for mpv process shutdown: {}", error);
    }
}

fn stop_audio_process(process: &mut ExternalAudioProcess) {
    process.stop_requested.store(true, Ordering::Release);
    kill_audio_child(&process.child);
    cleanup_ipc_path(&process.ipc_path);
}

fn next_ipc_path(state: &ExternalAudioState) -> String {
    let id = state.next_ipc_id.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();

    #[cfg(windows)]
    {
        format!(r"\\.\pipe\taurus-codewave-mpv-{pid}-{id}")
    }

    #[cfg(not(windows))]
    {
        std::env::temp_dir()
            .join(format!("taurus-codewave-mpv-{pid}-{id}.sock"))
            .to_string_lossy()
            .into_owned()
    }
}

#[cfg(windows)]
fn cleanup_ipc_path(_path: &str) {
    // Windows mpv IPC uses named pipes, which are removed by the OS.
}

#[cfg(not(windows))]
fn cleanup_ipc_path(path: &str) {
    let _ = std::fs::remove_file(path);
}

#[cfg(windows)]
fn request_json_from_mpv_ipc(path: &str, payload: Value) -> Result<Value, String> {
    let mut last_error = None;
    let mut pipe = {
        let mut opened = None;
        for _ in 0..40 {
            match std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(path)
            {
                Ok(pipe) => {
                    opened = Some(pipe);
                    break;
                }
                Err(error) => {
                    last_error = Some(error);
                    thread::sleep(Duration::from_millis(25));
                }
            }
        }
        match opened {
            Some(pipe) => pipe,
            None => {
                return Err(format!(
                    "Failed to open mpv IPC pipe: {}",
                    last_error
                        .map(|error| error.to_string())
                        .unwrap_or_else(|| "unknown error".to_string())
                ));
            }
        }
    };
    writeln!(pipe, "{payload}")
        .map_err(|error| format!("Failed to write mpv IPC command: {error}"))?;
    pipe.flush()
        .map_err(|error| format!("Failed to flush mpv IPC command: {error}"))?;

    let mut line = String::new();
    let mut reader = BufReader::new(pipe);
    reader
        .read_line(&mut line)
        .map_err(|error| format!("Failed to read mpv IPC response: {error}"))?;
    serde_json::from_str(&line)
        .map_err(|error| format!("Failed to parse mpv IPC response: {error}"))
}

#[cfg(not(windows))]
fn request_json_from_mpv_ipc(path: &str, payload: Value) -> Result<Value, String> {
    use std::os::unix::net::UnixStream;

    let mut socket = UnixStream::connect(path)
        .map_err(|error| format!("Failed to open mpv IPC socket: {error}"))?;
    writeln!(socket, "{payload}")
        .map_err(|error| format!("Failed to write mpv IPC command: {error}"))?;
    socket
        .flush()
        .map_err(|error| format!("Failed to flush mpv IPC command: {error}"))?;

    let mut line = String::new();
    let mut reader = BufReader::new(socket);
    reader
        .read_line(&mut line)
        .map_err(|error| format!("Failed to read mpv IPC response: {error}"))?;
    serde_json::from_str(&line)
        .map_err(|error| format!("Failed to parse mpv IPC response: {error}"))
}

fn send_mpv_command(
    process: &ExternalAudioProcess,
    command: serde_json::Value,
) -> Result<(), String> {
    let response = request_json_from_mpv_ipc(&process.ipc_path, json!({ "command": command }))?;
    match response.get("error").and_then(Value::as_str) {
        Some("success") | None => Ok(()),
        Some(error) => Err(format!("mpv command failed: {error}")),
    }
}

fn read_mpv_property(ipc_path: &str, property: &str) -> Result<Value, String> {
    let response =
        request_json_from_mpv_ipc(ipc_path, json!({ "command": ["get_property", property] }))?;
    match response.get("error").and_then(Value::as_str) {
        Some("success") | None => Ok(response.get("data").cloned().unwrap_or(Value::Null)),
        Some(error) => Err(format!("mpv get_property {property} failed: {error}")),
    }
}

fn read_mpv_f64(ipc_path: &str, property: &str) -> Option<f64> {
    read_mpv_property(ipc_path, property)
        .ok()
        .and_then(|value| value.as_f64())
}

fn read_mpv_bool(ipc_path: &str, property: &str) -> Option<bool> {
    read_mpv_property(ipc_path, property)
        .ok()
        .and_then(|value| value.as_bool())
}

fn read_mpv_string(ipc_path: &str, property: &str) -> Option<String> {
    read_mpv_property(ipc_path, property)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
}

type StderrLines = Arc<Mutex<VecDeque<String>>>;

fn spawn_mpv_stderr_reader(stderr: ChildStderr) -> StderrLines {
    let lines = Arc::new(Mutex::new(VecDeque::with_capacity(40)));
    let captured = Arc::clone(&lines);
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let line = line.trim().to_string();
            if line.is_empty() {
                continue;
            }
            log::warn!("mpv: {line}");
            if let Ok(mut buffer) = captured.lock() {
                if buffer.len() == 40 {
                    buffer.pop_front();
                }
                buffer.push_back(line);
            }
        }
    });
    lines
}

fn mpv_error_message(lines: &StderrLines, fallback: &str) -> String {
    let details = lines.lock().ok().and_then(|buffer| {
        buffer
            .iter()
            .rev()
            .find(|line| !line.trim().is_empty())
            .cloned()
    });
    match details {
        Some(details) => format!("{fallback} {details}"),
        None => fallback.to_string(),
    }
}

fn mpv_reported_fatal_error(lines: &StderrLines) -> Option<String> {
    const FATAL_MARKERS: &[&str] = &[
        "[ytdl_hook] error:",
        "youtube-dl failed",
        "failed to initialize audio driver",
        "could not open/initialize audio device",
        "no audio or video streams selected",
        "failed to recognize file format",
    ];

    lines.lock().ok().and_then(|buffer| {
        buffer.iter().rev().find_map(|line| {
            let lower = line.to_ascii_lowercase();
            FATAL_MARKERS
                .iter()
                .any(|marker| lower.contains(marker))
                .then(|| line.clone())
        })
    })
}

fn emit_external_audio_state(app: &AppHandle, snapshot: ExternalAudioSnapshot) {
    if let Err(error) = app.emit("external-audio://state", snapshot) {
        log::error!("Failed to emit external audio state: {}", error);
    }
}

fn spawn_external_audio_poller(
    app: AppHandle,
    track_id: String,
    ipc_path: String,
    child: Arc<Mutex<Child>>,
    stop_requested: Arc<AtomicBool>,
    stderr_lines: StderrLines,
) {
    thread::spawn(move || {
        emit_external_audio_state(
            &app,
            ExternalAudioSnapshot {
                track_id: track_id.clone(),
                current: None,
                duration: None,
                is_playing: false,
                is_paused: false,
                loading: true,
                seekable: false,
                ended: false,
                idle_active: false,
                core_idle: true,
                media_title: None,
                audio_device: None,
                error: None,
            },
        );

        let mut playback_started = false;
        loop {
            thread::sleep(Duration::from_millis(500));

            if stop_requested.load(Ordering::Acquire) {
                break;
            }

            let exit_status = match child.lock() {
                Ok(mut child) => child.try_wait(),
                Err(_) => {
                    emit_external_audio_state(
                        &app,
                        ExternalAudioSnapshot {
                            track_id: track_id.clone(),
                            current: None,
                            duration: None,
                            is_playing: false,
                            is_paused: false,
                            loading: false,
                            seekable: false,
                            ended: false,
                            idle_active: true,
                            core_idle: true,
                            media_title: None,
                            audio_device: None,
                            error: Some("Unable to monitor the mpv process.".to_string()),
                        },
                    );
                    break;
                }
            };

            match exit_status {
                Ok(Some(status)) => {
                    let error = if status.success() && playback_started {
                        None
                    } else {
                        Some(mpv_error_message(
                            &stderr_lines,
                            &format!("mpv exited before playback completed ({status})."),
                        ))
                    };
                    emit_external_audio_state(
                        &app,
                        ExternalAudioSnapshot {
                            track_id: track_id.clone(),
                            current: Some(0.0),
                            duration: None,
                            is_playing: false,
                            is_paused: false,
                            loading: false,
                            seekable: false,
                            ended: error.is_none(),
                            idle_active: true,
                            core_idle: true,
                            media_title: None,
                            audio_device: None,
                            error,
                        },
                    );
                    break;
                }
                Ok(None) => {}
                Err(error) => {
                    emit_external_audio_state(
                        &app,
                        ExternalAudioSnapshot {
                            track_id: track_id.clone(),
                            current: None,
                            duration: None,
                            is_playing: false,
                            is_paused: false,
                            loading: false,
                            seekable: false,
                            ended: false,
                            idle_active: false,
                            core_idle: true,
                            media_title: None,
                            audio_device: None,
                            error: Some(format!("Failed to inspect the mpv process: {error}")),
                        },
                    );
                    break;
                }
            }

            if let Some(error) = mpv_reported_fatal_error(&stderr_lines) {
                emit_external_audio_state(
                    &app,
                    ExternalAudioSnapshot {
                        track_id: track_id.clone(),
                        current: None,
                        duration: None,
                        is_playing: false,
                        is_paused: false,
                        loading: false,
                        seekable: false,
                        ended: false,
                        idle_active: false,
                        core_idle: true,
                        media_title: None,
                        audio_device: None,
                        error: Some(format!("mpv playback failed: {error}")),
                    },
                );
                stop_requested.store(true, Ordering::Release);
                kill_audio_child(&child);
                break;
            }

            let current = read_mpv_f64(&ipc_path, "time-pos");
            let duration = read_mpv_f64(&ipc_path, "duration");
            let paused = read_mpv_bool(&ipc_path, "pause").unwrap_or(false);
            let idle_active = read_mpv_bool(&ipc_path, "idle-active").unwrap_or(false);
            let core_idle = read_mpv_bool(&ipc_path, "core-idle").unwrap_or(true);
            let media_title = read_mpv_string(&ipc_path, "media-title");
            let audio_device = read_mpv_string(&ipc_path, "audio-device");

            playback_started |= current.is_some() || duration.is_some() || media_title.is_some();

            if playback_started && current.is_none() && duration.is_none() && idle_active {
                emit_external_audio_state(
                    &app,
                    ExternalAudioSnapshot {
                        track_id: track_id.clone(),
                        current: Some(0.0),
                        duration,
                        is_playing: false,
                        is_paused: false,
                        loading: false,
                        seekable: false,
                        ended: true,
                        idle_active,
                        core_idle,
                        media_title,
                        audio_device,
                        error: None,
                    },
                );
                break;
            }

            let seekable = duration.is_some_and(|value| value > 0.0);
            emit_external_audio_state(
                &app,
                ExternalAudioSnapshot {
                    track_id: track_id.clone(),
                    current,
                    duration,
                    is_playing: !paused && current.is_some(),
                    is_paused: paused,
                    loading: current.is_none() && duration.is_none(),
                    seekable,
                    ended: false,
                    idle_active,
                    core_idle,
                    media_title,
                    audio_device,
                    error: None,
                },
            );
        }

        cleanup_ipc_path(&ipc_path);
    });
}

#[tauri::command]
fn play_external_audio(
    app: AppHandle,
    state: State<'_, ExternalAudioState>,
    url: String,
    track_id: Option<String>,
    volume: u8,
    muted: bool,
) -> Result<(), String> {
    let mut guard = state
        .process
        .lock()
        .map_err(|_| "External audio state lock was poisoned".to_string())?;

    if let Some(mut process) = guard.take() {
        stop_audio_process(&mut process);
    }

    let ipc_path = next_ipc_path(&state);
    cleanup_ipc_path(&ipc_path);
    let resource_dir = app.path().resource_dir().ok();
    let managed_root = playback_tools_root(&app).ok();
    let mut child = playback::play_youtube_audio_with_settings_from_locations(
        &url,
        &ipc_path,
        resource_dir.as_deref(),
        managed_root.as_deref(),
        volume,
        muted,
    )
    .map_err(|error| error.to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture mpv diagnostics.".to_string())?;
    let stderr_lines = spawn_mpv_stderr_reader(stderr);
    let child = Arc::new(Mutex::new(child));
    let stop_requested = Arc::new(AtomicBool::new(false));
    let track_id = track_id.unwrap_or_else(|| url.clone());
    *guard = Some(ExternalAudioProcess {
        child: Arc::clone(&child),
        ipc_path: ipc_path.clone(),
        stop_requested: Arc::clone(&stop_requested),
    });
    spawn_external_audio_poller(app, track_id, ipc_path, child, stop_requested, stderr_lines);
    Ok(())
}

#[tauri::command]
fn pause_external_audio(state: State<'_, ExternalAudioState>) -> Result<(), String> {
    let guard = state
        .process
        .lock()
        .map_err(|_| "External audio state lock was poisoned".to_string())?;
    let process = guard
        .as_ref()
        .ok_or_else(|| "No external audio process is running".to_string())?;
    send_mpv_command(process, json!(["set_property", "pause", true]))
}

#[tauri::command]
fn resume_external_audio(state: State<'_, ExternalAudioState>) -> Result<(), String> {
    let guard = state
        .process
        .lock()
        .map_err(|_| "External audio state lock was poisoned".to_string())?;
    let process = guard
        .as_ref()
        .ok_or_else(|| "No external audio process is running".to_string())?;
    send_mpv_command(process, json!(["set_property", "pause", false]))
}

#[tauri::command]
fn stop_external_audio(state: State<'_, ExternalAudioState>) -> Result<(), String> {
    let mut guard = state
        .process
        .lock()
        .map_err(|_| "External audio state lock was poisoned".to_string())?;
    if let Some(mut process) = guard.take() {
        stop_audio_process(&mut process);
    }
    Ok(())
}

#[tauri::command]
fn set_external_audio_volume(
    state: State<'_, ExternalAudioState>,
    volume: u8,
) -> Result<(), String> {
    let volume = volume.min(100);
    let guard = state
        .process
        .lock()
        .map_err(|_| "External audio state lock was poisoned".to_string())?;
    let Some(process) = guard.as_ref() else {
        return Ok(());
    };
    send_mpv_command(process, json!(["set_property", "volume", volume]))
}

#[tauri::command]
fn set_external_audio_muted(
    state: State<'_, ExternalAudioState>,
    muted: bool,
) -> Result<(), String> {
    let guard = state
        .process
        .lock()
        .map_err(|_| "External audio state lock was poisoned".to_string())?;
    let Some(process) = guard.as_ref() else {
        return Ok(());
    };
    send_mpv_command(process, json!(["set_property", "mute", muted]))
}

#[tauri::command]
fn seek_external_audio(state: State<'_, ExternalAudioState>, seconds: f64) -> Result<(), String> {
    let seconds = seconds.max(0.0);
    let guard = state
        .process
        .lock()
        .map_err(|_| "External audio state lock was poisoned".to_string())?;
    let process = guard
        .as_ref()
        .ok_or_else(|| "No external audio process is running".to_string())?;
    send_mpv_command(process, json!(["seek", seconds, "absolute"]))
}

#[cfg(test)]
mod external_audio_tests {
    use super::*;

    #[test]
    fn recognizes_ytdl_failure_without_waiting_for_mpv_to_exit() {
        let lines = Arc::new(Mutex::new(VecDeque::from([
            "[ytdl_hook] ERROR: unable to download API page".to_string(),
        ])));

        assert!(mpv_reported_fatal_error(&lines).is_some());
    }

    #[test]
    fn ordinary_mpv_warnings_do_not_stop_playback() {
        let lines = Arc::new(Mutex::new(VecDeque::from([
            "[ffmpeg] warning: metadata field was ignored".to_string(),
        ])));

        assert!(mpv_reported_fatal_error(&lines).is_none());
    }
}

pub fn run() {
    let state = Arc::new(AppState::default());
    let state_for_setup = state.clone();
    let state_for_window = state.clone();

    tauri::Builder::default()
        .manage(ExternalAudioState::default())
        .manage(tool_updater::PlaybackToolUpdateState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
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
            seek_external_audio,
            get_playback_tools_status,
            check_playback_tools_updates
        ])
        .setup(move |app| {
            let state_clone = state_for_setup.clone();

            if let Ok(resource_dir) = app.path().resource_dir() {
                app.state::<tool_updater::PlaybackToolUpdateState>()
                    .load_bundled_versions(&resource_dir);
            }

            if let Err(e) = app
                .global_shortcut()
                .on_shortcut("Ctrl+Alt+P", move |app, _, _| {
                    emit_player_control(app, EVENT_PLAY_PAUSE, "play/pause shortcut");
                })
            {
                log::error!("Failed to register Ctrl+Alt+P global shortcut: {}", e);
                return Err(Box::new(e));
            }
            if let Err(e) = app
                .global_shortcut()
                .on_shortcut("Ctrl+Alt+N", move |app, _, _| {
                    emit_player_control(app, EVENT_NEXT_TRACK, "next-track shortcut");
                })
            {
                log::error!("Failed to register Ctrl+Alt+N global shortcut: {}", e);
                return Err(Box::new(e));
            }
            if let Err(e) = app
                .global_shortcut()
                .on_shortcut("Ctrl+Alt+B", move |app, _, _| {
                    emit_player_control(app, EVENT_PREVIOUS_TRACK, "previous-track shortcut");
                })
            {
                log::error!("Failed to register Ctrl+Alt+B global shortcut: {}", e);
                return Err(Box::new(e));
            }
            if let Err(e) = app
                .global_shortcut()
                .on_shortcut("Ctrl+Alt+M", move |app, _, _| {
                    emit_player_control(app, EVENT_TOGGLE_MUTE, "toggle-mute shortcut");
                })
            {
                log::error!("Failed to register Ctrl+Alt+M global shortcut: {}", e);
                return Err(Box::new(e));
            }

            let show_hide_item =
                MenuItem::with_id(app, "show_hide", "Show / Hide", true, None::<&str>)?;
            let play_pause_item =
                MenuItem::with_id(app, "play_pause", "Play / Pause", true, None::<&str>)?;
            let stop_item = MenuItem::with_id(app, "stop_track", "Stop", true, None::<&str>)?;
            let next_item = MenuItem::with_id(app, "next_track", "Next Track", true, None::<&str>)?;
            let prev_item =
                MenuItem::with_id(app, "previous_track", "Previous Track", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

            let menu = Menu::with_items(
                app,
                &[
                    &show_hide_item,
                    &play_pause_item,
                    &stop_item,
                    &next_item,
                    &prev_item,
                    &quit_item,
                ],
            )?;

            let show_hide_id = show_hide_item.id().clone();
            let play_pause_id = play_pause_item.id().clone();
            let stop_id = stop_item.id().clone();
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
                                    Err(e) => {
                                        log::error!("Failed to query window visibility: {}", e)
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                })
                .on_menu_event(move |app_handle, event| {
                    log::debug!("Tray menu item selected: {:?}", event.id());
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
                        emit_player_control(app_handle, TRAY_EVENT_PLAY_PAUSE, "tray play/pause");
                    } else if event.id() == &stop_id {
                        emit_player_control(app_handle, TRAY_EVENT_STOP_TRACK, "tray stop");
                    } else if event.id() == &next_id {
                        emit_player_control(app_handle, TRAY_EVENT_NEXT_TRACK, "tray next-track");
                    } else if event.id() == &prev_id {
                        emit_player_control(
                            app_handle,
                            TRAY_EVENT_PREVIOUS_TRACK,
                            "tray previous-track",
                        );
                    } else if event.id() == &quit_id {
                        let state = app_handle.state::<ExternalAudioState>();
                        if let Ok(mut guard) = state.process.lock() {
                            if let Some(mut process) = guard.take() {
                                stop_audio_process(&mut process);
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

            match playback_tools_root(app.handle()) {
                Ok(root) => {
                    tool_updater::spawn_update_check(app.handle().clone(), root);
                }
                Err(error) => log::warn!("Automatic playback-tool check disabled: {error}"),
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
