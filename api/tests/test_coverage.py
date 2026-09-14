"""End-to-end API tests for the coverage distribution audit."""

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


def coverage(content, start, end, bucket, threshold):
    return client.post(
        "/api/coverage",
        json={
            "content": content,
            "program_start_ms": start,
            "program_end_ms": end,
            "bucket_ms": bucket,
            "threshold_pct": threshold,
        },
    )


# ---------------------------------------------------------------------------
# Bucket splitting and coverage ratios
# ---------------------------------------------------------------------------


def test_cue_spanning_two_buckets_is_split_by_intersection():
    # One 1000 ms cue straddling the boundary of two 1000 ms buckets.
    body = vtt(cue(500, 1500))
    r = coverage(body, 0, 2000, 1000, 50)
    assert r.status_code == 200
    data = r.json()
    assert data["bucket_count"] == 2
    assert [(b["start_ms"], b["end_ms"]) for b in data["buckets"]] == [
        (0, 1000),
        (1000, 2000),
    ]
    # 500 ms of the cue lands in each bucket; nothing is double-counted.
    assert [b["covered_ms"] for b in data["buckets"]] == [500, 500]
    assert [b["coverage_pct"] for b in data["buckets"]] == [50.0, 50.0]
    assert data["min_coverage_pct"] == 50.0


def test_cue_spanning_three_buckets_is_split_exactly():
    body = vtt(cue(500, 2500))
    data = coverage(body, 0, 3000, 1000, 0).json()
    assert [b["covered_ms"] for b in data["buckets"]] == [500, 1000, 500]
    assert [b["coverage_pct"] for b in data["buckets"]] == [50.0, 100.0, 50.0]


def test_touching_cues_do_not_double_count_bucket_boundary():
    # Two cues meeting exactly on the bucket boundary fill it completely.
    body = vtt(cue(0, 1000), cue(1000, 2000))
    data = coverage(body, 0, 2000, 1000, 100).json()
    assert [b["covered_ms"] for b in data["buckets"]] == [1000, 1000]
    assert [b["low_coverage"] for b in data["buckets"]] == [False, False]
    assert data["low_coverage_count"] == 0
    assert data["min_coverage_pct"] == 100.0


def test_short_last_bucket_uses_actual_duration_and_equal_threshold_passes():
    # Program 0..2500 with 1000 ms buckets: the last bucket is only
    # [2000, 2500) = 500 ms long, and 250 ms of coverage is exactly 50%.
    body = vtt(cue(2000, 2250))
    r = coverage(body, 0, 2500, 1000, 50)
    assert r.status_code == 200
    data = r.json()
    assert data["bucket_count"] == 3
    last = data["buckets"][-1]
    assert (last["start_ms"], last["end_ms"], last["duration_ms"]) == (
        2000,
        2500,
        500,
    )
    assert last["covered_ms"] == 250
    # 250/500 = 50% against the actual 500 ms interval, not the nominal
    # 1000 ms bucket length; equality with the threshold is NOT low.
    assert last["coverage_pct"] == 50.0
    assert last["low_coverage"] is False


def test_short_last_bucket_one_ms_under_threshold_is_low():
    body = vtt(cue(2000, 2249))  # 249 ms of the 500 ms tail bucket
    data = coverage(body, 0, 2500, 1000, 50).json()
    last = data["buckets"][-1]
    assert last["coverage_pct"] == pytest.approx(49.8)
    assert last["low_coverage"] is True


def test_decimal_threshold_equality_is_not_flagged():
    # 143 ms of 1000 ms is exactly 14.3%; binary floating point must not
    # push an exactly-equal ratio below the threshold.
    body = vtt(cue(0, 143))
    data = coverage(body, 0, 1000, 1000, 14.3).json()
    bucket = data["buckets"][0]
    assert bucket["coverage_pct"] == pytest.approx(14.3)
    assert bucket["low_coverage"] is False


def test_coverage_below_threshold_is_flagged_and_summarised():
    body = vtt(cue(0, 2000), cue(6000, 7000))
    data = coverage(body, 0, 8000, 2000, 60).json()
    assert [b["covered_ms"] for b in data["buckets"]] == [2000, 0, 0, 1000]
    assert [b["low_coverage"] for b in data["buckets"]] == [
        False,
        True,
        True,
        True,
    ]
    assert data["low_coverage_count"] == 3
    assert data["min_coverage_pct"] == 0.0
    assert data["cue_count"] == 2
    # Request parameters are echoed for the page header.
    assert data["bucket_ms"] == 2000
    assert data["threshold_pct"] == 60.0


def test_buckets_are_returned_in_time_order():
    body = vtt(cue(250, 750))
    data = coverage(body, 0, 4000, 1000, 0).json()
    assert [b["index"] for b in data["buckets"]] == [0, 1, 2, 3]
    starts = [b["start_ms"] for b in data["buckets"]]
    assert starts == sorted(starts)


