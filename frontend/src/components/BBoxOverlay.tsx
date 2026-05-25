'use client';

import React, { useMemo } from 'react';
import { useMap } from 'react-map-gl/maplibre';
import { Detection, ImageCorners } from '@/types/detection';
import { computePixelToGeoHomography, cornersToBounds, projectPixelToGeo } from '@/lib/geo';

interface BBoxOverlayProps {
  detections: Detection[];
  imageCorners: ImageCorners; // [TL, TR, BR, BL]
  confidenceThreshold: number;
  hiddenClasses: Set<string>;
  imageWidth?: number;
  imageHeight?: number;
  selectedDetectionIndex?: number | null;
  onSelectDetection?: (index: number) => void;
}

const toRgba = (hex: string, alpha: number): string => {
  const normalized = hex.trim();
  if (!/^#[0-9A-Fa-f]{6}$/.test(normalized)) {
    return `rgba(59,130,246,${alpha})`;
  }
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const rectsOverlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  padding = 4
) => (
  a.x < b.x + b.width + padding &&
  a.x + a.width + padding > b.x &&
  a.y < b.y + b.height + padding &&
  a.y + a.height + padding > b.y
);

const clamp = (value: number, min: number, max: number) => {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
};

export default function BBoxOverlay({
  detections,
  imageCorners,
  confidenceThreshold,
  hiddenClasses,
  imageWidth = 2048,
  imageHeight = 1534,
  selectedDetectionIndex = null,
  onSelectDetection,
}: BBoxOverlayProps) {
  const { current: map } = useMap();
  const homography = useMemo(() => {
    try {
      return computePixelToGeoHomography(imageWidth, imageHeight, imageCorners);
    } catch {
      return null;
    }
  }, [imageWidth, imageHeight, imageCorners]);
  const fallbackBounds = useMemo(() => cornersToBounds(imageCorners), [imageCorners]);

  const filteredDetections = useMemo(() => {
    return detections
      .map((detection, index) => ({ detection, index }))
      .filter(
        ({ detection }) =>
          detection.confidence >= confidenceThreshold &&
          !hiddenClasses.has(detection.label)
      );
  }, [detections, confidenceThreshold, hiddenClasses]);

  if (!map) return null;

  const container = map.getMap().getContainer();
  const viewportWidth = container.clientWidth;
  const viewportHeight = container.clientHeight;
  const labelHeight = 18;
  const labelGap = 5;

  const overlayItems = filteredDetections.map(({ detection, index }) => {
    const [x1, y1, x2, y2] = detection.bbox;
    const geoRing = homography
      ? [
          projectPixelToGeo(x1, y1, homography),
          projectPixelToGeo(x2, y1, homography),
          projectPixelToGeo(x2, y2, homography),
          projectPixelToGeo(x1, y2, homography),
        ]
      : [
          [
            fallbackBounds[0] + (x1 / imageWidth) * (fallbackBounds[2] - fallbackBounds[0]),
            fallbackBounds[3] - (y1 / imageHeight) * (fallbackBounds[3] - fallbackBounds[1]),
          ],
          [
            fallbackBounds[0] + (x2 / imageWidth) * (fallbackBounds[2] - fallbackBounds[0]),
            fallbackBounds[3] - (y1 / imageHeight) * (fallbackBounds[3] - fallbackBounds[1]),
          ],
          [
            fallbackBounds[0] + (x2 / imageWidth) * (fallbackBounds[2] - fallbackBounds[0]),
            fallbackBounds[3] - (y2 / imageHeight) * (fallbackBounds[3] - fallbackBounds[1]),
          ],
          [
            fallbackBounds[0] + (x1 / imageWidth) * (fallbackBounds[2] - fallbackBounds[0]),
            fallbackBounds[3] - (y2 / imageHeight) * (fallbackBounds[3] - fallbackBounds[1]),
          ],
        ];
    const projected = geoRing.map(([lng, lat]) => map.project([lng, lat]));
    const minX = Math.min(...projected.map((point) => point.x));
    const minY = Math.min(...projected.map((point) => point.y));
    const label = `${detection.label.toUpperCase()} ${Math.round(detection.confidence * 100)}%`;
    const labelWidth = Math.max(94, Math.round(label.length * 7.2) + 12);
    const desiredLabelX = minX + 2;
    const desiredLabelY = minY - labelHeight - 4;

    return {
      detection,
      index,
      points: projected.map((point) => `${point.x},${point.y}`).join(" "),
      minX,
      minY,
      label,
      labelWidth,
      labelX: clamp(desiredLabelX, 0, viewportWidth - labelWidth),
      labelY: clamp(desiredLabelY, 0, viewportHeight - labelHeight),
      desiredLabelY,
    };
  });

  const placedLabels: Array<{ x: number; y: number; width: number; height: number }> = [];
  [...overlayItems]
    .sort((a, b) => a.desiredLabelY - b.desiredLabelY || a.labelX - b.labelX)
    .forEach((item) => {
      const maxY = viewportHeight - labelHeight;
      const candidates = [item.desiredLabelY];
      for (let step = 1; step <= overlayItems.length + 8; step += 1) {
        candidates.push(item.desiredLabelY + step * (labelHeight + labelGap));
        candidates.push(item.desiredLabelY - step * (labelHeight + labelGap));
      }

      const uniqueCandidates = [...new Set(candidates.map((y) => clamp(y, 0, maxY)))];
      const availableY = uniqueCandidates.find((candidateY) => {
        const candidate = {
          x: item.labelX,
          y: candidateY,
          width: item.labelWidth,
          height: labelHeight,
        };
        return !placedLabels.some((placed) => rectsOverlap(candidate, placed));
      });

      item.labelY = availableY ?? item.labelY;
      placedLabels.push({
        x: item.labelX,
        y: item.labelY,
        width: item.labelWidth,
        height: labelHeight,
      });
    });

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <svg className="w-full h-full pointer-events-none">
        {overlayItems.map(({ detection, index, points }) => {
          const isSelected = selectedDetectionIndex === index;
          const strokeColor = detection.color;
          const fillColor = toRgba(detection.color, isSelected ? 0.2 : 0.08);

          return (
            <polygon
              key={`box-${detection.label}-${index}`}
              points={points}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={isSelected ? 3.2 : 2.4}
              opacity={isSelected ? 1 : 0.96}
              className="transition-all duration-300"
              style={{
                filter: `drop-shadow(0 0 5px ${strokeColor}44)`,
                pointerEvents: "all",
                cursor: onSelectDetection ? "pointer" : "default",
              }}
              onClick={() => onSelectDetection?.(index)}
            />
          );
        })}

        {overlayItems.map(({ detection, index, minX, minY, label, labelWidth, labelX, labelY, desiredLabelY }) => {
          const labelMoved = Math.abs(labelY - clamp(desiredLabelY, 0, viewportHeight - labelHeight)) > 2;

          return (
            <g key={`label-${detection.label}-${index}`} style={{ pointerEvents: "none" }}>
              {labelMoved && (
                <line
                  x1={clamp(minX + 8, 0, viewportWidth)}
                  y1={clamp(minY, 0, viewportHeight)}
                  x2={labelX + 8}
                  y2={labelY + labelHeight}
                  stroke={detection.color}
                  strokeWidth={1.5}
                  opacity={0.75}
                />
              )}
              <polygon
                points={`${labelX + 5},${labelY} ${labelX + labelWidth - 5},${labelY} ${labelX + labelWidth},${labelY + 5} ${labelX + labelWidth},${labelY + labelHeight - 5} ${labelX + labelWidth - 5},${labelY + labelHeight} ${labelX + 5},${labelY + labelHeight} ${labelX},${labelY + labelHeight - 5} ${labelX},${labelY + 5}`}
                fill={detection.color}
                opacity={0.95}
              />
              <text
                x={labelX + 6}
                y={labelY + 12}
                fill="#ffffff"
                fontSize="10"
                fontWeight="700"
                style={{ letterSpacing: 0 }}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
