import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    { type: "head", start_ms: 0, end_ms: 0, duration_ms: 0, limit_ms: 1500, line: 3, to_line: null },
    { type: "between", start_ms: 2000, end_ms: 3500, duration_ms: 1500, limit_ms: 1500, line: 3, to_line: 6 },
    { type: "tail", start_ms: 4000, end_ms: 4000, duration_ms: 0, limit_ms: 1500, line: 6, to_line: null },
  ],
  violations: [],
};

const failingResult: ReviewResult = {
  passed: false,
  max_gap_ms: 2500,
  cue_count: 2,
  gaps: [
    { type: "head", start_ms: 0, end_ms: 0, duration_ms: 0, limit_ms: 1500, line: 3, to_line: null },
    { type: "between", start_ms: 2000, end_ms: 4500, duration_ms: 2500, limit_ms: 1500, line: 3, to_line: 6 },
    { type: "tail", start_ms: 5000, end_ms: 5000, duration_ms: 0, limit_ms: 1500, line: 6, to_line: null },
  ],
  violations: [
    { type: "between", start_ms: 2000, end_ms: 4500, duration_ms: 2500, limit_ms: 1500, line: 3, to_line: 6 },
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
    expect(body).not.toHaveProperty("gap_limits");
    expect(typeof body.content).toBe("string");
  });

  it("omits gap_limits while the category toggle is off", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(passingResult));
    render(<App />);
    await fillAndSubmit();
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body).not.toHaveProperty("gap_limits");
  });

  it("posts gap_limits with head/between/tail when enabled and filled", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(passingResult));
    render(<App />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("gap-limits-toggle"));
    await user.type(screen.getByTestId("input-gap-head"), "800");
    await user.type(screen.getByTestId("input-gap-between"), "1200");
    await user.type(screen.getByTestId("input-gap-tail"), "2000");
    await user.click(screen.getByTestId("submit"));

    await screen.findByTestId("verdict");
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.gap_limits).toEqual({ head: 800, between: 1200, tail: 2000 });
  });

  it.each([
    ["empty", ""],
    ["fractional", "1.5"],
    ["negative", "-1"],
  ])(
    "blocks the request when a category limit is %s and reports it next to the input",
    async (_case, raw) => {
      render(<App />);
      const user = userEvent.setup();
      await user.click(screen.getByTestId("gap-limits-toggle"));
      await user.type(screen.getByTestId("input-gap-head"), "800");
      await user.type(screen.getByTestId("input-gap-between"), "1200");
      if (raw !== "") {
        await user.type(screen.getByTestId("input-gap-tail"), raw);
      }
      await user.click(screen.getByTestId("submit"));

      expect(
        await screen.findByTestId("input-gap-tail-error"),
      ).toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
      expect(screen.queryByTestId("verdict")).not.toBeInTheDocument();
    },
  );

  it("retains category values after closing and reopening the toggle", async () => {
    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("gap-limits-toggle"));
    await user.type(screen.getByTestId("input-gap-head"), "800");
    await user.type(screen.getByTestId("input-gap-between"), "1200");
    await user.type(screen.getByTestId("input-gap-tail"), "2000");
    await user.click(screen.getByTestId("gap-limits-toggle"));
    expect(screen.queryByTestId("input-gap-head")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("gap-limits-toggle"));
    expect(screen.getByTestId("input-gap-head")).toHaveValue(800);
    expect(screen.getByTestId("input-gap-between")).toHaveValue(1200);
    expect(screen.getByTestId("input-gap-tail")).toHaveValue(2000);
  });

  it("routes a nested gap_limits field error to its category input", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "invalid_params",
            message: "片头分类上限必须是非负整数毫秒值。",
            field: "gap_limits.head",
            line: null,
          },
        },
        422,
      ),
    );
    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("gap-limits-toggle"));
    await user.type(screen.getByTestId("input-gap-head"), "800");
    await user.type(screen.getByTestId("input-gap-between"), "1200");
    await user.type(screen.getByTestId("input-gap-tail"), "2000");
    await user.click(screen.getByTestId("submit"));

    expect(await screen.findByTestId("input-gap-head-error")).toHaveTextContent(
      "非负整数",
    );
    expect(screen.queryByTestId("source-error")).not.toBeInTheDocument();
  });

  it("shows the applied per-category limit on a violation", async () => {
    const categoryResult: ReviewResult = {
      ...failingResult,
      gaps: failingResult.gaps.map((g) => ({ ...g, limit_ms: 900 })),
      violations: [
        { ...failingResult.violations[0], limit_ms: 900 },
      ],
    };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(categoryResult));
    render(<App />);
    await fillAndSubmit();

    expect(await screen.findByTestId("violation-limit")).toHaveTextContent(
      "上限 900 ms",
    );
  });

  it.each([
    // 2^53 + 1 rounds to ...992 in Number(); the raw string reaches the app.
    ["rounded beyond 2^53", "9007199254740993", "精确"],
    // 310 digits overflow Number() to Infinity (which would serialize as
    // null); jsdom empties such a number input, so the empty message shows.
    ["overflowing toward null in JSON", "9".repeat(310), "非负整数"],
  ])(
    "blocks the request when a category limit is %s and reports it next to the input",
    async (_case, raw, message) => {
      render(<App />);
      const user = userEvent.setup();
      await user.click(screen.getByTestId("gap-limits-toggle"));
      await user.type(screen.getByTestId("input-gap-head"), "800");
      await user.type(screen.getByTestId("input-gap-between"), "1200");
      fireEvent.change(screen.getByTestId("input-gap-tail"), {
        target: { value: raw },
      });
      await user.click(screen.getByTestId("submit"));

      expect(
        await screen.findByTestId("input-gap-tail-error"),
      ).toHaveTextContent(message);
      expect(fetch).not.toHaveBeenCalled();
      expect(screen.queryByTestId("verdict")).not.toBeInTheDocument();
    },
  );

  it("locks every config input while waiting for the verdict", async () => {
    let releaseReview: (response: Response) => void = () => {};
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          releaseReview = resolve;
        }),
    );
    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("gap-limits-toggle"));
    await user.type(screen.getByTestId("input-gap-head"), "800");
    await user.type(screen.getByTestId("input-gap-between"), "1200");
    await user.type(screen.getByTestId("input-gap-tail"), "2000");
    await user.click(screen.getByTestId("submit"));

    // The submitted configuration cannot be edited while the verdict is
    // pending, so the result always matches the form it appears under.
    await waitFor(() =>
      expect(screen.getByTestId("input-gap-head")).toBeDisabled(),
    );
    expect(screen.getByTestId("input-gap-between")).toBeDisabled();
    expect(screen.getByTestId("input-gap-tail")).toBeDisabled();
    expect(screen.getByTestId("gap-limits-toggle")).toBeDisabled();
    expect(screen.getByTestId("input-start")).toBeDisabled();
    expect(screen.getByTestId("input-end")).toBeDisabled();
    expect(screen.getByTestId("input-limit")).toBeDisabled();
    expect(screen.getByTestId("input-vtt")).toBeDisabled();

    releaseReview(jsonResponse(passingResult));
    expect(await screen.findByTestId("verdict")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("input-gap-head")).toBeEnabled(),
    );
  });

  it("routes a gap_limits object error to the category limits error slot", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "invalid_params",
            message: "分类上限不能为 null；如需统一上限请省略 gap_limits 字段。",
            field: "gap_limits",
            line: null,
          },
        },
        422,
      ),
    );
    render(<App />);
    await fillAndSubmit();

    expect(await screen.findByTestId("gap-limits-error")).toHaveTextContent(
      "不能为 null",
    );
    expect(screen.queryByTestId("source-error")).not.toBeInTheDocument();
  });
});
