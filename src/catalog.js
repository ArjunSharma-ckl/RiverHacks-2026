// Names and copy shared between the browser app and the API server.
// Must stay free of browser and Cesium dependencies.
import { STARS, PLANET_NAMES } from './ephemeris.js';

export const SATELLITE_NAMES = [
  'Aqua satellite', 'Terra', 'Suomi NPP', 'GPM Core Observatory',
  'Landsat 9', 'Hubble Space Telescope', 'ISS (Zarya)'
];

export const DESCRIPTIONS = {
  Earth: 'Imagery is streamed live from NASA’s Global Imagery Browse Services. Turn on the weather layers to see the atmosphere as it is right now, then zoom in for metre-scale detail.',
  Sun: 'Our nearest star supplies the light that illuminates every other body in this view. Its position here is computed from real ephemerides, so the terminator on Earth below is the true day/night line.',
  Moon: 'Earth’s natural satellite, drawn at its real distance and orientation — the phase you see is the phase happening right now.',
  Mercury: 'The smallest planet and the closest to the Sun, airless and cratered, with surface temperatures swinging by hundreds of degrees between day and night.',
  Venus: 'Wrapped in a dense carbon-dioxide atmosphere that traps heat, Venus is the hottest planet in the solar system despite being further from the Sun than Mercury.',
  Mars: 'Iron oxides give the Martian surface its rusty colour. Its thin atmosphere, water ice and lava tubes make it the leading candidate for a permanent human outpost beyond the Moon.',
  Jupiter: 'Belts of ammonia cloud stretch around the largest planet in our solar system, driven by winds that have blown for centuries.',
  Saturn: 'A gas giant circled by a ring system of water ice, spanning tens of thousands of kilometres yet only metres thick.',
  'Aqua satellite': 'NASA’s Aqua spacecraft observes the water cycle — clouds, precipitation, water vapour and sea ice. Its MODIS instrument feeds several of the imagery layers in this view.',
  Terra: 'Terra flies the morning half of NASA’s flagship Earth-observing pair, carrying MODIS, ASTER and CERES for land, cloud and energy-budget measurements.',
  'Suomi NPP': 'Suomi NPP carries VIIRS, the instrument behind the true-colour and night-lights imagery draped over the globe here.',
  'GPM Core Observatory': 'The Global Precipitation Measurement core satellite anchors the constellation behind IMERG, the half-hourly precipitation layer in this view.',
  'Landsat 9': 'Landsat 9 continues a land-imaging record that reaches back to 1972, at 30-metre resolution.',
  'Hubble Space Telescope': 'Hubble observes the universe above Earth’s atmosphere with a 2.4-metre primary mirror.',
  'ISS (Zarya)': 'The International Space Station orbits roughly 420 km up, circling Earth about every 93 minutes.',
  Sirius: 'The brightest star in Earth’s night sky, and a binary: a white main-sequence star with a white-dwarf companion.',
  Vega: 'A bright blue-white star in Lyra, long used as a reference point for the magnitude scale.',
  Arcturus: 'An orange giant in Boötes and the brightest star in the northern celestial hemisphere.',
  Polaris: 'The north celestial pole sits within a degree of Polaris, which is why it barely moves as Earth turns.',
  Betelgeuse: 'A red supergiant in Orion, large enough that it would swallow the inner solar system if placed at the Sun.'
};

export const SUBJECTS = new Set([
  ...Object.keys(DESCRIPTIONS),
  ...PLANET_NAMES,
  ...SATELLITE_NAMES,
  ...STARS.map((star) => star.name)
]);

const STAR_BY_NAME = new Map(STARS.map((star) => [star.name, star]));

export function describe(name) {
  if (DESCRIPTIONS[name]) return DESCRIPTIONS[name];
  const star = STAR_BY_NAME.get(name);
  if (star) {
    const hours = star.ra / 15;
    return `Apparent magnitude ${star.mag.toFixed(2)}. Catalogue position (J2000) right ascension ${hours.toFixed(2)}h, declination ${star.dec.toFixed(1)}° — the marker is placed on the real sky position, so it sits on the star itself in the background star field.`;
  }
  return '';
}
