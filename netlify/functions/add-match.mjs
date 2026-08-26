import crypto from "node:crypto";

const CLUBS = {
  sydney: {
    name: "Sydney Spartans",
    matches: {
      id: "1DGCu6nW9TNH-id5Xfsc4TkerwvJ1vh09uZrKmUfNMlU",
      gid: "573157689",
    },
    competitors: {
      id: "15DuCXPZXtIG97V5pCod2kLkW4iqkb3kOBwoo7znwDDU",
      gid: "1561293575",
    },
    dateMode: "AU_DMY",
    allowedWeights: [
      "women", "woman", "u60kg", "youth",
      "u70kg", "u80kg", "u90kg", "u100kg", "100kg+",
    ],
  },

  nuac: {
    name: "NUAC Armwrestling Club",
    matches: {
      id: "16NFals1k03ibhtokiG9HzRe207mpKovxjLRNscDq1KI",
      gid: "573157689",
    },
    competitors: {
      id: "1oKakYJ_L4kpgw2FrPgRxaZHqa5BKgYXP5drXJ5bAuHw",
      gid: "1561293575",
    },
    dateMode: "NUAC_MIGRATION",
    allowedWeights: [
      "women", "woman", "u60kg", "u75kg", "u85kg", "open",
    ],
  },
};

function clubFromEnvironment() {
  const email = String(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || ""
  )
    .trim()
    .toLowerCase();

  if (email.startsWith("spartans-rank-writer@")) {
    return CLUBS.sydney;
  }

  if (email.startsWith("nuac-rank-writer@")) {
    return CLUBS.nuac;
  }

  throw new Error(
    "GOOGLE_SERVICE_ACCOUNT_EMAIL does not match the configured Sydney or NUAC service account."
  );
}

const CLUB = clubFromEnvironment();

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets";
const SYDNEY_TZ = "Australia/Sydney";

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

const trim = (v) => String(v ?? "").trim();

const normKey = (v) =>
  trim(v)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const b64url = (v) =>
  Buffer.from(v).toString("base64url");

function tokensMatch(received, expected) {
  const a = Buffer.from(String(received || ""));
  const b = Buffer.from(String(expected || ""));

  return (
    a.length > 0 &&
    a.length === b.length &&
    crypto.timingSafeEqual(a, b)
  );
}

function requireSecrets() {
  const email = trim(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  );

  const keyB64 = trim(
    process.env.GOOGLE_PRIVATE_KEY_B64
  );

  const entryToken = trim(
    process.env.MATCH_ENTRY_TOKEN
  );

  if (!email || !keyB64 || !entryToken) {
    throw new Error(
      "Match-entry backend is missing one or more required Netlify environment variables."
    );
  }

  let privateKey = "";

  try {
    privateKey = Buffer.from(
      keyB64,
      "base64"
    ).toString("utf8");
  } catch {
    throw new Error(
      "GOOGLE_PRIVATE_KEY_B64 could not be decoded."
    );
  }

  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new Error(
      "GOOGLE_PRIVATE_KEY_B64 does not contain a valid service-account private key."
    );
  }

  return {
    email,
    privateKey,
    entryToken,
  };
}

