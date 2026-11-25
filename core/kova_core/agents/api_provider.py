import http.client
import json
import ssl
from typing import Any, Callable
from urllib.parse import parse_qs, urlencode, urlparse

SYSTEM_PROMPT = (
    "Ты работаешь через API без доступа к файлам и терминалу. "
    "Не утверждай, что изменил файлы. Верни анализ, план или код."
)


class RunCancelled(Exception):
    pass


def _split_url(raw: str, default_path: str) -> tuple[str, str, int, str, dict[str, list[str]]]:
    parsed = urlparse(raw.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise RuntimeError("API endpoint должен начинаться с http:// или https://")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    path = parsed.path or default_path
    return parsed.scheme, parsed.hostname, port, path, parse_qs(parsed.query)


def _connect(scheme: str, host: str, port: int, timeout: int) -> http.client.HTTPConnection:
    if scheme == "https":
        return http.client.HTTPSConnection(
            host,
            port,
            timeout=timeout,
            context=ssl.create_default_context(),
        )
    return http.client.HTTPConnection(host, port, timeout=timeout)


def _sse_lines(
    response: http.client.HTTPResponse,
    should_stop: Callable[[], bool] | None,
):
    while True:
        if should_stop is not None and should_stop():
            raise RunCancelled()
        line = response.readline()
        if not line:
            return
        text = line.decode("utf-8", errors="replace").strip()
        if not text.startswith("data:"):
            continue
        payload = text[5:].strip()
        if not payload or payload == "[DONE]":
            continue
        try:
            event = json.loads(payload)
        except ValueError:
            continue
        if isinstance(event, dict):
            yield event


def _error(response: http.client.HTTPResponse, style: str) -> str:
    body = response.read(2000).decode("utf-8", errors="replace").strip()
    return f"{style} API вернул {response.status}: {body[:500]}"


def _run_openai(
    provider: dict[str, Any],
    prompt: str,
    api_key: str,
    on_text: Callable[[str], None] | None,
    should_stop: Callable[[], bool] | None,
    system: str = SYSTEM_PROMPT,
    azure: bool = False,
    media: list[dict[str, Any]] | None = None,
) -> tuple[str, dict[str, Any] | None]:
    scheme, host, port, path, query = _split_url(
        str(provider.get("api_url") or ""), "/v1/chat/completions"
    )
    model = str(provider.get("api_model") or "").strip()
    images = [
        item for item in (media or []) if item.get("kind") == "image" and item.get("data")
    ]
    user_content: Any = prompt
    if images:
        user_content = [{"type": "text", "text": prompt}]
        for image in images:
            user_content.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{image.get('mime') or 'image/png'};base64,{image.get('data')}"
                    },
                }
            )
    body = json.dumps(
        {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user_content},
            ],
            "stream": True,
        }
    ).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "text/event-stream"}
    if azure:
        if api_key:
            headers["api-key"] = api_key
    elif api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if query:
        path += "?" + urlencode({key: values[0] for key, values in query.items()})
    connection = _connect(scheme, host, port, int(provider.get("timeout") or 300))
    chunks: list[str] = []
    usage: dict[str, Any] | None = None
    try:
        connection.request("POST", path, body=body, headers=headers)
        response = connection.getresponse()
        if response.status >= 400:
            raise RuntimeError(_error(response, "OpenAI"))
        for event in _sse_lines(response, should_stop):
            if isinstance(event.get("usage"), dict):
                usage = event["usage"]
            choices = event.get("choices")
            if not isinstance(choices, list):
                continue
            for choice in choices:
                delta = choice.get("delta") if isinstance(choice, dict) else None
                content = delta.get("content") if isinstance(delta, dict) else None
                if isinstance(content, str) and content:
                    chunks.append(content)
                    if on_text is not None:
                        on_text("".join(chunks))
    finally:
        connection.close()
    return "".join(chunks).strip(), usage


