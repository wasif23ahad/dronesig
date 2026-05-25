# DroneSeg Backend

FastAPI backend for drone imagery semantic segmentation.

## Stack
| Package | Version | Role |
|---|---|---|
| FastAPI | 0.111 | Async REST framework |
| Uvicorn | 0.29 | ASGI server |
| HuggingFace Transformers | 4.40 | SegFormer-B2 model |
| PyTorch | 2.3 | Inference runtime |
| OpenCV (headless) | 4.9 | Connected-component bbox extraction |
| Pillow | 10.3 | Image I/O + mask colorization |
| aiosqlite | 0.20 | Async SQLite |

## Setup

Prerequisite: Python `3.11` or `3.12` (Torch `2.3.0` is not available on Python 3.14).

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Create `.env` (all values optional, defaults shown):

```env
UPLOAD_DIR=uploads
OUTPUT_DIR=outputs
DB_PATH=droneseg.db
MODEL_ID=nvidia/segformer-b2-finetuned-ade-512-512
MAX_UPLOAD_SIZE_MB=50
CORS_ORIGINS=http://localhost:3000
```

Windows one-command setup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup_backend.ps1
```

Windows CUDA setup (NVIDIA GPU):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup_backend.ps1 -UseCuda
```

PyTorch CUDA verification:

```powershell
venv\Scripts\python.exe -c "import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available())"
```

## Run

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

First run auto-downloads SegFormer-B2 weights (~85 MB) from HuggingFace Hub.  
SQLite database is created automatically on startup.

## Seed Sample Images

Place DJI sample files at repository root (or `backend/uploads/`) then run:

```bash
python seed_images.py
```

The script copies available samples into `backend/uploads/` and registers stable UUID image IDs in SQLite.
If one or more of `0059` / `0060` / `0061` is missing, the script backfills missing files from an available DJI sample so section 10.4 seeding remains complete for assessment runs.

### Recommended (Windows / PowerShell)

Use the bootstrap script to avoid global Python dependency issues:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\seed_images.ps1
```

This will:
1. create `backend/.seed_venv` with a copied Python runtime if missing or broken,
2. install `requirements.txt`,
3. run `seed_images.py` with the venv interpreter.

If you already installed dependencies and only want to re-run seeding:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\seed_images.ps1 -SkipInstall
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/upload` | Upload drone image (JPEG/PNG <= 50 MB) |
| `POST` | `/api/detect` | Run SegFormer inference (JSON or multipart) |
| `GET` | `/api/images` | List all registered images |
| `GET` | `/api/images/{image_id}` | Serve original image bytes |
| `GET` | `/api/images/raw/{filename}` | Serve raw image file directly from uploads |
| `PATCH` | `/api/images/{image_id}/bounds` | Update image geobounds (`sw_lng`, `sw_lat`, `ne_lng`, `ne_lat`) |
| `PATCH` | `/api/images/{image_id}/corners` | Update image geocorners (`tl`, `tr`, `br`, `bl`) |
| `GET` | `/api/masks/{filename}` | Serve segmentation mask PNG |
| `GET` | `/api/history` | Paginated detection history |
| `GET` | `/api/history/{id}` | Restore a stored detection payload |
| `DELETE` | `/api/history/{id}` | Delete a detection record |
| `GET` | `/api/export/geojson/{id}` | GeoJSON FeatureCollection export |

Interactive docs: http://localhost:8000/docs
