"""
OCR router — POST /ocr, POST /ocr/batch, GET /ocr/health

Called by the `process-photo` Supabase Edge Function which POSTs a
base64-encoded image.  Tesseract runs in a thread-pool executor so the
async event loop is never blocked.

If pytesseract or Pillow is not installed the endpoints return 503 with
a helpful message rather than crashing the server.
"""
from __future__ import annotations

import asyncio
import base64
import io
import logging
from functools import partial
from typing import List, Optional

import sentry_sdk
from fastapi import APIRouter, Depends, HTTPException, Security, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.auth import get_current_user

# ---------------------------------------------------------------------------
# Optional-import guard — pytesseract and Pillow
# ---------------------------------------------------------------------------
try:
    import pytesseract
    from PIL import Image, ImageFilter, ImageOps, UnidentifiedImageError

    _OCR_AVAILABLE = True
    _OCR_UNAVAILABLE_REASON = ""
except ImportError as _import_err:  # pragma: no cover
    _OCR_AVAILABLE = False
    _OCR_UNAVAILABLE_REASON = str(_import_err)

# ---------------------------------------------------------------------------
logger = logging.getLogger(__name__)
router = APIRouter()

_TESSERACT_CONFIG = "--oem 3 --psm 6"
# Minimum width/height in pixels below which we up-scale 2× to help Tesseract
_MIN_DIMENSION = 300


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class OCRRequest(BaseModel):
    image_base64: str
    job_id: str
    tenant_id: str
    file_type: str = "image/jpeg"


class OCRResponse(BaseModel):
    text: str
    confidence: float
    word_count: int
    job_id: str
    error: Optional[str] = None


class BatchImageItem(BaseModel):
    image_base64: str
    file_type: str = "image/jpeg"


class OCRBatchRequest(BaseModel):
    images: List[BatchImageItem] = Field(..., min_length=1)
    job_id: str
    tenant_id: str


class PageResult(BaseModel):
    text: str
    confidence: float
    word_count: int


class OCRBatchResponse(BaseModel):
    combined_text: str
    pages: List[PageResult]
    job_id: str


# ---------------------------------------------------------------------------
# Internal helpers (synchronous — run inside executor)
# ---------------------------------------------------------------------------

def _preprocess_image(img: "Image.Image") -> "Image.Image":
    """Convert to grayscale, binarize, and up-scale tiny images."""
    # Grayscale
    img = img.convert("L")

    # Up-scale if either dimension is below the threshold
    w, h = img.size
    if w < _MIN_DIMENSION or h < _MIN_DIMENSION:
        img = img.resize((w * 2, h * 2), Image.LANCZOS)

    # Binarize (simple threshold via point() — faster than ImageFilter)
    img = img.point(lambda p: 255 if p > 128 else 0, "L")

    return img


def _decode_base64_to_image(image_base64: str) -> "Image.Image":
    """Decode a base64 string to a PIL Image, stripping data-URI prefix if present."""
    if "," in image_base64:
        # data:image/jpeg;base64,<data>
        image_base64 = image_base64.split(",", 1)[1]

    raw_bytes = base64.b64decode(image_base64)
    return Image.open(io.BytesIO(raw_bytes))


def _run_tesseract(image_base64: str) -> dict:
    """
    Synchronous OCR pipeline — intended to be run in a thread executor.

    Returns a dict with keys: text, confidence, word_count, error.
    """
    if not _OCR_AVAILABLE:
        return {
            "text": "",
            "confidence": 0.0,
            "word_count": 0,
            "error": f"OCR unavailable: {_OCR_UNAVAILABLE_REASON}",
        }

    try:
        img = _decode_base64_to_image(image_base64)
    except Exception as exc:
        logger.warning("Failed to decode base64 image: %s", exc)
        return {"text": "", "confidence": 0.0, "word_count": 0, "error": f"Image decode error: {exc}"}

    try:
        img = _preprocess_image(img)
    except Exception as exc:
        logger.warning("Image pre-processing failed, using raw grayscale: %s", exc)
        try:
            img = img.convert("L")
        except Exception:
            return {"text": "", "confidence": 0.0, "word_count": 0, "error": "Pre-processing failed"}

    try:
        # image_to_data returns TSV with per-word confidence scores
        data = pytesseract.image_to_data(
            img,
            config=_TESSERACT_CONFIG,
            output_type=pytesseract.Output.DICT,
        )
        # Filter valid words (conf != -1)
        confidences = [
            int(c)
            for c in data["conf"]
            if str(c).lstrip("-").isdigit() and int(c) != -1
        ]
        avg_confidence = (sum(confidences) / len(confidences) / 100.0) if confidences else 0.0

        text = pytesseract.image_to_string(img, config=_TESSERACT_CONFIG).strip()
        word_count = len(text.split()) if text else 0

        return {
            "text": text,
            "confidence": round(avg_confidence, 4),
            "word_count": word_count,
            "error": None,
        }

    except pytesseract.TesseractNotFoundError as exc:
        logger.error("Tesseract binary not found: %s", exc)
        return {"text": "", "confidence": 0.0, "word_count": 0, "error": "Tesseract not installed on server"}
    except Exception as exc:
        sentry_sdk.capture_exception(exc)
        logger.error("Tesseract OCR error: %s", exc)
        return {"text": "", "confidence": 0.0, "word_count": 0, "error": str(exc)}


