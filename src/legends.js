// Colour keys for the imagery layers that render as a continuous field.
// Each entry mirrors the published product palette closely enough to read the
// map; the note spells out what the colours mean so a gradient never sits on
// screen without an explanation.
export const LAYER_LEGENDS = {
  'geocolor-east': {
    title: 'Cloud cover — GOES-East GeoColor',
    items: [
      ['Day: true colour', '#8ec5e8'],
      ['Night: infrared', '#3b4553'],
      ['City lights', '#ffe9a8']
    ],
    note: 'Cloud is white to grey; the night half is infrared with city lights, not visible light.'
  },
  'geocolor-west': {
    title: 'Cloud cover — GOES-West GeoColor',
    items: [
      ['Day: true colour', '#8ec5e8'],
      ['Night: infrared', '#3b4553'],
      ['City lights', '#ffe9a8']
    ],
    note: 'Pacific full disk. Cloud tops are white; thin cirrus reads translucent.'
  },
  precip: {
    title: 'Precipitation rate',
    unit: 'mm / hour',
    stops: ['#a9e9ff', '#4fa8ff', '#2f63ff', '#8a3bff', '#ff3fd0'],
    ticks: ['0.1', '1', '5', '10', '25+'],
    note: 'Transparent means no rain. Blue is light rain, violet and magenta are downpours.'
  },
  cloudtop: {
    title: 'Cloud-top temperature',
    unit: '°C',
    stops: ['#ffffff', '#cfdae4', '#8c99a6', '#4a5663', '#1b222b'],
    ticks: ['−80', '−55', '−30', '0', '25+'],
    note: 'Bright white tops are the coldest and tallest — deep convection and thunderstorm anvils.'
  },
  airmass: {
    title: 'Air mass — GOES RGB',
    items: [
      ['Moist air', '#1fae5c'],
      ['Dry air', '#d98b3a'],
      ['Cold air', '#3b6fd4'],
      ['Warm air', '#c4453b'],
      ['Jet stream', '#8f4fd8']
    ],
    note: 'A composite of water-vapour and infrared bands: it separates air masses, not cloud.'
  },
  sst: {
    title: 'Sea-surface temperature',
    unit: '°C',
    stops: ['#2b1a63', '#2f6fd0', '#2fbfa0', '#ffe066', '#ff6a3d', '#a0122a'],
    ticks: ['−2', '5', '15', '24', '30', '32+'],
    note: 'Daily 1 km analysis. Warm water above roughly 26 °C is the fuel for tropical cyclones.'
  },
  fires: {
    title: 'Thermal anomalies — VIIRS',
    items: [
      ['Active fire raster', '#ff8a3d'],
      ['Hot spot marker', '#ffd05c']
    ],
    note: 'The raster shows 375 m detections; the amber dots on the globe are the same fires as tracked events.'
  },
  aerosol: {
    title: 'Aerosol optical depth',
    unit: 'AOD',
    stops: ['#fff4c2', '#ffcf6b', '#e8792f', '#b3351f', '#5b1a12'],
    ticks: ['0', '1', '2', '3', '5+'],
    note: 'Thicker colour means more smoke, dust or haze between the satellite and the ground.'
  },
  snow: {
    title: 'Snow cover — NDSI',
    unit: 'index',
    stops: ['#0b1620', '#7fa8c9', '#cfe6ff', '#ffffff'],
    ticks: ['0', '40', '70', '100'],
    note: 'White is snow-covered ground; dark is snow-free. Cloud and snow can look alike.'
  },
  truecolor: {
    title: 'Daily true colour — VIIRS',
    items: [
      ['Vegetation', '#2f5d33'],
      ['Desert', '#c2a878'],
      ['Cloud', '#ffffff'],
      ['Ocean', '#123a5a'],
      ['Snow and ice', '#e8f2ff']
    ],
    note: 'Natural colour, no spectral index. Gaps are swath seams where the satellite did not pass.'
  }
};
