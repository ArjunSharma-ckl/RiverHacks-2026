import { CameraEventType, Cartesian3, Math as CesiumMath } from 'cesium';
import { loadEarthCatalog } from './terrain-data.js';
import { createTerrainPreview } from './terrain-preview.js';

const phases = [
  ['Recon', 'Map roughness and fissures with scout rovers and LiDAR. Test drone mapping and autonomous hazard avoidance.'],
  ['Subsurface', 'Plan ground-penetrating radar and seismic survey lines. Inspect candidate lava tubes with tethered probes.'],
  ['ISRU', 'Identify candidate ice sampling areas. Stage cryogenic drilling and closed-loop water extraction tests.'],
  ['EVA', 'Plan habitat access and egress. Test suit mobility, crew fatigue, and airlock operations.'],
];

export function mountMissionControls(viewer) {
  const cameraControls = viewer.scene.screenSpaceCameraController;
  cameraControls.zoomEventTypes = cameraControls.zoomEventTypes.filter(type => type !== CameraEventType.RIGHT_DRAG);
  cameraControls.tiltEventTypes = [...cameraControls.tiltEventTypes, CameraEventType.RIGHT_DRAG];

  const panel = document.querySelector('#mission');
  if (!panel) return;
  const phase = panel.querySelector('select');
  const description = panel.querySelector('p');
  for (const [name] of phases) phase.add(new Option(name));
  function updatePhase() {
    description.textContent = phases[phase.selectedIndex][1];
  }
  phase.addEventListener('change', updatePhase);
  updatePhase();

  const flyButton = panel.querySelector('button:not(#match-reopen)');
  let destination;
  function flyToMission() {
    viewer.trackedEntity = undefined;
    viewer.camera.flyTo(destination ?? {
      destination: Cartesian3.fromDegrees(-16.71, 64.94, 7300),
      orientation: { heading: CesiumMath.toRadians(345), pitch: CesiumMath.toRadians(-32), roll: 0 },
    });
  }
  flyButton.addEventListener('click', flyToMission);

  const terrainId = new URLSearchParams(location.search).get('terrain');
  if (!terrainId) return;
  loadEarthCatalog().then(({ candidates }) => {
    const site = candidates.find(candidate => candidate.id === terrainId);
    if (!site || viewer.isDestroyed()) return;
    destination = {
      destination: Cartesian3.fromDegrees(site.longitude, site.latitude, 14000),
      orientation: { heading: 0, pitch: -CesiumMath.PI_OVER_TWO, roll: 0 },
    };
    viewer.camera.setView(destination);
    panel.querySelector('details').open = true;
    panel.querySelector('#mission-site').textContent = site.name;
    flyButton.textContent = 'Recenter on site';
    const dialog = document.querySelector('#analog-evidence');
    const reopen = panel.querySelector('#match-reopen');
    document.querySelector('#analog-title').textContent = site.name;
    document.querySelector('#analog-score').textContent =
      (site.widthMetres / 1000) + ' × ' + (site.heightMetres / 1000) + ' km elevation patch';
    document.querySelector('#analog-reason').textContent = site.attribution;
    document.querySelector('#earth-data-source').href = site.source;
    createTerrainPreview(document.querySelector('#earth-relief'), site, 'Measured Earth elevation');
    reopen.hidden = false;
    reopen.addEventListener('click', () => dialog.showModal());
    dialog.addEventListener('close', () => reopen.focus());
    dialog.showModal();
  }).catch(error => {
    console.error(error);
    const status = panel.querySelector('#mission-match');
    status.textContent = 'Could not load the Earth elevation catalog.';
    status.hidden = false;
    panel.querySelector('details').open = true;
  });
}
