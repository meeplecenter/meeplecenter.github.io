#!/usr/bin/env node
/* suggest-bgg-ids.js
 * One-off helper: suggests a BGG ID for each game in the library sheet, for a
 * person to check and paste into the sheet's "BGG ID" column.
 *
 *   BGG_TOKEN=... node scripts/suggest-bgg-ids.js [--limit N] [--out file.csv]
 *
 * Rows come out in sheet order, one per game, so the "BGG ID" column of the
 * CSV can be pasted straight down the sheet's column. Games that already
 * have a BGG ID keep it and are not searched.
 *
 * How a suggestion is picked: an exact-name search first; if that finds
 * nothing, a loose search ranked by how closely the name matches. Among
 * equally good names, the game with the most BGG ratings wins, which is
 * nearly always the edition people mean. The Confidence column says how
 * much checking each row needs:
 *   exact      one board game has exactly this name
 *   most-rated several have this exact name; picked the most-rated
 *   loose      no exact match; best loose match, check it
 *   none       nothing found; look it up by hand
 *   already set  the sheet already has a BGG ID
 *
 * Searches run about 5 seconds apart (BGG's throttle), so the full library
 * takes 15 minutes or so. Try --limit 5 first.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const data = require("../js/catalog-data.js");
const bgg = require("./bgg.js");

const LOOSE_CANDIDATES = 10;

function parseArgs(argv) {
  const opts = { limit: Infinity, out: path.join(__dirname, "..", "bgg-suggestions.csv") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") { opts.limit = parseInt(argv[++i], 10); }
    else if (argv[i] === "--out") { opts.out = path.resolve(argv[++i]); }
    else { throw new Error(`unknown argument: ${argv[i]}`); }
  }
  return opts;
}

function simplify(name) {
  return name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

// 3: same name, 2: starts with ours, 1: contains ours, 0: other.
function nameScore(title, name) {
  const a = simplify(title);
  const b = simplify(name);
  if (a === b) { return 3; }
  if (b.startsWith(a)) { return 2; }
  if (b.includes(a)) { return 1; }
  return 0;
}

function csvField(value) {
  const s = String(value == null ? "" : value);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!bgg.token()) { throw new Error("BGG_TOKEN is not set"); }

  const response = await fetch(data.CSV_URL, { redirect: "follow" });
  if (!response.ok) { throw new Error(`sheet request failed: HTTP ${response.status}`); }
  const games = data.gamesFromCsv(await response.text()).slice(0, opts.limit);

  // Pass 1: search. Candidates keep the best name score found for them.
  const rows = [];
  for (const game of games) {
    const row = { game, candidates: [], confidence: "" };
    rows.push(row);
    if (game.bggId) { row.confidence = "already set"; continue; }

    let found = await bgg.search(game.title, true);
    let kind = "exact";
    if (!found.length) {
      kind = "loose";
      found = (await bgg.search(game.title, false))
        .map((c) => Object.assign(c, { score: nameScore(game.title, c.name) }))
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, LOOSE_CANDIDATES);
    } else {
      found.forEach((c) => { c.score = 3; });
    }
    row.candidates = found;
    row.confidence = !found.length ? "none" : kind === "loose" ? "loose" : found.length === 1 ? "exact" : "most-rated";
    console.log(`${game.id} ${game.title}: ${found.length} ${kind} match(es)`);
  }

  // Pass 2: rating counts for every game that had more than one candidate,
  // batched, so ties break toward the edition people actually play.
  const needRatings = rows.filter((r) => r.candidates.length > 1)
    .flatMap((r) => r.candidates.map((c) => c.id));
  const ratings = {};
  if (needRatings.length) {
    for (const item of await bgg.things(needRatings, true)) {
      ratings[item.attrs.id] = parseInt(bgg.value(item.body, "usersrated"), 10) || 0;
    }
  }

  const lines = [[
    "ID", "Title", "BGG ID", "BGG name", "Year", "Ratings", "Confidence",
    "Other candidates", "BGG page"
  ].join(",")];

  for (const row of rows) {
    const { game } = row;
    row.candidates.forEach((c) => { c.ratings = ratings[c.id] || 0; });
    row.candidates.sort((a, b) => b.score - a.score || b.ratings - a.ratings);
    const best = row.candidates[0];
    const bggId = game.bggId || (best ? best.id : "");
    const others = row.candidates.slice(1, 5)
      .map((c) => `${c.id}: ${c.name}${c.year ? ` (${c.year})` : ""}`)
      .join("; ");

    lines.push([
      game.id,
      game.title,
      bggId,
      best ? best.name : "",
      best ? best.year : "",
      best && row.candidates.length > 1 ? best.ratings : "",
      row.confidence,
      others,
      bggId ? `https://boardgamegeek.com/boardgame/${bggId}` : ""
    ].map(csvField).join(","));
  }

  fs.writeFileSync(opts.out, lines.join("\n") + "\n");
  const counts = {};
  rows.forEach((r) => { counts[r.confidence] = (counts[r.confidence] || 0) + 1; });
  console.log(`\nWrote ${rows.length} rows to ${opts.out}`);
  console.log(Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`).join("\n"));
}

main().catch((err) => {
  console.error(`suggest-bgg-ids: ${err.message}`);
  process.exit(1);
});
