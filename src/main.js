import * as C from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';

import { createViewer, addBaseImagery, setNightLights } from './viewer.js';
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
  'nightlights',
  ...WEATHER_LAYERS.map((spec) => `w:${spec.id}`)
]);
addBaseImagery();
setNightLights(true);

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
  setNightLights,
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
