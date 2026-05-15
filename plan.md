You are helping implement a MapLibre + OpenStreetMap + PostgreSQL/PostGIS spatial drawing system.

This system is not only an indoor building map editor. It is a Spatial / Drone Mission Map Editor that supports both outdoor regions and indoor buildings.

The app should support drawing custom maps for:
- agricultural fields
- crop areas
- campus areas
- parking areas
- industrial areas
- outdoor regions
- buildings
- multi-floor indoor maps
- mixed outdoor + indoor environments

The main use case is:
A drone may operate in a large outdoor area such as a rice field, campus, or industrial zone. It may also need to work around or inside buildings. Therefore, the system must support both region-level mapping and building-level mapping.

Architecture decision:
- Use MapLibre for rendering the main map and drawing workspace.
- Use OpenStreetMap only as the source of base boundary/reference data.
- Use PostgreSQL + PostGIS as the source of truth for all custom drawing data.
- Use Turf.js or equivalent on frontend for instant geometry validation and measurement feedback.
- Use backend + PostGIS validation as the final source of truth.
- Do not use ArcGIS for the core implementation.

Important design rules:
1. Never modify OpenStreetMap data directly.
2. OSM data is only used as a base boundary/reference.
3. All custom drawing data must be stored in PostgreSQL/PostGIS.
4. Frontend state is temporary only.
5. Support both OSM ways and relations:
   - /api/0.6/way/{id}/full.json
   - /api/0.6/relation/{id}/full.json
6. Do not hard-code only "way".
7. GeoJSON coordinates must use [lng, lat], not [lat, lng].
8. Only Polygon or MultiPolygon can be used as drawable base boundary.
9. Reject node-only, line-only, non-closed, invalid geometry.
10. Normalize base boundary to MultiPolygon where possible.
11. Every custom feature must stay inside the selected base boundary.
12. Frontend validates instantly, but backend/PostGIS must validate again before saving.
13. Published custom maps should appear as overlay layers on the main MapLibre map only when zoomed in enough.
14. Multi-floor buildings must support floor selection.
15. Outdoor region projects should not show floor selector by default.
16. Building/indoor projects should show floor selector when multiple floors exist.
17. Large outdoor regions are supported, but extremely large administrative boundaries should show warning or require confirmation.

Existing current app context:
- The app already has a MapLibre map.
- User can click a position on the map.
- The app can get target coordinate lat/lon.
- The app already has a "Fetch location" flow.
- After fetching, the right panel shows OSM enclosing elements.
- Each OSM element includes osmType, osmId, name, tags, and sometimes nodes.
- The terminal currently prints selected OSM information like:

===== OSM SELECTION =====
Type: way
ID: 1303838982

Tags:
addr:city = Hồ Chí Minh
amenity = university
name = Trường Đại học Công nghệ Thông tin
name:en = University of Information Technology
operator = Đại học Quốc gia Thành phố Hồ Chí Minh

Nodes:
1. node ... lat=... lon=...

Raw payload summary:
elements_total=10
nodes=9 ways=1 relations=0
=========================

This selected OSM information is useful. However:
- Printed nodes are only for debugging.
- Geometry must be built using the target way.nodes order, not arbitrary printed node order.
- For a way, create a nodeMap from node id to coordinate.
- Iterate through the target way.nodes array.
- Convert each node to GeoJSON coordinate order [lon, lat].
- Check that the polygon ring is closed.
- If valid, create Polygon or normalize to MultiPolygon.
- Save osmType, osmId, osmTags, and baseGeometry into PostgreSQL/PostGIS.

