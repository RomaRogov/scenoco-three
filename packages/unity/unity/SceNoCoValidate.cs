// Written by scenoco-unity on every export — edits here are overwritten.
using System;
using System.Collections.Generic;
using System.Reflection;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace SceNoCo
{
    /// <summary>
    /// SceNoCo's <c>onValidate</c> also runs when the editor moves a behaviour's object, or an object the
    /// behaviour was given (a knot under a spline's <c>knots</c>); Unity's runs only for a changed field.
    /// This calls <c>OnValidate</c> for a move too: on the moved object's behaviours, and on every behaviour
    /// in its scene whose fields hold that object or one above it. Edit mode only.
    /// </summary>
    [InitializeOnLoad]
    static class Validate
    {
        static readonly Dictionary<Type, MethodInfo> hooks = new();

        static Validate() => ObjectChangeEvents.changesPublished += Changed;

        static void Changed(ref ObjectChangeEventStream stream)
        {
            if (EditorApplication.isPlayingOrWillChangePlaymode) return;
            var moved = new HashSet<Transform>();
            for (var i = 0; i < stream.length; i++)
            {
                if (stream.GetEventType(i) != ObjectChangeKind.ChangeGameObjectOrComponentProperties) continue;
                stream.GetChangeGameObjectOrComponentPropertiesEvent(i, out var e);
                // A field changed on a behaviour is Unity's own OnValidate already; a move is its Transform.
#if UNITY_6000_6_OR_NEWER
                var changed = EditorUtility.EntityIdToObject(e.entityId);
#else
                var changed = EditorUtility.InstanceIDToObject(e.instanceId);
#endif
                if (changed is Transform t) moved.Add(t);
                else if (changed is GameObject go) moved.Add(go.transform);
            }
            if (moved.Count == 0) return;

            var called = new HashSet<MonoBehaviour>();
            foreach (var scene in Scenes(moved))
                foreach (var root in scene.GetRootGameObjects())
                    foreach (var b in root.GetComponentsInChildren<MonoBehaviour>(true))
                        if (b != null && IsGame(b.GetType()) && Hook(b.GetType()) != null && Concerns(b, moved)) called.Add(b);
            foreach (var b in called)
            {
                try { Hook(b.GetType()).Invoke(b, null); }
                catch (TargetInvocationException error) { Debug.LogException(error.InnerException ?? error, b); }
                if (b.gameObject.scene.IsValid()) EditorSceneManager.MarkSceneDirty(b.gameObject.scene);
            }
        }

        static IEnumerable<UnityEngine.SceneManagement.Scene> Scenes(HashSet<Transform> moved)
        {
            var seen = new HashSet<UnityEngine.SceneManagement.Scene>();
            foreach (var t in moved) if (t != null && t.gameObject.scene.IsValid() && seen.Add(t.gameObject.scene)) yield return t.gameObject.scene;
        }

        /// <summary>The behaviour is on a moved object, or a field of it holds one or an object above one.</summary>
        static bool Concerns(MonoBehaviour b, HashSet<Transform> moved)
        {
            foreach (var t in moved) if (t != null && t == b.transform) return true;
            var field = new SerializedObject(b).GetIterator();
            while (field.Next(true))
            {
                if (field.propertyType != SerializedPropertyType.ObjectReference || field.name == "m_Script") continue;
                var held = field.objectReferenceValue switch
                {
                    GameObject go => go.transform,
                    Component c => c.transform,
                    _ => null,
                };
                if (held == null) continue;
                foreach (var t in moved) if (t != null && t.IsChildOf(held)) return true;
            }
            return false;
        }

        /// <summary>The game's own behaviour: Unity's components (a SplineInstantiate) follow their own changes.</summary>
        static bool IsGame(Type type)
        {
            var assembly = type.Assembly.GetName().Name;
            return !assembly.StartsWith("Unity") && !assembly.StartsWith("UnityEngine");
        }

        static MethodInfo Hook(Type type)
        {
            if (!hooks.TryGetValue(type, out var hook))
                hooks[type] = hook = type.GetMethod("OnValidate", BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic, null, Type.EmptyTypes, null);
            return hook;
        }
    }
}
