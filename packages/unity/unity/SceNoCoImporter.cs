// Written by scenoco-unity on every export — edits here are overwritten.
//
// Makes what Assets/SceNoCo/export.json describes and the game's scenes and prefabs name: meshes,
// materials, terrains, physics and particle materials, post-processing profiles, UI panels, and the
// project's settings — with Unity's own API, updating each asset in place so references to it hold.
// Then the scenes and prefabs themselves: their text (.uscene, .uprefab) goes beside where they
// belong, and Scenoco (com.roro.scenoco) builds each .unity and .prefab from it — on a later export,
// changes only what changed. What the text has no place for, a scene's lighting, is set on the scene
// after. It runs by itself after the export's scripts compile, or from SceNoCo ▸ Import.
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
using UnityEngine.UIElements;
using Object = UnityEngine.Object;

namespace SceNoCo
{
    [InitializeOnLoad]
    public static class Importer
    {
        const string DataPath = "Assets/SceNoCo/export.json";
        /// <summary>Written once the recommended rendering settings are set: later imports leave them to the port.</summary>
        const string RecommendedPath = "ProjectSettings/SceNoCoRecommended.txt";
        const string PendingPath = "Assets/SceNoCo/.pending";
        /// <summary>Where the export leaves the scenes' and prefabs' text: Unity imports nothing in a folder ending in ~.</summary>
        const string Staged = "Assets/SceNoCo/Twins~";
        // Each twin as the last import left it, after Scenoco wrote it: what tells a port's edit from an export.
        const string Placed = "Assets/SceNoCo/Placed~";

        static Importer()
        {
            // Once the Editor has settled — compiled, imported, not playing — and only for a fresh export.
            EditorApplication.update += WhenSettled;
        }

        static double nextLook;

        // Watched for as long as the Editor runs, not once after a reload: an export that changes no code
        // reloads nothing, and its .pending would wait unread. A look a second costs one file check.
        static void WhenSettled()
        {
            if (EditorApplication.timeSinceStartup < nextLook) return;
            nextLook = EditorApplication.timeSinceStartup + 1;
            if (EditorApplication.isCompiling || EditorApplication.isUpdating || EditorApplication.isPlayingOrWillChangePlaymode) return;
            if (!File.Exists(PendingPath)) return;
            try { Import(); }
            catch (Exception error)
            {
                // Once, not every second: the export stays where it is for SceNoCo ▸ Import.
                File.Delete(PendingPath);
                Debug.LogException(error);
                Debug.LogError("SceNoCo: the import stopped (above). Fix it, then SceNoCo ▸ Import.");
            }
        }

        static readonly List<string> warnings = new List<string>();
        /// <summary>What the last import could not carry across, each with where it was written.</summary>
        public static IReadOnlyList<string> Warnings => warnings;

