# Renders a built car (public/models/cars/<team>.glb, or tyre / helmet) from four sides, with its markers shown (wheels
# as rings of their radius, head as a sphere, eye as a small red one), into scripts/build/cars/preview/<name>_<view>.png
#   blender -b --python scripts/cars/preview.py -- <team> [lod_far]
import bpy, os, sys, math
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
args = sys.argv[sys.argv.index('--') + 1:]
name, lod = args[0], (args[1] if len(args) > 1 else 'lod_near')
src = os.path.join(ROOT, 'public', 'models', 'cars', f'{name}.glb')
if not os.path.exists(src):
    src = os.path.join(ROOT, 'public', 'models', f'{name}.glb')
out = os.path.join(ROOT, 'scripts', 'build', 'cars', 'preview')
os.makedirs(out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
for o in list(sc.objects):
    if o.type == 'MESH' and o.name.startswith('lod_') and o.name != lod:
        o.hide_render = True
mark = bpy.data.materials.new('mark'); mark.use_nodes = True
mark.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (1, 0.1, 0.1, 1)
for o in list(sc.objects):
    if o.type != 'EMPTY':
        continue
    if o.name.startswith('wheel_') and 'radius' in o:
        bpy.ops.mesh.primitive_torus_add(location=o.matrix_world.translation, rotation=(math.pi / 2, 0, 0), major_radius=o['radius'], minor_radius=0.01)
        bpy.context.object.data.materials.append(mark)
    elif o.name in ('head', 'eye', 'wheel_pos'):
        bpy.ops.mesh.primitive_uv_sphere_add(location=o.matrix_world.translation, radius={'head': 0.12, 'eye': 0.03, 'wheel_pos': 0.05}[o.name])
        bpy.context.object.data.materials.append(mark)
bpy.ops.mesh.primitive_plane_add(size=30)
sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 960, 540
world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.8, 0.85, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3; sun.rotation_euler = (0.7, 0.2, 0.6)
sc.collection.objects.link(sun)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 50
# Blender after import: car x forward, glTF y-up converted back to z up
for view, pos in {'front34': (6, 4.5, 2.2), 'side': (0, 9, 1.2), 'top': (0.01, 0, 11), 'rear34': (-6, -4.5, 2.4)}.items():
    cam.location = pos
    d = Vector((0, 0, 0.4)) - Vector(pos)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(out, f'{name}_{lod}_{view}.png')
    bpy.ops.render.render(write_still=True)
print('[preview] done', out)
