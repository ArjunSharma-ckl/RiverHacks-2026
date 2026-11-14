"""Native 30-second NASA SLS/Orion to Mars animation; no footage or sequencer."""
from __future__ import annotations
import math, os, random
from pathlib import Path
import bpy
from mathutils import Vector

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'cinematic-source'/'missionforge-launch.blend'
ASTRO=ROOT/'public'/'models'/'mission'/'field-suit.glb'
SLS_SRC=next((p for p in [Path(os.environ['NASA_SLS_BLEND']) if os.environ.get('NASA_SLS_BLEND') else None,ROOT/'cinematic-source'/'assets'/'Block 1 (GNC markings).blend',ROOT.parent/'nasa-extracted'/'Block 1 (GNC markings).blend'] if p and p.is_file()),None)
if not SLS_SRC: raise FileNotFoundError('Official NASA SLS Block 1 source missing; set NASA_SLS_BLEND')
bpy.ops.wm.read_factory_settings(use_empty=True)
s=bpy.context.scene; s.render.engine='BLENDER_EEVEE'; s.render.fps=30; s.frame_start=1; s.frame_end=900
s.render.resolution_x=1920; s.render.resolution_y=1080; s.render.resolution_percentage=60; s.render.image_settings.file_format='PNG'; s.render.use_sequencer=False
s.world=bpy.data.worlds.new('Deep space'); s.world.use_nodes=True; s.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.002,.004,.012,1); s.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.12
s.view_settings.look='AgX - Medium High Contrast'

def col(n,p=None):
 c=bpy.data.collections.new(n); (p or s.collection).children.link(c); return c
SLS,FX,MARS,ENV,CAMS=col('SLS_ASSEMBLY'),col('FLIGHT_EFFECTS'),col('MARS_MISSION'),col('ENVIRONMENT'),col('CAMERAS_AND_LIGHTS')
def mat(n,c,met=0,rough=.45,emit=0):
 m=bpy.data.materials.new(n); m.use_nodes=True; b=m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value=(*c,1); b.inputs['Metallic'].default_value=met; b.inputs['Roughness'].default_value=rough
 if b.inputs.get('Emission Color'): b.inputs['Emission Color'].default_value=(*c,1); b.inputs['Emission Strength'].default_value=emit
 return m
def plume_mat(n,c,e):
 m=bpy.data.materials.new(n); m.use_nodes=True; t=m.node_tree; t.nodes.clear(); out=t.nodes.new('ShaderNodeOutputMaterial'); mix=t.nodes.new('ShaderNodeMixShader'); tr=t.nodes.new('ShaderNodeBsdfTransparent'); em=t.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value=(*c,1); em.inputs['Strength'].default_value=e; no=t.nodes.new('ShaderNodeTexNoise'); no.noise_dimensions='4D'; no.inputs['Scale'].default_value=4; no.inputs['W'].driver_add('default_value').driver.expression='frame*.13'; ra=t.nodes.new('ShaderNodeValToRGB'); ra.color_ramp.elements[0].position=.32; ra.color_ramp.elements[1].position=.64; t.links.new(no.outputs['Fac'],ra.inputs['Fac']); t.links.new(ra.outputs['Color'],mix.inputs[0]); t.links.new(tr.outputs[0],mix.inputs[1]); t.links.new(em.outputs[0],mix.inputs[2]); t.links.new(mix.outputs[0],out.inputs['Surface']); return m
def volume_mat():
 m=bpy.data.materials.new('Volumetric Mars dust'); m.use_nodes=True; t=m.node_tree; t.nodes.clear(); o=t.nodes.new('ShaderNodeOutputMaterial'); v=t.nodes.new('ShaderNodeVolumePrincipled'); v.inputs['Color'].default_value=(.42,.14,.035,1); v.inputs['Density'].default_value=1.8; t.links.new(v.outputs['Volume'],o.inputs['Volume']); return m