High-level system flow:
1. User opens the main map.
2. User clicks a position.
3. App gets lat/lon.
4. User clicks "Fetch location".
5. App fetches OSM enclosing elements.
6. Right panel displays OSM elements.
7. User clicks one OSM element card.
8. App sets selectedElement.
9. App highlights selected card.
10. App fetches/builds selected element geometry if needed.
11. App previews selected boundary on the main map.
12. App classifies the selected element into an editorMode.
13. User clicks "Open Spatial Editor" or "Create Drawing Project".
14. Backend creates a DrawingProject from the selected OSM element.
15. Backend fetches full OSM JSON using osmType and osmId.
16. Backend converts OSM JSON into GeoJSON Polygon/MultiPolygon.
17. Backend validates the geometry.
18. Backend stores the DrawingProject in PostgreSQL/PostGIS.
19. Backend creates default floors and layers according to editorMode.
20. Frontend redirects to /spatial-editor/:projectId or /drawing-canvas/:projectId.
21. Editor opens.
22. Editor displays the selected base boundary as a locked layer.
23. User draws custom features inside the boundary.
24. User can inspect coordinates, distances, perimeter, and area.
25. User can add tags/properties to each feature.
26. User can save draft.
27. User can publish.
28. Published drawing appears as overlay on the main map when zoomed in.
29. If the project is a building/indoor project with multiple floors, the floor selector appears and filters visible features.

Conceptual diagram:

Main Map
  ↓ click position
Fetch OSM Enclosing Elements
  ↓ select element
Preview OSM Boundary
  ↓ classify selected element
Create DrawingProject
  ↓ save base boundary to PostgreSQL/PostGIS
Spatial Editor
  ↓ draw custom features
Save Draft / Publish
  ↓
Main Map Overlay
  ↓ zoom in
Show custom map
  ↓ if building/indoor
Floor Selector

Editor mode classification:
When user selects an OSM element, classify it into one of these editorMode values:

editorMode:
- region
- campus
- agriculture
- building
- indoor
- parking
- custom

Classification rules:
1. If tags contain building, set editorMode = building.
2. If tags contain amenity=university, amenity=school, amenity=hospital, or operator:type=university, set editorMode = campus.
3. If tags contain landuse=farmland, landuse=orchard, landuse=meadow, crop, farmyard, or other agricultural-related tags, set editorMode = agriculture.
4. If tags contain amenity=parking, set editorMode = parking.
5. If tags contain natural, landuse, leisure, or a general area tag, set editorMode = region.
6. If user manually draws a boundary, set editorMode = custom.
7. If tags contain boundary=administrative or the polygon is extremely large, show a warning or require confirmation.

Example:
If selected OSM element has:
amenity=university
name=Trường Đại học Công nghệ Thông tin

Then create:
editorMode = campus

Do not treat it as a building indoor project.

Canvas/editor behavior by editorMode:

1. region mode:
Used for general outdoor areas.
Supported features:
- flight_zone
- no_fly_zone
- landing_pad
- takeoff_point
- waypoint
- checkpoint
- obstacle
- survey_area
- road
- path
- sensor
- camera
- charging_station
- custom_area
- custom_line
- custom_point
No floor selector by default.

2. agriculture mode:
Used for fields, rice fields, crop areas, orchards.
Supported features:
- crop_area
- survey_area
- flight_zone
- no_fly_zone
- landing_pad
- takeoff_point
- waypoint
- checkpoint
- obstacle
- irrigation_line
- sensor
- camera
- charging_station
- custom_area
- custom_line
- custom_point
No floor selector by default.

3. campus mode:
Used for universities, schools, hospitals, company campuses, industrial campuses.
Supported features:
- building_footprint
- internal_road
- path
- gate
- parking_zone
- outdoor_poi
- flight_zone
- no_fly_zone
- waypoint
- checkpoint
- obstacle
- route
- landing_pad
- sensor
- camera
- custom_area
Campus projects can contain building features.
A building feature can be linked to a child building/indoor DrawingProject.

4. parking mode:
Used for parking areas.
Supported features:
- parking_slot
- entrance
- exit
- route
- checkpoint
- sensor
- camera
- obstacle
- custom_area
- custom_line
- custom_point

5. building/indoor mode:
Used for building interior maps.
Supported features:
- floor
- room
- wall
- door
- corridor
- stairs
- elevator
- entrance
- exit
- indoor_waypoint
- indoor_route
- restricted_area
- poi
- sensor
- camera
Show floor selector when multiple floors exist.

6. custom mode:
Used when user manually draws a boundary.
Allow user to choose feature types manually.

Default layers by editorMode:

For region/agriculture:
- Base Boundary
- Flight Zones
- No-Fly Zones
- Routes
- Waypoints
- Obstacles
- Landing / Takeoff
- Crop Areas
- Sensors
- POI
- Measurements

