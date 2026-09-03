/**
 * Expense Logger — Google Apps Script backend.
 *
 * Deploy this as a Web App (Deploy > New deployment > Web app):
 *   - Execute as:   Me
 *   - Who has access: Anyone
 * Then copy the /exec URL into app.js (API_URL).
 *
 * Set the shared PIN once via:  Project Settings > Script Properties > PIN
 * (or run setPin() below after editing the value).
 *
 * The Sheet must have two tabs:
 *   Expenses : Timestamp | Date | Description | Amount | Category | Who | Raw
 *   Rules    : Keyword   | Category
 */

var SHEET_EXPENSES = 'Expenses';
var SHEET_RULES = 'Rules';
var FALLBACK_CATEGORY = 'Miscellaneous';

// ---- HTTP entrypoints -------------------------------------------------------

function doGet(e) {
  try {
    if (!checkPin_(e)) return json_({ ok: false, error: 'bad_pin' });
    var action = (e.parameter.action || 'recent');
    if (action === 'summary') {
      return json_({ ok: true, summary: getSummary_(e.parameter.month) });
    }
    if (action === 'recent') {
      return json_({ ok: true, entries: getRecent_(20) });
    }
    if (action === 'categories') {
      return json_({ ok: true, categories: getCategories_() });
    }
    return json_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    // Body is sent as text/plain (simple request) to avoid CORS preflight.
    var body = {};
    if (e && e.postData && e.postData.contents) {
      body = JSON.parse(e.postData.contents);
    }
    if (!checkPinValue_(body.pin)) return json_({ ok: false, error: 'bad_pin' });

    var action = body.action || 'log';
    if (action === 'log') {
      return json_({ ok: true, entry: logExpense_(body.text, body.who) });
    }
    if (action === 'recategorize') {
      return json_({ ok: true, entry: recategorize_(body.id, body.category) });
    }
    return json_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// ---- Core operations --------------------------------------------------------

function logExpense_(rawText, who) {
  var raw = String(rawText || '').trim();
  if (!raw) throw 'empty_text';

  var parsed = parseText_(raw);
  var category = categorize_(parsed.description);
  var now = new Date();
  var tz = Session.getScriptTimeZone();
  var id = now.toISOString();
  var dateStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

  var sheet = getSheet_(SHEET_EXPENSES);
  sheet.appendRow([
    id,
    dateStr,
    parsed.description,
    parsed.amount,
    category,
    who || '',
    raw
  ]);

  return {
    id: id,
    date: dateStr,
    description: parsed.description,
    amount: parsed.amount,
    category: category,
    who: who || '',
    raw: raw
  };
}

function recategorize_(id, category) {
  if (!id || !category) throw 'missing_args';
  var sheet = getSheet_(SHEET_EXPENSES);
  var values = sheet.getDataRange().getValues();
  // Column 0 = Timestamp/id, column 4 = Category. Row 0 is the header.
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(id)) {
      sheet.getRange(r + 1, 5).setValue(category);
      return { id: id, category: category };
    }
  }
  throw 'not_found';
}

function getRecent_(limit) {
  var sheet = getSheet_(SHEET_EXPENSES);
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var count = Math.min(limit, last - 1);
  var start = last - count + 1;
  var rows = sheet.getRange(start, 1, count, 7).getValues();
  var out = rows.map(rowToEntry_);
  out.reverse(); // newest first
  return out;
}

function getSummary_(month) {
  // month = 'YYYY-MM'; defaults to current month in the script timezone.
  var tz = Session.getScriptTimeZone();
  if (!month) month = Utilities.formatDate(new Date(), tz, 'yyyy-MM');

  var sheet = getSheet_(SHEET_EXPENSES);
  var last = sheet.getLastRow();
  var byCategory = {};
  var total = 0;

  if (last >= 2) {
    var rows = sheet.getRange(2, 1, last - 1, 7).getValues();
    for (var i = 0; i < rows.length; i++) {
      var entry = rowToEntry_(rows[i]);
      if (String(entry.date).slice(0, 7) !== month) continue;
      var cat = entry.category || FALLBACK_CATEGORY;
      if (!byCategory[cat]) byCategory[cat] = { total: 0, entries: [] };
      byCategory[cat].total += entry.amount;
      byCategory[cat].entries.push(entry);
      total += entry.amount;
    }
  }

  // Sort categories by total descending.
  var categories = Object.keys(byCategory).map(function (cat) {
    return { category: cat, total: byCategory[cat].total, entries: byCategory[cat].entries };
  });
  categories.sort(function (a, b) { return b.total - a.total; });

  return { month: month, total: total, categories: categories };
}

// ---- Parsing & categorization ----------------------------------------------

function parseText_(raw) {
  // Grab the LAST number in the string as the amount (supports 1,200.50 and ₹250).
  var matches = raw.match(/[\d][\d,]*(\.\d+)?/g);
  var amount = 0;
  var description = raw;

  if (matches && matches.length) {
    var amtStr = matches[matches.length - 1];
    amount = parseFloat(amtStr.replace(/,/g, '')) || 0;
    // Remove that last occurrence from the description.
    var idx = raw.lastIndexOf(amtStr);
    description = (raw.slice(0, idx) + raw.slice(idx + amtStr.length));
  }

  description = description
    .replace(/[₹$]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\bfor\b\s*$/i, '')
    .replace(/[-,:]\s*$/, '')
    .trim();

  if (!description) description = raw.replace(/[\d,.₹$]/g, ' ').replace(/\s+/g, ' ').trim();
  return { amount: amount, description: description };
}