WHITE=mat('Ceramic white',(.8,.8,.76),.1,.3); ORANGE=mat('SLS insulation orange',(.7,.16,.02),.04,.46); BLACK=mat('Thermal blanket',(.012,.016,.026),.3,.33); METAL=mat('Aerospace alloy',(.25,.3,.34),.82,.25); GOLD=mat('Thermal gold',(.74,.38,.025),.85,.22); RED=mat('Mars regolith',(.34,.10,.03),0,.92); BLUE=mat('Solar cells',(.008,.026,.12),.4,.18); FLAG=mat('Flag fabric',(.08,.006,.016),0,.5); TEXT=mat('Flag text',(.95,.85,.52),.1,.25); HOT=plume_mat('Blue white exhaust',(.7,.9,1),18); FIRE=plume_mat('Turbulent exhaust',(1,.12,.01),5); DUST=volume_mat()
def link(o,c):
 for q in list(o.users_collection): q.objects.unlink(o)
 c.objects.link(o); return o
def emp(n,loc=(0,0,0),par=None,c=ENV):
 o=bpy.data.objects.new(n,None); c.objects.link(o); o.location=loc; o.parent=par; return o
def smooth(o):
 if o.type=='MESH':
  for p in o.data.polygons:p.use_smooth=True
def cube(n,l,d,m,par=None,c=ENV):
 bpy.ops.mesh.primitive_cube_add(size=1); o=link(bpy.context.object,c); o.name=n; o.location=l; o.dimensions=d; o.parent=par; o.data.materials.append(m); return o
def cyl(n,l,r,h,m,par=None,c=ENV,v=32):
 bpy.ops.mesh.primitive_cylinder_add(vertices=v,radius=r,depth=h); o=link(bpy.context.object,c); o.name=n;o.location=l;o.parent=par;o.data.materials.append(m);smooth(o);return o
def cone(n,l,r1,r2,h,m,par=None,c=ENV,v=32):
 bpy.ops.mesh.primitive_cone_add(vertices=v,radius1=r1,radius2=r2,depth=h);o=link(bpy.context.object,c);o.name=n;o.location=l;o.parent=par;o.data.materials.append(m);smooth(o);return o
def sphere(n,l,r,m,par=None,c=ENV,seg=48):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=seg,ring_count=seg//2,radius=r);o=link(bpy.context.object,c);o.name=n;o.location=l;o.parent=par;o.data.materials.append(m);smooth(o);return o
def rod(n,a,b,r,m,par=None,c=ENV):
 a,b=Vector(a),Vector(b);o=cyl(n,(a+b)/2,r,(a-b).length,m,par,c,12);o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o
def parent_world(o,p):
 w=o.matrix_world.copy();o.parent=p;o.matrix_parent_inverse=p.matrix_world.inverted();o.matrix_world=w
def k(o,path,f,x): setattr(o,path,x);o.keyframe_insert(data_path=path,frame=f)
def tf(o,f,l=None,r=None,sc=None):
 if l is not None:k(o,'location',f,l)
 if r is not None:o.rotation_mode='XYZ';k(o,'rotation_euler',f,r)
 if sc is not None:k(o,'scale',f,sc)

# Append, preserve and reorganize NASA's official Block 1 model.
with bpy.data.libraries.load(str(SLS_SRC),link=False) as (a,b): b.collections=['Collection']
nasa=b.collections[0];nasa.name='NASA_SLS_BLOCK_1_OFFICIAL';SLS.children.link(nasa)
print('STAGE: official NASA Block 1 model appended', flush=True)
for n in ('Camera','Light'):
 if bpy.data.objects.get(n):bpy.data.objects.remove(bpy.data.objects[n],do_unlink=True)
