// Written by scenoco-unity on every export — edits here are overwritten.
using UnityEngine;

namespace SceNoCo
{
    /// <summary>
    /// Keeps its object when a scene loads: the first scene's Input object — its EventSystem and UI input
    /// module — stays for the whole game, as the page's input does on the web.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class KeepAcrossScenes : MonoBehaviour
    {
        void Awake()
        {
            // One of a kind: a scene played on its own may hold another.
#if UNITY_6000_6_OR_NEWER
            foreach (var other in FindObjectsByType<KeepAcrossScenes>())
#else
            foreach (var other in FindObjectsByType<KeepAcrossScenes>(FindObjectsSortMode.None))
#endif
                if (other != this && other.name == name) { Destroy(gameObject); return; }
            DontDestroyOnLoad(gameObject);
        }
    }
}
