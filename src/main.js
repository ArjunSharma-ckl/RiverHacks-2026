import * as C from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';

const viewer = new C.Viewer('cesiumContainer', {
  baseLayer: C.ImageryLayer.fromProviderAsync(C.SingleTileImageryProvider.fromUrl('/textures/earth.jpg')),
  timeline: false, animation: false, fullscreenButton: false, homeButton: false,
  geocoder: false, sceneModePicker: false, navigationHelpButton: false, baseLayerPicker: false,
  infoBox: false, selectionIndicator: false, shouldAnimate: true, shadows: true
});
const { scene, camera } = viewer;
scene.globe.enableLighting = true;
scene.globe.showGroundAtmosphere = false;
scene.skyAtmosphere.brightnessShift = -0.45;
scene.skyAtmosphere.saturationShift = -0.45;
scene.globe.dynamicAtmosphereLighting = true;
viewer.clock.currentTime = C.JulianDate.fromIso8601('2026-06-12T15:00:00Z');
const start = viewer.clock.currentTime.clone();
camera.setView({ destination: C.Cartesian3.fromDegrees(-35, 15, 21500000) });

function addTiles(url, credit, maximumLevel, minimumTerrainLevel = 0) {
  const provider = new C.UrlTemplateImageryProvider({ url, credit, maximumLevel });
  viewer.imageryLayers.add(new C.ImageryLayer(provider, {
    minimumTerrainLevel, brightness: 0.83, saturation: 0.72, contrast: 1.08
  }));
}
addTiles('https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/2004-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg', 'NASA Blue Marble / GIBS', 8);
addTiles('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 'Esri World Imagery and imagery contributors', 19, 6);
C.Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_ACCESS_TOKEN;
C.createWorldTerrainAsync().then(terrain => { viewer.terrainProvider = terrain; }).catch(() => {});

const descriptions = {
  Earth: 'The Blue Marble mosaic shows Earth at planetary scale. Zoom in to explore satellite imagery.',
  'Aqua satellite': 'NASA’s Aqua spacecraft observes the water cycle, including clouds, precipitation and sea ice.',
  'Hubble Space Telescope': 'Hubble observes the universe above Earth’s atmosphere with a 2.4-meter primary mirror.',
  Moon: 'Earth’s natural satellite preserves a record of impacts in its cratered highlands.',
  Mars: 'Iron oxides give the Martian surface its rusty color.',
  Jupiter: 'Belts of clouds stretch around the largest planet in our solar system.',
  Sun: 'Our nearest star supplies the light that illuminates the planets.',
  Sirius: 'The brightest star in Earth’s night sky belongs to a binary system.',
  Vega: 'Vega is a bright blue-white star in Lyra.',
  Arcturus: 'Arcturus is an orange giant in Boötes.'
};

function satellite(name, file, phase, inclination, ascendingNode, altitude) {
  const radius = 6378137 + altitude;
  const rate = Math.sqrt(3.986004418e14 / radius ** 3);
  const position = new C.CallbackPositionProperty((time, result) => {
    const elapsed = C.JulianDate.secondsDifference(time, start);
    const angle = phase + elapsed * rate;
    const node = ascendingNode - elapsed * 0.000072921;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle) * Math.cos(inclination);
    return C.Cartesian3.fromElements(x*Math.cos(node)-y*Math.sin(node), x*Math.sin(node)+y*Math.cos(node), radius*Math.sin(angle)*Math.sin(inclination), result);
  }, false);
  viewer.entities.add({ name, position, orientation: new C.VelocityOrientationProperty(position),
    model: { uri: '/models/' + file + '.glb', minimumPixelSize: 66, shadows: C.ShadowMode.ENABLED } });
}
satellite('Aqua satellite', 'aqua', 0.71, 1.71, -1.41, 705000);
satellite('Hubble Space Telescope', 'hubble', -0.63, 0.50, 0.85, 535000);

// Compose distant objects in the initial camera frame, using compressed distances.
function backdropPosition(horizontal, vertical, depth) {
  const p = C.Cartesian3.multiplyByScalar(camera.directionWC, depth, new C.Cartesian3());
  C.Cartesian3.add(p, C.Cartesian3.multiplyByScalar(camera.rightWC, horizontal, new C.Cartesian3()), p);
  return C.Cartesian3.add(p, C.Cartesian3.multiplyByScalar(camera.upWC, vertical, new C.Cartesian3()), p);
}
scene.moon.show = false;
for (const [name, x, y, depth, radius] of [
  ['Moon', 19000000, 11000000, 30000000, 1740000],
  ['Jupiter', -31000000, 17500000, 68000000, 2300000],
  ['Mars', 38000000, -16000000, 80000000, 1100000]
]) {
  viewer.entities.add({ name, position: backdropPosition(x,y,depth),
    ellipsoid: { radii: new C.Cartesian3(radius,radius,radius), material: '/textures/' + name.toLowerCase() + '.jpg' } });
}
for (const [name,x,y] of [['Sirius',-34,-14],['Vega',5,26],['Arcturus',38,9]]) {
  viewer.entities.add({ name, position: backdropPosition(x*1e6,y*1e6,1e8),
    point: { pixelSize: 4, color: C.Color.fromCssColorString(name === 'Arcturus' ? '#d6b399' : '#c9d6eb') } });
}
const panel = document.createElement('aside');
panel.hidden = true;
panel.innerHTML = '<button aria-label="Close details">×</button><h2></h2><p></p><section aria-live="polite"></section>';
document.body.append(panel);
let selection = 0;
function close() { panel.hidden = true; selection++; }
panel.querySelector('button').onclick = close;
window.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
async function inspect(name) {
  const request = ++selection;
  panel.hidden = false;
  panel.querySelector('h2').textContent = name;
  panel.querySelector('p').textContent = descriptions[name];
  const details = panel.querySelector('section');
  details.textContent = 'Searching for images and sources…';
  try {
    const response = await fetch('/api/object?name=' + encodeURIComponent(name));
    if (!response.ok) throw new Error();
    const { article, photos } = await response.json();
    if (request !== selection) return;
    details.replaceChildren();
    if (article) {
      const link = document.createElement('a');
      link.href = article.link; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = article.snippet; details.append(link);
    }
    const gallery = document.createElement('div');
    for (const photo of photos) {
      const link = document.createElement('a');
      link.href = photo.link; link.target = '_blank'; link.rel = 'noopener noreferrer';
      const img = new Image(); img.src = photo.thumbnail; img.alt = photo.title;
      link.append(img); gallery.append(link);
    }
    details.append(gallery);
  } catch { if (request === selection) details.textContent = 'Live search is unavailable.'; }
}
viewer.screenSpaceEventHandler.setInputAction(({position}) => {
  const hit = scene.pick(position, 9, 9);
  if (hit?.id?.name && Object.hasOwn(descriptions, hit.id.name)) return inspect(hit.id.name);
  if (camera.pickEllipsoid(position)) return inspect('Earth');
  const sun = C.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(viewer.clock.currentTime);
  const rotation = C.Transforms.computeIcrfToFixedMatrix(viewer.clock.currentTime);
  if (rotation) {
    const screen = scene.cartesianToCanvasCoordinates(C.Matrix3.multiplyByVector(rotation,sun,sun));
    if (screen && C.Cartesian2.distance(screen,position) < 20) return inspect('Sun');
  }
  close();
}, C.ScreenSpaceEventType.LEFT_CLICK);