ROOT_EMPTY=emp('SLS_ROOT',c=SLS); CORE=emp('CORE_STAGE',par=ROOT_EMPTY,c=SLS); ENGINES=emp('RS25_ENGINES',par=CORE,c=SLS); LEFT=emp('SRB_LEFT',par=ROOT_EMPTY,c=SLS); RIGHT=emp('SRB_RIGHT',par=ROOT_EMPTY,c=SLS); UPPER=emp('UPPER_STAGE',par=ROOT_EMPTY,c=SLS); ORION=emp('ORION',par=ROOT_EMPTY,c=SLS); CREW=emp('CREW_MODULE',par=ORION,c=SLS); SERVICE=emp('SERVICE_MODULE',par=ORION,c=SLS); ARRAYS=emp('SOLAR_ARRAYS',par=ORION,c=SLS); LAS=emp('LAUNCH_ABORT_SYSTEM',par=ORION,c=SLS)
for name,target in [('Dummy_Core',CORE),('Dummy_Engs',ENGINES),('Dummy_SRB_',LEFT),('Dummy_SRB0',RIGHT),('Dummy_LVSA',UPPER),('Dummy_ICP0',UPPER),('Dummy_ESM_',SERVICE),('Dummy_MPCV',CREW),('Dummy_Orio',CREW),('Dummy_NewS',ARRAYS),('Dummy146',LAS)]:
 if bpy.data.objects.get(name):parent_world(bpy.data.objects[name],target)
if bpy.data.objects.get('Dummy_Bloc'):bpy.data.objects.remove(bpy.data.objects['Dummy_Bloc'],do_unlink=True)
ROOT_EMPTY['NASA_asset']='Space Launch System Block 1 (GNC markings), NASA 3D Resources';ROOT_EMPTY['source_url']='https://science.nasa.gov/3d-resources/space-launch-system-block-1/'
print('STAGE: NASA vehicle reorganized into animated components', flush=True)

def exhaust(n,p,l,r,h,keys):
 host=emp(n,l,p,FX);o=cone(n+'_turbulent_sheet',(0,0,-h*.52),r*1.12,r*.26,h,FIRE,host,FX);i=cone(n+'_hot_core',(0,0,-h*.45),r*.54,r*.1,h*.76,HOT,host,FX);o.rotation_euler.x=math.pi;i.rotation_euler.x=math.pi
 ld=bpy.data.lights.new(n+'_light','POINT');ld.energy=900*r;ld.color=(1,.2,.03);lo=bpy.data.objects.new(n+'_light',ld);FX.objects.link(lo);lo.parent=host;lo.location=(0,0,-.2)
 for f,v in keys: tf(host,f,sc=(max(.001,v),)*3);ld.energy=900*r*v*v;ld.keyframe_insert(data_path='energy',frame=f)
 host['effect']='noise-modulated transparent emissive exhaust following nozzle';return host
burn=[(1,.001),(54,.001),(67,.28),(82,1),(238,1),(245,.22),(250,.001)]
exhaust('SRB_LEFT_EXHAUST',LEFT,(-6.17,0,1),2.4,27,burn);exhaust('SRB_RIGHT_EXHAUST',RIGHT,(6.23,0,1),2.4,27,burn)
for z,(x,y) in enumerate(((-1.15,-1.15),(-1.15,1.15),(1.15,-1.15),(1.15,1.15)),1):exhaust(f'RS25_{z}_EXHAUST',ENGINES,(x,y,.75),.75,11.5,[(1,.001),(52,.001),(65,.25),(82,1),(405,1),(420,.4),(426,.001)])
exhaust('UPPER_STAGE_EXHAUST',UPPER,(0,0,66),.55,8,[(1,.001),(420,.001),(438,.35),(452,1),(522,.65),(540,.001)])
for side in (-1,1):
 h=emp(f'ORION_SOLAR_HINGE_{side}',(side*1.2,0,77),ARRAYS,SLS);cube('ORION_SOLAR_ARRAY',(side*4.1,0,0),(5.8,.13,1.15),BLUE,h,SLS);tf(h,1,r=(0,side*math.radians(86),0));tf(h,528,r=(0,side*math.radians(86),0));tf(h,550,r=(0,side*math.radians(18),0));tf(h,570,r=(0,0,0))

