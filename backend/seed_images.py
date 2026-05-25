import shutil
from pathlib import Path

try:
    from PIL import Image
    import db.history_repo as repo
    from config import UPLOAD_DIR
    from db.database import get_db, init_db
    from services.bounds_service import resolve_image_geo
    from services.metadata_service import extract_metadata
except ModuleNotFoundError as exc:
    raise SystemExit(
        f"Missing dependency: {exc.name}.\n"
        "Recommended (Windows PowerShell):\n"
        "  powershell -ExecutionPolicy Bypass -File .\\scripts\\seed_images.ps1\n"
        "Manual fallback:\n"
        "  1) cd backend\n"
        "  2) python -m venv --copies .seed_venv\n"
        "  3) .seed_venv\\Scripts\\pip install -r requirements.txt\n"
        "  4) .seed_venv\\Scripts\\python seed_images.py"
    ) from exc

SAMPLE_IMAGES: dict[str, str] = {
    "DJI_20260308132416_0059_V.JPG": "c0172fb4-08e7-4adc-b4ee-96cb20c4c059",
    "DJI_20260308132417_0060_V.JPG": "976f3af1-3f88-4e9d-a7d7-8a2f0f39c060",
    "DJI_20260308132419_0061_V.JPG": "6a0d31d1-fce1-4a72-9252-79b18e996061",
}
SAMPLE_IMAGE_ALIASES: dict[str, list[str]] = {
    "DJI_20260308132416_0059_V.JPG": ["dji_sample_0059.jpg"],
    "DJI_20260308132417_0060_V.JPG": ["dji_sample_0060.jpg"],
    "DJI_20260308132419_0061_V.JPG": ["dji_sample_0061.jpg"],
}
FALLBACK_SOURCE_NAME = "DJI_20260308132419_0061_V.JPG"


def _normalized(value: str) -> str:
    return value.strip().lower()

