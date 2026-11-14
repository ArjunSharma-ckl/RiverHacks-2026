import * as C from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';

import { createViewer, addBaseImagery } from './viewer.js';
import { initLayers } from './layers.js';
import { createSky } from './sky.js';
import { createSatellites } from './satellites.js';
import { createWeather, WEATHER_LAYERS } from './weather.js';
import { createPanel } from './panel.js';
import { createHud } from './hud.js';
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
  setStatus: (handler) => { statusHandler = handler; }
});

// Picking: primitives and entities first, then the Sun and Moon by projecting
// their real positions, then the globe itself.
viewer.screenSpaceEventHandler.setInputAction(({ position }) => {
  const picked = scene.pick(position, 9, 9);

  if (picked?.id instanceof C.Entity) {
    const entity = picked.id;
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
const cameraKeys = new Set(['w', 'a', 's', 'd', '+', '=', '-', '_']);
window.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest?.('input, select, textarea, [contenteditable=true]')) return;
  if (event.key === 'Escape' && viewer.trackedEntity) satellites.track(undefined);
  const key = event.key.toLowerCase();
  if (!cameraKeys.has(key)) return;
  event.preventDefault();
  const range = viewer.trackedEntity ? C.Cartesian3.magnitude(camera.position) : camera.positionCartographic.height;
  const step = C.Math.clamp(range * 0.15, 0.5, 4000000);
  const angle = viewer.trackedEntity ? 0.05 : C.Math.clamp(range / 6378137 * 0.05, 0.0000001, 0.07);
  switch (key) {
    case 'w': camera.rotateUp(angle); break;
    case 's': camera.rotateDown(angle); break;
    case 'a': camera.rotateLeft(angle); break;
    case 'd': camera.rotateRight(angle); break;
    case '+': case '=': camera.zoomIn(Math.min(step, Math.max(0, range - 2))); break;
    default: camera.zoomOut(step);
  }
});