For campus:
- Base Boundary
- Buildings
- Internal Roads
- Gates
- Parking
- Flight Zones
- No-Fly Zones
- Routes
- Waypoints
- Obstacles
- POI
- Measurements

For parking:
- Base Boundary
- Parking Slots
- Entrances
- Exits
- Routes
- Checkpoints
- Sensors
- Cameras
- Obstacles
- Measurements

For building/indoor:
- Base Boundary
- Floors
- Rooms
- Walls
- Doors
- Corridors
- Stairs
- Elevators
- Indoor Routes
- POI
- Sensors
- Measurements

Frontend requirements:

Main map:
1. Keep existing fetch-location flow.
2. In the OSM Enclosing Elements panel, make each OSM element card selectable.
3. When user clicks an element card:
   - set selectedElement
   - highlight selected card
   - fetch/build selected element geometry if needed
   - preview selected boundary on the map
   - classify editorMode
   - show detected editor mode
   - show "Open Spatial Editor" button
4. When user clicks "Open Spatial Editor":
   - call POST /api/drawing-projects/from-osm
   - pass osmType and osmId
   - receive projectId
   - navigate to /spatial-editor/:projectId or /drawing-canvas/:projectId

Suggested frontend functions:
- handleSelectOsmElement(element)
- fetchOsmElementGeometry(osmType, osmId)
- renderSelectedBoundaryPreview(geometry)
- classifyOsmElement(tags, area)
- handleOpenSpatialEditor(selectedElement)

Spatial editor:
1. Use MapLibre as the drawing workspace.
2. Load DrawingProject by projectId.
3. Render baseGeometry as locked base boundary.
4. Fit camera to baseGeometry.
5. Render layers and features from backend.
6. Render toolbar according to editorMode.
7. Render layer panel.
8. Render feature property panel.
9. Render coordinate inspector.
10. Render measurement panel.
11. Render floor selector only for building/indoor projects with multiple floors.

Drawing tools:
- Select
- Pan
- Draw Point
- Draw LineString
- Draw Polygon
- Draw Rectangle
- Edit Vertex
- Move Feature
- Delete Feature
- Measure Coordinate
- Measure Distance
- Measure Area
- Save Draft
- Publish

Base boundary behavior:
- Base boundary is always locked.
- User cannot edit it.
- User cannot move it.
- User cannot delete it.
- It is used to validate all custom features.
- It is used to clip/limit the drawing space.

Feature rules:
1. Supported geometry:
   - Point
   - LineString
   - Polygon
2. Every created or edited feature must be checked against the base boundary.
3. If feature is outside the base boundary, reject operation.
4. If user edits a vertex and new geometry goes outside the boundary, rollback to previous valid geometry.
5. Each feature must have editable properties/tags.
6. Tags are metadata/properties.
7. Vertices/nodes are coordinate points.
8. Do not call vertices "tags".

Frontend geometry validation:
Use Turf.js or equivalent:
- Point must be inside base boundary.
- LineString must be fully inside base boundary.
- Polygon must be fully inside base boundary.
- Routes should warn if intersecting obstacles.
- Routes should be rejected or warned if intersecting no_fly_zone.
- Waypoints should stay inside allowed flight zones when flight zones exist.

Possible validation helpers:
- isFeatureInsideBoundary(feature, baseBoundary)
- validatePointInsideBoundary(point, baseBoundary)
- validateLineInsideBoundary(line, baseBoundary)
- validatePolygonInsideBoundary(polygon, baseBoundary)
- validateRouteAvoidsNoFlyZones(route, noFlyZones)
- validateRouteAvoidsObstacles(route, obstacles)
- validateWaypointInsideFlightZone(point, flightZones)

Measurement requirements:
1. Show lat/lon on hover or click.
2. Show lat/lon for selected vertex/node.
3. Calculate LineString length.
4. Calculate Polygon perimeter.
5. Calculate Polygon area.
6. Distance units:
   - cm
   - m
   - km
7. Area units:
   - m²
   - km²
8. Format distance:
   - below 1 meter: show cm
   - 1 meter to below 1000 meters: show m
   - 1000 meters or more: show km
