"""Build the remaining simulation props as proper glTF assets.

Passages are 2 m ribbed corridor sections (east-west and north-south variants),
the recycler reuses NASA's Habitat Demonstration Unit dome with a tank farm,
and the solar/comms props replace the old Cesium boxes.
"""
import bpy
import math
import os
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MISSION = os.path.join(ROOT, 'public', 'models', 'mission')
if not os.path.isdir(MISSION):
    MISSION = os.path.join(ROOT, 'repo-sparse', 'public', 'models', 'mission')
OUT = MISSION


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color, metallic=0.0, rough=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = rough
    return m


def cube(name, loc, dims, mat, rot=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.scale = dims
    o.data.materials.append(mat)
    if parent:
        o.parent = parent
        o.matrix_parent_inverse.identity()
    return o


def cylinder(name, loc, radius, depth, mat, rot=(0, 0, 0), parent=None, vertices=24, end_fill_type='NGON'):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rot, end_fill_type=end_fill_type)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(mat)
    if parent:
        o.parent = parent
        o.matrix_parent_inverse.identity()
    return o


def sphere(name, loc, radius, mat, scale=(1, 1, 1), parent=None, segments=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=12, radius=radius, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    o.data.materials.append(mat)
    if parent:
        o.parent = parent
        o.matrix_parent_inverse.identity()
    return o


def torus(name, loc, major, minor, mat, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=24, minor_segments=8, location=loc, rotation=rot)
    o = bpy.context.object
    o.name = name
    o.data.materials.append(mat)
    return o


def export(name):
    path = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False)
    print('SAVED', path, flush=True)


def build_passage(axis):
    reset()
    hull = material('Corridor hull', (0.80, 0.81, 0.78), 0.08, 0.55)
    metal = material('Corridor ribs', (0.42, 0.45, 0.45), 0.75, 0.32)
    floor = material('Corridor floor', (0.24, 0.27, 0.27), 0.35, 0.7)
    glass = material('Corridor windows', (0.03, 0.09, 0.12), 0.6, 0.2)
    amber = material('Corridor light', (1.0, 0.57, 0.19), 0, 0.3)
    length = 2.0
    ew = axis == 'ew'
    rotation = (0, math.pi / 2, 0) if ew else (math.pi / 2, 0, 0)
    cylinder('Pressure tube', (0, 0, 1.18), 1.18, length, hull, rot=rotation, vertices=32, end_fill_type='NOTHING')
    floor_dims = (length - 0.12, 1.95, 0.12) if ew else (1.95, length - 0.12, 0.12)
    cube('Floor', (0, 0, 0.07), floor_dims, floor)
    for i in range(3):
        offset = -0.8 + i * 0.8
        loc = (offset, 0, 1.18) if ew else (0, offset, 1.18)
        torus('Rib %d' % i, loc, 1.2, 0.055, metal, rot=rotation)
    rail_rot = (0, math.pi / 2, 0) if ew else (math.pi / 2, 0, 0)
    for side in (-1, 1):
        loc = (0, side * 0.86, 0.96) if ew else (side * 0.86, 0, 0.96)
        cylinder('Handrail', loc, 0.025, length - 0.25, metal, rot=rail_rot)
        loc = (0, side * 1.17, 1.5) if ew else (side * 1.17, 0, 1.5)
        dims = (length * 0.62, 0.035, 0.28) if ew else (0.035, length * 0.62, 0.28)
        cube('Window band', loc, dims, glass)
    for i, offset in enumerate((-0.55, 0.55)):
        loc = (offset, 0, 2.31) if ew else (0, offset, 2.31)
        dims = (0.38, 0.08, 0.035) if ew else (0.08, 0.38, 0.035)
        cube('Ceiling light %d' % i, loc, dims, amber)
    export('passage-' + axis)


def build_solar():
    reset()
    steel = material('Array steel', (0.46, 0.49, 0.49), 0.8, 0.32)
    concrete = material('Array pad', (0.26, 0.27, 0.26), 0, 0.85)
    panel = material('Solar cells', (0.035, 0.095, 0.19), 0.65, 0.24)
    frame = material('Solar frame', (0.62, 0.66, 0.66), 0.85, 0.3)
    cube('Pad', (0, 0, 0.08), (1.5, 1.5, 0.16), concrete)
    cylinder('Tracker post', (0, 0, 1.15), 0.13, 2.3, steel)
    cube('Gearbox', (0, 0, 2.28), (0.5, 0.62, 0.42), steel)
    pivot = bpy.data.objects.new('Panel pivot', None)
    bpy.context.scene.collection.objects.link(pivot)
    pivot.location = (0, 0, 2.65)
    pivot.rotation_euler = (math.radians(-28), 0, 0)
    cube('Panel', (0, 0, 0), (3.9, 2.55, 0.07), panel, parent=pivot)
    for x in (-1.94, 1.94):
        cube('Panel side rail', (x, 0, 0), (0.07, 2.62, 0.11), frame, parent=pivot)
    for y in (-1.29, 1.29):
        cube('Panel end rail', (0, y, 0), (3.96, 0.07, 0.11), frame, parent=pivot)
    for x in (-1.3, -0.65, 0, 0.65, 1.3):
        cube('Cell divider', (x, 0, 0.04), (0.025, 2.54, 0.015), frame, parent=pivot)
    for y in (-0.85, -0.28, 0.28, 0.85):
        cube('Cell row', (0, y, 0.04), (3.86, 0.025, 0.015), frame, parent=pivot)
    for side in (-1, 1):
        cylinder('Panel strut', (side * 0.58, 0, 2.22), 0.035, 1.35, steel, rot=(0, math.radians(38), 0))
    export('solar')


