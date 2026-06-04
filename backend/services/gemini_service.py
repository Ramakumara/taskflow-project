import os
from functools import lru_cache


@lru_cache(maxsize=1)
def _get_model():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None

    try:
        import google.generativeai as genai

        genai.configure(api_key=api_key)
        return genai.GenerativeModel("gemini-2.5-flash")
    except Exception:
        return None


def ask_gemini(prompt: str) -> str | None:
    model = _get_model()
    if model is None:
        return None

    try:
        response = model.generate_content(prompt)
        text = getattr(response, "text", None)
        return str(text).strip() if text else None
    except Exception:
        return None
