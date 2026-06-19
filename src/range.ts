import type { Context } from "hono";

export interface ParsedRange {
  start?: number;
  end?: number; // exclusive (refget convention)
  source: "query" | "range" | "none";
}

export function parseRangeRequest(c: Context): ParsedRange {
  const startParam = c.req.query("start");
  const endParam = c.req.query("end");

  if (startParam !== undefined || endParam !== undefined) {
    const start =
      startParam !== undefined ? parseInt(startParam, 10) : undefined;
    const end = endParam !== undefined ? parseInt(endParam, 10) : undefined;
    return { start, end, source: "query" };
  }

  const rangeHeader = c.req.header("Range");
  if (rangeHeader) {
    const match = rangeHeader.match(/^bytes=(\d+)-(\d*)$/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) + 1 : undefined;
      return { start, end, source: "range" };
    }
    // malformed range -> treat as no range
  }

  return { source: "none" };
}
