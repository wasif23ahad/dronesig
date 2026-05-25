import json
from datetime import datetime, timezone

import aiosqlite


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def save_image(
    db: aiosqlite.Connection,
    image_id: str, filename: str, filepath: str,
    width: int, height: int, size_bytes: int,
    lat: float = None, lng: float = None,
    sw_lng: float = None, sw_lat: float = None,
    ne_lng: float = None, ne_lat: float = None,
    tl_lng: float = None, tl_lat: float = None,
    tr_lng: float = None, tr_lat: float = None,
    br_lng: float = None, br_lat: float = None,
    bl_lng: float = None, bl_lat: float = None,
) -> None:
    await db.execute(
        """
        INSERT INTO images (
            image_id, filename, filepath, width, height, size_bytes,
            latitude, longitude, sw_lng, sw_lat, ne_lng, ne_lat, created_at,
            tl_lng, tl_lat, tr_lng, tr_lat, br_lng, br_lat, bl_lng, bl_lat
        )
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            image_id, filename, filepath, width, height, size_bytes,
            lat, lng, sw_lng, sw_lat, ne_lng, ne_lat, _now(),
            tl_lng, tl_lat, tr_lng, tr_lat, br_lng, br_lat, bl_lng, bl_lat,
        ),
    )
    await db.commit()


async def get_image(db: aiosqlite.Connection, image_id: str):
    async with db.execute(
        "SELECT * FROM images WHERE image_id = ?", (image_id,)
    ) as cur:
        return await cur.fetchone()


async def list_images(db: aiosqlite.Connection) -> list:
    async with db.execute(
        "SELECT * FROM images ORDER BY created_at DESC"
    ) as cur:
        return await cur.fetchall()


async def update_image_bounds(
    db: aiosqlite.Connection,
    image_id: str,
    lat: float,
    lng: float,
    sw_lng: float,
    sw_lat: float,
    ne_lng: float,
    ne_lat: float,
    tl_lng: float,
    tl_lat: float,
    tr_lng: float,
    tr_lat: float,
    br_lng: float,
    br_lat: float,
    bl_lng: float,
    bl_lat: float,
) -> bool:
    cur = await db.execute(
        """
        UPDATE images
        SET
            latitude = ?,
            longitude = ?,
            sw_lng = ?,
            sw_lat = ?,
            ne_lng = ?,
            ne_lat = ?,
            tl_lng = ?,
            tl_lat = ?,
            tr_lng = ?,
            tr_lat = ?,
            br_lng = ?,
            br_lat = ?,
            bl_lng = ?,
            bl_lat = ?
        WHERE image_id = ?
        """,
        (
            lat, lng, sw_lng, sw_lat, ne_lng, ne_lat,
            tl_lng, tl_lat, tr_lng, tr_lat, br_lng, br_lat, bl_lng, bl_lat,
            image_id,
        ),
    )
    await db.commit()
    return cur.rowcount > 0


async def save_detection(
    db: aiosqlite.Connection,
    detection_id: str, image_id: str, model_used: str,
    detections: list, mask_path: str,
    inference_time_ms: int, confidence_threshold: float,
) -> None:
    await db.execute(
        "INSERT INTO detections VALUES (?,?,?,?,?,?,?,?)",
        (detection_id, image_id, model_used, json.dumps(detections),
         mask_path, inference_time_ms, confidence_threshold, _now()),
    )
    await db.commit()


async def get_detection(db: aiosqlite.Connection, detection_id: str):
    async with db.execute(
        "SELECT * FROM detections WHERE detection_id = ?", (detection_id,)
    ) as cur:
        return await cur.fetchone()


async def list_detections(
    db: aiosqlite.Connection, page: int, per_page: int
) -> tuple[int, list]:
    async with db.execute("SELECT COUNT(*) FROM detections") as cur:
        total = (await cur.fetchone())[0]
    offset = (page - 1) * per_page
    async with db.execute(
        "SELECT * FROM detections ORDER BY created_at DESC LIMIT ? OFFSET ?",
        (per_page, offset),
    ) as cur:
        rows = await cur.fetchall()
    return total, rows


async def delete_detection(db: aiosqlite.Connection, detection_id: str) -> bool:
    async with db.execute(
        "SELECT COUNT(*) FROM detections WHERE detection_id = ?", (detection_id,)
    ) as cur:
        exists = (await cur.fetchone())[0]
    if not exists:
        return False
    await db.execute("DELETE FROM detections WHERE detection_id = ?", (detection_id,))
    await db.commit()
    return True
