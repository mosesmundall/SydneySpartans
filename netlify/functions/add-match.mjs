import crypto from "node:crypto";

/*
 * Netlify Function: secure Match-sheet writer.
 *
 * Secrets required in Netlify Environment Variables (Functions scope):
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_PRIVATE_KEY_B64
 *   MATCH_ENTRY_TOKEN
 *
 * This function intentionally discovers the Google Sheet tab by its numeric gid,
 * reads row 1 to locate columns by header name, validates submitted competitor IDs
 * against the Competitor sheet, checks for duplicate matches, then appends one row.
 */

const CLUB = {
  "name": "Sydney Spartans",
  "matches": {
    "id": "1DGCu6nW9TNH-id5Xfsc4TkerwvJ1vh09uZrKmUfNMlU",
    "gid": "573157689"
  },
  "competitors": {
    "id": "15DuCXPZXtIG97V5pCod2kLkW4iqkb3kOBwoo7znwDDU",
    "gid": "1561293575"
  },
  "dateMode": "AU_DMY",
  "allowedWeights": [
    "women",
    "woman",
    "u60kg",
    "youth",
    "u70kg",
    "u80kg",
    "u90kg",
    "u100kg",
    "100kg+"
  ]
};
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SYDNEY_TZ = "Australia/Sydney";
let cachedGoogleToken = null;
let cachedGoogleTokenExpiresAt = 0;

function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function trim(value) {
  return String(value ?? "").trim();
}

