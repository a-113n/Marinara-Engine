# Partition Rubric

The routing rules the agent applies to **every** sourcebook section in Phase 1 (build the outline) and Phase 2 (extract). For each section, decide one bucket: `dm-card`, `lorebook`, or `discard`.

## Partition table

| Sourcebook content | Bucket |
|---|---|
| Tone & mood, narration style, fiction inspirations, "how to run", turn/round/step procedures, pacing, when-to-roll, fail-forward, NPC portrayal, session/arc advice | **dm-card** |
| Geography, history, factions, religions, NPCs, creatures/bestiary, magic systems, spells, items, races/cultures, cosmology, world-rules | **lorebook** |
| Pregenerated player characters or NPCs | **roster** (emit via roster runner; ask the user) |
| OGL/legal text, table of contents & indexes (used for outline only, not imported), blank character sheets, ads/credits, running headers/footers & page chrome | **discard** |

## Bucket definitions

- **`dm-card`** — *how to run the game*. Procedural and tonal guidance the Game Master needs in every turn.
- **`lorebook`** — *facts about the world*. Discrete, nameable things a player's action might touch and the GM must recall on demand.
- **`roster`** — *pregenerated characters*. Pregenerated player characters or NPCs. Emit via a separate `roster-data.mjs` + `save-roster.mjs` runner (see Phase 5 supplement notes). Save to a named group (e.g. the sourcebook title). Ask the user whether to save pregens.
- **`discard`** — *not game content*. Procedural and tonal guidance the Game Master needs in every turn: how to narrate, when to call for rolls, how to pace, what tone to strike. This material shapes the card's `system_prompt`, `personality`, and `post_history_instructions`. It is general to the *whole game*, not a specific fact the players look up.
- **`lorebook`** — *facts about the world*. Discrete, nameable things a player's action might touch and the GM must recall on demand: places, people, creatures, factions, spells, items, rules-subsystems. Each becomes a **keyword-activatable entry** so it injects only when relevant.
- **`discard`** — *not game content*. Legal text, navigation aids, fillers. Keep the ToC around only long enough to infer the chapter structure in Phase 1, then drop it.

## Supplement-mode routing

A **supplement** is a sourcebook that adds world facts to an existing lorebook (e.g. a campaign book adding locations/NPCs/creatures to a core world's lorebook, or an operations collection adding scenarios to a parent game).

In supplement mode:
- Default `existingLorebook` is detected from the Setup gate's lorebook probe.
- Sections that are **world facts** → `lorebook` bucket, `supplementTo: <parent-id>`.
- Sections that are **how to run the game** → `dm-card` bucket (the DM card is always independent; it supplements the existing Handler card, not the lorebook).
- Sections that are **pregenerated characters** → `roster` bucket.
- Operations/scenarios that are **world facts** → `lorebook`, not `dm-card`. Scenario-execution guidance goes into the DM card's `procedures`, not the lorebook.

## Judgment-call rules

**1. Dual-purpose content (world-fact AND tone) → split it.** Don't collapse one into the other; capture both.

> Example — *"Magic is rare and feared; common folk mistrust mages."*
> - → **lorebook entry** (keyword-activatable): `name: "Magic and Mistrust"`, `keys: ["magic","mage","sorcery","arcane"]`, `category: world`, `tag: lore` — the factual rule a turn might invoke.
> - → **`personality` sentence**: a tone directive — "Magic is rare and feared; depict commonfolk's mistrust of mages in narration." — so the mood colors every scene.

**2. Procedures that reference world facts → split along the same seam.** The entity goes to the lorebook; the *procedure* for resolving it goes to `system_prompt`.

> Example — *"When a character encounters a Crowned, roll X vs Y."*
> - → **lorebook entry**: the Crowned (what they are, stats, behavior).
> - → **`system_prompt` fragment**: the encounter-resolution procedure ("when encountering the Crowned, roll X vs Y").

**3. When genuinely ambiguous, prefer `lorebook`.** A discrete, named thing is easier to relocate to the card later than to mine out of a wall of procedure text. Reserve `dm-card` for guidance that is clearly about *running* the game.

**4. Never invent.** If a section promises "how to run the game" but contains only fluff, mark it `discard` — do not fabricate procedures.

## Partition-plan output shape (Phase 1)

The Phase 1 outline is a JSON object the agent builds from the extracted text and then presents to the user for the gating checkpoint:

```json
{
  "sourcebook": "<title>",
  "existingLorebook": { "id": "<id>", "name": "<name>", "action": "supplement" },
  "sections": [
    {
      "title": "Chapter 3: The Shattered Coast",
      "pageRange": "42-61",
      "bucket": "lorebook",
      "reason": "regional geography, settlements, one creature stat block",
      "estEntries": 12,
      "supplementTo": "<existing-lorebook-id>"
    }
  ]
}
```

- `existingLorebook` → omit to create a new standalone lorebook; include to supplement an existing one.
- `sections[].supplementTo` → optionally override the default existing lorebook for a specific section (useful if a supplement spans multiple parent lorebooks).
- `bucket: "roster"` → pregenerated characters/NPCs. Emit via a separate roster runner (not the main emit).


The human may edit `bucket`, `estEntries`, or `existingLorebook` per section before Phase 2 begins.
