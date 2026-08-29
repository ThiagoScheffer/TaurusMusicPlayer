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
const BUNDLED_TOOLS_DIR: &str = "playback-tools/windows-x64";
const BUNDLED_MPV_DIR: &str = "mpv";
const BUNDLED_MPV_EXE: &str = "mpv.exe";
const BUNDLED_YT_DLP_EXE: &str = "yt-dlp.exe";

#[derive(Debug, Clone, PartialEq, Eq)]
struct PlaybackTools {
    mpv_binary: PathBuf,
    yt_dlp_binary: PathBuf,
    tools_dir: PathBuf,
}

#[derive(Debug)]
pub enum PlaybackError {
    EmptyUrl,
    InvalidBundledTools { resource_dir: PathBuf },
    MissingDependency { binary: &'static str },
    SpawnFailed(std::io::Error),
}

impl fmt::Display for PlaybackError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyUrl => write!(f, "A YouTube URL is required. Pass --url <URL>."),
            Self::InvalidBundledTools { resource_dir } => write!(
                f,
                "Bundled playback tools are incomplete in '{}'. Reinstall Taurus Music Player.",
                resource_dir.display()
            ),
            Self::MissingDependency { binary } => write!(
                f,
                "Missing playback dependency: bundled '{}' was unavailable and it was not found in PATH.",
                binary
            ),
            Self::SpawnFailed(error) => write!(f, "Failed to start mpv: {error}"),
        }
    }
}

impl std::error::Error for PlaybackError {}

pub fn mpv_audio_args(url: &str) -> Vec<OsString> {
    mpv_audio_args_with_settings(url, None, 100, false)
}

pub fn mpv_audio_args_with_ipc(url: &str, ipc_path: Option<&str>) -> Vec<OsString> {
    mpv_audio_args_with_settings(url, ipc_path, 100, false)
}

pub fn mpv_audio_args_with_settings(
    url: &str,
    ipc_path: Option<&str>,
    volume: u8,
    muted: bool,
) -> Vec<OsString> {
    let mut args = vec![
        OsString::from("--no-config"),
        OsString::from("--no-video"),
        OsString::from("--vo=null"),
        OsString::from("--audio-display=no"),
        OsString::from("--ytdl-format=bestaudio"),
        OsString::from("--msg-level=all=warn"),
        OsString::from(format!("--volume={}", volume.min(100))),
        OsString::from(if muted { "--mute=yes" } else { "--mute=no" }),
    ];

    if let Some(ipc_path) = ipc_path {
        args.push(OsString::from(format!("--input-ipc-server={ipc_path}")));
    }

    args.push(OsString::from(url));
    args
}

pub fn build_mpv_audio_command(mpv_binary: &Path, url: &str, ipc_path: Option<&str>) -> Command {
    build_mpv_audio_command_with_tools(mpv_binary, url, ipc_path, None, None, 100, false)
}

fn build_mpv_audio_command_with_tools(
    mpv_binary: &Path,
    url: &str,
    ipc_path: Option<&str>,
    tools_dir: Option<&Path>,
    yt_dlp_dir: Option<&Path>,
    volume: u8,
    muted: bool,
) -> Command {
    let mut command = Command::new(mpv_binary);
    command
        .args(mpv_audio_args_with_settings(url, ipc_path, volume, muted))
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    if let Some(tools_dir) = tools_dir {
        // mpv loads its DLLs and runs yt-dlp from this portable, bundled directory.
        command.current_dir(tools_dir);
        command.env(
            "PATH",
            prepend_directories_to_path(
                [Some(tools_dir), yt_dlp_dir].into_iter().flatten(),
                env::var_os("PATH"),
            ),
        );
    }

    command
}

pub fn play_youtube_audio(url: &str) -> Result<Child, PlaybackError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(PlaybackError::EmptyUrl);
    }

    let tools = resolve_playback_tools(None, None)?;

    log::info!(
        "Starting mpv '{}' with playback tools from '{}'",
        tools.mpv_binary.display(),
        tools.tools_dir.display()
    );
    build_mpv_audio_command_with_tools(
        &tools.mpv_binary,
        trimmed,
        None,
        Some(&tools.tools_dir),
        tools.yt_dlp_binary.parent(),
        100,
        false,
    )
    .spawn()
    .map_err(PlaybackError::SpawnFailed)
}