        [MenuItem("SceNoCo/Import")]
        public static void Import()
        {
            if (!File.Exists(DataPath))
            {
                Debug.LogError($"SceNoCo: no {DataPath} — run scenoco-unity first.");
                if (File.Exists(PendingPath)) File.Delete(PendingPath);
                return;
            }
            warnings.Clear();
            AssetDatabase.Refresh();
            var data = (Dictionary<string, object>)Json.Parse(File.ReadAllText(DataPath));
            foreach (var w in List(data["warnings"])) warnings.Add((string)w);
            // The rendering settings are a starting point, set by the first import only: a port that changes
            // one — a game lit in gamma — keeps its choice through every export after.
            if (!File.Exists(RecommendedPath))
            {
                Try(Project.Recommended, "rendering settings");
                File.WriteAllText(RecommendedPath, "SceNoCo set this project's rendering settings once. Delete this file to set them again on the next import.\n");
            }
            if (data.TryGetValue("layers", out var layers)) Try(() => Project.Layers(Obj(layers)), "layers");
            if (data.TryGetValue("input", out var input)) Try(() => Project.Input((string)input), "input actions");

            // The assets the text names, before the text is built.
            var rerooted = false;
            Try(() => rerooted = ModelRoots(), "the models' import settings");
            if (data.TryGetValue("dataTextures", out var stamps))
                foreach (var t in List(stamps)) Try(() => DataTexture((string)t), (string)t);
            if (data.TryGetValue("modelVariants", out var variants))
                foreach (var v in List(variants)) Try(() => ModelVariant(Obj(v)), Str(Obj(v), "path"));
            foreach (var m in List(data["meshes"])) Try(() => MakeMesh(Obj(m)), Str(Obj(m), "path"));
            foreach (var t in List(data["terrains"])) Try(() => MakeTerrain(Obj(t)), Str(Obj(t), "path"));
            if (data.TryGetValue("terrainMaterial", out var tm)) Try(() => TerrainMaterial((string)tm), (string)tm);
            foreach (var m in List(data["materials"])) Try(() => MakeMaterial(Obj(m)), Str(Obj(m), "path"));
            foreach (var m in List(data["physicsMaterials"])) Try(() => PhysicsMaterial(Obj(m)), Str(Obj(m), "path"));
            foreach (var b in List(data["particleMaterials"])) Try(() => ParticleMaterial((string)b), $"Particles-{b}");
            foreach (var v in List(data["volumes"])) Try(() => Volumes.Make(Obj(v)), Str(Obj(v), "path"));
            var theme = data.TryGetValue("theme", out var th) ? (string)th : null;
            foreach (var p in List(data["panels"])) Try(() => MakePanel(Obj(p), theme), Str(Obj(p), "path"));
            AssetDatabase.SaveAssets();

            // The scenes and prefabs: their text in place, built by Scenoco.
            // A twin the port edited since the last import is the port's: kept, with the export beside it to merge.
            var twins = List(data["twins"]).Select(t => (string)t).ToList();
            var kept = new HashSet<string>();
            foreach (var twin in twins)
                Try(() =>
                {
                    var rel = twin.Substring("Assets/".Length);
                    var placed = Path.Combine(Placed, rel);
                    if (File.Exists(twin) && File.Exists(placed) && Text(twin) != Text(placed))
                    {
                        kept.Add(twin);
                        warnings.Add($"{twin}: edited since the last export — kept. This export's is {Path.Combine(Staged, rel)}: merge what it changes by hand, or delete {placed} and import again to take it whole.");
                        return;
                    }
                    Directory.CreateDirectory(Path.GetDirectoryName(twin));
                    File.Copy(Path.Combine(Staged, rel), twin, true);
                }, twin);
            AssetDatabase.Refresh();
            var status = Scenoco.Files.Sync();
            foreach (var line in status.Split('\n'))
                if (twins.Any(t => line.StartsWith(t + ":")) && !line.Contains(": Synced")) warnings.Add(line);
            foreach (var twin in twins.Where(t => !kept.Contains(t) && File.Exists(t)))
                Try(() =>
                {
                    var placed = Path.Combine(Placed, twin.Substring("Assets/".Length));
                    Directory.CreateDirectory(Path.GetDirectoryName(placed));
                    File.Copy(twin, placed, true);
                }, twin);

            var scenes = List(data["scenes"]).Select(Obj).ToList();
            foreach (var s in scenes) Try(() => Lighting(s), Str(s, "path"));
            var paths = scenes.Select(s => Str(s, "path")).Where(File.Exists).ToList();
            EditorBuildSettings.scenes = paths.Select(p => new EditorBuildSettingsScene(p, true))
                .Concat(EditorBuildSettings.scenes.Where(s => !paths.Contains(s.path))).ToArray();
            Try(Skill, "the unity-game skill");

            File.Delete(PendingPath);
            // A model given its root just now: the prefabs placing it re-import after this pass, losing their
            // overrides on the old root. Once they have, a second pass builds the text into them again.
            if (rerooted) File.WriteAllText(PendingPath, "models re-rooted");
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            foreach (var w in warnings) Debug.LogWarning($"SceNoCo: {w}");
            Debug.Log($"SceNoCo: imported {twins.Count(t => t.EndsWith(".uprefab"))} prefabs, {scenes.Count} scenes, {List(data["meshes"]).Count} meshes, {List(data["materials"]).Count} materials"
                + (warnings.Count > 0 ? $" — {warnings.Count} warnings above." : "."));
        }

