#!/usr/bin/env python3
"""
Terra AI backend.

  * Keeps GEMINI_API_KEY server-side (read from .env) and streams Gemini replies to the UI,
    with function-calling tools that let the model drive the 3D terrain.
  * Serves real Digital Elevation Model data cached by worldgen.py (Copernicus / Terrarium / Open-Meteo).
  * Geocodes place names / coordinates and fetches new DEMs on demand (never synthetic terrain).
  * Reports the real state of the FPGA artifacts that worldgen.py exported.

Run:   venv/bin/python earthelevate_server.py        ->  http://localhost:8787
Dev:   cd earthelevate && npm run dev                ->  http://localhost:5173 (proxies /api here)
"""
import time
import json
import math
import os
import re
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

import geminiapi  # noqa: E402  (also loads .env)
import worldgen  # noqa: E402

CACHE_DIR = os.path.join(HERE, "cache")
OUT_DIR = os.path.join(HERE, "out")
DIST_DIR = os.path.join(HERE, "earthelevate", "dist")
PORT = int(os.environ.get("EARTHELEVATE_PORT", "8787"))
FALLBACK_MODELS = ["gemini-flash-lite-latest", "gemini-2.5-flash", "gemini-2.5-flash-lite"]
DEFAULT_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")
GRID = worldgen.GRID
KEY_RE = re.compile(r"^[a-z0-9][a-z0-9\-_.]{0,120}$")
MAX_BODY = 4 * 1024 * 1024

# Coordinates for caches created before sidecar metadata existed.
KNOWN_PLACES = {
    "vancouver-british-columbia-canada": (49.2827, -123.1207, "Vancouver, British Columbia, Canada"),
}

# --------------------------------------------------------------------------- Gemini tools
ENUM_LAYERS = ["elevation", "slope", "contours", "flood_risk", "landslide_risk", "voxel", "satellite"]

TOOLS = [{
    "functionDeclarations": [
        {
            "name": "set_layer",
            "description": "Turn a visualization layer on or off. elevation, slope, flood_risk, landslide_risk and satellite are mutually exclusive base colour layers (enabling one replaces the current one). contours and voxel are toggles.",
            "parameters": {"type": "object", "properties": {
                "layer": {"type": "string", "enum": ENUM_LAYERS},
                "enabled": {"type": "boolean", "description": "Defaults to true."}},
                "required": ["layer"]},
        },
        {
            "name": "highlight_elevation_range",
            "description": "Highlight every part of the terrain within an elevation band in metres above sea level. Use only max_m for 'below X', only min_m for 'above X'.",
            "parameters": {"type": "object", "properties": {
                "min_m": {"type": "number"}, "max_m": {"type": "number"}}},
        },
        {
            "name": "highlight_extreme",
            "description": "Highlight the highest areas, lowest areas or steepest regions of the terrain (top N percent of cells).",
            "parameters": {"type": "object", "properties": {
                "feature": {"type": "string", "enum": ["highest", "lowest", "steepest"]},
                "percent": {"type": "number", "description": "Top percent of cells to highlight, default 8."}},
                "required": ["feature"]},
        },
        {
            "name": "clear_highlights",
            "description": "Remove any highlight, cross-section and selection overlays.",
            "parameters": {"type": "object", "properties": {}},
        },
        {
            "name": "focus_on",
            "description": "Fly the camera to a notable feature, select that point and return its measurements.",
            "parameters": {"type": "object", "properties": {
                "target": {"type": "string", "enum": ["highest_point", "lowest_point", "steepest_slope", "center", "selected_point"]}},
                "required": ["target"]},
        },
        {
            "name": "select_point",
            "description": "Select a point by latitude/longitude (must be inside the loaded terrain) and return its measurements.",
            "parameters": {"type": "object", "properties": {
                "latitude": {"type": "number"}, "longitude": {"type": "number"}},
                "required": ["latitude", "longitude"]},
        },
        {
            "name": "rotate_camera",
            "description": "Rotate the camera so it looks toward a compass direction (e.g. north puts north at the top of the view), or orbit by a number of degrees.",
            "parameters": {"type": "object", "properties": {
                "direction": {"type": "string", "enum": ["north", "south", "east", "west", "left", "right"]},
                "degrees": {"type": "number", "description": "For left/right orbit. Default 45."}},
                "required": ["direction"]},
        },
        {
            "name": "zoom",
            "description": "Zoom the camera. 'mountain' zooms onto the highest peak.",
            "parameters": {"type": "object", "properties": {
                "action": {"type": "string", "enum": ["in", "out", "reset", "mountain", "selected_point"]},
                "factor": {"type": "number", "description": "Multiplier for in/out, default 1.6."}},
                "required": ["action"]},
        },
        {
            "name": "set_view_mode",
            "description": "Switch between the smooth realistic surface and the Minecraft-style voxel world.",
            "parameters": {"type": "object", "properties": {
                "mode": {"type": "string", "enum": ["surface", "voxel"]}}, "required": ["mode"]},
        },
        {
            "name": "start_simulation",
            "description": "Start a flood or landslide VISUALIZATION on the current terrain. For floods give rainfall_mm (rain event) and/or water_level_m (absolute water surface in metres above sea level). For landslides give rainfall_mm as the trigger. These are illustrative simulations, not certified predictions.",
            "parameters": {"type": "object", "properties": {
                "type": {"type": "string", "enum": ["flood", "landslide"]},
                "rainfall_mm": {"type": "number"}, "water_level_m": {"type": "number"}},
                "required": ["type"]},
        },
        {
            "name": "stop_simulation",
            "description": "Stop and clear the running disaster simulation.",
            "parameters": {"type": "object", "properties": {}},
        },
        {
            "name": "show_cross_section",
            "description": "Draw an elevation cross-section line across the terrain and show its elevation profile.",
            "parameters": {"type": "object", "properties": {
                "orientation": {"type": "string", "enum": ["east_west", "north_south", "through_selected", "highest_to_lowest"]},
                "position_percent": {"type": "number", "description": "0-100 position of the line across the terrain (default 50). Ignored for through_selected and highest_to_lowest."}},
                "required": ["orientation"]},
        },
        {
            "name": "set_vertical_exaggeration",
            "description": "Set the vertical exaggeration of the terrain (1 = true scale, up to 6).",
            "parameters": {"type": "object", "properties": {"value": {"type": "number"}}, "required": ["value"]},
        },
        {
            "name": "search_location",
            "description": "Move to a place by name or by 'lat, lon' coordinates when a terrain dataset can be loaded for it.",
            "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
        },
    ]
}]

