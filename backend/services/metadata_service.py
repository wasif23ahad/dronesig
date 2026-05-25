import re
import math
from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS

def _get_exif_data(image):
    """Extract EXIF data from PIL image."""
    exif_data = {}
    info = image._getexif()
    if info:
        for tag, value in info.items():
            decoded = TAGS.get(tag, tag)
            if decoded == "GPSInfo":
                gps_data = {}
                for t in value:
                    sub_tag = GPSTAGS.get(t, t)
                    gps_data[sub_tag] = value[t]
                exif_data[decoded] = gps_data
            else:
                exif_data[decoded] = value
    return exif_data

def _convert_to_degrees(value):
    """Helper to convert GPS coordinates to degrees."""
    d = float(value[0])
    m = float(value[1])
    s = float(value[2])
    return d + (m / 60.0) + (s / 3600.0)

def _get_xmp_metadata(image_path):
    """Extract XMP metadata from image file."""
    with open(image_path, 'rb') as f:
        content = f.read()
    
    start = content.find(b'<x:xmpmeta')
    end = content.find(b'</x:xmpmeta>')
    if start == -1 or end == -1:
        return {}
    
    xmp_str = content[start:end+12].decode('utf-8', errors='ignore')
    
    metadata = {}
    # Simple regex extraction for DJI tags
    tags = [
        'GpsLatitude', 'GpsLongitude', 'RelativeAltitude', 
        'GimbalPitchDegree', 'GimbalYawDegree', 'FlightYawDegree',
        'CalibratedFocalLength'
    ]
    for tag in tags:
        match = re.search(f'drone-dji:{tag}="([^"]+)"', xmp_str)
        if match:
            metadata[tag] = float(match.group(1))
            
    return metadata


def _footprint_corners(
    center_lat: float,
    center_lng: float,
    width_m: float,
    height_m: float,
    yaw_deg: float | None,
) -> list[list[float]]:
    """
    Return corners [TL, TR, BR, BL] in [lng, lat].
    yaw_deg is interpreted as clockwise heading from north.
    """
    half_w = width_m / 2.0
    half_h = height_m / 2.0
    local_corners = [
        (-half_w, +half_h),  # TL
        (+half_w, +half_h),  # TR
        (+half_w, -half_h),  # BR
        (-half_w, -half_h),  # BL
    ]

    phi = math.radians(yaw_deg) if yaw_deg is not None else 0.0
    cos_phi = math.cos(phi)
    sin_phi = math.sin(phi)
    meters_per_deg_lat = 111111.0
    meters_per_deg_lng = 111111.0 * max(math.cos(math.radians(center_lat)), 1e-6)

    corners: list[list[float]] = []
    for east_m, north_m in local_corners:
        # Clockwise rotation in EN plane.
        rot_east_m = (east_m * cos_phi) + (north_m * sin_phi)
        rot_north_m = (-east_m * sin_phi) + (north_m * cos_phi)
        lat = center_lat + (rot_north_m / meters_per_deg_lat)
        lng = center_lng + (rot_east_m / meters_per_deg_lng)
        corners.append([lng, lat])
    return corners

def extract_metadata(image_path: str):
    """Extract GPS and calculate footprint from drone image."""
    with Image.open(image_path) as img:
        width, height = img.size
        exif = _get_exif_data(img)

    # Try XMP first (more precise for DJI)
    xmp = _get_xmp_metadata(image_path)
    
    lat = xmp.get('GpsLatitude')
    lng = xmp.get('GpsLongitude')
    alt = xmp.get('RelativeAltitude')
    yaw = xmp.get('GimbalYawDegree')
    focal_len = xmp.get('CalibratedFocalLength')
    
    # Fallback to EXIF for basic GPS
    if lat is None or lng is None:
        gps_info = exif.get('GPSInfo')
        if gps_info:
            lat = _convert_to_degrees(gps_info.get('GPSLatitude'))
            if gps_info.get('GPSLatitudeRef') == 'S': lat = -lat
            lng = _convert_to_degrees(gps_info.get('GPSLongitude'))
            if gps_info.get('GPSLongitudeRef') == 'W': lng = -lng
            
    # Default fallbacks if no GPS found
    if lat is None or lng is None:
        return None

    # Calculate footprint
    # Default values if missing from metadata
    if alt is None: alt = 50.0  # Assume 50m
    if focal_len is None:
        # Try to estimate from focal length in 35mm
        f35 = exif.get('FocalLengthIn35mmFilm', 24)
        # Focal length in pixels approx: (f35 / 36) * width
        focal_len = (f35 / 36.0) * width
        
    gsd = alt / focal_len
    ground_w = gsd * width
    ground_h = gsd * height

    corners = _footprint_corners(lat, lng, ground_w, ground_h, yaw)
    lng_values = [corner[0] for corner in corners]
    lat_values = [corner[1] for corner in corners]
    sw_lng = min(lng_values)
    sw_lat = min(lat_values)
    ne_lng = max(lng_values)
    ne_lat = max(lat_values)
    
    return {
        "latitude": lat,
        "longitude": lng,
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
