"""
The race car: a low-slung body lofted from cross-sections, a glass canopy, a splitter and a rear
wing, lights, and four wheels.

Run with the asset lab (`lab blender car.py --out ../src/models/car.glb`) or plain Blender
(`Blender -b -P car.py -- car.glb`).

glTF's axes, which three.js sees: the nose at +Z, +Y up, the origin on the ground under the car's
middle. Blender is Z-up and its exporter turns -Y into +Z, so here the nose points along -Y. The car's
left is +X.

What the game reaches by name: `body` (everything that leans), `wheel_FL`, `wheel_FR`, `wheel_RL`
and `wheel_RR`, each with its origin at the wheel's centre so it can steer and spin, and the material
`paint`, which each car tints its own colour.
"""

import math
import sys

import bmesh
import bpy

LENGTH = 4.3
WHEEL_RADIUS = 0.36
WHEEL_WIDTH = 0.3
TRACK = 0.86  # the wheels' centres from the middle, across
AXLE = 1.38  # the axles from the middle, along


def material(name, colour, roughness, metallic=0.0, emission=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = 4.0
    return m


paint = material("paint", (1, 1, 1), 0.28, 0.45)
carbon = material("carbon", (0.025, 0.027, 0.03), 0.45, 0.3)
glass = material("glass", (0.04, 0.07, 0.11), 0.05, 0.6)
tyre = material("tyre", (0.03, 0.03, 0.03), 0.9)
rim = material("rim", (0.75, 0.76, 0.78), 0.25, 1.0)
headlight = material("headlight", (1, 0.97, 0.88), 0.2, emission=(1, 0.95, 0.8))
taillight = material("taillight", (0.6, 0.02, 0.02), 0.3, emission=(1, 0.05, 0.03))


def section(half_width, bottom, top, sides=20, taper=0.18):
    """A rounded cross-section (a superellipse), narrower at the top: x across, z up."""
    mid, half_height = (bottom + top) / 2, (top - bottom) / 2
    points = []
    for i in range(sides):
        a = 2 * math.pi * i / sides
        c, s = math.cos(a), math.sin(a)
        x = half_width * math.copysign(abs(c) ** 0.5, c)
        z = mid + half_height * math.copysign(abs(s) ** 0.5, s)
        if z > mid:
            x *= 1 - taper * (z - mid) / half_height
        points.append((x, z))
    return points


def loft(name, stations, mats, sides=20, taper=0.18, subdivide=1):
    """Cross-sections at stations along -Y (y, half width, bottom, top), joined and capped, smoothed."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = [[bm.verts.new((x, y, z)) for x, z in section(w, b, t, sides, taper)] for y, w, b, t in stations]
    for a, b in zip(rings, rings[1:]):
        for j in range(sides):
            bm.faces.new((a[j], a[(j + 1) % sides], b[(j + 1) % sides], b[j]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    for m in mats:
        obj.data.materials.append(m)
    for poly in mesh.polygons:
        poly.use_smooth = True
    bpy.context.scene.collection.objects.link(obj)
    if subdivide:
        mod = obj.modifiers.new("smooth", "SUBSURF")
        mod.levels = mod.render_levels = subdivide
    return obj


def block(name, size, at, mat, bevel=0.02):
    """A box with rounded edges: a wing, a splitter, a light."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=at)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(scale=True)
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    return obj


# --- the body ------------------------------------------------------------------------------------
# Nose at -Y. A wedge that rises to the cockpit, fenders swelling over each axle, the waist pinched
# between them, the tail cut off square under the wing.
half = LENGTH / 2
body = loft("shell", [
    (-half, 0.6, 0.22, 0.38),
    (-half + 0.25, 0.9, 0.19, 0.48),
    (-1.65, 1.0, 0.18, 0.6),
    (-1.1, 1.0, 0.18, 0.6),
    (-0.55, 0.86, 0.18, 0.6),
    (0.25, 0.9, 0.18, 0.66),
    (1.0, 1.05, 0.18, 0.72),
    (1.7, 1.03, 0.2, 0.72),
    (half - 0.15, 0.92, 0.24, 0.68),
    (half, 0.8, 0.3, 0.6),
], [paint, carbon])
# Two-tone: the lower sides carbon, the paint above.
for poly in body.data.polygons:
    if poly.center.z < 0.3:
        poly.material_index = 1

canopy = loft("canopy", [
    (-0.85, 0.2, 0.56, 0.62),
    (-0.5, 0.42, 0.56, 0.88),
    (0.0, 0.5, 0.56, 1.0),
    (0.5, 0.47, 0.56, 0.96),
    (0.95, 0.3, 0.56, 0.8),
    (1.2, 0.14, 0.56, 0.7),
], [glass], taper=0.4)

parts = [
    body,
    canopy,
    block("splitter", (1.8, 0.3, 0.05), (0, -half + 0.15, 0.17), carbon, 0.015),
    block("wing", (1.8, 0.36, 0.06), (0, half - 0.22, 1.08), paint, 0.02),
    block("endplate L", (0.04, 0.5, 0.3), (0.9, half - 0.22, 1.0), carbon, 0.01),
    block("endplate R", (0.04, 0.5, 0.3), (-0.9, half - 0.22, 1.0), carbon, 0.01),
    block("strut L", (0.05, 0.1, 0.32), (0.42, half - 0.28, 0.86), carbon, 0.01),
    block("strut R", (0.05, 0.1, 0.32), (-0.42, half - 0.28, 0.86), carbon, 0.01),
    block("diffuser", (1.5, 0.3, 0.08), (0, half - 0.05, 0.24), carbon, 0.01),
    block("headlight L", (0.34, 0.22, 0.05), (0.56, -half + 0.42, 0.5), headlight, 0.015),
    block("headlight R", (0.34, 0.22, 0.05), (-0.56, -half + 0.42, 0.5), headlight, 0.015),
    block("taillight L", (0.42, 0.05, 0.07), (0.52, half - 0.02, 0.6), taillight, 0.01),
    block("taillight R", (0.42, 0.05, 0.07), (-0.52, half - 0.02, 0.6), taillight, 0.01),
    block("mirror L", (0.16, 0.08, 0.07), (0.62, -0.5, 0.72), paint, 0.015),
    block("mirror R", (0.16, 0.08, 0.07), (-0.62, -0.5, 0.72), paint, 0.015),
]

# One object for everything that leans: modifiers applied, then joined.
bpy.ops.object.select_all(action="DESELECT")
for part in parts:
    part.select_set(True)
    bpy.context.view_layer.objects.active = part
    for mod in list(part.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body.name = "body"


# --- the wheels ----------------------------------------------------------------------------------
def wheel(name, x, y):
    """A tyre with rounded shoulders and a rim inside it, its origin at the centre, its axle along X."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=WHEEL_RADIUS, depth=WHEEL_WIDTH, location=(0, 0, 0), rotation=(0, math.pi / 2, 0))
    t = bpy.context.active_object
    t.data.materials.append(tyre)
    mod = t.modifiers.new("bevel", "BEVEL")
    mod.width = 0.07
    mod.segments = 3
    bpy.ops.object.modifier_apply(modifier="bevel")
    side = 1 if x > 0 else -1
    bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=WHEEL_RADIUS * 0.66, depth=0.04, location=(side * (WHEEL_WIDTH / 2 + 0.005), 0, 0), rotation=(0, math.pi / 2, 0))
    r = bpy.context.active_object
    r.data.materials.append(rim)
    # Five spokes' worth of hub: a small cap.
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.08, depth=0.06, location=(side * (WHEEL_WIDTH / 2 + 0.03), 0, 0), rotation=(0, math.pi / 2, 0))
    h = bpy.context.active_object
    h.data.materials.append(carbon)
    bpy.ops.object.select_all(action="DESELECT")
    for o in (t, r, h):
        o.select_set(True)
    bpy.context.view_layer.objects.active = t
    bpy.ops.object.join()
    t.name = name
    for poly in t.data.polygons:
        poly.use_smooth = True
    t.location = (x, y, WHEEL_RADIUS)
    return t


# Front is -Y; the car's left is +X.
wheel("wheel_FL", TRACK, -AXLE)
wheel("wheel_FR", -TRACK, -AXLE)
wheel("wheel_RL", TRACK, AXLE)
wheel("wheel_RR", -TRACK, AXLE)

if "OUT" not in globals():
    # Plain Blender: the output path after `--`.
    bpy.ops.export_scene.gltf(filepath=sys.argv[sys.argv.index("--") + 1], export_format="GLB", export_yup=True)
