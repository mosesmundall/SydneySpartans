import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";

/* ===================== GROUPS & DISPLAY ===================== */
/*
 * Ranking structure:
 * - Women and Youth are separate special categories.
 * - Women do NOT qualify for Youth.
 * - Youth do NOT qualify for Women.
 * - Both special categories qualify for every Open weight class.
 * - Open competitors qualify for their own class and every heavier Open class.
 */
const OPEN_GROUPS = ["u70kg", "u80kg", "u90kg", "u100kg", "100kg+"];
const SPECIAL_GROUPS = ["u60kg", "youth"]; // u60kg is the internal key for Women
const ORDER_GROUPS = [...SPECIAL_GROUPS, ...OPEN_GROUPS];
const ARMS = ["Right", "Left"];

/**
 * Display order:
 * - Open classes first (heavy -> light)
 * - Then Women
 * - Then Youth
 *
 * Display order is intentionally independent of eligibility. Women and Youth
 * remain parallel special categories and never qualify for each other.
 */
const DISPLAY_CLASSES = [
  ...ORDER_GROUPS
    .filter((g) => g !== "u60kg" && g !== "youth")
    .slice()
    .reverse()
    .flatMap((g) => ARMS.map((a) => `${g} ${a}`)),
  ...ARMS.map((a) => `u60kg ${a}`),
  ...ARMS.map((a) => `youth ${a}`),
];

/* ===================== CONFIG ===================== */
/* Using gviz for fast-refresh CSVs */
const CONFIG = {
  sheets: {
    players: { id: "15DuCXPZXtIG97V5pCod2kLkW4iqkb3kOBwoo7znwDDU", gid: "1561293575" },
    matches: { id: "1DGCu6nW9TNH-id5Xfsc4TkerwvJ1vh09uZrKmUfNMlU", gid: "573157689" },
  },
  weightClasses: DISPLAY_CLASSES,
  branding: {
    clubName: "Sydney Spartans",
    logoUrl: "/spartans_logo.png",
    backgroundImage: "/spartans_bg.png",
  },
  photos: {
    byPlayerId: {
      aden_w: "/aden_champ.png",
      luke_a: "/luke_champ.png",
      moses_m: "/moses_champ.png",
      bowen_c: "/bowen_champ.png",
      garry_k: "/gary_champ.png",
      steph_v: "/steph_champ.png",
      josh_b: "/josh_champ.png",
      peppe_p: "/peppe_champ.png",
      brooke_h: "/brooke_champ.png",
      edward_s: "/ed_champ.png",
      ime_king: "/ime_champ.png",
      mario_t: "/mario_champ.png",
      lachlan_c: "/lachlan_champ.png",
      dimi_b: "/dimi_champ.png",
      jacob_s: "/shiggs_champ.png",
      aidan_b: "/aidan_champ.png",
      harrison_r: "/harrison_champ.png",
    },
    size: 72,
    ring: true,
  },

  validation: {
    allowedPlayerWeightClasses: ["women", "woman", "u60kg", "youth", "u70kg", "u80kg", "u90kg", "u100kg", "100kg+"],
    dateHelp: 'Use DD/MM/YYYY. Ambiguous dates such as 07/05/2025 cannot be automatically distinguished from US-style input, so enter all new dates consistently.',
  },

  defaultWindowDays: 30,
  livePollMs: 5000,
};

/* gviz (fast) CSV URL */
const csvUrl = ({ id, gid }) =>
  `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}`;

/* ===================== HELPERS ===================== */
const trim = (x) => (x ?? "").toString().trim();
const yes = (x) => ["true", "yes", "y", "1"].includes(trim(x).toLowerCase());

async function fetchCsv(url) {
  const bust = url.includes("?") ? "&t=" + Date.now() : "?t=" + Date.now();
  const res = await fetch(url + bust, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sheet request failed (${res.status})`);
  const text = await res.text();
  return new Promise((resolve, reject) =>
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: (r) => resolve(r.data),
      error: reject,
    })
  );
}

const normKey = (k) => (k ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const normalizeRow = (row) => {
  const out = {};
  Object.entries(row || {}).forEach(([k, v]) => (out[normKey(k)] = v));
  return out;
};
const gv = (obj, ...keys) => {
  for (const k of keys) {
    const v = obj[normKey(k)];
    if (v !== undefined && String(v).trim() !== "") return v;
  }
  return "";
};

/* Parse date/datetime as UTC. Slash dates are explicitly Australian D/M/YYYY. */
function parseDateTimeUTC(s) {
  const t = String(s || "").trim();
  if (!t) return null;

  // 1) ISO YYYY-MM-DD
  let m =
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2})(?::(\d{1,2})(?::(\d{1,2}))?)?)?$/.exec(
      t
    );
  if (m) {
    const [, y, mo, d, hh = "12", mi = "0", ss = "0"] = m;
    return new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss));
  }

  // 2) Australian slash dates D/M/YYYY
  m =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2})(?::(\d{1,2})(?::(\d{1,2}))?)?)?$/.exec(
      t
    );
  if (m) {
    const d = +m[1],
      mo = +m[2],
      y = +m[3];
    const hh = +(m[4] ?? 12),
      mi = +(m[5] ?? 0),
      ss = +(m[6] ?? 0);
    return new Date(Date.UTC(y, mo - 1, d, hh, mi, ss));
  }

  return null;
}

/* Parse "Injured?" column: RIGHT/LEFT (also R/L, BOTH, or comma lists) */
function parseInjury(val) {
  const t = String(val || "").toLowerCase().trim();
  if (!t) return { injuredRight: false, injuredLeft: false };
  const parts = t.split(/[,\s/;|]+/).filter(Boolean);
  const set = new Set(parts);
  const isRight = set.has("right") || set.has("r");
  const isLeft = set.has("left") || set.has("l");
  const isBoth = set.has("both");
  return {
    injuredRight: isBoth || isRight,
    injuredLeft: isBoth || isLeft,
  };
}

/* ===================== ELIGIBILITY & SEEDING ===================== */
/*
 * Treat "women" as the internal "u60kg" ladder key.
 *
 * Eligibility rules:
 * Women -> Women + every Open class (NOT Youth)
 * Youth -> Youth + every Open class (NOT Women)
 * u70   -> u70, u80, u90, u100, 100+
 * u80   -> u80, u90, u100, 100+
 * etc.
 */
function baseGroupFor(player) {
  const baseRaw = String(player.weight_class || "").trim().toLowerCase();
  return baseRaw === "women" || baseRaw === "woman" ? "u60kg" : baseRaw;
}

function eligibleClassesFor(player) {
  const base = baseGroupFor(player);

  let groups = [];

  if (base === "u60kg") {
    // Women can rank in Women + all Open classes, but never Youth.
    groups = ["u60kg", ...OPEN_GROUPS];
  } else if (base === "youth") {
    // Youth can rank in Youth + all Open classes, but never Women.
    groups = ["youth", ...OPEN_GROUPS];
  } else {
    // Open-class competitors qualify for their own class and every heavier class.
    const baseIdx = OPEN_GROUPS.indexOf(base);
    if (baseIdx === -1) return [];
    groups = OPEN_GROUPS.slice(baseIdx);
  }

  return groups.flatMap((group) => ARMS.map((arm) => `${group} ${arm}`));
}

// Starting ranks are only a seed for the initial ladder state.
// Only positive finite numbers count as valid seeds. Blanks, dashes (—/–/-),
// text, zero, negatives, etc. are treated as UNSEEDED and start at the bottom.
function validStartingRank(value) {
  const t = String(value ?? "").trim();
  if (!t) return Infinity;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
}

function seedLadders(players, displayClasses) {
  const ladders = Object.fromEntries(displayClasses.map((wc) => [wc, []]));

  /*
   * GLOBAL-SEED MODEL
   * -----------------
   * The Starting Rank columns come from the old single club-wide ladder.
   * They are NOT category-specific ranks.
   *
   * Therefore we first reconstruct that old global order independently for
   * Right and Left arm:
   *   1 = best overall, 2 = next best, etc.
   *   valid numeric seeds first; unseeded players go underneath them in
   *   Competitor-sheet row order.
   *
   * Only AFTER that global order exists do we create each category ladder by
   * filtering out players who are not eligible for that category.
   *
   * Example: if Bhavya is global RH seed 21, he begins around that part of the
   * global order. In U100 he may move up a few places only because heavier
   * 100kg+ competitors are ineligible for U100; he must NOT become #2 merely
   * because he is a U80 competitor or because of his Competitor-sheet row.
   *
   * Historical matches are replayed after this seed stage and always override
   * the starting order wherever a real takeover occurs.
   */

  const seedForArm = (p, arm) => {
    const armValue = arm === "Right" ? p.current_rank_rh : p.current_rank_lh;
    const armRank = validStartingRank(armValue);
    if (Number.isFinite(armRank)) return armRank;
    return validStartingRank(p.current_rank);
  };

  const globalOrderByArm = {};

  ARMS.forEach((arm) => {
    globalOrderByArm[arm] = players
      .filter((p) => {
        if (!p.active) return false;
        if (arm === "Right" && p.injuredRight) return false;
        if (arm === "Left" && p.injuredLeft) return false;
        return true;
      })
      .slice()
      .sort((a, b) => {
        const aRank = seedForArm(a, arm);
        const bRank = seedForArm(b, arm);

        // Old overall rank: lower number is better. Any valid numbered seed
        // always sits above every unseeded player.
        if (aRank !== bRank) return aRank - bRank;

        // Duplicate seed values or two unseeded players are resolved by their
        // physical Competitor-sheet order, top row first.
        const rowDiff =
          (a._playerRowIndex ?? Infinity) - (b._playerRowIndex ?? Infinity);
        if (rowDiff !== 0) return rowDiff;

        return a.name.localeCompare(b.name);
      });
  });

  Object.keys(ladders).forEach((wc) => {
    const arm = wc.endsWith(" Right")
      ? "Right"
      : wc.endsWith(" Left")
      ? "Left"
      : null;

    if (!arm) return;

    // "Divide" the old global ladder into the new category ladder while
    // preserving the global relative order of every eligible competitor.
    ladders[wc] = (globalOrderByArm[arm] || []).filter((p) =>
      eligibleClassesFor(p).includes(wc)
    );
  });

  return ladders;
}

/* helper */
function indexRanks(arr) {
  const m = new Map();
  arr.forEach((p, i) => m.set(p.id || "row_" + i, i + 1));
  return m;
}

/* ===================== MATCH APPLICATION ===================== */
function applyMatchToLadder(ladder, match) {
  const ids = ladder.map((p) => p.id);
  const wi = ids.indexOf(match.winner_id);
  const li = ids.indexOf(match.loser_id);
  const events = [];
  if (wi !== -1 && li !== -1) {
    if (wi < li) {
      events.push({
        type: "defense",
        winner_id: match.winner_id,
        loser_id: match.loser_id,
        jump: 0,
      });
      return { ladder, events };
    }
    if (wi > li) {
      const moved = ladder[wi];
      const out = ladder.slice();
      out.splice(wi, 1);
      out.splice(li, 0, moved);
      const jump = wi - li;
      events.push({
        type: "takeover",
        winner_id: match.winner_id,
        loser_id: match.loser_id,
        jump,
        // Everyone between the loser and winner is displaced down one place.
        // This lets the UI show movement caused ONLY by visible (Badge? != FALSE) matches.
        displaced_ids: ladder.slice(li, wi).map((p) => p.id),
      });
      return { ladder: out, events };
    }
  }
  return { ladder, events };
}

/* ===================== CORE REPLAY ===================== */
function computeLaddersThroughDate(players, matches, displayClasses, cutoff) {
  const ladders = seedLadders(players, displayClasses);

  // Track positive events separately (robust badges + UI activity/history).
  const lastEventMap = new Map();
  const lastJumpMap = new Map();
  const lastTakeoverMap = new Map();
  const lastDefenseMap = new Map();
  const lastLadderActivityMap = new Map();
  // Only NON-suppressed matches are written to these visual logs.
  // Badge? = FALSE still changes the real ladder, but leaves no movement UI trace.
  const eventLog = [];
  const movementLog = [];

  const laddersForArm = (arm) =>
    Object.keys(ladders).filter((wc) => wc.endsWith(` ${arm}`));

  matches
    .map((m) => {
      const parsed = parseDateTimeUTC(m._dateTime);
      return parsed ? { ...m, _t: parsed.getTime() } : null;
    })
    .filter(Boolean)
    .sort((a, b) => {
      // Replay matches by calendar date first.
      if (a._t !== b._t) return a._t - b._t;

      // For matches on the same date, the Google Sheet is the source of truth:
      // the highest row happened first and each lower row happened afterwards.
      // Time/Seq columns intentionally do NOT override sheet row order.
      if ((a._rowIndex ?? Infinity) !== (b._rowIndex ?? Infinity))
        return (a._rowIndex ?? Infinity) - (b._rowIndex ?? Infinity);

      return a._stableKey.localeCompare(b._stableKey);
    })
    .forEach((m) => {
      const when = new Date(m._t);
      if (!m.arm) return;
      if (cutoff && when > cutoff) return;

      for (const wc of laddersForArm(m.arm)) {
        const ladder = ladders[wc];
        if (!ladder) continue;

        const ids = ladder.map((p) => p.id);
        const wi = ids.indexOf(m.winner_id);
        const li = ids.indexOf(m.loser_id);
        if (wi === -1 || li === -1) continue;

        const { ladder: newLadder, events } = applyMatchToLadder(ladder, m);
        ladders[wc] = newLadder;

        events.forEach((e) => {
          /*
           * Badge? = FALSE is a COMPLETE VISUAL SUPPRESSION flag.
           * The ladder change above has already been applied, so the real ranking
           * remains correct. From this point onward, however, a suppressed match
           * must leave no visible movement trail: no badge, arrows, activity feed,
           * takeover/defense stat, or "last activity" update.
           */
          if (m._badgeSuppressed) return;

          const logged = {
            ...e,
            wc,
            arm: m.arm,
            when,
            matchKey: m._stableKey,
            matchWeightClass: m.weight_class,
          };
          eventLog.push(logged);
          lastLadderActivityMap.set(wc, when);

          const wk = `${wc}:${e.winner_id}`;
          if (e.type === "defense") {
            lastEventMap.set(wk, { type: "defense", when });
            lastDefenseMap.set(wk, when);
            lastJumpMap.delete(wk);
          }
          if (e.type === "takeover") {
            lastEventMap.set(wk, { type: "takeover", when });
            lastTakeoverMap.set(wk, when);
            lastJumpMap.set(wk, e.jump || 0);

            // Winner moves up by the full jump.
            movementLog.push({
              wc,
              player_id: e.winner_id,
              delta: e.jump || 0,
              when,
              matchKey: m._stableKey,
            });

            // Everyone passed by the winner moves down exactly one place.
            (e.displaced_ids || []).forEach((player_id) => {
              movementLog.push({
                wc,
                player_id,
                delta: -1,
                when,
                matchKey: m._stableKey,
              });
            });
          }
        });
      }
    });

  const out = {};
  Object.keys(ladders).forEach((wc) => {
    const arr = ladders[wc];
    const ranks = indexRanks(arr);
    out[wc] = arr.map((p) => ({ ...p, rank: ranks.get(p.id) }));
  });

  return {
    ladders: out,
    lastEventMap,
    lastJumpMap,
    lastTakeoverMap,
    lastDefenseMap,
    lastLadderActivityMap,
    eventLog,
    movementLog,
  };
}

/* ===================== PRESENTATION HELPERS ===================== */
const prettyClassLabel = (wc) =>
  String(wc || "")
    .replace(/^u60kg\b/i, "Women")
    .replace(/^youth\b/i, "Youth")
    .replace(/^u70kg\b/i, "U70 kg")
    .replace(/^u80kg\b/i, "U80 kg")
    .replace(/^u90kg\b/i, "U90 kg")
    .replace(/^u100kg\b/i, "U100 kg")
    .replace(/^100kg\+\b/i, "100 kg+");

const prettyBaseLabel = (base) => {
  const t = String(base || "").trim();
  if (/^(women|woman|u60kg)$/i.test(t)) return "Women";
  if (/^youth$/i.test(t)) return "Youth";
  return prettyClassLabel(t);
};

const classWithoutArm = (wc) =>
  prettyClassLabel(String(wc || "").replace(/\s+(Right|Left)$/i, ""));

function formatDateAU(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatTimeLocal(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => {
    const k = keyFn(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}


/* ===================== DATA HEALTH / ADMIN ===================== */
function sheetEditUrl(sheetKey, row) {
  const sheet = CONFIG.sheets[sheetKey];
  if (!sheet) return "";
  const range = row ? `&range=A${row}:Z${row}` : "";
  return `https://docs.google.com/spreadsheets/d/${sheet.id}/edit#gid=${sheet.gid}${range}`;
}

function levenshtein(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  const dp = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= y.length; j += 1) {
      const hold = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = hold;
    }
  }
  return dp[y.length];
}

