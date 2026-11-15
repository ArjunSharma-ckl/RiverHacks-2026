"""Build a white pressurized crew transport ('space car') for the settlement."""
import bpy, math, os
HERE=os.path.dirname(os.path.abspath(__file__))
OUT=os.path.join(HERE,'..','public','models','mission')
bpy.ops.wm.read_factory_settings(use_empty=True)

def mat(name,color,metallic=0.0,rough=0.55):
    m=bpy.data.materials.new(name); m.use_nodes=True
    b=m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value=(*color,1)
    b.inputs['Metallic'].default_value=metallic; b.inputs['Roughness'].default_value=rough
    return m

def cube(name,loc,dims,material,rot=(0,0,0)):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc,rotation=rot)
    o=bpy.context.object; o.name=name; o.scale=dims; o.data.materials.append(material)
    bevel=o.modifiers.new('soft edges','BEVEL'); bevel.width=0.06; bevel.segments=2
    return o

def cyl(name,loc,radius,depth,material,rot=(0,0,0),vertices=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=loc,rotation=rot)
    o=bpy.context.object; o.name=name; o.data.materials.append(material)
    return o

def sphere(name,loc,radius,material,scale=(1,1,1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=10,radius=radius,location=loc)
    o=bpy.context.object; o.name=name; o.scale=scale; o.data.materials.append(material)
    return o

white=mat('Transport hull',(0.82,0.84,0.80),0.05,0.45)
warm=mat('Transport trim',(0.58,0.62,0.59),0.25,0.4)
dark=mat('Transport wheels',(0.035,0.04,0.04),0.3,0.8)
glass=mat('Transport glass',(0.03,0.12,0.17),0.75,0.15)
gold=mat('Transport visor',(0.46,0.33,0.12),0.75,0.18)
solar=mat('Transport solar',(0.035,0.10,0.22),0.55,0.22)
light=mat('Transport light',(1.0,0.62,0.22),0.1,0.25)

cube('Hull',(0,0,1.18),(4.7,2.35,1.12),white)
cube('Belly',(0,0,.66),(4.0,2.0,.38),warm)
cube('Cabin',(.25,0,1.95),(2.45,2.06,.82),white)
cube('Windshield',(1.48,0,2.02),(.08,1.72,.48),glass,rot=(0,0,0))
for side in (-1,1):
    cube('Side window %s'%side,(.25,side*1.035,2.03),(1.55,.035,.36),glass)
    for x in (-1.45,1.45):
        cyl('Wheel %s %s'%(side,x),(x,side*1.22,.51),.5,.28,dark,rot=(math.pi/2,0,0))
        cyl('Hub %s %s'%(side,x),(x,side*1.37,.51),.24,.06,gold,rot=(math.pi/2,0,0))
        cube('Fender %s %s'%(side,x),(x,side*1.12,.93),(.9,.3,.2),warm)
    cyl('Rear hatch %s'%side,(-2.42,side*.45,1.3),.36,.09,warm,rot=(0,math.pi/2,0))
    sphere('Headlight %s'%side,(2.38,side*.62,1.16),.11,light,scale=(.7,1,1))

cube('Solar roof',(-.2,0,2.42),(2.8,1.55,.07),solar)
for x in (-1.6,-.8,0,.8,1.6):
    cube('Solar divider %s'%x,(x,0,2.46),(.025,1.5,.02),gold)
for side in (-1,1):
    cyl('Dock light %s'%side,(-2.5,side*.95,1.55),.075,.12,light,rot=(0,math.pi/2,0))
for side in (-1,1):
    cube('Ladder %s'%side,(-1.9,side*1.17,1.55),(.04,.06,1.1),warm)
cube('Front bumper',(2.38,0,.78),(.22,2.1,.22),warm)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'space-car.glb'),export_format='GLB',use_selection=False)
print('SAVED space-car',flush=True)