function normKey(value) {
  return trim(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function tokensMatch(received, expected) {
  const a = Buffer.from(String(received || ""));
  const b = Buffer.from(String(expected || ""));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireSecrets() {
  const email = trim(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
  const keyB64 = trim(process.env.GOOGLE_PRIVATE_KEY_B64);
  const entryToken = trim(process.env.MATCH_ENTRY_TOKEN);
  if (!email || !keyB64 || !entryToken) {
    throw new Error("Match-entry backend is missing one or more required Netlify environment variables.");
  }
  let privateKey;
  try {
    privateKey = Buffer.from(keyB64, "base64").toString("utf8");
  } catch {
    throw new Error("GOOGLE_PRIVATE_KEY_B64 could not be decoded.");
  }
  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new Error("GOOGLE_PRIVATE_KEY_B64 does not contain a valid service-account private key.");
  }
  return { email, privateKey, entryToken };
}

async function getGoogleAccessToken(email, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedGoogleToken && cachedGoogleTokenExpiresAt > now + 60) return cachedGoogleToken;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: email,
      scope: SHEETS_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = `${header}.${claims}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url");
  const assertion = `${unsigned}.${signature}`;

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !payload.access_token) {
    throw new Error(`Google authentication failed (${tokenResponse.status}). Check the service-account email/private key.`);
  }
  cachedGoogleToken = payload.access_token;
  cachedGoogleTokenExpiresAt = now + Number(payload.expires_in || 3600);
  return cachedGoogleToken;
}

async function googleJson(url, accessToken, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `Google Sheets request failed (${response.status}).`;
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  return data;
}

function quoteSheetTitle(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

async function resolveSheetTitle(spreadsheetId, gid, accessToken) {
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`);
  url.searchParams.set("fields", "sheets.properties(sheetId,title)");
  const data = await googleJson(url.toString(), accessToken);
  const target = (data.sheets || []).find((s) => String(s?.properties?.sheetId) === String(gid));
  if (!target?.properties?.title) {
    throw new Error(`Could not find sheet tab gid ${gid} inside spreadsheet ${spreadsheetId}.`);
  }
  return target.properties.title;
}

async function getValues(spreadsheetId, range, accessToken) {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`
  );
  url.searchParams.set("majorDimension", "ROWS");
  url.searchParams.set("valueRenderOption", "FORMATTED_VALUE");
  const data = await googleJson(url.toString(), accessToken);
  return data.values || [];
}

function headerIndex(headers, aliases) {
  const wanted = new Set(aliases.map(normKey));
  return headers.findIndex((h) => wanted.has(normKey(h)));
}

function columnLetter(indexZeroBased) {
  let n = indexZeroBased + 1;
  let out = "";
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

function validIsoDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trim(iso));
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function sydneyTodayIso() {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: SYDNEY_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function sheetDateFromIso(iso) {
  const [y, mo, d] = iso.split("-");
  if (CLUB.dateMode === "NUAC_MIGRATION" && iso < "2026-08-01") {
    return `${mo}/${d}/${y}`; // legacy NUAC history uses MM/DD/YYYY
  }
  return `${d}/${mo}/${y}`; // Sydney + new NUAC entries use DD/MM/YYYY
}

function candidateIso(y, mo, d) {
  const iso = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return validIsoDate(iso) ? iso : null;
}

function storedDateToIso(value) {
  const t = trim(value);
  if (!t) return null;
  if (validIsoDate(t)) return t;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (!m) return null;
  const a = +m[1], b = +m[2], y = +m[3];
  const dmy = candidateIso(y, b, a);
  const mdy = candidateIso(y, a, b);
  if (dmy && !mdy) return dmy;
  if (mdy && !dmy) return mdy;
  if (!dmy && !mdy) return null;
  if (dmy === mdy) return dmy;
  if (CLUB.dateMode !== "NUAC_MIGRATION") return dmy;
  const cutover = "2026-08-01";
  const dmyPost = dmy >= cutover;
  const mdyPost = mdy >= cutover;
  if (dmyPost !== mdyPost) return dmyPost ? dmy : mdy;
  return dmyPost ? dmy : mdy;
}

function normalizeArm(value) {
  const t = trim(value).toLowerCase();
  if (t === "right" || t === "r") return "RIGHT";
  if (t === "left" || t === "l") return "LEFT";
  return "";
}

function buildHeaderMap(headers, kind) {
  if (kind === "matches") {
    const out = {
      date: headerIndex(headers, ["DATE"]),
      winner: headerIndex(headers, ["Winner ID", "winner_id"]),
      loser: headerIndex(headers, ["Loser ID", "Looser ID", "loser_id", "looser_id"]),
      arm: headerIndex(headers, ["Arm?", "Arm"]),
      badge: headerIndex(headers, ["Badge?", "Badge"]),
      time: headerIndex(headers, ["Time", "Timestamp", "DateTime"]),
    };
    const missing = Object.entries(out)
      .filter(([key, index]) => ["date", "winner", "loser", "arm"].includes(key) && index < 0)
      .map(([key]) => key);
    if (missing.length) throw new Error(`Match sheet is missing required header(s): ${missing.join(", ")}.`);
    return out;
  }

  const out = {
    id: headerIndex(headers, ["ID", "Player ID", "Competitor ID"]),
    name: headerIndex(headers, ["Name", "Display Name"]),
    weight: headerIndex(headers, ["Weight Class", "weight_class"]),
    active: headerIndex(headers, ["Active", "Currently Active?", "Currently Active"]),
  };
  if (out.id < 0) throw new Error("Competitor sheet is missing an ID / Player ID / Competitor ID header.");
  if (out.name < 0) throw new Error("Competitor sheet is missing a Name header.");
  if (out.weight < 0) throw new Error("Competitor sheet is missing a Weight Class header.");
  return out;
}

function rowValue(row, index) {
  return index >= 0 ? trim(row[index]) : "";
}

function competitorRecords(rows, map) {
  return rows
    .map((row, index) => ({
      row: index + 2,
      id: rowValue(row, map.id),
      name: rowValue(row, map.name),
      weight: rowValue(row, map.weight),
      active: rowValue(row, map.active),
    }))
    .filter((r) => r.id || r.name || r.weight || r.active);
}

function validateSelectedCompetitor(id, records, label) {
  const matches = records.filter((r) => r.id === id);
  if (matches.length === 0) return `${label} ID '${id}' was not found in the Competitor sheet.`;
  if (matches.length > 1) return `${label} ID '${id}' appears more than once in the Competitor sheet. Fix the duplicate ID first.`;
  const person = matches[0];
  if (!person.name) return `${label} '${id}' has a blank competitor name. Fix Competitor sheet row ${person.row} first.`;
  if (!person.weight) return `${label} '${id}' has no weight class. Fix Competitor sheet row ${person.row} first.`;
  if (!CLUB.allowedWeights.includes(person.weight.toLowerCase())) {
    return `${label} '${id}' has invalid weight class '${person.weight}'. Fix Competitor sheet row ${person.row} first.`;
  }
  return "";
}

async function appendValues(spreadsheetId, range, values, accessToken) {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append`
  );
  // RAW is deliberate: dates stay exactly as the ranking parser expects instead of
  // being silently reinterpreted by the spreadsheet locale.
  url.searchParams.set("valueInputOption", "RAW");
  url.searchParams.set("insertDataOption", "INSERT_ROWS");
  url.searchParams.set("includeValuesInResponse", "true");
  return googleJson(url.toString(), accessToken, {
    method: "POST",
    body: JSON.stringify({ majorDimension: "ROWS", values: [values] }),
  });
}

