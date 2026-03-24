import pytesseract
from PIL import Image
import httpx
import io


async def extract_text_from_photo(photo_url: str) -> str:
    """Download from Supabase Storage, run Tesseract OCR."""
    async with httpx.AsyncClient() as client:
        r = await client.get(photo_url)
    img = Image.open(io.BytesIO(r.content))
    img = img.convert('L')  # grayscale for better OCR
    text = pytesseract.image_to_string(img, config='--psm 6')
    return text.strip()


async def aggregate_field_text(job_id: str, db) -> str:
    notes = await db.fetch(
        'SELECT raw_text, photo_urls FROM field_notes WHERE job_id=$1',
        job_id
    )
    chunks = [n['raw_text'] or '' for n in notes]
    for note in notes:
        for url in (note['photo_urls'] or []):
            chunks.append(await extract_text_from_photo(url))
    return '\n'.join(filter(None, chunks))
