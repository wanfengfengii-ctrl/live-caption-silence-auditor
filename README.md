# 直播字幕空档审校（WebVTT Gap Review）

节目上线前发现**片头、字幕之间、片尾**过长无字幕空档的 Web + API 系统。
页面粘贴 WebVTT 与节目时间参数，后端使用维护中的
[`webvtt-py`](https://pypi.org/project/webvtt-py/) 解析库完成真正的格式解析，
统一为毫秒区间后做时间轴校验与空档裁决，并返回结构化结果。

## 裁决规则

- 空档 = 节目开始 → 第一条字幕（片头）、相邻字幕间（上一条结束 → 下一条开始）、
  最后一条字幕结束 → 节目结束（片尾）。
- 首尾相接的空档为 **0 ms**；空档时长 **等于**允许上限判为合格；
  **超过上限 1 ms** 即违规。
- 时间轴校验：字幕按开始时间**严格升序**、结束晚于开始、**互不重叠**（允许端点相接）、
  完全位于节目区间 `[开始, 结束]` 内。
- **仅含文件头而无字幕块一律拒绝**（即使只有 NOTE/STYLE/REGION 块）。
- 参数、解析或时间轴错误都会**拒绝整份输入**：HTTP 422 且只返回错误对象，
  不会产生部分结果；前端在每次新提交时清空旧结果与旧错误。
  - 可归属到字幕源内容的**首个**错误带原始 **1-based 行号**（含 cue identifier 偏移）。
  - 参数错误指出责任字段（`field`）。

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
  app/main.py         路由与统一 422 错误处理
  app/parser.py       webvtt-py 解析 + 行号定位 + 毫秒归一化
  app/timeline.py     时间轴校验与空档裁决
  app/schemas.py      Pydantic 模型
  tests/              pytest（35 用例）
web/                React + TS + Vite
  src/                 页面、API 客户端、结果面板
  tests/e2e/           Playwright 真实联调（6 用例）
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

成功 `200`：

```json
{
  "passed": true,
  "max_gap_ms": 1000,
  "cue_count": 3,
  "gaps": [
    {"type": "head", "start_ms": 0, "end_ms": 1000, "duration_ms": 1000, "line": 3, "to_line": null}
  ],
  "violations": []
}
```

失败 `422`（整份拒绝，无任何审校字段）：

```json
{"error": {"code": "parse_error", "message": "第 6 行的时间戳无效：…", "field": null, "line": 6}}
{"error": {"code": "invalid_program_range", "message": "…", "field": "program_end_ms", "line": null}}
```

错误码：`invalid_params`、`invalid_program_range`、`invalid_header`、`empty_document`、
`parse_error`、`unrecognized_block`、`cue_invalid_range`、`cue_out_of_range`、
`cues_not_sorted`、`cues_overlap`。

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
# 后端裁决边界（35）
cd api && python -m pytest

# 前端页面状态（9，jsdom + mock fetch）
cd web && npm test

# 真实浏览器端到端（6，需要一个正在运行的 API 于 :8000）
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
