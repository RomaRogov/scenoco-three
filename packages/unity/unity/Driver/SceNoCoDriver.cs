// Drives the game in the Editor's Play mode the way window.__scenoco drives it on the web: a held
// clock that steps exact frames, input as the player's, and the game's state read by class and name.
// Commands for Unity's CLI (com.unity.pipeline): `unity command scenoco.help` says how to call them.
//
// Written into the project by scenoco-unity, and again by every export: edit it there, not here.
using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Threading;
using Unity.Pipeline.Commands;
using UnityEditor;
using UnityEngine;
using UnityEngine.LowLevel;
using UnityEngine.PlayerLoop;
using UnityEngine.SceneManagement;
#if SCENOCO_INPUT_SYSTEM
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.LowLevel;
#endif

namespace SceNoCo.Driver
{
    [InitializeOnLoad]
    static class Driver
    {
        const string Group = "scenoco";
        /// <summary>A frame of the held clock, as the web bridge steps it.</summary>
        const float Frame = 1f / 60f;
        /// <summary>Session state: set up for driving, so it outlives the reload Play mode starts with.</summary>
        const string Driving = "SceNoCo.Driver.Driving";

        static readonly int mainThread;
        static readonly ConcurrentQueue<Action> onMain = new ConcurrentQueue<Action>();
        static readonly System.Diagnostics.Stopwatch sinceTick = System.Diagnostics.Stopwatch.StartNew();
        static Action signalTick;

        static Driver()
        {
            mainThread = Thread.CurrentThread.ManagedThreadId;
            EditorApplication.update += Update;
            EditorApplication.playModeStateChanged += OnPlayMode;
#if SCENOCO_INPUT_SYSTEM
            InputSystem.onBeforeUpdate += BeforeInput;
#endif
        }

        static void Update()
        {
            while (onMain.TryDequeue(out var action)) action();
            // An unfocused Editor ticks rarely, and its game with it: while driving, keep it ticking, as
            // the Pipeline's `editor set_auto_tick` does.
            // Frames a command is waiting for tick at once: they are game time, not the Editor's.
            if (SessionState.GetBool(Driving, false) && (toRun > 0 || sinceTick.ElapsedMilliseconds >= 16))
            {
                sinceTick.Restart();
                signalTick ??= (Action)Delegate.CreateDelegate(typeof(Action), typeof(EditorApplication).GetMethod("SignalTick", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic));
                signalTick();
            }
        }

        /// <summary>Run on the main thread and wait for it: commands that let frames pass run on a worker thread.</summary>
        static T Run<T>(Func<T> work, double seconds = 10)
        {
            if (Thread.CurrentThread.ManagedThreadId == mainThread) return work();
            T result = default;
            Exception error = null;
            using var done = new ManualResetEventSlim();
            onMain.Enqueue(() =>
            {
                try { result = work(); }
                catch (Exception e) { error = e; }
                finally { done.Set(); }
            });
            if (!done.Wait(TimeSpan.FromSeconds(seconds)))
                throw new TimeoutException("The Editor did not run a frame for " + seconds + " s: a modal dialog may be open in it, or it is not set up for driving — run `unity command scenoco.setup`.");
            if (error != null) throw error;
            return result;
        }

        static void Run(Action work) => Run(() => { work(); return 0; });

        // --- Setting up ---------------------------------------------------------------------------

        [CliCommand(Group, "help", "How to drive the game: every scenoco command, and the order to call them in.", MainThreadRequired = false)]
        static string Help() => HelpText;

        [CliCommand(Group, "setup", "Make the Editor drivable: keep it ticking while unfocused, run the game in the background, and route input to it. Optionally set the Game view's resolution.")]
        static object Setup(
            [CliArg("width", "Game view width in pixels; 0 keeps the current one")] int width = 0,
            [CliArg("height", "Game view height in pixels; 0 keeps the current one")] int height = 0)
        {
            SessionState.SetBool(Driving, true);
            if (width > 0 && height > 0)
            {
                PlayModeWindow.SetViewType(PlayModeWindow.PlayModeViewTypes.GameView);
                PlayModeWindow.SetCustomRenderingResolution((uint)width, (uint)height, "SceNoCo " + width + "x" + height);
            }
            // A Game view to draw into: capture.game_view has nothing to capture without one.
            if (Resources.FindObjectsOfTypeAll(typeof(EditorWindow)).All(w => w.GetType().Name != "GameView"))
                EditorApplication.ExecuteMenuItem("Window/General/Game");
            if (EditorApplication.isPlaying) EnterPlay();
            var clock = Clock();
            clock["next"] = EditorApplication.isPlaying ? "unity command scenoco.ready" : "unity command scenoco.play";
            return clock;
        }

