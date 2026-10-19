# Builds public/models/cars/<team>.glb from its downloaded Sketchfab model (scripts/cars/models.json, fetch.py):
# the real shape at real scale in the game's car frame (x forward, y left, z up, metres, origin between the axles on
# the ground), the model's own wheels taken out (the game draws real tyres there: wheel_FL/FR/RL/RR markers with their
# radius and width), head / eye / wheel_pos markers at the cockpit, and two detail levels (lod_near, lod_far) each with
# one material 'livery' whose colour, normal and roughness are baked from the full model.
#   blender -b --python scripts/cars/build.py -- <teamId> [--preview]
import bpy, bmesh, json, os, sys, glob, math
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CACHE = os.path.join(ROOT, 'scripts', 'build', 'cars')
OUT = os.path.join(ROOT, 'public', 'models', 'cars')
NEAR_TRIS, FAR_TRIS = 58000, 9500          # under the test's 60k / 10k
NEAR_TEX, FAR_TEX = 2048, 1024
WHEELBASE_M = {2023: 3.6, 2024: 3.6, 2026: 3.4}  # each car's real axle distance for its year
# the cockpit: the helmet's centre 0.45 m ahead of the roll hoop (the highest point between the axles: its top can
# carry a camera pod, so only its position along the car counts) at 0.76 m (the regulated survival cell puts every
# driver's head at about that height), the eye a little ahead, the steering wheel as the game's views.js
# (WHEEL_POS - EYE.cockpit)
HEAD_AHEAD_OF_HOOP_M, HEAD_Z_M = 0.45, 0.76
EYE_FROM_HEAD = (0.08, 0.0, -0.02)
WHEEL_FROM_EYE = (0.29, 0.0, -0.12)


def log(*a):
    print('[build]', *a, flush=True)


