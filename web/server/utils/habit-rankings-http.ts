import { createError, getCookie, getHeader, getRequestURL, setHeader, type H3Event } from "h3";
import { readBoundedJsonBody } from "./bounded-body";
import { COURSE_ACCOUNT_COOKIE, CourseAccountSessions } from "./course-linked-session";
import { consumePublicRateLimit } from "./public-abuse";
import { RANKED_SUBJECTS, type RankedSubject } from "./habit-rankings-items";
import { HabitRankings, RANK_DIVISIONS, RankRequestError, type RankCommand, type RankScope } from "./habit-rankings";
import { getHabitRankingsStore } from "./habit-rankings-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DID = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]{1,240}$/;

function isRankedSubject(subject: unknown): subject is RankedSubject {
  return typeof subject === "string" && Object.hasOwn(RANKED_SUBJECTS, subject);
}

export function parseRankCommand(value: unknown): RankCommand {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const body = value as Record<string, unknown>;
    const size = Object.keys(body).length;
    if (size === 1 && (body.type === "withdraw" || body.type === "accept-demotion")) return { type: body.type };
    if (size === 2 && body.type === "enroll" && body.adultAttested === true) return { type: "enroll", adultAttested: true };
    if (size === 2 && body.type === "start" && isRankedSubject(body.subject)) return { type: "start", subject: body.subject };
    if (size === 3 && body.type === "answer" && typeof body.attemptId === "string" && UUID.test(body.attemptId) &&
        typeof body.choice === "number" && Number.isInteger(body.choice) && body.choice >= 0 && body.choice < 3) {
      return { type: "answer", attemptId: body.attemptId, choice: body.choice };
    }
  }
  throw createError({ statusCode: 400, statusMessage: "Invalid rankings request." });
}

export function parseRankScope(query: URLSearchParams): RankScope {
  const subject = query.get("subject");
  const division = query.get("division") ?? "0";
  const cohort = query.get("cohort") ?? "1";
  if (query.has("subject")) {
    if (isRankedSubject(subject) && !query.has("division") && !query.has("cohort")) return { subject };
  } else if (/^\d$/.test(division) && Number(division) < RANK_DIVISIONS.length && /^[1-9]\d{0,5}$/.test(cohort)) {
    return { division: Number(division), cohort: Number(cohort) };
  }
  throw createError({ statusCode: 400, statusMessage: "Choose a valid rankings board." });
}

async function accountDid(event: H3Event): Promise<string> {
  const token = getCookie(event, COURSE_ACCOUNT_COOKIE);
  if (token) {
    const account = await new CourseAccountSessions().read(token);
    if (DID.test(account.accountId)) return account.accountId;
  }
  throw createError({ statusCode: 401, statusMessage: "Sign in to use public rankings." });
}

function noCache(event: H3Event): void {
  setHeader(event, "Cache-Control", "no-store");
}

async function withRankings<T>(run: (rankings: HabitRankings) => Promise<T>): Promise<T> {
  try {
    return await run(new HabitRankings(getHabitRankingsStore()));
  } catch (error) {
    if (error instanceof RankRequestError) throw createError({ statusCode: error.statusCode, statusMessage: error.message });
    throw createError({ statusCode: 503, statusMessage: "Rankings are temporarily unavailable." });
  }
}

export async function readPublicHabitRankings(event: H3Event) {
  noCache(event);
  const scope = parseRankScope(getRequestURL(event).searchParams);
  await consumePublicRateLimit(event, { bucket: "rankings-board", limit: 60, windowSeconds: 60 });
  return withRankings(rankings => rankings.board(scope));
}

export async function readPrivateHabitRankings(event: H3Event) {
  noCache(event);
  await consumePublicRateLimit(event, { bucket: "rankings-account-read", limit: 60, windowSeconds: 60 });
  const did = await accountDid(event);
  return withRankings(rankings => rankings.account(did));
}

export async function changeHabitRankings(event: H3Event) {
  noCache(event);
  const origin = getRequestURL(event, { xForwardedProto: true, xForwardedHost: false }).origin;
  if (getHeader(event, "origin") !== origin) {
    throw createError({ statusCode: 403, statusMessage: "Rankings changes require a same-origin request." });
  }
  if (getHeader(event, "content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw createError({ statusCode: 415, statusMessage: "Send rankings changes as JSON." });
  }
  await consumePublicRateLimit(event, { bucket: "rankings-account-write-ip", limit: 60, windowSeconds: 60 });
  const did = await accountDid(event);
  await consumePublicRateLimit(event, { bucket: "rankings-account-write-did", key: did, limit: 24, windowSeconds: 60 });
  const command = parseRankCommand(await readBoundedJsonBody(event.req, 1024));
  return withRankings(rankings => rankings.account(did, command));
}
