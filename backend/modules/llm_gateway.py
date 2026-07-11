# ─────────────────────────────────────────────────────────────────────────────
# modules/llm_gateway.py
# AI Provider Gateway: Vertex AI Gemini -> AI Studio Gemini -> Ollama -> Vertex AI Claude
# ─────────────────────────────────────────────────────────────────────────────

import os
import re
import asyncio
import random
import logging
import httpx
import vertexai
from vertexai.generative_models import GenerativeModel

logger = logging.getLogger(__name__)

# ── Config ──────────────────────────────────────────────────────────────────

# Vertex AI
VERTEX_PROJECT_ID = os.getenv("VERTEX_PROJECT_ID")
VERTEX_LOCATION = os.getenv("VERTEX_LOCATION", "us-central1")
VERTEX_CLAUDE_MODEL = os.getenv("VERTEX_CLAUDE_MODEL", "claude-3-5-sonnet@20240620")
VERTEX_GEMINI_MODEL = os.getenv("VERTEX_GEMINI_MODEL", "gemini-1.5-pro-preview-0409")

# Gemini (AI Studio)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-pro-latest")

# Ollama
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "haitham-accountant:latest")

# Retry configuration
LLM_MAX_RETRIES = int(os.getenv("LLM_MAX_RETRIES", "3"))
LLM_RETRY_BASE_DELAY = float(os.getenv("LLM_RETRY_BASE_DELAY", "0.8"))
LLM_RETRY_MAX_DELAY = float(os.getenv("LLM_RETRY_MAX_DELAY", "8.0"))

# Network timeouts (seconds)
VERTEX_TIMEOUT = float(os.getenv("VERTEX_TIMEOUT", "120.0"))
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "120.0"))
GEMINI_TIMEOUT = float(os.getenv("GEMINI_TIMEOUT", "60.0"))
OLLAMA_PING_TIMEOUT = float(os.getenv("OLLAMA_PING_TIMEOUT", "3.0"))

# Transient error codes that warrant a retry
_RETRYABLE_HTTP_STATUS = {408, 425, 429, 500, 502, 503, 504}

# Initialize Vertex AI
if VERTEX_PROJECT_ID:
    try:
        vertexai.init(project=VERTEX_PROJECT_ID, location=VERTEX_LOCATION)
        logger.info(f"✅ Vertex AI initialized for project {VERTEX_PROJECT_ID} in {VERTEX_LOCATION}")
    except Exception as e:
        logger.error(f"❌ Failed to initialize Vertex AI: {e}")
        VERTEX_PROJECT_ID = None

# ── Retry Helper ────────────────────────────────────────────────────────────

async def _with_retry(coro_factory, *, label: str, max_retries: int = LLM_MAX_RETRIES):
    last_exc: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            return await coro_factory()
        except (httpx.TimeoutException, asyncio.TimeoutError) as exc:
            last_exc = exc
            logger.warning(f"⏱️ {label} timed out (attempt {attempt}/{max_retries}): {exc}")
        except httpx.HTTPStatusError as exc:
            last_exc = exc
            status = exc.response.status_code if exc.response is not None else 0
            if status not in _RETRYABLE_HTTP_STATUS or attempt >= max_retries:
                logger.error(f"❌ {label} HTTP {status} (no retry): {exc}")
                raise
            logger.warning(f"⚠️ {label} HTTP {status} (attempt {attempt}/{max_retries})")
        except (httpx.ConnectError, httpx.NetworkError) as exc:
            last_exc = exc
            logger.warning(f"🔌 {label} network error (attempt {attempt}/{max_retries}): {exc}")
        except Exception as exc: 
             last_exc = exc
             logger.warning(f"💥 {label} unexpected error (attempt {attempt}/{max_retries}): {exc}")

        if attempt < max_retries:
            delay = min(LLM_RETRY_MAX_DELAY, LLM_RETRY_BASE_DELAY * (2 ** (attempt - 1)))
            delay = random.uniform(0, delay)
            await asyncio.sleep(delay)

    assert last_exc is not None
    raise last_exc


# ── Vertex AI (Claude) ──────────────────────────────────────────────────────

async def call_vertex_claude(prompt: str) -> str:
    if not VERTEX_PROJECT_ID:
        raise RuntimeError("Vertex AI is not configured. Set VERTEX_PROJECT_ID.")

    async def _do_call() -> str:
        model = GenerativeModel(VERTEX_CLAUDE_MODEL)
        loop = asyncio.get_running_loop()
        response = await loop.run_in_executor(
            None,
            lambda: model.generate_content(
                [prompt],
                generation_config={"max_output_tokens": 2048, "temperature": 0.1},
            )
        )
        return _clean_json(response.text)

    return await _with_retry(_do_call, label=f"VertexClaude:{VERTEX_CLAUDE_MODEL}")

# ── Vertex AI (Gemini) ──────────────────────────────────────────────────────

