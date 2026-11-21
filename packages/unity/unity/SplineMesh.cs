// Written by scenoco-unity on every export — edits here are overwritten.
using System.Collections.Generic;
using System.Linq;
using Unity.Mathematics;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Splines;

namespace SceNoCo
{
    /// <summary>
    /// SceNoCo's SplineMesh: bends a modelled piece along a spline, repeated end to end to cover it, into
    /// this object's mesh — a road section with its kerbs and markings, a rail, a fence. Unity has no
    /// built-in for it (its SplineExtrude sweeps a shape instead).
    ///
    /// <see cref="mesh"/> is a model — each of its meshes bent, each keeping its material — or a bare
    /// Mesh drawn with this renderer's own material. The piece runs along its +Z with +Y up; its +X
    /// goes to the spline's right. It bends only where it has vertices, so a piece needs edge loops
    /// along its length. Copies are stretched a little so a whole number of them fills the length.
    /// Bent when enabled and whenever the spline, the piece or the count changes. In the editor, into one
    /// mesh asset per object beside the scene (<c>&lt;Scene&gt;/SplineMesh_&lt;path&gt;.asset</c>), as Unity's
    /// SplineExtrude keeps its own, written again rather than made anew: opening the scene changes
    /// nothing in it. Playing, into a mesh of its own; a player build reads the piece's vertices, so its
    /// model needs Read/Write on.
    /// </summary>
    [ExecuteAlways, DisallowMultipleComponent, RequireComponent(typeof(MeshFilter), typeof(MeshRenderer))]
    public sealed class SplineMesh : MonoBehaviour
    {
        /// <summary>The spline. Left empty, the one on this object.</summary>
        public SplineContainer container;
        /// <summary>The piece to repeat: a model (its prefab) or a Mesh.</summary>
        public Object mesh;
        /// <summary>How many copies; 0 fits as many as the piece's own length allows.</summary>
        public int count;

        Mesh built;
        /// <summary>What <see cref="built"/> was bent from: rebuilt only when this changes.</summary>
        int builtFrom;
        bool dirty;

        /// <summary>One part of the piece: a submesh's vertices in the piece's own space, and its material.</summary>
        struct Part
        {
            public Vector3[] positions, normals;
            public Vector2[] uvs;
            public int[] triangles;
            public Material material;
        }

        void OnEnable()
        {
            Spline.Changed += OnSplineChanged;
            Rebuild();
        }

        void OnDisable() => Spline.Changed -= OnSplineChanged;

        void OnValidate() => dirty = true;

        void OnSplineChanged(Spline spline, int knot, SplineModification change)
        {
            var c = Container;
            if (c != null && c.Splines.Contains(spline)) dirty = true;
        }

        void Update()
        {
            if (dirty) Rebuild();
        }

        SplineContainer Container => container != null ? container : GetComponent<SplineContainer>();

        /// <summary>The inputs, as one number: the knots, the spline's place against this object, the piece and the count.</summary>
        int Inputs(SplineContainer spline)
        {
            var hash = new System.HashCode();
            hash.Add(spline.Spline.Closed);
            foreach (var knot in spline.Spline.Knots) { hash.Add(knot.Position); hash.Add(knot.TangentIn); hash.Add(knot.TangentOut); hash.Add(knot.Rotation); }
            var relative = transform.worldToLocalMatrix * spline.transform.localToWorldMatrix;
            for (var i = 0; i < 16; i++) hash.Add(Mathf.Round(relative[i] * 1e4f));
            hash.Add(mesh.name);
            hash.Add(count);
            return hash.ToHashCode();
        }

        /// <summary>Bend again, if the spline or the piece changed since the last time.</summary>
        public void Rebuild()
        {
            dirty = false;
            var spline = Container;
            if (mesh == null || spline == null || spline.Spline == null || spline.Spline.Count < 2) return;
            var inputs = Inputs(spline);
            var filter = GetComponent<MeshFilter>();
            if (built != null && inputs == builtFrom)
            {
                if (filter.sharedMesh != built) filter.sharedMesh = built;
                return;
            }
            var parts = PartsOf(mesh);
            if (parts.Count == 0) return;

            // One length for the whole piece, so its parts stay in step.
            float minZ = float.MaxValue, maxZ = float.MinValue;
            foreach (var part in parts)
                foreach (var p in part.positions) { minZ = Mathf.Min(minZ, p.z); maxZ = Mathf.Max(maxZ, p.z); }
            var pieceLength = Mathf.Max(1e-6f, maxZ - minZ);
            var length = spline.CalculateLength();
            var copies = count > 0 ? count : Mathf.Max(1, Mathf.RoundToInt(length / pieceLength));

            // A piece's vertices share edge loops: one frame per place along the spline.
            var frames = new Dictionary<float, (Vector3 position, Vector3 right, Vector3 up, Vector3 forward)>();
            (Vector3, Vector3, Vector3, Vector3) FrameAt(float t)
            {
                if (frames.TryGetValue(t, out var f)) return f;
                spline.Evaluate(Mathf.Clamp01(t), out float3 position, out float3 tangent, out float3 up);
                var forward = transform.InverseTransformDirection((Vector3)math.normalizesafe(tangent)).normalized;
                var upward = transform.InverseTransformDirection((Vector3)math.normalizesafe(up)).normalized;
                var right = Vector3.Cross(upward, forward).normalized;
                upward = Vector3.Cross(forward, right);
                f = (transform.InverseTransformPoint(position), right, upward, forward);
                frames[t] = f;
                return f;
            }

            var positions = new List<Vector3>();
            var normals = new List<Vector3>();
            var uvs = new List<Vector2>();
            var submeshes = new List<int[]>();
            var materials = new List<Material>();
            foreach (var part in parts)
            {
                var triangles = new List<int>(part.triangles.Length * copies);
                for (var i = 0; i < copies; i++)
                {
                    var start = positions.Count;
                    for (var v = 0; v < part.positions.Length; v++)
                    {
                        var p = part.positions[v];
                        var (o, r, u, f) = FrameAt((i + (p.z - minZ) / pieceLength) / copies);
                        positions.Add(o + r * p.x + u * p.y);
                        if (part.normals != null) { var n = part.normals[v]; normals.Add((r * n.x + u * n.y + f * n.z).normalized); }
                        if (part.uvs != null) uvs.Add(part.uvs[v]);
                    }
                    foreach (var index in part.triangles) triangles.Add(start + index);
                }
                submeshes.Add(triangles.ToArray());
                materials.Add(part.material);
            }

            if (built == null) built = NewMesh();
            built.Clear();
            built.indexFormat = positions.Count > 65535 ? IndexFormat.UInt32 : IndexFormat.UInt16;
            built.SetVertices(positions);
            if (normals.Count == positions.Count) built.SetNormals(normals);
            if (uvs.Count == positions.Count) built.SetUVs(0, uvs);
            built.subMeshCount = submeshes.Count;
            for (var s = 0; s < submeshes.Count; s++) built.SetTriangles(submeshes[s], s);
            if (normals.Count != positions.Count) built.RecalculateNormals();
            built.RecalculateBounds();
            builtFrom = inputs;
            filter.sharedMesh = built;
            if (mesh is GameObject) GetComponent<MeshRenderer>().sharedMaterials = materials.ToArray();
#if UNITY_EDITOR
            if (UnityEditor.EditorUtility.IsPersistent(built)) UnityEditor.EditorUtility.SetDirty(built);
#endif
        }

