export interface Detection {
  label: string;
  confidence: number;
  bbox: [number, number, number, number]; // [x_min, y_min, x_max, y_max]
  pixel_area: number;
  color: string;
}

export type ImageCorners = [[number, number], [number, number], [number, number], [number, number]];

export interface DetectionResponse {
  detection_id: string;
  image_id: string;
  model_used: string;
  inference_time_ms: number;
  image_width: number;
  image_height: number;
  detections: Detection[];
  mask_url: string;
  image_bounds?: [number, number, number, number];
  image_corners?: ImageCorners;
}

export interface ImageRecord {
  image_id: string;
  filename: string;
  width: number;
  height: number;
  size_bytes: number;
  latitude?: number;
  longitude?: number;
  sw_lng?: number;
  sw_lat?: number;
  ne_lng?: number;
  ne_lat?: number;
  tl_lng?: number;
  tl_lat?: number;
  tr_lng?: number;
  tr_lat?: number;
  br_lng?: number;
  br_lat?: number;
  bl_lng?: number;
  bl_lat?: number;
  image_corners?: ImageCorners;
  created_at: string;
}

export interface ImageBoundsUpdatePayload {
  sw_lng: number;
  sw_lat: number;
  ne_lng: number;
  ne_lat: number;
}

export interface ImageCornersUpdatePayload {
  tl_lng: number;
  tl_lat: number;
  tr_lng: number;
  tr_lat: number;
  br_lng: number;
  br_lat: number;
  bl_lng: number;
  bl_lat: number;
}

export interface HistoryItem {
  detection_id: string;
  image_id: string;
  timestamp: string;
  model_used: string;
  class_count: number;
  image_thumbnail_url: string;
  detected_classes: string[];
}

export interface HistoryResponse {
  total: number;
  page: number;
  items: HistoryItem[];
}
