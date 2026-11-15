"""MissionForge: native 30 s SLS/Orion/Mars animation built from NASA geometry.

All motion is object/bone keyframe animation inside this .blend; no video
textures, no sequencer, no stock footage.  NASA source model:
  Space Launch System printable model (outer mold line, with Orion and LAS)
  https://science.nasa.gov/3d-resources/space-launch-system-sls/
"""
import bpy
import json
import math
import os
import random
import sys
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
COMP = os.path.join(ROOT, 'nasa-assets', 'sls_components.blend')
if not os.path.isfile(COMP):
    sys.exit('Run extract_sls.py first: %s missing' % COMP)
PIVOT_JSON = os.path.join(ROOT, 'nasa-assets', 'sls_components.json')
PIV = json.load(open(PIVOT_JSON)) if os.path.isfile(PIVOT_JSON) else {}
PIV.setdefault('CORE_STAGE', [0.45, 0.45, 0.0])
PIV.setdefault('SRB_LEFT', [-6.3, 0.45, 0.0])
PIV.setdefault('SRB_RIGHT', [6.3, 0.45, 0.0])
PIV.setdefault('UPPER_STAGE', [0.45, 0.45, 63.0])
PIV.setdefault('ORION', [0.45, 0.45, 77.5])
PIV.setdefault('LAS', [0.45, 0.45, 86.5])
REPO = os.path.join(ROOT, 'RiverHacks-2026')
if os.path.basename(HERE) == 'cinematic-source':
    OUT = os.path.join(HERE, 'missionforge-launch.blend')
else:
    OUT = os.path.join(REPO if os.path.isdir(REPO) else HERE, 'cinematic-source', 'missionforge-launch.blend')
os.makedirs(os.path.dirname(OUT), exist_ok=True)

FPS, END = 30, 900
TAU = math.tau
D = math.radians

bpy.ops.wm.open_mainfile(filepath=COMP)
s = bpy.context.scene
s.name = 'MissionForge_Launch_to_Mars'
for o in list(bpy.data.objects):
    if o.type in {'CAMERA', 'LIGHT'}:
        bpy.data.objects.remove(o, do_unlink=True)
s.render.fps = FPS
s.frame_start = 1
s.frame_end = END
s.render.resolution_x = 1920
s.render.resolution_y = 1080
s.render.resolution_percentage = 50
s.render.image_settings.file_format = 'PNG'
s.render.use_sequencer = False
try:
    s.render.engine = 'BLENDER_EEVEE_NEXT'
except Exception:
    s.render.engine = 'BLENDER_EEVEE'
for attr, val in (('use_gtao', True), ('use_bloom', True), ('motion_blur_shutter', 0.45)):
    try:
        setattr(s.eevee, attr, val)
    except Exception:
        pass
try:
    s.render.use_motion_blur = True
except Exception:
    pass
s.view_settings.look = 'AgX - Medium High Contrast'

# ---------------------------------------------------------------- collections
def col(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or s.collection).children.link(c)
    return c

SLS = bpy.data.collections.get('NASA_SLS_COMPONENTS') or col('NASA_SLS_COMPONENTS')
SLS.name = 'SLS_VEHICLE'
FX = col('FLIGHT_EFFECTS')
ENV = col('LAUNCH_ENVIRONMENT')
MARS = col('MARS_MISSION')
CAMS = col('CAMERAS_LIGHTS')
EVA = col('EVA_CREW')


def move(o, c):
    for q in list(o.users_collection):
        q.objects.unlink(o)
    c.objects.link(o)
    return o


# ------------------------------------------------------------------ materials
def pr(n, color, metallic=0.0, rough=0.45, emission=None, strength=0.0):
    m = bpy.data.materials.get(n)
    if m:
        return m
    m = bpy.data.materials.new(n)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = rough
    if emission and b.inputs.get('Emission Color'):
        b.inputs['Emission Color'].default_value = (*emission, 1)
        b.inputs['Emission Strength'].default_value = strength
    return m


def foam_material():
    """Orange SLS core insulation with subtle spray-foam bump."""
    m = bpy.data.materials.get('SLS_core_orange_foam') or bpy.data.materials.new('SLS_core_orange_foam')
    m.use_nodes = True
    if m.get('_built'):
        return m
    m.use_nodes = True
    t = m.node_tree
    b = t.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.58, 0.19, 0.045, 1)
    b.inputs['Roughness'].default_value = 0.66
    noise = t.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 55
    noise.inputs['Detail'].default_value = 6
    bump = t.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.22
    t.links.new(noise.outputs['Fac'], bump.inputs['Height'])
    t.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    m['_built'] = True
    return m


def srb_material():
    m = bpy.data.materials.new('SLS_booster_white_paint')
    m.use_nodes = True
    t = m.node_tree
    b = t.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.84, 0.84, 0.81, 1)
    b.inputs['Roughness'].default_value = 0.4
    noise = t.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 180
    rough = t.nodes.new('ShaderNodeMapRange')
    rough.inputs['To Min'].default_value = 0.3
    rough.inputs['To Max'].default_value = 0.55
    t.links.new(noise.outputs['Fac'], rough.inputs['Value'])
    t.links.new(rough.outputs['Result'], b.inputs['Roughness'])
    return m


CORE = foam_material()
SRB = srb_material()
WHITE = pr('Aerospace white', (0.82, 0.82, 0.79), 0.05, 0.38)
METAL = pr('Aerospace alloy', (0.32, 0.34, 0.36), 0.9, 0.3)
DARK = pr('Engine bell', (0.07, 0.075, 0.08), 0.9, 0.32)
GOLD = pr('MLI gold foil', (0.72, 0.42, 0.08), 0.95, 0.28)
BLACK = pr('Thermal blanket', (0.012, 0.014, 0.018), 0.2, 0.55)
SOLAR = pr('Solar cell blue', (0.008, 0.02, 0.075), 0.45, 0.16)
RED_FABRIC = pr('Flag fabric', (0.09, 0.008, 0.015), 0.0, 0.65)
FLAG_TEXT = pr('Flag lettering', (0.98, 0.93, 0.82), 0.0, 0.4, (1.0, 0.95, 0.85), 1.2)
SUIT = pr('EVA suit white', (0.86, 0.86, 0.84), 0.02, 0.42)
VISOR = pr('Gold visor', (0.55, 0.32, 0.04), 1.0, 0.12)
REGOLITH = pr('Mars regolith', (0.34, 0.115, 0.045), 0.0, 0.95)
DUST_MAT = None

