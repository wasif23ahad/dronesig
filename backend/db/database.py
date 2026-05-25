from contextlib import asynccontextmanager
import uuid

import aiosqlite
from config import DB_PATH

_SCHEMA = """
CREATE TABLE IF NOT EXISTS images (
    image_id   TEXT PRIMARY KEY,
    filename   TEXT NOT NULL,
    filepath   TEXT NOT NULL,
    width      INTEGER,
    height     INTEGER,
    size_bytes INTEGER,
    latitude   REAL,
    longitude  REAL,
    sw_lng     REAL,
    sw_lat     REAL,
    ne_lng     REAL,
    ne_lat     REAL,
    created_at TEXT NOT NULL,
    tl_lng     REAL,
    tl_lat     REAL,
    tr_lng     REAL,
    tr_lat     REAL,
    br_lng     REAL,
    br_lat     REAL,
    bl_lng     REAL,
    bl_lat     REAL
);
CREATE TABLE IF NOT EXISTS detections (
    detection_id         TEXT PRIMARY KEY,
    image_id             TEXT NOT NULL REFERENCES images(image_id),
    model_used           TEXT NOT NULL,
    detections_json      TEXT NOT NULL,
    mask_path            TEXT,
    inference_time_ms    INTEGER,
    confidence_threshold REAL,
    created_at           TEXT NOT NULL
);
"""


def _is_uuid(value: str | None) -> bool:
    if not value:
        return False
    try:
        uuid.UUID(value)
        return True
    except (ValueError, TypeError):
        return False


async def _normalize_legacy_image_ids(db: aiosqlite.Connection) -> None:
    """
    Section 7 expects UUID primary keys.
    Older seed scripts could create non-UUID image IDs (e.g., dji_sample_*).
    If a duplicate row with the same filename and a valid UUID exists, migrate
    detections to the UUID row and drop the legacy non-UUID row.
    """
    async with db.execute("SELECT image_id, filename FROM images") as cur:
        rows = await cur.fetchall()

    by_filename: dict[str, list[str]] = {}
    for image_id, filename in rows:
        by_filename.setdefault(filename, []).append(image_id)

    for _filename, ids in by_filename.items():
        canonical_uuid = next((image_id for image_id in ids if _is_uuid(image_id)), None)
        if not canonical_uuid:
            continue

        for legacy_id in (image_id for image_id in ids if not _is_uuid(image_id)):
            await db.execute(
                "UPDATE detections SET image_id = ? WHERE image_id = ?",
                (canonical_uuid, legacy_id),
            )
            await db.execute(
                "DELETE FROM images WHERE image_id = ?",
                (legacy_id,),
            )


async def _connect() -> aiosqlite.Connection:
    db = await aiosqlite.connect(DB_PATH)
    await db.execute("PRAGMA foreign_keys = ON")
    return db


async def _ensure_images_corner_columns(db: aiosqlite.Connection) -> None:
    async with db.execute("PRAGMA table_info(images)") as cur:
        columns = await cur.fetchall()
    existing_names = {row[1] for row in columns}

    required = [
        ("tl_lng", "REAL"),
        ("tl_lat", "REAL"),
        ("tr_lng", "REAL"),
        ("tr_lat", "REAL"),
        ("br_lng", "REAL"),
        ("br_lat", "REAL"),
        ("bl_lng", "REAL"),
        ("bl_lat", "REAL"),
    ]
    for name, col_type in required:
        if name not in existing_names:
            await db.execute(f"ALTER TABLE images ADD COLUMN {name} {col_type}")

    # Backfill corners from existing rectangular bounds for legacy rows.
    await db.execute(
        """
        UPDATE images
        SET
            tl_lng = COALESCE(tl_lng, sw_lng),
            tl_lat = COALESCE(tl_lat, ne_lat),
            tr_lng = COALESCE(tr_lng, ne_lng),
            tr_lat = COALESCE(tr_lat, ne_lat),
            br_lng = COALESCE(br_lng, ne_lng),
            br_lat = COALESCE(br_lat, sw_lat),
            bl_lng = COALESCE(bl_lng, sw_lng),
            bl_lat = COALESCE(bl_lat, sw_lat)
        """
    )

    # Backfill rectangular bounds from corners if needed.
    await db.execute(
        """
        UPDATE images
        SET
            sw_lng = COALESCE(sw_lng, MIN(tl_lng, tr_lng, br_lng, bl_lng)),
            sw_lat = COALESCE(sw_lat, MIN(tl_lat, tr_lat, br_lat, bl_lat)),
            ne_lng = COALESCE(ne_lng, MAX(tl_lng, tr_lng, br_lng, bl_lng)),
            ne_lat = COALESCE(ne_lat, MAX(tl_lat, tr_lat, br_lat, bl_lat))
        """
    )

    # Keep centroid synchronized for rows that only had corner data.
    await db.execute(
        """
        UPDATE images
        SET
            longitude = COALESCE(longitude, (tl_lng + tr_lng + br_lng + bl_lng) / 4.0),
            latitude = COALESCE(latitude, (tl_lat + tr_lat + br_lat + bl_lat) / 4.0)
        """
    )


async def init_db() -> None:
    db = await _connect()
    try:
        await db.executescript(_SCHEMA)
        await _ensure_images_corner_columns(db)
        await _normalize_legacy_image_ids(db)
        await db.commit()
    finally:
        await db.close()


@asynccontextmanager
async def get_db():
    db = await _connect()
    try:
        yield db
    finally:
        await db.close()
