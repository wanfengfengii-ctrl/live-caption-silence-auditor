"""Pydantic request/response models."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

from .timeline import GAP_TYPES, Gap, Review

_MS_FIELDS = ("program_start_ms", "program_end_ms", "max_silence_ms")


class GapLimits(BaseModel):
    """Per-gap-type silence ceilings (non-negative integer milliseconds).

    The three categories are all-or-nothing: either ``head``, ``between``
    and ``tail`` are all supplied (per-type adjudication), or the whole
    object is omitted (``max_silence_ms`` applies to every gap). Missing
    members and unknown gap types reject the whole request with the
    offending field attributed under ``gap_limits``.
    """

    head: int = Field(..., ge=0, description="片头空档上限（非负整数毫秒）")
    between: int = Field(..., ge=0, description="字幕间空档上限（非负整数毫秒）")
    tail: int = Field(..., ge=0, description="片尾空档上限（非负整数毫秒）")

    @field_validator(*GAP_TYPES, mode="before")
    @classmethod
    def _reject_non_integer(cls, value: Any) -> Any:
        # JSON booleans/strings are not millisecond integers; fractional
        # floats like 1.5 are rejected while integral floats (2.0) pass.
        if isinstance(value, (bool, str)) or (
            isinstance(value, float) and not value.is_integer()
        ):
            raise ValueError("必须是非负整数毫秒值")
        return value

    @model_validator(mode="before")
    @classmethod
    def _reject_missing_and_unknown(cls, data: Any) -> Any:
        # A non-dict (array, string, …) becomes a plain Pydantic type
        # error; let it surface so the route attributes it to gap_limits.
        if not isinstance(data, dict):
            return data

        provided = set(data.keys())
        missing = [name for name in GAP_TYPES if name not in provided]
        unknown = sorted(provided - set(GAP_TYPES))
        if missing:
            # Naming the first missing member keeps the error next to a
            # concrete input while still rooted at gap_limits.
            raise ValueError(f"缺少分类上限字段：{missing[0]}。")
        if unknown:
            raise ValueError(f"未知的空档类型：{unknown[0]}。")
        return data

    def as_mapping(self) -> dict[str, int]:
        return {name: getattr(self, name) for name in GAP_TYPES}


class ReviewRequest(BaseModel):
    content: str = Field(..., description="WebVTT 原文")
    program_start_ms: int = Field(
        ..., ge=0, description="节目开始时间（非负整数毫秒）"
    )
    program_end_ms: int = Field(
        ..., ge=0, description="节目结束时间（非负整数毫秒）"
    )
    max_silence_ms: int = Field(
        ..., ge=0, description="允许的无字幕空档上限（非负整数毫秒）"
    )
    gap_limits: GapLimits | None = Field(
        default=None,
        description="可选的片头/字幕间/片尾分类上限；三项须同时提供",
    )

    @field_validator(*_MS_FIELDS, mode="before")
    @classmethod
    def _reject_non_integer(cls, value):
        # JSON booleans/strings are not millisecond integers; fractional
        # floats like 1.5 are rejected while integral floats (2.0) pass.
        if isinstance(value, (bool, str)) or (
            isinstance(value, float) and not value.is_integer()
        ):
            raise ValueError("必须是非负整数毫秒值")
        return value


class GapModel(BaseModel):
    type: str
    start_ms: int
    end_ms: int
    duration_ms: int
    limit_ms: int
    line: int | None = None
    to_line: int | None = None

    @classmethod
    def from_gap(cls, gap: Gap) -> "GapModel":
        return cls(
            type=gap.type,
            start_ms=gap.start_ms,
            end_ms=gap.end_ms,
            duration_ms=gap.duration_ms,
            limit_ms=gap.limit_ms,
            line=gap.line,
            to_line=gap.to_line,
        )


class ReviewResponse(BaseModel):
    passed: bool
    max_gap_ms: int
    gaps: list[GapModel]
    violations: list[GapModel]
    cue_count: int

    @classmethod
    def from_review(cls, review: Review, cue_count: int) -> "ReviewResponse":
        return cls(
            passed=review.passed,
            max_gap_ms=review.max_gap_ms,
            gaps=[GapModel.from_gap(g) for g in review.gaps],
            violations=[GapModel.from_gap(g) for g in review.violations],
            cue_count=cue_count,
        )


class ErrorBody(BaseModel):
    code: str
    message: str
    field: str | None = None
    line: int | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody
