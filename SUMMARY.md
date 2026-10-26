# Retro Scan — handoff SUMMARY

## Live URL
**https://kv1400x.github.io/retro-scan/**

- Repo: https://github.com/KV1400X/retro-scan (public, GitHub Pages from `main` `/`)
- Local path: `/workspace/retro-scan/`
- Authenticated as **KV1400X** via `gh`; Pages enabled (legacy branch deploy)

## Name
**Retro Scan** — dark tool-shop PWA for small-object photogrammetry capture.

## How Nick uses it on iPhone 12
1. Open the live URL in **Safari** (not Chrome — Add to Home Screen reliability).
2. Share → **Add to Home Screen** → open the icon (fullscreen).
3. Allow **Camera** (rear / environment).
4. Use Low / Eye / High rings; ~24–36 overlapping stills for adapters/ports.
5. Gallery to delete/retake; **Export** → prefer **Share ZIP…** (Files / AirDrop). Download fallback exists but iOS Safari is flaky.
6. On PC: unzip → follow `pc-pipeline/README.md` (COLMAP or Meshroom).

## LiDAR one-liner
**iPhone 12 has no rear LiDAR; TrueDepth/Face ID depth is front-only and not available to Safari/web apps — capture here, reconstruct on PC.**

## Proven this session
- Live HTTPS 200 for app shell, manifest, JS, fflate.
- Chromium smoke: capture 3 photos → ZIP with `scan-…/img_00N.jpg` + `scan.json`.
- `process_scan.py --dry-run` validates image folders and prints COLMAP commands (COLMAP not installed on the box).

## PC pipeline status
- `pc-pipeline/process_scan.py` — ZIP/folder/video → COLMAP sparse (+ optional dense), optional Open3D cleanup, optional ArUco detect hint.
- `requirements.txt` + install notes for macOS/Windows/Linux.
- Dry-run works without COLMAP. Full reconstruct needs Nick to `brew install colmap` (or Windows release / apt).

## iOS caveats
- Camera requires HTTPS (Pages provides it).
- Blob `<a download>` can be unreliable → Web Share with files is the primary path.
- Service worker caches the UI shell only; camera still needs a live secure context.
- Optional video mode deferred (v1.1); stills are solid for v1.

## Privacy
No home address or personal phone anywhere in the public site.

## Next improvements
- Short video mode + client-side frame extract before ZIP.
- DeviceMotion / compass hints for orbit completeness.
- On-device ArUco overlay when markers detected in the viewfinder.
- Private source mirror if desired; Pages repo is public by design.
- Wire OpenMVS after COLMAP dense for cleaner meshes.