pub fn play_youtube_audio_with_ipc(url: &str, ipc_path: &str) -> Result<Child, PlaybackError> {
    play_youtube_audio_with_ipc_from_resources(url, ipc_path, None)
}

pub fn play_youtube_audio_with_ipc_from_resources(
    url: &str,
    ipc_path: &str,
    resource_dir: Option<&Path>,
) -> Result<Child, PlaybackError> {
    play_youtube_audio_with_settings_from_resources(url, ipc_path, resource_dir, 100, false)
}

pub fn play_youtube_audio_with_settings_from_resources(
    url: &str,
    ipc_path: &str,
    resource_dir: Option<&Path>,
    volume: u8,
    muted: bool,
) -> Result<Child, PlaybackError> {
    play_youtube_audio_with_settings_from_locations(
        url,
        ipc_path,
        resource_dir,
        None,
        volume,
        muted,
    )
}

pub fn play_youtube_audio_with_settings_from_locations(
    url: &str,
    ipc_path: &str,
    resource_dir: Option<&Path>,
    managed_root: Option<&Path>,
    volume: u8,
    muted: bool,
) -> Result<Child, PlaybackError> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err(PlaybackError::EmptyUrl);
    }

    let tools = resolve_playback_tools(resource_dir, managed_root)?;

    log::info!(
        "Starting mpv '{}' with playback tools from '{}'",
        tools.mpv_binary.display(),
        tools.tools_dir.display()
    );

    build_mpv_audio_command_with_tools(
        &tools.mpv_binary,
        trimmed,
        Some(ipc_path),
        Some(&tools.tools_dir),
        tools.yt_dlp_binary.parent(),
        volume,
        muted,
    )
    .spawn()
    .map_err(PlaybackError::SpawnFailed)
}

fn resolve_playback_tools(
    resource_dir: Option<&Path>,
    managed_root: Option<&Path>,
) -> Result<PlaybackTools, PlaybackError> {
    let bundled = resource_dir
        .map(bundled_playback_tools)
        .transpose()?
        .flatten();
    let managed_mpv = managed_root.and_then(|root| {
        crate::tool_updater::managed_executable(root, crate::tool_updater::ToolKind::Mpv)
    });
    let managed_ytdlp = managed_root.and_then(|root| {
        crate::tool_updater::managed_executable(root, crate::tool_updater::ToolKind::YtDlp)
    });
    let mpv_binary = managed_mpv
        .or_else(|| bundled.as_ref().map(|tools| tools.mpv_binary.clone()))
        .map(Ok)
        .unwrap_or_else(resolve_mpv_binary)?;
    let yt_dlp_binary = managed_ytdlp
        .or_else(|| bundled.as_ref().map(|tools| tools.yt_dlp_binary.clone()))
        .map(Ok)
        .unwrap_or_else(resolve_yt_dlp_binary)?;
    let tools_dir = mpv_binary
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default();
    Ok(PlaybackTools {
        mpv_binary,
        yt_dlp_binary,
        tools_dir,
    })
}

fn bundled_playback_tools(resource_dir: &Path) -> Result<Option<PlaybackTools>, PlaybackError> {
    let tools_dir = resource_dir.join(BUNDLED_TOOLS_DIR);
    if !tools_dir.exists() {
        return Ok(None);
    }

    let mpv_binary = tools_dir.join(BUNDLED_MPV_DIR).join(BUNDLED_MPV_EXE);
    let yt_dlp_binary = tools_dir.join(BUNDLED_YT_DLP_EXE);
    if !mpv_binary.is_file() || !yt_dlp_binary.is_file() {
        return Err(PlaybackError::InvalidBundledTools {
            resource_dir: tools_dir,
        });
    }

    Ok(Some(PlaybackTools {
        mpv_binary,
        yt_dlp_binary,
        tools_dir,
    }))
}