        [CliCommand(Group, "import", "Build what the last scenoco-unity export wrote — prefabs, scenes, materials, the UI — and say what did not come across.")]
        static object Import()
        {
            if (EditorApplication.isPlaying) throw new InvalidOperationException("import: leave Play mode first — `unity command scenoco.stop`.");
            // The importer is in the project's Editor assembly, which this one cannot reference by name.
            var importer = Type.GetType("SceNoCo.Importer, Assembly-CSharp-Editor") ?? throw new InvalidOperationException("No SceNoCo importer in the project: run scenoco-unity first.");
            importer.GetMethod("Import").Invoke(null, null);
            var warnings = (IEnumerable<string>)importer.GetProperty("Warnings").GetValue(null);
            return new Dictionary<string, object> { ["warnings"] = warnings.ToList() };
        }

        static void OnPlayMode(PlayModeStateChange change)
        {
            if (!SessionState.GetBool(Driving, false)) return;
            if (change == PlayModeStateChange.EnteredPlayMode) EnterPlay();
            if (change == PlayModeStateChange.ExitingPlayMode) ExitPlay();
        }

        /// <summary>What a driven game needs once it plays. None of it is saved: it lasts until Play mode ends.</summary>
        static void EnterPlay()
        {
            Application.runInBackground = true;
            CountFrames();
#if SCENOCO_INPUT_SYSTEM
            // A copy of the project's settings, so the asset itself is never changed.
            if (savedSettings == null)
            {
                savedSettings = InputSystem.settings;
                var settings = UnityEngine.Object.Instantiate(savedSettings);
                settings.backgroundBehavior = InputSettings.BackgroundBehavior.IgnoreFocus;
                settings.editorInputBehaviorInPlayMode = InputSettings.EditorInputBehaviorInPlayMode.AllDeviceInputAlwaysGoesToGameView;
                InputSystem.settings = settings;
            }
#endif
        }

        static void ExitPlay()
        {
            Time.captureDeltaTime = 0;
#if SCENOCO_INPUT_SYSTEM
            foreach (var device in new InputDevice[] { mouse, touch, keyboard })
                if (device != null && device.added) InputSystem.RemoveDevice(device);
            mouse = null;
            touch = null;
            keyboard = null;
            pressed.Clear();
            script.Clear();
            buttonDown = false;
            if (savedSettings != null) InputSystem.settings = savedSettings;
            savedSettings = null;
#endif
        }

        // --- The clock ----------------------------------------------------------------------------

        [CliCommand(Group, "play", "Enter Play mode, or let a held clock run in real time again.")]
        static object Play()
        {
            if (!SessionState.GetBool(Driving, false)) Setup();
            if (!EditorApplication.isPlaying)
            {
                EditorApplication.isPlaying = true;
                return new Dictionary<string, object>
                {
                    ["entering"] = true,
                    ["next"] = "Play mode reloads the scripts, and the command server with them: call `unity command scenoco.ready` until it answers.",
                };
            }
            EditorApplication.isPaused = false;
            Time.captureDeltaTime = 0;
            return Clock();
        }

        [CliCommand(Group, "ready", "Wait until the game has run its first frames: input sent sooner reaches nothing. Call it after play.", MainThreadRequired = false)]
        static object Ready([CliArg("frames", "Frames the game must have run")] int frames = 3)
        {
            var deadline = DateTime.UtcNow.AddSeconds(60);
            while (!Run(() => EditorApplication.isPlaying && !EditorApplication.isCompiling && Time.frameCount >= frames))
            {
                if (DateTime.UtcNow > deadline) throw new TimeoutException("The game did not reach frame " + frames + " in 60 s. Is the Editor in Play mode? `unity command scenoco.play` enters it.");
                if (Held()) Pass(1);
                Thread.Sleep(20);
            }
            return Run(Clock);
        }

        [CliCommand(Group, "pause", "Hold the clock: the game moves only when stepped, 1/60 s a frame.")]
        static object Pause()
        {
            RequirePlaying("pause");
            Hold();
            return Clock();
        }

