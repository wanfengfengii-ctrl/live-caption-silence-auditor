import type { CoverageResult } from "../api";
import { formatMs, formatPct } from "../format";

export function CoverageResultPanel({ result }: { result: CoverageResult }) {
  const hasLowCoverage = result.low_coverage_count > 0;
  return (
    <section
      className={`result ${hasLowCoverage ? "result--fail" : "result--pass"}`}
      aria-live="polite"
      data-testid="coverage-result"
    >
      <header className="result__header">
        <h2 data-testid="coverage-verdict">
          {hasLowCoverage ? "⚠️ 存在低覆盖时段" : "✅ 覆盖分布达标"}
        </h2>
        <p className="result__summary">
          共解析 <strong>{result.cue_count}</strong> 条字幕，按{" "}
          <strong>{result.bucket_ms}</strong> ms 分为{" "}
          <strong>{result.bucket_count}</strong> 桶，最低覆盖率{" "}
          <strong data-testid="min-coverage">
            {formatPct(result.min_coverage_pct)}
          </strong>
          {hasLowCoverage && (
            <>
              ，低于 {result.threshold_pct}% 阈值的桶{" "}
              <strong data-testid="low-count">
                {result.low_coverage_count}
              </strong>{" "}
              个
            </>
          )}
        </p>
      </header>

      <table className="coverage-table">
        <thead>
          <tr>
            <th>桶</th>
            <th>区间</th>
            <th>时长 (ms)</th>
            <th>覆盖 (ms)</th>
            <th>覆盖率</th>
            <th>标记</th>
          </tr>
        </thead>
        <tbody>
          {result.buckets.map((bucket) => (
            <tr
              key={bucket.index}
              className={bucket.low_coverage ? "bucket--low" : ""}
              data-testid="bucket-row"
            >
              <td>{bucket.index + 1}</td>
              <td>
                {formatMs(bucket.start_ms)} → {formatMs(bucket.end_ms)}
              </td>
              <td>{bucket.duration_ms}</td>
              <td data-testid="bucket-covered">{bucket.covered_ms}</td>
              <td data-testid="bucket-pct">{formatPct(bucket.coverage_pct)}</td>
              <td>
                {bucket.low_coverage ? (
                  <span className="badge" data-testid="bucket-low">
                    低覆盖
                  </span>
                ) : (
                  "正常"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
