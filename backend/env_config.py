"""Load local developer settings from the repository's ignored .env file."""

import os
from pathlib import Path


ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


def load_local_env(path=ENV_FILE):
    """Read simple KEY=VALUE entries without overriding exported variables."""
    try:
        lines = Path(path).read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        if key:
            os.environ.setdefault(key, value)


load_local_env()
