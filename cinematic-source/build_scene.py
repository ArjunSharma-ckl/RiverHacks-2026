"""Build the MF-X1 flight, its field lander and the seven shot camera edit in Blender."""
import math
import random
from pathlib import Path
import bpy
from mathutils import Vector, noise

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "cinematic-source"
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
random.seed(41)
def material(name, rgb, metal=0, rough=.42, glow=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    shader = m.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*rgb, 1)
    shader.inputs["Metallic"].default_value = metal
    shader.inputs["Roughness"].default_value = rough
    shader.inputs["Emission Color"].default_value = (*rgb, 1)
    shader.inputs["Emission Strength"].default_value = glow
    return m

ivory = material("Thermal ceramic", (.82,.83,.77), .28)
steel = material("Titanium", (.26,.31,.33), .78)
black = material("Carbon composite", (.035,.048,.057), .45)
copper = material("Anodized copper", (.75,.22,.055), .63)
glass = material("Cockpit glazing", (.024,.11,.17), .83,.13)
lamp = material("Navigation lights", (.32,.84,1), glow=4)
flame = material("Exhaust mantle", (1,.21,.025), glow=4)
core = material("Exhaust core", (1,.83,.48), glow=8)
def group(name, xyz=(0,0,0), parent=None):
    o = bpy.data.objects.new(name,None)
    scene.collection.objects.link(o)
    o.parent = parent
    o.location = xyz
    return o
def finish(name, xyz, mat, parent):
    o = bpy.context.object
    o.name = name
    o.parent = parent
    o.location = xyz
    o.data.materials.append(mat)
    return o
def box(name, xyz, dims, mat, p=None):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = finish(name, xyz, mat, p)
    for v in o.data.vertices:
        for i in range(3): v.co[i] *= dims[i]
    return o
def cylinder(name, xyz, low, high, h, mat, p=None, sides=48):
    bpy.ops.mesh.primitive_cone_add(vertices=sides,radius1=low,radius2=high,depth=h)
    o = finish(name,xyz,mat,p)
    for face in o.data.polygons: face.use_smooth = len(face.vertices)<=4
    return o
def rod(name,a,b,r,mat,p=None):
    a,b = Vector(a),Vector(b)
    o = cylinder(name,(a+b)/2,r,r,(a-b).length,mat,p,12)
    o.rotation_euler = (b-a).to_track_quat("Z","Y").to_euler()
    return o
def key(o,attr,f,value):
    setattr(o,attr,value)
    o.keyframe_insert(data_path=attr,frame=f)
def move(o,keys):
    for f,v in keys: key(o,"location",f,v)
def mark(name,body,xyz,size,mat,p):
    curve=bpy.data.curves.new(name,"FONT")
    curve.body=body
    curve.align_x="CENTER"
    curve.size=size
    o=bpy.data.objects.new(name,curve)
    scene.collection.objects.link(o)
    o.parent=p
    o.location=xyz
    o.rotation_euler.x=math.pi/2
    curve.materials.append(mat)
    return o

rocket=group("MF-X1 launch assembly")
booster=group("Recoverable first stage",parent=rocket)
upper=group("Orbital transfer stage",parent=rocket)
for z,lo,hi,h,mat in [(5.3,1.33,1.33,8.8,ivory),(1.3,1.39,1.33,.9,black),(9.9,1.35,1.35,.5,black)]:
    cylinder("Booster hull",(0,0,z),lo,hi,h,mat,booster)
for z in [1.45,2.6,4.2,6,8.4,9.4,9.75,10]:
    cylinder("Tank seam",(0,0,z),1.35,1.35,.064,steel,booster)
for i in range(8):
    a=i*math.tau/8
    x,y=math.cos(a),math.sin(a)
    cylinder("Rocket engine bell",(.83*x,.83*y,.65),.39,.19,.7,steel,booster)
    rod("Feed line",(1.33*x,1.33*y,1.5),(1.33*x,1.33*y,8.9),.05,steel,booster)
