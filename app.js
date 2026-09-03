// ---- Config -----------------------------------------------------------------
// Paste the Apps Script Web App /exec URL here after deploying Code.gs.
const API_URL = 'https://script.google.com/macros/s/AKfycbwvpM_hTxGV_wjQFipfX_-QIpq8olwDZj1QlC4BD6K4UtMjP6B7lGCYo0pX55_bxDvj/exec';

// ---- State ------------------------------------------------------------------
let pin = localStorage.getItem('el_pin') || '';
let categories = [];
let currentMonth = monthKey(new Date());
let pendingRecategorizeId = null;

// ---- DOM refs -----------------------------------------------------------------
const pinScreen = document.getElementById('pinScreen');
const app = document.getElementById('app');
const pinInput = document.getElementById('pinInput');
const pinSubmit = document.getElementById('pinSubmit');
const pinError = document.getElementById('pinError');

const tabLogBtn = document.getElementById('tabLogBtn');
const tabSummaryBtn = document.getElementById('tabSummaryBtn');
const logView = document.getElementById('logView');
const summaryView = document.getElementById('summaryView');

const logForm = document.getElementById('logForm');
const logInput = document.getElementById('logInput');
const logStatus = document.getElementById('logStatus');
const recentList = document.getElementById('recentList');

const monthLabel = document.getElementById('monthLabel');
const prevMonthBtn = document.getElementById('prevMonth');
const nextMonthBtn = document.getElementById('nextMonth');
const summaryTotal = document.getElementById('summaryTotal');
const categoryList = document.getElementById('categoryList');

const categoryPicker = document.getElementById('categoryPicker');
const categoryOptions = document.getElementById('categoryOptions');
const categoryCancel = document.getElementById('categoryCancel');

// ---- API helpers --------------------------------------------------------------

async function apiGet(params) {
  const url = new URL(API_URL);
  url.searchParams.set('pin', pin);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  return res.json();
}

async function apiPost(body) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' }, // avoids CORS preflight to Apps Script
    body: JSON.stringify({ ...body, pin })
  });
  return res.json();
}

// ---- PIN gate -----------------------------------------------------------------

function showPinScreen() {
  pinScreen.classList.remove('hidden');
  app.classList.add('hidden');
  pinInput.focus();
}

function showApp() {
  pinScreen.classList.add('hidden');
  app.classList.remove('hidden');
  loadRecent();
  loadCategories();
}

async function tryUnlock(candidatePin) {
  pin = candidatePin;
  const result = await apiGet({ action: 'recent' });
  if (result.ok) {
    localStorage.setItem('el_pin', pin);
    pinError.classList.add('hidden');
    showApp();
  } else {
    pin = '';
    pinError.classList.remove('hidden');
  }
}

pinSubmit.addEventListener('click', () => {
  const v = pinInput.value.trim();
  if (v) tryUnlock(v);
});
pinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') pinSubmit.click();
});

// ---- Tabs -----------------------------------------------------------------

tabLogBtn.addEventListener('click', () => switchTab('log'));
tabSummaryBtn.addEventListener('click', () => switchTab('summary'));

function switchTab(tab) {
  const isLog = tab === 'log';
  tabLogBtn.classList.toggle('active', isLog);
  tabSummaryBtn.classList.toggle('active', !isLog);
  logView.classList.toggle('hidden', !isLog);
  summaryView.classList.toggle('hidden', isLog);
  if (!isLog) loadSummary();
}

// ---- Log view -----------------------------------------------------------------

logForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = logInput.value.trim();
  if (!text) return;
  logInput.value = '';
  logStatus.textContent = 'Saving…';
  try {
    const result = await apiPost({ action: 'log', text });
    if (result.ok) {
      logStatus.textContent = `Added ${result.entry.description} — ₹${result.entry.amount}`;
      recentList.prepend(createEntryElement(result.entry));
    } else {
      logStatus.textContent = 'Failed to save: ' + (result.error || 'unknown error');
    }
  } catch (err) {
    logStatus.textContent = 'Network error, try again.';
  }
});

