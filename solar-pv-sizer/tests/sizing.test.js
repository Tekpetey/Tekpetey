// Run with: node --test solar-pv-sizer/tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/sizing.js');
const D = require('../js/data.js');

const flat = (v) => new Array(12).fill(v);
const ideal = {
  mode: 'offgrid', designBasis: 'worst', systemVoltage: 24, autonomyDays: 1,
  panelWatts: 100, panelsPerString: 1, panelIsc: 6, tempCoeff: -0.4, cellTempRise: 0, tiltFactor: 1,
  soilingLoss: 0, wiringLoss: 0, mismatchLoss: 0, inverterEfficiency: 100,
  controllerType: 'mppt', batteryType: 'x', batteryDod: 50, batteryEfficiency: 100,
  batteryUnitVoltage: 12, batteryUnitAh: 100, inverterSafety: 1.25, offsetPercent: 100, dcAcRatio: 1
};
const base = {
  appliances: [{ name: 'Load', watts: 100, qty: 1, hours: 10, surge: 3 }],
  ghi: flat(5), temp: flat(25), system: ideal,
  batteries: {}, controllers: { mppt: { efficiency: 100 }, pwm: { efficiency: 80 } }
};

test('load summary adds energy, peak and worst surge', () => {
  const l = S.loadSummary([
    { watts: 100, qty: 2, hours: 5, surge: 1 },
    { watts: 150, qty: 1, hours: 10, surge: 4 },
    { watts: 20, qty: 1, hours: 12, dc: true }
  ]);
  assert.equal(l.acWh, 2500);
  assert.equal(l.dcWh, 240);
  assert.equal(l.acPeakW, 350);
  assert.equal(l.surgeW, 350 + 150 * 3);
});

test('off-grid sizing with no losses matches hand calculation', () => {
  const r = S.size(base);
  assert.ok(r.ok);
  assert.equal(r.arrayWh, 1000);
  assert.equal(r.pv.requiredWp, 200);
  assert.equal(r.pv.panels, 2);
  assert.equal(r.battery.usableWh, 1000);
  assert.equal(r.battery.nominalWh, 2000);
  assert.ok(Math.abs(r.battery.requiredAh - 83.333) < 0.01);
  assert.equal(r.battery.series, 2);
  assert.equal(r.battery.parallel, 1);
  assert.equal(r.battery.installedKWh, 2.4);
  assert.equal(r.inverter.continuousW, 125);
  assert.equal(r.inverter.surgeW, 300);
  assert.ok(Math.abs(r.controller.currentA - 200 / 24 * 1.25) < 1e-9);
});

test('worst month drives off-grid design', () => {
  const ghi = flat(6); ghi[7] = 4; // August is dullest
  const r = S.size({ ...base, ghi });
  assert.equal(r.designMonth, 'Aug');
  assert.equal(r.pv.requiredWp, 250);
  assert.equal(r.pv.panels, 3);
});

test('temperature and losses derate output', () => {
  const s = { ...ideal, cellTempRise: 25, soilingLoss: 10 };
  const m = S.monthlyYieldPerWp(flat(5), flat(25), s);
  // cell 50 °C -> 1 - 0.004*25 = 0.9; soiling 0.9
  assert.ok(Math.abs(m[0].yieldPerWp - 5 * 0.9 * 0.9) < 1e-9);
});

test('grid-tied ignores battery and uses inverter efficiency', () => {
  const r = S.size({ ...base, system: { ...ideal, mode: 'gridtied', inverterEfficiency: 90 } });
  assert.equal(r.battery, undefined);
  assert.equal(r.controller, undefined);
  assert.ok(Math.abs(r.pv.requiredWp - 1000 / 0.9 / 5) < 1e-9);
  assert.equal(r.pv.panels, 3);
  assert.equal(r.inverter.continuousW, 300);
});

test('hybrid battery covers backup hours of average load', () => {
  const r = S.size({ ...base, system: { ...ideal, mode: 'hybrid', backupHours: 12 } });
  assert.ok(Math.abs(r.battery.usableWh - 1000 / 24 * 12) < 1e-9);
  assert.equal(r.controller, undefined);
});

test('panels round up to whole strings', () => {
  const r = S.size({ ...base, system: { ...ideal, panelsPerString: 3 } });
  assert.equal(r.pv.panels, 3);
  assert.equal(r.pv.strings, 1);
});

test('missing irradiance or loads gives a helpful error', () => {
  assert.equal(S.size({ ...base, ghi: flat(null) }).ok, false);
  assert.equal(S.size({ ...base, appliances: [] }).ok, false);
});

test('cost estimate totals the lines', () => {
  const r = S.size(base);
  const c = S.cost(r, { panelPerWp: 1, batteryPerKWh: 100, inverterPerKW: 100, controllerPerA: 1, bosPercent: 10, installPercent: 0, lifetimeYears: 10 });
  const equipment = 200 + 240 + 12.5 + r.controller.currentA;
  assert.ok(Math.abs(c.total - equipment * 1.1) < 1e-9);
});

test('reference data is well formed', () => {
  D.REGIONS.forEach((g) => g.places.forEach((p) => {
    assert.ok(Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180, p.name);
  }));
  D.DEFAULT_LOADS.forEach((n) => assert.ok(D.APPLIANCES.some((a) => a.name === n), n));
  assert.ok(D.BATTERIES[D.DEFAULTS.system.batteryType]);
  assert.ok(D.CONTROLLERS[D.DEFAULTS.system.controllerType]);
});

test('realistic Ghana household sizes sensibly with defaults', () => {
  const appliances = D.DEFAULT_LOADS.map((n) => D.APPLIANCES.find((a) => a.name === n));
  const sys = { ...D.DEFAULTS.system, batteryDod: 80, batteryEfficiency: 95 };
  const r = S.size({ appliances, ghi: [5.2, 5.6, 5.7, 5.5, 5.1, 4.4, 4.2, 4.3, 4.6, 5.2, 5.4, 5.1], temp: flat(27), system: sys, batteries: D.BATTERIES, controllers: D.CONTROLLERS });
  assert.ok(r.ok);
  assert.ok(r.pv.arrayWp > 1000 && r.pv.arrayWp < 3000, String(r.pv.arrayWp));
  assert.equal(r.designMonth, 'Jul');
});
