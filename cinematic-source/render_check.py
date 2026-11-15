import bpy
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BLEND = os.path.join(HERE, 'cinematic-source', 'missionforge-launch.blend')
if not os.path.isfile(BLEND):
    BLEND = os.path.join(HERE, 'missionforge-launch.blend')
if not os.path.isfile(BLEND):
    sys.exit('blend missing')
bpy.ops.wm.open_mainfile(filepath=BLEND)
s = bpy.context.scene
s.render.resolution_percentage = 30
s.render.image_settings.file_format = 'PNG'
s.render.film_transparent = False
s.render.use_motion_blur = False
try:
    s.render.engine = 'BLENDER_EEVEE_NEXT'
except Exception:
    s.render.engine = 'CYCLES'
    s.cycles.samples = 12
    s.cycles.use_denoising = True
out = os.path.join(HERE, 'verification')
os.makedirs(out, exist_ok=True)
frames = [int(x) for x in sys.argv[sys.argv.index('--') + 1:]] if '--' in sys.argv else [24, 268, 305, 430, 545, 660, 722, 800, 872]
for f in frames:
    s.frame_set(f)
    s.render.filepath = os.path.join(out, 'frame_%03d.png' % f)
    bpy.ops.render.render(write_still=True)
    print('RENDERED', s.render.filepath, flush=True)
print('RENDER_DONE', flush=True)
