import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query

import db.history_repo as repo
from db.database import get_db
from models.schemas import Detection, DetectionResponse, HistoryItem, HistoryResponse
from services.bounds_service import resolve_bounds_from_image_row, resolve_corners_from_image_row
from services.detection_dimensions_service import infer_detection_dimensions

router = APIRouter()


async def _db():
    async with get_db() as db:
        yield db


@router.get("/history", response_model=HistoryResponse)
async def get_history(
    page:     int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    db=Depends(_db),
):
    total, rows = await repo.list_detections(db, page, per_page)
    items = [
        HistoryItem(
            detection_id=row[0],
            image_id=row[1],
            model_used=row[2],
            class_count=len(json.loads(row[3])),
            detected_classes=[d["label"] for d in json.loads(row[3])],
            image_thumbnail_url=f"/api/images/{row[1]}",   # FR-HIST-02
            timestamp=row[7],
        )
        for row in rows
    ]
    return HistoryResponse(total=total, page=page, items=items)


@router.get("/history/{detection_id}", response_model=DetectionResponse)
async def get_history_detection(detection_id: str, db=Depends(_db)):
    """Return a stored detection payload so frontend can restore without re-running inference."""
    det_row = await repo.get_detection(db, detection_id)
    if not det_row:
        raise HTTPException(404, f"Detection '{detection_id}' not found")

    img_row = await repo.get_image(db, det_row[1])  # image_id
    if not img_row:
        raise HTTPException(404, f"Source image not found for detection '{detection_id}'")

    detections = json.loads(det_row[3])  # detections_json
    mask_url = ""
    if det_row[4]:
        mask_filename = Path(det_row[4]).name
        mask_url = f"/api/masks/{mask_filename}"
    det_width, det_height = infer_detection_dimensions(
        det_row[3],
        det_row[4],
        img_row[3],
        img_row[4],
    )

    return DetectionResponse(
        detection_id=det_row[0],
        image_id=det_row[1],
        model_used=det_row[2],
        inference_time_ms=det_row[5] or 0,
        image_width=det_width,
        image_height=det_height,
        detections=[Detection(**item) for item in detections],
        mask_url=mask_url,
        image_bounds=resolve_bounds_from_image_row(img_row),
        image_corners=resolve_corners_from_image_row(img_row),
    )


@router.delete("/history/{detection_id}", status_code=204)
async def delete_history(detection_id: str, db=Depends(_db)):
    deleted = await repo.delete_detection(db, detection_id)
    if not deleted:
        raise HTTPException(404, f"Detection '{detection_id}' not found")
