import * as C from 'cesium';
import { gibsWms } from './gibs.js';
import { setLayer, dropLayer, getLayer } from './layers.js';

// Every layer here is a NASA GIBS product. stepMinutes is the product's native
// cadence and latencyMinutes is how far behind real time it is published, so
// the requested timestamp always lands on an image that actually exists.
export const WEATHER_LAYERS = [
  {
    id: 'clouds', label: 'Cloud fraction — MODIS Terra', layer: 'MODIS_Terra_Cloud_Fraction_Day',
    stepMinutes: 1440, latencyMinutes: 1440, alpha: 0.68, maxLevel: 5, on: true,
    note: 'Daily global daytime observations. Clear gaps can indicate missing measurements.'
  },
  {
    id: 'precip', label: 'Precipitation rate — GPM IMERG', layer: 'IMERG_Precipitation_Rate_30min',
    stepMinutes: 30, latencyMinutes: 360, alpha: 0.8, maxLevel: 6, on: true,
    note: 'Global half-hour precipitation estimate.'
  },
  {
    id: 'cloudtop', label: 'Cloud-top temperature — MODIS Terra', layer: 'MODIS_Terra_Cloud_Top_Temp_Night',
    stepMinutes: 1440, latencyMinutes: 1440, alpha: 0.72, maxLevel: 5,
    note: 'Global nighttime cloud-top observations.'
  },
  {
    id: 'vapor', label: 'Atmospheric water vapor — MODIS Aqua', layer: 'MODIS_Aqua_Water_Vapor_5km_Day',
    stepMinutes: 1440, latencyMinutes: 1440, alpha: 0.72, maxLevel: 5,
    note: 'Daily global daytime water vapor observations.'
  },
  {
    id: 'sst', label: 'Sea-surface temperature — MUR L4', layer: 'GHRSST_L4_MUR_Sea_Surface_Temperature',
    stepMinutes: 1440, latencyMinutes: 2880, alpha: 0.75, maxLevel: 6,
    note: 'Daily 1 km analysis — the fuel gauge for tropical cyclones.'
  },
  {
    id: 'fires', label: 'Thermal anomalies — VIIRS', layer: 'VIIRS_NOAA20_Thermal_Anomalies_375m_Day',
    stepMinutes: 1440, latencyMinutes: 1440, alpha: 0.95, maxLevel: 8,
    note: 'Active fire and hot-spot detections at 375 m.'
  },
  {
    id: 'aerosol', label: 'Smoke and dust — MODIS aerosol', layer: 'MODIS_Terra_Aerosol',
    stepMinutes: 1440, latencyMinutes: 1440, alpha: 0.6, maxLevel: 6,
    note: 'Aerosol optical depth: smoke plumes, dust storms and haze.'
  },
  {
    id: 'snow', label: 'Snow cover — MODIS NDSI', layer: 'MODIS_Terra_NDSI_Snow_Cover',
    stepMinutes: 1440, latencyMinutes: 1440, alpha: 0.8, maxLevel: 7,
    note: 'Normalised difference snow index.'
  },
  {
    id: 'truecolor', label: 'Daily true colour — VIIRS', layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
    stepMinutes: 1440, latencyMinutes: 1440, alpha: 1, maxLevel: 8,

    note: 'Global daytime mosaic. Areas without observations show the basemap.'
  }
];

const EVENT_COLORS = {
  'Severe Storms': '#7fd4ff', Wildfires: '#ff8a5c', Volcanoes: '#ff5c5c', Floods: '#5c9bff',
  'Sea and Lake Ice': '#cfe9ff', Drought: '#d9c27f', 'Dust and Haze': '#c9a97f',
  Earthquakes: '#ffd05c', 'Temperature Extremes': '#ff7fb0', Snow: '#ffffff',
  'Water Color': '#7fffd4', 'Manmade': '#9aa7b8'
};

function pin(color, category) {
  const element = document.createElement('canvas');
  element.width = 32;
  element.height = 32;
  const context = element.getContext('2d');
  context.beginPath();
  context.arc(16, 16, 11, 0, Math.PI * 2);
  context.fillStyle = "#101a21";
  context.fill();
  context.lineWidth = 2.5;
  context.strokeStyle = color;
  context.stroke();
  context.beginPath();
  const paths = {
    Wildfires:'M16 6 Q18 13 21 16 Q23 23 16 25 Q8 23 11 17 Q14 14 16 6Z',
    Volcanoes:'M6 23 L13 13 L16 16 L19 13 L26 23Z',
    Floods:'M6 14 Q10 10 15 14 T26 14 M6 20 Q10 16 15 20 T26 20',
    'Severe Storms':'M17 6 L10 18 H16 L14 26 L23 13 H17Z',
    'Sea and Lake Ice':'M16 7 V25 M8 11 L24 21 M8 21 L24 11',
    Earthquakes:'M5 17 H11 L14 9 L17 24 L20 15 H27'
  };
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.stroke(new Path2D(paths[category] || 'M16 9 L23 16 L16 23 L9 16Z'));
  context.fillStyle = color;
  context.fill();
  return element.toDataURL('image/png');
}

