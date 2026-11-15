"""Derive better simulation buildings from NASA's Habitat Demonstration Unit GLB.

The sim's laboratory/medical/logistics models were simple sheds.  These variants
reuse the NASA HDU dome (the same online asset credited for the habitat) and add
a distinct annex so each facility reads differently in Cesium.
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
SRC = os.path.join(MISSION, 'habitat.glb')
OUT = MISSION


def material(name, color, metallic=0.0, rough=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = rough
    return m


def box(name, loc, dims, mat, root):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = dims
    o.data.materials.append(mat)
    o.parent = root
    o.matrix_parent_inverse.identity()
    return o


def cyl(name, loc, radius, depth, mat, root, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=radius, depth=depth, location=loc)
    o = bpy.context.object
    o.name = name
    o.rotation_euler = rot
    o.data.materials.append(mat)
    o.parent = root
    o.matrix_parent_inverse.identity()
    return o


def build(kind, scale, tint):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    scene = bpy.context.scene
    meshes = [o for o in scene.objects if o.type == 'MESH']
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    zmin = min(p.z for p in pts)
    cx = (min(p.x for p in pts) + max(p.x for p in pts)) / 2
    cy = (min(p.y for p in pts) + max(p.y for p in pts)) / 2
    roots = [o for o in scene.objects if o.parent is None]
    root = bpy.data.objects.new('HDU_' + kind.upper(), None)
    scene.collection.objects.link(root)
    for o in roots:
        o.parent = root
        o.matrix_parent_inverse.identity()
    root.scale = (scale, scale, scale)
    root.location = (-cx * scale, -cy * scale, -zmin * scale)

    accent = material('Facility accent', tint, 0.2, 0.45)
    metal = material('Facility metal', (0.42, 0.45, 0.46), 0.8, 0.35)
    hull = material('Annex hull', (0.82, 0.83, 0.81), 0.0, 0.55)
    if kind == 'laboratory':
        cyl('Laboratory module', (5.8, 0, 2.0), 1.55, 5.4, hull, root, (0, math.pi / 2, 0))
        cyl('Laboratory collar', (3.2, 0, 2.0), 1.65, 0.35, accent, root, (0, math.pi / 2, 0))
        cyl('Laboratory viewport ring', (8.5, 0, 2.0), 1.0, 0.22, metal, root, (0, math.pi / 2, 0))
        box('Lab roof rail', (5.8, 0, 3.6), (4.4, 0.12, 0.12), metal, root)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.85, location=(6.0, 0, 4.1))
        dish = bpy.context.object
        dish.scale = (1, 1, 0.25)
        dish.data.materials.append(metal)
        dish.parent = root
        dish.matrix_parent_inverse.identity()
    elif kind == 'medical':
        box('Medical vestibule', (5.2, 0, 1.5), (2.3, 3.2, 3.0), hull, root)
        box('Medical door', (6.36, 0, 1.45), (0.08, 1.25, 2.0), accent, root)
        box('Medical cross vertical', (6.42, 0, 2.35), (0.06, 0.42, 1.1), material('Medical red', (0.72, 0.07, 0.05), 0, 0.5), root)
        box('Medical cross horizontal', (6.42, 0, 2.35), (0.06, 1.1, 0.42), material('Medical red', (0.72, 0.07, 0.05), 0, 0.5), root)
        cyl('Medical antenna', (4.0, 2.6, 3.6), 0.09, 1.5, metal, root)
    else:
        for i, (x, y) in enumerate(((5.4, 1.9), (7.0, 1.4), (6.3, 3.1), (5.2, 3.8))):
            box('Supply crate %d' % i, (x, y, 0.75), (1.35, 1.35, 1.5), accent if i % 2 else metal, root)
        box('Loading deck', (6.2, 0.1, 0.22), (4.2, 4.8, 0.42), metal, root)
        cyl('Depot mast', (3.3, 3.1, 2.4), 0.09, 3.6, metal, root)
        box('Depot beacon', (3.3, 3.1, 4.2), (0.32, 0.32, 0.32), material('Depot beacon', (1.0, 0.55, 0.15), 0, 0.3), root)

    path = os.path.join(OUT, kind + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False)
    print('SAVED', path, flush=True)


build('laboratory', 0.82, (0.10, 0.42, 0.48))
build('medical', 0.66, (0.16, 0.44, 0.40))
build('logistics', 0.86, (0.55, 0.36, 0.14))
