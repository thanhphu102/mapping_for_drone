// OpenStreetMap base map tile configuration.
//
// The backend proxies the public OSM standard tile server at
// `/api/tiles/osm/{z}/{x}/{y}.png` (see backend/app/routers/tiles.py). OSM
// standard raster tiles serve up to zoom level 19.

export const OSM_SOURCE_ID = 'osm'
export const OSM_LAYER_ID = 'osm-tiles'
export const OSM_RASTER_MAX_ZOOM = 19
export const OSM_TILE_URL = '/api/tiles/osm/{z}/{x}/{y}.png'
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors'
