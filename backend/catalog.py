"""Static mission and data-provider catalogs."""

PHASES = [
    {
        "id": "phase-1",
        "name": "Robotic Remote Reconnaissance & Navigation Mapping",
        "objective": "Map terrain roughness, identify hidden surface fissures, and test autonomous hazard avoidance under low-illumination polar conditions.",
        "roles": ["Remote Operations Commander", "Autonomous Systems Engineer"],
        "equipment": [
            {
                "id": "scout-rover",
                "name": "Navigational Scout Rovers",
                "description": "LiDAR and optical hazard-detection software; tested for slip resistance on loose, frost-heaved basalt scree.",
            },
            {
                "id": "solar-drone",
                "name": "Solar-autonomous drone units",
                "description": "Aerial mapping capability under high-latitude magnetic anomalies.",
            },
        ],
    },
    {
        "id": "phase-2",
        "name": "Subsurface Exploration & Lava Tube Integrity Analysis",
        "objective": "Verify whether subsurface basalt tubes can shield equipment and crew from radiation and thermal swings.",
        "roles": ["Subsurface Geologist", "Geotechnical Engineer"],
        "equipment": [
            {
                "id": "gpr-seismic-array",
                "name": "Ground-Penetrating Radar and high-frequency seismic nodal arrays",
                "description": "Map roof thickness and structural stability of underground basalt caverns.",
            },
            {
                "id": "borehole-probe",
                "name": "Tethered borehole inspection probes",
                "description": "Sample wall-rock mineralogy and look for trapped volatiles.",
            },
        ],
    },
    {
        "id": "phase-3",
        "name": "In-Situ Resource Utilization (ISRU) & Water Extraction",
        "objective": "Extract and quantify water locked within permafrost-bound basalt matrices.",
        "roles": ["ISRU Systems Specialist", "Chemical Process Engineer"],
        "equipment": [
            {
                "id": "cryogenic-drill",
                "name": "Cryogenic drilling rigs",
                "description": "Designed to operate in sub-freezing, abrasive basalt matrices.",
            },
            {
                "id": "thermal-tent",
                "name": "Thermal-tent melting enclosures",
                "description": "Test closed-loop water filtration and extraction yields from ice-rich permafrost.",
            },
        ],
    },
    {
        "id": "phase-4",
        "name": "Human EVA Operations & Habitat Integration",
        "objective": "Evaluate crew fatigue, life-support umbilical management, and tool dexterity in heavy pressurized gloves under extreme cold and wind.",
        "roles": ["Commander", "EVA Specialist 1 (Science Lead)", "EVA Specialist 2 (Systems/Maintenance)"],
        "equipment": [
            {
                "id": "eva-suit-exoskeleton",
                "name": "Simulated pressurized spacesuits / mobility exoskeletons",
                "description": "Include thermal-regulation telemetry.",
            },
            {
                "id": "inflatable-airlock",
                "name": "Deployable inflatable habitat airlock modules",
                "description": "Test rapid ingress/egress in high wind and low visibility, including storm-like conditions.",
            },
        ],
    },
]

RESOURCES = [
    {
        "id": "pds",
        "name": "NASA Planetary Data System (PDS)",
        "url": "https://pds.nasa.gov/",
        "discovery_url": "https://pds.nasa.gov/services/search/",
        "protocols": ["REST search", "web catalog"],
        "use": "Planetary mission geology, mineralogy, atmosphere, surface, and subsurface datasets.",
        "integration": "Use the PDS Search API/catalog to discover products; resolve a specific search endpoint and response schema when mission targets and query terms are selected.",
    },
    {
        "id": "earthdata-gibs",
        "name": "NASA Earthdata / Global Imagery Browse Services (GIBS)",
        "url": "https://www.earthdata.nasa.gov/",
        "discovery_url": "https://www.earthdata.nasa.gov/about/science-system-description/eosdis-components/global-imagery-browse-services-gibs",
        "service_url": "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi",
        "capabilities_url": "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/getCapabilities.xml",
        "protocols": ["WMTS", "WMS", "TWMS"],
        "use": "Earth analog imagery and environmental context, including ice, dust, wind, and surface conditions.",
        "integration": "Discover available imagery layers and dimensions from the WMTS capabilities document; GIBS provides Earth observations, not planetary basemaps.",
    },
    {
        "id": "usgs-astrogeology",
        "name": "USGS Astrogeology Science Center / Astropedia",
        "url": "https://astrogeology.usgs.gov/",
        "discovery_url": "https://astrogeology.usgs.gov/search",
        "catalog_api_url": "https://stac.astrogeology.usgs.gov/api/",
        "protocols": ["WMS", "STAC API", "OGC APIs"],
        "use": "Planetary terrain models, elevation, craters, lava tube mapping, and surface materials.",
        "integration": "Use the documented catalog APIs for metadata search and service-specific map endpoints for raster layers.",
    },
    {
        "id": "ahed",
        "name": "NASA Astrobiology Habitable Environments Database (AHED)",
        "url": "https://ahed.nasa.gov/",
        "discovery_url": "https://ahed.nasa.gov/help/faq",
        "protocols": ["web catalog", "programmatic API"],
        "use": "Extremophile, biosignature, environmental-extreme, and habitability datasets.",
        "integration": "AHED documents programmatic analysis through an API; select the dataset and access method before binding a concrete endpoint or authentication flow.",
    },
    {
        "id": "nasa-trek",
        "name": "NASA Trek Tools / Planetary Trek",
        "url": "https://trek.nasa.gov/",
        "discovery_url": "https://trek.nasa.gov/tiles/apidoc/",
        "protocols": ["WMTS", "REST tile services"],
        "use": "Planetary terrain visualization and landing-site analysis; services expose body-specific map layers.",
        "integration": "Discover body, layer, projection, and tile-matrix details from the service documentation/capabilities before constructing tile requests.",
    },
]

PHASE_BY_ID = {phase["id"]: phase for phase in PHASES}
EQUIPMENT_BY_ID = {
    equipment["id"]: (phase, equipment)
    for phase in PHASES
    for equipment in phase["equipment"]
}
