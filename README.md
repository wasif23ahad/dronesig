# DroneSeg Vision Platform

DroneSeg is a full-stack technical assessment project for uploading DJI drone imagery, mapping it over OpenStreetMap, running semantic segmentation, and exporting geospatial detection results. The project was implemented from the PRD/SRS as a zero-cost local workflow using open-source tooling, local SQLite storage, SegFormer-B2 for image segmentation, and optional Gemini 2.5 Flash for free-tier vision-language analysis.

## What Was Implemented

- FastAPI backend for image upload, metadata extraction, segmentation, history, image retrieval, map bounds/corner updates, and GeoJSON export.
- Next.js frontend with MapLibre/OpenStreetMap, drag-and-drop upload, available sample images, raster overlay, segmentation mask overlay, confidence threshold filtering, per-class visibility controls, history restore, and export actions.
- Sample image seeding for the three PRD DJI files with stable UUIDs.
- GPS/XMP metadata parsing for DJI imagery, including camera position, yaw, altitude, focal metadata, and estimated ground footprint.
- Four-corner georeferencing so rotated drone images can be aligned with the map instead of using only a rectangular bounding box.
- Manual correction tools: draggable corner pins and a center pin to refine placement when map data and drone imagery do not perfectly match.
- Backend/frontend setup scripts for Windows to make the project easier to run on another machine.

## Main Challenge: Coordinate Mismatch

The PRD gave approximate Kafrul-area bounds, but those values were not accurate enough for the provided DJI imagery. The initial overlay placed the image near the correct area, but visible landmarks, especially the water body, did not line up cleanly with the base map.

To fix this, the backend was updated to prefer DJI metadata from EXIF/XMP when available. The application now calculates a rotated image footprint and stores top-left, top-right, bottom-right, and bottom-left map coordinates. The frontend renders the image as a four-corner map overlay and allows manual pin adjustment. The alignment was manually checked against Google Earth and the visible drone photo/map landmarks. Because OSM map geometry, Google Earth imagery, and the drone capture can differ, the app supports manual correction rather than pretending one static coordinate set is perfect.

Important distinction: segmentation labels such as water, building, tree, plant, and earth come from the uploaded image pixels. Map alignment affects visualization and exported geospatial placement, not the model's pixel-level classification itself.

## Tech Stack

### Backend

- Python 3.11 or 3.12
- FastAPI + Uvicorn
- SQLite through `aiosqlite`
- HuggingFace Transformers
- PyTorch / TorchVision
- SegFormer-B2 ADE20K model
- Pillow, OpenCV headless, NumPy, SciPy

### Frontend

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- MapLibre GL / react-map-gl
- Radix Slider
- Lucide icons
- Axios

## Project Structure

```text
.
+-- backend/
|   +-- main.py
|   +-- config.py
|   +-- routers/              # Upload, detect, image, history, export APIs
|   +-- services/             # Segmentation, metadata, bounds, GeoJSON logic
|   +-- db/                   # SQLite setup and repository functions
|   +-- models/               # API schemas
|   +-- scripts/              # Windows setup and sample seeding helpers
|   +-- seed_images.py
+-- frontend/
|   +-- src/app/              # Next.js app routes and API proxy
|   +-- src/components/       # Map, upload, overlay, detection UI
|   +-- src/lib/              # API, geo, Gemini helpers
|   +-- scripts/
+-- uploads/                  # Local sample image staging, ignored by Git
+-- model/                    # Model notes/assets
+-- README.md
```

## Cost and API Choices

The core segmentation workflow is free and runs locally with the open-source SegFormer-B2 model. No paid OpenAI route is required. Gemini 2.5 Flash is used only for optional vision-language analysis because it has a free-tier path and satisfies the assessment requirement without paid API usage. If `GEMINI_API_KEY` is not configured, the main upload, segmentation, map overlay, threshold, history, and export features still work.

OpenStreetMap tiles are used through public map services for local demo purposes. For production, use a tile provider that matches the deployment terms and traffic volume.

## Prerequisites

- Git
- Python 3.11 or 3.12
- Node.js 18.17 or newer
- npm
- Internet access for first-time package/model download
- Optional: NVIDIA GPU with CUDA for faster PyTorch inference

## Clone and Run

```bash
git clone <repo-url> droneseg
cd droneseg
```

### 1. Backend Setup

