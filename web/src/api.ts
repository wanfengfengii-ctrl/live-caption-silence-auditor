export type GapType = "head" | "between" | "tail";

export type GapLimits = Record<GapType, number>;

export interface Gap {
  type: GapType;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  limit_ms: number;
  line: number | null;
  to_line: number | null;
}

export interface ReviewResult {
  passed: boolean;
  max_gap_ms: number;
  gaps: Gap[];
  violations: Gap[];
  cue_count: number;
}

export interface ApiError {
  code: string;
  message: string;
  field: string | null;
  line: number | null;
}

export interface ReviewInput {
  content: string;
  program_start_ms: number;
  program_end_ms: number;
  max_silence_ms: number;
  gap_limits?: GapLimits;
}

export interface CoverageBucket {
  index: number;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  covered_ms: number;
  coverage_pct: number;
  low_coverage: boolean;
}

export interface CoverageResult {
  buckets: CoverageBucket[];
  bucket_count: number;
  cue_count: number;
  bucket_ms: number;
  threshold_pct: number;
  min_coverage_pct: number;
  low_coverage_count: number;
}

export interface CoverageInput {
  content: string;
  program_start_ms: number;
  program_end_ms: number;
  bucket_ms: number;
  threshold_pct: number;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error: ApiError | undefined = payload?.error;
    throw error ?? {
      code: "network_error",
      message: `请求失败（HTTP ${response.status}），请确认 API 服务可用。`,
      field: null,
      line: null,
    };
  }
  return payload as T;
}

export function postReview(input: ReviewInput): Promise<ReviewResult> {
  return postJson<ReviewResult>("/api/review", input);
}

export function postCoverage(input: CoverageInput): Promise<CoverageResult> {
  return postJson<CoverageResult>("/api/coverage", input);
}
