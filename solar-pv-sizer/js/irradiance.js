/*
 * Solar irradiance and geocoding sources. All are free, need no API key and
 * allow requests straight from the browser (CORS).
 *
 *  - NASA POWER:  long-term monthly climatology from satellite data (global).
 *  - Open-Meteo:  monthly means computed from recent years of ERA5 reanalysis.
 *  - Open-Meteo geocoding for place search.
 *
 * Results are cached in the browser for CACHE_DAYS; "Refresh" bypasses it.
 * To add a source, add an entry to SOURCES with a fetch(lat, lon) that resolves
 * to { ghi: [12 numbers kWh/m²/day], temp: [12 numbers °C or null], note }.
 */
(function (root) {
  var CACHE_DAYS = 30;
  var MONTH_KEYS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  function round(v, dp) {
    var f = Math.pow(10, dp);
    return Math.round(v * f) / f;
  }

  async function getJson(url) {
    var response;
    try {
      response = await fetch(url);
    } catch (e) {
      throw new Error('Could not reach the server. Check your internet connection.');
    }
    if (!response.ok) {
      var detail = '';
      try { detail = (await response.text()).slice(0, 200); } catch (e) { /* ignore */ }
      throw new Error('Server returned ' + response.status + (detail ? ': ' + detail : ''));
    }
    return response.json();
  }

  var SOURCES = {
    nasa: {
      label: 'NASA POWER (long-term climatology)',
      link: 'https://power.larc.nasa.gov/data-access-viewer/',
      fetch: async function (lat, lon) {
        var url = 'https://power.larc.nasa.gov/api/temporal/climatology/point' +
          '?parameters=ALLSKY_SFC_SW_DWN,T2M&community=RE&format=JSON' +
          '&latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4);
        var json = await getJson(url);
        var params = json && json.properties && json.properties.parameter;
        if (!params || !params.ALLSKY_SFC_SW_DWN) throw new Error('Unexpected response from NASA POWER.');
        var fill = json.header && json.header.fill_value !== undefined ? json.header.fill_value : -999;
        var ghi = MONTH_KEYS.map(function (k) { return params.ALLSKY_SFC_SW_DWN[k]; });
        if (ghi.some(function (v) { return v === fill || v === undefined || v === null; })) {
          throw new Error('NASA POWER has no irradiance data for this point.');
        }
        var temp = MONTH_KEYS.map(function (k) {
          var t = params.T2M && params.T2M[k];
          return t === undefined || t === fill ? null : round(t, 1);
        });
        var period = json.header && json.header.range ? ' ' + json.header.range : '';
        return { ghi: ghi.map(function (v) { return round(v, 2); }), temp: temp, note: 'NASA POWER climatology' + period };
      }
    },

    openmeteo: {
      label: 'Open-Meteo (ERA5, last 5 full years)',
      link: 'https://open-meteo.com/en/docs/historical-weather-api',
      fetch: async function (lat, lon) {
        var endYear = new Date().getFullYear() - 1;
        var startYear = endYear - 4;
        var url = 'https://archive-api.open-meteo.com/v1/archive' +
          '?latitude=' + lat.toFixed(4) + '&longitude=' + lon.toFixed(4) +
          '&start_date=' + startYear + '-01-01&end_date=' + endYear + '-12-31' +
          '&daily=shortwave_radiation_sum,temperature_2m_mean&timezone=auto';
        var json = await getJson(url);
        var daily = json && json.daily;
        if (!daily || !daily.time || !daily.shortwave_radiation_sum) throw new Error('Unexpected response from Open-Meteo.');
        var sums = new Array(12).fill(0), counts = new Array(12).fill(0);
        var tSums = new Array(12).fill(0), tCounts = new Array(12).fill(0);
        daily.time.forEach(function (d, i) {
          var m = Number(d.slice(5, 7)) - 1;
          var rad = daily.shortwave_radiation_sum[i];
          if (rad !== null && isFinite(rad)) { sums[m] += rad; counts[m]++; }
          var t = daily.temperature_2m_mean ? daily.temperature_2m_mean[i] : null;
          if (t !== null && isFinite(t)) { tSums[m] += t; tCounts[m]++; }
        });
        if (counts.some(function (c) { return c === 0; })) throw new Error('Open-Meteo returned incomplete data for this point.');
        // MJ/m²/day -> kWh/m²/day
        var ghi = sums.map(function (s, m) { return round(s / counts[m] / 3.6, 2); });
        var temp = tSums.map(function (s, m) { return tCounts[m] ? round(s / tCounts[m], 1) : null; });
        return { ghi: ghi, temp: temp, note: 'Open-Meteo ERA5 ' + startYear + '–' + endYear };
      }
    }
  };

  function cacheKey(source, lat, lon) {
    return 'pv-irr:' + source + ':' + lat.toFixed(3) + ',' + lon.toFixed(3);
  }

  function readCache(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var entry = JSON.parse(raw);
      if (Date.now() - new Date(entry.fetchedAt).getTime() > CACHE_DAYS * 864e5) return null;
      return entry;
    } catch (e) {
      return null;
    }
  }

  function writeCache(key, entry) {
    try { localStorage.setItem(key, JSON.stringify(entry)); } catch (e) { /* storage unavailable */ }
  }

  async function getIrradiance(source, lat, lon, forceRefresh) {
    var src = SOURCES[source];
    if (!src) throw new Error('Unknown data source: ' + source);
    var key = cacheKey(source, lat, lon);
    if (!forceRefresh) {
      var cached = readCache(key);
      if (cached) { cached.fromCache = true; return cached; }
    }
    var data = await src.fetch(lat, lon);
    var entry = {
      ghi: data.ghi,
      temp: data.temp,
      source: source,
      note: data.note,
      lat: lat,
      lon: lon,
      fetchedAt: new Date().toISOString()
    };
    writeCache(key, entry);
    return entry;
  }

  async function geocode(query) {
    var url = 'https://geocoding-api.open-meteo.com/v1/search?count=8&language=en&format=json&name=' + encodeURIComponent(query);
    var json = await getJson(url);
    return (json.results || []).map(function (r) {
      return {
        name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
        lat: r.latitude,
        lon: r.longitude
      };
    });
  }

  // Links for cross-checking a location in other tools (these do not allow browser API calls).
  function referenceLinks(lat, lon) {
    return [
      { label: 'Global Solar Atlas', url: 'https://globalsolaratlas.info/map?c=' + lat.toFixed(4) + ',' + lon.toFixed(4) + ',11&s=' + lat.toFixed(4) + ',' + lon.toFixed(4) + '&m=site' },
      { label: 'PVGIS (EU JRC)', url: 'https://re.jrc.ec.europa.eu/pvg_tools/en/' },
      { label: 'NASA POWER viewer', url: 'https://power.larc.nasa.gov/data-access-viewer/' }
    ];
  }

  root.Irradiance = {
    SOURCES: SOURCES,
    getIrradiance: getIrradiance,
    geocode: geocode,
    referenceLinks: referenceLinks
  };
})(this);