        /// <summary>
        /// Every model glTFast imports gets a root of its own, as three.js's loader gives it a scene: by
        /// default glTFast makes a lone node the root, and a placement's Transform then replaces that
        /// node's own (a quantized model's decoding scale) where three keeps both.
        /// </summary>
        static bool ModelRoots()
        {
            var changed = false;
            if (!AssetDatabase.IsValidFolder("Assets/Models")) return false;
            foreach (var guid in AssetDatabase.FindAssets("", new[] { "Assets/Models" }))
            {
                var path = AssetDatabase.GUIDToAssetPath(guid);
                if (!path.EndsWith(".glb") && !path.EndsWith(".gltf")) continue;
                var importer = AssetImporter.GetAtPath(path);
                if (importer == null) continue;
                var settings = new SerializedObject(importer);
                // glTFast's SceneObjectCreation: Never 0, Always 1, WhenMultipleRootNodes 2.
                var creation = settings.FindProperty("instantiationSettings.sceneObjectCreation");
                if (creation == null || creation.intValue == 1) continue;
                creation.intValue = 1;
                settings.ApplyModifiedPropertiesWithoutUndo();
                importer.SaveAndReimport();
                changed = true;
            }
            return changed;
        }

        /// <summary>
        /// An image a behaviour reads as data — a height stamp, a map — imported pixel for pixel, as the
        /// browser decodes it: readable, uncompressed, no mipmaps, and never resized to a power of two.
        /// </summary>
        static void DataTexture(string path)
        {
            if (!(AssetImporter.GetAtPath(path) is TextureImporter importer)) return;
            if (importer.isReadable && importer.npotScale == TextureImporterNPOTScale.None && !importer.mipmapEnabled
                && importer.textureCompression == TextureImporterCompression.Uncompressed) return;
            importer.isReadable = true;
            importer.npotScale = TextureImporterNPOTScale.None;
            importer.mipmapEnabled = false;
            importer.textureCompression = TextureImporterCompression.Uncompressed;
            importer.SaveAndReimport();
        }

        /// <summary>
        /// A model whose every copy draws otherwise than Unity's defaults — <c>sharedModel(url, { castShadow: false })</c> —
        /// as a prefab variant of its file with its renderers set. Placements and fields name the variant.
        /// </summary>
        static void ModelVariant(Dictionary<string, object> v)
        {
            var path = Str(v, "path");
            var model = AssetDatabase.LoadAssetAtPath<GameObject>(Str(v, "model"));
            if (model == null)
            {
                warnings.Add($"{path}: its model {Str(v, "model")} did not import — placements of it are empty.");
                return;
            }
            var copy = (GameObject)PrefabUtility.InstantiatePrefab(model);
            try
            {
                foreach (var r in copy.GetComponentsInChildren<Renderer>(true))
                {
                    r.shadowCastingMode = (bool)v["castShadow"] ? ShadowCastingMode.On : ShadowCastingMode.Off;
                    r.receiveShadows = (bool)v["receiveShadow"];
                }
                // Over an existing variant, in place: its GUID, and so every reference to it, stays.
                PrefabUtility.SaveAsPrefabAsset(copy, path);
            }
            finally { Object.DestroyImmediate(copy); }
        }

