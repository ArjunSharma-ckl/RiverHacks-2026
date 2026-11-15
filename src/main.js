import * as C from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';

import { createViewer, addBaseImagery } from './viewer.js';
import { enableGlobeSpin } from './globe-spin.js';
import { CLOUD_KEYS } from './cloud-loop.js';
import { initLayers } from './layers.js';
import { createSky } from './sky.js';
import { paintGalaxy } from './galaxy.js';
import { addCatalog } from './orbit-catalog.js';
import { createSatellites } from './satellites.js';
import { createWeather, WEATHER_LAYERS } from './weather.js';
import { createPanel } from './panel.js';
import { createHud } from './hud.js';
import { createControls, HOME } from './controls.js';
import { mountMissionControls } from './mission.js';
import { createEventList } from './event-list.js';
import { createQuality } from './quality.js';
import { landingMotion } from './landing-motion.js';
import { STARS, PLANET_NAMES } from './ephemeris.js';
import { SUBJECTS, describe } from './catalog.js';

const { viewer, scene, camera, lensFlare } = createViewer('cesiumContainer');
const spin = enableGlobeSpin(viewer);
const quality = createQuality(viewer);

initLayers(viewer, [
  'bluemarble',
  'esri',
  'w:truecolor',
  ...CLOUD_KEYS,
  ...WEATHER_LAYERS.filter(spec => !['clouds', 'truecolor'].includes(spec.id)).map((spec) => `w:${spec.id}`)
]);
addBaseImagery({ blueMarble: true });


paintGalaxy(scene);

const sky = createSky(viewer);
const satellites = createSatellites(viewer);
const pointList = createEventList();
function skyRows(group) {
  if (group === 'Satellites') return (satellites.contacts || []).map(c => ({
    sky:true,id:c.norad,title:c.name,category:group,description:() =>
      'CelesTrak · NORAD '+c.norad+' · '+c.job+(Number.isFinite(c.alt) ? ' · Altitude '+Math.round(c.alt)+' km' : '')
  }));
  if (group === 'Stars') return STARS.map(s=>({sky:true,id:s.name,title:s.name,category:group,
    description:()=>describe(s.name)+' · Right ascension '+s.ra+'° · Declination '+s.dec+'° · Magnitude '+s.mag}));
  return PLANET_NAMES.map(name=>({sky:true,id:name,title:name,category:group,description:()=>describe(name)}));
}
function pointMode(group,on) {
  pointList.visible(on,group);
  if (on) pointList.populate(skyRows(group),group);
}
for (const group of ['Planets','Stars','Satellites']) pointMode(group,true);
const trackContact = addCatalog(viewer, satellites, () => pointList.populate(skyRows('Satellites'),'Satellites'));

const controls = createControls(viewer, {
  onEscape: () => {
    if (viewer.trackedEntity) satellites.track(undefined);
    else controls.home();
  }
});

mountMissionControls(viewer);

let statusHandler = () => {};
const weather = createWeather(viewer, { eventList:pointList, onStatus: (entries) => statusHandler(entries) });

const panel = createPanel(document.getElementById('details'));

createHud(document.getElementById('hud'), {
  viewer,
  scene,
  sky,
  satellites,
  weather,
  lensFlare,
  spin,
  quality,
  pointMode,
  chooseContact(contact) { trackContact(contact); pointList.open(contact.norad,'Satellites'); },
  controls,
  setStatus: (handler) => { statusHandler = handler; }
});

