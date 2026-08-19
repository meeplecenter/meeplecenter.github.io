/* catalog.js
 * Builds and powers the Meeple Center game catalog (catalog.html).
 *
 * The library spreadsheet is the source of truth, but the page doesn't wait on
 * it. We render data/games.json first -- a copy refreshed weekly by
 * .github/workflows/refresh-catalog.yml, served from our own domain, so the
 * table appears without a round trip to Google. Then we fetch the sheet in the
 * background and quietly swap the table only if something actually changed, so
 * an edit still shows up on the very next page load.
 *
 * If that background fetch fails -- Google is down, the sheet's sharing
 * changed, the visitor is offline -- the cached table simply stays, with a note
 * above it saying which day the copy is from.
 *
 * Parsing lives in js/catalog-data.js, shared with the build script so the
 * cache and the live page can't drift apart. The table body starts empty in
 * the markup; everything below the <thead> is rendered here, and catalog.html
 * carries a <noscript> pointing at the spreadsheet.
 */
(function () {
  "use strict";

  var DATA = window.MeepleCatalogData;

  // Same-origin copy written by scripts/fetch-catalog.js.
  var CACHE_URL = "data/games.json";

  var WEIGHT_ORDER = { "Light": 0, "Medium": 1, "Heavy": 2 };

  var PIP_LIMIT = 5;  // at most this many meeples before a numeral takes over
  var PIP_SHORT = 4;  // meeples drawn alongside that numeral
  var PIP_MAX = 9;    // largest numeral shown; past it the count becomes "9+"
  // Shown for fields the sheet leaves blank. An entity rather than a literal
  // em dash so the file survives being served without a charset; every use
  // below goes through innerHTML.
  var EMPTY = "&mdash;";

  var tbody = null;
  var rows = []; // [{ el, title, types, max, open, time, weight, status }]

  var els = {}; // cache of filter/control elements, looked up once

  var sortKey = null;
  var sortDir = "asc"; // "asc" | "desc"

  function byId(id) {
    return document.getElementById(id);
  }

  function debounce(fn, delay) {
    var timer = null;
    return function () {
      var args = arguments;
      var ctx = this;
      if (timer) { clearTimeout(timer); }
      timer = setTimeout(function () {
        fn.apply(ctx, args);
      }, delay);
    };
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ------------------------------------------------------------------------
     Rendering
     --------------------------------------------------------------------- */

  // The player count in words, for the cell's tooltip and its screen readers.
  function playersLabel(game) {
    if (!game.max) { return "Player count unknown"; }
    return game.open
      ? game.max + " or more players"
      : (game.max === 1 ? "1 player" : "up to " + game.max + " players");
  }

  // Player count, drawn as one meeple per seat up to five. Past that the row
  // keeps four meeples and spells the rest as a numeral, so every wide count
  // occupies the same width: XXXXX, XXXX6, XXXX7+, XXXX9+.
  function pipsHtml(game) {
    if (!game.max) { return "<span>" + EMPTY + "</span>"; }

    var numeric = game.open || game.max > PIP_LIMIT;
    var shown = numeric ? Math.min(game.max, PIP_SHORT) : game.max;
    var pips = "";
    for (var n = 1; n <= shown; n++) {
      pips += '<span class="meeple-icon" aria-hidden="true"></span>';
    }
    if (numeric) {
      pips += '<span class="more" aria-hidden="true">' +
        Math.min(game.max, PIP_MAX) +
        (game.open || game.max > PIP_MAX ? "+" : "") + "</span>";
    }

    return '<span class="pips">' + pips + "</span>" +
      '<span class="sr-only">' + playersLabel(game) + "</span>";
  }

  function typesHtml(game) {
    if (!game.types.length) { return EMPTY; }
    var html = "";
    for (var i = 0; i < game.types.length; i++) {
      var tag = escapeHtml(game.types[i]);
      html += '<span class="badge" data-type="' + tag + '">' + tag + "</span>";
    }
    return '<span class="type-tags">' + html + "</span>";
  }

  // Rental is a yes/no straight from the sheet's TRUE/FALSE, so it's drawn as
  // a mark rather than a word: a green check for a game that goes home with
  // you, a gray circled x for one that stays here. The word still goes out to
  // screen readers, which can't see the color the mark is leaning on.
  function rentalHtml(game) {
    var lendable = game.status === "lendable";
    return '<span class="rental-mark" aria-hidden="true">' +
      (lendable ? "&check;" : "&otimes;") + "</span>" +
      '<span class="sr-only">' +
      (lendable ? "Available to rent" : "In-house only") + "</span>";
  }

  function rowHtml(game) {
    return "<td>" + escapeHtml(game.title) + "</td>" +
      "<td>" + typesHtml(game) + "</td>" +
      '<td class="col-players" title="' + escapeHtml(playersLabel(game)) + '">' +
        pipsHtml(game) + "</td>" +
      "<td>" + (game.time ? game.time : EMPTY) + "</td>" +
      "<td>" + (game.weight || EMPTY) + "</td>" +
      '<td class="col-rental">' + rentalHtml(game) + "</td>";
  }

  function render(games) {
    var frag = document.createDocumentFragment();
    rows = [];

    for (var i = 0; i < games.length; i++) {
      var game = games[i];
      var tr = document.createElement("tr");
      tr.setAttribute("data-weight", game.weight);
      tr.setAttribute("data-status", game.status);
      tr.innerHTML = rowHtml(game);
      frag.appendChild(tr);

      // A fresh object rather than tacking .el onto the caller's game: the
      // array we were handed stays plain data, so it can still be compared
      // against a later fetch.
      rows.push({
        el: tr,
        title: game.title,
        types: game.types,
        max: game.max,
        open: game.open,
        time: game.time,
        weight: game.weight,
        status: game.status
      });
    }

    tbody.innerHTML = "";
    tbody.appendChild(frag);
  }

  /* ------------------------------------------------------------------------
     Filter options, built from whatever the sheet actually contains
     --------------------------------------------------------------------- */

  function addOptions(select, values, labelFor) {
    if (!select) { return; }
    // Drop anything from a previous pass, keeping the "All ..." placeholder,
    // so a refresh from the live sheet doesn't stack up duplicate options.
    while (select.children.length > 1) {
      select.removeChild(select.children[select.children.length - 1]);
    }
    var frag = document.createDocumentFragment();
    for (var i = 0; i < values.length; i++) {
      var opt = document.createElement("option");
      opt.value = String(values[i]);
      opt.textContent = labelFor ? labelFor(values[i]) : String(values[i]);
      frag.appendChild(opt);
    }
    select.appendChild(frag);
  }

  function populateFilters(games) {
    var types = {};
    var counts = {};
    var times = {};

    for (var i = 0; i < games.length; i++) {
      var game = games[i];
      for (var t = 0; t < game.types.length; t++) { types[game.types[t]] = true; }
      if (game.max) { counts[game.max] = true; }
      if (game.time) { times[game.time] = true; }
    }

    addOptions(els.type, Object.keys(types).sort(function (a, b) {
      return a.localeCompare(b);
    }));

    addOptions(els.players, Object.keys(counts).map(Number).sort(function (a, b) {
      return a - b;
    }), function (n) {
      return n + " or more";
    });

    addOptions(els.time, Object.keys(times).map(Number).sort(function (a, b) {
      return a - b;
    }), function (n) {
      return "~" + n + " min";
    });
  }

  /* ------------------------------------------------------------------------
     Filtering
     --------------------------------------------------------------------- */

  function matchesSearch(game, term) {
    if (!term) { return true; }
    var haystack = (game.title + " " + game.types.join(" ")).toLowerCase();
    return haystack.indexOf(term) !== -1;
  }

  function matchesType(game, val) {
    if (!val) { return true; }
    for (var i = 0; i < game.types.length; i++) {
      if (game.types[i] === val) { return true; }
    }
    return false;
  }

  // The sheet records only a maximum, so "5 or more" means "seats at least 5".
  function matchesPlayers(game, val) {
    if (!val) { return true; }
    var n = parseInt(val, 10);
    if (isNaN(n)) { return true; }
    return game.max >= n;
  }

  function matchesTime(game, val) {
    if (!val) { return true; }
    var n = parseInt(val, 10);
    if (isNaN(n)) { return true; }
    return game.time === n;
  }

  function matchesWeight(game, val) {
    return !val || game.weight === val;
  }

  function matchesStatus(game, val) {
    return !val || game.status === val;
  }

  function applyFilters() {
    if (!rows.length) { return; }

    var term = els.search ? els.search.value.trim().toLowerCase() : "";
    var type = els.type ? els.type.value : "";
    var players = els.players ? els.players.value : "";
    var time = els.time ? els.time.value : "";
    var weight = els.weight ? els.weight.value : "";
    var status = els.status ? els.status.value : "";

    var visibleCount = 0;

    for (var i = 0; i < rows.length; i++) {
      var game = rows[i];
      var visible =
        matchesSearch(game, term) &&
        matchesType(game, type) &&
        matchesPlayers(game, players) &&
        matchesTime(game, time) &&
        matchesWeight(game, weight) &&
        matchesStatus(game, status);

      if (visible) {
        game.el.removeAttribute("hidden");
        visibleCount++;
      } else {
        game.el.setAttribute("hidden", "");
      }
    }

    if (els.resultCount) {
      els.resultCount.textContent =
        "Showing " + visibleCount + " of " + rows.length + " games";
    }

    if (els.noResults) {
      if (visibleCount === 0) {
        els.noResults.removeAttribute("hidden");
      } else {
        els.noResults.setAttribute("hidden", "");
      }
    }
  }

  function resetFilters() {
    if (els.search) { els.search.value = ""; }
    if (els.type) { els.type.value = ""; }
    if (els.players) { els.players.value = ""; }
    if (els.time) { els.time.value = ""; }
    if (els.weight) { els.weight.value = ""; }
    if (els.status) { els.status.value = ""; }
    applyFilters();
  }

  /* ------------------------------------------------------------------------
     Sorting
     --------------------------------------------------------------------- */

  function compareValues(a, b, key) {
    switch (key) {
      case "players":
        return a.max - b.max;
      case "time":
        return a.time - b.time;
      case "weight":
        var wa = WEIGHT_ORDER.hasOwnProperty(a.weight) ? WEIGHT_ORDER[a.weight] : -1;
        var wb = WEIGHT_ORDER.hasOwnProperty(b.weight) ? WEIGHT_ORDER[b.weight] : -1;
        return wa - wb;
      case "type":
        return (a.types[0] || "").toLowerCase() < (b.types[0] || "").toLowerCase()
          ? -1
          : (a.types[0] || "").toLowerCase() > (b.types[0] || "").toLowerCase() ? 1 : 0;
      case "title":
      case "status":
      default:
        var av = (a[key] || "").toLowerCase();
        var bv = (b[key] || "").toLowerCase();
        if (av < bv) { return -1; }
        if (av > bv) { return 1; }
        return 0;
    }
  }

  function applySort(key, dir) {
    if (!rows.length || !tbody) { return; }

    sortKey = key;
    sortDir = dir;

    var dirMultiplier = sortDir === "asc" ? 1 : -1;
    rows.sort(function (a, b) {
      // Ties fall back to title so repeated sorts stay stable and readable.
      var cmp = compareValues(a, b, key) * dirMultiplier;
      return cmp !== 0 ? cmp : compareValues(a, b, "title");
    });

    var frag = document.createDocumentFragment();
    for (var i = 0; i < rows.length; i++) {
      frag.appendChild(rows[i].el);
    }
    tbody.appendChild(frag);

    updateSortIndicators(key);
  }

  // Clicking the same column again reverses it.
  function sortBy(key) {
    applySort(key, sortKey === key && sortDir === "asc" ? "desc" : "asc");
  }

  function updateSortIndicators(activeKey) {
    if (!els.sortButtons) { return; }
    for (var i = 0; i < els.sortButtons.length; i++) {
      var btn = els.sortButtons[i];
      var th = btn.parentNode;
      if (!th) { continue; }
      var key = btn.getAttribute("data-sort");
      if (key === activeKey) {
        th.setAttribute("aria-sort", sortDir === "asc" ? "ascending" : "descending");
      } else {
        th.setAttribute("aria-sort", "none");
      }
    }
  }

  /* ------------------------------------------------------------------------
     Wiring
     --------------------------------------------------------------------- */

  function setStatus(message, isError) {
    if (!els.catalogStatus) { return; }
    if (!message) {
      els.catalogStatus.setAttribute("hidden", "");
      return;
    }
    els.catalogStatus.removeAttribute("hidden");
    els.catalogStatus.innerHTML = message;
    if (isError) {
      els.catalogStatus.classList.add("is-error");
    } else {
      els.catalogStatus.classList.remove("is-error");
    }
  }

  function showLoadError() {
    setStatus(
      "We couldn't load the catalog just now. You can " +
      '<a href="' + DATA.SHEET_URL + '">browse the library spreadsheet</a> ' +
      "instead.",
      true
    );
    if (els.resultCount) { els.resultCount.textContent = ""; }
  }

  // "19 August 2026" -- spelled out, since a cached date is worth reading
  // rather than decoding. Falls back to the raw string on an odd timestamp.
  function formatDate(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) { return String(iso); }
    try {
      return date.toLocaleDateString(undefined, {
        year: "numeric", month: "long", day: "numeric"
      });
    } catch (e) {
      return date.toISOString().slice(0, 10);
    }
  }

  // What the visitor has typed and clicked. A refresh from the live sheet
  // rebuilds the whole table, so this gets put back afterwards -- nobody
  // should lose their search because a background fetch landed.
  function captureState() {
    return {
      search: els.search ? els.search.value : "",
      type: els.type ? els.type.value : "",
      players: els.players ? els.players.value : "",
      time: els.time ? els.time.value : "",
      weight: els.weight ? els.weight.value : "",
      status: els.status ? els.status.value : "",
      sortKey: sortKey,
      sortDir: sortDir
    };
  }

  // Selects silently fall back to "" if the sheet no longer offers the value
  // that was chosen, which is the right outcome: show everything, not nothing.
  function restoreState(state) {
    if (els.search) { els.search.value = state.search; }
    if (els.type) { els.type.value = state.type; }
    if (els.players) { els.players.value = state.players; }
    if (els.time) { els.time.value = state.time; }
    if (els.weight) { els.weight.value = state.weight; }
    if (els.status) { els.status.value = state.status; }
    applySort(state.sortKey || "title", state.sortDir || "asc");
  }

  function show(games, keepState) {
    if (!games.length) { throw new Error("no games"); }
    var state = keepState ? captureState() : null;

    render(games);
    populateFilters(games);

    if (state) {
      restoreState(state);
    } else {
      applySort("title", "asc");
    }
    applyFilters();
  }

  // A comparable fingerprint of the catalog. Sorted, so "did anything change?"
  // doesn't depend on the sheet's row order matching the cache's, and built
  // from named fields only, so it can't be thrown off by an extra property
  // hanging off a game object.
  function signature(games) {
    return games.map(function (g) {
      return [
        g.title, (g.types || []).join("|"), g.max, g.open, g.time,
        g.weight, g.status
      ].join("\t");
    }).sort().join("\n");
  }

  function fetchJson(url) {
    return fetch(url, { credentials: "omit" }).then(function (response) {
      if (!response.ok) { throw new Error("HTTP " + response.status); }
      return response.json();
    });
  }

  function fetchLive() {
    return fetch(DATA.CSV_URL, { credentials: "omit" })
      .then(function (response) {
        if (!response.ok) { throw new Error("HTTP " + response.status); }
        return response.text();
      })
      .then(function (text) {
        var games = DATA.gamesFromCsv(text);
        if (!games.length) { throw new Error("no games in sheet"); }
        return games;
      });
  }

  // Second half of the cache-first load: confirm the saved copy against the
  // live sheet and quietly swap the table if a volunteer has changed
  // something. The whole sheet is a few KB, and Google offers no cheap
  // "when did this last change?" check -- no ETag, no Last-Modified, and
  // nothing CORS would let us read anyway -- so fetching it outright is both
  // simpler and no slower than asking first.
  function revalidate(cached) {
    return fetchLive().then(function (games) {
      if (signature(games) !== signature(cached)) {
        show(games, true);
      }
    });
  }

  // Preferred path: the copy in data/games.json is same-origin and needs no
  // round trip to Google, so the table is on screen immediately.
  function loadCache() {
    return fetchJson(CACHE_URL).then(function (payload) {
      var cached = payload.games || [];
      show(cached);
      setStatus(""); // the table is up; drop the "Loading..." line right away

      // Only if we can't reach the sheet does the age of this copy matter
      // enough to mention.
      return revalidate(cached).catch(function () {
        setStatus(
          "Showing a saved copy of the catalog from " +
          formatDate(payload.generatedAt) +
          ", because the live library spreadsheet didn't respond. " +
          "A game or two may have changed since."
        );
      });
    });
  }

  function load() {
    loadCache()
      .catch(function () {
        // No cached copy yet -- a fresh checkout before the first weekly
        // refresh, say. Fall back to the sheet on its own.
        return fetchLive().then(function (games) {
          show(games);
          setStatus("");
        });
      })
      .catch(function () {
        showLoadError();
      });
  }

  function init() {
    tbody = document.querySelector("#catalog tbody");
    if (!tbody || !DATA) { return; }

    els.search = byId("search");
    els.type = byId("filter-type");
    els.players = byId("filter-players");
    els.time = byId("filter-time");
    els.weight = byId("filter-weight");
    els.status = byId("filter-status");
    els.reset = byId("reset");
    els.clear = byId("clear");
    els.resultCount = byId("result-count");
    els.noResults = byId("no-results");
    els.catalogStatus = byId("catalog-status");
    els.sortButtons = document.querySelectorAll(".sort-btn");

    var debouncedApply = debounce(applyFilters, 150);

    if (els.search) { els.search.addEventListener("input", debouncedApply); }
    if (els.type) { els.type.addEventListener("change", applyFilters); }
    if (els.players) { els.players.addEventListener("change", applyFilters); }
    if (els.time) { els.time.addEventListener("change", applyFilters); }
    if (els.weight) { els.weight.addEventListener("change", applyFilters); }
    if (els.status) { els.status.addEventListener("change", applyFilters); }
    if (els.reset) { els.reset.addEventListener("click", resetFilters); }
    if (els.clear) { els.clear.addEventListener("click", resetFilters); }

    if (els.sortButtons) {
      for (var i = 0; i < els.sortButtons.length; i++) {
        (function (btn) {
          btn.addEventListener("click", function () {
            var key = btn.getAttribute("data-sort");
            if (key) { sortBy(key); }
          });
        })(els.sortButtons[i]);
      }
    }

    load();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    // In case catalog.js somehow runs after DOMContentLoaded already fired.
    init();
  }
})();
