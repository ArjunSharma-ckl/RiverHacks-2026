// Pure-math sky positions. No Cesium, no browser APIs, so this module can be
// unit-tested in Node and imported by the dev/production API server.

const DEG = Math.PI / 180;
export const AU = 149597870700;
const OBLIQUITY = 23.43928 * DEG;

// Approximate Keplerian elements referred to the J2000 ecliptic, from JPL's
// "Keplerian Elements for Approximate Positions of the Major Planets"
// (Standish), valid 1800-2050. Each pair is [value at J2000, rate per century].
// a in AU, angles in degrees.
const ELEMENTS = {
  Mercury: { a: [0.38709927, 0.00000037], e: [0.20563593, 0.00001906], i: [7.00497902, -0.00594749], l: [252.25032350, 149472.67411175], peri: [77.45779628, 0.16047689], node: [48.33076593, -0.12534081] },
  Venus: { a: [0.72333566, 0.00000390], e: [0.00677672, -0.00004107], i: [3.39467605, -0.00078890], l: [181.97909950, 58517.81538729], peri: [131.60246718, 0.00268329], node: [76.67984255, -0.27769418] },
  Earth: { a: [1.00000261, 0.00000562], e: [0.01671123, -0.00004392], i: [-0.00001531, -0.01294668], l: [100.46457166, 35999.37244981], peri: [102.93768193, 0.32327364], node: [0, 0] },
  Mars: { a: [1.52371034, 0.00001847], e: [0.09339410, 0.00007882], i: [1.84969142, -0.00813131], l: [-4.55343205, 19140.30268499], peri: [-23.94362959, 0.44441088], node: [49.55953891, -0.29257343] },
  Jupiter: { a: [5.20288700, -0.00011607], e: [0.04838624, -0.00013253], i: [1.30439695, -0.00183714], l: [34.39644051, 3034.74612775], peri: [14.72847983, 0.21252668], node: [100.47390909, 0.20469106] },
  Saturn: { a: [9.53667594, -0.00125060], e: [0.05386179, -0.00050991], i: [2.48599187, 0.00193609], l: [49.95424423, 1222.49362201], peri: [92.59887831, -0.41897216], node: [113.66242448, -0.28867794] }
};

export const PLANET_NAMES = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];

export function julianDayFromDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

function wrapDegrees(value) {
  const d = value % 360;
  return d < 0 ? d + 360 : d;
}

function solveKepler(meanAnomaly, eccentricity) {
  let E = meanAnomaly;
  for (let step = 0; step < 24; step++) {
    const delta = (E - eccentricity * Math.sin(E) - meanAnomaly) / (1 - eccentricity * Math.cos(E));
    E -= delta;
    if (Math.abs(delta) < 1e-13) break;
  }
  return E;
}

// Heliocentric position in the J2000 ecliptic frame, in AU.
function heliocentricEcliptic(name, centuries) {
  const el = ELEMENTS[name];
  const a = el.a[0] + el.a[1] * centuries;
  const e = el.e[0] + el.e[1] * centuries;
  const i = (el.i[0] + el.i[1] * centuries) * DEG;
  const node = (el.node[0] + el.node[1] * centuries) * DEG;
  const longitudeOfPerihelion = el.peri[0] + el.peri[1] * centuries;
  const argument = longitudeOfPerihelion * DEG - node;
  const meanLongitude = el.l[0] + el.l[1] * centuries;
  let mean = wrapDegrees(meanLongitude - longitudeOfPerihelion);
  if (mean > 180) mean -= 360;
  const E = solveKepler(mean * DEG, e);

  // In the orbital plane, then rotated by argument of perihelion, inclination
  // and longitude of ascending node.
  const xo = a * (Math.cos(E) - e);
  const yo = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(argument), sw = Math.sin(argument);
  const cn = Math.cos(node), sn = Math.sin(node);
  const ci = Math.cos(i), si = Math.sin(i);
  return {
    x: (cw * cn - sw * sn * ci) * xo + (-sw * cn - cw * sn * ci) * yo,
    y: (cw * sn + sw * cn * ci) * xo + (-sw * sn + cw * cn * ci) * yo,
    z: sw * si * xo + cw * si * yo
  };
}

function eclipticToEquatorial(v) {
  const c = Math.cos(OBLIQUITY), s = Math.sin(OBLIQUITY);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}

// Geocentric position in the J2000 equatorial frame (aligned with ICRF), in AU.
export function geocentric(name, julianDay) {
  const centuries = (julianDay - 2451545.0) / 36525;
  const planet = heliocentricEcliptic(name, centuries);
  const earth = heliocentricEcliptic('Earth', centuries);
  return eclipticToEquatorial({ x: planet.x - earth.x, y: planet.y - earth.y, z: planet.z - earth.z });
}