// Picking: primitives and entities first, then the Sun and Moon by projecting
// their real positions, then the globe itself.
viewer.screenSpaceEventHandler.setInputAction(({ position }) => {
  const picked = scene.pick(position, 9, 9);

  if (picked?.id?.thermal !== undefined) return pointList.open(picked.id.thermal,'Thermal anomalies');
  if (picked?.id?.catalogIndex !== undefined) {
    trackContact(picked.id);
    return pointList.open(picked.id.norad,'Satellites');
  }
  if (picked?.id instanceof C.Entity) {
    const entity = picked.id;
    if (entity.catalogContact) { trackContact(entity.catalogContact); return pointList.open(entity.catalogContact.norad,'Satellites'); }
    if (weather.eventsSource.entities.contains(entity)) {
      const event = entity.properties?.getValue(viewer.clock.currentTime);
      if (event) return weather.openEvent(event.id);
    }
    if (satellites.entities.includes(entity)) satellites.track(entity);
    if (STARS.some(s => s.name === entity.name)) return pointList.open(entity.name,'Stars');
    if (entity.name && SUBJECTS.has(entity.name)) return panel.show(entity.name);
  }
  if (PLANET_NAMES.includes(picked?.id)) return pointList.open(picked.id,'Planets');
  if (typeof picked?.id === 'string' && SUBJECTS.has(picked.id)) {
    return panel.show(picked.id, { subtitle: 'Direction is real; distance is compressed' });
  }

  for (const target of sky.screenTargets(viewer.clock.currentTime)) {
    const screen = C.SceneTransforms.worldToWindowCoordinates(scene, target.position);
    if (screen && C.Cartesian2.distance(screen, position) < 26) return panel.show(target.name);
  }

  const ground = camera.pickEllipsoid(position, scene.globe.ellipsoid);
  if (ground) {
    const carto = C.Cartographic.fromCartesian(ground);
    return panel.showPlace({
      latitude: C.Math.toDegrees(carto.latitude),
      longitude: C.Math.toDegrees(carto.longitude)
    });
  }
  panel.hide();
}, C.ScreenSpaceEventType.LEFT_CLICK);
viewer.trackedEntityChanged.addEventListener(target => {
  scene.screenSpaceCameraController.minimumZoomDistance = target ? 2 : 160;
});
scene.canvas.addEventListener('wheel', event => {
  if (!viewer.trackedEntity || event.deltaY >= 0) return;
  const bounds = scene.canvas.getBoundingClientRect();
  const pixel = new C.Cartesian2(event.clientX-bounds.left,event.clientY-bounds.top);
  const tracked = viewer.trackedEntity.position.getValue(viewer.clock.currentTime);
  const center = tracked && C.SceneTransforms.worldToWindowCoordinates(scene,tracked);
  if (center && C.Cartesian2.distance(center,pixel) < 65) return;
  const ray = camera.getPickRay(pixel);
  const ground = ray && scene.globe.pick(ray,scene);
  if (!ground) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const location = C.Cartographic.fromCartesian(ground);
  viewer.trackedEntity = undefined;
  camera.flyTo({destination:C.Cartesian3.fromRadians(location.longitude,location.latitude,
    location.height + Math.max(160, C.Cartesian3.distance(camera.positionWC,ground)*0.72)), duration:0.65});
}, {capture:true,passive:false});


// Points on the far side of the Earth should disappear instead of showing
// through the globe. Cesium's occcluder answers that per point each frame.
const hiddenBehindGlobe = new Set();
const horizonTest = new C.EllipsoidalOccluder(scene.globe.ellipsoid, camera.positionWC);
scene.preRender.addEventListener(() => {
  horizonTest.cameraPosition = camera.positionWC;
  const time = viewer.clock.currentTime;
  const collections = [viewer.entities];
  // DataSourceCollection exposes length and get(i); it has no Symbol.iterator,
  // so for..of over it throws on every frame and Cesium stops rendering.
  for (let i = 0; i < viewer.dataSources.length; i++) {
    const source = viewer.dataSources.get(i);
    if (source?.entities) collections.push(source.entities);
  }
  for (const collection of collections) {
    for (const entity of collection.values) {
      const position = entity.position?.getValue(time);
      if (!position) continue;
      if (!horizonTest.isPointVisible(position)) {
        if (entity.show) {
          entity.show = false;
          hiddenBehindGlobe.add(entity);
        }
      } else if (hiddenBehindGlobe.has(entity)) {
        entity.show = true;
        hiddenBehindGlobe.delete(entity);
      }
    }
  }
});


// Landing sequence. While the headline is up the globe drifts slowly, which
// is what makes the first screen feel alive rather than a still; the first
// deliberate input from the viewer ends it. Clicking through flies the camera
// in, and that push-in is the one piece of motion the page spends boldness on.
// Landing view. The Earth is shown leaning on its real axial tilt and turns a
// quarter of a degree a second, slow enough to read as a planet rather than a
// spinner. It arrives from deep space over the first three seconds.
let introDrift = true;
let driftFrame = performance.now();
let tourActive = false;
const stopDrift = () => {};
const calmMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const AXIAL_TILT = -C.Math.toRadians(23.4);
const SPIN_RATE = C.Math.toRadians(0.25);
const ARRIVAL_SECONDS = 3;
const ARRIVAL_HEIGHT = HOME.height * 4.2;
let arrival = document.body.classList.contains('intro-open') && !calmMotion() ? 0 : ARRIVAL_SECONDS;
if (document.body.classList.contains('intro-open')) {
  camera.setView({
    destination: C.Cartesian3.fromDegrees(HOME.longitude, HOME.latitude,
      arrival < ARRIVAL_SECONDS ? ARRIVAL_HEIGHT : HOME.height),
    orientation: { heading: AXIAL_TILT, pitch: -C.Math.PI_OVER_TWO, roll: 0 },
  });
}

scene.preUpdate.addEventListener(() => {
  const now = performance.now();
  const elapsed = Math.min((now - driftFrame) / 1000, 0.1);
  driftFrame = now;
  if (!document.body.classList.contains('intro-open')) return;
  if (arrival < ARRIVAL_SECONDS) {
    arrival = Math.min(ARRIVAL_SECONDS, arrival + elapsed);
    const t = arrival / ARRIVAL_SECONDS;
    const eased = 1 - Math.pow(1 - t, 4);
    const here = camera.positionCartographic;
    camera.setView({
      destination: C.Cartesian3.fromRadians(here.longitude, here.latitude,
        ARRIVAL_HEIGHT + (HOME.height - ARRIVAL_HEIGHT) * eased),
      orientation: { heading: AXIAL_TILT, pitch: -C.Math.PI_OVER_TWO, roll: 0 },
    });
  }
  if (!introDrift || calmMotion() || tourActive) return;
  camera.rotate(C.Cartesian3.UNIT_Z, SPIN_RATE * elapsed);
});

