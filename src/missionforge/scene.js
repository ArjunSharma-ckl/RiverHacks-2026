import { condition, equipmentForModel, unavailable, weather } from './exposure.js';
import * as C from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { createViewer, addBaseImagery } from "../viewer.js";
import { enableGlobeSpin } from "../globe-spin.js";
import { initLayers, getLayer } from "../layers.js";
import { crewScene } from "./crew-scene.js";
import { stations } from "./duties.js";
import { pointOnRoute } from "./navigation.js";
import { vitals } from './simulation.js';
import tiles from "./tile-bounds.json";
import { sites } from "./sites.js";
import { createQuality } from "../quality.js";
export function createScene(onPick) {
  const { viewer, scene, camera, lensFlare } = createViewer("atlas");
  enableGlobeSpin(viewer);
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
  createQuality(viewer);
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
      position: pos(s.lon, s.lat, 35),
      point: {
        pixelSize: 8,
        color: orange,
        outlineColor: C.Color.WHITE,
        outlineWidth: 2,
        heightReference:C.HeightReference.RELATIVE_TO_GROUND,
        disableDepthTestDistance:Number.POSITIVE_INFINITY,
      },
      label: {
        text: s.name.toUpperCase(),
        font: "15px sans-serif",
        horizontalOrigin: C.HorizontalOrigin.CENTER,
        verticalOrigin: C.VerticalOrigin.BOTTOM,
        pixelOffset: new C.Cartesian2(0, -14),
        outlineWidth: 3,
        showBackground: true,
        backgroundColor: C.Color.fromCssColorString('#101a21').withAlpha(0.72),
        backgroundPadding: new C.Cartesian2(6, 4),
        style: C.LabelStyle.FILL_AND_OUTLINE,
        heightReference:C.HeightReference.RELATIVE_TO_GROUND,
        disableDepthTestDistance:Number.POSITIVE_INFINITY,
      },
    });
  }
  sites.forEach(pin);
  // At world scale the site names crowd each other. Each frame, keep a label
  // only when its screen box does not collide with one already placed.
  function declutterLabels() {
    const boxes = [];
    const time = viewer.clock.currentTime;
    for (const entity of pins.entities.values) {
      if (!entity.label || !entity.position) continue;
      const position = entity.position.getValue(time);
      const screen = position && C.SceneTransforms.worldToWindowCoordinates(scene, position);
      entity.label.show = true;
      if (!screen) { entity.label.show = false; continue; }
      const text = String(entity.label.text.getValue(time) ?? '');
      const width = Math.max(48, text.length * 8.6);
      const box = { x: screen.x - width / 2 - 6, y: screen.y - 36, w: width + 12, h: 22 };
      const collides = boxes.some(other =>
        box.x < other.x + other.w && box.x + box.w > other.x &&
        box.y < other.y + other.h && box.y + box.h > other.y);
      if (collides) entity.label.show = false;
      else boxes.push(box);
    }
  }
  viewer.scene.preRender.addEventListener(declutterLabels);
  let groundClick = null,
    site,
    placed = false;
  const layout = { east: 0, north: 0, scale: 1.9 };
  let renderQuality = "Performance";
  const surface = new C.CustomDataSource("Settlement photo");
  viewer.dataSources.add(surface);
  function showGlobe() {
    surface.entities.removeAll();
    scene.globe.show = true;
    scene.skyAtmosphere.show = true;
    scene.sun.show = true;
    scene.highDynamicRange = true;
    scene.light.intensity = 2;
    viewer.shadows = renderQuality !== "Performance";
  }
  viewer.screenSpaceEventHandler.setInputAction(({ position }) => {
    const ray = groundClick && camera.getPickRay(position);
    const ground = ray && scene.globe.pick(ray, scene);
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
  const tooltip=document.createElement('div');
  tooltip.className='scene-entity-tooltip';
  tooltip.hidden=true;
  viewer.container.append(tooltip);
  viewer.screenSpaceEventHandler.setInputAction(({endPosition})=>{
    const picked=scene.pick(endPosition)?.id;
    const id=typeof picked==='string'?picked:picked?.id;
    const siteHit = id && sites.find(item => item.id === id);
    if ((!placed || !base.entities.getById(id)) && !siteHit) { tooltip.hidden = true; return; }
    if (siteHit) {
      tooltip.replaceChildren();
      const heading = document.createElement('strong'), body = document.createElement('span');
      heading.textContent = siteHit.name;
      body.textContent = siteHit.country + ' · ' + siteHit.type + '. ' + siteHit.surface + '. ' + siteHit.hazard + '.';
      tooltip.append(heading, body);
      tooltip.style.left = (endPosition.x + 18) + 'px';
      tooltip.style.top = (endPosition.y - 54) + 'px';
      tooltip.hidden = false;
      return;
    }
    const m=roverMission;
    let title=id,detail='Settlement asset · operational';
    if(/^crew\d+$/.test(id)){
      const index=Number(id.slice(4)),v=m&&index<m.cfg.crew?vitals(m,index):null;
      title=v?.name||`Crew ${index+1}`;
      detail=v?`${v.status} · ${v.pulse} bpm · SpO₂ ${v.spo2}%`:'Crew telemetry pending';
    } else if(id==='Rover')detail=m?(m.active.rover?'Disabled':'Operational')+` · ${Math.round((m.roverEnergy??2.4)/2.4*100)}% battery`:'Rover telemetry pending';
    else if(id==='Habitat')detail=m?(m.active.oxygen?'Oxygen system failure':'Operational')+` · ${Math.round(m.integrity??100)}% integrity`:'Habitat telemetry pending';
    else if(id.startsWith('Solar '))detail=m?.active.solar?'Array failure':'Solar array operational';
    tooltip.replaceChildren();
    const heading=document.createElement('strong'),body=document.createElement('span');
    heading.textContent=title;body.textContent=detail;tooltip.append(heading,body);
    tooltip.style.left=`${endPosition.x+18}px`;tooltip.style.top=`${endPosition.y-54}px`;
    tooltip.hidden=false;
  },C.ScreenSpaceEventType.MOUSE_MOVE);
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
    showGlobe();
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
    showGlobe();
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
        minimumPixelSize: file.startsWith("passage-") ? 0 : file === "field-suit" ? 12 : file === "solar" ? 5 : 0,
        maximumScale: file === "field-suit" ? 2 : undefined,
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
        heightReference: C.HeightReference.NONE,
        imageBasedLightingFactor: new C.Cartesian2(0.95, 1),
      },
    });
  }
  const tunnelShape = Array.from({ length: 12 }, (_, i) => {
    const angle = i * Math.PI / 11;
    return new C.Cartesian2(Math.cos(angle) * 1.1 * layout.scale,
      Math.sin(angle) * 1.7 * layout.scale);
  });
  function passage(id, x1, y1, x2, y2) {
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length < 0.05) return;
    // Extend the profile into the joints so perpendicular and diagonal runs meet.
    const dx = (x2 - x1) * 0.55 / length;
    const dy = (y2 - y1) * 0.55 / length;
    base.entities.add({
      id,
      polylineVolume: {
        positions: [local(x1 - dx, y1 - dy), local(x2 + dx, y2 + dy)],
        shape: tunnelShape,
        material: C.Color.fromCssColorString('#aeb6bd'),
        cornerType: C.CornerType.MITERED,
      },
    });
  }
  function view(preset = "Overview", astronaut = 0) {
    if (!placed) return;
    if (actors.cameraMode(preset, astronaut)) {
      roverFollow = false;
      return;
    }
    roverFollow = preset === "Rover";
    scene.screenSpaceCameraController.enableInputs = !roverFollow;
    camera.cancelFlight();
    if (roverFollow) return;
    const overhead = preset === "Overview" || preset === "Tactical";
    camera.flyToBoundingSphere(new C.BoundingSphere(local(0, 0, 2), 1), {
      duration: overhead ? 0 : duration(),
      offset: new C.HeadingPitchRange(Math.PI, overhead ? -1.12 : -0.65,
        preset === "Overview" ? 270 : preset === "Tactical" ? 125 : 34),
    });
  }
  function loadSettlementPhoto(s) {
    surface.entities.removeAll();
    const photo = new Image();
    const imagePath = '/assets/mission/' + (tiles[s.id] ? s.id : 'atacama') + '-ground.jpg';
    const rectangle = {
      coordinates: C.Rectangle.fromCartesianArray([local(-215, -215), local(215, 215)]),
      height: -0.8,
      material: C.Color.fromCssColorString('#716353'),
    };
    const entity = surface.entities.add({ rectangle });
    photo.onload = () => {
      if (surface.entities.contains(entity)) entity.rectangle.material = new C.ImageMaterialProperty({ image: photo });
    };
    photo.src = imagePath;
  }
  let groundLayer;
  let groundSite='';
  // A closed survey loop east of the settlement keeps the rover clear of the
  // habitat and gives the chase camera a continuous, fluid route.
  const roverPath = [
    [85, 0], [105, -30], [135, -35], [155, -10],
    [155, 35], [120, 50], [90, 30], [85, 0],
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
    roverDistance = 0;
    roverFollow = false;
    roverDriving = false;
    roverLastFrame = performance.now();
    site = s;
    scene.globe.show = false;
    scene.skyAtmosphere.show = false;
    scene.sun.show = false;
    scene.highDynamicRange = false;
    viewer.shadows = false;
    loadSettlementPhoto(s);
    placedSignature=signature;
    placed = true;
    pins.show = false;
    fires.show = false;
    base.entities.removeAll();
    itinerary.entities.removeAll();
    model("Habitat", "habitat", 0, 0);
    model("Airlock seals", "passage-ew", 8, 0, 0.55);
    model("Thermal regulation", "recycler", -7, 6, 0.55);
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
    const extraModels={storage:['logistics',-32,-18],comms:['comms',34,-12],landing:['kestrel',72,-22],recycler:['recycler',-30,-9],lab:['laboratory',58,38],habitat:['habitat',-30,35],medical:['medical',-30,-32],solar:['solar',-42,35]};
    const links={storage:[[-10,-16,-26,-16],[-26,-16,-26,-18]],recycler:[[-18,-9,-25,-9]],lab:[[40,26,40,38],[40,38,54,38]],habitat:[[-10,22,-10,35],[-10,35,-24,35]],medical:[[-10,-16,-10,-32],[-10,-32,-26,-32]]};
    for(const key of c.addedFacilities||[]){const item=extraModels[key];if(item){model('Extra '+key,...item);for(const [index,segment] of (links[key]||[]).entries())passage('Extra '+key+' corridor '+index,...segment)}}
    if (c.rover) model("Rover", "rover", 85, 0, undefined, 1.05);
    for (let i = 0; i < c.crew; i++) {
      model("crew" + i, "field-suit", -3 + i * 1.6, -5 + (i % 2) * 1.3);
      base.entities.getById("crew" + i).point = new C.PointGraphics({
        pixelSize: 7,
        color: C.Color.CYAN,
        outlineColor: C.Color.BLACK,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new C.DistanceDisplayCondition(35, 500),
      });
    }
    for (let i = 0; i < 4; i++)
      model("Solar " + i, "solar", 6 + (i % 2) * 4.5, 9 + Math.floor(i / 2) * 4.2);
    model("Communications", "comms", -5, 13);
    view();
    setFacilities(c.facilities || {});
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
    actors.sync(m, rate);
    roverMission = m;
    roverDriving = Boolean(
      rate > 0 &&
      m.traverse &&
      m.outcome === "In progress" &&
      !unavailable(m, "rover") &&
      !m.active.storm &&
      (m.environment?.wind ?? 0) < 25 &&
      (!unavailable(m, "comms") || m.mitigated?.autonomy)
    );
    let greenhouse = base.entities.getById("Constructed greenhouse");
    if (m.construction >= 4 && !greenhouse)
      model("Constructed greenhouse", "laboratory", -34, 20);
    setFacilities(m.cfg.facilities||{});
    const coating = C.Color.fromCssColorString('#b88b62');
    for (const entity of base.entities.values) {
      const id = equipmentForModel(entity.id);
      if (!id || !entity.model) continue;
      entity.model.color = unavailable(m, id)
        ? orange
        : C.Color.lerp(C.Color.WHITE, coating, condition(m, id).dust, new C.Color());
    }
    const crew = base.entities.getById('crew0');
    if (crew) crew.model.color = m.health ? orange : C.Color.WHITE;
    const w = weather(m);
    scene.light.intensity = 2 * w.transmission;
    scene.fog.density = 0.0002 + w.tau * 0.0012 + w.cloud * 0.001;
    scene.fog.minimumBrightness = Math.max(0.04, 0.25 * w.transmission);
  }
  scene.preUpdate.addEventListener(() => {
    if (!placed) return;
    const now = performance.now();
    const delta = Math.min((now - roverLastFrame) / 1000, 3);
    roverLastFrame = now;
    if (roverDriving) roverDistance = (roverDistance + delta * 8.5) % roverLength;
    const rover = base.entities.getById("Rover");
    if (!rover) return;
    if (!roverDriving && !roverFollow) return;
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
    const ground = 0;
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
      renderQuality = mode;
      scene.msaaSamples = mode === "High" ? 2 : 1;
      viewer.resolutionScale =
        mode === "High"
          ? Math.min(devicePixelRatio, 1.5, Math.sqrt(3600000 / (innerWidth * innerHeight)))
          : mode === "Performance"
            ? 0.7
            : Math.min(devicePixelRatio||1,1.15,Math.sqrt(3000000/Math.max(1,innerWidth*innerHeight)));
      viewer.targetFrameRate = 30;
      viewer.shadows = !placed && mode !== "Performance";
      scene.postProcessStages.fxaa.enabled = mode === "High";
      scene.globe.maximumScreenSpaceError =
        mode === "High" ? 1.8 : mode === "Performance" ? 5 : 2.5;
      scene.globe.tileCacheSize = mode === "Performance" ? 150 : 220;
    },
    skip: () => camera.completeFlight(),
    detach: actors.reset,
    overview,
    inspect,
    preview,
    place,
    view,
    orbit(direction) {
      if (!placed) return;
      actors.cameraMode("Overview");
      roverFollow = false;
      camera.cancelFlight();
      const target = local(0, 0, 2);
      const range = C.Math.clamp(C.Cartesian3.distance(camera.positionWC, target), 65, 440);
      camera.lookAt(target, new C.HeadingPitchRange(camera.heading + direction * Math.PI / 4, -0.85, range));
      camera.lookAtTransform(C.Matrix4.IDENTITY);
    },
    resize(){viewer.resize();scene.requestRender();},
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
            disableDepthTestDistance:Number.POSITIVE_INFINITY,
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