# Curved launch, gravity turn, genuine departures and distinct paths.
for f,l,r in [(1,(0,0,0),(0,0,0)),(70,(0,0,0),(0,0,0)),(90,(0,0,10),(0,0,0)),(150,(0,0,85),(0,math.radians(2),0)),(240,(6,0,365),(0,math.radians(12),0)),(320,(42,0,760),(0,math.radians(28),0)),(420,(160,0,1320),(0,math.radians(48),0))]:tf(ROOT_EMPTY,f,l,r)
for b,sgn in ((LEFT,-1),(RIGHT,1)):
 for f,l,r in [(1,(0,0,0),(0,0,0)),(244,(0,0,0),(0,0,0)),(250,(sgn*8,0,-5),(sgn*.03,0,sgn*.1)),(280,(sgn*72,sgn*10,-95),(sgn*.31,sgn*.22,sgn*.82)),(350,(sgn*230,sgn*32,-410),(sgn*1.18,sgn*.82,sgn*2.12)),(420,(sgn*430,sgn*80,-820),(sgn*2.1,sgn*1.22,sgn*3.6))]:tf(b,f,l,r)
 b['booster_shutdown']=245;b['booster_separation']=245
for f,l,r in [(1,(0,0,0),(0,0,0)),(420,(0,0,0),(0,0,0)),(432,(-8,0,-18),(.08,-.1,.05)),(475,(-105,18,-310),(.63,-.52,.48)),(540,(-340,80,-830),(1.28,-.92,1.2))]:tf(CORE,f,l,r)
for g in (UPPER,ORION):
 for f,l,r in [(1,(0,0,0),(0,0,0)),(420,(0,0,0),(0,0,0)),(465,(26,-6,85),(0,math.radians(6),0)),(520,(106,-28,270),(0,math.radians(12),0))]:tf(g,f,l,r)
for f,l,r in [(560,(176,-54,410),(0,math.radians(16),0)),(620,(255,-92,590),(0,math.radians(20),0))]:tf(UPPER,f,l,r)
for f,l,r in [(530,(126,-44,302),(math.radians(3),math.radians(18),math.radians(-4))),(580,(315,-260,630),(math.radians(16),math.radians(46),math.radians(-12))),(630,(670,-650,960),(math.radians(26),math.radians(70),math.radians(-20)))]:tf(ORION,f,l,r)
ORION['separation_frame']=525

# Pad plus physical Earth/Mars objects.
cyl('Launch pad',(0,0,-.42),22,.8,METAL,c=ENV,v=64);cyl('Flame trench',(0,0,-1.2),9.5,1.2,BLACK,c=ENV)
for x in (-14,14):
 for z in range(0,90,12):rod('Tower column',(x,9,z),(x,9,z+12),.38,METAL,c=ENV);rod('Tower brace',(x,9,z),(x*.75,9,z+12),.17,ORANGE,c=ENV)
sphere('Earth',(-250,-520,620),180,mat('Earth ocean',(.01,.08,.24),.05,.48),c=ENV,seg=96);sphere('Mars',(110,-3820,-590),960,mat('Mars planet',(.36,.07,.018),0,.88),c=ENV,seg=96)
SITE=emp('MARS_LANDING_SITE',(0,-2600,0),c=MARS)
verts=[];faces=[];N=52;W=330
for j in range(N):
 for i in range(N):
  x=-W/2+W*i/(N-1);y=-W/2+W*j/(N-1);verts.append((x,y,(math.sin(x*.047)+math.cos(y*.063))*1.15+math.sin((x+y)*.115)*.42))
for j in range(N-1):
 for i in range(N-1):a=j*N+i;faces.append((a,a+1,a+N+1,a+N))
