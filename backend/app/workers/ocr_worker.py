import logging
import pytesseract
from PIL import Image, UnidentifiedImageError
import httpx
import io

logger = logging.getLogger(__name__)


async def extract_text_from_photo(photo_url: str) -> str:
    """Download from Supabase Storage URL, run Tesseract OCR. Returns extracted text."""
    if not photo_url or not photo_url.startswith(("http://", "https://")):
        logger.warning("Invalid photo URL: %s", photo_url)
        return ""

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(photo_url)
            r.raise_for_status()
    except httpx.HTTPError as exc:
        logger.error("Failed to download photo %s: %s", photo_url, exc)
        return ""

    try:
        img = Image.open(io.BytesIO(r.content))
        img = img.convert("L")  # grayscale improves OCR accuracy
    except (UnidentifiedImageError, OSError) as exc:
        logger.error("Cannot open image from %s: %s", photo_url, exc)
        return ""

    try:
        text = pytesseract.image_to_string(img, config="--psm 6")
    except pytesseract.TesseractError as exc:
        logger.error("Tesseract OCR failed for %s: %s", photo_url, exc)
        return ""

    return text.strip()