9. Format area:
   - below 1,000,000 m²: show m²
   - 1,000,000 m² or more: show km²

Suggested measurement helpers:
- formatDistance(meters)
- formatArea(squareMeters)
- calculateLineLength(line)
- calculatePolygonPerimeter(polygon)
- calculatePolygonArea(polygon)
- calculateVertexCoordinates(vertex)

Floor support:
1. Floor selector only applies to building/indoor projects.
2. Region/agriculture/campus projects do not show floor selector by default.
3. Campus projects may contain building features.
4. A building feature inside a campus can link to a child building/indoor project.
5. Building/indoor projects may have floors:
   - B2
   - B1
   - 1
   - 2
   - 3
   - etc.
6. A feature can belong to:
   - one floor
   - multiple floors
   - all floors
7. Use floorScope:
   - single
   - multiple
   - all
8. Shared features such as stairs, elevators, entrances, emergency exits, and vertical route connectors can appear across multiple floors.

Parent-child project support:
1. A region/campus project can contain building features.
2. A building feature can be linked to a child DrawingProject.
3. The child DrawingProject uses editorMode = building or indoor.
4. Store parentProjectId on the child project.
5. Store sourceFeatureId if the child project is created from a building feature inside the parent project.

Overlay rendering on main map:
1. Published DrawingProjects appear as custom overlays on the main map.
2. Overlay must not always be visible.
3. Visibility depends on zoom level.
4. Suggested rendering rules:
   - zoom < boundaryMinZoom: hide project completely
   - boundaryMinZoom <= zoom < detailMinZoom: show only project boundary
   - zoom >= detailMinZoom: show custom detail features
   - zoom >= indoorMinZoom: show indoor features for building/indoor projects
5. If building/indoor mode is active and project has multiple floors, show floor selector.
6. When user selects a floor, render only features from that floor.
7. Features from other floors must be hidden.
8. Shared features must remain visible when floorScope is all or selectedFloor is included in feature floors.
9. Hide floor selector when user zooms out below indoorMinZoom.
10. Main map still uses OpenStreetMap as the base map.
11. Custom drawing appears as overlay layers.

MapLibre overlay flow:
1. Listen to map moveend and zoomend events.
2. Get current map bbox.
3. Call GET /api/map-overlays?bbox=minLng,minLat,maxLng,maxLat.
4. Load published projects intersecting current bbox.
5. Render boundary layer when zoom >= boundaryMinZoom.
6. Render custom detail layers when zoom >= detailMinZoom.
7. Render indoor feature layers when zoom >= indoorMinZoom.
8. Show floor selector only for active building/indoor project.
9. Apply MapLibre filters based on selectedProjectId and selectedFloor.
10. Hide indoor layers and floor selector when zooming out.

Backend requirements:

Required APIs:
1. GET /api/osm/elements/{osmType}/{osmId}/geometry
   - Return selected OSM element geometry as GeoJSON.
   - Used for previewing boundary on main map.

2. POST /api/drawing-projects/from-osm
   Payload:
   {
     "osmType": "way" | "relation",
     "osmId": number
   }

   Responsibilities:
   - Fetch full OSM JSON from OSM API.
   - Support both way and relation.
   - Convert OSM JSON into GeoJSON Polygon/MultiPolygon.
   - Validate geometry.
   - Normalize to MultiPolygon if needed.
   - Classify editorMode using tags and geometry size.
   - Insert DrawingProject into PostgreSQL/PostGIS.
   - Insert default floors if needed.
   - Insert default layers based on editorMode.
   - Return projectId.

3. GET /api/drawing-projects/{projectId}
4. GET /api/drawing-projects/{projectId}/floors
5. GET /api/drawing-projects/{projectId}/layers
6. GET /api/drawing-projects/{projectId}/features

7. POST /api/drawing-projects/{projectId}/features
   - Validate geometry is inside project baseGeometry.
   - Validate drone-specific rules when relevant.
   - Calculate measurements.
   - Save feature to PostgreSQL/PostGIS.

8. PUT /api/drawing-features/{featureId}
   - Validate updated geometry.
   - Recalculate measurements.
   - Save update.

9. DELETE /api/drawing-features/{featureId}

