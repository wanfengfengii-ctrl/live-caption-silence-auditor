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
