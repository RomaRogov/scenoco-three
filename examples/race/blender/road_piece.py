"""
The track's road piece: 8 m of road, 10 m wide, for `SplineMesh` to repeat and bend along the track.

Run with the asset lab (`lab blender road_piece.py --out ../public/models/road.glb`) or plain
Blender (`Blender -b -P road_piece.py -- road.glb`).

glTF's axes, which three.js sees: the piece runs along +Z from 0 to 8, +Y is up. Blender is Z-up
and its exporter turns -Y into +Z, so here the piece runs along -Y. Every part has an edge loop
every half metre: a piece bends only where it has vertices.
"""

import sys

import bmesh
import bpy

LENGTH = 8.0
STEP = 0.5
HALF = 5.0  # half the asphalt's width


def material(name: str, colour: tuple[float, float, float], roughness: float) -> bpy.types.Material:
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    return m


def sweep(name: str, profile: list[tuple[float, float]], start: float, end: float, mat: bpy.types.Material, smooth: bool = False) -> None:
    """A cross-section (x across, z up), closed, swept along the piece from `start` to `end` metres."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    steps = max(1, round((end - start) / STEP))
    for i in range(steps + 1):
        y = -(start + (end - start) * i / steps)
        rings.append([bm.verts.new((x, y, z)) for x, z in profile])
    n = len(profile)
    for a, b in zip(rings, rings[1:]):
        for j in range(n):
            bm.faces.new((a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = smooth
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(mat)
    bpy.context.scene.collection.objects.link(obj)


asphalt = material("asphalt", (0.07, 0.075, 0.085), 0.92)
paint = material("paint", (0.9, 0.9, 0.86), 0.6)
red = material("kerb red", (0.62, 0.05, 0.05), 0.55)
white = material("kerb white", (0.85, 0.85, 0.85), 0.55)
gravel = material("gravel", (0.42, 0.36, 0.27), 1.0)

# The asphalt: a slab with chamfered top edges, its surface at y = 0.
sweep("asphalt", [(-HALF, -0.02), (-HALF + 0.05, 0), (HALF - 0.05, 0), (HALF, -0.02), (HALF, -0.4), (-HALF, -0.4)], 0, LENGTH, asphalt)

# Markings, a centimetre proud of the surface: an edge line each side, a dashed centre line.
line = lambda x, w: [(x - w / 2, 0), (x + w / 2, 0), (x + w / 2, 0.01), (x - w / 2, 0.01)]
for side in (-1, 1):
    sweep(f"edge line {side}", line(side * (HALF - 0.45), 0.2), 0, LENGTH, paint)
sweep("centre dash", line(0, 0.18), 1, 4, paint)
sweep("centre dash 2", line(0, 0.18), 5, 8 - 0.01, paint)

# Kerbs: a rounded hump just outside the asphalt, red and white in turns of 2 m.
hump = [(0, 0), (0.06, 0.06), (0.2, 0.11), (0.45, 0.13), (0.7, 0.1), (0.85, 0.04), (0.9, -0.02), (0.9, -0.3), (0, -0.3)]
for side in (-1, 1):
    profile = [(side * (HALF + x), z) for x, z in hump]
    if side < 0:
        profile.reverse()
    for k in range(4):
        sweep(f"kerb {side} {k}", profile, k * 2, k * 2 + 2, red if k % 2 == 0 else white, smooth=True)

# Gravel shoulders beyond the kerbs, falling away to the ground.
for side in (-1, 1):
    shoulder = [(HALF + 0.9, -0.02), (HALF + 3.2, -0.55), (HALF + 3.2, -0.7), (HALF + 0.9, -0.7)]
    profile = [(side * x, z) for x, z in shoulder]
    if side < 0:
        profile.reverse()
    sweep(f"shoulder {side}", profile, 0, LENGTH, gravel)

if "OUT" not in globals():
    # Plain Blender: the output path after `--`.
    bpy.ops.export_scene.gltf(filepath=sys.argv[sys.argv.index("--") + 1], export_format="GLB", export_yup=True)