        [CliCommand(Group, "step", "Hold the clock and advance exactly this many frames of 1/60 s.", MainThreadRequired = false)]
        static object Step([CliArg("frames", "Frames to advance")] int frames = 1)
        {
            Run(() => { RequirePlaying("step"); Hold(); });
            Pass(frames);
            return Run(Clock);
        }

        [CliCommand(Group, "clock", "Whether the game plays, whether its clock is held, its time, frame and time scale, and the Game view's size.")]
        static Dictionary<string, object> Clock()
        {
            PlayModeWindow.GetRenderingResolution(out var width, out var height);
            return new Dictionary<string, object>
            {
                ["playing"] = EditorApplication.isPlaying,
                ["held"] = EditorApplication.isPaused,
                ["time"] = Round(Time.time),
                ["frame"] = Time.frameCount,
                ["timeScale"] = Time.timeScale,
                ["width"] = width,
                ["height"] = height,
            };
        }

        [CliCommand(Group, "stop", "Leave Play mode.")]
        static string Stop()
        {
            EditorApplication.isPlaying = false;
            return "Leaving Play mode.";
        }

        static void RequirePlaying(string verb)
        {
            if (!EditorApplication.isPlaying) throw new InvalidOperationException(verb + ": the game is not playing. `unity command scenoco.play`, then `unity command scenoco.ready`.");
        }

        static void Hold()
        {
            EditorApplication.isPaused = true;
            // Every frame the same length, as the web bridge steps them: the game's time moves 1/60 s a step.
            Time.captureDeltaTime = Frame;
        }

        static bool Held() => Run(() => EditorApplication.isPlaying && EditorApplication.isPaused);

        /// <summary>Frames left to run before the clock is held again, and what holds it sooner.</summary>
        static int toRun;
        static Func<bool> stopWhen;

        struct SceNoCoFrameEnd { }

        /// <summary>
        /// Hold the clock again at the end of the frame that uses up `toRun`. A held clock steps by
        /// letting whole frames run, not with EditorApplication.Step: a stepped frame takes the fixed
        /// time step instead of Time.captureDeltaTime, and the Input System does not update the game in it.
        /// </summary>
        static void CountFrames()
        {
            var loop = PlayerLoop.GetCurrentPlayerLoop();
            for (var i = 0; i < loop.subSystemList.Length; i++)
            {
                if (loop.subSystemList[i].type != typeof(PostLateUpdate)) continue;
                var systems = loop.subSystemList[i].subSystemList.ToList();
                if (systems.Any(s => s.type == typeof(SceNoCoFrameEnd))) return;
                systems.Add(new PlayerLoopSystem
                {
                    type = typeof(SceNoCoFrameEnd),
                    updateDelegate = FrameEnd,
                });
                loop.subSystemList[i].subSystemList = systems.ToArray();
                PlayerLoop.SetPlayerLoop(loop);
                return;
            }
        }

        /// <summary>The end of a game frame: hold the clock once the frames asked for have run, or `stopWhen` holds.</summary>
        static void FrameEnd()
        {
            if (toRun <= 0) return;
            toRun--;
            if (toRun > 0 && (stopWhen == null || !stopWhen())) return;
            toRun = 0;
            EditorApplication.isPaused = true;
        }

        /// <summary>
        /// Let `frames` frames go by — exactly that many while the clock is held, fewer when `stop` holds at
        /// the end of one; in real time when it is not held.
        /// </summary>
        static void Pass(int frames, Func<bool> stop = null)
        {
            if (frames <= 0) return;
            var held = Held();
            var target = Run(() => Time.frameCount) + frames;
            if (held) Run(() => { CountFrames(); stopWhen = stop; toRun = frames; EditorApplication.isPaused = false; });
            var deadline = DateTime.UtcNow.AddSeconds(10 + frames / 10.0);
            while (!Run(() => held ? toRun == 0 && EditorApplication.isPaused : Time.frameCount >= target))
            {
                if (DateTime.UtcNow > deadline) throw new TimeoutException("The game stopped advancing at frame " + Run(() => Time.frameCount) + ".");
                Thread.Sleep(held ? 2 : 10);
            }
            stopWhen = null;
        }

        // --- Reading ------------------------------------------------------------------------------