# ------------------------------------------------------------------- helpers
def add_empty(name, world, parent=None, coll=None):
    o = bpy.data.objects.new(name, None)
    (coll or SLS).objects.link(o)
    o.empty_display_size = 1.5
    bpy.context.view_layer.update()
    if parent:
        # When parented, `world` is interpreted in the parent's local space.
        o.parent = parent
        o.matrix_parent_inverse = Matrix.Identity(4)
    o.location = Vector(world)
    bpy.context.view_layer.update()
    return o


def prim(kind, name, coll, mat=None, **kw):
    getattr(bpy.ops.mesh, kind)(**kw)
    o = bpy.context.object
    o.name = name
    move(o, coll)
    if mat:
        o.data.materials.append(mat)
    return o


def box(name, coll, centre, size, mat, parent=None, local=False):
    o = prim('primitive_cube_add', name, coll, mat, size=1, location=(0, 0, 0))
    o.scale = Vector(size) / 2
    if parent:
        o.parent = parent
        o.location = Vector(centre)
    else:
        o.location = Vector(centre)
    return o


def cyl(name, coll, centre, radius, depth, mat, verts=32, parent=None):
    o = prim('primitive_cylinder_add', name, coll, mat, vertices=verts, radius=radius, depth=depth, location=centre)
    if parent:
        o.parent = parent
        o.location = Vector(centre)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def sphere(name, coll, centre, radius, mat, seg=32, parent=None):
    o = prim('primitive_uv_sphere_add', name, coll, mat, segments=seg, ring_count=max(8, seg // 2), radius=radius, location=centre)
    if parent:
        o.parent = parent
        o.location = Vector(centre)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def cone(name, coll, centre, r1, r2, depth, mat, verts=32, parent=None):
    o = prim('primitive_cone_add', name, coll, mat, vertices=verts, radius1=r1, radius2=r2, depth=depth, location=centre)
    if parent:
        o.parent = parent
        o.location = Vector(centre)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def key(o, path, frame, value):
    setattr(o, path, value)
    o.keyframe_insert(data_path=path, frame=frame)


def key_loc(o, frame, loc):
    key(o, 'location', frame, Vector(loc))


def key_rot(o, frame, rot):
    o.rotation_mode = 'XYZ'
    key(o, 'rotation_euler', frame, Vector(rot))


def key_scale(o, frame, v):
    key(o, 'scale', frame, Vector((v, v, v)) if isinstance(v, (int, float)) else Vector(v))


def world_of(o):
    return o.matrix_world.translation.copy()


# ------------------------------------------------------------- vehicle mount
def rel(pivot, parent_pivot):
    return tuple(pivot[i] - parent_pivot[i] for i in range(3))


ROOT_AT = (0, 0, -0.6)
ROOT_EMPTY = add_empty('SLS_ROOT', ROOT_AT)
CORE_E = add_empty('CORE_STAGE', rel(PIV['CORE_STAGE'], ROOT_AT), ROOT_EMPTY)
ENG_E = add_empty('RS25_ENGINES', (0, 0, 0), CORE_E)
LEFT_E = add_empty('SRB_LEFT', rel(PIV['SRB_LEFT'], ROOT_AT), ROOT_EMPTY)
RIGHT_E = add_empty('SRB_RIGHT', rel(PIV['SRB_RIGHT'], ROOT_AT), ROOT_EMPTY)
UPPER_E = add_empty('UPPER_STAGE', rel(PIV['UPPER_STAGE'], ROOT_AT), ROOT_EMPTY)
ORION_E = add_empty('ORION', rel(PIV['ORION'], PIV['UPPER_STAGE']), UPPER_E)
CREW_E = add_empty('CREW_MODULE', (0, 0, 3.9), ORION_E)
SERVICE_E = add_empty('SERVICE_MODULE', (0, 0, 0), ORION_E)
ARRAY_E = add_empty('SOLAR_ARRAYS', (0, 0, 1.9), ORION_E)
LAS_E = add_empty('LAUNCH_ABORT_SYSTEM', rel(PIV['LAS'], PIV['ORION']), ORION_E)

MESH_MAP = {
    'CORE_STAGE_MESH': (CORE_E, PIV['CORE_STAGE']),
    'SRB_LEFT_MESH': (LEFT_E, PIV['SRB_LEFT']),
    'SRB_RIGHT_MESH': (RIGHT_E, PIV['SRB_RIGHT']),
    'UPPER_STAGE_MESH': (UPPER_E, PIV['UPPER_STAGE']),
    'ORION_MESH': (SERVICE_E, PIV['ORION']),
    'LAS_MESH': (LAS_E, PIV['LAS']),
}
for name, (host, pivot) in MESH_MAP.items():
    o = bpy.data.objects.get(name)
    if not o:
        print('MISSING COMPONENT', name, flush=True)
        continue
    bpy.context.view_layer.update()
    o.parent = host
    o.matrix_parent_inverse = host.matrix_world.inverted()
    o.location = Vector(pivot)
    mat = {'CORE_STAGE_MESH': CORE, 'SRB_LEFT_MESH': SRB, 'SRB_RIGHT_MESH': SRB,
           'UPPER_STAGE_MESH': WHITE, 'ORION_MESH': WHITE, 'LAS_MESH': WHITE}[name]
    o.data.materials.clear()
    o.data.materials.append(mat)
    if name == 'ORION_MESH':
        # the capsule top gets ceramic white, the service module gold MLI
        o.data.materials.append(GOLD)
        for poly in o.data.polygons:
            if poly.center.z < 4.9:      # local coords: service module below the capsule
                poly.material_index = 1
    print('MOUNTED', name, 'polys', len(o.data.polygons), flush=True)


def mount_copy(src_name, host, new_name, pivot=(0.45, 0.45, 76.4)):
    src = bpy.data.objects.get(src_name)
    if not src:
        return None
    c = src.copy()          # shares mesh data
    move(c, SLS)
    c.name = new_name
    c.animation_data_clear()
    c.constraints.clear()
    c.delta_location = (0, 0, 0)
    c.delta_rotation_euler = (0, 0, 0)
    c.delta_scale = (1, 1, 1)
    bpy.context.view_layer.update()
    c.parent = host
    c.matrix_parent_inverse = host.matrix_world.inverted()
    c.location = Vector(pivot)
    return c

# ------------------------------------------------------------------- exhaust
def plume_material(name, color, strength, density):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    t = m.node_tree
    t.nodes.clear()
    out = t.nodes.new('ShaderNodeOutputMaterial')
    vol = t.nodes.new('ShaderNodeVolumePrincipled')
    vol.inputs['Color'].default_value = (*color, 1)
    vol.inputs['Density'].default_value = density
    vol.inputs['Emission Color'].default_value = (*color, 1)
    vol.inputs['Emission Strength'].default_value = strength
    noise = t.nodes.new('ShaderNodeTexNoise')
    noise.noise_dimensions = '4D'
    noise.inputs['Scale'].default_value = 5.5
    noise.inputs['Detail'].default_value = 8
    noise.inputs['Roughness'].default_value = 0.65
    fcurve = noise.inputs['W'].driver_add('default_value')
    fcurve.driver.expression = 'frame*0.11'
    ramp = t.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.32
    ramp.color_ramp.elements[1].position = 0.68
    mul = t.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = density * 2.6
    t.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    t.links.new(ramp.outputs['Color'], mul.inputs[0])
    t.links.new(mul.outputs[0], vol.inputs['Density'])
    t.links.new(vol.outputs[0], out.inputs['Volume'])
    return m


SRB_PLUME = plume_material('SRB_aluminized_exhaust', (1.0, 0.62, 0.22), 18, 0.55)
RS25_PLUME = plume_material('RS25_hydrogen_exhaust', (0.66, 0.82, 1.0), 26, 0.42)
UPPER_PLUME = plume_material('ICPS_vacuum_exhaust', (0.55, 0.72, 1.0), 20, 0.3)
LANDER_PLUME = plume_material('Lander_methalox_exhaust', (0.95, 0.55, 0.25), 16, 0.6)


def exhaust(name, host, local, radius, length, mat, keys, light_energy, light_color):
    host_e = add_empty(name + '_HOST', (0, 0, 0), host)
    host_e.location = Vector(local)
    body = cone(name + '_VOLUME', FX, (0, 0, -length * 0.5), radius, radius * 0.22, length, mat)
    body.parent = host_e
    body.location = (0, 0, -length * 0.5)
    body.rotation_euler = (math.pi, 0, 0)
    core = cone(name + '_CORE', FX, (0, 0, -length * 0.32), radius * 0.45, radius * 0.1, length * 0.62, mat)
    core.parent = host_e
    core.location = (0, 0, -length * 0.32)
    core.rotation_euler = (math.pi, 0, 0)
    lamp = bpy.data.lights.new(name + '_LIGHT', 'POINT')
    lamp.color = light_color
    lamp.shadow_soft_size = radius * 1.2
    lo = bpy.data.objects.new(name + '_LIGHT', lamp)
    FX.objects.link(lo)
    lo.parent = host_e
    lo.location = (0, 0, -length * 0.2)
    for f, v in keys:
        key_scale(host_e, f, max(0.001, v))
        lamp.energy = light_energy * max(0.0, v) ** 2
        lamp.keyframe_insert('energy', frame=f)
    host_e['attached_to'] = host.name
    host_e['effect'] = 'volumetric exhaust driven by animated 4D noise'
    return host_e


SRB_BURN = [(1, 0.001), (38, 0.001), (52, 0.35), (66, 1.0), (240, 0.95), (244, 0.55), (247, 0.001)]
for e in (LEFT_E, RIGHT_E):
    exhaust(e.name + '_EXHAUST', e, (0, 0, 0.4), 3.1, 46, SRB_PLUME, SRB_BURN, 4200, (1.0, 0.55, 0.2))

for i, (x, y) in enumerate(((-1.35, -1.35), (-1.35, 1.35), (1.35, -1.35), (1.35, 1.35)), 1):
    exhaust('RS25_%d_EXHAUST' % i, ENG_E, (x, y, 0.2), 1.05, 22, RS25_PLUME,
            [(1, 0.001), (40, 0.001), (56, 0.3), (72, 1), (414, 1), (420, 0.25), (424, 0.001)],
            1500, (0.6, 0.78, 1.0))

exhaust('UPPER_STAGE_EXHAUST', UPPER_E, (0, 0, 0.1), 0.9, 16, UPPER_PLUME,
        [(1, 0.001), (432, 0.001), (440, 0.4), (452, 1), (520, 0.75), (536, 0.001)],
        1200, (0.55, 0.72, 1.0))

# ------------------------------------------------------------------- launchpad
pad = cyl('Launch pad 39B apron', ENV, (0, 0, -0.55), 32, 1.1, pr('Concrete', (0.30, 0.29, 0.27), 0, 0.9), 96)
cyl('Flame trench', ENV, (0, 0, -1.3), 11, 1.6, BLACK, 48)
for a in range(0, 360, 30):
    q = D(a)
    box('Pad hardstand', ENV, (16 * math.cos(q), 16 * math.sin(q), -0.02), (5, 5, 0.12),
        pr('Concrete', (0.30, 0.29, 0.27), 0, 0.9))

TOWER = add_empty('Mobile_Launcher_Tower', (-17, 6, 0), None, ENV)
for x in (-2.2, 2.2):
    for y in (-2.2, 2.2):
        box('Tower column', ENV, (x, y, 40), (0.65, 0.65, 80), METAL, TOWER)
for z in range(6, 80, 8):
    box('Tower deck', ENV, (0, 0, z), (5.2, 5.2, 0.25), METAL, TOWER)
    for a in range(0, 4):
        q = D(45 + 90 * a)
        box('Tower cross brace', ENV, (0, 0, z), (0.18, 0.18, 8.6), METAL, TOWER).rotation_euler = (D(48), 0, q)
for z in (22, 38, 54, 68):
    box('Service arm', ENV, (4.5, 0, z), (13, 1.1, 1.1), WHITE, TOWER)
    box('Umbilical', ENV, (0.5, 0, z), (0.6, 0.6, 1.2), BLACK, TOWER)
box('Lightning mast', ENV, (0, 0, 88), (0.5, 0.5, 18), METAL, TOWER)

# Ground, sky and the distant Earth.
ground = prim('primitive_plane_add', 'Coastal Florida ground', ENV,
              pr('Scrub ground', (0.055, 0.075, 0.035), 0, 0.95), size=80000, location=(0, 0, -1.11))
bpy.ops.object.shade_smooth() if False else None
earth = sphere('Earth from orbit', ENV, (0, -42000, 2600), 6000, pr('Earth oceans', (0.02, 0.09, 0.22), 0.1, 0.45), 96)
earth.data.materials.clear()
EM = bpy.data.materials.new('Earth map')
EM.use_nodes = True
nt = EM.node_tree
img = bpy.data.images.load(os.path.join(ROOT, 'repo-src', 'earth.jpg'), check_existing=True)
tex = nt.nodes.new('ShaderNodeTexImage')
tex.image = img
nt.links.new(tex.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
earth.data.materials.append(EM)

# ------------------------------------------------------------------- flight
key_loc(ROOT_EMPTY, 1, (0, 0, -1))
key_loc(ROOT_EMPTY, 64, (0, 0, -1))
key_loc(ROOT_EMPTY, 74, (0, 0, 0.4))
key_loc(ROOT_EMPTY, 92, (0, 0, 9))
key_loc(ROOT_EMPTY, 150, (0, 0, 120))
key_loc(ROOT_EMPTY, 240, (9, 0, 900))
key_loc(ROOT_EMPTY, 330, (46, 0, 1880))
key_loc(ROOT_EMPTY, 420, (104, 0, 3050))
key_rot(ROOT_EMPTY, 1, (0, 0, 0))
key_rot(ROOT_EMPTY, 120, (0, 0, 0))
key_rot(ROOT_EMPTY, 210, (0, D(9), 0))
key_rot(ROOT_EMPTY, 300, (0, D(27), 0))
key_rot(ROOT_EMPTY, 420, (0, D(46), 0))
# Thrust build-up vibration before release.
for f, dx in ((60, 0.02), (66, -0.03), (72, 0.015), (78, -0.01)):
    key_loc(ROOT_EMPTY, f, (dx, 0, -1))
    key_loc(ROOT_EMPTY, f, (dx, 0, -1))

# Boosters ride the stack exactly, then detach into world-space ballistic arcs.
# (Local-space offsets would mix with the pitch and swing into the core.)
UPPER_ASCENT = [(420, (0, 0, 0)), (462, (0, 0, 95)), (520, (0, 0, 330)),
                (575, (0, 0, 610)), (640, (0, 0, 980)), (900, (0, 0, 1500))]
for f, loc in UPPER_ASCENT:
    key_loc(UPPER_E, f, loc)

for side, sgn in ((LEFT_E, -1), (RIGHT_E, 1)):
    samples = []
    for f in list(range(1, 246, 6)) + [246]:
        s.frame_set(f)
        samples.append((f, side.matrix_world.copy()))
    side.parent = None
    side.rotation_mode = 'XYZ'
    for f, m in samples:
        side.matrix_world = m
        side.keyframe_insert('location', frame=f)
        side.keyframe_insert('rotation_euler', frame=f)
    m246 = samples[-1][1]
    P = m246.translation.copy()
    R = m246.to_3x3()
    lat = (R @ Vector((sgn, 0, 0))).normalized()
    aft = (R @ Vector((0, 0, -1))).normalized()
    down = Vector((0, 0, -1))
    base = m246.to_euler('XYZ')
    for f, out, back, drop, tumble in [
        (246, 0.0, 0.0, 0.0, 0.0),
        (252, 2.2, 0.6, 1.0, 3.0),
        (266, 8.0, 6.0, 5.0, 12.0),
        (300, 24.0, 34.0, 30.0, 34.0),
        (380, 50.0, 112.0, 145.0, 78.0),
        (480, 82.0, 245.0, 405.0, 140.0),
        (560, 112.0, 415.0, 745.0, 205.0),
    ]:
        p = P + lat * out + aft * back + down * drop
        key_loc(side, f, p)
        key_rot(side, f, (base.x + D(tumble * 0.55), base.y + D(sgn * tumble * 1.2),
                          base.z + D(sgn * tumble * 0.4)))
    side['separation_frame'] = 246
    side['path'] = 'world-space ballistic arc after tether release'

for f, loc, rot in [
    (1, (0, 0, 0), (0, 0, 0)), (420, (0, 0, 0), (0, 0, 0)),
    (426, (0, 0, -3), (D(1), 0, 0)),
    (448, (0, 2, -22), (D(4), 0, D(2))),
    (500, (0, 8, -140), (D(9), 0, D(5))),
    (570, (0, 18, -430), (D(16), 0, D(9))),
]:
    key_loc(CORE_E, f, loc)
    key_rot(CORE_E, f, rot)

key_rot(UPPER_E, 1, (0, 0, 0))
key_rot(UPPER_E, 520, (0, 0, 0))
key_rot(UPPER_E, 600, (D(-4), 0, D(6)))

# LAS jettison shortly after booster separation.
for f, loc, rot in [(1, (0, 0, 0), (0, 0, 0)), (196, (0, 0, 0), (0, 0, 0)),
                    (206, (0, -1, 6), (D(8), 0, D(4))),
                    (240, (0, -9, 42), (D(30), 0, D(16)))]:
    key_loc(LAS_E, f, loc)
    key_rot(LAS_E, f, rot)


def orion_assembly(label, parent, base_world, deploy_from=None):
    ore = add_empty(label, base_world, parent)
    service = add_empty(label + '_SERVICE_MODULE', (0, 0, 1.0), ore)
    crew = add_empty(label + '_CREW_MODULE', (0, 0, 5.0), ore)
    arrays = add_empty(label + '_SOLAR_ARRAYS', (0, 0, 3.0), ore)
    body = mount_copy('ORION_MESH', service, label + '_BODY', PIV['ORION'])
    if body:
        body.data = body.data.copy()
        body.data.materials.clear()
        body.data.materials.append(WHITE)
        body.data.materials.append(GOLD)
        for poly in body.data.polygons:
            poly.material_index = 1 if poly.center.z < 4.9 else 0
    wings = []
    for i in range(4):
        az = D(45 + 90 * i)
        hinge = add_empty('%s_SOLAR_WING_%d_HINGE' % (label, i + 1), (0, 0, 0), arrays)
        hinge.rotation_euler = (0, 0, az)
        fold = add_empty('%s_SOLAR_WING_%d_FOLD' % (label, i + 1), (0, 0, 0), hinge)
        fold.rotation_mode = 'XYZ'
        for j, (x0, ln) in enumerate(((2.9, 5.4), (8.5, 5.4))):
            p = box('%s_SOLAR_PANEL_%d_%d' % (label, i + 1, j + 1), SLS,
                    (x0, 0, 0), (ln, 0.06, 2.35), SOLAR, fold)
            box('%s_SOLAR_FRAME_%d_%d' % (label, i + 1, j + 1), SLS,
                (x0, 0, 0), (ln, 0.1, 0.07), GOLD, fold)
            box('%s_SOLAR_FRAME_%d_%db' % (label, i + 1, j + 1), SLS,
                (x0, 0, 2.3), (ln, 0.1, 0.07), GOLD, fold)
            box('%s_SOLAR_FRAME_%d_%dc' % (label, i + 1, j + 1), SLS,
                (x0, 0, -2.3), (ln, 0.1, 0.07), GOLD, fold)
        if deploy_from is None:
            fold.rotation_euler = (0, 0, 0)
        else:
            key_rot(fold, deploy_from, (0, D(88), 0))
            key_rot(fold, deploy_from + 22, (0, D(-6), 0))
            key_rot(fold, deploy_from + 32, (0, 0, 0))
        wings.append(fold)
    return {'root': ore, 'service': service, 'crew': crew, 'arrays': arrays, 'wings': wings}


ORION_A = orion_assembly('ORION_LAUNCH_STACK', ORION_E, (0, 0, 0), deploy_from=530)
key_rot(ORION_E, 1, (0, 0, 0))
for f, loc, rot in [
    (1, (0, 0, 0), (0, 0, 0)), (516, (0, 0, 0), (0, 0, 0)),
    (524, (0, 0, 1.6), (D(1), 0, D(1))),
    (548, (0, -2.5, 12), (D(5), D(3), D(4))),
    (590, (0, -9, 46), (D(16), D(9), D(12))),
    (650, (0, -22, 120), (D(34), D(24), D(28))),
]:
    key_loc(ORION_E, f, loc)
    key_rot(ORION_E, f, rot)

# ------------------------------------------------------------------ Mars set
SITE = add_empty('MARS_LANDING_SITE', (0, -2600, 0), None, MARS)
N = 90
W = 420
verts, faces = [], []
for j in range(N):
    for i in range(N):
        x = -W / 2 + W * i / (N - 1)
        y = -W / 2 + W * j / (N - 1)
        r = math.hypot(x, y)
        z = 1.4 * math.sin(x * 0.035) * math.cos(y * 0.041) + 0.7 * math.sin((x + y) * 0.09)
        z *= min(1.0, max(0.0, (r - 8) / 26))     # flat pad for touchdown
        verts.append((x, y, z))
for j in range(N - 1):
    for i in range(N - 1):
        a = j * N + i
        faces.append((a, a + 1, a + N + 1, a + N))
me = bpy.data.meshes.new('Mars terrain mesh')
me.from_pydata(verts, [], faces)
me.update()
terrain = bpy.data.objects.new('Rocky Martian terrain', me)
MARS.objects.link(terrain)
terrain.parent = SITE
MREG = bpy.data.materials.new('Mars regolith from NASA texture')
MREG.use_nodes = True
mt = MREG.node_tree
mimg = bpy.data.images.load(os.path.join(ROOT, 'repo-src', 'mars.jpg'), check_existing=True)
mtex = mt.nodes.new('ShaderNodeTexImage')
mtex.image = mimg
mt.links.new(mtex.outputs['Color'], mt.nodes['Principled BSDF'].inputs['Base Color'])
mt.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.95
terrain.data.materials.append(MREG)
for p in me.polygons:
    p.use_smooth = True

rng = random.Random(2026)
for i in range(90):
    q = rng.uniform(0, TAU)
    d = rng.uniform(24, 190)      # keep the landing / EVA zone clear
    sphere('Martian boulder %d' % i, MARS,
           (d * math.cos(q), d * math.sin(q), rng.uniform(-0.2, 0.6)),
           rng.uniform(0.25, 1.6), REGOLITH, 12, SITE)

mars_planet = sphere('Mars (planet)', MARS, (0, -7200, 120), 2300, REGOLITH, 96)
mars_planet.data.materials.clear()
MP = bpy.data.materials.new('Mars map')
MP.use_nodes = True
mpt = MP.node_tree
mptex = mpt.nodes.new('ShaderNodeTexImage')
mptex.image = mimg
mpt.links.new(mptex.outputs['Color'], mpt.nodes['Principled BSDF'].inputs['Base Color'])
mars_planet.data.materials.append(MP)

# Orion arriving at Mars (same NASA mesh, deployed arrays, separate path).
MARS_ORION_E = add_empty('ORION_MARS_APPROACH', (0, -4850, 210), None, MARS)
MARS_ORION = orion_assembly('ORION_MARS', MARS_ORION_E, (0, 0, 0))
for f, loc, rot in [
    (1, (-130, 420, -40), (D(-18), D(6), D(-30))),
    (600, (-110, 380, -60), (D(-18), D(8), D(-30))),
    (650, (-30, 110, -10), (D(-6), D(4), D(-10))),
    (700, (0, 20, 0), (0, D(2), 0)),
]:
    key_loc(MARS_ORION_E, f, loc)
    key_rot(MARS_ORION_E, f, rot)

# -------------------------------------------------------------------- lander
LAND = add_empty('MARS_LANDER', (0, 0, 165), SITE, MARS)
LAND['note'] = 'Dedicated Mars lander; Orion never transforms into it'
cone('Lander descent stage', MARS, (0, 0, 1.2), 3.3, 2.5, 2.0, GOLD, 48, LAND)
cyl('Lander crew compartment', MARS, (0, 0, 3.9), 2.5, 3.4, WHITE, 48, LAND)
cone('Lander pressure dome', MARS, (0, 0, 6.1), 2.48, 1.1, 1.3, WHITE, 48, LAND)
cyl('Lander descent engine bell', MARS, (0, 0, -0.2), 0.8, 1.4, DARK, 32, LAND)
for i, a in enumerate((45, 135, 225, 315), 1):
    q = D(a)
    x, y = 3.0 * math.cos(q), 3.0 * math.sin(q)
    hip = add_empty('LANDING_LEG_%d_HINGE' % i, (x, y, 2.1), LAND, MARS)
    hip.rotation_mode = 'XYZ'
    hip.rotation_euler = (0, D(38), 0)
    strut = cyl('Landing leg strut %d' % i, MARS, (0, 0, -1.55), 0.14, 3.4, METAL, 16, hip)
    strut.rotation_euler = (0, 0, 0)
    cyl('Landing foot pad %d' % i, MARS, (0, 0, -3.25), 0.62, 0.24, METAL, 24, hip)
    # 52 deg puts the foot pad on the surface: hinge 2.1 m, strut 3.4 m.
    key_rot(hip, 1, (0, D(62), 0))
    key_rot(hip, 646, (0, D(62), 0))
    key_rot(hip, 676, (0, D(54), 0))
    key_rot(hip, 686, (0, D(52), 0))
HATCH = add_empty('LANDER_HATCH_HINGE', (0, -2.52, 4.0), LAND, MARS)
box('Lander hatch', MARS, (0, -0.06, -0.8), (1.7, 0.16, 2.0), GOLD, HATCH)
key_rot(HATCH, 1, (0, 0, 0))
key_rot(HATCH, 724, (0, 0, 0))
key_rot(HATCH, 748, (D(-78), 0, 0))
RAMP = add_empty('LANDER_RAMP_HINGE', (0, -2.55, 1.5), LAND, MARS)
box('Landing ramp', MARS, (0, -1.95, 0), (1.6, 4.0, 0.16), METAL, RAMP)
key_rot(RAMP, 1, (D(70), 0, 0))
key_rot(RAMP, 746, (D(70), 0, 0))
key_rot(RAMP, 770, (D(22), 0, 0))   # tip rests on the surface

for i, (x, y) in enumerate(((-1.2, -1.2), (-1.2, 1.2), (1.2, -1.2), (1.2, 1.2)), 1):
    exhaust('LANDER_THRUSTER_%d' % i, LAND, (x, y, -1.3), 0.42, 6.5, LANDER_PLUME,
            [(1, 0.001), (612, 0.001), (626, 0.45), (640, 1), (712, 0.8), (722, 0.35), (728, 0.001)],
            700, (1.0, 0.6, 0.3))

for f, z in [(1, 165), (606, 165), (626, 132), (652, 78), (676, 34), (700, 9), (716, 2.1), (722, 1.12), (900, 1.12)]:
    key_loc(LAND, f, (0, 0, z))

DUST_ROOT = add_empty('MARS_DUST', (0, 0, 0.3), SITE, MARS)
for i in range(12):
    a = TAU * i / 12
    mat = LANDER_PLUME.copy()
    mat.name = 'Dust billow %d' % i
    vol = mat.node_tree.nodes['Principled Volume']
    vol.inputs['Emission Strength'].default_value = 0.0
    vol.inputs['Color'].default_value = (0.34, 0.17, 0.08, 1)
    for f, d in ((1, 0.001), (690, 0.001), (702, 0.35), (716, 0.9), (740, 0.8), (780, 0.05)):
        vol.inputs['Density'].default_value = d
        vol.inputs['Density'].keyframe_insert('default_value', frame=f)
    o = sphere('Dust billow %d' % i, MARS, (9.5 * math.cos(a), 9.5 * math.sin(a), 0.8), 1, mat, 16, DUST_ROOT)
    key_scale(o, 1, 0.001)
    key_scale(o, 690, 0.3)
    key_scale(o, 706, 1.2)
    key_scale(o, 730, 1.8)
    key_scale(o, 790, 2.0)

# -------------------------------------------------------------------- EVA crew
def astronaut(name, start, egress_frame, walk_start, walk_end, walk_from, walk_to):
    rig = add_empty(name, start, SITE, EVA)
    hips = add_empty(name + '_HIPS', (0, 0, 0.95), rig, EVA)
    chest = add_empty(name + '_CHEST', (0, 0, 0.42), hips, EVA)
    head = add_empty(name + '_HEAD', (0, 0, 0.42), chest, EVA)
    cyl(name + '_torso', EVA, (0, 0, 0.32), 0.27, 0.62, SUIT, 24, chest)
    sphere(name + '_helmet', EVA, (0, 0, 0.44), 0.19, SUIT, 24, head)
    box(name + '_visor', EVA, (0, -0.16, 0.45), (0.26, 0.09, 0.17), VISOR, head)
    box(name + '_PLSS backpack', EVA, (0, 0.24, 0.34), (0.38, 0.2, 0.52), pr('PLSS', (0.72, 0.73, 0.72), 0.1, 0.5), chest)
    joints = {'hips': hips, 'chest': chest, 'head': head}
    for side, sx in (('L', -1), ('R', 1)):
        sh = add_empty('%s_%s_SHOULDER' % (name, side), (sx * 0.29, 0, 0.52), chest, EVA)
        el = add_empty('%s_%s_ELBOW' % (name, side), (0, 0, -0.34), sh, EVA)
        cyl('%s_%s_upper_arm' % (name, side), EVA, (0, 0, -0.17), 0.085, 0.34, SUIT, 12, sh)
        cyl('%s_%s_forearm' % (name, side), EVA, (0, 0, -0.16), 0.078, 0.32, SUIT, 12, el)
        glove = sphere('%s_%s_glove' % (name, side), EVA, (0, 0, -0.33), 0.095, pr('Gloves', (0.8, 0.55, 0.3), 0.2, 0.5), 12, el)
        hip = add_empty('%s_%s_HIP' % (name, side), (sx * 0.15, 0, 0.02), hips, EVA)
        knee = add_empty('%s_%s_KNEE' % (name, side), (0, 0, -0.47), hip, EVA)
        cyl('%s_%s_thigh' % (name, side), EVA, (0, 0, -0.24), 0.11, 0.47, SUIT, 12, hip)
        cyl('%s_%s_shin' % (name, side), EVA, (0, 0, -0.22), 0.1, 0.44, SUIT, 12, knee)
        box('%s_%s_boot' % (name, side), EVA, (0, -0.06, -0.46), (0.17, 0.32, 0.12), BLACK, knee)
        joints[side] = {'sh': sh, 'el': el, 'hip': hip, 'knee': knee}
    # exit the ramp, then walk a real path with a gait cycle and vertical bob
    key_loc(rig, 1, start)
    key_loc(rig, egress_frame, start)
    key_loc(rig, walk_from, walk_start)
    a, b = Vector(walk_start), Vector(walk_end)
    phase = 0.0
    for f in range(walk_from, walk_to + 1, 6):
        t = (f - walk_from) / max(1, walk_to - walk_from)
        p = a.lerp(b, t)
        p.z += 0.045 * abs(math.sin(phase * 2.9))
        key_loc(rig, f, tuple(p))
        swing = math.sin(phase * 1.4)
        key_rot(joints['L']['hip'], f, (D(28) * swing, 0, 0))
        key_rot(joints['R']['hip'], f, (-D(28) * swing, 0, 0))
        key_rot(joints['L']['knee'], f, (D(-34) * max(0, -swing), 0, 0))
        key_rot(joints['R']['knee'], f, (D(-34) * max(0, swing), 0, 0))
        key_rot(joints['L']['sh'], f, (-D(24) * swing, 0, 0))
        key_rot(joints['R']['sh'], f, (D(24) * swing, 0, 0))
        phase += 1.0
    for j in (joints['L'], joints['R']):
        key_rot(j['hip'], walk_to, (0, 0, 0))
        key_rot(j['knee'], walk_to, (0, 0, 0))
        key_rot(j['sh'], walk_to, (0, 0, 0))
    return rig, joints


A1, J1 = astronaut('ASTRONAUT_1', (0.2, -2.6, 0.05), 752,
                   (0.8, -4.9, 0.05), (8.4, -10.8, 0.05), 790, 854)
A2, J2 = astronaut('ASTRONAUT_2', (0.95, -2.7, 0.05), 770,
                   (1.6, -4.9, 0.05), (5.4, -8.4, 0.05), 806, 868)

FLAG = add_empty('SPACE_INVADERS_FLAG', (10.4, -12.0, 0), SITE, EVA)
cyl('Flag support pole', EVA, (0, 0, 1.55), 0.05, 3.1, METAL, 12, FLAG)
box('Flag cross rod', EVA, (0.95, 0, 2.45), (1.9, 0.05, 0.05), METAL, FLAG)
fabric = box('Flag fabric', EVA, (0.95, 0, 1.85), (1.85, 0.02, 1.15), RED_FABRIC, FLAG)
cu = bpy.data.curves.new('SPACE INVADERS title', 'FONT')
cu.body = 'SPACE\nINVADERS'
cu.align_x = 'CENTER'
cu.align_y = 'CENTER'
cu.size = 0.26
cu.extrude = 0.004
cu.materials.append(FLAG_TEXT)
txt = bpy.data.objects.new('SPACE INVADERS lettering', cu)
EVA.objects.link(txt)
txt.parent = FLAG
txt.location = (0.95, 0.035, 1.88)
txt.rotation_euler = (D(90), 0, D(180))
txt2 = txt.copy()
txt2.data = cu.copy()
EVA.objects.link(txt2)
txt2.parent = FLAG
txt2.location = (0.95, -0.035, 1.88)
txt2.rotation_euler = (D(90), 0, 0)
key_rot(FLAG, 1, (D(72), 0, D(-25)))
key_rot(FLAG, 852, (D(72), 0, D(-25)))
key_rot(FLAG, 868, (D(-6), 0, D(3)))
key_rot(FLAG, 880, (0, 0, 0))
# Astronaut 1 plants it: reach down, then drive the pole upright.
for f, rot in ((846, (0, 0, 0)), (856, (D(52), 0, D(-14))), (868, (D(6), 0, D(-4))), (880, (0, 0, 0))):
    key_rot(J1['R']['sh'], f, rot)

# -------------------------------------------------------------- cameras
def follow_target(name, target, offset):
    """Aim point that follows an animated object, independent of bind pose."""
    o = bpy.data.objects.new(name, None)
    CAMS.objects.link(o)
    o.empty_display_size = 2
    c = o.constraints.new('COPY_LOCATION')
    c.name = name + ' follows ' + target.name
    c.target = target
    c.use_offset = True
    c.target_space = 'WORLD'
    c.owner_space = 'WORLD'
    o.location = Vector(offset)
    return o


LAUNCH_TARGET = follow_target('TARGET_LAUNCH_STACK', ROOT_EMPTY, (0, 0, 50))
BOOSTER_TARGET = follow_target('TARGET_BOOSTER_SEPARATION', LEFT_E, (0, 0, 26))
ORION_TARGET = follow_target('TARGET_ORION', ORION_E, (0, 0, 4))
UPPER_TARGET = follow_target('TARGET_UPPER_STAGE', UPPER_E, (0, 0, 10))
MARS_ORION_TARGET = follow_target('TARGET_MARS_ORION', MARS_ORION_E, (0, 0, 3))
LAND_TARGET = follow_target('TARGET_LANDER', LAND, (0, 0, 3))
EVA_TARGET = add_empty('TARGET_EVA', (8, -12, 1.2), SITE, CAMS)
MARS_TARGET = follow_target('TARGET_MARS_APPROACH', MARS_ORION_E, (0, 0, 1))


def camera(name, lens, target, frames, fstop=2.8, clip=60000):
    data = bpy.data.cameras.new(name)
    data.lens = lens
    data.sensor_width = 36
    data.clip_start = 0.1
    data.clip_end = clip
    o = bpy.data.objects.new(name, data)
    CAMS.objects.link(o)
    for f, loc in frames:
        o.location = Vector(loc)
        o.keyframe_insert('location', frame=f)
    c = o.constraints.new('TRACK_TO')
    c.name = name + ' aim'
    c.target = target
    c.track_axis = 'TRACK_NEGATIVE_Z'
    c.up_axis = 'UP_Y'
    o['focal_length_mm'] = lens
    return o


def rocket_at(frame):
    s.frame_set(frame)
    bpy.context.view_layer.update()
    return world_of(ROOT_EMPTY)


def at_frame(o, frame):
    s.frame_set(frame)
    bpy.context.view_layer.update()
    return o.matrix_world.translation.copy()


CAM_LAUNCH = camera('CAM_LAUNCHPAD', 50, LAUNCH_TARGET,
                    [(1, (54, -96, 14)), (60, (46, -84, 12)), (96, (38, -72, 11))])
CAM_ASCENT = camera('CAM_ASCENT', 42, LAUNCH_TARGET,
                    [(96, rocket_at(96) + Vector((58, -100, -12))),
                     (200, rocket_at(200) + Vector((82, -145, -6))),
                     (258, rocket_at(258) + Vector((108, -190, 10)))])
P246 = at_frame(LEFT_E, 246)
P276 = at_frame(LEFT_E, 276)
P305 = at_frame(LEFT_E, 305)
CAM_SEP = camera('CAM_BOOSTER_SEPARATION', 35, LEFT_E,
                 [(246, P246 + Vector((52, -96, 24))),
                  (276, P276 + Vector((62, -112, 30))),
                  (305, P305 + Vector((74, -132, 36)))])
CAM_ORBIT = camera('CAM_ORBIT', 50, UPPER_TARGET,
                   [(398, rocket_at(398) + Vector((85, -150, 45))),
                    (440, rocket_at(440) + Vector((105, -185, 55))),
                    (500, rocket_at(500) + Vector((130, -230, 70)))])
O516 = at_frame(ORION_E, 516)
O560 = at_frame(ORION_E, 560)
O610 = at_frame(ORION_E, 610)
CAM_ORION = camera('CAM_ORION', 65, ORION_TARGET,
                   [(516, O516 + Vector((26, -42, 14))),
                    (560, O560 + Vector((32, -52, 18))),
                    (610, O610 + Vector((40, -66, 22)))])
CAM_MARS = camera('CAM_MARS_APPROACH', 60, MARS_TARGET,
                  [(614, (-360, -5650, 240)), (660, (-260, -5250, 190)), (706, (-170, -4980, 140))])
CAM_LAND = camera('CAM_LANDING', 50, LAND_TARGET,
                  [(612, (34, -2660, 96)), (660, (26, -2640, 48)), (700, (18, -2628, 18)),
                   (726, (14, -2622, 6)), (760, (13, -2621, 5))])
CAM_EVA = camera('CAM_ASTRONAUTS', 42, EVA_TARGET,
                 [(700, (3.0, -2590, 3.2)), (760, (3.5, -2591, 3.0)),
                  (800, (4.0, -2592, 2.9)), (900, (4.5, -2593, 2.8))])

MARKERS = [
    (1, 'COUNTDOWN / PAD', CAM_LAUNCH),
    (40, 'ENGINE STARTUP', CAM_LAUNCH),
    (66, 'SRB IGNITION / LIFTOFF', CAM_ASCENT),
    (196, 'LAS JETTISON', CAM_ASCENT),
    (246, 'SRB SEPARATION', CAM_SEP),
    (300, 'BOOSTERS FALLING AWAY', CAM_SEP),
    (420, 'CORE STAGE SEPARATION', CAM_ORBIT),
    (440, 'UPPER STAGE IGNITION', CAM_ORBIT),
    (500, 'ORION SEPARATION', CAM_ORION),
    (532, 'SOLAR ARRAY DEPLOYMENT', CAM_ORION),
    (612, 'MARS APPROACH', CAM_MARS),
    (646, 'LANDING GEAR DEPLOY', CAM_LAND),
    (700, 'POWERED DESCENT', CAM_LAND),
    (722, 'MARS TOUCHDOWN', CAM_LAND),
    (728, 'ENGINE SHUTDOWN', CAM_LAND),
    (748, 'HATCH OPEN / RAMP', CAM_EVA),
    (780, 'CREW EGRESS', CAM_EVA),
    (856, 'SPACE INVADERS FLAG', CAM_EVA),
]
for frame, label, cam in MARKERS:
    m = s.timeline_markers.new(label, frame=frame)
    m.camera = cam
s.camera = CAM_LAUNCH

# ---------------------------------------------------------------- lighting
sun_data = bpy.data.lights.new('Sun', 'SUN')
sun_data.energy = 3.4
sun_data.angle = D(0.6)
sun = bpy.data.objects.new('Sun', sun_data)
CAMS.objects.link(sun)
sun.rotation_euler = (D(52), 0, D(28))

fill = bpy.data.lights.new('Pad fill', 'AREA')
fill.energy = 2200
fill.size = 30
fo = bpy.data.objects.new('Pad fill', fill)
CAMS.objects.link(fo)
fo.location = (40, -40, 22)

mars_fill = bpy.data.lights.new('Mars bounce', 'AREA')
mars_fill.energy = 900
mars_fill.size = 18
mars_fill.color = (1.0, 0.72, 0.5)
mo = bpy.data.objects.new('Mars bounce', mars_fill)
CAMS.objects.link(mo)
mo.location = (20, -2580, 12)

# world animates from Earth daylight to Mars dust
world = bpy.data.worlds.new('Mission sky')
s.world = world
world.use_nodes = True
bg = world.node_tree.nodes['Background']
bg.inputs['Color'].default_value = (0.16, 0.34, 0.62, 1)
bg.inputs['Strength'].default_value = 0.55
for f, c, e in ((1, (0.16, 0.34, 0.62), 0.55), (600, (0.16, 0.34, 0.62), 0.55),
                (606, (0.45, 0.22, 0.12), 0.5)):
    bg.inputs['Color'].default_value = (*c, 1)
    bg.inputs['Color'].keyframe_insert('default_value', frame=f)
    bg.inputs['Strength'].default_value = e
    bg.inputs['Strength'].keyframe_insert('default_value', frame=f)

# ------------------------------------------------------------------- polish
for o in bpy.data.objects:
    if not o.animation_data or not o.animation_data.action:
        continue
    for fc in o.animation_data.action.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
            kp.handle_left_type = 'AUTO_CLAMPED'
            kp.handle_right_type = 'AUTO_CLAMPED'

s.frame_set(1)
notes = bpy.data.texts.new('MISSIONFORGE_ANIMATION')
notes.write("""MISSIONFORGE - SLS / ORION / MARS  (30 fps, 900 frames, 30 s)

NASA geometry (real model, imported and split):
  Space Launch System printable model - core, SRBs, upper stage, Orion, LAS
  https://science.nasa.gov/3d-resources/space-launch-system-sls/

Hierarchy: SLS_ROOT > CORE_STAGE > RS25_ENGINES, SRB_LEFT, SRB_RIGHT,
UPPER_STAGE > ORION > CREW_MODULE / SERVICE_MODULE / SOLAR_ARRAYS / LAS.

Every visible action is an object or material keyframe on this timeline.
No video textures, no sequencer strips, no imported footage.
""")
s['source_models'] = 'NASA Space Launch System printable model (NASA 3D Resources)'
s['native_keyframe_animation'] = True

print('STAGE: saving', flush=True)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
print('SAVED', OUT, flush=True)

# ----------------------------------------------------------------- verification
def report(label, obj, frame):
    s.frame_set(frame)
    print('  %-34s f%03d world=%s' % (label, frame, tuple(round(v, 1) for v in world_of(obj))), flush=True)


print('VERIFY', flush=True)
for fr in (1, 90, 150, 246, 262, 300, 420, 440, 524, 548, 600, 650, 676, 700, 722, 750, 790, 870):
    report('rocket', ROOT_EMPTY, fr)
for fr in (246, 262, 300, 380, 480):
    report('left booster', LEFT_E, fr)
    report('right booster', RIGHT_E, fr)
    report('core', CORE_E, fr)
    print('    clearance L=%.1f m R=%.1f m' % (
        (world_of(LEFT_E) - world_of(CORE_E)).length, (world_of(RIGHT_E) - world_of(CORE_E)).length), flush=True)
for fr in (420, 462, 520, 575, 640):
    report('upper stage', UPPER_E, fr)
    report('orion', ORION_E, fr)
for fr in (1, 530, 548, 575):
    s.frame_set(fr)
    print('  solar fold angle f%03d = %.1f deg' % (fr, math.degrees(ORION_A['wings'][0].rotation_euler.y)), flush=True)
for fr in (1, 646, 676, 700, 722):
    s.frame_set(fr)
    print('  lander z f%03d = %.2f  leg angle %.0f deg' % (
        fr, LAND.matrix_world.translation.z, math.degrees(bpy.data.objects['LANDING_LEG_1_HINGE'].rotation_euler.y)), flush=True)
for fr in (1, 760, 800, 860):
    s.frame_set(fr)
    print('  astronaut 1 f%03d = %s' % (fr, tuple(round(v, 1) for v in world_of(A1))), flush=True)
s.frame_set(880)
print('  flag rot =', tuple(round(math.degrees(v), 1) for v in FLAG.rotation_euler), flush=True)
print('  cameras:', [o.name for o in bpy.data.objects if o.type == 'CAMERA'], flush=True)
print('  markers:', len(s.timeline_markers), 'fps', s.render.fps, 'end', s.frame_end, flush=True)
print('DONE', flush=True)
