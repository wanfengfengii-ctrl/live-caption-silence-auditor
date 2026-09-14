"""Domain errors for the subtitle gap review service.

Any error rejects the whole submission: the API never returns a partial
review. Errors that can be attributed to the WebVTT source carry the
original 1-based ``line``; parameter errors carry the offending ``field``.
"""


class ReviewError(Exception):
    """A rejection of an entire review request."""

    def __init__(self, code: str, message: str, *, field: str | None = None,
                 line: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.field = field
        self.line = line


# Error codes (kept as constants so tests and the frontend can rely on them).
INVALID_PARAMS = "invalid_params"
INVALID_PROGRAM_RANGE = "invalid_program_range"
EMPTY_DOCUMENT = "empty_document"
INVALID_HEADER = "invalid_header"
PARSE_ERROR = "parse_error"
UNRECOGNIZED_BLOCK = "unrecognized_block"
CUE_INVALID_RANGE = "cue_invalid_range"
CUE_OUT_OF_RANGE = "cue_out_of_range"
CUES_NOT_SORTED = "cues_not_sorted"
CUES_OVERLAP = "cues_overlap"