        /// <summary>The mesh to bend into: in the editor, this object's asset in the scene's own folder; playing, a mesh of its own.</summary>
        Mesh NewMesh()
        {
#if UNITY_EDITOR
            var scene = gameObject.scene.path;
            if (!Application.isPlaying && !string.IsNullOrEmpty(scene))
            {
                var folder = $"{System.IO.Path.GetDirectoryName(scene)}/{System.IO.Path.GetFileNameWithoutExtension(scene)}";
                var named = transform;
                var path = name;
                while ((named = named.parent) != null) path = $"{named.name}_{path}";
                var file = $"{folder}/SplineMesh_{path}.asset";
                var existing = UnityEditor.AssetDatabase.LoadAssetAtPath<Mesh>(file);
                if (existing != null) return existing;
                System.IO.Directory.CreateDirectory(folder);
                var asset = new Mesh { name = $"SplineMesh_{path}" };
                UnityEditor.AssetDatabase.CreateAsset(asset, file);
                return asset;
            }
#endif
            return new Mesh { name = $"SplineMesh_{name}", hideFlags = HideFlags.DontSave };
        }

        void OnDestroy()
        {
            // A mesh made playing is this object's alone; the editor's is an asset, kept.
            if (built != null && Application.isPlaying) Destroy(built);
        }

        /// <summary>A model's submeshes, each in the model root's space, or a lone Mesh's.</summary>
        static List<Part> PartsOf(Object source)
        {
            var parts = new List<Part>();
            if (source is Mesh lone)
            {
                for (var s = 0; s < lone.subMeshCount; s++) parts.Add(PartOf(lone, s, Matrix4x4.identity, null));
                return parts;
            }
            if (source is not GameObject root) return parts;
            var toRoot = root.transform.worldToLocalMatrix;
            foreach (var filter in root.GetComponentsInChildren<MeshFilter>(true))
            {
                var m = filter.sharedMesh;
                if (m == null) continue;
                var shared = filter.TryGetComponent<MeshRenderer>(out var renderer) ? renderer.sharedMaterials : new Material[0];
                var matrix = toRoot * filter.transform.localToWorldMatrix;
                for (var s = 0; s < m.subMeshCount; s++)
                    parts.Add(PartOf(m, s, matrix, shared.Length > 0 ? shared[Mathf.Min(s, shared.Length - 1)] : null));
            }
            return parts;
        }

        /// <summary>One submesh, its vertices renumbered from 0 and moved by <paramref name="matrix"/>.</summary>
        static Part PartOf(Mesh m, int submesh, Matrix4x4 matrix, Material material)
        {
            var source = m.GetTriangles(submesh);
            var vertices = m.vertices;
            var sourceNormals = m.normals;
            var sourceUvs = m.uv;
            var remap = new Dictionary<int, int>();
            var positions = new List<Vector3>();
            var normals = new List<Vector3>();
            var uvs = new List<Vector2>();
            var triangles = new int[source.Length];
            var normalMatrix = matrix.inverse.transpose;
            for (var i = 0; i < source.Length; i++)
            {
                var v = source[i];
                if (!remap.TryGetValue(v, out var index))
                {
                    index = remap[v] = positions.Count;
                    positions.Add(matrix.MultiplyPoint3x4(vertices[v]));
                    if (sourceNormals.Length == vertices.Length) normals.Add(normalMatrix.MultiplyVector(sourceNormals[v]).normalized);
                    if (sourceUvs.Length == vertices.Length) uvs.Add(sourceUvs[v]);
                }
                triangles[i] = index;
            }
            return new Part
            {
                positions = positions.ToArray(),
                normals = normals.Count == positions.Count ? normals.ToArray() : null,
                uvs = uvs.Count == positions.Count ? uvs.ToArray() : null,
                triangles = triangles,
                material = material,
            };
        }
    }
}
