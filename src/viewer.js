import * as C from 'cesium';
import { gibsWms } from './gibs.js';
import { setLayer } from './layers.js';

const ION_TOKEN = import.meta.env.VITE_CESIUM_ION_ACCESS_TOKEN;

export function createViewer(container) {
  if (ION_TOKEN) C.Ion.defaultAccessToken = ION_TOKEN;

  const viewer = new C.Viewer(container, {
    // A bundled single tile means the globe is never bare, even offline.
    baseLayer: C.ImageryLayer.fromProviderAsync(
      C.SingleTileImageryProvider.fromUrl('/textures/earth.jpg'),
      { brightness: 0.9, saturation: 0.9 }
    ),
    timeline: false, animation: false, fullscreenButton: false, homeButton: false,
    geocoder: false, sceneModePicker: false, navigationHelpButton: false,
    baseLayerPicker: false, infoBox: false, selectionIndicator: false,
    shouldAnimate: true, shadows: true,
    contextOptions: { webgl: { powerPreference: 'high-performance' } }
  });

  const { scene, camera, clock } = viewer;

  // Globe: true solar lighting, a scattering-based atmosphere and a black base
  // so nothing blue bleeds through gaps in the imagery.
  scene.globe.showWaterEffect = false;
  scene.globe.enableLighting = true;
  scene.globe.dynamicAtmosphereLighting = true;
  scene.globe.dynamicAtmosphereLightingFromSun = false;
  scene.globe.showGroundAtmosphere = true;
  scene.globe.atmosphereLightIntensity = 14;
  scene.globe.baseColor = C.Color.fromCssColorString('#04070d');
  scene.globe.depthTestAgainstTerrain = true;
  scene.globe.maximumScreenSpaceError = 1.25;

  scene.skyAtmosphere.perFragmentAtmosphere = true;
  scene.skyAtmosphere.atmosphereLightIntensity = 55;
  scene.skyAtmosphere.saturationShift = 0.08;
  scene.skyAtmosphere.brightnessShift = 0.04;

  scene.sun.glowFactor = 1.6;
  scene.moon = new C.Moon({ textureUrl: '/textures/moon.jpg', onlySunLighting: true });
  scene.fog.enabled = true;

  // Tone mapping plus bloom is what makes the sun read as a light source
  // rather than a white circle.
  scene.highDynamicRange = true;
  scene.msaaSamples = 4;
  scene.postProcessStages.fxaa.enabled = true;
  const bloom = scene.postProcessStages.bloom;
  bloom.enabled = true;
  bloom.uniforms.glowOnly = false;
  bloom.uniforms.contrast = 118;
  bloom.uniforms.brightness = -0.35;
  bloom.uniforms.delta = 1.2;
  bloom.uniforms.sigma = 2.4;
  bloom.uniforms.stepSize = 1;

  let lensFlare;
  try {
    lensFlare = C.PostProcessStageLibrary.createLensFlareStage();
    scene.postProcessStages.add(lensFlare);
    lensFlare.uniforms.intensity = 0.35;
    lensFlare.uniforms.distortion = 1.0;
    lensFlare.uniforms.dirtAmount = 0.01;
  } catch {
    lensFlare = undefined;
  }

  scene.shadowMap.darkness = 0.45;
  scene.shadowMap.size = 2048;
  viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2);

  // Keeping the far clip plane in reach of the backdrop bodies, and stopping
  // the camera before it flies past them.
  scene.screenSpaceCameraController.maximumZoomDistance = 7.5e7;
  scene.screenSpaceCameraController.minimumZoomDistance = 160;

  clock.currentTime = C.JulianDate.now();
  clock.clockStep = C.ClockStep.SYSTEM_CLOCK_MULTIPLIER;
  clock.multiplier = 1;
  clock.clockRange = C.ClockRange.UNBOUNDED;

  camera.setView({
    destination: C.Cartesian3.fromDegrees(-62, 18, 24000000),
    orientation: { heading: 0, pitch: -C.Math.PI_OVER_TWO + 0.22, roll: 0 }
  });

  {
    const options = { requestWaterMask: false, requestVertexNormals: true };
    const terrainReady = ION_TOKEN ? C.createWorldTerrainAsync(options)
      : C.IonResource.fromAssetId(1, { server: '/api/ion/', accessToken: '' })
        .then(resource => C.CesiumTerrainProvider.fromUrl(resource, options));
    terrainReady
      .then((terrain) => { viewer.terrainProvider = terrain; })
      .catch(() => {});
  }

  return { viewer, scene, camera, lensFlare };
}

// Shaded-relief Blue Marble is the cleanest global basemap; Esri imagery takes
// over once you are close enough for it to matter.
export function addBaseImagery() {
  setLayer('bluemarble', new C.ImageryLayer(
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
      url: '/api/arcgis/imagery/{z}/{y}/{x}',
      credit: 'Esri World Imagery and imagery contributors',
      maximumLevel: 19
    }),
    { minimumTerrainLevel: 6, brightness: 0.86, saturation: 0.78, contrast: 1.06 }
  ));
}


