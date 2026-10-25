/*
 * Solar PV sizing calculations. Pure functions with no DOM access, so they
 * can be unit tested in Node (see tests/sizing.test.js).
 *
 * Units: power W, energy Wh/day unless named kWh, irradiance kWh/m²/day
 * (numerically equal to peak sun hours, PSH).
 */
(function (root) {
  var DAYS_IN_MONTH = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function num(v, fallback) {
    var n = Number(v);
    return isFinite(n) ? n : fallback;
  }

  // Daily energy and power demand of the appliance list.
  function loadSummary(appliances) {
    var acWh = 0, dcWh = 0, acPeakW = 0, dcPeakW = 0, worstSurgeExtra = 0;
    (appliances || []).forEach(function (a) {
      var w = Math.max(0, num(a.watts, 0));
      var q = Math.max(0, num(a.qty, 0));
      var h = Math.min(24, Math.max(0, num(a.hours, 0)));
      var power = w * q;
      if (a.dc) {
        dcWh += power * h;
        dcPeakW += power;
      } else {
        acWh += power * h;
        acPeakW += power;
        // Assume one appliance of each type starts while everything else runs.
        worstSurgeExtra = Math.max(worstSurgeExtra, w * (Math.max(1, num(a.surge, 1)) - 1));
      }
    });
    return {
      acWh: acWh,
      dcWh: dcWh,
      totalWh: acWh + dcWh,
      acPeakW: acPeakW,
      dcPeakW: dcPeakW,
      surgeW: acPeakW + worstSurgeExtra
    };
  }

  // Daily PV output per installed watt-peak for each month (Wh/Wp/day),
  // after temperature and system losses, before inverter/controller/battery.
  function monthlyYieldPerWp(ghi, temp, s) {
    var lossFactor = (1 - num(s.soilingLoss, 0) / 100) *
      (1 - num(s.wiringLoss, 0) / 100) *
      (1 - num(s.mismatchLoss, 0) / 100);
    var gamma = num(s.tempCoeff, -0.35) / 100;
    var rise = num(s.cellTempRise, 25);
    var tilt = num(s.tiltFactor, 1);
    return ghi.map(function (g, i) {
      var ambient = temp && isFinite(Number(temp[i])) && temp[i] !== null ? Number(temp[i]) : 28;
      var cellTemp = ambient + rise;
      var tempFactor = Math.min(1.1, Math.max(0.5, 1 + gamma * (cellTemp - 25)));
      return {
        psh: g * tilt,
        cellTemp: cellTemp,
        tempFactor: tempFactor,
        derate: lossFactor * tempFactor,
        yieldPerWp: g * tilt * lossFactor * tempFactor
      };
    });
  }

  function validIrradiance(ghi) {
    return Array.isArray(ghi) && ghi.length === 12 && ghi.every(function (g) {
      return g !== null && g !== '' && isFinite(Number(g)) && Number(g) > 0;
    });
  }

  function daysWeightedMean(values) {
    var total = 0, days = 0;
    values.forEach(function (v, i) { total += v * DAYS_IN_MONTH[i]; days += DAYS_IN_MONTH[i]; });
    return total / days;
  }

  function size(input) {
    var s = input.system;
    var batteries = input.batteries || {};
    var controllers = input.controllers || {};
    var ghi = (input.ghi || []).map(Number);
    var warnings = [];

    if (!validIrradiance(ghi)) {
      return { ok: false, error: 'Enter or fetch 12 monthly irradiance values (kWh/m²/day) to size the system.' };
    }
    var load = loadSummary(input.appliances);
    if (load.totalWh <= 0) {
      return { ok: false, error: 'Add at least one appliance with power, quantity and hours of use.' };
    }

    var mode = s.mode || 'offgrid';
    var etaInv = num(s.inverterEfficiency, 93) / 100;
    var batt = batteries[s.batteryType] || { dod: 80, efficiency: 95 };
    var dod = num(s.batteryDod, batt.dod) / 100;
    var etaBatt = num(s.batteryEfficiency, batt.efficiency) / 100;
    var ctrl = controllers[s.controllerType] || { efficiency: 97 };
    var etaCc = mode === 'offgrid' ? ctrl.efficiency / 100 : 1;
    var vSys = num(s.systemVoltage, 24);
    var panelW = Math.max(1, num(s.panelWatts, 450));
    var perString = Math.max(1, Math.round(num(s.panelsPerString, 1)));

    var months = monthlyYieldPerWp(ghi, input.temp, s);
    var yields = months.map(function (m) { return m.yieldPerWp; });
    var avgYield = daysWeightedMean(yields);
    var worstIndex = yields.indexOf(Math.min.apply(null, yields));
    var designIndex = s.designBasis === 'average' ? -1 : worstIndex;
    var designYield = designIndex >= 0 ? yields[designIndex] : avgYield;

    if (mode === 'gridtied' && load.dcWh > 0) {
      warnings.push('DC loads are ignored in grid-tied mode; only AC loads are offset.');
    }

    // Energy the PV array must deliver each day (Wh/day at the array output).
    var demandWh, arrayWh, offset = Math.max(0, num(s.offsetPercent, 100)) / 100;
    if (mode === 'offgrid') {
      // Conservative: assume all energy cycles through the battery.
      demandWh = load.acWh / etaInv + load.dcWh;
      arrayWh = demandWh / (etaBatt * etaCc);
    } else {
      demandWh = load.acWh;
      arrayWh = load.acWh * offset / etaInv;
    }

    var requiredWp = arrayWh / designYield;
    var strings = Math.max(1, Math.ceil(requiredWp / (panelW * perString)));
    var panels = strings * perString;
    var arrayWp = panels * panelW;

    // Monthly energy supplied to loads vs demand (Wh/day).
    var monthly = months.map(function (m, i) {
      var pvWh = arrayWp * m.yieldPerWp;
      var supplyWh = mode === 'offgrid' ? pvWh * etaCc * etaBatt : pvWh * etaInv;
      var target = mode === 'offgrid' ? demandWh : demandWh * offset;
      return {
        month: MONTHS[i],
        ghi: ghi[i],
        cellTemp: m.cellTemp,
        derate: m.derate,
        pvWh: pvWh,
        supplyWh: supplyWh,
        demandWh: target,
        coverage: target > 0 ? Math.min(1, supplyWh / target) : 1,
        surplusWh: supplyWh - target
      };
    });
    var annualPvKWh = monthly.reduce(function (t, m, i) { return t + m.pvWh * DAYS_IN_MONTH[i]; }, 0) / 1000;
    var annualSupplyKWh = monthly.reduce(function (t, m, i) { return t + m.supplyWh * DAYS_IN_MONTH[i]; }, 0) / 1000;

    var result = {
      ok: true,
      mode: mode,
      load: load,
      months: monthly,
      designMonth: designIndex >= 0 ? MONTHS[designIndex] : 'Annual average',
      designPsh: designIndex >= 0 ? ghi[designIndex] : daysWeightedMean(ghi),
      designYield: designYield,
      avgPsh: daysWeightedMean(ghi),
      demandWh: demandWh,
      arrayWh: arrayWh,
      pv: {
        requiredWp: requiredWp,
        panelWatts: panelW,
        panels: panels,
        strings: strings,
        panelsPerString: perString,
        arrayWp: arrayWp,
        annualKWh: annualPvKWh,
        specificYield: annualPvKWh / (arrayWp / 1000)
      },
      annualSupplyKWh: annualSupplyKWh,
      warnings: warnings
    };

    // Battery bank.
    if (mode !== 'gridtied') {
      var usableWh = mode === 'offgrid'
        ? demandWh * Math.max(0, num(s.autonomyDays, 1))
        : (load.acWh / 24 / etaInv + load.dcWh / 24) * Math.max(0, num(s.backupHours, 6));
      var nominalWh = usableWh / dod / etaBatt;
      var requiredAh = nominalWh / vSys;
      var unitV = Math.max(1, num(s.batteryUnitVoltage, 12));
      var unitAh = Math.max(1, num(s.batteryUnitAh, 200));
      var series = Math.max(1, Math.round(vSys / unitV));
      if (Math.abs(series * unitV - vSys) > 0.5) {
        warnings.push('Battery unit voltage (' + unitV + ' V) does not divide evenly into the ' + vSys + ' V system voltage.');
      }
      var parallel = Math.max(1, Math.ceil(requiredAh / unitAh));
      result.battery = {
        usableWh: usableWh,
        nominalWh: nominalWh,
        requiredAh: requiredAh,
        series: series,
        parallel: parallel,
        units: series * parallel,
        unitVoltage: unitV,
        unitAh: unitAh,
        bankAh: parallel * unitAh,
        installedKWh: series * unitV * parallel * unitAh / 1000,
        dod: dod,
        efficiency: etaBatt
      };
      if (parallel > 4 && s.batteryType !== 'lifepo4') {
        warnings.push('More than 4 parallel lead-acid strings can cause uneven charging; consider larger batteries or a higher system voltage.');
      }
    }

    // Charge controller (off-grid only; hybrid inverters include the MPPT).
    if (mode === 'offgrid') {
      var ctrlA = s.controllerType === 'pwm'
        ? strings * num(s.panelIsc, 13.9) * 1.25
        : arrayWp / vSys * 1.25;
      result.controller = { type: s.controllerType, currentA: ctrlA };
      if (s.controllerType === 'pwm' && perString > 1) {
        warnings.push('PWM controllers need panels matched to battery voltage; strings of several panels in series suit an MPPT controller.');
      }
    }

    // Inverter.
    var safety = num(s.inverterSafety, 1.25);
    if (mode === 'gridtied') {
      var acKw = arrayWp / 1000 / Math.max(0.5, num(s.dcAcRatio, 1.15));
      result.inverter = { continuousW: acKw * 1000, surgeW: null };
    } else {
      result.inverter = { continuousW: load.acPeakW * safety, surgeW: load.surgeW };
    }
    if (mode !== 'gridtied' && load.acPeakW * safety > 5000 && vSys < 48) {
      warnings.push('Inverters above about 5 kW are normally 48 V; consider raising the system voltage.');
    }
    if (mode !== 'gridtied' && load.acPeakW * safety > 2000 && vSys < 24) {
      warnings.push('A 12 V system above about 2 kW needs very heavy cables; consider 24 V or 48 V.');
    }
    var deficits = monthly.filter(function (m) { return m.coverage < 0.999; }).map(function (m) { return m.month; });
    if (deficits.length && mode === 'offgrid') {
      warnings.push('PV output falls short of demand in: ' + deficits.join(', ') + '. Add panels, reduce load or plan a generator backup.');
    }
    return result;
  }

  function cost(result, c) {
    if (!result || !result.ok) return null;
    var lines = [];
    lines.push({ item: 'PV panels', amount: result.pv.arrayWp * num(c.panelPerWp, 0) });
    if (result.battery) lines.push({ item: 'Batteries', amount: result.battery.installedKWh * num(c.batteryPerKWh, 0) });
    lines.push({ item: result.mode === 'gridtied' ? 'Grid-tie inverter' : (result.mode === 'hybrid' ? 'Hybrid inverter' : 'Inverter'), amount: result.inverter.continuousW / 1000 * num(c.inverterPerKW, 0) });
    if (result.controller) lines.push({ item: 'Charge controller', amount: result.controller.currentA * num(c.controllerPerA, 0) });
    var equipment = lines.reduce(function (t, l) { return t + l.amount; }, 0);
    lines.push({ item: 'Balance of system (cables, protection, mounting)', amount: equipment * num(c.bosPercent, 0) / 100 });
    lines.push({ item: 'Installation', amount: equipment * num(c.installPercent, 0) / 100 });
    var total = lines.reduce(function (t, l) { return t + l.amount; }, 0);
    var lifetimeKWh = result.annualSupplyKWh * Math.max(1, num(c.lifetimeYears, 25));
    return {
      lines: lines,
      total: total,
      perWp: total / result.pv.arrayWp,
      // Simple capital cost per kWh delivered, ignoring battery replacement and finance.
      perKWh: lifetimeKWh > 0 ? total / lifetimeKWh : null
    };
  }

  var api = {
    MONTHS: MONTHS,
    DAYS_IN_MONTH: DAYS_IN_MONTH,
    loadSummary: loadSummary,
    monthlyYieldPerWp: monthlyYieldPerWp,
    validIrradiance: validIrradiance,
    size: size,
    cost: cost
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SolarSizing = api;
})(this);
