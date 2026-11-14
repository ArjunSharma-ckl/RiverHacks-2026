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
const held = new Set();
const axes = [0, 0, 0];
const bindings = {w:[0,1],s:[0,-1],a:[1,1],d:[1,-1],'+':[2,1],'=':[2,1],'-':[2,-1],'_':[2,-1]};
window.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest?.('input,select,textarea,[contenteditable=true]')) return;
  if (event.key === 'Escape' && viewer.trackedEntity) satellites.track(undefined);
  const key = event.key.toLowerCase();
  if (Object.hasOwn(bindings,key)) { event.preventDefault(); held.add(key); }
});
window.addEventListener('keyup',event => held.delete(event.key.toLowerCase()));
window.addEventListener('blur',() => { held.clear(); axes.fill(0); });
let previous = performance.now();
scene.preUpdate.addEventListener(() => {
  const now = performance.now(), dt = Math.min((now-previous)/1000,0.05);
  previous = now;
  const input = [0,0,0];
  for (const key of held) { const [axis,sign] = bindings[key]; input[axis] += sign; }
  axes.forEach((value,i) => { axes[i] += (input[i]-value)*(1-Math.exp(-14*dt)); });
  if (axes.every(value => Math.abs(value)<0.001)) return;
  const range = viewer.trackedEntity ? C.Cartesian3.magnitude(camera.position) : camera.positionCartographic.height;
  const angle = dt*(viewer.trackedEntity ? 1 : C.Math.clamp(range/6378137,0.000001,1));
  camera.rotateUp(axes[0]*angle); camera.rotateLeft(axes[1]*angle);
  camera.zoomIn(Math.min(Math.max(0,range-(viewer.trackedEntity ? 2 : 160)), range*(1-Math.exp(-axes[2]*dt*1.8))));
});

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
