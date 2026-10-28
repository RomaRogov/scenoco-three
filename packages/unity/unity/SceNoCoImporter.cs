// Written by scenoco-unity on every export — edits here are overwritten.
//
// Builds what Assets/SceNoCo/export.json describes with Unity's own API: mesh and material assets,
// prefabs (nested ones as nested prefabs), and scenes. It runs by itself after the export's scripts
// compile, or from SceNoCo ▸ Import. Re-importing updates assets in place, so references to them hold.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace SceNoCo
{
    [InitializeOnLoad]
    public static class Importer
    {
        const string DataPath = "Assets/SceNoCo/export.json";
        const string PendingPath = "Assets/SceNoCo/.pending";

        static Importer()
        {
            // Once the Editor has settled — compiled, imported, not playing — and only for a fresh export.
            EditorApplication.update += WhenSettled;
        }

        static void WhenSettled()
        {
            if (EditorApplication.isCompiling || EditorApplication.isUpdating || EditorApplication.isPlayingOrWillChangePlaymode) return;
            EditorApplication.update -= WhenSettled;
            if (File.Exists(PendingPath)) Import();
        }

        static readonly List<string> warnings = new List<string>();

        [MenuItem("SceNoCo/Import")]
        public static void Import()
        {
            if (!File.Exists(DataPath))
            {
                Debug.LogError($"SceNoCo: no {DataPath} — run scenoco-unity first.");
                return;
            }
            warnings.Clear();
            AssetDatabase.Refresh();
            var data = (Dictionary<string, object>)Json.Parse(File.ReadAllText(DataPath));
            foreach (var w in List(data["warnings"])) warnings.Add((string)w);

            foreach (var m in List(data["meshes"])) Try(() => MakeMesh(Obj(m)), Str(Obj(m), "path"));
            foreach (var m in List(data["materials"])) Try(() => MakeMaterial(Obj(m)), Str(Obj(m), "path"));
            AssetDatabase.SaveAssets();

            var prefabs = List(data["prefabs"]).Select(Obj).ToList();
            // First every prefab's objects and components, then their fields: a field may name a prefab saved later.
            foreach (var p in prefabs) Try(() => SavePrefab(p), Str(p, "path"));
            foreach (var p in prefabs) Try(() => WirePrefab(p), Str(p, "path"));

            var scenes = List(data["scenes"]).Select(Obj).ToList();
            replaced = false;
            foreach (var s in scenes) Try(() => SaveScene(s), Str(s, "path"));
            var paths = scenes.Select(s => Str(s, "path")).ToList();
            // An empty untitled scene stood in for the first exported one: open it in its place.
            if (replaced && paths.Count > 0) EditorSceneManager.OpenScene(paths[0], OpenSceneMode.Single);
            EditorBuildSettings.scenes = paths.Select(p => new EditorBuildSettingsScene(p, true))
                .Concat(EditorBuildSettings.scenes.Where(s => !paths.Contains(s.path))).ToArray();

            File.Delete(PendingPath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            foreach (var w in warnings) Debug.LogWarning($"SceNoCo: {w}");
            Debug.Log($"SceNoCo: imported {prefabs.Count} prefabs, {scenes.Count} scenes, {List(data["meshes"]).Count} meshes, {List(data["materials"]).Count} materials"
                + (warnings.Count > 0 ? $" — {warnings.Count} warnings above." : "."));
        }

        static void Try(Action action, string what)
        {
            try { action(); }
            catch (Exception e) { warnings.Add($"{what}: {e.Message}"); }
        }

        // --- assets ------------------------------------------------------------------------------

        static void MakeMesh(Dictionary<string, object> m)
        {
            // Filled in place through the Mesh API: CopySerialized onto an existing asset changes its data
            // but not what the GPU already holds, so the editor would keep drawing the previous import.
            var path = Str(m, "path");
            var mesh = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            var created = mesh == null;
            if (created) mesh = new Mesh();
            else mesh.Clear();
            mesh.name = Path.GetFileNameWithoutExtension(path);
            mesh.indexFormat = IndexFormat.UInt16;
            var v = Floats(m["vertices"]);
            var vertices = new Vector3[v.Length / 3];
            for (var i = 0; i < vertices.Length; i++) vertices[i] = new Vector3(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
            if (vertices.Length > 65535) mesh.indexFormat = IndexFormat.UInt32;
            mesh.vertices = vertices;
            if (m.TryGetValue("normals", out var n))
            {
                var f = Floats(n);
                mesh.normals = Enumerable.Range(0, f.Length / 3).Select(i => new Vector3(f[i * 3], f[i * 3 + 1], f[i * 3 + 2])).ToArray();
            }
            if (m.TryGetValue("uv", out var u))
            {
                var f = Floats(u);
                mesh.uv = Enumerable.Range(0, f.Length / 2).Select(i => new Vector2(f[i * 2], f[i * 2 + 1])).ToArray();
            }
            var subs = List(m["submeshes"]);
            mesh.subMeshCount = subs.Count;
            for (var i = 0; i < subs.Count; i++) mesh.SetTriangles(Floats(subs[i]).Select(x => (int)x).ToArray(), i);
            if (!m.ContainsKey("normals")) mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            if (created) SaveAsset(mesh, path);
            else EditorUtility.SetDirty(mesh);
        }

        static void MakeMaterial(Dictionary<string, object> m)
        {
            var lit = Str(m, "shader") == "lit";
            var shader = Shader.Find(lit ? "Universal Render Pipeline/Lit" : "Universal Render Pipeline/Unlit")
                ?? Shader.Find(lit ? "Standard" : "Unlit/Color");
            var path = Str(m, "path");
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            var created = mat == null;
            if (created) mat = new Material(shader);
            else mat.shader = shader;
            mat.name = Path.GetFileNameWithoutExtension(path);

            var color = Hex(Str(m, "color"));
            color.a = Num(m, "opacity", 1);
            mat.SetColor("_BaseColor", color);
            mat.color = color;
            if (lit)
            {
                mat.SetFloat("_Smoothness", Num(m, "smoothness", 0.5f));
                mat.SetFloat("_Metallic", Num(m, "metallic", 0));
            }
            if (m.ContainsKey("emission"))
            {
                // three multiplies emissive by its intensity in linear space; Unity stores colours in gamma.
                var e = (Hex(Str(m, "emission")).linear * Num(m, "emissionIntensity", 1)).gamma;
                mat.SetColor("_EmissionColor", e);
                mat.EnableKeyword("_EMISSION");
                mat.globalIlluminationFlags = MaterialGlobalIlluminationFlags.RealtimeEmissive;
            }
            else mat.DisableKeyword("_EMISSION");
            if (m.TryGetValue("texture", out var tex))
            {
                var t = AssetDatabase.LoadAssetAtPath<Texture2D>((string)tex);
                if (t != null) mat.SetTexture("_BaseMap", t);
                else warnings.Add($"{path}: texture {tex} did not import.");
            }

            mat.SetFloat("_Cull", Num(m, "cull", 2));
            var transparent = m.TryGetValue("transparent", out var tr) && (bool)tr;
            mat.SetFloat("_Surface", transparent ? 1 : 0);
            mat.SetFloat("_Blend", 0);
            mat.SetFloat("_SrcBlend", (float)(transparent ? BlendMode.SrcAlpha : BlendMode.One));
            mat.SetFloat("_DstBlend", (float)(transparent ? BlendMode.OneMinusSrcAlpha : BlendMode.Zero));
            mat.SetFloat("_SrcBlendAlpha", (float)BlendMode.One);
            mat.SetFloat("_DstBlendAlpha", (float)(transparent ? BlendMode.OneMinusSrcAlpha : BlendMode.Zero));
            mat.SetFloat("_ZWrite", transparent && !(m.TryGetValue("zWrite", out var zw) && (bool)zw) ? 0 : 1);
            mat.SetOverrideTag("RenderType", transparent ? "Transparent" : "Opaque");
            mat.renderQueue = (int)(transparent ? RenderQueue.Transparent : RenderQueue.Geometry);
            if (transparent) mat.EnableKeyword("_SURFACE_TYPE_TRANSPARENT"); else mat.DisableKeyword("_SURFACE_TYPE_TRANSPARENT");
            if (m.ContainsKey("alphaClip"))
            {
                mat.SetFloat("_AlphaClip", 1);
                mat.SetFloat("_Cutoff", Num(m, "alphaClip", 0.5f));
                mat.EnableKeyword("_ALPHATEST_ON");
            }
            if (created) SaveAsset(mat, path);
            else EditorUtility.SetDirty(mat);
        }

        static void SaveAsset(Object asset, string path)
        {
            // Only for a new asset: an existing one is edited in place, so every prefab and scene keeps pointing at it.
            Folder(Path.GetDirectoryName(path));
            AssetDatabase.CreateAsset(asset, path);
        }

        static void Folder(string path)
        {
            path = path.Replace('\\', '/');
            if (AssetDatabase.IsValidFolder(path)) return;
            var parent = Path.GetDirectoryName(path).Replace('\\', '/');
            Folder(parent);
            AssetDatabase.CreateFolder(parent, Path.GetFileName(path));
        }

        // --- prefabs and scenes ------------------------------------------------------------------

        static void SavePrefab(Dictionary<string, object> p)
        {
            var path = Str(p, "path");
            Folder(Path.GetDirectoryName(path));
            var go = Build(Obj(p["root"]), null);
            PrefabUtility.SaveAsPrefabAsset(go, path);
            Object.DestroyImmediate(go);
        }

        static void WirePrefab(Dictionary<string, object> p)
        {
            var path = Str(p, "path");
            var root = PrefabUtility.LoadPrefabContents(path);
            try
            {
                Wire(Obj(p["root"]), root, root);
                PrefabUtility.SaveAsPrefabAsset(root, path);
            }
            finally { PrefabUtility.UnloadPrefabContents(root); }
        }

        static bool replaced;

        static void SaveScene(Dictionary<string, object> s)
        {
            var path = Str(s, "path");
            Folder(Path.GetDirectoryName(path));
            // A scene of its own, beside whatever is open: nothing the user has open is touched. Unity
            // cannot add one beside an untitled scene, so an untouched untitled one is replaced instead.
            var previous = SceneManager.GetActiveScene();
            var untitled = SceneManager.sceneCount == 1 && string.IsNullOrEmpty(previous.path);
            if (untitled && previous.isDirty) throw new Exception("the open scene is untitled and has unsaved changes — save or discard it, then import again");
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, untitled ? NewSceneMode.Single : NewSceneMode.Additive);
            if (untitled) { replaced = true; previous = default; }
            SceneManager.SetActiveScene(scene);
            try
            {
                var roots = List(s["roots"]).Select(Obj).ToList();
                var built = roots.Select(r => Build(r, null)).ToList();
                // References between a scene's roots go through a holder that lists them as its children.
                var holder = new GameObject("__scenoco");
                foreach (var go in built) go.transform.SetParent(holder.transform, false);
                for (var i = 0; i < roots.Count; i++) Wire(roots[i], built[i], holder);
                foreach (var go in built) go.transform.SetParent(null, false);
                Object.DestroyImmediate(holder);

                RenderSettings.skybox = null;
                Color background = Color.black;
                var hasBackground = s.TryGetValue("background", out var bg);
                if (hasBackground) background = Hex((string)bg);
                var cameras = built.SelectMany(go => go.GetComponentsInChildren<Camera>(true)).ToList();
                foreach (var cam in cameras)
                {
                    cam.clearFlags = hasBackground ? CameraClearFlags.SolidColor : cam.clearFlags;
                    cam.backgroundColor = background;
                }
                if (cameras.Count > 0) cameras[0].gameObject.tag = "MainCamera";
                else warnings.Add($"{path}: no camera in the scene.");

                if (s.TryGetValue("fog", out var f))
                {
                    var fog = Obj(f);
                    RenderSettings.fog = true;
                    RenderSettings.fogColor = Hex(Str(fog, "color"));
                    if (Str(fog, "mode") == "linear")
                    {
                        RenderSettings.fogMode = FogMode.Linear;
                        RenderSettings.fogStartDistance = Num(fog, "start", 0);
                        RenderSettings.fogEndDistance = Num(fog, "end", 100);
                    }
                    else
                    {
                        RenderSettings.fogMode = FogMode.ExponentialSquared;
                        RenderSettings.fogDensity = Num(fog, "density", 0.01f);
                    }
                }
                else RenderSettings.fog = false;
                if (s.TryGetValue("ambient", out var a))
                {
                    var ambient = Obj(a);
                    var k = Num(ambient, "intensity", 1);
                    RenderSettings.ambientMode = AmbientMode.Trilight;
                    RenderSettings.ambientSkyColor = (Hex(Str(ambient, "sky")).linear * k).gamma;
                    RenderSettings.ambientEquatorColor = (Hex(Str(ambient, "equator")).linear * k).gamma;
                    RenderSettings.ambientGroundColor = (Hex(Str(ambient, "ground")).linear * k).gamma;
                }
                else
                {
                    // three lights nothing it was not told to.
                    RenderSettings.ambientMode = AmbientMode.Flat;
                    RenderSettings.ambientLight = Color.black;
                }
                EditorSceneManager.SaveScene(scene, path);
            }
            finally
            {
                if (previous.IsValid())
                {
                    SceneManager.SetActiveScene(previous);
                    EditorSceneManager.CloseScene(scene, true);
                }
            }
        }

        /** A node and everything under it, with its components added and not yet set. */
        static GameObject Build(Dictionary<string, object> n, Transform parent)
        {
            GameObject go;
            if (n.TryGetValue("prefab", out var prefab))
            {
                var asset = AssetDatabase.LoadAssetAtPath<GameObject>((string)prefab);
                if (asset == null) throw new Exception($"nested prefab {prefab} is missing");
                go = (GameObject)PrefabUtility.InstantiatePrefab(asset);
            }
            else go = new GameObject();
            go.name = Str(n, "name");
            go.transform.SetParent(parent, false);
            go.transform.localPosition = V3(n["position"]);
            var r = Floats(n["rotation"]);
            go.transform.localRotation = new Quaternion(r[0], r[1], r[2], r[3]);
            go.transform.localScale = V3(n["scale"]);

            if (n.TryGetValue("mesh", out var mesh))
            {
                go.AddComponent<MeshFilter>().sharedMesh = AssetDatabase.LoadAssetAtPath<Mesh>((string)mesh);
                var renderer = go.AddComponent<MeshRenderer>();
                var mats = n.TryGetValue("materials", out var ms) ? List(ms).Select(x => AssetDatabase.LoadAssetAtPath<Material>((string)x)).ToArray() : new Material[0];
                renderer.sharedMaterials = mats;
                renderer.shadowCastingMode = n.TryGetValue("castShadows", out var cs) && (bool)cs ? ShadowCastingMode.On : ShadowCastingMode.Off;
                renderer.receiveShadows = n.TryGetValue("receiveShadows", out var rs) && (bool)rs;
            }
            if (n.TryGetValue("light", out var l)) MakeLight(go, Obj(l));
            if (n.TryGetValue("camera", out var c)) MakeCamera(go, Obj(c));

            foreach (var comp in List(n["components"]).Select(Obj))
            {
                var type = Str(comp, "type");
                if ((bool)comp["game"])
                {
                    var t = GameType(type);
                    if (t == null) warnings.Add($"{Where(comp, n)}: no MonoBehaviour named {type} — it has a stub in Assets/Scripts unless a class of that name exists elsewhere.");
                    else go.AddComponent(t);
                }
                else if (!Physics.Add(go, type, Obj(comp["fields"]))) warnings.Add($"{Where(comp, n)}: {type} has no Unity counterpart here — left off.");
            }

            foreach (var child in List(n["children"]).Select(Obj)) Build(child, go.transform);
            if (n.TryGetValue("renderersEnabled", out var re) && !(bool)re)
                foreach (var rr in go.GetComponentsInChildren<Renderer>(true)) rr.enabled = false;
            if (n.TryGetValue("active", out var act) && !(bool)act) go.SetActive(false);
            return go;
        }

        /** Set the fields of a node's game components, walking the data and the built objects together. */
        static void Wire(Dictionary<string, object> n, GameObject go, GameObject root)
        {
            var games = List(n["components"]).Select(Obj).Where(c => (bool)c["game"]).ToList();
            foreach (var comp in games)
            {
                var t = GameType(Str(comp, "type"));
                var behaviour = t == null ? null : go.GetComponent(t);
                if (behaviour == null) continue;
                var so = new SerializedObject(behaviour);
                foreach (var field in Obj(comp["fields"]))
                {
                    var prop = so.FindProperty(field.Key);
                    if (prop == null)
                    {
                        warnings.Add($"{Where(comp, n)}: {t.Name} has no serialized field {field.Key} — add a public one to wire it.");
                        continue;
                    }
                    try { Set(prop, field.Value, root); }
                    catch (Exception e) { warnings.Add($"{Where(comp, n)}: {t.Name}.{field.Key}: {e.Message}"); }
                }
                so.ApplyModifiedPropertiesWithoutUndo();
            }
            Physics.WireJoints(n, go, root, warnings.Add);
            if (n.ContainsKey("prefab")) return; // a nested prefab is wired in its own asset
            var children = List(n["children"]).Select(Obj).ToList();
            for (var i = 0; i < children.Count && i < go.transform.childCount; i++) Wire(children[i], go.transform.GetChild(i).gameObject, root);
        }

        static void Set(SerializedProperty p, object v, GameObject root)
        {
            if (p.isArray && p.propertyType != SerializedPropertyType.String)
            {
                var items = v is Dictionary<string, object> d && d.TryGetValue("array", out var a) ? List(a) : new List<object>();
                p.arraySize = items.Count;
                for (var i = 0; i < items.Count; i++) Set(p.GetArrayElementAtIndex(i), items[i], root);
                return;
            }
            var o = v as Dictionary<string, object>;
            switch (p.propertyType)
            {
                case SerializedPropertyType.Float: p.floatValue = Convert.ToSingle(v, CultureInfo.InvariantCulture); return;
                case SerializedPropertyType.Integer: p.intValue = (int)Math.Round(Convert.ToDouble(v, CultureInfo.InvariantCulture)); return;
                case SerializedPropertyType.Boolean: p.boolValue = (bool)v; return;
                case SerializedPropertyType.String: p.stringValue = Convert.ToString(v, CultureInfo.InvariantCulture); return;
                case SerializedPropertyType.Enum:
                    if (v is string name)
                    {
                        var plain = new Func<string, string>(x => x.Replace("_", "").Replace("-", "").ToLowerInvariant());
                        var index = Array.FindIndex(p.enumNames, e => plain(e) == plain(name));
                        if (index < 0) throw new Exception($"'{name}' is none of {string.Join(", ", p.enumNames)}");
                        p.enumValueIndex = index;
                    }
                    else p.enumValueIndex = (int)Convert.ToDouble(v, CultureInfo.InvariantCulture);
                    return;
                case SerializedPropertyType.Vector2: { var f = Floats(o["v2"]); p.vector2Value = new Vector2(f[0], f[1]); return; }
                case SerializedPropertyType.Vector3: p.vector3Value = V3(o["v3"]); return;
                case SerializedPropertyType.Vector4: { var f = Floats(o["v4"]); p.vector4Value = new Vector4(f[0], f[1], f[2], f[3]); return; }
                case SerializedPropertyType.Quaternion: { var f = Floats(o["quat"]); p.quaternionValue = new Quaternion(f[0], f[1], f[2], f[3]); return; }
                case SerializedPropertyType.Color: p.colorValue = Hex(Str(o, "color")); return;
                case SerializedPropertyType.ObjectReference: p.objectReferenceValue = Reference(p, o, root); return;
            }
            throw new Exception($"a {p.propertyType} field is not set by the importer");
        }

        static Object Reference(SerializedProperty p, Dictionary<string, object> o, GameObject root)
        {
            if (o == null) return null;
            // "PPtr<$Transform>": what the field holds.
            var wanted = p.type.StartsWith("PPtr<$") ? p.type.Substring(6, p.type.Length - 7) : p.type;
            GameObject go = null;
            if (o.TryGetValue("asset", out var asset))
            {
                var loaded = AssetDatabase.LoadMainAssetAtPath((string)asset);
                if (!(loaded is GameObject prefab)) return loaded;
                go = prefab;
            }
            else if (o.TryGetValue("node", out var node)) go = Find(root, (string)node);
            if (go == null) throw new Exception("its target was not found");
            if (wanted == "GameObject") return go;
            if (wanted == "Transform") return go.transform;
            var component = o.TryGetValue("component", out var c) ? (string)c : wanted;
            var t = GameType(component) ?? GameType(wanted);
            return t != null ? go.GetComponent(t) : go.GetComponent(wanted);
        }

        static GameObject Find(GameObject root, string path)
        {
            var t = root.transform;
            if (path.Length == 0) return root;
            foreach (var step in path.Split('/'))
            {
                var i = int.Parse(step, CultureInfo.InvariantCulture);
                if (i >= t.childCount) return null;
                t = t.GetChild(i);
            }
            return t.gameObject;
        }

        static void MakeLight(GameObject go, Dictionary<string, object> l)
        {
            var light = go.AddComponent<Light>();
            var type = Str(l, "type");
            light.type = type == "Directional" ? LightType.Directional : type == "Spot" ? LightType.Spot : LightType.Point;
            light.color = Hex(Str(l, "color"));
            light.intensity = Num(l, "intensity", 1);
            light.shadows = l.TryGetValue("shadows", out var s) && (bool)s ? LightShadows.Soft : LightShadows.None;
            if (l.ContainsKey("range")) light.range = Num(l, "range", 10);
            if (l.ContainsKey("spotAngle")) light.spotAngle = Num(l, "spotAngle", 30);
            if (l.ContainsKey("innerSpotAngle")) light.innerSpotAngle = Num(l, "innerSpotAngle", 21);
        }

        static void MakeCamera(GameObject go, Dictionary<string, object> c)
        {
            var cam = go.AddComponent<Camera>();
            cam.orthographic = (bool)c["orthographic"];
            cam.nearClipPlane = Num(c, "near", 0.1f);
            cam.farClipPlane = Num(c, "far", 1000);
            if (cam.orthographic) cam.orthographicSize = Num(c, "size", 5);
            else cam.fieldOfView = Num(c, "fov", 60);
        }

        static readonly Dictionary<string, Type> types = new Dictionary<string, Type>();
        static Type GameType(string name)
        {
            if (types.TryGetValue(name, out var known)) return known;
            var found = AppDomain.CurrentDomain.GetAssemblies()
                .Where(a => !a.FullName.StartsWith("Unity") && !a.FullName.StartsWith("System") && !a.FullName.StartsWith("mscorlib"))
                .SelectMany(a => { try { return a.GetTypes(); } catch { return new Type[0]; } })
                .FirstOrDefault(t => t.Name == name && typeof(MonoBehaviour).IsAssignableFrom(t));
            types[name] = found;
            return found;
        }

        static string Where(Dictionary<string, object> comp, Dictionary<string, object> node) =>
            comp.TryGetValue("source", out var s) ? (string)s : node.TryGetValue("source", out var ns) ? (string)ns : Str(node, "name");

        // --- physics: SceNoCo's rapier and box2d components are Unity's own --------------------

        static class Physics
        {
            public static bool Add(GameObject go, string type, Dictionary<string, object> f)
            {
                switch (type)
                {
                    case "Rigidbody":
                    {
                        var rb = go.AddComponent<Rigidbody>();
                        rb.isKinematic = Bool(f, "isKinematic", false);
                        rb.useGravity = Bool(f, "useGravity", true);
                        rb.linearDamping = Num(f, "linearDamping", 0);
                        rb.angularDamping = Num(f, "angularDamping", 0.05f);
                        rb.freezeRotation = Bool(f, "freezeRotation", false);
                        return true;
                    }
                    case "BoxCollider":
                    {
                        var c = go.AddComponent<BoxCollider>();
                        if (f.ContainsKey("size")) { var s = V3(Obj(f["size"])["v3"]); c.size = new Vector3(Mathf.Abs(s.x), Mathf.Abs(s.y), Mathf.Abs(s.z)); }
                        if (f.ContainsKey("center")) c.center = V3(Obj(f["center"])["v3"]);
                        SetCollider3D(c, f);
                        return true;
                    }
                    case "SphereCollider":
                    {
                        var c = go.AddComponent<SphereCollider>();
                        c.radius = Num(f, "radius", 0.5f);
                        if (f.ContainsKey("center")) c.center = V3(Obj(f["center"])["v3"]);
                        SetCollider3D(c, f);
                        return true;
                    }
                    case "CapsuleCollider":
                    {
                        var c = go.AddComponent<CapsuleCollider>();
                        c.radius = Num(f, "radius", 0.5f);
                        c.height = Num(f, "height", 2);
                        if (f.ContainsKey("center")) c.center = V3(Obj(f["center"])["v3"]);
                        SetCollider3D(c, f);
                        return true;
                    }
                    case "Rigidbody2D":
                    {
                        // SceNoCo's enums carry Unity's own values.
                        var rb = go.AddComponent<Rigidbody2D>();
                        rb.bodyType = (RigidbodyType2D)(int)Num(f, "bodyType", 0);
                        rb.useAutoMass = Bool(f, "useAutoMass", false);
                        if (!rb.useAutoMass) rb.mass = Num(f, "mass", 1);
                        rb.gravityScale = Num(f, "gravityScale", 1);
                        rb.linearDamping = Num(f, "linearDamping", 0);
                        rb.angularDamping = Num(f, "angularDamping", 0.05f);
                        rb.constraints = (RigidbodyConstraints2D)(int)Num(f, "constraints", 0);
                        if (Bool(f, "freezeRotation", false)) rb.freezeRotation = true;
                        rb.collisionDetectionMode = (CollisionDetectionMode2D)(int)Num(f, "collisionDetectionMode", 0);
                        return true;
                    }
                    case "BoxCollider2D":
                    {
                        var c = go.AddComponent<BoxCollider2D>();
                        if (f.ContainsKey("size")) c.size = V2(f["size"]);
                        SetCollider2D(c, f);
                        return true;
                    }
                    case "CircleCollider2D":
                    {
                        var c = go.AddComponent<CircleCollider2D>();
                        c.radius = Num(f, "radius", 0.5f);
                        SetCollider2D(c, f);
                        return true;
                    }
                    case "CapsuleCollider2D":
                    {
                        var c = go.AddComponent<CapsuleCollider2D>();
                        if (f.ContainsKey("size")) c.size = V2(f["size"]);
                        c.direction = (CapsuleDirection2D)(int)Num(f, "direction", 0);
                        SetCollider2D(c, f);
                        return true;
                    }
                    case "PolygonCollider2D":
                    {
                        var c = go.AddComponent<PolygonCollider2D>();
                        if (f.ContainsKey("points")) c.SetPath(0, Points(f["points"]));
                        SetCollider2D(c, f);
                        return true;
                    }
                    case "EdgeCollider2D":
                    {
                        var c = go.AddComponent<EdgeCollider2D>();
                        if (f.ContainsKey("points")) c.points = Points(f["points"]);
                        SetCollider2D(c, f);
                        return true;
                    }
                    // Joints: `connectedBody` is another node's, set by `WireJoints` once every node is built.
                    case "FixedJoint2D":
                    {
                        var j = go.AddComponent<FixedJoint2D>();
                        SetAnchored(j, f, true);
                        j.frequency = Num(f, "frequency", 0);
                        j.dampingRatio = Num(f, "dampingRatio", 0);
                        return true;
                    }
                    case "HingeJoint2D":
                    {
                        var j = go.AddComponent<HingeJoint2D>();
                        SetAnchored(j, f, true);
                        j.useLimits = Bool(f, "useLimits", false);
                        if (f.ContainsKey("limits")) { var l = Fields(f["limits"]); j.limits = new JointAngleLimits2D { min = Num(l, "min", 0), max = Num(l, "max", 359) }; }
                        j.useMotor = Bool(f, "useMotor", false);
                        if (f.ContainsKey("motor")) j.motor = Motor(f["motor"]);
                        return true;
                    }
                    case "DistanceJoint2D":
                    {
                        var j = go.AddComponent<DistanceJoint2D>();
                        SetAnchored(j, f, false);
                        j.autoConfigureDistance = Bool(f, "autoConfigureDistance", true);
                        if (f.ContainsKey("distance")) j.distance = Num(f, "distance", 1);
                        j.maxDistanceOnly = Bool(f, "maxDistanceOnly", false);
                        return true;
                    }
                    case "SpringJoint2D":
                    {
                        var j = go.AddComponent<SpringJoint2D>();
                        SetAnchored(j, f, false);
                        j.autoConfigureDistance = Bool(f, "autoConfigureDistance", true);
                        if (f.ContainsKey("distance")) j.distance = Num(f, "distance", 1);
                        j.dampingRatio = Num(f, "dampingRatio", 0);
                        j.frequency = Num(f, "frequency", 1);
                        return true;
                    }
                    case "SliderJoint2D":
                    {
                        var j = go.AddComponent<SliderJoint2D>();
                        SetAnchored(j, f, true);
                        j.autoConfigureAngle = Bool(f, "autoConfigureAngle", false);
                        j.angle = Num(f, "angle", 0);
                        j.useLimits = Bool(f, "useLimits", false);
                        if (f.ContainsKey("limits")) { var l = Fields(f["limits"]); j.limits = new JointTranslationLimits2D { min = Num(l, "min", 0), max = Num(l, "max", 0) }; }
                        j.useMotor = Bool(f, "useMotor", false);
                        if (f.ContainsKey("motor")) j.motor = Motor(f["motor"]);
                        return true;
                    }
                    case "WheelJoint2D":
                    {
                        var j = go.AddComponent<WheelJoint2D>();
                        SetAnchored(j, f, true);
                        if (f.ContainsKey("suspension"))
                        {
                            var s = Fields(f["suspension"]);
                            j.suspension = new JointSuspension2D { dampingRatio = Num(s, "dampingRatio", 0.7f), frequency = Num(s, "frequency", 2), angle = Num(s, "angle", 90) };
                        }
                        j.useMotor = Bool(f, "useMotor", false);
                        if (f.ContainsKey("motor")) j.motor = Motor(f["motor"]);
                        return true;
                    }
                    case "FrictionJoint2D":
                    {
                        var j = go.AddComponent<FrictionJoint2D>();
                        SetAnchored(j, f, true);
                        j.maxForce = Num(f, "maxForce", 1);
                        j.maxTorque = Num(f, "maxTorque", 1);
                        return true;
                    }
                    case "RelativeJoint2D":
                    {
                        var j = go.AddComponent<RelativeJoint2D>();
                        SetJoint(j, f);
                        j.maxForce = Num(f, "maxForce", 10000);
                        j.maxTorque = Num(f, "maxTorque", 10000);
                        j.correctionScale = Num(f, "correctionScale", 0.3f);
                        j.autoConfigureOffset = Bool(f, "autoConfigureOffset", true);
                        if (f.ContainsKey("linearOffset")) j.linearOffset = V2(f["linearOffset"]);
                        if (f.ContainsKey("angularOffset")) j.angularOffset = Num(f, "angularOffset", 0);
                        return true;
                    }
                    case "TargetJoint2D":
                    {
                        var j = go.AddComponent<TargetJoint2D>();
                        SetJoint(j, f);
                        if (f.ContainsKey("anchor")) j.anchor = V2(f["anchor"]);
                        j.autoConfigureTarget = Bool(f, "autoConfigureTarget", true);
                        if (f.ContainsKey("target")) j.target = V2(f["target"]);
                        j.maxForce = Num(f, "maxForce", 1000);
                        j.dampingRatio = Num(f, "dampingRatio", 1);
                        j.frequency = Num(f, "frequency", 5);
                        return true;
                    }
                }
                return false;
            }

            static void SetJoint(Joint2D j, Dictionary<string, object> f)
            {
                j.enableCollision = Bool(f, "enableCollision", false);
                if (f.ContainsKey("breakForce")) j.breakForce = Num(f, "breakForce", float.PositiveInfinity);
                if (f.ContainsKey("breakTorque")) j.breakTorque = Num(f, "breakTorque", float.PositiveInfinity);
            }

            /** `autoConfigureConnectedAnchor` before `connectedAnchor`: Unity overwrites the anchor while it is on. */
            static void SetAnchored(AnchoredJoint2D j, Dictionary<string, object> f, bool autoByDefault)
            {
                SetJoint(j, f);
                if (f.ContainsKey("anchor")) j.anchor = V2(f["anchor"]);
                j.autoConfigureConnectedAnchor = Bool(f, "autoConfigureConnectedAnchor", autoByDefault);
                if (f.ContainsKey("connectedAnchor")) j.connectedAnchor = V2(f["connectedAnchor"]);
            }

            /** A settings object's fields: `{ object: { fields } }`. */
            static Dictionary<string, object> Fields(object v) => Obj(Obj(Obj(v)["object"])["fields"]);

            static JointMotor2D Motor(object v)
            {
                var m = Fields(v);
                return new JointMotor2D { motorSpeed = Num(m, "motorSpeed", 0), maxMotorTorque = Num(m, "maxMotorTorque", 10000) };
            }

            /** Each joint's `connectedBody`: the Rigidbody2D on the node it names, joints matched by type in order. */
            public static void WireJoints(Dictionary<string, object> n, GameObject go, GameObject root, Action<string> warn)
            {
                var seen = new Dictionary<string, int>();
                foreach (var comp in List(n["components"]).Select(Obj).Where(c => !(bool)c["game"]))
                {
                    var type = Str(comp, "type");
                    var t = typeof(Joint2D).Assembly.GetType("UnityEngine." + type);
                    if (t == null || !typeof(Joint2D).IsAssignableFrom(t)) continue;
                    seen[type] = seen.TryGetValue(type, out var i) ? i + 1 : 0;
                    if (!Obj(comp["fields"]).TryGetValue("connectedBody", out var link) || !(link is Dictionary<string, object> l) || !l.TryGetValue("node", out var path)) continue;
                    var joint = (Joint2D)go.GetComponents(t)[seen[type]];
                    var target = Find(root, (string)path);
                    joint.connectedBody = target != null ? target.GetComponent<Rigidbody2D>() : null;
                    if (joint.connectedBody == null) warn($"{type} on {go.name}: its connectedBody was not found");
                }
            }

            static void SetCollider3D(Collider c, Dictionary<string, object> f)
            {
                c.isTrigger = Bool(f, "isTrigger", false);
                if (!f.ContainsKey("friction") && !f.ContainsKey("bounciness")) return;
                var friction = Num(f, "friction", 0.5f);
                var bounce = Num(f, "bounciness", 0);
                var path = $"Assets/Materials/Physics/Friction{friction:0.##}_Bounce{bounce:0.##}.asset".Replace(',', '.');
                var m = AssetDatabase.LoadAssetAtPath<PhysicsMaterial>(path);
                if (m == null)
                {
                    m = new PhysicsMaterial { dynamicFriction = friction, staticFriction = friction, bounciness = bounce };
                    Folder(Path.GetDirectoryName(path));
                    AssetDatabase.CreateAsset(m, path);
                }
                c.sharedMaterial = m;
            }

            static void SetCollider2D(Collider2D c, Dictionary<string, object> f)
            {
                c.isTrigger = Bool(f, "isTrigger", false);
                if (f.ContainsKey("offset")) c.offset = V2(f["offset"]);
                if (f.ContainsKey("density")) c.density = Num(f, "density", 1);
                // A shared PhysicsMaterial2D, or the collider's own friction and bounciness: one asset per pair.
                var surface = f.TryGetValue("material", out var mv) && mv is Dictionary<string, object> mo && mo.TryGetValue("object", out var ov)
                    ? Obj(Obj(ov)["fields"])
                    : f;
                if (!surface.ContainsKey("friction") && !surface.ContainsKey("bounciness")) return;
                var friction = Num(surface, "friction", 0.4f);
                var bounce = Num(surface, "bounciness", 0);
                var path = $"Assets/Materials/Physics/Friction{friction:0.##}_Bounce{bounce:0.##}_2D.asset".Replace(',', '.');
                var m = AssetDatabase.LoadAssetAtPath<PhysicsMaterial2D>(path);
                if (m == null)
                {
                    m = new PhysicsMaterial2D { friction = friction, bounciness = bounce };
                    Folder(Path.GetDirectoryName(path));
                    AssetDatabase.CreateAsset(m, path);
                }
                c.sharedMaterial = m;
            }

            static Vector2 V2(object v)
            {
                var p = Floats(Obj(v)["v2"]);
                return new Vector2(p[0], p[1]);
            }

            static Vector2[] Points(object v) =>
                List(Obj(v)["array"]).Select(p => Floats(Obj(p)["v2"])).Select(p => new Vector2(p[0], p[1])).ToArray();
        }

        // --- data ----------------------------------------------------------------------------------

        static Dictionary<string, object> Obj(object v) => (Dictionary<string, object>)v;
        static List<object> List(object v) => (List<object>)v;
        static string Str(Dictionary<string, object> d, string key) => d.TryGetValue(key, out var v) ? (string)v : "";
        static float Num(Dictionary<string, object> d, string key, float fallback) =>
            d.TryGetValue(key, out var v) && v != null ? Convert.ToSingle(v, CultureInfo.InvariantCulture) : fallback;
        static bool Bool(Dictionary<string, object> d, string key, bool fallback) => d.TryGetValue(key, out var v) && v is bool b ? b : fallback;
        static float[] Floats(object v) => List(v).Select(x => Convert.ToSingle(x, CultureInfo.InvariantCulture)).ToArray();
        static Vector3 V3(object v) { var f = Floats(v); return new Vector3(f[0], f[1], f[2]); }
        static Color Hex(string hex) => ColorUtility.TryParseHtmlString(hex, out var c) ? c : Color.magenta;

        /** The few JSON shapes the export writes: objects, arrays, numbers, strings, booleans and null. */
        static class Json
        {
            public static object Parse(string text)
            {
                var i = 0;
                var value = Read(text, ref i);
                return value;
            }

            static object Read(string s, ref int i)
            {
                Skip(s, ref i);
                switch (s[i])
                {
                    case '{':
                    {
                        var d = new Dictionary<string, object>();
                        i++;
                        Skip(s, ref i);
                        if (s[i] == '}') { i++; return d; }
                        while (true)
                        {
                            Skip(s, ref i);
                            var key = ReadString(s, ref i);
                            Skip(s, ref i);
                            i++; // :
                            d[key] = Read(s, ref i);
                            Skip(s, ref i);
                            if (s[i++] == '}') return d;
                        }
                    }
                    case '[':
                    {
                        var l = new List<object>();
                        i++;
                        Skip(s, ref i);
                        if (s[i] == ']') { i++; return l; }
                        while (true)
                        {
                            l.Add(Read(s, ref i));
                            Skip(s, ref i);
                            if (s[i++] == ']') return l;
                        }
                    }
                    case '"': return ReadString(s, ref i);
                    case 't': i += 4; return true;
                    case 'f': i += 5; return false;
                    case 'n': i += 4; return null;
                    default:
                    {
                        var start = i;
                        while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
                        return double.Parse(s.Substring(start, i - start), CultureInfo.InvariantCulture);
                    }
                }
            }

            static string ReadString(string s, ref int i)
            {
                var sb = new StringBuilder();
                i++; // "
                while (s[i] != '"')
                {
                    var c = s[i++];
                    if (c != '\\') { sb.Append(c); continue; }
                    var e = s[i++];
                    switch (e)
                    {
                        case 'n': sb.Append('\n'); break;
                        case 't': sb.Append('\t'); break;
                        case 'r': sb.Append('\r'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'u': sb.Append((char)Convert.ToInt32(s.Substring(i, 4), 16)); i += 4; break;
                        default: sb.Append(e); break;
                    }
                }
                i++;
                return sb.ToString();
            }

            static void Skip(string s, ref int i)
            {
                while (i < s.Length && char.IsWhiteSpace(s[i])) i++;
            }
        }
    }
}
