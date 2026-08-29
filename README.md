# Taurus Music Player

Taurus Music Player is a compact Tauri v2 desktop player for coding and study. It uses a React/Vite frontend, a Rust backend, and `mpv` + `yt-dlp` for low-memory YouTube audio-only playback in the desktop app.

![Taurus Music Player](media/taurusmusicplayer-v1.jpeg)

## Current project

- React 19, TypeScript, Vite, and `react-youtube`
- Tauri v2 desktop shell and Rust 2021 backend
- Audio-only desktop playback through `mpv` and `yt-dlp`
- Background updates for the playback tools with verified offline fallbacks
- Browser-only Vite fallback through the YouTube embed player
- Queue, sessions/playlists, focus timer, focus modes, blacklist, and local settings
- System tray controls, hide-to-tray behavior, and global shortcuts

## Latest fixes and improvements

### Restored and observable external playback

- `mpv` diagnostics are captured instead of being discarded.
- Playback reports extraction failures, unavailable media, codec/runtime errors,
  audio-device failures, and unexpected `mpv` exits to the player UI.
- The external-audio poller now tracks loading, playing, paused, idle, ended, and
  failed states, including media title and selected audio device when available.
- Initial volume and mute settings are applied when playback starts.
- `mpv` runs with `--no-config`, preventing an incompatible user configuration
  from silently changing Taurus playback.
- Browser-only development retains the YouTube iframe fallback.

### Self-updating playback tools

- Taurus checks for stable `mpv` and `yt-dlp` releases in a background thread on
  every desktop launch, without blocking startup or current playback.
- Automatic updates use only the allowlisted `yt-dlp/yt-dlp` and
  `zhongfly/mpv-winbuild` GitHub repositories.
- ETags are persisted so unchanged releases return `304 Not Modified` without
  downloading the binaries again.
- Downloads have time and size limits and must match GitHub's SHA-256 digest.
- mpv archives are extracted with pinned `sevenz-rust2 0.21.5`; candidates must
  pass an executable `--version` check before activation.
- Updates are stored under the writable local application-data directory. Taurus
  never modifies installed files under Program Files.
- Version directories are retained as immutable active/previous installations.
  A failed or corrupted active version rolls back to the previous verified copy.
- Playback resolves each tool independently in this order: verified managed
  version, bundled offline fallback, then an existing PATH installation.
- **Options → Settings → Playback Tools** shows installed/latest versions,
  source, update phase, and failures, with a manual **Check now** action.

The currently bundled Windows x64 fallbacks are mpv
`2026-08-28-e8673660ab` and yt-dlp `2026.08.19`.

### Desktop shortcuts

- `Ctrl+Alt+P` - Play/Pause
- `Ctrl+Alt+N` - Next track
- `Ctrl+Alt+B` - Previous track
- `Ctrl+Alt+M` - Mute/Unmute

## Prerequisites

| Tool | Purpose | Check command |
| --- | --- | --- |
| Node.js | Frontend/tooling; current LTS recommended | `node --version` |
| npm | Installed with Node.js | `npm --version` |
| Rust | Rust 1.93+ stable toolchain | `rustc --version` |
| MSVC Build Tools | Tauri Windows builds | Install Visual Studio Build Tools with **Desktop development with C++** |
| WebView2 Runtime | Tauri Windows runtime | Usually installed on Windows 10/11 |
| mpv | Optional PATH fallback for CLI/source troubleshooting | `mpv --version` |
| yt-dlp | Optional PATH fallback for CLI/source troubleshooting | `yt-dlp --version` |

Install the Rust formatter once if it is missing:

```powershell
rustup component add rustfmt
```

### mpv and yt-dlp resolution

The desktop app first uses a verified version in its local application-data
directory, then its bundled Windows x64 fallback, and finally PATH or the
following legacy troubleshooting locations:

```text
mpv
mpv.exe
C:\Program Files\MPV Player\mpv.exe

yt-dlp
yt-dlp.exe
C:\Users\Thiago\AppData\Local\Microsoft\WinGet\Links\yt-dlp.exe
C:\Tools\yt-dlp\yt-dlp.exe
C:\Program Files\yt-dlp\yt-dlp.exe
```

