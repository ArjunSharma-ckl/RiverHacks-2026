# Asset credits

| Local file | Publisher and original |
| --- | --- |
| public/models/mission/habitat.glb and habitat2.glb | NASA/LaRC/Advanced Concepts Lab, [Habitat Demonstration Unit](https://science.nasa.gov/3d-resources/habitat-demonstration-unit/), parts 1 and 2 |
| public/models/mission/crew.glb | DigitalSpace Corporation via NASA Science, [Astronaut](https://science.nasa.gov/3d-resources/astronaut/) |
| public/models/mission/rover.glb | NASA/Jet Propulsion Laboratory, [Mars 2020 Perseverance Rover](https://science.nasa.gov/3d-resources/mars-2020-perseverance-rover/) |
| public/assets/mission/*.jpg | Representative regional imagery from [Esri World Imagery](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer), Esri and imagery contributors. Each thumbnail uses a bounding box centered on the listed coordinates. |
| Earth, planets and orbital models | Existing repository assets and attributions retained in the Orbital explorer. |
| Forge mark, array supports, solar banks and communications mast | Original MissionForge graphics and schematic geometry. |

NASA distributes the GLBs through its [3D Resources library](https://science.nasa.gov/3d-resources/). Educational and informational media use is subject to the [NASA media guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/) and applicable third-party rights. Credits do not imply endorsement. Model geometry is preserved with a wrapper transform for approximate physical scale and a ground-aligned origin. The two habitat parts are staged as separate training modules. Models are requested when a base is established.
The habitat shells use opaque materials with their original texture maps for Cesium compatibility. Ground patches use georeferenced World Imagery tiles at available levels 13–18. Their geographic bounds are stored with the scene.

The field suit, water reclamation plant, medical bay, geology laboratory and logistics depot are original MissionForge glTF models. Rebuild them with `node scripts/build-station-models.mjs`. The articulated suit provides the moving mission crew. The original NASA astronaut remains in the asset library.

The launch film opens with actual Artemis I launch imagery and pad audio from NASA Kennedy Space Center. The ascent and transfer use NASA Marshall Space Flight Center’s SLS and Orion visualization. The edit depicts an illustrative expedition. Kestrel, its landing, the boarding ramp, environment lighting, effects and additional sound design are original MissionForge production assets. The landing uses the field suit, habitat, rover and representative terrain imagery credited above. See the [cinematic production notes](cinematic-source/README.md) for source identifiers and edit points.
