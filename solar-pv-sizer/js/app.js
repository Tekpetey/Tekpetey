/* UI wiring for the Solar PV Sizing Tool. */
(function () {
  'use strict';

  var D = window.PV_DATA;
  var S = window.SolarSizing;
  var IRR = window.Irradiance;
  var STORAGE_KEY = 'pv-sizer-project';
  var MONTHS = S.MONTHS;

  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function findAppliance(name) {
    return D.APPLIANCES.filter(function (a) { return a.name === name; })[0];
  }

  function newProject() {
    var system = clone(D.DEFAULTS.system);
    var batt = D.BATTERIES[system.batteryType];
    system.batteryDod = batt.dod;
    system.batteryEfficiency = batt.efficiency;
    var costs = clone(D.DEFAULTS.costs);
    costs.batteryPerKWh = batt.pricePerKWh;
    return {
      name: 'My solar project',
      location: { name: D.REGIONS[0].places[0].name, lat: D.REGIONS[0].places[0].lat, lon: D.REGIONS[0].places[0].lon },
      source: 'nasa',
      irradiance: { ghi: new Array(12).fill(null), temp: new Array(12).fill(null), note: '', fetchedAt: null },
      appliances: D.DEFAULT_LOADS.map(function (n) { return clone(findAppliance(n)); }).filter(Boolean),
      system: system,
      costs: costs
    };
  }

  function loadSaved() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return mergeProject(JSON.parse(raw));
    } catch (e) { /* storage unavailable or corrupt */ }
    return newProject();
  }

  // Fill in any fields missing from older saved projects.
  function mergeProject(p) {
    var base = newProject();
    if (!p || typeof p !== 'object') return base;
    return {
      name: typeof p.name === 'string' ? p.name : base.name,
      location: p.location && isFinite(p.location.lat) ? p.location : base.location,
      source: IRR.SOURCES[p.source] ? p.source : base.source,
      irradiance: p.irradiance && Array.isArray(p.irradiance.ghi) && p.irradiance.ghi.length === 12 ? p.irradiance : base.irradiance,
      appliances: Array.isArray(p.appliances) ? p.appliances : base.appliances,
      system: Object.assign(base.system, p.system || {}),
      costs: Object.assign(base.costs, p.costs || {})
    };
  }

  var state = loadSaved();
  var map = null, marker = null;

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  // ---------- formatting ----------
  function fmt(v, dp) {
    if (v === null || v === undefined || !isFinite(v)) return '–';
    return Number(v).toLocaleString(undefined, { minimumFractionDigits: dp || 0, maximumFractionDigits: dp || 0 });
  }
  function energy(wh) {
    return wh >= 10000 ? fmt(wh / 1000, 1) + ' kWh' : fmt(wh, 0) + ' Wh';
  }
  function power(w) {
    return w >= 1000 ? fmt(w / 1000, 2) + ' kW' : fmt(w, 0) + ' W';
  }
  function money(v) {
    return (state.costs.currency || '') + ' ' + fmt(v, 0);
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- location ----------
  function initLocation() {
    var preset = $('#preset');
    D.REGIONS.forEach(function (g, gi) {
      var og = document.createElement('optgroup');
      og.label = g.group;
      g.places.forEach(function (p, pi) {
        var o = document.createElement('option');
        o.value = gi + ':' + pi;
        o.textContent = p.name;
        og.appendChild(o);
      });
      preset.appendChild(og);
    });
    preset.addEventListener('change', function () {
      if (!preset.value) return;
      var ix = preset.value.split(':').map(Number);
      var p = D.REGIONS[ix[0]].places[ix[1]];
      setLocation(p.name, p.lat, p.lon, true);
    });

    var src = $('#source');
    Object.keys(IRR.SOURCES).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k;
      o.textContent = IRR.SOURCES[k].label;
      src.appendChild(o);
    });
    src.value = state.source;
    src.addEventListener('change', function () { state.source = src.value; save(); });

    $('#loc-name').addEventListener('input', function (e) { state.location.name = e.target.value; save(); });
    ['#lat', '#lon'].forEach(function (id) {
      $(id).addEventListener('change', function () {
        var lat = Number($('#lat').value), lon = Number($('#lon').value);
        if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
          setLocation(state.location.name, lat, lon, false);
        }
      });
    });

    $('#search-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var q = $('#search').value.trim();
      var list = $('#search-results');
      if (q.length < 2) return;
      list.hidden = false;
      list.innerHTML = '<li class="muted">Searching…</li>';
      IRR.geocode(q).then(function (results) {
        list.innerHTML = '';
        if (!results.length) { list.innerHTML = '<li class="muted">No places found.</li>'; return; }
        results.forEach(function (r) {
          var li = document.createElement('li');
          var b = document.createElement('button');
          b.type = 'button';
          b.textContent = r.name + ' (' + r.lat.toFixed(2) + ', ' + r.lon.toFixed(2) + ')';
          b.addEventListener('click', function () {
            list.hidden = true;
            setLocation(r.name, r.lat, r.lon, true);
          });
          li.appendChild(b);
          list.appendChild(li);
        });
      }).catch(function (err) {
        list.innerHTML = '<li class="error">' + esc(err.message) + '</li>';
      });
    });

    $('#btn-geolocate').addEventListener('click', function () {
      if (!navigator.geolocation) { setStatus('This browser cannot share its location.', 'error'); return; }
      setStatus('Finding your location…');
      navigator.geolocation.getCurrentPosition(function (pos) {
        setLocation('My location', round4(pos.coords.latitude), round4(pos.coords.longitude), true);
      }, function (err) {
        setStatus('Location unavailable: ' + err.message, 'error');
      });
    });

    $('#btn-fetch').addEventListener('click', function () { fetchIrradiance(false); });
    $('#btn-refresh').addEventListener('click', function () { fetchIrradiance(true); });

    if (window.L) {
      map = L.map('map', { scrollWheelZoom: false }).setView([state.location.lat, state.location.lon], 6);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);
      marker = L.marker([state.location.lat, state.location.lon]).addTo(map);
      map.on('click', function (e) {
        setLocation('Map point', round4(e.latlng.lat), round4(e.latlng.lng), true);
      });
    } else {
      $('#map').hidden = true;
    }
    renderLocation();
  }

  function round4(v) { return Math.round(v * 1e4) / 1e4; }

  function setLocation(name, lat, lon, autoFetch) {
    var moved = Math.abs(lat - state.location.lat) > 1e-4 || Math.abs(lon - state.location.lon) > 1e-4;
    state.location = { name: name, lat: lat, lon: lon };
    if (moved) {
      state.irradiance = { ghi: new Array(12).fill(null), temp: new Array(12).fill(null), note: '', fetchedAt: null };
    }
    save();
    renderLocation();
    renderIrradiance();
    if (map) { map.setView([lat, lon], Math.max(map.getZoom(), 7)); }
    if (autoFetch) fetchIrradiance(false);
    else update();
  }

  function renderLocation() {
    $('#loc-name').value = state.location.name || '';
    $('#lat').value = state.location.lat;
    $('#lon').value = state.location.lon;
    if (marker) marker.setLatLng([state.location.lat, state.location.lon]);
    var links = IRR.referenceLinks(state.location.lat, state.location.lon);
    $('#ref-links').innerHTML = links.map(function (l) {
      return '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a>';
    }).join(' · ');
  }

  function setStatus(msg, kind) {
    var el = $('#irr-status');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function describeIrradiance() {
    var irr = state.irradiance;
    if (!irr.fetchedAt) return irr.note ? irr.note : '';
    var when = new Date(irr.fetchedAt);
    return irr.note + ' · downloaded ' + when.toLocaleDateString() + (irr.edited ? ' · edited by hand' : '');
  }

  function fetchIrradiance(force) {
    var btns = [$('#btn-fetch'), $('#btn-refresh')];
    btns.forEach(function (b) { b.disabled = true; });
    setStatus('Downloading monthly irradiance from ' + IRR.SOURCES[state.source].label + '…');
    var loc = state.location;
    IRR.getIrradiance(state.source, loc.lat, loc.lon, force).then(function (entry) {
      if (loc !== state.location) return; // location changed while loading
      state.irradiance = { ghi: entry.ghi, temp: entry.temp, note: entry.note, fetchedAt: entry.fetchedAt };
      save();
      renderIrradiance();
      setStatus((entry.fromCache ? 'Loaded saved copy. ' : 'Updated. ') + describeIrradiance(), 'ok');
      update();
    }).catch(function (err) {
      setStatus('Could not get irradiance: ' + err.message + ' Try the other data source or type values in by hand.', 'error');
    }).then(function () {
      btns.forEach(function (b) { b.disabled = false; });
    });
  }

  function initIrradianceTable() {
    var head = $('.irr-table thead tr');
    MONTHS.forEach(function (m) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = m;
      head.appendChild(th);
    });
    [['#row-ghi', 'ghi', '0.01'], ['#row-temp', 'temp', '0.1']].forEach(function (r) {
      var row = $(r[0]);
      MONTHS.forEach(function (m, i) {
        var td = document.createElement('td');
        var input = document.createElement('input');
        input.type = 'number';
        input.step = r[2];
        input.setAttribute('aria-label', m + ' ' + (r[1] === 'ghi' ? 'irradiance' : 'temperature'));
        input.addEventListener('input', function () {
          var v = input.value === '' ? null : Number(input.value);
          state.irradiance[r[1]][i] = v;
          state.irradiance.edited = true;
          if (!state.irradiance.note) state.irradiance.note = 'Entered by hand';
          save();
          update();
        });
        td.appendChild(input);
        row.appendChild(td);
      });
    });
    renderIrradiance();
  }

  function renderIrradiance() {
    var g = $$('#row-ghi input'), t = $$('#row-temp input');
    MONTHS.forEach(function (m, i) {
      var gv = state.irradiance.ghi[i], tv = state.irradiance.temp[i];
      g[i].value = gv === null || gv === undefined ? '' : gv;
      t[i].value = tv === null || tv === undefined ? '' : tv;
    });
    if (!$('#irr-status').classList.contains('error')) setStatus(describeIrradiance());
  }

  // ---------- loads ----------
  function initLoads() {
    var sel = $('#appliance-preset');
    D.APPLIANCES.forEach(function (a, i) {
      var o = document.createElement('option');
      o.value = i;
      o.textContent = a.name + ' (' + a.watts + ' W)';
      sel.appendChild(o);
    });
    var custom = document.createElement('option');
    custom.value = 'custom';
    custom.textContent = 'Custom appliance';
    sel.appendChild(custom);

    $('#btn-add-load').addEventListener('click', function () {
      var a = sel.value === 'custom'
        ? { name: 'Custom appliance', watts: 100, qty: 1, hours: 1, surge: 1 }
        : clone(D.APPLIANCES[Number(sel.value)]);
      state.appliances.push(a);
      save();
      renderLoads();
      update();
      var rows = $$('#load-body tr');
      var input = rows[rows.length - 1] && $('input', rows[rows.length - 1]);
      if (input) input.focus();
    });
    renderLoads();
  }

  var LOAD_COLS = [
    { key: 'name', type: 'text' },
    { key: 'watts', type: 'number', step: '1', min: '0' },
    { key: 'qty', type: 'number', step: '1', min: '0' },
    { key: 'hours', type: 'number', step: '0.1', min: '0', max: '24' },
    { key: 'surge', type: 'number', step: '0.5', min: '1' },
    { key: 'dc', type: 'checkbox' }
  ];

  function renderLoads() {
    var body = $('#load-body');
    body.innerHTML = '';
    state.appliances.forEach(function (a, i) {
      var tr = document.createElement('tr');
      LOAD_COLS.forEach(function (c) {
        var td = document.createElement('td');
        var input = document.createElement('input');
        input.type = c.type;
        ['step', 'min', 'max'].forEach(function (k) { if (c[k]) input[k] = c[k]; });
        input.setAttribute('aria-label', c.key + ' for ' + (a.name || 'appliance'));
        if (c.type === 'checkbox') input.checked = !!a.dc;
        else input.value = a[c.key] === undefined ? '' : a[c.key];
        input.addEventListener(c.type === 'checkbox' ? 'change' : 'input', function () {
          a[c.key] = c.type === 'checkbox' ? input.checked : (c.type === 'number' ? (input.value === '' ? 0 : Number(input.value)) : input.value);
          save();
          $('.wh', tr).textContent = fmt(rowWh(a), 0);
          update();
        });
        if (c.type === 'checkbox') td.className = 'center';
        td.appendChild(input);
        tr.appendChild(td);
      });
      var wh = document.createElement('td');
      wh.className = 'num wh';
      wh.textContent = fmt(rowWh(a), 0);
      tr.appendChild(wh);
      var del = document.createElement('td');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'icon-btn';
      b.setAttribute('aria-label', 'Remove ' + a.name);
      b.textContent = '×';
      b.addEventListener('click', function () {
        state.appliances.splice(i, 1);
        save();
        renderLoads();
        update();
      });
      del.appendChild(b);
      tr.appendChild(del);
      body.appendChild(tr);
    });
  }

  function rowWh(a) {
    return (Number(a.watts) || 0) * (Number(a.qty) || 0) * Math.min(24, Number(a.hours) || 0);
  }

  // ---------- system & costs ----------
  function initSystem() {
    var bt = $('#battery-type');
    Object.keys(D.BATTERIES).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k;
      o.textContent = D.BATTERIES[k].label;
      bt.appendChild(o);
    });
    var ct = $('#controller-type');
    Object.keys(D.CONTROLLERS).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k;
      o.textContent = D.CONTROLLERS[k].label + ' (' + D.CONTROLLERS[k].efficiency + '%)';
      ct.appendChild(o);
    });

    $$('input[name="mode"]').forEach(function (r) {
      r.addEventListener('change', function () {
        state.system.mode = r.value;
        save();
        renderSystem();
        update();
      });
    });

    $$('[data-key]').forEach(function (el) {
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () {
        var key = el.dataset.key;
        var v = el.tagName === 'SELECT' && el.dataset.type !== 'number' ? el.value : Number(el.value);
        state.system[key] = v;
        if (key === 'batteryType') {
          var b = D.BATTERIES[v];
          state.system.batteryDod = b.dod;
          state.system.batteryEfficiency = b.efficiency;
          state.costs.batteryPerKWh = b.pricePerKWh;
          renderSystem();
          renderCosts();
        }
        save();
        update();
      });
    });

    $$('[data-cost]').forEach(function (el) {
      el.addEventListener('input', function () {
        state.costs[el.dataset.cost] = el.type === 'number' ? Number(el.value) : el.value;
        save();
        update();
      });
    });
    renderSystem();
    renderCosts();
  }

  function renderSystem() {
    var mode = state.system.mode;
    $$('input[name="mode"]').forEach(function (r) { r.checked = r.value === mode; });
    $$('[data-key]').forEach(function (el) {
      var v = state.system[el.dataset.key];
      el.value = v === undefined || v === null ? '' : v;
    });
    $$('[data-modes]').forEach(function (el) {
      el.hidden = el.dataset.modes.split(' ').indexOf(mode) < 0;
    });
  }

  function renderCosts() {
    $$('[data-cost]').forEach(function (el) { el.value = state.costs[el.dataset.cost]; });
  }

  // ---------- results ----------
  function update() {
    var total = state.appliances.reduce(function (t, a) { return t + rowWh(a); }, 0);
    $('#load-total').textContent = fmt(total, 0) + ' Wh';

    var r = S.size({
      appliances: state.appliances,
      ghi: state.irradiance.ghi,
      temp: state.irradiance.temp,
      system: state.system,
      batteries: D.BATTERIES,
      controllers: D.CONTROLLERS
    });
    var out = $('#results-body');
    if (!r.ok) {
      out.innerHTML = '<p class="empty">' + esc(r.error) + '</p>';
      return;
    }
    var c = S.cost(r, state.costs);
    var html = '';
    var modeLabel = { offgrid: 'Off-grid', hybrid: 'Hybrid / backup', gridtied: 'Grid-tied' }[r.mode];
    html += '<p class="result-site">' + esc(state.location.name || 'Site') + ' · ' + modeLabel + '</p>';

    html += '<div class="stats">';
    html += stat('PV array', fmt(r.pv.arrayWp / 1000, 2) + ' kWp', r.pv.panels + ' × ' + r.pv.panelWatts + ' Wp' + (r.pv.panelsPerString > 1 ? ' (' + r.pv.strings + ' strings of ' + r.pv.panelsPerString + ')' : ''));
    if (r.battery) {
      html += stat('Battery bank', fmt(r.battery.installedKWh, 1) + ' kWh',
        r.battery.units + ' × ' + fmt(r.battery.unitVoltage, 1) + ' V ' + r.battery.unitAh + ' Ah (' + r.battery.series + 'S' + r.battery.parallel + 'P) = ' + r.battery.bankAh + ' Ah @ ' + state.system.systemVoltage + ' V');
    }
    html += stat('Inverter', power(r.inverter.continuousW), r.inverter.surgeW ? 'Surge ≥ ' + power(r.inverter.surgeW) : 'AC rating at DC/AC ' + state.system.dcAcRatio);
    if (r.controller) {
      html += stat('Charge controller', fmt(Math.ceil(r.controller.currentA), 0) + ' A', D.CONTROLLERS[r.controller.type].label + ' at ' + state.system.systemVoltage + ' V');
    }
    html += '</div>';

    html += '<dl class="facts">';
    html += fact('Daily consumption', energy(r.load.totalWh) + (r.load.dcWh ? ' (' + energy(r.load.dcWh) + ' DC)' : ''));
    html += fact('Connected load', power(r.load.acPeakW + r.load.dcPeakW));
    html += fact('Design sun hours', fmt(r.designPsh, 2) + ' h (' + esc(r.designMonth) + ')');
    html += fact('Annual mean sun hours', fmt(r.avgPsh, 2) + ' h/day');
    html += fact('Energy needed from PV', energy(r.arrayWh) + '/day');
    html += fact('Annual PV generation', fmt(r.pv.annualKWh, 0) + ' kWh');
    html += fact('Specific yield', fmt(r.pv.specificYield, 0) + ' kWh/kWp/yr');
    if (r.battery) html += fact('Usable storage', energy(r.battery.usableWh) + ' (' + fmt(r.battery.dod * 100, 0) + '% DoD)');
    html += '</dl>';

    html += '<h3>Monthly energy balance <small class="muted">per day</small></h3>';
    html += chart(r);

    if (r.warnings.length) {
      html += '<ul class="warnings">' + r.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>';
    }

    if (c) {
      html += '<h3>Cost estimate</h3><table class="cost-table"><tbody>';
      c.lines.forEach(function (l) { html += '<tr><td>' + esc(l.item) + '</td><td class="num">' + esc(money(l.amount)) + '</td></tr>'; });
      html += '</tbody><tfoot><tr><th>Total</th><td class="num">' + esc(money(c.total)) + '</td></tr></tfoot></table>';
      html += '<p class="muted small">' + esc(state.costs.currency) + ' ' + fmt(c.perWp, 2) + ' per Wp installed';
      if (c.perKWh) html += ' · about ' + esc(state.costs.currency) + ' ' + fmt(c.perKWh, 3) + ' per kWh over ' + state.costs.lifetimeYears + ' years (capital only, excludes battery replacement)';
      html += '</p>';
    }
    out.innerHTML = html;
  }

  function stat(label, value, sub) {
    return '<div class="stat"><span class="stat-label">' + esc(label) + '</span><span class="stat-value">' + esc(value) + '</span><span class="stat-sub">' + esc(sub) + '</span></div>';
  }
  function fact(k, v) {
    return '<div><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>';
  }

  function chart(r) {
    var W = 560, H = 220, padL = 44, padR = 8, padT = 12, padB = 26;
    var maxV = Math.max.apply(null, r.months.map(function (m) { return Math.max(m.supplyWh, m.demandWh); })) / 1000 * 1.1;
    var step = niceStep(maxV / 4);
    maxV = Math.ceil(maxV / step) * step;
    var cw = (W - padL - padR) / 12;
    var y = function (v) { return padT + (H - padT - padB) * (1 - v / maxV); };
    var svg = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Bar chart of daily PV energy supplied versus demand for each month">';
    for (var t = 0; t <= maxV + 1e-9; t += step) {
      svg += '<line class="grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(t) + '" y2="' + y(t) + '"/>';
      svg += '<text class="axis" x="' + (padL - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + fmt(t, step < 1 ? 1 : 0) + '</text>';
    }
    r.months.forEach(function (m, i) {
      var x = padL + i * cw;
      var v = m.supplyWh / 1000;
      var short = m.coverage < 0.999;
      svg += '<rect class="bar' + (short ? ' short' : '') + '" x="' + (x + cw * 0.18) + '" y="' + y(v) + '" width="' + (cw * 0.64) + '" height="' + Math.max(0, y(0) - y(v)) + '" rx="2"><title>' +
        m.month + ': ' + fmt(v, 2) + ' kWh/day supplied, ' + fmt(m.demandWh / 1000, 2) + ' kWh/day needed, GHI ' + fmt(m.ghi, 2) + '</title></rect>';
      svg += '<text class="axis" x="' + (x + cw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + m.month.charAt(0) + '</text>';
    });
    var line = r.months.map(function (m, i) {
      return (i ? 'L' : 'M') + (padL + i * cw + 2) + ' ' + y(m.demandWh / 1000) + ' H' + (padL + (i + 1) * cw - 2);
    }).join(' ');
    svg += '<path class="demand" d="' + line + '"/>';
    svg += '<text class="axis" x="4" y="' + (padT + 2) + '">kWh</text>';
    svg += '</svg>';
    svg += '<div class="legend"><span><i class="sw sw-bar"></i>PV energy delivered</span><span><i class="sw sw-short"></i>Short of demand</span><span><i class="sw sw-line"></i>Demand</span></div>';
    return svg;
  }

  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(raw)));
    var n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
  }

  // ---------- project actions ----------
  function initActions() {
    var name = $('#project-name');
    name.value = state.name;
    name.addEventListener('input', function () { state.name = name.value; save(); });

    $('#btn-save').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(Object.assign({ app: 'solar-pv-sizer', version: D.VERSION }, state), null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (state.name || 'solar-project').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
    });

    $('#file-import').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      file.text().then(function (txt) {
        state = mergeProject(JSON.parse(txt));
        save();
        renderAll();
      }).catch(function () {
        alert('That file is not a valid project export.');
      });
      e.target.value = '';
    });

    $('#btn-print').addEventListener('click', function () { window.print(); });

    $('#btn-reset').addEventListener('click', function () {
      if (!confirm('Start a new project? Unsaved changes to the current one will be lost.')) return;
      state = newProject();
      save();
      renderAll();
    });
  }

  function renderAll() {
    $('#project-name').value = state.name;
    $('#source').value = state.source;
    renderLocation();
    setStatus('');
    renderIrradiance();
    renderLoads();
    renderSystem();
    renderCosts();
    if (map) map.setView([state.location.lat, state.location.lon], 7);
    update();
  }

  $('#app-version').textContent = D.VERSION;
  initLocation();
  initIrradianceTable();
  initLoads();
  initSystem();
  initActions();
  update();
  if (!S.validIrradiance(state.irradiance.ghi)) fetchIrradiance(false);
})();
