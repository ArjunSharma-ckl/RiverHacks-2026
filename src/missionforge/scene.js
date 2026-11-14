import * as C from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { createViewer, addBaseImagery } from "../viewer.js";
import { initLayers, getLayer } from "../layers.js";
import { crewScene } from "./crew-scene.js";
import { stations } from "./duties.js";
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
  viewer.useBrowserRecommendedResolution = true;
  viewer.resolutionScale = Math.min(
    2,
    Math.max(1, devicePixelRatio),
    Math.sqrt(3600000 / Math.max(1, innerWidth * innerHeight)),
  );
  scene.msaaSamples = 4;
  scene.postProcessStages.fxaa.enabled = true;
  const pins = new C.CustomDataSource("Analog field sites"),
    base = new C.CustomDataSource("Surface station"),
    itinerary = new C.CustomDataSource("Travel itinerary"),
    fires = new C.CustomDataSource("FireWatch");
  for (const source of [pins, base, fires, itinerary]) viewer.dataSources.add(source);
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
    actors.reset();
    itinerary.entities.removeAll();
    groundClick = null;
    placed = false;
    base.entities.removeAll();
    fires.entities.removeAll();
    pins.show = true;
    camera.flyTo({ destination: pos(-68, -6, 11900000), duration: duration() });
  }
  function inspect(s) {
    actors.reset();
    itinerary.entities.removeAll();
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
  const actors = crewScene(viewer, base, local);
  function model(id, file, e, n) {
    base.entities.add({
      id,
      position: local(e, n),
      model: {
        uri: "/models/mission/" + file + ".glb",
        ...(file === "field-suit"
          ? {
              nodeTransformations: Object.fromEntries(
                ["LegL", "LegR", "ArmL", "ArmR"].map((name) => [
                  name,
                  { rotation: C.Quaternion.IDENTITY },
                ]),
              ),
            }
          : {}),
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
  function view(preset = "Overview", astronaut = 0) {
    if (!placed) return;
    if (actors.cameraMode(preset, astronaut)) return;
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
            ? 52
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
    itinerary.entities.removeAll();
    model("Habitat", "habitat", 0, 0);
    model("Science module", "habitat2", -8, 6);
    model("Kestrel descent vehicle", "kestrel", 12, -18);
    box("North pressure passage", 0, 8.3, 1, [1.6, 12.6, 1.95], "#a0a6a3");
    box("West pressure passage", -4.2, 5.8, 1, [7.5, 1.55, 1.95], "#a0a6a3");
    model("Emergency shelter", "medical", 0, 17);
    model("Crew quarters", "habitat", -10, -18);
    for (const station of Object.values(stations))
      model(station.name, station.model, ...station.at);
    // Enclosed pressure passages connect the inhabited modules through a central spine.
    const passage=(id,x,y,w,h)=>box(id,x,y,1,[w,h,2.05],"#a2b3b2");
    passage("South pressure spine",0,-7.5,2.2,15);
    passage("West pressure spine",-9,-2,18,2.2);
    passage("East pressure spine",7,-7,14,2.2);
    passage("Laboratory passage",-17,-2,16,2.2);
    passage("Quarters passage",-10,-12,2.2,12);
    passage("Medical passage",2,-12,4,2.2);
    passage("Reclamation passage",-10,-7,2.2,10);
    passage("Fabrication passage",14,4,28,2.2);
    passage("Construction passage",-19,9,2.2,18);
    passage("Battery passage",19,10,2.2,12);
    if (c.rover) model("Rover", "rover", 7, -5);
    for (let i = 0; i < c.crew; i++)
      model("crew" + i, "field-suit", -3 + i * 1.6, -5 + (i % 2) * 1.3);
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
    setFacilities(c.facilities || {});
  }
  function setFacilities(facilities) {
    const names={ science:["Science module","Geology laboratory"], medical:["Emergency shelter","Medical bay"], quarters:["Crew quarters"], water:["Water reclamation"], logistics:["Logistics depot"], fabrication:["Fabrication workshop"], construction:["Construction yard","Constructed greenhouse"], rover:["Rover"] };
    for(const [key,ids] of Object.entries(names)) for(const id of ids){const entity=base.entities.getById(id);if(entity)entity.show=facilities[key]!==false;}
  }
  function showRoute(points) {
    itinerary.entities.removeAll();
    if(points.length<2)return;
    for(let i=0;i<points.length;i++){
      const p=points[i];
      itinerary.entities.add({id:`Stop ${i+1}`,position:pos(p.lon,p.lat,10000),point:{pixelSize:10,color:C.Color.fromCssColorString('#a1efcf'),outlineColor:C.Color.BLACK,outlineWidth:2},label:{text:p.name,font:'12px sans-serif',pixelOffset:new C.Cartesian2(12,-15),horizontalOrigin:C.HorizontalOrigin.LEFT,style:C.LabelStyle.FILL_AND_OUTLINE,outlineWidth:3}});
      if(i){const a=points[i-1],g=new C.EllipsoidGeodesic(C.Cartographic.fromDegrees(a.lon,a.lat),C.Cartographic.fromDegrees(p.lon,p.lat));const positions=[];for(let j=0;j<=48;j++){const f=j/48,q=g.interpolateUsingFraction(f);positions.push(pos(C.Math.toDegrees(q.longitude),C.Math.toDegrees(q.latitude),10000+Math.sin(Math.PI*f)*Math.min(500000,g.surfaceDistance*.12)));}itinerary.entities.add({polyline:{positions,width:3,material:C.Color.fromCssColorString('#9de9c9')}});}
    }
    camera.flyTo({destination:pos(points.at(-1).lon,points.at(-1).lat,Math.max(2000000,points.length*1800000)),duration:duration()});
  }
  function sync(m, rate = 0) {
    if (!placed) return;
    actors.sync(m, rate);
    let greenhouse = base.entities.getById("Constructed greenhouse");
    if (m.construction >= 4 && !greenhouse)
      model("Constructed greenhouse", "laboratory", -28, 16);
    setFacilities(m.cfg.facilities||{});
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
    scene.fog.density = m.active.storm ? 0.003 : 0.0002 + (m.environment?.dust||0)*0.00002;
  }
  overview();
  return {
    quality(mode) {
      scene.msaaSamples = mode === "Performance" ? 1 : mode === "High" ? 4 : 2;
      viewer.resolutionScale =
        mode === "High"
          ? Math.min(devicePixelRatio, 2, Math.sqrt(4000000 / (innerWidth * innerHeight)))
          : mode === "Performance"
            ? 0.75
            : 1;
      viewer.targetFrameRate = mode === "High" ? 60 : 30;
      scene.globe.maximumScreenSpaceError =
        mode === "High" ? 1.5 : mode === "Performance" ? 4 : 2;
    },
    skip: () => camera.completeFlight(),
    detach: actors.reset,
    overview,
    inspect,
    place,
    view,
    sync,
    setFacilities,
    showRoute,
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
