// Written by scenoco-unity on every export — edits here are overwritten.
using System.Collections.Generic;
using Unity.Mathematics;
using UnityEngine;
using UnityEngine.Splines;

namespace SceNoCo
{
    /// <summary>
    /// The knots of this object's spline are the children of <see cref="knots"/>, in order, as SceNoCo's
    /// <c>&lt;SplineContainer knots={node} /&gt;</c> reads them: move one, add one or take one away, in the
    /// Scene view or from code, and the spline follows. Each knot's tangents are made smooth from its
    /// neighbours, a third of the way to each (SceNoCo's AutoSmooth), so both engines draw the same curve.
    /// </summary>
    [ExecuteAlways, DisallowMultipleComponent, RequireComponent(typeof(SplineContainer))]
    public sealed class SplineKnotNodes : MonoBehaviour
    {
        /// <summary>The object whose children are the knots.</summary>
        public Transform knots;

        readonly List<Vector3> seen = new();

        void OnEnable()
        {
            seen.Clear();
            Rebuild();
        }

        // Once a frame, as SceNoCo's SplineContainer looks: a rebuild only when a knot moved.
        void Update() => Rebuild();

        void Rebuild()
        {
            if (knots == null) return;
            var points = new List<Vector3>(knots.childCount);
            foreach (Transform child in knots) points.Add(transform.InverseTransformPoint(child.position));
            if (Same(points, seen)) return;
            seen.Clear();
            seen.AddRange(points);

            var spline = GetComponent<SplineContainer>().Spline;
            var closed = spline.Closed;
            var count = points.Count;
            Vector3 At(int i) => points[closed ? (i % count + count) % count : Mathf.Clamp(i, 0, count - 1)];
            // Along the line from the knot before to the one after, a third of the way to each neighbour.
            Vector3 Smooth(int i, bool outward)
            {
                if (!closed && (outward ? i == count - 1 : i == 0)) return Vector3.zero;
                var along = (At(i + 1) - At(i - 1)).normalized;
                return outward ? along * (At(i + 1) - At(i)).magnitude / 3 : -along * (At(i) - At(i - 1)).magnitude / 3;
            }

            spline.Clear();
            for (var i = 0; i < count; i++)
                spline.Add(new BezierKnot(points[i], Smooth(i, false), Smooth(i, true), quaternion.identity), TangentMode.Broken);
            spline.Closed = closed;
        }

        static bool Same(List<Vector3> a, List<Vector3> b)
        {
            if (a.Count != b.Count) return false;
            for (var i = 0; i < a.Count; i++) if (a[i] != b[i]) return false;
            return true;
        }
    }
}
