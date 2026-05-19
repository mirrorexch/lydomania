"""
Procedurally generate the Phase 4a SFX pack as 16-bit mono WAV files.

Why generate rather than ship third-party samples?
  • 100% CC0 — math output is uncopyrightable; we author the generator script.
  • Tiny binaries (each file 5–80 KB at 22.05 kHz mono).
  • Reproducible — running this script always produces byte-identical output.

Run once:    `cd /app/backend && python tools/generate_sfx.py`
Output:      `/app/frontend/public/sfx/*.wav`
"""
from __future__ import annotations

import math
import os
import random
import struct
import wave
from pathlib import Path

OUT_DIR = Path("/app/frontend/public/sfx")
OUT_DIR.mkdir(parents=True, exist_ok=True)

SR = 22050  # sample rate (lower = smaller files; plenty for chimes)


def _write_wav(path: Path, samples: list[float]) -> None:
    # Normalize to [-0.95, 0.95]
    peak = max((abs(s) for s in samples), default=0.0001)
    scale = (0.95 / peak) if peak > 0 else 1.0
    pcm = bytearray()
    for s in samples:
        v = int(max(-32767, min(32767, s * scale * 32767)))
        pcm += struct.pack("<h", v)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(bytes(pcm))


def _adsr(n: int, a: float, d: float, s: float, r: float) -> list[float]:
    """Attack/Decay/Sustain/Release envelope of length n samples, values 0..1."""
    a_n = max(1, int(a * n))
    d_n = max(1, int(d * n))
    r_n = max(1, int(r * n))
    s_n = max(0, n - a_n - d_n - r_n)
    out: list[float] = []
    for i in range(a_n):
        out.append(i / a_n)
    for i in range(d_n):
        out.append(1.0 - (1.0 - s) * (i / d_n))
    out += [s] * s_n
    for i in range(r_n):
        out.append(s * (1.0 - i / r_n))
    return out[:n]


def _sine(freq: float, n: int, phase: float = 0.0) -> list[float]:
    return [math.sin(2 * math.pi * freq * i / SR + phase) for i in range(n)]


def _saw(freq: float, n: int) -> list[float]:
    return [2 * ((freq * i / SR) % 1.0) - 1.0 for i in range(n)]


def _noise(n: int, seed: int = 1) -> list[float]:
    rng = random.Random(seed)
    return [(rng.random() * 2 - 1) for _ in range(n)]


def _mix(*tracks: list[float]) -> list[float]:
    n = max(len(t) for t in tracks)
    out = [0.0] * n
    for t in tracks:
        for i, v in enumerate(t):
            out[i] += v
    return out


def _apply(env: list[float], wave_: list[float]) -> list[float]:
    n = min(len(env), len(wave_))
    return [env[i] * wave_[i] for i in range(n)]


def _exp_decay(n: int, tau: float) -> list[float]:
    return [math.exp(-i / (tau * SR)) for i in range(n)]


def _bell(freq: float, n: int, harmonics=(1.0, 2.0, 3.0, 4.1), amps=(1.0, 0.5, 0.25, 0.12)) -> list[float]:
    """Bell timbre: fundamental + partials with individual exponential decays."""
    out = [0.0] * n
    for h, a in zip(harmonics, amps):
        tau = 0.35 / h  # higher partials decay faster
        env = _exp_decay(n, tau)
        wav = _sine(freq * h, n)
        for i in range(n):
            out[i] += a * env[i] * wav[i]
    return out


def scroll_tick() -> list[float]:
    """Short percussive click — 30ms high-freq noise burst."""
    n = int(0.030 * SR)
    env = _adsr(n, 0.05, 0.2, 0.0, 0.75)
    nz = _noise(n, seed=42)
    # Light low-pass: average pairs
    nz = [(nz[i] + nz[i - 1]) / 2 if i else nz[0] for i in range(n)]
    return _apply(env, nz)