function closestPlayerId(value, validIds) {
  const needle = trim(value).toLowerCase();
  if (!needle) return "";
  const exactCaseInsensitive = validIds.find((id) => id.toLowerCase() === needle);
  if (exactCaseInsensitive) return exactCaseInsensitive;
  const normalized = needle.replace(/[^a-z0-9]/g, "");
  const normalizedMatch = validIds.find((id) => id.toLowerCase().replace(/[^a-z0-9]/g, "") === normalized);
  if (normalizedMatch) return normalizedMatch;

  let best = "";
  let bestDistance = Infinity;
  validIds.forEach((id) => {
    const d = levenshtein(needle, id.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = id;
    }
  });
  const threshold = Math.max(2, Math.min(4, Math.floor(needle.length / 3)));
  return bestDistance <= threshold ? best : "";
}

function strictDateInfo(value) {
  const t = trim(value);
  if (!t) return { parsed: null, valid: false, format: "missing", inconsistent: false };

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (slash) {
    const a = +slash[1];
    const b = +slash[2];
    const y = +slash[3];
    let d;
    let mo;
    let inconsistent = false;

    if (a > 12 && b <= 12) {
      d = a;
      mo = b;
    } else if (b > 12 && a <= 12) {
      // This can only be MM/DD/YYYY, so it is inconsistent with our DD/MM/YYYY standard.
      d = b;
      mo = a;
      inconsistent = true;
    } else {
      // Ambiguous values are interpreted as DD/MM/YYYY by the ranking code.
      d = a;
      mo = b;
    }

    if (mo < 1 || mo > 12 || d < 1 || d > 31) {
      return { parsed: null, valid: false, format: "slash", inconsistent };
    }
    const ms = Date.UTC(y, mo - 1, d, 12, 0, 0);
    const parsed = new Date(ms);
    const valid = parsed.getUTCFullYear() === y && parsed.getUTCMonth() === mo - 1 && parsed.getUTCDate() === d;
    return { parsed: valid ? parsed : null, valid, format: "slash", inconsistent };
  }

  // The ranking parser may support legacy/ISO values, but the admin standard is DD/MM/YYYY.
  const parsed = parseDateTimeUTC(t);
  return { parsed, valid: Boolean(parsed), format: "other", inconsistent: true };
}

function validateClubData(playerRows, matchRows) {
  const issues = [];
  let issueSeq = 0;
  const add = (severity, source, row, field, message, value = "", fix = "", extra = {}) => {
    issues.push({
      id: `issue_${issueSeq++}`,
      severity,
      source,
      row,
      field,
      message,
      value: trim(value),
      fix,
      ...extra,
    });
  };

  const allowedWeights = new Set((CONFIG.validation?.allowedPlayerWeightClasses || []).map((x) => x.toLowerCase()));
  const playerIdRows = new Map();
  const validIds = [];

  (playerRows || []).forEach((raw, idx) => {
    const row = idx + 2; // row 1 is the header in Google Sheets
    const r = normalizeRow(raw);
    const id = trim(gv(r, "id", "player id", "player_id"));
    const name = trim(gv(r, "name", "display name", "display_name"));
    const wc = trim(gv(r, "weight class", "weight_class"));
    const active = trim(gv(r, "active", "currently active?", "currently active"));
    const injury = trim(gv(r, "injured?", "injured", "injury"));

    if (!id) {
      add("error", "Players", row, "Player ID", "Blank Player ID", "", "Enter a unique Player ID, e.g. moses_m.");
    } else {
      validIds.push(id);
      if (!playerIdRows.has(id)) playerIdRows.set(id, []);
      playerIdRows.get(id).push(row);
      if (!/^[a-z0-9_]+$/.test(id)) {
        add("warning", "Players", row, "Player ID", "Player ID uses an unusual format", id, "Use lowercase letters, numbers and underscores where possible.");
      }
    }

    if (!name) {
      add("error", "Players", row, "Name", "Blank competitor name", "", "Enter the competitor's display name.");
    }

    if (!wc) {
      add("error", "Players", row, "Weight Class", "Missing weight class", "", `Enter one of: ${CONFIG.validation.allowedPlayerWeightClasses.join(", ")}.`);
    } else if (!allowedWeights.has(wc.toLowerCase())) {
      add("error", "Players", row, "Weight Class", "Invalid weight class", wc, `Use one of: ${CONFIG.validation.allowedPlayerWeightClasses.join(", ")}.`);
    }

    if (!active) {
      add("warning", "Players", row, "Active", "Missing Active value", "", "Set Active to TRUE or FALSE.");
    } else if (!["true", "false"].includes(active.toLowerCase())) {
      add("warning", "Players", row, "Active", "Invalid Active value", active, "Use TRUE or FALSE exactly.");
    }

    if (injury) {
      const tokens = injury.toLowerCase().split(/[,\s/;|]+/).filter(Boolean);
      const allowedInjury = new Set(["right", "left", "r", "l", "both", "none", "no", "false"]);
      const bad = tokens.filter((token) => !allowedInjury.has(token));
      if (bad.length) {
        add("warning", "Players", row, "Injured?", "Unrecognised injury value", injury, "Use RIGHT, LEFT, BOTH, or leave blank when not injured.");
      }
    }
  });

  playerIdRows.forEach((rows, id) => {
    if (rows.length < 2) return;
    rows.forEach((row) => {
      const otherRows = rows.filter((x) => x !== row).join(", ");
      add("error", "Players", row, "Player ID", "Duplicate Player ID", id, `Change this ID so it is unique. The same ID also appears on row${otherRows.includes(",") ? "s" : ""} ${otherRows}.`);
    });
  });

  const uniqueValidIds = Array.from(new Set(validIds));
  const validIdSet = new Set(uniqueValidIds);
  const matchSignatures = new Map();
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

  (matchRows || []).forEach((raw, idx) => {
    const row = idx + 2;
    const r = normalizeRow(raw);
    const date = trim(gv(r, "date", "DATE"));
    const winner = trim(gv(r, "winner id", "winner_id"));
    const loser = trim(gv(r, "loser id", "loser_id", "looser id", "looser_id"));
    const rawArm = trim(gv(r, "arm?", "arm"));

    if (!date) {
      add("error", "Matches", row, "DATE", "Missing match date", "", "Enter the date as DD/MM/YYYY.");
    } else {
      const info = strictDateInfo(date);
      if (!info.valid) {
        add("error", "Matches", row, "DATE", "Invalid date", date, "Enter a real calendar date as DD/MM/YYYY.");
      } else {
        if (info.inconsistent) {
          add("error", "Matches", row, "DATE", "Inconsistent date format", date, "Convert this row to DD/MM/YYYY.");
        }
        const dayUtc = Date.UTC(info.parsed.getUTCFullYear(), info.parsed.getUTCMonth(), info.parsed.getUTCDate());
        if (dayUtc > todayUtc) {
          add("error", "Matches", row, "DATE", "Future-dated match", date, "Correct the date, or wait until that date before entering the match as a completed result.");
        }
      }
    }

    if (!winner) {
      add("error", "Matches", row, "Winner ID", "Missing Winner ID", "", "Enter the exact Competitor ID from the Competitor sheet.");
    } else if (!validIdSet.has(winner)) {
      const suggestion = closestPlayerId(winner, uniqueValidIds);
      add("error", "Matches", row, "Winner ID", "Winner ID not found in Competitor sheet", winner, suggestion ? `Possible match: ${suggestion}` : "Use an exact Competitor ID from the Competitor sheet.");
    }

    if (!loser) {
      add("error", "Matches", row, "Looser ID", "Missing Loser ID", "", "Enter the exact Competitor ID from the Competitor sheet.");
    } else if (!validIdSet.has(loser)) {
      const suggestion = closestPlayerId(loser, uniqueValidIds);
      add("error", "Matches", row, "Looser ID", "Loser ID not found in Competitor sheet", loser, suggestion ? `Possible match: ${suggestion}` : "Use an exact Competitor ID from the Competitor sheet.");
    }

    if (winner && loser && winner === loser) {
      add("error", "Matches", row, "Winner/Loser", "Winner and loser are identical", winner, "Choose two different competitor IDs.");
    }

    const arm = rawArm.toLowerCase();
    if (!rawArm) {
      add("error", "Matches", row, "Arm?", "Missing arm", "", "Enter RIGHT or LEFT.");
    } else if (!["right", "left", "r", "l"].includes(arm)) {
      add("error", "Matches", row, "Arm?", "Invalid arm", rawArm, "Use RIGHT or LEFT.");
    }

    if (date && winner && loser && rawArm) {
      const signature = [date.toLowerCase(), winner.toLowerCase(), loser.toLowerCase(), arm].join("|");
      if (!matchSignatures.has(signature)) matchSignatures.set(signature, []);
      matchSignatures.get(signature).push(row);
    }
  });

  matchSignatures.forEach((rows) => {
    if (rows.length < 2) return;
    rows.slice(1).forEach((row) => {
      add("warning", "Matches", row, "Match row", "Possible duplicate match", "", `This same date/winner/loser/arm combination also appears earlier on row ${rows[0]}. Check whether both results are intentional.`);
    });
  });

  const rawPlayerIdSet = new Set(uniqueValidIds);
  Object.keys(CONFIG.photos?.byPlayerId || {}).forEach((photoId) => {
    if (!rawPlayerIdSet.has(photoId)) {
      add(
        "warning",
        "Code",
        null,
        "CONFIG.photos.byPlayerId",
        "Photo mapping does not match a Player ID",
        photoId,
        "Either correct the photo mapping key or add the matching Competitor ID to the Competitor sheet.",
        { codeLocation: `CONFIG.photos.byPlayerId.${photoId}` }
      );
    }
  });

  const order = { error: 0, warning: 1 };
  issues.sort((a, b) => {
    if (order[a.severity] !== order[b.severity]) return order[a.severity] - order[b.severity];
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return (a.row ?? Infinity) - (b.row ?? Infinity);
  });

  return issues;
}


/* ===================== MATCH ENTRY ===================== */
function sydneyInputNow() {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

function initialMatchEntryToken() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("match-entry") || "";
}

