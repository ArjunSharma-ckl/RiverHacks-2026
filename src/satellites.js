import * as C from 'cesium';

const EARTH_RADIUS = 6378137;
const MU = 3.986004418e14;
const EARTH_ROTATION_RATE = 7.2921159e-5;
const EPOCH = C.JulianDate.fromIso8601('2026-01-01T00:00:00Z');
const DEG = Math.PI / 180;

// Real altitudes and inclinations; the in-plane phase and ascending node are
// chosen for a readable spread rather than taken from current TLEs.
const FLEET = [
  { name: 'Aqua satellite', model: 'aqua', altitude: 705000, inclination: 98.2, node: -80, phase: 40, color: '#7fd4ff' },
  { name: 'Terra', model: 'terra', altitude: 705000, inclination: 98.2, node: 25, phase: 200, color: '#7fd4ff' },
  { name: 'Suomi NPP', model: 'suomi', altitude: 824000, inclination: 98.7, node: -150, phase: 120, color: '#9affd1' },
  { name: 'GPM Core Observatory', model: 'gpm', altitude: 407000, inclination: 65, node: 60, phase: 300, color: '#ffd27f' },
  { name: 'Landsat 9', model: 'landsat', altitude: 705000, inclination: 98.2, node: 100, phase: 80, color: '#c9b8ff' },
  { name: 'Hubble Space Telescope', model: 'hubble', altitude: 535000, inclination: 28.5, node: 48, phase: -36, color: '#f2f6ff' },
  { name: 'ISS (Zarya)', model: 'iss', altitude: 420000, inclination: 51.64, node: -20, phase: 160, color: '#ff9f7f' }
];

function orbitPosition(config) {
  const radius = EARTH_RADIUS + config.altitude;
  const meanMotion = Math.sqrt(MU / radius ** 3);
  const inclination = config.inclination * DEG;
  const phase = config.phase * DEG;
  const node0 = config.node * DEG;
  return new C.CallbackPositionProperty((time, result) => {
    const elapsed = C.JulianDate.secondsDifference(time, EPOCH);
    const angle = phase + elapsed * meanMotion;
    // Converting the inertial orbit into the earth-fixed frame.
    const node = node0 - elapsed * EARTH_ROTATION_RATE;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle) * Math.cos(inclination);
    const z = radius * Math.sin(angle) * Math.sin(inclination);
    return C.Cartesian3.fromElements(
      x * Math.cos(node) - y * Math.sin(node),
      x * Math.sin(node) + y * Math.cos(node),
      z,
      result ?? new C.Cartesian3()
    );
  }, false);
}

export function createSatellites(viewer) {
  const entities = FLEET.map((config) => {
    const position = orbitPosition(config);
    const color = C.Color.fromCssColorString(config.color);
    const entity = viewer.entities.add({
      name: config.name,
      position,
      orientation: new C.VelocityOrientationProperty(position),
      viewFrom: new C.Cartesian3(-90, -140, 70),
      point: {
        pixelSize: 4, color: color.withAlpha(0.82),
        distanceDisplayCondition: new C.DistanceDisplayCondition(2501, Infinity)
      },
      model: {
        uri: '/models/' + config.model + '.glb',
        minimumPixelSize: 18, shadows: C.ShadowMode.ENABLED,
        distanceDisplayCondition: new C.DistanceDisplayCondition(0, 2501)
      },
      label: {
        distanceDisplayCondition: new C.DistanceDisplayCondition(0, 2500),
        text: `${config.name}  ${Math.round(config.altitude / 1000)} km`,
        font: '500 11px ui-monospace, SFMono-Regular, Menlo, monospace',
        fillColor: color,
        pixelOffset: new C.Cartesian2(14, 0),
        horizontalOrigin: C.HorizontalOrigin.LEFT,
        verticalOrigin: C.VerticalOrigin.CENTER,
        showBackground: true,
        backgroundColor: C.Color.fromCssColorString('#05080fcc'),
        backgroundPadding: new C.Cartesian2(6, 4)
      }
    });

    return entity;
  });

  return {
    entities,
    visible: true,
    track(entity) {
      viewer.trackedEntity = entity;
      if (!entity) viewer.camera.flyHome(0.8);
    },
    setLabels(show) {
      for (const entity of entities) entity.label.show = show;
    },
    setFleet(show) {
      this.visible = show;
      if (!show && viewer.trackedEntity) this.track(undefined);
      for (const entity of entities) entity.show = show;
    }
  };
}
