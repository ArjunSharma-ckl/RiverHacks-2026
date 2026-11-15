"""MissionForge: native 30 s SLS/Orion/Mars animation built from NASA geometry.

All motion is object/bone keyframe animation inside this .blend; no video
textures, no sequencer, no stock footage.  NASA source model:
  Space Launch System printable model (outer mold line, with Orion and LAS)
  https://science.nasa.gov/3d-resources/space-launch-system-sls/
"""
import bmesh
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
ASSETS = os.path.join(HERE, 'assets')
SUIT_GLB = os.path.join(ASSETS, 'field-suit.glb')
FLAG_TEX = os.path.join(ASSETS, 'usa-flag.png')
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
    s.render.use_motion_blur = False   # crisp poles/plumes, no smear
    s.eevee.motion_blur_shutter = 0.0
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
RED_FABRIC = pr('Flag fabric', (0.36, 0.02, 0.035), 0.0, 0.65)
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
def plume_material(name, color, strength, density, smooth=False):
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
    if smooth:
        t.links.new(vol.outputs[0], out.inputs['Volume'])
        return m
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


SRB_PLUME = plume_material('SRB_aluminized_exhaust', (1.0, 0.62, 0.22), 12, 0.5, smooth=True)
RS25_PLUME = plume_material('RS25_hydrogen_exhaust', (0.66, 0.82, 1.0), 16, 0.4, smooth=True)
UPPER_PLUME = plume_material('ICPS_vacuum_exhaust', (0.55, 0.72, 1.0), 12, 0.3, smooth=True)
def glow_material(name, color, strength=4.0, alpha=0.45):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    t = m.node_tree
    t.nodes.clear()
    out = t.nodes.new('ShaderNodeOutputMaterial')
    em = t.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*color, 1)
    em.inputs['Strength'].default_value = strength
    tr = t.nodes.new('ShaderNodeBsdfTransparent')
    mix = t.nodes.new('ShaderNodeMixShader')
    mix.inputs[0].default_value = alpha
    t.links.new(tr.outputs[0], mix.inputs[1])
    t.links.new(em.outputs[0], mix.inputs[2])
    t.links.new(mix.outputs[0], out.inputs['Surface'])
    for attr, val in (('blend_method', 'BLEND'), ('surface_render_method', 'BLENDED')):
        try:
            setattr(m, attr, val)
        except Exception:
            pass
    return m


LANDER_PLUME = glow_material('Lander_methalox_exhaust', (1.0, 0.55, 0.22), 1.4, 0.2)


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
        q = D(90 * a)
        box('Tower rail', ENV, (2.2 * math.cos(q), 2.2 * math.sin(q), z + 4), (0.12, 0.12, 8.0), METAL, TOWER)
for z in (22, 38, 54, 68):
    box('Service arm', ENV, (4.5, 0, z), (13, 1.1, 1.1), WHITE, TOWER)
    box('Umbilical', ENV, (0.5, 0, z), (0.6, 0.6, 1.2), BLACK, TOWER)
box('Lightning mast', ENV, (0, 0, 88), (0.5, 0.5, 18), METAL, TOWER)

# Ground: a wide curving coastal plain so the pad sits on an Earth horizon
# instead of a square plane, with atmospheric haze swallowing the far edge.
def disk_terrain(name, coll, radius, rings, segs, height, flat_radius=0.0, tint=None):
    verts = [(0.0, 0.0, height(0.0, 0.0))]
    for i in range(1, rings + 1):
        r = radius * i / rings
        for j in range(segs):
            a = TAU * j / segs
            x, y = r * math.cos(a), r * math.sin(a)
            verts.append((x, y, height(x, y)))
    faces = []
    for j in range(segs):
        faces.append((0, 1 + j, 1 + (j + 1) % segs))
    for i in range(rings - 1):
        a0 = 1 + i * segs
        b0 = a0 + segs
        for j in range(segs):
            jn = (j + 1) % segs
            faces.append((a0 + j, b0 + j, b0 + jn, a0 + jn))
    me = bpy.data.meshes.new(name + ' mesh')
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    return ob


