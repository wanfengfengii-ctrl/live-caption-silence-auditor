// Locate WebVTT source text for a review result.
//
// The backend attributes cue blocks with 1-based line numbers produced by
// Python's str.splitlines(); the boundary set below mirrors it exactly
// (CR/LF pairs, vertical tab, form feed, file/group/record separators,
// NEL, and Unicode line/paragraph separators) so a source_range always
// selects the same lines the parser counted.

import type { SourceRange } from "./api";

const LINE_BREAKS =
  /\r\n|[\n\x0b\x0c\x1c-\x1e\x85\u2028\u2029]/g;

export interface TextSelection {
  start: number;
  end: number;
}

interface LineSpan {
  start: number; // offset of the first character of the line
  end: number; // offset just past the last character (before the break)
}

function lineSpans(text: string): LineSpan[] {
  const spans: LineSpan[] = [];
  const breaks = new RegExp(LINE_BREAKS.source, "g");
  let lineStart = 0;
  let match: RegExpExecArray | null;
  while ((match = breaks.exec(text)) !== null) {
    spans.push({ start: lineStart, end: match.index });
    lineStart = match.index + match[0].length;
  }
  // A trailing line break ends the final line; it does not start a new one
  // (same as Python: "a\n".splitlines() == ["a"]).
  if (spans.length === 0 || lineStart < text.length) {
    spans.push({ start: lineStart, end: text.length });
  }
  return spans;
}

/** Character offsets covering the 1-based inclusive line range, or null
 * when the range cannot be mapped onto the current text. */
export function selectionForRange(
  text: string,
  range: SourceRange,
): TextSelection | null {
  const spans = lineSpans(text);
  if (
    range.start_line < 1 ||
    range.end_line > spans.length ||
    range.start_line > range.end_line
  ) {
    return null;
  }
  return {
    start: spans[range.start_line - 1].start,
    end: spans[range.end_line - 1].end,
  };
}