        // A file's text with its line endings made one: a checkout may have changed them, not the port.
        static string Text(string path) => File.ReadAllText(path).Replace("\r\n", "\n");

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
            if (m.TryGetValue("colors", out var c))
            {
                var f = Floats(c);
                mesh.colors = Enumerable.Range(0, f.Length / 4).Select(i => new Color(f[i * 4], f[i * 4 + 1], f[i * 4 + 2], f[i * 4 + 3])).ToArray();
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
            // Vertex colours: URP's Particles shaders multiply by them (Color Mode Multiply), lit or not; Lit and Unlit ignore them.
            var colours = m.TryGetValue("vertexColors", out var vc) && (bool)vc;
            var shader = Shader.Find(colours
                    ? (lit ? "Universal Render Pipeline/Particles/Lit" : "Universal Render Pipeline/Particles/Unlit")
                    : (lit ? "Universal Render Pipeline/Lit" : "Universal Render Pipeline/Unlit"))
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
            if (m.TryGetValue("emissionTexture", out var etex))
            {
                var t = AssetDatabase.LoadAssetAtPath<Texture2D>((string)etex);
                if (t != null) mat.SetTexture("_EmissionMap", t);
                else warnings.Add($"{path}: emission texture {etex} did not import.");
            }
            if (m.TryGetValue("tiling", out var tiling))
            {
                var f = Floats(tiling);
                mat.SetTextureScale("_BaseMap", new Vector2(f[0], f[1]));
                mat.SetTextureScale("_EmissionMap", new Vector2(f[0], f[1]));
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


        /// <summary>A terrain's heights and colour layers, in place: the layers live inside the data's asset, each with a one-pixel texture of its colour.</summary>
        static void MakeTerrain(Dictionary<string, object> t)
        {
            var path = Str(t, "path");
            var data = AssetDatabase.LoadAssetAtPath<TerrainData>(path);
            var created = data == null;
            if (created) data = new TerrainData();
            var n = (int)Num(t, "heightmapResolution", 33);
            data.heightmapResolution = n;
            data.size = V3(t["size"]);
            var flat = Floats(t["heights"]);
            var heights = new float[n, n];
            for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) heights[y, x] = flat[y * n + x];
            data.SetHeights(0, 0, heights);
            if (created) SaveAsset(data, path);
            // Only what an earlier import added: Unity keeps the splat maps in this asset too, and
            // SetAlphamaps fails ("splatdatabase alphamap 0 is null") once they are gone.
            foreach (var old in AssetDatabase.LoadAllAssetRepresentationsAtPath(path))
                if (old is TerrainLayer || (old is Texture2D added && added.name.EndsWith(" colour"))) Object.DestroyImmediate(old, true);
            var layers = List(t["layers"]).Select(Obj).Select(spec =>
            {
                // The layer's own texture, copied in by the export; else its colour, as a one-pixel texture.
                var texture = spec.ContainsKey("texture") ? AssetDatabase.LoadAssetAtPath<Texture2D>(Str(spec, "texture")) : null;
                if (texture == null)
                {
                    if (spec.ContainsKey("texture")) warnings.Add($"{path}: layer texture {Str(spec, "texture")} did not import — the layer is its colour.");
                    texture = new Texture2D(1, 1) { name = Str(spec, "name") + " colour" };
                    texture.SetPixel(0, 0, Hex(Str(spec, "color")));
                    texture.Apply();
                    AssetDatabase.AddObjectToAsset(texture, data);
                }
                var tile = Num(spec, "tileSize", 10);
                var layer = new TerrainLayer { name = Str(spec, "name"), diffuseTexture = texture, tileSize = new Vector2(tile, tile) };
                if (spec.ContainsKey("normalMap")) layer.normalMapTexture = NormalMap(Str(spec, "normalMap"));
                AssetDatabase.AddObjectToAsset(layer, data);
                return layer;
            }).ToArray();
            data.terrainLayers = layers;
            if (layers.Length > 0)
            {
                var a = (int)Num(t, "alphamapResolution", 16);
                data.alphamapResolution = a;
                var w = Floats(t["alphamaps"]);
                var maps = new float[a, a, layers.Length];
                for (var y = 0; y < a; y++) for (var x = 0; x < a; x++) for (var l = 0; l < layers.Length; l++) maps[y, x, l] = w[(y * a + x) * layers.Length + l];
                data.SetAlphamaps(0, 0, maps);
            }
            EditorUtility.SetDirty(data);
        }

        /// <summary>A texture imported as a normal map: Unity reads one only when its importer says so.</summary>
        static Texture2D NormalMap(string path)
        {
            if (AssetImporter.GetAtPath(path) is TextureImporter importer && importer.textureType != TextureImporterType.NormalMap)
            {
                importer.textureType = TextureImporterType.NormalMap;
                importer.SaveAndReimport();
            }
            var texture = AssetDatabase.LoadAssetAtPath<Texture2D>(path);
            if (texture == null) warnings.Add($"{path}: the normal map did not import.");
            return texture;
        }

        /// <summary>URP's terrain material, one for the project: a terrain with none draws pink there.</summary>
        static void TerrainMaterial(string path)
        {
            if (AssetDatabase.LoadAssetAtPath<Material>(path) != null) return;
            var shader = Shader.Find("Universal Render Pipeline/Terrain/Lit") ?? Shader.Find("Nature/Terrain/Standard");
            SaveAsset(new Material(shader), path);
        }

        /// <summary>A collider's friction and bounciness: one PhysicsMaterial (or 2D) per pair.</summary>
        static void PhysicsMaterial(Dictionary<string, object> m)
        {
            var path = Str(m, "path");
            float friction = Num(m, "friction", 0.5f), bounce = Num(m, "bounciness", 0);
            if (Num(m, "dimensions", 3) == 2)
            {
                var two = AssetDatabase.LoadAssetAtPath<PhysicsMaterial2D>(path);
                if (two == null) SaveAsset(two = new PhysicsMaterial2D(), path);
                two.friction = friction;
                two.bounciness = bounce;
                EditorUtility.SetDirty(two);
                return;
            }
            var three = AssetDatabase.LoadAssetAtPath<PhysicsMaterial>(path);
            if (three == null) SaveAsset(three = new PhysicsMaterial(), path);
            three.dynamicFriction = three.staticFriction = friction;
            three.bounciness = bounce;
            EditorUtility.SetDirty(three);
        }

        /// <summary>One particle material per blending, shared by every system: URP's particle shader, Unity's soft round sprite.</summary>
        static void ParticleMaterial(string blending)
        {
            var path = $"Assets/Materials/Particles-{blending}.mat";
            if (AssetDatabase.LoadAssetAtPath<Material>(path) != null) return;
            var shader = Shader.Find("Universal Render Pipeline/Particles/Unlit") ?? Shader.Find("Particles/Standard Unlit");
            var mat = new Material(shader);
            mat.SetTexture("_BaseMap", AssetDatabase.GetBuiltinExtraResource<Texture2D>("Default-Particle.psd"));
            mat.SetFloat("_Surface", 1);
            mat.SetFloat("_Blend", blending == "Additive" ? 2 : 0);
            mat.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            mat.SetFloat("_DstBlend", (float)(blending == "Additive" ? BlendMode.One : BlendMode.OneMinusSrcAlpha));
            mat.SetFloat("_ZWrite", 0);
            mat.SetOverrideTag("RenderType", "Transparent");
            mat.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
            mat.renderQueue = (int)RenderQueue.Transparent;
            SaveAsset(mat, path);
        }

        /// <summary>Panel Settings for a UIDocument's element, scaling as core's UIDocument does.</summary>
        static void MakePanel(Dictionary<string, object> p, string theme)
        {
            var path = Str(p, "path");
            var panel = AssetDatabase.LoadAssetAtPath<PanelSettings>(path);
            if (panel == null) SaveAsset(panel = ScriptableObject.CreateInstance<PanelSettings>(), path);
            if (theme != null) panel.themeStyleSheet = AssetDatabase.LoadAssetAtPath<ThemeStyleSheet>(theme);
            panel.scaleMode = PanelScaleMode.ScaleWithScreenSize;
            panel.screenMatchMode = PanelScreenMatchMode.MatchWidthOrHeight;
            var size = Floats(p["referenceResolution"]);
            panel.referenceResolution = new Vector2Int(Mathf.RoundToInt(size[0]), Mathf.RoundToInt(size[1]));
            panel.match = Num(p, "match", 0.5f);
            panel.sortingOrder = Num(p, "sortingOrder", 0);
            EditorUtility.SetDirty(panel);
        }

        // --- scenes: what their text has no place for ------------------------------------------------

        /// <summary>
        /// A scene's fog, ambient light and reflections, which a scene keeps outside its objects: set on the scene
        /// Scenoco built, opened beside whatever is open, saved and closed again.
        /// </summary>
        static void Lighting(Dictionary<string, object> s)
        {
            var path = Str(s, "path");
            if (!File.Exists(path)) return;                                       // Scenoco's status says why
            var scene = SceneManager.GetSceneByPath(path);
            var open = scene.IsValid() && scene.isLoaded;
            if (open && scene.isDirty) throw new Exception("its lighting was not set: it is open with unsaved changes — save or discard them, then import again");
            if (!open) scene = EditorSceneManager.OpenScene(path, OpenSceneMode.Additive);
            var active = SceneManager.GetActiveScene();
            SceneManager.SetActiveScene(scene);
            try
            {
                RenderSettings.skybox = null;
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
                // three lights a surface with no environment by nothing but its lights: no skybox reflections either.
                RenderSettings.defaultReflectionMode = DefaultReflectionMode.Custom;
                RenderSettings.customReflectionTexture = null;
                RenderSettings.reflectionIntensity = 0;
                EditorSceneManager.SaveScene(scene);
            }
            finally
            {
                if (active.IsValid() && active != scene) SceneManager.SetActiveScene(active);
                if (!open && SceneManager.sceneCount > 1) EditorSceneManager.CloseScene(scene, true);
            }
        }

        /// <summary>Diceload's skill, for the agent porting the game: copied into the project's .claude/skills once.</summary>
        static void Skill()
        {
            const string to = ".claude/skills/unity-game";
            if (Directory.Exists(to)) return;
            var package = UnityEditor.PackageManager.PackageInfo.FindForPackageName("com.roro.diceload");
            var from = package == null ? null : Path.Combine(package.resolvedPath, "Skills~/unity-game");
            if (from == null || !Directory.Exists(from)) throw new Exception("com.roro.diceload is not in the project — add it to Packages/manifest.json");
            Directory.CreateDirectory(to);
            foreach (var file in Directory.GetFiles(from)) File.Copy(file, Path.Combine(to, Path.GetFileName(file)));
        }

        /// <summary>A game's post effects as a URP Volume profile. By type name and serialized field, so a project without URP still compiles this.</summary>
        static class Volumes
        {
            const string Rendering = "UnityEngine.Rendering.{0}, Unity.RenderPipelines.Core.Runtime";
            const string Universal = "UnityEngine.Rendering.Universal.{0}, Unity.RenderPipelines.Universal.Runtime";

            public static void Make(Dictionary<string, object> v)
            {
                var path = Str(v, "path");
                var profileType = Type.GetType(string.Format(Rendering, "VolumeProfile")) ?? throw new Exception("URP is not in this project");
                // Made anew each time: its effects are objects of their own in the profile's file.
                var existing = AssetDatabase.LoadMainAssetAtPath(path);
                ScriptableObject profile;
                if (existing != null && existing.GetType() == profileType)
                {
                    profile = (ScriptableObject)existing;
                    foreach (var old in AssetDatabase.LoadAllAssetRepresentationsAtPath(path)) Object.DestroyImmediate(old, true);
                    var list = new SerializedObject(profile);
                    list.FindProperty("components").ClearArray();
                    list.ApplyModifiedPropertiesWithoutUndo();
                }
                else SaveAsset(profile = ScriptableObject.CreateInstance(profileType), path);
                foreach (var e in List(v["effects"]).Select(Obj)) Effect(profile, Str(e, "type"), Obj(e["fields"]));
                EditorUtility.SetDirty(profile);
            }

            static void Effect(ScriptableObject profile, string type, Dictionary<string, object> f)
            {
                var effect = Type.GetType(string.Format(Universal, type));
                if (effect == null) { warnings.Add($"{type}: not a URP effect here — left out of the Volume."); return; }
                var added = (ScriptableObject)profile.GetType().GetMethod("Add", new[] { typeof(Type), typeof(bool) }).Invoke(profile, new object[] { effect, false });
                var o = new SerializedObject(added);
                void Float(string name, float value) => Set(o, name, p => p.floatValue = value);
                void Tint(string name, string field, string fallback) => Set(o, name, p => p.colorValue = f.TryGetValue(field, out var c) ? Hex((string)Obj(c)["color"]) : Hex(fallback));
                switch (type)
                {
                    case "Bloom":
                        Float("threshold", Num(f, "threshold", 0.9f));
                        Float("intensity", Num(f, "intensity", 1));
                        Float("scatter", Num(f, "scatter", 0.7f));
                        Tint("tint", "tint", "#ffffff");
                        break;
                    case "Tonemapping":
                        var mode = f.TryGetValue("mode", out var m) ? (string)m : "ACES";
                        Set(o, "mode", p => p.enumValueIndex = mode == "ACES" ? 2 : mode == "Neutral" ? 1 : 0);
                        break;
                    case "ColorAdjustments":
                        Float("postExposure", Num(f, "postExposure", 0));
                        Float("contrast", Num(f, "contrast", 0));
                        Float("hueShift", Num(f, "hueShift", 0));
                        Float("saturation", Num(f, "saturation", 0));
                        Tint("colorFilter", "colorFilter", "#ffffff");
                        break;
                    case "Vignette":
                        Float("intensity", Num(f, "intensity", 0.3f));
                        Float("smoothness", Num(f, "smoothness", 0.2f));
                        Tint("color", "color", "#000000");
                        if (f.TryGetValue("center", out var c))
                        {
                            var at = Floats(Obj(c)["v2"]);
                            Set(o, "center", p => p.vector2Value = new Vector2(at[0], at[1]));
                        }
                        break;
                    case "DepthOfField":
                        Set(o, "mode", p => p.enumValueIndex = 2); // Bokeh
                        Float("focusDistance", Num(f, "focusDistance", 10));
                        Float("focalLength", Num(f, "focalLength", 50));
                        Float("aperture", Num(f, "aperture", 5.6f));
                        break;
                    default:
                        Float("intensity", Num(f, "intensity", 0.3f));
                        break;
                }
                o.ApplyModifiedPropertiesWithoutUndo();
                // Each is an object of its own in the profile's file, and its list is lost at save unless marked.
                AssetDatabase.AddObjectToAsset(added, profile);
                EditorUtility.SetDirty(added);
            }

            static void Set(SerializedObject o, string name, Action<SerializedProperty> value)
            {
                var parameter = o.FindProperty(name);
                parameter.FindPropertyRelative("m_OverrideState").boolValue = true;
                value(parameter.FindPropertyRelative("m_Value"));
            }
        }

        /// <summary>The project's own settings: what a three.js game draws and reads like, in Unity 6.</summary>
        static class Project
        {
            /// <summary>
            /// three.js renders in linear space to an sRGB canvas, with no tone mapping, no antialiasing (SceNoCo's
            /// default), no light limit per object and no environment: Linear colour space, HDR kept for a bloom a
            /// game adds, MSAA off, render scale 1, Forward+, soft shadows. Applied to every URP asset in the
            /// project, through their serialized fields, so a project without URP still compiles this.
            /// </summary>
            public static void Recommended()
            {
                PlayerSettings.colorSpace = ColorSpace.Linear;
                foreach (var guid in AssetDatabase.FindAssets("t:UniversalRenderPipelineAsset"))
                {
                    var asset = AssetDatabase.LoadMainAssetAtPath(AssetDatabase.GUIDToAssetPath(guid));
                    var so = new SerializedObject(asset);
                    Set(so, "m_SupportsHDR", p => p.boolValue = true);
                    Set(so, "m_MSAA", p => p.intValue = 1);
                    Set(so, "m_RenderScale", p => p.floatValue = 1);
                    Set(so, "m_SoftShadowsSupported", p => p.boolValue = true);
                    so.ApplyModifiedPropertiesWithoutUndo();
                }
                foreach (var guid in AssetDatabase.FindAssets("t:UniversalRendererData"))
                {
                    var so = new SerializedObject(AssetDatabase.LoadMainAssetAtPath(AssetDatabase.GUIDToAssetPath(guid)));
                    // Forward+: no cap of eight lights per object — three has none.
                    Set(so, "m_RenderingMode", p => p.intValue = 2);
                    so.ApplyModifiedPropertiesWithoutUndo();
                }
            }

            static void Set(SerializedObject so, string name, Action<SerializedProperty> set)
            {
                var p = so.FindProperty(name);
                if (p != null) set(p);
            }

            /// <summary>The game's layers by name, and the pairs its physics lets pass through each other.</summary>
            public static void Layers(Dictionary<string, object> l)
            {
                var tags = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/TagManager.asset")[0]);
                var names = tags.FindProperty("layers");
                foreach (var pair in Obj(l["names"]))
                {
                    var index = int.Parse(pair.Key, CultureInfo.InvariantCulture);
                    var current = names.GetArrayElementAtIndex(index).stringValue;
                    if (string.IsNullOrEmpty(current) || current.StartsWith("Layer ")) names.GetArrayElementAtIndex(index).stringValue = (string)pair.Value;
                    else if (current != (string)pair.Value) warnings.Add($"layers: Unity layer {index} is \"{current}\" already — the game's {pair.Value} shares it.");
                }
                tags.ApplyModifiedPropertiesWithoutUndo();
                Matrix("ProjectSettings/Physics2DSettings.asset", List(l["ignore2D"]).Select(Floats));
                Matrix("ProjectSettings/DynamicsManager.asset", List(l["ignore3D"]).Select(Floats));
            }

            /// <summary>
            /// The pairs written into the project's collision matrix itself: IgnoreLayerCollision called in the
            /// Editor lasts only until the settings reload. A row's bit set is "collides".
            /// </summary>
            static void Matrix(string settings, IEnumerable<float[]> pairs)
            {
                var so = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath(settings)[0]);
                var rows = so.FindProperty("m_LayerCollisionMatrix");
                if (rows == null) return;
                foreach (var pair in pairs)
                {
                    int a = (int)pair[0], b = (int)pair[1];
                    rows.GetArrayElementAtIndex(a).longValue &= ~(1L << b);
                    rows.GetArrayElementAtIndex(b).longValue &= ~(1L << a);
                }
                so.ApplyModifiedPropertiesWithoutUndo();
            }

            /// <summary>SceNoCo's named axes and buttons as the project-wide actions: `InputSystem.actions["Horizontal"]`.</summary>
            public static void Input(string path)
            {
                AssetDatabase.ImportAsset(path);
                var asset = AssetDatabase.LoadMainAssetAtPath(path);
                var system = Type.GetType("UnityEngine.InputSystem.InputSystem, Unity.InputSystem");
                var actions = system?.GetProperty("actions", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.Public);
                if (asset == null || actions == null || !actions.CanWrite)
                {
                    warnings.Add($"input: {path} is not the project-wide actions — set it in Project Settings ▸ Input System Package.");
                    return;
                }
                actions.SetValue(null, asset);
            }
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
