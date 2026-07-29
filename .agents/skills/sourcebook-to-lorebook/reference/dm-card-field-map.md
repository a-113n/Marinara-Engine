# DM Card Field Map

How Phase 4 applies the consolidated **DM profile** (from Phase 3 DM fragments) to the bundled base card (`reference/base-dm-card.json`). Load the base card, then apply sourcebook-specific overrides field by field.

## Fragment field → native card field

| DM fragment field | Native card field | How to apply |
|---|---|---|
| `tone` | `data.personality` (prepend/tune) | Add a tone directive; dial the base "dramatic-but-fair" toward the sourcebook's mood. |
| `narrationStyle` | `data.personality` | Replace/augment the narration guidance (POV, register, sensory emphasis). |
| `fictionInspirations` | `data.personality` + `data.creator_notes` | "Channel the feel of X meets Y." |
| `procedures` | `data.system_prompt` | **Replace** the generic "RUNNING THE GAME" block with the sourcebook's turn/step procedure, preserving the referee framing. |
| `pacing` | `data.system_prompt` (append) | Add a pacing directive to the procedure block. |
| *(implied)* | `data.post_history_instructions` | Refine the persistent referee directive with sourcebook-specific consistency rules (e.g. "honor the rarity of magic"). |
| *(implied)* | `data.extensions.depth_prompt` | Tune the shallow-depth nudge if the procedures introduce a per-turn check (e.g. "before resolving, confirm the approach matches the declared intent"). |
| *(implied)* | `data.name` | Optional: a sourcebook-specific GM title ("The Loremaster", "Your Warden"). Default: keep "The Game Master". |
| *(implied)* | `data.extensions.backstory` | A 1–2 paragraph condensed world premise to ground the GM. |
| *(implied)* | `data.first_mes` | Optional opening narrator hook that establishes tone. |
| *(always)* | `data.tags` | Append the sourcebook name, the game system, genre, and keep `DM`/`AI-Game-Master`. |
| *(always)* | `data.creator_notes` | Provenance: `"Generated from <Sourcebook Title> by the sourcebook-to-lorebook skill on <date>."` |

## Merge rule (critical)

**Sourcebook evidence overrides only the fields it has evidence for. Base-card defaults are preserved wherever the sourcebook is silent.** Concretely:

- If fragments supply `procedures` → replace `system_prompt`'s running-game block. If they don't → keep the base block verbatim.
- If fragments supply `tone`/`narrationStyle` → rewrite `personality`. If not → keep the base personality.
- Always set `tags` (append, don't replace) and `creator_notes` (replace with provenance).
- Never blank a base field. Never invent procedures the sourcebook doesn't contain.

## Fallback: no run-the-game content found

If Phase 3 produced **no** DM fragments (the sourcebook had no "how to run" material), **ship the base DM card unchanged** and set:

```json
"data": {
  "creator_notes": "Generated from <Sourcebook> by the sourcebook-to-lorebook skill. NOTE: no 'how to run the game' section was found; this is the generic base DM card unmodified. Add narration/tone guidance manually.",
  "tags": ["DM", "AI-Game-Master", "no-run-the-game-content"]
}
```

Do not fabricate procedures. The human is told to add them by hand.
