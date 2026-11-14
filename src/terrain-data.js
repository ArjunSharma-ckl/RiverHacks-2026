let catalogPromise;

export async function loadTerrainGrid(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Terrain data unavailable.');
  return response.json();
}

export function loadEarthCatalog() {
  catalogPromise ??= loadTerrainGrid('/analogs/terrain/catalog.json').catch(error => {
    catalogPromise = undefined;
    throw error;
  });
  return catalogPromise;
}

export function validateTerrainGrid(grid) {
  if (!Number.isInteger(grid?.size) || grid.size < 33 || grid.size > 129 ||
      !Array.isArray(grid.values) || grid.values.length !== grid.size ** 2 ||
      !grid.values.every(Number.isFinite) ||
      !Number.isFinite(grid.widthMetres) || grid.widthMetres <= 0 ||
      !Number.isFinite(grid.heightMetres) || grid.heightMetres <= 0) {
    throw new Error('Use a square grid with finite elevations in metres, 33–129 samples per side, and positive widthMetres and heightMetres.');
  }
  if (grid.size === 65) return grid;
  const values = Array.from({ length: 65 ** 2 }, (_, i) => {
    const x = (i % 65) * (grid.size - 1) / 64;
    const y = Math.floor(i / 65) * (grid.size - 1) / 64;
    const col = Math.min(Math.floor(x), grid.size - 2);
    const row = Math.min(Math.floor(y), grid.size - 2);
    const at = row * grid.size + col;
    const top = grid.values[at] + (x - col) * (grid.values[at + 1] - grid.values[at]);
    const bottom = grid.values[at + grid.size] + (x - col) * (grid.values[at + grid.size + 1] - grid.values[at + grid.size]);
    return top + (y - row) * (bottom - top);
  });
  return { ...grid, size: 65, values };
}