        [CliCommand(Group, "read", "The game's state: `Player` — every live Player's fields; `Player.lane` — that member of each (a static member is read once); `#runner` — the GameObject named runner.")]
        static object Read([CliArg("target", "Player | Player.lane | #runner")] string target)
        {
            RequirePlaying("read");
            if (target.StartsWith("#"))
            {
                var go = GameObject.Find(target.Substring(1)) ?? throw new ArgumentException("No active GameObject is named " + target.Substring(1) + ". `unity command scenoco.outline` lists them.");
                return Node(go);
            }
            var (type, path) = Split(target);
            var member = path.Length > 0 ? Member(type, path[0]) : null;
            if (member != null && IsStatic(member)) return Plain(Walk(Value(member, null), path.Skip(1)), 3);
            var live = Live(type);
            if (path.Length == 0) return live.Select(b => Fields(b, 2)).ToList();
            return live.Select(b => Plain(Walk(b, path), 3)).ToList();
        }

        [CliCommand(Group, "outline", "The loaded scenes as text: every GameObject, its components, and each game behaviour's fields.")]
        static string Outline([CliArg("depth", "How deep under each root")] int depth = 4)
        {
            var clock = Clock();
            var text = new StringBuilder($"time {clock["time"]}s · frame {clock["frame"]} · timeScale {clock["timeScale"]}{((bool)clock["held"] ? " · clock held" : "")}\n");
            void Visit(Transform t, int level)
            {
                var indent = new string(' ', level * 2);
                text.Append(indent).Append(t.name).Append(t.gameObject.activeInHierarchy ? "" : " (inactive)");
                var parts = t.GetComponents<Component>().Where(c => c != null && !(c is Transform)).Select(c => c.GetType().Name);
                text.Append(" [").Append(string.Join(", ", parts)).Append("]\n");
                foreach (var b in t.GetComponents<MonoBehaviour>().Where(IsGame))
                    text.Append(indent).Append("  ").Append(b.GetType().Name).Append(' ').Append(Json(Fields(b, 1))).Append('\n');
                if (level < depth) foreach (Transform child in t) Visit(child, level + 1);
            }
            for (var i = 0; i < SceneManager.sceneCount; i++)
                foreach (var root in SceneManager.GetSceneAt(i).GetRootGameObjects()) Visit(root.transform, 0);
            return text.ToString();
        }

        [CliCommand(Group, "until", "Hold the clock and step until a member of the game meets a condition: until --target Game.phase --equals over.", MainThreadRequired = false)]
        static object Until(
            [CliArg("target", "A member, as read takes it: Game.phase, Player.lives")] string target,
            [CliArg("equals", "Met when it equals this (a number compares as a number)")] string equals = null,
            [CliArg("above", "Met when it is greater than this number")] string above = null,
            [CliArg("below", "Met when it is less than this number")] string below = null,
            [CliArg("max_frames", "Give up after this many frames")] int maxFrames = 600)
        {
            Run(() => { RequirePlaying("until"); Hold(); });
            Func<object, bool> test;
            if (equals != null) test = v => double.TryParse(equals, NumberStyles.Float, CultureInfo.InvariantCulture, out var n) && Number(v) is double d ? Math.Abs(d - n) < 1e-6 : string.Equals(Text(v), equals, StringComparison.Ordinal);
            else if (above != null) test = v => Number(v) > double.Parse(above, CultureInfo.InvariantCulture);
            else if (below != null) test = v => Number(v) < double.Parse(below, CultureInfo.InvariantCulture);
            else test = v => v is bool b ? b : v != null && !(Number(v) is double d && d == 0);
            // Tested at the end of every frame, in the game's own loop, which holds the clock on the frame it is met.
            var start = Run(() => Time.frameCount);
            if (!Run(() => test(First(target)))) Pass(maxFrames, () => test(First(target)));
            return Run(() =>
            {
                var v = First(target);
                var result = Clock();
                result["met"] = test(v);
                result["frames"] = Time.frameCount - start;
                result["value"] = Plain(v, 2);
                return result;
            });
        }

        /// <summary>A member of the first live behaviour of its class, or a static member: what `until` tests.</summary>
        static object First(string target)
        {
            var (type, path) = Split(target);
            if (path.Length == 0) return Live(type).FirstOrDefault();
            var member = Member(type, path[0]);
            if (member != null && IsStatic(member)) return Walk(Value(member, null), path.Skip(1));
            var live = Live(type).FirstOrDefault();
            return live == null ? null : Walk(live, path);
        }

