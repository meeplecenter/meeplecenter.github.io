# Meeple Center Website

This is the website for Meeple Center. It's a small, plain HTML website hosted using GitHub pages.

## File structure

- `index.html`: the homepage (About)
- `membership.html`: membership levels, dues, and the sign-up form
- `catalog.html`: the searchable list of games in the lending library
- `calendar.html`: the Events page with the Google Calendar embed
- `css/styles.css`: all the styling for every page, in one file
- `js/catalog.js`: builds the Game Catalog table and powers its filters
- `js/catalog-data.js`: reads the library spreadsheet; shared by the page and the weekly refresh
- `data/games.json`: a saved copy of the catalog, shown instantly while the live spreadsheet loads
- `scripts/fetch-catalog.js`: rebuilds `data/games.json`
- `.github/workflows/refresh-catalog.yml`: runs that script once a week

Every page links to the same stylesheet, so a change to `css/styles.css` updates the look of the whole site at once.

## The look of the site

The design comes from the logo: the deep teal of the words, the five meeple colors (purple, green, yellow, red, blue), and heavy rounded shapes with hard offset shadows. Two things are worth knowing if you edit pages:

- **The meeple shape** lives in one file, `assets/Meeple_Generic.svg`. To draw a meeple anywhere, write `<span class="meeple-icon"></span>` and give it a size and a color in CSS: the shape is pulled in as a mask, so the color is just the element's `background` (by default it matches the surrounding text). Nothing needs to be copied into a new page.
- **Each page owns a color**, set by the `data-page` attribute on the `<body>` tag (`about`, `membership`, `catalog`, `events`). It tints the nav underline and the small label above the page heading.

Fonts load from Google Fonts. If you open the files with no internet connection the site still works and just falls back to your computer's built-in fonts.

## Viewing the site

There's nothing to install and no server to run. Just double-click `index.html` (or any of the other `.html` files) and it will open in your web browser. If you want to preview changes before publishing, just save the file and refresh the browser tab.

**One exception: the Game Catalog.** Because that page loads the game list from the library spreadsheet, browsers refuse to fetch it when the page is opened straight off your hard drive, so the table will show an error instead of the games. Every other page is fine. To preview the catalog properly, open a terminal in this folder and run one of these, then visit `http://localhost:8000/catalog.html`:

```
python -m http.server 8000     # if you have Python
npx serve                      # if you have Node
```

This only affects previewing on your own computer. Once the site is published to GitHub Pages the catalog works normally.

The recommended approach is to use VS Code's built-in browser. This will load everything correctly.

## Setting up the Google Calendar

The Events page (`calendar.html`) shows a live Google Calendar so you don't have to update the website every time you schedule an event. It is already connected to the public **meeplecenter@gmail.com** calendar, so adding an event there makes it appear on the website automatically: no code changes needed.

## Adding a game to the catalog

**Add it to the library spreadsheet.** The Game Catalog page reads the spreadsheet every time someone opens it, so a game you add will be displayed automatically. Nobody needs to edit `catalog.html` to add games.

The spreadsheet is the [Meeple Center library sheet](https://docs.google.com/spreadsheets/d/14E2W7WBHVCCoZHOgNvSgtmfyr-WgxsfsuN92z7g48Wk/edit?gid=768323261). Here's how its columns turn into what people see:

| Spreadsheet column | On the website |
| --- | --- |
| `Title` | The game's name. **A row with a blank title is skipped**, which is how the empty rows at the bottom of the sheet stay off the site. |
| `Type` (and the column to its right) | The colored tags, and the "Type" filter. Separate several with commas: `Eurogame, Drafting`. |
| `Max Player Count` | The row of meeples. `5+ Player` draws four meeples and a `5+`. |
| `Length` | The play time in minutes. It reads the first number it finds, so `~60 Minutes` becomes `60`. |
| `MC` | Complexity: `1` shows as Light, `2` as Medium, `3` as Heavy. Left blank, the row shows a dash. |
| `Rental` | `TRUE` shows as a green checkmark, anything else as a gray circled x. |

Two things worth knowing:

- **Type tags don't need any setup.** Invent a new one in the spreadsheet and it appears on the site and in the Type dropdown on its own. It'll be a plain grey tag unless someone adds a color for it in the "Type colors" block in `css/styles.css`.
- **`Plays`, `Size`, `Condition`, and `Donated By` are ignored** by the website. They're only in the spreadsheet.

### The weekly saved copy

The page doesn't make visitors wait on Google. It draws the table straight from `data/games.json`, a copy of the catalog kept in this repository, so the games appear immediately. Then, in the background, it reads the real spreadsheet and quietly updates the table if anything has changed since that copy was made. In practice this is invisible: the list is on screen right away and correct a moment later.

If Google is ever unreachable, that background step simply fails and the saved copy stays on screen, with a note above the table saying which day it's from. Either way visitors see a full catalog.

Two useful consequences: a change you make in the spreadsheet still shows up on the site the very next time someone loads the page, and if someone is already searching or filtering when the update lands, their search box and filters are left exactly as they were.

That file refreshes itself every Monday morning through GitHub Actions, so it's never more than a week behind. Nobody has to run it by hand, but you can: go to the **Actions** tab on GitHub, pick **Refresh game catalog cache**, and click **Run workflow**. Or, on your own computer, `node scripts/fetch-catalog.js`.

As a safety net, the refresh refuses to overwrite a good copy if the game count suddenly drops by half, since that usually means the spreadsheet broke rather than that the library shrank. If you really did remove that many games, tick the **"Write even if the game count dropped by half"** box when running the workflow by hand.

## Updating membership levels or dues

Membership levels and prices live in a table in `membership.html`. Open the file, find the table, and edit the level names, prices, or descriptions directly in the `<td>` cells. No other files need to change.

## The membership form

`membership.html` doesn't have a sign-up form built into the page. Instead, it links out to the Zeffy membership form.

That link URL appears in exactly **three** places in `membership.html`: the button at the top of the page, the first item in the "How to sign up" list, and the button in the "Ready to join?" section at the bottom.

## Deploying

This is a fully static website, meaning the files themselves are the whole website, with no database or server-side code. It's set up to be hosted on **GitHub Pages**:

1. Push to this GitHub repository.
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Choose the `main` branch and the `/ (root)` folder, then save.
5. Wait about a minute, and the site will publish at `https://<username>.github.io/<repository>/`.

A few things worth knowing:

- `index.html` at the root of the repository automatically becomes the site's home page, with no extra configuration needed.
- There's no build step. GitHub Pages serves the files exactly as they are in the repository.
- Every link in the site is relative, so it works the same whether the site lives at the root of a domain or in a subfolder (like the `/<repository>/` path GitHub Pages uses).
- After you edit and push a change, it goes live on the site shortly after.

### One note on the weekly catalog refresh

GitHub pauses scheduled workflows in repositories with no activity for 60 days, and emails the owner when it does. If the catalog copy ever goes stale for that reason, open the **Actions** tab and re-enable it.
