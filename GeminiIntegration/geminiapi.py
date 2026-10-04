"""Minimal client for Google's Gemini API (REST). Reads GEMINI_API_KEY from .env or the environment."""
import json
import os
import urllib.error
import urllib.request

BASE_URL = "https://generativelanguage.googleapis.com/v1beta"


def load_env(path=".env"):
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), path)
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env()


def call(path, body=None):
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY is not set. Add it to .env (see .env.example).")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        BASE_URL + path,
        data=data,
        headers={"x-goog-api-key": key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Gemini API {e.code}: {e.read().decode()}") from None


def list_models():
    return call("/models?pageSize=100")


def generate(prompt, model="gemini-flash-latest", image_b64=None, mime="image/png"):
    parts = [{"text": prompt}]
    if image_b64:
        parts.append({"inline_data": {"mime_type": mime, "data": image_b64}})
    return call(f"/models/{model}:generateContent", {"contents": [{"parts": parts}]})


def chat(messages, model="gemini-flash-latest", system=None):
    """messages: [{"role": "user"|"model", "text": str}, ...]"""
    body = {"contents": [{"role": m["role"], "parts": [{"text": m["text"]}]} for m in messages]}
    if system:
        body["system_instruction"] = {"parts": [{"text": system}]}
    return call(f"/models/{model}:generateContent", body)


def count_tokens(text, model="gemini-flash-latest"):
    return call(f"/models/{model}:countTokens", {"contents": [{"parts": [{"text": text}]}]})


def embed(text, model="gemini-embedding-001"):
    return call(f"/models/{model}:embedContent", {"content": {"parts": [{"text": text}]}})


if __name__ == "__main__":
    for m in list_models().get("models", []):
        print(m["name"], "-", ", ".join(m.get("supportedGenerationMethods", [])))