async function getGoogleAccessToken(
  email,
  privateKey
) {
  const now = Math.floor(Date.now() / 1000);

  if (
    cachedToken &&
    cachedTokenExpiresAt > now + 60
  ) {
    return cachedToken;
  }

  const header = b64url(
    JSON.stringify({
      alg: "RS256",
      typ: "JWT",
    })
  );

  const claims = b64url(
    JSON.stringify({
      iss: email,
      scope: SHEETS_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );

  const unsigned =
    `${header}.${claims}`;

  const signature = crypto
    .sign(
      "RSA-SHA256",
      Buffer.from(unsigned),
      privateKey
    )
    .toString("base64url");

  const response = await fetch(
    GOOGLE_TOKEN_URL,
    {
      method: "POST",
      headers: {
        "content-type":
          "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type:
          "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion:
          `${unsigned}.${signature}`,
      }),
    }
  );

  const data = await response
    .json()
    .catch(() => ({}));

  if (
    !response.ok ||
    !data.access_token
  ) {
    throw new Error(
      `Google authentication failed (${response.status}). Check the service-account email/private key.`
    );
  }

  cachedToken =
    data.access_token;

  cachedTokenExpiresAt =
    now + Number(
      data.expires_in || 3600
    );

  return cachedToken;
}

async function googleJson(
  url,
  accessToken,
  options = {}
) {
  const response = await fetch(
    url,
    {
      ...options,

      headers: {
        authorization:
          `Bearer ${accessToken}`,

        ...(options.body
          ? {
              "content-type":
                "application/json",
            }
          : {}),

        ...(options.headers || {}),
      },
    }
  );

  const data = await response
    .json()
    .catch(() => ({}));

  if (!response.ok) {
    const err = new Error(
      data?.error?.message ||
        `Google Sheets request failed (${response.status}).`
    );

    err.status =
      response.status;

    throw err;
  }

  return data;
}

function quoteSheetTitle(title) {
  return `'${String(title).replace(
    /'/g,
    "''"
  )}'`;
}

async function resolveSheetTitle(
  spreadsheetId,
  gid,
  accessToken
) {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}`
  );

  url.searchParams.set(
    "fields",
    "sheets.properties(sheetId,title)"
  );

  const data =
    await googleJson(
      url.toString(),
      accessToken
    );

  const sheet = (
    data.sheets || []
  ).find(
    (s) =>
      String(
        s?.properties?.sheetId
      ) === String(gid)
  );

  if (
    !sheet?.properties?.title
  ) {
    throw new Error(
      `Could not find sheet tab gid ${gid} inside spreadsheet ${spreadsheetId}.`
    );
  }

  return sheet.properties.title;
}

async function getValues(
  spreadsheetId,
  range,
  accessToken
) {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(
      range
    )}`
  );

  url.searchParams.set(
    "majorDimension",
    "ROWS"
  );

  url.searchParams.set(
    "valueRenderOption",
    "FORMATTED_VALUE"
  );

  const data =
    await googleJson(
      url.toString(),
      accessToken
    );

  return data.values || [];
}

