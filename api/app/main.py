"""FastAPI application: subtitle silence-gap review."""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .errors import INVALID_PARAMS, INVALID_PROGRAM_RANGE, ReviewError
from .parser import parse_webvtt
from .schemas import (
    ErrorBody,
    ErrorResponse,
    ReviewRequest,
    ReviewResponse,
)
from .timeline import review

app = FastAPI(title="直播字幕空档审校 API", version="1.0.0")

# The dev server (Vite) and the containerized web app live on different
# origins locally; in Docker the web container proxies /api same-origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


def _error_response(body: ErrorBody, status_code: int) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=ErrorResponse(error=body).model_dump(),
    )


@app.exception_handler(ReviewError)
async def review_error_handler(_request: Request, exc: ReviewError):
    return _error_response(
        ErrorBody(
            code=exc.code, message=exc.message, field=exc.field, line=exc.line
        ),
        status_code=422,
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    _request: Request, exc: RequestValidationError
):
    detail = exc.errors()[0] if exc.errors() else {}
    loc = tuple(part for part in (detail.get("loc") or ()) if part != "body")
    if loc and loc[0] == "gap_limits":
        # Member errors point at gap_limits.<head|between|tail>; errors of
        # the object itself stay the single field gap_limits.
        field = "gap_limits" if len(loc) == 1 else ".".join(
            str(part) for part in loc
        )
    else:
        field = str(loc[-1]) if loc else None
    message = _translate_validation(detail, field)
    return _error_response(
        ErrorBody(code=INVALID_PARAMS, message=message, field=field),
        status_code=422,
    )


def _translate_validation(detail: dict, field: str | None) -> str:
    error_type = detail.get("type", "")
    # gap_limits.<member> uses the member label for member-level errors.
    label_key = field.split(".", 1)[1] if field and "." in field else field
    label = {
        "content": "WebVTT 文本",
        "program_start_ms": "节目开始时间",
        "program_end_ms": "节目结束时间",
        "max_silence_ms": "允许静默上限",
        "gap_limits": "分类上限",
        "head": "片头分类上限",
        "between": "字幕间分类上限",
        "tail": "片尾分类上限",
    }.get(label_key or "", label_key or "参数")
    if error_type == "missing":
        return f"缺少必填字段：{label}。"
    if error_type in ("int_parsing", "int_type"):
        return f"{label}必须是整数毫秒值。"
    if error_type == "greater_than_equal":
        return f"{label}必须是非负整数（毫秒）。"
    if error_type in ("model_type", "model_attributes_type"):
        return f"{label}必须是同时包含 head、between、tail 三项的对象。"
    if error_type == "value_error":
        msg = detail.get("msg", "校验失败").removeprefix("Value error, ")
        # Object-level (cross-field) messages are already complete.
        if field == "gap_limits":
            return msg
        if "非负整数" in msg:
            return f"{label}必须是非负整数毫秒值。"
        return f"{label}参数无效：{msg}。"
    return f"{label}参数无效：{detail.get('msg', '校验失败')}。"


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/api/review", response_model=ReviewResponse)
async def review_subtitles(request: ReviewRequest) -> ReviewResponse:
    # Parameters are validated first (Pydantic + start < end), then the
    # source is parsed; any failure rejects the whole submission.
    if request.program_start_ms >= request.program_end_ms:
        raise ReviewError(
            INVALID_PROGRAM_RANGE,
            f"节目开始时间（{request.program_start_ms} ms）必须小于"
            f"节目结束时间（{request.program_end_ms} ms）。",
            field="program_end_ms",
        )

    cues = parse_webvtt(request.content)
    result = review(
        cues,
        request.program_start_ms,
        request.program_end_ms,
        request.max_silence_ms,
        request.gap_limits.as_mapping() if request.gap_limits else None,
    )
    return ReviewResponse.from_review(result, cue_count=len(cues))
