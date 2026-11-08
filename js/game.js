/* game.js
 * Fills in game.html, the page an NFC tag opens: game.html?id=042.
 *
 * Loads the same way as the catalog. data/games.json paints the page without
 * waiting on Google, then the live sheet confirms it, so Location and Rental
 * are current. The sheet has the final say: a game only counts as "not found"
 * once the sheet has been read and doesn't list it.
 */
(function () {
  "use strict";

  var DATA = window.MeepleCatalogData;
  var CACHE_URL = "data/games.json";
  var EMPTY = "—";

  var found = false;

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

  function playersText(game) {
    if (!game.max) { return EMPTY; }
    if (game.open) { return game.max + " or more players"; }
    return game.max === 1 ? "1 player" : "Up to " + game.max + " players";
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

  function render(game) {
    found = true;
    setHeading(game.title);
    setStatus("");

    setTags(byId("fact-type"), game.types, "data-type");
    setTags(byId("fact-location"), game.locations, "data-location");
    byId("fact-players").textContent = playersText(game);
    byId("fact-time").textContent = game.time ? "About " + game.time + " minutes" : EMPTY;
    byId("fact-weight").textContent = game.weight || EMPTY;
    byId("fact-rental").textContent =
      game.status === "lendable" ? "Available to rent" : "In-house only";
    byId("game-facts").hidden = false;

    var bgg = byId("game-bgg");
    if (/^\d+$/.test(game.bggId || "")) {
      bgg.href = "https://boardgamegeek.com/boardgame/" + game.bggId;
      bgg.hidden = false;
    } else {
      bgg.hidden = true;
    }
  }

  function showNotFound() {
    found = false;
    setHeading("Game not found");
    setStatus("We couldn't find that game in the library. It may have left the collection.");
    byId("game-facts").hidden = true;
    byId("game-bgg").hidden = true;
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
        return games;
      });
  }

  function load(id) {
    fetchCached()
      .then(function (games) {
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
