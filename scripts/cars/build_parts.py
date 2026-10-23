# Builds public/models/tyre.glb (Soft, Medium and Hard tyres and one rim, from the tyre pack: radius 0.36 m, unit width
# along the axle, as carModel.js's wheels, so the game's wheel scale gives each its 305 / 405 mm) and
# public/models/helmet.glb (a helmet in white paint the game tints per team, a dark visor, and suit-coloured shoulders).
#   blender -b --python scripts/cars/build_parts.py
import bpy, json, math, os, sys
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(__file__))
from build import ROOT, log, meshes, world_bbox, import_model, tris, decimated_copy, write_credits

OUT = os.path.join(ROOT, 'public', 'models')
MODELS = json.load(open(os.path.join(ROOT, 'scripts', 'cars', 'models.json')))
# The pack's soft and hard materials are named the wrong way round: HARD_TYRE carries the red (Soft) sidewall, SOFT_TYRE the white
TYRES = {'HARD_TYRE': 'tyre_S', 'MEDIUM_TYRE': 'tyre_M', 'SOFT_TYRE': 'tyre_H'}


def shrink_images(px):
    for img in bpy.data.images:
        if img.size[0] > px:
            img.scale(px, px)
        if img.has_data:
            img.pack()


def export(name, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    out = os.path.join(OUT, f'{name}.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_image_format='WEBP', export_yup=True, export_apply=True)
    log(f'wrote {out} ({os.path.getsize(out) / 1e6:.2f} MB)')


def place(o, centre, axle_axis, width):
    # centre on the origin, the axle (along axle_axis) turned onto Blender's y (three.js z), unit width along it
    rot = Matrix.Identity(4) if axle_axis == 1 else Matrix.Rotation(math.pi / 2, 4, 'Z')
    o.data.transform(Matrix.Diagonal((1, 1 / width, 1, 1)) @ rot @ Matrix.Translation(-centre))
    o.matrix_world = Matrix.Identity(4)


def tyres():
    import_model(MODELS['tyre']['uid'])
    ms = meshes()
    out = []
    first = None
    for o in ms:
        mat = next((m.name.split('.')[0] for m in o.data.materials if m), '')
        if mat not in TYRES:
            continue
        a, b = world_bbox(o)
        d = b - a
        axle = 0 if d[0] < d[1] else 1
        centre, width = (a + b) / 2, d[axle]
        if first is None:
            first = (centre, axle, width)
            rim = min((r for r in ms if any(m and m.name.startswith('FRONT_RIM') for m in r.data.materials)), key=lambda r: ((sum(world_bbox(r), Vector()) / 2) - centre).length)
            place(rim, centre, axle, width)
            out.append(decimated_copy(rim, 'rim', 1450, keep_materials=True))
        place(o, centre, axle, width)
        out.append(decimated_copy(o, TYRES[mat], 2900, keep_materials=True))
    for o in ms:
        bpy.data.objects.remove(o, do_unlink=True)
    shrink_images(1024)
    export('tyre', out)


def helmet():
    import_model(MODELS['helmet']['uid'])
    ms = meshes()
    for o in ms:
        if 'inside' in o.name.lower():
            bpy.data.objects.remove(o, do_unlink=True)
    ms = meshes()
    a = Vector([min(world_bbox(o)[0][k] for o in ms) for k in range(3)]); b = Vector([max(world_bbox(o)[1][k] for o in ms) for k in range(3)])
    s, centre = 0.29 / (b.z - a.z), (a + b) / 2
    # the visor faces +y in the download: turned to face +x (forward in the car frame)
    T = Matrix.Rotation(-math.pi / 2, 4, 'Z') @ Matrix.Diagonal((s, s, s, 1)) @ Matrix.Translation(-centre)
    paint = bpy.data.materials.new('helmet_paint'); paint.use_nodes = True
    p = paint.node_tree.nodes['Principled BSDF']; p.inputs['Base Color'].default_value = (1, 1, 1, 1); p.inputs['Roughness'].default_value = 0.3
    visor = bpy.data.materials.new('visor'); visor.use_nodes = True
    v = visor.node_tree.nodes['Principled BSDF']; v.inputs['Base Color'].default_value = (0.02, 0.02, 0.025, 1); v.inputs['Roughness'].default_value = 0.05; v.inputs['Metallic'].default_value = 0.5
    for o in ms:
        o.data.transform(T); o.matrix_world = Matrix.Identity(4)
        for i, m in enumerate(o.data.materials):
            n = (m.name if m else '').lower()
            o.data.materials[i] = visor if 'glass' in n else paint if 'main' in n else m
    bpy.ops.object.select_all(action='DESELECT')
    for o in ms:
        o.select_set(True)
    bpy.context.view_layer.objects.active = ms[0]
    bpy.ops.object.join()
    full = bpy.context.view_layer.objects.active
    h = decimated_copy(full, 'helmet', 3900, keep_materials=True)
    bpy.data.objects.remove(full, do_unlink=True)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=12, location=(-0.04, 0, -0.27))
    sh = bpy.context.object; sh.name = 'shoulders'; sh.scale = (0.2, 0.42, 0.14)
    bpy.ops.object.transform_apply(scale=True)
    suit = bpy.data.materials.new('suit'); suit.use_nodes = True
    suit.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (1, 1, 1, 1)
    sh.data.materials.append(suit)
    log(f'helmet {tris(h)} triangles, shoulders {tris(sh)}')
    shrink_images(512)
    export('helmet', [h, sh])


tyres()
helmet()
write_credits()
