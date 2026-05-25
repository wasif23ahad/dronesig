'use client';

import React, { useState, useEffect } from 'react';
import { 
  X, 
  History, 
  Plus, 
  Zap, 
  Info, 
  LayoutDashboard,
  ExternalLink,
  FileImage,
  Layers,
  Sparkles,
  Trash2,
  Save
} from 'lucide-react';
import MapViewer from '@/components/MapViewer';
import DetectionPanel from '@/components/DetectionPanel';
import UploadZone from '@/components/UploadZone';
import LLMModelSelector, { ModelType } from '@/components/LLMModelSelector';
import * as api from '@/lib/api';
import { DetectionResponse, ImageCorners, ImageRecord, HistoryItem } from '@/types/detection';
import { boundsToCorners, cornersToBounds, DEFAULT_BOUNDS } from '@/lib/geo';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const toCornersDraft = (corners?: ImageCorners) => {
  if (!corners) {
    return {
      tl_lng: '',
      tl_lat: '',
      tr_lng: '',
      tr_lat: '',
      br_lng: '',
      br_lat: '',
      bl_lng: '',
      bl_lat: '',
    };
  }
  return {
    tl_lng: corners[0][0].toFixed(6),
    tl_lat: corners[0][1].toFixed(6),
    tr_lng: corners[1][0].toFixed(6),
    tr_lat: corners[1][1].toFixed(6),
    br_lng: corners[2][0].toFixed(6),
    br_lat: corners[2][1].toFixed(6),
    bl_lng: corners[3][0].toFixed(6),
    bl_lat: corners[3][1].toFixed(6),
  };
};

const parseCornersDraft = (draft: ReturnType<typeof toCornersDraft>): ImageCorners | undefined => {
  const parsed = [
    [Number.parseFloat(draft.tl_lng), Number.parseFloat(draft.tl_lat)],
    [Number.parseFloat(draft.tr_lng), Number.parseFloat(draft.tr_lat)],
    [Number.parseFloat(draft.br_lng), Number.parseFloat(draft.br_lat)],
    [Number.parseFloat(draft.bl_lng), Number.parseFloat(draft.bl_lat)],
  ] as ImageCorners;
  const hasInvalid = parsed.some(([lng, lat]) => Number.isNaN(lng) || Number.isNaN(lat));
  return hasInvalid ? undefined : parsed;
};

const extractImageCorners = (image?: ImageRecord | null): ImageCorners | undefined => {
  if (!image) {
    return undefined;
  }
  if (image.image_corners && image.image_corners.length === 4) {
    return image.image_corners;
  }
  if (
    image.tl_lng != null && image.tl_lat != null &&
    image.tr_lng != null && image.tr_lat != null &&
    image.br_lng != null && image.br_lat != null &&
    image.bl_lng != null && image.bl_lat != null
  ) {
    return [
      [image.tl_lng, image.tl_lat],
      [image.tr_lng, image.tr_lat],
      [image.br_lng, image.br_lat],
      [image.bl_lng, image.bl_lat],
    ];
  }
  if (
    image.sw_lng != null &&
    image.sw_lat != null &&
    image.ne_lng != null &&
    image.ne_lat != null
  ) {
    return boundsToCorners([image.sw_lng, image.sw_lat, image.ne_lng, image.ne_lat]);
  }
  return undefined;
};

const blobToBase64 = async (blob: Blob): Promise<string> => {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  const [, encoded] = dataUrl.split(",");
  if (!encoded) {
    throw new Error("Failed to encode image to base64");
  }
  return encoded;
};