        static (Type, string[]) Split(string target)
        {
            var parts = target.Split('.');
            var type = FindType(parts[0]) ?? throw new ArgumentException("No class is named " + parts[0] + ". A target is a class of the game, then its members: Player, Player.lane, Game.phase.");
            return (type, parts.Skip(1).ToArray());
        }

        static readonly Dictionary<string, Type> types = new Dictionary<string, Type>();

        static Type FindType(string name)
        {
            if (types.TryGetValue(name, out var known)) return known;
            var found = TypeCache.GetTypesDerivedFrom<object>()
                .Where(t => t.Name == name && !t.Assembly.FullName.StartsWith("System") && !t.Assembly.FullName.StartsWith("mscorlib"))
                .OrderBy(t => t.Assembly.GetName().Name.StartsWith("Assembly-CSharp") ? 0 : t.Assembly.GetName().Name.StartsWith("Unity") ? 2 : 1)
                .FirstOrDefault();
            if (found != null) types[name] = found;
            return found;
        }

        static IEnumerable<UnityEngine.Object> Live(Type type)
        {
            if (!typeof(UnityEngine.Object).IsAssignableFrom(type)) throw new ArgumentException(type.Name + " is not a component: read a static member of it, Type.member.");
            // Unity 6.6 deprecates the sort mode, but the order is what keeps `read` the same from call to call.
#pragma warning disable CS0618
            return UnityEngine.Object.FindObjectsByType(type, FindObjectsSortMode.InstanceID);
#pragma warning restore CS0618
        }

        const BindingFlags Any = BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.FlattenHierarchy;

        static MemberInfo Member(Type type, string name) =>
            (MemberInfo)type.GetField(name, Any) ?? type.GetProperty(name, Any) ?? (MemberInfo)type.GetField("<" + name + ">k__BackingField", Any);

        static bool IsStatic(MemberInfo m) => m is FieldInfo f ? f.IsStatic : m is PropertyInfo p && (p.GetGetMethod(true)?.IsStatic ?? false);

        static object Value(MemberInfo m, object target) => m is FieldInfo f ? f.GetValue(target) : ((PropertyInfo)m).GetValue(target);

        static object Walk(object value, IEnumerable<string> path)
        {
            foreach (var name in path)
            {
                if (value == null) return null;
                var member = Member(value.GetType(), name) ?? throw new ArgumentException(value.GetType().Name + " has no member " + name + ".");
                value = Value(member, value);
            }
            return value;
        }

        static bool IsGame(MonoBehaviour b) => b != null && b.GetType().Assembly.GetName().Name.StartsWith("Assembly-CSharp");

        /// <summary>A behaviour's own fields — its class's and its game ancestors', public or not.</summary>
        static Dictionary<string, object> Fields(object o, int depth)
        {
            var result = new Dictionary<string, object>();
            for (var t = o.GetType(); t != null && t != typeof(MonoBehaviour) && t != typeof(object); t = t.BaseType)
                foreach (var f in t.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly))
                {
                    var name = f.Name.StartsWith("<") ? f.Name.Substring(1, f.Name.IndexOf('>') - 1) : f.Name;
                    if (!result.ContainsKey(name)) result[name] = Plain(f.GetValue(o), depth);
                }
            return result;
        }

        static Dictionary<string, object> Node(GameObject go) => new Dictionary<string, object>
        {
            ["name"] = go.name,
            ["active"] = go.activeInHierarchy,
            ["position"] = Plain(go.transform.position, 1),
            ["components"] = go.GetComponents<Component>().Where(c => c != null).Select(c => c.GetType().Name).ToList(),
            ["behaviours"] = go.GetComponents<MonoBehaviour>().Where(IsGame).ToDictionary(b => b.GetType().Name, b => (object)Fields(b, 1)),
        };

