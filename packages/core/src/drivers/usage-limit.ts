/*
 * Parsing usage-limit reset times from CLI error text (Claude Code, Codex) and
 * recognising explicit Claude subscription usage-limit sentences when the CLI
 * emits them outside a coded `rate_limit` assistant frame.
 */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const UNIT_MS: Record<string, number> = {
  d: 86_400_000, day: 86_400_000, days: 86_400_000,
  h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000,
  m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
  s: 1_000, sec: 1_000, secs: 1_000, second: 1_000, seconds: 1_000,
};

const MAX_RELATIVE_MS = 31 * 86_400_000;

interface WallDate {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(ms: number, timeZone: string): WallDate {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts['year'] ?? 1970,
    month: parts['month'] ?? 1,
    day: parts['day'] ?? 1,
    hour: parts['hour'] === 24 ? 0 : (parts['hour'] ?? 0),
    minute: parts['minute'] ?? 0,
    second: parts['second'] ?? 0,
  };
}

function todayIn(now: number, timeZone?: string): { year: number; month: number; day: number } {
  if (timeZone !== undefined) {
    const parts = zonedParts(now, timeZone);
    return { year: parts.year, month: parts.month, day: parts.day };
  }
  const date = new Date(now);
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

function nextCalendarDay(year: number, month: number, day: number): { year: number; month: number; day: number } {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() + 1 === month && check.getUTCDate() === day;
}

function validTimeZone(zone: string | undefined): string | null {
  if (zone === undefined) return null;
  const trimmed = zone.trim();
  if (trimmed.length === 0) return null;
  const normalized = trimmed.toUpperCase() === 'Z' ? 'UTC' : trimmed;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized });
    return normalized;
  } catch {
    return null;
  }
}

function wallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone?: string,
): number | null {
  if (!isValidCalendarDate(year, month, day)) return null;
  if (timeZone === undefined) {
    const date = new Date(year, month - 1, day, hour, minute, second, 0);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }
  try {
    const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    let guess = targetAsUtc;
    for (let step = 0; step < 3; step += 1) {
      const shown = zonedParts(guess, timeZone);
      const shownAsUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second);
      const diff = targetAsUtc - shownAsUtc;
      if (diff === 0) break;
      guess += diff;
    }
    return Number.isFinite(guess) ? guess : null;
  } catch {
    return null;
  }
}

interface ParsedClock {
  hour: number;
  minute: number;
  second: number;
}

