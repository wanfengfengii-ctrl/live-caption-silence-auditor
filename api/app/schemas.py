"""Pydantic request/response models."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from .timeline import Gap, Review

_MS_FIELDS = ("program_start_ms", "program_end_ms", "max_silence_ms")


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
    line: int | None = None
    to_line: int | None = None

    @classmethod
    def from_gap(cls, gap: Gap) -> "GapModel":
        return cls(
            type=gap.type,
            start_ms=gap.start_ms,
            end_ms=gap.end_ms,
            duration_ms=gap.duration_ms,
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
