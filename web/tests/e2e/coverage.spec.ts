import { expect, test, type Page } from "@playwright/test";

async function openCoverageTab(page: Page) {
  await page.goto("/");
  await page.getByTestId("tab-coverage").click();
}

test("覆盖分布：默认样例按时间顺序展示每桶覆盖率、最低覆盖率与低覆盖桶", async ({ page }: { page: Page }) => {
  await openCoverageTab(page);
  await page.getByTestId("coverage-submit").click();

  // 默认样例：0..10000ms 按 2000ms 分 5 桶，[4000,6000] 与 [8000,10000]
  // 两桶完全无字幕，[6000,8000] 覆盖 1000ms = 50%，恰好等于阈值不标记。
  await expect(page.getByTestId("coverage-verdict")).toHaveText("⚠️ 存在低覆盖时段");
  await expect(page.getByTestId("bucket-row")).toHaveCount(5);
  await expect(page.getByTestId("min-coverage")).toHaveText("0%");
  await expect(page.getByTestId("low-count")).toHaveText("2");
  await expect(page.getByTestId("bucket-low")).toHaveCount(2);

  const rows = page.getByTestId("bucket-row");
  await expect(rows.nth(3).getByTestId("bucket-pct")).toHaveText("50%");
  await expect(rows.nth(3).getByTestId("bucket-low")).toHaveCount(0);
  await expect(rows.nth(2).getByTestId("bucket-low")).toBeVisible();
  await expect(rows.nth(4).getByTestId("bucket-low")).toBeVisible();
});

test("覆盖分布：跨桶字幕按交集拆分，短末桶按实际时长计算且等于阈值不标记", async ({ page }: { page: Page }) => {
  await openCoverageTab(page);
  await page.getByTestId("coverage-input-start").fill("0");
  await page.getByTestId("coverage-input-end").fill("2500");
  await page.getByTestId("coverage-input-bucket").fill("1000");
  await page.getByTestId("coverage-input-threshold").fill("50");
  await page.getByTestId("coverage-input-vtt").fill(
    "WEBVTT\n\n" +
      "00:00:00.500 --> 00:00:01.500\n跨两个桶的字幕\n\n" +
      "00:00:02.000 --> 00:00:02.250\n末尾短字幕\n",
  );
  await page.getByTestId("coverage-submit").click();

  // [500,1500] 跨两个 1000ms 桶，各计 500ms；末桶 [2000,2500] 实际
  // 500ms，覆盖 250ms = 50%，恰好等于阈值，不标记低覆盖。
  await expect(page.getByTestId("coverage-verdict")).toHaveText("✅ 覆盖分布达标");
  const rows = page.getByTestId("bucket-row");
  await expect(rows).toHaveCount(3);
  await expect(page.getByTestId("bucket-covered")).toHaveText(["500", "500", "250"]);
  await expect(page.getByTestId("bucket-pct")).toHaveText(["50%", "50%", "50%"]);
  await expect(page.getByTestId("bucket-low")).toHaveCount(0);
  await expect(page.getByTestId("min-coverage")).toHaveText("50%");
});

test("覆盖分布：超过一千个桶被服务器拒绝，错误显示在分桶时长输入旁", async ({ page }: { page: Page }) => {
  await openCoverageTab(page);
  // 先得到一次成功结果，验证被拒绝后旧分布会被清空。
  await page.getByTestId("coverage-submit").click();
  await expect(page.getByTestId("coverage-result")).toBeVisible();

  // 0..2000000ms 按 1000ms 分桶将生成 2000 个桶，超过 1000 上限。
  await page.getByTestId("coverage-input-end").fill("2000000");
  await page.getByTestId("coverage-input-bucket").fill("1000");
  await page.getByTestId("coverage-submit").click();

  const fieldError = page.getByTestId("coverage-input-bucket-error");
  await expect(fieldError).toBeVisible();
  await expect(fieldError).toContainText("超过上限");
  await expect(page.getByTestId("coverage-result")).toHaveCount(0);
  await expect(page.getByTestId("coverage-source-error")).toHaveCount(0);
});

test("覆盖分布：解析错误拒绝整份输入并显示原始行号", async ({ page }: { page: Page }) => {
  await openCoverageTab(page);
  await page.getByTestId("coverage-input-vtt").fill(
    "WEBVTT\n\n" +
      "00:00:01.000 --> 00:00:02.000\n第一条\n\n" +
      "00:00:03.000 --> 00:00:61.000\n坏时间戳\n",
  );
  await page.getByTestId("coverage-submit").click();

  const errorBox = page.getByTestId("coverage-source-error");
  await expect(errorBox).toBeVisible();
  await expect(page.getByTestId("coverage-source-error-line")).toHaveText("6");
  await expect(page.getByTestId("coverage-result")).toHaveCount(0);
});

test("覆盖分布：分桶时长为零时在输入旁反馈且不发送请求", async ({ page }: { page: Page }) => {
  await openCoverageTab(page);
  let coverageRequested = false;
  await page.route("**/api/coverage", (route) => {
    coverageRequested = true;
    route.continue();
  });
  await page.getByTestId("coverage-input-bucket").fill("0");
  await page.getByTestId("coverage-submit").click();

  const fieldError = page.getByTestId("coverage-input-bucket-error");
  await expect(fieldError).toBeVisible();
  await expect(fieldError).toContainText("正整数");
  await expect(page.getByTestId("coverage-result")).toHaveCount(0);
  // Give any (incorrect) in-flight request a moment, then assert none fired.
  await page.waitForTimeout(300);
  expect(coverageRequested).toBe(false);
});

test("覆盖分布：阈值超出一百时在输入旁反馈且不发送请求", async ({ page }: { page: Page }) => {
  await openCoverageTab(page);
  let coverageRequested = false;
  await page.route("**/api/coverage", (route) => {
    coverageRequested = true;
    route.continue();
  });
  await page.getByTestId("coverage-input-threshold").fill("100.5");
  await page.getByTestId("coverage-submit").click();

  const fieldError = page.getByTestId("coverage-input-threshold-error");
  await expect(fieldError).toBeVisible();
  await expect(fieldError).toContainText("0 到 100");
  await page.waitForTimeout(300);
  expect(coverageRequested).toBe(false);
});

test("页签切换：空档审校入口保持可用", async ({ page }: { page: Page }) => {
  await openCoverageTab(page);
  await expect(page.getByTestId("coverage-input-vtt")).toBeVisible();

  await page.getByTestId("tab-review").click();
  await expect(page.getByTestId("input-vtt")).toBeVisible();
  await page.getByTestId("submit").click();
  await expect(page.getByTestId("verdict")).toHaveText("✅ 审校通过");
});
