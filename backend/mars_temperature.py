"""Query point surface temperatures from the Mars Climate Database (MCD)."""

from functools import lru_cache
import math
import re
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


MCD_VERSION = "6.2"
MCD_URL = "https://www-mars.lmd.jussieu.fr/mcd_python/"
MCD_QUERY_URL = "https://www-mars.lmd.jussieu.fr/mcd_python/cgi-bin/mcdcgi.py"
MCD_SOURCE = {
    "name": "Mars Climate Database v6.2",
    "provider": "Laboratoire de Météorologie Dynamique / University of Oxford / IAA / ESA / CNES",
    "version": MCD_VERSION,
    "url": MCD_URL,
    "measurement": "modeled surface temperature at the requested Mars location, season, and local time",
    "units": "K",
    "model_type": "climatology; not a current weather observation",
    "spatial_method": "linear interpolation from the MCD climate grid",
}

DUST_SCENARIOS = {
    1: "climatology average solar",
    2: "climatology minimum solar",
    3: "climatology maximum solar",
    4: "dust storm minimum solar",
    5: "dust storm average solar",
}
_TEMPERATURE_PATTERN = re.compile(
    r"Temperature\s*\(K\)\s*\.{2,}\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)",
    re.IGNORECASE,
)


def _validated_float(value, label, minimum, maximum, upper_exclusive=False):
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{label} must be a number.") from error
    if not math.isfinite(number) or number < minimum or (number >= maximum if upper_exclusive else number > maximum):
        end = f"less than {maximum:g}" if upper_exclusive else f"at most {maximum:g}"
        raise ValueError(f"{label} must be between {minimum:g} and {end}.")
    return number


@lru_cache(maxsize=256)
def _query_mcd_cached(latitude, longitude_east, solar_longitude, local_time, dust_scenario):
    params = {
        "var1": "t",
        "var2": "none",
        "var3": "none",
        "var4": "none",
        "datekeyhtml": "1",
        "ls": f"{solar_longitude:g}",
        "localtime": f"{local_time:g}",
        "latitude": f"{latitude:g}",
        "longitude": f"{longitude_east:g}",
        "altitude": "0",
        "zkey": "3",
        "spacecraft": "none",
        "betatest": "on",
        "isfixedlt": "on",
        "dust": str(dust_scenario),
    }
    request = Request(
        f"{MCD_QUERY_URL}?{urlencode(params)}",
        headers={"User-Agent": "RiverHacksMissionBackend/1.0", "Accept": "text/html"},
    )
    try:
        with urlopen(request, timeout=45) as response:
            if getattr(response, "status", 200) != 200:
                raise URLError(f"MCD returned HTTP {response.status}.")
            payload = response.read(128_000).decode("utf-8", errors="replace")
    except (OSError, URLError, TimeoutError) as error:
        raise RuntimeError(f"Could not query the Mars Climate Database: {error}") from error

    match = _TEMPERATURE_PATTERN.search(payload)
    if not match:
        raise RuntimeError("The Mars Climate Database response did not contain a surface temperature.")
    temperature = float(match.group(1))
    if not math.isfinite(temperature) or not 50.0 <= temperature <= 400.0:
        raise RuntimeError("The Mars Climate Database returned an invalid surface temperature.")
    return temperature


def query_mars_temperature(
    latitude,
    longitude_east,
    solar_longitude=0.0,
    local_time=12.0,
    dust_scenario=1,
):
    """Return MCD modeled surface temperature at a point in its season/diurnal cycle."""
    latitude = _validated_float(latitude, "latitude", -90.0, 90.0)
    longitude_east = _validated_float(longitude_east, "longitude_east", -360.0, 720.0) % 360.0
    solar_longitude = _validated_float(solar_longitude, "solar_longitude", 0.0, 360.0, upper_exclusive=True)
    local_time = _validated_float(local_time, "local_time", 0.0, 24.0, upper_exclusive=True)
    try:
        dust_scenario = int(dust_scenario)
    except (TypeError, ValueError) as error:
        raise ValueError("dust_scenario must be an integer from 1 to 5.") from error
    if dust_scenario not in DUST_SCENARIOS:
        raise ValueError("dust_scenario must be an integer from 1 to 5.")

    value_kelvin = _query_mcd_cached(
        latitude, longitude_east, solar_longitude, local_time, dust_scenario
    )
    return {
        "status": "available",
        "surface_temperature_kelvin": round(value_kelvin, 3),
        "surface_temperature_celsius": round(value_kelvin - 273.15, 3),
        "solar_longitude_degrees": solar_longitude,
        "local_time_hours": local_time,
        "altitude_m_above_local_surface": 0,
        "dust_scenario": DUST_SCENARIOS[dust_scenario],
        "source": MCD_SOURCE,
    }
