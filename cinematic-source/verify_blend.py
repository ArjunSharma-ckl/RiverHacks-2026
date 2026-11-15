import bpy
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BLEND = os.path.join(HERE, 'cinematic-source', 'missionforge-launch.blend')
if not os.path.isfile(BLEND):
    BLEND = os.path.join(HERE, 'missionforge-launch.blend')
bpy.ops.wm.open_mainfile(filepath=BLEND)
s = bpy.context.scene
fails = []


def chk(name, cond, detail=''):
    print(('PASS ' if cond else 'FAIL ') + name + ('  ' + detail if detail else ''), flush=True)
    if not cond:
        fails.append(name)


def w(o):
    return o.matrix_world.translation.copy()


chk('scene is 30 fps', s.render.fps == 30, str(s.render.fps))
chk('scene is 900 frames', s.frame_start == 1 and s.frame_end == 900, '%d-%d' % (s.frame_start, s.frame_end))
chk('no video sequencer strips', s.sequence_editor is None or len(s.sequence_editor.sequences_all) == 0)

cams = [o for o in bpy.data.objects if o.type == 'CAMERA']
chk('eight named cameras', len(cams) == 8, ','.join(sorted(c.name for c in cams)))
chk('timeline markers', len(s.timeline_markers) >= 15, str(len(s.timeline_markers)))
animated = [o for o in bpy.data.objects if o.animation_data and o.animation_data.action]
curves = sum(len(o.animation_data.action.fcurves) for o in animated)
chk('animated objects', len(animated) > 40, '%d objects / %d fcurves' % (len(animated), curves))

names = ['SLS_ROOT', 'CORE_STAGE', 'SRB_LEFT', 'SRB_RIGHT', 'RS25_ENGINES', 'UPPER_STAGE',
         'ORION', 'CREW_MODULE', 'SERVICE_MODULE', 'SOLAR_ARRAYS', 'LAUNCH_ABORT_SYSTEM',
         'MARS_LANDER', 'ASTRONAUT_1', 'ASTRONAUT_2', 'SPACE_INVADERS_FLAG']
chk('required hierarchy present', all(n in bpy.data.objects for n in names),
    ','.join(n for n in names if n not in bpy.data.objects))

root = bpy.data.objects['SLS_ROOT']
core = bpy.data.objects['CORE_STAGE']
left = bpy.data.objects['SRB_LEFT']
right = bpy.data.objects['SRB_RIGHT']
upper = bpy.data.objects['UPPER_STAGE']
orion = bpy.data.objects['ORION']
lander = bpy.data.objects['MARS_LANDER']
land_mesh = bpy.data.objects['MARS_LANDER']

s.frame_set(1)
z1 = w(root).z
s.frame_set(150)
z150 = w(root).z
s.frame_set(246)
zl246, zc246 = w(left).z, w(core).z
gap246 = (w(left) - w(core)).length
s.frame_set(300)
gap300 = (w(left) - w(core)).length
s.frame_set(420)
zl420 = w(left).z
chk('liftoff moves the stack', z150 - z1 > 50, 'dz=%.0f' % (z150 - z1))
chk('boosters attached at ignition', abs(zl246 - zc246) < 8, 'dz=%.1f' % (zl246 - zc246))
chk('boosters detach outward', gap300 > gap246 + 10, 'gap %.1f -> %.1f m' % (gap246, gap300))
chk('boosters fall behind', zl420 < zl246, 'z %.0f -> %.0f' % (zl246, zl420))
chk('boosters tumble', abs(left.rotation_euler.x) + abs(left.rotation_euler.z) > 0.4,
    str(tuple(round(v, 2) for v in left.rotation_euler)))

s.frame_set(420)
core420, up420 = w(core).z, w(upper).z
s.frame_set(500)
core500, up500 = w(core).z, w(upper).z
chk('core stage separates', (core500 - up500) < (core420 - up420) - 20,
    'core-upper %.0f -> %.0f m' % (core420 - up420, core500 - up500))

s.frame_set(520)
o520 = w(orion)
s.frame_set(600)
o600 = w(orion)
chk('orion separates from upper stage', (o600 - w(upper)).length > 10,
    'sep %.1f m' % (o600 - w(upper)).length)
chk('orion changes orientation', abs(orion.rotation_euler.y) > 0.15,
    str(tuple(round(math.degrees(v), 1) for v in orion.rotation_euler)))