async def _async_run_tesseract(image_base64: str) -> dict:
    """Offload the CPU-bound OCR to a thread-pool executor."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_run_tesseract, image_base64))


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/ocr/health", tags=["ocr"])
async def ocr_health():
    """
    Public health check — no auth required.
    Returns whether Tesseract is available and its version string.
    """
    if not _OCR_AVAILABLE:
        return JSONResponse(
            {"tesseract_available": False, "version": "", "detail": _OCR_UNAVAILABLE_REASON},
            status_code=503,
        )

    loop = asyncio.get_event_loop()
    try:
        version = await loop.run_in_executor(
            None, pytesseract.get_tesseract_version
        )
        version_str = str(version)
    except Exception as exc:
        return JSONResponse(
            {"tesseract_available": False, "version": "", "detail": str(exc)},
            status_code=503,
        )

    return {"tesseract_available": True, "version": version_str}


@router.post("/ocr", response_model=OCRResponse, tags=["ocr"])
async def run_ocr(
    body: OCRRequest,
    user: dict = Security(get_current_user),
):
    """
    Decode a base64 image and run Tesseract OCR on it.

    Pre-processing pipeline:
      1. Grayscale conversion
      2. Binarization (threshold at 128)
      3. 2× up-scale if either dimension is < 300 px

    Tesseract config: --oem 3 --psm 6
    """
    if not _OCR_AVAILABLE:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"OCR service unavailable — pytesseract not installed: {_OCR_UNAVAILABLE_REASON}",
        )

    # Validate that the caller's tenant_id matches the JWT claim
    if body.tenant_id != user["tenant_id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="tenant_id in body does not match authenticated tenant",
        )

    logger.info(
        "OCR request: job_id=%s tenant_id=%s file_type=%s",
        body.job_id,
        body.tenant_id,
        body.file_type,
    )

    result = await _async_run_tesseract(body.image_base64)

    return OCRResponse(
        text=result["text"],
        confidence=result["confidence"],
        word_count=result["word_count"],
        job_id=body.job_id,
        error=result.get("error"),
    )


@router.post("/ocr/batch", response_model=OCRBatchResponse, tags=["ocr"])
async def run_ocr_batch(
    body: OCRBatchRequest,
    user: dict = Security(get_current_user),
):
    """
    Process multiple images for a single job.

    All images are processed concurrently via asyncio.gather().
    Results are concatenated with a page-separator line.
    """
    if not _OCR_AVAILABLE:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"OCR service unavailable — pytesseract not installed: {_OCR_UNAVAILABLE_REASON}",
        )

    if body.tenant_id != user["tenant_id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="tenant_id in body does not match authenticated tenant",
        )

    logger.info(
        "OCR batch request: job_id=%s tenant_id=%s pages=%d",
        body.job_id,
        body.tenant_id,
        len(body.images),
    )

    # Fan-out — process all images concurrently
    tasks = [_async_run_tesseract(img.image_base64) for img in body.images]
    results: list[dict] = await asyncio.gather(*tasks)

    pages: list[PageResult] = []
    page_texts: list[str] = []

    for idx, res in enumerate(results, start=1):
        page_text = res["text"]
        page_texts.append(f"--- Page {idx} ---\n{page_text}")
        pages.append(
            PageResult(
                text=page_text,
                confidence=res["confidence"],
                word_count=res["word_count"],
            )
        )

    combined_text = "\n\n".join(page_texts)

    return OCRBatchResponse(
        combined_text=combined_text,
        pages=pages,
        job_id=body.job_id,
    )
