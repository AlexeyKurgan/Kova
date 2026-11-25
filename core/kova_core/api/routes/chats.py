import json
import queue
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from ... import chats as chat_store
from ..deps import require_hub

router = APIRouter(prefix="/chats", tags=["chats"])


class ChatCreateRequest(BaseModel):
    title: str = ""
    scope: str = "project"
    task_id: str = ""
    provider_id: str = ""
    model: str = ""


class ChatUpdateRequest(BaseModel):
    title: str | None = None
    provider_id: str | None = None
    model: str | None = None
    scope: str | None = None
    task_id: str | None = None


class ChatAttachmentInput(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    mime: str = ""
    data: str = ""


class ChatMessageRequest(BaseModel):
    text: str = Field(default="", max_length=20_000)
    attachments: list[ChatAttachmentInput] = Field(default_factory=list)


class ChatActionDecision(BaseModel):
    decision: str = Field(pattern="^(approve|reject)$")


@router.get("")
def get_chats(hub: Path = Depends(require_hub)) -> list[dict]:
    return chat_store.list_chats(hub)


@router.get("/events")
def chat_events(hub: Path = Depends(require_hub)) -> StreamingResponse:
    def stream():
        subscriber = chat_store.subscribe_all()
        nl = chr(10) * 2
        try:
            yield "retry: 3000" + nl
            while True:
                try:
                    subscriber.get(timeout=15)
                except queue.Empty:
                    yield ": ping" + nl
                    continue
                rows = chat_store.list_chats(hub)
                payload = json.dumps({"type": "chats", "chats": rows}, ensure_ascii=False)
                yield f"data: {payload}" + nl
        finally:
            chat_store.unsubscribe_all(subscriber)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("", status_code=201)
def create_chat(payload: ChatCreateRequest, hub: Path = Depends(require_hub)) -> dict:
    return chat_store.create_chat(
        hub,
        payload.title,
        payload.scope,
        payload.task_id,
        payload.provider_id,
        payload.model,
    )


@router.get("/{chat_id}")
def get_chat(chat_id: str, hub: Path = Depends(require_hub)) -> dict:
    chat = chat_store.get_chat(hub, chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="chat not found")
    return chat


@router.get("/{chat_id}/events")
def chat_events_one(chat_id: str, hub: Path = Depends(require_hub)) -> StreamingResponse:
    chat = chat_store.get_chat(hub, chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="chat not found")

    def stream():
        subscriber = chat_store.subscribe(chat_id)
        nl = chr(10) * 2
        try:
            initial = chat_store.get_chat(hub, chat_id)
            if initial is not None:
                payload = json.dumps({"type": "chat", "chat": initial}, ensure_ascii=False)
                yield f"data: {payload}" + nl
            while True:
                try:
                    subscriber.get(timeout=15)
                except queue.Empty:
                    yield ": ping" + nl
                    continue
                current = chat_store.get_chat(hub, chat_id)
                if current is None:
                    yield "data: " + json.dumps({"type": "deleted"}) + nl
                    return
                payload = json.dumps({"type": "chat", "chat": current}, ensure_ascii=False)
                yield f"data: {payload}" + nl
        finally:
            chat_store.unsubscribe(chat_id, subscriber)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.patch("/{chat_id}")
def update_chat(chat_id: str, payload: ChatUpdateRequest, hub: Path = Depends(require_hub)) -> dict:
    updates = {key: value for key, value in payload.model_dump(exclude_unset=True).items() if value is not None}
    chat = chat_store.update_chat(hub, chat_id, updates)
    if chat is None:
        raise HTTPException(status_code=404, detail="chat not found")
    return chat


@router.delete("/{chat_id}", status_code=204)
def delete_chat(chat_id: str, hub: Path = Depends(require_hub)) -> None:
    if not chat_store.delete_chat(hub, chat_id):
        raise HTTPException(status_code=404, detail="chat not found")


@router.post("/{chat_id}/messages")
def send_message(chat_id: str, payload: ChatMessageRequest, hub: Path = Depends(require_hub)) -> dict:
    if not payload.text.strip() and not payload.attachments:
        raise HTTPException(status_code=422, detail="нужен текст или вложение")
    try:
        chat = chat_store.send_message(
            hub,
            chat_id,
            payload.text,
            [item.model_dump() for item in payload.attachments],
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if chat is None:
        raise HTTPException(status_code=404, detail="chat not found")
    return chat


@router.post("/{chat_id}/cancel")
def cancel_chat(chat_id: str, hub: Path = Depends(require_hub)) -> dict:
    chat = chat_store.cancel_chat(hub, chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="chat not found")
    return chat


@router.post("/{chat_id}/actions/{action_id}")
def apply_chat_action(
    chat_id: str,
    action_id: str,
    payload: ChatActionDecision,
    hub: Path = Depends(require_hub),
) -> dict:
    try:
        chat = chat_store.decide_action(hub, chat_id, action_id, payload.decision)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="action not found") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if chat is None:
        raise HTTPException(status_code=404, detail="chat not found")
    return chat


@router.get("/{chat_id}/attachments/{attachment_id}")
def get_attachment(
    chat_id: str,
    attachment_id: str,
    hub: Path = Depends(require_hub),
) -> FileResponse:
    found = chat_store.find_attachment(hub, chat_id, attachment_id)
    if found is None:
        raise HTTPException(status_code=404, detail="attachment not found")
    attachment, path = found
    return FileResponse(
        path,
        media_type=str(attachment.get("mime") or "application/octet-stream"),
        filename=str(attachment.get("name") or path.name),
        headers={"Cache-Control": "no-store"},
    )