def meshes():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def world_bbox(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return Vector([min(p[k] for p in pts) for k in range(3)]), Vector([max(p[k] for p in pts) for k in range(3)])


def import_model(uid, keyed=None, drop=(), colours=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    f = glob.glob(os.path.join(CACHE, uid, '**', '*.gltf'), recursive=True)[0]
    bpy.ops.import_scene.gltf(filepath=f)
    # flatten: every mesh in world space, no parents, no empties
    for o in list(bpy.context.scene.objects):
        if o.type == 'MESH':
            m = o.matrix_world.copy()
            o.parent = None
            o.matrix_world = m
    for o in list(bpy.context.scene.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.context.view_layer.objects.active = meshes()[0]
    bpy.ops.object.make_single_user(object=True, obdata=True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in list(meshes()):  # models.json "drop": materials of another season's livery (logo sheets) left out
        if any(m and m.name in drop for m in o.data.materials):
            bpy.data.objects.remove(o, do_unlink=True)
    for m in bpy.data.materials:  # models.json "colours": untextured materials (flat grey in the download) given theirs
        b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None) if m.use_nodes else None
        if m.name in (colours or {}) and b and not b.inputs['Base Color'].is_linked:
            b.inputs['Base Color'].default_value = (*[c ** 2.2 for c in _hex(colours[m.name])], 1)  # linear
    for m in bpy.data.materials:
        if m.name in (keyed or {}):
            key_alpha(m, keyed[m.name])
    # decals: sponsor logos on thin planes with see-through textures; never part of the drawn mesh, baked on instead
    for o in meshes():
        o['decal'] = any(is_decal(m) for m in o.data.materials if m)


def key_alpha(m, background):
    # a logo sheet whose see-through parts were flattened to a colour (models.json "keyed": black or white): its alpha
    # from how far each texel is from that background
    t = m.node_tree
    b = next(n for n in t.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = b.inputs['Base Color'].links[0].from_node
    sep = t.nodes.new('ShaderNodeSeparateColor')
    t.links.new(tex.outputs['Color'], sep.inputs['Color'])
    op = 'MAXIMUM' if background == 'black' else 'MINIMUM'
    m1 = t.nodes.new('ShaderNodeMath'); m1.operation = op
    m2 = t.nodes.new('ShaderNodeMath'); m2.operation = op
    t.links.new(sep.outputs[0], m1.inputs[0]); t.links.new(sep.outputs[1], m1.inputs[1])
    t.links.new(m1.outputs[0], m2.inputs[0]); t.links.new(sep.outputs[2], m2.inputs[1])
    mr = t.nodes.new('ShaderNodeMapRange')  # clamped: near the background 0, clearly off it 1
    mr.inputs['From Min'].default_value, mr.inputs['From Max'].default_value = (0.08, 0.3) if background == 'black' else (0.92, 0.7)
    t.links.new(m2.outputs[0], mr.inputs['Value'])
    t.links.new(mr.outputs['Result'], b.inputs['Alpha'])


def is_decal(m):
    if not m.use_nodes:
        return False
    b = m.node_tree.nodes.get('Principled BSDF')
    return bool(b and (b.inputs['Alpha'].is_linked or b.inputs['Alpha'].default_value < 0.99))


def islands(o):
    bm = bmesh.new(); bm.from_mesh(o.data)
    seen, n = set(), 0
    for v in bm.verts:
        if v in seen:
            continue
        n += 1; stack = [v]; seen.add(v)
        while stack:
            for e in stack.pop().link_edges:
                for y in e.verts:
                    if y not in seen:
                        seen.add(y); stack.append(y)
    bm.free()
    return n


def weld_if_split(length):
    # a model exported as unwelded triangles (tens of thousands of islands): its coincident vertices merged first,
    # or splitting it into parts takes forever and every triangle becomes a "part"
    if sum(islands(o) for o in meshes()) <= 30000:
        return
    for o in meshes():
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4 * length)
        bm.to_mesh(o.data); bm.free()
    log(f'welded: {sum(islands(o) for o in meshes())} islands')


def separate_loose():
    ext = robust_extent()
    weld_if_split(max(b - a for a, b in ext[:2]))
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes():
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes()[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='LOOSE')
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in meshes():  # each part's origin at its own centre (bound boxes are then tight)
        o.select_set(True)
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')


def robust_extent():
    # the car's extent from its vertices (1st to 99th percentile: a stray part or a display stand doesn't count)
    xs, ys, zs = [], [], []
    for o in meshes():
        mw = o.matrix_world
        vs = o.data.vertices
        for i in range(0, len(vs), max(1, len(vs) // 200)):
            p = mw @ vs[i].co
            xs.append(p.x); ys.append(p.y); zs.append(p.z)
    pick = lambda a, q: sorted(a)[int(q * (len(a) - 1))]
    return [(pick(a, 0.01), pick(a, 0.99)) for a in (xs, ys, zs)]


def find_wheels():
    ext = robust_extent()
    span = [b - a for a, b in ext]
    L = 0 if span[0] >= span[1] else 1   # the length axis (horizontal); W the width axis; Z up
    W = 1 - L
    length = span[L]
    cands = []
    for o in meshes():
        a, b = world_bbox(o)
        d = b - a
        dia = (d[L] + d[2]) / 2
        if not (0.09 * length < dia < 0.17 * length):
            continue
        if abs(d[L] - d[2]) > 0.12 * dia or d[W] > 0.75 * dia:
            continue
        cands.append((o, (a + b) / 2, dia, d[W]))
    if len(cands) < 4:
        sys.exit(f'only {len(cands)} wheel-like parts')
    mid = sum((c[1] for c in cands), Vector()) / len(cands)
    corners = {}
    for c in cands:  # the biggest round part at each corner: the tyre
        key = (c[1][L] > mid[L], c[1][W] > mid[W])
        if key not in corners or c[2] > corners[key][2]:
            corners[key] = c
    if len(corners) != 4:
        sys.exit(f'wheels found at {len(corners)} corners')
    wheels = []
    for o, c, dia, wid in corners.values():
        # the whole tyre across: every round part on the same axle centre (a tyre can be split into sidewall halves)
        same = [k for k in cands if math.hypot(k[1][L] - c[L], k[1][2] - c[2]) < 0.1 * dia and k[2] > 0.8 * dia
                and abs(k[1][W] - c[W]) < dia]
        lo = min(k[1][W] - k[3] / 2 for k in same)
        hi = max(k[1][W] + k[3] / 2 for k in same)
        c = c.copy(); c[W] = (lo + hi) / 2
        wheels.append((o, c, dia, hi - lo))
    # the narrower pair is the front (305 mm against 405 mm)
    ends = {}
    for c in wheels:
        ends.setdefault(c[1][L] > mid[L], []).append(c)
    w_hi, w_lo = (sum(c[3] for c in ends[s]) / 2 for s in (True, False))
    front_hi = w_hi < w_lo
    return L, W, wheels, front_hi


TYRE_NAME = __import__('re').compile(r'(^|[^a-z])(tyre|tire|rim)s?([^a-z]|$)')


def remove_inside(wheels, L, W):
    # the tyre and what turns with it: parts wholly within a wheel's tyre, and round parts on its axle (rim, disc, wheel
    # cover); anything else that reaches outside the tyre (suspension arms, uprights, brake ducts, wing endplates) stays
    gone = 0
    mid_w = sum(w[1][W] for w in wheels) / 4  # the car's centreline
    for o in list(meshes()):
        a, b = world_bbox(o)
        c = (a + b) / 2
        for _, wc, dia, wid in wheels:
            out = 1 if wc[W] > mid_w else -1
            rr, half = dia / 2 * 1.03, wid / 2 + 0.01 * dia
            inside = (math.hypot(c[L] - wc[L], c[2] - wc[2]) < rr
                      and all(abs(v[k] - wc[k]) <= rr for v in (a, b) for k in (L, 2))
                      and all(abs(v[W] - wc[W]) <= half for v in (a, b)))
            d = b - a
            turning = (math.hypot(c[L] - wc[L], c[2] - wc[2]) < 0.05 * dia  # round, on the axle: rim, disc, wheel cover
                       and abs(d[L] - d[2]) < 0.1 * max(d[L], d[2]) and max(d[L], d[2]) <= dia * 1.03
                       and abs(c[W] - wc[W]) < wid * 0.75)
            # within the tyre's circle and wholly on its outboard half: sidewall lettering, rim face, nut (nothing of
            # the car sits outboard of a wheel's centre plane, inside its circle)
            edges = sorted((v[W] - wc[W]) * out for v in (a, b))
            outboard = (all(abs(v[k] - wc[k]) <= rr for v in (a, b) for k in (L, 2))
                        and edges[0] >= 0 and edges[1] <= wid / 2 + 0.08 * dia)
            # named as a tyre or rim by the model (whole words: not "steeringwheel" or "trim"), within the wheel's circle
            named = (TYRE_NAME.search(o.name.lower()) and abs(c[W] - wc[W]) < dia
                     and all(abs(v[k] - wc[k]) <= rr for v in (a, b) for k in (L, 2)))
            # in the rubber: within the tyre's width (and its sidewall's bulge) and its circle, nowhere nearer the axle than 70 % of the radius
            # (inner sidewall lettering; what the car has inside a wheel sits within the rim)
            near = math.hypot(*(max(a[k] - wc[k], 0, wc[k] - b[k]) for k in (L, 2)))
            rubber = (near > 0.7 * dia / 2 and all(abs(v[k] - wc[k]) <= rr for v in (a, b) for k in (L, 2))
                      and all(abs(v[W] - wc[W]) <= half + 0.05 * dia for v in (a, b)))
            if inside or turning or outboard or named or rubber:
                bpy.data.objects.remove(o, do_unlink=True)
                gone += 1
                break
    return gone


def to_car_frame(L, W, wheels, front_hi, year):
    fwd = Vector([0, 0, 0]); fwd[L] = 1 if front_hi else -1
    up = Vector((0, 0, 1)); left = up.cross(fwd)
    R = Matrix((fwd, left, up))  # rows: new axes in old coordinates → maps old to car frame
    fc = [c for c in wheels if (c[1][L] - sum(w[1][L] for w in wheels) / 4) * (1 if front_hi else -1) > 0]
    rc = [c for c in wheels if c not in fc]
    f_mid = sum((c[1] for c in fc), Vector()) / 2
    r_mid = sum((c[1] for c in rc), Vector()) / 2
    base = abs(f_mid[L] - r_mid[L])
    s = WHEELBASE_M[year] / base
    origin = (f_mid + r_mid) / 2
    radius = sum(c[2] for c in wheels) / 8  # mean diameter / 2
    origin[2] = sum(c[1][2] for c in wheels) / 4 - radius  # the ground under the wheels
    T = Matrix.Diagonal((s, s, s, 1)) @ R.to_4x4() @ Matrix.Translation(-origin)
    for o in meshes():
        o.data.transform(T @ o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
    out = {}
    for c in wheels:
        p = T @ c[1]
        name = ('wheel_F' if c in fc else 'wheel_R') + ('L' if p.y > 0 else 'R')
        out[name] = (p, c[2] * s / 2, c[3] * s)
    log(f'scale {s:.4f}, measured wheelbase {base * s:.2f} m')
    return out


def cockpit_markers():
    best = None
    for o in meshes():
        if o.get('decal'):
            continue
        for v in o.data.vertices:
            p = v.co
            if -1.6 < p.x < 1.4 and abs(p.y) < 0.25 and (best is None or p.z > best.z):
                best = p.copy()
    head = Vector((best.x + HEAD_AHEAD_OF_HOOP_M, 0, HEAD_Z_M))
    eye = head + Vector(EYE_FROM_HEAD)
    wheel = eye + Vector(WHEEL_FROM_EYE)
    log(f'roll hoop top at x {best.x:.2f} z {best.z:.2f}; head {tuple(round(v, 2) for v in head)}')
    return {'head': head, 'eye': eye, 'wheel_pos': wheel}


def join_all(name, decals=False):
    bpy.ops.object.select_all(action='DESELECT')
    ms = [o for o in meshes() if bool(o.get('decal')) == decals and not o.name.startswith('lod_')]
    if not ms:
        return None
    for o in ms:
        o.select_set(True)
    bpy.context.view_layer.objects.active = ms[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    return o


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def decimated_copy(src, name, target, keep_materials=False):
    o = src.copy(); o.data = src.data.copy(); o.name = name
    bpy.context.scene.collection.objects.link(o)
    mod = o.modifiers.new('dec', 'DECIMATE')
    mod.ratio = min(1.0, target / max(1, tris(src)))
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier='dec')
    # a few % over after triangulation: once more on the triangulated count
    if tris(o) > target:
        mod = o.modifiers.new('dec', 'DECIMATE'); mod.ratio = target / tris(o) * 0.99
        bpy.ops.object.modifier_apply(modifier='dec')
    if not keep_materials:  # the body bakes into one new material
        o.data.materials.clear()
    log(f'{name}: {tris(o)} triangles')
    return o


def bake_onto(low, high, decals, size, tag, repaint_to=None):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = low
    low.select_set(True)
    for uv in list(low.data.uv_layers):  # one UV set, the bake's: the model's own are unused and only add weight
        low.data.uv_layers.remove(uv)
    low.data.uv_layers.new(name='uv')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0)
    # every island at the same texel density, then packed tight (rotated to fit), a margin of the bake's 4 px bleed
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin_method='FRACTION', margin=4 / size)
    bpy.ops.object.mode_set(mode='OBJECT')
    mat = bpy.data.materials.new('livery'); mat.use_nodes = True
    low.data.materials.append(mat)
    nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
    imgs = {}
    for kind in ('color', 'normal', 'rough'):
        img = bpy.data.images.new(f'{tag}_{kind}', size, size, alpha=False, float_buffer=False)
        if kind != 'color':
            img.colorspace_settings.name = 'Non-Color'
        imgs[kind] = img
    tex = {k: nt.nodes.new('ShaderNodeTexImage') for k in imgs}
    for k, n in tex.items():
        n.image = imgs[k]
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 4
    try:
        prefs = bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type = 'METAL'; prefs.get_devices()
        for d in prefs.devices: d.use = True
        sc.cycles.device = 'GPU'
    except Exception as e:
        log('GPU bake unavailable, CPU', e)
    bake = sc.render.bake
    bake.use_selected_to_active = True
    bake.cage_extrusion = 0.02
    bake.max_ray_distance = 0.06
    bake.margin = 4
    def from_(src):
        bpy.ops.object.select_all(action='DESELECT')
        src.select_set(True); low.select_set(True)
        bpy.context.view_layer.objects.active = low
    from_(high)
    for kind, btype in (('normal', 'NORMAL'), ('rough', 'ROUGHNESS')):
        nt.nodes.active = tex[kind]
        bpy.ops.object.bake(type=btype)
        log(f'{tag}: baked {kind}')
    # colour as the base colour itself, emitted: a DIFFUSE colour pass is base colour x (1 - metallic), black on metal paint
    restore = emit_base(high.data.materials, 'color')
    nt.nodes.active = tex['color']
    bpy.ops.object.bake(type='EMIT')
    restore()
    log(f'{tag}: baked color')
    if repaint_to:
        repaint(imgs['color'], repaint_to)
        log(f'{tag}: repainted {repaint_to}')
    if decals:
        overlay_decals(low, decals, nt, imgs['color'], size, tag, from_)
    nt.links.new(tex['color'].outputs['Color'], bsdf.inputs['Base Color'])
    nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(tex['normal'].outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    nt.links.new(tex['rough'].outputs['Color'], bsdf.inputs['Roughness'])
    bsdf.inputs['Metallic'].default_value = 0.1
    for img in imgs.values():
        img.pack()


# 2023 liveries on models painted otherwise: the baked body colour recoloured by hue/value regions (logos are decals,
# laid over afterwards, so they keep their own colours). Each rule: (which texels, the new colour).
def _hex(h):
    return [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]


REPAINTS = {
    # Red Bull's Japanese GP special: the navy body white; red, yellow and carbon stay
    'RB-suzuka': lambda h, s, v: [((h > 0.55) & (h < 0.75) & (s > 0.25) & (v < 0.55), '#f4f4f4')],
    # Williams FW45: navy body (the 2024 model is white), its light blue kept as the 2023 cyan accent
    'FW45-2023': lambda h, s, v: [((s < 0.2) & (v > 0.6), '#041e42'), ((h > 0.5) & (h < 0.6) & (s > 0.4) & (v > 0.5), '#00a0de')],
    # Haas VF-23: the 2026 model's white bodywork black, its reds the 2023 red
    'VF23-2023': lambda h, s, v: [((s < 0.2) & (v > 0.6), '#111111'), (((h < 0.04) | (h > 0.95)) & (s > 0.5) & (v > 0.3), '#e10600')],
}


def repaint(img, to):
    import numpy as np
    px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
    rgb = px[:, :3]
    mx, mn = rgb.max(1), rgb.min(1)
    v, s = mx, np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = rgb.T
    d = np.maximum(mx - mn, 1e-6)
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) / 6
    # sRGB image: compare and write in display values (pixels[] of a byte image are already sRGB-encoded)
    for mask, col in REPAINTS[to](h, s, v):
        rgb[mask] = _hex(col)
    px[:, :3] = rgb
    img.pixels[:] = px.ravel()
    img.update()


def emit_base(materials, what):
    # each material's surface replaced by an emission of its Base Color (or Alpha, as grey) for an EMIT bake;
    # returns the function that puts the surfaces back
    saved = []
    for m in materials:
        if not m or not m.use_nodes:
            continue
        t = m.node_tree
        b = next((n for n in t.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        out = next((n for n in t.nodes if n.type == 'OUTPUT_MATERIAL'), None)
        if not b or not out:
            continue
        surf = out.inputs['Surface']
        saved.append((t, surf, surf.links[0].from_socket if surf.links else None))
        e = t.nodes.get('bake_emit') or t.nodes.new('ShaderNodeEmission')
        e.name = 'bake_emit'
        for l in list(e.inputs['Color'].links):
            t.links.remove(l)
        src = b.inputs['Base Color'] if what == 'color' else b.inputs['Alpha']
        if src.is_linked:
            t.links.new(src.links[0].from_socket, e.inputs['Color'])
        else:
            v = src.default_value
            e.inputs['Color'].default_value = tuple(v) if what == 'color' else (v, v, v, 1)
        t.links.new(e.outputs['Emission'], surf)
    def restore():
        for t, surf, was in saved:
            if was:
                t.links.new(was, surf)
    return restore


def overlay_decals(low, decals, nt, color, size, tag, select_from):
    # the decals' colour and coverage (alpha) baked as emission into two images, then laid over the body colour:
    # where no decal is in reach nothing is written (coverage stays 0) and the paint shows through
    import numpy as np
    imgs = {}
    for what in ('color', 'alpha'):
        img = bpy.data.images.new(f'{tag}_decal_{what}', size, size, alpha=False)
        img.generated_color = (0, 0, 0, 1)
        if what == 'alpha':
            img.colorspace_settings.name = 'Non-Color'
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = img; nt.nodes.active = n
        restore = emit_base(decals.data.materials, what)
        select_from(decals)
        bpy.ops.object.bake(type='EMIT')
        restore()
        imgs[what] = img
        nt.nodes.remove(n)
    get = lambda im: np.array(im.pixels[:], dtype=np.float32).reshape(-1, 4)
    base, dc, a = get(color), get(imgs['color']), get(imgs['alpha'])[:, :1]
    base[:, :3] = base[:, :3] * (1 - a) + dc[:, :3] * a
    color.pixels[:] = base.ravel()
    color.update()
    log(f'{tag}: decals laid over ({int((a > 0.5).sum())} texels)')


def add_marker(name, pos, extras=None):
    e = bpy.data.objects.new(name, None)
    e.location = pos
    for k, v in (extras or {}).items():
        e[k] = v
    bpy.context.scene.collection.objects.link(e)
    return e


def build(team):
    models = json.load(open(os.path.join(ROOT, 'scripts', 'cars', 'models.json')))
    m = models['cars'][team]
    import_model(m['uid'], m.get('keyed'), m.get('drop', ()), m.get('colours'))
    log(f'{team}: {len(meshes())} objects, {sum(tris(o) for o in meshes())} triangles')
    separate_loose()
    log(f'{len(meshes())} loose parts')
    L, W, wheels, front_hi = find_wheels()
    log(f'removed {remove_inside(wheels, L, W)} wheel parts')
    W4 = to_car_frame(L, W, wheels, front_hi, m['year'])
    marks = cockpit_markers()
    decals = join_all('decals', decals=True)
    high = join_all('high')
    near = decimated_copy(high, 'lod_near', NEAR_TRIS)
    far = decimated_copy(high, 'lod_far', FAR_TRIS)
    to = (m.get('repaint') or {}).get('to')
    bake_onto(near, high, decals, NEAR_TEX, f'{team}_near', to)
    bake_onto(far, high, decals, FAR_TEX, f'{team}_far', to)
    bpy.data.objects.remove(high, do_unlink=True)
    if decals:
        bpy.data.objects.remove(decals, do_unlink=True)
    for name, (p, r, w) in W4.items():
        add_marker(name, p, {'radius': round(r, 4), 'width': round(w, 4)})
    for name, p in marks.items():
        add_marker(name, p)
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, f'{team}.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_extras=True, export_image_format='WEBP',
                              export_yup=True, export_apply=True, export_materials='EXPORT')
    log(f'wrote {out} ({os.path.getsize(out) / 1e6:.1f} MB)')
    return out


def write_credits():
    # public/models/credits.json: every model the game uses (models.json, one entry per Sketchfab model), for the lobby
    models = json.load(open(os.path.join(ROOT, 'scripts', 'cars', 'models.json')))
    used = {m['uid']: m for m in [*models['cars'].values(), models['tyre'], models['helmet']]}
    credits = [{k: m[k] for k in ('uid', 'name', 'author', 'licence', 'url')} for m in used.values()]
    with open(os.path.join(ROOT, 'public', 'models', 'credits.json'), 'w') as f:
        json.dump(credits, f, indent=1, ensure_ascii=False)
        f.write('\n')


if __name__ == '__main__':  # build_parts.py imports the helpers
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if args[0] != '--credits':
        build(args[0])
    write_credits()
