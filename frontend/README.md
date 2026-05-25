# DroneSeg Vision Platform - Frontend

Map-first UI for drone imagery segmentation using SegFormer-B2 and optional LLM vision analysis.

## Features

- Interactive MapLibre + OpenStreetMap viewer.
- Drone raster overlay with adjustable opacity.
- Segmentation mask overlay and map-synced bounding boxes.
- Detection panel with confidence threshold and per-class visibility toggles.
- Detection history restore and GeoJSON export.
- Optional LLM mode using Gemini 2.5 Flash.

## Tech Stack

- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS
- MapLibre GL JS / react-map-gl
- Radix UI / Lucide React
- Axios

## Assessment Notes

- The optional LLM workflow intentionally uses **Gemini 2.5 Flash** for zero-cost assessment execution while preserving the same UI workflow and structured response contract.

## Getting Started

Prerequisites:
- Node.js 18.17.0+
- Backend API running on `http://localhost:8000`

Install and run:

```bash
npm install
```

Create `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
GEMINI_API_KEY=
```

Run dev server:

```bash
npm run dev
```

Production build:

```bash
npm run build
npm start
```

Windows quick setup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup_frontend.ps1
```