// Geocentric direction to the Sun, J2000 equatorial, in AU.
export function sunGeocentric(julianDay) {
  const centuries = (julianDay - 2451545.0) / 36525;
  const earth = heliocentricEcliptic('Earth', centuries);
  return eclipticToEquatorial({ x: -earth.x, y: -earth.y, z: -earth.z });
}

export function normalize(v) {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

export function distanceAu(v) {
  return Math.hypot(v.x, v.y, v.z);
}

// Right ascension in hours and declination in degrees, for readouts.
export function toRaDec(v) {
  const ra = Math.atan2(v.y, v.x) / DEG;
  return {
    rightAscension: wrapDegrees(ra) / 15,
    declination: Math.asin(normalize(v).z) / DEG
  };
}

// Unit vector in the J2000 equatorial frame for a catalogue position.
export function directionFromRaDec(raDegrees, decDegrees) {
  const ra = raDegrees * DEG, dec = decDegrees * DEG;
  return { x: Math.cos(dec) * Math.cos(ra), y: Math.cos(dec) * Math.sin(ra), z: Math.sin(dec) };
}

// The brightest stars, with J2000 positions in degrees, visual magnitude and an
// approximate colour for the spectral class.
export const STARS = [
  { name: 'Sirius', ra: 101.2871, dec: -16.7161, mag: -1.46, color: '#dce9ff' },
  { name: 'Canopus', ra: 95.9879, dec: -52.6956, mag: -0.74, color: '#f3f2ee' },
  { name: 'Arcturus', ra: 213.9154, dec: 19.1825, mag: -0.05, color: '#ffcf9a' },
  { name: 'Vega', ra: 279.2346, dec: 38.7836, mag: 0.03, color: '#d7e6ff' },
  { name: 'Capella', ra: 79.1725, dec: 45.9981, mag: 0.08, color: '#fff3dc' },
  { name: 'Rigel', ra: 78.6346, dec: -8.2017, mag: 0.13, color: '#c3d6ff' },
  { name: 'Procyon', ra: 114.8254, dec: 5.225, mag: 0.34, color: '#f9f5ec' },
  { name: 'Achernar', ra: 24.4283, dec: -57.2367, mag: 0.46, color: '#c6d8ff' },
  { name: 'Betelgeuse', ra: 88.7929, dec: 7.4069, mag: 0.5, color: '#ffae84' },
  { name: 'Hadar', ra: 210.9558, dec: -60.3731, mag: 0.61, color: '#bcd2ff' },
  { name: 'Altair', ra: 297.6958, dec: 8.8683, mag: 0.77, color: '#eef2ff' },
  { name: 'Acrux', ra: 186.6496, dec: -63.0992, mag: 0.77, color: '#bcd2ff' },
  { name: 'Aldebaran', ra: 68.98, dec: 16.5092, mag: 0.85, color: '#ffc489' },
  { name: 'Spica', ra: 201.2983, dec: -11.1614, mag: 0.98, color: '#bfd4ff' },
  { name: 'Antares', ra: 247.3517, dec: -26.4319, mag: 1.09, color: '#ffa97d' },
  { name: 'Pollux', ra: 116.3288, dec: 28.0261, mag: 1.14, color: '#ffd6a3' },
  { name: 'Fomalhaut', ra: 344.4125, dec: -29.6222, mag: 1.16, color: '#e4edff' },
  { name: 'Deneb', ra: 310.3579, dec: 45.2803, mag: 1.25, color: '#e8eeff' },
  { name: 'Mimosa', ra: 191.9304, dec: -59.6886, mag: 1.25, color: '#bcd2ff' },
  { name: 'Regulus', ra: 152.0929, dec: 11.9672, mag: 1.35, color: '#cadbff' },
  { name: 'Adhara', ra: 104.6563, dec: -28.9722, mag: 1.5, color: '#c0d4ff' },
  { name: 'Castor', ra: 113.65, dec: 31.8883, mag: 1.58, color: '#dce9ff' },
  { name: 'Shaula', ra: 263.4021, dec: -37.1039, mag: 1.62, color: '#c0d4ff' },
  { name: 'Bellatrix', ra: 81.2829, dec: 6.3497, mag: 1.64, color: '#c0d4ff' },
  { name: 'Elnath', ra: 81.5729, dec: 28.6075, mag: 1.65, color: '#cadbff' },
  { name: 'Alnilam', ra: 84.0533, dec: -1.2019, mag: 1.69, color: '#bcd2ff' },
  { name: 'Alnitak', ra: 85.1896, dec: -1.9428, mag: 1.74, color: '#b8d0ff' },
  { name: 'Mizar', ra: 200.9813, dec: 54.9253, mag: 1.77, color: '#dce9ff' },
  { name: 'Dubhe', ra: 165.9321, dec: 61.7508, mag: 1.79, color: '#ffd6a3' },
  { name: 'Polaris', ra: 37.9546, dec: 89.2642, mag: 1.98, color: '#fdf6ea' }
];
