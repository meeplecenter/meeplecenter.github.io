/* catalog-data.js
 * Turns the Meeple Center library spreadsheet into game records.
 *
 * This file is shared by two callers, which is why it exports both ways:
 *   - js/catalog.js, in the browser, fetching the sheet live on page load
 *   - scripts/fetch-catalog.js, in Node, building the weekly cached copy
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

  // Type tags live in the "Type" column and in the unnamed columns after it,
  // comma-separated, e.g. "Tile Placement, Abstract" + "Under Age 5".
  function collectTypes(record, from) {
    var seen = {};
    var list = [];
    if (from < 0) { return list; }
    for (var i = from; i < record.length; i++) {
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
      title: headerIndex(header, "Title"),
      players: headerIndex(header, "Max Player Count"),
      length: headerIndex(header, "Length"),
      rental: headerIndex(header, "Rental"),
      mc: headerIndex(header, "MC"),
      type: headerIndex(header, "Type")
    };

    var games = [];
    for (var r = 1; r < table.length; r++) {
      var record = table[r];
      var title = cell(record, idx.title);
      // The sheet keeps blank template rows below the real entries.
      if (!title) { continue; }

      var players = cell(record, idx.players);
      var mc = cell(record, idx.mc);

      games.push({
        title: title,
        types: collectTypes(record, idx.type),
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

  return {
    SHEET_ID: SHEET_ID,
    GID: GID,
    CSV_URL: CSV_URL,
    SHEET_URL: SHEET_URL,
    parseCsv: parseCsv,
    toGames: toGames,
    gamesFromCsv: gamesFromCsv
  };
});