def _run_anthropic(
    provider: dict[str, Any],
    prompt: str,
    api_key: str,
    on_text: Callable[[str], None] | None,
    should_stop: Callable[[], bool] | None,
    system: str = SYSTEM_PROMPT,
    media: list[dict[str, Any]] | None = None,
) -> tuple[str, dict[str, Any] | None]:
    scheme, host, port, path, query = _split_url(
        str(provider.get("api_url") or ""), "/v1/messages"
    )
    model = str(provider.get("api_model") or "").strip()
    images = [
        item for item in (media or []) if item.get("kind") == "image" and item.get("data")
    ]
    user_content: Any = prompt
    if images:
        user_content = [{"type": "text", "text": prompt}]
        for image in images:
            user_content.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": image.get("mime") or "image/png",
                        "data": image.get("data"),
                    },
                }
            )
    body = json.dumps(
        {
            "model": model,
            "max_tokens": int(provider.get("api_max_tokens") or 4096),
            "system": system,
            "messages": [{"role": "user", "content": user_content}],
            "stream": True,
        }
    ).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "anthropic-version": "2023-06-01",
    }
    if api_key:
        headers["x-api-key"] = api_key
    if query:
        path += "?" + urlencode({key: values[0] for key, values in query.items()})
    connection = _connect(scheme, host, port, int(provider.get("timeout") or 300))
    chunks: list[str] = []
    usage: dict[str, Any] = {}
    try:
        connection.request("POST", path, body=body, headers=headers)
        response = connection.getresponse()
        if response.status >= 400:
            raise RuntimeError(_error(response, "Anthropic"))
        for event in _sse_lines(response, should_stop):
            kind = event.get("type")
            if kind == "error":
                message = event.get("error")
                raise RuntimeError(f"Anthropic: {str(message)[:300]}")
            if kind == "message_start":
                message = event.get("message")
                if isinstance(message, dict) and isinstance(message.get("usage"), dict):
                    usage.update(message["usage"])
            if kind == "message_delta":
                if isinstance(event.get("usage"), dict):
                    usage.update(event["usage"])
                delta = event.get("delta")
                text = delta.get("text") if isinstance(delta, dict) else None
                if isinstance(text, str) and text:
                    chunks.append(text)
                    if on_text is not None:
                        on_text("".join(chunks))
            if kind == "content_block_delta":
                delta = event.get("delta")
                text = delta.get("text") if isinstance(delta, dict) else None
                if isinstance(text, str) and text:
                    chunks.append(text)
                    if on_text is not None:
                        on_text("".join(chunks))
    finally:
        connection.close()
    return "".join(chunks).strip(), usage or None


def _google_endpoint(provider: dict[str, Any], api_key: str) -> tuple[str, str, int, str]:
    scheme, host, port, path, query = _split_url(
        str(provider.get("api_url") or ""), "/v1beta"
    )
    base = path.rstrip("/")
    model = str(provider.get("api_model") or "").strip()
    if not model:
        raise RuntimeError("не задана API-модель")
    if model.startswith("models/"):
        model = model[len("models/") :]
    path = f"{base}/models/{model}:streamGenerateContent"
    params = {key: values[0] for key, values in query.items()}
    params["alt"] = "sse"
    if api_key:
        params["key"] = api_key
    return scheme, host, port, path + "?" + urlencode(params)


def _run_google(
    provider: dict[str, Any],
    prompt: str,
    api_key: str,
    on_text: Callable[[str], None] | None,
    should_stop: Callable[[], bool] | None,
    system: str = SYSTEM_PROMPT,
    media: list[dict[str, Any]] | None = None,
) -> tuple[str, dict[str, Any] | None]:
    scheme, host, port, path = _google_endpoint(provider, api_key)
    parts: list[dict[str, Any]] = [{"text": prompt}]
    for item in media or []:
        if item.get("kind") in {"image", "video"} and item.get("data"):
            parts.append(
                {
                    "inline_data": {
                        "mime_type": item.get("mime") or "application/octet-stream",
                        "data": item.get("data"),
                    }
                }
            )
    body = json.dumps(
        {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {
                "maxOutputTokens": int(provider.get("api_max_tokens") or 4096)
            },
        }
    ).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "text/event-stream"}
    connection = _connect(scheme, host, port, int(provider.get("timeout") or 300))
    chunks: list[str] = []
    usage: dict[str, Any] | None = None
    try:
        connection.request("POST", path, body=body, headers=headers)
        response = connection.getresponse()
        if response.status >= 400:
            raise RuntimeError(_error(response, "Google"))
        for event in _sse_lines(response, should_stop):
            if isinstance(event.get("usageMetadata"), dict):
                meta = event["usageMetadata"]
                usage = {
                    "input_tokens": meta.get("promptTokenCount", 0),
                    "output_tokens": meta.get("candidatesTokenCount", 0),
                    "total_tokens": meta.get("totalTokenCount", 0),
                }
            candidates = event.get("candidates")
            if not isinstance(candidates, list):
                continue
            for candidate in candidates:
                if not isinstance(candidate, dict):
                    continue
                content = candidate.get("content")
                parts = content.get("parts") if isinstance(content, dict) else None
                if not isinstance(parts, list):
                    continue
                for part in parts:
                    text = part.get("text") if isinstance(part, dict) else None
                    if isinstance(text, str) and text:
                        chunks.append(text)
                        if on_text is not None:
                            on_text("".join(chunks))
    finally:
        connection.close()
    return "".join(chunks).strip(), usage