// Spin and render quality are reachable from the first screen.
{
  const spinButton = document.getElementById('intro-spin');
  if (spinButton) spinButton.onclick = () => {
    introDrift = !introDrift;
    spinButton.setAttribute('aria-pressed', String(introDrift));
    spinButton.textContent = introDrift ? 'Spin on' : 'Spin off';
  };
  const qualityButton = document.getElementById('intro-quality');
  if (qualityButton) {
    const label = () => { qualityButton.textContent = 'Quality: ' + quality.level.label; };
    label();
    qualityButton.onclick = () => {
      quality.apply((quality.index + 1) % quality.levels.length);
      label();
      const slider = document.getElementById('quality-slider');
      if (slider) { slider.value = String(quality.index); slider.dispatchEvent(new Event('input')); }
    };
  }
}

document.addEventListener('orbit:enter', () => {
  arrival = ARRIVAL_SECONDS;
  if (calmMotion()) {
    camera.setView({
      destination: C.Cartesian3.fromDegrees(HOME.longitude, HOME.latitude, HOME.height),
      orientation: { heading: 0, pitch: -C.Math.PI_OVER_TWO, roll: 0 },
    });
    return;
  }
  camera.flyTo({
    destination: C.Cartesian3.fromDegrees(HOME.longitude, HOME.latitude, HOME.height * 0.78),
    orientation: { heading: 0, pitch: -C.Math.PI_OVER_TWO, roll: 0 },
    duration: 1.7,
    easingFunction: C.EasingFunction.QUADRATIC_IN_OUT,
  });
}, { once: true });

// Scroll tour. Each chapter of the landing page has a camera keyframe, and the
// scroll position blends between them. The camera eases toward the blend every
// frame instead of being set on the scroll event, so it glides, and picks up
// smoothly from wherever the idle drift left it.
const story = document.getElementById('orbit-story');
if (story) {
  const KEYFRAMES = [
    { lon: HOME.longitude, lat: HOME.latitude, height: HOME.height },
    { lon: -96, lat: 31, height: 1.25e7 },   // weather over North America
    { lon: -38, lat: 6, height: 3.5e7 },     // pulled back to the satellite shells
    { lon: -19, lat: 58, height: 7.5e6 },    // Iceland, a classic Mars analog
    { lon: -68, lat: -20, height: 1.5e7 },   // the Atacama
  ];
  let tourTarget = null;
  story.addEventListener('scroll', () => {
    const span = story.scrollHeight - story.clientHeight;
    const progress = span > 0 ? story.scrollTop / span : 0;
    story.style.setProperty('--progress', progress.toFixed(4));
    // Back at the top the planet is left to turn on its own again.
    if (progress < 0.004) { tourTarget = null; tourActive = false; return; }
    tourActive = true;
    arrival = ARRIVAL_SECONDS;
    const scaled = progress * (KEYFRAMES.length - 1);
    const index = Math.min(KEYFRAMES.length - 2, Math.floor(scaled));
    const t = scaled - index;
    const blend = t * t * (3 - 2 * t);
    const from = KEYFRAMES[index], to = KEYFRAMES[index + 1];
    tourTarget = {
      lon: from.lon + (to.lon - from.lon) * blend,
      lat: from.lat + (to.lat - from.lat) * blend,
      height: from.height + (to.height - from.height) * blend,
    };
    stopDrift();
  }, { passive: true });

  let tourFrame = performance.now();
  scene.preUpdate.addEventListener(() => {
    const now = performance.now();
    const elapsed = Math.min((now - tourFrame) / 1000, 0.1);
    tourFrame = now;
    if (!tourTarget || !document.body.classList.contains('intro-open')) return;
    const here = camera.positionCartographic;
    const ease = 1 - Math.exp(-elapsed * 4.5);
    const lon = C.Math.toDegrees(here.longitude);
    const lat = C.Math.toDegrees(here.latitude);
    const turn = ((tourTarget.lon - lon + 540) % 360) - 180;
    camera.setView({
      destination: C.Cartesian3.fromDegrees(
        lon + turn * ease,
        lat + (tourTarget.lat - lat) * ease,
        here.height + (tourTarget.height - here.height) * ease,
      ),
      orientation: { heading: AXIAL_TILT, pitch: -C.Math.PI_OVER_TWO, roll: 0 },
    });
  });

  if ('IntersectionObserver' in window) {
    const reveal = new IntersectionObserver((entries) => {
      for (const entry of entries) entry.target.classList.toggle('in', entry.isIntersecting);
    }, { root: story, threshold: 0.45 });
    for (const panel of story.querySelectorAll('.story-panel:not(.story-hero)')) reveal.observe(panel);
  } else {
    for (const panel of story.querySelectorAll('.story-panel')) panel.classList.add('in');
  }
}

landingMotion(document.getElementById('orbit-story'));
