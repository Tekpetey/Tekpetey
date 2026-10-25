# Solar PV Sizer

A browser-only tool for sizing off-grid, hybrid (backup) and grid-tied solar PV systems.
It has no server and nothing to install: open `index.html` or use the GitHub Pages site.

## What it does

1. **Location and solar resource.** Choose a preset (Ghana's 16 regional capitals and major
   West African cities), search any place, click the map or use your device location. Monthly
   irradiance (GHI, kWh/m²/day = peak sun hours) and air temperature are downloaded from:
   - **NASA POWER**: long-term satellite climatology, global coverage.
   - **Open-Meteo**: monthly means of the last 5 full years of ERA5 reanalysis.

   Every value stays editable, so you can enter site-survey figures or numbers from
   [Global Solar Atlas](https://globalsolaratlas.info) or [PVGIS](https://re.jrc.ec.europa.eu/pvg_tools/en/).
   Those two don't allow browser API calls, so the tool links to them for cross-checking.
2. **Loads.** An appliance table with watts, quantity, hours per day, start-up surge and an AC/DC flag.
3. **System design.** The system type, voltage, autonomy or backup hours, panel and battery
   data, losses and efficiencies.
4. **Prices.** Indicative unit prices for a cost estimate.

**Results** shows the PV array (panels and strings), battery bank (series × parallel), inverter
(continuous and surge rating), charge controller current, a monthly energy balance chart,
design warnings and a cost estimate. Projects autosave in the browser and can be
exported/imported as JSON or printed.

## Method (summary)

| Step | Formula |
| --- | --- |
| Temperature derate | `1 + γ × (T_air + ΔT_cell − 25)` |
| Yield per Wp (monthly) | `GHI × tilt factor × (1−soiling)(1−wiring)(1−mismatch) × temp. derate` |
| Off-grid daily energy | `E_AC / η_inv + E_DC` |
| Off-grid array energy | `daily energy / (η_battery × η_controller)` (conservative: all energy cycles through the battery) |
| Grid-tied/hybrid array energy | `E_AC × PV share / η_inv` |
| Array size | `array energy / yield per Wp` in the design month (worst month, or the annual average) |
| Battery (off-grid) | `daily energy × autonomy days / (DoD × η_battery)` |
| Battery (hybrid) | `average load × backup hours / (DoD × η_battery)` |
| Charge controller | MPPT: `array Wp / V_sys × 1.25`, PWM: `strings × Isc × 1.25` |
| Inverter | off-grid/hybrid: `connected AC load × safety factor`, plus the surge of the largest motor; grid-tied: `array kWp / DC-AC ratio` |

These are preliminary estimates for planning. Confirm them with datasheets, a site survey and a qualified installer.

## Updating the tool

| To change… | Edit |
| --- | --- |
| Preset locations, appliance list, battery types, default settings and prices | `js/data.js` |
| Sizing formulas | `js/sizing.js` (then run the tests) |
| Irradiance or geocoding sources (add a new one to `SOURCES`) | `js/irradiance.js` |
| Layout and styling | `index.html`, `css/style.css` |

Irradiance downloads are cached in each browser for 30 days. **Refresh** downloads them again.

After changing anything, bump `VERSION` in `js/data.js`, run the tests and push to `main`.
The GitHub Actions workflow `.github/workflows/deploy-solar-pv-sizer.yml` runs the tests and
republishes the site automatically.

```sh
node --test solar-pv-sizer/tests/*.test.js
```

To try it locally, serve the folder (any static server works):

```sh
cd solar-pv-sizer && python3 -m http.server 8000   # then open http://localhost:8000
```

### One-time GitHub Pages setup

In the repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
The site is then published at `https://tekpetey.github.io/Tekpetey/`.

## Data credits

- NASA POWER: Prediction Of Worldwide Energy Resources, NASA Langley Research Center.
- Open-Meteo: weather and geocoding APIs (CC BY 4.0), ERA5 data from Copernicus/ECMWF.
- Map tiles © OpenStreetMap contributors; map library [Leaflet](https://leafletjs.com).
