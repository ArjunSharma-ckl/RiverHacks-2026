"""Search for a named surface image and ask Gemini for a roughness proxy."""

import base64
import ipaddress
import json
import math
import os
import socket
from functools import lru_cache
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen

from backend import env_config as _env_config  # noqa: F401 - load local .env values.


SERPAPI_URL = "https://serpapi.com/search.json"
GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"
MAX_SEARCH_BYTES = 2_000_000
MAX_IMAGE_BYTES = 6_000_000
MAX_GEMINI_RESPONSE_BYTES = 1_000_000
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
ROUGHNESS_LIMITATIONS = [
    "Google Images may return a nearby, regional, or illustrative image rather than the exact point.",
    "An image-derived micrometer value is a Gemini visual proxy, not a profilometer measurement or calibrated Ra/Rq value.",
    "Without a visible scale reference, the estimate is an unscaled visual prior and has very high uncertainty.",
]

ROUGHNESS_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "surface_roughness_um": {
            "type": "NUMBER",
            "description": "Positive order-of-magnitude visual texture roughness proxy in micrometers.",
        },
        "roughness_range_um": {
            "type": "ARRAY",
            "items": {"type": "NUMBER"},
            "minItems": 2,
            "maxItems": 2,
            "description": "Low and high plausible values in micrometers.",
        },
        "confidence": {"type": "STRING", "enum": ["low", "medium", "high"]},
        "scale_reference_present": {"type": "BOOLEAN"},
        "texture_description": {"type": "STRING"},
        "estimate_basis": {"type": "STRING"},
    },
    "required": [
        "surface_roughness_um", "roughness_range_um", "confidence",
        "scale_reference_present", "texture_description", "estimate_basis",
    ],
    "propertyOrdering": [
        "surface_roughness_um", "roughness_range_um", "confidence",
        "scale_reference_present", "texture_description", "estimate_basis",
    ],
}


def credentials_available():
    return bool(os.environ.get("SERPAPI_API_KEY", "").strip()) and bool(
        os.environ.get("GEMINI_API_KEY", "").strip()
    )


def _validate_public_https_url(url):
    parsed = urlsplit(str(url))
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Only public HTTPS image URLs are accepted.")
    if parsed.port not in (None, 443):
        raise ValueError("Nonstandard ports are not accepted for image URLs.")
    host = parsed.hostname.rstrip(".").casefold()
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        raise ValueError("Private image hosts are not accepted.")
    try:
        addresses = [ipaddress.ip_address(host)]
    except ValueError:
        try:
            addresses = [
                ipaddress.ip_address(item[4][0])
                for item in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
            ]
        except OSError as error:
            raise ValueError("The image host could not be resolved safely.") from error
    if not addresses or any(
        not address.is_global
        or address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        for address in addresses
    ):
        raise ValueError("Private or reserved image hosts are not accepted.")
    return parsed


class _PublicHttpsRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        try:
            _validate_public_https_url(new_url)
        except ValueError:
            return None
        return super().redirect_request(request, file_pointer, code, message, headers, new_url)