```bash
cd backend
python -m venv venv
```

Activate the environment:

```powershell
venv\Scripts\activate
```

On macOS/Linux:

```bash
source venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Create the backend environment file:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Run the backend:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at:

```text
http://localhost:8000
http://localhost:8000/docs
```

### 2. Seed Sample Images

If you have the three PRD sample images, place them in either the repository root, root `uploads/`, or `backend/uploads/`:

```text
DJI_20260308132416_0059_V.JPG
DJI_20260308132417_0060_V.JPG
DJI_20260308132419_0061_V.JPG
```

Then run:

```bash
cd backend
python seed_images.py
```

Recommended Windows seeding command:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\seed_images.ps1
```

This registers stable UUIDs in SQLite and copies the files into `backend/uploads/`. Sample imagery and generated runtime files are intentionally ignored by Git.

### 3. Frontend Setup

Open a new terminal:

```bash
cd frontend
npm install
```

Create the frontend environment file:

```bash
cp .env.local.example .env.local
```

On Windows PowerShell:

```powershell
Copy-Item .env.local.example .env.local
```

Expected values:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
GEMINI_API_KEY=
```

Run the frontend:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Windows One-Command Helpers

Backend:

```powershell
cd backend
powershell -ExecutionPolicy Bypass -File .\scripts\setup_backend.ps1
```

Backend with CUDA PyTorch packages:

```powershell
cd backend
powershell -ExecutionPolicy Bypass -File .\scripts\setup_backend.ps1 -UseCuda
```

Frontend:

```powershell
cd frontend
powershell -ExecutionPolicy Bypass -File .\scripts\setup_frontend.ps1
```

## Core API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/upload` | Upload JPEG/PNG drone image |
| `POST` | `/api/detect` | Run segmentation |
| `GET` | `/api/images` | List uploaded/seeded images |
| `GET` | `/api/images/{image_id}` | Serve image bytes |
| `PATCH` | `/api/images/{image_id}/bounds` | Save rectangular bounds |
| `PATCH` | `/api/images/{image_id}/corners` | Save four-corner georeference |
| `GET` | `/api/history` | Detection history |
| `GET` | `/api/history/{id}` | Restore one detection |
| `DELETE` | `/api/history/{id}` | Delete detection |
| `GET` | `/api/export/geojson/{id}` | Export GeoJSON |

## Manual Test Checklist

Use this checklist when recording or validating the submission:

1. Start backend and confirm `http://localhost:8000/docs` loads.
2. Start frontend and open `http://localhost:3000`.
3. Confirm the map loads around the sample imagery area.
4. Upload a DJI image or choose one of the available samples.
5. Verify the drone image appears as a rotated overlay on the map.
6. Run segmentation and confirm mask colors and object labels appear.
7. Move the confidence threshold slider and confirm lower-confidence classes hide/show.
8. Toggle object visibility from the side panel.
9. Drag corner pins or the center pin, save, refresh, and confirm the position persists.
10. Export GeoJSON and confirm the file includes detected classes and mapped coordinates.
11. Check history restore and clear/delete behavior.

## Known Limitations

- SegFormer-B2 ADE20K is a general semantic segmentation model, not a custom-trained drone land-cover model. It is useful for assessment/demo purposes but may misclassify some aerial features.
- Perfect geospatial alignment is not guaranteed from metadata alone. True survey-grade alignment requires orthorectification, ground control points, or calibrated flight data.
- The first backend run may take time while model weights download.
- CPU inference works but can be slower than CUDA GPU inference.
- Public map tiles should be replaced with a production tile provider for deployed use.

## Security and Git Notes

- Do not commit `.env`, `.env.local`, SQLite DB files, uploads, outputs, model caches, or generated masks.
- Real API keys should stay local only.
- The repository includes `.env.example` and `.env.local.example` with blank secrets.
- DJI sample images are ignored by Git because they are large local assessment assets.

## Submission Summary

This project now satisfies the main PRD workflow: upload or select drone imagery, extract/assign geolocation, overlay it on a map, run segmentation, review class results with threshold filtering, adjust geospatial alignment, persist history, and export GIS-ready GeoJSON. The biggest implementation risk was the mismatch between approximate PRD coordinates and actual DJI image metadata; that was addressed with metadata-driven georeferencing plus manual map correction tested against Google Earth and visible map landmarks.
