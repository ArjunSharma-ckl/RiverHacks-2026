import * as C from 'cesium';

export const THERMAL = 'Thermal anomalies';
export function thermalLayer(viewer, list) {
  let request, collection, alpha = 0.95;
  const credit = new C.Credit('NASA FIRMS · NOAA-20 VIIRS daytime detections',true);
  function clear() {
    request?.abort();
    if (collection) viewer.scene.primitives.remove(collection);
    collection = undefined;
    viewer.scene.frameState.creditDisplay.removeStaticCredit(credit);
  }
  function opacity(value) {
    alpha = value;
    if (!collection) return;
    const color = C.Color.ORANGERED.withAlpha(alpha);
    for (let i=0;i<collection.length;i++) collection.get(i).color = color;
  }
  return {
    clear, opacity,
    async load(date) {
      clear();
      list.visible(true,THERMAL);
      list.populate([],THERMAL);
      list.message('Loading global NASA FIRMS detections…',THERMAL);
      const current = request = new AbortController();
      try {
        const r = await fetch('/api/nasa/thermal-points?date='+date,{signal:current.signal});
        if (!r.ok) throw new Error('Unavailable');
        const {points} = await r.json();
        if (current.signal.aborted) return;
        collection = viewer.scene.primitives.add(new C.PointPrimitiveCollection());
        const color = C.Color.ORANGERED.withAlpha(alpha);
        const items = points.map(([lat,lon,time,brightness,power,confidence],i) => {
          const latitude = Number(lat), longitude = Number(lon);
          collection.add({id:{thermal:i},position:C.Cartesian3.fromDegrees(longitude,latitude,500),
            pixelSize:4,color});
          return {id:i,fire:true,category:THERMAL,latitude,longitude,brightness,power,confidence,
            title:latitude.toFixed(3)+'°, '+longitude.toFixed(3)+'° · '+time.slice(0,2)+':'+time.slice(2)+' UTC',
            date:date+'T'+time.slice(0,2)+':'+time.slice(2)+':00Z',
            sources:[{id:'NASA FIRMS fire map',url:'https://firms.modaps.eosdis.nasa.gov/map/#d:'+date+';@'+lon+','+lat+',9z'}]};
        });
        viewer.scene.frameState.creditDisplay.addStaticCredit(credit);
        list.populate(items,THERMAL);
      } catch(error) {
        if (current.signal.aborted) return;
        list.message('NASA FIRMS detections are unavailable for '+date+'.',THERMAL);
        throw error;
      }
    }
  };
}
