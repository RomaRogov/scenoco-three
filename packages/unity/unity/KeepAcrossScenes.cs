// Written by scenoco-unity on every export — edits here are overwritten.
using UnityEngine;

namespace SceNoCo
{
    /// <summary>
    /// Keeps its object when a scene loads: the first scene's Input object — its EventSystem and UI input
    /// module — stays for the whole game, as the page's input does on the web. Each scene with a page has
    /// one, so it plays on its own too; the one already kept wins.
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
                if (other != this && other.name == name)
                {
                    // Off at once, so its EventSystem is never a second one, even for the rest of this frame.
                    gameObject.SetActive(false);
                    Destroy(gameObject);
                    return;
                }
            DontDestroyOnLoad(gameObject);
        }
    }
}
