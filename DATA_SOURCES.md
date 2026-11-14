# MissionForge data sources

| Input | Provenance and use |
| --- | --- |
| Climate normals | Six unmodified NASA POWER point responses in `public/data`, including coordinates, monthly values, units, sources and the January 2001–December 2025 period. The ranker uses annual T2M, PRECTOTCORR and ALLSKY_SFC_SW_DWN. Meteorology includes MERRA-2 reanalysis. Grid values describe a region. [NASA POWER](https://power.larc.nasa.gov/) |
| Daily surface profile | The existing server route queries the most recent available daily sample in its lookback window. The inspection panel reports its actual date. |
| Global imagery | Bundled Earth texture, NASA GIBS Blue Marble, and Esri World Imagery at regional scale. [NASA GIBS](https://www.earthdata.nasa.gov/data/tools/gibs) |
| Elevation and slope | Three Cesium world-terrain samples spaced approximately 30 m apart. Slope is a finite-difference estimate. Without terrain access the app reports unavailable. |
| FireWatch | Optional FIRMS observations during the previous day in a 10-degree regional box, capped at 500 rows. Sensor, acquisition time, position and raw confidence come from the feed. An empty response provides no assurance of safety. [FIRMS](https://firms.modaps.eosdis.nasa.gov/) |
| Events | The existing EONET route returns up to 200 open events in 45 days. The inspector selects those within 500 km. [EONET](https://eonet.gsfc.nasa.gov/) |
| Site evidence | Catalog entries link to the NASA Planetary Analog Explorer, Astrobiology Field Sites, NASA Technical Reports Server or HI-SEAS. Coordinates identify representative study locations. Access scores are editorial estimates and confer no permission to enter sites. |
| Search | Optional server-side SerpApi search returns source-linked excerpts from NASA, USGS and ESA. The field research reference works independently. |

To reproduce a catalog record, use the site's coordinates in the [POWER climatology point endpoint](https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M,PRECTOTCORR,ALLSKY_SFC_SW_DWN,RH2M,WS2M,PS&community=RE&longitude=-69.86&latitude=-24.09&format=JSON). Retain metadata when updating the data period.

Suitability is a MissionForge weighted mean on a 0–100 scale. Climate combines precipitation and distance from a mission-dependent temperature target. Solar saturates at 7.5 kWh/m²/day. Profiles and query terms change component weights. Missing fields are excluded from the mean. Operational hazard information is presented alongside the ranking. Scores do not establish site safety or constitute NASA validation.

GroundTruth routes /api/research/site, incident, logistics, news and medical-support use cached SerpApi responses. Site queries use Scholar, news uses Google News, and other categories use Google Search. Returned links are filtered to NASA, USGS, ESA, NIH, CDC and NOAA. Excerpts are displayed as evidence. Automated clinical conclusions and automatic changes to simulation state are outside this feature.
