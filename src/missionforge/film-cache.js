// The Blender launch film is large, so it is fetched once when the site opens
// and kept in the browser cache. Later launches play from that stored copy
// instead of downloading it again or waiting on the network.
const FILM = "/cinematics/mission-launch-1080p.mp4";
const CACHE = "missionforge-media-v1";

async function openCache() {
  if (typeof caches === "undefined") return null;
  try {
    return await caches.open(CACHE);
  } catch {
    return null;
  }
}

export async function warmFilm() {
  const cache = await openCache();
  if (!cache) return false;
  try {
    const stored = await cache.match(FILM);
    if (stored) return true;
    const response = await fetch(FILM, { cache: "force-cache" });
    if (!response.ok) return false;
    await cache.put(FILM, response.clone());
    return true;
  } catch {
    return false;
  }
}

export async function filmSource() {
  const cache = await openCache();
  if (cache) {
    try {
      const stored = await cache.match(FILM);
      if (stored) {
        const blob = await stored.blob();
        if (blob.size > 0) return URL.createObjectURL(blob);
      }
    } catch {}
  }
  return FILM;
}
