# Build the shared low-poly F1 car, bake livery lookup maps, export car.glb.
# Run: npm run build:car
import bpy, bmesh, os, sys
import numpy as np
from math import radians

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from car_parts import PARTS, TEX_SIZE, WHEEL_RADIUS, POS_RANGE
from car_shapes import f1_body

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


# ---------- body (X forward, Y left, Z up, metres): modern ground-effect F1 car ----------
parts = f1_body(PARTS)

body = join(parts, 'body')
bpy.context.scene.cursor.location = (0, 0, 0)
bpy.ops.object.origin_set(type='ORIGIN_CURSOR')

bm = bmesh.new()
bm.from_mesh(body.data)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(body.data)
bm.free()

# No bevel: it tripled the triangles on the new curved parts. Smooth-by-angle shading gives the curves for free.

body.data.materials.append(LIVERY)
bpy.ops.object.shade_smooth_by_angle(angle=radians(35))

bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=radians(66), island_margin=0.01)
bpy.ops.object.mode_set(mode='OBJECT')


# ---------- wheels ----------
def wheel(name, x, y, width):
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=WHEEL_RADIUS, depth=width,
                                        location=(x, y, WHEEL_RADIUS), rotation=(radians(90), 0, 0))
    tyre = bpy.context.active_object
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bev = tyre.modifiers.new('shoulder', 'BEVEL')   # rounded low-profile sidewall
    bev.width = 0.045
    bev.segments = 3
    bpy.ops.object.modifier_apply(modifier=bev.name)
    tyre.data.materials.append(TYRE)
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=WHEEL_RADIUS * 0.72, depth=width + 0.008,
                                        location=(x, y, WHEEL_RADIUS), rotation=(radians(90), 0, 0))
    cover = bpy.context.active_object               # flat 2022-style wheel cover
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    cover.data.materials.append(RIM)
    return join([tyre, cover], name)  # tyre first: the game batches sub-mesh 0 as tyre, 1 as rim


wheel('wheel_FL', 1.60, 0.80, 0.30)
wheel('wheel_FR', 1.60, -0.80, 0.30)
wheel('wheel_RL', -1.85, 0.78, 0.40)
wheel('wheel_RR', -1.85, -0.78, 0.40)


# ---------- checks: the game depends on these ----------
body_tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
xs = [v.co.x for v in body.data.vertices]; ys = [v.co.y for v in body.data.vertices]; zs = [v.co.z for v in body.data.vertices]
print(f'body ~{body_tris} triangles, x {min(xs):.2f}..{max(xs):.2f} y {min(ys):.2f}..{max(ys):.2f} z {min(zs):.2f}..{max(zs):.2f}')
if body_tris > 8000:
    raise SystemExit(f'body has {body_tris} triangles, budget 8000')
if min(xs) < -2.95 or max(xs) > 2.95 or min(ys) < -1.0 or max(ys) > 1.0 or min(zs) < 0 or max(zs) > 1.05:
    raise SystemExit('body leaves its size box (x ±2.95, y ±1.0, z 0–1.05 m)')
for name, (wx, wy) in {'wheel_FL': (1.60, 0.80), 'wheel_FR': (1.60, -0.80), 'wheel_RL': (-1.85, 0.78), 'wheel_RR': (-1.85, -0.78)}.items():
    w = bpy.data.objects[name]
    if abs(w.location.x - wx) > 1e-3 or abs(w.location.y - wy) > 1e-3 or abs(w.location.z - WHEEL_RADIUS) > 1e-3:
        raise SystemExit(f'{name} moved to {tuple(w.location)}')


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
