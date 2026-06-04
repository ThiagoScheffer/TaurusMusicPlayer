use std::{
    env,
    ffi::OsString,
    fmt,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
};

const MPV_BIN: &str = "mpv";
const YT_DLP_BIN: &str = "yt-dlp";
const MPV_CANDIDATES: &[&str] = &["mpv", "mpv.exe", r"C:\Program Files\MPV Player\mpv.exe"];
const YT_DLP_CANDIDATES: &[&str] = &[
    "yt-dlp",
    "yt-dlp.exe",
    r"C:\Users\Thiago\AppData\Local\Microsoft\WinGet\Links\yt-dlp.exe",
    r"C:\Tools\yt-dlp\yt-dlp.exe",
    r"C:\Program Files\yt-dlp\yt-dlp.exe",
];

#[derive(Debug)]
pub enum PlaybackError {
    EmptyUrl,
    MissingDependency { binary: &'static str },
    SpawnFailed(std::io::Error),
}

impl fmt::Display for PlaybackError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyUrl => write!(f, "A YouTube URL is required. Pass --url <URL>."),
            Self::MissingDependency { binary } => write!(
                f,
                "Missing dependency: '{}' was not found in PATH. Install '{}' and try again.",
                binary, binary
            ),
            Self::SpawnFailed(error) => write!(f, "Failed to start mpv: {error}"),
        }
    }
}

impl std::error::Error for PlaybackError {}

pub fn mpv_audio_args(url: &str) -> Vec<OsString> {
    mpv_audio_args_with_ipc(url, None)
}

pub fn mpv_audio_args_with_ipc(url: &str, ipc_path: Option<&str>) -> Vec<OsString> {
    let mut args = vec![
        OsString::from("--no-video"),
        OsString::from("--vo=null"),
        OsString::from("--audio-display=no"),
        OsString::from("--ytdl-format=bestaudio"),
        OsString::from("--really-quiet"),
    ];

    if let Some(ipc_path) = ipc_path {
        args.push(OsString::from(format!("--input-ipc-server={ipc_path}")));
    }

    args.push(OsString::from(url));
    args
}

pub fn build_mpv_audio_command(mpv_binary: &Path, url: &str, ipc_path: Option<&str>) -> Command {
    let mut command = Command::new(mpv_binary);
    command
        .args(mpv_audio_args_with_ipc(url, ipc_path))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

pub fn play_youtube_audio(url: &str) -> Result<Child, PlaybackError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(PlaybackError::EmptyUrl);
    }

    let mpv_binary = resolve_mpv_binary()?;
    ensure_yt_dlp_binary()?;

    build_mpv_audio_command(&mpv_binary, trimmed, None)
        .spawn()
        .map_err(PlaybackError::SpawnFailed)
}

pub fn play_youtube_audio_with_ipc(url: &str, ipc_path: &str) -> Result<Child, PlaybackError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(PlaybackError::EmptyUrl);
    }

    let mpv_binary = resolve_mpv_binary()?;
    ensure_yt_dlp_binary()?;

    build_mpv_audio_command(&mpv_binary, trimmed, Some(ipc_path))
        .spawn()
        .map_err(PlaybackError::SpawnFailed)
}

fn resolve_mpv_binary() -> Result<PathBuf, PlaybackError> {
    MPV_CANDIDATES
        .iter()
        .find_map(|candidate| resolve_binary_candidate(candidate, env::var_os("PATH")))
        .ok_or(PlaybackError::MissingDependency { binary: MPV_BIN })
}

fn ensure_yt_dlp_binary() -> Result<(), PlaybackError> {
    if YT_DLP_CANDIDATES
        .iter()
        .any(|candidate| resolve_binary_candidate(candidate, env::var_os("PATH")).is_some())
    {
        Ok(())
    } else {
        Err(PlaybackError::MissingDependency { binary: YT_DLP_BIN })
    }
}

fn resolve_binary_candidate(binary: &str, path_var: Option<OsString>) -> Option<PathBuf> {
    let direct = PathBuf::from(binary);
    if direct.is_file() {
        return Some(direct);
    }

    let path_var = path_var?;
    env::split_paths(&path_var)
        .flat_map(|dir| candidate_paths(&dir, binary))
        .find(|p| p.is_file())
}

fn candidate_paths(dir: &Path, binary: &str) -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let pathext = env::var_os("PATHEXT").unwrap_or_else(|| OsString::from(".COM;.EXE;.BAT;.CMD"));
        let extensions = pathext
            .to_string_lossy()
            .split(';')
            .filter(|ext| !ext.is_empty())
            .map(|ext| ext.trim_start_matches('.').to_ascii_lowercase())
            .collect::<Vec<_>>();

        let has_extension = Path::new(binary).extension().is_some();
        if has_extension {
            return vec![dir.join(binary)];
        }

        let mut paths = vec![dir.join(binary)];
        paths.extend(extensions.into_iter().map(|ext| dir.join(format!("{binary}.{ext}"))));
        paths
    }

    #[cfg(not(windows))]
    {
        vec![dir.join(binary)]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_audio_only_mpv_args() {
        let args = mpv_audio_args("https://youtube.com/watch?v=test");
        let text = args
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert_eq!(
            text,
            vec![
                "--no-video",
                "--vo=null",
                "--audio-display=no",
                "--ytdl-format=bestaudio",
                "--really-quiet",
                "https://youtube.com/watch?v=test"
            ]
        );
    }

    #[test]
    fn builds_audio_only_mpv_command_with_resolved_binary() {
        let command = build_mpv_audio_command(Path::new("mpv"), "https://youtube.com/watch?v=test", None);
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert_eq!(command.get_program().to_string_lossy(), "mpv");
        assert_eq!(
            args,
            vec![
                "--no-video",
                "--vo=null",
                "--audio-display=no",
                "--ytdl-format=bestaudio",
                "--really-quiet",
                "https://youtube.com/watch?v=test"
            ]
        );
    }

    #[test]
    fn builds_audio_only_mpv_args_with_ipc() {
        let args = mpv_audio_args_with_ipc("https://youtube.com/watch?v=test", Some(r"\\.\pipe\taurus-test"));
        let text = args
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert_eq!(
            text,
            vec![
                "--no-video",
                "--vo=null",
                "--audio-display=no",
                "--ytdl-format=bestaudio",
                "--really-quiet",
                r"--input-ipc-server=\\.\pipe\taurus-test",
                "https://youtube.com/watch?v=test"
            ]
        );
    }

    #[test]
    fn empty_path_does_not_find_dependency() {
        assert!(resolve_binary_candidate("definitely-not-real", Some(OsString::new())).is_none());
    }

    #[test]
    fn empty_url_returns_actionable_error() {
        let error = play_youtube_audio(" ").unwrap_err();
        assert!(matches!(error, PlaybackError::EmptyUrl));
    }
}
