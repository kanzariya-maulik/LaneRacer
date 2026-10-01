# Build the shared low-poly F1 car, bake livery lookup maps, export car.glb.
# Run: npm run build:car
import bpy, bmesh, os, sys
import numpy as np
from math import radians

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from car_parts import PARTS, TEX_SIZE, WHEEL_RADIUS, POS_RANGE

ROOT = os.path.dirname(HERE)
BUILD = os.path.join(HERE, 'build')
OUT_GLB = os.path.join(ROOT, 'public', 'models', 'car.glb')
os.makedirs(BUILD, exist_ok=True)
os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)


# ---------- materials ----------
def material(name, color, roughness=0.5, metallic=0.0):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True  # deprecated no-op on newer Blender
    except AttributeError:
        pass
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None) or nt.nodes.new('ShaderNodeBsdfPrincipled')
    out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None) or nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    return m, nt, bsdf


LIVERY, livery_nt, livery_bsdf = material('livery', (1, 1, 1), roughness=0.35)
placeholder = bpy.data.images.new('livery_placeholder', 8, 8)
tex_node = livery_nt.nodes.new('ShaderNodeTexImage')
tex_node.name = 'LiveryTex'
tex_node.image = placeholder
livery_nt.links.new(tex_node.outputs['Color'], livery_bsdf.inputs['Base Color'])
TYRE = material('tyre', (0.02, 0.02, 0.02), roughness=0.9)[0]
RIM = material('rim', (0.08, 0.08, 0.09), roughness=0.4, metallic=0.8)[0]


# ---------- primitives ----------
def tag(o, part):
    attr = o.data.color_attributes.new('part', 'FLOAT_COLOR', 'POINT')
    v = PARTS[part] / 32.0
    for d in attr.data:
        d.color = (v, 0.0, 0.0, 1.0)
    return o


def box(part, x0, x1, y0, y1, z0, z1):
    bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    o = bpy.context.active_object
    o.scale = (x1 - x0, y1 - y0, z1 - z0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return tag(o, part)


def loft(part, back, front, yc=0.0):
    """Truncated pyramid between two rectangles. back/front = (x, half_width, z_bottom, z_top)."""
    verts = []
    for (x, hw, zb, zt) in (back, front):
        verts += [(x, yc - hw, zb), (x, yc + hw, zb), (x, yc + hw, zt), (x, yc - hw, zt)]
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    me = bpy.data.meshes.new(part)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(part, me)
    bpy.context.collection.objects.link(o)
    return tag(o, part)


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    return o


# ---------- body (X forward, Y left, Z up, metres) ----------
parts = [
    box('floor', -1.45, 1.15, -0.8, 0.8, 0.03, 0.08),
    box('floor', 1.55, 1.65, -0.75, 0.75, 0.30, 0.33),      # front suspension arm
    box('floor', -1.90, -1.80, -0.70, 0.70, 0.30, 0.33),    # rear suspension arm
    loft('chassis', (-0.30, 0.36, 0.08, 0.62), (1.35, 0.30, 0.12, 0.58)),
    loft('nose', (1.35, 0.30, 0.12, 0.58), (2.72, 0.09, 0.14, 0.30)),
    loft('sidepods', (-1.00, 0.14, 0.10, 0.35), (0.55, 0.22, 0.10, 0.60), yc=0.55),
    loft('sidepods', (-1.00, 0.14, 0.10, 0.35), (0.55, 0.22, 0.10, 0.60), yc=-0.55),
    loft('engine', (-1.75, 0.12, 0.15, 0.42), (-0.30, 0.36, 0.10, 0.62)),
    loft('engine', (-0.90, 0.08, 0.55, 0.75), (-0.05, 0.16, 0.60, 0.98)),   # airbox
    box('engine', -2.30, -1.70, -0.15, 0.15, 0.15, 0.35),                   # gearbox / crash structure
    loft('fin', (-1.65, 0.008, 0.42, 0.75), (-0.60, 0.008, 0.60, 0.78)),
    box('fw_main', 2.45, 2.88, -0.95, 0.95, 0.05, 0.10),
    box('fw_flap', 2.30, 2.60, -0.90, 0.90, 0.10, 0.17),
    box('fw_end', 2.28, 2.90, 0.93, 0.97, 0.04, 0.30),
    box('fw_end', 2.28, 2.90, -0.97, -0.93, 0.04, 0.30),
    box('rw_main', -2.75, -2.42, -0.50, 0.50, 0.78, 0.86),
    box('rw_flap', -2.72, -2.50, -0.50, 0.50, 0.88, 0.98),
    box('rw_end', -2.80, -2.30, 0.50, 0.53, 0.35, 1.00),
    box('rw_end', -2.80, -2.30, -0.53, -0.50, 0.35, 1.00),
    box('rw_pillar', -2.55, -2.45, -0.02, 0.02, 0.30, 0.80),
    box('halo', 0.55, 0.62, -0.02, 0.02, 0.58, 0.78),                       # halo centre pillar
]
bpy.ops.mesh.primitive_torus_add(major_radius=0.30, minor_radius=0.025, major_segments=24, minor_segments=8, location=(0.15, 0, 0.78))
halo = bpy.context.active_object
halo.scale = (1.4, 1.0, 1.0)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
parts.append(tag(halo, 'halo'))
bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.13, location=(0.18, 0, 0.74))
parts.append(tag(bpy.context.active_object, 'helmet'))