function parseClock(hourText: string, minuteText: string | undefined, secondText: string | undefined, meridiem: string | undefined): ParsedClock | null {
  const rawHour = Number(hourText);
  const minute = minuteText === undefined ? 0 : Number(minuteText);
  const second = secondText === undefined ? 0 : Number(secondText);
  if (!Number.isInteger(rawHour) || !Number.isInteger(minute) || !Number.isInteger(second)) return null;
  if (minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  if (meridiem !== undefined) {
    if (rawHour < 1 || rawHour > 12) return null;
    const lower = meridiem.toLowerCase();
    const hour = lower === 'am' ? (rawHour === 12 ? 0 : rawHour) : (rawHour === 12 ? 12 : rawHour + 12);
    return { hour, minute, second };
  }
  if (minuteText === undefined || rawHour < 0 || rawHour > 23) return null;
  return { hour: rawHour, minute, second };
}

function parseRelativeDuration(text: string, now: number): number | null {
  const lead = /\b(?:try\s+again|retry|resets?|available|back|wait)\s+in\s+([^.\n;]+)/i.exec(text)
    ?? /\bin\s+(\d+\s*(?:days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b[^.\n;]*)/i.exec(text);
  if (lead === null) return null;
  const tail = lead[1]!;
  let total = 0;
  let matched = false;
  const token = /(\d+)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi;
  let cursor = 0;
  for (;;) {
    const hit = token.exec(tail);
    if (hit === null) break;
    // Stop once text between tokens is no longer a simple separator (comma / "and" / space).
    const between = tail.slice(cursor, hit.index);
    if (cursor > 0 && !/^(?:\s*,\s*|\s+and\s+|\s+)$/i.test(between)) break;
    if (cursor === 0 && between.trim().length > 0) break;
    const amount = Number(hit[1]);
    const unit = UNIT_MS[hit[2]!.toLowerCase()];
    if (!Number.isFinite(amount) || unit === undefined) break;
    total += amount * unit;
    matched = true;
    cursor = hit.index + hit[0].length;
  }
  if (!matched || total <= 0 || total > MAX_RELATIVE_MS) return null;
  return now + total;
}

const MONTH_PATTERN = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

/**
 * Extracts a reset timestamp in epoch milliseconds from a CLI usage-limit
 * message. Handles:
 * - Claude pipe epoch (`Claude AI usage limit reached|1763838000`)
 * - ISO 8601 timestamps (`resets 2026-11-23T17:00:00Z`)
 * - Relative durations (`Try again in 2 hours 15 minutes.`)
 * - Date + clock or clock-only times (`resets 5pm (Europe/Paris)`,
 *   `resets Nov 23, 5:30pm (Europe/Paris)`, `Try again at Nov 23rd, 2026 3:45 PM.`,
 *   `resets 5pm` in local time)
 */
export function parseUsageLimitReset(text: string | null | undefined, now = Date.now(), defaultTimeZone?: string): number | null {
  if (!text) return null;

  // 1) Legacy Claude CLI pipe-separated epoch (`Claude AI usage limit reached|1763838000`).
  const pipe = /\|(\d{10,13})\b/.exec(text);
  if (pipe !== null) {
    const raw = Number(pipe[1]);
    if (Number.isFinite(raw) && raw > 0) return raw < 1e12 ? raw * 1000 : raw;
  }

  // 2) ISO 8601 timestamp with explicit offset or Z.
  const iso = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2}))\b/i.exec(text);
  if (iso !== null) {
    const parsed = Date.parse(iso[1]!);
    if (Number.isFinite(parsed)) return parsed;
  }

  // 3) Relative duration (`Try again in 2 hours 15 minutes.`, `resets in 45m`).
  const relative = parseRelativeDuration(text, now);
  if (relative !== null) return relative;

  // 4) Calendar date + clock time or clock-only time after a reset/retry cue.
  const cue = /\b(?:resets?(?:\s+at)?|try\s+again(?:\s+at)?|retry(?:\s+at)?|available(?:\s+at)?|until)\s+([^\n]+)/i.exec(text);
  if (cue === null) return null;
  const fragment = cue[1]!.trim();

  // Optional timezone either in parentheses `(Europe/Paris)` / `(UTC)` or trailing `UTC` / `GMT`.
  const parenTz = /\(([A-Za-z_][A-Za-z0-9_/+.-]{1,63})\)/.exec(fragment);
  let explicitTz: string | null = null;
  if (parenTz !== null) {
    explicitTz = validTimeZone(parenTz[1]);
    if (explicitTz === null) return null;
  }
  const clean = (parenTz !== null ? fragment.slice(0, parenTz.index) : fragment).trim().replace(/[.)]+$/, '').trim();
  let trailingTz: string | null = null;
  const withoutTrailingTz = clean.replace(/\s+(UTC|GMT|Z)$/i, (_full, tz: string) => {
    trailingTz = validTimeZone(tz);
    return '';
  }).trim();

  const resolvedDefault = defaultTimeZone === undefined ? undefined : (validTimeZone(defaultTimeZone) ?? undefined);
  const timeZone = explicitTz ?? trailingTz ?? resolvedDefault;

  // 4a) Month Day[, Year][, | at ]Clock  (e.g. "Nov 23, 2026, 5:30pm", "Nov 23rd, 2026 3:45 PM", "Nov 23, 5pm", "Nov 23 at 17:00")
  const mdy = new RegExp(
    `^(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:(?:\\s*,?\\s*)(\\d{4}))?(?:\\s*,\\s*|\\s+at\\s+|\\s+)(\\d{1,2})(?::(\\d{2})(?::(\\d{2}))?)?\\s*(am|pm)?\\b`,
    'i',
  ).exec(withoutTrailingTz);
  if (mdy !== null) {
    const month = MONTHS[mdy[1]!.toLowerCase()];
    const day = Number(mdy[2]);
    const explicitYear = mdy[3] !== undefined ? Number(mdy[3]) : null;
    const clock = parseClock(mdy[4]!, mdy[5], mdy[6], mdy[7]);
    if (month !== undefined && clock !== null) {
      const baseYear = explicitYear ?? todayIn(now, timeZone).year;
      let at = wallClockToUtc(baseYear, month, day, clock.hour, clock.minute, clock.second, timeZone);
      if (at !== null && explicitYear === null && at < now - 86_400_000) {
        at = wallClockToUtc(baseYear + 1, month, day, clock.hour, clock.minute, clock.second, timeZone);
      }
      if (at !== null) return at;
    }
  }

  // 4b) Day Month [Year][, | at ]Clock  (e.g. "23 Nov 2026 15:45", "23 Nov, 5pm")
  const dmy = new RegExp(
    `^(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})\\.?(?:\\s*,?\\s*(\\d{4}))?(?:\\s*,\\s*|\\s+at\\s+|\\s+)(\\d{1,2})(?::(\\d{2})(?::(\\d{2}))?)?\\s*(am|pm)?\\b`,
    'i',
  ).exec(withoutTrailingTz);
  if (dmy !== null) {
    const day = Number(dmy[1]);
    const month = MONTHS[dmy[2]!.toLowerCase()];
    const explicitYear = dmy[3] !== undefined ? Number(dmy[3]) : null;
    const clock = parseClock(dmy[4]!, dmy[5], dmy[6], dmy[7]);
    if (month !== undefined && clock !== null) {
      const baseYear = explicitYear ?? todayIn(now, timeZone).year;
      let at = wallClockToUtc(baseYear, month, day, clock.hour, clock.minute, clock.second, timeZone);
      if (at !== null && explicitYear === null && at < now - 86_400_000) {
        at = wallClockToUtc(baseYear + 1, month, day, clock.hour, clock.minute, clock.second, timeZone);
      }
      if (at !== null) return at;
    }
  }

  // 4c) YYYY-MM-DD Clock  (e.g. "2026-11-23 17:00")
  const ymd = /^(\d{4})-(\d{2})-(\d{2})(?:\s+|T)(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(withoutTrailingTz);
  if (ymd !== null) {
    const clock = parseClock(ymd[4]!, ymd[5], ymd[6], ymd[7]);
    if (clock !== null) {
      const at = wallClockToUtc(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]), clock.hour, clock.minute, clock.second, timeZone);
      if (at !== null) return at;
    }
  }

  // 4d) Clock-only time without a date (e.g. "5pm", "5:30pm", "3:45 PM", "17:00").
  const clockOnly = /^(\d{1,2})(?::(\d{2})(?::(\d{2}))?)?\s*(am|pm)?\b/i.exec(withoutTrailingTz);
  if (clockOnly !== null) {
    const clock = parseClock(clockOnly[1]!, clockOnly[2], clockOnly[3], clockOnly[4]);
    if (clock !== null) {
      const today = todayIn(now, timeZone);
      let at = wallClockToUtc(today.year, today.month, today.day, clock.hour, clock.minute, clock.second, timeZone);
      if (at !== null && at <= now) {
        const tomorrow = nextCalendarDay(today.year, today.month, today.day);
        at = wallClockToUtc(tomorrow.year, tomorrow.month, tomorrow.day, clock.hour, clock.minute, clock.second, timeZone);
      }
      if (at !== null) return at;
    }
  }

  return null;
}

