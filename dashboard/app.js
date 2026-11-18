// Token Radar dashboard (radar-2). Reads window.RADAR from data.js —
// written beside dashboard/ by main.ts — and renders the ranked board,
// the filters, the live-token view and a per-protocol detail panel.
// No network: every value on the page comes from data.js.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var app = document.getElementById('app');
  if (!DATA || !app) return;

  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return money.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function age(n) {
    if (n === null || n === undefined) return 'unknown';
    if (n >= 365) return (n / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(n)) + 'd';
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  // radar-2 recomputed in the page, so the detail panel can check the
  // number board.json carries against the same arithmetic.
  function impliedOf(row) {
    var m = DATA.model;
    var g = Math.min(m.growth_high, Math.max(m.growth_low, row.change_7d === null ? 0 : row.change_7d));
    var growth = 1 + (g / 100) * m.growth_weight;
    var a = row.age_days === null ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_base + m.maturity_span * (1 - Math.exp(-Math.max(a, 0) / m.maturity_halflife_days));
    var extra = Math.min(Math.max((row.chains || []).length - 1, 0), m.breadth_max_extra);
    var breadth = 1 + m.breadth_per_chain * extra;
    return Math.max(1, Math.round(row.tvl_usd * m.base_multiple * growth * maturity * breadth));
  }

  function bySlug(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (r.tvl_usd < state.minTvl) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (state.sort === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (state.sort === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (state.sort === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (state.sort === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (state.sort === 'chains') { av = (a.chains || []).length; bv = (b.chains || []).length; }
      else if (state.sort === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return bySlug(a.slug, b.slug);
    });
  }

  function fillSelect(el, values, allLabel) {
    el.innerHTML = '<option value="all">' + esc(allLabel) + '</option>' +
      values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
  }

  function renderMeta() {
    document.getElementById('mast-meta').textContent = 'Snapshot ' + DATA.as_of + '  ·  radar-2  ·  ' + DATA.board_size + ' rows';
    var s = document.getElementById('stats');
    s.innerHTML = [
      ['Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size],
      ['Pre-token rows', String(DATA.board_size)],
      ['Early rows below $50M floor', String(DATA.early_size)],
      ['Live-token set aside', String(DATA.live_size)],
      ['Top implied value', usd(DATA.rows[0] ? DATA.rows[0].implied_value_usd : 0)]
    ].map(function (kv) { return '<div><dt>' + kv[0] + '</dt><dd>' + kv[1] + '</dd></div>'; }).join('');
    var m = DATA.model;
    document.getElementById('formula').textContent =
      'implied = round( tvl_usd x ' + m.base_multiple +
      ' x (1 + clamp(change_7d, ' + m.growth_low + ', ' + m.growth_high + ') / 100 x ' + m.growth_weight + ')' +
      ' x (' + m.maturity_base + ' + ' + m.maturity_span + ' x (1 - exp(-age_days / ' + m.maturity_halflife_days + ')))' +
      ' x (1 + ' + m.breadth_per_chain + ' x min(chains - 1, ' + m.breadth_max_extra + ')) )';
    document.getElementById('model-note').textContent =
      'TVL and 7-day growth come from the snapshot. Age is the days since the protocol was first listed; an unlisted age uses ' +
      m.unknown_age_days + ' days. Maturity rises fast in year one and then flattens. Breadth rewards up to four extra chains. ' +
      'One function scores every protocol — no name is special-cased and no row is hand-picked.';
  }

  function renderTable() {
    var tbody = document.getElementById('rows');
    var caption = document.getElementById('caption');
    var empty = document.getElementById('empty');
    var count = document.getElementById('count');
    document.getElementById('tab-pre').setAttribute('aria-pressed', state.tab === 'pre-token' ? 'true' : 'false');
    document.getElementById('tab-live').setAttribute('aria-pressed', state.tab === 'live' ? 'true' : 'false');
    if (state.tab === 'live') {
      caption.textContent = 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.';
      count.textContent = DATA.live.length + ' live-token protocols';
      tbody.innerHTML = DATA.live.map(function (r) {
        return '<tr><td class="num">live</td><td class="pname"><b>' + esc(r.name) + '</b><span>' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') + '</span></td>' +
          '<td class="num">' + usd(r.tvl_usd) + '</td><td class="num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</td>' +
          '<td class="num">—</td><td class="num">' + (r.chains || []).length + '</td><td class="num">' + usd(r.mcap_usd) + '</td><td><span class="badge live">already trades</span></td></tr>';
      }).join('');
      empty.hidden = true;
      return;
    }
    var list = sorted(filtered());
    var max = list.length ? list[0].implied_value_usd : 1;
    caption.textContent = 'Pre-token protocols, strongest implied value first. Click a row for its breakdown and farm plan.';
    count.textContent = list.length + ' of ' + DATA.board_size + ' rows shown';
    empty.hidden = list.length > 0;
    tbody.innerHTML = list.map(function (r) {
      var w = Math.max(3, Math.round((r.implied_value_usd / max) * 100));
      return '<tr data-slug="' + esc(r.slug) + '" tabindex="0" class="' + (state.selected === r.slug ? 'sel' : '') + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td class="pname"><b>' + esc(r.name) + '</b><span>' + esc(r.category || 'Other') + ' on ' + esc((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain') + '</span></td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num">' + (r.chains || []).length + '</td>' +
        '<td><span class="bar"><i aria-hidden="true"><b style="width:' + w + '%"></b></i><span class="num">' + usd(r.implied_value_usd) + '</span></span></td>' +
        '<td><span class="badge">no token</span></td></tr>';
    }).join('');
    Array.prototype.forEach.call(tbody.querySelectorAll('tr'), function (tr) {
      tr.addEventListener('click', function () { openDetail(tr.getAttribute('data-slug')); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(tr.getAttribute('data-slug')); } });
    });
  }

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    var recomputed = impliedOf(row);
    var steps = (row.farm_steps || []).map(function (s) {
      var ci = s.indexOf(' Cost: ');
      var action = ci >= 0 ? s.slice(0, ci) : s;
      var tail = ci >= 0 ? s.slice(ci + 1) : '';
      return '<li><b>' + esc(action) + '</b><span>' + esc(tail) + '</span></li>';
    }).join('');
    document.getElementById('detail-in').innerHTML =
      '<button type="button" class="d-close" id="d-close">Close</button>' +
      '<p class="d-kicker">RANK ' + row.rank + ' OF ' + DATA.board_size + ' · PRE-TOKEN</p>' +
      '<h2>' + esc(row.name) + '</h2>' +
      '<p class="d-sub">' + esc(row.category || 'Other') + ' on ' + esc((row.chains || []).join(', ') || 'an unnamed chain') + ' · listed ' + esc(row.listed_at || 'date unknown') + '</p>' +
      '<div class="d-sec"><h3>Implied value — radar-2 breakdown</h3><div class="kv">' +
      '<div><span>TVL</span><b>' + usd(row.tvl_usd) + '</b></div>' +
      '<div><span>Seven-day growth</span><b>' + pct(row.change_7d) + '</b></div>' +
      '<div><span>Age with no token</span><b>' + age(row.age_days) + '</b></div>' +
      '<div><span>Chains (' + (row.chains || []).length + ')</span><b>' + esc((row.chains || []).slice(0, 4).join(', ') || '—') + '</b></div>' +
      '<div><span>Growth multiplier</span><b>' + row.growth_multiplier + '</b></div>' +
      '<div><span>Maturity multiplier</span><b>' + row.maturity_multiplier + '</b></div>' +
      '<div><span>Breadth multiplier</span><b>' + row.breadth_multiplier + '</b></div>' +
      '<div><span>Implied value</span><b>' + usd(row.implied_value_usd) + '</b></div></div>' +
      '<p class="d-check">The page recomputes this row as ' + usd(recomputed) + (recomputed === row.implied_value_usd ? ' — the same number board.json carries.' : ' — which differs from the board; the data would be stale.') + ' This is an estimate, not a price.</p></div>' +
      '<div class="d-sec"><h3>Farm plan</h3><ol class="steps">' + steps + '</ol></div>';
    document.getElementById('detail').hidden = false;
    document.getElementById('d-close').addEventListener('click', closeDetail);
    renderTable();
  }

  function closeDetail() {
    state.selected = null;
    document.getElementById('detail').hidden = true;
    writeHash();
    renderTable();
  }

  function readHash() {
    var p = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (p.get('q') !== null) state.q = p.get('q');
    if (p.get('category') !== null) state.category = p.get('category');
    if (p.get('chain') !== null) state.chain = p.get('chain');
    if (p.get('min') !== null) state.minTvl = Number(p.get('min')) || 0;
    if (p.get('tab') === 'live') state.tab = 'live';
    if (p.get('p') !== null) state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.minTvl !== 0) p.set('min', String(state.minTvl));
    if (state.tab === 'live') p.set('tab', 'live');
    if (state.selected) p.set('p', state.selected);
    var next = p.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  function render() { renderMeta(); renderTable(); if (state.selected) openDetail(state.selected); app.setAttribute('aria-busy', 'false'); }

  // Wire the filters once, from the data.
  var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
  var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
  fillSelect(document.getElementById('cat'), cats, 'All categories');
  fillSelect(document.getElementById('chain'), chains, 'All chains');
  readHash();
  var qEl = document.getElementById('q');
  var catEl = document.getElementById('cat');
  var chainEl = document.getElementById('chain');
  var minEl = document.getElementById('mintvl');
  qEl.value = state.q; catEl.value = cats.indexOf(state.category) >= 0 ? state.category : 'all'; state.category = catEl.value;
  chainEl.value = chains.indexOf(state.chain) >= 0 ? state.chain : 'all'; state.chain = chainEl.value;
  minEl.value = String(state.minTvl);
  qEl.addEventListener('input', function () { state.q = qEl.value; writeHash(); renderTable(); });
  catEl.addEventListener('change', function () { state.category = catEl.value; writeHash(); renderTable(); });
  chainEl.addEventListener('change', function () { state.chain = chainEl.value; writeHash(); renderTable(); });
  minEl.addEventListener('change', function () { state.minTvl = Number(minEl.value); writeHash(); renderTable(); });
  document.getElementById('tab-pre').addEventListener('click', function () { state.tab = 'pre-token'; writeHash(); renderTable(); });
  document.getElementById('tab-live').addEventListener('click', function () { state.tab = 'live'; writeHash(); renderTable(); });
  document.getElementById('clear').addEventListener('click', function () {
    state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.tab = 'pre-token';
    qEl.value = ''; catEl.value = 'all'; chainEl.value = 'all'; minEl.value = '0';
    writeHash(); renderTable();
  });
  Array.prototype.forEach.call(document.querySelectorAll('th button[data-sort]'), function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = -1; }
      renderTable();
    });
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.selected) closeDetail(); });

  render();
})();