Release installers bundle pinned, verified Windows x64 copies of `mpv` and
`yt-dlp`, so end users do not need to install either tool separately. Automatic
updates are stored per user and the bundled copies remain available for offline
startup and recovery. Browser-only Vite development uses the YouTube embed
fallback and does not require either executable.

## First-time setup

Run from the repository root:

```powershell
npm ci

Push-Location src-tauri
cargo check
Pop-Location
```

Use `npm install` only when you intentionally changed JavaScript dependencies and need to update `package-lock.json`.

## Development

### Frontend only

Starts Vite at `http://localhost:5173`. Use this for React/UI work. Tauri-only features, such as the tray, native window controls, global shortcuts, and mpv playback, are unavailable in this mode.

```powershell
npm run dev
```

Build and preview the frontend production bundle:

```powershell
npm run build
npm run preview
```

### Full desktop app

Starts Vite and launches the Tauri application with the Rust backend, system tray, global shortcuts, and mpv audio-only playback.

```powershell
npm run tauri -- dev
```

Equivalent command:

```powershell
npx tauri dev
```

Closing the main window hides it to the system tray. Use **Quit** from the tray menu to fully exit the application.

## Build, checks, and tests

### Frontend build

```powershell
npm run build
```

Runs TypeScript project builds and creates the Vite output in `dist/`.

### Frontend lint

```powershell
npm run lint
```

### Frontend tests

```powershell
npm test
```

### Rust compile check

```powershell
Push-Location src-tauri
cargo check
Pop-Location
```

### Rust tests

```powershell
Push-Location src-tauri
cargo test
Pop-Location
```

### Rust formatting and linting

```powershell
Push-Location src-tauri
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
Pop-Location
```

### Complete pre-release validation

```powershell
npm run lint
npm test
npm run build

Push-Location src-tauri
cargo fmt --check
cargo check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
Pop-Location
```

Then perform a desktop smoke test:

```powershell
npm run tauri -- dev
```

Verify that you can add a YouTube URL, play/pause/stop, move through the queue, change volume/mute, seek, control playback through the tray, use global shortcuts while unfocused, and hide/quit through the tray.

Also open **Options → Settings → Playback Tools**, verify both bundled or managed
versions are displayed, and run **Check now**. A network failure must leave
playback available through the last verified or bundled tools.

## Release build

Create optimized, installable desktop artifacts:

```powershell
npm run tauri -- build
```

Equivalent command:

```powershell
npx tauri build
```

Tauri runs `npm run build` automatically before bundling because `src-tauri/tauri.conf.json` configures it as `beforeBuildCommand`.

The current configuration uses `"targets": "all"`. Windows installers normally appear under:

```text
src-tauri\target\release\bundle\msi\
src-tauri\target\release\bundle\nsis\
```

The exact output folders depend on the installed packaging tools and target platform. All release output is rooted at:

```text
src-tauri\target\release\bundle\
```

### Recommended release sequence

```powershell
npm ci
npm run lint
npm test
npm run build

Push-Location src-tauri
cargo fmt --check
cargo check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
Pop-Location

npm run refresh:playback-tools
npm run tauri -- build
```

`refresh:playback-tools` is a Windows release-only command. It downloads only
the allowlisted stable assets, verifies their GitHub SHA-256 digests, validates
both executables, replaces the bundled resource staging directory, and updates
the checksum manifest and third-party notice.

Install the generated installer on a clean Windows account before distribution.
Confirm audio playback works with no `mpv` or `yt-dlp` installed in `PATH`, both
versions appear in Options, a first-run update check completes, and playback
still works when the machine is offline.

### Bundled playback tool maintenance

The release installer packages `src-tauri/resources/playback-tools/` as Tauri resources. It contains the complete portable mpv runtime, `yt-dlp.exe`, source/license notices, and a checksum manifest.

