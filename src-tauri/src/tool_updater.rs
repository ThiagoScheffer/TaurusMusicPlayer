use reqwest::blocking::{Client, Response};
use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, ETAG, IF_NONE_MATCH, USER_AGENT,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

pub const STATUS_EVENT: &str = "playback-tools://status";
pub const MANAGED_DIR_NAME: &str = "playback-tools";
const MANIFEST_FILE: &str = "manifest.json";
const MAX_YT_DLP_BYTES: u64 = 64 * 1024 * 1024;
const MAX_MPV_BYTES: u64 = 256 * 1024 * 1024;
const VALIDATION_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolKind {
    Mpv,
    YtDlp,
}

impl ToolKind {
    fn key(self) -> &'static str {
        if self == Self::Mpv {
            "mpv"
        } else {
            "yt-dlp"
        }
    }
    fn repository(self) -> &'static str {
        if self == Self::Mpv {
            "zhongfly/mpv-winbuild"
        } else {
            "yt-dlp/yt-dlp"
        }
    }
    fn executable(self) -> &'static str {
        if self == Self::Mpv {
            "mpv.exe"
        } else {
            "yt-dlp.exe"
        }
    }
    fn max_bytes(self) -> u64 {
        if self == Self::Mpv {
            MAX_MPV_BYTES
        } else {
            MAX_YT_DLP_BYTES
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct GitHubAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
    pub digest: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct GitHubRelease {
    pub id: u64,
    pub tag_name: String,
    pub assets: Vec<GitHubAsset>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedToolRecord {
    pub version: String,
    pub executable_path: String,
    pub executable_sha256: String,
    pub archive_sha256: String,
    pub source_url: String,
    pub release_id: u64,
    pub activated_at: u64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSlot {
    pub active: Option<ManagedToolRecord>,
    pub previous: Option<ManagedToolRecord>,
    pub etag: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedManifest {
    pub schema_version: u8,
    pub last_checked_at: Option<u64>,
    pub mpv: ToolSlot,
    pub yt_dlp: ToolSlot,
}

impl Default for ManagedManifest {
    fn default() -> Self {
        Self {
            schema_version: 1,
            last_checked_at: None,
            mpv: ToolSlot::default(),
            yt_dlp: ToolSlot::default(),
        }
    }
}

impl ManagedManifest {
    fn slot(&self, kind: ToolKind) -> &ToolSlot {
        if kind == ToolKind::Mpv {
            &self.mpv
        } else {
            &self.yt_dlp
        }
    }
    fn slot_mut(&mut self, kind: ToolKind) -> &mut ToolSlot {
        if kind == ToolKind::Mpv {
            &mut self.mpv
        } else {
            &mut self.yt_dlp
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub kind: ToolKind,
    pub installed_version: Option<String>,
    pub latest_version: Option<String>,
    pub source: String,
    pub failure_message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackToolsStatus {
    pub phase: String,
    pub last_check: Option<u64>,
    pub message: Option<String>,
    pub tools: Vec<ToolStatus>,
}

fn blank_status(kind: ToolKind) -> ToolStatus {
    ToolStatus {
        kind,
        installed_version: None,
        latest_version: None,
        source: "bundled".into(),
        failure_message: None,
    }
}

impl Default for PlaybackToolsStatus {
    fn default() -> Self {
        Self {
            phase: "idle".into(),
            last_check: None,
            message: None,
            tools: vec![blank_status(ToolKind::Mpv), blank_status(ToolKind::YtDlp)],
        }
    }
}

#[derive(Default)]
pub struct PlaybackToolUpdateState {
    status: Mutex<PlaybackToolsStatus>,
    running: AtomicBool,
}

impl PlaybackToolUpdateState {
    pub fn snapshot(&self) -> PlaybackToolsStatus {
        self.status
            .lock()
            .map(|value| value.clone())
            .unwrap_or_default()
    }

    pub fn load_bundled_versions(&self, resource_dir: &Path) {
        let path = resource_dir.join("playback-tools").join("manifest.json");
        let Ok(bytes) = fs::read(path) else { return };
        let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
            return;
        };
        let Some(tools) = value.get("tools").and_then(|tools| tools.as_array()) else {
            return;
        };
        if let Ok(mut status) = self.status.lock() {
            for tool in &mut status.tools {
                tool.installed_version = tools
                    .iter()
                    .find(|entry| {
                        entry.get("name").and_then(|value| value.as_str()) == Some(tool.kind.key())
                    })
                    .and_then(|entry| entry.get("version").and_then(|value| value.as_str()))
                    .map(str::to_owned);
            }
        }
    }
}

pub fn select_release_asset(
    kind: ToolKind,
    release: &GitHubRelease,
) -> Result<&GitHubAsset, String> {
    release
        .assets
        .iter()
        .filter(|asset| github_sha256(asset).is_ok())
        .find(|asset| match kind {
            ToolKind::YtDlp => {
                asset.name == "yt-dlp.exe"
                    && asset
                        .browser_download_url
                        .starts_with("https://github.com/yt-dlp/yt-dlp/releases/download/")
            }
            ToolKind::Mpv => {
                let name = asset.name.to_ascii_lowercase();
                asset
                    .browser_download_url
                    .starts_with("https://github.com/zhongfly/mpv-winbuild/releases/download/")
                    && name.starts_with("mpv-x86_64-")
                    && name.ends_with(".7z")
                    && !["x86_64-v3", "aarch64", "arm64", "debug", "dev", "lgpl"]
                        .iter()
                        .any(|part| name.contains(part))
            }
        })
        .ok_or_else(|| format!("No verified {kind:?} Windows x64 release asset was found"))
}

fn github_sha256(asset: &GitHubAsset) -> Result<&str, String> {
    let value = asset
        .digest
        .as_deref()
        .and_then(|digest| digest.strip_prefix("sha256:"))
        .ok_or_else(|| format!("{} has no SHA-256 digest", asset.name))?;
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(format!("{} has a malformed SHA-256 digest", asset.name));
    }
    Ok(value)
}

pub fn managed_executable(root: &Path, kind: ToolKind) -> Option<PathBuf> {
    let manifest = read_manifest(root).ok()?;
    let record = manifest.slot(kind).active.as_ref()?;
    let path = root.join(&record.executable_path);
    verify_record(root, record).then_some(path)
}

pub fn spawn_update_check(app: AppHandle, root: PathBuf) -> bool {
    let state = app.state::<PlaybackToolUpdateState>();
    if state.running.swap(true, Ordering::AcqRel) {
        return false;
    }
    set_status(&app, "checking", None, None);
    thread::spawn(move || {
        if let Err(error) = update_all(Some(&app), &root) {
            let text = error.to_ascii_lowercase();
            let phase =
                if text.contains("connect") || text.contains("dns") || text.contains("timed out") {
                    "offline"
                } else {
                    "failed"
                };
            log::warn!("Playback-tool update check failed: {error}");
            set_status(&app, phase, Some(error), None);
        }
        app.state::<PlaybackToolUpdateState>()
            .running
            .store(false, Ordering::Release);
    });
    true
}

fn set_status(
    app: &AppHandle,
    phase: &str,
    message: Option<String>,
    tools: Option<Vec<ToolStatus>>,
) {
    let state = app.state::<PlaybackToolUpdateState>();
    let snapshot = if let Ok(mut status) = state.status.lock() {
        status.phase = phase.into();
        status.message = message;
        if let Some(tools) = tools {
            status.tools = tools;
        }
        status.clone()
    } else {
        return;
    };
    if let Err(error) = app.emit(STATUS_EVENT, snapshot) {
        log::debug!("Could not emit playback-tool status: {error}");
    }
}

pub fn refresh_managed_tools_blocking(root: &Path) -> Result<ManagedManifest, String> {
    update_all(None, root)?;
    read_manifest(root)
}

fn update_all(app: Option<&AppHandle>, root: &Path) -> Result<(), String> {
    fs::create_dir_all(root)
        .map_err(|error| format!("Cannot create tool data directory: {error}"))?;
    let mut manifest = read_manifest(root).unwrap_or_default();
    repair_or_rollback(root, &mut manifest, ToolKind::Mpv)?;
    repair_or_rollback(root, &mut manifest, ToolKind::YtDlp)?;
    let mut default_headers = HeaderMap::new();
    if let Ok(token) = std::env::var("GITHUB_TOKEN") {
        if let Ok(mut authorization) = HeaderValue::from_str(&format!("Bearer {token}")) {
            authorization.set_sensitive(true);
            default_headers.insert(AUTHORIZATION, authorization);
        }
    }
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(90))
        .redirect(reqwest::redirect::Policy::limited(5))
        .default_headers(default_headers)
        .build()
        .map_err(|error| format!("Cannot create update client: {error}"))?;
    let mut changed = false;
    let mut results = Vec::new();
    let bundled_versions = app.map(|app| app.state::<PlaybackToolUpdateState>().snapshot().tools);
    for kind in [ToolKind::YtDlp, ToolKind::Mpv] {
        let bundled_version = bundled_versions
            .as_ref()
            .and_then(|tools| tools.iter().find(|tool| tool.kind == kind))
            .and_then(|tool| tool.installed_version.as_deref());
        match update_one(app, &client, root, &mut manifest, kind, bundled_version) {
            Ok((updated, version)) => {
                changed |= updated;
                results.push((kind, version, None));
            }
            Err(error) => results.push((kind, None, Some(error))),
        }
    }
    manifest.last_checked_at = Some(unix_time());
    write_manifest(root, &manifest)?;
    let tools = [ToolKind::Mpv, ToolKind::YtDlp]
        .into_iter()
        .map(|kind| {
            let result = results.iter().find(|(candidate, _, _)| *candidate == kind);
            ToolStatus {
                kind,
                installed_version: manifest
                    .slot(kind)
                    .active
                    .as_ref()
                    .map(|record| record.version.clone())
                    .or_else(|| {
                        bundled_versions
                            .as_ref()
                            .and_then(|tools| tools.iter().find(|tool| tool.kind == kind))
                            .and_then(|tool| tool.installed_version.clone())
                    }),
                latest_version: result.and_then(|(_, value, _)| value.clone()),
                source: if manifest.slot(kind).active.is_some() {
                    "managed".into()
                } else {
                    "bundled".into()
                },
                failure_message: result.and_then(|(_, _, error)| error.clone()),
            }
        })
        .collect();
    if let Some(app) = app {
        if let Ok(mut status) = app.state::<PlaybackToolUpdateState>().status.lock() {
            status.last_check = manifest.last_checked_at;
        }
    }
    let any_failure = results.iter().any(|(_, _, error)| error.is_some());
    let all_failures_are_offline = any_failure
        && results
            .iter()
            .filter_map(|(_, _, error)| error.as_ref())
            .all(|error| {
                let text = error.to_ascii_lowercase();
                text.contains("connect") || text.contains("dns") || text.contains("timed out")
            });
    if let Some(app) = app {
        set_status(
            app,
            if changed {
                "updated"
            } else if all_failures_are_offline {
                "offline"
            } else if any_failure {
                "failed"
            } else {
                "current"
            },
            None,
            Some(tools),
        );
    }
    if any_failure && manifest.mpv.active.is_none() && manifest.yt_dlp.active.is_none() {
        return Err(results
            .into_iter()
            .filter_map(|(_, _, error)| error)
            .collect::<Vec<_>>()
            .join("; "));
    }
    Ok(())
}

fn update_one(
    app: Option<&AppHandle>,
    client: &Client,
    root: &Path,
    manifest: &mut ManagedManifest,
    kind: ToolKind,
    bundled_version: Option<&str>,
) -> Result<(bool, Option<String>), String> {
    let endpoint = format!(
        "https://api.github.com/repos/{}/releases/latest",
        kind.repository()
    );
    let mut request = client
        .get(endpoint)
        .header(USER_AGENT, "Taurus-Music-Player/0.1 updater")
        .header(ACCEPT, "application/vnd.github+json");
    if let Some(etag) = manifest.slot(kind).etag.as_deref() {
        request = request.header(IF_NONE_MATCH, etag);
    }
    let response = request
        .send()
        .map_err(|error| format!("{} release check failed: {error}", kind.key()))?;
    if response.status() == reqwest::StatusCode::NOT_MODIFIED {
        return Ok((
            false,
            manifest
                .slot(kind)
                .active
                .as_ref()
                .map(|record| record.version.clone()),
        ));
    }
    if !response.status().is_success() {
        return Err(format!(
            "{} release check returned HTTP {}",
            kind.key(),
            response.status()
        ));
    }
    let etag = response
        .headers()
        .get(ETAG)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let release: GitHubRelease = response
        .json()
        .map_err(|error| format!("{} release metadata is invalid: {error}", kind.key()))?;
    let asset = select_release_asset(kind, &release)?;
    let version = release.tag_name.trim_start_matches('v').to_string();
    if manifest
        .slot(kind)
        .active
        .as_ref()
        .is_some_and(|record| record.release_id == release.id)
    {
        if let Some(etag) = etag {
            manifest.slot_mut(kind).etag = Some(etag);
        }
        return Ok((false, Some(version)));
    }
    if manifest.slot(kind).active.is_none() && bundled_version == Some(version.as_str()) {
        if let Some(etag) = etag {
            manifest.slot_mut(kind).etag = Some(etag);
        }
        return Ok((false, Some(version)));
    }
    if let Some(app) = app {
        set_status(
            app,
            "downloading",
            Some(format!("Downloading {} {version}", kind.key())),
            None,
        );
    }
    install_release(client, root, manifest, kind, &release, asset)?;
    if let Some(etag) = etag {
        manifest.slot_mut(kind).etag = Some(etag);
    }
    if let Some(app) = app {
        set_status(
            app,
            "validating",
            Some(format!("Validated {} {version}", kind.key())),
            None,
        );
    }
    Ok((true, Some(version)))
}

fn install_release(
    client: &Client,
    root: &Path,
    manifest: &mut ManagedManifest,
    kind: ToolKind,
    release: &GitHubRelease,
    asset: &GitHubAsset,
) -> Result<(), String> {
    if asset.size == 0 || asset.size > kind.max_bytes() {
        return Err(format!(
            "{} asset size {} exceeds its allowed limit",
            kind.key(),
            asset.size
        ));
    }
    let stage = root
        .join("staging")
        .join(format!("{}-{}", kind.key(), release.id));
    if stage.exists() {
        fs::remove_dir_all(&stage).map_err(|error| format!("Cannot clear staging: {error}"))?;
    }
    fs::create_dir_all(&stage).map_err(|error| format!("Cannot create staging: {error}"))?;
    let archive = stage.join(&asset.name);
    let response = client
        .get(&asset.browser_download_url)
        .header(USER_AGENT, "Taurus-Music-Player/0.1 updater")
        .send()
        .map_err(|error| format!("{} download failed: {error}", kind.key()))?;
    let downloaded = download_bounded(response, &archive, kind.max_bytes())?;
    if downloaded != asset.size {
        let _ = fs::remove_dir_all(&stage);
        return Err(format!(
            "{} download was incomplete (expected {}, received {})",
            kind.key(),
            asset.size,
            downloaded
        ));
    }
    let expected = github_sha256(asset)?;
    let actual = sha256_file(&archive)?;
    if !actual.eq_ignore_ascii_case(expected) {
        let _ = fs::remove_dir_all(&stage);
        return Err(format!("{} checksum did not match GitHub", kind.key()));
    }
    let prepared = stage.join("prepared");
    fs::create_dir_all(&prepared).map_err(|error| format!("Cannot prepare update: {error}"))?;
    let staged_executable = match kind {
        ToolKind::YtDlp => {
            let target = prepared.join(kind.executable());
            fs::copy(&archive, &target).map_err(|error| format!("Cannot stage yt-dlp: {error}"))?;
            target
        }
        ToolKind::Mpv => {
            sevenz_rust2::decompress_file(&archive, &prepared)
                .map_err(|error| format!("Cannot extract mpv: {error}"))?;
            find_file(&prepared, kind.executable())
                .ok_or_else(|| "The mpv archive did not contain mpv.exe".to_string())?
        }
    };
    validate_executable(&staged_executable)?;
    let executable_hash = sha256_file(&staged_executable)?;
    let relative_inside = staged_executable
        .strip_prefix(&prepared)
        .map_err(|_| "Invalid staged executable path".to_string())?
        .to_path_buf();
    let version = release.tag_name.trim_start_matches('v');
    let immutable_dir = root.join("versions").join(kind.key()).join(format!(
        "{}-{}",
        sanitize_version(version),
        &actual[..12]
    ));
    fs::create_dir_all(
        immutable_dir
            .parent()
            .ok_or_else(|| "Invalid version path".to_string())?,
    )
    .map_err(|error| format!("Cannot create version root: {error}"))?;
    if immutable_dir.exists() {
        fs::remove_dir_all(&immutable_dir)
            .map_err(|error| format!("Cannot replace staged version: {error}"))?;
    }
    fs::rename(&prepared, &immutable_dir)
        .map_err(|error| format!("Cannot activate staged tool: {error}"))?;
    let installed_executable = immutable_dir.join(relative_inside);
    let record = ManagedToolRecord {
        version: version.into(),
        executable_path: installed_executable
            .strip_prefix(root)
            .map_err(|_| "Managed executable escaped its root".to_string())?
            .to_string_lossy()
            .into_owned(),
        executable_sha256: executable_hash,
        archive_sha256: actual,
        source_url: asset.browser_download_url.clone(),
        release_id: release.id,
        activated_at: unix_time(),
    };
    {
        let slot = manifest.slot_mut(kind);
        slot.previous = slot.active.take();
        slot.active = Some(record);
    }
    write_manifest(root, manifest)?;
    let _ = fs::remove_dir_all(&stage);
    prune_versions(root, kind, manifest.slot(kind));
    Ok(())
}

fn download_bounded(mut response: Response, target: &Path, limit: u64) -> Result<u64, String> {
    if !response.status().is_success() {
        return Err(format!("Tool download returned HTTP {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > limit)
    {
        return Err("Tool download exceeds the allowed size".into());
    }
    let mut output =
        File::create(target).map_err(|error| format!("Cannot create download: {error}"))?;
    let mut total = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = response
            .read(&mut buffer)
            .map_err(|error| format!("Download interrupted: {error}"))?;
        if read == 0 {
            break;
        }
        total += read as u64;
        if total > limit {
            return Err("Tool download exceeds the allowed size".into());
        }
        output
            .write_all(&buffer[..read])
            .map_err(|error| format!("Cannot write download: {error}"))?;
    }
    output
        .sync_all()
        .map_err(|error| format!("Cannot flush download: {error}"))?;
    Ok(total)
}

fn validate_executable(path: &Path) -> Result<(), String> {
    let mut child = Command::new(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("{} could not start: {error}", path.display()))?;
    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => {
                return Err(format!(
                    "{} validation exited with {status}",
                    path.display()
                ))
            }
            Ok(None) if started.elapsed() < VALIDATION_TIMEOUT => {
                thread::sleep(Duration::from_millis(50))
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("{} validation timed out", path.display()));
            }
            Err(error) => return Err(format!("{} validation failed: {error}", path.display())),
        }
    }
}

fn repair_or_rollback(
    root: &Path,
    manifest: &mut ManagedManifest,
    kind: ToolKind,
) -> Result<(), String> {
    if manifest
        .slot(kind)
        .active
        .as_ref()
        .is_none_or(|record| verify_record(root, record))
    {
        return Ok(());
    }
    let slot = manifest.slot_mut(kind);
    slot.active = if slot
        .previous
        .as_ref()
        .is_some_and(|record| verify_record(root, record))
    {
        slot.previous.take()
    } else {
        None
    };
    write_manifest(root, manifest)
}

fn verify_record(root: &Path, record: &ManagedToolRecord) -> bool {
    let path = root.join(&record.executable_path);
    path.is_file()
        && sha256_file(&path)
            .map(|hash| hash.eq_ignore_ascii_case(&record.executable_sha256))
            .unwrap_or(false)
}

fn read_manifest(root: &Path) -> Result<ManagedManifest, String> {
    serde_json::from_slice(&fs::read(root.join(MANIFEST_FILE)).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

fn write_manifest(root: &Path, manifest: &ManagedManifest) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let temporary = root.join("manifest.json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(manifest).map_err(|error| error.to_string())?,
    )
    .map_err(|error| format!("Cannot write tool manifest: {error}"))?;
    replace_file(&temporary, &root.join(MANIFEST_FILE))
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source = source
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(format!(
            "Cannot atomically activate tool manifest: {}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(source, destination)
        .map_err(|error| format!("Cannot atomically activate tool manifest: {error}"))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file =
        File::open(path).map_err(|error| format!("Cannot hash {}: {error}", path.display()))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Cannot hash {}: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn find_file(root: &Path, name: &str) -> Option<PathBuf> {
    for entry in fs::read_dir(root).ok()?.flatten() {
        let path = entry.path();
        if path.is_file()
            && path
                .file_name()
                .is_some_and(|value| value.eq_ignore_ascii_case(name))
        {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = find_file(&path, name) {
                return Some(found);
            }
        }
    }
    None
}

fn prune_versions(root: &Path, kind: ToolKind, slot: &ToolSlot) {
    let keep = [slot.active.as_ref(), slot.previous.as_ref()]
        .into_iter()
        .flatten()
        .filter_map(|record| {
            root.join(&record.executable_path)
                .parent()
                .map(Path::to_path_buf)
        })
        .collect::<Vec<_>>();
    if let Ok(entries) = fs::read_dir(root.join("versions").join(kind.key())) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() && !keep.iter().any(|kept| kept.starts_with(&path)) {
                let _ = fs::remove_dir_all(path);
            }
        }
    }
}

fn sanitize_version(version: &str) -> String {
    version
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn unix_time() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    fn digest(c: char) -> String {
        format!("sha256:{}", c.to_string().repeat(64))
    }
    fn release(assets: &[(&str, String)]) -> GitHubRelease {
        GitHubRelease {
            id: 42,
            tag_name: "v1".into(),
            assets: assets
                .iter()
                .map(|(name, digest)| GitHubAsset {
                    name: (*name).into(),
                    browser_download_url: if name.starts_with("mpv-") {
                        format!(
                            "https://github.com/zhongfly/mpv-winbuild/releases/download/v1/{name}"
                        )
                    } else {
                        format!("https://github.com/yt-dlp/yt-dlp/releases/download/v1/{name}")
                    },
                    size: 123,
                    digest: Some(digest.clone()),
                })
                .collect(),
        }
    }
    #[test]
    fn yt_dlp_requires_the_exact_stable_windows_asset() {
        let release = release(&[
            ("yt-dlp_x86.exe", digest('1')),
            ("yt-dlp.exe", digest('2')),
            ("yt-dlp_linux", digest('3')),
        ]);
        assert_eq!(
            select_release_asset(ToolKind::YtDlp, &release)
                .unwrap()
                .name,
            "yt-dlp.exe"
        );
    }
    #[test]
    fn mpv_accepts_only_the_standard_x86_64_archive() {
        let release = release(&[
            ("mpv-x86_64-v3-20260820-git.7z", digest('1')),
            ("mpv-x86_64-20260820-git-lgpl.7z", digest('2')),
            ("mpv-aarch64-20260820-git.7z", digest('3')),
            ("mpv-x86_64-20260820-git.7z", digest('4')),
        ]);
        assert_eq!(
            select_release_asset(ToolKind::Mpv, &release).unwrap().name,
            "mpv-x86_64-20260820-git.7z"
        );
    }
    #[test]
    fn selection_rejects_assets_without_github_sha256_digest() {
        let mut release = release(&[("yt-dlp.exe", digest('2'))]);
        release.assets[0].digest = None;
        assert!(select_release_asset(ToolKind::YtDlp, &release).is_err());
    }
    #[test]
    fn malformed_digest_is_rejected() {
        let release = release(&[("yt-dlp.exe", "sha256:not-a-digest".into())]);
        assert!(select_release_asset(ToolKind::YtDlp, &release).is_err());
    }

    #[test]
    fn asset_download_url_must_stay_in_the_allowlisted_repository() {
        let mut release = release(&[("yt-dlp.exe", digest('2'))]);
        release.assets[0].browser_download_url = "https://example.com/yt-dlp.exe".into();
        assert!(select_release_asset(ToolKind::YtDlp, &release).is_err());
    }

    #[test]
    fn invalid_active_executable_rolls_back_to_previous_version() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("taurus-updater-rollback-{unique}"));
        fs::create_dir_all(&root).unwrap();
        let active_path = PathBuf::from("versions/yt-dlp/current/yt-dlp.exe");
        let previous_path = PathBuf::from("versions/yt-dlp/previous/yt-dlp.exe");
        fs::create_dir_all(root.join(active_path.parent().unwrap())).unwrap();
        fs::create_dir_all(root.join(previous_path.parent().unwrap())).unwrap();
        fs::write(root.join(&active_path), b"corrupt").unwrap();
        fs::write(root.join(&previous_path), b"verified previous").unwrap();
        let previous_hash = sha256_file(&root.join(&previous_path)).unwrap();
        let record = |version: &str, path: &Path, hash: &str| ManagedToolRecord {
            version: version.into(),
            executable_path: path.to_string_lossy().into_owned(),
            executable_sha256: hash.into(),
            archive_sha256: "0".repeat(64),
            source_url: "https://github.com/allowlisted".into(),
            release_id: 1,
            activated_at: 1,
        };
        let mut manifest = ManagedManifest::default();
        manifest.yt_dlp.active = Some(record("new", &active_path, &"1".repeat(64)));
        manifest.yt_dlp.previous = Some(record("old", &previous_path, &previous_hash));

        repair_or_rollback(&root, &mut manifest, ToolKind::YtDlp).unwrap();

        assert_eq!(manifest.yt_dlp.active.as_ref().unwrap().version, "old");
        assert!(manifest.yt_dlp.previous.is_none());
        fs::remove_dir_all(root).unwrap();
    }
}
