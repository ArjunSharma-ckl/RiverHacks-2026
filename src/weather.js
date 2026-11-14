import * as C from 'cesium';
import { gibsWms } from './gibs.js';
import { setLayer, dropLayer, getLayer } from './layers.js';

// Every layer here is a NASA GIBS product. stepMinutes is the product's native
// cadence and latencyMinutes is how far behind real time it is published, so
// the requested timestamp always lands on an image that actually exists.
export const WEATHER_LAYERS = [
  {
    id: 'geocolor-east', label: 'Cloud cover — GOES-East GeoColor', layer: 'GOES-East_ABI_GeoColor',
    stepMinutes: 10, latencyMinutes: 75, alpha: 0.92, maxLevel: 7, on: true,
    note: 'Ten-minute full disk: true colour by day, multispectral infrared at night.'
  },
  {
    id: 'geocolor-west', label: 'Cloud cover — GOES-West GeoColor', layer: 'GOES-West_ABI_GeoColor',
    stepMinutes: 10, latencyMinutes: 75, alpha: 0.92, maxLevel: 7, on: true,
    note: 'The Pacific-hemisphere companion to GOES-East.'
  },
  {
    id: 'precip', label: 'Precipitation rate — GPM IMERG', layer: 'IMERG_Precipitation_Rate',
    stepMinutes: 30, latencyMinutes: 340, alpha: 0.8, maxLevel: 6, on: true,
    note: 'Half-hourly rain and snow rate from the GPM satellite constellation.'
  },
  {
    id: 'cloudtop', label: 'Cloud-top temperature — GOES clean IR', layer: 'GOES-East_ABI_Band13_Clean_Infrared',
    stepMinutes: 10, latencyMinutes: 75, alpha: 0.72, maxLevel: 7,
    note: 'Cold tops mark deep convection and thunderstorm anvils.'
  },
  {
    id: 'airmass', label: 'Air mass — GOES RGB', layer: 'GOES-East_ABI_Air_Mass',
    stepMinutes: 10, latencyMinutes: 75, alpha: 0.72, maxLevel: 7,
    note: 'Picks out jet streams, dry slots and cyclone structure.'
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
    id: 'truecolor', label: 'True colour today — VIIRS', layer: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
    stepMinutes: 1440, latencyMinutes: 1440, alpha: 1, maxLevel: 8,
    format: 'image/jpeg', transparent: false,
    note: 'Today’s 250 m global mosaic, swath gaps and all.'
  }
];

const EVENT_COLORS = {
  'Severe Storms': '#7fd4ff', Wildfires: '#ff8a5c', Volcanoes: '#ff5c5c', Floods: '#5c9bff',
  'Sea and Lake Ice': '#cfe9ff', Drought: '#d9c27f', 'Dust and Haze': '#c9a97f',
  Earthquakes: '#ffd05c', 'Temperature Extremes': '#ff7fb0', Snow: '#ffffff',
  'Water Color': '#7fffd4', 'Manmade': '#9aa7b8'
};

function pin(color) {
  const element = document.createElement('canvas');
  element.width = 32;
  element.height = 32;
  const context = element.getContext('2d');
  context.beginPath();
  context.arc(16, 16, 11, 0, Math.PI * 2);
  context.fillStyle = `${color}33`;
  context.fill();
  context.lineWidth = 2.5;
  context.strokeStyle = color;
  context.stroke();
  context.beginPath();
  context.arc(16, 16, 3.5, 0, Math.PI * 2);
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

  function report() {
    if (!onStatus) return;
    onStatus([...state.values()]
      .filter((entry) => entry.enabled)
      .map((entry) => ({ id: entry.spec.id, label: entry.spec.label, stamp: entry.stamp, failing: entry.failures > 6 })));
  }

  function build(entry) {
    const { spec } = entry;
    const stamp = timestampFor(spec, C.JulianDate.toDate(viewer.clock.currentTime));
    entry.stamp = stamp;
    entry.failures = 0;
    const provider = gibsWms({
      layer: spec.layer,
      time: stamp,
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
            image: pin(color),
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
    setEnabled,
    setAlpha,
    isEnabled: (id) => Boolean(state.get(id)?.enabled),
    setMaster(enabled) {
      for (const spec of WEATHER_LAYERS) {
        if (spec.on) setEnabled(spec.id, enabled);
      }
    },
    async setEvents(show) {
      if (show) await loadEvents();
      events.show = show;
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
