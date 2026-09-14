"""WebVTT parsing.

The maintained ``webvtt-py`` library is the parser of record:

* :class:`webvtt.vtt.WebVTTCueBlock` / comment / style block primitives
  provide the cue/block grammar (``is_valid``/``from_lines``).
* :class:`webvtt.models.Caption` provides timestamp validation/parsing via
  its ``Timestamp`` objects, which we convert to milliseconds.
* ``webvtt.from_buffer`` performs an authoritative high-level parse used
  as an integrity cross-check, so this module never silently diverges
  from the library.

Only line splitting (``str.splitlines``) and the library's documented
blank-line block boundaries are handled locally; no format grammar is
re-implemented. The library does not expose source line numbers, so the
block primitives are reused here purely to attribute errors to the
original 1-based line.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import webvtt
from webvtt.errors import MalformedCaptionError, MalformedFileError
from webvtt.models import Caption
from webvtt.vtt import (
    WebVTTCommentBlock,
    WebVTTCueBlock,
    WebVTTStyleBlock,
)

from .errors import (
    EMPTY_DOCUMENT,
    INVALID_HEADER,
    PARSE_ERROR,
    UNRECOGNIZED_BLOCK,
    ReviewError,
)

BOM = "﻿"


@dataclass(frozen=True)
class Cue:
    """One cue normalised to a millisecond interval."""

    start_ms: int
    end_ms: int
    line: int
    identifier: str | None = None


def _timestamp_to_ms(caption: Caption, attr: str) -> int:
    hours, minutes, seconds, milliseconds = getattr(caption, attr).to_tuple()
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + milliseconds


def _split_blocks(lines: list[str]) -> list[tuple[int, list[str]]]:
    """Split into blank-line separated blocks (the library's rule).

    Returns ``(start_line_number, block_lines)`` pairs.
    """
    blocks: list[tuple[int, list[str]]] = []
    current: list[str] = []
    start_line = 0
    for index, line in enumerate(lines, start=1):
        if line.strip():
            if not current:
                start_line = index
            current.append(line)
        elif current:
            blocks.append((start_line, current))
            current = []
    if current:
        blocks.append((start_line, current))
    return blocks


def _is_region_block(block_lines: list[str]) -> bool:
    """REGION blocks are part of WebVTT and carry no cue data."""
    head = block_lines[0].strip()
    return head == "REGION" or head.startswith("REGION ")


def parse_webvtt(content: str) -> list[Cue]:
    """Parse WebVTT text into millisecond cues or raise :class:`ReviewError`."""

    if not content or not content.strip():
        raise ReviewError(
            PARSE_ERROR, "WebVTT 文档为空，至少需要文件头与一个字幕块。", line=1
        )

    lines = content.splitlines()
    # webvtt-py strips a BOM for files; do the same for pasted text.
    if lines and lines[0].startswith(BOM):
        lines[0] = lines[0].lstrip(BOM)

    if not lines or not lines[0].startswith("WEBVTT"):
        raise ReviewError(
            INVALID_HEADER,
            "第 1 行必须以 “WEBVTT” 文件头开始。",
            line=1,
        )

    cues: list[Cue] = []
    for block_start, block_lines in _split_blocks(lines):
        # The header block (line 1) carries no cues.
        if block_start == 1:
            continue

        if WebVTTCueBlock.is_valid(block_lines):
            cue_block = WebVTTCueBlock.from_lines(block_lines)
            # Timing is on the first line, or on the second when a cue
            # identifier is present (grammar comes from the library regex).
            timing_offset = (
                0 if WebVTTCueBlock.CUE_TIMINGS_PATTERN.match(block_lines[0])
                else 1
            )
            timing_line = block_start + timing_offset
            try:
                caption = Caption(
                    cue_block.start,
                    cue_block.end,
                    cue_block.payload,
                    cue_block.identifier,
                )
            except MalformedCaptionError:
                raise ReviewError(
                    PARSE_ERROR,
                    f"第 {timing_line} 行的时间戳无效："
                    f"{block_lines[timing_offset].strip()}",
                    line=timing_line,
                ) from None
            cues.append(
                Cue(
                    start_ms=_timestamp_to_ms(caption, "start_time"),
                    end_ms=_timestamp_to_ms(caption, "end_time"),
                    line=timing_line,
                    identifier=caption.identifier or None,
                )
            )
        elif (
            WebVTTCommentBlock.is_valid(block_lines)
            or WebVTTStyleBlock.is_valid(block_lines)
            or _is_region_block(block_lines)
        ):
            continue
        else:
            raise ReviewError(
                UNRECOGNIZED_BLOCK,
                f"第 {block_start} 行起的内容块无法识别为有效的字幕块，"
                "请检查时间轴行（格式应为 "
                "“HH:MM:SS.mmm --> HH:MM:SS.mmm”）以及块间空行。",
                line=block_start,
            )

    if not cues:
        raise ReviewError(
            EMPTY_DOCUMENT,
            "文档仅含文件头（或注释/样式块），没有任何字幕块。",
            line=1,
        )

    # Authoritative cross-parse with the library: counts must agree so a
    # silently dropped/merged cue can never produce a partial review.
    try:
        document = webvtt.from_buffer(io.StringIO("\n".join(lines)))
    except (MalformedFileError, MalformedCaptionError) as exc:
        raise ReviewError(PARSE_ERROR, f"WebVTT 解析失败：{exc}", line=1) \
            from None
    if len(document.captions) != len(cues):
        raise ReviewError(
            PARSE_ERROR,
            "WebVTT 解析结果内部不一致，请检查是否存在无法识别的内容块。",
            line=1,
        )

    return cues
