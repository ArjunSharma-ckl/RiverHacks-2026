import * as C from 'cesium';
import { STARS, geocentric, normalize, directionFromRaDec } from './ephemeris.js';
import { bandedTexture, crateredTexture, ringTexture } from './textures.js';

const DEG = Math.PI / 180;
const STAR_DISTANCE = 3.6e8;

// Distances are compressed and radii exaggerated so the bodies read on screen;
// the *direction* to each one is the true geocentric direction for the clock
// time, computed from JPL's approximate Keplerian elements.
const PLANETS = [
  {
    name: 'Mercury', distance: 1.30e8, radius: 5.2e5, spinHours: 1407.6, tilt: 0.03,
    texture: () => crateredTexture({ base: '#8d8679', shades: ['#6f6a60', '#a39b8c', '#574f46'], seed: 11 })
  },
  {
    name: 'Venus', distance: 1.46e8, radius: 9.2e5, spinHours: -5832.5, tilt: 177.4,
    texture: () => bandedTexture({
      seed: 5, strength: 0.1,
      bands: [[0, '#cfa559'], [0.25, '#efd39a'], [0.5, '#f7e6bd'], [0.75, '#e8c489'], [1, '#c2954f']]
    })
  },
  { name: 'Mars', distance: 1.70e8, radius: 8.2e5, spinHours: 24.62, tilt: 25.2, image: '/textures/mars.jpg' },
  { name: 'Jupiter', distance: 2.00e8, radius: 1.95e6, spinHours: 9.93, tilt: 3.1, image: '/textures/jupiter.jpg' },
  {
    name: 'Saturn', distance: 2.22e8, radius: 1.75e6, spinHours: 10.56, tilt: 26.7, ring: [1.3, 2.3],
    texture: () => bandedTexture({
      seed: 9, strength: 0.05,
      bands: [[0, '#b99a62'], [0.22, '#e2cb98'], [0.46, '#f4e6c0'], [0.72, '#ddc38d'], [1, '#ab8c58']]
    })
  }
];

const LABELLED_STARS = new Set(
  STARS.filter((star) => star.mag <= 1.0 || star.name === 'Polaris').map((star) => star.name)
);

function texturedSphere(radius) {
  return new C.EllipsoidGeometry({
    radii: new C.Cartesian3(radius, radius, radius),
    stackPartitions: 48,
    slicePartitions: 64,
    vertexFormat: C.MaterialAppearance.MaterialSupport.TEXTURED.vertexFormat
  });
}

// A flat annulus in the XY plane. The texture's vertical axis runs across the
// ring's width so the gaps fall at the right radii.
function ringGeometry(inner, outer, segments = 192) {
  const positions = [];
  const normals = [];
  const sts = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    positions.push(inner * cos, inner * sin, 0, outer * cos, outer * sin, 0);
    normals.push(0, 0, 1, 0, 0, 1);
    sts.push(i / segments, 0, i / segments, 1);
  }
  for (let i = 0; i < segments; i++) {
    const base = i * 2;
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  return new C.Geometry({
    attributes: {
      position: new C.GeometryAttribute({
        componentDatatype: C.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values: new Float64Array(positions)
      }),
      normal: new C.GeometryAttribute({
        componentDatatype: C.ComponentDatatype.FLOAT,
        componentsPerAttribute: 3,
        values: new Float32Array(normals)
      }),
      st: new C.GeometryAttribute({
        componentDatatype: C.ComponentDatatype.FLOAT,
        componentsPerAttribute: 2,
        values: new Float32Array(sts)
      })
    },
    indices: new Uint16Array(indices),
    primitiveType: C.PrimitiveType.TRIANGLES,
    boundingSphere: C.BoundingSphere.fromVertices(positions)
  });
}

function imagePrimitive(geometry, image, id, translucent) {
  return new C.Primitive({
    geometryInstances: new C.GeometryInstance({ geometry, id }),
    appearance: new C.MaterialAppearance({
      material: C.Material.fromType('Image', { image }),
      materialSupport: C.MaterialAppearance.MaterialSupport.TEXTURED,
      translucent,
      closed: !translucent,
      faceForward: translucent
    }),
    asynchronous: false,
    modelMatrix: C.Matrix4.clone(C.Matrix4.IDENTITY)
  });
}