async function loadRecent() {
  const result = await apiGet({ action: 'recent' });
  if (!result.ok) return;
  renderRecent(result.entries);
}

function renderRecent(entries) {
  recentList.innerHTML = '';
  entries.forEach((entry) => recentList.appendChild(createEntryElement(entry)));
}

function createEntryElement(entry) {
  const li = document.createElement('li');

  const left = document.createElement('div');
  left.innerHTML = `<div class="entry-desc">${escapeHtml(entry.description)}</div>
                     <div class="entry-date">${entry.date}</div>`;

  const right = document.createElement('div');
  right.className = 'entry-right';

  const amount = document.createElement('span');
  amount.className = 'entry-amount';
  amount.textContent = `₹${entry.amount}`;

  const chip = document.createElement('button');
  chip.className = 'chip';
  chip.textContent = entry.category;
  chip.addEventListener('click', () => openCategoryPicker(entry.id));

  right.appendChild(amount);
  right.appendChild(chip);
  li.appendChild(left);
  li.appendChild(right);
  return li;
}

// ---- Category picker -----------------------------------------------------------------

async function loadCategories() {
  const result = await apiGet({ action: 'categories' });
  if (result.ok) categories = result.categories;
}

function openCategoryPicker(entryId) {
  pendingRecategorizeId = entryId;
  categoryOptions.innerHTML = '';
  categories.forEach((cat) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.textContent = cat;
    btn.addEventListener('click', () => chooseCategory(cat));
    li.appendChild(btn);
    categoryOptions.appendChild(li);
  });
  categoryPicker.classList.remove('hidden');
}

async function chooseCategory(category) {
  categoryPicker.classList.add('hidden');
  const id = pendingRecategorizeId;
  pendingRecategorizeId = null;
  if (!id) return;
  await apiPost({ action: 'recategorize', id, category });
  loadRecent();
}

categoryCancel.addEventListener('click', () => {
  categoryPicker.classList.add('hidden');
  pendingRecategorizeId = null;
});

// ---- Summary view -----------------------------------------------------------------

prevMonthBtn.addEventListener('click', () => {
  currentMonth = shiftMonth(currentMonth, -1);
  loadSummary();
});
nextMonthBtn.addEventListener('click', () => {
  currentMonth = shiftMonth(currentMonth, 1);
  loadSummary();
});

async function loadSummary() {
  monthLabel.textContent = formatMonthLabel(currentMonth);
  summaryTotal.textContent = 'Loading…';
  categoryList.innerHTML = '';
  const result = await apiGet({ action: 'summary', month: currentMonth });
  if (!result.ok) {
    summaryTotal.textContent = 'Failed to load summary.';
    return;
  }
  renderSummary(result.summary);
}

function renderSummary(summary) {
  summaryTotal.innerHTML = `Total: <strong>₹${summary.total.toFixed(2)}</strong>`;
  categoryList.innerHTML = '';

  if (!summary.categories.length) {
    const p = document.createElement('p');
    p.className = 'status';
    p.textContent = 'No expenses logged this month yet.';
    categoryList.appendChild(p);
    return;
  }

  summary.categories.forEach((cat) => {
    const li = document.createElement('li');
    li.className = 'category-item';

    const head = document.createElement('div');
    head.className = 'category-head';
    head.innerHTML = `<span class="category-name">${escapeHtml(cat.category)}</span>
                       <span class="category-total">₹${cat.total.toFixed(2)}</span>`;
    head.addEventListener('click', () => li.classList.toggle('open'));

    const details = document.createElement('div');
    details.className = 'category-entries';
    cat.entries.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'sub-row';
      row.innerHTML = `<span>${escapeHtml(entry.description)}</span><span>₹${entry.amount}</span>`;
      details.appendChild(row);
    });

    li.appendChild(head);
    li.appendChild(details);
    categoryList.appendChild(li);
  });
}

// ---- Utils -----------------------------------------------------------------

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return monthKey(d);
}

function formatMonthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Init -----------------------------------------------------------------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

if (pin) {
  tryUnlock(pin);
} else {
  showPinScreen();
}