fn resolve_mpv_binary() -> Result<PathBuf, PlaybackError> {
    MPV_CANDIDATES
        .iter()
        .find_map(|candidate| resolve_binary_candidate(candidate, env::var_os("PATH")))
        .ok_or(PlaybackError::MissingDependency { binary: MPV_BIN })
}

fn resolve_yt_dlp_binary() -> Result<PathBuf, PlaybackError> {
    YT_DLP_CANDIDATES
        .iter()
        .find_map(|candidate| resolve_binary_candidate(candidate, env::var_os("PATH")))
        .ok_or(PlaybackError::MissingDependency { binary: YT_DLP_BIN })
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

fn prepend_directories_to_path<'a>(
    directories: impl IntoIterator<Item = &'a Path>,
    current_path: Option<OsString>,
) -> OsString {
    let mut entries = directories
        .into_iter()
        .map(Path::to_path_buf)
        .collect::<Vec<_>>();
    if let Some(current_path) = current_path {
        entries.extend(env::split_paths(&current_path));
    }
    env::join_paths(&entries).unwrap_or_else(|_| {
        entries
            .first()
            .map(|path| path.as_os_str().to_os_string())
            .unwrap_or_default()
    })
}

fn candidate_paths(dir: &Path, binary: &str) -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let pathext =
            env::var_os("PATHEXT").unwrap_or_else(|| OsString::from(".COM;.EXE;.BAT;.CMD"));
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
        paths.extend(
            extensions
                .into_iter()
                .map(|ext| dir.join(format!("{binary}.{ext}"))),
        );
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
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_resource_dir() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "taurus-playback-test-{}-{unique}",
            std::process::id()
        ))
    }

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
                "--no-config",
                "--no-video",
                "--vo=null",
                "--audio-display=no",
                "--ytdl-format=bestaudio",
                "--msg-level=all=warn",
                "--volume=100",
                "--mute=no",
                "https://youtube.com/watch?v=test"
            ]
        );
    }

    #[test]
    fn builds_audio_only_mpv_command_with_resolved_binary() {
        let command =
            build_mpv_audio_command(Path::new("mpv"), "https://youtube.com/watch?v=test", None);
        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert_eq!(command.get_program().to_string_lossy(), "mpv");
        assert_eq!(
            args,
            vec![
                "--no-config",
                "--no-video",
                "--vo=null",
                "--audio-display=no",
                "--ytdl-format=bestaudio",
                "--msg-level=all=warn",
                "--volume=100",
                "--mute=no",
                "https://youtube.com/watch?v=test"
            ]
        );
    }

    #[test]
    fn builds_audio_only_mpv_args_with_ipc() {
        let args = mpv_audio_args_with_ipc(
            "https://youtube.com/watch?v=test",
            Some(r"\\.\pipe\taurus-test"),
        );
        let text = args
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert_eq!(
            text,
            vec![
                "--no-config",
                "--no-video",
                "--vo=null",
                "--audio-display=no",
                "--ytdl-format=bestaudio",
                "--msg-level=all=warn",
                "--volume=100",
                "--mute=no",
                r"--input-ipc-server=\\.\pipe\taurus-test",
                "https://youtube.com/watch?v=test"
            ]
        );
    }

    #[test]
    fn applies_initial_volume_and_mute_to_mpv() {
        let args =
            mpv_audio_args_with_settings("https://youtube.com/watch?v=test", None, 125, true);
        let text = args
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert!(text.contains(&"--volume=100".to_string()));
        assert!(text.contains(&"--mute=yes".to_string()));
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

    #[test]
    fn bundled_tools_take_precedence_over_external_candidates() {
        let resource_dir = temporary_resource_dir();
        let tools_dir = resource_dir.join(BUNDLED_TOOLS_DIR);
        let mpv_dir = tools_dir.join(BUNDLED_MPV_DIR);
        fs::create_dir_all(&mpv_dir).unwrap();
        fs::write(mpv_dir.join(BUNDLED_MPV_EXE), []).unwrap();
        fs::write(tools_dir.join(BUNDLED_YT_DLP_EXE), []).unwrap();

        let tools = resolve_playback_tools(Some(&resource_dir), None).unwrap();
        assert_eq!(tools.mpv_binary, mpv_dir.join(BUNDLED_MPV_EXE));
        assert_eq!(tools.tools_dir, mpv_dir);

        fs::remove_dir_all(resource_dir).unwrap();
    }

    #[test]
    fn verified_managed_tools_take_precedence_over_bundled_tools() {
        use crate::tool_updater::{ManagedManifest, ManagedToolRecord};

        let resource_dir = temporary_resource_dir();
        let managed_root = temporary_resource_dir();
        let bundled_dir = resource_dir.join(BUNDLED_TOOLS_DIR);
        fs::create_dir_all(bundled_dir.join(BUNDLED_MPV_DIR)).unwrap();
        fs::write(bundled_dir.join(BUNDLED_MPV_DIR).join(BUNDLED_MPV_EXE), []).unwrap();
        fs::write(bundled_dir.join(BUNDLED_YT_DLP_EXE), []).unwrap();
        let managed_mpv = PathBuf::from("versions/mpv/current/mpv.exe");
        let managed_ytdlp = PathBuf::from("versions/yt-dlp/current/yt-dlp.exe");
        fs::create_dir_all(managed_root.join(managed_mpv.parent().unwrap())).unwrap();
        fs::create_dir_all(managed_root.join(managed_ytdlp.parent().unwrap())).unwrap();
        fs::write(managed_root.join(&managed_mpv), []).unwrap();
        fs::write(managed_root.join(&managed_ytdlp), []).unwrap();
        let empty_sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        let record = |path: &Path| ManagedToolRecord {
            version: "managed".into(),
            executable_path: path.to_string_lossy().into_owned(),
            executable_sha256: empty_sha256.into(),
            archive_sha256: empty_sha256.into(),
            source_url: "https://github.com/allowlisted".into(),
            release_id: 1,
            activated_at: 1,
        };
        let mut manifest = ManagedManifest::default();
        manifest.mpv.active = Some(record(&managed_mpv));
        manifest.yt_dlp.active = Some(record(&managed_ytdlp));
        fs::write(
            managed_root.join("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();

        let tools = resolve_playback_tools(Some(&resource_dir), Some(&managed_root)).unwrap();

        assert_eq!(tools.mpv_binary, managed_root.join(managed_mpv));
        assert_eq!(tools.yt_dlp_binary, managed_root.join(managed_ytdlp));
        fs::remove_dir_all(resource_dir).unwrap();
        fs::remove_dir_all(managed_root).unwrap();
    }

    #[test]
    fn incomplete_bundled_tools_fail_with_reinstall_guidance() {
        let resource_dir = temporary_resource_dir();
        let tools_dir = resource_dir.join(BUNDLED_TOOLS_DIR);
        fs::create_dir_all(&tools_dir).unwrap();

        let error = resolve_playback_tools(Some(&resource_dir), None).unwrap_err();
        assert!(matches!(error, PlaybackError::InvalidBundledTools { .. }));

        fs::remove_dir_all(resource_dir).unwrap();
    }

    #[test]
    fn bundled_command_sets_working_directory_and_path() {
        let tools_dir = PathBuf::from(r"C:\\Taurus\\playback-tools\\windows-x64");
        let command = build_mpv_audio_command_with_tools(
            &tools_dir.join(BUNDLED_MPV_DIR).join(BUNDLED_MPV_EXE),
            "https://youtube.com/watch?v=test",
            None,
            Some(&tools_dir),
            Some(&tools_dir),
            100,
            false,
        );

        assert_eq!(command.get_current_dir(), Some(tools_dir.as_path()));
        let path = command
            .get_envs()
            .find_map(|(key, value)| (key == "PATH").then_some(value).flatten())
            .expect("bundled command should set PATH");
        assert!(path
            .to_string_lossy()
            .starts_with(tools_dir.to_string_lossy().as_ref()));
    }
}
