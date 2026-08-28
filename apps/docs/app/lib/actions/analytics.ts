"use server";

import { runPeriodicMaintenance } from "db/maintenance";
import { catchUpRollups, rollupDay } from "db/rollup";
import { z } from "zod";
import { eachUtcDay, toDateKey, utcYesterday } from "@repo/shared/dates";
import { logger } from "@repo/shared/logger";
import { getSession } from "@/lib/session";

const MAX_RANGE_DAYS = 14;
const BUDGET_MS = 8_000;

export interface ResummarizeDay {
  date: string;
  ok: boolean;
  rows: number;
  error?: string;
}

export interface ResummarizeResult {
  ok: boolean;
  results: ResummarizeDay[];
  remaining: number;
  error?: string;
}

export interface CatchUpResult {
  ok: boolean;
  processed: string[];
  remaining: number;
  error?: string;
}

export interface MaintenanceResult {
  ok: boolean;
  error?: string;
}

const DAY = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must be written YYYY-MM-DD.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), "That is not a real date.")
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const RangeInput = z
  .object({ from: DAY, to: DAY })
  .refine(({ from, to }) => from <= to, { message: "The range ends before it starts." });

export async function resummarize(input: { from: string; to: string }): Promise<ResummarizeResult> {
  const session = await getSession();
  if (!session) return { ok: false, results: [], remaining: 0, error: "Not signed in." };

  const parsed = RangeInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      results: [],
      remaining: 0,
      error: parsed.error.issues[0]?.message ?? "That range cannot be summarised.",
    };
  }

  const yesterday = utcYesterday();
  const { from } = parsed.data;
  const to = parsed.data.to > yesterday ? yesterday : parsed.data.to;
  if (from > to) {
    return {
      ok: false,
      results: [],
      remaining: 0,
      error: "Only days up to yesterday can be summarised.",
    };
  }

  const days = eachUtcDay(from, to);
  const began = Date.now();

  const results: ResummarizeDay[] = [];
  for (const day of days.slice(0, MAX_RANGE_DAYS)) {
    if (results.length > 0 && Date.now() - began >= BUDGET_MS) break;
    const result = await rollupDay(day, "manual");
    results.push({
      date: toDateKey(day),
      ok: result.ok,
      rows: result.rows,
      ...(result.error ? { error: result.error } : {}),
    });
  }

  return { ok: results.every((r) => r.ok), results, remaining: days.length - results.length };
}

export async function runCatchUp(): Promise<CatchUpResult> {
  const session = await getSession();
  if (!session) return { ok: false, processed: [], remaining: 0, error: "Not signed in." };

  try {
    const { processed, remaining } = await catchUpRollups();
    return { ok: true, processed, remaining };
  } catch (e) {
    const error = e instanceof Error ? e.message : "unknown error";
    logger.error("analytics", "catch-up failed", { error });
    return { ok: false, processed: [], remaining: 0, error };
  }
}

export async function runMaintenanceNow(): Promise<MaintenanceResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  try {
    await runPeriodicMaintenance();
    return { ok: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : "unknown error";
    logger.error("analytics", "maintenance failed", { error });
    return { ok: false, error };
  }
}