# ---- Live location data (Open-Meteo). Independent of the DEM/FPGA pipeline. ----
WMO = {0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Rime fog",
       51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Heavy freezing drizzle",
       61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Heavy freezing rain",
       71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Light rain showers", 81: "Rain showers",
       82: "Violent rain showers", 85: "Light snow showers", 86: "Heavy snow showers", 95: "Thunderstorm",
       96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail"}
_LIVE_CACHE = {}


def fetch_live(lat, lon):
    ck = (round(lat, 2), round(lon, 2))
    hit = _LIVE_CACHE.get(ck)
    if hit and time.time() - hit[0] < 300:
        return hit[1]
    q = urllib.parse.urlencode({"latitude": lat, "longitude": lon, "timezone": "auto",
                                "current": "temperature_2m,weather_code,is_day"})
    req = urllib.request.Request("https://api.open-meteo.com/v1/forecast?" + q, headers={"User-Agent": "TerraAI/1.0"})
    with urllib.request.urlopen(req, timeout=10) as r:
        d = json.loads(r.read())
    cur = d.get("current") or {}
    code = cur.get("weather_code")
    out = {
        "ok": True, "source": "Open-Meteo", "latitude": lat, "longitude": lon, "grid_latitude": d.get("latitude"), "grid_longitude": d.get("longitude"),
        "elevation_m": d.get("elevation"), "timezone": d.get("timezone"), "timezone_abbreviation": d.get("timezone_abbreviation"),
        "utc_offset_seconds": d.get("utc_offset_seconds"), "local_time": cur.get("time"),
        "temperature_c": cur.get("temperature_2m"), "weather_code": code,
        "weather": WMO.get(code, "Unknown") if code is not None else None,
        "is_day": bool(cur.get("is_day")) if cur.get("is_day") is not None else None,
        "fetched_at_unix": int(time.time()),
    }
    _LIVE_CACHE[ck] = (time.time(), out)
    return out


SYSTEM_PROMPT = """You are Terra AI, the copilot inside a 3D geospatial terrain explorer ("Ask the Earth anything").
The user is looking at a real Digital Elevation Model (DEM) rendered in 3D. The live scene state is in TERRAIN CONTEXT below.

Rules:
- Answer questions about THIS terrain using the numbers in the context. Quote real values (metres, degrees, coordinates). Never invent measurements; if something is not in the context, say it is not available.
- Live weather, local time and timezone exist ONLY in the `live_location` field of the context (from Open-Meteo, for the selected point or the dataset centre). Use those values for weather/time/temperature questions and cite the place and time they refer to. If `live_location` is missing or has ok=false, say live data is unavailable. Never guess weather or time, and you have no other live feeds (traffic, forecasts, etc.).
- When the user asks you to change the view (show/hide layers, highlight, zoom, rotate, fly somewhere, start a simulation, cross-section, search a place), CALL THE MATCHING TOOL instead of just describing it, then confirm briefly using the tool result. You may call several tools in one turn.
- Flood and landslide outputs are visualization/simulation features based on elevation and slope only. Always describe them as simulations, never as certified predictions or safety guidance.
- Land cover is only known when the context says so; otherwise terrain type is derived from elevation, slope and position.
- Be concise and use Markdown (short paragraphs, bullet lists, **bold** key numbers). No preamble like "Sure!".

TERRAIN CONTEXT (JSON):
"""


# --------------------------------------------------------------------------- terrain data
def slug_key(label, mpp):
    return f"{worldgen.slugify(label)}_{int(mpp)}m"


def meta_path(key):
    return os.path.join(CACHE_DIR, key + ".meta.json")


def read_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return None


def current_world():
    return read_json(os.path.join(OUT_DIR, "world.json"))


def ensure_meta(key):
    """lat/lon/label for a cached DEM. Sidecar first, then the FPGA world, then a geocode."""
    meta = read_json(meta_path(key))
    if meta:
        return meta
    mpp = int(key.rsplit("_", 1)[1].rstrip("m")) if "_" in key else 30
    base = key.rsplit("_", 1)[0]
    meta = None
    w = current_world()
    if w and worldgen.slugify(w["location"]["label"]) == base:
        loc = w["location"]
        meta = {"label": loc["label"], "lat": loc["latitude"], "lon": loc["longitude"], "mpp": mpp}
    elif base in KNOWN_PLACES:
        lat, lon, label = KNOWN_PLACES[base]
        meta = {"label": label, "lat": lat, "lon": lon, "mpp": mpp}
    if meta is None:
        loc = worldgen.geocode(base.replace("-", " "))
        if loc:
            meta = {"label": loc.label, "lat": loc.lat, "lon": loc.lon, "mpp": mpp}
    if meta is None:
        return None
    with open(meta_path(key), "w") as f:
        json.dump(meta, f)
    return meta


def list_terrains():
    out = []
    if not os.path.isdir(CACHE_DIR):
        return out
    for name in sorted(os.listdir(CACHE_DIR)):
        if not name.endswith(".npz"):
            continue
        key = name[:-4]
        meta = ensure_meta(key)
        if meta:
            out.append({"key": key, **meta})
    return out


def load_terrain(key):
    cached = worldgen.load_cache(CACHE_DIR, key)
    if cached is None:
        return None
    meta = ensure_meta(key)
    if meta is None:
        return None
    elev = np.asarray(cached["elev"], dtype=np.float64)
    size = elev.shape[0]
    result = {
        "key": key, **meta,
        "size": size,
        "source": cached.get("elev_source", "cache"),
        "weather": cached.get("weather"),
        "elev": [round(float(v), 1) for v in elev.reshape(-1)],
        "blocks": None,
        "block_types": None,
        "block_colors": None,
        "fpga_match": False,
    }
    w = current_world()
    bin_path = os.path.join(OUT_DIR, "world.bin")
    if w and worldgen.slugify(w["location"]["label"]) == worldgen.slugify(meta["label"]) and os.path.exists(bin_path):
        raw = np.frombuffer(open(bin_path, "rb").read(), dtype=np.uint8)
        if raw.size == size * size:
            result["blocks"] = (raw & 7).astype(int).tolist()
            result["block_types"] = w.get("block_types")
            result["block_colors"] = w.get("block_colors")
            result["fpga_match"] = True
    return result


def crc16_ccitt_false(data):
    crc = 0xFFFF
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def fpga_status():
    w = current_world()
    frame_path = os.path.join(OUT_DIR, "world.frame")
    bin_path = os.path.join(OUT_DIR, "world.bin")
    status = {
        "world_present": w is not None,
        "label": w["location"]["label"] if w else None,
        "generated_utc": w.get("generated_utc") if w else None,
        "grid": w.get("grid") if w else None,
        "block_counts": (w.get("stats") or {}).get("block_counts") if w else None,
        "bin_bytes": os.path.getsize(bin_path) if os.path.exists(bin_path) else None,
        "frame_bytes": None,
        "frame_crc_ok": None,
        "artifacts": {n: os.path.exists(os.path.join(OUT_DIR, n)) for n in ("world.bin", "world.mif", "world.hex", "world.frame")},
        "board": {"configured": False, "host": None, "reachable": None},
        "fps": None,
        "fps_measured": False,
    }
    if os.path.exists(frame_path):
        data = open(frame_path, "rb").read()
        status["frame_bytes"] = len(data)
        if len(data) > 4 and data[:2] == b"\xa5\x5a":
            body, tail = data[2:-2], data[-2:]
            status["frame_crc_ok"] = crc16_ccitt_false(body) == int.from_bytes(tail, "little")
    board = os.environ.get("FPGA_BOARD", "").strip()
    if board:
        host, _, port = board.partition(":")
        status["board"]["configured"] = True
        status["board"]["host"] = board
        try:
            with socket.create_connection((host, int(port or 22)), timeout=1.5):
                status["board"]["reachable"] = True
        except OSError:
            status["board"]["reachable"] = False
    return status


COORD_RE = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*°?\s*([NSns])?\s*[, ;]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EWew])?\s*$")


