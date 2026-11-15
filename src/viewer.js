import * as C from 'cesium';
import { gibsWms } from './gibs.js';
import { setLayer } from './layers.js';

const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_ACCESS_TOKEN;

export function createViewer(container) {
  if (ION_TOKEN) C.Ion.defaultAccessToken = ION_TOKEN;

  const viewer = new C.Viewer(container, {
    // A bundled single tile means the globe is never bare, even offline.
    baseLayer: C.ImageryLayer.fromProviderAsync(
      C.SingleTileImageryProvider.fromUrl('/textures/earth.jpg', { credit: new C.Credit('Earth basemap', true) }),
      { brightness: 0.9, saturation: 0.9 }
    ),
    creditContainer: document.getElementById('map-credits') ?? undefined,
    timeline: false, animation: false, fullscreenButton: false, homeButton: false,
    geocoder: false, sceneModePicker: false, navigationHelpButton: false,
    baseLayerPicker: false, infoBox: false, selectionIndicator: false,
    shouldAnimate: true, shadows: false,
    contextOptions: { webgl: { powerPreference: 'high-performance' } }
  });

  const { scene, camera, clock } = viewer;

  // Globe: true solar lighting, a scattering-based atmosphere and a black base
  // so nothing blue bleeds through gaps in the imagery.
  scene.globe.showWaterEffect = false;
  scene.globe.enableLighting = container !== 'cesiumContainer';
  scene.globe.dynamicAtmosphereLighting = true;
  scene.globe.dynamicAtmosphereLightingFromSun = false;
  scene.globe.showGroundAtmosphere = true;
  scene.globe.atmosphereLightIntensity = 14;
  scene.globe.baseColor = C.Color.fromCssColorString('#04070d');
  scene.globe.depthTestAgainstTerrain = true;
  scene.globe.maximumScreenSpaceError = 3;
  scene.globe.tileCacheSize = 220;

  scene.skyAtmosphere.perFragmentAtmosphere = true;
  scene.skyAtmosphere.atmosphereLightIntensity = 62;
  scene.skyAtmosphere.saturationShift = 0.08;
  scene.skyAtmosphere.brightnessShift = 0.04;

  scene.sun.glowFactor = 2.6;
  scene.moon = new C.Moon({ textureUrl: '/textures/moon.jpg', onlySunLighting: true });
  scene.fog.enabled = true;

  // Tone mapping plus bloom is what makes the sun read as a light source
  // rather than a white circle.
  scene.highDynamicRange = true;
  scene.msaaSamples = 1;
  scene.postProcessStages.fxaa.enabled = true;
  const bloom = scene.postProcessStages.bloom;
  bloom.enabled = false;
  bloom.uniforms.glowOnly = false;
  bloom.uniforms.contrast = 94;
  bloom.uniforms.brightness = -0.26;
  bloom.uniforms.delta = 1.2;
  bloom.uniforms.sigma = 3.1;
  bloom.uniforms.stepSize = 1;

  let lensFlare;
  try {
    lensFlare = C.PostProcessStageLibrary.createLensFlareStage();
    scene.postProcessStages.add(lensFlare);
    lensFlare.enabled = false;
    lensFlare.uniforms.intensity = 0.9;
    lensFlare.uniforms.distortion = 4.0;
    lensFlare.uniforms.dirtAmount = 0.05;
  } catch {
    lensFlare = undefined;
  }

  scene.shadowMap.darkness = 0.45;
  scene.shadowMap.size = 2048;
  viewer.targetFrameRate = 30;
  viewer.resolutionScale = 1;

  // Keeping the far clip plane in reach of the backdrop bodies, and stopping
  // the camera before it flies past them.
  scene.screenSpaceCameraController.maximumZoomDistance = 7.5e7;
  scene.screenSpaceCameraController.minimumZoomDistance = 160;
  scene.screenSpaceCameraController.zoomFactor = 7.5;

  clock.currentTime = C.JulianDate.now();
  clock.clockStep = C.ClockStep.SYSTEM_CLOCK_MULTIPLIER;
  clock.multiplier = 1;
  clock.clockRange = C.ClockRange.UNBOUNDED;

  camera.setView({
    destination: C.Cartesian3.fromDegrees(-62, 18, 24000000),
    orientation: { heading: 0, pitch: -C.Math.PI_OVER_TWO, roll: 0 }
  });

  let terrainReady = Promise.resolve(viewer.terrainProvider);
  function loadTerrain() {
    const options = { requestWaterMask: false, requestVertexNormals: true };
    terrainReady = (ION_TOKEN ? C.createWorldTerrainAsync(options)
      : C.ArcGISTiledElevationTerrainProvider.fromUrl(
        'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer'
      ))
      .then((terrain) => {
        viewer.terrainProvider = terrain;
        return terrain;
      })
      .catch(() => viewer.terrainProvider);
  }

  if (container === 'cesiumContainer' && !ION_TOKEN) {
    // ArcGIS uses Mercator terrain. Keep the full ellipsoid at orbital and polar views.
    const ellipsoid = viewer.terrainProvider;
    const elevationCredit = new C.Credit('Esri World Elevation', true);
    const display = scene.frameState.creditDisplay;
    let detail;
    let requested = false;
    function updateTerrain() {
      const { height, latitude } = camera.positionCartographic;
      const nearSurface = height < 100000 && Math.abs(latitude) < C.Math.toRadians(80);
      if (nearSurface && !requested) {
        requested = true;
        loadTerrain();
        terrainReady.then(provider => { detail = provider; updateTerrain(); });
      }
      const terrain = nearSurface && detail ? detail : ellipsoid;
      if (viewer.terrainProvider !== terrain) viewer.terrainProvider = terrain;
      display.removeStaticCredit(elevationCredit);
      if (terrain !== ellipsoid) display.addStaticCredit(elevationCredit);
    }
    camera.moveEnd.addEventListener(updateTerrain);
  } else {
    loadTerrain();
  }
  return { viewer, scene, camera, lensFlare, terrainReady };
}

// Shaded-relief Blue Marble is the cleanest global basemap; Esri imagery takes
// over once you are close enough for it to matter.
export function addBaseImagery({ blueMarble = true } = {}) {
  if (blueMarble) setLayer('bluemarble', new C.ImageryLayer(
    gibsWms({
      layer: 'BlueMarble_ShadedRelief_Bathymetry',
      time: '2004-01-01',
      format: 'image/jpeg',
      transparent: false,
      maximumLevel: 8
    }),
    { brightness: 0.92, saturation: 0.88, contrast: 1.07, gamma: 1.04 }
  ));

  setLayer('esri', new C.ImageryLayer(
    new C.UrlTemplateImageryProvider({
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      credit: new C.Credit('Esri World Imagery and imagery contributors', true),
      maximumLevel: 19
    }),
    { minimumTerrainLevel: 6, brightness: 0.86, saturation: 0.78, contrast: 1.06 }
  ));
}