for x in [-1.72,1.72]:
    cylinder("Auxiliary booster",(x,0,4.6),.53,.53,7.1,ivory,booster)
    cylinder("Booster ogive",(x,0,8.68),.54,.09,1.1,copper,booster)
    cylinder("Auxiliary skirt",(x,0,1.22),.56,.52,.45,black,booster)
for z,lo,hi,h,mat in [(10.45,.8,.53,.75,steel),(12.9,1.31,1.31,4.2,ivory),(15.25,1.31,1.48,.5,copper),(16.65,1.48,1.48,2.3,ivory),(18.55,1.48,.74,1.5,ivory),(19.7,.74,.04,.8,ivory)]:
    cylinder("Transfer hull",(0,0,z),lo,hi,h,mat,upper)
for z in [11.1,11.25,14.75,15.5,17.75]:
    cylinder("Interstage band",(0,0,z),1.5 if z>=15.5 else 1.33,1.5 if z>=15.5 else 1.33,.07,black,upper)
mark("Flight number","X1",(0,-1.33,6.4),.88,black,booster)
mark("Mission livery","MF",(0,-1.32,13),.75,black,upper)

def engine(p,z,r,h):
    jet=group("Throttle envelope",(0,0,z),p)
    # Transparent turbulent exhaust sheets with an axial temperature gradient.
    for layer in range(2):
        m=bpy.data.materials.new("Turbulent exhaust")
        m.use_nodes=True
        nt=m.node_tree
        nt.nodes.clear()
        def node(kind): return nt.nodes.new(kind)
        def connect(a,b): nt.links.new(a,b)
        uv=node("ShaderNodeTexCoord")
        split=node("ShaderNodeSeparateXYZ")
        connect(uv.outputs["Generated"],split.inputs[0])
        turb=node("ShaderNodeTexNoise")
        turb.noise_dimensions="4D"
        turb.inputs["Scale"].default_value=5
        turb.inputs["Detail"].default_value=4
        turb.inputs["W"].driver_add("default_value").driver.expression="frame * 0.09"
        opacity=node("ShaderNodeMath"); opacity.operation="MULTIPLY"
        connect(split.outputs["Z"],opacity.inputs[0]); connect(turb.outputs[0],opacity.inputs[1])
        emit=node("ShaderNodeEmission")
        emit.inputs[0].default_value=(1,.29,.055,1) if layer==0 else (1,.79,.45,1)
        emit.inputs[1].default_value=6 if layer==0 else 16
        mix=node("ShaderNodeMixShader")
        connect(opacity.outputs[0],mix.inputs[0]); connect(node("ShaderNodeBsdfTransparent").outputs[0],mix.inputs[1])
        connect(emit.outputs[0],mix.inputs[2]);connect(mix.outputs[0],node("ShaderNodeOutputMaterial").inputs["Surface"])
        verts=[]; faces=[]
        for j in range(25):
            t=j/24
            for i in range(32):
                a=math.tau*i/32
                ripple=noise.noise_vector(Vector((math.cos(a)*2,math.sin(a)*2,t*9))).x
                radius=r*(.68+.46*t+.45*t*ripple)*(.63 if layer else 1)
                verts.append((radius*math.cos(a)+t*t*r*.38,radius*math.sin(a),-h*t*(.69 if layer else 1)))
                if j: faces.append(((j-1)*32+i,(j-1)*32+(i+1)%32,j*32+(i+1)%32,j*32+i))
        mesh=bpy.data.meshes.new("Shear layer"); mesh.from_pydata(verts,[],faces)
        o=bpy.data.objects.new("Exhaust mixing layer",mesh);scene.collection.objects.link(o);o.parent=jet;mesh.materials.append(m)
    light=bpy.data.lights.new("Engine bounce","POINT");light.color=(1,.39,.105);light.shadow_soft_size=r
    o=bpy.data.objects.new("Engine illumination",light);scene.collection.objects.link(o);o.parent=jet
    driver=light.driver_add("energy").driver
    v=driver.variables.new();v.name="throttle";v.type="SINGLE_PROP";v.targets[0].id=jet;v.targets[0].data_path="scale[2]"
    driver.expression=f"{int(3100*r)} * throttle**2"
    return jet
