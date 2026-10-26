"""
The game's sound effects, synthesised: noise, oscillators and envelopes, no samples. Writes
22 kHz mono WAVs into src/sounds/. Run with any Python that has numpy:

    uv run --project ~/Dev/asset-lab python tools/sfx.py
"""
import wave
from pathlib import Path

import numpy as np

RATE = 22050
OUT = Path(__file__).resolve().parent.parent / "src" / "sounds"
rng = np.random.default_rng(3)


def t(seconds):
    return np.arange(int(RATE * seconds)) / RATE


def env(n, attack=0.005, decay=0.2, curve=4.0):
    x = np.arange(n) / RATE
    a = np.clip(x / max(attack, 1e-4), 0, 1)
    return a * np.exp(-curve * np.maximum(0, x - attack) / max(decay, 1e-4))


def tone(freq, seconds, shape="sine"):
    x = t(seconds)
    f = np.broadcast_to(freq, x.shape) if np.ndim(freq) else np.full_like(x, freq)
    phase = 2 * np.pi * np.cumsum(f) / RATE
    if shape == "square":
        return np.sign(np.sin(phase)) * 0.6
    if shape == "tri":
        return 2 / np.pi * np.arcsin(np.sin(phase))
    return np.sin(phase)


def noise(seconds):
    return rng.uniform(-1, 1, int(RATE * seconds))


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / RATE)
    y = np.zeros_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def mix(*parts):
    n = max(len(p) for p in parts)
    out = np.zeros(n)
    for p in parts:
        out[: len(p)] += p
    return out


def notes(seq, step, shape="tri", decay=0.25):
    parts = []
    for i, f in enumerate(seq):
        s = tone(f, step + decay, shape) * env(int(RATE * (step + decay)), 0.004, decay, 5)
        parts.append(np.concatenate([np.zeros(int(RATE * step * i)), s]))
    return mix(*parts)


def save(name, x, gain=0.8):
    x = x / max(1e-6, np.abs(x).max()) * gain
    fade = min(len(x), 200)
    x[-fade:] *= np.linspace(1, 0, fade)
    OUT.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((x * 32767).astype("<i2").tobytes())


n = lambda s: int(RATE * s)

# A bowstring: a falling twang over a puff of air.
save("arrow", mix(tone(np.linspace(520, 240, n(0.16)), 0.16, "tri") * env(n(0.16), 0.002, 0.05), lowpass(noise(0.12), 2500) * env(n(0.12), 0.001, 0.03) * 0.6), 0.5)
# A cannon: a thump and a rumble.
save("cannon", mix(tone(np.linspace(140, 45, n(0.4)), 0.4) * env(n(0.4), 0.002, 0.12), lowpass(noise(0.5), 600) * env(n(0.5), 0.002, 0.18)), 0.85)
# An explosion: low noise, long tail.
save("boom", mix(lowpass(noise(0.9), 420) * env(n(0.9), 0.004, 0.3, 3.5), tone(np.linspace(90, 35, n(0.6)), 0.6) * env(n(0.6), 0.002, 0.2) * 0.8), 0.9)
# A magic bolt: a rising shimmer.
save("magic", mix(*(tone(np.linspace(600 * k, 1300 * k, n(0.35)), 0.35) * env(n(0.35), 0.01, 0.12) * (0.5 / k) for k in (1, 1.5, 2.01))), 0.45)
# Frost: a glassy chime.
save("frost", mix(*(tone(f, 0.5) * env(n(0.5), 0.002, 0.15, 5) for f in (1760, 2637, 3520))), 0.4)
# A hit: a short dull knock.
save("hit", lowpass(noise(0.08), 1500) * env(n(0.08), 0.001, 0.02), 0.35)
# A death: a squeaky drop and a puff.
save("death", mix(tone(np.linspace(700, 180, n(0.22)), 0.22, "square") * env(n(0.22), 0.002, 0.08) * 0.35, lowpass(noise(0.3), 1200) * env(n(0.3), 0.005, 0.1) * 0.6), 0.45)
# A coin: two bright notes.
save("coin", notes([1318, 1976], 0.06, "square", 0.12), 0.35)
# Building: hammer knocks and a settling thud.
save("build", mix(*(np.concatenate([np.zeros(n(0.09 * i)), lowpass(noise(0.07), 2200) * env(n(0.07), 0.001, 0.02)]) for i in range(3)), np.concatenate([np.zeros(n(0.3)), tone(np.linspace(160, 70, n(0.25)), 0.25) * env(n(0.25), 0.002, 0.08)])), 0.7)
# Upgrading: a rising arpeggio.
save("upgrade", notes([523, 659, 784, 1046, 1318], 0.07, "tri", 0.3), 0.55)
# Selling: a falling pair of coins.
save("sell", notes([1568, 1175, 880], 0.07, "square", 0.12), 0.35)
# A click.
save("click", tone(1400, 0.03, "tri") * env(n(0.03), 0.001, 0.01), 0.35)
# Refused: a low buzz.
save("nope", tone(150, 0.22, "square") * env(n(0.22), 0.004, 0.12) * (1 + 0.3 * tone(30, 0.22)), 0.4)
# An enemy through the gate: a low alarm.
save("leak", mix(tone(np.linspace(330, 220, n(0.35)), 0.35, "square") * env(n(0.35), 0.005, 0.15) * 0.5, lowpass(noise(0.35), 500) * env(n(0.35), 0.002, 0.1)), 0.6)
# The wave horn: two rising brassy notes.
horn = lambda f, s: sum(tone(f * k, s, "tri") / k for k in (1, 2, 3)) * env(n(s), 0.06, s * 0.9, 1.5)
save("horn", np.concatenate([horn(196, 0.3), horn(262, 0.6)]), 0.6)
# Winning: a fanfare.
save("win", notes([523, 659, 784, 1046, 784, 1046, 1318], 0.12, "tri", 0.45), 0.6)
# Losing: a sad descent.
save("lose", notes([392, 370, 349, 262], 0.28, "tri", 0.6), 0.6)
# A star landing.
save("star", notes([1046, 1568, 2093], 0.05, "tri", 0.3), 0.45)
print("written to", OUT)
