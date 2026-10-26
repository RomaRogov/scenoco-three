"""
Build pads for each level, beside the path on dry, gentle ground, printed as TSX lines in game
units (a quarter of a map metre). Run with the asset lab's Python:

    uv run --project ~/Dev/asset-lab python tools/layout.py
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path.home() / "Dev/asset-lab"))
from lab.terrain import spline_points  # noqa: E402

LAB = Path.home() / "Dev/asset-lab"
UNIT = 0.25

for name in ("meadow", "canyon", "frost"):
    level = json.loads((LAB / f"levels/td-{name}.json").read_text())
    info = json.loads((LAB / f"out/td/terrain/{name}/terrain.json").read_text())
    n = level["size"]
    raw = np.fromfile(LAB / f"out/td/terrain/{name}/height.bin", "<u2").reshape(n, n) / 65535
    metres = info["minY"] + raw * (info["maxY"] - info["minY"])

    def height(x, z):
        c = np.clip((x + n / 2) / n * (n - 1), 0, n - 1)
        r = np.clip((z + n / 2) / n * (n - 1), 0, n - 1)
        return metres[int(round(r)), int(round(c))]

    road = level["roads"][0]
    path = spline_points(road["knots"], False, step=1.0)
    seg = np.diff(path, axis=0)
    length = np.r_[0, np.cumsum(np.linalg.norm(seg, axis=1))]
    pads = []
    side = 1
    for d in np.arange(20, length[-1] - 14, 11):
        i = int(np.searchsorted(length, d))
        p = path[i]
        t = path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]
        t /= np.linalg.norm(t)
        normal = np.array([-t[1], t[0]])
        for s in (side, -side):
            c = p + normal * s * 13.5
            if abs(c[0]) > 52 or abs(c[1]) > 118:
                continue
            if np.min(np.linalg.norm(path - c, axis=1)) < 12:
                continue
            if any(np.linalg.norm(c - q) < 24 for q in pads):
                continue
            ring = [height(c[0] + dx, c[1] + dz) for dx, dz in ((0, 0), (4, 0), (-4, 0), (0, 4), (0, -4))]
            if min(ring) < 1.0 or max(ring) - min(ring) > 3.5:
                continue
            pads.append(c)
            side = -s
            break
    print(f"// {name}: {len(pads)} pads")
    for c in pads:
        ys = [height(c[0] + dx, c[1] + dz) for dx, dz in ((0, 0), (4, 0), (-4, 0), (0, 4), (0, -4))]
        print(f"      <BuildPad position={{[{c[0] * UNIT:.2f}, {np.mean(ys) * UNIT:.2f}, {c[1] * UNIT:.2f}]}} />")
    if level.get("rivers"):
        river = spline_points(level["rivers"][0]["knots"], False, step=1.0)
        dist = np.array([np.min(np.linalg.norm(river - q, axis=1)) for q in path])
        i = int(np.argmin(dist))
        print(f"// {name}: river crossing at t = {length[i] / length[-1]:.4f}")