jet=engine(booster,.55,1.08,8)
for f,s in [(1,.001),(62,.001),(72,.65),(100,1.1),(151,.85),(154,.001)]:
    key(jet,"scale",f,(s,s,s))
upperJet=engine(upper,10.2,.66,4)
for f,s in [(1,.001),(158,.001),(167,1),(205,.7),(214,.001)]:
    key(upperJet,"scale",f,(s,s,s))

lander=group("Kestrel field lander")
for z,lo,hi,h,mat in [(1.18,1.4,2.02,.7,black),(1.82,2.03,1.95,.6,copper),(2.8,1.96,1.75,1.4,ivory),(3.82,1.76,1.12,.65,glass),(4.21,1.13,.92,.16,ivory)]:
    cylinder("Descent cabin",(0,0,z),lo,hi,h,ivory if mat==glass else mat,lander,48)
for i in range(12):
    a=i*math.tau/12
    x,y=math.sin(a),-math.cos(a)
    panel=box("Recessed avionics panel",(1.93*x,1.93*y,2.05),(.52,.085,.3),steel,lander)
    panel.rotation_euler.z=a
    frame=box("Window seal",(1.51*x,1.51*y,3.76),(.67,.12,.43),black,lander)
    frame.rotation_euler=(math.radians(-43),0,a)
    pane=box("Laminated window",(1.55*x,1.55*y,3.79),(.56,.12,.31),glass,lander)
    pane.rotation_euler=frame.rotation_euler
    rod("Cabin seam",(1.93*x,1.93*y,2.16),(1.76*x,1.76*y,3.48),.018,steel,lander)
for i in range(4):
    a=math.pi*.25+i*math.pi/2
    x,y=math.cos(a),math.sin(a)
    rod("Shock absorber",(1.52*x,1.52*y,2.15),(2.75*x,2.75*y,.2),.11,steel,lander)
    rod("Compression strut",(1.36*x,1.36*y,1.05),(2.67*x,2.67*y,.32),.075,ivory,lander)
    cylinder("Landing shoe",(2.75*x,2.75*y,.12),.46,.29,.22,black,lander)
    cylinder("Vernier",(1.38*x,1.38*y,.92),.3,.16,.48,steel,lander)
box("Airlock recess",(0,-1.83,2.21),(1.15,.15,1.86),black,lander)
hinge=group("Airlock hinge",(0,-1.93,1.27),lander)
box("Boarding ramp",(0,0,1.12),(1.06,.13,2.24),steel,hinge)
for i in range(9): box("Traction tread",(0,.085,.14+i*.24),(.92,.09,.075),black,hinge)
for x in [-.72,.72]: box("Entry lamp",(x,-1.79,2.8),(.12,.08,.31),lamp,lander)
mark("Vehicle call sign","K E S T R E L",(0,-1.82,3.19),.18,black,lander)
hinge.rotation_euler.x=2.16
bpy.ops.object.select_all(action="DESELECT")
for o in [lander,*lander.children_recursive]: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(ROOT/"public/models/mission/kestrel.glb"),use_selection=True,export_animations=False)
key(hinge,"rotation_euler",396,(0,0,0))
key(hinge,"rotation_euler",414,(2.16,0,0))
descentJet=engine(lander,.98,.89,3.7)
for f,s in [(1,.001),(262,.9),(325,1.1),(369,.65),(381,.001)]:
    key(descentJet,"scale",f,(s,s,s))

