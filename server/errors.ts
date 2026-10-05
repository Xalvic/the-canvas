import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    });
    return;
  }

  // express.json() can fail before a route runs. Normalize its errors too.
  const parserType = typeof error === "object" && error !== null && "type" in error
    ? error.type
    : null;
  if (parserType === "entity.parse.failed") {
    res.status(400).json({
      error: { code: "INVALID_JSON", message: "Request body must be valid JSON" },
    });
    return;
  }
  if (parserType === "entity.too.large") {
    const bytes = typeof error === "object" && error !== null && "limit" in error ? error.limit : null;
    const limit = bytes === 5 * 1024 * 1024 ? "5 MiB" : bytes === 1024 * 1024 ? "1 MB" : "16 KB";
    res.status(413).json({
      error: { code: "PAYLOAD_TOO_LARGE", message: `Request body exceeds the ${limit} limit` },
    });
    return;
  }
  if (parserType === "charset.unsupported" || parserType === "encoding.unsupported") {
    res.status(415).json({
      error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Unsupported request encoding" },
    });
    return;
  }

  console.error("Unhandled API error:", error);
  res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred" },
  });
};
