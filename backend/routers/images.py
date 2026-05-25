from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

import db.history_repo as repo
from db.database import get_db
from models.schemas import ImageBoundsUpdateRequest, ImageCornersUpdateRequest, ImageRecord
from services.bounds_service import bounds_to_corners, bounds_to_geo, corners_to_geo, resolve_corners_from_image_row

router = APIRouter()

CANONICAL_SAMPLE_IMAGE_IDS = {
    "dji_20260308132416_0059_v.jpg": "c0172fb4-08e7-4adc-b4ee-96cb20c4c059",
    "dji_20260308132417_0060_v.jpg": "976f3af1-3f88-4e9d-a7d7-8a2f0f39c060",
    "dji_20260308132419_0061_v.jpg": "6a0d31d1-fce1-4a72-9252-79b18e996061",
}


async def _db():
    async with get_db() as db:
        yield db


def _to_image_record(row: tuple) -> ImageRecord:
    corners = resolve_corners_from_image_row(row)
    return ImageRecord(
        image_id=row[0],
        filename=row[1],
        width=row[3],
        height=row[4],
        size_bytes=row[5],
        latitude=row[6],
        longitude=row[7],
        sw_lng=row[8],
        sw_lat=row[9],
        ne_lng=row[10],
        ne_lat=row[11],
        tl_lng=corners[0][0],
        tl_lat=corners[0][1],
        tr_lng=corners[1][0],
        tr_lat=corners[1][1],
        br_lng=corners[2][0],
        br_lat=corners[2][1],
        bl_lng=corners[3][0],
        bl_lat=corners[3][1],
        image_corners=corners,
        created_at=row[12],
    )


@router.get("/images", response_model=list[ImageRecord])
async def list_images(db=Depends(_db)):
    """List all registered images (FR-UPLOAD-05: sample images dropdown)."""
    rows = await repo.list_images(db)
    by_id = {row[0]: row for row in rows}
    selected_rows = []
    used_sample_names = set()

    for row in rows:
        filename_key = str(row[1]).strip().lower()
        canonical_id = CANONICAL_SAMPLE_IMAGE_IDS.get(filename_key)
        if canonical_id:
            if filename_key in used_sample_names:
                continue
            selected_rows.append(by_id.get(canonical_id, row))
            used_sample_names.add(filename_key)
            continue
        selected_rows.append(row)

    return [_to_image_record(row) for row in selected_rows]


@router.get("/images/{image_id}")
async def get_image(image_id: str, db=Depends(_db)):
    """Serve original drone image bytes (SRS §6.4)."""
    row = await repo.get_image(db, image_id)
    if not row:
        raise HTTPException(404, f"Image '{image_id}' not found")
    filepath = Path(row[2])
    if not filepath.exists():
        raise HTTPException(404, "Image file missing from disk")
    return FileResponse(filepath)


@router.patch("/images/{image_id}/bounds", response_model=ImageRecord)
async def update_image_bounds(
    image_id: str,
    payload: ImageBoundsUpdateRequest,
    db=Depends(_db),
):
    if payload.ne_lng <= payload.sw_lng or payload.ne_lat <= payload.sw_lat:
        raise HTTPException(422, "Bounds must satisfy NE > SW for both longitude and latitude")

    row = await repo.get_image(db, image_id)
    if not row:
        raise HTTPException(404, f"Image '{image_id}' not found")

    corners = bounds_to_corners([payload.sw_lng, payload.sw_lat, payload.ne_lng, payload.ne_lat])
    geo = bounds_to_geo([payload.sw_lng, payload.sw_lat, payload.ne_lng, payload.ne_lat])
    updated = await repo.update_image_bounds(
        db,
        image_id=image_id,
        lat=geo["latitude"],
        lng=geo["longitude"],
        sw_lng=geo["sw_lng"],
        sw_lat=geo["sw_lat"],
        ne_lng=geo["ne_lng"],
        ne_lat=geo["ne_lat"],
        tl_lng=corners[0][0],
        tl_lat=corners[0][1],
        tr_lng=corners[1][0],
        tr_lat=corners[1][1],
        br_lng=corners[2][0],
        br_lat=corners[2][1],
        bl_lng=corners[3][0],
        bl_lat=corners[3][1],
    )
    if not updated:
        raise HTTPException(500, "Failed to update image bounds")

    updated_row = await repo.get_image(db, image_id)
    if not updated_row:
        raise HTTPException(500, "Image disappeared after bounds update")
    return _to_image_record(updated_row)


@router.patch("/images/{image_id}/corners", response_model=ImageRecord)
async def update_image_corners(
    image_id: str,
    payload: ImageCornersUpdateRequest,
    db=Depends(_db),
):
    row = await repo.get_image(db, image_id)
    if not row:
        raise HTTPException(404, f"Image '{image_id}' not found")

    corners = [
        [payload.tl_lng, payload.tl_lat],
        [payload.tr_lng, payload.tr_lat],
        [payload.br_lng, payload.br_lat],
        [payload.bl_lng, payload.bl_lat],
    ]
    geo = corners_to_geo(corners)

    updated = await repo.update_image_bounds(
        db,
        image_id=image_id,
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
    if not updated:
        raise HTTPException(500, "Failed to update image corners")

    updated_row = await repo.get_image(db, image_id)
    if not updated_row:
        raise HTTPException(500, "Image disappeared after corner update")
    return _to_image_record(updated_row)
