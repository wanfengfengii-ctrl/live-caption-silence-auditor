"""End-to-end API tests for the subtitle gap review adjudication."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def vtt(*blocks: str) -> str:
    return "WEBVTT\n\n" + "\n\n".join(blocks) + "\n"


def cue(start_ms: float, end_ms: float, text: str = "x", ident: str | None = None):
    def ts(ms: int) -> str:
        h, rem = divmod(ms, 3_600_000)
        m, rem = divmod(rem, 60_000)
        s, milli = divmod(rem, 1000)
        return f"{h:02d}:{m:02d}:{s:02d}.{milli:03d}"

    head = f"{ident}\n" if ident is not None else ""
    return f"{head}{ts(int(start_ms))} --> {ts(int(end_ms))}\n{text}"


def review(content, start, end, limit):
    return client.post(
        "/api/review",
        json={
            "content": content,
            "program_start_ms": start,
            "program_end_ms": end,
            "max_silence_ms": limit,
        },
    )


# ---------------------------------------------------------------------------
# Adjudication boundaries
# ---------------------------------------------------------------------------


def test_contiguous_full_program_passes_with_zero_gaps():
    body = vtt(cue(0, 1000), cue(1000, 2000))
    r = review(body, 0, 2000, 0)
    assert r.status_code == 200
    data = r.json()
    assert data["passed"] is True
    assert data["max_gap_ms"] == 0
    assert [g["duration_ms"] for g in data["gaps"]] == [0, 0, 0]
    assert data["violations"] == []
    assert data["cue_count"] == 2


def test_gap_types_are_head_between_tail_in_order():
    body = vtt(cue(1000, 2000), cue(4000, 5000))
    data = review(body, 0, 8000, 10000).json()
    types = [(g["type"], g["duration_ms"]) for g in data["gaps"]]
    assert types == [("head", 1000), ("between", 2000), ("tail", 3000)]
    assert data["max_gap_ms"] == 3000


def test_gap_equal_to_limit_passes():
    body = vtt(cue(1000, 2000), cue(3500, 4000))  # head 1000, between 1500
    data = review(body, 0, 4000, 1500).json()
    assert data["passed"] is True
    assert data["violations"] == []


def test_gap_one_ms_over_limit_fails():
    body = vtt(cue(1000, 2000), cue(3501, 4000))  # between 1501
    r = review(body, 0, 4000, 1500)
    data = r.json()
    assert data["passed"] is False
    assert len(data["violations"]) == 1
    viol = data["violations"][0]
    assert viol["type"] == "between"
    assert viol["duration_ms"] == 1501
    assert viol["start_ms"] == 2000
    assert viol["end_ms"] == 3501


def test_gap_one_ms_under_limit_passes():
    body = vtt(cue(1000, 2000), cue(3499, 4000))  # between 1499
    data = review(body, 0, 4000, 1500).json()
    assert data["passed"] is True


def test_zero_limit_any_gap_violates_but_touching_passes():
    touching = vtt(cue(0, 500), cue(500, 1000))
    assert review(touching, 0, 1000, 0).json()["passed"] is True

    gapped = vtt(cue(0, 500), cue(501, 1000))
    data = review(gapped, 0, 1000, 0).json()
    assert data["passed"] is False
    assert [v["type"] for v in data["violations"]] == ["between"]


def test_head_and_tail_violations_reported():
    body = vtt(cue(2000, 3000))
    data = review(body, 0, 6000, 1000).json()
    assert data["passed"] is False
    assert [v["type"] for v in data["violations"]] == ["head", "tail"]
    assert data["max_gap_ms"] == 3000


def test_all_violating_segments_returned():
    body = vtt(cue(2000, 3000), cue(5000, 6000), cue(8000, 9000))
    data = review(body, 0, 12000, 500).json()
    assert [v["type"] for v in data["violations"]] == [
        "head", "between", "between", "tail"
    ]


def test_gap_intervals_use_millisecond_coordinates():
    body = vtt(cue(1250, 2500))
    data = review(body, 250, 3000, 10000).json()
    head, tail = data["gaps"][0], data["gaps"][-1]
    assert (head["start_ms"], head["end_ms"], head["duration_ms"]) == (
        250, 1250, 1000
    )
    assert (tail["start_ms"], tail["end_ms"], tail["duration_ms"]) == (
        2500, 3000, 500
    )


# ---------------------------------------------------------------------------
# Parameter errors (rejected wholesale, field attributed)
# ---------------------------------------------------------------------------


def test_start_must_be_before_end_equal():
    r = review(vtt(cue(0, 1000)), 1000, 1000, 0)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "invalid_program_range"
    assert err["field"] == "program_end_ms"
    assert "review" not in r.json()


def test_start_must_be_before_end_greater():
    r = review(vtt(cue(1000, 2000)), 3000, 1000, 0)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_program_range"


@pytest.mark.parametrize("field,value", [
    ("program_start_ms", -1),
    ("program_end_ms", -1),
    ("max_silence_ms", -1),
])
def test_negative_milliseconds_rejected(field, value):
    payload = {
        "content": vtt(cue(0, 1000)),
        "program_start_ms": 0,
        "program_end_ms": 1000,
        "max_silence_ms": 0,
    }
    payload[field] = value
    r = client.post("/api/review", json=payload)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "invalid_params"
    assert err["field"] == field


@pytest.mark.parametrize("field,value", [
    ("program_start_ms", 1.5),
    ("program_end_ms", "1000"),
    ("max_silence_ms", True),
])
def test_non_integer_milliseconds_rejected(field, value):
    payload = {
        "content": vtt(cue(0, 1000)),
        "program_start_ms": 0,
        "program_end_ms": 1000,
        "max_silence_ms": 0,
    }
    payload[field] = value
    r = client.post("/api/review", json=payload)
    assert r.status_code == 422
    assert r.json()["error"]["field"] == field


def test_missing_field_attributed():
    r = client.post(
        "/api/review",
        json={"content": "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nx",
              "program_end_ms": 1000, "max_silence_ms": 0},
    )
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "invalid_params"
    assert err["field"] == "program_start_ms"


# ---------------------------------------------------------------------------
# Parse errors (line attributed, whole input rejected)
# ---------------------------------------------------------------------------


def test_empty_content_rejected():
    r = review("", 0, 1000, 0)
    assert r.status_code == 422
    assert r.json()["error"]["line"] == 1


def test_header_only_without_cues_rejected():
    r = review("WEBVTT\n", 0, 1000, 0)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "empty_document"
    assert err["line"] == 1


def test_header_with_only_comments_and_styles_rejected():
    content = (
        "WEBVTT\n\nNOTE a comment\n\nSTYLE\n::cue { color: red }\n"
    )
    r = review(content, 0, 1000, 0)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "empty_document"


def test_missing_header_rejected_at_line_one():
    r = review("00:00:00.000 --> 00:00:01.000\nx\n", 0, 1000, 0)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "invalid_header"
    assert err["line"] == 1


def test_bad_timestamp_reports_its_line():
    content = (
        "WEBVTT\n\n"
        "00:00:01.000 --> 00:00:02.000\nfirst\n\n"
        "00:00:03.000 --> 00:00:61.000\nsecond\n"
    )
    r = review(content, 0, 100000, 0)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "parse_error"
    assert err["line"] == 6


def test_unrecognized_block_reports_first_line_of_block():
    # A timing-looking line missing the arrow is an unrecognized block.
    content = (
        "WEBVTT\n\n"
        "00:00:01.000 --> 00:00:02.000\nfirst\n\n"
        "00:00:03.000  00:00:04.000\nsecond\n"
    )
    r = review(content, 0, 100000, 0)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "unrecognized_block"
    assert err["line"] == 6


def test_line_number_accounts_for_cue_identifier():
    content = (
        "WEBVTT\n\n"
        "cue-1\n00:00:01.000 --> 00:00:02.000\nfirst\n\n"
        "cue-2\n00:00:03.000 --> 00:00:60.000\nsecond\n"
    )
    r = review(content, 0, 100000, 0)
    assert r.status_code == 422
    # identifier on line 7, timing on line 8
    assert r.json()["error"]["line"] == 8


# ---------------------------------------------------------------------------
# Timeline errors (line attributed)
# ---------------------------------------------------------------------------


def test_unsorted_cues_rejected_with_line():
    body = vtt(cue(4000, 5000), cue(1000, 2000))
    r = review(body, 0, 10000, 0)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "cues_not_sorted"
    assert err["line"] == 6  # timing line of second cue


def test_equal_start_times_rejected():
    body = vtt(cue(1000, 2000), cue(1000, 3000))
    r = review(body, 0, 10000, 0)
    assert r.json()["error"]["code"] == "cues_not_sorted"


def test_end_not_after_start_rejected():
    body = vtt("00:00:02.000 --> 00:00:02.000\nzero")
    r = review(body, 0, 10000, 0)
    err = r.json()["error"]
    assert err["code"] == "cue_invalid_range"
    assert err["line"] == 3


def test_overlapping_cues_rejected_with_line():
    body = vtt(cue(1000, 3000), cue(2000, 4000))
    r = review(body, 0, 10000, 0)
    err = r.json()["error"]
    assert err["code"] == "cues_overlap"
    assert err["line"] == 6  # timing line of second cue


def test_cue_before_program_start_rejected():
    body = vtt(cue(0, 1000))
    r = review(body, 500, 5000, 0)
    err = r.json()["error"]
    assert err["code"] == "cue_out_of_range"
    assert err["line"] == 3


def test_cue_after_program_end_rejected():
    body = vtt(cue(1000, 6000))
    r = review(body, 0, 5000, 0)
    assert r.json()["error"]["code"] == "cue_out_of_range"


def test_cue_exactly_on_program_boundaries_passes():
    body = vtt(cue(1000, 5000))
    data = review(body, 1000, 5000, 0).json()
    assert data["passed"] is True
    assert data["max_gap_ms"] == 0


# ---------------------------------------------------------------------------
# Supported WebVTT features / no partial results
# ---------------------------------------------------------------------------


def test_notes_style_region_blocks_and_bom_accepted():
    content = (
        "﻿WEBVTT - demo\n\n"
        "NOTE\nmulti line comment\n\n"
        "REGION\nid:top\nwidth:50%\n\n"
        "STYLE\n::cue { color: lime }\n\n"
        "1\n00:00:01.000 --> 00:00:02.000\n<v Alice>Hello\n\n"
        "00:00:02.000 --> 00:00:03.000\nWorld\n"
    )
    data = review(content, 1000, 3000, 0).json()
    assert data["passed"] is True
    assert data["cue_count"] == 2


def test_error_never_contains_partial_review():
    r = review("WEBVTT\n\n", 0, 1000, 0)
    assert r.status_code == 422
    top = r.json()
    assert set(top.keys()) == {"error"}
    assert "violations" not in top
    assert "max_gap_ms" not in top


def test_health():
    assert client.get("/health").json() == {"status": "ok"}
