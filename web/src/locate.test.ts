import { describe, expect, it } from "vitest";
import { selectionForRange } from "./locate";

describe("selectionForRange", () => {
  it("selects a whole cue block with identifier and multi-line payload", () => {
    const text = "WEBVTT\n\ncue-1\n00:00:01.000 --> 00:00:02.000\n甲\n乙\n\nnext";
    const selection = selectionForRange(text, { start_line: 3, end_line: 6 });
    expect(selection).not.toBeNull();
    expect(text.slice(selection!.start, selection!.end)).toBe(
      "cue-1\n00:00:01.000 --> 00:00:02.000\n甲\n乙",
    );
  });

  it("counts lines like Python str.splitlines (CRLF, trailing newline)", () => {
    const text = "WEBVTT\r\n\r\nblock one\r\nblock two\r\n";
    // Lines: 1 "WEBVTT", 2 "", 3 "block one", 4 "block two" — the trailing
    // CRLF does not open a fifth line.
    const selection = selectionForRange(text, { start_line: 3, end_line: 4 });
    expect(text.slice(selection!.start, selection!.end)).toBe(
      "block one\r\nblock two",
    );
    expect(selectionForRange(text, { start_line: 5, end_line: 5 })).toBeNull();
  });

  it("rejects ranges outside the text or inverted", () => {
    const text = "WEBVTT\n\nonly block";
    expect(
      selectionForRange(text, { start_line: 0, end_line: 1 }),
    ).toBeNull();
    expect(
      selectionForRange(text, { start_line: 2, end_line: 1 }),
    ).toBeNull();
    expect(
      selectionForRange(text, { start_line: 1, end_line: 99 }),
    ).toBeNull();
  });
});
