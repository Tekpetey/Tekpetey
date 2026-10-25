/*
 * Editable reference data for the Solar PV Sizing Tool.
 *
 * This is the main file to update when prices, equipment or locations change:
 *  - REGIONS:     preset locations shown in the "Preset location" list
 *  - APPLIANCES:  appliance presets offered in the load table
 *  - BATTERIES:   battery chemistries and their usable depth of discharge
 *  - DEFAULTS:    starting values for a new project (system + prices)
 *
 * Prices are indicative placeholders: update them to current local market prices.
 */
(function (root) {
  var data = {
    VERSION: '1.0.0',

    REGIONS: [
      {
        group: 'Ghana: regional capitals',
        places: [
          { name: 'Accra (Greater Accra)', lat: 5.6037, lon: -0.187 },
          { name: 'Kumasi (Ashanti)', lat: 6.6885, lon: -1.6244 },
          { name: 'Tamale (Northern)', lat: 9.4008, lon: -0.8393 },
          { name: 'Sekondi-Takoradi (Western)', lat: 4.8845, lon: -1.7554 },
          { name: 'Cape Coast (Central)', lat: 5.1053, lon: -1.2466 },
          { name: 'Koforidua (Eastern)', lat: 6.0941, lon: -0.2591 },
          { name: 'Ho (Volta)', lat: 6.6008, lon: 0.4713 },
          { name: 'Sunyani (Bono)', lat: 7.3399, lon: -2.3268 },
          { name: 'Techiman (Bono East)', lat: 7.5909, lon: -1.9395 },
          { name: 'Goaso (Ahafo)', lat: 6.8036, lon: -2.5172 },
          { name: 'Bolgatanga (Upper East)', lat: 10.7856, lon: -0.8514 },
          { name: 'Wa (Upper West)', lat: 10.0601, lon: -2.5099 },
          { name: 'Dambai (Oti)', lat: 8.0662, lon: 0.1795 },
          { name: 'Nalerigu (North East)', lat: 10.5273, lon: -0.3698 },
          { name: 'Damongo (Savannah)', lat: 9.0833, lon: -1.8167 },
          { name: 'Sefwi Wiawso (Western North)', lat: 6.2058, lon: -2.4894 }
        ]
      },
      {
        group: 'West Africa',
        places: [
          { name: 'Lagos, Nigeria', lat: 6.5244, lon: 3.3792 },
          { name: 'Abuja, Nigeria', lat: 9.0765, lon: 7.3986 },
          { name: 'Kano, Nigeria', lat: 12.0022, lon: 8.592 },
          { name: 'Lomé, Togo', lat: 6.1725, lon: 1.2314 },
          { name: 'Cotonou, Benin', lat: 6.3703, lon: 2.3912 },
          { name: 'Abidjan, Côte d’Ivoire', lat: 5.36, lon: -4.0083 },
          { name: 'Ouagadougou, Burkina Faso', lat: 12.3714, lon: -1.5197 },
          { name: 'Bamako, Mali', lat: 12.6392, lon: -8.0029 },
          { name: 'Niamey, Niger', lat: 13.5116, lon: 2.1254 },
          { name: 'Dakar, Senegal', lat: 14.7167, lon: -17.4677 },
          { name: 'Freetown, Sierra Leone', lat: 8.4657, lon: -13.2317 },
          { name: 'Monrovia, Liberia', lat: 6.3156, lon: -10.8074 }
        ]
      }
    ],

    // surge = starting current multiplier (motors and compressors draw 3-6x on start-up).
    // dc = true for loads wired to the DC bus (bypass the inverter).
    APPLIANCES: [
      { name: 'LED bulb', watts: 10, qty: 6, hours: 6, surge: 1 },
      { name: 'Ceiling fan', watts: 70, qty: 3, hours: 8, surge: 1.5 },
      { name: 'Standing fan', watts: 55, qty: 1, hours: 8, surge: 1.5 },
      { name: 'LED TV (43")', watts: 80, qty: 1, hours: 5, surge: 1 },
      { name: 'Satellite decoder', watts: 20, qty: 1, hours: 5, surge: 1 },
      { name: 'Refrigerator', watts: 150, qty: 1, hours: 10, surge: 4 },
      { name: 'Chest/deep freezer', watts: 200, qty: 1, hours: 12, surge: 4 },
      { name: 'Phone charger', watts: 10, qty: 3, hours: 3, surge: 1 },
      { name: 'Laptop', watts: 65, qty: 1, hours: 5, surge: 1 },
      { name: 'Desktop computer', watts: 200, qty: 1, hours: 5, surge: 1 },
      { name: 'Wi-Fi router', watts: 12, qty: 1, hours: 24, surge: 1 },
      { name: 'Sound system', watts: 100, qty: 1, hours: 3, surge: 1 },
      { name: 'Electric iron', watts: 1000, qty: 1, hours: 0.5, surge: 1 },
      { name: 'Microwave', watts: 1200, qty: 1, hours: 0.3, surge: 1.5 },
      { name: 'Blender', watts: 400, qty: 1, hours: 0.2, surge: 2 },
      { name: 'Electric kettle', watts: 1500, qty: 1, hours: 0.3, surge: 1 },
      { name: 'Washing machine', watts: 500, qty: 1, hours: 1, surge: 3 },
      { name: 'Air conditioner (1 HP)', watts: 900, qty: 1, hours: 6, surge: 3 },
      { name: 'Air conditioner (1.5 HP)', watts: 1300, qty: 1, hours: 6, surge: 3 },
      { name: 'Water pump (1 HP)', watts: 750, qty: 1, hours: 1, surge: 4 },
      { name: 'CCTV camera', watts: 5, qty: 4, hours: 24, surge: 1 },
      { name: 'Security light (DC)', watts: 20, qty: 2, hours: 12, surge: 1, dc: true }
    ],

    // Starting load list for a new project (names must match APPLIANCES).
    DEFAULT_LOADS: ['LED bulb', 'Ceiling fan', 'LED TV (43")', 'Satellite decoder', 'Refrigerator', 'Phone charger', 'Laptop'],

    BATTERIES: {
      lifepo4: { label: 'Lithium iron phosphate (LiFePO4)', dod: 80, efficiency: 95, pricePerKWh: 250 },
      agm: { label: 'Lead-acid: AGM / sealed', dod: 50, efficiency: 85, pricePerKWh: 160 },
      gel: { label: 'Lead-acid: gel', dod: 60, efficiency: 85, pricePerKWh: 180 },
      flooded: { label: 'Lead-acid: flooded / tubular', dod: 50, efficiency: 80, pricePerKWh: 130 }
    },

    CONTROLLERS: {
      mppt: { label: 'MPPT', efficiency: 97 },
      pwm: { label: 'PWM', efficiency: 80 }
    },

    DEFAULTS: {
      system: {
        mode: 'offgrid',             // offgrid | hybrid | gridtied
        designBasis: 'worst',        // worst | average
        systemVoltage: 24,           // V DC
        autonomyDays: 1,             // off-grid: days of storage without sun
        backupHours: 6,              // hybrid: hours of outage the battery must cover
        offsetPercent: 100,          // grid-tied/hybrid: share of daily consumption from PV
        panelWatts: 450,
        panelIsc: 13.9,              // A, from the panel datasheet
        panelsPerString: 1,
        tempCoeff: -0.35,            // %/°C, from the panel datasheet
        cellTempRise: 25,            // °C above ambient when operating
        tiltFactor: 1.0,             // tilted-plane gain vs horizontal (≈1.0 near the equator)
        soilingLoss: 3,              // %
        wiringLoss: 3,               // %
        mismatchLoss: 2,             // %
        inverterEfficiency: 93,      // %
        controllerType: 'mppt',
        batteryType: 'lifepo4',
        batteryUnitVoltage: 12,      // V per battery
        batteryUnitAh: 200,          // Ah per battery
        inverterSafety: 1.25,        // continuous rating = peak load x this
        dcAcRatio: 1.15              // grid-tied: PV array kWp / inverter kW
      },
      costs: {
        currency: 'USD',
        panelPerWp: 0.35,
        batteryPerKWh: 250,
        inverterPerKW: 200,
        controllerPerA: 4,
        bosPercent: 15,              // cables, breakers, mounting, earthing
        installPercent: 10,
        lifetimeYears: 25
      }
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = data;
  else root.PV_DATA = data;
})(this);