10. POST /api/drawing-projects/{projectId}/layers
11. PUT /api/drawing-layers/{layerId}
12. DELETE /api/drawing-layers/{layerId}

13. POST /api/drawing-projects/{projectId}/floors
14. PUT /api/drawing-floors/{floorId}
15. DELETE /api/drawing-floors/{floorId}

16. PUT /api/drawing-projects/{projectId}/save-draft
17. PUT /api/drawing-projects/{projectId}/publish

18. GET /api/map-overlays?bbox=minLng,minLat,maxLng,maxLat
   - Return published projects intersecting current bbox.
   - Include project metadata, floors, layers, and features needed for rendering.

19. POST /api/drawing-projects/{projectId}/features/{featureId}/create-child-project
   - Used when a building feature inside a campus/region project should become a child building/indoor project.
   - Create child DrawingProject with parentProjectId and sourceFeatureId.

OSM parser requirements:
Create OsmGeometryParser or equivalent service.

Methods:
- ParseOsmJsonToGeoJson(osmJson, osmType, osmId)
- ParseWayToPolygon(way, nodes)
- ParseRelationToPolygonOrMultiPolygon(relation, ways, nodes)
- JoinFragmentedWaysIfNeeded()
- NormalizePolygonToMultiPolygon()
- ValidateOsmDrawableBoundary()

Way parsing:
1. Find target way by id.
2. Get target way.nodes.
3. Create nodeMap from node id to node coordinate.
4. Iterate through way.nodes in exact order.
5. Convert each node to [lon, lat].
6. Ensure ring is closed.
7. Convert to GeoJSON Polygon.
8. Normalize to MultiPolygon for database storage.

Relation parsing:
1. Support multipolygon relations.
2. Read relation members.
3. Separate outer and inner ways.
4. Build outer rings.
5. Build inner rings as holes.
6. Join fragmented ways if required.
7. Output Polygon or MultiPolygon.
8. Normalize to MultiPolygon for database storage.

Geometry validation:
Reject selected OSM element if:
- geometry is empty
- geometry is not Polygon or MultiPolygon
- coordinates are invalid
- ring is not closed
- too few coordinates
- geometry is self-intersecting
- geometry cannot be parsed

For large polygons:
- Do not reject large outdoor polygons automatically.
- If polygon is large but reasonable, open region/campus/agriculture editor and show warning.
- If polygon is extremely large administrative boundary, require confirmation or recommend selecting smaller area.

PostgreSQL/PostGIS requirements:
1. Use PostgreSQL as main database.
2. Enable PostGIS extension.
3. Store spatial data with SRID 4326.
4. Store custom map data in PostgreSQL/PostGIS, not only frontend memory.
5. Store tags/properties/styleConfig/measurements as jsonb.
6. Add GiST spatial indexes for geometry columns.
7. Backend/PostGIS validation is source of truth.
8. Use transactions when creating a DrawingProject from OSM.
9. Published overlays must be loaded from PostgreSQL by bbox query.

Database schema concept:

DrawingProject:
- id
- name
- source: openstreetmap | manual
- osmType: way | relation | null
- osmId: bigint | null
- osmTags: jsonb
- baseGeometry: PostGIS MultiPolygon, SRID 4326
- editorMode: region | campus | agriculture | building | indoor | parking | custom
- parentProjectId nullable
- sourceFeatureId nullable
- status: draft | published | archived
- boundaryMinZoom
- detailMinZoom
- indoorMinZoom nullable
- defaultFloorId nullable
- createdBy
- createdAt
- updatedAt
- publishedAt

DrawingFloor:
- id
- projectId
- floorCode
- floorName
- floorOrder
- isDefault
- createdAt
- updatedAt

DrawingLayer:
- id
- projectId
- floorId nullable
- name
- type
- visible
- locked
- minZoom
- maxZoom
- layerOrder
- styleConfig: jsonb
- createdAt
- updatedAt

DrawingFeature:
- id
- projectId
- layerId
- floorId nullable
- featureType
- geometryType: Point | LineString | Polygon
- geometry: PostGIS Geometry, SRID 4326
- properties: jsonb
- tags: jsonb
- measurements: jsonb
- floorScope: single | multiple | all
- floors: optional jsonb array of floor codes or floor ids
- altitudeMin nullable
- altitudeMax nullable
- altitudeUnit default "m"
- childProjectId nullable
- createdAt
- updatedAt

