import json
from pathlib import Path
from typing import Any, Callable

from . import tools
from .api_provider import RunCancelled, run_chat

PROTOCOL = """
Ты — агент Kova внутри проекта. Работай только внутри рабочей папки.
Отвечай ОДНИМ JSON-объектом без markdown и без пояснений вокруг.

Вызвать инструмент:
{"tool": "read_file", "args": {"path": "src/app.ts"}}

Завершить работу:
{"final": "краткий отчёт: что сделано, что проверено, что осталось"}

За один шаг — один инструмент. После результата инструмента реши следующий шаг.
Не выдумывай содержимое файлов: читай их инструментом.
"""


def _merge_usage(total: dict[str, Any], usage: dict[str, Any] | None) -> None:
    if not isinstance(usage, dict):
        return
    for key, value in usage.items():
        if isinstance(value, (int, float)):
            total[key] = int(total.get(key, 0)) + int(value)
        elif key not in total:
            total[key] = value


def _decision(text: str) -> dict[str, Any] | None:
    value = text.strip()
    if value.startswith("```"):
        lines = [line for line in value.splitlines() if not line.strip().startswith("```")]
        value = "\n".join(lines).strip()
    start = value.find("{")
    end = value.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        payload = json.loads(value[start : end + 1])
    except ValueError:
        return None
    return payload if isinstance(payload, dict) else None


def _action_for(name: str, args: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    if name == "run_command":
        return {
            "kind": "command",
            "value": str(args.get("command") or ""),
            "exit_code": result.get("exit_code"),
        }
    path = str(args.get("path") or "")
    if name == "write_file":
        return {"kind": "file", "value": path, "change": "write"}
    if name == "delete_file":
        return {"kind": "file", "value": path, "change": "delete"}
    return {"kind": "file", "value": path or ".", "change": "read"}


def run_agent(
    provider: dict[str, Any],
    prompt: str,
    api_key: str,
    root: Path,
    policy: str,
    on_text: Callable[[str], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
    approve: Callable[[str, dict[str, Any]], bool] | None = None,
) -> tuple[str, dict[str, Any] | None, list[dict[str, Any]]]:
    system = PROTOCOL + "\n" + tools.tool_specs(policy) + "\n"
    transcript = f"## Задача\n{prompt}\n"
    log: list[str] = []
    actions: list[dict[str, Any]] = []
    usage: dict[str, Any] = {}
    last_text = ""

    for step in range(12):
        if should_stop is not None and should_stop():
            raise RunCancelled()
        request = (
            transcript
            + "\n## Следующий шаг\n"
            + "Верни только JSON: инструмент или final.\n"
        )
        text, turn_usage = run_chat(
            provider,
            request,
            api_key,
            on_text=on_text,
            should_stop=should_stop,
            system=system,
        )
        _merge_usage(usage, turn_usage)
        last_text = text
        decision = _decision(text)

        if decision is not None and "final" in decision:
            final = str(decision.get("final") or "").strip()
            prefix = "\n".join(log)
            output = (prefix + "\n\n" + final).strip() if prefix else final
            return output or "Готово.", usage or None, actions

        name = str(decision.get("tool") or "") if decision else ""
        args = decision.get("args") if decision and isinstance(decision.get("args"), dict) else {}
        if not name:
            prefix = "\n".join(log)
            output = (prefix + "\n\n" + text).strip() if prefix else text
            return output, usage or None, actions

        if tools.needs_approval(name) and tools.permitted(name, policy):
            allowed = approve(name, args) if approve is not None else False
            if not allowed:
                actions.append({
                    "kind": "file" if name != "run_command" else "command",
                    "value": str(args.get("path") or args.get("command") or name),
                    "change": "denied",
                })
                raise RunCancelled()

        try:
            result = tools.run_tool(name, args, root, policy)
        except Exception as exc:
            result = {"ok": False, "error": str(exc)[:500]}

        status = "ok" if result.get("ok") else "error"
        line = f"{name} {args.get('path') or args.get('command') or ''} — {status}"
        log.append(f"• {line}")
        actions.append(_action_for(name, args, result))
        transcript += (
            f"\nASSISTANT: {text}\n"
            f"TOOL_RESULT {name}: {json.dumps(result, ensure_ascii=False)[:12000]}\n"
        )
        if on_text is not None:
            on_text("\n".join(log) + "\n…")

    return (
        ("\n".join(log) + "\n\nДостигнут лимит шагов.\n" + last_text).strip(),
        usage or None,
        actions,
    )
