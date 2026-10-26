"""
The tower defense's hand-scripted props, one per output file: the file's name picks the prop.

    lab blender props.py --out ../src/models/pad.glb      # pad, arrow, cannonball, shard, pine,
                                                          # pine_snow, tree, rock, lantern, bridge

Sizes are game units (a tower stands about 3.5 high, the path is about 2.25 wide). Blender is Z-up;
glTF's +Z (the way a projectile flies) is Blender's -Y.
"""

import math
import random
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector, noise

NAME = Path(OUT).stem  # noqa: F821 — the runner passes OUT
random.seed(7)


def material(name, colour, roughness=0.8, metallic=0.0, emission=None, strength=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


def link(obj, mat=None, smooth=True):
    """Give an object in the scene its material and shading."""
    if mat:
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = smooth
    return obj


def bevel(obj, width=0.03, segments=2):
    mod = obj.modifiers.new("bevel", "BEVEL")
    mod.width, mod.segments, mod.limit_method = width, segments, "ANGLE"
    return obj


def cylinder(r1, r2, depth, at=(0, 0, 0), sides=12, mat=None, smooth=True, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=r1, radius2=r2, depth=depth, location=at, rotation=rot)
    return link(bpy.context.object, mat, smooth)


def box(size, at=(0, 0, 0), mat=None, rot=(0, 0, 0), bevel_width=0.02, segments=2):
    bpy.ops.mesh.primitive_cube_add(size=1, location=at, rotation=rot)
    o = bpy.context.object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    link(o, mat, smooth=False)
    return bevel(o, bevel_width, segments) if bevel_width else o


def blob(radius, at, mat, seed, roughness=0.35, subdiv=3, squash=1.0):
    """An icosphere pushed in and out by noise: a rock, a canopy, a snow cap."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=radius, location=at)
    o = bpy.context.object
    off = Vector((seed * 3.1, seed * 7.3, seed * 1.7))
    for v in o.data.vertices:
        n = noise.noise(v.co * (1.6 / radius) + off)
        v.co *= 1 + n * roughness
        v.co.z *= squash
    return link(o, mat, smooth=True)


def flat(obj):
    for p in obj.data.polygons:
        p.use_smooth = False
    return obj


stone = material("stone", (0.62, 0.6, 0.56), 0.85)
stone_dark = material("stone dark", (0.4, 0.39, 0.37), 0.9)
wood = material("wood", (0.55, 0.33, 0.16), 0.75)
wood_dark = material("wood dark", (0.33, 0.2, 0.1), 0.8)
leaf = material("leaf", (0.24, 0.55, 0.18), 0.8)
leaf_dark = material("leaf dark", (0.13, 0.38, 0.17), 0.85)
snow = material("snow", (0.93, 0.96, 1.0), 0.6)
iron = material("iron", (0.12, 0.12, 0.13), 0.45, 0.8)
dirt = material("dirt", (0.5, 0.38, 0.25), 1.0)


if NAME == "pad":
    # A round stone platform: a ring of bevelled wedge stones around packed earth.
    cylinder(1.05, 1.05, 0.12, (0, 0, 0.06), 32, dirt)
    stones = 12
    for i in range(stones):
        a0, a1 = (i + 0.06) / stones * math.tau, (i + 0.94) / stones * math.tau
        bm = bmesh.new()
        ring = []
        for r, z in ((0.88, 0), (1.22, 0), (1.22, 0.2), (0.88, 0.2)):
            ring.append([bm.verts.new((r * math.cos(a0 + (a1 - a0) * k / 3), r * math.sin(a0 + (a1 - a0) * k / 3), z + random.uniform(0, 0.03) * (z > 0))) for k in range(4)])
        for j in range(4):
            a, b = ring[j], ring[(j + 1) % 4]
            for k in range(3):
                bm.faces.new((a[k], a[k + 1], b[k + 1], b[k]))
        bm.faces.new([ring[j][0] for j in range(4)])
        bm.faces.new([ring[j][3] for j in reversed(range(4))])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        mesh = bpy.data.meshes.new(f"stone{i}")
        bm.to_mesh(mesh)
        o = bpy.data.objects.new(f"stone{i}", mesh)
        bpy.context.scene.collection.objects.link(o)
        link(o, stone if i % 3 else stone_dark, smooth=False)
        bevel(o, 0.035, 2)

elif NAME == "arrow":
    # Along Blender -Y: glTF +Z, the way it flies. Tip at -0.45, nock at +0.45.
    cylinder(0.025, 0.025, 0.9, (0, 0, 0), 6, wood, rot=(math.pi / 2, 0, 0))
    cylinder(0.07, 0, 0.18, (0, -0.52, 0), 6, iron, rot=(math.pi / 2, 0, 0))
    feather = material("feather", (0.95, 0.25, 0.2), 0.7)
    for i in range(3):
        a = i / 3 * math.tau
        box((0.005, 0.22, 0.07), (math.cos(a) * 0.045, 0.34, math.sin(a) * 0.045), feather, rot=(0, -a + math.pi / 2, 0), bevel_width=0)

elif NAME == "cannonball":
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=0.2)
    link(bpy.context.object, iron)

elif NAME == "shard":
    # An ice crystal: a long hexagonal bipyramid, flying along -Y.
    ice = material("ice", (0.7, 0.9, 1.0), 0.15, emission=(0.4, 0.75, 1.0), strength=1.5)
    cylinder(0.11, 0, 0.35, (0, -0.175, 0), 6, ice, smooth=False, rot=(math.pi / 2, 0, 0))
    cylinder(0.11, 0, 0.25, (0, 0.125, 0), 6, ice, smooth=False, rot=(-math.pi / 2, 0, 0))

elif NAME in ("pine", "pine_snow"):
    cylinder(0.12, 0.08, 0.6, (0, 0, 0.3), 8, wood_dark)
    for i, (r, z, h) in enumerate(((0.8, 0.55, 0.9), (0.62, 1.05, 0.8), (0.42, 1.5, 0.7))):
        cone = cylinder(r, 0.02, h, (0, 0, z + h / 2), 9, leaf_dark, smooth=False)
        for v in cone.data.vertices:  # a ragged hem
            if v.co.z < 0:
                v.co.x *= 1 + random.uniform(-0.12, 0.12)
                v.co.y *= 1 + random.uniform(-0.12, 0.12)
                v.co.z += random.uniform(-0.06, 0.04)
        if NAME == "pine_snow":
            cap = cylinder(r * 0.82, 0.02, h * 0.62, (0, 0, z + h * 0.62), 9, snow, smooth=False)
            cap.scale = (1.02, 1.02, 1)

elif NAME == "tree":
    cylinder(0.13, 0.09, 0.9, (0, 0, 0.45), 8, wood)
    for i, (x, y, z, r) in enumerate(((0, 0, 1.3, 0.62), (0.32, 0.1, 1.05, 0.42), (-0.28, -0.12, 1.1, 0.45), (0.05, 0.3, 1.6, 0.4))):
        blob(r, (x, y, z), leaf if i % 2 == 0 else leaf_dark, i + 1, roughness=0.18, subdiv=2)

elif NAME == "rock":
    flat(blob(0.55, (0, 0, 0.2), stone, 3, roughness=0.45, subdiv=2, squash=0.65))
    flat(blob(0.3, (0.5, 0.25, 0.1), stone_dark, 5, roughness=0.45, subdiv=1, squash=0.7))

elif NAME == "lantern":
    cylinder(0.06, 0.07, 1.3, (0, 0, 0.65), 8, wood_dark)
    box((0.42, 0.05, 0.05), (0.18, 0, 1.25), wood_dark, bevel_width=0.01)
    glow = material("glow", (1.0, 0.8, 0.4), 0.4, emission=(1.0, 0.7, 0.3), strength=4)
    cylinder(0.1, 0.1, 0.2, (0.34, 0, 1.0), 8, glow)
    cylinder(0.13, 0.03, 0.1, (0.34, 0, 1.15), 8, iron)
    cylinder(0.03, 0.03, 0.1, (0.34, 0, 1.2), 6, iron)

elif NAME == "bridge":
    # An arched plank bridge 5.6 long along Y, 2.8 wide, its ends at deck level 0.
    length, width, rise, planks = 5.6, 2.8, 0.45, 22
    arch = lambda y: rise * (1 - (2 * y / length) ** 2)
    for i in range(planks):
        y = -length / 2 + (i + 0.5) * length / planks
        z = arch(y)
        slope = math.atan(-8 * rise * y / length**2)
        box((width + random.uniform(-0.1, 0.1), length / planks * 0.88, 0.09), (random.uniform(-0.04, 0.04), y, z), wood if i % 3 else wood_dark, rot=(slope, 0, 0), bevel_width=0.015, segments=1)
    for side in (-1, 1):
        x = side * (width / 2 - 0.08)
        for i in range(7):
            y = -length / 2 + 0.2 + i * (length - 0.4) / 6
            box((0.11, 0.11, 0.62), (x, y, arch(y) + 0.31), wood_dark, bevel_width=0.015, segments=1)
        for k in range(12):
            y0 = -length / 2 + 0.2 + k * (length - 0.4) / 12
            y1 = y0 + (length - 0.4) / 12
            mid = (y0 + y1) / 2
            slope = math.atan((arch(y1) - arch(y0)) / (y1 - y0))
            box((0.09, (y1 - y0) * 1.02 / math.cos(slope), 0.09), (x, mid, (arch(y0) + arch(y1)) / 2 + 0.58), wood, rot=(slope, 0, 0), bevel_width=0.01, segments=1)

else:
    raise SystemExit(f"props.py: no prop named {NAME!r}")
