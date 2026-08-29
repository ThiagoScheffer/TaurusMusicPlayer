use app_lib::tool_updater::refresh_managed_tools_blocking;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn copy_tree(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let target = destination.join(entry.file_name());
        if entry.path().is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn main() -> Result<(), String> {
    if std::env::var("TAURUS_RELEASE_TOOL_REFRESH").as_deref() != Ok("1") {
        return Err("Set TAURUS_RELEASE_TOOL_REFRESH=1 to run this release-only command.".into());
    }
    let destination = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("resources/playback-tools"));
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let stage = std::env::temp_dir().join(format!(
        "taurus-release-tools-{}-{unique}",
        std::process::id()
    ));
    let manifest = refresh_managed_tools_blocking(&stage)?;
    let mpv = manifest
        .mpv
        .active
        .as_ref()
        .ok_or_else(|| "No verified mpv release was downloaded".to_string())?;
    let yt_dlp = manifest
        .yt_dlp
        .active
        .as_ref()
        .ok_or_else(|| "No verified yt-dlp release was downloaded".to_string())?;
    let mpv_executable = stage.join(&mpv.executable_path);
    let yt_dlp_executable = stage.join(&yt_dlp.executable_path);
    let next = destination.join("windows-x64.next");
    if next.exists() {
        fs::remove_dir_all(&next).map_err(|error| error.to_string())?;
    }
    copy_tree(
        mpv_executable
            .parent()
            .ok_or_else(|| "Invalid mpv layout".to_string())?,
        &next.join("mpv"),
    )?;
    fs::copy(&yt_dlp_executable, next.join("yt-dlp.exe")).map_err(|error| error.to_string())?;
    let current = destination.join("windows-x64");
    if current.exists() {
        fs::remove_dir_all(&current).map_err(|error| error.to_string())?;
    }
    fs::rename(&next, &current).map_err(|error| error.to_string())?;
    let bundled = json!({
        "schemaVersion": 1,
        "platform": "windows-x64",
        "tools": [
            {
                "name": "mpv", "version": mpv.version, "sourceUrl": mpv.source_url,
                "sourceArchiveSha256": mpv.archive_sha256,
                "bundledExecutable": "windows-x64/mpv/mpv.exe",
                "bundledExecutableSha256": mpv.executable_sha256,
                "licenseNotice": "licenses/mpv-Copyright.txt"
            },
            {
                "name": "yt-dlp", "version": yt_dlp.version, "sourceUrl": yt_dlp.source_url,
                "sourceArchiveSha256": yt_dlp.archive_sha256,
                "bundledExecutable": "windows-x64/yt-dlp.exe",
                "bundledExecutableSha256": yt_dlp.executable_sha256,
                "licenseNotice": "licenses/yt-dlp-THIRD_PARTY_LICENSES.txt"
            }
        ]
    });
    fs::write(
        destination.join("manifest.json"),
        serde_json::to_vec_pretty(&bundled).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let mpv_archive = Path::new(&mpv.source_url)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("mpv-x86_64.7z");
    let notice = format!(
        "# Bundled Playback Tools\n\nTaurus Music Player bundles unmodified Windows x64 executables of mpv and yt-dlp\nso audio playback works after installation without separate user setup.\n\n## mpv\n\n- Build: `{}`\n- Source: `zhongfly/mpv-winbuild`\n- Archive: `{}`\n- Source URL: https://github.com/zhongfly/mpv-winbuild/releases/tag/{}\n- Copyright and GPL notice: `licenses/mpv-Copyright.txt` and\n  `licenses/mpv-GPL-2.0-or-later.txt`\n\n## yt-dlp\n\n- Version: `{}`\n- Source URL: https://github.com/yt-dlp/yt-dlp/releases/tag/{}\n- The bundled Windows executable contains third-party components. Its upstream\n  license notices are included in `licenses/yt-dlp-THIRD_PARTY_LICENSES.txt`.\n- The yt-dlp source license is included in `licenses/yt-dlp-Unlicense.txt`.\n\nSee `manifest.json` for pinned download URLs and SHA-256 values. The\nrelease-only `npm run refresh:playback-tools` command refreshes these files\nafter verifying upstream digests and executable startup.\n",
        mpv.version, mpv_archive, mpv.version, yt_dlp.version, yt_dlp.version
    );
    fs::write(destination.join("THIRD_PARTY_NOTICES.md"), notice)
        .map_err(|error| error.to_string())?;
    fs::remove_dir_all(stage).map_err(|error| error.to_string())?;
    println!(
        "Refreshed bundled mpv {} and yt-dlp {}",
        mpv.version, yt_dlp.version
    );
    Ok(())
}
