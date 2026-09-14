import { useState } from "react";
import {
  type ApiError,
  type ReviewInput,
  type ReviewResult,
  postReview,
} from "./api";
import { ResultPanel } from "./components/ResultPanel";

const SAMPLE_VTT = `WEBVTT

1
00:00:01.000 --> 00:00:03.000
欢迎收看本期直播节目

00:00:03.500 --> 00:00:06.000
今天我们聊聊字幕空档审校

00:00:06.000 --> 00:00:08.000
片尾再见
`;

type FieldName =
  | "content"
  | "program_start_ms"
  | "program_end_ms"
  | "max_silence_ms";

type FieldErrors = Partial<Record<FieldName, string>>;

const FIELD_LABELS: Record<FieldName, string> = {
  content: "WebVTT 文本",
  program_start_ms: "节目开始时间",
  program_end_ms: "节目结束时间",
  max_silence_ms: "允许静默上限",
};

const INTEGER_RE = /^\d+$/;

function parseInteger(raw: string): number | null {
  const trimmed = raw.trim();
  if (!INTEGER_RE.test(trimmed)) return null;
  return Number(trimmed);
}

export function App() {
  const [content, setContent] = useState(SAMPLE_VTT);
  const [programStart, setProgramStart] = useState("0");
  const [programEnd, setProgramEnd] = useState("9000");
  const [maxSilence, setMaxSilence] = useState("1500");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [sourceError, setSourceError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [loading, setLoading] = useState(false);

  function buildInput(): ReviewInput | null {
    const errors: FieldErrors = {};

    if (!content.trim()) {
      errors.content = "请粘贴 WebVTT 文本。";
    }

    const start = parseInteger(programStart);
    if (start === null) {
      errors.program_start_ms = "节目开始时间必须是非负整数毫秒。";
    }

    const end = parseInteger(programEnd);
    if (end === null) {
      errors.program_end_ms = "节目结束时间必须是非负整数毫秒。";
    }

    const limit = parseInteger(maxSilence);
    if (limit === null) {
      errors.max_silence_ms = "允许静默上限必须是非负整数毫秒。";
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
      max_silence_ms: limit as number,
    };
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    // Every submission is adjudicated afresh: never keep a stale result or
    // stale error when the new input is rejected.
    setResult(null);
    setSourceError(null);
    setFieldErrors({});

    const input = buildInput();
    if (!input) return;

    setLoading(true);
    try {
      const reviewResult = await postReview(input);
      setResult(reviewResult);
    } catch (error) {
      const apiError = error as ApiError;
      if (
        apiError.field &&
        (apiError.field as FieldName) in FIELD_LABELS
      ) {
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
  ) => (
    <label className="field">
      <span>
        {label}
        <em>(ms)</em>
      </span>
      <input
        type="number"
        min={0}
        step={1}
        value={value}
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
    <main className="page">
      <h1>直播字幕空档审校</h1>
      <p className="subtitle">
        粘贴 WebVTT 字幕并填写节目时间区间与允许静默上限，系统将校验时间轴并审校片头、
        字幕之间与片尾的无字幕空档（首尾相接为 0，等于上限合格，超过 1 ms 即违规）。
      </p>

      <form className="form" onSubmit={handleSubmit} noValidate>
        <div className="form__row">
          {numberInput(
            "program_start_ms",
            FIELD_LABELS.program_start_ms,
            programStart,
            setProgramStart,
            "input-start",
          )}
          {numberInput(
            "program_end_ms",
            FIELD_LABELS.program_end_ms,
            programEnd,
            setProgramEnd,
            "input-end",
          )}
          {numberInput(
            "max_silence_ms",
            FIELD_LABELS.max_silence_ms,
            maxSilence,
            setMaxSilence,
            "input-limit",
          )}
        </div>

        <label className="field field--full">
          <span>{FIELD_LABELS.content}</span>
          <textarea
            value={content}
            rows={14}
            spellCheck={false}
            data-testid="input-vtt"
            aria-invalid={Boolean(fieldErrors.content)}
            onChange={(event) => setContent(event.target.value)}
          />
          {fieldErrors.content && (
            <span className="field__error" data-testid="input-vtt-error">
              {fieldErrors.content}
            </span>
          )}
        </label>

        <div className="form__actions">
          <button
            type="submit"
            disabled={loading}
            className="button button--primary"
            data-testid="submit"
          >
            {loading ? "审校中…" : "提交审校"}
          </button>
        </div>
      </form>

      {sourceError && (
        <div className="alert alert--error" role="alert" data-testid="source-error">
          <strong>整份输入已拒绝：</strong>
          {sourceError.line !== null && sourceError.line !== undefined ? (
            <span>
              （原始第 <strong data-testid="source-error-line">
                {sourceError.line}
              </strong> 行）
            </span>
          ) : null}
          <span>{sourceError.message}</span>
        </div>
      )}

      {result && <ResultPanel result={result} />}
    </main>
  );
}
