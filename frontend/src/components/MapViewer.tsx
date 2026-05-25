'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import Map, { Source, Layer, MapRef, LayerProps, Marker } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Detection, ImageCorners } from '@/types/detection';
import { boundsToCorners, cornersToBounds, DEFAULT_BOUNDS } from '@/lib/geo';
import SegMaskOverlay from './SegMaskOverlay';
import BBoxOverlay from './BBoxOverlay';

interface MapViewerProps {
  imageBounds?: [number, number, number, number]; // [SW_lng, SW_lat, NE_lng, NE_lat]
  imageCorners?: ImageCorners;
  imageUrl?: string;
  maskUrl?: string;
  detections?: Detection[];
  opacity?: number;
  confidenceThreshold?: number;
  hiddenClasses?: Set<string>;
  imageWidth?: number;
  imageHeight?: number;
  selectedDetectionIndex?: number | null;
  onSelectDetection?: (index: number) => void;
  editableCorners?: boolean;
  onCornersChange?: (corners: ImageCorners) => void;
}

export default function MapViewer({
  imageBounds = DEFAULT_BOUNDS,
  imageCorners,
  imageUrl,
  maskUrl,
  detections = [],
  opacity = 0.85,
  confidenceThreshold = 0.5,
  hiddenClasses = new Set(),
  imageWidth = 2048,
  imageHeight = 1534,
  selectedDetectionIndex = null,
  onSelectDetection,
  editableCorners = false,
  onCornersChange,
}: MapViewerProps) {
  const mapRef = useRef<MapRef>(null);
  const fittedImageRef = useRef<string | undefined>(undefined);
  const centerDragRef = useRef<{
    startLng: number;
    startLat: number;
    baseCorners: ImageCorners;
  } | null>(null);
  const [isStyleLoaded, setIsStyleLoaded] = useState(false);
  const resolvedCorners = useMemo(
    () => imageCorners ?? boundsToCorners(imageBounds),
    [imageCorners, imageBounds]
  );
  const resolvedBounds = useMemo(
    () => cornersToBounds(resolvedCorners),
    [resolvedCorners]
  );
  const [viewState, setViewState] = useState({
    longitude: (resolvedBounds[0] + resolvedBounds[2]) / 2,
    latitude: (resolvedBounds[1] + resolvedBounds[3]) / 2,
    zoom: 16,
  });

  const mapStyle = useMemo(() => ({
    version: 8 as const,
    sources: {
      'osm-raster': {
        type: 'raster' as const,
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap contributors',
        maxzoom: 19,
      },
    },
    layers: [
      {
        id: 'osm-raster-layer',
        type: 'raster' as const,
        source: 'osm-raster',
        minzoom: 0,
        maxzoom: 19,
      },
    ],
  }), []);

  useEffect(() => {
    if (!mapRef.current) {
      return;
    }
    if (fittedImageRef.current === imageUrl) {
      return;
    }
    fittedImageRef.current = imageUrl;
    mapRef.current.getMap().fitBounds(
      [
        [resolvedBounds[0], resolvedBounds[1]], // SW
        [resolvedBounds[2], resolvedBounds[3]], // NE
      ],
      { padding: 100, duration: 2000 }
    );
  }, [imageUrl, resolvedBounds]);

  const handleCornerDrag = (cornerIndex: number, lng: number, lat: number) => {
    if (!onCornersChange) {
      return;
    }
    const next: ImageCorners = resolvedCorners.map((corner, idx) => (
      idx === cornerIndex ? [lng, lat] : corner
    )) as ImageCorners;
    onCornersChange(next);
  };

  const centerPoint = useMemo(() => {
    const lng = resolvedCorners.reduce((sum, corner) => sum + corner[0], 0) / resolvedCorners.length;
    const lat = resolvedCorners.reduce((sum, corner) => sum + corner[1], 0) / resolvedCorners.length;
    return [lng, lat] as [number, number];
  }, [resolvedCorners]);

  const handleCenterDragStart = (event: { lngLat: { lng: number; lat: number } }) => {
    centerDragRef.current = {
      startLng: event.lngLat.lng,
      startLat: event.lngLat.lat,
      baseCorners: resolvedCorners,
    };
  };

  const handleCenterDrag = (event: { lngLat: { lng: number; lat: number } }) => {
    if (!onCornersChange || !centerDragRef.current) {
      return;
    }
    const deltaLng = event.lngLat.lng - centerDragRef.current.startLng;
    const deltaLat = event.lngLat.lat - centerDragRef.current.startLat;
    const shifted: ImageCorners = centerDragRef.current.baseCorners.map(([lng, lat]) => [
      lng + deltaLng,
      lat + deltaLat,
    ]) as ImageCorners;
    onCornersChange(shifted);
  };

  const handleCenterDragEnd = (event: { lngLat: { lng: number; lat: number } }) => {
    handleCenterDrag(event);
    centerDragRef.current = null;
  };

  const droneImageLayer: LayerProps = useMemo(() => ({
    id: 'drone-image-layer',
    type: 'raster',
    paint: {
      'raster-opacity': opacity,
    },
  }), [opacity]);

  const handleMapError = (event: { error?: { message?: string } }) => {
    const message = event?.error?.message ?? '';
    const isTransientImageAbort =
      message.includes('AJAXError: Failed to fetch (0):') &&
      message.includes('/api/images/');

    if (isTransientImageAbort) {
      return;
    }

    if (event?.error) {
      console.error(event.error);
    }
  };

  return (
    <div className="relative w-full h-full bg-[#0a0a0b] overflow-hidden">
      <Map
        {...viewState}
        onMove={(evt) => setViewState(evt.viewState)}
        mapStyle={mapStyle}
        onStyleData={() => setIsStyleLoaded(true)}
        onError={handleMapError}
        style={{ width: '100%', height: '100%' }}
        ref={mapRef}
      >
        {isStyleLoaded && imageUrl && (
          <Source
            id="drone-image"
            type="image"
            url={imageUrl}
            coordinates={resolvedCorners}
          >
            <Layer {...droneImageLayer} />
          </Source>
        )}

        {isStyleLoaded && maskUrl && (
          <SegMaskOverlay 
            maskUrl={maskUrl} 
            imageCorners={resolvedCorners}
            opacity={Math.max(0.45, opacity * 0.72)}
          />
        )}

        {isStyleLoaded && (
          <BBoxOverlay 
            detections={detections}
            imageCorners={resolvedCorners}
            confidenceThreshold={confidenceThreshold}
            hiddenClasses={hiddenClasses}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            selectedDetectionIndex={selectedDetectionIndex}
            onSelectDetection={onSelectDetection}
          />
        )}

        {isStyleLoaded && editableCorners && onCornersChange && resolvedCorners.map((corner, index) => (
          <Marker
            key={`corner-${index}`}
            longitude={corner[0]}
            latitude={corner[1]}
            draggable
            onDrag={(event: { lngLat: { lng: number; lat: number } }) =>
              handleCornerDrag(index, event.lngLat.lng, event.lngLat.lat)
            }
            onDragEnd={(event: { lngLat: { lng: number; lat: number } }) =>
              handleCornerDrag(index, event.lngLat.lng, event.lngLat.lat)
            }
          >
            <button
              type="button"
              className="h-4 w-4 rounded-full border-2 border-white shadow-[0_0_12px_rgba(59,130,246,0.65)] bg-primary"
              title={`Corner ${index + 1}`}
              aria-label={`Corner ${index + 1}`}
            />
          </Marker>
        ))}

        {isStyleLoaded && editableCorners && onCornersChange && (
          <Marker
            longitude={centerPoint[0]}
            latitude={centerPoint[1]}
            draggable
            onDragStart={(event: { lngLat: { lng: number; lat: number } }) => handleCenterDragStart(event)}
            onDrag={(event: { lngLat: { lng: number; lat: number } }) => handleCenterDrag(event)}
            onDragEnd={(event: { lngLat: { lng: number; lat: number } }) => handleCenterDragEnd(event)}
          >
            <button
              type="button"
              className="h-5 w-5 rounded-full border-2 border-white bg-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.75)]"
              title="Move entire image"
              aria-label="Move entire image"
            />
          </Marker>
        )}
      </Map>

      <div className="absolute bottom-6 left-6 flex flex-col gap-2">
        <div className="glass-dark px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 border-white/5">
          <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]" />
          Map Engine Live
        </div>
      </div>
    </div>
  );
}
