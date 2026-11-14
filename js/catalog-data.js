/* catalog-data.js
 * Turns the Meeple Center library spreadsheet into game records.
 *
 * This file is shared by two callers, which is why it exports both ways:
 *   - js/catalog.js, in the browser, fetching the sheet live on page load
 *   - scripts/fetch-catalog.js, in Node, building the daily cached copy
 * Keeping one copy of the parsing means the cache can never disagree with
 * the live page about what a row means.
 */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.MeepleCatalogData = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SHEET_ID = "14E2W7WBHVCCoZHOgNvSgtmfyr-WgxsfsuN92z7g48Wk";
  var GID = "768323261";

  // The sheet is shared publicly, so the CSV endpoint needs no API key.
  var CSV_URL =
    "https://docs.google.com/spreadsheets/d/" + SHEET_ID +
    "/gviz/tq?tqx=out:csv&headers=1&gid=" + GID;
  var SHEET_URL =
    "https://docs.google.com/spreadsheets/d/" + SHEET_ID + "/edit?gid=" + GID;

  // The sheet rates complexity 1-3 in its "MC" column; the table shows words.
  var MC_LABELS = { "1": "Light", "2": "Medium", "3": "Heavy" };

  // Minimal RFC 4180 parser: handles quoted fields, embedded commas and
  // quotes, and both LF and CRLF line endings. Returns an array of rows,
  // each an array of strings.
  function parseCsv(text) {
    var out = [];
    var row = [];
    var field = "";
    var inQuotes = false;
    var i = 0;

    // A leading BOM would otherwise end up glued to the first header name.
    if (text.charCodeAt(0) === 0xFEFF) { text = text.slice(1); }

    while (i < text.length) {
      var ch = text.charAt(i);

      if (inQuotes) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          inQuotes = false;
          i++;
          continue;
        }
        field += ch;
        i++;
        continue;
      }

      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ",") { row.push(field); field = ""; i++; continue; }
      if (ch === "\r") { i++; continue; }
      if (ch === "\n") {
        row.push(field);
        out.push(row);
        row = [];
        field = "";
        i++;
        continue;
      }

      field += ch;
      i++;
    }

    if (field !== "" || row.length) {
      row.push(field);
      out.push(row);
    }
    return out;
  }

  function headerIndex(header, name) {
    for (var i = 0; i < header.length; i++) {
      if (header[i].trim().toLowerCase() === name.toLowerCase()) { return i; }
    }
    return -1;
  }

  function cell(record, index) {
    if (index < 0 || index >= record.length) { return ""; }
    return record[index].trim();
  }

  function firstNumber(str) {
    var m = /(\d+)/.exec(str);
    return m ? parseInt(m[1], 10) : 0;
  }

  // The first named column after "from", or -1 if there isn't one.
  function nextNamed(header, from) {
    for (var i = from + 1; i < header.length; i++) {
      if (header[i].trim()) { return i; }
    }
    return -1;
  }

  // IDs are compared without leading zeros, so a tag reading 042 still finds
  // its game if the sheet ever turns that cell into the number 42.
  function normalizeId(id) {
    return String(id).trim().replace(/^0+(?=\d)/, "");
  }

  // Finds the game a tag's ?id= points at. Blank IDs never match.
  function findById(games, id) {
    var wanted = normalizeId(id == null ? "" : id);
    if (!wanted) { return null; }
    for (var i = 0; i < games.length; i++) {
      if (games[i].id && normalizeId(games[i].id) === wanted) { return games[i]; }
    }
    return null;
  }

  // Both tag columns spill: the sheet writes comma-separated values in the
  // named column ("Tile Placement, Abstract") and continues into the unnamed
  // columns after it ("Under Age 5"). So a column runs until the next named
  // one starts, or to the end of the row if none does (a negative "to").
  function collectTags(record, from, to) {
    var seen = {};
    var list = [];
    if (from < 0) { return list; }
    var end = to < 0 || to > record.length ? record.length : to;
    for (var i = from; i < end; i++) {
      var parts = record[i].split(",");
      for (var p = 0; p < parts.length; p++) {
        var tag = parts[p].trim();
        if (tag && !seen[tag]) {
          seen[tag] = true;
          list.push(tag);
        }
      }
    }
    return list;
  }

  function toGames(table) {
    if (!table.length) { return []; }

    var header = table[0];
    var idx = {
      id: headerIndex(header, "ID"),
      bggId: headerIndex(header, "BGG ID"),
      title: headerIndex(header, "Title"),
      players: headerIndex(header, "Max Player Count"),
      length: headerIndex(header, "Length"),
      rental: headerIndex(header, "Rental"),
      mc: headerIndex(header, "MC"),
      type: headerIndex(header, "Type"),
      location: headerIndex(header, "Location")
    };

    var games = [];
    for (var r = 1; r < table.length; r++) {
      var record = table[r];
      // A trailing "*" is a marker for people reading the sheet; the site
      // never shows it.
      var title = cell(record, idx.title).replace(/\s*\*+$/, "");
      // The sheet keeps blank template rows below the real entries.
      if (!title) { continue; }

      var players = cell(record, idx.players);
      var mc = cell(record, idx.mc);

      games.push({
        id: cell(record, idx.id),
        bggId: cell(record, idx.bggId),
        title: title,
        types: collectTags(record, idx.type, nextNamed(header, idx.type)),
        locations: collectTags(record, idx.location, nextNamed(header, idx.location)),
        max: firstNumber(players),
        open: players.indexOf("+") !== -1, // "7+ Player" has no upper bound
        time: firstNumber(cell(record, idx.length)),
        weight: MC_LABELS.hasOwnProperty(mc) ? MC_LABELS[mc] : "",
        status: cell(record, idx.rental).toUpperCase() === "TRUE"
          ? "lendable"
          : "house"
      });
    }
    return games;
  }

  function gamesFromCsv(text) {
    return toGames(parseCsv(text));
  }

  // The live sheet has no BGG data; only data/games.json does. This copies
  // each cached game's "bgg" object onto the live game with the same BGG ID,
  // so a sheet edit (Location, Rental, a new game) shows at once while BGG
  // facts stay at most a day old. A BGG ID new since the last refresh simply
  // has no BGG data until the next one. Returns new objects; neither input
  // is changed.
  function withBgg(games, cachedGames) {
    var byBggId = {};
    for (var i = 0; i < (cachedGames || []).length; i++) {
      var cached = cachedGames[i];
      if (cached.bggId && cached.bgg) { byBggId[cached.bggId] = cached.bgg; }
    }
    return games.map(function (game) {
      var copy = {};
      for (var key in game) {
        if (Object.prototype.hasOwnProperty.call(game, key)) { copy[key] = game[key]; }
      }
      if (game.bggId && byBggId[game.bggId]) { copy.bgg = byBggId[game.bggId]; }
      return copy;
    });
  }

  // BGG reports a missing value as 0 (no weight votes yet, no play time).
  function positive(value) {
    var n = parseFloat(value);
    return n > 0 ? n : 0;
  }

  // BGG weight bands for the catalog's filter. Filtering on BGG's number
  // doesn't change it, so this stays within BGG's terms.
  function weightBand(weight) {
    if (!weight) { return ""; }
    if (weight < 2) { return "Light"; }
    return weight <= 3 ? "Medium" : "Heavy";
  }

  // What both pages show for players, play time, and complexity. BGG's
  // figures win; the sheet's older columns fill in for games without BGG
  // data until those columns are retired. Numbers are 0 when unknown.
  function facts(game) {
    var b = game.bgg || {};
    var out = {
      minPlayers: positive(b.minPlayers),
      maxPlayers: positive(b.maxPlayers),
      openEnded: false,
      bestWith: b.bestWith || "",
      time: positive(b.playingTime),
      minTime: positive(b.minPlayTime),
      maxTime: positive(b.maxPlayTime),
      weight: positive(b.weight),
      weightBand: "",
      weightText: ""
    };

    if (!out.maxPlayers && game.max) {
      out.minPlayers = 0; // the sheet only ever recorded a maximum
      out.maxPlayers = game.max;
      out.openEnded = !!game.open;
    }
    if (!out.time && game.time) { out.time = game.time; }

    if (out.weight) {
      // BGG's number, shown as BGG shows it: "2.4 / 5".
      out.weightBand = weightBand(out.weight);
      out.weightText = out.weight.toFixed(1) + " / 5";
    } else if (game.weight) {
      out.weightBand = game.weight;
      out.weightText = game.weight;
    }
    return out;
  }

  // "2–4 players", "1 player", "Up to 6 players", "7 or more players", or "".
  function playersText(f) {
    if (!f.maxPlayers) { return ""; }
    if (f.openEnded) { return f.maxPlayers + " or more players"; }
    if (!f.minPlayers) {
      return f.maxPlayers === 1 ? "1 player" : "Up to " + f.maxPlayers + " players";
    }
    if (f.minPlayers === f.maxPlayers) {
      return f.maxPlayers + (f.maxPlayers === 1 ? " player" : " players");
    }
    return f.minPlayers + "–" + f.maxPlayers + " players";
  }

  // "15–30 minutes", "About 45 minutes", or "".
  function timeText(f) {
    if (f.minTime && f.maxTime && f.minTime !== f.maxTime) {
      return f.minTime + "–" + f.maxTime + " minutes";
    }
    return f.time ? "About " + f.time + " minutes" : "";
  }

  return {
    SHEET_ID: SHEET_ID,
    GID: GID,
    CSV_URL: CSV_URL,
    SHEET_URL: SHEET_URL,
    parseCsv: parseCsv,
    toGames: toGames,
    gamesFromCsv: gamesFromCsv,
    findById: findById,
    withBgg: withBgg,
    facts: facts,
    playersText: playersText,
    timeText: timeText
  };
});