def _serpapi_image_results(query):
    api_key = os.environ.get("SERPAPI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("SERPAPI_API_KEY is not configured in the environment or .env file.")
    url = f"{SERPAPI_URL}?{urlencode({'engine': 'google_images', 'q': query, 'api_key': api_key, 'ijn': '0'})}"
    request = Request(url, headers={"User-Agent": "RiverHacksMissionBackend/1.0"})
    try:
        with urlopen(request, timeout=30) as response:
            raw = response.read(MAX_SEARCH_BYTES + 1)
    except (OSError, URLError, TimeoutError, HTTPError) as error:
        raise RuntimeError("SerpAPI image search failed; verify the API key and service quota.") from error
    if len(raw) > MAX_SEARCH_BYTES:
        raise RuntimeError("SerpAPI returned an unexpectedly large response.")
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise RuntimeError("SerpAPI returned invalid JSON.") from error
    if not isinstance(payload, dict):
        raise RuntimeError("SerpAPI returned an unexpected response format.")
    if payload.get("error"):
        raise RuntimeError("SerpAPI image search failed; verify the API key and service quota.")
    results = payload.get("images_results")
    if not isinstance(results, list) or not results:
        raise RuntimeError("SerpAPI found no usable images for the requested location.")
    return results


def _download_image(result):
    candidates = [result.get("original"), result.get("thumbnail")]
    last_error = None
    for image_url in dict.fromkeys(url for url in candidates if isinstance(url, str) and url.strip()):
        try:
            _validate_public_https_url(image_url)
            opener = build_opener(_PublicHttpsRedirectHandler())
            request = Request(image_url, headers={"User-Agent": "Mozilla/5.0 (compatible; MissionSurfaceAnalyzer/1.0)", "Accept": "image/avif,image/webp,image/png,image/jpeg"})
            with opener.open(request, timeout=25) as response:
                content_type = response.headers.get_content_type().casefold()
                declared = response.headers.get("Content-Length")
                if declared and int(declared) > MAX_IMAGE_BYTES:
                    raise ValueError("The image exceeds the 6 MB limit.")
                if content_type not in ALLOWED_IMAGE_TYPES:
                    raise ValueError("The selected result is not a supported JPEG, PNG, or WebP image.")
                data = response.read(MAX_IMAGE_BYTES + 1)
                if len(data) > MAX_IMAGE_BYTES:
                    raise ValueError("The image exceeds the 6 MB limit.")
                if not data:
                    raise ValueError("The selected image is empty.")
            return data, content_type, image_url
        except (OSError, URLError, TimeoutError, ValueError, HTTPError) as error:
            last_error = error
    raise RuntimeError("Could not download a safe, supported image from the search results.") from last_error


def _gemini_estimate(image_bytes, mime_type, location_name, body, image_title):
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured in the environment or .env file.")
    model = os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
    url = f"{GEMINI_API_ROOT}/{model}:generateContent"
    prompt = (
        f"You are assessing a search-result image associated with {location_name} on {body}. "
        f"Image title: {image_title[:300]}. Estimate an order-of-magnitude apparent surface-texture roughness proxy in micrometers. "
        "This is a visual estimate, not a direct profilometry measurement. Do not call it a measured Ra or Rq. "
        "If no physical scale is visible, still provide a very-low-confidence visual prior, set scale_reference_present=false, "
        "use a broad plausible low/high interval with at least a tenfold span, and explain that the view is unscaled. "
        "If the image is a map, illustration, unrelated, or has no visible surface texture, use a conservative very-low-confidence prior "
        "and say so in estimate_basis. Return only the requested JSON fields."
    )
    payload = {
        "contents": [{
            "role": "user",
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": mime_type, "data": base64.b64encode(image_bytes).decode("ascii")}},
            ],
        }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": ROUGHNESS_SCHEMA,
            "temperature": 0.1,
        },
    }
    request = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    try:
        with urlopen(request, timeout=60) as response:
            raw = response.read(MAX_GEMINI_RESPONSE_BYTES + 1)
    except (OSError, URLError, TimeoutError, HTTPError) as error:
        raise RuntimeError("Gemini roughness analysis failed; verify the API key, model, and quota.") from error
    if len(raw) > MAX_GEMINI_RESPONSE_BYTES:
        raise RuntimeError("Gemini returned an unexpectedly large response.")
    try:
        response_data = json.loads(raw)
        text = response_data["candidates"][0]["content"]["parts"][0]["text"]
        estimate = json.loads(text)
    except (json.JSONDecodeError, KeyError, IndexError, TypeError, UnicodeDecodeError) as error:
        raise RuntimeError("Gemini returned an invalid roughness response.") from error

    try:
        roughness = float(estimate["surface_roughness_um"])
        interval = [float(value) for value in estimate["roughness_range_um"]]
        scale_present = estimate["scale_reference_present"]
    except (KeyError, TypeError, ValueError) as error:
        raise RuntimeError("Gemini did not return numeric roughness fields.") from error
    if (
        not math.isfinite(roughness)
        or roughness <= 0
        or roughness > 1_000_000
        or len(interval) != 2
        or any(not math.isfinite(value) or value <= 0 or value > 1_000_000 for value in interval)
        or not isinstance(scale_present, bool)
    ):
        raise RuntimeError("Gemini returned roughness values outside the accepted range.")
    interval.sort()
    interval[0] = min(interval[0], roughness)
    interval[1] = max(interval[1], roughness)
    confidence = estimate.get("confidence", "low")
    if confidence not in {"low", "medium", "high"}:
        confidence = "low"
    if not scale_present:
        confidence = "low"
        if interval[1] < interval[0] * 10:
            interval[1] = interval[0] * 10
    return {
        "surface_roughness_um": round(roughness, 3),
        "roughness_range_um": [round(interval[0], 3), round(interval[1], 3)],
        "roughness_metric": "Gemini visual texture proxy; not calibrated Ra/Rq",
        "confidence": confidence,
        "scale_reference_present": scale_present,
        "texture_description": str(estimate.get("texture_description", ""))[:800],
        "estimate_basis": str(estimate.get("estimate_basis", ""))[:800],
        "source": {
            "name": "Gemini multimodal visual estimate",
            "model": model,
            "image_search_provider": "SerpAPI Google Images",
        },
        "limitations": list(ROUGHNESS_LIMITATIONS),
    }


@lru_cache(maxsize=128)
def estimate_surface_roughness(location_name, body="Moon", latitude=None, longitude=None):
    """Search a place image and return Gemini's micrometer visual proxy."""
    if not credentials_available():
        missing = []
        if not os.environ.get("SERPAPI_API_KEY", "").strip():
            missing.append("SERPAPI_API_KEY")
        if not os.environ.get("GEMINI_API_KEY", "").strip():
            missing.append("GEMINI_API_KEY")
        raise RuntimeError(f"Configure {', '.join(missing)} in .env before requesting image roughness.")
    if not isinstance(location_name, str) or not location_name.strip():
        raise ValueError("name must be a non-empty surface location name.")
    if len(location_name.strip()) > 160:
        raise ValueError("name must be no longer than 160 characters.")
    body = str(body).strip().title()
    if body not in {"Moon", "Earth", "Mars"}:
        raise ValueError("body must be Moon, Earth, or Mars.")
    search_terms = [location_name.strip(), body, "surface terrain close-up geology texture"]
    if latitude is not None and longitude is not None:
        search_terms.extend((f"latitude {float(latitude):.5f}", f"longitude {float(longitude):.5f}"))
    query = " ".join(search_terms)
    results = _serpapi_image_results(query)
    selected_result = next((
        result for result in results
        if isinstance(result, dict)
        and not result.get("unsafe")
        and (result.get("original") or result.get("thumbnail"))
    ), None)
    if selected_result is None:
        raise RuntimeError("SerpAPI did not return a safe image result.")
    image_bytes, mime_type, used_image_url = _download_image(selected_result)
    estimate = _gemini_estimate(
        image_bytes, mime_type, location_name.strip(), body, str(selected_result.get("title", ""))
    )
    estimate["image"] = {
        "title": str(selected_result.get("title", ""))[:500],
        "source": str(selected_result.get("source", ""))[:200],
        "source_page_url": selected_result.get("link"),
        "image_url": used_image_url,
        "width": selected_result.get("original_width"),
        "height": selected_result.get("original_height"),
        "search_query": query,
    }
    return estimate