def coin_drop() -> list[float]:
    """Two-tone metallic ping (sell/credit)."""
    n = int(0.32 * SR)
    a = _apply(_exp_decay(n, 0.16), _sine(880, n))
    b = _apply(_exp_decay(int(0.85 * n), 0.14), _sine(1320, int(0.85 * n)))
    return _mix(a, b)


def win_common() -> list[float]:
    """Soft single-note chime."""
    n = int(0.5 * SR)
    return _bell(523.25, n)  # C5


def win_rare() -> list[float]:
    """C5+E5 — major-third chime."""
    n = int(0.7 * SR)
    return _mix(_bell(523.25, n), _bell(659.25, n, amps=(0.7, 0.35, 0.18, 0.09)))


def win_epic() -> list[float]:
    """C-major triad + brighter top partial."""
    n = int(0.9 * SR)
    return _mix(
        _bell(523.25, n),                 # C5
        _bell(659.25, n, amps=(0.7, 0.35, 0.18, 0.09)),  # E5
        _bell(783.99, n, amps=(0.6, 0.3, 0.15, 0.08)),   # G5
    )


def win_legendary() -> list[float]:
    """Regal arpeggio (G3 → C4 → E4 → G4 → C5) with sustain pad."""
    n_each = int(0.08 * SR)
    arp_freqs = [196.0, 261.63, 329.63, 392.0, 523.25]
    arp = []
    for f in arp_freqs:
        env = _adsr(n_each, 0.05, 0.3, 0.4, 0.6)
        arp += _apply(env, _sine(f, n_each))
    # Sustain chord overlay
    n_pad = int(1.2 * SR)
    pad = _mix(
        _apply(_exp_decay(n_pad, 0.5), _sine(261.63, n_pad)),  # C4
        _apply(_exp_decay(n_pad, 0.5), _sine(329.63, n_pad)),  # E4
        _apply(_exp_decay(n_pad, 0.5), _sine(392.00, n_pad)),  # G4
    )
    # Concatenate then mix the pad starting at the arpeggio end
    full = arp + [0.0] * n_pad
    for i in range(n_pad):
        if len(arp) + i < len(full):
            full[len(arp) + i] += pad[i] * 0.6
    return full


def win_mythic() -> list[float]:
    """Triumphant 'orchestral hit': brass-like impact + cymbal swell + bell tail."""
    total = int(1.8 * SR)
    # Layer 1: brass impact = stacked saw with sharp envelope
    impact_n = int(0.4 * SR)
    impact_env = _adsr(impact_n, 0.005, 0.2, 0.5, 0.6)
    impact = _mix(
        _apply(impact_env, _saw(130.81, impact_n)),  # C3
        _apply(impact_env, _saw(164.81, impact_n)),  # E3
        _apply(impact_env, _saw(196.00, impact_n)),  # G3
        _apply(impact_env, _saw(261.63, impact_n)),  # C4
    )
    # Layer 2: cymbal swell — band-passed noise
    swell_n = int(0.6 * SR)
    nz = _noise(swell_n, seed=7)
    # Crude high-pass (subtract running average)
    avg = 0.0
    hpf: list[float] = []
    for v in nz:
        avg = avg * 0.97 + v * 0.03
        hpf.append(v - avg)
    swell_env = _adsr(swell_n, 0.4, 0.3, 0.2, 0.3)
    swell = _apply(swell_env, hpf)
    # Layer 3: bell tail (long)
    tail_n = total - int(0.1 * SR)
    tail = _bell(523.25, tail_n, harmonics=(1, 2, 3, 5, 7), amps=(1.0, 0.7, 0.4, 0.2, 0.1))
    # Compose: impact at 0, swell at 0, tail at 0.05s
    out = [0.0] * total
    for i, v in enumerate(impact):
        if i < total: out[i] += v
    for i, v in enumerate(swell):
        if i < total: out[i] += v * 0.45
    offset = int(0.05 * SR)
    for i, v in enumerate(tail):
        if i + offset < total: out[i + offset] += v * 0.6
    return out


