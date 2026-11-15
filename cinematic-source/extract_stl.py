"""Build animatable SLS components from NASA's printable outer-mold-line model.

Source: https://science.nasa.gov/3d-resources/space-launch-system-sls/
The central stack is one watertight solid in the STL, so it is sliced at the
real stage interfaces; the two boosters are already separate solids.
"""
import bpy
import bmesh
import json
import math
import os
import sys
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
STL = os.path.join(ROOT, 'nasa-assets', 'sls_printable', 'Space Launch System (SLS).stl')
if not os.path.isfile(STL):
    sys.exit('missing %s' % STL)
OUT = os.path.join(ROOT, 'nasa-assets', 'sls_components.blend')
PIVOT_JSON = os.path.join(ROOT, 'nasa-assets', 'sls_components.json')

CORE_TOP = 63.0
UPPER_TOP = 77.5
ORION_TOP = 86.5

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.stl_import(filepath=STL)
src = [o for o in bpy.data.objects if o.type == 'MESH'][0]
bpy.context.view_layer.objects.active = src
src.select_set(True)
bpy.ops.mesh.separate(type='LOOSE')
shells = [o for o in bpy.data.objects if o.type == 'MESH']


def coords(o):
    arr = np.empty(len(o.data.vertices) * 3, dtype=np.float32)
    o.data.vertices.foreach_get('co', arr)
    return arr.reshape(-1, 3)


# Y-up STL -> Z-up metres, axis centred, stack sitting on z = 0.
rot = Matrix.Rotation(math.radians(90), 4, 'X')
for o in shells:
    o.data.transform(rot)
    o.data.update()
allz = np.concatenate([coords(o)[:, 2] for o in shells])
zmin, zmax = float(allz.min()), float(allz.max())
scale = 98.0 / (zmax - zmin)
central = max(shells, key=lambda o: len(o.data.polygons))
cc = coords(central)
cx = (float(cc[:, 0].min()) + float(cc[:, 0].max())) / 2
cy = (float(cc[:, 1].min()) + float(cc[:, 1].max())) / 2
M = Matrix.Diagonal((scale, scale, scale, 1)) @ Matrix.Translation((-cx, -cy, -zmin))
for o in shells:
    o.data.transform(M)
    o.data.update()

coll = bpy.data.collections.new('NASA_SLS_COMPONENTS')
bpy.context.scene.collection.children.link(coll)


def mat(name, color, metallic=0.0, rough=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = rough
    return m


ORANGE = mat('SLS_core_orange_foam', (0.63, 0.21, 0.05), 0.03, 0.62)
WHITE = mat('SLS_booster_white', (0.87, 0.87, 0.84), 0.06, 0.4)
UPPER = mat('SLS_upper_white', (0.83, 0.84, 0.85), 0.14, 0.36)
CERAMIC = mat('Orion_white_ceramic', (0.8, 0.79, 0.76), 0.04, 0.33)
GOLD = mat('Orion_MLI_gold', (0.66, 0.38, 0.07), 0.9, 0.3)
LASM = mat('LAS_white', (0.89, 0.89, 0.87), 0.1, 0.38)


def slice_shell(z0, z1, name):
    o = central.copy()
    o.data = central.data.copy()
    coll.objects.link(o)
    o.name = name
    bm = bmesh.new()
    bm.from_mesh(o.data)
    for z, inner, outer in ((z0, True, False), (z1, False, True)):
        bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                               plane_co=(0, 0, z), plane_no=(0, 0, 1),
                               clear_inner=inner, clear_outer=outer)
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    return o


def finish(o, key, material, ratio):
    arr = coords(o)
    pivot = (round(float((arr[:, 0].min() + arr[:, 0].max()) / 2), 3),
             round(float((arr[:, 1].min() + arr[:, 1].max()) / 2), 3),
             round(float(arr[:, 2].min()), 3))
    print('  %-12s z=%.1f..%.1f x=%.1f..%.1f polys=%d pivot=%s' % (
        key, arr[:, 2].min(), arr[:, 2].max(), arr[:, 0].min(), arr[:, 0].max(),
        len(o.data.polygons), pivot), flush=True)
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.materials.clear()
    o.data.materials.append(material)
    o.data.transform(Matrix.Translation(-Vector(pivot)))
    o.location = pivot
    dec = o.modifiers.new('Viewport decimation', 'DECIMATE')
    dec.ratio = ratio
    dec.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=dec.name)
    return o


pivots = {}
parts = []

# central stack slices
for key, z0, z1, material, ratio in (
        ('CORE_STAGE', 0.0, CORE_TOP, ORANGE, 0.5),
        ('UPPER_STAGE', CORE_TOP, UPPER_TOP, UPPER, 0.5),
        ('ORION', UPPER_TOP, ORION_TOP, CERAMIC, 0.55),
        ('LAS', ORION_TOP, 98.0, LASM, 0.5)):
    o = slice_shell(z0, z1, key + '_MESH')
    if key == 'CORE_STAGE':
        # the engine bells / boattail are separate small solids in the STL
        extra = []
        for sh in shells:
            arr = coords(sh)
            cxx = (float(arr[:, 0].min()) + float(arr[:, 0].max())) / 2
            if arr[:, 2].max() < 8.0 and abs(cxx) < 3.4 and len(sh.data.polygons) > 500:
                extra.append(sh)
        if extra:
            bpy.ops.object.select_all(action='DESELECT')
            o.select_set(True)
            for e in extra:
                e.select_set(True)
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.join()
            o = bpy.context.view_layer.objects.active
            o.name = key + '_MESH'
    if key == 'ORION':
        o.data.materials.append(GOLD)
    o = finish(o, key, material, ratio)
    if key == 'ORION':
        for p in o.data.polygons:
            if p.center.z < 4.8:
                p.material_index = 1
    pivots[key] = list(o.location)
    parts.append(o)

# boosters: the two large lateral solids plus their feed lines
jobs = {}
for key, sign in (('SRB_LEFT', -1), ('SRB_RIGHT', 1)):
    group = []
    for o in list(shells):
        try:
            arr = coords(o)
        except ReferenceError:
            continue
        cxx = (float(arr[:, 0].min()) + float(arr[:, 0].max())) / 2
        zspan = float(arr[:, 2].max() - arr[:, 2].min())
        if sign * cxx > 3.0 and zspan > 3.0 and arr[:, 2].max() < CORE_TOP:
            group.append(o)
    jobs[key] = group

for key, group in jobs.items():
    if not group:
        continue
    bpy.ops.object.select_all(action='DESELECT')
    for g in group:
        g.select_set(True)
    bpy.context.view_layer.objects.active = group[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = key + '_MESH'
    o = finish(o, key, WHITE, 0.6)
    pivots[key] = list(o.location)
    parts.append(o)

for o in list(bpy.data.objects):
    if o.type == 'MESH' and o not in parts:
        bpy.data.objects.remove(o, do_unlink=True)
for me in list(bpy.data.meshes):
    if me.users == 0:
        bpy.data.meshes.remove(me)

with open(PIVOT_JSON, 'w') as fh:
    json.dump(pivots, fh, indent=1)
print('PIVOTS', pivots, flush=True)
bpy.context.scene['source'] = "NASA Space Launch System printable model (outer mold line)"
bpy.context.scene['source_url'] = 'https://science.nasa.gov/3d-resources/space-launch-system-sls/'
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
print('SAVED', OUT, flush=True)
