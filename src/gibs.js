import * as C from 'cesium';

export const WMS_URL = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
export const WMTS_BASE = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
export const CREDIT = 'NASA EOSDIS GIBS';

// WMS avoids having to know each layer's tile-matrix set, and covers layers
// that are only published in the geographic projection.
export function gibsWms({ layer, time, format = 'image/png', transparent = true, maximumLevel = 7, credit = CREDIT }) {
  const parameters = { format, transparent: String(transparent) };
  if (time) parameters.time = time;
  return new C.WebMapServiceImageryProvider({
    url: WMS_URL,
    layers: layer,
    parameters,
    tileWidth: 256,
    tileHeight: 256,
    enablePickFeatures: false,
    tilingScheme: new C.GeographicTilingScheme(),
    maximumLevel,
    credit: new C.Credit(credit, true)
  });
}

// Pre-cached tiles, used for the layers whose matrix set is known.
export function gibsWmts({ layer, time, matrixSet, extension = 'jpeg', maximumLevel = 8 }) {
  return new C.UrlTemplateImageryProvider({
    url: `${WMTS_BASE}/${layer}/default/${time}/${matrixSet}/{z}/{y}/{x}.${extension}`,
    credit: CREDIT,
    maximumLevel
  });
}