async def call_vertex_gemini(prompt: str) -> str:
    if not VERTEX_PROJECT_ID:
        raise RuntimeError("Vertex AI is not configured. Set VERTEX_PROJECT_ID.")

    async def _do_call() -> str:
        model = GenerativeModel(VERTEX_GEMINI_MODEL)
        loop = asyncio.get_running_loop()
        response = await loop.run_in_executor(
            None,
            lambda: model.generate_content(
                [prompt],
                generation_config={"max_output_tokens": 2048, "temperature": 0.1},
            )
        )
        return _clean_json(response.text)

    return await _with_retry(_do_call, label=f"VertexGemini:{VERTEX_GEMINI_MODEL}")


# ── Ollama ──────────────────────────────────────────────────────────────────

async def ping_ollama() -> bool:
    if not OLLAMA_BASE_URL:
        return False
    try:
        async with httpx.AsyncClient(timeout=OLLAMA_PING_TIMEOUT) as client:
            resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            return resp.status_code == 200
    except Exception:
        return False

async def call_ollama(prompt: str) -> str:
    async def _do_call() -> str:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            resp = await client.post(
                f"{OLLAMA_BASE_URL}/api/chat",
                json={
                    "model": OLLAMA_MODEL,
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are an expert financial accountant AI. Return ONLY valid JSON — no markdown, no explanation.",
                        },
                        {"role": "user", "content": prompt},
                    ],
                    "options": {"temperature": 0.1, "num_ctx": 4096, "num_predict": 2048},
                    "stream": False,
                    "format": "json",
                },
            )
            resp.raise_for_status()
            data = resp.json()
            raw = data.get("message", {}).get("content", "")
            return _clean_json(raw)

    return await _with_retry(_do_call, label=f"Ollama:{OLLAMA_MODEL}")


# ── AI Studio (Gemini) ──────────────────────────────────────────────────────

async def call_ai_studio_gemini(prompt: str) -> str:
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not set.")

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}"
        f":generateContent?key={GEMINI_API_KEY}"
    )

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 2048,
            "responseMimeType": "application/json",
        },
    }

    async def _do_call() -> str:
        async with httpx.AsyncClient(timeout=GEMINI_TIMEOUT) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            data = resp.json()

            candidates = data.get("candidates", [])
            if not candidates:
                raise RuntimeError("Gemini returned no candidates.")

            parts = candidates[0].get("content", {}).get("parts", [])
            if not parts:
                raise RuntimeError("Gemini returned empty parts.")

            raw = parts[0].get("text", "")
            return _clean_json(raw)

    return await _with_retry(_do_call, label=f"AIStudioGemini:{GEMINI_MODEL}")


# ── Gateway ─────────────────────────────────────────────────────────────────

async def ask_llm(prompt: str) -> str:
    """
    Smart gateway that tries providers in a specific order.
    Order: Vertex AI Gemini -> AI Studio Gemini -> Ollama -> Vertex AI Claude
    """
    # 1. Try Vertex AI Gemini
    if VERTEX_PROJECT_ID:
        try:
            logger.info(f"☁️ Using Gemini via Vertex AI ({VERTEX_GEMINI_MODEL})...")
            result = await call_vertex_gemini(prompt)
            logger.info("✅ Gemini (Vertex AI) responded successfully.")
            return result
        except Exception as e:
            logger.warning(f"⚠️ Gemini (Vertex AI) failed: {e}. Falling back...")

    # 2. Try AI Studio Gemini
    if GEMINI_API_KEY:
        try:
            logger.info(f"☁️ Using Gemini via AI Studio ({GEMINI_MODEL})...")
            result = await call_ai_studio_gemini(prompt)
            logger.info("✅ Gemini (AI Studio) responded successfully.")
            return result
        except Exception as e:
            logger.warning(f"⚠️ Gemini (AI Studio) failed: {e}. Falling back...")

    # 3. Fallback to Ollama
    if await ping_ollama():
        try:
            logger.info(f"🦙 Using Ollama ({OLLAMA_MODEL})...")
            result = await call_ollama(prompt)
            logger.info("✅ Ollama responded successfully.")
            return result
        except Exception as e:
            logger.warning(f"⚠️ Ollama failed: {e}. Falling back...")

    # 4. Fallback to Vertex AI Claude
    if VERTEX_PROJECT_ID:
        try:
            logger.info(f"✨ Using Claude via Vertex AI ({VERTEX_CLAUDE_MODEL})...")
            result = await call_vertex_claude(prompt)
            logger.info("✅ Claude (Vertex AI) responded successfully.")
            return result
        except Exception as e:
            logger.warning(f"⚠️ Claude (Vertex AI) failed: {e}. Falling back...")

    raise RuntimeError(
        "No AI provider available. All fallbacks failed. Ensure Vertex AI, AI Studio, or Ollama are configured correctly."
    )


# ── JSON Cleaning ───────────────────────────────────────────────────────────

_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```")

def _clean_json(raw: str) -> str:
    """Strip markdown fences and extract JSON object from LLM response."""
    if not raw:
        return ""

    match = _JSON_FENCE_RE.search(raw)
    if match:
        return match.group(1).strip()

    first = raw.find("{")
    last = raw.rfind("}")
    if first != -1 and last > first:
        return raw[first : last + 1].strip()
    return raw.strip()