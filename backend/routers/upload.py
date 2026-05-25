import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

import db.history_repo as repo
from config import UPLOAD_DIR, MAX_UPLOAD_B
from db.database import get_db
from models.schemas import UploadResponse
from services.bounds_service import resolve_image_geo
from services.metadata_service import extract_metadata

router = APIRouter()


async def _db():
    async with get_db() as db:
        yield db


@router.post("/upload", response_model=UploadResponse)
async def upload_image(file: UploadFile, db=Depends(_db)):
    if file.content_type not in ("image/jpeg", "image/png"):
        raise HTTPException(422, "Only JPEG/PNG images are accepted")

    content = await file.read()
    if len(content) > MAX_UPLOAD_B:
        raise HTTPException(422, f"File exceeds {MAX_UPLOAD_B // (1024*1024)} MB limit")

    ext      = ".jpg" if file.content_type == "image/jpeg" else ".png"
    image_id = str(uuid.uuid4())
    filepath = UPLOAD_DIR / f"{image_id}{ext}"
    filepath.write_bytes(content)

    try:
        with Image.open(filepath) as img:
            img.verify()
        with Image.open(filepath) as img:
            width, height = img.size
    except (UnidentifiedImageError, OSError):
        filepath.unlink(missing_ok=True)
        raise HTTPException(422, "Invalid or corrupt image file")

    geo = resolve_image_geo(file.filename, extract_metadata(str(filepath)))

    await repo.save_image(
        db, image_id, file.filename or "", str(filepath), width, height, len(content),
        geo["latitude"], geo["longitude"], geo["sw_lng"], geo["sw_lat"], geo["ne_lng"], geo["ne_lat"],
        geo["tl_lng"], geo["tl_lat"], geo["tr_lng"], geo["tr_lat"], geo["br_lng"], geo["br_lat"], geo["bl_lng"], geo["bl_lat"],
    )

    return UploadResponse(
        image_id=image_id, filename=file.filename or "",
        width=width, height=height, size_bytes=len(content),
        latitude=geo["latitude"], longitude=geo["longitude"],
        sw_lng=geo["sw_lng"], sw_lat=geo["sw_lat"], ne_lng=geo["ne_lng"], ne_lat=geo["ne_lat"],
        tl_lng=geo["tl_lng"], tl_lat=geo["tl_lat"], tr_lng=geo["tr_lng"], tr_lat=geo["tr_lat"],
        br_lng=geo["br_lng"], br_lat=geo["br_lat"], bl_lng=geo["bl_lng"], bl_lat=geo["bl_lat"],
        image_corners=[
            [geo["tl_lng"], geo["tl_lat"]],
            [geo["tr_lng"], geo["tr_lat"]],
            [geo["br_lng"], geo["br_lat"]],
            [geo["bl_lng"], geo["bl_lat"]],
        ],
    )