me=bpy.data.meshes.new('Rocky Mars terrain');me.from_pydata(verts,[],faces);terrain=bpy.data.objects.new('Empty rocky Martian landscape',me);MARS.objects.link(terrain);terrain.parent=SITE;terrain.data.materials.append(RED);smooth(terrain)
for i in range(80):
 q=random.Random(9000+i);o=sphere('Martian rock',(q.uniform(-120,120),q.uniform(-120,120),q.uniform(0,1.5)),q.uniform(.25,1.45),BLACK,SITE,MARS,12);o.scale.z=q.uniform(.35,.9)

# Dedicated lander, descent, legs, hatch, ramp and dust.
LAND=emp('MARS_LANDER',(0,0,150),SITE,MARS);LAND['purpose']='Dedicated lander; Orion never transforms into a lander'
cone('Descent stage',(0,0,2),3,2.25,1.35,GOLD,LAND,MARS,48);cyl('Crew compartment',(0,0,3.5),2.25,2.3,WHITE,LAND,MARS,48);cone('Pressure dome',(0,0,5),2.22,1.15,1.25,WHITE,LAND,MARS,48)
for i,a in enumerate((45,135,225,315),1):
 q=math.radians(a);h=emp(f'LANDING_GEAR_{i}_HINGE',(1.68*math.cos(q),1.68*math.sin(q),1.78),LAND,MARS);rod('Landing leg strut',(0,0,0),(1.6*math.cos(q),1.6*math.sin(q),-1.42),.13,METAL,h,MARS);cyl('Landing foot',(1.72*math.cos(q),1.72*math.sin(q),-1.5),.48,.2,BLACK,h,MARS,24);tf(h,1,r=(0,math.radians(-32),0));tf(h,644,r=(0,math.radians(-32),0));tf(h,685,r=(0,0,0))
H=emp('LANDER_HATCH_HINGE',(0,-2.28,4.05),LAND,MARS);cube('Lander hatch',(0,-.09,-.65),(1.65,.16,1.85),GOLD,H,MARS);tf(H,1,r=(0,0,0));tf(H,724,r=(0,0,0));tf(H,746,r=(0,math.radians(-72),0))
R=emp('LANDER_RAMP_HINGE',(0,-2.3,1.75),LAND,MARS);cube('Lander ramp',(0,-1.85,0),(1.55,3.7,.18),METAL,R,MARS);tf(R,1,r=(math.radians(72),0,0));tf(R,744,r=(math.radians(72),0,0));tf(R,766,r=(0,0,0))
for x,y in ((-1.35,-1.35),(-1.35,1.35),(1.35,-1.35),(1.35,1.35)):exhaust('LANDER_DESCENT_THRUSTER',LAND,(x,y,1.12),.43,5.3,[(1,.001),(640,1),(680,.8),(708,.45),(720,.001)])
for f,l in [(1,(0,0,150)),(620,(0,0,150)),(650,(0,0,72)),(680,(0,0,25)),(708,(0,0,8)),(720,(0,0,1.55)),(725,(0,0,1.52)),(900,(0,0,1.52))]:tf(LAND,f,l)
DROOT=emp('MARS_DUST_PLUMES',(0,0,.6),SITE,MARS)
for i in range(10):
 a=math.tau*i/10;o=cube('Volumetric dust billow',(.8*math.cos(a),.8*math.sin(a),0),(1,1,1),DUST,DROOT,MARS);tf(o,640,sc=(.001,)*3);tf(o,680,sc=(6+i%3,6+(i+1)%4,1.7));tf(o,720,sc=(13+i%4,12+(i+2)%4,2.6));tf(o,750,sc=(17+i%4,15+(i+1)%4,1.2))
print('STAGE: Mars landing system built', flush=True)