def _resolve_source_image(filename: str) -> Path | None:
    backend_dir = Path(__file__).resolve().parent
    repo_root = backend_dir.parent
    repo_uploads = repo_root / "uploads"
    candidates = [
        repo_root / filename,             # assessment root
        repo_uploads / filename,          # root uploads folder
        backend_dir / "uploads" / filename,  # backend uploads with original names
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def _resolve_fallback_source(excluded: str) -> Path | None:
    if _normalized(FALLBACK_SOURCE_NAME) != _normalized(excluded):
        fallback = _resolve_source_image(FALLBACK_SOURCE_NAME)
        if fallback is not None:
            return fallback

    for sample_name in SAMPLE_IMAGES:
        if _normalized(sample_name) == _normalized(excluded):
            continue
        fallback = _resolve_source_image(sample_name)
        if fallback is not None:
            return fallback
    return None


async def _merge_duplicate_sample_rows(db, canonical_image_id: str, filename: str) -> None:
    """
    Keep only the canonical sample UUID for each PRD sample filename.
    Any duplicate rows (e.g. uploaded copies with random IDs) are merged.
    """
    alias_names = SAMPLE_IMAGE_ALIASES.get(filename, [])
    all_names = [filename, *alias_names]
    placeholders = ",".join("?" for _ in all_names)
    query = (
        f"SELECT image_id FROM images "
        f"WHERE lower(filename) IN ({placeholders}) AND image_id != ?"
    )
    params = tuple(_normalized(name) for name in all_names) + (canonical_image_id,)
    async with db.execute(query, params) as cur:
        duplicate_rows = await cur.fetchall()

    for (duplicate_id,) in duplicate_rows:
        await db.execute(
            "UPDATE detections SET image_id = ? WHERE image_id = ?",
            (canonical_image_id, duplicate_id),
        )
        await db.execute(
            "DELETE FROM images WHERE image_id = ?",
            (duplicate_id,),
        )

    if duplicate_rows:
        await db.commit()
        print(f"[seed_images] Merged {len(duplicate_rows)} duplicate row(s) for {filename}")


async def ensure_sample_images_seeded() -> None:
    await init_db()
    UPLOAD_DIR.mkdir(exist_ok=True)
    backend_dir = Path(__file__).resolve().parent
    repo_root = backend_dir.parent
    root_uploads_dir = repo_root / "uploads"
    root_uploads_dir.mkdir(exist_ok=True)

    async with get_db() as db:
        for filename, image_id in SAMPLE_IMAGES.items():
            existing = await repo.get_image(db, image_id)
            existing_source: Path | None = None
            if existing and existing[2]:
                existing_source = Path(existing[2])
            if existing_source is not None and not existing_source.is_absolute():
                existing_source = backend_dir / existing_source
            if existing_source is None or not existing_source.exists():
                probe = _resolve_source_image(filename)
                if probe is not None:
                    existing_source = probe
            metadata_geo = extract_metadata(str(existing_source)) if existing_source and existing_source.exists() else None
            canonical_geo = resolve_image_geo(filename, metadata_geo)
            if existing:
                await repo.update_image_bounds(
                    db,
                    image_id=image_id,
                    lat=canonical_geo["latitude"],
                    lng=canonical_geo["longitude"],
                    sw_lng=canonical_geo["sw_lng"],
                    sw_lat=canonical_geo["sw_lat"],
                    ne_lng=canonical_geo["ne_lng"],
                    ne_lat=canonical_geo["ne_lat"],
                    tl_lng=canonical_geo["tl_lng"],
                    tl_lat=canonical_geo["tl_lat"],
                    tr_lng=canonical_geo["tr_lng"],
                    tr_lat=canonical_geo["tr_lat"],
                    br_lng=canonical_geo["br_lng"],
                    br_lat=canonical_geo["br_lat"],
                    bl_lng=canonical_geo["bl_lng"],
                    bl_lat=canonical_geo["bl_lat"],
                )
                await _merge_duplicate_sample_rows(db, image_id, filename)
                print(f"[seed_images] Updated bounds for existing sample {filename} -> {image_id}")
                continue

            source = _resolve_source_image(filename)
            if source is None:
                fallback_source = _resolve_fallback_source(filename)
                if fallback_source is None:
                    print(f"[seed_images] Skipped missing sample: {filename}")
                    continue
                synthetic_source = root_uploads_dir / filename
                shutil.copy2(fallback_source, synthetic_source)
                source = synthetic_source
                print(
                    f"[seed_images] Missing {filename}; cloned from {fallback_source.name} "
                    f"for PRD sample seeding."
                )
            else:
                synthetic_source = root_uploads_dir / filename
                if not synthetic_source.exists():
                    shutil.copy2(source, synthetic_source)

            ext = source.suffix.lower() if source.suffix.lower() in (".jpg", ".jpeg", ".png") else ".jpg"
            destination = UPLOAD_DIR / f"{image_id}{ext}"
            if not destination.exists():
                shutil.copy2(source, destination)

            with Image.open(destination) as img:
                width, height = img.size
            size_bytes = destination.stat().st_size

            geo = resolve_image_geo(filename, extract_metadata(str(destination)))
            await repo.save_image(
                db,
                image_id=image_id,
                filename=filename,
                filepath=str(destination),
                width=width,
                height=height,
                size_bytes=size_bytes,
                lat=geo["latitude"],
                lng=geo["longitude"],
                sw_lng=geo["sw_lng"],
                sw_lat=geo["sw_lat"],
                ne_lng=geo["ne_lng"],
                ne_lat=geo["ne_lat"],
                tl_lng=geo["tl_lng"],
                tl_lat=geo["tl_lat"],
                tr_lng=geo["tr_lng"],
                tr_lat=geo["tr_lat"],
                br_lng=geo["br_lng"],
                br_lat=geo["br_lat"],
                bl_lng=geo["bl_lng"],
                bl_lat=geo["bl_lat"],
            )
            await _merge_duplicate_sample_rows(db, image_id, filename)
            print(f"[seed_images] Seeded {filename} -> {image_id}")


if __name__ == "__main__":
    import asyncio

    asyncio.run(ensure_sample_images_seeded())