export default function DroneSegPlatform() {
  // UI State
  const [activeTab, setActiveTab] = useState<'upload' | 'history'>('upload');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelType>('segformer');

  // App State
  const [currentImage, setCurrentImage] = useState<ImageRecord | null>(null);
  const [detectionResult, setDetectionResult] = useState<DetectionResponse | null>(null);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.5);
  const [hiddenClasses, setHiddenClasses] = useState<Set<string>>(new Set());
  const [isDetecting, setIsDetecting] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [sampleImages, setSampleImages] = useState<ImageRecord[]>([]);
  const [mapOpacity, setMapOpacity] = useState(0.85);
  const [selectedDetectionIndex, setSelectedDetectionIndex] = useState<number | null>(null);
  const [cornersDraft, setCornersDraft] = useState(toCornersDraft());
  const [boundsError, setBoundsError] = useState<string | null>(null);
  const [isSavingBounds, setIsSavingBounds] = useState(false);
  const draftCorners = parseCornersDraft(cornersDraft);

  const activeCorners: ImageCorners = draftCorners
    ?? detectionResult?.image_corners
    ?? (detectionResult?.image_bounds ? boundsToCorners(detectionResult.image_bounds) : undefined)
    ?? extractImageCorners(currentImage)
    ?? boundsToCorners(DEFAULT_BOUNDS);
  const activeBounds = cornersToBounds(activeCorners);

  const syncBoundsDraft = (corners?: ImageCorners) => {
    setCornersDraft(toCornersDraft(corners));
    setBoundsError(null);
  };

  const handleMapCornersChange = (corners: ImageCorners) => {
    syncBoundsDraft(corners);
  };

  // Initialize
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [historyData, imagesData] = await Promise.all([
          api.getHistory(),
          api.getImages()
        ]);
        setHistory(historyData.items);
        setSampleImages(imagesData);
      } catch (err) {
        console.error("Failed to fetch initial data", err);
      }
    };
    fetchData();
  }, []);

  const handleUploadSuccess = async (file: File) => {
    try {
      const img = await api.uploadImage(file);
      setCurrentImage(img);
      setDetectionResult(null);
      setSelectedDetectionIndex(null);
      setHiddenClasses(new Set());
      syncBoundsDraft(extractImageCorners(img));
      await runAnalysis(img.image_id);
    } catch (err) {
      console.error("Upload failed", err);
      throw err;
    }
  };

  const runAnalysis = async (imageId: string) => {
    setIsDetecting(true);
    setHiddenClasses(new Set());
    try {
      if (selectedModel === 'segformer') {
        const result = await api.runDetection(imageId, 0.1);
        setDetectionResult(result);
        setSelectedDetectionIndex(null);
        syncBoundsDraft(result.image_corners ?? (result.image_bounds ? boundsToCorners(result.image_bounds) : undefined));
      } else {
        const imgUrl = `${process.env.NEXT_PUBLIC_API_URL}/api/images/${imageId}`;
        const resp = await fetch(imgUrl);
        if (!resp.ok) {
          throw new Error(`Failed to load image for LLM analysis (${resp.status})`);
        }
        const blob = await resp.blob();
        
        const activeImg = sampleImages.find(img => img.image_id === imageId) || currentImage;
        const imgWidth = activeImg?.width || 2048;
        const imgHeight = activeImg?.height || 1534;

        const base64data = await blobToBase64(blob);
        const t0 = performance.now();
        const llmResp = await fetch('/api/llm/analyze', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ 
            image_base64: base64data, 
            model: selectedModel,
            width: imgWidth,
            height: imgHeight
          }),
        });
        const result = await llmResp.json();
        if (!llmResp.ok) {
          throw new Error(result?.error || "LLM analysis failed");
        }
        const latency = Math.round(performance.now() - t0);
        setDetectionResult({
          ...result,
          detection_id: 'llm-result-' + Date.now(),
          image_id: imageId,
          model_used: selectedModel,
          inference_time_ms: latency,
          image_width: imgWidth,
          image_height: imgHeight,
          mask_url: '',
        });
        setSelectedDetectionIndex(null);
        syncBoundsDraft(extractImageCorners(activeImg));
      }
      
      if (selectedModel === "segformer") {
        const historyData = await api.getHistory();
        setHistory(historyData.items);
      }
    } catch (err) {
      console.error("Analysis failed", err);
    } finally {
      setIsDetecting(false);
    }
  };

  const toggleClassVisibility = (label: string) => {
    setHiddenClasses((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const clearResults = () => {
    setDetectionResult(null);
    setSelectedDetectionIndex(null);
    setHiddenClasses(new Set());
    setConfidenceThreshold(0.5);
  };

  const selectHistoryItem = async (item: HistoryItem) => {
    setIsDetecting(true);
    try {
      const result = await api.getHistoryDetection(item.detection_id);
      setDetectionResult(result);
      setSelectedDetectionIndex(null);
      setHiddenClasses(new Set());
      syncBoundsDraft(result.image_corners ?? (result.image_bounds ? boundsToCorners(result.image_bounds) : undefined));

      const existingImage = sampleImages.find((img) => img.image_id === item.image_id);
      if (existingImage) {
        setCurrentImage(existingImage);
      } else {
        setCurrentImage({
          image_id: item.image_id,
          filename: 'Restored Image',
          width: result.image_width,
          height: result.image_height,
          size_bytes: 0,
          sw_lng: result.image_bounds?.[0],
          sw_lat: result.image_bounds?.[1],
          ne_lng: result.image_bounds?.[2],
          ne_lat: result.image_bounds?.[3],
          tl_lng: result.image_corners?.[0]?.[0],
          tl_lat: result.image_corners?.[0]?.[1],
          tr_lng: result.image_corners?.[1]?.[0],
          tr_lat: result.image_corners?.[1]?.[1],
          br_lng: result.image_corners?.[2]?.[0],
          br_lat: result.image_corners?.[2]?.[1],
          bl_lng: result.image_corners?.[3]?.[0],
          bl_lat: result.image_corners?.[3]?.[1],
          image_corners: result.image_corners,
          created_at: item.timestamp
        });
      }
      setIsHistoryOpen(false);
    } catch (err) {
      console.error("Failed to restore history item", err);
    } finally {
      setIsDetecting(false);
    }
  };

  const handleDeleteHistory = async (e: React.MouseEvent, detectionId: string) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this detection record?")) return;
    try {
      await api.deleteHistory(detectionId);
      setHistory(prev => prev.filter(item => item.detection_id !== detectionId));
      if (detectionResult?.detection_id === detectionId) {
        setDetectionResult(null);
        setSelectedDetectionIndex(null);
      }
    } catch (err) {
      console.error("Failed to delete history item", err);
      alert("Failed to delete record");
    }
  };

  const handleSaveBounds = async () => {
    if (!currentImage) {
      return;
    }

    const parsed = {
      tl_lng: Number.parseFloat(cornersDraft.tl_lng),
      tl_lat: Number.parseFloat(cornersDraft.tl_lat),
      tr_lng: Number.parseFloat(cornersDraft.tr_lng),
      tr_lat: Number.parseFloat(cornersDraft.tr_lat),
      br_lng: Number.parseFloat(cornersDraft.br_lng),
      br_lat: Number.parseFloat(cornersDraft.br_lat),
      bl_lng: Number.parseFloat(cornersDraft.bl_lng),
      bl_lat: Number.parseFloat(cornersDraft.bl_lat),
    };
    const values = Object.values(parsed);
    if (values.some((value) => Number.isNaN(value))) {
      setBoundsError("All corner coordinates must be valid numbers");
      return;
    }

    const parsedCorners: ImageCorners = [
      [parsed.tl_lng, parsed.tl_lat],
      [parsed.tr_lng, parsed.tr_lat],
      [parsed.br_lng, parsed.br_lat],
      [parsed.bl_lng, parsed.bl_lat],
    ];
    const [swLng, swLat, neLng, neLat] = cornersToBounds(parsedCorners);
    if (neLng <= swLng || neLat <= swLat) {
      setBoundsError("Corner set must define a valid area");
      return;
    }

    setIsSavingBounds(true);
    setBoundsError(null);
    try {
      const updated = await api.updateImageCorners(currentImage.image_id, parsed);
      setCurrentImage(updated);
      setSampleImages((prev) => prev.map((img) => (img.image_id === updated.image_id ? updated : img)));
      setDetectionResult((prev) => {
        if (!prev || prev.image_id !== updated.image_id) {
          return prev;
        }
        return {
          ...prev,
          image_corners: parsedCorners,
          image_bounds: [swLng, swLat, neLng, neLat],
        };
      });
      syncBoundsDraft(parsedCorners);
    } catch (error) {
      console.error("Failed to save image corners", error);
      setBoundsError("Failed to save corners");
    } finally {
      setIsSavingBounds(false);
    }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden font-sans">
      {/* Sidebar Navigation */}
      <aside className="w-20 glass-dark border-r border-white/5 flex flex-col items-center py-8 gap-10 z-50">
        <div className="relative group">
          <div className="absolute inset-0 bg-primary blur-2xl opacity-20 group-hover:opacity-40 transition-opacity" />
          <div className="relative w-12 h-12 bg-primary rounded-2xl flex items-center justify-center shadow-lg shadow-primary/20 cursor-pointer active:scale-95 transition-transform">
            <Zap className="text-white w-6 h-6 fill-current" />
          </div>
        </div>

        <nav className="flex flex-col gap-6">
          <button 
            onClick={() => { setActiveTab('upload'); setIsHistoryOpen(false); }}
            className={cn(
              "p-3.5 rounded-2xl transition-all",
              activeTab === 'upload' && !isHistoryOpen ? "bg-white/10 text-primary" : "text-muted-foreground hover:bg-white/5"
            )}
          >
            <LayoutDashboard className="w-6 h-6" />
          </button>
          <button 
            onClick={() => setIsHistoryOpen(true)}
            className={cn(
              "p-3.5 rounded-2xl transition-all",
              isHistoryOpen ? "bg-white/10 text-primary" : "text-muted-foreground hover:bg-white/5"
            )}
          >
            <History className="w-6 h-6" />
          </button>
        </nav>

        <div className="mt-auto flex flex-col gap-6 text-muted-foreground">
          <button className="p-3.5 rounded-2xl hover:bg-white/5 transition-all">
            <Info className="w-6 h-6" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 relative flex overflow-hidden">
        {/* Map Engine */}
        <div className="flex-1 relative">
          <MapViewer 
            imageUrl={currentImage ? `${process.env.NEXT_PUBLIC_API_URL}/api/images/${currentImage.image_id}` : undefined}
            maskUrl={detectionResult?.mask_url ? `${process.env.NEXT_PUBLIC_API_URL}${detectionResult.mask_url}` : undefined}
            detections={detectionResult?.detections}
            imageBounds={activeBounds}
            imageCorners={activeCorners}
            confidenceThreshold={confidenceThreshold}
            hiddenClasses={hiddenClasses}
            opacity={mapOpacity}
            imageWidth={detectionResult?.image_width || currentImage?.width}
            imageHeight={detectionResult?.image_height || currentImage?.height}
            selectedDetectionIndex={selectedDetectionIndex}
            onSelectDetection={setSelectedDetectionIndex}
            editableCorners={Boolean(currentImage)}
            onCornersChange={handleMapCornersChange}
          />

          {/* Top Floating Toolbar */}
          <div className="absolute top-6 left-6 right-6 flex items-center justify-between pointer-events-none">
            <div className="flex items-center gap-4 pointer-events-auto">
              <div className="glass px-6 py-3.5 rounded-2xl flex items-center gap-4 shadow-2xl">
                <div className="flex flex-col">
                  <h1 className="text-sm font-bold tracking-tight text-gradient">DroneSeg Platform</h1>
                  <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">Vision Node</p>
                </div>
              </div>
              <LLMModelSelector selectedModel={selectedModel} onSelect={setSelectedModel} />
            </div>

            <div className="flex items-center gap-3 pointer-events-auto">
              {selectedModel !== 'segformer' && (
                <div className="glass-dark px-4 py-2.5 rounded-2xl flex items-center gap-2.5 border-primary/20 shadow-[0_0_20px_rgba(59,130,246,0.1)]">
                  <Sparkles className="w-4 h-4 text-primary animate-pulse" />
                  <span className="text-xs font-bold text-primary tracking-tight">LLM Vision Mode - Approximate Results</span>
                </div>
              )}
              {currentImage && (
                <div className="glass px-4 py-2.5 rounded-2xl flex items-center gap-2.5 text-xs font-bold border-white/10">
                  <FileImage className="w-4 h-4 text-primary" />
                  {currentImage.filename}
                </div>
              )}
            </div>
          </div>

          {/* Opacity Control - FR-MAP-04 */}
          <div className="absolute bottom-6 right-6 glass-dark p-2 rounded-2xl border-white/10 flex items-center gap-3 pointer-events-auto shadow-2xl">
            <div className="p-2 rounded-xl bg-white/5">
              <Layers className="w-4 h-4 text-muted-foreground" />
            </div>
            <input 
              type="range" 
              min="0" max="1" step="0.01" 
              value={mapOpacity} 
              onChange={(e) => setMapOpacity(parseFloat(e.target.value))}
              className="w-24 accent-primary"
            />
            <span className="text-[10px] font-bold text-muted-foreground w-8 uppercase">{Math.round(mapOpacity * 100)}%</span>
          </div>
        </div>

        {/* Right Sidebar */}
        <aside className="w-96 min-h-0 glass-dark border-l border-white/5 transition-all duration-500 z-40 overflow-hidden">
          <div className="h-full min-h-0 flex flex-col">
            {!currentImage && !detectionResult ? (
              <div className="h-full min-h-0 overflow-y-auto overscroll-contain p-6 flex flex-col gap-6">
                <div className="flex-shrink-0 space-y-2">
                  <h2 className="text-2xl font-bold tracking-tight">Project Node</h2>
                  <p className="text-sm text-muted-foreground">Upload drone imagery for segmentation.</p>
                </div>
                
                <UploadZone onUploadSuccess={handleUploadSuccess} className="h-[190px] min-h-[180px] flex-shrink-0" />

                <div className="flex-shrink-0 space-y-3">
                  <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    <ExternalLink className="w-3 h-3" />
                    Available Samples
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {sampleImages.map((img) => (
                      <button
                        key={img.image_id}
                        onClick={() => {
                          setCurrentImage(img);
                          syncBoundsDraft(extractImageCorners(img));
                          runAnalysis(img.image_id);
                        }}
                        className="glass px-4 py-3 rounded-xl text-left hover:bg-white/5 transition-all group border-white/5"
                      >
                        <p className="text-sm font-bold group-hover:text-primary transition-colors">{img.filename}</p>
                        <p className="text-[10px] text-muted-foreground uppercase font-bold">
                          {(img.size_bytes / 1024 / 1024).toFixed(1)}MB
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full min-h-0 flex flex-col overflow-hidden">
                <div className="flex-shrink-0 p-6 border-b border-white/5 flex items-center justify-between">
                  <button 
                    onClick={() => {
                      setCurrentImage(null);
                      setDetectionResult(null);
                      setSelectedDetectionIndex(null);
                      setHiddenClasses(new Set());
                      syncBoundsDraft();
                    }}
                    className="text-xs font-bold text-muted-foreground hover:text-white flex items-center gap-2 transition-colors"
                  >
                    <Plus className="w-4 h-4 rotate-45" />
                    Reset Workspace
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                  <div className="px-6 py-4 border-b border-white/5">
                    <div className="flex items-center gap-3">
                      <div className="w-16 h-16 rounded-xl overflow-hidden bg-secondary/40 border border-white/10 flex-shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`${process.env.NEXT_PUBLIC_API_URL}/api/images/${currentImage?.image_id ?? ''}`}
                          alt={currentImage?.filename ?? 'Current image'}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-bold truncate">{currentImage?.filename ?? 'Unknown image'}</p>
                        <p className="text-[11px] text-muted-foreground font-medium">
                          {((currentImage?.size_bytes ?? 0) / 1024 / 1024).toFixed(2)} MB
                        </p>
                        <p className="text-[11px] text-muted-foreground font-medium">
                          {currentImage?.width ?? 0} x {currentImage?.height ?? 0}px
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="px-6 py-4 border-b border-white/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground">
                        Image Corners
                      </p>
                      <button
                        type="button"
                        onClick={handleSaveBounds}
                        disabled={isSavingBounds}
                        className="px-3 py-1.5 rounded-lg bg-primary/90 hover:bg-primary text-[11px] font-bold flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                      >
                        <Save className="w-3.5 h-3.5" />
                        {isSavingBounds ? "Saving" : "Save"}
                      </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Drag blue corner pins to warp, drag yellow center pin to move whole image, then save.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={cornersDraft.tl_lng}
                        onChange={(event) => setCornersDraft((prev) => ({ ...prev, tl_lng: event.target.value }))}
                        placeholder="TL lng"
                        className="px-2.5 py-2 rounded-lg bg-black/30 border border-white/10 text-xs font-mono"
                      />
                      <input
                        value={cornersDraft.tl_lat}
                        onChange={(event) => setCornersDraft((prev) => ({ ...prev, tl_lat: event.target.value }))}
                        placeholder="TL lat"
                        className="px-2.5 py-2 rounded-lg bg-black/30 border border-white/10 text-xs font-mono"
                      />
                      <input
                        value={cornersDraft.tr_lng}
                        onChange={(event) => setCornersDraft((prev) => ({ ...prev, tr_lng: event.target.value }))}
                        placeholder="TR lng"
                        className="px-2.5 py-2 rounded-lg bg-black/30 border border-white/10 text-xs font-mono"
                      />
                      <input
                        value={cornersDraft.tr_lat}
                        onChange={(event) => setCornersDraft((prev) => ({ ...prev, tr_lat: event.target.value }))}
                        placeholder="TR lat"
                        className="px-2.5 py-2 rounded-lg bg-black/30 border border-white/10 text-xs font-mono"
                      />
                      <input
                        value={cornersDraft.br_lng}
                        onChange={(event) => setCornersDraft((prev) => ({ ...prev, br_lng: event.target.value }))}
                        placeholder="BR lng"
                        className="px-2.5 py-2 rounded-lg bg-black/30 border border-white/10 text-xs font-mono"
                      />
                      <input
                        value={cornersDraft.br_lat}
                        onChange={(event) => setCornersDraft((prev) => ({ ...prev, br_lat: event.target.value }))}
                        placeholder="BR lat"
                        className="px-2.5 py-2 rounded-lg bg-black/30 border border-white/10 text-xs font-mono"
                      />
                      <input
                        value={cornersDraft.bl_lng}
                        onChange={(event) => setCornersDraft((prev) => ({ ...prev, bl_lng: event.target.value }))}
                        placeholder="BL lng"
                        className="px-2.5 py-2 rounded-lg bg-black/30 border border-white/10 text-xs font-mono"
                      />
                      <input
                        value={cornersDraft.bl_lat}
                        onChange={(event) => setCornersDraft((prev) => ({ ...prev, bl_lat: event.target.value }))}
                        placeholder="BL lat"
                        className="px-2.5 py-2 rounded-lg bg-black/30 border border-white/10 text-xs font-mono"
                      />
                    </div>
                    {boundsError && (
                      <p className="text-[11px] text-red-400 font-medium">{boundsError}</p>
                    )}
                  </div>
                  <DetectionPanel 
                    result={detectionResult}
                    confidenceThreshold={confidenceThreshold}
                    setConfidenceThreshold={setConfidenceThreshold}
                    hiddenClasses={hiddenClasses}
                    toggleClassVisibility={toggleClassVisibility}
                    onExport={() => detectionResult && api.exportGeoJSON(detectionResult.detection_id)}
                    onClear={clearResults}
                    isDetecting={isDetecting}
                    selectedDetectionIndex={selectedDetectionIndex}
                    onSelectDetection={setSelectedDetectionIndex}
                  />
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* History Drawer */}
        {isHistoryOpen && (
          <div className="absolute inset-0 z-50 flex">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={() => setIsHistoryOpen(false)} />
            <aside className="relative w-[480px] bg-background border-r border-white/10 flex flex-col shadow-2xl">
              <div className="p-8 border-b border-white/5 flex items-center justify-between">
                <h2 className="text-2xl font-bold tracking-tight">History</h2>
                <button onClick={() => setIsHistoryOpen(false)} className="p-3 rounded-2xl hover:bg-white/5 transition-all">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-8 space-y-4">
                {history.map((item) => (
                  <div
                    key={item.detection_id}
                    onClick={() => selectHistoryItem(item)}
                    className="glass group p-5 rounded-3xl cursor-pointer hover:border-primary/30 transition-all border-white/5 relative"
                  >
                    <div className="flex gap-5 items-center">
                      <div className="w-20 h-20 rounded-2xl bg-secondary overflow-hidden relative flex-shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img 
                          src={`${process.env.NEXT_PUBLIC_API_URL}${item.image_thumbnail_url}`}
                          className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-all"
                          alt="Thumb"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold mb-1 truncate">Task {item.detection_id.slice(0, 8)}</p>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase">{new Date(item.timestamp).toLocaleDateString()}</p>
                      </div>
                      <button
                        onClick={(e) => handleDeleteHistory(e, item.detection_id)}
                        className="p-2.5 rounded-xl hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0"
                        title="Delete record"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