def astronaut(n,start):
 bpy.ops.object.select_all(action='DESELECT');bpy.ops.import_scene.gltf(filepath=str(ASTRO));items=list(bpy.context.selected_objects);roots=[o for o in items if o.parent not in items];rig=emp(n,start,SITE,MARS)
 for o in roots:
  for q in list(o.users_collection):q.objects.unlink(o)
  MARS.objects.link(o);o.parent=rig
 pts=[o.matrix_world@Vector(v) for o in items if o.type=='MESH' for v in o.bound_box]
 if pts:
  low=min(p.z for p in pts);hi=max(p.z for p in pts)
  for o in roots:o.location.z-=low
  rig.scale=(1.78/(hi-low),)*3
 joints={o.name.split('.')[0]:o for o in items if o.name.split('.')[0] in ('ArmL','ArmR','LegL','LegR')};rig['rig']='Articulated imported field-suit model';return rig,joints
def walk(rig,joints,path,plant=None):
 for f,l in path:tf(rig,f,l)
 for f in range(path[0][0],path[-1][0]+1,9):
  x=math.sin((f-path[0][0])*.35)
  for j,sgn in (('LegL',1),('LegR',-1),('ArmL',-1),('ArmR',1)):
   if joints.get(j):tf(joints[j],f,r=(sgn*x*.43,0,0))
 if plant and joints.get('ArmR'):tf(joints['ArmR'],plant,r=(.25,0,-.15));tf(joints['ArmR'],plant+25,r=(1.1,.08,-.35))
A1,J1=astronaut('ASTRONAUT_1_RIG',(0,-2,.05));A2,J2=astronaut('ASTRONAUT_2_RIG',(.7,-2.1,.05));walk(A1,J1,[(1,(0,-2,.05)),(760,(0,-2,.05)),(790,(.5,-4.5,.05)),(825,(5.2,-9.5,.05)),(850,(10,-12.2,.05)),(900,(10,-12.2,.05))],834);walk(A2,J2,[(1,(.7,-2.1,.05)),(780,(.7,-2.1,.05)),(812,(1.6,-4.2,.05)),(850,(4.4,-7.3,.05)),(900,(4.4,-7.3,.05))])
print('STAGE: animated EVA crew built', flush=True)
F=emp('SPACE_INVADERS_FLAG',(10.8,-12.4,0),SITE,MARS);cyl('Flag support rod',(0,0,1.25),.045,2.5,METAL,F,MARS,12);cube('Flag fabric',(1.1,0,1.82),(2.2,.035,1.05),FLAG,F,MARS);cu=bpy.data.curves.new('SPACE INVADERS lettering','FONT');cu.body='SPACE\nINVADERS';cu.align_x='CENTER';cu.align_y='CENTER';cu.size=.31;cu.extrude=.012;cu.materials.append(TEXT);tx=bpy.data.objects.new('SPACE INVADERS lettering',cu);MARS.objects.link(tx);tx.parent=F;tx.location=(1.1,-.035,1.82);tx.rotation_euler=(math.pi/2,0,0);tf(F,1,(-0.,0,-3),(math.radians(50),0,math.radians(18)));tf(F,838,(-0.,0,-3),(math.radians(50),0,math.radians(18)));tf(F,870,(0,0,0),(0,0,0))

# Actual cameras switch by markers and use tracking constraints.
LT=emp('LAUNCH_TARGET',(0,0,48),c=CAMS);MT=emp('MARS_APPROACH_TARGET',(0,0,25),SITE,CAMS);DT=emp('LANDER_TRACK_TARGET',(0,0,2.5),LAND,CAMS);ET=emp('EVA_TRACK_TARGET',(7,-9,1.3),SITE,CAMS)
def camera(n,f,t,lens,pts):
 d=bpy.data.cameras.new(n);d.lens=lens;d.sensor_width=36;o=bpy.data.objects.new(n,d);CAMS.objects.link(o)
 for fr,loc in pts:tf(o,fr,loc)
 q=o.constraints.new('TRACK_TO');q.name=n+' tracking';q.target=t;q.track_axis='TRACK_NEGATIVE_Z';q.up_axis='UP_Y';m=s.timeline_markers.new(n,frame=f);m.camera=o;return o
