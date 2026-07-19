// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    process::ExitCode,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use app_lib::playback::{play_youtube_audio, PlaybackError};

#[derive(Debug, Default)]
struct CliOptions {
    audio_only: bool,
    url: Option<String>,
}

fn parse_cli_options(args: impl IntoIterator<Item = String>) -> Result<CliOptions, String> {
    let mut options = CliOptions::default();
    let mut args = args.into_iter();
    let _program = args.next();

    while let Some(arg) = args.next() {
        if arg == "--audio-only" {
            options.audio_only = true;
        } else if arg == "--url" {
            let Some(url) = args.next() else {
                return Err("--url requires a value".to_string());
            };
            options.url = Some(url);
        } else if let Some(url) = arg.strip_prefix("--url=") {
            options.url = Some(url.to_string());
        }
    }

    Ok(options)
}

fn run_audio_only(url: &str) -> Result<(), PlaybackError> {
    let child = play_youtube_audio(url)?;
    let child = Arc::new(Mutex::new(Some(child)));
    let child_for_ctrlc = child.clone();

    if let Err(error) = ctrlc::set_handler(move || {
        if let Ok(mut guard) = child_for_ctrlc.lock() {
            if let Some(child) = guard.as_mut() {
                let _ = child.kill();
            }
        }
    }) {
        eprintln!("Failed to install Ctrl+C handler: {error}");
    }

    loop {
        let exited = {
            let mut guard = child.lock().expect("mpv child mutex poisoned");
            if let Some(child) = guard.as_mut() {
                match child.try_wait() {
                    Ok(Some(_status)) => {
                        guard.take();
                        true
                    }
                    Ok(None) => false,
                    Err(_error) => {
                        let _ = child.kill();
                        guard.take();
                        true
                    }
                }
            } else {
                true
            }
        };

        if exited {
            return Ok(());
        }

        thread::sleep(Duration::from_millis(200));
    }
}

fn main() -> ExitCode {
    let cli = match parse_cli_options(std::env::args()) {
        Ok(cli) => cli,
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::from(2);
        }
    };

    if cli.audio_only {
        let Some(url) = cli.url.as_deref() else {
            eprintln!("Audio-only mode requires --url <URL>.");
            return ExitCode::from(2);
        };

        if let Err(error) = run_audio_only(url) {
            eprintln!("{error}");
            return ExitCode::from(1);
        }

        return ExitCode::SUCCESS;
    }

    app_lib::run();
    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_audio_only_with_url_value() {
        let cli = parse_cli_options([
            "app".to_string(),
            "--audio-only".to_string(),
            "--url".to_string(),
            "https://youtube.com/watch?v=test".to_string(),
        ])
        .expect("valid cli");

        assert!(cli.audio_only);
        assert_eq!(cli.url.as_deref(), Some("https://youtube.com/watch?v=test"));
    }

    #[test]
    fn parses_audio_only_with_url_equals() {
        let cli = parse_cli_options([
            "app".to_string(),
            "--audio-only".to_string(),
            "--url=https://youtube.com/playlist?list=test".to_string(),
        ])
        .expect("valid cli");

        assert!(cli.audio_only);
        assert_eq!(
            cli.url.as_deref(),
            Some("https://youtube.com/playlist?list=test")
        );
    }
}