wing = bpy.data.objects['ORION_LAUNCH_STACK_SOLAR_WING_1_FOLD']
s.frame_set(520)
a_folded = math.degrees(wing.rotation_euler.y)
s.frame_set(575)
a_open = math.degrees(wing.rotation_euler.y)
chk('solar arrays deploy', abs(a_folded) > 60 and abs(a_open) < 5, '%.1f -> %.1f deg' % (a_folded, a_open))

s.frame_set(606)
z_high = w(lander).z
s.frame_set(700)
z_low = w(lander).z
s.frame_set(722)
z_touch = w(lander).z
s.frame_set(800)
z_hold = w(lander).z
chk('lander descends', z_high - z_low > 50, '%.1f -> %.1f m' % (z_high, z_low))
chk('lander stops at surface', abs(z_touch) < 0.15 and abs(z_hold - z_touch) < 0.01, 'z=%.2f' % z_touch)
cap = bpy.data.objects.get('MARS_CAPSULE_BODY')
chk('Mars capsule built from NASA Orion geometry', bool(cap and len(cap.data.polygons) > 500),
    '%d polys' % len(cap.data.polygons) if cap else 'missing')
chk('capsule heat shield and legs are present',
    all(n in bpy.data.objects for n in ('Capsule heat shield', 'Capsule landing leg 0', 'Capsule hatch door')))
hatch = bpy.data.objects['LANDER_HATCH_HINGE']
s.frame_set(720)
h_a = abs(hatch.rotation_euler.x)
s.frame_set(760)
h_b = abs(hatch.rotation_euler.x)
chk('hatch opens', h_b - h_a > 0.8, '%.1f -> %.1f deg' % (math.degrees(h_a), math.degrees(h_b)))
ramp = bpy.data.objects['LANDER_RAMP_HINGE']
s.frame_set(740)
r_a = ramp.rotation_euler.x
s.frame_set(790)
r_b = ramp.rotation_euler.x
chk('ramp deploys', abs(r_b - r_a) > 0.8, '%.1f -> %.1f deg' % (math.degrees(r_a), math.degrees(r_b)))

a1 = bpy.data.objects['ASTRONAUT_1']
s.frame_set(760)
p_start = w(a1)
s.frame_set(860)
p_end = w(a1)
chk('astronaut walks', (p_end - p_start).length > 4, '%.1f m' % (p_end - p_start).length)
a2 = bpy.data.objects['ASTRONAUT_2']
s.frame_set(780)
q_start = w(a2)
s.frame_set(870)
q_end = w(a2)
chk('second astronaut walks', (q_end - q_start).length > 2, '%.1f m' % (q_end - q_start).length)
limb = next((o for o in bpy.data.objects if o.name.startswith('ArmL') and o.animation_data
             and o.animation_data.action), None)
chk('field-suit limbs are keyframed', bool(limb),
    limb.name if limb else 'no animated ArmL')

flag = bpy.data.objects['SPACE_INVADERS_FLAG']
fabric = bpy.data.objects['Flag fabric']
s.frame_set(850)
f_a = fabric.scale.x
s.frame_set(880)
f_b = fabric.scale.x
chk('flag unfurls upright at the pole', f_a < 0.2 and f_b > 0.9,
    'scale %.2f -> %.2f' % (f_a, f_b))
chk('flag carries the USA flag texture',
    any(m and m.use_nodes and any(n.type == 'TEX_IMAGE' and n.image and 'usa-flag' in n.image.name
        for n in m.node_tree.nodes) for m in bpy.data.materials))

s.frame_set(100)
cam100 = s.camera.name
s.frame_set(250)
cam250 = s.camera.name
s.frame_set(620)
cam620 = s.camera.name
chk('cameras switch on markers', len({cam100, cam250, cam620}) == 3, '%s / %s / %s' % (cam100, cam250, cam620))

chk('no movie clip textures', not any(getattr(t, 'type', '') == 'MOVIE' for m in bpy.data.materials
                                      if m.use_nodes for t in m.node_tree.nodes))
chk('NASA meshes carry geometry', all(bpy.data.objects[n].type == 'MESH' and len(bpy.data.objects[n].data.polygons) > 1000
                                      for n in ('CORE_STAGE_MESH', 'SRB_LEFT_MESH', 'SRB_RIGHT_MESH',
                                                'UPPER_STAGE_MESH', 'ORION_MESH')))

print('RESULT', 'FAILURES: ' + ','.join(fails) if fails else 'ALL CHECKS PASSED', flush=True)
sys.exit(1 if fails else 0)
