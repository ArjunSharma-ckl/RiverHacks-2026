import * as C from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';

import { createViewer, addBaseImagery } from './viewer.js';
import { initLayers } from './layers.js';
import { createSky } from './sky.js';
import { paintGalaxy } from './galaxy.js';
import { addCatalog } from './orbit-catalog.js';
import { createSatellites } from './satellites.js';
import { createWeather, WEATHER_LAYERS, CLOUD_FRAMES } from './weather.js';
import { createPanel } from './panel.js';
import { createHud } from './hud.js';
import { createControls } from './controls.js';
import { mountMissionControls } from './mission.js';
import { createRail } from './rail.js';
import { createSatellitePanel } from './satellite-panel.js';
import { SUBJECTS } from './catalog.js';

const { viewer, scene, camera, lensFlare } = createViewer('cesiumContainer');

initLayers(viewer, [
  'bluemarble',
  'esri',
  ...WEATHER_LAYERS.flatMap((spec) => spec.animated
    ? Array.from({ length: CLOUD_FRAMES }, (_, index) => `w:${spec.id}:${index}`)
    : [`w:${spec.id}`])
]);
addBaseImagery();

paintGalaxy(scene);

const sky = createSky(viewer);
const satellites = createSatellites(viewer);
const trackContact = addCatalog(viewer, satellites);

const controls = createControls(viewer, {
  onEscape: () => {
    if (viewer.trackedEntity) satellites.track(undefined);
    else controls.home();
  }
});

mountMissionControls(viewer);

const panel = createPanel(document.getElementById('details'));
const rail = createRail(document.getElementById('rail'), {
  onSelectEvent: (event) => weather.flyToEvent(event),
  onSelectDot: (dot) => weather.flyToDot(dot)
});

const satellitePanel = createSatellitePanel({
  viewer,
  satellites,
  onChoose: (contact) => trackContact(contact)
});
rail.panel('satellites')?.body.append(satellitePanel.root);

let statusHandler = () => {};
const weather = createWeather(viewer, {
  onStatus: (entries) => statusHandler(entries),
  onEvents: (events) => rail.setEvents(events),
  onThermal: (dots) => rail.setHotspots(dots),
  onLayers: (ids) => rail.setLayers(ids)
});

createHud(document.getElementById('hud'), {
  viewer,
  scene,
  sky,
  satellites,
  weather,
  lensFlare,
  chooseContact(contact) { trackContact(contact); panel.showContact(contact); },
  controls,
  setStatus: (handler) => { statusHandler = handler; }
});

// Hover card. A dot on the globe answers to the pointer and the same row is
// highlighted in the right-hand panel, so both read as one object.
const tip = document.getElementById('map-tip');
function showTip(annotation, x, y) {
  const { data, kind } = annotation;
  const heading = document.createElement('b');
  heading.textContent = data.title;
  const meta = document.createElement('span');
  meta.textContent = kind === 'event'
    ? `${data.category} · ${new Date(data.date).toUTCString().slice(5, 22)}`
    : `${data.latitude.toFixed(2)}°, ${data.longitude.toFixed(2)}° · thermal detection`;
  const hint = document.createElement('em');
  hint.textContent = 'Click to open its briefing in the panel';
  tip.replaceChildren(heading, meta, hint);
  tip.hidden = false;
  const box = tip.getBoundingClientRect();
  const pad = 16;
  let left = x + 18;
  let top = y + 18;
  if (left + box.width > window.innerWidth - pad) left = x - box.width - 18;
  if (top + box.height > window.innerHeight - pad) top = y - box.height - 18;
  tip.style.left = `${Math.max(pad, left)}px`;
  tip.style.top = `${Math.max(pad, top)}px`;
}

let lastHover = 0;
viewer.screenSpaceEventHandler.setInputAction(({ endPosition }) => {
  const now = performance.now();
  if (now - lastHover < 70) return;
  lastHover = now;
  const annotation = weather.describe(scene.pick(endPosition, 11, 11)?.id);
  if (!annotation) {
    if (!tip.hidden) tip.hidden = true;
    return;
  }
  showTip(annotation, endPosition.x, endPosition.y);
  rail.highlight(annotation.kind, annotation.id);
}, C.ScreenSpaceEventType.MOUSE_MOVE);

// Picking: dots first, then primitives and entities, then the Sun and Moon by
// projecting their real positions, then the globe itself.
viewer.screenSpaceEventHandler.setInputAction(({ position }) => {
  const picked = scene.pick(position, 9, 9);
  const annotation = weather.describe(picked?.id);

  if (annotation?.kind === 'event') {
    tip.hidden = true;
    rail.selectEvent(annotation.data);
    weather.flyToEvent(annotation.data);
    return;
  }
  if (annotation?.kind === 'thermal') {
    tip.hidden = true;
    rail.selectHotspot(annotation.data);
    weather.flyToDot(annotation.data);
    return;
  }

  if (picked?.id?.catalogIndex !== undefined) {
    trackContact(picked.id);
    return panel.showContact(picked.id);
  }
  if (picked?.id instanceof C.Entity) {
    const entity = picked.id;
    if (entity.catalogContact) { trackContact(entity.catalogContact); return panel.showContact(entity.catalogContact); }
    if (satellites.entities.includes(entity)) satellites.track(entity);
    if (entity.name && SUBJECTS.has(entity.name)) return panel.show(entity.name);
  }
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
