import { expect, test, type Page } from "@playwright/test";

async function submit(page: Page) {
  await page.getByTestId("submit").click();
}

test("页面真实联调：默认样例在 1500ms 上限下审校通过", async ({ page }: { page: Page }) => {
  await page.goto("/");
  await submit(page);

  await expect(page.getByTestId("verdict")).toHaveText("✅ 审校通过");
  await expect(page.getByTestId("max-gap")).toHaveText("1000");
  // head = 1000, between = 500/0, tail = 1000
  await expect(page.getByTestId("violation")).toHaveCount(0);
});

test("裁决边界：上限等于最大空档合格，减少 1ms 立即违规并列出全部区段", async ({ page }: { page: Page }) => {
  await page.goto("/");
  await page.getByTestId("input-limit").fill("1000");
  await submit(page);
  await expect(page.getByTestId("verdict")).toHaveText("✅ 审校通过");

  await page.getByTestId("input-limit").fill("999");
  await submit(page);
  await expect(page.getByTestId("verdict")).toHaveText("❌ 审校不通过");
  // 片头与片尾均为 1000ms，均超过 999ms
  await expect(page.getByTestId("violation")).toHaveCount(2);
  await expect(page.getByTestId("violation").first()).toContainText("1000 ms");
});

test("解析错误：拒绝整份输入并显示原始行号，且不保留旧结果", async ({ page }: { page: Page }) => {
  await page.goto("/");
  await submit(page);
  await expect(page.getByTestId("verdict")).toBeVisible();

  await page.getByTestId("input-vtt").fill(
    "WEBVTT\n\n" +
      "00:00:01.000 --> 00:00:02.000\n第一条\n\n" +
      "00:00:03.000 --> 00:00:61.000\n坏时间戳\n",
  );
  await submit(page);

  const errorBox = page.getByTestId("source-error");
  await expect(errorBox).toBeVisible();
  await expect(page.getByTestId("source-error-line")).toHaveText("6");
  await expect(page.getByTestId("verdict")).toHaveCount(0);
});

test("仅含文件头无字幕块被拒绝（empty_document）", async ({ page }: { page: Page }) => {
  await page.goto("/");
  await page.getByTestId("input-vtt").fill("WEBVTT\n");
  await submit(page);
  const errorBox = page.getByTestId("source-error");
  await expect(errorBox).toBeVisible();
  await expect(errorBox).toContainText("没有任何字幕块");
});

test("参数错误：开始时间不小于结束时间时指向结束字段，不发起错误状态", async ({ page }: { page: Page }) => {
  await page.goto("/");
  await page.getByTestId("input-start").fill("5000");
  await page.getByTestId("input-end").fill("5000");
  await submit(page);
  await expect(page.getByTestId("input-end-error")).toBeVisible();
  await expect(page.getByTestId("source-error")).toHaveCount(0);
  await expect(page.getByTestId("verdict")).toHaveCount(0);
});

test("时间轴违规：重叠字幕按原始行号拒绝", async ({ page }: { page: Page }) => {
  await page.goto("/");
  await page.getByTestId("input-start").fill("0");
  await page.getByTestId("input-end").fill("20000");
  await page.getByTestId("input-limit").fill("5000");
  await page.getByTestId("input-vtt").fill(
    "WEBVTT\n\n" +
      "00:00:01.000 --> 00:00:06.000\n长字幕\n\n" +
      "00:00:05.000 --> 00:00:08.000\n与上条重叠\n",
  );
  await submit(page);
  await expect(page.getByTestId("source-error")).toBeVisible();
  await expect(page.getByTestId("source-error-line")).toHaveText("6");
});

// Two cues in 0..5000ms produce three gaps of exactly 1000ms each:
// head 0->1000, between 2000->3000, tail 4000->5000.
const EQUAL_GAPS_VTT =
  "WEBVTT\n\n" +
  "00:00:01.000 --> 00:00:02.000\n第一条\n\n" +
  "00:00:03.000 --> 00:00:04.000\n第二条\n";

async function enableCategoryLimits(page: Page) {
  await page.getByTestId("input-start").fill("0");
  await page.getByTestId("input-end").fill("5000");
  await page.getByTestId("input-vtt").fill(EQUAL_GAPS_VTT);
  await page.getByTestId("gap-limits-toggle").check();
}

test("分类上限：三段等长空档按不同分类上限产生不同判定", async ({ page }: { page: Page }) => {
  await page.goto("/");
  await enableCategoryLimits(page);
  await page.getByTestId("input-gap-head").fill("1000");
  await page.getByTestId("input-gap-between").fill("999");
  await page.getByTestId("input-gap-tail").fill("2000");
  await submit(page);

  await expect(page.getByTestId("verdict")).toHaveText("❌ 审校不通过");
  // Only the 字幕间隙 gap (1000ms > 999ms) violates; head equals its limit
  // and tail is well under its limit.
  const violations = page.getByTestId("violation");
  await expect(violations).toHaveCount(1);
  await expect(violations.first()).toContainText("字幕间隙");
  await expect(violations.first()).toContainText("上限 999 ms");
  // max_gap_ms is the raw largest gap (1000), independent of limits.
  await expect(page.getByTestId("max-gap")).toHaveText("1000");
});