def hazy_ground_material(name, base_a, base_b, haze, far_start, far_end, tex=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    t = m.node_tree
    b = t.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 0.95
    coord = t.nodes.new('ShaderNodeTexCoord')
    noise = t.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 0.0016
    noise.inputs['Detail'].default_value = 5.0
    ramp = t.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*base_a, 1)
    ramp.color_ramp.elements[1].color = (*base_b, 1)
    t.links.new(coord.outputs['Object'], noise.inputs['Vector'])
    t.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    if tex:
        mapping = t.nodes.new('ShaderNodeMapping')
        mapping.inputs['Scale'].default_value = (0.0006, 0.0006, 0.0006)
        img = t.nodes.new('ShaderNodeTexImage')
        img.image = tex
        mix = t.nodes.new('ShaderNodeMixRGB')
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Fac'].default_value = 0.6
        t.links.new(coord.outputs['Object'], mapping.inputs['Vector'])
        t.links.new(mapping.outputs['Vector'], img.inputs['Vector'])
        t.links.new(img.outputs['Color'], mix.inputs['Color1'])
        t.links.new(ramp.outputs['Color'], mix.inputs['Color2'])
        t.links.new(mix.outputs['Color'], b.inputs['Base Color'])
    else:
        t.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    length = t.nodes.new('ShaderNodeVectorMath')
    length.operation = 'LENGTH'
    t.links.new(coord.outputs['Object'], length.inputs[0])
    mr = t.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = far_start
    mr.inputs['From Max'].default_value = far_end
    mr.inputs['To Min'].default_value = 0.0
    mr.inputs['To Max'].default_value = 1.0
    t.links.new(length.outputs['Value'], mr.inputs['Value'])
    fade = t.nodes.new('ShaderNodeMixRGB')
    fade.inputs['Color2'].default_value = (*haze, 1)
    t.links.new(mr.outputs['Result'], fade.inputs['Fac'])
    if tex:
        pre_fade = mix.outputs['Color']
    else:
        pre_fade = ramp.outputs['Color']
    t.links.new(pre_fade, fade.inputs['Color1'])
    t.links.new(fade.outputs['Color'], b.inputs['Base Color'])
    return m


def launch_height(x, y):
    r = math.hypot(x, y)
    flat = min(1.0, max(0.0, (r - 120.0) / 900.0))
    return -1.11 + flat * (1.2 * math.sin(x * 0.0007) * math.cos(y * 0.0009) +
                           0.5 * math.sin((x + y) * 0.002))


ground = disk_terrain('Coastal Florida ground', ENV, 26000, 80, 160, launch_height)
ground.data.materials.append(hazy_ground_material(
    'Scrub and coastal plain', (0.018, 0.024, 0.012), (0.05, 0.06, 0.03),
    (0.015, 0.03, 0.055), 6000, 22000))
LAUNCH_GROUND = add_empty('LAUNCH_GROUND_ROOT', (0, 0, 0), None, ENV)
ground.parent = LAUNCH_GROUND
for i in range(45):
    a = TAU * random.random()
    d = random.uniform(7000, 18000)
    lamp = pr('Distant town light %d' % i, (1.0, 0.72, 0.38), 0, 0.4, (1.0, 0.65, 0.3), 4.0)
    light = sphere('Distant town light %d' % i, ENV,
           (d * math.cos(a), d * math.sin(a), -0.6), random.uniform(4, 9), lamp, 6)
    light.parent = LAUNCH_GROUND
key_scale(LAUNCH_GROUND, 1, 1)
key_scale(LAUNCH_GROUND, 430, 1)
key_scale(LAUNCH_GROUND, 450, 0.001)   # ground stays under the falling boosters

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
UPPER_BASE = rel(PIV['UPPER_STAGE'], ROOT_AT)
UPPER_ASCENT = [(1, (0, 0, 0)), (420, (0, 0, 0)), (462, (0, 0, 95)), (520, (0, 0, 330)),
                (575, (0, 0, 610)), (640, (0, 0, 980)), (900, (0, 0, 1500))]
