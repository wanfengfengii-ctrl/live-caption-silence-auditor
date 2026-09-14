import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { CoverageResult } from "./api";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

const sampleResult: CoverageResult = {
  buckets: [
    { index: 0, start_ms: 0, end_ms: 2000, duration_ms: 2000, covered_ms: 2000, coverage_pct: 100, low_coverage: false },
    { index: 1, start_ms: 2000, end_ms: 4000, duration_ms: 2000, covered_ms: 1000, coverage_pct: 50, low_coverage: false },
    { index: 2, start_ms: 4000, end_ms: 6000, duration_ms: 2000, covered_ms: 666, coverage_pct: 33.33333333333333, low_coverage: true },
  ],
  bucket_count: 3,
  cue_count: 2,
  bucket_ms: 2000,
  threshold_pct: 50,
  min_coverage_pct: 33.33333333333333,
  low_coverage_count: 1,
};

async function openCoverageTab() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByTestId("tab-coverage"));
  return user;
}

describe("Coverage page states", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the gap review by default and switches between tabs", async () => {
    const user = await openCoverageTab();
    expect(screen.getByTestId("coverage-input-vtt")).toBeInTheDocument();
    expect(screen.queryByTestId("input-vtt")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("tab-review"));
    expect(screen.getByTestId("input-vtt")).toBeInTheDocument();
    expect(screen.queryByTestId("coverage-input-vtt")).not.toBeInTheDocument();
  });

  it("renders the distribution with min coverage and low-coverage buckets", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(sampleResult));
    await openCoverageTab();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("coverage-submit"));

    expect(await screen.findByTestId("coverage-verdict")).toHaveTextContent(
      "存在低覆盖时段",
    );
    expect(screen.getByTestId("min-coverage")).toHaveTextContent("33.33%");
    expect(screen.getByTestId("low-count")).toHaveTextContent("1");

    const rows = screen.getAllByTestId("bucket-row");
    expect(rows).toHaveLength(3);
    const covered = screen.getAllByTestId("bucket-covered");
    expect(covered.map((cell) => cell.textContent)).toEqual([
      "2000",
      "1000",
      "666",
    ]);
    const pcts = screen.getAllByTestId("bucket-pct");
    expect(pcts.map((cell) => cell.textContent)).toEqual([
      "100%",
      "50%",
      "33.33%",
    ]);
    expect(screen.getAllByTestId("bucket-low")).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("posts coverage parameters to /api/coverage", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(sampleResult));
    await openCoverageTab();
    const user = userEvent.setup();
    await user.clear(screen.getByTestId("coverage-input-bucket"));
    await user.type(screen.getByTestId("coverage-input-bucket"), "2500");
    await user.clear(screen.getByTestId("coverage-input-threshold"));
    await user.type(screen.getByTestId("coverage-input-threshold"), "42.5");
    await user.click(screen.getByTestId("coverage-submit"));

    await screen.findByTestId("coverage-result");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/coverage");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.program_start_ms).toBe(0);
    expect(body.program_end_ms).toBe(10000);
    expect(body.bucket_ms).toBe(2500);
    expect(body.threshold_pct).toBe(42.5);
    expect(body).not.toHaveProperty("max_silence_ms");
    expect(typeof body.content).toBe("string");
  });

  it("routes a parameter error to the responsible input", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "invalid_params",
            message: "分桶时长 100 ms 将生成 1200 个桶，超过上限 1000 个。",
            field: "bucket_ms",
            line: null,
          },
        },
        422,
      ),
    );
    await openCoverageTab();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("coverage-submit"));

    expect(
      await screen.findByTestId("coverage-input-bucket-error"),
    ).toHaveTextContent("超过上限");
    expect(
      screen.queryByTestId("coverage-source-error"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("coverage-result")).not.toBeInTheDocument();
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
    await openCoverageTab();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("coverage-submit"));

    const errorBox = await screen.findByTestId("coverage-source-error");
    expect(errorBox).toHaveTextContent("整份输入已拒绝");
    expect(
      screen.getByTestId("coverage-source-error-line"),
    ).toHaveTextContent("6");
    expect(screen.queryByTestId("coverage-result")).not.toBeInTheDocument();
  });

  it.each([["zero", "0"], ["negative", "-1"], ["fractional", "1.5"]])(
    "blocks submission locally when the bucket length is %s",
    async (_case, raw) => {
      await openCoverageTab();
      const user = userEvent.setup();
      await user.clear(screen.getByTestId("coverage-input-bucket"));
      await user.type(screen.getByTestId("coverage-input-bucket"), raw);
      await user.click(screen.getByTestId("coverage-submit"));

      expect(
        await screen.findByTestId("coverage-input-bucket-error"),
      ).toHaveTextContent("正整数");
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([["over a hundred", "100.5"], ["negative", "-1"]])(
    "blocks submission locally when the threshold is %s",
    async (_case, raw) => {
      await openCoverageTab();
      const user = userEvent.setup();
      await user.clear(screen.getByTestId("coverage-input-threshold"));
      await user.type(screen.getByTestId("coverage-input-threshold"), raw);
      await user.click(screen.getByTestId("coverage-submit"));

      expect(
        await screen.findByTestId("coverage-input-threshold-error"),
      ).toHaveTextContent("0 到 100");
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("blocks submission locally when start is not before end", async () => {
    await openCoverageTab();
    const user = userEvent.setup();
    await user.clear(screen.getByTestId("coverage-input-start"));
    await user.type(screen.getByTestId("coverage-input-start"), "5000");
    await user.clear(screen.getByTestId("coverage-input-end"));
    await user.type(screen.getByTestId("coverage-input-end"), "5000");
    await user.click(screen.getByTestId("coverage-submit"));

    expect(
      await screen.findByTestId("coverage-input-end-error"),
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks submission locally when the VTT content is empty", async () => {
    await openCoverageTab();
    const user = userEvent.setup();
    await user.clear(screen.getByTestId("coverage-input-vtt"));
    await user.click(screen.getByTestId("coverage-submit"));

    expect(
      await screen.findByTestId("coverage-input-vtt-error"),
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("clears a previous distribution when the next submission is rejected", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(sampleResult));
    await openCoverageTab();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("coverage-submit"));
    expect(await screen.findByTestId("coverage-result")).toBeInTheDocument();

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
    await user.clear(screen.getByTestId("coverage-input-vtt"));
    await user.type(screen.getByTestId("coverage-input-vtt"), "WEBVTT\n");
    await user.click(screen.getByTestId("coverage-submit"));

    await waitFor(() =>
      expect(screen.queryByTestId("coverage-result")).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByTestId("coverage-source-error"),
    ).toBeInTheDocument();
  });

  it("locks every input while waiting for the distribution", async () => {
    let release: (response: Response) => void = () => {};
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    await openCoverageTab();
    const user = userEvent.setup();
    await user.click(screen.getByTestId("coverage-submit"));

    // The submitted configuration cannot be edited while the distribution
    // is pending, so the result always matches the form it appears under.
    await waitFor(() =>
      expect(screen.getByTestId("coverage-input-bucket")).toBeDisabled(),
    );
    expect(screen.getByTestId("coverage-input-start")).toBeDisabled();
    expect(screen.getByTestId("coverage-input-end")).toBeDisabled();
    expect(screen.getByTestId("coverage-input-threshold")).toBeDisabled();
    expect(screen.getByTestId("coverage-input-vtt")).toBeDisabled();

    release(jsonResponse(sampleResult));
    expect(await screen.findByTestId("coverage-result")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("coverage-input-bucket")).toBeEnabled(),
    );
  });
});
