# Expedition flight master

The 15-second film uses NASA's Artemis I for the heavy-lift vehicle. The overhead view shows the service connections and the full stack before ignition. The launch pad recording captures exhaust spreading across the pad. The booster and transfer shots come from NASA's engineering visualization. The final three shots use the original MissionForge Kestrel descent module. The landing is a representative desert sequence for every destination.

## Source plates

Download the large MP4 rendition of each record into a scratch directory. The filenames below are used by the edit script.

| Filename | NASA source |
| --- | --- |
| pad.mp4 | [Kennedy Space Center, Artemis I Isolated Launch Views](https://images.nasa.gov/details/KSC-20221116-MH-AJN01-0001-Artemis_I_Isolated_Launch_Views-3314595) |
| orbit.mp4 | [Marshall Space Flight Center, SLS Launch and Mission Animation](https://images.nasa.gov/details/MSFC_SLS_01142021_SLS_Orion_Animation_0034) |

NASA's asset API lists downloadable files under `https://images-api.nasa.gov/asset/{record-id}`. Use HTTPS for the returned media URL. The source plate timecodes, playback rates and cut lengths are in `master.py`. Original field assets and imagery are identified in [asset credits](../ASSET_CREDITS.md).

## Rebuild

Use Blender 4.3.2, FFmpeg with H.264, VP9, Opus and WebP support, and Python with NumPy, SciPy and OpenCV. Run the commands from the repository root. Replace the scratch directory with an absolute path.

```sh
blender -b -P cinematic-source/build_scene.py
blender -b cinematic-source/missionforge-launch.blend --python-expr "import bpy; s=bpy.context.scene; s.cycles.samples=4; s.cycles.use_denoising=False; s.render.use_persistent_data=True" -o /path/to/scratch/kestrel-frames/frame- -f 262,268,274,280,286,292,298,304,310,316,322,328,334,339,340,346,352,358,364,370,376,382,388,394,396,397,403,409,415,421,427,433,439,445,450
python cinematic-source/master.py /path/to/scratch --ffmpeg ffmpeg
```

The Blender file packs its textures, includes the complete camera timeline and exports the landed Kestrel to the simulator. The distribution edit uses NASA plates for frames 1–261. The last 189 frames use native 1080p Cycles exposures with bidirectional optical-flow interpolation between them. Rendering every frame from 262 through 450 into the same directory also works. The conform never interpolates across a camera cut.

The soundtrack combines original synthesized pressure, engine, airlock and contact effects with a short passage from the launch-pad recording. The portable renders under `public/cinematics` are the only production media needed by the website. The Blender source, downloaded plates and exposure frames are independent of the deployment build.
