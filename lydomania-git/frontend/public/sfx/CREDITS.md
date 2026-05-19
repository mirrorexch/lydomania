# Sound Effects · Credits

All sound files in this directory are **CC0 / public domain**.

## Origin

These samples are **procedurally generated** by
`/app/backend/tools/generate_sfx.py` using additive sine + sawtooth synthesis
with ADSR envelopes and noise shaping. No third-party samples were used.

Mathematical waveforms are not eligible for copyright in the United States,
United Kingdom, or European Union; the generator script is published as part
of this repository under the same license as the rest of Lydomania.

## Pack contents

| File | Use | Approx size |
| --- | --- | --- |
| `scroll_tick.wav` | Case-open scroll: tick per item passing center | ~1 KB |
| `coin_drop.wav` | Sell / credit-balance feedback | ~14 KB |
| `win_common.wav` | Win modal — Common rarity | ~22 KB |
| `win_rare.wav` | Win modal — Rare rarity | ~30 KB |
| `win_epic.wav` | Win modal — Epic rarity | ~39 KB |
| `win_legendary.wav` | Win modal — Legendary rarity (regal arpeggio) | ~50 KB |
| `win_mythic.wav` | Win modal — Mythic rarity (orchestral hit) | ~80 KB |
| `confetti_burst.wav` | Overlay on Legendary+ wins | ~26 KB |

## Regenerating

```bash
cd /app/backend && python tools/generate_sfx.py
```

The generator is deterministic (seeded RNG) — output is byte-identical
across runs.

## License

To the extent possible under law, the authors have dedicated all copyright
and related rights to these files to the public domain worldwide. See
<https://creativecommons.org/publicdomain/zero/1.0/>.
