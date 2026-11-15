import * as C from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { createViewer, addBaseImagery } from "../viewer.js";
import { initLayers, getLayer } from "../layers.js";
import { crewScene } from "./crew-scene.js";
import { stations } from "./duties.js";
import { pointOnRoute } from "./navigation.js";
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
  const layoutCache = new Map(), layoutPending = new Map();
  const defaultLayout = { east:0, north:0, scale:1.6, slope:null };
  let layout = defaultLayout, placedLayout = null, lastRate = 0;
  const within = (promise, ms) => Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Error('Terrain sample timed out')),ms))]);
  async function prepareLayout(s) {
    if (layoutCache.has(s.id)) return layoutCache.get(s.id);
    if (layoutPending.has(s.id)) return layoutPending.get(s.id);
    const task = (async () => {
      await within(terrainReady,4000).catch(()=>{});
      const candidates = [-100,0,100].flatMap(east=>[-100,0,100].map(north=>({east,north})));
      const offsets = [[0,0],[25,0],[-25,0],[0,25],[0,-25]];
      const points = candidates.flatMap(({east,north})=>offsets.map(([dx,dy])=>
        C.Cartographic.fromDegrees(s.lon+(east+dx)/(111320*Math.max(.01,Math.cos(C.Math.toRadians(s.lat)))),s.lat+(north+dy)/111320)));
      let sampled;
      try { sampled=await within(viewer.terrainProvider.availability
        ? C.sampleTerrainMostDetailed(viewer.terrainProvider,points)
        : C.sampleTerrain(viewer.terrainProvider,13,points),5500); }
      catch { sampled=points.map(p=>({height:scene.globe.getHeight(p)})); }
      const scored=candidates.map((candidate,i)=>{
        const heights=sampled.slice(i*5,i*5+5).map(p=>p.height);
        if(heights.some(h=>!Number.isFinite(h)))return {...candidate,score:Infinity,slope:Infinity};
        const slope=Math.max(...heights.slice(1).map(h=>Math.abs(h-heights[0])/25));
        const roughness=Math.max(...heights)-Math.min(...heights);
        return {...candidate,slope,score:slope*100+roughness*.3+Math.hypot(candidate.east,candidate.north)*.012};
      });
      const best=scored.sort((a,b)=>a.score-b.score)[0];
      if(!Number.isFinite(best.score))return defaultLayout;
      return {east:best.east,north:best.north,scale:best.slope<.08?1.9:best.slope<.22?1.65:1.4,slope:best.slope};
    })().then(value=>{layoutCache.set(s.id,value);layoutPending.delete(s.id);return value;},()=>{layoutPending.delete(s.id);return defaultLayout;});
    layoutPending.set(s.id,task);
    return task;
  }
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
    roverFollow = false;
    scene.screenSpaceCameraController.enableInputs = true;
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
    layout = layoutCache.get(s.id)||defaultLayout;
    prepareLayout(s);
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
        (layout.east+east*layout.scale) / (111320 * Math.max(0.01, Math.cos((site.lat * Math.PI) / 180))),
      site.lat + (layout.north+north*layout.scale) / 111320,
      z,
    );
  const actors = crewScene(viewer, base, local);
  function model(id, file, e, n, scale, height = 0) {
    base.entities.add({
      id,
      position: local(e, n, height),
      model: {
        uri: "/models/mission/" + file + ".glb",
        scale: file === 'crew' || file === 'field-suit' ? (scale||1)
          : (scale||1)*layout.scale*(file.startsWith('passage-') || file === 'rover' || file === 'kestrel' ? 1 : 1.28),
        minimumPixelSize: file.startsWith('passage-') ? 0 : file === 'crew' ? 3 : file === 'solar' ? 5 : 14,
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
        heightReference: height
          ? C.HeightReference.RELATIVE_TO_GROUND
          : C.HeightReference.CLAMP_TO_GROUND,
        imageBasedLightingFactor: new C.Cartesian2(0.95, 1),
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
    const loaded=scene.globe.getHeight(point);
    if(Number.isFinite(loaded))return loaded;
    await within(terrainReady,3500).catch(()=>{});
    if (!viewer.terrainProvider) return scene.globe.getHeight(point) ?? 0;
    try {
      const [sampled] = await within(viewer.terrainProvider.availability
        ? C.sampleTerrainMostDetailed(viewer.terrainProvider, [point])
        : C.sampleTerrain(viewer.terrainProvider,13,[point]),3500);
      return Number.isFinite(sampled.height)?sampled.height:0;
    } catch {
      return scene.globe.getHeight(point) ?? 0;
    }
  }
  async function view(preset = "Overview", astronaut = 0) {
    if (!placed) return;
    const attached = actors.cameraMode(preset, astronaut);
    if (attached) {
      roverFollow = false;
      return;
    }
    roverFollow = preset === "Rover";
    scene.screenSpaceCameraController.enableInputs = !roverFollow;
    if (roverFollow) camera.cancelFlight();
    if(preset==='Overview'){
      const point=C.Cartographic.fromCartesian(local(0,0));
      const ground=await terrainHeight(point);
      const target=local(0,0,ground+2);
      camera.flyToBoundingSphere(new C.BoundingSphere(target,30),{
        duration:duration(),
        offset:new C.HeadingPitchRange(Math.PI,-1.22,310*layout.scale/1.6),
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
  // A closed survey loop east of the settlement keeps the rover clear of the
  // habitat and gives the chase camera a continuous, fluid route.
  const roverPath = [
    [38, 0], [44, -18], [58, -24], [70, -12],
    [72, 8], [58, 24], [44, 20], [38, 0],
  ];
  const roverLength = roverPath.slice(1).reduce(
    (sum, point, index) =>
      sum + Math.hypot(point[0] - roverPath[index][0], point[1] - roverPath[index][1]),
    0,
  );
  let roverDistance = 0;
  let roverFollow = false;
  let roverDriving = false;
  let roverMission = null;
  let roverLastFrame = performance.now();
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
    const nextLayout=layoutCache.get(s.id)||defaultLayout;
    if (
      placed &&
      site.id === s.id &&
      site.lat === s.lat &&
      site.lon === s.lon &&
      base.entities.getById("crew" + (c.crew - 1)) &&
      !base.entities.getById("crew" + c.crew) &&
      Boolean(base.entities.getById("Rover")) === c.rover && placedSignature===signature && placedLayout===nextLayout
    )
      return;
    camera.cancelFlight();
    if (groundLayer) groundLayer.show = false;
    startClock(s);
    roverDistance = 0;
    roverFollow = false;
    roverDriving = false;
    roverLastFrame = performance.now();
    site = s;
    layout = nextLayout;
    placedLayout = nextLayout;
    placedSignature=signature;
    placed = true;
    pins.show = false;
    fires.show = false;
    base.entities.removeAll();
    itinerary.entities.removeAll();
    model("Habitat", "habitat", 0, 0);
    model("Science module", "habitat2", 56, -12);
    model("Kestrel descent vehicle", "kestrel", 60, -65);
    model("Emergency shelter", "medical", 0, 17);
    model("Crew quarters", "habitat", -10, -18);
    for (const station of Object.values(stations))
      model(station.name, station.model, ...station.at);
    // A ribbed pressure loop links the habitat, laboratories, medical bay and depot.
    passage("Habitat apron", 0, 2.2, 0, 4);
    passage("North corridor", 0, 4, 0, 15.2);
    passage("West corridor", 0, -2, -13.5, -2);
    passage("Habitat bypass riser", -6, -2, -6, 4);
    passage("Habitat bypass north", -6, 4, 0, 4);
    passage("South corridor", 0, -2, 0, -13);
    passage("East corridor", 0, -8, 8.4, -8);
    passage("Water corridor", 0, -9, -13, -9);
    passage("Quarters connector", -10, -2, -10, -6);
    passage("Quarters corridor", -10, -6, -10, -15.9);
    passage("Fabrication corridor", 0, 4, 22.4, 4);
    passage("Battery corridor", 19, 4, 19, 13.2);
    passage("Construction riser", -10.5, -2, -10.5, 2);
    passage("Construction link", -10.5, 2, -19, 2);
    passage("Construction return", -19, 2, -19, 0);
    passage("Construction corridor", -19, 0, -19, 14.3);
    passage("Medical connector", 0, -13, 1.3, -13);
    passage("Transport 1 spur", 0, -13, 0, -16);
    passage("Transport 1 link", 0, -16, 12, -16);
    passage("Transport 1 bay", 12, -16, 12, -20);
    passage("Transport 2 spur", 0, 15.2, -6, 15.2);
    passage("Transport 2 link", -6, 15.2, -10, 22);
    passage("Mine link north", 22.4, 4, 22.4, 10);
    passage("Mine link east", 22.4, 10, 24.5, 10);
    passage("Mine link south", 24.5, 10, 24.5, 17);
    passage("Research descent", 19, 4, 19, -1);
    passage("Research south link", 19, -1, 40, -1);
    passage("Research south ring", 40, -1, 40, -12);
    passage("Science spur", 40, -12, 48.2, -12);
    passage("Research north ring", 40, -1, 40, 26);
    passage("Bio spur", 40, 14, 44.1, 14);
    passage("Chem spur", 40, 26, 44.1, 26);
    const extraModels={greenhouse:['laboratory',-46,25],observatory:['comms',-38,8],power:['habitat2',42,26],storage:['logistics',-32,-18],comms:['comms',34,-12],airlock:['medical',-18,-24],drilling:['recycler',-42,-12],landing:['kestrel',72,-22]};
    for(const key of c.addedFacilities||[]){const item=extraModels[key];if(item)model('Extra '+key,...item)}
    if (c.rover) model("Rover", "rover", 38, 0, undefined, 1.05);
    for (let i = 0; i < c.crew; i++)
      model("crew" + i, "crew", -3 + i * 1.6, -5 + (i % 2) * 1.3);
    for (let i = 0; i < 4; i++)
      model("Solar " + i, "solar", 6 + (i % 2) * 4.5, 9 + Math.floor(i / 2) * 4.2);
    model("Communications", "comms", -5, 13);
    view();
    setFacilities(c.facilities || {});
    if(!layoutCache.has(s.id))prepareLayout(s).then(prepared=>{
      if(placed&&site.id===s.id&&placedLayout!==prepared){
        const previous=roverMission, rate=lastRate;
        place(s,c);
        if(previous)sync(previous,rate);
      }
    });
  }
  function setFacilities(facilities) {
    const names={ science:["Science module","Geology laboratory","Biology lab","Chemistry lab"], medical:["Emergency shelter","Medical bay"], quarters:["Crew quarters"], water:["Water reclamation"], logistics:["Logistics depot"], fabrication:["Fabrication workshop"], construction:["Construction yard","Constructed greenhouse"], rover:["Rover"] };
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
    lastRate = rate;
    actors.sync(m, rate);
    roverMission = m;
    roverDriving = Boolean(
      rate > 0 &&
      m.traverse &&
      m.outcome === "In progress" &&
      !m.active.rover &&
      !m.active.storm &&
      (m.environment?.wind ?? 0) < 25 &&
      (!m.active.comms || m.mitigated?.autonomy)
    );
    let greenhouse = base.entities.getById("Constructed greenhouse");
    if (m.construction >= 4 && !greenhouse)
      model("Constructed greenhouse", "laboratory", -34, 20);
    setFacilities(m.cfg.facilities||{});
    for (let i = 0; i < 4; i++)
      base.entities.getById("Solar " + i).model.color = m.active.solar
        ? orange
        : C.Color.WHITE;
    const rover = base.entities.getById("Rover");
    if (rover) rover.model.color = m.active.rover ? orange : C.Color.WHITE;
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
  scene.preUpdate.addEventListener(() => {
    if (!placed) return;
    const now = performance.now();
    const delta = Math.min((now - roverLastFrame) / 1000, 3);
    roverLastFrame = now;
    if (roverDriving) roverDistance = (roverDistance + delta * 8.5) % roverLength;
    const rover = base.entities.getById("Rover");
    if (!rover) return;
    const point = pointOnRoute(roverPath, roverDistance / roverLength);
    const world = local(point.x, point.y, 1.05);
    rover.position.setValue(world);
    rover.orientation ??= new C.ConstantProperty();
    rover.orientation.setValue(
      C.Transforms.headingPitchRollQuaternion(
        world,
        new C.HeadingPitchRoll(point.heading - Math.PI / 2, 0, 0),
      ),
    );
    if (!roverFollow) return;
    const ground = scene.globe.getHeight(C.Cartographic.fromCartesian(world)) ?? 0;
    camera.setView({
      destination: local(
        point.x - Math.sin(point.heading) * 10,
        point.y - Math.cos(point.heading) * 10,
        ground + 4.2,
      ),
      orientation: { heading: point.heading, pitch: -0.26, roll: 0 },
    });
  });
  overview();
  return {
    quality(mode) {
      scene.msaaSamples = mode === "High" ? 2 : 1;
      viewer.resolutionScale =
        mode === "High"
          ? Math.min(devicePixelRatio, 1.5, Math.sqrt(3600000 / (innerWidth * innerHeight)))
          : mode === "Performance"
            ? 0.7
            : 0.9;
      viewer.targetFrameRate = 30;
      viewer.shadows = mode !== "Performance";
      scene.postProcessStages.fxaa.enabled = mode === "High";
      scene.globe.maximumScreenSpaceError =
        mode === "High" ? 2 : mode === "Performance" ? 5 : 3;
      scene.globe.tileCacheSize = mode === "Performance" ? 150 : 220;
    },
    skip: () => camera.completeFlight(),
    detach: actors.reset,
    overview,
    inspect,
    preview,
    place,
    view,
    resize(){viewer.resize();scene.requestRender();},
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
      const ds = 30 / 111320,
        points = [
          [s.lon, s.lat],
          [s.lon + ds / Math.cos((s.lat * Math.PI) / 180), s.lat],
          [s.lon, s.lat + ds],
        ].map(([x, y]) => C.Cartographic.fromDegrees(x, y));
      const [a, b, c] = viewer.terrainProvider.availability
        ? await C.sampleTerrainMostDetailed(viewer.terrainProvider,points)
        : await C.sampleTerrain(viewer.terrainProvider,13,points);
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