function categorize_(description) {
  var text = String(description || '').toLowerCase();
  var rules = getRules_();
  for (var i = 0; i < rules.length; i++) {
    if (rules[i].keyword && text.indexOf(rules[i].keyword) !== -1) {
      return rules[i].category;
    }
  }
  return FALLBACK_CATEGORY;
}

function getRules_() {
  var sheet = getSheet_(SHEET_RULES);
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var rows = sheet.getRange(2, 1, last - 1, 2).getValues();
  return rows
    .filter(function (r) { return r[0] !== ''; })
    .map(function (r) {
      return { keyword: String(r[0]).toLowerCase().trim(), category: String(r[1]).trim() };
    });
}

function getCategories_() {
  var rules = getRules_();
  var set = {};
  rules.forEach(function (r) { if (r.category) set[r.category] = true; });
  set[FALLBACK_CATEGORY] = true;
  return Object.keys(set).sort();
}

// ---- Helpers ----------------------------------------------------------------

function rowToEntry_(r) {
  return {
    id: String(r[0]),
    date: (r[1] instanceof Date) ? Utilities.formatDate(r[1], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(r[1]),
    description: String(r[2]),
    amount: Number(r[3]) || 0,
    category: String(r[4]) || FALLBACK_CATEGORY,
    who: String(r[5] || ''),
    raw: String(r[6] || '')
  };
}

function getSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw 'missing_tab:' + name;
  return sheet;
}

function checkPin_(e) {
  return checkPinValue_(e && e.parameter ? e.parameter.pin : null);
}

function checkPinValue_(pin) {
  var expected = PropertiesService.getScriptProperties().getProperty('PIN');
  if (!expected) return false;
  return String(pin) === String(expected);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Optional convenience: set the PIN from the editor instead of the UI.
function setPin() {
  PropertiesService.getScriptProperties().setProperty('PIN', '1234'); // <-- change me
}

// Optional convenience: create the tabs + seed rules in a fresh spreadsheet.
function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var exp = ss.getSheetByName(SHEET_EXPENSES) || ss.insertSheet(SHEET_EXPENSES);
  exp.clear();
  exp.getRange(1, 1, 1, 7)
    .setValues([['Timestamp', 'Date', 'Description', 'Amount', 'Category', 'Who', 'Raw']])
    .setFontWeight('bold');

  var rules = ss.getSheetByName(SHEET_RULES) || ss.insertSheet(SHEET_RULES);
  rules.clear();
  rules.getRange(1, 1, 1, 2).setValues([['Keyword', 'Category']]).setFontWeight('bold');
  var seed = SEED_RULES_();
  rules.getRange(2, 1, seed.length, 2).setValues(seed);
}

function SEED_RULES_() {
  return [
    ['milkbasket', 'Groceries'],
    ['bigbasket', 'Groceries'],
    ['blinkit', 'Groceries'],
    ['zepto', 'Groceries'],
    ['dmart', 'Groceries'],
    ['grofers', 'Groceries'],
    ['vegetable', 'Groceries'],
    ['milk', 'Groceries'],
    ['grocery', 'Groceries'],
    ['swiggy', 'Food & Dining'],
    ['zomato', 'Food & Dining'],
    ['restaurant', 'Food & Dining'],
    ['cafe', 'Food & Dining'],
    ['dinner', 'Food & Dining'],
    ['lunch', 'Food & Dining'],
    ['uber', 'Transport'],
    ['ola', 'Transport'],
    ['petrol', 'Transport'],
    ['fuel', 'Transport'],
    ['diesel', 'Transport'],
    ['auto', 'Transport'],
    ['metro', 'Transport'],
    ['cab', 'Transport'],
    ['electricity', 'Utilities & Bills'],
    ['water', 'Utilities & Bills'],
    ['gas', 'Utilities & Bills'],
    ['internet', 'Utilities & Bills'],
    ['wifi', 'Utilities & Bills'],
    ['recharge', 'Utilities & Bills'],
    ['mobile', 'Utilities & Bills'],
    ['dth', 'Utilities & Bills'],
    ['bill', 'Utilities & Bills'],
    ['maid', 'Household/Help'],
    ['cook', 'Household/Help'],
    ['rent', 'Household/Help'],
    ['repair', 'Household/Help'],
    ['driver', 'Household/Help'],
    ['pharmacy', 'Health'],
    ['medicine', 'Health'],
    ['medical', 'Health'],
    ['doctor', 'Health'],
    ['apollo', 'Health'],
    ['hospital', 'Health'],
    ['clinic', 'Health'],
    ['amazon', 'Shopping'],
    ['flipkart', 'Shopping'],
    ['myntra', 'Shopping'],
    ['clothes', 'Shopping'],
    ['shopping', 'Shopping'],
    ['gift', 'Gifts'],
    ['netflix', 'Entertainment'],
    ['spotify', 'Entertainment'],
    ['movie', 'Entertainment'],
    ['prime', 'Entertainment'],
    ['hotstar', 'Entertainment'],
    ['subscription', 'Entertainment'],
    ['school', 'Kids/Education'],
    ['fees', 'Kids/Education'],
    ['tuition', 'Kids/Education'],
    ['toys', 'Kids/Education'],
    ['books', 'Kids/Education']
  ];
}
