import pytesseract
from PIL import Image
import httpx
import io


async def extract_text_from_photo(photo_url: str) -> str:
    """Download from Supabase Storage URL, run Tesseract OCR. Returns extracted text."""
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(photo_url)
        r.raise_for_status()
    img = Image.open(io.BytesIO(r.content))
    img = img.convert("L")  # grayscale improves OCR accuracy
    text = pytesseract.image_to_string(img, config="--psm 6")
    return text.strip()
