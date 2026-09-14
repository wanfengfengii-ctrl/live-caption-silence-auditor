# 直播字幕审校台（WebVTT Gap Review + Coverage）

节目上线前的字幕审校 Web + API 系统，提供两个独立入口：

- **空档审校**：发现**片头、字幕之间、片尾**过长无字幕空档。
- **覆盖分布**：按时间桶统计字幕覆盖毫秒数与覆盖率，发现低覆盖时段。

页面粘贴 WebVTT 与节目时间参数，后端使用维护中的
[`webvtt-py`](https://pypi.org/project/webvtt-py/) 解析库完成真正的格式解析，
统一为毫秒区间后做时间轴校验与裁决，并返回结构化结果。

## 裁决规则

- 空档 = 节目开始 → 第一条字幕（片头）、相邻字幕间（上一条结束 → 下一条开始）、
  最后一条字幕结束 → 节目结束（片尾）。
- 首尾相接的空档为 **0 ms**；空档时长 **等于**允许上限判为合格；
  **超过上限 1 ms** 即违规。
- **分类上限**（可选）：开启后分别为片头 `head`、字幕间 `between`、片尾 `tail`
  指定独立上限；三段空档各自按对应上限裁决，`max_silence_ms` 对这三类不再生效。
  三项**必须同时提供**，整组缺项、出现未知类型或显式传入 `null` 都按 422
  拒绝（错误指向 `gap_limits`）；省略 `gap_limits` 时三类空档统一使用
  `max_silence_ms`，响应字段与裁决结果与旧版本一致。
- 时间轴校验：字幕按开始时间**严格升序**、结束晚于开始、**互不重叠**（允许端点相接）、
  完全位于节目区间 `[开始, 结束]` 内。
- **仅含文件头而无字幕块一律拒绝**（即使只有 NOTE/STYLE/REGION 块）。
- 参数、解析或时间轴错误都会**拒绝整份输入**：HTTP 422 且只返回错误对象，
  不会产生部分结果；前端在每次新提交时清空旧结果与旧错误。
  - 可归属到字幕源内容的**首个**错误带原始 **1-based 行号**（含 cue identifier 偏移）。
  - 参数错误指出责任字段（`field`）。

## 覆盖分布规则

- 节目区间 `[开始, 结束]` 按**正整数分桶时长**（毫秒）顺序切桶；
  **末桶不足完整时长时按实际区间长度计算覆盖率**。
- 每条字幕按**区间交集**计入各桶：跨桶字幕被拆分到对应桶，不会重复计数。
- 每桶覆盖率 = 覆盖毫秒数 ÷ 桶实际时长 × 100%；**严格低于**请求的低覆盖阈值
  （0–100，可为小数）才标记低覆盖，**等于阈值不标记**。
- 分桶数量**超过 1000** 即拒绝（错误指向 `bucket_ms`）；
  分桶时长不大于零、阈值超出 0–100 同样以 422 拒绝并指向责任字段。
- 解析与时间轴校验、行号错误与空档审校完全一致；覆盖分布使用独立的
  领域对象（`app/coverage.py`）、请求/响应模型与前端结果状态。

## 技术栈

| 层 | 技术 |
| --- | --- |
| API | Python 3.12 · FastAPI · Pydantic v2 · webvtt-py |
| Web | React 18 · TypeScript · Vite 6 |
| 测试 | pytest（裁决边界）· Vitest + Testing Library（页面状态）· Playwright（真实浏览器联调） |
| 部署 | Docker Compose（web/nginx + api/uvicorn），一次性 `verify` 验收服务 |

## 目录

```
api/                FastAPI 服务
  app/main.py         路由（/api/review、/api/coverage）与统一 422 错误处理
  app/parser.py       webvtt-py 解析 + 行号定位 + 毫秒归一化
  app/timeline.py     时间轴校验与空档裁决
  app/coverage.py     覆盖分布：分桶、跨桶拆分、低覆盖标记
  app/schemas.py      Pydantic 模型（审校与覆盖分布各自独立）
  tests/              pytest（89 用例）
web/                React + TS + Vite
  src/                 页签、审校/覆盖两个页面、API 客户端、结果面板
  tests/e2e/           Playwright 真实联调（19 用例）
verify/             一次性验收服务（pytest + Playwright 驱动真实 web/api 容器）
docker-compose.yml
```

## API

`POST /api/review`

```json
{
  "content": "WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n你好\n",
  "program_start_ms": 0,
  "program_end_ms": 9000,
  "max_silence_ms": 1500
}
```

可选地按空档类型分别设置上限（`head` / `between` / `tail` 三项须同时给出，
均为非负整数毫秒）：

```json
{
  "content": "WEBVTT\n\n…\n",
  "program_start_ms": 0,
  "program_end_ms": 9000,
  "max_silence_ms": 1500,
  "gap_limits": {"head": 2000, "between": 500, "tail": 3000}
}
```

成功 `200`（每段空档都带本次采用的 `limit_ms`；省略 `gap_limits` 时等于
`max_silence_ms`）：

```json
{
  "passed": true,
  "max_gap_ms": 1000,
  "cue_count": 3,
  "gaps": [
    {"type": "head", "start_ms": 0, "end_ms": 1000, "duration_ms": 1000,
     "limit_ms": 1500, "line": 3, "to_line": null}
  ],
  "violations": []
}
```

`max_gap_ms` 始终按**原始空档时长**计算，与分类上限无关；违规判定为
`duration_ms` **严格大于**该段的 `limit_ms`。

失败 `422`（整份拒绝，无任何审校字段）：

```json
{"error": {"code": "parse_error", "message": "第 6 行的时间戳无效：…", "field": null, "line": 6}}
{"error": {"code": "invalid_program_range", "message": "…", "field": "program_end_ms", "line": null}}
{"error": {"code": "invalid_params", "message": "缺少分类上限字段：tail。", "field": "gap_limits", "line": null}}
{"error": {"code": "invalid_params", "message": "片头分类上限必须是非负整数毫秒值。", "field": "gap_limits.head", "line": null}}
```

错误码：`invalid_params`、`invalid_program_range`、`invalid_header`、`empty_document`、
`parse_error`、`unrecognized_block`、`cue_invalid_range`、`cue_out_of_range`、
`cues_not_sorted`、`cues_overlap`。

`POST /api/coverage`

```json
{
  "content": "WEBVTT\n\n00:00:00.500 --> 00:00:01.500\n跨桶字幕\n",
  "program_start_ms": 0,
  "program_end_ms": 2500,
  "bucket_ms": 1000,
  "threshold_pct": 50
}
```

成功 `200`（桶按时间顺序；末桶 `[2000, 2500)` 只有 500 ms，按实际区间计算）：

```json
{
  "buckets": [
    {"index": 0, "start_ms": 0, "end_ms": 1000, "duration_ms": 1000,
     "covered_ms": 500, "coverage_pct": 50.0, "low_coverage": false},
    {"index": 1, "start_ms": 1000, "end_ms": 2000, "duration_ms": 1000,
     "covered_ms": 500, "coverage_pct": 50.0, "low_coverage": false},
    {"index": 2, "start_ms": 2000, "end_ms": 2500, "duration_ms": 500,
     "covered_ms": 250, "coverage_pct": 50.0, "low_coverage": false}
  ],
  "bucket_count": 3,
  "cue_count": 1,
  "bucket_ms": 1000,
  "threshold_pct": 50.0,
  "min_coverage_pct": 50.0,
  "low_coverage_count": 0
}
```

失败 `422`（与空档审校相同的错误结构，整份拒绝）：

```json
{"error": {"code": "invalid_params", "message": "分桶时长必须是正整数（毫秒）。", "field": "bucket_ms", "line": null}}
{"error": {"code": "invalid_params", "message": "低覆盖阈值必须介于 0 到 100 之间。", "field": "threshold_pct", "line": null}}
{"error": {"code": "invalid_params", "message": "分桶时长 1000 ms 将生成 2000 个桶，超过上限 1000 个；…", "field": "bucket_ms", "line": null}}
{"error": {"code": "parse_error", "message": "第 6 行的时间戳无效：…", "field": null, "line": 6}}
```

## 本地开发（真实联调）

```bash
# API（Python 3.12）
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r api/requirements.txt
cd api && uvicorn app.main:app --reload --port 8000

# Web（Vite 开发服务器会把 /api 代理到 http://localhost:8000，
# 可用 API_ORIGIN 覆盖）
cd web && npm install && npm run dev
```

打开 http://localhost:5173 。

### 测试

```bash
# 后端裁决边界（89）
cd api && python -m pytest

# 前端页面状态（35，jsdom + mock fetch）
cd web && npm test

# 真实浏览器端到端（19，需要一个正在运行的 API 于 :8000）
cd web && npx playwright install chromium
npx playwright test          # 自动启动 Vite，/api 代理到真实 uvicorn
WEB_URL=http://host:port npx playwright test   # 指向已运行的前端（如 nginx 生产镜像）
```

## Docker Compose

默认只运行 **web** 与 **api** 两个服务：

```bash
docker compose up --build
# web:  http://localhost:${WEB_PORT:-8080}
# api:  http://localhost:${API_PORT:-8000}
WEB_PORT=9000 API_PORT=9001 docker compose up --build
```

浏览器访问 web（nginx 同源反代 `/api → api:8000`），不暴露跨域细节。

### 一次性验收 `verify`

`verify` 属于独立 profile，不会随普通 `up` 启动；它对**运行中的 web/api 容器**
执行真实 pytest 与真实浏览器 Playwright 联调，结束后退出并带上退出码：

```bash
docker compose --profile verify up --build \
  --abort-on-container-exit --exit-code-from verify
# 或分两步
docker compose up --build -d
docker compose --profile verify run --rm verify
```

验收脚本 `verify/accept.sh`：等待两个健康检查通过 → 验证 `Web → /api → API`
真实代理链路 → pytest 全量 → Playwright 全量；全部成功输出
`ALL ACCEPTANCE CHECKS PASSED` 并以 0 退出。

> 健康检查语义：**web 健康只表示 nginx 已在提供页面**（容器内用 busybox
> `wget` 显式探测 `http://127.0.0.1/`，不使用可能解析到 IPv6 `::1` 的
> `localhost`，也不反代依赖 API）；**api 健康只表示 uvicorn 已就绪**。
> Web→API 的代理联调是 `verify` 服务自己的职责，因此不会因网络/代理抖动把
> “网页已启动”误判为不健康而阻塞验收。
