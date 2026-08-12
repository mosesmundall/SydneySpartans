import React, { useEffect, useMemo, useState } from "react";
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
    players: { id: "15DuCXPZXtIG97V5pCod2kLkW4iqkb3kOBwoo7znwDDU", gid: "0" },
    matches: { id: "1DGCu6nW9TNH-id5Xfsc4TkerwvJ1vh09uZrKmUfNMlU", gid: "0" },
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
      tristan_c: "/tristan_champ.png",
      wesley_h: "/wesley_champ.png",
      yve_w: "/Yve_Champ_New.jpg",
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
    },
    size: 72,
    ring: true,
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
function eligibleClassesFor(player) {
  const baseRaw = String(player.weight_class || "").trim().toLowerCase();

  // Keep the existing internal key "u60kg" for the Women's ladder.
  const base =
    baseRaw === "women" || baseRaw === "woman" ? "u60kg" : baseRaw;

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

function seedLadders(players, displayClasses) {
  const ladders = Object.fromEntries(displayClasses.map((wc) => [wc, []]));
  players
    .filter((p) => p.active)
    .forEach((p) => {
      const elig = eligibleClassesFor(p);
      elig.forEach((wc) => {
        const arm = wc.endsWith(" Right")
          ? "Right"
          : wc.endsWith(" Left")
          ? "Left"
          : null;

        // exclude from specific arm if injured
        const canEnter =
          arm === "Right"
            ? !p.injuredRight
            : arm === "Left"
            ? !p.injuredLeft
            : true;

        if (canEnter && ladders[wc]) ladders[wc].push(p);
      });
    });

  Object.keys(ladders).forEach((wc) => {
    const arm = wc.endsWith(" Right")
      ? "Right"
      : wc.endsWith(" Left")
      ? "Left"
      : null;

    ladders[wc].sort((a, b) => {
      // If a player has NO starting rank, treat as Infinity so they sink to the bottom (unranked).
      const aRank =
        arm === "Right"
          ? a.current_rank_rh
            ? +a.current_rank_rh
            : a.current_rank
            ? +a.current_rank
            : Infinity
          : a.current_rank_lh
          ? +a.current_rank_lh
          : a.current_rank
          ? +a.current_rank
          : Infinity;

      const bRank =
        arm === "Right"
          ? b.current_rank_rh
            ? +b.current_rank_rh
            : b.current_rank
            ? +b.current_rank
            : Infinity
          : b.current_rank_lh
          ? +b.current_rank_lh
          : b.current_rank
          ? +b.current_rank
          : Infinity;

      if (aRank !== bRank) return aRank - bRank;
      return a.name.localeCompare(b.name);
    });
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
  const eventLog = [];

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
          // Log all real ladder events, even when the visual badge is suppressed.
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

          if (m._badgeSuppressed) return;

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

  async function loadAll() {
    setError("");

    try {
      const [pRows, mRows] = await Promise.all([
        fetchCsv(csvUrl(CONFIG.sheets.players)),
        fetchCsv(csvUrl(CONFIG.sheets.matches)),
      ]);

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

        const srRight = trim(
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
        const srLeft = trim(
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
          injuredRight,
          injuredLeft,
          current_rank_rh: srRight || srSingle || "",
          current_rank_lh: srLeft || srSingle || "",
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
    if (!selectedPlayerId) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setSelectedPlayerId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedPlayerId]);

  // Compute current ladders and the historical comparison window.
  const { nowData, pastData, cutoff } = useMemo(() => {
    const cutoffDate = new Date();
    cutoffDate.setHours(0, 0, 0, 0);
    cutoffDate.setDate(cutoffDate.getDate() - (showBadges ? windowDays : 36500));
    const past = computeLaddersThroughDate(players, matches, CONFIG.weightClasses, cutoffDate);
    const now = computeLaddersThroughDate(players, matches, CONFIG.weightClasses, null);
    return { nowData: now, pastData: past, cutoff: cutoffDate };
  }, [players, matches, windowDays, showBadges]);

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
        currentStreak: 0,
        bestStreak: 0,
        history: [],
        takeoverKeys: new Set(),
        defenseKeys: new Set(),
        biggestJump: 0,
      })
    );

    sortedMatches.forEach((m) => {
      const w = map.get(m.winner_id);
      const l = map.get(m.loser_id);

      if (w) {
        w.wins += 1;
        if (m.arm === "Right") w.rightWins += 1;
        if (m.arm === "Left") w.leftWins += 1;
        w.currentStreak += 1;
        w.bestStreak = Math.max(w.bestStreak, w.currentStreak);
        w.history.push({ ...m, result: "W", opponentId: m.loser_id });
      }
      if (l) {
        l.losses += 1;
        if (m.arm === "Right") l.rightLosses += 1;
        if (m.arm === "Left") l.leftLosses += 1;
        l.currentStreak = 0;
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
  }, [players, sortedMatches, nowData.eventLog]);

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

  const visibleClasses = useMemo(
    () =>
      CONFIG.weightClasses.filter(
        (wc) => armFilter === "All" || wc.endsWith(` ${armFilter}`)
      ),
    [armFilter]
  );

  const activePlayers = players.filter((p) => p.active);

  const invalidDateCount = matches.filter((m) => m._invalidDate).length;
  const selectedPlayer = selectedPlayerId ? playerById.get(selectedPlayerId) : null;
  const selectedRanks = selectedPlayer ? ranksByPlayer.get(selectedPlayer.id) || [] : [];
  const selectedStats = selectedPlayer ? playerStats.get(selectedPlayer.id) : null;
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
        .rank-row.recent { animation:recentGlow 1.15s ease-out both; }
        .rank-num { width:32px; height:32px; display:grid; place-items:center; border-radius:10px; font-weight:900; background:rgba(255,255,255,.055); flex:0 0 32px; }
        .rank-row.champion .rank-num { color:#ffe792; background:rgba(245,197,66,.13); }
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

      <div className="rank-shell">
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
            <div style={{ fontSize: 24, fontWeight: 900, marginTop: 2 }}>{sortedMatches.length}</div>
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

        {/* Recent ladder activity */}
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
              <div style={{ fontWeight: 850 }}>Recent ladder activity</div>
              <div style={{ fontSize: 11, opacity: 0.58, marginTop: 2 }}>Takeovers and successful defenses across every affected class</div>
            </div>
            <span style={{ opacity: 0.65 }}>{showActivity ? "Hide ▲" : "Show ▼"}</span>
          </button>

          {showActivity && (
            <div style={{ padding: "0 15px 12px" }}>
              {rankActivity.length === 0 ? (
                <div style={{ padding: "12px 0", opacity: 0.6 }}>No ladder activity recorded yet.</div>
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
            const past = pastData.ladders[wc] || [];
            const pastRank = new Map(past.map((p) => [p.id, p.rank]));
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
                        {lastActivity ? `Last activity ${formatDateAU(lastActivity)}` : "No recorded ladder activity"}
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
                      No matching competitor in this ladder.
                    </div>
                  ) : (
                    filtered.map((p) => {
                      const was = pastRank.get(p.id);
                      const delta = was ? was - p.rank : 0;
                      const key = `${wc}:${p.id}`;
                      const takeoverWhen = nowData.lastTakeoverMap.get(key) || null;
                      const defenseWhen = nowData.lastDefenseMap.get(key) || null;
                      const isRecentTakeover = Boolean(showBadges && takeoverWhen && takeoverWhen >= cutoff);
                      const isRecentDefense = Boolean(showBadges && defenseWhen && defenseWhen >= cutoff);
                      const recent = isRecentTakeover || isRecentDefense;
                      const jump = nowData.lastJumpMap.get(key) ?? 0;

                      return (
                        <div
                          key={`${wc}:${p.id}`}
                          className={`rank-row ${p.rank === 1 ? "champion" : ""} ${recent ? "recent" : ""}`}
                          onClick={() => setSelectedPlayerId(p.id)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") setSelectedPlayerId(p.id);
                          }}
                        >
                          <div className="rank-num">{p.rank === 1 ? "👑" : p.rank}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
                              <span style={{ fontWeight: 820, letterSpacing: 0.1, overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                              {isRecentTakeover && <span title="Took rank" style={{ color: gold }}>★</span>}
                              {isRecentDefense && <span title="Defended">🛡️</span>}
                              {showBadges && delta > 0 && (
                                <span title={`Up ${delta} in selected window`} style={{ color: green, fontSize: 11, fontWeight: 900 }}>↑ {jump > 0 ? jump : delta}</span>
                              )}
                              {showBadges && delta < 0 && (
                                <span title={`Down ${Math.abs(delta)} in selected window`} style={{ color: red, fontSize: 11, fontWeight: 850 }}>↓ {Math.abs(delta)}</span>
                              )}
                            </div>
                            <div style={{ fontSize: 10.5, opacity: 0.52, marginTop: 2 }}>Base · {prettyBaseLabel(p.weight_class)}</div>
                          </div>
                          <div style={{ opacity: 0.35, fontSize: 16 }}>›</div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>
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
                    <div style={{ color: "#ffe792", marginTop: 5, fontSize: 12, fontWeight: 800 }}>👑 Champion in {selectedChampionCount} ladder{selectedChampionCount === 1 ? "" : "s"}</div>
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
                {(selectedStats?.currentStreak || 0) > 1 && <span style={{ fontSize: 11, color: green }}>🔥 {selectedStats.currentStreak} win streak</span>}
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