function matchEntrySuggestions(players, query, excludedId = "") {
  const q = trim(query).toLowerCase();
  if (!q) return [];
  return players
    .filter((p) => p.id !== excludedId)
    .map((p) => {
      const name = String(p.name || "").toLowerCase();
      const id = String(p.id || "").toLowerCase();
      const starts = name.startsWith(q) || id.startsWith(q);
      const contains = name.includes(q) || id.includes(q);
      return { p, score: starts ? 0 : contains ? 1 : 2 };
    })
    .filter((x) => x.score < 2)
    .sort((a, b) => a.score - b.score || (b.p.active ? 1 : 0) - (a.p.active ? 1 : 0) || a.p.name.localeCompare(b.p.name))
    .slice(0, 8)
    .map((x) => x.p);
}

function CompetitorMatchPicker({ label, players, selectedId, onSelect, excludedId, glass }) {
  const selected = players.find((p) => p.id === selectedId) || null;
  const [query, setQuery] = useState(selected ? selected.name : "");
  const [focused, setFocused] = useState(false);
  const previousSelectedId = useRef(selectedId);
  const suggestions = matchEntrySuggestions(players, query, excludedId);

  useEffect(() => {
    const p = players.find((x) => x.id === selectedId);
    if (p) setQuery(p.name);
    else if (previousSelectedId.current && !selectedId) setQuery("");
    previousSelectedId.current = selectedId;
  }, [selectedId, players]);

  return (
    <div style={{ position: "relative" }}>
      <label style={{ display: "block", fontSize: 11, opacity: 0.62, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{label}</label>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (selectedId) onSelect("");
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 140)}
        placeholder={`Type ${label.toLowerCase()}'s name or ID…`}
        autoComplete="off"
        style={{
          width: "100%",
          padding: "12px 12px",
          borderRadius: 11,
          border: selected ? "1px solid rgba(52,211,153,.4)" : "1px solid rgba(255,255,255,.15)",
          background: "rgba(0,0,0,.2)",
          color: "white",
          outline: "none",
        }}
      />
      {selected && (
        <div style={{ marginTop: 5, fontSize: 11, opacity: 0.65 }}>
          Selected <strong style={{ color: "white" }}>{selected.id}</strong> · {prettyBaseLabel(selected.weight_class)}{selected.active ? "" : " · inactive"}
        </div>
      )}
      {focused && query.trim() && !selected && (
        <div style={{ ...glass, position: "absolute", zIndex: 30, top: 68, left: 0, right: 0, borderRadius: 12, overflow: "hidden", maxHeight: 310, overflowY: "auto" }}>
          {suggestions.length === 0 ? (
            <div style={{ padding: 12, fontSize: 12, opacity: 0.62 }}>No competitor matches “{query}”.</div>
          ) : suggestions.map((p) => (
            <button
              type="button"
              key={p.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(p.id);
                setQuery(p.name);
                setFocused(false);
              }}
              style={{ width: "100%", border: 0, borderBottom: "1px solid rgba(255,255,255,.07)", padding: "10px 12px", background: "rgba(8,12,25,.96)", color: "white", textAlign: "left", cursor: "pointer" }}
            >
              <div style={{ fontWeight: 850 }}>{p.name}</div>
              <div style={{ fontSize: 11, opacity: 0.58, marginTop: 2 }}>{p.id} · {prettyBaseLabel(p.weight_class)}{p.active ? "" : " · inactive"}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MatchEntryPage({ players, accessToken, onBack, onReload, pageStyle, glass, button, pill, green }) {
  const initialNow = sydneyInputNow();
  const [winnerId, setWinnerId] = useState("");
  const [loserId, setLoserId] = useState("");
  const [arm, setArm] = useState("");
  const [dateIso, setDateIso] = useState(initialNow.date);
  const [hidePublicActivity, setHidePublicActivity] = useState(false);
  const [backend, setBackend] = useState({ loading: true, ok: false, error: "", matchSheet: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [success, setSuccess] = useState(null);
  const [duplicate, setDuplicate] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function checkBackend() {
      setBackend((b) => ({ ...b, loading: true, error: "" }));
      try {
        const res = await fetch("/.netlify/functions/add-match", {
          headers: { "x-match-entry-token": accessToken },
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !data.ok) throw new Error(data.error || `Backend check failed (${res.status}).`);
        setBackend({ loading: false, ok: true, error: "", matchSheet: data.matchSheet || "" });
      } catch (e) {
        if (!cancelled) setBackend({ loading: false, ok: false, error: e?.message || "Could not connect to match-entry backend.", matchSheet: "" });
      }
    }
    checkBackend();
    return () => { cancelled = true; };
  }, [accessToken]);

  const winner = players.find((p) => p.id === winnerId) || null;
  const loser = players.find((p) => p.id === loserId) || null;
  const canSubmit = backend.ok && winner && loser && winnerId !== loserId && arm && dateIso && !submitting;

  async function submitMatch(allowDuplicate = false) {
    if (!canSubmit && !allowDuplicate) return;
    setSubmitting(true);
    setSubmitError("");
    setSuccess(null);
    if (!allowDuplicate) setDuplicate(null);
    try {
      const res = await fetch("/.netlify/functions/add-match", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-match-entry-token": accessToken,
        },
        body: JSON.stringify({ winnerId, loserId, arm, dateIso, hidePublicActivity, allowDuplicate }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.duplicate) {
        setDuplicate(data);
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data.error || `Match submission failed (${res.status}).`);
      setSuccess(data);
      setDuplicate(null);
      setWinnerId("");
      setLoserId("");
      setArm("");
      setHidePublicActivity(false);
      await onReload?.();
    } catch (e) {
      setSubmitError(e?.message || "Could not add match.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={pageStyle}>
      <style>{`
        * { box-sizing:border-box; }
        button, input { font:inherit; }
        .match-entry-shell { max-width:760px; margin:0 auto; }
        .match-entry-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        @media (max-width:680px) { .match-entry-grid { grid-template-columns:1fr; } }
      `}</style>
      <div className="match-entry-shell">
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap", marginBottom:16 }}>
          <div>
            <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
              <h1 style={{ margin:0, fontSize:"clamp(26px,4vw,37px)", letterSpacing:-.7 }}>Add Match</h1>
              <span style={{ ...pill, color:backend.ok ? green : backend.loading ? "#fde68a" : "#fecdd3", borderColor:backend.ok ? "rgba(52,211,153,.28)" : "rgba(251,191,36,.3)" }}>
                {backend.loading ? "● checking connection" : backend.ok ? "● Match sheet connected" : "● backend unavailable"}
              </span>
            </div>
            <div style={{ opacity:.65, fontSize:13, marginTop:4 }}>{CONFIG.branding.clubName} · secure match entry</div>
          </div>
          <button type="button" style={button} onClick={onBack}>← Back to rankings</button>
        </div>

        {!backend.ok && !backend.loading && (
          <div style={{ ...glass, borderRadius:14, padding:13, marginBottom:14, borderColor:"rgba(251,113,133,.42)", color:"#fecdd3" }}>
            <strong>Setup issue:</strong> {backend.error}
          </div>
        )}

        {success && (
          <div style={{ ...glass, borderRadius:15, padding:14, marginBottom:14, borderColor:"rgba(52,211,153,.34)", background:"rgba(52,211,153,.07)" }}>
            <div style={{ fontWeight:900, color:"#bbf7d0" }}>✅ Match added{success.row ? ` · Match sheet row ${success.row}` : ""}</div>
            <div style={{ fontSize:12, opacity:.72, marginTop:4 }}>{success.winnerId} defeated {success.loserId} · {success.arm} · {success.dateWritten}</div>
            {success.editUrl && <a href={success.editUrl} target="_blank" rel="noreferrer" style={{ display:"inline-block", marginTop:8, color:"white", fontSize:12 }}>Open added row ↗</a>}
          </div>
        )}

        {submitError && (
          <div style={{ ...glass, borderRadius:14, padding:13, marginBottom:14, borderColor:"rgba(251,113,133,.42)", color:"#fecdd3" }}>
            <strong>Could not add match:</strong> {submitError}
          </div>
        )}

        {duplicate && (
          <div style={{ ...glass, borderRadius:15, padding:14, marginBottom:14, borderColor:"rgba(251,191,36,.34)", background:"rgba(251,191,36,.06)" }}>
            <div style={{ fontWeight:900, color:"#fde68a" }}>⚠ Possible duplicate</div>
            <div style={{ fontSize:12.5, opacity:.76, marginTop:5 }}>{duplicate.error}</div>
            <div style={{ display:"flex", gap:8, marginTop:10, flexWrap:"wrap" }}>
              <button type="button" style={button} onClick={() => setDuplicate(null)}>Cancel</button>
              <button type="button" style={{ ...button, borderColor:"rgba(251,191,36,.48)", color:"#fde68a" }} disabled={submitting} onClick={() => submitMatch(true)}>Add anyway</button>
            </div>
          </div>
        )}

        <div style={{ ...glass, borderRadius:20, padding:"16px", overflow:"visible" }}>
          <div className="match-entry-grid">
            <CompetitorMatchPicker label="Winner" players={players} selectedId={winnerId} onSelect={setWinnerId} excludedId={loserId} glass={glass} />
            <CompetitorMatchPicker label="Loser" players={players} selectedId={loserId} onSelect={setLoserId} excludedId={winnerId} glass={glass} />
          </div>

          <div style={{ marginTop:16 }}>
            <div style={{ fontSize:11, opacity:.62, textTransform:"uppercase", letterSpacing:1, marginBottom:7 }}>Arm</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              {["RIGHT", "LEFT"].map((a) => (
                <button key={a} type="button" onClick={() => setArm(a)} style={{ ...button, padding:"12px", borderColor:arm === a ? "rgba(245,197,66,.58)" : "rgba(255,255,255,.16)", color:arm === a ? "#ffe792" : "white", background:arm === a ? "rgba(245,197,66,.12)" : "rgba(255,255,255,.07)" }}>
                  {a === "RIGHT" ? "Right arm" : "Left arm"}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop:16 }}>
            <label style={{ display:"block" }}>
              <span style={{ display:"block", fontSize:11, opacity:.62, textTransform:"uppercase", letterSpacing:1, marginBottom:6 }}>Date</span>
              <input type="date" value={dateIso} max={sydneyInputNow().date} onChange={(e) => setDateIso(e.target.value)} style={{ width:"100%", padding:"11px", borderRadius:10, border:"1px solid rgba(255,255,255,.15)", background:"rgba(0,0,0,.2)", color:"white" }} />
            </label>
          </div>

          <div style={{ marginTop:17, padding:"11px 12px", borderRadius:12, background:"rgba(255,255,255,.045)", fontSize:12, lineHeight:1.5 }}>
            {winner && loser ? (
              <><strong>{winner.name}</strong> defeated <strong>{loser.name}</strong>{arm ? ` · ${arm === "RIGHT" ? "Right" : "Left"} arm` : " · choose an arm"}</>
            ) : <span style={{ opacity:.58 }}>Choose the winner, loser and arm. IDs are inserted automatically from the Competitor sheet.</span>}
          </div>

          <label style={{ display:"flex", alignItems:"flex-start", gap:10, marginTop:14, padding:"11px 12px", borderRadius:11, border:"1px solid rgba(255,255,255,.11)", background:"rgba(255,255,255,.035)", cursor:"pointer" }}>
            <input
              type="checkbox"
              checked={hidePublicActivity}
              onChange={(e) => setHidePublicActivity(e.target.checked)}
              style={{ marginTop:2, width:16, height:16, accentColor:"#f5c542", cursor:"pointer", flex:"0 0 auto" }}
            />
            <span>
              <span style={{ display:"block", fontSize:12.5, fontWeight:850 }}>Hidden ranking adjustment</span>
              <span style={{ display:"block", fontSize:11, opacity:.58, marginTop:2, lineHeight:1.4 }}>
                Check this to move the ranks without showing this match in public records, history, streaks, badges, arrows or recent activity.
              </span>
            </span>
          </label>

          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => submitMatch(false)}
            style={{ ...button, width:"100%", marginTop:12, padding:"13px 14px", fontSize:14, opacity:canSubmit ? 1 : .45, cursor:canSubmit ? "pointer" : "not-allowed", background:canSubmit ? "rgba(52,211,153,.12)" : "rgba(255,255,255,.05)", borderColor:canSubmit ? "rgba(52,211,153,.38)" : "rgba(255,255,255,.12)", color:canSubmit ? "#bbf7d0" : "white" }}
          >
            {submitting ? "Adding match…" : "Add match"}
          </button>

          <div style={{ opacity:.46, fontSize:10.5, lineHeight:1.45, marginTop:9, textAlign:"center" }}>
            The backend re-checks the competitor IDs, sheet headers, date, arm and duplicates before anything is written. Same-day match order follows Match-sheet row order. Hidden ranking adjustment writes FALSE into Badge?; otherwise Badge? is left blank.
          </div>
        </div>
      </div>
    </div>
  );
}



/* ===================== LIVE RANK ANIMATIONS ===================== */
const RANK_REPLAY_DAYS = 30;

function rankAnimationEventKey(e) {
  return `${e?.matchKey || ""}|${e?.wc || ""}|${e?.type || ""}|${e?.winner_id || ""}|${e?.loser_id || ""}`;
}

function rankOrderSignature(items) {
  return (items || []).map((p) => p.id).join("|");
}

function animationDisplayLadder(wc, ladder) {
  return (ladder || []);
}

function buildInitialRankReplayFrames(players, matches) {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - RANK_REPLAY_DAYS);

  const sorted = (matches || [])
    .filter((m) => m._parsedDate)
    .slice()
    .sort((a, b) => {
      const at = a._parsedDate.getTime();
      const bt = b._parsedDate.getTime();
      if (at !== bt) return at - bt;
      return (a._rowIndex ?? 0) - (b._rowIndex ?? 0);
    });

  const beforeWindow = sorted.filter((m) => m._parsedDate < cutoff);
  const recent = sorted.filter((m) => m._parsedDate >= cutoff);

  /*
   * Replay baseline rule:
   *
   * Badge? = FALSE is a hidden/manual ranking adjustment. It must never look
   * like a public match happened during the 30-day replay.
   *
   * Start with the historical state from before the 30-day window, then silently
   * pre-apply EVERY suppressed adjustment inside the window. That corrected state
   * is what the viewer sees before the replay begins.
   */
  const recentSuppressed = recent.filter((m) => m._badgeSuppressed);
  const baselineMatches = [...beforeWindow, ...recentSuppressed].sort((a, b) => {
    const at = a._parsedDate.getTime();
    const bt = b._parsedDate.getTime();
    if (at !== bt) return at - bt;
    return (a._rowIndex ?? 0) - (b._rowIndex ?? 0);
  });

  const baselineData = computeLaddersThroughDate(
    players,
    baselineMatches,
    CONFIG.weightClasses,
    null
  );

  const frames = Object.fromEntries(
    CONFIG.weightClasses.map((wc) => [
      wc,
      [
        {
          items: animationDisplayLadder(wc, baselineData.ladders[wc] || []),
          event: null,
          animate: false,
        },
      ],
    ])
  );

  /*
   * Separately walk through the true chronological history only to discover
   * which PUBLIC takeover/defense events occurred. Those records power the
   * takeover/defense glows. Hidden matches never create an animation event.
   */
  const chronologicalWorking = beforeWindow.slice();

  recent.forEach((match) => {
    chronologicalWorking.push(match);

    const data = computeLaddersThroughDate(
      players,
      chronologicalWorking,
      CONFIG.weightClasses,
      null
    );

    if (match._badgeSuppressed) return;

    const events = (data.eventLog || []).filter(
      (e) => e.matchKey === match._stableKey
    );

    events.forEach((event) => {
      if (!frames[event.wc]) return;

      frames[event.wc].push({
        items: animationDisplayLadder(event.wc, data.ladders[event.wc] || []),
        event,
        animate: true,
      });
    });
  });

  // Finish on the exact real current ranking, including all hidden adjustments.
  const finalData = computeLaddersThroughDate(
    players,
    sorted,
    CONFIG.weightClasses,
    null
  );

  CONFIG.weightClasses.forEach((wc) => {
    const finalItems = animationDisplayLadder(
      wc,
      finalData.ladders[wc] || []
    );

    const list = frames[wc] || [];
    const last = list[list.length - 1]?.items || [];

    if (rankOrderSignature(last) !== rankOrderSignature(finalItems)) {
      list.push({
        items: finalItems,
        event: null,
        animate: false,
      });
    }
  });

  return frames;
}

function AnimatedRankRows({
  wc,
  items,
  replayFrames,
  displayMode,
  liveEvents,
  limit = 10,
  onSelect,
  getRowClass,
  renderRow,
}) {
  const containerRef = useRef(null);
  const replayFramesRef = useRef(replayFrames || []);
  const replayStartedRef = useRef(false);
  const replayFinishedRef = useRef(displayMode || (replayFrames || []).length <= 1);
  const replayTimerRef = useRef(null);
  const previousRectsRef = useRef(new Map());
  const animateNextRef = useRef(false);
  const animationModeRef = useRef("none"); // "replay" | "live" | "none"
  const pulseEventsRef = useRef([]);
  const [inView, setInView] = useState(false);

  const baselineFullItems = !displayMode && (replayFrames || []).length > 1
    ? replayFrames[0].items
    : items;
  const initialItems = baselineFullItems.slice(0, limit);
  const [displayedItems, setDisplayedItems] = useState(initialItems);
  const replayBaselineOrderRef = useRef((baselineFullItems || []).map((p) => p.id));

  const currentSignature = rankOrderSignature(items);
  const liveSignature = (liveEvents || []).map(rankAnimationEventKey).join("||");

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setInView(Boolean(entry?.isIntersecting)),
      { threshold: 0.28 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
      const node = containerRef.current;
      if (node) {
        node.style.height = "";
        node.style.overflow = "";
      }
    };
  }, []);

  useEffect(() => {
    if (displayMode) {
      if (replayTimerRef.current) clearTimeout(replayTimerRef.current);
      replayFinishedRef.current = true;
      animateNextRef.current = false;
      animationModeRef.current = "none";
      pulseEventsRef.current = [];
      setDisplayedItems(items);
      return;
    }

    if (!inView || replayStartedRef.current || replayFinishedRef.current) return;
    const frames = replayFramesRef.current || [];
    if (frames.length <= 1) {
      replayFinishedRef.current = true;
      setDisplayedItems(items);
      return;
    }

    /*
     * Historical replay is intentionally COLLAPSED into one calm transition:
     * show the corrected 30-day baseline with hidden/manual adjustments already baked in,
     * then let the public-match movement float into its current place together. This avoids a
     * busy card "machine-gunning" through every intermediate match result.
     *
     * Public takeover/defense events are still remembered so the competitors
     * responsible for recent activity receive the appropriate glow after the
     * movement settles. Badge? = FALSE frames never carry an event, so hidden
     * adjustments remain visually silent.
     */
    replayStartedRef.current = true;

    const finalFrame = frames[frames.length - 1];
    const baselineItems = frames[0]?.items || [];
    const finalFullItems = finalFrame.items || [];
    replayBaselineOrderRef.current = baselineItems.map((p) => p.id);

    const baselineVisibleIds = baselineItems.slice(0, limit).map((p) => p.id);
    let transitionDepth = Math.min(limit, finalFullItems.length);

    // Keep any competitor who started inside the visible top N mounted long
    // enough to physically slide down and out if the replay bumps them below it.
    baselineVisibleIds.forEach((id) => {
      const finalIndex = finalFullItems.findIndex((p) => p.id === id);
      if (finalIndex >= 0) transitionDepth = Math.max(transitionDepth, finalIndex + 1);
    });

    const replayTransitionItems = finalFullItems.slice(0, transitionDepth);
    const publicEvents = frames
      .filter((frame) => frame.animate && frame.event)
      .map((frame) => frame.event);

    // A competitor only needs one pulse of each type during the collapsed replay.
    const uniquePulseEvents = Array.from(
      new Map(
        publicEvents.map((event) => [
          `${event.type}:${event.winner_id}`,
          event,
        ])
      ).values()
    );

    replayTimerRef.current = setTimeout(() => {
      const node = containerRef.current;

      // Lock the existing baseline list in place. This prevents scroll-triggered
      // replays from blanking/collapsing the card while React swaps row order.
      if (node) {
        const currentHeight = node.getBoundingClientRect().height;
        node.style.height = `${currentHeight}px`;
        node.style.overflow = "hidden";
      }

      animateNextRef.current = true;
      animationModeRef.current = "replay";
      pulseEventsRef.current = uniquePulseEvents;
      setDisplayedItems(replayTransitionItems);

      // Mark replay complete after the long float/glow has had time to finish.
      replayTimerRef.current = setTimeout(() => {
        replayFinishedRef.current = true;
        animateNextRef.current = false;
        animationModeRef.current = "none";
        pulseEventsRef.current = [];

        // Sync to the latest live top-N data. Release the temporary clip only
        // after React has committed the settled ranking.
        setDisplayedItems(items);
        requestAnimationFrame(() => {
          const currentNode = containerRef.current;
          if (currentNode) {
            currentNode.style.height = "";
            currentNode.style.overflow = "";
          }
        });
      }, 2500);
    }, 360);
  }, [inView, displayMode]);

  // Once the initial replay is finished, every genuinely new public match can animate the existing rows
  // from their old DOM positions to their new positions. Hidden-only changes sync silently.
  useEffect(() => {
    if (!replayFinishedRef.current) return;
    if ((liveEvents || []).length > 0) {
      animateNextRef.current = true;
      animationModeRef.current = "live";
      pulseEventsRef.current = liveEvents;
      setDisplayedItems(items);
    } else {
      animateNextRef.current = false;
      animationModeRef.current = "none";
      pulseEventsRef.current = [];
      setDisplayedItems(items);
    }
  }, [currentSignature, liveSignature]);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const elements = Array.from(node.querySelectorAll("[data-rank-key]"));
    const nextRects = new Map();
    elements.forEach((el) => nextRects.set(el.dataset.rankKey, el.getBoundingClientRect()));

    if (animateNextRef.current && !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      const oldRects = previousRectsRef.current;
      const mode = animationModeRef.current;
      const isReplay = mode === "replay";

      // Replay should feel like a slow ranking board settling into place.
      // Live results remain punchier, but are still smoother than before.
      const moveDuration = isReplay ? 1650 : 1050;
      const enterDuration = isReplay ? 1250 : 760;
      const easing = isReplay
        ? "cubic-bezier(.22,.72,.18,1)"
        : "cubic-bezier(.18,.82,.20,1)";

      // Estimate the vertical spacing of one ranking row.
      let rowPitch = 54;
      if (elements.length >= 2) {
        const a = nextRects.get(elements[0].dataset.rankKey);
        const b = nextRects.get(elements[1].dataset.rankKey);
        if (a && b && Math.abs(b.top - a.top) > 20) rowPitch = Math.abs(b.top - a.top);
      } else if (elements[0]) {
        const only = nextRects.get(elements[0].dataset.rankKey);
        if (only?.height) rowPitch = only.height + 2;
      }

      const baselineOrder = replayBaselineOrderRef.current || [];
      const finalOrder = displayedItems.map((p) => p.id);

      elements.forEach((el) => {
        const key = el.dataset.rankKey;
        const oldRect = oldRects.get(key);
        const newRect = nextRects.get(key);
        if (!newRect) return;

        let dy = 0;
        let hasOrigin = false;

        if (isReplay) {
          const oldIndex = baselineOrder.indexOf(key);
          const newIndex = finalOrder.indexOf(key);

          if (oldIndex >= 0 && newIndex >= 0) {
            // Visible baseline rows use their exact previous DOM position.
            // Someone who was below the displayed cutoff starts at the bottom edge.
            if (oldIndex < limit) {
              // Prefer the exact previous DOM coordinate when available, but
              // fall back to rank-index geometry for cards that were off-screen.
              dy = oldRect
                ? oldRect.top - newRect.top
                : (oldIndex - newIndex) * rowPitch;
            } else {
              // A climber that started below the displayed cutoff enters from
              // the bottom edge and travels upward to the rank they earned.
              const visualOldIndex = Math.max(0, limit - 1);
              dy = (visualOldIndex - newIndex) * rowPitch;
            }
            hasOrigin = true;
          }
        } else if (oldRect) {
          dy = oldRect.top - newRect.top;
          hasOrigin = true;
        }

        if (hasOrigin && Math.abs(dy) > 1) {
          el.animate(
            [
              {
                transform: `translate3d(0, ${dy}px, 0)`,
                zIndex: 4,
              },
              {
                transform: "translate3d(0, 0, 0)",
                zIndex: 4,
              },
            ],
            {
              duration: moveDuration,
              easing,
              fill: "both",
            }
          );

          if (!isReplay) {
            el.classList.add(dy > 0 ? "fx-live-up" : "fx-live-down");
          }
          return;
        }

        if (!hasOrigin && !isReplay) {
          // Only genuinely LIVE rows may use an entry animation. Historical
          // scroll-in replay never fades or lifts an entire list into view.
          const newIndex = Math.max(0, finalOrder.indexOf(key));
          const fromBottom = Math.max(
            rowPitch,
            (Math.max(0, limit - 1) - newIndex) * rowPitch
          );

          el.animate(
            [
              {
                opacity: 0.45,
                transform: `translate3d(0, ${fromBottom}px, 0)`,
                zIndex: 5,
              },
              {
                opacity: 1,
                transform: "translate3d(0, 0, 0)",
                zIndex: 5,
              },
            ],
            {
              duration: enterDuration,
              easing,
              fill: "both",
            }
          );
        }

        // Replay rule: no baseline origin = no movement. An unchanged competitor
        // also has dy === 0 and remains perfectly stationary.
      });

      (pulseEventsRef.current || []).forEach((event) => {
        const winner = node.querySelector(
          `[data-rank-key="${CSS.escape(event.winner_id)}"]`
        );

        if (winner) {
          winner.classList.add(
            event.type === "defense" ? "fx-defense" : "fx-takeover"
          );

          const currentWinner = displayedItems.find(
            (p) => p.id === event.winner_id
          );

          if (event.type === "takeover" && currentWinner?.rank === 1) {
            winner.classList.add("fx-champion");
          }
        }

        // Red displaced-row flashes are useful for one live match, but make a
        // 30-day replay visually noisy. Keep them live-only.
        if (!isReplay) {
          (event.displaced_ids || []).forEach((id) => {
            const displaced = node.querySelector(
              `[data-rank-key="${CSS.escape(id)}"]`
            );
            if (displaced) displaced.classList.add("fx-displaced");
          });
        }
      });

      const cleanupDelay = isReplay ? 2650 : 2450;
      const cleanup = setTimeout(() => {
        elements.forEach((el) =>
          el.classList.remove(
            "fx-live-up",
            "fx-live-down",
            "fx-takeover",
            "fx-defense",
            "fx-displaced",
            "fx-champion"
          )
        );
      }, cleanupDelay);

      setTimeout(() => clearTimeout(cleanup), cleanupDelay + 150);
    }

    previousRectsRef.current = nextRects;
    animateNextRef.current = false;
    animationModeRef.current = "none";
  }, [displayedItems]);

  return (
    <div ref={containerRef} className="animated-rank-list">
      {displayedItems.map((p) => (
        <div
          key={`${wc}:${p.id}`}
          data-rank-key={p.id}
          className={`rank-row ${getRowClass(p)}`}
          onClick={() => onSelect(p.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onSelect(p.id);
          }}
        >
          {renderRow(p)}
        </div>
      ))}
    </div>
  );
}


/* ===================== APP ===================== */
export default function App() {
  const [players, setPlayers] = useState([]);
  const [matches, setMatches] = useState([]);
  const [windowDays, setWindowDays] = useState(CONFIG.defaultWindowDays);
  const [showBadges, setShowBadges] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [armFilter, setArmFilter] = useState("All");
  const [selectedPlayerId, setSelectedPlayerId] = useState(null);
  const [showActivity, setShowActivity] = useState(true);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [dataIssues, setDataIssues] = useState([]);
  const [dataHealthMeta, setDataHealthMeta] = useState({ playerRows: 0, matchRows: 0 });
  const [issueFilter, setIssueFilter] = useState("All");
  const [adminMode, setAdminMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("admin") === "1";
  });
  const [matchEntryToken, setMatchEntryToken] = useState(initialMatchEntryToken);
  const matchEntryMode = Boolean(matchEntryToken);
  const [displayMode, setDisplayMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(`rank-display-mode:${CONFIG.branding.clubName}`) === "1";
  });
  const [initialReplayFrames, setInitialReplayFrames] = useState(null);
  const initialReplayFramesRef = useRef(null);
  const loadedMatchKeysRef = useRef(null);
  const [liveMatchKeys, setLiveMatchKeys] = useState([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(`rank-display-mode:${CONFIG.branding.clubName}`, displayMode ? "1" : "0");
  }, [displayMode]);

  async function loadAll() {
    setError("");

    try {
      const [pRows, mRows] = await Promise.all([
        fetchCsv(csvUrl(CONFIG.sheets.players)),
        fetchCsv(csvUrl(CONFIG.sheets.matches)),
      ]);

      // Validate the raw sheet rows before ranking parsing/fallbacks can hide data-entry problems.
      setDataIssues(validateClubData(pRows, mRows));
      setDataHealthMeta({ playerRows: pRows.length, matchRows: mRows.length });

      /* ---- Players ---- */
      const p = pRows.map((raw, idx) => {
        const r = normalizeRow(raw);
        let rawId = trim(gv(r, "id", "player id", "player_id"));
        let nm = trim(gv(r, "name", "display name", "display_name"));
        let wc = trim(gv(r, "weight class", "weight_class"));
        let act =
          trim(gv(r, "active", "currently active?", "currently active")) || "true";

        const injCol = trim(gv(r, "injured?", "injured", "injury"));
        const { injuredRight, injuredLeft } = parseInjury(injCol);

        const rawVals = Object.values(raw || {});

        let srRight = trim(
          gv(
            r,
            "starting rank rh",
            "starting rank right",
            "starting rank (right)",
            "start rh",
            "start_right",
            "start right",
            "rh rank",
            "rank rh",
            "right rank"
          )
        );
        let srLeft = trim(
          gv(
            r,
            "starting rank lh",
            "starting rank left",
            "starting rank (left)",
            "start lh",
            "start_left",
            "start left",
            "lh rank",
            "rank lh",
            "left rank"
          )
        );
        const srSingle = trim(gv(r, "starting rank", "current_rank"));

        // The Sydney Competitor sheet has the arm starting ranks in columns F and G.
        // Google/Papa can rename duplicate-looking CSV headers, so use the physical
        // column values as a robust fallback when an explicit RH/LH header was not
        // found. F = Right, G = Left.
        if (!srRight && rawVals.length > 5) srRight = trim(rawVals[5]);
        if (!srLeft && rawVals.length > 6) srLeft = trim(rawVals[6]);

        // Legacy one-column sheets remain supported if F/G are unavailable.
        if (!srRight) srRight = srSingle;
        if (!srLeft) srLeft = srSingle;

        if (!rawId && !nm && !wc) {
          const vals = Object.values(raw || {});
          rawId = trim(vals[0]);
          nm = trim(vals[1]) || rawId;
          wc = trim(vals[2]);
          act = trim(vals[3] ?? "true");
        }

        const safeId =
          rawId ||
          (nm
            ? nm
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "_")
                .replace(/^_|_$/g, "")
            : "") ||
          `anon_${idx}`;

        return {
          id: safeId,
          name: nm || safeId,
          weight_class: wc,
          active: yes(act),
          // Preserve physical Competitor-sheet order for deterministic unseeded placement.
          // idx 0 is the first data row beneath the header; larger idx = lower in sheet.
          _playerRowIndex: idx,
          injuredRight,
          injuredLeft,
          current_rank_rh: srRight || "",
          current_rank_lh: srLeft || "",
          current_rank: srSingle || "",
        };
      });

      /* ---- Matches (deterministic + Badge? support) ---- */
      const m = mRows
        .map((raw, rowIndex) => {
          const r = normalizeRow(raw);
          let date = trim(gv(r, "date", "DATE"));
          let time = trim(gv(r, "time", "timestamp", "datetime"));
          let seqStr = trim(gv(r, "seq", "order", "sequence"));
          let seq = seqStr && !isNaN(+seqStr) ? +seqStr : undefined;

          let wc = trim(gv(r, "weight class", "weight_class"));
          let win = trim(gv(r, "winner id", "winner_id"));
          let lose = trim(gv(r, "loser id", "loser_id", "looser id", "looser_id"));
          let arm = trim(gv(r, "arm?", "arm")).toLowerCase();

          const badgeCol = trim(gv(r, "badge?", "badge"));
          const badgeSuppressed = badgeCol !== "" && !yes(badgeCol);

          if (!date && !win && !lose) {
            const vals = Object.values(raw || {});
            date = trim(vals[0]);
            wc = trim(vals[1]);
            win = trim(vals[2]);
            lose = trim(vals[3]);
            arm = trim((vals[4] ?? "").toLowerCase());
          }

          arm = arm.startsWith("l") ? "Left" : arm.startsWith("r") ? "Right" : "";

          // Ranking order is based on the DATE column only. If multiple matches share
          // a date, their physical Google Sheet row order determines chronology.
          const dt = date;
          const dtParsed = parseDateTimeUTC(date);

          const stableKey = [
            dtParsed ? dtParsed.toISOString() : "na",
            win,
            lose,
            arm,
            wc,
            String(seq ?? ""),
            String(rowIndex),
          ].join("|");

          return {
            date,
            _dateTime: dt,
            _seq: seq,
            _rowIndex: rowIndex,
            _stableKey: stableKey,
            _parsedDate: dtParsed,
            _invalidDate: Boolean(date) && !dtParsed,
            weight_class: wc,
            winner_id: win,
            loser_id: lose,
            arm,
            _badgeSuppressed: badgeSuppressed,
          };
        })
        .filter((x) => x.date && x.arm && x.winner_id && x.loser_id);

      const nextMatchKeys = new Set(m.map((match) => match._stableKey));
      if (loadedMatchKeysRef.current === null) {
        setLiveMatchKeys([]);
      } else {
        const freshPublicKeys = m
          .filter((match) => !loadedMatchKeysRef.current.has(match._stableKey) && !match._badgeSuppressed)
          .map((match) => match._stableKey);
        setLiveMatchKeys(freshPublicKeys);
      }
      loadedMatchKeysRef.current = nextMatchKeys;

      if (!initialReplayFramesRef.current) {
        const frames = buildInitialRankReplayFrames(p, m);
        initialReplayFramesRef.current = frames;
        setInitialReplayFrames(frames);
      }

      setPlayers(p);
      setMatches(m);
      setLastUpdated(new Date());
    } catch (e) {
      console.error(e);
      setError(e?.message || "Could not load rankings data.");
    }
  }

  useEffect(() => {
    let pollInFlight = false;

    // Initial visible load.
    loadAll();

    // Keep the rankings silently up to date while the page is open.
    // Guard against overlapping requests if Google Sheets is slow.
    const refreshLive = async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        await loadAll();
      } finally {
        pollInFlight = false;
      }
    };

    const liveTimer = setInterval(refreshLive, CONFIG.livePollMs);

    return () => clearInterval(liveTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      setAdminMode(params.get("admin") === "1");
      setMatchEntryToken(params.get("match-entry") || "");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function setAdminPage(enabled) {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (enabled) url.searchParams.set("admin", "1");
    else url.searchParams.delete("admin");
    window.history.pushState({}, "", url);
    setAdminMode(enabled);
    setSelectedPlayerId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeMatchEntryPage() {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("match-entry");
    window.history.pushState({}, "", url);
    setMatchEntryToken("");
    setSelectedPlayerId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    if (!selectedPlayerId) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setSelectedPlayerId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedPlayerId]);

  // Compute the current ladders and the recent-visual window.
  // Movement arrows are now derived from NON-suppressed movement events rather
  // than raw rank snapshots, so Badge? = FALSE cannot create green/red arrows.
  const { nowData, cutoff } = useMemo(() => {
    const cutoffDate = new Date();
    cutoffDate.setHours(0, 0, 0, 0);
    cutoffDate.setDate(cutoffDate.getDate() - (showBadges ? windowDays : 36500));
    const now = computeLaddersThroughDate(players, matches, CONFIG.weightClasses, null);
    return { nowData: now, cutoff: cutoffDate };
  }, [players, matches, windowDays, showBadges]);

  const liveEventSet = useMemo(() => new Set(liveMatchKeys), [liveMatchKeys]);
  const liveEvents = useMemo(
    () => (nowData.eventLog || []).filter((event) => liveEventSet.has(event.matchKey)),
    [nowData.eventLog, liveEventSet]
  );

  const playerById = useMemo(
    () => new Map(players.map((p) => [p.id, p])),
    [players]
  );

  const ranksByPlayer = useMemo(() => {
    const map = new Map();
    Object.entries(nowData.ladders || {}).forEach(([wc, ladder]) => {
      ladder.forEach((p) => {
        if (!map.has(p.id)) map.set(p.id, []);
        map.get(p.id).push({ wc, rank: p.rank });
      });
    });
    map.forEach((arr) =>
      arr.sort((a, b) => {
        const armCmp = a.wc.endsWith(" Right") === b.wc.endsWith(" Right") ? 0 : a.wc.endsWith(" Right") ? -1 : 1;
        if (armCmp) return armCmp;
        return CONFIG.weightClasses.indexOf(a.wc) - CONFIG.weightClasses.indexOf(b.wc);
      })
    );
    return map;
  }, [nowData.ladders]);

  const sortedMatches = useMemo(
    () =>
      matches
        .filter((m) => m._parsedDate)
        .slice()
        .sort((a, b) => {
          const at = a._parsedDate.getTime();
          const bt = b._parsedDate.getTime();
          if (at !== bt) return at - bt;
          return (a._rowIndex ?? 0) - (b._rowIndex ?? 0);
        }),
    [matches]
  );

  // Public/competitor-facing match data excludes rows where Badge? = FALSE.
  // Those rows still replay through the ladder engine, but they must be invisible
  // in W-L records, arm records, streaks, recent-match history and public counts.
  const visibleMatches = useMemo(
    () => sortedMatches.filter((m) => !m._badgeSuppressed),
    [sortedMatches]
  );

  const playerStats = useMemo(() => {
    const map = new Map();
    players.forEach((p) =>
      map.set(p.id, {
        wins: 0,
        losses: 0,
        rightWins: 0,
        rightLosses: 0,
        leftWins: 0,
        leftLosses: 0,
        rightCurrentStreak: 0,
        rightBestStreak: 0,
        rightLastWinMs: 0,
        leftCurrentStreak: 0,
        leftBestStreak: 0,
        leftLastWinMs: 0,
        history: [],
        takeoverKeys: new Set(),
        defenseKeys: new Set(),
        biggestJump: 0,
      })
    );

    visibleMatches.forEach((m) => {
      const w = map.get(m.winner_id);
      const l = map.get(m.loser_id);

      if (w) {
        w.wins += 1;
        if (m.arm === "Right") {
          w.rightWins += 1;
          w.rightCurrentStreak += 1;
          w.rightBestStreak = Math.max(w.rightBestStreak, w.rightCurrentStreak);
          w.rightLastWinMs = m._parsedDate?.getTime?.() || w.rightLastWinMs || 0;
        }
        if (m.arm === "Left") {
          w.leftWins += 1;
          w.leftCurrentStreak += 1;
          w.leftBestStreak = Math.max(w.leftBestStreak, w.leftCurrentStreak);
          w.leftLastWinMs = m._parsedDate?.getTime?.() || w.leftLastWinMs || 0;
        }
        w.history.push({ ...m, result: "W", opponentId: m.loser_id });
      }
      if (l) {
        l.losses += 1;
        if (m.arm === "Right") {
          l.rightLosses += 1;
          l.rightCurrentStreak = 0;
        }
        if (m.arm === "Left") {
          l.leftLosses += 1;
          l.leftCurrentStreak = 0;
        }
        l.history.push({ ...m, result: "L", opponentId: m.winner_id });
      }
    });

    (nowData.eventLog || []).forEach((e) => {
      const s = map.get(e.winner_id);
      if (!s) return;
      if (e.type === "takeover") {
        s.takeoverKeys.add(e.matchKey);
        s.biggestJump = Math.max(s.biggestJump, e.jump || 0);
      }
      if (e.type === "defense") s.defenseKeys.add(e.matchKey);
    });

    return map;
  }, [players, visibleMatches, nowData.eventLog]);

  // One activity item per match/event type, aggregating every ladder affected by that win.
  const rankActivity = useMemo(() => {
    const grouped = new Map();
    (nowData.eventLog || []).forEach((e) => {
      const k = `${e.matchKey}:${e.type}:${e.winner_id}:${e.loser_id}`;
      if (!grouped.has(k)) {
        grouped.set(k, {
          ...e,
          classes: [],
          maxJump: 0,
        });
      }
      const item = grouped.get(k);
      item.classes.push(e.wc);
      item.maxJump = Math.max(item.maxJump, e.jump || 0);
    });

    return Array.from(grouped.values())
      .map((item) => ({
        ...item,
        classes: uniqueBy(item.classes, (x) => x),
      }))
      .sort((a, b) => b.when.getTime() - a.when.getTime());
  }, [nowData.eventLog]);

  // Net visible rank movement inside the selected recent window.
  // Suppressed matches never enter movementLog, so they can change the actual
  // rankings without creating either green upward or red downward arrows.
  const recentVisibleMovement = useMemo(() => {
    const map = new Map();
    if (!showBadges) return map;

    (nowData.movementLog || []).forEach((move) => {
      if (!move.when || move.when < cutoff) return;
      const key = `${move.wc}:${move.player_id}`;
      map.set(key, (map.get(key) || 0) + (move.delta || 0));
    });

    return map;
  }, [nowData.movementLog, cutoff, showBadges]);

  const visibleClasses = useMemo(
    () =>
      CONFIG.weightClasses.filter(
        (wc) => armFilter === "All" || wc.endsWith(` ${armFilter}`)
      ),
    [armFilter]
  );

  const activePlayers = players.filter((p) => p.active);

  const invalidDateCount = matches.filter((m) => m._invalidDate).length;
  const dataHealthCounts = useMemo(() => ({
    errors: dataIssues.filter((x) => x.severity === "error").length,
    warnings: dataIssues.filter((x) => x.severity === "warning").length,
  }), [dataIssues]);

  // Highest CURRENT arm-specific streak across active competitors.
  // Right and Left are intentionally independent: a loss only resets the streak
  // on the arm that actually lost. Ties are broken by the most recent win, then
  // by name for deterministic display.
  const highestCurrentStreak = useMemo(() => {
    const candidates = [];

    players.forEach((p) => {
      if (!p.active) return;
      const s = playerStats.get(p.id);
      if (!s) return;

      candidates.push({
        player: p,
        arm: "Right",
        streak: s.rightCurrentStreak || 0,
        lastWinMs: s.rightLastWinMs || 0,
      });
      candidates.push({
        player: p,
        arm: "Left",
        streak: s.leftCurrentStreak || 0,
        lastWinMs: s.leftLastWinMs || 0,
      });
    });

    candidates.sort((a, b) => {
      if (a.streak !== b.streak) return b.streak - a.streak;
      if (a.lastWinMs !== b.lastWinMs) return b.lastWinMs - a.lastWinMs;
      return (a.player?.name || "").localeCompare(b.player?.name || "");
    });

    return candidates[0]?.streak > 0 ? candidates[0] : null;
  }, [players, playerStats]);

  const selectedPlayer = selectedPlayerId ? playerById.get(selectedPlayerId) : null;
  const selectedRanks = selectedPlayer ? ranksByPlayer.get(selectedPlayer.id) || [] : [];
  const selectedStats = selectedPlayer ? playerStats.get(selectedPlayer.id) : null;
  const selectedCurrentArmStreak = selectedStats
    ? selectedStats.rightCurrentStreak >= selectedStats.leftCurrentStreak
      ? { arm: "Right", streak: selectedStats.rightCurrentStreak || 0 }
      : { arm: "Left", streak: selectedStats.leftCurrentStreak || 0 }
    : { arm: "Right", streak: 0 };
  const selectedChampionCount = selectedRanks.filter((r) => r.rank === 1).length;
  const selectedRecentHistory = selectedStats
    ? selectedStats.history.slice().reverse().slice(0, 8)
    : [];

  const gold = "#f5c542";
  const green = "#34d399";
  const red = "#fb7185";
  const bgOverlay = CONFIG.branding.backgroundImage
    ? `linear-gradient(180deg, rgba(5,8,18,.82) 0%, rgba(7,11,25,.9) 58%, rgba(5,8,18,.96) 100%), url(${CONFIG.branding.backgroundImage})`
    : "#070b19";

  const pageStyle = {
    minHeight: "100vh",
    background: bgOverlay,
    color: "white",
    padding: "clamp(14px, 2vw, 26px)",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundAttachment: "fixed",
  };

  const glass = {
    border: "1px solid rgba(255,255,255,.12)",
    background: "linear-gradient(180deg, rgba(255,255,255,.085), rgba(255,255,255,.045))",
    boxShadow: "0 18px 55px rgba(0,0,0,.28)",
    backdropFilter: "blur(14px)",
  };

  const button = {
    padding: "9px 12px",
    borderRadius: 11,
    border: "1px solid rgba(255,255,255,.16)",
    background: "rgba(255,255,255,.07)",
    color: "white",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 13,
    transition: "transform .18s ease, background .18s ease, border-color .18s ease",
  };

  const pill = {
    padding: "5px 9px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,.12)",
    background: "rgba(255,255,255,.055)",
    fontSize: 12,
  };

  const statCard = {
    ...glass,
    borderRadius: 16,
    padding: "12px 14px",
    minWidth: 130,
    flex: "1 1 130px",
  };

  const cardStyle = {
    ...glass,
    borderRadius: 20,
    overflow: "hidden",
    minWidth: 0,
  };

  function photoForPlayer(id) {
    return CONFIG.photos.byPlayerId[id] || "";
  }

  const searchLower = searchTerm.trim().toLowerCase();


  if (matchEntryMode) {
    return (
      <MatchEntryPage
        players={players}
        accessToken={matchEntryToken}
        onBack={closeMatchEntryPage}
        onReload={loadAll}
        pageStyle={pageStyle}
        glass={glass}
        button={button}
        pill={pill}
        green={green}
      />
    );
  }

  if (adminMode) {
    const filteredIssues = dataIssues.filter((issue) =>
      issueFilter === "All" || (issueFilter === "Errors" && issue.severity === "error") || (issueFilter === "Warnings" && issue.severity === "warning")
    );

    return (
      <div style={pageStyle}>
        <style>{`
          * { box-sizing: border-box; }
          button { font: inherit; }
          .admin-shell { max-width: 1180px; margin: 0 auto; }
          .admin-grid { display:grid; grid-template-columns:repeat(4,minmax(150px,1fr)); gap:10px; }
          .issue-card { border-radius:15px; padding:14px; background:rgba(255,255,255,.055); border:1px solid rgba(255,255,255,.1); }
          .issue-card + .issue-card { margin-top:9px; }
          @media (max-width:760px) { .admin-grid { grid-template-columns:1fr 1fr; } }
        `}</style>

        <div className="admin-shell">
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap", marginBottom:16 }}>
            <div>
              <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                <h1 style={{ margin:0, fontSize:"clamp(25px,4vw,36px)", letterSpacing:-0.7 }}>Data Health</h1>
                <span style={{ ...pill, color: green, borderColor:"rgba(52,211,153,.28)", background:"rgba(52,211,153,.07)" }}>● LIVE · auto checks</span>
              </div>
              <div style={{ opacity:.65, fontSize:13, marginTop:4 }}>{CONFIG.branding.clubName} · Admin diagnostics</div>
            </div>
            <button className="control" style={button} onClick={() => setAdminPage(false)}>← Back to rankings</button>
          </div>

          {error && (
            <div style={{ ...glass, borderRadius:14, padding:12, marginBottom:14, borderColor:"rgba(251,113,133,.45)", color:"#fecdd3" }}>
              <strong>Sheet connection issue:</strong> {error}
            </div>
          )}

          <div className="admin-grid" style={{ marginBottom:14 }}>
            <div style={{ ...statCard, borderColor: dataHealthCounts.errors ? "rgba(251,113,133,.4)" : "rgba(52,211,153,.25)" }}>
              <div style={{ fontSize:11, opacity:.62, textTransform:"uppercase", letterSpacing:1 }}>Errors</div>
              <div style={{ fontSize:27, fontWeight:950, marginTop:2, color:dataHealthCounts.errors ? "#fda4af" : green }}>● {dataHealthCounts.errors}</div>
            </div>
            <div style={{ ...statCard, borderColor: dataHealthCounts.warnings ? "rgba(251,191,36,.35)" : "rgba(52,211,153,.25)" }}>
              <div style={{ fontSize:11, opacity:.62, textTransform:"uppercase", letterSpacing:1 }}>Warnings</div>
              <div style={{ fontSize:27, fontWeight:950, marginTop:2, color:dataHealthCounts.warnings ? "#fde68a" : green }}>● {dataHealthCounts.warnings}</div>
            </div>
            <div style={statCard}>
              <div style={{ fontSize:11, opacity:.62, textTransform:"uppercase", letterSpacing:1 }}>Competitors checked</div>
              <div style={{ fontSize:27, fontWeight:950, marginTop:2 }}>{dataHealthMeta.playerRows}</div>
            </div>
            <div style={statCard}>
              <div style={{ fontSize:11, opacity:.62, textTransform:"uppercase", letterSpacing:1 }}>Matches checked</div>
              <div style={{ fontSize:27, fontWeight:950, marginTop:2 }}>{dataHealthMeta.matchRows}</div>
            </div>
          </div>

          <div style={{ ...glass, borderRadius:16, padding:13, marginBottom:14 }}>
            <div style={{ display:"flex", justifyContent:"space-between", gap:12, flexWrap:"wrap", alignItems:"center" }}>
              <div>
                <div style={{ fontWeight:850 }}>Validation rules</div>
                <div style={{ opacity:.62, fontSize:12, marginTop:3 }}>{CONFIG.validation.dateHelp}</div>
                <div style={{ opacity:.5, fontSize:11, marginTop:3 }}>Starting-rank/seed fields and blank Badge? cells are intentionally not checked.</div>
              </div>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                {["All", "Errors", "Warnings"].map((f) => (
                  <button key={f} className="control" style={{ ...button, ...(issueFilter === f ? { borderColor:"rgba(245,197,66,.55)", color:"#ffe792", background:"rgba(245,197,66,.11)" } : {}) }} onClick={() => setIssueFilter(f)}>
                    {f}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {dataIssues.length === 0 ? (
            <div style={{ ...glass, borderRadius:18, padding:"28px 20px", textAlign:"center", borderColor:"rgba(52,211,153,.3)" }}>
              <div style={{ fontSize:34 }}>✅</div>
              <div style={{ fontSize:20, fontWeight:900, marginTop:7 }}>All clear</div>
              <div style={{ opacity:.62, fontSize:13, marginTop:5 }}>No data-entry errors or warnings were found in the current sheets or photo configuration.</div>
            </div>
          ) : filteredIssues.length === 0 ? (
            <div style={{ ...glass, borderRadius:16, padding:18, textAlign:"center", opacity:.72 }}>No issues in this filter.</div>
          ) : (
            <div>
              {filteredIssues.map((issue) => {
                const isError = issue.severity === "error";
                const sheetKey = issue.source === "Players" ? "players" : issue.source === "Matches" ? "matches" : null;
                const location = issue.source === "Code"
                  ? (issue.codeLocation || issue.field)
                  : `${issue.source === "Players" ? "Competitor sheet" : "Match sheet"} · Row ${issue.row}`;
                return (
                  <div className="issue-card" key={issue.id} style={{ borderColor:isError ? "rgba(251,113,133,.32)" : "rgba(251,191,36,.28)" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
                      <div style={{ minWidth:0, flex:1 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                          <span style={{ ...pill, padding:"3px 7px", color:isError ? "#fecdd3" : "#fde68a", borderColor:isError ? "rgba(251,113,133,.34)" : "rgba(251,191,36,.3)", background:isError ? "rgba(251,113,133,.08)" : "rgba(251,191,36,.07)" }}>
                            {isError ? "🔴 ERROR" : "🟠 WARNING"}
                          </span>
                          <strong style={{ fontSize:14 }}>{issue.message}</strong>
                        </div>
                        <div style={{ marginTop:7, fontSize:12, fontWeight:800, color:"#cbd5e1" }}>{location} · {issue.field}</div>
                        {issue.value && <div style={{ marginTop:5, fontSize:12, opacity:.72 }}>Current value: <code style={{ color:"white", background:"rgba(0,0,0,.22)", padding:"2px 5px", borderRadius:5 }}>{issue.value}</code></div>}
                        {issue.fix && <div style={{ marginTop:6, fontSize:12.5, lineHeight:1.45, opacity:.8 }}><strong>Fix:</strong> {issue.fix}</div>}
                      </div>
                      {sheetKey && issue.row && (
                        <a href={sheetEditUrl(sheetKey, issue.row)} target="_blank" rel="noreferrer" style={{ ...button, textDecoration:"none", alignSelf:"flex-start", whiteSpace:"nowrap" }}>
                          Open row ↗
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ opacity:.45, fontSize:11, marginTop:14, textAlign:"center" }}>
            Last checked {lastUpdated ? formatTimeLocal(lastUpdated) : "—"} · refreshes every {Math.round(CONFIG.livePollMs / 1000)} seconds
          </div>
        </div>
      </div>
    );
  }


  return (
    <div style={pageStyle}>
      <style>{`
        * { box-sizing: border-box; }
        button, input { font: inherit; }
        .rank-shell { max-width: 1680px; margin: 0 auto; }
        .topbar { display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-bottom:14px; }
        .brand-logo { width:64px; height:64px; border-radius:16px; object-fit:cover; box-shadow:0 12px 35px rgba(0,0,0,.35); }
        .control:hover { transform:translateY(-1px); background:rgba(255,255,255,.11)!important; border-color:rgba(255,255,255,.25)!important; }
        .arm-btn.active { background:rgba(245,197,66,.15)!important; border-color:rgba(245,197,66,.55)!important; color:#ffe792!important; }
        .rank-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(330px,1fr)); gap:18px; align-items:start; }
        .rank-card { animation:cardIn .42s ease both; transition:transform .2s ease, border-color .2s ease, box-shadow .2s ease; }
        .rank-card:hover { transform:translateY(-2px); border-color:rgba(255,255,255,.2)!important; box-shadow:0 22px 65px rgba(0,0,0,.34)!important; }
        .rank-row { position:relative; display:flex; gap:12px; padding:10px 12px; align-items:center; border-radius:13px; cursor:pointer; transition:transform .18s ease, background .18s ease, box-shadow .18s ease; }
        .rank-row + .rank-row { margin-top:2px; }
        .rank-row:hover { transform:translateX(3px); background:rgba(255,255,255,.075); }
        .rank-row.champion { background:linear-gradient(90deg,rgba(245,197,66,.14),rgba(245,197,66,.035)); border:1px solid rgba(245,197,66,.18); }
        .rank-row.silver { background:linear-gradient(90deg,rgba(210,214,224,.11),rgba(210,214,224,.03)); border:1px solid rgba(210,214,224,.16); }
        .rank-row.bronze { background:linear-gradient(90deg,rgba(191,131,92,.11),rgba(191,131,92,.03)); border:1px solid rgba(191,131,92,.16); }
        .rank-row.recent { animation:recentGlow 1.15s ease-out both; }

        .animated-rank-list { position:relative; }
        .animated-rank-list .rank-row { will-change:transform; backface-visibility:hidden; transform:translateZ(0); }
        .rank-row.fx-live-up { box-shadow:inset 0 0 0 1px rgba(52,211,153,.48), 0 0 24px rgba(52,211,153,.14); }
        .rank-row.fx-live-down, .rank-row.fx-displaced { box-shadow:inset 0 0 0 1px rgba(251,113,133,.30), 0 0 16px rgba(251,113,133,.07); }
        .rank-row.fx-takeover { overflow:hidden; animation:takeoverImpact 2.35s ease-out both!important; }
        .rank-row.fx-takeover::after { content:""; position:absolute; z-index:8; pointer-events:none; width:52%; height:220%; top:-60%; left:-70%; transform:rotate(-18deg); background:linear-gradient(90deg,transparent,var(--rank-fx-slash,rgba(52,211,153,.95)),rgba(255,255,255,.9),transparent); filter:blur(.4px); opacity:0; animation:rankSlash 1.05s cubic-bezier(.2,.78,.18,1) both; }
        .rank-row.fx-defense { animation:defenseImpact 2.4s ease-out both!important; }
        .rank-row.fx-champion { animation:championImpact 1.25s ease-out both!important; }
        .rank-row.fx-champion .rank-num { animation:crownPop .9s cubic-bezier(.18,.9,.24,1.35) both; }
        .rank-shell.theme-newcastle { --rank-fx-slash:rgba(34,211,238,.98); --rank-fx-glow:rgba(52,211,153,.26); }
        .rank-shell.theme-sydney { --rank-fx-slash:rgba(245,197,66,.98); --rank-fx-glow:rgba(52,211,153,.22); }
        .display-mode-toggle { margin:18px auto 2px; width:max-content; max-width:100%; display:flex; align-items:center; gap:9px; padding:7px 10px; border-radius:999px; border:1px solid rgba(255,255,255,.10); background:rgba(5,9,20,.50); color:rgba(255,255,255,.62); font-size:10.5px; }
        .display-mode-toggle input { accent-color:#f5c542; }
        @keyframes rankSlash { 0% { left:-70%; opacity:0; } 16% { opacity:.9; } 72% { opacity:.65; } 100% { left:125%; opacity:0; } }
        @keyframes takeoverImpact { 0% { box-shadow:0 0 0 0 rgba(52,211,153,0); } 18% { box-shadow:inset 0 0 0 1px rgba(245,197,66,.72),0 0 38px rgba(52,211,153,.28); } 58% { box-shadow:inset 0 0 0 1px rgba(52,211,153,.42),0 0 28px rgba(52,211,153,.18); } 100% { box-shadow:none; } }
        @keyframes defenseImpact { 0% { box-shadow:0 0 0 0 rgba(226,232,240,0); } 18% { box-shadow:inset 0 0 0 2px rgba(241,245,249,.92),0 0 38px rgba(226,232,240,.28); } 58% { box-shadow:inset 0 0 0 1px rgba(203,213,225,.55),0 0 28px rgba(226,232,240,.16); } 100% { box-shadow:none; } }
        @keyframes championImpact { 0% { box-shadow:0 0 0 0 rgba(245,197,66,0); } 30% { box-shadow:inset 0 0 0 1px rgba(245,197,66,.92),0 0 46px rgba(245,197,66,.32); } 100% { box-shadow:none; } }
        @keyframes crownPop { 0% { transform:scale(1); } 38% { transform:scale(1.35) rotate(-5deg); } 68% { transform:scale(.96) rotate(2deg); } 100% { transform:scale(1); } }
        .rank-num { width:32px; height:32px; display:grid; place-items:center; border-radius:10px; font-weight:900; background:rgba(255,255,255,.055); flex:0 0 32px; }
        .rank-row.champion .rank-num { color:#ffe792; background:rgba(245,197,66,.13); }
        .rank-row.silver .rank-num { color:#eef2ff; background:rgba(210,214,224,.12); }
        .rank-row.bronze .rank-num { color:#f2d3bd; background:rgba(191,131,92,.12); }
        .champ-photo { width:66px; height:66px; border-radius:50%; object-fit:cover; border:2px solid rgba(245,197,66,.88); box-shadow:0 0 0 4px rgba(245,197,66,.10), 0 8px 25px rgba(0,0,0,.32); }
        .activity-item { display:grid; grid-template-columns:34px 1fr auto; gap:10px; align-items:start; padding:10px 0; }
        .activity-item + .activity-item { border-top:1px solid rgba(255,255,255,.08); }
        .drawer-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.58); z-index:50; animation:fadeIn .16s ease both; }
        .player-drawer { position:absolute; top:0; right:0; width:min(460px,94vw); min-height:100%; background:linear-gradient(180deg,#11182c,#0a1020); border-left:1px solid rgba(255,255,255,.12); padding:20px; box-shadow:-20px 0 70px rgba(0,0,0,.48); animation:drawerIn .24s ease both; }
        .drawer-rank { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:9px 11px; border-radius:11px; background:rgba(255,255,255,.05); }
        .drawer-rank + .drawer-rank { margin-top:6px; }
        .search-input::placeholder { color:rgba(255,255,255,.48); }
        .search-input:focus { outline:none; border-color:rgba(245,197,66,.5)!important; box-shadow:0 0 0 3px rgba(245,197,66,.08); }
        @keyframes cardIn { from { opacity:0; transform:translateY(9px); } to { opacity:1; transform:none; } }
        @keyframes recentGlow { 0% { box-shadow:inset 0 0 0 1px rgba(52,211,153,.55), 0 0 24px rgba(52,211,153,.14); } 100% { box-shadow:none; } }
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
        @keyframes drawerIn { from { opacity:0; transform:translateX(32px); } to { opacity:1; transform:none; } }
        @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration:.001ms!important; animation-iteration-count:1!important; transition-duration:.001ms!important; } }
        @media (max-width: 760px) {
          .rank-grid { grid-template-columns:1fr; gap:14px; }
          .brand-logo { width:54px; height:54px; }
          .desktop-subtitle { font-size:12px!important; }
          .activity-layout { grid-template-columns:1fr!important; }
        }
      `}</style>

      <div className="rank-shell theme-sydney">
        <div className="topbar">
          {CONFIG.branding.logoUrl && (
            <img src={CONFIG.branding.logoUrl} alt="logo" className="brand-logo" />
          )}

          <div style={{ minWidth: 220 }}>
            <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
              <h1 style={{ fontSize: "clamp(25px,3vw,34px)", fontWeight: 950, margin: 0, letterSpacing: -0.7 }}>
                {CONFIG.branding.clubName}
              </h1>
              <span style={{ ...pill, color: "#ffe792", borderColor: "rgba(245,197,66,.3)" }}>RANKINGS</span>
              <span style={{ ...pill, color: green, borderColor: "rgba(52,211,153,.28)", background: "rgba(52,211,153,.07)" }}>● LIVE · auto updates</span>
            </div>
            <div className="desktop-subtitle" style={{ marginTop: 3, opacity: 0.72, fontSize: 13 }}>
              Live Sydney Ranks • Check out competitor profiles 
            </div>
          </div>

          <button
            className="control"
            style={{ ...button, marginLeft: "auto", opacity: 0.72 }}
            onClick={() => setAdminPage(true)}
            title="Open data health diagnostics"
          >
            ⚙ Data health{dataHealthCounts.errors > 0 ? ` · ${dataHealthCounts.errors}` : ""}
          </button>

        </div>

        {error && (
          <div style={{ ...glass, borderRadius: 14, padding: 12, marginBottom: 14, borderColor: "rgba(251,113,133,.45)", color: "#fecdd3" }}>
            <strong>Live update issue:</strong> {error}
          </div>
        )}

        {invalidDateCount > 0 && (
          <div style={{ ...glass, borderRadius: 14, padding: 12, marginBottom: 14, borderColor: "rgba(251,191,36,.4)", color: "#fde68a" }}>
            {invalidDateCount} match {invalidDateCount === 1 ? "row has" : "rows have"} an invalid date and {invalidDateCount === 1 ? "is" : "are"} being ignored. Use DD/MM/YYYY.
          </div>
        )}

        {/* Headline stats */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <div style={statCard}>
            <div style={{ fontSize: 11, opacity: 0.62, textTransform: "uppercase", letterSpacing: 1 }}>Active members</div>
            <div style={{ fontSize: 24, fontWeight: 900, marginTop: 2 }}>{activePlayers.length}</div>
          </div>
          <div style={statCard}>
            <div style={{ fontSize: 11, opacity: 0.62, textTransform: "uppercase", letterSpacing: 1 }}>Recorded matches</div>
            <div style={{ fontSize: 24, fontWeight: 900, marginTop: 2 }}>{visibleMatches.length}</div>
          </div>
          <div
            style={{ ...statCard, cursor: highestCurrentStreak ? "pointer" : "default" }}
            onClick={() => highestCurrentStreak && setSelectedPlayerId(highestCurrentStreak.player.id)}
            title={highestCurrentStreak ? `Open ${highestCurrentStreak.player.name}'s profile` : undefined}
          >
            <div style={{ fontSize: 11, opacity: 0.62, textTransform: "uppercase", letterSpacing: 1 }}>Current highest streak</div>
            {highestCurrentStreak ? (
              <>
                <div style={{ fontSize: 22, fontWeight: 950, marginTop: 2, color: "#fde68a", whiteSpace: "nowrap" }}>🔥 {highestCurrentStreak.streak}</div>
                <div style={{ fontSize: 11.5, opacity: 0.78, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {highestCurrentStreak.player.name} · {highestCurrentStreak.arm}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 18, fontWeight: 850, marginTop: 5 }}>—</div>
            )}
          </div>
          <div style={statCard}>
            <div style={{ fontSize: 11, opacity: 0.62, textTransform: "uppercase", letterSpacing: 1 }}>Last update</div>
            <div style={{ fontSize: 18, fontWeight: 850, marginTop: 5 }}>{lastUpdated ? formatTimeLocal(lastUpdated) : "—"}</div>
          </div>
        </div>

        {/* Controls */}
        <div style={{ ...glass, borderRadius: 16, padding: 10, marginBottom: 14, display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <input
            className="search-input"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search a competitor…"
            style={{
              minWidth: 210,
              flex: "1 1 250px",
              padding: "9px 11px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,.14)",
              background: "rgba(0,0,0,.18)",
              color: "white",
              transition: "border-color .18s ease, box-shadow .18s ease",
            }}
          />

          <div style={{ display: "flex", gap: 6 }}>
            {["All", "Right", "Left"].map((arm) => (
              <button
                key={arm}
                className={`control arm-btn ${armFilter === arm ? "active" : ""}`}
                style={button}
                onClick={() => setArmFilter(arm)}
              >
                {arm}
              </button>
            ))}
          </div>

          <label style={{ ...pill, display: "inline-flex", gap: 7, alignItems: "center" }}>
            <input type="checkbox" checked={showBadges} onChange={(e) => setShowBadges(e.target.checked)} />
            Recent badges
          </label>

          <label style={{ ...pill, display: "inline-flex", gap: 6, alignItems: "center" }}>
            Window
            <input
              type="number"
              min={0}
              value={windowDays}
              onChange={(e) => setWindowDays(Math.max(0, parseInt(e.target.value || "0", 10)))}
              style={{
                width: 54,
                padding: "3px 5px",
                borderRadius: 7,
                border: "1px solid rgba(255,255,255,.15)",
                background: "rgba(0,0,0,.18)",
                color: "white",
              }}
            />
            days
          </label>
        </div>

        {/* Legend */}
        <div style={{ marginBottom: 14, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", opacity: 0.92 }}>
          <span style={pill}><span style={{ color: gold }}>★</span> takeover</span>
          <span style={pill}>🛡️ defense</span>
          <span style={pill}><span style={{ color: green }}>↑</span> moved up</span>
          <span style={pill}><span style={{ color: red }}>↓</span> displaced</span>
          <span style={{ opacity: 0.55, fontSize: 11 }}>Click any competitor for full details.</span>
        </div>

        {/* Recent activity */}
        <section style={{ ...cardStyle, marginBottom: 18 }}>
          <button
            onClick={() => setShowActivity((v) => !v)}
            style={{
              width: "100%",
              border: 0,
              background: "transparent",
              color: "white",
              padding: "13px 15px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              textAlign: "left",
            }}
          >
            <div>
              <div style={{ fontWeight: 850 }}>Recent activity</div>
              <div style={{ fontSize: 11, opacity: 0.58, marginTop: 2 }}>Recent rank changes and successful defenses across every affected class</div>
            </div>
            <span style={{ opacity: 0.65 }}>{showActivity ? "Hide ▲" : "Show ▼"}</span>
          </button>

          {showActivity && (
            <div style={{ padding: "0 15px 12px" }}>
              {rankActivity.length === 0 ? (
                <div style={{ padding: "12px 0", opacity: 0.6 }}>No recent activity recorded yet.</div>
              ) : (
                rankActivity.slice(0, 6).map((item) => {
                  const winner = playerById.get(item.winner_id);
                  const loser = playerById.get(item.loser_id);
                  const affected = item.classes.map(classWithoutArm);
                  const uniqueAffected = uniqueBy(affected, (x) => x);
                  return (
                    <div className="activity-item" key={`${item.matchKey}:${item.type}`}>
                      <div style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: item.type === "takeover" ? "rgba(245,197,66,.13)" : "rgba(52,211,153,.11)" }}>
                        {item.type === "takeover" ? <span style={{ color: gold }}>★</span> : "🛡️"}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, lineHeight: 1.45 }}>
                          <strong>{winner?.name || item.winner_id}</strong>{" "}
                          {item.type === "takeover" ? "took rank from" : "defended against"}{" "}
                          <strong>{loser?.name || item.loser_id}</strong>
                          {item.type === "takeover" && item.maxJump > 0 && (
                            <span style={{ color: green, fontWeight: 800 }}> · ↑ {item.maxJump}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, opacity: 0.58, marginTop: 2 }}>
                          {item.arm} · {uniqueAffected.join(", ")}
                        </div>
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.55, whiteSpace: "nowrap" }}>{formatDateAU(item.when)}</div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>

        {/* Ranking cards */}
        <div className="rank-grid">
          {visibleClasses.map((wc, cardIndex) => {
            const fullLadder = nowData.ladders[wc] || [];
            const filtered = searchLower
              ? fullLadder.filter((p) => p.name.toLowerCase().includes(searchLower))
              : fullLadder.slice(0, 15);
            const champion = fullLadder[0];
            const champPhoto = champion ? photoForPlayer(champion.id) : "";
            const lastActivity = nowData.lastLadderActivityMap.get(wc) || null;

            return (
              <section
                key={wc}
                className="rank-card"
                style={{ ...cardStyle, animationDelay: `${Math.min(cardIndex * 35, 280)}ms` }}
              >
                <div style={{ padding: "13px 14px", borderBottom: "1px solid rgba(255,255,255,.09)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 17, fontWeight: 900, letterSpacing: -0.2 }}>{prettyClassLabel(wc)}</div>
                      <div style={{ fontSize: 10.5, opacity: 0.5, marginTop: 3 }}>
                        {lastActivity ? `Last activity ${formatDateAU(lastActivity)}` : "No recorded activity"}
                      </div>
                    </div>

                    {champion && (
                      <button
                        onClick={() => setSelectedPlayerId(champion.id)}
                        title={`Current #1: ${champion.name}`}
                        style={{ border: 0, background: "transparent", color: "white", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 9, textAlign: "right" }}
                      >
                        <div>
                          <div style={{ fontSize: 9.5, letterSpacing: 1.1, color: "#ffe792", fontWeight: 850 }}>👑 CHAMPION</div>
                          <div style={{ fontSize: 13, fontWeight: 850, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{champion.name}</div>
                        </div>
                        {champPhoto ? (
                          <img src={champPhoto} alt={champion.name} className="champ-photo" />
                        ) : (
                          <div className="champ-photo" style={{ display: "grid", placeItems: "center", background: "rgba(255,255,255,.07)", fontSize: 20 }}>👑</div>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ padding: 8 }}>
                  {filtered.length === 0 ? (
                    <div style={{ padding: "18px 12px", opacity: 0.55, textAlign: "center", fontSize: 13 }}>
                      No matching competitor in this class.
                    </div>
                  ) : (
                    <AnimatedRankRows
                      wc={wc}
                      items={filtered}
                      replayFrames={searchLower ? [] : (initialReplayFrames?.[wc] || [])}
                      displayMode={displayMode}
                      limit={15}
                      liveEvents={liveEvents.filter((event) => event.wc === wc)}
                      onSelect={setSelectedPlayerId}
                      getRowClass={(p) => {
                        const key = `${wc}:${p.id}`;
                        const movement = recentVisibleMovement.get(key) || 0;
                        const takeoverWhen = nowData.lastTakeoverMap.get(key) || null;
                        const defenseWhen = nowData.lastDefenseMap.get(key) || null;
                        const isRecentTakeover = Boolean(showBadges && takeoverWhen && takeoverWhen >= cutoff);
                        const isRecentDefense = Boolean(showBadges && defenseWhen && defenseWhen >= cutoff);
                        const recent = isRecentTakeover || isRecentDefense || movement !== 0;
                        return `${p.rank === 1 ? "champion" : p.rank === 2 ? "silver" : p.rank === 3 ? "bronze" : ""} ${recent ? "recent" : ""}`;
                      }}
                      renderRow={(p) => {
                        const key = `${wc}:${p.id}`;
                        const movement = recentVisibleMovement.get(key) || 0;
                        const takeoverWhen = nowData.lastTakeoverMap.get(key) || null;
                        const defenseWhen = nowData.lastDefenseMap.get(key) || null;
                        const isRecentTakeover = Boolean(showBadges && takeoverWhen && takeoverWhen >= cutoff);
                        const isRecentDefense = Boolean(showBadges && defenseWhen && defenseWhen >= cutoff);
                        return (
                          <>
                            <div className="rank-num">{p.rank === 1 ? "👑" : p.rank}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
                                <span style={{ fontWeight: 820, letterSpacing: 0.1, overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                                {isRecentTakeover && <span title="Took rank" style={{ color: gold }}>★</span>}
                                {isRecentDefense && <span title="Defended">🛡️</span>}
                                {showBadges && movement > 0 && (
                                  <span title={`Up ${movement} from visible ranking matches in selected window`} style={{ color: green, fontSize: 11, fontWeight: 900 }}>↑ {movement}</span>
                                )}
                                {showBadges && movement < 0 && (
                                  <span title={`Down ${Math.abs(movement)} from visible ranking matches in selected window`} style={{ color: red, fontSize: 11, fontWeight: 850 }}>↓ {Math.abs(movement)}</span>
                                )}
                              </div>
                              <div style={{ fontSize: 10.5, opacity: 0.52, marginTop: 2 }}>Base · {prettyBaseLabel(p.weight_class)}</div>
                            </div>
                            <div style={{ opacity: 0.35, fontSize: 16 }}>›</div>
                          </>
                        );
                      }}
                    />
                  )}
                </div>
              </section>
            );
          })}
        </div>

        <label className="display-mode-toggle" title="Display Mode skips the 30-day replay when this page is opened; genuinely new live results still animate.">
          <input
            type="checkbox"
            checked={displayMode}
            onChange={(e) => setDisplayMode(e.target.checked)}
          />
          <span><strong style={{ color: "rgba(255,255,255,.78)" }}>Display Mode</strong> · live animations only</span>
        </label>
      </div>

      {/* Competitor profile drawer */}
      {selectedPlayer && (
        <div className="drawer-backdrop" onClick={() => setSelectedPlayerId(null)}>
          <aside className="player-drawer" onClick={(e) => e.stopPropagation()} aria-label={`${selectedPlayer.name} profile`}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <div style={{ display: "flex", gap: 13, alignItems: "center", minWidth: 0 }}>
                {photoForPlayer(selectedPlayer.id) ? (
                  <img src={photoForPlayer(selectedPlayer.id)} alt={selectedPlayer.name} style={{ width: 76, height: 76, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(255,255,255,.28)" }} />
                ) : (
                  <div style={{ width: 76, height: 76, borderRadius: "50%", display: "grid", placeItems: "center", background: "rgba(255,255,255,.07)", fontSize: 29 }}>⚔️</div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 23, fontWeight: 950, letterSpacing: -0.5, overflow: "hidden", textOverflow: "ellipsis" }}>{selectedPlayer.name}</div>
                  <div style={{ opacity: 0.62, marginTop: 2, fontSize: 12 }}>Base category · {prettyBaseLabel(selectedPlayer.weight_class)}</div>
                  {selectedChampionCount > 0 && (
                    <div style={{ color: "#ffe792", marginTop: 5, fontSize: 12, fontWeight: 800 }}>👑 Champion in {selectedChampionCount} class{selectedChampionCount === 1 ? "" : "es"}</div>
                  )}
                </div>
              </div>
              <button className="control" style={{ ...button, padding: "6px 9px" }} onClick={() => setSelectedPlayerId(null)} aria-label="Close profile">✕</button>
            </div>

            {(selectedPlayer.injuredRight || selectedPlayer.injuredLeft) && (
              <div style={{ marginTop: 12, padding: "8px 10px", borderRadius: 10, background: "rgba(251,191,36,.09)", border: "1px solid rgba(251,191,36,.22)", color: "#fde68a", fontSize: 12 }}>
                Injury status: {selectedPlayer.injuredRight && selectedPlayer.injuredLeft ? "Both arms" : selectedPlayer.injuredRight ? "Right arm" : "Left arm"}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 16 }}>
              <div style={{ ...glass, borderRadius: 12, padding: 10 }}>
                <div style={{ opacity: 0.55, fontSize: 10, textTransform: "uppercase" }}>Record</div>
                <div style={{ fontSize: 20, fontWeight: 900, marginTop: 3 }}>{selectedStats?.wins || 0}-{selectedStats?.losses || 0}</div>
              </div>
              <div style={{ ...glass, borderRadius: 12, padding: 10 }}>
                <div style={{ opacity: 0.55, fontSize: 10, textTransform: "uppercase" }}>Takeovers</div>
                <div style={{ fontSize: 20, fontWeight: 900, marginTop: 3 }}>{selectedStats?.takeoverKeys?.size || 0}</div>
              </div>
              <div style={{ ...glass, borderRadius: 12, padding: 10 }}>
                <div style={{ opacity: 0.55, fontSize: 10, textTransform: "uppercase" }}>Defenses</div>
                <div style={{ fontSize: 20, fontWeight: 900, marginTop: 3 }}>{selectedStats?.defenseKeys?.size || 0}</div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
              <div style={{ ...glass, borderRadius: 12, padding: 10 }}>
                <div style={{ opacity: 0.55, fontSize: 10, textTransform: "uppercase" }}>Right arm</div>
                <div style={{ fontWeight: 850, marginTop: 3 }}>{selectedStats?.rightWins || 0}W · {selectedStats?.rightLosses || 0}L</div>
              </div>
              <div style={{ ...glass, borderRadius: 12, padding: 10 }}>
                <div style={{ opacity: 0.55, fontSize: 10, textTransform: "uppercase" }}>Left arm</div>
                <div style={{ fontWeight: 850, marginTop: 3 }}>{selectedStats?.leftWins || 0}W · {selectedStats?.leftLosses || 0}L</div>
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: 14 }}>Current ranks</h3>
                {selectedStats?.biggestJump > 0 && <span style={{ fontSize: 11, color: green }}>Best single climb ↑ {selectedStats.biggestJump}</span>}
              </div>
              <div style={{ marginTop: 8 }}>
                {selectedRanks.length === 0 ? (
                  <div style={{ opacity: 0.55, fontSize: 12 }}>No active ranks.</div>
                ) : (
                  selectedRanks.map((r) => (
                    <div className="drawer-rank" key={`${selectedPlayer.id}:${r.wc}`}>
                      <span style={{ fontSize: 12, opacity: 0.76 }}>{prettyClassLabel(r.wc)}</span>
                      <strong style={{ color: r.rank === 1 ? "#ffe792" : "white" }}>{r.rank === 1 ? "👑 #1" : `#${r.rank}`}</strong>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <h3 style={{ margin: 0, fontSize: 14 }}>Recent matches</h3>
                {selectedCurrentArmStreak.streak > 1 && (
                  <span style={{ fontSize: 11, color: green }}>🔥 {selectedCurrentArmStreak.streak} {selectedCurrentArmStreak.arm.toLowerCase()}-arm win streak</span>
                )}
              </div>
              <div style={{ marginTop: 7 }}>
                {selectedRecentHistory.length === 0 ? (
                  <div style={{ opacity: 0.55, fontSize: 12 }}>No recorded matches.</div>
                ) : (
                  selectedRecentHistory.map((m) => {
                    const opp = playerById.get(m.opponentId);
                    return (
                      <div key={`${m._stableKey}:${m.result}`} style={{ display: "grid", gridTemplateColumns: "30px 1fr auto", gap: 9, alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,.07)" }}>
                        <div style={{ width: 27, height: 27, borderRadius: 8, display: "grid", placeItems: "center", fontWeight: 950, fontSize: 11, color: m.result === "W" ? "#a7f3d0" : "#fecdd3", background: m.result === "W" ? "rgba(52,211,153,.10)" : "rgba(251,113,133,.09)" }}>{m.result}</div>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 760 }}>{opp?.name || m.opponentId}</div>
                          <div style={{ opacity: 0.5, fontSize: 10.5 }}>{m.arm}{m.weight_class ? ` · ${m.weight_class}` : ""}</div>
                        </div>
                        <div style={{ opacity: 0.52, fontSize: 10.5 }}>{formatDateAU(m._parsedDate)}</div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
