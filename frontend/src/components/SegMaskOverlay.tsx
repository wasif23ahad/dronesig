'use client';

import React, { useMemo } from 'react';
import { Source, Layer, LayerProps } from 'react-map-gl/maplibre';
import type { ImageCorners } from '@/types/detection';

interface SegMaskOverlayProps {
  maskUrl: string;
  imageCorners: ImageCorners;
  opacity?: number;
}

export default function SegMaskOverlay({
  maskUrl,
  imageCorners,
  opacity = 0.6,
}: SegMaskOverlayProps) {
  const maskLayer: LayerProps = useMemo(() => ({
    id: 'seg-mask-layer',
    type: 'raster',
    paint: {
      'raster-opacity': opacity,
    },
  }), [opacity]);

  return (
    <Source
      id="seg-mask-source"
      type="image"
      url={maskUrl}
      coordinates={imageCorners}
    >
      <Layer {...maskLayer} />
    </Source>
  );
}
