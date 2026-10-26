# Retro Scan — PC processing pipeline

Take the ZIP from the **Retro Scan** iPhone PWA, unpack (or pass the ZIP), and reconstruct a mesh on your computer with COLMAP.

> iPhone 12 Safari cannot access LiDAR or Face ID depth. Reconstruction happens here on the PC.

## Quick start

```bash
# 1) Install Python deps (optional helpers)
cd pc-pipeline
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 2) Install COLMAP + ffmpeg (see below)

# 3) Validate a scan folder without running COLMAP
python process_scan.py /path/to/scan-YYYYMMDD-HHMM --dry-run

# 4) Sparse reconstruction
python process_scan.py /path/to/scan-YYYYMMDD-HHMM.zip --out ~/scans/part1

# 5) Dense + cleanup + ArUco hint (50 mm markers)
python process_scan.py ~/scans/part1/images --out ~/scans/part1 --dense --cleanup --aruco-mm 50
```

### From video instead of stills

```bash
python process_scan.py ~/Movies/orbit.mov --from-video --fps 2 --out ~/scans/fromvid
```

## Install COLMAP

### macOS
```bash
brew install colmap ffmpeg
```

### Windows
1. Download a COLMAP release: https://github.com/colmap/colmap/releases  
2. Unzip and add the folder containing `colmap.exe` to PATH, **or** pass `--colmap C:\path\to\colmap.exe`.  
3. Install ffmpeg: https://ffmpeg.org/download.html (or `winget install ffmpeg`).

### Linux (Debian/Ubuntu)
```bash
sudo apt update
sudo apt install colmap ffmpeg
# If the distro package is old/missing CUDA, build from source:
# https://colmap.github.io/install.html
```

### GPU note
The script enables SIFT GPU by default. If feature extraction fails on a machine without CUDA/Metal support, re-run the COLMAP commands printed by `--dry-run` with `--SiftExtraction.use_gpu 0` and `--SiftMatching.use_gpu 0`, or patch those flags in `process_scan.py`.

## Alternative: Meshroom (GUI)

1. Install [AliceVision Meshroom](https://alicevision.org/#meshroom).  
2. Drag the `images/` folder (from the Retro Scan ZIP) into Meshroom.  
3. Hit **Start** on the default photogrammetry graph.  
4. Export textured OBJ / save the project.  
5. Scale in MeshLab/Blender using ArUco edge length or a caliper measurement.

## Scaling to real units

- Print [ArUco DICT_4X4](https://chev.me/arucogen/) markers at a known size (e.g. 50 mm edge) and include them in frame.  
- After reconstruction, measure two known corners in MeshLab → **Filters → Normals/Matrices → Transform: Scale**.  
- Or caliper a physical feature on the part and scale the mesh so that distance matches.

## Outputs

| Path | Meaning |
|------|---------|
| `images/` | Staged JPEGs (+ `scan.json` if present) |
| `sparse/0/` | COLMAP sparse model |
| `sparse_points.ply` | Sparse point cloud |
| `dense/fused.ply` | Dense fused cloud (`--dense`) |
| `dense/meshed-poisson.ply` | Poisson mesh if available |
| `cleaned_*.ply` | Open3D cleanup (`--cleanup`) |

Export STL from MeshLab/Blender for slicers (Bambu / Prusa / Cura).

## Dry-run

`--dry-run` validates the image folder / ZIP layout and prints every COLMAP command without executing. Useful when COLMAP is not installed on the machine yet.

```bash
python process_scan.py ./example-scan --dry-run
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Too few matches | More overlap (~60%), better light, matte background, more photos (24–40) |
| Glossy / black parts | Dust with dry powder / spray matte, cross-polarized light |
| Sparse OK, dense fails | Need CUDA GPU for `patch_match_stereo`; use Meshroom CPU or skip `--dense` |
| Scale wrong | Use ArUco or known caliper distance; COLMAP is unitless by default |
| iPhone ZIP won't open | Re-export via **Share → Save to Files** in Retro Scan |

## Privacy

Do not put personal addresses or phone numbers into `scan.json` notes if you share the ZIP publicly.