function updatedRowNumber(updatedRange) {
  const m = /![A-Z]+(\d+):[A-Z]+(\d+)$/i.exec(String(updatedRange || ""));
  return m ? Number(m[1]) : null;
}

export default async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (!['GET', 'POST'].includes(request.method)) return reply(405, { ok: false, error: "Method not allowed." });

  try {
    const secrets = requireSecrets();
    const suppliedToken = trim(request.headers.get("x-match-entry-token"));
    if (!tokensMatch(suppliedToken, secrets.entryToken)) {
      return reply(401, { ok: false, error: "Invalid or expired match-entry link." });
    }

    const accessToken = await getGoogleAccessToken(secrets.email, secrets.privateKey);
    const [matchTitle, competitorTitle] = await Promise.all([
      resolveSheetTitle(CLUB.matches.id, CLUB.matches.gid, accessToken),
      resolveSheetTitle(CLUB.competitors.id, CLUB.competitors.gid, accessToken),
    ]);

    const [matchHeaderRows, competitorHeaderRows] = await Promise.all([
      getValues(CLUB.matches.id, `${quoteSheetTitle(matchTitle)}!1:1`, accessToken),
      getValues(CLUB.competitors.id, `${quoteSheetTitle(competitorTitle)}!1:1`, accessToken),
    ]);
    const matchHeaders = matchHeaderRows[0] || [];
    const competitorHeaders = competitorHeaderRows[0] || [];
    const matchMap = buildHeaderMap(matchHeaders, "matches");
    const competitorMap = buildHeaderMap(competitorHeaders, "competitors");

    const competitorLastCol = columnLetter(Math.max(competitorHeaders.length, 1) - 1);
    const competitorRows = await getValues(
      CLUB.competitors.id,
      `${quoteSheetTitle(competitorTitle)}!A2:${competitorLastCol}`,
      accessToken
    );
    const competitors = competitorRecords(competitorRows, competitorMap);

    if (request.method === "GET") {
      return reply(200, {
        ok: true,
        club: CLUB.name,
        matchSheet: matchTitle,
        competitorSheet: competitorTitle,
        competitorCount: competitors.filter((p) => p.id).length,
        timeColumnPresent: matchMap.time >= 0,
        headers: matchHeaders,
      });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return reply(400, { ok: false, error: "Invalid JSON request." });

    const winnerId = trim(body.winnerId);
    const loserId = trim(body.loserId);
    const arm = normalizeArm(body.arm);
    const dateIso = trim(body.dateIso);
    const time = trim(body.time);
    const allowDuplicate = body.allowDuplicate === true;

    if (!winnerId || !loserId) return reply(422, { ok: false, error: "Choose both a winner and a loser from the competitor suggestions." });
    if (winnerId === loserId) return reply(422, { ok: false, error: "Winner and loser cannot be the same competitor." });
    if (!arm) return reply(422, { ok: false, error: "Choose RIGHT or LEFT arm." });
    if (!validIsoDate(dateIso)) return reply(422, { ok: false, error: "Choose a valid match date." });
    if (dateIso > sydneyTodayIso()) return reply(422, { ok: false, error: "Future-dated matches cannot be submitted." });
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return reply(422, { ok: false, error: "Time must be in HH:MM format." });

    const winnerProblem = validateSelectedCompetitor(winnerId, competitors, "Winner");
    if (winnerProblem) return reply(422, { ok: false, error: winnerProblem });
    const loserProblem = validateSelectedCompetitor(loserId, competitors, "Loser");
    if (loserProblem) return reply(422, { ok: false, error: loserProblem });

    const sheetDate = sheetDateFromIso(dateIso);
    const coreIndexes = [matchMap.date, matchMap.winner, matchMap.loser, matchMap.arm];
    if (matchMap.badge >= 0) coreIndexes.push(matchMap.badge);
    if (matchMap.time >= 0) coreIndexes.push(matchMap.time);
    const lastWriteIndex = Math.max(...coreIndexes);
    const lastWriteCol = columnLetter(lastWriteIndex);

    // Duplicate protection reads only the columns that the writer itself controls.
    const existingRows = await getValues(
      CLUB.matches.id,
      `${quoteSheetTitle(matchTitle)}!A2:${lastWriteCol}`,
      accessToken
    );
    const duplicateIndex = existingRows.findIndex((row) => {
      const existingDateIso = storedDateToIso(rowValue(row, matchMap.date));
      return (
        existingDateIso === dateIso &&
        rowValue(row, matchMap.winner) === winnerId &&
        rowValue(row, matchMap.loser) === loserId &&
        normalizeArm(rowValue(row, matchMap.arm)) === arm
      );
    });
    if (duplicateIndex >= 0 && !allowDuplicate) {
      return reply(409, {
        ok: false,
        duplicate: true,
        row: duplicateIndex + 2,
        error: `An identical date / winner / loser / arm match already exists on row ${duplicateIndex + 2}.`,
      });
    }

    const row = Array(lastWriteIndex + 1).fill("");
    row[matchMap.date] = sheetDate;
    row[matchMap.winner] = winnerId;
    row[matchMap.loser] = loserId;
    row[matchMap.arm] = arm;
    if (matchMap.badge >= 0) row[matchMap.badge] = ""; // normal public match
    if (matchMap.time >= 0) row[matchMap.time] = time || "";

    const appendRange = `${quoteSheetTitle(matchTitle)}!A:${lastWriteCol}`;
    const result = await appendValues(CLUB.matches.id, appendRange, row, accessToken);
    const writtenRange = result?.updates?.updatedRange || "";
    const writtenRow = updatedRowNumber(writtenRange);
    const editUrl = writtenRow
      ? `https://docs.google.com/spreadsheets/d/${CLUB.matches.id}/edit?gid=${CLUB.matches.gid}&range=A${writtenRow}:${lastWriteCol}${writtenRow}#gid=${CLUB.matches.gid}`
      : `https://docs.google.com/spreadsheets/d/${CLUB.matches.id}/edit?gid=${CLUB.matches.gid}#gid=${CLUB.matches.gid}`;

    return reply(200, {
      ok: true,
      row: writtenRow,
      updatedRange: writtenRange,
      editUrl,
      dateWritten: sheetDate,
      timeStored: matchMap.time >= 0,
      winnerId,
      loserId,
      arm,
    });
  } catch (error) {
    console.error("add-match function error", error);
    const status = error?.status === 403 ? 503 : 500;
    return reply(status, {
      ok: false,
      error:
        error?.status === 403
          ? "Google denied access. Check that the service-account email has Viewer access to the Competitor sheet and Editor access to the Match sheet."
          : error?.message || "Unexpected match-entry backend error.",
    });
  }
};