def search_places(q):
    q = q.strip()
    results = []
    m = COORD_RE.match(q)
    if m:
        lat, ns, lon, ew = float(m.group(1)), m.group(2), float(m.group(3)), m.group(4)
        if ns and ns.lower() == "s":
            lat = -abs(lat)
        if ew and ew.lower() == "w":
            lon = -abs(lon)
        if -85 <= lat <= 85 and -180 <= lon <= 180:
            results.append({"label": f"{lat:.4f}, {lon:.4f}", "lat": lat, "lon": lon, "country": "", "coords": True})
    else:
        try:
            req = urllib.request.Request(
                worldgen.GEOCODE_URL + "?" + urllib.parse.urlencode({"name": q, "count": 5, "language": "en", "format": "json"}),
                headers={"User-Agent": "TerraAI/1.0"})
            with urllib.request.urlopen(req, timeout=10) as r:
                for g in json.load(r).get("results") or []:
                    parts = [g.get("name", q), g.get("admin1", ""), g.get("country", "")]
                    results.append({"label": ", ".join(p for p in parts if p), "lat": float(g["latitude"]),
                                    "lon": float(g["longitude"]), "country": g.get("country", ""), "coords": False})
        except Exception as exc:
            return {"results": [], "error": f"Geocoding unavailable: {exc}"}
    # Prefer an already-cached terrain whose centre is within half a span of the result.
    terrains = list_terrains()
    for r in results:
        r["cached_key"] = None
        for t in terrains:
            half = t["mpp"] * GRID / 2000.0 * 0.9
            dlat = (r["lat"] - t["lat"]) * 111.32
            dlon = (r["lon"] - t["lon"]) * 111.32 * math.cos(math.radians(t["lat"]))
            if abs(dlat) <= half and abs(dlon) <= half:
                r["cached_key"] = t["key"]
                break
    return {"results": results}


