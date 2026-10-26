# Retro Scan

Installable iPhone web app (PWA) for **photogrammetry capture** of small objects (water-bottle size or smaller) — tool ports, adapters, small parts.

**Live app:** https://kv1400x.github.io/retro-scan/

## What it does

1. Uses the **rear camera** in Safari to capture high-res stills.  
2. Guides a 3-ring orbit (Low / Eye / High), ~24–36 photos recommended.  
3. Exports a ZIP of JPEGs + `scan.json` (Share sheet or download).  
4. You run **COLMAP** (or Meshroom) on a PC — see [`pc-pipeline/`](pc-pipeline/).

## What it does *not* do

- **No on-device mesh.** iPhone 12 has no rear LiDAR; TrueDepth/Face ID is front-only and **not available to Safari/web apps**.  
- No cloud reconstruction. Export → process locally.

## Add to Home Screen (iPhone)

1. Open https://kv1400x.github.io/retro-scan/ in **Safari**.  
2. Tap **Share** → **Add to Home Screen**.  
3. Open **Retro Scan** from the home screen (fullscreen PWA).  
4. Allow **Camera** when prompted.

## Capture → export

1. Place the part on a matte background with even light (lazy susan optional).  
2. Select Low / Eye / High rings; orbit with ~60% overlap.  
3. Tap the shutter; review in Gallery (delete/retake as needed).  
4. **Export** → **Share ZIP…** (preferred on iOS) or Download.  
5. On a PC: follow [`pc-pipeline/README.md`](pc-pipeline/README.md).

## Project layout

```
retro-scan/
  index.html, styles.css, js/app.js, sw.js, manifest.json
  icons/  vendor/fflate.min.js
  pc-pipeline/   # COLMAP companion
  SUMMARY.md
```

## Local preview

```bash
cd retro-scan
python3 -m http.server 8080
# open http://localhost:8080  (camera may require HTTPS / localhost exception)
```

## License

MIT for Retro Tool Shop / personal use.
