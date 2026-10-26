#!/usr/bin/env python3
"""
Retro Scan — PC photogrammetry companion

Takes a folder of JPEGs (from the Retro Scan PWA ZIP) or a video, runs COLMAP
(sparse + optional dense), exports PLY/OBJ, optional Open3D cleanup, optional
ArUco scale if markers are present.

Usage:
  python process_scan.py /path/to/scan-folder
  python process_scan.py /path/to/scan-YYYYMMDD-HHMM.zip
  python process_scan.py /path/to/video.mp4 --from-video --fps 2
  python process_scan.py /path/to/scan-folder --dry-run
  python process_scan.py /path/to/scan-folder --dense --cleanup --aruco-mm 50

Requires: COLMAP on PATH (or --colmap /path/to/colmap). ffmpeg for video.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}


def which(cmd: str) -> str | None:
    return shutil.which(cmd)


def run(cmd: list[str], dry: bool) -> None:
    print("+", " ".join(cmd))
    if dry:
        return
    subprocess.run(cmd, check=True)


def list_images(folder: Path) -> list[Path]:
    imgs = [p for p in sorted(folder.iterdir()) if p.suffix.lower() in IMAGE_EXTS and p.is_file()]
    return imgs


def extract_zip(zip_path: Path, dest: Path) -> Path:
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(dest)
    # Prefer nested scan-* folder if present
    subs = [p for p in dest.iterdir() if p.is_dir()]
    if len(subs) == 1:
        return subs[0]
    return dest


def extract_video_frames(video: Path, out_dir: Path, fps: float, dry: bool) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    pattern = str(out_dir / "img_%03d.jpg")
    ff = which("ffmpeg")
    if not ff:
        raise SystemExit("ffmpeg not found on PATH. Install ffmpeg to extract frames.")
    run(
        [ff, "-y", "-i", str(video), "-vf", f"fps={fps}", "-q:v", "2", pattern],
        dry,
    )


def validate_images(folder: Path) -> list[Path]:
    imgs = list_images(folder)
    if len(imgs) < 3:
        raise SystemExit(f"Need at least 3 images in {folder} (found {len(imgs)}).")
    print(f"Found {len(imgs)} images in {folder}")
    meta = folder / "scan.json"
    if meta.exists():
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
            print(f"  scan.json: {data.get('photoCount')} photos, notes={data.get('notes')!r}")
        except Exception as e:
            print(f"  (could not parse scan.json: {e})")
    return imgs


def colmap_bin(explicit: str | None) -> str:
    if explicit:
        return explicit
    for name in ("colmap", "COLMAP"):
        p = which(name)
        if p:
            return p
    raise SystemExit(
        "COLMAP not found on PATH.\n"
        "Install:\n"
        "  macOS:   brew install colmap\n"
        "  Windows: download release from https://github.com/colmap/colmap/releases\n"
        "  Linux:   sudo apt install colmap   OR build from source\n"
        "Or pass --colmap /path/to/colmap\n"
        "Alternative GUI: AliceVision Meshroom (https://alicevision.org)"
    )


def run_colmap(
    images: Path,
    work: Path,
    colmap: str,
    dense: bool,
    dry: bool,
) -> Path:
    db = work / "database.db"
    sparse = work / "sparse"
    dense_dir = work / "dense"
    sparse.mkdir(parents=True, exist_ok=True)

    run(
        [
            colmap,
            "feature_extractor",
            "--database_path",
            str(db),
            "--image_path",
            str(images),
            "--ImageReader.single_camera",
            "1",
            "--SiftExtraction.use_gpu",
            "1",
        ],
        dry,
    )
    # If GPU fails in real runs, user can re-run with --SiftExtraction.use_gpu 0
    run(
        [
            colmap,
            "exhaustive_matcher",
            "--database_path",
            str(db),
            "--SiftMatching.use_gpu",
            "1",
        ],
        dry,
    )
    run(
        [
            colmap,
            "mapper",
            "--database_path",
            str(db),
            "--image_path",
            str(images),
            "--output_path",
            str(sparse),
        ],
        dry,
    )

    # Export sparse model 0 as PLY / TXT
    model0 = sparse / "0"
    if not dry and not model0.exists():
        # Sometimes mapper writes directly into sparse/
        model0 = sparse

    export_ply = work / "sparse_points.ply"
    run(
        [
            colmap,
            "model_converter",
            "--input_path",
            str(model0),
            "--output_path",
            str(export_ply),
            "--output_type",
            "PLY",
        ],
        dry,
    )

    mesh_out = export_ply
    if dense:
        dense_dir.mkdir(parents=True, exist_ok=True)
        run(
            [
                colmap,
                "image_undistorter",
                "--image_path",
                str(images),
                "--input_path",
                str(model0),
                "--output_path",
                str(dense_dir),
                "--output_type",
                "COLMAP",
            ],
            dry,
        )
        run(
            [
                colmap,
                "patch_match_stereo",
                "--workspace_path",
                str(dense_dir),
                "--workspace_format",
                "COLMAP",
                "--PatchMatchStereo.geom_consistency",
                "true",
            ],
            dry,
        )
        run(
            [
                colmap,
                "stereo_fusion",
                "--workspace_path",
                str(dense_dir),
                "--workspace_format",
                "COLMAP",
                "--input_type",
                "geometric",
                "--output_path",
                str(dense_dir / "fused.ply"),
            ],
            dry,
        )
        # Optional Poisson meshing (needs COLMAP built with CGAL)
        poisson = dense_dir / "meshed-poisson.ply"
        try:
            run(
                [
                    colmap,
                    "poisson_mesher",
                    "--input_path",
                    str(dense_dir / "fused.ply"),
                    "--output_path",
                    str(poisson),
                ],
                dry,
            )
            mesh_out = poisson
        except subprocess.CalledProcessError:
            print("poisson_mesher failed (optional). Using fused.ply point cloud.")
            mesh_out = dense_dir / "fused.ply"

    return mesh_out


def open3d_cleanup(mesh_path: Path, out_path: Path, dry: bool) -> None:
    if dry:
        print(f"+ [dry-run] Open3D cleanup {mesh_path} -> {out_path}")
        return
    try:
        import open3d as o3d
    except ImportError:
        print("open3d not installed; skip cleanup. pip install open3d")
        return

    print(f"Open3D cleanup: {mesh_path}")
    if mesh_path.suffix.lower() == ".ply":
        # Try as triangle mesh first, else point cloud
        mesh = o3d.io.read_triangle_mesh(str(mesh_path))
        if mesh.is_empty() or len(mesh.triangles) == 0:
            pcd = o3d.io.read_point_cloud(str(mesh_path))
            pcd, _ = pcd.remove_statistical_outlier(nb_neighbors=20, std_ratio=2.0)
            pcd = pcd.voxel_down_sample(voxel_size=0.002)
            o3d.io.write_point_cloud(str(out_path), pcd)
            print(f"Wrote cleaned point cloud: {out_path}")
            return
        mesh.remove_duplicated_vertices()
        mesh.remove_duplicated_triangles()
        mesh.remove_degenerate_triangles()
        mesh.remove_non_manifold_edges()
        mesh, _ = mesh.remove_statistical_outlier(nb_neighbors=20, std_ratio=2.0) if hasattr(mesh, "remove_statistical_outlier") else (mesh, None)
        # Simpler: cluster connected triangles and keep largest
        try:
            triangle_clusters, cluster_n_triangles, _ = mesh.cluster_connected_triangles()
            import numpy as np

            triangle_clusters = np.asarray(triangle_clusters)
            cluster_n_triangles = np.asarray(cluster_n_triangles)
            largest = cluster_n_triangles.argmax()
            triangles_to_remove = triangle_clusters != largest
            mesh.remove_triangles_by_mask(triangles_to_remove)
            mesh.remove_unreferenced_vertices()
        except Exception as e:
            print(f"  cluster cleanup skipped: {e}")
        o3d.io.write_triangle_mesh(str(out_path), mesh)
        print(f"Wrote cleaned mesh: {out_path}")
    else:
        shutil.copy2(mesh_path, out_path)


def try_aruco_scale(images_dir: Path, marker_mm: float, dry: bool) -> float | None:
    """Detect ArUco markers; return approximate scale factor mm/unit if found.
    This is a heuristic helper — full metric scale usually needs COLMAP + known baseline.
    """
    if dry:
        print(f"+ [dry-run] ArUco detect (marker {marker_mm} mm) in {images_dir}")
        return None
    try:
        import cv2
        import numpy as np
    except ImportError:
        print("opencv not installed; skip ArUco. pip install opencv-python-headless")
        return None

    # OpenCV ArUco API varies by version
    try:
        aruco = cv2.aruco
        dictionary = aruco.getPredefinedDictionary(aruco.DICT_4X4_50)
        params = aruco.DetectorParameters()
        detector = aruco.ArucoDetector(dictionary, params)
        detect_fn = lambda img: detector.detectMarkers(img)
    except Exception:
        try:
            dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
            params = cv2.aruco.DetectorParameters_create()
            detect_fn = lambda img: cv2.aruco.detectMarkers(img, dictionary, parameters=params)[:2]
        except Exception as e:
            print(f"ArUco API unavailable: {e}")
            return None

    found = 0
    for img_path in list_images(images_dir)[:40]:
        img = cv2.imread(str(img_path))
        if img is None:
            continue
        corners, ids = detect_fn(img)[:2]
        if ids is not None and len(ids):
            found += 1
    if found:
        print(f"ArUco: markers seen in {found} image(s). Physical size set to {marker_mm} mm.")
        print("  Tip: use COLMAP model_aligner or MeshLab known-distance scale with two marker corners.")
        print(f"  Known edge length: {marker_mm} mm")
        return marker_mm
    print("ArUco: no markers detected in sample images.")
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description="Retro Scan PC pipeline (COLMAP)")
    ap.add_argument("input", type=Path, help="Image folder, ZIP from Retro Scan, or video")
    ap.add_argument("--out", type=Path, default=None, help="Work/output directory")
    ap.add_argument("--colmap", type=str, default=None, help="Path to colmap binary")
    ap.add_argument("--dense", action="store_true", help="Run dense stereo + fusion")
    ap.add_argument("--cleanup", action="store_true", help="Open3D mesh/point cleanup")
    ap.add_argument("--aruco-mm", type=float, default=None, help="ArUco marker side length in mm")
    ap.add_argument("--from-video", action="store_true", help="Treat input as video; extract frames")
    ap.add_argument("--fps", type=float, default=2.0, help="Frame extract rate for video")
    ap.add_argument("--dry-run", action="store_true", help="Validate + print commands only")
    ap.add_argument("--cpu", action="store_true", help="Hint: print GPU-off note (edit if needed)")
    args = ap.parse_args()

    inp = args.input.expanduser().resolve()
    if not inp.exists():
        raise SystemExit(f"Input not found: {inp}")

    work = (args.out or Path.cwd() / f"retroscan_out_{inp.stem}").expanduser().resolve()
    work.mkdir(parents=True, exist_ok=True)
    images_dir = work / "images"
    images_dir.mkdir(exist_ok=True)

    print("=== Retro Scan PC pipeline ===")
    print(f"Input: {inp}")
    print(f"Work:  {work}")
    if args.dry_run:
        print("Mode:  DRY RUN (no COLMAP execution)")

    # Stage images
    if args.from_video or inp.suffix.lower() in {".mp4", ".mov", ".m4v", ".avi", ".mkv"}:
        extract_video_frames(inp, images_dir, args.fps, args.dry_run)
    elif inp.suffix.lower() == ".zip":
        staging = work / "_unzip"
        staging.mkdir(exist_ok=True)
        root = extract_zip(inp, staging)
        # Copy images into images_dir
        for p in list_images(root):
            shutil.copy2(p, images_dir / p.name)
        meta = root / "scan.json"
        if meta.exists():
            shutil.copy2(meta, images_dir / "scan.json")
            shutil.copy2(meta, work / "scan.json")
    elif inp.is_dir():
        for p in list_images(inp):
            shutil.copy2(p, images_dir / p.name)
        meta = inp / "scan.json"
        if meta.exists():
            shutil.copy2(meta, images_dir / "scan.json")
            shutil.copy2(meta, work / "scan.json")
    else:
        raise SystemExit("Input must be a folder, .zip, or video file.")

    if not args.dry_run or list_images(images_dir) or True:
        # In dry-run after video extract may be empty; still validate when possible
        imgs = list_images(images_dir)
        if not imgs and args.dry_run and (args.from_video or inp.suffix.lower() in {".mp4", ".mov"}):
            print("Dry-run: would extract video frames into", images_dir)
        else:
            validate_images(images_dir)

    if args.aruco_mm:
        try_aruco_scale(images_dir, args.aruco_mm, args.dry_run)

    if args.cpu:
        print("Note: if SIFT GPU fails, re-run COLMAP steps with --SiftExtraction.use_gpu 0")

    try:
        colmap = colmap_bin(args.colmap)
        print(f"COLMAP: {colmap}")
    except SystemExit as e:
        if args.dry_run:
            print(f"[dry-run] COLMAP missing — commands below are still printed.\n{e}")
            colmap = args.colmap or "colmap"
        else:
            raise

    mesh = run_colmap(images_dir, work, colmap, dense=args.dense, dry=args.dry_run)
    print(f"Primary output: {mesh}")

    if args.cleanup:
        cleaned = work / ("cleaned_mesh.ply" if args.dense else "cleaned_points.ply")
        open3d_cleanup(mesh if not args.dry_run else work / "sparse_points.ply", cleaned, args.dry_run)

    print("\nDone.")
    print("Next: open the PLY in MeshLab / Blender, scale with ArUco or caliper, export STL.")
    print("Meshroom alternative: import the images folder into Meshroom and run the default graph.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
