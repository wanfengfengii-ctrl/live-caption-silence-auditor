import type { Gap, ReviewResult } from "../api";
import { GAP_TYPE_LABEL, formatMs } from "../format";

function GapLocation({ gap }: { gap: Gap }) {
  if (gap.type === "between") {
    return (
      <span data-testid={`gap-lines-${gap.type}`}>
        第 {gap.line} 行 → 第 {gap.to_line} 行
      </span>
    );
  }
  return <span>第 {gap.line} 行字幕{gap.type === "head" ? "之前" : "之后"}</span>;
}

export function ResultPanel({ result }: { result: ReviewResult }) {
  return (
    <section
      className={`result ${result.passed ? "result--pass" : "result--fail"}`}
      aria-live="polite"
    >
      <header className="result__header">
        <h2 data-testid="verdict">
          {result.passed ? "✅ 审校通过" : "❌ 审校不通过"}
        </h2>
        <p className="result__summary">
          共解析 <strong>{result.cue_count}</strong> 条字幕，最大空档{" "}
          <strong data-testid="max-gap">{result.max_gap_ms}</strong> ms
          {result.violations.length > 0 && (
            <>
              ，违规区段 <strong>{result.violations.length}</strong> 处
            </>
          )}
        </p>
      </header>

      {result.violations.length > 0 && (
        <div className="result__violations">
          <h3>违规区段（超过允许上限）</h3>
          <ul>
            {result.violations.map((gap, index) => (
              <li
                key={`v-${index}`}
                className="violation"
                data-testid="violation"
              >
                <span className="badge">{GAP_TYPE_LABEL[gap.type]}</span>
                <span>
                  {formatMs(gap.start_ms)} → {formatMs(gap.end_ms)}
                </span>
                <span data-testid="violation-duration">{gap.duration_ms} ms</span>
                <span data-testid="violation-limit">
                  上限 {gap.limit_ms} ms
                </span>
                <GapLocation gap={gap} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="result__all-gaps" open>
        <summary>全部空档（{result.gaps.length} 段）</summary>
        <table>
          <thead>
            <tr>
              <th>类型</th>
              <th>起 (ms)</th>
              <th>止 (ms)</th>
              <th>时长 (ms)</th>
              <th>采用上限 (ms)</th>
              <th>位置</th>
            </tr>
          </thead>
          <tbody>
            {result.gaps.map((gap, index) => (
              <tr
                key={`g-${index}`}
                className={gap.duration_ms > 0 ? "" : "gap--zero"}
                data-testid="gap-row"
              >
                <td>{GAP_TYPE_LABEL[gap.type]}</td>
                <td>{gap.start_ms}</td>
                <td>{gap.end_ms}</td>
                <td>{gap.duration_ms}</td>
                <td>{gap.limit_ms}</td>
                <td>
                  <GapLocation gap={gap} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