Recommended SQL concepts:
- CREATE EXTENSION IF NOT EXISTS postgis;
- Add GiST index on drawing_projects.base_geometry.
- Add GiST index on drawing_features.geometry.
- Add index on drawing_projects.status.
- Add index on drawing_projects.editor_mode.
- Add index on drawing_projects.parent_project_id.
- Add index on drawing_features.project_id.
- Add index on drawing_features.floor_id.
- Add index on drawing_features.feature_type.

PostGIS validation:
Before insert/update feature:
- Use ST_IsValid to validate geometry.
- Use ST_Covers or ST_Contains to check feature geometry is inside project baseGeometry.
- Use ST_Intersects to detect route intersection with no_fly_zone or obstacles.
- Reject invalid/outside geometry.
- Warn or reject route/no-fly-zone conflicts according to rule.

PostGIS measurement:
Use geography calculations for real-world measurement:
- ST_Length(geometry::geography) for line length
- ST_Perimeter(geometry::geography) for polygon perimeter
- ST_Area(geometry::geography) for polygon area

Store calculated values in measurements jsonb:
{
  "lengthM": number,
  "perimeterM": number,
  "areaM2": number
}

Frontend can calculate measurements for instant feedback, but backend recalculates and stores authoritative values.

Suggested frontend file structure:
src/
  features/
    map/
      MainMap.tsx
      TargetCoordinatePopup.tsx
      OsmEnclosingElementsPanel.tsx
      OsmElementCard.tsx
      osmElementPreview.ts
      osmElementClassifier.ts
      mapSelectionStore.ts
      overlayRenderer.ts
      floorOverlayFilter.ts

    spatial-editor/
      SpatialEditorPage.tsx
      SpatialEditorToolbar.tsx
      LayerPanel.tsx
      FloorSelector.tsx
      FeaturePropertyPanel.tsx
      MeasurementPanel.tsx
      CoordinateInspector.tsx
      EditorModeBadge.tsx
      drawingTools.ts
      drawingValidation.ts
      droneValidation.ts
      measurementUtils.ts
      boundaryUtils.ts

  api/
    osmApi.ts
    drawingProjectApi.ts
    drawingFloorApi.ts
    drawingLayerApi.ts
    drawingFeatureApi.ts
    mapOverlayApi.ts

  types/
    osm.ts
    drawingProject.ts
    drawingFloor.ts
    drawingLayer.ts
    drawingFeature.ts
    geojson.ts

Suggested backend file structure:
Controllers/
  OsmController
  DrawingProjectController
  DrawingFloorController
  DrawingLayerController
  DrawingFeatureController
  MapOverlayController

Services/
  OsmApiClient
  OsmGeometryParser
  OsmElementClassifier
  GeometryValidationService
  MeasurementService
  DroneRuleValidationService
  DrawingProjectService
  DrawingFeatureService
  MapOverlayService

Models/
  DrawingProject
  DrawingFloor
  DrawingLayer
  DrawingFeature

DTOs/
  OsmElementDto
  OsmElementGeometryDto
  CreateDrawingProjectFromOsmRequest
  DrawingProjectDto
  DrawingFloorDto
  DrawingLayerDto
  DrawingFeatureDto
  MapOverlayDto

Implementation phases:

Phase 1: Selected OSM element preview
- Add selectable cards to OSM Enclosing Elements panel.
- Set selectedElement when card clicked.
- Highlight selected card.
- Fetch/build selected element geometry.
- Render boundary preview on main map.
- Classify selected element into editorMode.
- Show detected editor mode.
- Add Open Spatial Editor button.

Phase 2: Create DrawingProject from OSM
- Implement POST /api/drawing-projects/from-osm.
- Fetch full OSM JSON by osmType and osmId.
- Support way and relation.
- Convert OSM JSON to GeoJSON.
- Validate and normalize geometry.
- Classify editorMode.
- Save project to PostgreSQL/PostGIS.
- Create default floors only when needed.
- Create default layers based on editorMode.
- Return projectId.
- Redirect frontend to /spatial-editor/:projectId.

