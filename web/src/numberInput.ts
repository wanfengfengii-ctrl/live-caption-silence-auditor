// Shared client-side parsing for millisecond/integer form fields.

const INTEGER_RE = /^\d+$/;

// Number() represents integers exactly only up to 2^53 - 1; beyond that a
// threshold would be silently rounded (and an overflowing value would even
// serialize as null), so such input is rejected at the field instead of
// submitting a value the user never typed.
export const MAX_PRECISE_MS = Number.MAX_SAFE_INTEGER;

export function parseInteger(raw: string): number | null {
  const trimmed = raw.trim();
  if (!INTEGER_RE.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

export function integerErrorMessage(label: string, raw: string): string {
  // A pure-digit value that failed to parse exceeds the precise range.
  if (INTEGER_RE.test(raw.trim())) {
    return (
      `${label}超出可精确表示的整数范围，` +
      `请填写不超过 ${MAX_PRECISE_MS} 的非负整数毫秒。`
    );
  }
  return `${label}必须是非负整数毫秒。`;
}

export function positiveIntegerErrorMessage(
  label: string,
  raw: string,
): string {
  // Same overflow distinction as integerErrorMessage, but the field only
  // accepts strictly positive integers (e.g. the bucket length).
  if (INTEGER_RE.test(raw.trim())) {
    return (
      `${label}超出可精确表示的整数范围，` +
      `请填写不超过 ${MAX_PRECISE_MS} 的正整数毫秒。`
    );
  }
  return `${label}必须是正整数毫秒。`;
}