def build_comms():
    reset()
    steel = material('Mast steel', (0.52, 0.55, 0.55), 0.85, 0.28)
    concrete = material('Mast pad', (0.27, 0.28, 0.27), 0, 0.85)
    dish = material('Dish white', (0.84, 0.85, 0.82), 0.05, 0.5)
    feed = material('Feed horn', (0.2, 0.22, 0.22), 0.7, 0.3)
    cube('Pad', (0, 0, 0.09), (1.8, 1.8, 0.18), concrete)
    for angle in (0, 2 * math.pi / 3, 4 * math.pi / 3):
        x, y = 0.52 * math.cos(angle), 0.52 * math.sin(angle)
        cylinder('Mast leg', (x, y, 2.7), 0.4, 5.4, steel, vertices=8)
    for z in (1.2, 2.5, 3.8):
        torus('Mast ring', (0, 0, z), 0.55, 0.035, steel)
    cylinder('Mast top', (0, 0, 5.55), 0.14, 0.5, steel)
    tilt = bpy.data.objects.new('Dish tilt', None)
    bpy.context.scene.collection.objects.link(tilt)
    tilt.location = (0, 0, 5.65)
    tilt.rotation_euler = (math.radians(34), 0, 0)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1.35, location=(0, 0, 0))
    reflector = bpy.context.object
    reflector.name = 'Reflector'
    reflector.scale = (1, 1, 0.22)
    reflector.data.materials.append(dish)
    reflector.parent = tilt
    reflector.matrix_parent_inverse.identity()
    cylinder('Feed boom', (0, 0, 0.5), 0.06, 0.8, steel, parent=tilt)
    cylinder('Feed horn', (0, 0, 0.95), 0.18, 0.32, feed, parent=tilt)
    sphere('Beacon', (0.65, 0, 5.15), 0.08, material('Beacon amber', (1.0, 0.55, 0.12), 0, 0.3))
    export('comms')


def build_recycler():
    reset()
    bpy.ops.import_scene.gltf(filepath=os.path.join(MISSION, 'habitat.glb'))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    zmin = min(p.z for p in pts)
    cx = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
    cy = (min(p.y for p in pts) + max(p.y for p in pts)) / 2
    roots = [o for o in bpy.context.scene.objects if o.parent is None]
    root = bpy.data.objects.new('RECYCLER', None)
    bpy.context.scene.collection.objects.link(root)
    for o in roots:
        o.parent = root
        o.matrix_parent_inverse.identity()
    scale = 0.56
    root.scale = (scale, scale, scale)
    root.location = (-1.5 - cx * scale, -cy * scale, -zmin * scale)

    steel = material('Plant steel', (0.45, 0.48, 0.48), 0.8, 0.32)
    tankmat = material('Tank white', (0.83, 0.84, 0.81), 0.08, 0.45)
    accent = material('Plant accent', (0.05, 0.36, 0.42), 0.25, 0.4)
    dark = material('Plant dark', (0.18, 0.2, 0.2), 0.4, 0.55)
    for i, y in enumerate((-1.4, 1.4)):
        cylinder('Tank %d' % i, (2.65, y, 1.65), 0.82, 3.3, tankmat)
        sphere('Tank cap %d' % i, (2.65, y, 3.3), 0.82, tankmat, scale=(1, 1, 0.35))
        cylinder('Tank band %d' % i, (2.65, y, 1.05), 0.835, 0.18, accent)
        torus('Tank base %d' % i, (2.65, y, 0.12), 0.84, 0.07, steel)
    cylinder('Header pipe', (2.65, 0, 2.65), 0.09, 2.9, steel, rot=(math.pi / 2, 0, 0))
    for y in (-1.4, 1.4):
        cylinder('Tank riser', (2.65, y, 2.05), 0.09, 1.4, steel)
    cube('Processing skid', (4.35, 0, 1.0), (1.75, 2.55, 1.8), tankmat)
    cube('Skid panel', (5.24, 0, 1.2), (0.06, 1.45, 1.0), accent)
    cube('Skid vent', (4.35, -1.3, 1.35), (0.8, 0.05, 0.55), dark)
    for z in (0.55, 2.2):
        cylinder('Skid pipe', (3.35, 0, z), 0.07, 1.2, steel, rot=(0, math.pi / 2, 0))
    cube('Radiator', (-3.1, 2.15, 1.45), (0.12, 2.0, 2.15), tankmat)
    for y in (-1.0, -0.35, 0.3, 0.95):
        cube('Radiator fin', (-3.03, 2.15 + y, 1.45), (0.05, 0.16, 1.95), steel)
    cylinder('Beacon mast', (-0.4, -2.05, 2.5), 0.055, 2.2, steel)
    sphere('Beacon', (-0.4, -2.05, 3.65), 0.1, material('Recycler beacon', (1.0, 0.55, 0.12), 0, 0.3))
    export('recycler')


build_passage('ew')
build_passage('ns')
build_solar()
build_comms()
build_recycler()