for f, off in UPPER_ASCENT:
    key_loc(UPPER_E, f, (UPPER_BASE[0] + off[0], UPPER_BASE[1] + off[1], UPPER_BASE[2] + off[2]))

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
LAS_BASE = rel(PIV['LAS'], PIV['ORION'])
for f, loc, rot in [(1, (0, 0, 0), (0, 0, 0)), (196, (0, 0, 0), (0, 0, 0)),
                    (206, (0, -1, 6), (D(8), 0, D(4))),
                    (240, (0, -9, 42), (D(30), 0, D(16)))]:
    key_loc(LAS_E, f, tuple(LAS_BASE[i] + loc[i] for i in range(3)))
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
ORION_BASE = rel(PIV['ORION'], PIV['UPPER_STAGE'])
for f, loc, rot in [
    (1, (0, 0, 0), (0, 0, 0)), (516, (0, 0, 0), (0, 0, 0)),
    (524, (0, 0, 1.6), (D(1), 0, D(1))),
    (548, (0, -2.5, 12), (D(5), D(3), D(4))),
    (590, (0, -9, 46), (D(16), D(9), D(12))),
    (650, (0, -22, 120), (D(34), D(24), D(28))),
]:
    key_loc(ORION_E, f, tuple(ORION_BASE[i] + loc[i] for i in range(3)))
    key_rot(ORION_E, f, rot)

# ------------------------------------------------------------------ Mars set
SITE = add_empty('MARS_LANDING_SITE', (0, -2600, 0), None, MARS)
key_scale(SITE, 1, 0.001)
key_scale(SITE, 605, 0.001)
key_scale(SITE, 606, 1.0)      # the wide Mars plain must not reach the launch site


def mars_height(x, y):
    r = math.hypot(x, y)
    flat = min(1.0, max(0.0, (r - 26.0) / 90.0))
    dunes = (1.6 * math.sin(x * 0.030 + y * 0.012) * math.cos(y * 0.026) +
             0.7 * math.sin(x * 0.085) * math.cos(y * 0.07) +
             0.25 * math.sin((x + y) * 0.19))
    return flat * dunes - 0.03


terrain = disk_terrain('Rocky Martian terrain', MARS, 12000, 80, 160, mars_height)
terrain.parent = SITE
mimg = bpy.data.images.load(os.path.join(ASSETS, 'mars-ground.png'), check_existing=True)
MREG = hazy_ground_material('Mars regolith from NASA texture',
                            (0.24, 0.10, 0.05), (0.42, 0.19, 0.10),
                            (0.55, 0.29, 0.17), 5000, 11500, tex=mimg)
terrain.data.materials.append(MREG)

rng = random.Random(2026)
for i in range(150):
    q = rng.uniform(0, TAU)
    d = rng.uniform(24, 640)      # keep the landing / EVA zone clear
    sphere('Martian boulder %d' % i, MARS,
           (d * math.cos(q), d * math.sin(q), mars_height(d * math.cos(q), d * math.sin(q)) + rng.uniform(-0.1, 0.4)),
           rng.uniform(0.2, 2.2), REGOLITH, 12, SITE)

# No Mars globe: the 12 km descender plain and haze carry the horizon.

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

# ----------------------------------------------------------- Mars capsule
LAND = add_empty('MARS_LANDER', (0, 0, 165), SITE, MARS)
LAND['note'] = 'Mars crew capsule; Orion never transforms into it'
CAPSULE = add_empty('MARS_CAPSULE', (0, 0, 0), LAND, MARS)
# Build the capsule from the top cone of NASA's Orion mesh: a real capsule
# silhouette with the heat shield down and the crew hatch facing the camera.
_src = bpy.data.objects['ORION_MESH']
_cme = _src.data.copy()
_bm = bmesh.new()
_bm.from_mesh(_cme)
bmesh.ops.delete(_bm, geom=[v for v in _bm.verts if v.co.z < 4.5], context='VERTS')
_z0 = min(v.co.z for v in _bm.verts)
_z1 = max(v.co.z for v in _bm.verts)
_sf = 3.4 / (_z1 - _z0)
for v in _bm.verts:
    v.co.x *= _sf
    v.co.y *= _sf
    v.co.z = (v.co.z - _z0) * _sf
_bm.to_mesh(_cme)
_bm.free()
_cme.materials.clear()
_cme.materials.append(WHITE)
_cme.materials.append(pr('Capsule ablative shield', (0.10, 0.08, 0.06), 0, 0.7))
for p in _cme.polygons:
    p.use_smooth = True
    p.material_index = 1 if p.center.z < 0.5 else 0
