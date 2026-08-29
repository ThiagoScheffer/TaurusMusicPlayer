# Bundled Playback Tools

Taurus Music Player bundles unmodified Windows x64 executables of mpv and yt-dlp
so audio playback works after installation without separate user setup.

## mpv

- Build: `2026-08-28-e8673660ab`
- Source: `zhongfly/mpv-winbuild`
- Archive: `mpv-x86_64-20260828-git-e8673660ab.7z`
- Source URL: https://github.com/zhongfly/mpv-winbuild/releases/tag/2026-08-28-e8673660ab
- Copyright and GPL notice: `licenses/mpv-Copyright.txt` and
  `licenses/mpv-GPL-2.0-or-later.txt`

## yt-dlp

- Version: `2026.08.19`
- Source URL: https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19
- The bundled Windows executable contains third-party components. Its upstream
  license notices are included in `licenses/yt-dlp-THIRD_PARTY_LICENSES.txt`.
- The yt-dlp source license is included in `licenses/yt-dlp-Unlicense.txt`.

See `manifest.json` for pinned download URLs and SHA-256 values. The
release-only `npm run refresh:playback-tools` command refreshes these files
after verifying upstream digests and executable startup.
