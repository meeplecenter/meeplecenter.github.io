#!/usr/bin/env node
/* fetch-catalog.js
 * Writes data/games.json, the cached copy of the library spreadsheet that
 * catalog.html falls back to when the live fetch from Google fails.
 *
 * Run by .github/workflows/refresh-catalog.yml once a week, and by hand with:
 *   node scripts/fetch-catalog.js
 *
 * No dependencies -- Node 18+ has fetch built in, and the parsing comes from
 * js/catalog-data.js, the same file the browser uses.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const data = require("../js/catalog-data.js");

const OUT_FILE = path.join(__dirname, "..", "data", "games.json");

// A good fetch that somehow yields far fewer games than last time usually
// means the sheet broke, not that the library shrank -- 130 games do not
// vanish in a week. Refuse to overwrite a good cache with a bad one unless
// someone deliberately asks (ALLOW_SHRINK=1), e.g. after a real purge.
const SHRINK_LIMIT = 0.5;
const MIN_GAMES = 20;

function readExisting() {
  try {
    return JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));
  } catch (err) {
    return null;
  }
}

async function main() {
  const response = await fetch(data.CSV_URL, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`sheet request failed: HTTP ${response.status}`);
  }

  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/csv")) {
    // A sheet that stops being publicly shared answers with an HTML sign-in
    // page, which would otherwise parse into a single nonsense row.
    throw new Error(`expected CSV, got "${type}" -- is the sheet still public?`);
  }

  const games = data.gamesFromCsv(await response.text());
  if (games.length < MIN_GAMES) {
    throw new Error(`only ${games.length} games parsed; refusing to write`);
  }

  const existing = readExisting();
  const previous = existing && Array.isArray(existing.games)
    ? existing.games.length
    : 0;

  if (previous && games.length < previous * SHRINK_LIMIT && !process.env.ALLOW_SHRINK) {
    throw new Error(
      `game count fell from ${previous} to ${games.length}; ` +
      "refusing to write. Set ALLOW_SHRINK=1 if this is correct."
    );
  }

  // Sorted so the file only changes when the data does, which keeps the
  // weekly workflow from committing noise.
  games.sort((a, b) => a.title.localeCompare(b.title));

  const gamesJson = JSON.stringify(games);
  if (existing && JSON.stringify(existing.games) === gamesJson) {
    console.log(`No changes -- ${games.length} games, cache already current.`);
    return;
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: data.SHEET_URL,
    count: games.length,
    games: games
  }, null, 2) + "\n");

  console.log(
    previous
      ? `Wrote ${games.length} games (was ${previous}).`
      : `Wrote ${games.length} games.`
  );
}

main().catch((err) => {
  console.error(`fetch-catalog: ${err.message}`);
  process.exit(1);
});
