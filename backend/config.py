import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent


def _path_from_env(key: str, default: Path) -> Path:
    value = os.getenv(key)
    if not value:
        return default
    path = Path(value)
    return path if path.is_absolute() else BASE_DIR / path


UPLOAD_DIR      = _path_from_env("UPLOAD_DIR", BASE_DIR / "uploads")
OUTPUT_DIR      = _path_from_env("OUTPUT_DIR", BASE_DIR / "outputs")
DB_PATH         = _path_from_env("DB_PATH",    BASE_DIR / "droneseg.db")
MODEL_ID        = os.getenv("MODEL_ID", "nvidia/segformer-b2-finetuned-ade-512-512")
MAX_UPLOAD_B    = int(os.getenv("MAX_UPLOAD_SIZE_MB", "50")) * 1024 * 1024
CORS_ORIGINS    = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