        /// <summary>A value as plain data: numbers, strings, lists, objects of fields.</summary>
        static object Plain(object v, int depth)
        {
            switch (v)
            {
                case null: return null;
                case string s: return s;
                case bool b: return b;
                case float f: return Round(f);
                case double d: return Round(d);
                case Enum e: return e.ToString();
                case Vector2 a: return new[] { Round(a.x), Round(a.y) };
                case Vector3 a: return new[] { Round(a.x), Round(a.y), Round(a.z) };
                case Vector4 a: return new[] { Round(a.x), Round(a.y), Round(a.z), Round(a.w) };
                case Quaternion q: return Plain(q.eulerAngles, depth);
                case Color c: return "#" + ColorUtility.ToHtmlStringRGBA(c);
                case GameObject go: return "#" + go.name;
                case Component c: return c == null ? null : c.GetType().Name + " on #" + c.gameObject.name;
                case UnityEngine.Object o: return o == null ? null : o.name;
            }
            if (v.GetType().IsPrimitive || v is decimal) return v;
            // An engine object — a VisualElement, a Rigidbody2D's internals — reads as its own text, not its fields.
            if (!(v is IEnumerable) && !v.GetType().Assembly.GetName().Name.StartsWith("Assembly-CSharp")) return v.ToString();
            if (depth <= 0) return v.ToString();
            if (v is IDictionary dict) { var r = new Dictionary<string, object>(); foreach (DictionaryEntry e in dict) r[e.Key.ToString()] = Plain(e.Value, depth - 1); return r; }
            if (v is IEnumerable list) return list.Cast<object>().Take(50).Select(x => Plain(x, depth - 1)).ToList();
            return Fields(v, depth - 1);
        }

        static double Round(double v) => Math.Round(v, 4);

        static double? Number(object v) => v switch
        {
            null => null,
            bool b => b ? 1 : 0,
            Enum _ => null,
            IConvertible c when !(v is string) => c.ToDouble(CultureInfo.InvariantCulture),
            string s when double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };

        static string Text(object v) => v is Enum e ? e.ToString() : Plain(v, 0)?.ToString();

        static string Json(object v) => v switch
        {
            null => "null",
            string s => "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"",
            bool b => b ? "true" : "false",
            IDictionary<string, object> d => "{" + string.Join(", ", d.Select(p => p.Key + ": " + Json(p.Value))) + "}",
            IEnumerable e => "[" + string.Join(", ", e.Cast<object>().Select(Json)) + "]",
            IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
            _ => v.ToString(),
        };

        // --- Input --------------------------------------------------------------------------------
#if SCENOCO_INPUT_SYSTEM
        static InputSettings savedSettings;
        static Mouse mouse;
        static Touchscreen touch;
        static Keyboard keyboard;
        static readonly HashSet<Key> pressed = new HashSet<Key>();
        /// <summary>What to send the game, one entry per frame of its own: input queued from the Editor's update reaches the Editor, not the game.</summary>
        static readonly Queue<Action> script = new Queue<Action>();

        static void BeforeInput()
        {
            if (InputState.currentUpdateType != InputUpdateType.Dynamic || script.Count == 0) return;
            script.Dequeue()?.Invoke();
        }

        /// <summary>The driver's own devices: the real ones keep sending their state, which would undo what is sent here.</summary>
        static T Device<T>(ref T device, string name) where T : InputDevice
        {
            if (device == null || !device.added) device = InputSystem.AddDevice<T>(name);
            // The Editor turns devices off whenever it loses focus.
            if (!device.enabled) InputSystem.EnableDevice(device);
            return device;
        }

        /// <summary>Send `frames` (one entry a frame, null for none) and let them all reach the game.</summary>
        static object Send(IEnumerable<Action> frames)
        {
            var count = Run(() =>
            {
                RequirePlaying("input");
                foreach (var f in frames) script.Enqueue(f);
                return script.Count;
            });
            Pass(count + 1);
            return Run(Clock);
        }

        static Vector2 Point(string verb, float x, float y)
        {
            PlayModeWindow.GetRenderingResolution(out var width, out var height);
            if (x < 0 || y < 0 || x > width || y > height)
                throw new ArgumentException($"{verb}: ({x}, {y}) is outside the Game view, which is {width}×{height}. x and y are pixels from its top-left.");
            // From the top-left, as the web bridge takes them; Unity counts from the bottom-left.
            return new Vector2(x, height - y);
        }

