from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from config import CORS_ORIGINS, OUTPUT_DIR, UPLOAD_DIR
from db.database import init_db
from routers import detect, export, history, images, upload
from seed_images import ensure_sample_images_seeded
from services.segformer_service import SegformerService


@asynccontextmanager
async def lifespan(app: FastAPI):
    UPLOAD_DIR.mkdir(exist_ok=True)
    OUTPUT_DIR.mkdir(exist_ok=True)
    await init_db()
    try:
        await ensure_sample_images_seeded()
    except Exception as e:
        print(f"Sample image seeding warning: {e}")
    try:
        app.state.seg_service = SegformerService()   # loaded once
        app.state.seg_load_error = None
    except Exception as e:
        app.state.seg_service = None
        app.state.seg_load_error = str(e)
        print(f"Segmentation model initialization warning: {e}")
    yield


app = FastAPI(title="DroneSeg API", version="1.0.0", lifespan=lifespan)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(_request: Request, exc: StarletteHTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail, "status_code": exc.status_code},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "status_code": 422},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, _exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "status_code": 500},
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

# Routers registered before StaticFiles so /api/images/{id} route takes precedence
app.include_router(upload.router,  prefix="/api")
app.include_router(images.router,  prefix="/api")   # GET /api/images + /api/images/{id}
app.include_router(detect.router,  prefix="/api")
app.include_router(history.router, prefix="/api")
app.include_router(export.router,  prefix="/api")

# Direct static access path for upload artifacts (section 9.3 style mount)
app.mount("/api/images/raw", StaticFiles(directory=str(UPLOAD_DIR)), name="images-raw")
# Masks served as static files (filename includes extension so no ambiguity)
app.mount("/api/masks", StaticFiles(directory=str(OUTPUT_DIR)), name="masks")
