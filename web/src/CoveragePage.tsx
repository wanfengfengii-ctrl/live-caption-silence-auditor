import { useState } from "react";
import {
  type ApiError,
  type CoverageInput,
  type CoverageResult,
  postCoverage,
} from "./api";
import { CoverageResultPanel } from "./components/CoverageResultPanel";
import {
  integerErrorMessage,
  parseInteger,
  positiveIntegerErrorMessage,
} from "./numberInput";

const SAMPLE_VTT = `WEBVTT

00:00:00.000 --> 00:00:02.000
欢迎收看本期直播节目

00:00:02.000 --> 00:00:04.000
今天我们聊聊字幕覆盖分布

00:00:07.000 --> 00:00:08.000
片尾再见
`;

type FieldName =
  | "content"
  | "program_start_ms"
  | "program_end_ms"
  | "bucket_ms"
  | "threshold_pct";

type FieldErrors = Partial<Record<FieldName, string>>;

const FIELD_LABELS: Record<FieldName, string> = {
  content: "WebVTT 文本",
  program_start_ms: "节目开始时间",
  program_end_ms: "节目结束时间",
  bucket_ms: "分桶时长",
  threshold_pct: "低覆盖阈值",
};

function parseThreshold(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

export function CoveragePage() {
  const [content, setContent] = useState(SAMPLE_VTT);
  const [programStart, setProgramStart] = useState("0");
  const [programEnd, setProgramEnd] = useState("10000");
  const [bucketMs, setBucketMs] = useState("2000");
  const [threshold, setThreshold] = useState("50");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [sourceError, setSourceError] = useState<ApiError | null>(null);
  // The coverage distribution keeps its own result state, independent of
  // the gap review on the other tab.
  const [result, setResult] = useState<CoverageResult | null>(null);
  // While an audit is in flight every input is locked, so the returned
  // distribution can never be displayed under an edited configuration.
  const [loading, setLoading] = useState(false);

  function buildInput(): CoverageInput | null {
    const errors: FieldErrors = {};

    if (!content.trim()) {
      errors.content = "请粘贴 WebVTT 文本。";
    }

    const start = parseInteger(programStart);
    if (start === null) {
      errors.program_start_ms = integerErrorMessage(
        FIELD_LABELS.program_start_ms,
        programStart,
      );
    }

    const end = parseInteger(programEnd);
    if (end === null) {
      errors.program_end_ms = integerErrorMessage(
        FIELD_LABELS.program_end_ms,
        programEnd,
      );
    }

    const bucket = parseInteger(bucketMs);
    if (bucket === null) {
      errors.bucket_ms = positiveIntegerErrorMessage(
        FIELD_LABELS.bucket_ms,
        bucketMs,
      );
    } else if (bucket < 1) {
      errors.bucket_ms = `${FIELD_LABELS.bucket_ms}必须是正整数毫秒。`;
    }

    const thresholdPct = parseThreshold(threshold);
    if (thresholdPct === null) {
      errors.threshold_pct = `${FIELD_LABELS.threshold_pct}必须是 0 到 100 之间的数值。`;
    }

    if (start !== null && end !== null && start >= end) {
      errors.program_end_ms =
        `节目结束时间（${end} ms）必须晚于开始时间（${start} ms）。`;
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return null;

    return {
      content,
      program_start_ms: start as number,
      program_end_ms: end as number,
      bucket_ms: bucket as number,
      threshold_pct: thresholdPct as number,
    };
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    // Every submission is audited afresh: never keep a stale distribution
    // or stale error when the new input is rejected.
    setResult(null);
    setSourceError(null);
    setFieldErrors({});

    const input = buildInput();
    if (!input) return;

    setLoading(true);
    try {
      const coverageResult = await postCoverage(input);
      setResult(coverageResult);
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError.field && apiError.field in FIELD_LABELS) {
        setFieldErrors({ [apiError.field as FieldName]: apiError.message });
      } else {
        setSourceError(apiError);
      }
    } finally {
      setLoading(false);
    }
  }

  const numberInput = (
    name: FieldName,
    label: string,
    value: string,
    onChange: (value: string) => void,
    testid: string,
    unit: string,
  ) => (
    <label className="field">
      <span>
        {label}
        <em>{unit}</em>
      </span>
      <input
        type="number"
        min={0}
        step="any"
        value={value}
        disabled={loading}
        data-testid={testid}
        aria-invalid={Boolean(fieldErrors[name])}
        onChange={(event) => onChange(event.target.value)}
      />
      {fieldErrors[name] && (
        <span className="field__error" data-testid={`${testid}-error`}>
          {fieldErrors[name]}
        </span>
      )}
    </label>
  );

  return (
    <>
      <p className="subtitle">
        粘贴 WebVTT 字幕并填写节目时间区间、正整数分桶时长与低覆盖阈值（0–100%），
        系统将按时间顺序统计每个时间桶的字幕覆盖毫秒数与覆盖率；
        跨桶字幕按区间交集拆分计入，末桶不足完整时长时按实际区间计算，
        覆盖率低于阈值的时间桶会被标记为低覆盖。
      </p>

      <form className="form" onSubmit={handleSubmit} noValidate>
        <div className="form__row">
          {numberInput(
            "program_start_ms",
            FIELD_LABELS.program_start_ms,
            programStart,
            setProgramStart,
            "coverage-input-start",
            "(ms)",
          )}
          {numberInput(
            "program_end_ms",
            FIELD_LABELS.program_end_ms,
            programEnd,
            setProgramEnd,
            "coverage-input-end",
            "(ms)",
          )}
          {numberInput(
            "bucket_ms",
            FIELD_LABELS.bucket_ms,
            bucketMs,
            setBucketMs,
            "coverage-input-bucket",
            "(ms)",
          )}
        </div>

        <div className="form__row form__row--threshold">
          <label className="field">
            <span>
              {FIELD_LABELS.threshold_pct}
              <em>(%，0–100)</em>
            </span>
            <input
              type="number"
              min={0}
              max={100}
              step="any"
              value={threshold}
              disabled={loading}
              data-testid="coverage-input-threshold"
              aria-invalid={Boolean(fieldErrors.threshold_pct)}
              onChange={(event) => setThreshold(event.target.value)}
            />
            {fieldErrors.threshold_pct && (
              <span
                className="field__error"
                data-testid="coverage-input-threshold-error"
              >
                {fieldErrors.threshold_pct}
              </span>
            )}
          </label>
        </div>

        <label className="field field--full">
          <span>{FIELD_LABELS.content}</span>
          <textarea
            value={content}
            rows={14}
            spellCheck={false}
            disabled={loading}
            data-testid="coverage-input-vtt"
            aria-invalid={Boolean(fieldErrors.content)}
            onChange={(event) => setContent(event.target.value)}
          />
          {fieldErrors.content && (
            <span
              className="field__error"
              data-testid="coverage-input-vtt-error"
            >
              {fieldErrors.content}
            </span>
          )}
        </label>

        <div className="form__actions">
          <button
            type="submit"
            disabled={loading}
            className="button button--primary"
            data-testid="coverage-submit"
          >
            {loading ? "统计中…" : "提交统计"}
          </button>
        </div>
      </form>

      {sourceError && (
        <div
          className="alert alert--error"
          role="alert"
          data-testid="coverage-source-error"
        >
          <strong>整份输入已拒绝：</strong>
          {sourceError.line !== null && sourceError.line !== undefined ? (
            <span>
              （原始第 <strong data-testid="coverage-source-error-line">
                {sourceError.line}
              </strong> 行）
            </span>
          ) : null}
          <span>{sourceError.message}</span>
        </div>
      )}

      {result && <CoverageResultPanel result={result} />}
    </>
  );
}
