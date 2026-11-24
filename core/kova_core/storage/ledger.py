from pathlib import Path

from ..domain.ledger import LedgerEvent


def append_event(hub: Path, event: LedgerEvent) -> None:
    path = hub / "ledger" / "events.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(event.model_dump_json() + "\n")


def list_events(hub: Path, limit: int = 30) -> list[LedgerEvent]:
    path = hub / "ledger" / "events.jsonl"
    if not path.is_file():
        return []

    events: list[LedgerEvent] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            events.append(LedgerEvent.model_validate_json(line))
        except ValueError:
            continue
    events.reverse()
    return events[:limit]