# Three sets are staged kilometres apart so they can share a single edit timeline.
field=3000
space=6000
move(rocket,[(1,(0,0,1)),(67,(0,0,1)),(90,(0,0,2.5)),(135,(0,0,21)),(136,(space,0,8)),(195,(space+3,0,13)),(261,(space+9,0,17))])
for f,ang in [(135,0),(136,.8),(195,1.12),(261,1.43)]: key(rocket,"rotation_euler",f,(0,ang,0))
move(booster,[(150,(0,0,0)),(195,(-2,0,-9)),(261,(-8,0,-30))])
key(booster,"rotation_euler",150,(0,0,0))
key(booster,"rotation_euler",228,(.11,-.42,.12))
move(lander,[(1,(field,0,60)),(195,(space+21,0,22)),(196,(space+22,0,23)),(261,(space+30,-4,24)),(262,(field,0,38)),(302,(field,0,19)),(339,(field,0,5.8)),(365,(field,0,1.1)),(376,(field,0,.02)),(379,(field,0,-.06)),(384,(field,0,0)),(450,(field,0,0))])

def ground(origin):
    width=520
    count=75
    verts=[]
    for j in range(count):
        for i in range(count):
            x=(i/(count-1)-.5)*width
            y=(j/(count-1)-.5)*width
            edge=min(1,max(0,(math.hypot(x,y)-21)/60))
            z=edge*(2+10*noise.fractal(Vector((x*.027,y*.027,2)),1.1,2,4))
            verts.append((x+origin,y,z-.07))
    mesh=bpy.data.meshes.new("Basin relief")
    mesh.from_pydata(verts,[],[(j*count+i,j*count+i+1,(j+1)*count+i+1,(j+1)*count+i) for j in range(count-1) for i in range(count-1)])
    o=bpy.data.objects.new("Analog basin",mesh)
    scene.collection.objects.link(o)
    m=material("Basalt and alluvium",(.47,.29,.18),rough=.93)
    nt=m.node_tree
    tex=nt.nodes.new("ShaderNodeTexImage")
    tex.image=bpy.data.images.load(str(ROOT/"public/assets/mission/atacama-ground.jpg"),check_existing=True)
    uv=nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(uv.outputs["Generated"],tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"],nt.nodes.get("Principled BSDF").inputs["Base Color"])
    mesh.materials.append(m)
    for poly in mesh.polygons: poly.use_smooth=True
ground(0)
ground(field)
rock=material("Weathered basalt",(.15,.10,.075),rough=.91)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1)
stone=finish("Talus",(field+8,0,0),rock,None)
for i in range(220):
    o=stone.copy();scene.collection.objects.link(o)
    a=random.uniform(0,math.tau);d=random.uniform(3.5,34);r=random.uniform(.07,.43)
    o.location=(field+d*math.cos(a),d*math.sin(a),-.035)
    o.rotation_euler.z=a
    o.scale=(r*1.7,r,r*random.uniform(.45,.95))
stone.scale=(.5,.4,.18)
box("Flame trench",(0,0,.25),(10,10,.62),black)
for j in range(12):
    z=j*1.6
    box("Access deck",(-4,1,z+.6),(2.4,2.4,.13),steel)
    for x in [-5,-3]:
        for y in [0,2]: rod("Gantry column",(x,y,z),(x,y,z+1.6),.095,steel)
    rod("Lattice brace",(-5,0,z),(-3,0,z+1.6),.075,copper)
    rod("Lattice brace",(-3,0,z),(-5,0,z+1.6),.07,steel)
    if j in [4,8,11]:
        box("Umbilical",(-2.48,1,z+.7),(2.8,.8,.23),copper)
    if j%3==0: box("Tower beacon",(-5,0,z+.78),(.13,.13,.18),lamp)
for x,y in [(11,10),(15,10),(-14,14)]:
    cylinder("Cryogenic storage",(x,y,2.5),1.6,1.6,5,ivory)
    cylinder("Tank dome",(x,y,5.22),1.6,.64,.44,steel)