# ---------------------------------------------------------------------------
# Bucket count ceiling
# ---------------------------------------------------------------------------


def test_exactly_1000_buckets_allowed():
    body = vtt(cue(0, 1000))
    r = coverage(body, 0, 1_000_000, 1000, 0)
    assert r.status_code == 200
    assert r.json()["bucket_count"] == 1000


def test_more_than_1000_buckets_rejected():
    body = vtt(cue(0, 1000))
    r = coverage(body, 0, 1_000_001, 1000, 0)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "invalid_params"
    assert err["field"] == "bucket_ms"
    assert "1000" in err["message"]
    # Whole input rejected: never a partial distribution alongside the error.
    assert set(r.json().keys()) == {"error"}


# ---------------------------------------------------------------------------
# Parameter errors (rejected wholesale, field attributed)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("bucket", [0, -1, -1000])
def test_non_positive_bucket_rejected(bucket):
    r = coverage(vtt(cue(0, 1000)), 0, 2000, bucket, 50)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "invalid_params"
    assert err["field"] == "bucket_ms"


@pytest.mark.parametrize("bucket", ["1000", 1.5, True])
def test_non_integer_bucket_rejected(bucket):
    r = coverage(vtt(cue(0, 1000)), 0, 2000, bucket, 50)
    assert r.status_code == 422
    assert r.json()["error"]["field"] == "bucket_ms"


@pytest.mark.parametrize("threshold", [-0.1, -1, 100.5, 101])
def test_threshold_out_of_range_rejected(threshold):
    r = coverage(vtt(cue(0, 1000)), 0, 2000, 1000, threshold)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "invalid_params"
    assert err["field"] == "threshold_pct"


@pytest.mark.parametrize("threshold", ["50", True, None])
def test_non_number_threshold_rejected(threshold):
    r = coverage(vtt(cue(0, 1000)), 0, 2000, 1000, threshold)
    assert r.status_code == 422
    assert r.json()["error"]["field"] == "threshold_pct"


def test_threshold_boundaries_zero_and_hundred_allowed():
    body = vtt(cue(0, 500))
    assert coverage(body, 0, 1000, 1000, 0).status_code == 200
    r = coverage(body, 0, 1000, 1000, 100)
    assert r.status_code == 200
    # 50% against a 100% threshold is strictly below: flagged.
    assert r.json()["buckets"][0]["low_coverage"] is True


@pytest.mark.parametrize("field", ["bucket_ms", "threshold_pct"])
def test_missing_coverage_fields_attributed(field):
    payload = {
        "content": vtt(cue(0, 1000)),
        "program_start_ms": 0,
        "program_end_ms": 2000,
        "bucket_ms": 1000,
        "threshold_pct": 50,
    }
    del payload[field]
    r = client.post("/api/coverage", json=payload)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "invalid_params"
    assert err["field"] == field


def test_program_range_still_validated():
    r = coverage(vtt(cue(0, 1000)), 2000, 2000, 1000, 50)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "invalid_program_range"
    assert err["field"] == "program_end_ms"


# ---------------------------------------------------------------------------
# Parse and timeline errors keep their line numbers
# ---------------------------------------------------------------------------


def test_parse_error_keeps_line_number():
    content = (
        "WEBVTT\n\n"
        "00:00:01.000 --> 00:00:02.000\nfirst\n\n"
        "00:00:03.000 --> 00:00:61.000\nsecond\n"
    )
    r = coverage(content, 0, 100000, 1000, 50)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "parse_error"
    assert err["line"] == 6
    assert set(r.json().keys()) == {"error"}


def test_header_only_rejected():
    r = coverage("WEBVTT\n", 0, 1000, 500, 50)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "empty_document"
    assert err["line"] == 1


def test_timeline_error_keeps_line_number():
    body = vtt(cue(1000, 3000), cue(2000, 4000))
    r = coverage(body, 0, 10000, 1000, 50)
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "cues_overlap"
    assert err["line"] == 6


def test_cue_out_of_program_range_rejected():
    body = vtt(cue(0, 1000))
    r = coverage(body, 500, 5000, 1000, 50)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "cue_out_of_range"


# ---------------------------------------------------------------------------
# The gap review endpoint is untouched by the coverage audit
# ---------------------------------------------------------------------------


def test_review_endpoint_unchanged_by_coverage_route():
    body = vtt(cue(1000, 2000), cue(3000, 4000))
    r = client.post(
        "/api/review",
        json={
            "content": body,
            "program_start_ms": 0,
            "program_end_ms": 5000,
            "max_silence_ms": 1000,
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert data["passed"] is True
    assert [g["duration_ms"] for g in data["gaps"]] == [1000, 1000, 1000]
