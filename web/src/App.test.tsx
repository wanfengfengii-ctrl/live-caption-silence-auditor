import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { ReviewResult } from "./api";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const passingResult: ReviewResult = {
  passed: true,
  max_gap_ms: 1500,
  cue_count: 2,
  gaps: [
    { type: "head", start_ms: 0, end_ms: 0, duration_ms: 0, line: 3, to_line: null },
    { type: "between", start_ms: 2000, end_ms: 3500, duration_ms: 1500, line: 3, to_line: 6 },
    { type: "tail", start_ms: 4000, end_ms: 4000, duration_ms: 0, line: 6, to_line: null },
  ],
  violations: [],
};

const failingResult: ReviewResult = {
  passed: false,
  max_gap_ms: 2500,
  cue_count: 2,
  gaps: [
    { type: "head", start_ms: 0, end_ms: 0, duration_ms: 0, line: 3, to_line: null },
    { type: "between", start_ms: 2000, end_ms: 4500, duration_ms: 2500, line: 3, to_line: 6 },
    { type: "tail", start_ms: 5000, end_ms: 5000, duration_ms: 0, line: 6, to_line: null },
  ],
  violations: [
    { type: "between", start_ms: 2000, end_ms: 4500, duration_ms: 2500, line: 3, to_line: 6 },
  ],
};

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.clear(screen.getByTestId("input-vtt"));
  await user.type(screen.getByTestId("input-vtt"), "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nx");
  await user.click(screen.getByTestId("submit"));
}

describe("App page states", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a passing verdict with max gap and no violations", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(passingResult));
    render(<App />);

    await fillAndSubmit();

    expect(await screen.findByTestId("verdict")).toHaveTextContent("审校通过");
    expect(screen.getByTestId("max-gap")).toHaveTextContent("1500");
    expect(screen.queryAllByTestId("violation")).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("renders a failing verdict with every violating segment", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(failingResult));
    render(<App />);

    await fillAndSubmit();

    expect(await screen.findByTestId("verdict")).toHaveTextContent("审校不通过");
    const violations = screen.getAllByTestId("violation");
    expect(violations).toHaveLength(1);
    expect(violations[0]).toHaveTextContent("2500 ms");
    expect(violations[0]).toHaveTextContent("字幕间隙");
  });

  it("shows a source error with its original line number", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "parse_error",
            message: "第 6 行的时间戳无效：00:00:61.000",
            field: null,
            line: 6,
          },
        },
        422,
      ),
    );
    render(<App />);
    await fillAndSubmit();

    const errorBox = await screen.findByTestId("source-error");
    expect(errorBox).toHaveTextContent("整份输入已拒绝");
    expect(screen.getByTestId("source-error-line")).toHaveTextContent("6");
    expect(screen.queryByTestId("verdict")).not.toBeInTheDocument();
  });

  it("routes a field error to the responsible input", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "invalid_program_range",
            message: "节目开始时间必须小于节目结束时间。",
            field: "program_end_ms",
            line: null,
          },
        },
        422,
      ),
    );
    render(<App />);
    await fillAndSubmit();

    expect(await screen.findByTestId("input-end-error")).toHaveTextContent(
      "必须小于节目结束时间",
    );
    expect(screen.queryByTestId("source-error")).not.toBeInTheDocument();
  });

  it("blocks submission locally when start is not before end", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.clear(screen.getByTestId("input-start"));
    await user.type(screen.getByTestId("input-start"), "5000");
    await user.clear(screen.getByTestId("input-end"));
    await user.type(screen.getByTestId("input-end"), "5000");
    await user.click(screen.getByTestId("submit"));

    expect(await screen.findByTestId("input-end-error")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks submission locally for non-integer or negative milliseconds", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.clear(screen.getByTestId("input-limit"));
    await user.type(screen.getByTestId("input-limit"), "1.5");
    await user.click(screen.getByTestId("submit"));
    expect(await screen.findByTestId("input-limit-error")).toHaveTextContent("非负整数");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks submission locally when VTT content is empty", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.clear(screen.getByTestId("input-vtt"));
    await user.click(screen.getByTestId("submit"));

    expect(await screen.findByTestId("input-vtt-error")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("clears a previous passing result when the next submission is rejected", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(passingResult));
    render(<App />);
    await fillAndSubmit();
    expect(await screen.findByTestId("verdict")).toBeInTheDocument();

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: "empty_document",
            message: "文档仅含文件头，没有任何字幕块。",
            field: null,
            line: 1,
          },
        },
        422,
      ),
    );
    const user = userEvent.setup();
    await user.clear(screen.getByTestId("input-vtt"));
    await user.type(screen.getByTestId("input-vtt"), "WEBVTT\n");
    await user.click(screen.getByTestId("submit"));

    await waitFor(() =>
      expect(screen.queryByTestId("verdict")).not.toBeInTheDocument(),
    );
    expect(await screen.findByTestId("source-error")).toBeInTheDocument();
  });

  it("posts millisecond integers to /api/review", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(passingResult));
    render(<App />);
    await fillAndSubmit();

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/review");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.program_start_ms).toBe(0);
    expect(body.program_end_ms).toBe(9000);
    expect(body.max_silence_ms).toBe(1500);
    expect(typeof body.content).toBe("string");
  });
});
