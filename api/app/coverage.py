"""Coverage distribution audit: subtitle coverage per time bucket.

The program interval is divided into consecutive buckets of ``bucket_ms``
milliseconds. The final bucket may be shorter than a full bucket; its
coverage ratio is measured against its actual duration, never the nominal
bucket length. Each cue contributes to a bucket the length of its
intersection with that bucket, so a cue spanning several buckets is split
across them. A bucket whose coverage ratio is strictly below the requested
threshold is flagged as low coverage; a ratio exactly equal to the
threshold is not flagged.
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction

from .parser import Cue
from .timeline import validate_timeline

# Hard ceiling on generated buckets so a tiny bucket_ms over a long
# program cannot produce an unbounded response.
MAX_BUCKETS = 1000


@dataclass(frozen=True)
class Bucket:
    """One time bucket with its subtitle coverage."""

    index: int
    start_ms: int
    end_ms: int
    duration_ms: int                # actual interval; the last bucket may be short
    covered_ms: int
    coverage_pct: float
    low_coverage: bool


@dataclass(frozen=True)
class CoverageReport:
    buckets: list[Bucket]
    min_coverage_pct: float
    low_coverage_count: int


def bucket_count(program_start_ms: int, program_end_ms: int,
                 bucket_ms: int) -> int:
    """Number of buckets the program interval divides into (ceiling)."""
    span_ms = program_end_ms - program_start_ms
    return -(-span_ms // bucket_ms)


def coverage_distribution(
    cues: list[Cue],
    program_start_ms: int,
    program_end_ms: int,
    bucket_ms: int,
    threshold_pct: float,
) -> CoverageReport:
    """Split the program into buckets and measure per-bucket coverage.

    Timeline validation is identical to the gap review; the caller has
    already validated the scalar parameters (positive ``bucket_ms``,
    threshold within 0..100, bucket count within ``MAX_BUCKETS``).
    """
    validate_timeline(cues, program_start_ms, program_end_ms)

    count = bucket_count(program_start_ms, program_end_ms, bucket_ms)
    covered = [0] * count
    for cue in cues:
        # Indices of the buckets intersected by [cue.start_ms, cue.end_ms).
        first = (cue.start_ms - program_start_ms) // bucket_ms
        last = (cue.end_ms - 1 - program_start_ms) // bucket_ms
        for index in range(first, last + 1):
            bucket_start = program_start_ms + index * bucket_ms
            bucket_end = min(bucket_start + bucket_ms, program_end_ms)
            covered[index] += min(cue.end_ms, bucket_end) - max(
                cue.start_ms, bucket_start
            )

    # Compare ratios as exact fractions so a coverage equal to the
    # threshold is never flagged by binary floating-point rounding
    # (e.g. 143 ms of 1000 ms against a 14.3 threshold).
    threshold = Fraction(str(threshold_pct))
    buckets: list[Bucket] = []
    for index in range(count):
        start_ms = program_start_ms + index * bucket_ms
        end_ms = min(start_ms + bucket_ms, program_end_ms)
        duration_ms = end_ms - start_ms
        covered_ms = covered[index]
        ratio = Fraction(covered_ms * 100, duration_ms)
        buckets.append(
            Bucket(
                index=index,
                start_ms=start_ms,
                end_ms=end_ms,
                duration_ms=duration_ms,
                covered_ms=covered_ms,
                coverage_pct=float(ratio),
                low_coverage=ratio < threshold,
            )
        )

    return CoverageReport(
        buckets=buckets,
        min_coverage_pct=min(bucket.coverage_pct for bucket in buckets),
        low_coverage_count=sum(1 for bucket in buckets if bucket.low_coverage),
    )