CAP_BODY = bpy.data.objects.new('MARS_CAPSULE_BODY', _cme)
MARS.objects.link(CAP_BODY)
CAP_BODY.parent = CAPSULE
CAP_BODY['source'] = 'NASA Orion crew module (SLS printable model), sliced and rescaled'
# Heat shield, windows, hatch frame, RCS clusters.
sph = sphere('Capsule heat shield', MARS, (0, 0, 0.34), 1.0, pr('Ablative heat shield', (0.09, 0.07, 0.05), 0, 0.8), 48, CAPSULE)
sph.scale = (2.02, 2.02, 0.42)
GLASS = pr('Capsule window glass', (0.02, 0.03, 0.045), 0.6, 0.15)
for i, ang in enumerate((D(50), D(130), D(230), D(310))):
    radial = Vector((math.cos(ang), math.sin(ang), 0))
    w = cyl('Capsule window %d' % i, MARS, radial * 1.46 + Vector((0, 0, 2.0)),
            0.29, 0.16, GLASS, 20, CAPSULE)
    w.rotation_euler = radial.to_track_quat('Z', 'Y').to_euler()
cyl('Capsule base trim', MARS, (0, 0, 0.52), 2.08, 0.16, pr('Capsule trim metal', (0.22, 0.21, 0.20), 0.85, 0.4), 64, CAPSULE)
box('Capsule hatch frame', MARS, (0, -2.02, 1.28), (1.18, 0.10, 1.42), METAL, CAPSULE)
box('Capsule hatch', MARS, (0, -2.10, 1.28), (0.92, 0.10, 1.16), pr('Capsule hatch metal', (0.55, 0.42, 0.2), 0.8, 0.35), CAPSULE)
for i, ang in enumerate((D(45), D(135), D(225), D(315))):
    box('Capsule RCS %d' % i, MARS, (1.12 * math.cos(ang), 1.12 * math.sin(ang), 3.02),
        (0.3, 0.22, 0.26), METAL, CAPSULE)
for i, ang in enumerate((D(45), D(135), D(225), D(315))):
    top = Vector((1.45 * math.cos(ang), 1.45 * math.sin(ang), 0.55))
    foot = Vector((2.25 * math.cos(ang), 2.25 * math.sin(ang), 0.05))
    vec = foot - top
    leg = cyl('Capsule landing leg %d' % i, MARS, (top + foot) / 2, 0.09, vec.length, METAL, 8, CAPSULE)
    leg.rotation_euler = vec.to_track_quat('Z', 'Y').to_euler()
    cyl('Capsule foot pad %d' % i, MARS, foot, 0.24, 0.08, METAL, 12, CAPSULE)
for i, (x, y) in enumerate(((-1.1, -1.1), (-1.1, 1.1), (1.1, -1.1), (1.1, 1.1)), 1):
    cyl('Capsule retro nozzle %d' % i, MARS, (x, y, 0.30), 0.2, 0.34,
        pr('Nozzle metal', (0.18, 0.17, 0.16), 0.9, 0.35), 12, CAPSULE)
HATCH = add_empty('LANDER_HATCH_HINGE', (0, -2.12, 1.92), LAND, MARS)
box('Capsule hatch door', MARS, (0, 0, -0.6), (0.94, 0.10, 1.2), pr('Capsule hatch metal', (0.55, 0.42, 0.2), 0.8, 0.35), HATCH)
key_rot(HATCH, 1, (0, 0, 0))
key_rot(HATCH, 724, (0, 0, 0))
key_rot(HATCH, 748, (D(-82), 0, 0))
RAMP = add_empty('LANDER_RAMP_HINGE', (0, -2.12, 1.12), LAND, MARS)
box('Landing ramp', MARS, (0, -1.8, 0), (1.1, 3.6, 0.1), METAL, RAMP)
key_rot(RAMP, 1, (D(72), 0, 0))
key_rot(RAMP, 746, (D(72), 0, 0))
key_rot(RAMP, 770, (D(19), 0, 0))   # tip rests on the surface

for i, (x, y) in enumerate(((-1.2, -1.2), (-1.2, 1.2), (1.2, -1.2), (1.2, 1.2)), 1):
    exhaust('LANDER_THRUSTER_%d' % i, LAND, (x, y, 0.15), 0.22, 2.4, LANDER_PLUME,
            [(1, 0.001), (612, 0.001), (626, 0.45), (640, 1), (712, 0.8), (722, 0.35), (728, 0.001)],
            700, (1.0, 0.6, 0.3))

for f, z in [(1, 165), (606, 165), (626, 132), (652, 78), (676, 34), (700, 9), (716, 1.0), (722, 0.0), (900, 0.0)]:
    key_loc(LAND, f, (0, 0, z))