body = join(parts, 'body')
bpy.context.scene.cursor.location = (0, 0, 0)
bpy.ops.object.origin_set(type='ORIGIN_CURSOR')

bm = bmesh.new()
bm.from_mesh(body.data)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(body.data)
bm.free()

bevel = body.modifiers.new('bevel', 'BEVEL')
bevel.width = 0.012
bevel.segments = 2
bevel.limit_method = 'ANGLE'
bpy.ops.object.modifier_apply(modifier=bevel.name)

body.data.materials.append(LIVERY)

bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=radians(66), island_margin=0.01)
bpy.ops.object.mode_set(mode='OBJECT')


# ---------- wheels ----------
def wheel(name, x, y, width):
    objs = []
    for radius, depth, mat in ((WHEEL_RADIUS, width, TYRE), (WHEEL_RADIUS * 0.62, width + 0.01, RIM)):
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=radius, depth=depth,
                                            location=(x, y, WHEEL_RADIUS), rotation=(radians(90), 0, 0))
        o = bpy.context.active_object
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        o.data.materials.append(mat)
        objs.append(o)
    return join(objs, name)  # origin = tyre centre, so it spins in place


wheel('wheel_FL', 1.60, 0.80, 0.30)
wheel('wheel_FR', 1.60, -0.80, 0.30)
wheel('wheel_RL', -1.85, 0.78, 0.40)
wheel('wheel_RR', -1.85, -0.78, 0.40)


# ---------- bake lookup maps ----------
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 1
scene.render.bake.margin = 4


def bake(build_emission):
    img = bpy.data.images.new('bake', TEX_SIZE, TEX_SIZE, alpha=True, float_buffer=True)
    img.generated_color = (0, 0, 0, 0)
    mat, nt, _ = material('bake_mat', (0, 0, 0))
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    emit = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(build_emission(nt), emit.inputs['Color'])
    nt.links.new(emit.outputs['Emission'], out.inputs['Surface'])
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.nodes.active = tex
    body.data.materials.clear()
    body.data.materials.append(mat)
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.bake(type='EMIT')
    arr = np.empty(TEX_SIZE * TEX_SIZE * 4, dtype=np.float32)
    img.pixels.foreach_get(arr)
    return arr.reshape(TEX_SIZE, TEX_SIZE, 4)


def remap(nt, socket, offset, factor):
    add = nt.nodes.new('ShaderNodeVectorMath')
    add.operation = 'ADD'
    add.inputs[1].default_value = (offset, offset, offset)
    nt.links.new(socket, add.inputs[0])
    mul = nt.nodes.new('ShaderNodeVectorMath')
    mul.operation = 'SCALE'
    mul.inputs['Scale'].default_value = factor
    nt.links.new(add.outputs['Vector'], mul.inputs[0])
    return mul.outputs['Vector']


def geometry(nt):
    return nt.nodes.new('ShaderNodeNewGeometry')


def part_attr(nt):
    a = nt.nodes.new('ShaderNodeAttribute')
    a.attribute_name = 'part'
    return a.outputs['Color']


pos = bake(lambda nt: remap(nt, geometry(nt).outputs['Position'], POS_RANGE, 1 / (2 * POS_RANGE)))
nrm = bake(lambda nt: remap(nt, geometry(nt).outputs['Normal'], 1.0, 0.5))
prt = bake(part_attr)

part = np.rint(prt[..., 0] * 32).astype(np.uint8)
# bake writes alpha=1 everywhere; part ids start at 1. Island-edge texels can carry
# positions blended with the empty background, so also require a point on the car.
P = pos[..., :3] * 2 * POS_RANGE - POS_RANGE
mask = (part > 0) & (np.abs(P[..., 0]) < 2.95) & (np.abs(P[..., 1]) < 1.0) & (P[..., 2] > 0) & (P[..., 2] < 1.05)
missing = set(PARTS.values()) - set(np.unique(part[mask]).tolist())
if missing:
    raise SystemExit(f'bake missed part ids {sorted(missing)} — check UV unwrap')
np.savez_compressed(os.path.join(BUILD, 'bake.npz'),
                    pos=P,
                    nrm=nrm[..., :3] * 2 - 1,
                    part=part, mask=mask)

# restore livery material, drop the part-id colours so three.js doesn't tint the car
body.data.materials.clear()
body.data.materials.append(LIVERY)
body.data.color_attributes.remove(body.data.color_attributes['part'])
for m in [m for m in bpy.data.materials if m.name.startswith('bake_mat')]:
    bpy.data.materials.remove(m)

bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', export_yup=True, export_apply=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BUILD, 'car.blend'))
tris = sum(len(p.vertices) - 2 for o in bpy.data.objects if o.type == 'MESH' for p in o.data.polygons)
print(f'car.glb written, ~{tris} triangles')