def _google_token() -> str:
    import os
    import subprocess

    token = os.environ.get("GOOGLE_ACCESS_TOKEN", "").strip()
    if token:
        return token
    try:
        result = subprocess.run(
            ["gcloud", "auth", "print-access-token"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return (result.stdout or "").strip()


def _run_vertex(
    provider: dict,
    prompt: str,
    api_key: str,
    on_text,
    should_stop,
    system: str = SYSTEM_PROMPT,
    media: list[dict] | None = None,
):
    project = str(provider.get("gcp_project") or "").strip()
    region = str(provider.get("gcp_region") or "us-central1").strip()
    model = str(provider.get("api_model") or "").strip()
    if not project or not model:
        raise RuntimeError("для Vertex нужны project и модель")
    token = api_key or _google_token()
    if not token:
        raise RuntimeError("нет Google access token: задай GOOGLE_ACCESS_TOKEN или войди в gcloud")
    host = f"{region}-aiplatform.googleapis.com"
    path = (
        f"/v1/projects/{project}/locations/{region}/publishers/google/models/"
        f"{model}:streamGenerateContent?alt=sse"
    )
    parts: list[dict] = [{"text": prompt}]
    for item in media or []:
        if item.get("kind") in {"image", "video"} and item.get("data"):
            parts.append(
                {
                    "inline_data": {
                        "mime_type": item.get("mime") or "application/octet-stream",
                        "data": item.get("data"),
                    }
                }
            )
    body = json.dumps(
        {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {
                "maxOutputTokens": int(provider.get("api_max_tokens") or 4096)
            },
        }
    ).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Authorization": f"Bearer {token}",
    }
    connection = _connect("https", host, 443, int(provider.get("timeout") or 300))
    chunks = []
    usage = None
    try:
        connection.request("POST", path, body=body, headers=headers)
        response = connection.getresponse()
        if response.status >= 400:
            raise RuntimeError(_error(response, "Vertex"))
        for event in _sse_lines(response, should_stop):
            if isinstance(event.get("usageMetadata"), dict):
                meta = event["usageMetadata"]
                usage = {
                    "input_tokens": meta.get("promptTokenCount", 0),
                    "output_tokens": meta.get("candidatesTokenCount", 0),
                    "total_tokens": meta.get("totalTokenCount", 0),
                }
            candidates = event.get("candidates")
            if not isinstance(candidates, list):
                continue
            for candidate in candidates:
                content = candidate.get("content") if isinstance(candidate, dict) else None
                parts = content.get("parts") if isinstance(content, dict) else None
                for part in parts if isinstance(parts, list) else []:
                    text = part.get("text") if isinstance(part, dict) else None
                    if isinstance(text, str) and text:
                        chunks.append(text)
                        if on_text is not None:
                            on_text("".join(chunks))
    finally:
        connection.close()
    return "".join(chunks).strip(), usage


def _sigv4_headers(method: str, host: str, path: str, region: str, service: str, body: bytes):
    import datetime
    import hashlib
    import hmac
    import os

    access = os.environ.get("AWS_ACCESS_KEY_ID", "").strip()
    secret = os.environ.get("AWS_SECRET_ACCESS_KEY", "").strip()
    session = os.environ.get("AWS_SESSION_TOKEN", "").strip()
    if not access or not secret:
        raise RuntimeError("нет AWS credentials: задай AWS_ACCESS_KEY_ID и AWS_SECRET_ACCESS_KEY")
    now = datetime.datetime.now(datetime.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(body).hexdigest()
    canonical_headers = (
        "content-type:application/json\n"
        f"host:{host}\n"
        f"x-amz-content-sha256:{payload_hash}\n"
        f"x-amz-date:{amz_date}\n"
    )
    signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date"
    canonical_request = (
        f"{method}\n{path}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
    )
    credential_scope = f"{date_stamp}/{region}/{service}/aws4_request"
    string_to_sign = (
        "AWS4-HMAC-SHA256\n"
        + amz_date
        + "\n"
        + credential_scope
        + "\n"
        + hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()
    )

    def sign(key: bytes, data: str) -> bytes:
        return hmac.new(key, data.encode("utf-8"), hashlib.sha256).digest()

    signing_key = sign(
        sign(sign(sign(("AWS4" + secret).encode("utf-8"), date_stamp), region), service),
        "aws4_request",
    )
    signature = hmac.new(
        signing_key, string_to_sign.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    headers = {
        "Content-Type": "application/json",
        "Host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
        "Authorization": (
            f"AWS4-HMAC-SHA256 Credential={access}/{credential_scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}"
        ),
    }
    if session:
        headers["x-amz-security-token"] = session
    return headers


def _run_bedrock(
    provider,
    prompt: str,
    api_key: str,
    on_text,
    should_stop,
    system: str = SYSTEM_PROMPT,
    media=None,
):
    import urllib.parse

    region = str(provider.get("aws_region") or "us-east-1").strip()
    model = str(provider.get("api_model") or "").strip()
    if not model:
        raise RuntimeError("не задана модель Bedrock")
    if "claude" not in model.lower() and "anthropic" not in model.lower():
        raise RuntimeError("Bedrock-адаптер поддерживает Anthropic Claude модели")
    host = f"bedrock-runtime.{region}.amazonaws.com"
    path = f"/model/{urllib.parse.quote(model, safe='')}/invoke"
    body = json.dumps(
        {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": int(provider.get("api_max_tokens") or 4096),
            "system": system,
            "messages": [{"role": "user", "content": prompt}],
        }
    ).encode("utf-8")
    headers = _sigv4_headers("POST", host, path, region, "bedrock", body)
    connection = _connect("https", host, 443, int(provider.get("timeout") or 300))
    try:
        connection.request("POST", path, body=body, headers=headers)
        response = connection.getresponse()
        raw = response.read().decode("utf-8", errors="replace")
    finally:
        connection.close()
    if response.status >= 400:
        raise RuntimeError(f"Bedrock вернул {response.status}: {raw[:500]}")
    try:
        payload = json.loads(raw)
    except ValueError as exc:
        raise RuntimeError("Bedrock вернул не JSON") from exc
    texts = []
    content = payload.get("content")
    for part in content if isinstance(content, list) else []:
        text = part.get("text") if isinstance(part, dict) else None
        if isinstance(text, str):
            texts.append(text)
    output = "".join(texts).strip()
    if on_text is not None and output:
        on_text(output)
    usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else None
    return output, usage


def run_chat(
    provider: dict[str, Any],
    prompt: str,
    api_key: str,
    on_text: Callable[[str], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
    system: str = SYSTEM_PROMPT,
    media: list[dict[str, Any]] | None = None,
) -> tuple[str, dict[str, Any] | None]:
    if not str(provider.get("api_model") or "").strip():
        raise RuntimeError("не задана API-модель")
    style = str(provider.get("api_style") or "openai")
    if style == "vertex":
        output, usage = _run_vertex(
            provider, prompt, api_key, on_text, should_stop, system, media
        )
    elif style == "bedrock":
        output, usage = _run_bedrock(
            provider, prompt, api_key, on_text, should_stop, system, media
        )
    elif style == "azure":
        output, usage = _run_openai(
            provider, prompt, api_key, on_text, should_stop, system, azure=True, media=media
        )
    elif style == "anthropic":
        output, usage = _run_anthropic(
            provider, prompt, api_key, on_text, should_stop, system, media
        )
    elif style == "google":
        output, usage = _run_google(
            provider, prompt, api_key, on_text, should_stop, system, media
        )
    else:
        output, usage = _run_openai(
            provider, prompt, api_key, on_text, should_stop, system, media=media
        )
    if not output:
        raise RuntimeError("API вернул пустой ответ")
    return output, usage
