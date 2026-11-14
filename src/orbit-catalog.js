import { mission } from './catalog-search.js';
import * as C from 'cesium';
import { propagate, gstime, eciToEcf, twoline2satrec } from 'satellite.js';

export function addCatalog(viewer, fleet) {
  const featuredIds = ['27424','25994','37849','39574','49260','20580','25544'];
  const cloud = viewer.scene.primitives.add(new C.PointPrimitiveCollection());
  const worker = new Worker(new URL('./orbits.worker.js', import.meta.url), {type:'module'});
  const nearby = new Map();
  let points = [], ready = false, last = -Infinity;
  const color = C.Color.fromCssColorString('#b5ced9').withAlpha(0.68);
  const lines = fetch('/data/active.tle').then(r => r.text()).then(text => text.trim().split(/\r?\n/));
  async function position(index) {
    const tle = await lines;
    const record = twoline2satrec(tle[index*3+1], tle[index*3+2]);
    return new C.CallbackPositionProperty((time, result) => {
      const date = C.JulianDate.toDate(time);
      const state = propagate(record,date);
      if (!state?.position) return undefined;
      const p = eciToEcf(state.position,gstime(date));
      return C.Cartesian3.fromElements(p.x*1000,p.y*1000,p.z*1000,result);
    },false);
  }
  worker.onmessage = async ({data}) => {
    if (data.names) {
      fleet.contacts = data.names.map(([name,norad],catalogIndex) => ({name,norad,catalogIndex,job:mission(name)}));
      points = data.names.map(([name,id],index) => {
        const featured = featuredIds.indexOf(id);
        if (featured >= 0) {
          position(index).then(p => {
            fleet.entities[featured].position = p;
            fleet.entities[featured].orientation = new C.VelocityOrientationProperty(p);
          });
          return null;
        }
        return cloud.add({ id:fleet.contacts[index], color,pixelSize:2,show:false });
      });
    } else {
      const p = new C.Cartesian3();
      points.forEach((point,i) => {
        const c = fleet.contacts[i];
        c.speed = data.speeds[i];
        if (c.speed) {
          const geo=C.Cartographic.fromCartesian(C.Cartesian3.unpack(data.xyz,3*i,p));
          c.lat=C.Math.toDegrees(geo.latitude); c.lon=C.Math.toDegrees(geo.longitude); c.alt=geo.height/1000;
        }
        if (!point) return;
        point.show = Number.isFinite(data.xyz[3*i]);
        const close = point.show && /^STARLINK/i.test(c.name) && viewer.trackedEntity?.name !== c.name &&
          C.Cartesian3.distanceSquared(viewer.camera.positionWC,p) < 3000 ** 2;
        if (close && !nearby.has(i)) {
          const entity = viewer.entities.add({name:c.name,position:C.Cartesian3.clone(p),
            model:{uri:'/models/starlink.glb',minimumPixelSize:18,distanceDisplayCondition:new C.DistanceDisplayCondition(0,3000)}});
          entity.catalogContact=c;
          nearby.set(i,entity);
        }
        if (close) nearby.get(i).position=C.Cartesian3.clone(p);
        else if (nearby.has(i)) {viewer.entities.remove(nearby.get(i));nearby.delete(i);}
        if (point.show) point.position = C.Cartesian3.clone(p);
      });
    }
    fleet.refreshSearch?.();
    ready = true;
  };
  worker.postMessage({init:true});
  viewer.scene.preUpdate.addEventListener(() => {
    cloud.show = fleet.visible;
    if (!cloud.show && nearby.size) { for (const entity of nearby.values()) viewer.entities.remove(entity); nearby.clear(); }
    if (!ready || !cloud.show || performance.now()-last < 2200) return;
    ready = false; last = performance.now();
    worker.postMessage({time:C.JulianDate.toDate(viewer.clock.currentTime).getTime()});
  });
  let target;
  return async contact => {
    const featured=featuredIds.indexOf(contact.norad);
    if (featured>=0) {fleet.track(fleet.entities[featured]);return;}
    const p = await position(contact.catalogIndex);
    if (target) viewer.entities.remove(target);
    target = viewer.entities.add({name:contact.name,position:p,viewFrom:new C.Cartesian3(-120,-160,90),
      orientation:new C.VelocityOrientationProperty(p),
      model:/^STARLINK/i.test(contact.name) ? { uri:'/models/starlink.glb',minimumPixelSize:54,distanceDisplayCondition:new C.DistanceDisplayCondition(0,3000) } : undefined,
      point:{pixelSize:5,color,distanceDisplayCondition:new C.DistanceDisplayCondition(/^STARLINK/i.test(contact.name)?3000:0,Infinity)},label:{text:contact.name,font:'12px sans-serif',pixelOffset:new C.Cartesian2(0,-18)}});
    fleet.track(target);
  };
}