function timestampFor(spec, date) {
  const step = spec.stepMinutes * 60000;
  const shifted = date.getTime() - spec.latencyMinutes * 60000;
  const snapped = new Date(Math.floor(shifted / step) * step);
  return spec.stepMinutes >= 1440
    ? snapped.toISOString().slice(0, 10)
    : `${snapped.toISOString().slice(0, 19)}Z`;
}

export function createWeather(viewer, { onStatus } = {}) {
  const state = new Map(WEATHER_LAYERS.map((spec) => [spec.id, {
    spec, enabled: false, alpha: spec.alpha, stamp: undefined, failures: 0
  }]));
  const events = new C.CustomDataSource('eonet');
  events.show = false;
  viewer.dataSources.add(events);
  let eventsLoaded = false;
  let live = true;

  function report() {
    if (!onStatus) return;
    onStatus([...state.values()]
      .filter((entry) => entry.enabled)
      .map((entry) => ({ id: entry.spec.id, label: entry.spec.label, stamp: live && (entry.spec.stepMinutes < 1440 || entry.spec.id === 'sst') ? 'Latest available' : entry.stamp, failing: entry.failures > 6 })));
  }

  function build(entry) {
    const { spec } = entry;
    const stamp = timestampFor(spec, C.JulianDate.toDate(viewer.clock.currentTime));
    entry.stamp = stamp;
    entry.failures = 0;
    const provider = gibsWms({
      layer: spec.layer,
      time: live && (spec.stepMinutes < 1440 || spec.id === 'sst') ? undefined : stamp,
      credit: 'NASA GIBS · ' + spec.label,
      format: spec.format ?? 'image/png',
      transparent: spec.transparent ?? true,
      maximumLevel: spec.maxLevel ?? 7
    });
    provider.errorEvent.addEventListener(() => {
      entry.failures += 1;
      if (entry.failures === 7) report();
    });
    setLayer(`w:${spec.id}`, new C.ImageryLayer(provider, { alpha: entry.alpha }));
  }

  function setEnabled(id, enabled) {
    const entry = state.get(id);
    if (!entry || entry.enabled === enabled) return;
    entry.enabled = enabled;
    if (enabled) build(entry);
    else {
      dropLayer(`w:${id}`);
      entry.stamp = undefined;
    }
    report();
  }

  function setAlpha(id, alpha) {
    const entry = state.get(id);
    if (!entry) return;
    entry.alpha = alpha;
    const layer = getLayer(`w:${id}`);
    if (layer) layer.alpha = alpha;
  }

  // GIBS near-real-time products roll forward; re-request when the snapped
  // timestamp for an enabled layer changes.
  let lastCheck = 0;
  viewer.clock.onTick.addEventListener(() => {
    const now = Date.now();
    if (now - lastCheck < 5000) return;
    lastCheck = now;
    const date = C.JulianDate.toDate(viewer.clock.currentTime);
    let changed = false;
    for (const entry of state.values()) {
      if (!entry.enabled) continue;
      if (timestampFor(entry.spec, date) !== entry.stamp) {
        build(entry);
        changed = true;
      }
    }
    if (changed) report();
  });

  async function loadEvents() {
    if (eventsLoaded) return;
    eventsLoaded = true;
    try {
      const response = await fetch('/api/nasa/events');
      if (!response.ok) throw new Error('unavailable');
      const payload = await response.json();
      for (const event of payload.events ?? []) {
        const color = EVENT_COLORS[event.category] ?? '#9aa7b8';
        events.entities.add({
          name: event.title,
          position: C.Cartesian3.fromDegrees(event.longitude, event.latitude, 18000),
          billboard: {
            image: pin(color,event.category),
            width: 26,
            height: 26,
            scaleByDistance: new C.NearFarScalar(2.0e6, 1.1, 4.0e7, 0.55)
          },
          properties: event
        });
      }
    } catch {
      eventsLoaded = false;
    }
  }

  return {
    layers: WEATHER_LAYERS,
    setTimeMode(isLive) {
      live = isLive;
      for (const entry of state.values()) if (entry.enabled) build(entry);
      report();
    },
    setEnabled,
    setAlpha,
    isEnabled: (id) => Boolean(state.get(id)?.enabled),
    setMaster(enabled) {
      for (const spec of WEATHER_LAYERS) {
        if (spec.on) setEnabled(spec.id, enabled);
      }
    },
    async setEvents(show) {
      events.show = show;
      if (show) await loadEvents();
      document.getElementById('event-credit').textContent = events.show && events.entities.values.length ? 'NASA EONET' : '';
    },
    eventsSource: events
  };
}

export async function surfaceWeather(latitude, longitude) {
  const query = `lat=${latitude.toFixed(4)}&lon=${longitude.toFixed(4)}`;
  const response = await fetch(`/api/nasa/power?${query}`);
  if (!response.ok) throw new Error('unavailable');
  return response.json();
}

export async function spaceWeather() {
  const response = await fetch('/api/nasa/spaceweather');
  if (!response.ok) throw new Error('unavailable');
  return response.json();
}