export function createSky(viewer) {
  const { scene } = viewer;
  let icrfToFixed;

  const bodies = PLANETS.map((config) => {
    const image = config.image ?? config.texture();
    const primitive = imagePrimitive(texturedSphere(config.radius), image, config.name, false);
    scene.primitives.add(primitive);

    let ring;
    if (config.ring) {
      try {
        ring = imagePrimitive(
          ringGeometry(config.radius * config.ring[0], config.radius * config.ring[1]),
          ringTexture(),
          config.name,
          true
        );
        scene.primitives.add(ring);
      } catch {
        ring = undefined;
      }
    }
    return { config, primitive, ring };
  });

  const starEntities = STARS.map((star) => {
    const direction = directionFromRaDec(star.ra, star.dec);
    const inertial = new C.Cartesian3(
      direction.x * STAR_DISTANCE,
      direction.y * STAR_DISTANCE,
      direction.z * STAR_DISTANCE
    );
    const position = new C.CallbackPositionProperty((time, result) => {
      const target = C.Cartesian3.clone(inertial, result ?? new C.Cartesian3());
      return icrfToFixed ? C.Matrix3.multiplyByVector(icrfToFixed, target, target) : target;
    }, false);

    const entity = viewer.entities.add({
      name: star.name,
      position,
      point: {
        pixelSize: Math.max(2.2, 7.4 - 1.55 * star.mag),
        color: C.Color.fromCssColorString(star.color)
      }
    });
    if (LABELLED_STARS.has(star.name)) {
      entity.label = new C.LabelGraphics({
        text: star.name,
        font: '500 11px ui-monospace, SFMono-Regular, Menlo, monospace',
        fillColor: C.Color.fromCssColorString('#9fb4cc'),
        pixelOffset: new C.Cartesian2(10, -2),
        horizontalOrigin: C.HorizontalOrigin.LEFT,
        verticalOrigin: C.VerticalOrigin.CENTER,
        show: true
      });
    }
    return entity;
  });

  const scratchPosition = new C.Cartesian3();
  const scratchTilt = new C.Matrix3();
  const scratchSpin = new C.Matrix3();
  const scratchRotation = new C.Matrix3();
  const scratchMatrix = new C.Matrix4();

  scene.preUpdate.addEventListener(() => {
    const time = viewer.clock.currentTime;
    icrfToFixed = C.Transforms.computeIcrfToFixedMatrix(time, scratchRotation) ? scratchRotation : undefined;
    const julianDay = C.JulianDate.totalDays(time);
    const seconds = (julianDay - 2451545) * 86400;

    for (const body of bodies) {
      const { config, primitive, ring } = body;
      const direction = normalize(geocentric(config.name, julianDay));
      C.Cartesian3.fromElements(
        direction.x * config.distance,
        direction.y * config.distance,
        direction.z * config.distance,
        scratchPosition
      );
      if (icrfToFixed) C.Matrix3.multiplyByVector(icrfToFixed, scratchPosition, scratchPosition);

      C.Matrix3.fromRotationX(config.tilt * DEG, scratchTilt);
      const spin = (seconds / (config.spinHours * 3600)) * Math.PI * 2;
      C.Matrix3.fromRotationZ(spin % (Math.PI * 2), scratchSpin);
      primitive.modelMatrix = C.Matrix4.fromRotationTranslation(
        C.Matrix3.multiply(scratchTilt, scratchSpin, new C.Matrix3()),
        scratchPosition,
        new C.Matrix4()
      );
      if (ring) {
        ring.modelMatrix = C.Matrix4.fromRotationTranslation(scratchTilt, scratchPosition, scratchMatrix.clone());
      }
    }
  });

  // The Sun and Moon are drawn by Cesium itself, so they are picked by
  // projecting their real positions to the screen instead.
  function screenTargets(time) {
    const rotation = C.Transforms.computeIcrfToFixedMatrix(time, new C.Matrix3());
    if (!rotation) return [];
    const sun = C.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(time);
    const moon = C.Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(time);
    return [
      { name: 'Sun', position: C.Matrix3.multiplyByVector(rotation, sun, new C.Cartesian3()) },
      { name: 'Moon', position: C.Matrix3.multiplyByVector(rotation, moon, new C.Cartesian3()) }
    ];
  }

  return {
    screenTargets,
    setStarLabels(show) {
      for (const entity of starEntities) {
        if (entity.label) entity.label.show = show;
      }
    },
    setPlanets(show) {
      for (const body of bodies) {
        body.primitive.show = show;
        if (body.ring) body.ring.show = show;
      }
    },
    setStars(show) {
      for (const entity of starEntities) entity.show = show;
    }
  };
}
