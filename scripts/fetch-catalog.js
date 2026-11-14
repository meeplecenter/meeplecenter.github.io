#!/usr/bin/env node
/* fetch-catalog.js
 * Writes the cached catalog the site draws first:
 *   data/games.json         every game: sheet fields, plus a "bgg" object
 *                           with BoardGameGeek's facts for games with a BGG ID
 *   data/game-details.json  BGG descriptions by BGG ID, which only the game
 *                           page needs, kept out of games.json so the catalog
 *                           stays small
 *
 * Run daily by .github/workflows/refresh-catalog.yml, and by hand with:
 *   node scripts/fetch-catalog.js
 *
 * BGG data needs BGG_TOKEN. Without it, or if BGG fails, each game keeps the
 * BGG data from the last good cache rather than losing it, so a BGG outage
 * never blanks the site. The sheet fields are always refreshed.
 *
 * No dependencies -- Node 18+ has fetch built in, the sheet parsing comes
 * from js/catalog-data.js (the same file the browser uses), and scripts/bgg.js
 * talks to BGG.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const data = require("../js/catalog-data.js");
const bgg = require("./bgg.js");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_FILE = path.join(DATA_DIR, "games.json");
const DETAILS_FILE = path.join(DATA_DIR, "game-details.json");

// A good fetch that somehow yields far fewer games than last time usually
// means the sheet broke, not that the library shrank -- 130 games do not
// vanish in a day. Refuse to overwrite a good cache with a bad one unless
// someone deliberately asks (ALLOW_SHRINK=1), e.g. after a real purge.
const SHRINK_LIMIT = 0.5;
const MIN_GAMES = 20;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return null;
  }
}

async function fetchSheet() {
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
  return data.gamesFromCsv(await response.text());
}

// BGG data for every BGG ID in the sheet, as { bggId: { fields, description } }.
// Starts from the last cache, then overwrites whatever BGG returns, so an ID
// BGG fails on (or a run with no token) keeps its previous data.
async function fetchBgg(games, existing, existingDetails) {
  const byId = {};
  const previous = (existing && existing.games) || [];
  for (const game of previous) {
    if (game.bggId && game.bgg) {
      byId[game.bggId] = {
        fields: game.bgg,
        description: (existingDetails && existingDetails[game.bggId]) || ""
      };
    }
  }

  const ids = Array.from(new Set(games.map((g) => g.bggId).filter(Boolean)));
  if (!ids.length) { return { byId, fetched: 0, note: "no games have a BGG ID" }; }
  if (!bgg.token()) {
    return { byId, fetched: 0, note: "BGG_TOKEN not set; kept BGG data from the last cache" };
  }

  let fetched = 0;
  let note = "";
  try {
    // One batch at a time, so batches that succeed before a failure are kept.
    for (let i = 0; i < ids.length; i += bgg.THING_BATCH) {
      for (const item of await bgg.things(ids.slice(i, i + bgg.THING_BATCH), true)) {
        const thing = bgg.parseThing(item);
        const description = thing.description;
        delete thing.description;
        byId[item.attrs.id] = { fields: thing, description };
        fetched++;
      }
    }
  } catch (err) {
    note = `BGG failed (${err.message}); kept BGG data from the last cache`;
  }

  const missing = ids.filter((id) => !byId[id]);
  if (missing.length && !note) {
    note = `BGG returned nothing for BGG ID ${missing.join(", ")} -- check the sheet`;
  }
  return { byId, fetched, note };
}

async function main() {
  const games = await fetchSheet();
  if (games.length < MIN_GAMES) {
    throw new Error(`only ${games.length} games parsed; refusing to write`);
  }

  const existing = readJson(OUT_FILE);
  const existingDetails = readJson(DETAILS_FILE);
  const previous = existing && Array.isArray(existing.games)
    ? existing.games.length
    : 0;

  if (previous && games.length < previous * SHRINK_LIMIT && !process.env.ALLOW_SHRINK) {
    throw new Error(
      `game count fell from ${previous} to ${games.length}; ` +
      "refusing to write. Set ALLOW_SHRINK=1 if this is correct."
    );
  }

  const { byId, fetched, note } = await fetchBgg(
    games, existing, existingDetails && existingDetails.descriptions
  );

  const descriptions = {};
  for (const game of games) {
    const found = game.bggId && byId[game.bggId];
    if (found) {
      game.bgg = found.fields;
      if (found.description) { descriptions[game.bggId] = found.description; }
    }
  }

  // Sorted so the files only change when the data does, which keeps the
  // daily workflow from committing noise.
  games.sort((a, b) => a.title.localeCompare(b.title));
  const sortedDescriptions = {};
  Object.keys(descriptions).sort((a, b) => a - b).forEach((id) => {
    sortedDescriptions[id] = descriptions[id];
  });

  const withBgg = games.filter((g) => g.bgg).length;
  const summary = `${games.length} games, ${withBgg} with BGG data` +
    (bgg.token() ? ` (${fetched} fetched from BGG)` : "");
  if (note) {
    // In Actions, "::warning::" puts the note on the run's summary page, so
    // an expired token shows up without failing the sheet refresh.
    console.log(`${process.env.GITHUB_ACTIONS ? "::warning::" : "Note: "}${note}`);
  }

  const generatedAt = new Date().toISOString();
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const gamesChanged = !existing || JSON.stringify(existing.games) !== JSON.stringify(games);
  if (gamesChanged) {
    fs.writeFileSync(OUT_FILE, JSON.stringify({
      generatedAt,
      source: data.SHEET_URL,
      count: games.length,
      games
    }, null, 2) + "\n");
  }

  const detailsChanged = !existingDetails ||
    JSON.stringify(existingDetails.descriptions) !== JSON.stringify(sortedDescriptions);
  if (detailsChanged) {
    fs.writeFileSync(DETAILS_FILE, JSON.stringify({
      generatedAt,
      descriptions: sortedDescriptions
    }, null, 2) + "\n");
  }

  if (!gamesChanged && !detailsChanged) {
    console.log(`No changes -- ${summary}, cache already current.`);
  } else {
    console.log(`Wrote ${summary}` + (previous ? ` (was ${previous} games).` : "."));
  }
}

main().catch((err) => {
  console.error(`fetch-catalog: ${err.message}`);
  process.exit(1);
});
