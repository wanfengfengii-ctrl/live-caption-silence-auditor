import { useState } from "react";
import type { Gap, SourceRange } from "../api";
import { GAP_TYPE_LABEL } from "../format";

// Shared "定位原文" button for the violation list and the all-gaps table.
// A gap bounded by two cue blocks (字幕间隙) cycles through its boundary
// blocks on repeated clicks; a single-boundary gap (片头/片尾) reselects
// the same block. When the response carries no locate data the button is
// disabled and explains why, without disturbing the surrounding result.
export function LocateButton({
  gap,
  onLocate,
  testid,
}: {
  gap: Gap;
  onLocate: (range: SourceRange) => void;
  testid: string;
}) {
  const [cursor, setCursor] = useState(0);
  const ranges = gap.source_ranges ?? [];

  if (ranges.length === 0) {
    return (
      <button
        type="button"
        className="button button--locate"
        disabled
        data-testid={testid}
        title="该结果缺少原文定位数据，无法定位；请重新提交审校"
      >
        定位原文
      </button>
    );
  }

  const index = cursor % ranges.length;
  return (
    <button
      type="button"
      className="button button--locate"
      data-testid={testid}
      title={
        ranges.length > 1
          ? `在原文中选中形成该${GAP_TYPE_LABEL[gap.type]}的字幕块` +
            `（第 ${index + 1}/${ranges.length} 块，点击切换）`
          : `在原文中选中形成该${GAP_TYPE_LABEL[gap.type]}的字幕块`
      }
      onClick={() => {
        onLocate(ranges[index]);
        setCursor((index + 1) % ranges.length);
      }}
    >
      定位原文
      {ranges.length > 1 && (
        <span className="button__hint" data-testid={`${testid}-step`}>
          {index + 1}/{ranges.length}
        </span>
      )}
    </button>
  );
}