        static Action PointerAt(bool touchscreen, Vector2 at, UnityEngine.InputSystem.TouchPhase phase) => () =>
        {
            if (touchscreen)
                InputSystem.QueueStateEvent(Device(ref touch, "SceNoCoTouch"), new TouchState { touchId = 1, phase = phase, position = at });
            else
            {
                // A move keeps the button as it was: down while dragging, up while hovering.
                if (phase == UnityEngine.InputSystem.TouchPhase.Began) buttonDown = true;
                if (phase == UnityEngine.InputSystem.TouchPhase.Ended) buttonDown = false;
                // With its delta, as a real mouse sends it: a game that steers by "the mouse moved" reads that.
                InputSystem.QueueStateEvent(Device(ref mouse, "SceNoCoMouse"), new MouseState { position = at, delta = at - mouseAt }.WithButton(MouseButton.Left, buttonDown));
                mouseAt = at;
            }
        };

        static bool buttonDown;
        static Vector2 mouseAt;

        static Action Keys(Key key, bool down) => () =>
        {
            if (down) pressed.Add(key); else pressed.Remove(key);
            InputSystem.QueueStateEvent(Device(ref keyboard, "SceNoCoKeyboard"), new KeyboardState(pressed.ToArray()));
        };

        static Key KeyNamed(string name)
        {
            switch (name)
            {
                case " ": case "Space": return Key.Space;
                case "ArrowLeft": return Key.LeftArrow;
                case "ArrowRight": return Key.RightArrow;
                case "ArrowUp": return Key.UpArrow;
                case "ArrowDown": return Key.DownArrow;
                case "Shift": return Key.LeftShift;
                case "Control": return Key.LeftCtrl;
                case "Alt": return Key.LeftAlt;
                case "Meta": return Key.LeftMeta;
            }
            if (name.Length == 1 && char.IsDigit(name[0])) return (Key)Enum.Parse(typeof(Key), "Digit" + name);
            if (Enum.TryParse<Key>(name, true, out var key) && key != Key.None) return key;
            throw new ArgumentException("No key is named " + name + ". Keys are named as on the web: Space, ArrowLeft, Enter, Escape, a, 7 — or by Unity's Key: LeftArrow, Digit7.");
        }

        [CliCommand(Group, "press", "Hold a key for some frames, then let it go: press --key Space.", MainThreadRequired = false)]
        static object Press([CliArg("key", "Space, ArrowLeft, Enter, Escape, a, 7")] string key, [CliArg("frames", "Frames to hold it")] int frames = 6)
        {
            var k = KeyNamed(key);
            return Send(new[] { Keys(k, true) }.Concat(Enumerable.Repeat<Action>(null, Math.Max(0, frames - 1))).Concat(new[] { Keys(k, false) }));
        }

        [CliCommand(Group, "key_down", "Press a key and keep it down.", MainThreadRequired = false)]
        static object KeyDown([CliArg("key", "Space, ArrowLeft, Enter, Escape, a, 7")] string key) => Send(new[] { Keys(KeyNamed(key), true) });

        [CliCommand(Group, "key_up", "Let a key go.", MainThreadRequired = false)]
        static object KeyUp([CliArg("key", "Space, ArrowLeft, Enter, Escape, a, 7")] string key) => Send(new[] { Keys(KeyNamed(key), false) });

        [CliCommand(Group, "click", "Click — or with --touch, tap — at a point of the Game view, in pixels from its top-left.", MainThreadRequired = false)]
        static object Click([CliArg("x", "Pixels from the left")] float x, [CliArg("y", "Pixels from the top")] float y, [CliArg("touch", "A finger instead of the mouse")] bool touch = false)
        {
            var at = Run(() => Point("click", x, y));
            return Send(new[] { PointerAt(touch, at, UnityEngine.InputSystem.TouchPhase.Began), PointerAt(touch, at, UnityEngine.InputSystem.TouchPhase.Ended) });
        }

        [CliCommand(Group, "pointer_down", "Press the mouse — or with --touch, a finger — at a point, and keep it down.", MainThreadRequired = false)]
        static object PointerDown([CliArg("x", "Pixels from the left")] float x, [CliArg("y", "Pixels from the top")] float y, [CliArg("touch", "A finger instead of the mouse")] bool touch = false)
        {
            var at = Run(() => Point("pointer_down", x, y));
            pointerAt = at;
            return Send(new[] { PointerAt(touch, at, UnityEngine.InputSystem.TouchPhase.Began) });
        }