Refresh the bundled tools from the repository root:

```powershell
npm run refresh:playback-tools
```

The command accepts exactly `yt-dlp.exe` from the latest stable yt-dlp release
and a standard `mpv-x86_64-*.7z` zhongfly build. ARM64, x86_64-v3, debug, dev,
and LGPL variants are rejected. It preserves the complete portable mpv runtime,
updates `manifest.json` and `THIRD_PARTY_NOTICES.md`, and fails without replacing
the active bundle if verification or validation does not complete.

Do not manually run `yt-dlp -U` against installed or bundled resources. Runtime
updates are managed by Taurus, and release assets should be refreshed with the
command above so checksums and notices remain reproducible.

## Command reference

| Task | Command |
| --- | --- |
| Install locked JavaScript dependencies | `npm ci` |
| Start browser frontend | `npm run dev` |
| Build frontend | `npm run build` |
| Lint frontend | `npm run lint` |
| Run frontend tests | `npm test` |
| Preview frontend bundle | `npm run preview` |
| Run desktop app in development | `npm run tauri -- dev` |
| Create desktop release bundle | `npm run tauri -- build` |
| Refresh verified bundled playback tools | `npm run refresh:playback-tools` |
| Rust check | `Push-Location src-tauri; cargo check; Pop-Location` |
| Rust tests | `Push-Location src-tauri; cargo test; Pop-Location` |
| Rust formatting check | `Push-Location src-tauri; cargo fmt --check; Pop-Location` |
| Rust lint | `Push-Location src-tauri; cargo clippy --all-targets --all-features -- -D warnings; Pop-Location` |

## Project structure

```text
src/                         React/TypeScript application
  features/player/           Player UI, queue, playback, browser fallback
  features/sessions/         Saved sessions/playlists
  features/focus-timer/      Pomodoro/focus timer
  features/focus-modes/      Focus mode configuration
  features/settings/         Settings/options window
  runtime/                   Runtime state and commands
  ipc/                       Typed frontend event contracts

src-tauri/                   Rust/Tauri backend
  src/lib.rs                 Tray, shortcuts, mpv IPC, window behavior
  src/playback/              mpv + yt-dlp process orchestration
  src/tool_updater.rs        Verified background updater, manifests, rollback
  src/bin/refresh_playback_tools.rs
                             Release-only bundled-tool refresh command
  resources/playback-tools/ Portable offline tools, licenses, checksum manifest
  capabilities/              Tauri permissions
  tauri.conf.json            Desktop/build configuration

docs/                        Architecture notes
ARCHITECTURE_AUDIT.md        Architecture audit
```

## Troubleshooting

### Tauri starts but audio does not play

Open **Options → Settings → Playback Tools** first. Confirm that mpv and yt-dlp
show either `managed` or `bundled` as their source, then use **Check now**.

Run Tauri from a terminal to see captured `mpv` diagnostics:

```powershell
npm run tauri -- dev
```

Failures now include useful details for YouTube extraction, unavailable media,
audio devices, codecs, missing runtime files, and unexpected process exits. If
both managed and bundled tools are unavailable, verify optional PATH fallbacks:

```powershell
mpv --version
yt-dlp --version
```

Deleting a damaged managed version is normally unnecessary: the startup check
verifies its executable hash and automatically rolls back or uses the bundled
fallback.

### Playback-tool update fails

Taurus continues with the active verified or bundled tools when GitHub is
offline, rate-limited, returns malformed metadata, or a download fails checksum,
size, extraction, or executable validation. Check the Options status and Rust
logs, then retry with **Check now**. Never replace files in Program Files by hand.

### Browser mode has no tray/window controls

That is expected. Use desktop development mode:

```powershell
npm run tauri -- dev
```

### `cargo fmt` is unavailable

```powershell
rustup component add rustfmt
```

### Windows release bundling fails

Confirm that the C++ desktop workload and WebView2 Runtime are installed, then run:

```powershell
Push-Location src-tauri
cargo check
Pop-Location

npm run tauri -- build
```
