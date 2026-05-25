import json
from pathlib import Path

from PIL import Image


def infer_detection_dimensions(
    detections_json: str,
    mask_path: str | None,
    fallback_width: int,
    fallback_height: int,
) -> tuple[int, int]:
    """
    Detect the coordinate space used by stored detections.
    Priority:
    1) Saved mask size (authoritative, same frame as detections).
    2) Max bbox extents from detections JSON.
    3) Original image dimensions fallback.
    """
    if mask_path:
        try:
            resolved = Path(mask_path)
            if resolved.exists():
                with Image.open(resolved) as mask:
                    width, height = mask.size
                    if width > 0 and height > 0:
                        return int(width), int(height)
        except Exception:
            pass

    try:
        detections = json.loads(detections_json)
    except Exception:
        detections = []

    max_x = 0
    max_y = 0
    for item in detections:
        bbox = item.get("bbox")
        if not isinstance(bbox, list) or len(bbox) != 4:
            continue
        x2 = int(bbox[2])
        y2 = int(bbox[3])
        if x2 > max_x:
            max_x = x2
        if y2 > max_y:
            max_y = y2

    if max_x > 0 and max_y > 0:
        return max_x, max_y

    return fallback_width, fallback_height