test("分类上限：空档时长等于分类上限时通过", async ({ page }: { page: Page }) => {
  await page.goto("/");
  await enableCategoryLimits(page);
  await page.getByTestId("input-gap-head").fill("1000");
  await page.getByTestId("input-gap-between").fill("1000");
  await page.getByTestId("input-gap-tail").fill("1000");
  await submit(page);

  await expect(page.getByTestId("verdict")).toHaveText("✅ 审校通过");
  await expect(page.getByTestId("violation")).toHaveCount(0);
});

test("分类上限：关闭后重新开启保留本次已填值", async ({ page }: { page: Page }) => {
  await page.goto("/");
  await page.getByTestId("gap-limits-toggle").check();
  await page.getByTestId("input-gap-head").fill("800");
  await page.getByTestId("input-gap-between").fill("1200");
  await page.getByTestId("input-gap-tail").fill("2000");

  await page.getByTestId("gap-limits-toggle").uncheck();
  await expect(page.getByTestId("input-gap-head")).toHaveCount(0);
  await page.getByTestId("gap-limits-toggle").check();
  await expect(page.getByTestId("input-gap-head")).toHaveValue("800");
  await expect(page.getByTestId("input-gap-between")).toHaveValue("1200");
  await expect(page.getByTestId("input-gap-tail")).toHaveValue("2000");
});

test("分类上限：分类值非法（负数）时在输入旁反馈且不发送请求", async ({ page }: { page: Page }) => {
  await page.goto("/");
  let reviewRequested = false;
  await page.route("**/api/review", (route) => {
    reviewRequested = true;
    route.continue();
  });
  await enableCategoryLimits(page);
  await page.getByTestId("input-gap-head").fill("1000");
  await page.getByTestId("input-gap-between").fill("1000");
  await page.getByTestId("input-gap-tail").fill("-1");
  await submit(page);

  await expect(page.getByTestId("input-gap-tail-error")).toBeVisible();
  await expect(page.getByTestId("input-gap-tail-error")).toContainText("非负整数");
  await expect(page.getByTestId("verdict")).toHaveCount(0);
  // Give any (incorrect) in-flight request a moment, then assert none fired.
  await page.waitForTimeout(300);
  expect(reviewRequested).toBe(false);
});

test("分类上限：分类值超出精确范围时在输入旁拒绝且不发送请求", async ({ page }: { page: Page }) => {
  await page.goto("/");
  let reviewRequested = false;
  await page.route("**/api/review", (route) => {
    reviewRequested = true;
    route.continue();
  });
  await enableCategoryLimits(page);
  await page.getByTestId("input-gap-head").fill("1000");
  await page.getByTestId("input-gap-between").fill("1000");
  // 2^53 + 1 cannot be represented exactly; Number() would silently round it.
  await page.getByTestId("input-gap-tail").fill("9007199254740993");
  await submit(page);

  await expect(page.getByTestId("input-gap-tail-error")).toBeVisible();
  await expect(page.getByTestId("input-gap-tail-error")).toContainText("精确");
  await expect(page.getByTestId("verdict")).toHaveCount(0);
  // Give any (incorrect) in-flight request a moment, then assert none fired.
  await page.waitForTimeout(300);
  expect(reviewRequested).toBe(false);
});

test("分类上限：等待审校结果期间表单锁定，结果与当前配置一致", async ({ page }: { page: Page }) => {
  await page.goto("/");
  await enableCategoryLimits(page);
  await page.getByTestId("input-gap-head").fill("1000");
  await page.getByTestId("input-gap-between").fill("1000");
  await page.getByTestId("input-gap-tail").fill("1000");

  // Hold the response so the waiting state is observable.
  let release: () => void = () => {};
  await page.route("**/api/review", async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.continue();
  });
  await submit(page);

  // While the verdict is pending, no threshold (or any other config input)
  // can be edited, so the returned result always matches the visible form.
  await expect(page.getByTestId("input-gap-head")).toBeDisabled();
  await expect(page.getByTestId("input-gap-between")).toBeDisabled();
  await expect(page.getByTestId("input-gap-tail")).toBeDisabled();
  await expect(page.getByTestId("gap-limits-toggle")).toBeDisabled();
  await expect(page.getByTestId("input-start")).toBeDisabled();
  await expect(page.getByTestId("input-end")).toBeDisabled();
  await expect(page.getByTestId("input-limit")).toBeDisabled();
  await expect(page.getByTestId("input-vtt")).toBeDisabled();

  release();
  await expect(page.getByTestId("verdict")).toHaveText("✅ 审校通过");
  await expect(page.getByTestId("input-gap-head")).toBeEnabled();
});
