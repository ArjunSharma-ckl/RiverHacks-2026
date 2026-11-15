import * as C from 'cesium';
import { gibsWms } from './gibs.js';
import { setLayer, dropLayer, getLayer } from './layers.js';

// Every layer here is a NASA GIBS product. stepMinutes is the product's native
// cadence and latencyMinutes is how far behind real time it is published, so
// the requested timestamp always lands on an image that actually exists.
export const WEATHER_LAYERS = [
  {
    id: 'geocolor-east', label: 'Cloud cover — GOES-East GeoColor', layer: 'GOES-East_ABI_GeoColor',
    stepMinutes: 10, latencyMinutes: 75, alpha: 0.92, maxLevel: 7, on: true, animated: true,
    note: 'Ten-minute full disk: true colour by day, multispectral infrared at night.'
  },
  {
    id: 'geocolor-west', label: 'Cloud cover — GOES-West GeoColor', layer: 'GOES-West_ABI_GeoColor',
    stepMinutes: 10, latencyMinutes: 75, alpha: 0.92, maxLevel: 7, on: true, animated: true,
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
    note: 'Active fire and hot-spot detections at 375 m. Adds the matching dots to the globe.'
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
    id: 'truecolor', label: 'Daily true colour — VIIRS', layer: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
    stepMinutes: 1440, latencyMinutes: 1440, alpha: 1, maxLevel: 7,
    // PNG with alpha: the swath seams and the empty corners stay transparent so
    // the basemap shows through instead of opaque black tiles with hard edges.
    format: 'image/png', transparent: true,
    note: 'Today’s 250 m global mosaic. Unobserved swaths stay clear; they are gaps, not cloud.'
  }
];

export const EVENT_COLORS = {
  'Severe Storms': '#7fd4ff', Wildfires: '#ff8a5c', Volcanoes: '#ff5c5c', Floods: '#5c9bff',
  'Sea and Lake Ice': '#cfe9ff', Drought: '#d9c27f', 'Dust and Haze': '#c9a97f',
  Earthquakes: '#ffd05c', 'Temperature Extremes': '#ff7fb0', Snow: '#ffffff',
  'Water Color': '#7fffd4', Manmade: '#9aa7b8'
};

// Frames looped for the animated cloud layers. Must match the layer order
// declared in main.js so the frames stay above the basemap.
export const CLOUD_FRAMES = 3;

const GLYPHS = {
  Wildfires: 'M16 6 Q18 13 21 16 Q23 23 16 25 Q8 23 11 17 Q14 14 16 6Z',
  Volcanoes: 'M6 23 L13 13 L16 16 L19 13 L26 23Z',
  Floods: 'M6 14 Q10 10 15 14 T26 14 M6 20 Q10 16 15 20 T26 20',
  'Severe Storms': 'M17 6 L10 18 H16 L14 26 L23 13 H17Z',
  'Sea and Lake Ice': 'M16 7 V25 M8 11 L24 21 M8 21 L24 11',
  Earthquakes: 'M5 17 H11 L14 9 L17 24 L20 15 H27',
  Snow: 'M16 6 V26 M8 11 L24 21 M8 21 L24 11 M12 7 L20 9 M12 25 L20 23',
  'Temperature Extremes': 'M16 7 A4 4 0 0 1 20 11 V19 A5 5 0 1 1 12 19 V11 A4 4 0 0 1 16 7Z',
  'Dust and Haze': 'M6 12 H24 M8 17 H26 M6 22 H22',
  Drought: 'M7 20 H25 M12 20 V8 M20 20 V12',
  'Water Color': 'M6 16 Q11 9 16 16 T26 16 M6 23 Q11 16 16 23 T26 23',
  Manmade: 'M8 22 V11 L14 15 V11 L20 15 V9 L24 9 V22Z'
};

// The same symbol vocabulary is used on the globe and in the right-hand list,
// so a dot is recognisable in both places.
export function pin(color, category) {
  const element = document.createElement('canvas');
  element.width = 48;
  element.height = 48;
  const context = element.getContext('2d');
  context.scale(1.5, 1.5);
  context.beginPath();
  context.arc(16, 16, 11, 0, Math.PI * 2);
  context.fillStyle = '#101a21';
  context.fill();
  context.lineWidth = 2.3;
  context.strokeStyle = color;
  context.stroke();
  context.beginPath();
  context.strokeStyle = color;
  context.lineWidth = 1.9;
  context.lineJoin = 'round';
  context.stroke(new Path2D(GLYPHS[category] || 'M16 9 L23 16 L16 23 L9 16Z'));
  context.fillStyle = color;
  context.fill();
  return element.toDataURL('image/png');
}

