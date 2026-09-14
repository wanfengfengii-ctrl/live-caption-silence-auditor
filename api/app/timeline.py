"""Timeline validation and silence-gap adjudication."""

from __future__ import annotations

from dataclasses import dataclass

from .errors import (
    CUE_INVALID_RANGE,
    CUE_OUT_OF_RANGE,
    CUES_NOT_SORTED,
    CUES_OVERLAP,
    ReviewError,
)
from .parser import Cue

HEAD = "head"
BETWEEN = "between"
TAIL = "tail"

GAP_TYPES = (HEAD, BETWEEN, TAIL)


def validate_timeline(
    cues: list[Cue], program_start_ms: int, program_end_ms: int
) -> None:
    """Validate cues against the program interval.

    Cues must be strictly ascending by start, end after start, fully
    inside the program interval and mutually non-overlapping (touching
    ends/starts are allowed). Raises on the first offending cue.
    """
    previous: Cue | None = None
    for cue in cues:
        if previous is not None and cue.start_ms <= previous.start_ms:
            raise ReviewError(
                CUES_NOT_SORTED,
                f"第 {cue.line} 行字幕开始时间为 {cue.start_ms} ms，"
                f"未晚于第 {previous.line} 行的 {previous.start_ms} ms；"
                "字幕必须按开始时间严格升序排列。",
                line=cue.line,
            )

        if cue.end_ms <= cue.start_ms:
            raise ReviewError(
                CUE_INVALID_RANGE,
                f"第 {cue.line} 行字幕结束时间 {cue.end_ms} ms "
                f"必须晚于开始时间 {cue.start_ms} ms。",
                line=cue.line,
            )

        if cue.start_ms < program_start_ms or cue.end_ms > program_end_ms:
            raise ReviewError(
                CUE_OUT_OF_RANGE,
                f"第 {cue.line} 行字幕区间 "
                f"[{cue.start_ms}, {cue.end_ms}) ms 超出节目区间 "
                f"[{program_start_ms}, {program_end_ms}] ms。",
                line=cue.line,
            )

        if previous is not None and cue.start_ms < previous.end_ms:
            raise ReviewError(
                CUES_OVERLAP,
                f"第 {previous.line} 行与第 {cue.line} 行字幕重叠："
                f"前者结束于 {previous.end_ms} ms，后者开始于 "
                f"{cue.start_ms} ms。",
                line=cue.line,
            )

        previous = cue


@dataclass(frozen=True)
class Gap:
    """A silence interval (no caption) on the program timeline."""

    type: str
    start_ms: int
    end_ms: int
    duration_ms: int
    limit_ms: int                    # limit applied when adjudicating
    line: int | None = None          # cue line bounding the gap
    to_line: int | None = None       # second cue line for BETWEEN gaps


@dataclass(frozen=True)
class Review:
    passed: bool
    max_gap_ms: int
    gaps: list[Gap]
    violations: list[Gap]


def review(
    cues: list[Cue],
    program_start_ms: int,
    program_end_ms: int,
    max_silence_ms: int,
    gap_limits: dict[str, int] | None = None,
) -> Review:
    """Compute head/between/tail gaps and adjudicate against limits.

    ``gap_limits`` optionally maps a gap type to its own millisecond
    ceiling; missing types fall back to ``max_silence_ms``. A gap equal
    to its limit passes; anything one millisecond longer is a violation.
    ``max_gap_ms`` always reflects the raw durations, never the limits.
    """
    validate_timeline(cues, program_start_ms, program_end_ms)

    limits = {gap_type: max_silence_ms for gap_type in GAP_TYPES}
    if gap_limits:
        limits.update(gap_limits)

    gaps: list[Gap] = [
        Gap(
            type=HEAD,
            start_ms=program_start_ms,
            end_ms=cues[0].start_ms,
            duration_ms=cues[0].start_ms - program_start_ms,
            limit_ms=limits[HEAD],
            line=cues[0].line,
        )
    ]

    for previous, cue in zip(cues, cues[1:]):
        gaps.append(
            Gap(
                type=BETWEEN,
                start_ms=previous.end_ms,
                end_ms=cue.start_ms,
                duration_ms=cue.start_ms - previous.end_ms,
                limit_ms=limits[BETWEEN],
                line=previous.line,
                to_line=cue.line,
            )
        )

    gaps.append(
        Gap(
            type=TAIL,
            start_ms=cues[-1].end_ms,
            end_ms=program_end_ms,
            duration_ms=program_end_ms - cues[-1].end_ms,
            limit_ms=limits[TAIL],
            line=cues[-1].line,
        )
    )

    violations = [gap for gap in gaps if gap.duration_ms > gap.limit_ms]
    return Review(
        passed=not violations,
        max_gap_ms=max(gap.duration_ms for gap in gaps),
        gaps=gaps,
        violations=violations,
    )
