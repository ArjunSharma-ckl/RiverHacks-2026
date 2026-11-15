"""Append-only JSON Lines storage for local mission observations."""

import json
import os
from pathlib import Path


DEFAULT_DATA_FILE = Path(__file__).parent / "data" / "observations.jsonl"


def data_file() -> Path:
    configured = os.environ.get("MISSION_DATA_FILE")
    return Path(configured).expanduser() if configured else DEFAULT_DATA_FILE


def append_observation(observation: dict) -> None:
    path = data_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(observation, ensure_ascii=False, allow_nan=False) + "\n")


def list_observations(phase_id: str | None = None) -> list[dict]:
    path = data_file()
    if not path.exists():
        return []

    records = []
    with path.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as error:
                raise RuntimeError(f"Invalid observation data on line {line_number}.") from error
            if phase_id is None or record.get("phase_id") == phase_id:
                records.append(record)
    records.reverse()
    return records