Phase 3: Spatial editor page
- Create SpatialEditorPage.
- Load project, floors, layers, and features.
- Render base boundary as locked layer.
- Fit map to base boundary.
- Render default drawing layers.
- Render editor toolbar according to editorMode.

Phase 4: Drawing tools and boundary validation
- Add drawing tools for point, line, polygon, rectangle.
- Add select/move/edit/delete.
- Validate every create/update against boundary.
- Rollback invalid edits.
- Show error when feature goes outside boundary.

Phase 5: Feature properties and tags
- Add FeaturePropertyPanel.
- Allow editing featureType, name, layer, floor if applicable.
- Allow adding/updating/removing tags.
- Allow altitudeMin/altitudeMax for drone-related features.
- Save properties/tags to backend.

Phase 6: Drone-specific validation
- Ensure all drone features stay inside boundary.
- Ensure route does not intersect no_fly_zone.
- Warn if route intersects obstacle.
- Ensure waypoints stay inside flight zones when flight zones exist.
- Validate again on backend with PostGIS.

Phase 7: Measurement and coordinate tools
- Show lat/lon for hover/click.
- Show vertex coordinates.
- Calculate line length.
- Calculate polygon perimeter.
- Calculate polygon area.
- Format values as cm/m/km and m²/km².
- Backend recalculates authoritative measurements.

Phase 8: Floor support for building/indoor projects
- Add floor CRUD.
- Add floor selector only for building/indoor projects.
- Filter features by selected floor.
- Support shared features using floorScope.

Phase 9: Parent-child project support
- Allow campus/region project to contain building features.
- Allow building feature to become/link to a child building/indoor project.
- Store parentProjectId and sourceFeatureId.
- Allow opening child project editor.

Phase 10: Save draft and publish
- Save all data to PostgreSQL/PostGIS.
- Draft projects must survive browser refresh.
- Publish validates project and sets status=published.
- publishedAt must be set.

Phase 11: Main map overlay rendering
- Load published overlays by bbox.
- Render boundary at boundaryMinZoom.
- Render detail features at detailMinZoom.
- Render indoor features at indoorMinZoom.
- Add floor selector for active building/indoor overlays.
- Apply floor-based filtering.
- Hide overlays/floor selector when zooming out.

Acceptance criteria:
1. Existing fetch-location flow still works.
2. User can fetch OSM enclosing elements from a clicked coordinate.
3. User can select one OSM element.
4. Selected element card is highlighted.
5. Selected element boundary is previewed on the main map.
6. Selected element is classified into editorMode.
7. UIT university OSM element is classified as campus, not building.
8. User can open selected element in Spatial Editor.
9. Spatial Editor shows selected boundary as locked base boundary.
10. Boundary cannot be edited, moved, or deleted.
11. User can draw points, lines, and polygons inside the boundary.
12. User cannot draw or move features outside the boundary.
13. Invalid features are rejected by frontend and backend.
14. User can inspect lat/lon of points and vertices.
15. User can measure real-world distance in cm, m, and km.
16. User can measure polygon perimeter and area.
17. User can add tags/properties to each drawn feature.
18. User can add altitude metadata for drone-related features.
19. Region/agriculture/campus projects support drone mission features.
20. Building/indoor projects support rooms, walls, doors, corridors, floors.
21. Floor selector appears only for multi-floor building/indoor projects.
22. Campus/region projects can contain building features.
23. Building features can link to child building/indoor projects.
24. Data is saved into PostgreSQL/PostGIS.
25. Browser refresh does not lose draft data.
26. User can save draft.
27. User can publish.
28. Published drawing appears as overlay on the main map only when zoomed in.
29. Boundary appears at boundaryMinZoom.
30. Detail features appear at detailMinZoom.
31. Indoor details appear at indoorMinZoom.
32. Selecting a floor immediately updates visible indoor features.
33. Features from other floors are hidden.
34. Shared features such as stairs/elevators can appear across floors.
35. Overlay data is queried from PostgreSQL/PostGIS by bbox.
36. OpenStreetMap data is never modified directly.