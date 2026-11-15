import * as C from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { createViewer, addBaseImagery } from "../viewer.js";
import { initLayers, getLayer } from "../layers.js";
import { crewScene } from "./crew-scene.js";
import { stations } from "./duties.js";
import tiles from "./tile-bounds.json";
import { sites } from "./sites.js";
export function createScene(onPick) {
  const { viewer, scene, camera, lensFlare, terrainReady } = createViewer("atlas");
  initLayers(viewer, ["bluemarble", "esri"]);
  addBaseImagery();
  scene.globe.enableLighting = true;
  scene.globe.dynamicAtmosphereLighting = true;
  scene.globe.dynamicAtmosphereLightingFromSun = true;
  scene.postProcessStages.bloom.enabled = false;
  if (lensFlare) lensFlare.enabled = false;
  scene.sun.show = true;
  scene.moon.show = false;
  scene.globe.showWaterEffect = false;
  scene.screenSpaceCameraController.minimumZoomDistance = 1;
  scene.screenSpaceCameraController.zoomEventTypes = [C.CameraEventType.WHEEL,C.CameraEventType.PINCH];
  scene.screenSpaceCameraController.tiltEventTypes = [C.CameraEventType.RIGHT_DRAG,C.CameraEventType.MIDDLE_DRAG,C.CameraEventType.PINCH];
  scene.screenSpaceCameraController.maximumTiltAngle = C.Math.PI_OVER_TWO;
  viewer.shadows = true;
  scene.shadowMap.softShadows = true;
  scene.shadowMap.size = 1024;
  scene.shadowMap.darkness = 0.3;
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
        font: "15px sans-serif",
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
    if(groundLayer){viewer.imageryLayers.remove(groundLayer);groundLayer=null;}
    itinerary.entities.removeAll();
    groundClick = null;
    placed = false;
    base.entities.removeAll();
    fires.entities.removeAll();
    pins.show = true;
    camera.flyTo({ destination: pos(-68, -6, 11900000), duration: duration() });
  }
  function inspect(s, height=42000) {
    actors.reset();
    itinerary.entities.removeAll();
    site = s;
    groundClick = null;
    placed = false;
    base.entities.removeAll();
    fires.entities.removeAll();
    pins.show = true;
    if (!pins.entities.getById(s.id)) pin(s);
    showGroundTile(s,0.55);
    camera.flyTo({
      destination: pos(s.lon, s.lat, height),
      orientation:{heading:0,pitch:-C.Math.PI_OVER_TWO,roll:0},
      duration: duration(),
    });
  }
  function preview(s){inspect(s,900);pins.show=false;}
  const local = (east, north, z = 0) =>
    pos(
      site.lon +
        east / (111320 * Math.max(0.01, Math.cos((site.lat * Math.PI) / 180))),
      site.lat + north / 111320,
      z,
    );
  const actors = crewScene(viewer, base, local);
  function model(id, file, e, n, scale) {
    base.entities.add({
      id,
      position: local(e, n),
      model: {
        uri: "/models/mission/" + file + ".glb",
        ...(scale ? { scale } : {}),
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
        imageBasedLightingFactor: new C.Cartesian2(0.72, 0.82),
      },
    });
  }
  function passage(id, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, length = Math.hypot(dx, dy);
    if (length < 0.05) return;
    const eastWest = Math.abs(dx) >= Math.abs(dy);
    const ux = dx / length, uy = dy / length;
    for (let start = 0, segment = 0; start < length - 0.01; start += 2, segment++) {
      const section = Math.min(2, length - start);
      model(
        id + " " + segment,
        eastWest ? "passage-ew" : "passage-ns",
        x1 + ux * (start + section / 2),
        y1 + uy * (start + section / 2),
        section / 2,
      );
    }
  }
  async function terrainHeight(point) {
    await terrainReady;
    if (!viewer.terrainProvider) return scene.globe.getHeight(point) ?? 0;
    try {
      const [sampled] = await C.sampleTerrainMostDetailed(viewer.terrainProvider, [point]);
      return sampled.height;
    } catch {
      return scene.globe.getHeight(point) ?? 0;
    }
  }
  async function view(preset = "Overview", astronaut = 0) {
    if (!placed) return;
    if (actors.cameraMode(preset, astronaut)) return;
    if(preset==='Overview'){
      const point=C.Cartographic.fromDegrees(site.lon,site.lat);
      const ground=await terrainHeight(point);
      const target=C.Cartesian3.fromDegrees(site.lon,site.lat,ground+2);
      camera.flyToBoundingSphere(new C.BoundingSphere(target,30),{
        duration:duration(),
        offset:new C.HeadingPitchRange(Math.PI,-0.68,280),
      });
      return;
    }
    const e =
      preset === "Rover"
        ? base.entities.getById("Rover")
        : preset === "Astronaut"
          ? base.entities.getById("crew0")
          : null;
    const target =
      e?.position.getValue(viewer.clock.currentTime) ?? local(0, 0);
    const carto = C.Cartographic.fromCartesian(target);
    carto.height = await terrainHeight(carto);
    camera.flyToBoundingSphere(
      new C.BoundingSphere(C.Cartographic.toCartesian(carto), 1),
      {
        duration: duration(),
        offset: new C.HeadingPitchRange(
          0.55,
          preset === "Tactical" ? -1.55 : -0.75,
          preset === "Overview"
            ? 105
            : preset === "Tactical"
              ? 125
              : preset === "Habitat"
                ? 34
                : 10,
        ),
      },
    );
  }
  let groundLayer;
  let groundSite='';
  function showGroundTile(s,opacity=0.55){
    if(groundSite===s.id&&groundLayer){groundLayer.alpha=opacity;return;}
    if(groundLayer){viewer.imageryLayers.remove(groundLayer);groundLayer=null;}
        groundSite = s.id;
    if(tiles[s.id]){groundLayer=C.ImageryLayer.fromProviderAsync(C.SingleTileImageryProvider.fromUrl('/assets/mission/'+s.id+'-ground.jpg',{rectangle:C.Rectangle.fromDegrees(...tiles[s.id]),credit:'Esri World Imagery and contributors'}));groundLayer.alpha=opacity;groundLayer.show=opacity>0;viewer.imageryLayers.add(groundLayer);}
  }
  function startClock(s) {
    const now = new Date();
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const morning = 9.5; // local solar time
    const start = midnight + (morning - s.lon / 15) * 3600000;
    viewer.clock.currentTime = C.JulianDate.fromDate(new Date(start));
    viewer.clock.clockStep = C.ClockStep.SYSTEM_CLOCK_MULTIPLIER;
    viewer.clock.multiplier = 600;
    viewer.clock.shouldAnimate = true;
  }
  let placedSignature='';
  function place(s, c) {
    const signature=JSON.stringify(c.addedFacilities||[]);
    if (
      placed &&
      site.id === s.id &&
      site.lat === s.lat &&
      site.lon === s.lon &&
      base.entities.getById("crew" + (c.crew - 1)) &&
      !base.entities.getById("crew" + c.crew) &&
      Boolean(base.entities.getById("Rover")) === c.rover && placedSignature===signature
    )
      return;
    camera.cancelFlight();
    if (groundLayer) groundLayer.show = false;
    startClock(s);
    site = s;
    placedSignature=signature;
    placed = true;
    pins.show = false;
    fires.show = false;
    base.entities.removeAll();
    itinerary.entities.removeAll();
    model("Habitat", "habitat", 0, 0);
    model("Science module", "habitat2", -8, 6);
    model("Kestrel descent vehicle", "kestrel", 60, -65);
    model("Emergency shelter", "medical", 0, 17);
    model("Crew quarters", "habitat", -10, -18);
    for (const station of Object.values(stations))
      model(station.name, station.model, ...station.at);
    // A ribbed pressure loop links the habitat, laboratories, medical bay and depot.
    passage("North corridor", 0, 0, 0, 15.2);
    passage("West corridor", 0, -2, -13.5, -2);
    passage("South corridor", 0, 0, 0, -13);
    passage("East corridor", 0, -8, 8.4, -8);
    passage("Water corridor", 0, -9, -13, -9);
    passage("Quarters corridor", -10, -6, -10, -15.9);
    passage("Fabrication corridor", 0, 4, 22.4, 4);
    passage("Battery corridor", 19, 4, 19, 13.2);
    passage("Construction corridor", -19, 0, -19, 14.3);
    passage("Medical connector", 0, -13, 1.3, -13);
    const extraModels={greenhouse:['laboratory',-46,25],observatory:['laboratory',-38,8],power:['habitat2',42,26],storage:['logistics',-32,-18],comms:['habitat2',34,-12],airlock:['medical',-18,-24],drilling:['recycler',-42,-12],landing:['kestrel',72,-22]};
    for(const key of c.addedFacilities||[]){const item=extraModels[key];if(item)model('Extra '+key,...item)}
    if (c.rover) model("Rover", "rover", 5.5, -3);
    for (let i = 0; i < c.crew; i++)
      model("crew" + i, "field-suit", -3 + i * 1.6, -5 + (i % 2) * 1.3);
    for (let i = 0; i < 4; i++)
      model("Solar " + i, "solar", 6 + (i % 2) * 4.5, 9 + Math.floor(i / 2) * 4.2);
    model("Communications", "comms", -5, 13);
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
      itinerary.entities.add({id:`Stop ${i+1}`,position:pos(p.lon,p.lat,10000),point:{pixelSize:10,color:C.Color.fromCssColorString('#a1efcf'),outlineColor:C.Color.BLACK,outlineWidth:2},label:{text:p.name,font:'15px sans-serif',pixelOffset:new C.Cartesian2(12,-15),horizontalOrigin:C.HorizontalOrigin.LEFT,style:C.LabelStyle.FILL_AND_OUTLINE,outlineWidth:3}});
      if(i){const a=points[i-1],g=new C.EllipsoidGeodesic(C.Cartographic.fromDegrees(a.lon,a.lat),C.Cartographic.fromDegrees(p.lon,p.lat));const positions=[];for(let j=0;j<=48;j++){const f=j/48,q=g.interpolateUsingFraction(f);positions.push(pos(C.Math.toDegrees(q.longitude),C.Math.toDegrees(q.latitude),10000+Math.sin(Math.PI*f)*Math.min(500000,g.surfaceDistance*.12)));}itinerary.entities.add({polyline:{positions,width:3,material:C.Color.fromCssColorString('#9de9c9')}});}
    }
    const sphere=C.BoundingSphere.fromPoints(points.map(p=>pos(p.lon,p.lat)));
    camera.flyToBoundingSphere(sphere,{duration:duration(),offset:new C.HeadingPitchRange(0,-C.Math.PI_OVER_TWO,Math.max(500000,sphere.radius*3.4))});
  }
  function sync(m, rate = 0) {
    if (!placed) return;
    actors.sync(m, rate);
    let greenhouse = base.entities.getById("Constructed greenhouse");
    if (m.construction >= 4 && !greenhouse)
      model("Constructed greenhouse", "laboratory", -34, 20);
    setFacilities(m.cfg.facilities||{});
    for (let i = 0; i < 4; i++)
      base.entities.getById("Solar " + i).model.color = m.active.solar
        ? orange
        : C.Color.WHITE;
    const rover = base.entities.getById("Rover");
    if (rover) {
      rover.position = local(
        5.5 + 2.2 * Math.sin(m.km),
        -3 - 1.6 * (1 - Math.cos(m.km)),
      );
      rover.model.color = m.active.rover ? orange : C.Color.WHITE;
    }
    base.entities.getById("crew0").model.color = m.health
      ? orange
      : C.Color.WHITE;
    base.entities.getById("Habitat").model.color = m.active.oxygen
      ? orange
      : C.Color.WHITE;
    const dust=Math.max(0,Math.min(100,m.environment?.dust||0));
    scene.fog.density = m.active.storm ? 0.004 : 0.0002 + dust*0.000035;
    scene.fog.minimumBrightness = Math.max(0.04,0.25-dust*0.002);
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
    preview,
    place,
    view,
    sync,
    waitForTiles(){return new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;remove();clearTimeout(timer);resolve()};const remove=scene.globe.tileLoadProgressEvent.addEventListener(count=>{if(count===0)finish()});const timer=setTimeout(finish,12000);if(scene.globe.tilesLoaded)setTimeout(finish,300)})},
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
