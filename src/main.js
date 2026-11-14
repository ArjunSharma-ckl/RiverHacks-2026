import * as C from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';

import { createViewer, addBaseImagery } from './viewer.js';
import { initLayers } from './layers.js';
import { createSky } from './sky.js';
import { addCatalog } from './orbit-catalog.js';
import { createSatellites } from './satellites.js';
import { createWeather, WEATHER_LAYERS } from './weather.js';
import { createPanel } from './panel.js';
import { createHud } from './hud.js';
import { createControls } from './controls.js';
import { SUBJECTS } from './catalog.js';

const { viewer, scene, camera, lensFlare } = createViewer('cesiumContainer');

initLayers(viewer, [
  'bluemarble',
  'esri',
  ...WEATHER_LAYERS.map((spec) => `w:${spec.id}`)
]);
addBaseImagery();


const sky = createSky(viewer);
const satellites = createSatellites(viewer);
const trackContact = addCatalog(viewer, satellites);

const controls = createControls(viewer, {
  onEscape: () => {
    if (viewer.trackedEntity) satellites.track(undefined);
    else controls.home();
  }
});

let statusHandler = () => {};
const weather = createWeather(viewer, { onStatus: (entries) => statusHandler(entries) });

const panel = createPanel(document.getElementById('details'));

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

// Picking: primitives and entities first, then the Sun and Moon by projecting
// their real positions, then the globe itself.
viewer.screenSpaceEventHandler.setInputAction(({ position }) => {
  const picked = scene.pick(position, 9, 9);

  if (picked?.id?.catalogIndex !== undefined) {
    trackContact(picked.id);
    return panel.showContact(picked.id);
  }
  if (picked?.id instanceof C.Entity) {
    const entity = picked.id;
    if (entity.catalogContact) { trackContact(entity.catalogContact); return panel.showContact(entity.catalogContact); }
    if (weather.eventsSource.entities.contains(entity)) {
      const event = entity.properties?.getValue(viewer.clock.currentTime);
      if (event) return panel.showEvent(event);
    }
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
    return panel.show('Earth', {
      location: {
        latitude: C.Math.toDegrees(carto.latitude),
        longitude: C.Math.toDegrees(carto.longitude)
      }
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
