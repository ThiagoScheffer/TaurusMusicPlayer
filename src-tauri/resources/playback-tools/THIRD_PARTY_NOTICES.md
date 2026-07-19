# Bundled Playback Tools

Taurus Music Player bundles unmodified Windows x64 executables of mpv and yt-dlp
so audio playback works after installation without separate user setup.

## mpv

- Build: `20260610-git-304426c`
- Source: `shinchiro/mpv-winbuild-cmake`
- Archive: `mpv-x86_64-20260610-git-304426c.7z`
- Source URL: https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20260610
- Copyright and GPL notice: `licenses/mpv-Copyright.txt` and
  `licenses/mpv-GPL-2.0-or-later.txt`

## yt-dlp

- Version: `2026.07.04`
- Source URL: https://github.com/yt-dlp/yt-dlp/releases/tag/2026.07.04
- The bundled Windows executable contains third-party components. Its upstream
  license notices are included in `licenses/yt-dlp-THIRD_PARTY_LICENSES.txt`.
- The yt-dlp source license is included in `licenses/yt-dlp-Unlicense.txt`.

See `manifest.json` for pinned download URLs and SHA-256 values. Replace these
files only as part of a Taurus release and update this notice and manifest with
the verified upstream version and checksums.