DUST_ROOT = add_empty('MARS_DUST', (0, 0, 0.3), SITE, MARS)
DUST_BASE = plume_material('Mars dust volume', (0.34, 0.17, 0.08), 0, 0.5, smooth=True)
for i in range(12):
    a = TAU * i / 12
    mat = DUST_BASE.copy()
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
def sim_astronaut(name, start, egress_frame, walk_start, walk_end, walk_from, walk_to):
    """Use the same field-suit glTF as the MissionForge simulation."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=SUIT_GLB)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        move(o, EVA)
    roots = [o for o in new if o.parent is None]
    rig = add_empty(name, start, SITE, EVA)
    holder = bpy.data.objects.new(name + '_SUIT', None)
    EVA.objects.link(holder)
    holder.parent = rig
    for o in roots:
        o.parent = holder
        o.matrix_parent_inverse = Matrix.Identity(4)
    limbs = {}
    for o in new:
        short = o.name.split('.')[0]
        if o.type == 'EMPTY' and short in ('ArmL', 'ArmR', 'LegL', 'LegR'):
            limbs[short] = o
    key_scale(rig, 1, 0.001)          # stays inside until the hatch opens
    key_scale(rig, egress_frame - 1, 0.001)
    key_scale(rig, egress_frame, 1)
    key_loc(rig, 1, start)
    key_loc(rig, egress_frame, start)
    key_loc(rig, walk_from, walk_start)
    a, b = Vector(walk_start), Vector(walk_end)
    heading = math.atan2(-(b.x - a.x), -(b.y - a.y))
    rig.rotation_mode = 'XYZ'
    key_rot(rig, walk_from - 1, (0, 0, heading))
    key_rot(rig, walk_to, (0, 0, heading))
    phase = 0.0
    for f in range(walk_from, walk_to + 1, 5):
        t = (f - walk_from) / max(1, walk_to - walk_from)
        p = a.lerp(b, t)
        p.z += 0.035 * abs(math.sin(phase * 2.9))
        key_loc(rig, f, tuple(p))
        s = math.sin(phase * 1.5)
        for key, ang in (('LegL', 0.55 * s), ('LegR', -0.55 * s),
                         ('ArmL', -0.45 * s), ('ArmR', 0.45 * s)):
            if key in limbs:
                key_rot(limbs[key], f, (ang, 0, 0))
        phase += 1.0
    for o in limbs.values():
        key_rot(o, walk_to, (0, 0, 0))
    return rig, {'r_arm': limbs.get('ArmR'), 'legs': limbs}


A1, J1 = sim_astronaut('ASTRONAUT_1', (0.2, -2.6, 0.05), 752,
                        (0.8, -4.9, 0.05), (8.4, -10.8, 0.05), 790, 854)
A2, J2 = sim_astronaut('ASTRONAUT_2', (0.95, -2.7, 0.05), 770,
                        (1.6, -4.9, 0.05), (5.4, -8.4, 0.05), 806, 868)

FLAG = add_empty('SPACE_INVADERS_FLAG', (10.4, -12.0, 0), SITE, EVA)
flag_pole = cyl('Flag support pole', EVA, (0, 0, 1.55), 0.05, 3.1, METAL, 12, FLAG)
flag_pole.visible_shadow = False   # keeps its shadow off the thin dust haze
box('Flag cross rod', EVA, (1.3, 0, 3.05), (2.6, 0.05, 0.05), METAL, FLAG)
fabric = prim('primitive_plane_add', 'Flag fabric', EVA, None, size=1, location=(1.3, 0, 1.85))
fabric.scale = (2.6, 1.3, 1.0)
fabric.rotation_euler = (D(90), 0, 0)
fabric.parent = FLAG
USAM = bpy.data.materials.new('USA flag print')
USAM.use_nodes = True
ut = USAM.node_tree
uimg = bpy.data.images.load(FLAG_TEX, check_existing=True)
utex = ut.nodes.new('ShaderNodeTexImage')
utex.image = uimg
ut.links.new(utex.outputs['Color'], ut.nodes['Principled BSDF'].inputs['Base Color'])
ut.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
fabric.data.materials.clear()
fabric.data.materials.append(USAM)
key_loc(fabric, 1, (1.3, 0, 1.85))
key_loc(fabric, 852, (1.3, 0, 1.85))
key_loc(fabric, 868, (1.3, 0, 2.45))   # hoisted so its top corner meets the pole tip
key_scale(fabric, 1, (0.156, 1.3, 1))
key_scale(fabric, 852, (0.156, 1.3, 1))
key_scale(fabric, 868, (2.6, 1.3, 1))    # unfurls to full size
key_scale(FLAG, 1, 0.001)
key_scale(FLAG, 840, 0.001)
key_scale(FLAG, 842, 1)          # planted upright, then unfurled
key_rot(FLAG, 842, (0, 0, 0))
key_rot(FLAG, 852, (0, 0, 0))
key_rot(FLAG, 868, (0, 0, 0))
key_rot(FLAG, 880, (0, 0, 0))
# Astronaut 1 steadies the pole as it is raised.
for f, rot in ((846, (0, 0, 0)), (856, (D(20), 0, 0)), (868, (D(4), 0, 0)), (880, (0, 0, 0))):
    if J1.get('r_arm'):
        key_rot(J1['r_arm'], f, rot)
# Both astronauts turn to face the flag while it is planted.
for rig, endf, pos in ((A1, 854, (8.4, -10.8)), (A2, 868, (5.4, -8.4))):
    fx, fy = 10.4, -12.0
    face = math.atan2(-(fx - pos[0]), -(fy - pos[1]))
    key_rot(rig, endf, (0, 0, face))
    key_rot(rig, 880, (0, 0, face))

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
LAND_TARGET = follow_target('TARGET_LANDER', LAND, (0, 0, 1.0))
EVA_TARGET = add_empty('TARGET_EVA', (5.6, -12.0, 1.1), SITE, CAMS)
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


CAM_LAUNCH = camera('CAM_LAUNCHPAD', 45, LAUNCH_TARGET,
                    [(1, (96, -172, 20)), (60, (82, -150, 17)), (96, (70, -128, 14))])
CAM_ASCENT = camera('CAM_ASCENT', 42, LAUNCH_TARGET,
                    [(f, rocket_at(f) + Vector((104, -182, -26))) for f in (96, 126, 156, 186, 216, 246, 258)])
P246 = at_frame(LEFT_E, 246)
P276 = at_frame(LEFT_E, 276)
P305 = at_frame(LEFT_E, 305)
CAM_SEP = camera('CAM_BOOSTER_SEPARATION', 35, LEFT_E,
                 [(246, P246 + Vector((52, -96, 32))),
                  (276, P276 + Vector((62, -112, 62))),
                  (305, P305 + Vector((74, -132, 96)))])
CAM_ORBIT = camera('CAM_ORBIT', 75, UPPER_TARGET,
                   [(398, rocket_at(398) + Vector((60, -100, 52))),
                    (440, rocket_at(440) + Vector((72, -120, 105))),
                    (500, rocket_at(500) + Vector((88, -146, 168)))])
O516 = at_frame(ORION_E, 516)
O560 = at_frame(ORION_E, 560)
O610 = at_frame(ORION_E, 610)
CAM_ORION = camera('CAM_ORION', 55, ORION_TARGET,
                   [(516, O516 + Vector((52, -86, 24))),
                    (560, O560 + Vector((62, -104, 56))),
                    (610, O610 + Vector((76, -126, 104)))])
CAM_MARS = camera('CAM_MARS_APPROACH', 60, MARS_TARGET,
                  [(614, (-360, -5650, 240)), (660, (-260, -5250, 190)), (706, (-170, -4980, 140))])
CAM_LAND = camera('CAM_LANDING', 50, LAND_TARGET,
                  [(612, (34, -2660, 96)), (660, (26, -2640, 40)), (700, (16, -2624, 12)),
                   (726, (10.0, -2614, 3.4)), (760, (9.0, -2613, 3.0))])
CAM_EVA = camera('CAM_ASTRONAUTS', 35, EVA_TARGET,
                 [(700, (0.0, -2626, 3.5)), (760, (1.0, -2625, 3.2)),
                  (800, (2.0, -2624, 3.1)), (852, (2.0, -2624, 3.1)),
                  (900, (2.6, -2624, 3.0))])

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
    (856, 'USA FLAG RAISED', CAM_EVA),
]
for frame, label, cam in MARKERS:
    m = s.timeline_markers.new(label, frame=frame)
    m.camera = cam
s.camera = CAM_LAUNCH

# ---------------------------------------------------------------- lighting
sun_data = bpy.data.lights.new('Sun', 'SUN')
sun_data.energy = 4.1
sun_data.color = (1.0, 0.93, 0.84)
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
mars_fill.energy = 3200
mars_fill.size = 26
mars_fill.color = (1.0, 0.78, 0.6)
mo = bpy.data.objects.new('Mars bounce', mars_fill)
CAMS.objects.link(mo)
mo.location = (3, -2578, 8)
mo.rotation_euler = (D(-90), 0, 0)   # lights the camera-facing side of the crew

# World: night launch starfield mixed into a Mars sky at the landing scene.
world = bpy.data.worlds.new('Mission sky')
s.world = world
world.use_nodes = True
wnt = world.node_tree
wnt.nodes.clear()
out = wnt.nodes.new('ShaderNodeOutputWorld')
star_bg = wnt.nodes.new('ShaderNodeBackground')
star_env = wnt.nodes.new('ShaderNodeTexEnvironment')
star_env.image = bpy.data.images.load(os.path.join(ASSETS, 'starfield.png'), check_existing=True)
wnt.links.new(star_env.outputs['Color'], star_bg.inputs['Color'])
star_bg.inputs['Strength'].default_value = 1.1
# Earth atmosphere: deep blue horizon glow under a black starry zenith.
earth_bg = wnt.nodes.new('ShaderNodeBackground')
earth_bg.inputs['Strength'].default_value = 1.0
tc = wnt.nodes.new('ShaderNodeTexCoord')
sep = wnt.nodes.new('ShaderNodeSeparateXYZ')
sky_mr = wnt.nodes.new('ShaderNodeMapRange')
sky_mr.inputs['From Min'].default_value = -0.05
sky_mr.inputs['From Max'].default_value = 0.45
sky_ramp = wnt.nodes.new('ShaderNodeValToRGB')
sky_ramp.color_ramp.elements[0].color = (0.055, 0.105, 0.20, 1)
sky_ramp.color_ramp.elements[1].color = (0.003, 0.005, 0.012, 1)
wnt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])
wnt.links.new(sep.outputs['Z'], sky_mr.inputs['Value'])
wnt.links.new(sky_mr.outputs['Result'], sky_ramp.inputs['Fac'])
wnt.links.new(sky_ramp.outputs['Color'], earth_bg.inputs['Color'])
sky_fac = wnt.nodes.new('ShaderNodeMapRange')
sky_fac.inputs['From Min'].default_value = -0.02
sky_fac.inputs['From Max'].default_value = 0.30
sky_fac.inputs['To Min'].default_value = 1.0
sky_fac.inputs['To Max'].default_value = 0.0
wnt.links.new(sep.outputs['Z'], sky_fac.inputs['Value'])
atmo = wnt.nodes.new('ShaderNodeValue')
atmo.outputs[0].default_value = 1.0
atmo.outputs[0].keyframe_insert('default_value', frame=1)
atmo.outputs[0].default_value = 1.0
atmo.outputs[0].keyframe_insert('default_value', frame=240)
atmo.outputs[0].default_value = 0.0
atmo.outputs[0].keyframe_insert('default_value', frame=300)   # atmosphere ends at the top of the climb
atmo_mul = wnt.nodes.new('ShaderNodeMath')
atmo_mul.operation = 'MULTIPLY'
wnt.links.new(sky_fac.outputs['Result'], atmo_mul.inputs[0])
wnt.links.new(atmo.outputs[0], atmo_mul.inputs[1])
mix_launch = wnt.nodes.new('ShaderNodeMixShader')
wnt.links.new(star_bg.outputs[0], mix_launch.inputs[1])
wnt.links.new(earth_bg.outputs[0], mix_launch.inputs[2])
wnt.links.new(atmo_mul.outputs[0], mix_launch.inputs[0])
mars_bg = wnt.nodes.new('ShaderNodeBackground')
mars_env = wnt.nodes.new('ShaderNodeTexEnvironment')
mars_env.image = bpy.data.images.load(os.path.join(ASSETS, 'mars-sky.png'), check_existing=True)
wnt.links.new(mars_env.outputs['Color'], mars_bg.inputs['Color'])
mars_bg.inputs['Strength'].default_value = 0.85
mix = wnt.nodes.new('ShaderNodeMixShader')
mix.inputs[0].default_value = 0.0
wnt.links.new(mix_launch.outputs[0], mix.inputs[1])
wnt.links.new(mars_bg.outputs[0], mix.inputs[2])
wnt.links.new(mix.outputs[0], out.inputs['Surface'])
for f, v in ((1, 0.0), (600, 0.0), (606, 1.0), (900, 1.0)):
    mix.inputs[0].default_value = v
    mix.inputs[0].keyframe_insert('default_value', frame=f)

# Visible sun and planets in the space shots: real emissive spheres at a safe
# distance inside the camera clip range, hidden once the film cuts to Mars.
SKY_ROOT = add_empty('SPACE_BACKDROP', (0, 0, 0), None, CAMS)


def sky_material(name, color=(1, 1, 1), tex=None, strength=1.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = strength
    if tex:
        img = nt.nodes.new('ShaderNodeTexImage')
        local = os.path.join(ASSETS, tex)
        img.image = bpy.data.images.load(local if os.path.isfile(local) else os.path.join(ROOT, 'repo-src', tex), check_existing=True)
        nt.links.new(img.outputs['Color'], em.inputs['Color'])
    else:
        em.inputs['Color'].default_value = (*color, 1)
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    return m


SKY_BODIES = [
    ('Sun', 131, 9, 32000, 1200, sky_material('Sky sun', (1.0, 0.93, 0.78), strength=40),
     [(1, 1.0)]),
    ('Sky earth far', 133, -55, 24000, 6000, sky_material('Sky earth far', tex='earth.jpg', strength=7.0),
     [(1, 1.0), (430, 1.0), (450, 0.001)]),
    ('Sky earth near', 120, -7, 20000, 4500, sky_material('Sky earth near', tex='earth.jpg', strength=7.0),
     [(1, 0.001), (435, 0.001), (455, 1.0)]),
    ('Mars', 127, 10, 27000, 360, sky_material('Sky mars', tex='mars.jpg', strength=1.4), [(1, 1.0)]),
    ('Jupiter', 104, 15, 35000, 700, sky_material('Sky jupiter', (0.60, 0.48, 0.34), strength=1.0), [(1, 1.0)]),
    ('Saturn', 141, 17, 40000, 520, sky_material('Sky saturn', (0.58, 0.53, 0.42), strength=1.0), [(1, 1.0)]),
]
for name, az, elev, dist, radius, mat, windows in SKY_BODIES:
    a, e = D(az), D(elev)
    pos = (dist * math.cos(e) * math.cos(a), dist * math.cos(e) * math.sin(a), dist * math.sin(e))
    body = sphere(name, CAMS, pos, radius, mat, 64, SKY_ROOT)
    body.visible_shadow = False
    body['celestial_body'] = 'background sphere at %d km' % round(dist / 1000)
    for f, v in windows:
        key_scale(body, f, v)

key_scale(SKY_ROOT, 1, 1)
key_scale(SKY_ROOT, 600, 1)
key_scale(SKY_ROOT, 610, 0.001)

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

NASA geometry (real models, imported and split):
  Space Launch System printable model - core, SRBs, upper stage, Orion, LAS
  https://science.nasa.gov/3d-resources/space-launch-system-sls/
  NASA Orion crew module geometry - reused as the Mars capsule
  (same NASA SLS printable model, sliced and rescaled)
Crew: the MissionForge field-suit glTF from the simulation.

Hierarchy: SLS_ROOT > CORE_STAGE > RS25_ENGINES, SRB_LEFT, SRB_RIGHT,
UPPER_STAGE > ORION > CREW_MODULE / SERVICE_MODULE / SOLAR_ARRAYS / LAS.

Every visible action is an object or material keyframe on this timeline.
No video textures, no sequencer strips, no imported footage.
""")
s['source_models'] = 'NASA SLS printable model (Orion capsule reused for Mars); MissionForge field-suit crew'
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
    print('  lander z f%03d = %.2f' % (fr, LAND.matrix_world.translation.z), flush=True)
for fr in (1, 760, 800, 860):
    s.frame_set(fr)
    print('  astronaut 1 f%03d = %s' % (fr, tuple(round(v, 1) for v in world_of(A1))), flush=True)
s.frame_set(880)
print('  flag rot =', tuple(round(math.degrees(v), 1) for v in FLAG.rotation_euler), flush=True)
print('  cameras:', [o.name for o in bpy.data.objects if o.type == 'CAMERA'], flush=True)
print('  markers:', len(s.timeline_markers), 'fps', s.render.fps, 'end', s.frame_end, flush=True)
print('DONE', flush=True)