async function appendValues(
  spreadsheetId,
  range,
  row,
  accessToken
) {
  const url = new URL(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(
      range
    )}:append`
  );

  url.searchParams.set(
    "valueInputOption",
    "RAW"
  );

  url.searchParams.set(
    "insertDataOption",
    "INSERT_ROWS"
  );

  url.searchParams.set(
    "includeValuesInResponse",
    "true"
  );

  return googleJson(
    url.toString(),
    accessToken,
    {
      method: "POST",

      body: JSON.stringify({
        majorDimension:
          "ROWS",

        values: [row],
      }),
    }
  );
}

function headerIndex(
  headers,
  aliases
) {
  const wanted = new Set(
    aliases.map(normKey)
  );

  return headers.findIndex(
    (h) =>
      wanted.has(normKey(h))
  );
}

function columnLetter(
  indexZeroBased
) {
  let n =
    indexZeroBased + 1;

  let out = "";

  while (n > 0) {
    n -= 1;

    out =
      String.fromCharCode(
        65 + (n % 26)
      ) + out;

    n = Math.floor(
      n / 26
    );
  }

  return out;
}

function buildHeaderMap(
  headers,
  kind
) {
  if (
    kind === "matches"
  ) {
    const map = {
      date: headerIndex(
        headers,
        ["DATE"]
      ),

      winner: headerIndex(
        headers,
        [
          "Winner ID",
          "winner_id",
        ]
      ),

      loser: headerIndex(
        headers,
        [
          "Loser ID",
          "Looser ID",
          "loser_id",
          "looser_id",
        ]
      ),

      arm: headerIndex(
        headers,
        [
          "Arm?",
          "Arm",
        ]
      ),

      badge: headerIndex(
        headers,
        [
          "Badge?",
          "Badge",
        ]
      ),
    };

    const required = [
      "date",
      "winner",
      "loser",
      "arm",
      "badge",
    ];

    const missing =
      required.filter(
        (key) =>
          map[key] < 0
      );

    if (
      missing.length
    ) {
      throw new Error(
        `Match sheet is missing required header(s): ${missing.join(
          ", "
        )}.`
      );
    }

    return map;
  }

  const map = {
    id: headerIndex(
      headers,
      [
        "ID",
        "Player ID",
        "Competitor ID",
      ]
    ),

    name: headerIndex(
      headers,
      [
        "Name",
        "Display Name",
      ]
    ),

    weight: headerIndex(
      headers,
      [
        "Weight Class",
        "weight_class",
      ]
    ),
  };

  if (map.id < 0) {
    throw new Error(
      "Competitor sheet is missing an ID / Player ID / Competitor ID header."
    );
  }

  if (map.name < 0) {
    throw new Error(
      "Competitor sheet is missing a Name header."
    );
  }

  if (map.weight < 0) {
    throw new Error(
      "Competitor sheet is missing a Weight Class header."
    );
  }

  return map;
}

const rowValue = (
  row,
  index
) =>
  index >= 0
    ? trim(row[index])
    : "";

function competitorRecords(
  rows,
  map
) {
  return rows
    .map(
      (
        row,
        i
      ) => ({
        row: i + 2,

        id: rowValue(
          row,
          map.id
        ),

        name: rowValue(
          row,
          map.name
        ),

        weight:
          rowValue(
            row,
            map.weight
          ),
      })
    )

    .filter(
      (p) =>
        p.id ||
        p.name ||
        p.weight
    );
}

function validateSelectedCompetitor(
  id,
  records,
  label
) {
  const found =
    records.filter(
      (p) =>
        p.id === id
    );

  if (
    found.length === 0
  ) {
    return `${label} ID '${id}' was not found in the Competitor sheet.`;
  }

  if (
    found.length > 1
  ) {
    return `${label} ID '${id}' appears more than once in the Competitor sheet. Fix the duplicate ID first.`;
  }

  const person =
    found[0];

  if (
    !person.name
  ) {
    return `${label} '${id}' has a blank competitor name. Fix Competitor sheet row ${person.row} first.`;
  }

  if (
    !person.weight
  ) {
    return `${label} '${id}' has no weight class. Fix Competitor sheet row ${person.row} first.`;
  }

  if (
    !CLUB.allowedWeights.includes(
      person.weight.toLowerCase()
    )
  ) {
    return `${label} '${id}' has invalid weight class '${person.weight}'. Fix Competitor sheet row ${person.row} first.`;
  }

  return "";
}

function validIsoDate(
  iso
) {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(
      trim(iso)
    );

  if (!m) {
    return false;
  }

  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];

  const dt =
    new Date(
      Date.UTC(
        y,
        mo - 1,
        d
      )
    );

  return (
    dt.getUTCFullYear() ===
      y &&
    dt.getUTCMonth() ===
      mo - 1 &&
    dt.getUTCDate() ===
      d
  );
}

function sydneyTodayIso() {
  const parts =
    new Intl.DateTimeFormat(
      "en-AU",
      {
        timeZone:
          SYDNEY_TZ,

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",
      }
    ).formatToParts(
      new Date()
    );

  const get =
    (type) =>
      parts.find(
        (p) =>
          p.type ===
          type
      )?.value;

  return `${get(
    "year"
  )}-${get(
    "month"
  )}-${get(
    "day"
  )}`;
}

function sheetDateFromIso(
  iso
) {
  const [
    y,
    mo,
    d,
  ] =
    iso.split("-");

  if (
    CLUB.dateMode ===
      "NUAC_MIGRATION" &&
    iso <
      "2026-08-01"
  ) {
    return `${mo}/${d}/${y}`;
  }

  return `${d}/${mo}/${y}`;
}

function candidateIso(
  y,
  mo,
  d
) {
  const iso =
    `${String(y).padStart(
      4,
      "0"
    )}-${String(
      mo
    ).padStart(
      2,
      "0"
    )}-${String(
      d
    ).padStart(
      2,
      "0"
    )}`;

  return validIsoDate(
    iso
  )
    ? iso
    : null;
}

function storedDateToIso(
  value
) {
  const t =
    trim(value);

  if (!t) {
    return null;
  }

  if (
    validIsoDate(t)
  ) {
    return t;
  }

  const m =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(
      t
    );

  if (!m) {
    return null;
  }

  const a = +m[1];
  const b = +m[2];
  const y = +m[3];

  const dmy =
    candidateIso(
      y,
      b,
      a
    );

  const mdy =
    candidateIso(
      y,
      a,
      b
    );

  if (
    CLUB.dateMode !==
    "NUAC_MIGRATION"
  ) {
    return dmy;
  }

  if (
    dmy &&
    !mdy
  ) {
    return dmy;
  }

  if (
    mdy &&
    !dmy
  ) {
    return mdy;
  }

  if (
    !dmy &&
    !mdy
  ) {
    return null;
  }

  if (
    dmy === mdy
  ) {
    return dmy;
  }

  const cutover =
    "2026-08-01";

  const dmyPost =
    dmy >=
    cutover;

  const mdyPost =
    mdy >=
    cutover;

  if (
    dmyPost !==
    mdyPost
  ) {
    return dmyPost
      ? dmy
      : mdy;
  }

  return dmyPost
    ? dmy
    : mdy;
}

function normalizeArm(
  value
) {
  const t =
    trim(value)
      .toLowerCase();

  if (
    t === "right" ||
    t === "r"
  ) {
    return "RIGHT";
  }

  if (
    t === "left" ||
    t === "l"
  ) {
    return "LEFT";
  }

  return "";
}

function updatedRowNumber(
  updatedRange
) {
  const m =
    /![A-Z]+(\d+):[A-Z]+(\d+)$/i.exec(
      String(
        updatedRange ||
          ""
      )
    );

  return m
    ? Number(m[1])
    : null;
}

export default async (
  request
) => {
  if (
    request.method ===
    "OPTIONS"
  ) {
    return new Response(
      null,
      {
        status: 204,
      }
    );
  }

  if (
    ![
      "GET",
      "POST",
    ].includes(
      request.method
    )
  ) {
    return reply(
      405,
      {
        ok: false,
        error:
          "Method not allowed.",
      }
    );
  }

  try {
    const secrets =
      requireSecrets();

    const suppliedToken =
      trim(
        request.headers.get(
          "x-match-entry-token"
        )
      );

    if (
      !tokensMatch(
        suppliedToken,
        secrets.entryToken
      )
    ) {
      return reply(
        401,
        {
          ok: false,

          error:
            "Invalid or expired match-entry link.",
        }
      );
    }

    const accessToken =
      await getGoogleAccessToken(
        secrets.email,
        secrets.privateKey
      );

    const [
      matchTitle,
      competitorTitle,
    ] =
      await Promise.all([
        resolveSheetTitle(
          CLUB.matches.id,
          CLUB.matches.gid,
          accessToken
        ),

        resolveSheetTitle(
          CLUB.competitors.id,
          CLUB.competitors.gid,
          accessToken
        ),
      ]);

    const [
      matchHeaderRows,
      competitorHeaderRows,
    ] =
      await Promise.all([
        getValues(
          CLUB.matches.id,
          `${quoteSheetTitle(
            matchTitle
          )}!1:1`,
          accessToken
        ),

        getValues(
          CLUB.competitors.id,
          `${quoteSheetTitle(
            competitorTitle
          )}!1:1`,
          accessToken
        ),
      ]);

    const matchHeaders =
      matchHeaderRows[0] ||
      [];

    const competitorHeaders =
      competitorHeaderRows[0] ||
      [];

    const matchMap =
      buildHeaderMap(
        matchHeaders,
        "matches"
      );

    const competitorMap =
      buildHeaderMap(
        competitorHeaders,
        "competitors"
      );

    const competitorLastCol =
      columnLetter(
        Math.max(
          competitorHeaders.length,
          1
        ) - 1
      );

    const competitorRows =
      await getValues(
        CLUB.competitors.id,
        `${quoteSheetTitle(
          competitorTitle
        )}!A2:${competitorLastCol}`,
        accessToken
      );

    const competitors =
      competitorRecords(
        competitorRows,
        competitorMap
      );

    if (
      request.method ===
      "GET"
    ) {
      return reply(
        200,
        {
          ok: true,

          club:
            CLUB.name,

          matchSheet:
            matchTitle,

          competitorSheet:
            competitorTitle,

          competitorCount:
            competitors.filter(
              (p) =>
                p.id
            ).length,

          headers:
            matchHeaders,
        }
      );
    }

    const body =
      await request
        .json()
        .catch(
          () => null
        );

    if (
      !body ||
      typeof body !==
        "object"
    ) {
      return reply(
        400,
        {
          ok: false,
          error:
            "Invalid JSON request.",
        }
      );
    }

    const winnerId =
      trim(
        body.winnerId
      );

    const loserId =
      trim(
        body.loserId
      );

    const arm =
      normalizeArm(
        body.arm
      );

    const dateIso =
      trim(
        body.dateIso
      );

    const allowDuplicate =
      body.allowDuplicate ===
      true;

    const hidePublicActivity =
      body.hidePublicActivity ===
      true;

    if (
      !winnerId ||
      !loserId
    ) {
      return reply(
        422,
        {
          ok: false,

          error:
            "Choose both a winner and a loser from the competitor suggestions.",
        }
      );
    }

    if (
      winnerId ===
      loserId
    ) {
      return reply(
        422,
        {
          ok: false,

          error:
            "Winner and loser cannot be the same competitor.",
        }
      );
    }

    if (!arm) {
      return reply(
        422,
        {
          ok: false,

          error:
            "Choose RIGHT or LEFT arm.",
        }
      );
    }

    if (
      !validIsoDate(
        dateIso
      )
    ) {
      return reply(
        422,
        {
          ok: false,

          error:
            "Choose a valid match date.",
        }
      );
    }

    if (
      dateIso >
      sydneyTodayIso()
    ) {
      return reply(
        422,
        {
          ok: false,

          error:
            "Future-dated matches cannot be submitted.",
        }
      );
    }

    const winnerProblem =
      validateSelectedCompetitor(
        winnerId,
        competitors,
        "Winner"
      );

    if (
      winnerProblem
    ) {
      return reply(
        422,
        {
          ok: false,

          error:
            winnerProblem,
        }
      );
    }

    const loserProblem =
      validateSelectedCompetitor(
        loserId,
        competitors,
        "Loser"
      );

    if (
      loserProblem
    ) {
      return reply(
        422,
        {
          ok: false,

          error:
            loserProblem,
        }
      );
    }

    const sheetDate =
      sheetDateFromIso(
        dateIso
      );

    const lastWriteIndex =
      Math.max(
        matchMap.date,
        matchMap.winner,
        matchMap.loser,
        matchMap.arm,
        matchMap.badge
      );

    const lastWriteCol =
      columnLetter(
        lastWriteIndex
      );

    const existingRows =
      await getValues(
        CLUB.matches.id,

        `${quoteSheetTitle(
          matchTitle
        )}!A2:${lastWriteCol}`,

        accessToken
      );

    const duplicateIndex =
      existingRows.findIndex(
        (row) =>
          storedDateToIso(
            rowValue(
              row,
              matchMap.date
            )
          ) ===
            dateIso &&

          rowValue(
            row,
            matchMap.winner
          ) ===
            winnerId &&

          rowValue(
            row,
            matchMap.loser
          ) ===
            loserId &&

          normalizeArm(
            rowValue(
              row,
              matchMap.arm
            )
          ) === arm
      );

    if (
      duplicateIndex >=
        0 &&
      !allowDuplicate
    ) {
      return reply(
        409,
        {
          ok: false,

          duplicate:
            true,

          row:
            duplicateIndex +
            2,

          error:
            `An identical date / winner / loser / arm match already exists on row ${
              duplicateIndex +
              2
            }.`,
        }
      );
    }

    const row =
      Array(
        lastWriteIndex +
          1
      ).fill("");

    row[
      matchMap.date
    ] = sheetDate;

    row[
      matchMap.winner
    ] = winnerId;

    row[
      matchMap.loser
    ] = loserId;

    row[
      matchMap.arm
    ] = arm;

    row[
      matchMap.badge
    ] =
      hidePublicActivity
        ? "FALSE"
        : "";

    const appendRange =
      `${quoteSheetTitle(
        matchTitle
      )}!A:${lastWriteCol}`;

    const result =
      await appendValues(
        CLUB.matches.id,
        appendRange,
        row,
        accessToken
      );

    const writtenRange =
      result?.updates
        ?.updatedRange ||
      "";

    const writtenRow =
      updatedRowNumber(
        writtenRange
      );

    const editUrl =
      writtenRow

        ? `https://docs.google.com/spreadsheets/d/${CLUB.matches.id}/edit?gid=${CLUB.matches.gid}&range=A${writtenRow}:${lastWriteCol}${writtenRow}#gid=${CLUB.matches.gid}`

        : `https://docs.google.com/spreadsheets/d/${CLUB.matches.id}/edit?gid=${CLUB.matches.gid}#gid=${CLUB.matches.gid}`;

    return reply(
      200,
      {
        ok: true,

        row:
          writtenRow,

        updatedRange:
          writtenRange,

        editUrl,

        dateWritten:
          sheetDate,

        winnerId,

        loserId,

        arm,

        hiddenRankingAdjustment:
          hidePublicActivity,
      }
    );
  } catch (
    error
  ) {
    console.error(
      "add-match function error",
      error
    );

    const status =
      error?.status ===
      403
        ? 503
        : 500;

    return reply(
      status,
      {
        ok: false,

        error:
          error?.status ===
          403

            ? "Google denied access. Check that the service-account email has Viewer access to the Competitor sheet and Editor access to the Match sheet."

            : error?.message ||
              "Unexpected match-entry backend error.",
      }
    );
  }
};
