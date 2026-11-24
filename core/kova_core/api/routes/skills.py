from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ... import skills as skill_store

router = APIRouter(prefix="/skills", tags=["skills"])


class SkillCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = ""
    category: str = "general"
    content: str = ""
    locked: bool = False


class SkillUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    category: str | None = None
    content: str | None = None
    locked: bool | None = None


@router.get("")
def list_skills() -> list[dict]:
    return skill_store.list_skills()


@router.get("/{skill_id}")
def get_skill(skill_id: str) -> dict:
    row = skill_store.get_skill(skill_id)
    if row is None:
        raise HTTPException(status_code=404, detail="skill not found")
    return row


@router.post("", status_code=201)
def create_skill(payload: SkillCreateRequest) -> dict:
    try:
        return skill_store.create_skill(payload.model_dump())
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/{skill_id}")
def update_skill(
    skill_id: str,
    payload: SkillUpdateRequest,
    unlock: bool = Query(default=False),
) -> dict:
    updates = payload.model_dump(exclude_unset=True)
    try:
        row = skill_store.update_skill(skill_id, updates, unlock=unlock)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if row is None:
        raise HTTPException(status_code=404, detail="skill not found")
    return row


@router.delete("/{skill_id}", status_code=204)
def delete_skill(skill_id: str, unlock: bool = Query(default=False)) -> None:
    try:
        removed = skill_store.delete_skill(skill_id, unlock=unlock)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not removed:
        raise HTTPException(status_code=404, detail="skill not found")
