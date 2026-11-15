import bpy
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
BLEND = os.path.join(HERE, 'cinematic-source', 'missionforge-launch.blend')
if not os.path.isfile(BLEND):
    BLEND = os.path.join(HERE, 'missionforge-launch.blend')
OUT = os.path.join(HERE, 'cinematic-source', 'missionforge-launch-30s.mp4')
if not os.path.isdir(os.path.dirname(OUT)):
    OUT = os.path.join(HERE, 'missionforge-launch-30s.mp4')

bpy.ops.wm.open_mainfile(filepath=BLEND)
s = bpy.context.scene
s.render.resolution_x = 1920
s.render.resolution_y = 1080
s.render.resolution_percentage = 100
s.render.fps = 30
s.frame_start = 1
s.frame_end = 900
s.render.use_motion_blur = False
s.render.use_sequencer = False
try:
    s.render.engine = 'BLENDER_EEVEE_NEXT'
    s.eevee.taa_render_samples = 64
    s.eevee.volumetric_samples = 128
except Exception:
    pass
s.render.image_settings.file_format = 'FFMPEG'
s.render.ffmpeg.format = 'MPEG4'
s.render.ffmpeg.codec = 'H264'
s.render.ffmpeg.constant_rate_factor = 'HIGH'
s.render.ffmpeg.ffmpeg_preset = 'GOOD'
s.render.filepath = OUT
print('START', OUT, 'engine', s.render.engine, 'frames', s.frame_start, s.frame_end, flush=True)
t = time.time()
bpy.ops.render.render(animation=True)
print('FINISHED in %.1f s -> %s' % (time.time() - t, OUT), flush=True)
