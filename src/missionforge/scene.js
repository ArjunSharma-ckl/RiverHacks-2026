import * as C from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { createViewer, addBaseImagery } from "../viewer.js";
import { initLayers, getLayer } from "../layers.js";
import tiles from "./tile-bounds.json";
import { sites } from "./sites.js";
export function createScene(onPick) {
  const { viewer, scene, camera, lensFlare } = createViewer("atlas");
  initLayers(viewer, ["bluemarble", "esri"]);
  addBaseImagery();
  scene.globe.enableLighting = false;
  scene.postProcessStages.bloom.enabled = false;
  if (lensFlare) lensFlare.enabled = false;
  scene.sun.show = false;
  scene.moon.show = false;
  scene.globe.showWaterEffect = false;
  scene.screenSpaceCameraController.minimumZoomDistance = 1;
  viewer.shadows = false;
  viewer.targetFrameRate = 30;
  viewer.resolutionScale = Math.min(devicePixelRatio, 1.25);
  const pins = new C.CustomDataSource("Analog field sites"),
    base = new C.CustomDataSource("Surface station"),
    fires = new C.CustomDataSource("FireWatch");
  for (const source of [pins, base, fires]) viewer.dataSources.add(source);
  const orange = C.Color.fromCssColorString("#ff7647"),
    pos = (lon, lat, z = 0) => C.Cartesian3.fromDegrees(lon, lat, z);
  function pin(s) {
    pins.entities.add({
      id: s.id,
      position: pos(s.lon, s.lat),
      point: {
        pixelSize: 8,
        color: orange,
        outlineColor: C.Color.WHITE,
        outlineWidth: 2,
      },
      label: {
        text: s.name.toUpperCase(),
        font: "10px monospace",
        horizontalOrigin: C.HorizontalOrigin.LEFT,
        pixelOffset: new C.Cartesian2(12, 0),
        outlineWidth: 3,
        style: C.LabelStyle.FILL_AND_OUTLINE,
      },
    });
  }
  sites.forEach(pin);
  let groundClick = null,
    site,
    placed = false;
  viewer.screenSpaceEventHandler.setInputAction(({ position }) => {
    const ray = camera.getPickRay(position),
      ground = ray && scene.globe.pick(ray, scene);
    if (groundClick && ground) {
      const cb = groundClick;
      groundClick = null;
      const p = C.Cartographic.fromCartesian(ground);
      cb(C.Math.toDegrees(p.longitude), C.Math.toDegrees(p.latitude));
      return;
    }
    const e = scene.pick(position)?.id;
    if (e) onPick(e.id);
  }, C.ScreenSpaceEventType.LEFT_CLICK);
  const duration = () =>
    matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1.05;
  function overview() {
    groundClick = null;
    placed = false;
    base.entities.removeAll();
    fires.entities.removeAll();
    pins.show = true;
    camera.flyTo({ destination: pos(-68, -6, 11900000), duration: duration() });
  }
  function inspect(s) {
    site = s;
    groundClick = null;
    placed = false;
    base.entities.removeAll();
    fires.entities.removeAll();
    pins.show = true;
    if (!pins.entities.getById(s.id)) pin(s);
    camera.flyTo({
      destination: pos(s.lon, s.lat, 42000),
      duration: duration(),
    });
  }
  const local = (east, north, z = 0) =>
    pos(
      site.lon +
        east / (111320 * Math.max(0.01, Math.cos((site.lat * Math.PI) / 180))),
      site.lat + north / 111320,
      z,
    );
  function model(id, file, e, n) {
    base.entities.add({
      id,
      position: local(e, n),
      model: {
        uri: "/models/mission/" + file + ".glb",
        heightReference: C.HeightReference.CLAMP_TO_GROUND,
        imageBasedLightingFactor: new C.Cartesian2(1, 1),
      },
    });
  }
  function box(id, e, n, z, dim, color) {
    base.entities.add({
      id,
      position: local(e, n, z),
      box: {
        dimensions: new C.Cartesian3(...dim),
        material: C.Color.fromCssColorString(color),
        heightReference: C.HeightReference.RELATIVE_TO_GROUND,
      },
    });
  }
  function view(preset = "Overview") {
    if (!placed) return;
    const e =
      preset === "Rover"
        ? base.entities.getById("Rover")
        : preset === "Astronaut"
          ? base.entities.getById("crew0")
          : null;
    const target =
      e?.position.getValue(viewer.clock.currentTime) ?? local(0, 0);
    const carto = C.Cartographic.fromCartesian(target);
    carto.height = scene.globe.getHeight(carto) ?? 0;
    camera.flyToBoundingSphere(
      new C.BoundingSphere(C.Cartographic.toCartesian(carto), 1),
      {
        duration: duration(),
        offset: new C.HeadingPitchRange(
          0.55,
          preset === "Tactical" ? -1.55 : -0.62,
          preset === "Overview"
            ? 35
            : preset === "Tactical"
              ? 67
              : preset === "Habitat"
                ? 23
                : 10,
        ),
      },
    );
  }
  let groundLayer;
  function place(s, c) {
    if (
      placed &&
      site.id === s.id &&
      site.lat === s.lat &&
      site.lon === s.lon &&
      base.entities.getById("crew" + (c.crew - 1)) &&
      !base.entities.getById("crew" + c.crew) &&
      Boolean(base.entities.getById("Rover")) === c.rover
    )
      return;
    camera.cancelFlight();
    if (groundLayer) {
      viewer.imageryLayers.remove(groundLayer);
      groundLayer = null;
    }
    if (tiles[s.id]) {
      groundLayer = C.ImageryLayer.fromProviderAsync(
        C.SingleTileImageryProvider.fromUrl(
          "/assets/mission/" + s.id + "-ground.jpg",
          {
            rectangle: C.Rectangle.fromDegrees(...tiles[s.id]),
            credit: "Esri World Imagery and contributors",
          },
        ),
      );
      viewer.imageryLayers.add(groundLayer);
    }
    site = s;
    placed = true;
    pins.show = false;
    fires.show = false;
    base.entities.removeAll();
    model("Habitat", "habitat", 0, 0);
    model("Science module", "habitat2", -8, 3);
    if (c.rover) model("Rover", "rover", 7, -5);
    for (let i = 0; i < c.crew; i++)
      model("crew" + i, "crew", -3 + i * 1.6, -5 + (i % 2) * 1.3);
    for (let i = 0; i < 4; i++) {
      box(
        "Array support " + i,
        5 + i * 2.4,
        3,
        0.55,
        [0.15, 0.15, 1.1],
        "#9ba3a9",
      );
      box("Solar " + i, 5 + i * 2.4, 3, 1.14, [2.25, 4, 0.12], "#26476b");
    }
    box("Communications mast", -4, -1, 2.8, [0.14, 0.14, 5.6], "#c8ccd0");
    base.entities.add({
      id: "Communications",
      position: local(-4, -1, 5.7),
      ellipsoid: {
        radii: new C.Cartesian3(1.2, 1.2, 0.28),
        material: C.Color.WHITE,
        heightReference: C.HeightReference.RELATIVE_TO_GROUND,
      },
    });
    view();
  }
  function sync(m) {
    if (!placed) return;
    for (let i = 0; i < 4; i++)
      base.entities.getById("Solar " + i).box.material = m.active.solar
        ? orange
        : C.Color.fromCssColorString("#26476b");
    const rover = base.entities.getById("Rover");
    if (rover) {
      rover.position = local(
        7 + 6 * Math.sin(m.km),
        -5 - 4 * (1 - Math.cos(m.km)),
      );
      rover.model.color = m.active.rover ? orange : C.Color.WHITE;
    }
    base.entities.getById("crew0").model.color = m.health
      ? orange
      : C.Color.WHITE;
    base.entities.getById("Habitat").model.color = m.active.oxygen
      ? orange
      : C.Color.WHITE;
    scene.fog.density = m.active.storm ? 0.003 : 0.0002;
  }
  overview();
  return {
    skip: () => camera.completeFlight(),
    overview,
    inspect,
    place,
    view,
    sync,
    pick: (cb) => {
      groundClick = cb;
    },
    imagery: () => {
      const l = getLayer("esri");
      l.show = !l.show;
      return l.show;
    },
    async terrain(s) {
      if (!viewer.terrainProvider.availability) return null;
      const ds = 30 / 111320,
        points = [
          [s.lon, s.lat],
          [s.lon + ds / Math.cos((s.lat * Math.PI) / 180), s.lat],
          [s.lon, s.lat + ds],
        ].map(([x, y]) => C.Cartographic.fromDegrees(x, y));
      const [a, b, c] = await C.sampleTerrainMostDetailed(
        viewer.terrainProvider,
        points,
      );
      return {
        height: a.height,
        slope:
          (Math.atan(
            Math.hypot(b.height - a.height, c.height - a.height) / 30,
          ) *
            180) /
          Math.PI,
      };
    },
    fire(items) {
      fires.entities.removeAll();
      fires.show = true;
      items.forEach((p, i) =>
        fires.entities.add({
          id: "Fire " + (i + 1),
          position: pos(p.longitude, p.latitude),
          point: {
            pixelSize: 6,
            color: orange,
            heightReference: C.HeightReference.CLAMP_TO_GROUND,
          },
        }),
      );
    },
    zoom(f) {
      const d = camera.positionCartographic.height * 0.25;
      f > 0 ? camera.zoomIn(d) : camera.zoomOut(d);
    },
  };
}
