from pathlib import Path

DEFAULT_BOUNDS = [90.354, 23.778, 90.358, 23.782]  # sw_lng, sw_lat, ne_lng, ne_lat
DEFAULT_CORNERS = [
    [DEFAULT_BOUNDS[0], DEFAULT_BOUNDS[3]],  # TL
    [DEFAULT_BOUNDS[2], DEFAULT_BOUNDS[3]],  # TR
    [DEFAULT_BOUNDS[2], DEFAULT_BOUNDS[1]],  # BR
    [DEFAULT_BOUNDS[0], DEFAULT_BOUNDS[1]],  # BL
]

# PRD sample DJI images should use deterministic Kafrul-area bounds for stable demos.
SAMPLE_IMAGE_BOUNDS: dict[str, list[float]] = {
    "dji_20260308132416_0059_v.jpg": DEFAULT_BOUNDS,
    "dji_20260308132417_0060_v.jpg": DEFAULT_BOUNDS,
    "dji_20260308132419_0061_v.jpg": DEFAULT_BOUNDS,
}

IDX_SW_LNG = 8
IDX_SW_LAT = 9
IDX_NE_LNG = 10
IDX_NE_LAT = 11
IDX_TL_LNG = 13
IDX_TL_LAT = 14
IDX_TR_LNG = 15
IDX_TR_LAT = 16
IDX_BR_LNG = 17
IDX_BR_LAT = 18
IDX_BL_LNG = 19
IDX_BL_LAT = 20


def _normalized_filename(filename: str | None) -> str:
    if not filename:
        return ""
    return Path(filename).name.lower()


def _row_value(row: tuple | None, index: int):
    if row is None or index >= len(row):
        return None
    return row[index]


def bounds_to_corners(bounds: list[float]) -> list[list[float]]:
    sw_lng, sw_lat, ne_lng, ne_lat = bounds
    return [
        [sw_lng, ne_lat],  # TL
        [ne_lng, ne_lat],  # TR
        [ne_lng, sw_lat],  # BR
        [sw_lng, sw_lat],  # BL
    ]


def corners_to_bounds(corners: list[list[float]]) -> list[float]:
    lngs = [corner[0] for corner in corners]
    lats = [corner[1] for corner in corners]
    return [min(lngs), min(lats), max(lngs), max(lats)]


def corners_to_geo(corners: list[list[float]]) -> dict[str, float]:
    sw_lng, sw_lat, ne_lng, ne_lat = corners_to_bounds(corners)
    center_lng = sum(corner[0] for corner in corners) / 4
    center_lat = sum(corner[1] for corner in corners) / 4
    return {
        "latitude": center_lat,
        "longitude": center_lng,
        "sw_lng": sw_lng,
        "sw_lat": sw_lat,
        "ne_lng": ne_lng,
        "ne_lat": ne_lat,
        "tl_lng": corners[0][0],
        "tl_lat": corners[0][1],
        "tr_lng": corners[1][0],
        "tr_lat": corners[1][1],
        "br_lng": corners[2][0],
        "br_lat": corners[2][1],
        "bl_lng": corners[3][0],
        "bl_lat": corners[3][1],
    }


def bounds_to_geo(bounds: list[float]) -> dict[str, float]:
    return corners_to_geo(bounds_to_corners(bounds))


def resolve_image_geo(filename: str | None, extracted_geo: dict | None) -> dict[str, float]:
    if extracted_geo:
        extracted = dict(extracted_geo)
        has_corners = all(
            key in extracted and extracted[key] is not None
            for key in ("tl_lng", "tl_lat", "tr_lng", "tr_lat", "br_lng", "br_lat", "bl_lng", "bl_lat")
        )
        if has_corners:
            corners = [
                [float(extracted["tl_lng"]), float(extracted["tl_lat"])],
                [float(extracted["tr_lng"]), float(extracted["tr_lat"])],
                [float(extracted["br_lng"]), float(extracted["br_lat"])],
                [float(extracted["bl_lng"]), float(extracted["bl_lat"])],
            ]
            return corners_to_geo(corners)
        has_bounds = all(
            key in extracted and extracted[key] is not None
            for key in ("sw_lng", "sw_lat", "ne_lng", "ne_lat")
        )
        if has_bounds:
            return bounds_to_geo(
                [
                    float(extracted["sw_lng"]),
                    float(extracted["sw_lat"]),
                    float(extracted["ne_lng"]),
                    float(extracted["ne_lat"]),
                ]
            )
    sample_bounds = SAMPLE_IMAGE_BOUNDS.get(_normalized_filename(filename))
    if sample_bounds:
        return bounds_to_geo(sample_bounds)
    return bounds_to_geo(DEFAULT_BOUNDS)


def resolve_corners_from_image_row(img_row: tuple | None) -> list[list[float]]:
    tl_lng = _row_value(img_row, IDX_TL_LNG)
    tl_lat = _row_value(img_row, IDX_TL_LAT)
    tr_lng = _row_value(img_row, IDX_TR_LNG)
    tr_lat = _row_value(img_row, IDX_TR_LAT)
    br_lng = _row_value(img_row, IDX_BR_LNG)
    br_lat = _row_value(img_row, IDX_BR_LAT)
    bl_lng = _row_value(img_row, IDX_BL_LNG)
    bl_lat = _row_value(img_row, IDX_BL_LAT)
    if None not in (tl_lng, tl_lat, tr_lng, tr_lat, br_lng, br_lat, bl_lng, bl_lat):
        return [
            [float(tl_lng), float(tl_lat)],
            [float(tr_lng), float(tr_lat)],
            [float(br_lng), float(br_lat)],
            [float(bl_lng), float(bl_lat)],
        ]

    sw_lng = _row_value(img_row, IDX_SW_LNG)
    sw_lat = _row_value(img_row, IDX_SW_LAT)
    ne_lng = _row_value(img_row, IDX_NE_LNG)
    ne_lat = _row_value(img_row, IDX_NE_LAT)
    if None not in (sw_lng, sw_lat, ne_lng, ne_lat):
        return bounds_to_corners([float(sw_lng), float(sw_lat), float(ne_lng), float(ne_lat)])
    return DEFAULT_CORNERS


def resolve_bounds_from_image_row(img_row: tuple | None) -> list[float]:
    return corners_to_bounds(resolve_corners_from_image_row(img_row))
