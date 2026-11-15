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
import { createControls } from './controls.js';
import { mountMissionControls } from './mission.js';
import { createEventList } from './event-list.js';
import { STARS, PLANET_NAMES } from './ephemeris.js';
import { SUBJECTS, describe } from './catalog.js';

const { viewer, scene, camera, lensFlare } = createViewer('cesiumContainer');
const spin = enableGlobeSpin(viewer);

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

