/* game.js
 * Fills in game.html, the page an NFC tag opens: game.html?id=042.
 *
 * Loads the same way as the catalog. data/games.json paints the page without
 * waiting on Google, then the live sheet confirms it, so Location and Rental
 * are current. The sheet has the final say: a game only counts as "not found"
 * once the sheet has been read and doesn't list it.
 *
 * BoardGameGeek's facts (players, play time, weight, box art) ride along in
 * data/games.json and are carried onto the live sheet's row by BGG ID. The
 * description is larger, so it lives in data/game-details.json and is only
 * fetched here. BGG's terms require the "Powered by BGG" credit whenever any
 * of it is shown.
 */
(function () {
  "use strict";

  var DATA = window.MeepleCatalogData;
  var CACHE_URL = "data/games.json";
  var DETAILS_URL = "data/game-details.json";
  var EMPTY = String.fromCharCode(0x2014); // an em dash; this file stays ASCII

  var found = false;
  var cachedGames = [];
  var details = null; // promise of { bggId: description }, fetched once

  function byId(id) {
    return document.getElementById(id);
  }

  function setStatus(message) {
    var status = byId("game-status");
    status.textContent = message;
    status.hidden = !message;
  }

  function setHeading(text) {
    byId("game-title").textContent = text;
    document.title = text + " | Meeple Center";
  }

  function setTags(el, tags, attr) {
    el.textContent = "";
    if (!tags || !tags.length) {
      el.textContent = EMPTY;
      return;
    }
    var wrap = document.createElement("span");
    wrap.className = "type-tags";
    for (var i = 0; i < tags.length; i++) {
      var badge = document.createElement("span");
      badge.className = "badge";
      badge.setAttribute(attr, tags[i]);
      badge.textContent = tags[i];
      wrap.appendChild(badge);
    }
    el.appendChild(wrap);
  }

  function hasBggId(game) {
    return /^\d+$/.test(game.bggId || "");
  }

  function renderArt(game) {
    var art = byId("game-art");
    var src = game.bgg && game.bgg.thumbnail;
    if (!src) {
      art.hidden = true;
      art.removeAttribute("src");
      return;
    }
    art.alt = "Box art for " + game.title;
    art.onerror = function () { art.hidden = true; };
    if (art.getAttribute("src") !== src) { art.src = src; }
    art.hidden = false;
  }

  // BGG separates paragraphs with a blank line; single line breaks inside a
  // paragraph (lists, credits) are kept by the CSS.
  function renderDescription(text) {
    var box = byId("game-description");
    box.textContent = "";
    var paragraphs = (text || "").split(/\n\s*\n/);
    for (var i = 0; i < paragraphs.length; i++) {
      var para = paragraphs[i].trim();
      if (!para) { continue; }
      var p = document.createElement("p");
      p.textContent = para;
      box.appendChild(p);
    }
    byId("game-about").hidden = !box.childNodes.length;
  }

  function loadDescription(game) {
    if (!game.bgg || !hasBggId(game)) {
      renderDescription("");
      return;
    }
    if (!details) {
      details = fetch(DETAILS_URL, { credentials: "omit" })
        .then(function (response) {
          if (!response.ok) { throw new Error("HTTP " + response.status); }
          return response.json();
        })
        .then(function (payload) { return payload.descriptions || {}; })
        .catch(function () { return {}; }); // the page is fine without it
    }
    var wanted = game.bggId;
    details.then(function (descriptions) {
      // Only if the page still shows this game.
      if (found && byId("game-bgg").getAttribute("data-bgg-id") === wanted) {
        renderDescription(descriptions[wanted]);
      }
    });
  }

  function render(game) {
    found = true;
    setHeading(game.title);
    setStatus("");

    var f = DATA.facts(game);
    setTags(byId("fact-type"), game.types, "data-type");
    setTags(byId("fact-location"), game.locations, "data-location");
    byId("fact-players").textContent = DATA.playersText(f) || EMPTY;
    var best = byId("fact-best");
    best.textContent = f.bestWith;
    best.hidden = !f.bestWith;
    byId("fact-time").textContent = DATA.timeText(f) || EMPTY;
    byId("fact-weight").textContent = f.weight
      ? f.weightText + " (" + f.weightBand + ")"
      : f.weightText || EMPTY;
    byId("fact-rental").textContent =
      game.status === "lendable" ? "Available to rent" : "In-house only";
    byId("game-facts").hidden = false;

    renderArt(game);
    byId("game-credit").hidden = !game.bgg;

    var bgg = byId("game-bgg");
    if (hasBggId(game)) {
      bgg.href = "https://boardgamegeek.com/boardgame/" + game.bggId;
      bgg.setAttribute("data-bgg-id", game.bggId);
      bgg.hidden = false;
    } else {
      bgg.removeAttribute("data-bgg-id");
      bgg.hidden = true;
    }

    loadDescription(game);
  }

  function showNotFound() {
    found = false;
    setHeading("Game not found");
    setStatus("We couldn't find that game in the library. It may have left the collection.");
    byId("game-facts").hidden = true;
    byId("game-bgg").hidden = true;
    byId("game-art").hidden = true;
    byId("game-about").hidden = true;
    byId("game-credit").hidden = true;
  }

  function showLoadError() {
    setHeading("Couldn't load this game");
    setStatus("The library didn't respond. Check your connection and try again.");
  }

  function fetchCached() {
    return fetch(CACHE_URL, { credentials: "omit" }).then(function (response) {
      if (!response.ok) { throw new Error("HTTP " + response.status); }
      return response.json();
    }).then(function (payload) {
      return payload.games || [];
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
        // The sheet has no BGG data; carry it over from the saved copy.
        return DATA.withBgg(games, cachedGames);
      });
  }

  function load(id) {
    fetchCached()
      .then(function (games) {
        cachedGames = games;
        var game = DATA.findById(games, id);
        if (game) { render(game); }
      })
      .catch(function () {
        // No saved copy is fine; the sheet below can still answer.
      })
      .then(fetchLive)
      .then(function (games) {
        var game = DATA.findById(games, id);
        if (game) {
          render(game);
        } else {
          showNotFound();
        }
      })
      .catch(function () {
        // A saved copy already on screen is better than an error.
        if (!found) { showLoadError(); }
      });
  }

  function init() {
    if (!DATA) { return; }
    var id = new URLSearchParams(window.location.search).get("id");
    if (!id) {
      showNotFound();
      return;
    }
    load(id);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