camera('CAM_LAUNCHPAD',1,LT,52,[(1,(145,-190,58)),(95,(130,-170,64))]);camera('CAM_ASCENT',96,ROOT_EMPTY,46,[(96,(180,-260,165)),(245,(260,-410,570))]);camera('CAM_BOOSTER_SEPARATION',245,ROOT_EMPTY,58,[(245,(210,-310,570)),(420,(430,-510,1040))]);camera('CAM_ORBIT',421,UPPER,48,[(421,(520,-670,1560)),(525,(600,-790,1780))]);camera('CAM_ORION',526,ORION,62,[(526,(640,-880,1860)),(630,(1030,-1220,2260))]);camera('CAM_MARS_APPROACH',610,MT,50,[(610,(520,-3300,810)),(650,(380,-3040,420))]);camera('CAM_LANDING',651,DT,44,[(651,(170,-2810,145)),(720,(92,-2725,32))]);camera('CAM_ASTRONAUTS',746,ET,50,[(746,(44,-2670,18)),(900,(39,-2675,11))]);s.camera=bpy.data.objects['CAM_LAUNCHPAD']
for n,kind,loc,en,size in [('Sunlight','SUN',(0,0,0),3.1,0),('Launch fill','AREA',(35,-40,35),1700,34),('Mars bounce','AREA',(25,-2580,25),900,24)]:
 d=bpy.data.lights.new(n,kind);d.energy=en
 if size:d.shape='DISK';d.size=size
 o=bpy.data.objects.new(n,d);CAMS.objects.link(o);o.location=loc
bpy.data.objects['Sunlight'].rotation_euler=(math.radians(28),math.radians(-32),math.radians(-24))
for f,n in [(1,'T-00:00 — COUNTDOWN'),(55,'RS-25 ENGINE STARTUP'),(90,'SLS LIFTOFF'),(245,'LEFT + RIGHT BOOSTER SEPARATION'),(420,'CORE STAGE SEPARATION'),(438,'UPPER STAGE IGNITION'),(525,'ORION SEPARATION'),(528,'ORION SOLAR ARRAY DEPLOYMENT'),(610,'MARS TRANSFER / APPROACH'),(644,'LANDING GEAR DEPLOYMENT'),(720,'MARS TOUCHDOWN / ENGINE SHUTDOWN'),(746,'HATCH OPEN + RAMP DEPLOY'),(780,'ASTRONAUT EVA'),(870,'SPACE INVADERS FLAG PLANT')]:s.timeline_markers.new(n,frame=f)
# Blender 5 stores F-curves in layered action slots.  Keyframe insertion above
# creates Bezier curves by default, so avoid using the removed Action.fcurves API.
s.frame_set(1);names=['SLS_ROOT','SRB_LEFT','SRB_RIGHT','CORE_STAGE','UPPER_STAGE','ORION','MARS_LANDER','ASTRONAUT_1_RIG','ASTRONAUT_2_RIG','SPACE_INVADERS_FLAG'];check={n:bool(bpy.data.objects[n].animation_data and bpy.data.objects[n].animation_data.action) for n in names};t=bpy.data.texts.new('ANIMATION_VERIFICATION');t.write('30fps / 900 frames / native object animation / no video sequencer\n\n'+str(check));s['verification']=str(check);s['native_animation_only']=True
print('STAGE: timelines and verification record built', flush=True)
# The NASA meshes and materials are appended into this file; avoid a slow
# texture repack so the viewport stays responsive and builds remain practical.
print('STAGE: saving final blend', flush=True);bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(OUT),compress=False);print('SAVED',OUT);print('VERIFIED',check)
