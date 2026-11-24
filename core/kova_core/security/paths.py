from pathlib import Path


def resolve_inside(project_dir: Path, candidate: str | Path) -> Path:
    root = project_dir.resolve()
    target = Path(candidate)
    if not target.is_absolute():
        target = root / target
    resolved = target.resolve()

    if resolved != root and root not in resolved.parents:
        raise ValueError(f"path escapes project: {candidate}")

    return resolved
