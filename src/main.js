import { createWorldTerrainAsync, ImageryLayer, Ion, TileMapServiceImageryProvider, Viewer } from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';

Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_ACCESS_TOKEN;

const viewer = new Viewer('cesiumContainer', {
  baseLayer: ImageryLayer.fromProviderAsync(
    TileMapServiceImageryProvider.fromUrl('/cesium/Assets/Textures/NaturalEarthII'),
  ),
});

try {
  viewer.terrainProvider = await createWorldTerrainAsync();
} catch {
  const status = document.createElement('div');
  status.className = 'terrain-status';
  status.textContent = 'World terrain unavailable. Check your Cesium ion token in .env.local.';
  status.setAttribute('role', 'status');
  document.body.append(status);
}

window.addEventListener('pagehide', () => viewer.destroy(), { once: true });