/**
 * True when a Claude CLI error sentence names a spent subscription usage limit,
 * even if the SDK surfaced it as an uncoded `result` error or `error: "unknown"`.
 */
export function isClaudeUsageLimitText(text: string | null | undefined): boolean {
  if (!text) return false;
  return /\bClaude\s+AI\s+usage\s+limit\s+reached\b/i.test(text)
    || /\bYou(?:'ve|\u2019ve|\s+have)\s+hit\s+your\b[^.\n]{0,40}\blimit\b/i.test(text)
    || /\b(?:5[\s-]?hour|five[\s-]?hour|weekly|session|subscription)\s+(?:usage\s+)?limit\s+(?:reached|exceeded)\b/i.test(text)
    || /\busage\s+limit\s+(?:reached|exceeded)\b/i.test(text);
}

/**
 * True when a subscription gateway (Douane) error reports an exhausted pool or
 * client share cap:
 * - `state.rs`: HTTP 503 or WebSocket `proxy_error` `"no available subscription for this model..."`
 * - `relay.rs`: HTTP 429 `"all accounts for this provider are unavailable..."`
 *   (only on 429, never on a 5xx upstream outage or 401/403 auth refusal)
 * - client share cap: `"this client's share is used up until ..."`
 */
export function isGatewayUsageLimitText(text: string | null | undefined, httpStatus: number | null = null): boolean {
  if (!text) return false;
  if (/\bno available subscription for this model\b/i.test(text)) return true;
  if (/\bclient(?:'s|\u2019s)\s+share\s+is\s+used\s+up\b/i.test(text)) return true;
  if (/\ball accounts for this provider are unavailable\b/i.test(text)) {
    return httpStatus === 429 || /\b429\b|\btoo many requests\b/i.test(text);
  }
  return false;
}

