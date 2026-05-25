def _solve_linear_system(matrix: list[list[float]], values: list[float]) -> list[float]:
    """Solve A*x=b using Gaussian elimination with partial pivoting."""
    size = len(values)
    a = [row[:] for row in matrix]
    b = values[:]

    for col in range(size):
        pivot_row = max(range(col, size), key=lambda row: abs(a[row][col]))
        pivot_val = a[pivot_row][col]
        if abs(pivot_val) < 1e-12:
            raise ValueError("Singular matrix")

        if pivot_row != col:
            a[col], a[pivot_row] = a[pivot_row], a[col]
            b[col], b[pivot_row] = b[pivot_row], b[col]

        divisor = a[col][col]
        for k in range(col, size):
            a[col][k] /= divisor
        b[col] /= divisor

        for row in range(size):
            if row == col:
                continue
            factor = a[row][col]
            if factor == 0:
                continue
            for k in range(col, size):
                a[row][k] -= factor * a[col][k]
            b[row] -= factor * b[col]
    return b


def _compute_homography(img_w: int, img_h: int, corners: list[list[float]]) -> list[float]:
    """
    Compute pixel->geo homography.
    corners order: [TL, TR, BR, BL] as [lng, lat].
    """
    pixel_points = [
        (0.0, 0.0),                    # TL
        (float(img_w), 0.0),           # TR
        (float(img_w), float(img_h)),  # BR
        (0.0, float(img_h)),           # BL
    ]

    matrix: list[list[float]] = []
    values: list[float] = []
    for (x, y), (lng, lat) in zip(pixel_points, corners):
        matrix.append([x, y, 1.0, 0.0, 0.0, 0.0, -lng * x, -lng * y])
        values.append(float(lng))
        matrix.append([0.0, 0.0, 0.0, x, y, 1.0, -lat * x, -lat * y])
        values.append(float(lat))
    return _solve_linear_system(matrix, values)


def _project_pixel(x: float, y: float, homography: list[float]) -> list[float]:
    h11, h12, h13, h21, h22, h23, h31, h32 = homography
    denom = (h31 * x) + (h32 * y) + 1.0
    if abs(denom) < 1e-12:
        raise ValueError("Invalid homography denominator")
    lng = ((h11 * x) + (h12 * y) + h13) / denom
    lat = ((h21 * x) + (h22 * y) + h23) / denom
    return [lng, lat]


def _pixel_to_coords(bbox: list[int], homography: list[float]) -> list[list[float]]:
    """Map pixel bbox to closed GeoJSON ring [[lng,lat], ...]."""
    x1, y1, x2, y2 = bbox
    ring = [
        _project_pixel(float(x1), float(y1), homography),
        _project_pixel(float(x2), float(y1), homography),
        _project_pixel(float(x2), float(y2), homography),
        _project_pixel(float(x1), float(y2), homography),
    ]
    ring.append(ring[0])
    return ring


def _pixel_to_coords_rect(
    bbox: list[int], img_w: int, img_h: int, corners: list[list[float]]
) -> list[list[float]]:
    lngs = [corner[0] for corner in corners]
    lats = [corner[1] for corner in corners]
    sw_lng, sw_lat, ne_lng, ne_lat = min(lngs), min(lats), max(lngs), max(lats)
    x1, y1, x2, y2 = bbox
    lng_span = ne_lng - sw_lng
    lat_span = ne_lat - sw_lat
    ring = [
        [sw_lng + (x1 / img_w) * lng_span, ne_lat - (y1 / img_h) * lat_span],
        [sw_lng + (x2 / img_w) * lng_span, ne_lat - (y1 / img_h) * lat_span],
        [sw_lng + (x2 / img_w) * lng_span, ne_lat - (y2 / img_h) * lat_span],
        [sw_lng + (x1 / img_w) * lng_span, ne_lat - (y2 / img_h) * lat_span],
    ]
    ring.append(ring[0])
    return ring


def build_geojson(detections: list[dict], img_width: int, img_height: int, corners: list[list[float]]) -> dict:
    """Return a GeoJSON FeatureCollection (SRS section 6.7)."""
    homography = None
    try:
        homography = _compute_homography(img_width, img_height, corners)
    except ValueError:
        homography = None
    features = [
        {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    _pixel_to_coords(d["bbox"], homography)
                    if homography
                    else _pixel_to_coords_rect(d["bbox"], img_width, img_height, corners)
                ],
            },
            "properties": {
                "class": d["label"],
                "confidence": d["confidence"],
                "pixel_area": d["pixel_area"],
                "color": d["color"],
            },
        }
        for d in detections
    ]
    return {"type": "FeatureCollection", "features": features}
