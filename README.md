# Expense Logger — Setup

A tiny webapp for logging household expenses ("Milkbasket 5000", "Gift for
Arnab 500") and viewing a monthly summary by category. Data lives in a Google
Sheet; the app is a static PWA you install to your home screen.

## 1. Create the Google Sheet + script

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank
   spreadsheet. Name it e.g. "Expenses".
2. Extensions → Apps Script. Delete any starter code in `Code.gs`, then paste
   in the full contents of this repo's [Code.gs](Code.gs).
3. In the Apps Script editor, run `setupSheet` once (select it from the
   function dropdown, click Run). This creates the `Expenses` and `Rules` tabs
   with headers and ~55 seed keyword rules. The first run will ask you to
   authorize the script — that's expected, it's your own script.
4. Choose your PIN: edit the `setPin()` function, change `'1234'` to your
   PIN, run `setPin` once. (Or set it via Project Settings → Script
   Properties → add property `PIN`.)

## 2. Deploy the Web App

1. In the Apps Script editor: Deploy → New deployment.
2. Type: **Web app**.
3. Execute as: **Me**.
4. Who has access: **Anyone**.
5. Deploy, authorize again if asked, then copy the URL ending in `/exec`.

## 3. Point the front-end at your deployment

1. Open [app.js](app.js) in this folder.
2. Replace `PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE` with the `/exec` URL from
   step 2.

## 4. Deploy the static site to Netlify

Same flow as your other projects — either:

- Drag the `Expense logger` folder onto [app.netlify.com/drop](https://app.netlify.com/drop), or
- Connect this git repo to a new Netlify site (publish directory: `.`, no build command — `netlify.toml` is already set up for this).

Netlify gives you an HTTPS URL — that's what you'll open on both phones.

## 5. Install on both phones

1. Open the Netlify URL in the phone's browser.
2. Enter the PIN once (it's remembered after that).
3. Use the browser's "Add to Home Screen" (Share → Add to Home Screen on
   iOS; ⋮ menu → Add to Home Screen / Install app on Android).
4. Open from the home screen icon — it goes straight to the Log box.

## Using it

- **Log tab:** type e.g. `Milkbasket 5000`, tap Add. The app guesses the
  category from keywords in the `Rules` tab. Tap the category chip on any
  recent entry to correct it.
- **Summary tab:** pick a month, see totals per category (tap a category to
  expand its entries) and the grand total.

## Customizing categories

Open the `Rules` tab in the Google Sheet anytime — add, edit, or remove
`Keyword → Category` rows. No code changes or redeploy needed; the app reads
the sheet live. Unmatched entries fall into `Miscellaneous`.