        [CliCommand(Group, "pointer_move", "Move the pointer — held or not — to a point.", MainThreadRequired = false)]
        static object PointerMove([CliArg("x", "Pixels from the left")] float x, [CliArg("y", "Pixels from the top")] float y, [CliArg("touch", "A finger instead of the mouse")] bool touch = false)
        {
            var at = Run(() => Point("pointer_move", x, y));
            pointerAt = at;
            return Send(new[] { PointerAt(touch, at, UnityEngine.InputSystem.TouchPhase.Moved) });
        }

        [CliCommand(Group, "pointer_up", "Let the pointer go where it is.", MainThreadRequired = false)]
        static object PointerUp([CliArg("touch", "A finger instead of the mouse")] bool touch = false) =>
            Send(new[] { PointerAt(touch, pointerAt, UnityEngine.InputSystem.TouchPhase.Ended) });

        static Vector2 pointerAt;

        [CliCommand(Group, "swipe", "Press at one point, drag to another over some frames, let go: swipe --from 500,400 --to 300,400.", MainThreadRequired = false)]
        static object Swipe(
            [CliArg("from", "x,y in pixels from the Game view's top-left")] string from,
            [CliArg("to", "x,y in pixels from the Game view's top-left")] string to,
            [CliArg("frames", "Frames the drag takes")] int frames = 8,
            [CliArg("touch", "A finger instead of the mouse")] bool touch = false)
        {
            Vector2 Parse(string point)
            {
                var xy = point.Split(',');
                if (xy.Length != 2 || !float.TryParse(xy[0], NumberStyles.Float, CultureInfo.InvariantCulture, out var x) || !float.TryParse(xy[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var y))
                    throw new ArgumentException("swipe: " + point + " is not a point — write it x,y: swipe --from 500,400 --to 300,400.");
                return Run(() => Point("swipe", x, y));
            }
            var a = Parse(from);
            var b = Parse(to);
            var steps = new List<Action> { PointerAt(touch, a, UnityEngine.InputSystem.TouchPhase.Began) };
            for (var i = 1; i <= Math.Max(1, frames); i++) steps.Add(PointerAt(touch, Vector2.Lerp(a, b, i / (float)Math.Max(1, frames)), UnityEngine.InputSystem.TouchPhase.Moved));
            steps.Add(PointerAt(touch, b, UnityEngine.InputSystem.TouchPhase.Ended));
            return Send(steps);
        }
#endif

        const string HelpText = @"scenoco — the game in the Editor's Play mode, driven as window.__scenoco drives it on the web.
Every command: unity command scenoco.<verb> [--name value …] — scenoco.step --frames 10. Each returns plain data.

Start:
  import                               build the last export and list what did not come across — read every warning
  setup [--width 1080 --height 1920]   keep the Editor ticking unfocused, run the game in the background, route input to it;
                                       sets the Game view's resolution too
  play                                 enter Play mode; it reloads the scripts, and this server with them
  ready                                wait for the game's first frames — call it until it answers: input sent sooner reaches nothing
Clock — a held clock moves only when stepped, 1/60 s a frame, so every reading lands on an exact frame:
  pause   play   clock   stop
  step [--frames 1]                    advance exactly this many frames
  until --target Game.phase --equals over [--max_frames 600]   step until it holds; also --above n, --below n, or neither (truthy)
                                       a wait longer than Unity's CLI allows (30 s): add --timeout 120 after the verb
Reading — a target is a class of the game, then its members; the first live one is the one `until` tests:
  read --target Player | Player.lane | #runner     every live Player's fields; that member of each; the GameObject named runner
  outline [--depth 4]                  the loaded scenes as text, with each game behaviour's fields
Input — through the Input System, as the player's, stepped while the clock is held; x, y in pixels from the Game view's top-left:
  press --key Space [--frames 6]   key_down --key a   key_up --key a       Space, ArrowLeft, Enter, Escape, a, 7
  click --x 540 --y 960   pointer_down / pointer_move --x --y   pointer_up   swipe --from 540,1400 --to 540,600 [--frames 8]
  add --touch true to any pointer verb for a finger instead of the mouse
  The legacy Input Manager (UnityEngine.Input) is not driven: read input through the Input System.
Looking and anything else, from Unity's own commands:
  unity command capture.game_view -- --save_path Screenshots/now.png    what the Game view shows, HUD included
  unity command console.get -- --level error                           exceptions
  unity command script.eval ""return FindFirstObjectByType<Game>().score;""   any C#";
    }
}
