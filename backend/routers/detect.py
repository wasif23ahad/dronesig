import base64
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from PIL import Image as PILImage, UnidentifiedImageError

import db.history_repo as repo
from config import MAX_UPLOAD_B, OUTPUT_DIR, UPLOAD_DIR
from db.database import get_db
from models.schemas import Detection, DetectionResponse
from services.bounds_service import resolve_bounds_from_image_row, resolve_corners_from_image_row, resolve_image_geo
from services.metadata_service import extract_metadata

router = APIRouter()


async def _db():
    async with get_db() as db:
        yield db


async def _parse_multipart(request: Request, db) -> tuple[str, str, float]:
    """Handle FR-DETECT-07: multipart/form-data upload + detect in one shot."""
    form = await request.form()
    file = form.get("file")
    try:
        threshold = float(form.get("confidence_threshold", 0.5))
    except (TypeError, ValueError):
        raise HTTPException(422, "confidence_threshold must be 0.0-1.0")

    if not file:
        raise HTTPException(422, "Field 'file' is required for multipart detect")
    if file.content_type not in ("image/jpeg", "image/png"):
        raise HTTPException(422, "Only JPEG/PNG images are accepted")
    if not (0.0 <= threshold <= 1.0):
        raise HTTPException(422, "confidence_threshold must be 0.0-1.0")

    content = await file.read()
    if len(content) > MAX_UPLOAD_B:
        raise HTTPException(422, f"File exceeds {MAX_UPLOAD_B // (1024*1024)} MB limit")

    ext = ".jpg" if file.content_type == "image/jpeg" else ".png"
    image_id = str(uuid.uuid4())
    filepath = UPLOAD_DIR / f"{image_id}{ext}"
    filepath.write_bytes(content)

    try:
        with PILImage.open(filepath) as img:
            img.verify()
        with PILImage.open(filepath) as img:
            width, height = img.size
    except (UnidentifiedImageError, OSError):
        filepath.unlink(missing_ok=True)
        raise HTTPException(422, "Invalid or corrupt image file")

    geo = resolve_image_geo(file.filename, extract_metadata(str(filepath)))
    await repo.save_image(
        db,
        image_id,
        file.filename or "",
        str(filepath),
        width,
        height,
        len(content),
        geo["latitude"],
        geo["longitude"],
        geo["sw_lng"],
        geo["sw_lat"],
        geo["ne_lng"],
        geo["ne_lat"],
        geo["tl_lng"],
        geo["tl_lat"],
        geo["tr_lng"],
        geo["tr_lat"],
        geo["br_lng"],
        geo["br_lat"],
        geo["bl_lng"],
        geo["bl_lat"],
    )
    return image_id, str(filepath), threshold


async def _parse_json(request: Request, db) -> tuple[str, str, float]:
    """Handle FR-DETECT-01: JSON body {image_id, confidence_threshold}."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(422, "Invalid JSON body")

    image_id = body.get("image_id")
    try:
        threshold = float(body.get("confidence_threshold", 0.5))
    except (TypeError, ValueError):
        raise HTTPException(422, "confidence_threshold must be 0.0-1.0")

    if not image_id:
        raise HTTPException(422, "Field 'image_id' is required")
    if not (0.0 <= threshold <= 1.0):
        raise HTTPException(422, "confidence_threshold must be 0.0-1.0")

    row = await repo.get_image(db, image_id)
    if not row:
        raise HTTPException(404, f"Image '{image_id}' not found")
    return image_id, row[2], threshold


@router.post("/detect", response_model=DetectionResponse)
async def detect(request: Request, db=Depends(_db)):
    seg = request.app.state.seg_service
    if seg is None:
        load_error = getattr(request.app.state, "seg_load_error", None)
        message = "Segmentation model is not loaded"
        if load_error:
            message = f"Segmentation model failed to initialize: {load_error}"
        raise HTTPException(503, message)

    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" in content_type:
        image_id, filepath, threshold = await _parse_multipart(request, db)
    else:
        image_id, filepath, threshold = await _parse_json(request, db)

    img_row = await repo.get_image(db, image_id)
    bounds = resolve_bounds_from_image_row(img_row)
    corners = resolve_corners_from_image_row(img_row)
    try:
        result = seg.segment(filepath, threshold)
    except Exception as exc:
        raise HTTPException(503, f"Segmentation inference failed: {exc}") from exc

    detection_id = str(uuid.uuid4())
    mask_filename = f"{detection_id}_mask.png"
    mask_path = OUTPUT_DIR / mask_filename
    mask_path.write_bytes(result["mask_png"])
    mask_base64 = "data:image/png;base64," + base64.b64encode(result["mask_png"]).decode("ascii")
    await repo.save_detection(
        db,
        detection_id,
        image_id,
        seg.MODEL_ID,
        result["detections"],
        str(mask_path),
        result["inference_time_ms"],
        threshold,
    )

    return DetectionResponse(
        detection_id=detection_id,
        image_id=image_id,
        model_used=seg.MODEL_ID,
        inference_time_ms=result["inference_time_ms"],
        image_width=result["image_width"],
        image_height=result["image_height"],
        detections=[Detection(**d) for d in result["detections"]],
        mask_url=f"/api/masks/{mask_filename}",
        mask_base64=mask_base64,
        image_bounds=bounds,
        image_corners=corners,
    )
