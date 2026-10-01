# Shapes for the modern (2022+) F1 body. X forward, Y left, Z up, metres; origin between the axles at ground level.
# Every builder returns one mesh object tagged with a car_parts.PARTS name (livery painting goes by part + position).
import bpy
from math import cos, sin, pi, radians, copysign


def _tag(o, part, parts):
    attr = o.data.color_attributes.new('part', 'FLOAT_COLOR', 'POINT')
    v = parts[part] / 32.0
    for d in attr.data:
        d.color = (v, 0.0, 0.0, 1.0)
    return o


def _mesh(name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return o


def loft_rings(part, rings, parts, cap=True):
    """Solid through a list of closed rings (each a list of (x, y, z), same length)."""
    n = len(rings[0])
    verts = [p for r in rings for p in r]
    faces = []
    for i in range(len(rings) - 1):
        a, b = i * n, (i + 1) * n
        for k in range(n):
            k2 = (k + 1) % n
            faces.append((a + k, a + k2, b + k2, b + k))
    if cap:
        faces.append(tuple(range(n - 1, -1, -1)))
        last = (len(rings) - 1) * n
        faces.append(tuple(range(last, last + n)))
    return _tag(_mesh(part, verts, faces), part, parts)


def ring(x, yc, wt, wb, zb, zt, p=3.0, n=16):
    """Rounded cross-section at x: half-width wt at the top, wb at the bottom (wb < wt = undercut), squareness p."""
    pts = []
    for k in range(n):
        t = 2 * pi * k / n
        c, s = cos(t), sin(t)
        u = copysign(abs(c) ** (2 / p), c)
        v = copysign(abs(s) ** (2 / p), s)
        f = (v + 1) / 2
        pts.append((x, yc + (wb + (wt - wb) * f) * u, zb + (zt - zb) * f))
    return pts


def section_loft(part, sections, parts, yc=0.0, p=3.0, n=16):
    """sections: [(x, wt, wb, zb, zt)] front-to-back or back-to-front; optional 6th value = yc for that section."""
    return loft_rings(part, [ring(s[0], s[5] if len(s) > 5 else yc, s[1], s[2], s[3], s[4], p, n) for s in sections], parts)


def _airfoil(chord, thick):
    # (along chord from the leading edge, height) — cambered, flat-ish underside
    return [(0.0, 0.0), (0.06, 0.55), (0.3, 1.0), (0.7, 0.75), (1.0, 0.1), (1.0, 0.0), (0.7, -0.15), (0.25, -0.3), (0.05, -0.25)], chord, thick


def wing(part, parts, x_le, z, chord, thick, half_span, aoa_deg=0.0, rise=lambda f: 0.0, sweep=lambda f: 0.0, stations=9, y0=None):
    """Aerofoil extruded across Y from -half_span to +half_span (or y0..half_span on one side).
    f = |y| / half_span; rise(f) lifts the section (tip curl, spoon), sweep(f) moves it back; aoa tilts the trailing edge down."""
    prof, c, t = _airfoil(chord, thick)
    a = radians(aoa_deg)
    ys = [(-half_span + 2 * half_span * i / (stations - 1)) for i in range(stations)] if y0 is None else \
         [y0 + (half_span - y0) * i / (stations - 1) for i in range(stations)]
    rings = []
    for y in ys:
        f = abs(y) / half_span
        r = []
        for (u, h) in prof:
            dx, dz = -u * c, h * t                              # chord runs backwards from the leading edge
            rx, rz = dx * cos(a) - dz * sin(a), dx * sin(a) + dz * cos(a)
            r.append((x_le + rx - sweep(f), y, z + rz + rise(f)))
        rings.append(r)
    return loft_rings(part, rings, parts)


def strut(part, parts, a, b, r=0.018, n=6):
    """Thin tube from point a to b (suspension arms, mirror stalks, pillars)."""
    ax, ay, az = a
    bx, by, bz = b
    dx, dy, dz = bx - ax, by - ay, bz - az
    L = (dx * dx + dy * dy + dz * dz) ** 0.5
    bpy.ops.mesh.primitive_cylinder_add(vertices=n, radius=r, depth=L, location=((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2))
    o = bpy.context.active_object
    # cylinder axis is +Z: rotate onto (dx, dy, dz)
    o.rotation_mode = 'QUATERNION'
    from mathutils import Vector
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(Vector((dx, dy, dz)))
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return _tag(o, part, parts)


def _catmull_rom(points, per_segment=6):
    """Smooth path through every point (a NURBS curve would only pass near them)."""
    out = []
    pts = [points[0]] + list(points) + [points[-1]]
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for k in range(per_segment):
            t = k / per_segment
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * (2 * p1[j] + (p2[j] - p0[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2
                                    + (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * t3) for j in range(3)))
    out.append(tuple(points[-1]))
    return out


def tube(part, parts, points, r=0.025):
    """Smooth tube through every point of a polyline (the halo)."""
    cu = bpy.data.curves.new(part, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = 2
    path = _catmull_rom(points)
    sp = cu.splines.new('POLY')
    sp.points.add(len(path) - 1)
    for p, q in zip(sp.points, path):
        p.co = (*q, 1.0)
    o = bpy.data.objects.new(part, cu)
    bpy.context.collection.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target='MESH')
    o = bpy.context.active_object
    return _tag(o, part, parts)


def ellipsoid(part, parts, loc, size, segments=12, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=loc)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return _tag(o, part, parts)


def f1_body(P):
    """All body parts of the 2022+ car, as a list of tagged objects."""
    objs = []
    # Floor: plank, edge wings, diffuser
    objs.append(section_loft('floor', [(1.20, 0.55, 0.55, 0.03, 0.07), (0.6, 0.80, 0.80, 0.03, 0.07),
                                        (-1.3, 0.80, 0.80, 0.03, 0.07), (-1.55, 0.62, 0.62, 0.04, 0.09)], P, p=8))
    for s in (1, -1):
        objs.append(section_loft('floor', [(0.55, 0.02, 0.02, 0.07, 0.10, 0.82 * s), (-0.2, 0.02, 0.02, 0.07, 0.16, 0.82 * s),
                                            (-1.25, 0.02, 0.02, 0.07, 0.12, 0.82 * s)], P, p=6, n=8))   # edge wing
    objs.append(section_loft('floor', [(-1.50, 0.60, 0.60, 0.04, 0.10), (-1.85, 0.56, 0.56, 0.08, 0.22),
                                        (-2.10, 0.53, 0.53, 0.12, 0.30)], P, p=10))                       # diffuser, meets the endplates
    # Chassis tub and cockpit
    objs.append(section_loft('chassis', [(-0.40, 0.33, 0.36, 0.08, 0.60), (0.20, 0.32, 0.35, 0.09, 0.63),
                                          (0.90, 0.29, 0.32, 0.11, 0.60), (1.35, 0.25, 0.29, 0.14, 0.56)], P, p=3.5))
    objs.append(ellipsoid('floor', P, (0.30, 0, 0.625), (0.42, 0.22, 0.012), 16, 4))                       # cockpit opening (carbon)
    # Nose dropping onto the front wing
    objs.append(section_loft('nose', [(1.35, 0.25, 0.29, 0.14, 0.56), (1.85, 0.17, 0.21, 0.15, 0.45),
                                       (2.35, 0.10, 0.13, 0.14, 0.32), (2.74, 0.05, 0.07, 0.13, 0.22)], P, p=3))
    # Sidepods: tall narrow inlet, undercut, downwash ramp to the floor
    for s in (1, -1):
        objs.append(section_loft('sidepods', [(0.64, 0.15, 0.08, 0.24, 0.58, 0.50 * s), (0.30, 0.21, 0.10, 0.12, 0.61, 0.52 * s),
                                               (-0.40, 0.20, 0.11, 0.10, 0.50, 0.48 * s), (-1.00, 0.14, 0.10, 0.09, 0.30, 0.42 * s),
                                               (-1.40, 0.07, 0.06, 0.08, 0.15, 0.36 * s)], P, p=3.5))
    # Engine cover narrowing to the tail; airbox / roll hoop above the helmet; crash structure
    objs.append(section_loft('engine', [(-0.30, 0.28, 0.34, 0.10, 0.66), (-0.90, 0.20, 0.26, 0.12, 0.60),
                                         (-1.40, 0.12, 0.16, 0.14, 0.44), (-1.85, 0.07, 0.09, 0.16, 0.32)], P, p=3))
    objs.append(section_loft('engine', [(0.04, 0.07, 0.10, 0.64, 0.96), (-0.25, 0.08, 0.16, 0.60, 0.93),
                                         (-0.70, 0.06, 0.20, 0.58, 0.80), (-1.15, 0.02, 0.16, 0.56, 0.64)], P, p=2.2))
    objs.append(ellipsoid('floor', P, (0.03, 0, 0.86), (0.012, 0.06, 0.07), 10, 6))                      # intake mouth
    objs.append(section_loft('engine', [(-1.80, 0.09, 0.10, 0.16, 0.34), (-2.30, 0.05, 0.06, 0.20, 0.30)], P, p=4, n=8))
    objs.append(section_loft('fin', [(-0.80, 0.006, 0.006, 0.60, 0.80), (-1.70, 0.005, 0.005, 0.32, 0.62)], P, p=2, n=8))
    # Halo: side arms over the cockpit into the centre pillar
    objs.append(tube('halo', P, [(-0.10, 0.30, 0.60), (0.05, 0.28, 0.77), (0.35, 0.17, 0.83), (0.58, 0.0, 0.81),
                                 (0.35, -0.17, 0.83), (0.05, -0.28, 0.77), (-0.10, -0.30, 0.60)], r=0.03))
    objs.append(strut('halo', P, (0.58, 0, 0.81), (0.78, 0, 0.58), r=0.03, n=12))   # centre pillar, from the arc's apex
    objs.append(ellipsoid('helmet', P, (0.18, 0, 0.74), (0.13, 0.12, 0.13), 16, 10))
    # Mirrors on stalks
    for s in (1, -1):
        objs.append(ellipsoid('chassis', P, (0.62, 0.43 * s, 0.67), (0.06, 0.035, 0.03), 8, 5))
        objs.append(strut('chassis', P, (0.66, 0.30 * s, 0.58), (0.62, 0.41 * s, 0.66), r=0.012))
    # Wishbones (carbon): front and rear, upper and lower, plus push/pull rods
    for s in (1, -1):
        for (a, b) in [((1.42, 0.22, 0.42), (1.60, 0.68, 0.45)), ((1.80, 0.20, 0.42), (1.60, 0.68, 0.45)),
                       ((1.40, 0.20, 0.18), (1.60, 0.68, 0.24)), ((1.82, 0.18, 0.20), (1.60, 0.68, 0.24)),
                       ((-1.60, 0.16, 0.40), (-1.85, 0.62, 0.46)), ((-2.05, 0.12, 0.40), (-1.85, 0.62, 0.46)),
                       ((-1.60, 0.16, 0.18), (-1.85, 0.62, 0.24)), ((-2.05, 0.12, 0.20), (-1.85, 0.62, 0.24))]:
            objs.append(strut('floor', P, (a[0], a[1] * s, a[2]), (b[0], b[1] * s, b[2])))
    # Front wing: main plane + 3 flaps curling up at the tips, curved endplates
    objs.append(wing('fw_main', P, 2.90, 0.06, 0.40, 0.035, 0.95, aoa_deg=-4, rise=lambda f: 0.07 * max(0, f - 0.45) / 0.55))
    for k in range(3):
        objs.append(wing('fw_flap', P, 2.64 - 0.09 * k, 0.10 + 0.045 * k, 0.15, 0.022, 0.93, aoa_deg=-(14 + 9 * k),
                         rise=lambda f, k=k: (0.06 + 0.035 * k) * max(0, f - 0.35) / 0.65))
    for s in (1, -1):
        objs.append(section_loft('fw_end', [(2.92, 0.012, 0.012, 0.04, 0.12, 0.955 * s), (2.62, 0.012, 0.012, 0.04, 0.24, 0.955 * s),
                                             (2.32, 0.012, 0.012, 0.06, 0.20, 0.955 * s)], P, p=6, n=8))
    # Rear wing, 2022+ style: spoon main plane + DRS flap whose tips roll down into curved endplates,
    # two beam-wing elements low between the endplates, swan-neck pylon hooked over the main plane, DRS actuator pod
    roll = lambda f: 0.20 * max(0.0, (f - 0.70) / 0.30) ** 2            # tip curls down into the endplate
    objs.append(wing('rw_main', P, -2.08, 0.82, 0.30, 0.03, 0.50, aoa_deg=-8, stations=13,
                     rise=lambda f: -0.035 * (1 - f * f) - roll(f)))
    objs.append(wing('rw_flap', P, -2.25, 0.91, 0.22, 0.022, 0.50, aoa_deg=-28, stations=13,
                     rise=lambda f: -0.02 * (1 - f * f) - roll(f), sweep=lambda f: 0.04 * roll(f) / 0.20))
    objs.append(wing('rw_main', P, -2.16, 0.40, 0.17, 0.018, 0.47, aoa_deg=-6))                                   # upper beam wing
    objs.append(wing('rw_main', P, -2.24, 0.33, 0.15, 0.016, 0.47, aoa_deg=-14))                                  # lower beam wing
    for s in (1, -1):
        # curved endplate: top follows the rolled wing tips, the lower front is cut away, the foot meets the beam wing
        objs.append(section_loft('rw_end', [(-2.10, 0.011, 0.011, 0.66, 0.72, 0.505 * s), (-2.20, 0.011, 0.011, 0.58, 0.86, 0.505 * s),
                                             (-2.31, 0.011, 0.011, 0.30, 0.94, 0.505 * s), (-2.46, 0.011, 0.011, 0.30, 0.95, 0.505 * s),
                                             (-2.56, 0.011, 0.011, 0.56, 0.88, 0.505 * s)], P, p=6, n=8))
    objs.append(tube('rw_pillar', P, [(-1.96, 0.0, 0.33), (-2.03, 0.0, 0.62), (-2.06, 0.0, 0.86), (-2.12, 0.0, 0.90),
                                       (-2.20, 0.0, 0.86)], r=0.02))       # swan neck: up, over the leading edge, onto the top
    objs.append(ellipsoid('rw_pillar', P, (-2.33, 0, 0.955), (0.06, 0.025, 0.02), 8, 5))                     # DRS actuator pod
    return objs
