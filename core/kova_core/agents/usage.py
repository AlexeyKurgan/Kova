from pathlib import Path
from typing import Any


def token_total(usage: dict[str, Any] | None) -> int | None:
    if not isinstance(usage, dict):
        return None
    for key in ("total_tokens", "totalTokens", "total"):
        value = usage.get(key)
        if isinstance(value, (int, float)) and value >= 0:
            return int(value)
    parts: list[int] = []
    for key in (
        "input_tokens",
        "output_tokens",
        "prompt_tokens",
        "completion_tokens",
    ):
        value = usage.get(key)
        if isinstance(value, (int, float)) and value >= 0:
            parts.append(int(value))
    return sum(parts) if parts else None


def usage_summary(hub: Path, budget: int = 0) -> dict[str, Any]:
    from .runner import list_runs_raw

    total = 0
    known = 0
    unknown = 0
    for run in list_runs_raw(hub):
        if run.get("status") not in {"succeeded", "failed", "cancelled", "interrupted"}:
            continue
        tokens = token_total(run.get("usage"))
        if tokens is None:
            unknown += 1
            continue
        total += tokens
        known += 1
    remaining = max(0, budget - total) if budget > 0 else None
    return {
        "budget": budget,
        "used": total,
        "known_runs": known,
        "unknown_runs": unknown,
        "remaining": remaining,
        "exhausted": bool(budget > 0 and total >= budget),
    }
