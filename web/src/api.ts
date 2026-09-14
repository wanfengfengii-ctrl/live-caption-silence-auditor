export type GapType = "head" | "between" | "tail";

export interface Gap {
  type: GapType;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
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
}

export async function postReview(input: ReviewInput): Promise<ReviewResult> {
  const response = await fetch("/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
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
  return payload as ReviewResult;
}