def import_model(name,xyz,height):
    bpy.ops.import_scene.gltf(filepath=str(ROOT/f"public/models/mission/{name}.glb"))
    objects=list(bpy.context.selected_objects)
    roots=[o for o in objects if not o.parent]
    points=[o.matrix_world@Vector(v) for o in objects if o.type=="MESH" for v in o.bound_box]
    low=[min(v[i] for v in points) for i in range(3)]
    high=[max(v[i] for v in points) for i in range(3)]
    scale=height/(high[2]-low[2])
    p=group(name,xyz)
    center=group("Asset datum",(-scale*(low[0]+high[0])/2,-scale*(low[1]+high[1])/2,-scale*low[2]),p)
    center.scale=(scale,)*3
    for o in roots:o.parent=center
    return p
import_model("habitat",(field-10,8,0),4)
import_model("laboratory",(field-2,10,0),3.4)
import_model("rover",(field+7,4,0),2.1)
for x in [-8,-7,-6,-5]: box("Pressure connector",(field+x,9,1.1),(1.1,1.45,1.9),ivory)
for i in range(3):
    box("Array mast",(field+3+i*2.5,11,.72),(.15,.15,1.44),steel)
    box("Photovoltaic wing",(field+3+i*2.5,11,1.44),(2.35,3,.13),glass).rotation_euler.x=.24
crew=import_model("field-suit",(field,-1.88,1.24),1.74)
crew.rotation_euler.z=math.pi
move(crew,[(1,(field,0,1.1)),(408,(field,-1.74,1.24)),(430,(field,-3.53,.17)),(450,(field+.22,-4.5,0))])
for o in crew.children_recursive:
    if o.name in ["LegL","LegR","ArmL","ArmR"]:
        base=o.rotation_euler.copy()
        o.rotation_mode="XYZ"
        for f in range(408,451,3):
            v=base.copy()
            v.x+=.38*math.sin((f-408)*.29)*(1 if o.name in ["LegL","ArmR"] else -1)
            if o.name=="ArmR" and f>435:v.y+=(f-435)*.055
            key(o,"rotation_euler",f,v)

# Soft edged dust volumes use a radial extinction profile and turbulent density.
dust=bpy.data.materials.new("Windborne exhaust")
dust.use_nodes=True
nt=dust.node_tree
nt.nodes.remove(nt.nodes.get("Principled BSDF"))
vol=nt.nodes.new("ShaderNodeVolumePrincipled")
vol.inputs["Color"].default_value=(.64,.54,.41,1)
nt.links.new(vol.outputs[0],nt.nodes.get("Material Output").inputs["Volume"])
coord=nt.nodes.new("ShaderNodeTexCoord")
distance=nt.nodes.new("ShaderNodeVectorMath"); distance.operation="DISTANCE"
distance.inputs[1].default_value=(.5,.5,.5)
nt.links.new(coord.outputs["Generated"],distance.inputs[0])
ramp=nt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].color=(.62,.62,.62,1)
ramp.color_ramp.elements[1].position=.51
ramp.color_ramp.elements[1].color=(0,0,0,1)
nt.links.new(distance.outputs["Value"],ramp.inputs[0])
texture=nt.nodes.new("ShaderNodeTexNoise")
texture.inputs["Scale"].default_value=4
product=nt.nodes.new("ShaderNodeMath"); product.operation="MULTIPLY"
nt.links.new(ramp.outputs[0],product.inputs[0]); nt.links.new(texture.outputs[0],product.inputs[1]); nt.links.new(product.outputs[0],vol.inputs["Density"])
for origin,first,last in [(0,60,135),(field,328,450)]:
    for i in range(14):
        a=random.uniform(0,math.tau)
        o=box("Dust billow",(origin,0,.5),(1,1,1),dust)
        start=first+i%7*3
        key(o,"scale",start,(.001,)*3)
        key(o,"scale",int((start+last)/2),(8+i%4,7+i%4,1.8+i%2))
        key(o,"scale",last,(12+i%4,9+i%4,1.5+i%3))
        move(o,[(start,(origin,0,.55)),(last,(origin+(5+i%7)*math.cos(a),(5+i%7)*math.sin(a),.65))])

