import type { IncomingMessage, ServerResponse } from "http";
import { getDb } from "../lib/db.js";
import { getCalendarMonth } from "../lib/calendarDb.js";

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const url = new URL(req.url ?? "/", "http://localhost");
  const month = url.searchParams.get("month");
  const region = (url.searchParams.get("region") ?? process.env.REGION ?? "IN").toUpperCase();

  if (!month || !MONTH_PATTERN.test(month)) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "month is required, format YYYY-MM" }));
    return;
  }

  if (!/^[A-Z]{2}$/.test(region)) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "region must be a two-letter country code" }));
    return;
  }

  try {
    const entries = await getCalendarMonth(getDb(), month, region);
    res.statusCode = 200;
    res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
    res.end(JSON.stringify({ month, region, entries }));
  } catch (err) {
    console.error("[calendar] lookup failed", err);
    res.statusCode = 500;
    res.setHeader("Cache-Control", "no-store");
    // Generic message to the client — the real error (which can include raw
    // Postgres driver detail) is logged server-side, never shipped to the browser.
    res.end(JSON.stringify({ error: "could not load calendar" }));
  }
}
