// The Token Launch Radar's page. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a per-protocol detail view with the
// model's own arithmetic, the calibration the prices came from, and the trading
// protocols the radar never ranks. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;

  var $ = function (id) { return document.getElementById(id); };
  var rows = DATA.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  // ---------------------------------------------------------- formatting
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtFull(n) {
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.round(days) + 'd';
  }
  function fmtMult(n) { return n.toFixed(2) + 'x'; }

  // ---------------------------------------------------------- state
  var state = { view: 'board', q: '', category: 'all', chain: 'all', screen: 'all', sort: 'rank', dir: 1, slug: null };

  function parseHash() {
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    h.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      if (kv.length !== 2) return;
      var k = decodeURIComponent(kv[0]), v = decodeURIComponent(kv[1]);
      if (k === 'view' && (v === 'board' || v === 'model' || v === 'live')) state.view = v;
      if (k === 'detail') { state.view = 'detail'; state.slug = v; }
      if (k === 'q') state.q = v;
      if (k === 'cat') state.category = v;
      if (k === 'chain') state.chain = v;
      if (k === 'screen') state.screen = v;
      if (k === 'sort') state.sort = v;
      if (k === 'dir') state.dir = v === '-1' ? -1 : 1;
    });
  }
  function writeHash(replace) {
    var parts = [];
    if (state.view === 'detail' && state.slug) parts.push('detail=' + encodeURIComponent(state.slug));
    else if (state.view !== 'board') parts.push('view=' + state.view);
    if (state.view === 'board') {
      if (state.q) parts.push('q=' + encodeURIComponent(state.q));
      if (state.category !== 'all') parts.push('cat=' + encodeURIComponent(state.category));
      if (state.chain !== 'all') parts.push('chain=' + encodeURIComponent(state.chain));
      if (state.screen !== 'all') parts.push('screen=' + encodeURIComponent(state.screen));
      if (state.sort !== 'rank') parts.push('sort=' + state.sort, 'dir=' + state.dir);
    }
    var hash = '#' + parts.join('&');
    if (replace) history.replaceState(null, '', hash);
    else location.hash = hash;
  }

  // ---------------------------------------------------------- header + stats
  $('subline').textContent = 'Pre-token protocols, ranked by what their token would be worth. Snapshot: ' + DATA.source + ', sealed ' + DATA.as_of + '.';
  $('modelchip').textContent = 'model ' + DATA.model_version + ' · calibrated on ' + DATA.calibration.sample_size + ' trading protocols';

  $('stats').innerHTML =
    stat('Board rows', '<em>' + DATA.board_size + '</em>', DATA.watchlist_size + ' house watchlist + ' + DATA.extended_size + ' extended finds') +
    stat('Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'the floor every board must carry, whole') +
    stat('Calibration set', String(DATA.calibration.sample_size), 'trading protocols whose price of TVL the board borrows') +
    stat('Median price of $1 TVL', fmtMult(DATA.calibration.global_median), 'the global median market cap per TVL dollar');
  function stat(k, v, n) {
    return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div><div class="n">' + esc(n) + '</div></div>';
  }

  // ---------------------------------------------------------- filters
  function fillSelect(el, values, allLabel) {
    el.innerHTML = '<option value="all">' + esc(allLabel) + '</option>' + values.map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(v) + '</option>';
    }).join('');
  }
  var catCounts = {}, chainCounts = {};
  rows.forEach(function (r) {
    var c = r.category || '(uncategorised)';
    catCounts[c] = (catCounts[c] || 0) + 1;
    r.chains.forEach(function (ch) { chainCounts[ch] = (chainCounts[ch] || 0) + 1; });
  });
  var byCount = function (m) { return Object.keys(m).sort(function (a, b) { return m[b] - m[a] || (a < b ? -1 : 1); }); };
  fillSelect($('f-category'), byCount(catCounts), 'All categories');
  fillSelect($('f-chain'), byCount(chainCounts), 'All chains');

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || '(uncategorised)') !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) === -1) return false;
      if (state.screen !== 'all' && r.screen !== state.screen) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var key = state.sort, dir = state.dir;
    var val = function (r) {
      if (key === 'rank') return r.rank;
      if (key === 'name') return r.name.toLowerCase();
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'change') return r.change_7d === null ? -Infinity : r.change_7d;
      if (key === 'age') return r.age_days === null ? -1 : r.age_days;
      if (key === 'multiple') return r.model.multiple;
      if (key === 'ratio') return r.implied_value_usd / r.tvl_usd;
      return r.implied_value_usd;
    };
    out.sort(function (a, b) {
      var va = val(a), vb = val(b);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.rank - b.rank;
    });
    return out;
  }

  // ---------------------------------------------------------- board view
  function renderBoard() {
    var list = visibleRows();
    $('count').textContent = list.length + ' of ' + rows.length + ' protocols';
    document.querySelectorAll('#board-table th.sortable').forEach(function (th) {
      var k = th.getAttribute('data-sort');
      var label = th.getAttribute('data-label') || th.textContent.replace(/ [▲▼]$/, '');
      th.setAttribute('data-label', label);
      th.innerHTML = esc(label) + (state.sort === k ? ' <span class="dir">' + (state.dir === 1 ? '▲' : '▼') + '</span>' : '');
    });
    if (list.length === 0) {
      $('board-body').innerHTML = '<tr><td colspan="10" class="empty">No protocol on the board matches those filters. Loosen one and the radar sweeps again.</td></tr>';
      return;
    }
    $('board-body').innerHTML = list.map(function (r) {
      var chg = r.change_7d === null ? '<span>n/a</span>'
        : '<span class="' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + fmtPct(r.change_7d) + '</span>';
      return '<tr data-slug="' + esc(r.slug) + '"' + (r.rank <= 3 ? ' class="top3"' : '') + '>' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span><span class="pslug">' + esc(r.slug) + '</span>' +
          (r.screen === 'watchlist' ? '<span class="wdot" title="House watchlist"></span>' : '') + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '')) + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num">' + chg + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num">' + fmtMult(r.model.multiple) + '</td>' +
        '<td class="num implied">' + fmtUsd(r.implied_value_usd) + '</td>' +
        '<td class="num">' + (r.implied_value_usd / r.tvl_usd).toFixed(3) + 'x</td>' +
        '</tr>';
    }).join('');
  }

  // ---------------------------------------------------------- detail view
  function bandLabel(tvl) {
    if (tvl < DATA.floor_usd) return 'under the $50M floor';
    if (tvl < DATA.floor_usd * 10) return 'between the floor and 10x it';
    return 'over 10x the floor';
  }
  function renderDetail() {
    var r = bySlug[state.slug];
    if (!r) { state.view = 'board'; show(); return; }
    var m = r.model;
    var recomputed = Math.round(r.tvl_usd * m.multiple * m.size_factor * m.growth_multiplier * m.maturity_multiplier);
    var multWhy = m.multiple_source === 'category'
      ? 'the median market cap per TVL dollar of the ' + m.calibration_samples + ' trading protocols in ' + (r.category || 'this category')
      : 'the global median: this category has too few trading protocols to price itself, so all ' + m.calibration_samples + ' are used';
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    $('view-detail').innerHTML =
      '<button type="button" class="back" id="back">← Back to the board</button>' +
      '<div class="dhead"><h2>' + esc(r.name) + '</h2>' +
        '<span class="badge">' + esc(r.category || 'uncategorised') + '</span>' +
        (r.screen === 'watchlist' ? '<span class="badge watch">house watchlist</span>' : '<span class="badge ext">extended find</span>') +
        '<span class="badge">rank #' + r.rank + ' of ' + rows.length + '</span></div>' +
      '<div class="dgrid">' +
        dcard('Implied value', fmtFull(r.implied_value_usd), 'what its token would be worth at the market\'s own prices', true) +
        dcard('TVL', fmtFull(r.tvl_usd), 'total value locked in the snapshot') +
        dcard('7-day TVL change', fmtPct(r.change_7d), 'the week the snapshot sealed') +
        dcard('Running with no token', r.age_days === null ? 'unknown' : r.age_days + ' days', r.listed_at ? 'tracked by DefiLlama since ' + r.listed_at : 'no listing date in the record') +
      '</div>' +
      '<div class="panel"><h3>How this price is made</h3>' +
        '<table class="breakdown">' +
          brow('', 'TVL', fmtFull(r.tvl_usd), 'the protocol\'s own figure') +
          brow('x', 'Category multiple', m.multiple.toFixed(4), multWhy) +
          brow('x', 'Size factor', m.size_factor.toFixed(4), 'a protocol ' + bandLabel(r.tvl_usd) + ' prices thinner or richer than its category norm') +
          brow('x', 'Growth factor', m.growth_multiplier.toFixed(4), 'its 7-day TVL change of ' + fmtPct(m.growth_pct) + ' in the model\'s window, weighted 0.6') +
          brow('x', 'Maturity factor', m.maturity_multiplier.toFixed(4), (r.age_days === null ? 'an unrecorded age borrows the board\'s median' : r.age_days + ' days with no token') + ', of the 1,460 the model counts to full maturity') +
          '<tr class="total"><td class="op">=</td><td>Implied value</td><td class="val">' + fmtFull(r.implied_value_usd) + '</td><td class="why">the board\'s claim for ' + esc(r.name) + '</td></tr>' +
        '</table>' +
        '<p class="check">This page recomputes the price from the row\'s own factors and gets <b>' + fmtFull(recomputed) + '</b> — the same figure the board carries, so the page and the data agree.</p>' +
      '</div>' +
      '<div class="panel"><h3>The farm plan</h3><ol class="steps">' + steps + '</ol></div>';
    $('back').addEventListener('click', function () { state.view = 'board'; writeHash(false); show(); });
  }
  function brow(op, k, v, why) {
    return '<tr><td class="op">' + op + '</td><td>' + esc(k) + '</td><td class="val">' + esc(v) + '</td><td class="why">' + esc(why) + '</td></tr>';
  }
  function dcard(k, v, n, big) {
    return '<div class="dcard"><div class="k">' + esc(k) + '</div><div class="v' + (big ? ' big' : '') + '">' + esc(v) + '</div><div class="n">' + esc(n) + '</div></div>';
  }

  // ---------------------------------------------------------- model view
  function renderModel() {
    var c = DATA.calibration, mo = DATA.model;
    var catRows = c.by_category.map(function (x) {
      var used = x.samples >= mo.category_min_samples;
      return '<tr><td>' + esc(x.category) + '</td><td class="num">' + x.samples + '</td><td class="num">' + x.median_ratio.toFixed(4) + '</td><td>' + (used ? 'prices its category' : 'too few: the global median stands in') + '</td></tr>';
    }).join('');
    var bandRows = c.by_band.map(function (b, i) {
      var res = c.by_band_residual[i];
      return '<tr><td>' + esc(b.band) + '</td><td class="num">' + b.samples + '</td><td class="num">' + b.median_ratio.toFixed(4) + '</td><td class="num">' + (res ? res.median_residual.toFixed(4) : 'n/a') + '</td></tr>';
    }).join('');
    $('view-model').innerHTML =
      '<div class="prose">' +
      '<p><strong>The question.</strong> What would a protocol\'s token be worth if it launched today, at the prices the market already pays for the TVL of protocols that do trade? The radar answers from the sealed snapshot alone: no outside prices, no hand-picked names, one function for every row.</p>' +
      '<p class="formula">implied value = TVL x category multiple x size factor x growth factor x maturity factor</p>' +
      '<p><strong>Category multiple.</strong> The ' + c.sample_size + ' protocols in the snapshot whose token already trades reveal what TVL is worth: market cap divided by TVL. A pre-token protocol is priced at the median of its own category when at least ' + mo.category_min_samples + ' trading peers exist, else at the global median of <strong>' + c.global_median.toFixed(4) + '</strong>.</p>' +
      '<p><strong>Size factor.</strong> Big markets price TVL thinner, even inside a category. Each trading protocol\'s residual — its ratio over its own category\'s multiple — strips the category effect out; the median residual of a protocol\'s TVL band is its size factor, clamped to [' + mo.size_clamp_low + ', ' + mo.size_clamp_high + '].</p>' +
      '<p><strong>Growth factor.</strong> The seven-day TVL change, clamped to [' + mo.growth_floor_pct + '%, +' + mo.growth_cap_pct + '%], weighted ' + mo.growth_weight + ': a protocol that grew 50% in the sealed week is priced 30% above its base.</p>' +
      '<p><strong>Maturity factor.</strong> The longer a protocol has run with no token, the longer the record behind a launch: ' + mo.maturity_floor + ' on day one, rising linearly to ' + (mo.maturity_floor + mo.maturity_range).toFixed(2) + ' at ' + mo.maturity_days + ' days. An unrecorded listing date borrows the board\'s own median age.</p>' +
      '<p><strong>The screen.</strong> A protocol is ranked when its record shows no token and it is not a wrapped, staked, bridged or versioned product of one that trades: its category is not a bridge, staking or exchange category, its name carries no version marker and no whole word "wrapped", "staked" or "staking", and it does not open with an exchange\'s name. The house\'s 40-protocol watchlist is carried whole; the same screen then runs at every size, which is where the extended finds come from.</p>' +
      '</div>' +
      '<div class="grid2">' +
      '<div class="panel"><h3>Category multiples (mcap / TVL)</h3><table class="mini"><thead><tr><th>Category</th><th class="num">Trading</th><th class="num">Median</th><th>Role</th></tr></thead><tbody>' + catRows + '</tbody></table></div>' +
      '<div class="panel"><h3>Size bands</h3><table class="mini"><thead><tr><th>Band</th><th class="num">Trading</th><th class="num">Median ratio</th><th class="num">Size factor</th></tr></thead><tbody>' + bandRows + '</tbody></table>' +
      '<p class="check">The bands are the house\'s $50M floor and ten times it. The size factor is the band\'s median residual, before the model\'s clamp.</p></div>' +
      '</div>';
  }

  // ---------------------------------------------------------- live view
  function renderLive() {
    var body = DATA.live.map(function (p) {
      return '<tr data-slug=""><td><span class="pname">' + esc(p.name) + '</span><span class="pslug">' + esc(p.slug) + '</span></td>' +
        '<td>' + esc(p.category || '—') + '</td>' +
        '<td class="num">' + fmtUsd(p.tvl_usd) + '</td>' +
        '<td class="num">' + (p.mcap_usd === null ? 'n/a' : fmtUsd(p.mcap_usd)) + '</td>' +
        '<td class="num">' + (p.ratio === null ? 'n/a' : p.ratio.toFixed(4)) + '</td></tr>';
    }).join('');
    $('view-live').innerHTML =
      '<div class="prose"><p><strong>These already trade.</strong> The radar never ranks them: their market cap is the market\'s own figure, not a model\'s. They are on this page because they are the calibration set — the revealed prices of TVL that the board\'s implied values are built from. The largest ' + DATA.live.length + ' by market cap:</p></div>' +
      '<div class="tablewrap"><table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">mcap / TVL</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  // ---------------------------------------------------------- navigation
  function show() {
    ['board', 'detail', 'model', 'live'].forEach(function (v) {
      $('view-' + v).hidden = state.view !== v;
    });
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('on', t.getAttribute('data-view') === state.view || (state.view === 'detail' && t.getAttribute('data-view') === 'board'));
    });
    if (state.view === 'board') renderBoard();
    if (state.view === 'detail') renderDetail();
    if (state.view === 'model') renderModel();
    if (state.view === 'live') renderLive();
    window.scrollTo(0, 0);
  }

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      state.view = t.getAttribute('data-view');
      writeHash(false);
      show();
    });
  });
  $('board-body').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (!tr || !tr.getAttribute('data-slug')) return;
    state.view = 'detail';
    state.slug = tr.getAttribute('data-slug');
    writeHash(false);
    show();
  });
  document.querySelectorAll('#board-table th.sortable').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = k === 'rank' || k === 'name' ? 1 : -1; }
      writeHash(true);
      renderBoard();
    });
  });
  $('q').addEventListener('input', function () { state.q = $('q').value; writeHash(true); renderBoard(); });
  $('f-category').addEventListener('change', function () { state.category = $('f-category').value; writeHash(true); renderBoard(); });
  $('f-chain').addEventListener('change', function () { state.chain = $('f-chain').value; writeHash(true); renderBoard(); });
  $('f-screen').addEventListener('change', function () { state.screen = $('f-screen').value; writeHash(true); renderBoard(); });
  window.addEventListener('hashchange', function () { parseHash(); syncControls(); show(); });

  function syncControls() {
    $('q').value = state.q;
    $('f-category').value = state.category;
    $('f-chain').value = state.chain;
    $('f-screen').value = state.screen;
  }

  parseHash();
  syncControls();
  show();
})();
