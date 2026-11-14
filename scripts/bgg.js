/* bgg.js
 * A small client for the BoardGameGeek XML API2, shared by the scripts in
 * this folder. Node only: the token must never reach a browser.
 *
 * Every request needs BGG_TOKEN (from boardgamegeek.com/applications). In
 * Actions it comes from the repository secret of the same name; locally, set
 * it in the environment for the one command that needs it.
 *
 * BGG throttles hard, so requests go out one at a time, at least
 * REQUEST_GAP_MS apart, and back off on 202 (queued), 429 (too many
 * requests), 500, 502, 503 and 504.
 */
"use strict";

const API_ROOT = "https://boardgamegeek.com/xmlapi2/";
const REQUEST_GAP_MS = 5000;
const MAX_ATTEMPTS = 5;
const THING_BATCH = 20; // BGG's limit for ids per thing request
const RETRY_STATUSES = [202, 429, 500, 502, 503, 504];

let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function token() {
  return (process.env.BGG_TOKEN || "").trim();
}

async function request(command, params) {
  const auth = token();
  if (!auth) { throw new Error("BGG_TOKEN is not set"); }

  const url = API_ROOT + command + "?" + new URLSearchParams(params).toString();
  let delay = REQUEST_GAP_MS;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const wait = lastRequestAt + REQUEST_GAP_MS - Date.now();
    if (wait > 0) { await sleep(wait); }
    lastRequestAt = Date.now();

    let response;
    try {
      response = await fetch(url, {
        headers: { Authorization: "Bearer " + auth }
      });
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) { throw err; }
      await sleep(delay);
      delay *= 2;
      continue;
    }

    if (response.ok && response.status !== 202) {
      return response.text();
    }
    if (!RETRY_STATUSES.includes(response.status) || attempt === MAX_ATTEMPTS) {
      throw new Error(`BGG ${command} failed: HTTP ${response.status}`);
    }
    await sleep(delay);
    delay *= 2;
  }
  throw new Error(`BGG ${command} failed after ${MAX_ATTEMPTS} attempts`);
}

// --- Minimal XML reading -------------------------------------------------
// BGG's responses are flat and regular, so a few regexes are enough and keep
// the scripts free of dependencies.

function decode(str) {
  return str
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attrs(tagText) {
  const out = {};
  const re = /([\w:-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(tagText))) { out[m[1]] = decode(m[2]); }
  return out;
}

// Each <item ...>...</item> as { attrs, body }.
function items(xml) {
  const out = [];
  const re = /<item\b([^>]*?)(?:\/>|>([\s\S]*?)<\/item>)/g;
  let m;
  while ((m = re.exec(xml))) { out.push({ attrs: attrs(m[1]), body: m[2] || "" }); }
  return out;
}

// Attributes of every <tag .../> in body.
function tags(body, tag) {
  const out = [];
  const re = new RegExp("<" + tag + "\\b([^>]*?)\\/?>", "g");
  let m;
  while ((m = re.exec(body))) { out.push(attrs(m[1])); }
  return out;
}

// The value="" of the first <tag/> in body, or "".
function value(body, tag) {
  const found = tags(body, tag)[0];
  return found && found.value != null ? found.value : "";
}

// The decoded text inside the first <tag>...</tag> in body, or "".
function text(body, tag) {
  const m = new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)<\\/" + tag + ">").exec(body);
  return m ? decode(m[1]).trim() : "";
}

// The fields the site shows, from one <item> of a thing?stats=1 response.
// Values are kept as BGG gives them; BGG's terms forbid altering their data.
function parseThing(item) {
  const body = item.body;
  const names = tags(body, "name");
  const primary = names.find((n) => n.type === "primary") || names[0] || {};
  const summary = tags(body, "result").filter((r) => r.name);
  const pick = (prefix) => {
    const found = summary.find((r) => r.name.indexOf(prefix) === 0);
    return found ? found.value : "";
  };
  return {
    name: primary.value || "",
    year: value(body, "yearpublished"),
    minPlayers: value(body, "minplayers"),
    maxPlayers: value(body, "maxplayers"),
    // The poll summary is BGG's own wording, e.g. "Best with 2 players".
    // (BGG spells the second one "recommmendedwith", hence the prefix.)
    bestWith: pick("bestwith"),
    recommendedWith: pick("recomm"),
    playingTime: value(body, "playingtime"),
    minPlayTime: value(body, "minplaytime"),
    maxPlayTime: value(body, "maxplaytime"),
    minAge: value(body, "minage"),
    weight: value(body, "averageweight"),
    image: text(body, "image"),
    thumbnail: text(body, "thumbnail"),
    description: text(body, "description")
  };
}

// --- Commands ------------------------------------------------------------

// Board games whose name matches query, once each. BGG includes expansions
// in type=boardgame results (and lists them twice, once per type), which is
// wanted here: the library holds some expansions.
async function search(query, exact) {
  const params = { query: query, type: "boardgame" };
  if (exact) { params.exact = "1"; }
  const xml = await request("search", params);
  const seen = new Set();
  return items(xml)
    .filter((it) => !seen.has(it.attrs.id) && seen.add(it.attrs.id))
    .map((it) => ({
      id: it.attrs.id,
      name: value(it.body, "name"),
      year: value(it.body, "yearpublished")
    }));
}

// Raw <item> blocks for the given ids, fetched THING_BATCH at a time.
async function things(ids, withStats) {
  const unique = Array.from(new Set(ids.map(String).filter(Boolean)));
  const out = [];
  for (let i = 0; i < unique.length; i += THING_BATCH) {
    const params = { id: unique.slice(i, i + THING_BATCH).join(",") };
    if (withStats) { params.stats = "1"; }
    out.push(...items(await request("thing", params)));
  }
  return out;
}

module.exports = {
  THING_BATCH,
  token,
  request,
  search,
  things,
  parseThing,
  items,
  text,
  tags,
  value,
  attrs,
  decode
};
