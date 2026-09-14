import type { GapType } from "./api";

export function formatMs(ms: number): string {
  const totalMs = Math.max(0, Math.trunc(ms));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const millis = totalMs % 1000;
  return (
    `${String(hours).padStart(2, "0")}:` +
    `${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")}.` +
    `${String(millis).padStart(3, "0")}`
  );
}

export const GAP_TYPE_LABEL: Record<GapType, string> = {
  head: "片头空档",
  between: "字幕间隙",
  tail: "片尾空档",
};

export function formatPct(pct: number): string {
  // Up to two decimals with trailing zeros trimmed: 50 -> "50%",
  // 33.333… -> "33.33%".
  return `${pct.toFixed(2).replace(/\.?0+$/, "")}%`;
}