earth=material("Blue Marble",(.1,.2,.4),rough=.85)
tex=earth.node_tree.nodes.new("ShaderNodeTexImage")
tex.image=bpy.data.images.load(str(ROOT/"public/textures/earth.jpg"))
earth.node_tree.links.new(tex.outputs[0],earth.node_tree.nodes.get("Principled BSDF").inputs["Base Color"])
bpy.ops.mesh.primitive_uv_sphere_add(segments=160,ring_count=96,radius=97)
planet=finish("Earth • survey orbit",(space,44,-83),earth,None)
for face in planet.data.polygons: face.use_smooth=True
world=bpy.data.worlds.new("Dawn atmosphere")
scene.world=world
world.use_nodes=True
nt=world.node_tree
sky=nt.nodes.new("ShaderNodeTexSky")
sky.sky_type="NISHITA"; sky.sun_elevation=.19; sky.sun_rotation=2.6
bg=nt.nodes.get("Background")
nt.links.new(sky.outputs[0],bg.inputs["Color"])
for f,v in [(1,.27),(135,.27),(136,.00009),(261,.00009),(262,.27)]:
    bg.inputs["Strength"].default_value=v
    bg.inputs["Strength"].keyframe_insert(data_path="default_value",frame=f)
bpy.ops.object.light_add(type="SUN")
sun=bpy.context.object
sun.rotation_euler=(1.18,-.46,-.5)
sun.data.energy=2.8
sun.data.angle=.045
def shot(name,f1,f2,p1,p2,t1,t2,lens):
    bpy.ops.object.camera_add()
    cam=bpy.context.object
    cam.name=name
    cam.data.lens=lens
    cam.data.clip_end=1000
    for f,pos,aim in [(f1,p1,t1),(f2,p2,t2)]:
        key(cam,"location",f,pos)
        key(cam,"rotation_euler",f,(Vector(aim)-Vector(pos)).to_track_quat("-Z","Y").to_euler())
    marker=scene.timeline_markers.new(name,frame=f1)
    marker.camera=cam
    return cam
scene.camera=shot("01 · Countdown",1,66,(16,-39,6),(13,-36,5),(0,0,10),(0,0,10),34)
shot("02 · Tower clear",67,135,(10,-24,2),(15,-38,20),(0,0,7),(0,0,30),31)
shot("03 · Stage separation",136,195,(space+11,-28,18),(space+8,-35,21),(space+8,0,15),(space+13,0,20),36)
shot("04 · Payload deployment",196,261,(space+24,-30,27),(space+31,-24,30),(space+17,0,20),(space+26,0,22),43)
descent_cam=shot("05 · Terminal descent",262,339,(field+10,-18,46),(field+11,-20,14),(field,0,39),(field,0,8),37)
# Track the cabin through the braking curve.
target=group("Descent tracking point",(0,0,2),lander)
track=descent_cam.constraints.new("TRACK_TO");track.target=target;track.track_axis="TRACK_NEGATIVE_Z";track.up_axis="UP_Y"
shot("06 · Touchdown",340,396,(field+9,-17,2),(field+8,-15,1.4),(field,0,5.6),(field,0,2.1),37)
shot("07 · Field deployment",397,450,(field+4,-9,2.5),(field+7,-14,3.4),(field,-1.4,2),(field-2,.5,2),36)
scene.frame_end=450
scene.render.fps=30
scene.render.engine="CYCLES"
scene.cycles.samples=3
scene.cycles.use_denoising=True
scene.cycles.max_bounces=3
scene.cycles.volume_bounces=0
scene.render.resolution_x=1920
scene.render.resolution_y=1080
scene.render.resolution_percentage=100
scene.render.image_settings.file_format="JPEG"
scene.render.image_settings.quality=94
scene.view_settings.exposure=-.85
scene.view_settings.look="AgX - Medium High Contrast"
scene.render.filepath="//frames/frame-"
scene.frame_set(1)
bpy.ops.file.pack_all()
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/"missionforge-launch.blend"),compress=True)