def confetti_burst() -> list[float]:
    """Stochastic high-pitched pop cluster (overlay for legendary+ wins)."""
    total = int(0.6 * SR)
    out = [0.0] * total
    rng = random.Random(123)
    for _ in range(12):
        start = rng.randint(0, int(0.3 * SR))
        n = int(0.06 * SR)
        f = 1500 + rng.random() * 1500
        env = _adsr(n, 0.01, 0.3, 0.0, 0.7)
        wav = _apply(env, _sine(f, n))
        for i, v in enumerate(wav):
            if start + i < total: out[start + i] += v * 0.4
    return out


def promo_redeem() -> list[float]:
    """Bright two-step rising chime — promo code success ping."""
    n_step = int(0.18 * SR)
    env = _adsr(n_step, 0.02, 0.25, 0.4, 0.6)
    # G5 → C6, both with overtone for brightness
    g5 = _mix(_apply(env, _sine(783.99, n_step)),
              _apply(env, _sine(1567.98, n_step)))  # 2nd harmonic
    c6 = _mix(_apply(env, _sine(1046.50, n_step)),
              _apply(env, _sine(2093.00, n_step)))
    out = g5 + c6
    return out


def battle_start() -> list[float]:
    """Placeholder for 6d — bold horn-like 2-note fanfare (C3 → G3)."""
    total = int(0.9 * SR)
    n_each = int(0.42 * SR)
    env1 = _adsr(n_each, 0.04, 0.25, 0.5, 0.55)
    env2 = _adsr(n_each, 0.04, 0.20, 0.55, 0.6)
    # Stacked saws for brass-like timbre
    note1 = _mix(
        _apply(env1, _saw(130.81, n_each)),    # C3
        _apply(env1, _saw(196.00, n_each)),    # G3 (fifth)
    )
    note2 = _mix(
        _apply(env2, _saw(196.00, n_each)),    # G3
        _apply(env2, _saw(261.63, n_each)),    # C4
        _apply(env2, _saw(392.00, n_each)),    # G4
    )
    out = [0.0] * total
    for i, v in enumerate(note1):
        if i < total: out[i] += v * 0.6
    offset = int(0.4 * SR)
    for i, v in enumerate(note2):
        if i + offset < total: out[i + offset] += v * 0.75
    return out


def free_case_ready() -> list[float]:
    """Soft notification ping — two short bells, descending then resolving."""
    n = int(0.55 * SR)
    # E5 short pluck → C5 sustain → confirm
    pluck = _apply(_exp_decay(int(0.15 * SR), 0.08), _sine(659.25, int(0.15 * SR)))
    resolve = _bell(523.25, int(0.45 * SR), amps=(0.8, 0.4, 0.18, 0.08))
    out = [0.0] * n
    for i, v in enumerate(pluck):
        if i < n: out[i] += v * 0.7
    offset = int(0.13 * SR)
    for i, v in enumerate(resolve):
        if i + offset < n: out[i + offset] += v * 0.65
    return out


GENERATORS = {
    "scroll_tick.wav": scroll_tick,
    "coin_drop.wav": coin_drop,
    "win_common.wav": win_common,
    "win_rare.wav": win_rare,
    "win_epic.wav": win_epic,
    "win_legendary.wav": win_legendary,
    "win_mythic.wav": win_mythic,
    "confetti_burst.wav": confetti_burst,
    "promo_redeem.wav": promo_redeem,
    "battle_start.wav": battle_start,
    "free_case_ready.wav": free_case_ready,
}


def main() -> None:
    for fname, gen in GENERATORS.items():
        samples = gen()
        path = OUT_DIR / fname
        _write_wav(path, samples)
        print(f"  wrote {path.name:24s}  {path.stat().st_size / 1024:6.1f} KB  ({len(samples)} samples)")


if __name__ == "__main__":
    main()
