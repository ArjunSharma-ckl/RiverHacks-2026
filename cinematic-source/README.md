# MissionForge launch film — native Blender animation

`missionforge-launch.blend` is a 30-second, 900-frame, 30 fps scene in which the
actual 3D objects are animated. There are no video textures, no sequencer strips
and no stock footage in the project: the rocket, boosters, stages, spacecraft,
cameras, lander, crew and flag all move through keyframes on the timeline.

## Spacecraft geometry

| Component | Source |
| --- | --- |
| SLS core stage, solid rocket boosters, upper stage, Orion, launch abort system | [Space Launch System printable model](https://science.nasa.gov/3d-resources/space-launch-system-sls/), NASA 3D Resources |

The NASA printable model is a 1.55-million-triangle, 54-shell STL of the full
stack's outer mold line (the Block 1 CAD download is internal structure only and
has no skin, so it is not used for the visible vehicle). `extract_stl.py`:

1. imports the STL, rotates it to Z-up and scales it to 98 m tall;
2. separates the loose shells, keeping each solid rocket booster (with its feed
   lines) as its own component;
3. slices the single central solid at the real stage interfaces — 63 m core
   stage / upper stage, 77.5 m upper stage / Orion, 86.5 m Orion / LAS;
4. joins the engine-bell shells into the core, decimates for viewport
   performance, re-origins every part at its base and writes
   `sls_components.json` with the measured pivots.

`build_scene.py` mounts those parts under the animated hierarchy:

```
SLS_ROOT
├── CORE_STAGE
│   └── RS25_ENGINES
├── SRB_LEFT
├── SRB_RIGHT
├── UPPER_STAGE
└── ORION
    ├── CREW_MODULE
    ├── SERVICE_MODULE
    ├── SOLAR_ARRAYS   (4 deployable wings)
    └── LAUNCH_ABORT_SYSTEM
```

## Timeline

| Frame | Event | Camera |
| --- | --- | --- |
| 1 | Countdown on the pad | CAM_LAUNCHPAD |
| 40 | RS-25 start, exhaust growth | CAM_LAUNCHPAD |
| 66 | SRB ignition, liftoff, pad smoke | CAM_ASCENT |
| 120–300 | Gravity turn | CAM_ASCENT |
| 196 | Launch abort system jettison | CAM_ASCENT |
| 246 | Booster shutdown and separation | CAM_BOOSTER_SEPARATION |
| 246–560 | Boosters tumble and fall away on separate ballistic arcs | CAM_BOOSTER_SEPARATION |
| 420 | Core stage separation | CAM_ORBIT |
| 440 | Upper stage ignition | CAM_ORBIT |
| 500 | Orion separates from the upper stage | CAM_ORION |
| 530 | Four solar array wings deploy | CAM_ORION |
| 612 | Mars approach | CAM_MARS_APPROACH |
| 646 | Landing legs deploy | CAM_LANDING |
| 700 | Powered descent, dust plume | CAM_LANDING |
| 722 | Touchdown and engine shutdown | CAM_LANDING |
| 748 | Hatch opens, ramp deploys | CAM_ASTRONAUTS |
| 780 | Crew egress and walk | CAM_ASTRONAUTS |
| 856 | SPACE INVADERS flag planted | CAM_ASTRONAUTS |

Booster separation is handled in world space: while attached, each booster is
sampled from the stack's transform every six frames; at frame 246 it detaches,
receives an outward impulse and follows its own arc with tumble, so the two
boosters never clip the core.

The exhaust is geometry parented to each nozzle (two SRB plumes, four RS-25
plumes, one upper-stage plume, four lander thrusters). Each plume uses a
volumetric Principled Volume shader whose density is modulated by an animated
4D noise texture, plus a point light keyframed with thrust, so the flames follow
the engines and shut down at separation.

## Rebuild

The scene is generated entirely from scripts; nothing is painted by hand.

```sh
# 1. Download the printable SLS STL into nasa-assets/sls_printable/
#    https://science.nasa.gov/3d-resources/space-launch-system-sls/

blender -b --python cinematic-source/extract_stl.py
blender -b --python cinematic-source/build_scene.py
blender -b --python cinematic-source/verify_blend.py     # asserts the animation
blender -b --python cinematic-source/render_check.py     # sample frames
```

`verify_blend.py` reopens the saved file and checks, at multiple frames, that the
stack lifts off, both boosters detach and separate, the core falls behind, the
upper stage keeps climbing, Orion separates and turns, the arrays unfold, the
lander descends and stops, the legs, hatch and ramp move, both astronauts walk,
the flag rises, and the cameras switch on their markers. It also asserts 30 fps,
900 frames, eight named cameras, 18 markers, the required hierarchy, keyframed
limbs, and the absence of movie-clip textures or sequencer strips.

## Notes

The 77 MB NASA STL and the extracted `sls_components.blend` are build inputs,
not committed. The scene keeps the outer mold line at roughly 50 % decimation so
the viewport stays interactive; raise the ratios in `extract_stl.py` for final
renders. The Mars terrain, lander, crew, flag, launch pad and exhaust are
original MissionForge geometry.