def generate_terrain(body):
    lat, lon = float(body["lat"]), float(body["lon"])
    label = str(body.get("label") or f"{lat:.4f}, {lon:.4f}")[:120]
    mpp = float(body.get("mpp") or 30)
    mpp = min(max(mpp, 30), 240)
    key = slug_key(label, mpp)
    if worldgen.load_cache(CACHE_DIR, key) is not None:
        return {"ok": True, "key": key, "cached": True}
    bbox = worldgen.bbox_from_center(lat, lon, mpp)
    elev, source = worldgen.fetch_elevation(bbox, lat)
    if source == "synthetic":
        return {"ok": False, "error": "No real elevation dataset could be downloaded for this location (the network or DEM services are unavailable). Terra AI does not substitute fake terrain."}
    weather = worldgen.fetch_weather(lat, lon)
    worldgen.save_cache(CACHE_DIR, key, elev, None, None, weather, source)
    with open(meta_path(key), "w") as f:
        json.dump({"label": label, "lat": lat, "lon": lon, "mpp": mpp}, f)
    return {"ok": True, "key": key, "cached": False, "source": source}


# --------------------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.address_string(), fmt % args))

    def send_bytes(self, code, data, ctype="application/json", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, code, obj):
        self.send_bytes(code, json.dumps(obj).encode())

    def read_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_BODY:
            raise ValueError("request too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        url = urlparse(self.path)
        path = url.path
        try:
            if path == "/api/health":
                return self.send_json(200, {"ok": True, "gemini_key_configured": bool(os.environ.get("GEMINI_API_KEY")), "model": DEFAULT_MODEL})
            if path == "/api/terrains":
                return self.send_json(200, {"terrains": list_terrains()})
            if path.startswith("/api/terrain/"):
                key = path[len("/api/terrain/"):]
                if not KEY_RE.match(key):
                    return self.send_json(400, {"error": "bad key"})
                t = load_terrain(key)
                return self.send_json(200, t) if t else self.send_json(404, {"error": "terrain not found"})
            if path == "/api/live":
                qs = parse_qs(url.query)
                try:
                    lat = float(qs["lat"][0]); lon = float(qs["lon"][0])
                    assert -90 <= lat <= 90 and -180 <= lon <= 180
                except Exception:
                    return self.send_json(400, {"ok": False, "error": "lat/lon required"})
                try:
                    return self.send_json(200, fetch_live(lat, lon))
                except Exception as exc:
                    return self.send_json(200, {"ok": False, "error": f"Open-Meteo unavailable: {exc}"})
            if path == "/api/search":
                q = (parse_qs(url.query).get("q") or [""])[0]
                if not q.strip():
                    return self.send_json(400, {"error": "empty query"})
                return self.send_json(200, search_places(q))
            if path == "/api/fpga/status":
                return self.send_json(200, fpga_status())
            if path.startswith("/api/"):
                return self.send_json(404, {"error": "not found"})
            return self.serve_static(path)
        except Exception as exc:
            return self.send_json(500, {"error": str(exc)})

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            body = self.read_body()
            if path == "/api/chat/stream":
                return self.chat_stream(body)
            if path == "/api/terrain/generate":
                return self.send_json(200, generate_terrain(body))
            return self.send_json(404, {"error": "not found"})
        except Exception as exc:
            try:
                return self.send_json(500, {"error": str(exc)})
            except Exception:
                pass

    def serve_static(self, path):
        if not os.path.isdir(DIST_DIR):
            msg = "Terra AI UI is not built. Run: cd earthelevate && npm install && npm run build  (or use `npm run dev` on port 5173)."
            return self.send_bytes(200, msg.encode(), "text/plain")
        rel = os.path.normpath(path.lstrip("/")) or "index.html"
        full = os.path.join(DIST_DIR, rel)
        if not full.startswith(DIST_DIR) or not os.path.isfile(full):
            full = os.path.join(DIST_DIR, "index.html")
        ctype = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
                 ".json": "application/json", ".png": "image/png", ".woff2": "font/woff2"}.get(os.path.splitext(full)[1], "application/octet-stream")
        with open(full, "rb") as f:
            self.send_bytes(200, f.read(), ctype)

    def chat_stream(self, body):
        key = os.environ.get("GEMINI_API_KEY")
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True

        def emit(obj):
            self.wfile.write(b"data: " + json.dumps(obj).encode() + b"\n\n")
            self.wfile.flush()

        if not key:
            return emit({"error": "GEMINI_API_KEY is not configured on the server (.env)."})
        model = re.sub(r"[^a-zA-Z0-9._\-]", "", body.get("model") or DEFAULT_MODEL) or DEFAULT_MODEL
        context = json.dumps(body.get("context") or {}, separators=(",", ":"))[:20000]
        payload = {
            "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT + context}]},
            "contents": body.get("contents") or [],
            "tools": TOOLS,
            "generationConfig": {"temperature": 0.6},
        }
        models = [model] + [m for m in FALLBACK_MODELS if m != model]
        data = json.dumps(payload).encode()
        last = "no model available"
        try:
            for attempt, m in enumerate(models * 2):
                url = f"{geminiapi.BASE_URL}/models/{m}:streamGenerateContent?alt=sse"
                req = urllib.request.Request(url, data=data,
                                             headers={"x-goog-api-key": key, "Content-Type": "application/json"})
                try:
                    with urllib.request.urlopen(req, timeout=120) as resp:
                        for line in resp:
                            if line.strip():
                                self.wfile.write(line + b"\n")
                                self.wfile.flush()
                    return
                except urllib.error.HTTPError as e:
                    detail = e.read().decode(errors="replace")
                    try:
                        detail = json.loads(detail)["error"]["message"]
                    except Exception:
                        pass
                    last = f"Gemini API {e.code}: {detail}"
                    if e.code not in (404, 429, 500, 502, 503, 504):
                        break
                    time.sleep(min(1.5 * (attempt // len(models) + 1), 3))
            emit({"error": last + " (all models busy; try again shortly)"})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            emit({"error": f"Gemini request failed: {exc}"})


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Terra AI backend on http://localhost:{PORT}  (Gemini key configured: {bool(os.environ.get('GEMINI_API_KEY'))})")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
