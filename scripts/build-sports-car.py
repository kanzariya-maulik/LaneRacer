# Build Formula-D Sports / Drift / Stock car 3D model, export sports_car.glb.
# Run: python scripts/build-sports-car.py (or via blender)
import sys, os

try:
    import bpy, bmesh
    import numpy as np

    HERE = os.path.dirname(os.path.abspath(__file__))
    ROOT = os.path.dirname(HERE)
    OUT_GLB = os.path.join(ROOT, 'public', 'models', 'sports_car.glb')
    os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)

    def material(name, color, roughness=0.4, metallic=0.2):
        m = bpy.data.materials.new(name)
        try:
            m.use_nodes = True
        except AttributeError:
            pass
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None) or nt.nodes.new('ShaderNodeBsdfPrincipled')
        out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None) or nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
        bsdf.inputs['Base Color'].default_value = (*color, 1.0)
        bsdf.inputs['Roughness'].default_value = roughness
        bsdf.inputs['Metallic'].default_value = metallic
        return m

    LIVERY = material('livery', (0.9, 0.15, 0.2), roughness=0.3, metallic=0.4)
    TYRE = material('tyre', (0.02, 0.02, 0.02), roughness=0.9, metallic=0.0)
    RIM = material('rim', (0.1, 0.1, 0.12), roughness=0.3, metallic=0.9)
    GLASS = material('glass', (0.05, 0.05, 0.08), roughness=0.1, metallic=0.9)
    WING = material('carbon', (0.03, 0.03, 0.03), roughness=0.5, metallic=0.1)

    # 1. Main Chassis & Cabin (Coupe Sports Car proportions)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.45))
    body = bpy.context.active_object
    body.name = 'body'
    body.scale = (4.4, 1.92, 0.65)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    # Cabin Roof
    bpy.ops.mesh.primitive_cube_add(size=1, location=(-0.3, 0, 0.95))
    cabin = bpy.context.active_object
    cabin.name = 'cabin'
    cabin.scale = (2.1, 1.5, 0.5)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    # GT Rear Wing
    bpy.ops.mesh.primitive_cube_add(size=1, location=(-2.05, 0, 1.05))
    wing = bpy.context.active_object
    wing.name = 'rear_wing'
    wing.scale = (0.4, 1.85, 0.06)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    # Wing Endplates & Mounts
    bpy.ops.mesh.primitive_cube_add(size=1, location=(-2.05, 0.9, 1.08))
    ep1 = bpy.context.active_object
    ep1.scale = (0.45, 0.04, 0.25)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    bpy.ops.mesh.primitive_cube_add(size=1, location=(-2.05, -0.9, 1.08))
    ep2 = bpy.context.active_object
    ep2.scale = (0.45, 0.04, 0.25)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    # Front Splitter
    bpy.ops.mesh.primitive_cube_add(size=1, location=(2.15, 0, 0.18))
    splitter = bpy.context.active_object
    splitter.scale = (0.4, 1.95, 0.06)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    # Join body parts
    bpy.ops.object.select_all(action='DESELECT')
    for o in [body, cabin, wing, ep1, ep2, splitter]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    body = bpy.context.active_object
    body.name = 'body'
    body.data.materials.append(LIVERY)

    # 2. Wheels (wheel_FL, wheel_FR, wheel_RL, wheel_RR)
    wheel_coords = [
        ('wheel_FL', (1.4, 0.96, 0.35)),
        ('wheel_FR', (1.4, -0.96, 0.35)),
        ('wheel_RL', (-1.4, 0.96, 0.35)),
        ('wheel_RR', (-1.4, -0.96, 0.35)),
    ]

    for name, loc in wheel_coords:
        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.35, depth=0.32, location=loc)
        w = bpy.context.active_object
        w.name = name
        w.rotation_euler = (1.5708, 0, 0)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        w.data.materials.append(TYRE)

    bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', export_yup=True, export_apply=True)
    print(f'[Formula-D] Successfully exported {OUT_GLB}')
except ImportError:
    print('[Formula-D] Blender not found. Procedural Three.js fallback active.')