function heatDot() {
  const element = document.createElement('canvas');
  element.width = 48;
  element.height = 48;
  const context = element.getContext('2d');
  const glow = context.createRadialGradient(24, 24, 1, 24, 24, 22);
  glow.addColorStop(0, 'rgba(255,244,200,0.95)');
  glow.addColorStop(0.35, 'rgba(255,168,64,0.75)');
  glow.addColorStop(0.7, 'rgba(255,96,32,0.28)');
  glow.addColorStop(1, 'rgba(255,72,0,0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, 48, 48);
  context.beginPath();
  context.arc(24, 24, 4.2, 0, Math.PI * 2);
  context.fillStyle = '#fff2c4';
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

// Consecutive frames behind the newest one, used to loop the cloud deck.
function frameStamps(spec, stamp, count) {
  const end = new Date(stamp.length > 10 ? stamp : `${stamp}T00:00:00Z`);
  const stamps = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(end.getTime() - index * spec.stepMinutes * 60000);
    stamps.push(spec.stepMinutes >= 1440
      ? date.toISOString().slice(0, 10)
      : `${date.toISOString().slice(0, 19)}Z`);
  }
  return stamps;
}

export function createWeather(viewer, { onStatus, onEvents, onThermal, onLayers } = {}) {
  const state = new Map(WEATHER_LAYERS.map((spec) => [spec.id, {
    spec, enabled: false, alpha: spec.alpha, stamp: undefined, failures: 0, frames: [], timer: undefined, frameIndex: 0
  }]));

  const events = new C.CustomDataSource('eonet');
  events.show = false;
  viewer.dataSources.add(events);

  const thermal = new C.CustomDataSource('thermal');
  thermal.show = false;
  viewer.dataSources.add(thermal);

  const hotImage = heatDot();
  let eventList = [];
  let thermalDots = [];
  let eventsLoaded = false;
  let thermalLoaded = false;
  let animation = true;

  function report() {
    onLayers?.([...state.values()].filter((entry) => entry.enabled).map((entry) => entry.spec.id));
    if (!onStatus) return;
    onStatus([...state.values()]
      .filter((entry) => entry.enabled)
      .map((entry) => ({ id: entry.spec.id, label: entry.spec.label, stamp: entry.stamp, failing: entry.failures > 6 })));
  }

  function providerFor(spec, stamp, maximumLevel) {
    return gibsWms({
      layer: spec.layer,
      time: stamp,
      format: spec.format ?? 'image/png',
      transparent: spec.transparent ?? true,
      maximumLevel: maximumLevel ?? spec.maxLevel ?? 7
    });
  }

  function stopFrames(entry) {
    if (entry.timer) clearInterval(entry.timer);
    entry.timer = undefined;
    for (let index = 0; index < entry.frames.length; index += 1) {
      dropLayer(`w:${entry.spec.id}:${index}`);
    }
    entry.frames = [];
    entry.frameIndex = 0;
  }

  // Clouds are a moving field, not a still image. Loop the newest GOES frames so
  // the deck drifts instead of sitting there as one frozen square of pixels.
  function startFrames(entry) {
    stopFrames(entry);
    const stamps = frameStamps(entry.spec, entry.stamp, CLOUD_FRAMES);
    entry.frames = stamps.map((stamp, index) => {
      const layer = new C.ImageryLayer(providerFor(entry.spec, stamp, 5), { alpha: entry.alpha });
      layer.show = false;
      // Registered by key so the stack order raises the frames over the
      // basemap; adding them directly would let restack() bury them.
      return setLayer(`w:${entry.spec.id}:${index}`, layer);
    });
    entry.frameIndex = entry.frames.length - 1;
    entry.frames[entry.frameIndex].show = true;
    entry.timer = setInterval(() => {
      if (!entry.enabled || entry.frames.length < 2) return;
      entry.frames[entry.frameIndex].show = false;
      entry.frameIndex = (entry.frameIndex + 1) % entry.frames.length;
      entry.frames[entry.frameIndex].show = true;
    }, 1600);
  }

  function build(entry) {
    const { spec } = entry;
    const stamp = timestampFor(spec, C.JulianDate.toDate(viewer.clock.currentTime));
    entry.stamp = stamp;
    entry.failures = 0;
    if (spec.animated && animation) {
      dropLayer(`w:${spec.id}`);
      startFrames(entry);
      return;
    }
    stopFrames(entry);
    const provider = providerFor(spec, stamp);
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
      stopFrames(entry);
      entry.stamp = undefined;
    }
    if (id === 'fires') setThermal(enabled);
    report();
  }

  function setAlpha(id, alpha) {
    const entry = state.get(id);
    if (!entry) return;
    entry.alpha = alpha;
    const layer = getLayer(`w:${id}`);
    if (layer) layer.alpha = alpha;
    for (const frame of entry.frames) frame.alpha = alpha;
  }

  function setAnimation(on) {
    animation = Boolean(on);
    for (const entry of state.values()) {
      if (entry.enabled) build(entry);
    }
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
      eventList = payload.events ?? [];
      for (const event of eventList) {
        const colour = EVENT_COLORS[event.category] ?? '#9aa7b8';
        const entity = events.entities.add({
          name: event.title,
          position: C.Cartesian3.fromDegrees(event.longitude, event.latitude, 18000),
          billboard: {
            image: pin(colour, event.category),
            width: 26,
            height: 26,
            scaleByDistance: new C.NearFarScalar(2.0e6, 1.15, 4.0e7, 0.5)
          },
          properties: event
        });
        entity.eonetEvent = event;
      }
      onEvents?.(eventList);
    } catch {
      eventsLoaded = false;
    }
  }

  async function loadThermal() {
    if (thermalLoaded) return;
    thermalLoaded = true;
    try {
      const response = await fetch('/api/nasa/thermal');
      if (!response.ok) throw new Error('unavailable');
      const payload = await response.json();
      thermalDots = payload.dots ?? [];
      for (const dot of thermalDots) {
        // A detection with a higher fire radiative power reads as a bigger
        // glow; named EONET events keep a uniform marker.
        const size = dot.source === 'NASA FIRMS'
          ? Math.min(20 + Math.sqrt(dot.frp || 10) * 2.4, 36)
          : 30;
        const entity = thermal.entities.add({
          name: dot.title,
          position: C.Cartesian3.fromDegrees(dot.longitude, dot.latitude, 12000),
          billboard: {
            image: hotImage,
            width: size,
            height: size,
            scaleByDistance: new C.NearFarScalar(2.0e6, 1.1, 4.0e7, 0.55)
          },
          properties: dot
        });
        entity.thermalDot = dot;
      }
      onThermal?.(thermalDots);
    } catch {
      thermalLoaded = false;
    }
  }

  async function setThermal(show) {
    if (show) await loadThermal();
    thermal.show = Boolean(show);
  }

  // What the pointer is over, if it is one of the dots on the globe.
  function describe(entity) {
    if (!(entity instanceof C.Entity)) return undefined;
    if (entity.eonetEvent) return { kind: 'event', id: entity.eonetEvent.id, data: entity.eonetEvent };
    if (entity.thermalDot) return { kind: 'thermal', id: entity.thermalDot.key, data: entity.thermalDot };
    return undefined;
  }

  function flyTo(latitude, longitude, height = 2.4e6) {
    viewer.trackedEntity = undefined;
    viewer.camera.flyTo({
      destination: C.Cartesian3.fromDegrees(longitude, latitude, height),
      duration: 1.3
    });
  }

  return {
    layers: WEATHER_LAYERS,
    setEnabled,
    setAlpha,
    setAnimation,
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
    setThermal,
    describe,
    flyToEvent: (event) => flyTo(event.latitude, event.longitude),
    flyToDot: (dot) => flyTo(dot.latitude, dot.longitude, 1.2e6),
    events: () => eventList,
    thermal: () => thermalDots,
    eventsSource: events,
    thermalSource: thermal,
    async loadAll() {
      await Promise.all([loadEvents(), loadThermal()]);
    }
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
