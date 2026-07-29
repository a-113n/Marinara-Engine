# Extraction Schema

The exact JSON shapes the agent must emit at each phase. **Always emit valid JSON.** No prose outside the JSON, no trailing commas, no comments. If a field is unknown, omit it rather than guessing.

## Phase 2 — Candidate lorebook entries (one per discrete fact in a `lorebook` chunk)

```json
{
  "name": "The Shattered Coast",
  "content": "Concise reference text — facts and keywords a GM needs, not raw prose. Bullet points and short clauses are encouraged.",
  "description": "One-line summary for the knowledge-router (what this entry is about).",
  "keys": ["shattered coast", "the coast", "coastline"],
  "secondaryKeys": ["harbor town", "saltmarsh"],
  "category": "world",
  "tag": "location",
  "chapter": "Chapter 3: The Shattered Coast",
  "relationships": ["Saltmarsh (settlement)", "The Crowned (creature)"],
  "selective": true,
  "logic": "and"
}
```

Field rules:

- `name` — proper-noun or distinctive noun phrase. Unique within the lorebook.
- `content` — **reference, not narration.** Strip flavor prose; keep facts, numbers, relationships, mechanics. Keep it tight (target a few sentences to a short list).
- `description` — ≤1 sentence. The knowledge-router reads this to decide whether to activate the entry.
- `keys` — **distinctive nouns/names, lowercase**, plus aliases/plurals/variants. See Key-quality rules below.
- `secondaryKeys` — narrower terms paired with `keys` when a key alone is too generic (use `selective: true` + `logic`).
- `category` — one of `world` | `character` | `npc` | `spellbook` | `uncategorized`.
- `tag` — one of `location` | `character` | `item` | `faction` | `lore` | `magic` | `creature` | `event`.
- `chapter` — the section title this came from (used to assign `folderId`: one folder per chapter).
- `relationships` — array of other entries' names this connects to. This is an **authoring alias**: emit (Phase 5) maps it to the native `Record<string,string>` form (`name → descriptor`, e.g. `{"That Which Was Marlene": "related"}`). Consolidation (Phase 3) makes the set bidirectional.
- `selective` / `logic` — set `selective: true` when `keys` are generic and must co-occur with a `secondaryKey` to avoid false triggers. `logic` is an **authoring alias** for the native `selectiveLogic` enum (`and` | `and_all` | `or` | `not` | `not_all`); emit renames `logic → selectiveLogic`. Do NOT POST a `logic` field directly.

## Phase 2 — DM fragments (one bundle per `dm-card` chunk)

```json
{
  "tone": "Grim, noir, low-fantasy; consequences bite; hope is scarce but earned.",
  "narrationStyle": "Tight third-person, sensory-first; favor concrete detail over exposition; let silence do work.",
  "fictionInspirations": ["The First Law", "The Witcher", "Blood Meridian"],
  "procedures": "Declare intent -> state approach -> resolve (success / partial / failure-with-cost) -> narrate consequence -> advance the clock. Call for a roll only when the outcome is uncertain AND the stakes matter.",
  "pacing": "Front-load a concrete threat or question per scene; cut when the decision is made, not when the description is done.",
  "source": "Chapter 1: Running the Game"
}
```

Omit any field the sourcebook doesn't actually cover. Do not invent.

## Phase 3 — Consolidation rules

Run these over the union of all Phase 2 outputs:

1. **Dedupe by normalized name.** Normalize each `name` to lowercase, strip punctuation/articles. Entries whose normalized names match are the same entity → merge.
2. **Union keys.** Merge duplicate entries' `keys`, `secondaryKeys`, and `relationships` (dedupe within each).
3. **Merge content** intelligently — combine into one tight reference, not a concatenation of both. Prefer the more specific/complete phrasing.
4. **Resolve category/tag conflicts** — prefer the **most specific** (e.g. `npc` over `character`; `creature` over `lore`).
5. **Cross-chapter duplicates** are expected (an NPC re-summarized in a later chapter). Merge them; keep the union of keys so the entry activates from any angle.
6. **Relationships are bidirectional** — if A lists B, ensure B lists A.
7. **Token-budget enforcement** — after consolidation, estimate total entry content size; if it grossly exceeds the budget, that's expected (activation handles it). Do **not** delete entries to fit the budget — instead ensure only ≤5 are `constant`, and the rest are keyword/selective.

## Key-quality rules (make-or-break for activation accuracy)

- Keys must be **distinctive nouns/names**, lowercase. Prefer proper nouns and specific terms.
- Provide **aliases, plurals, and common variants** (e.g. `["shattered coast", "the coast", "coastline"]`).
- **Never** use a lone generic word as a key (`king`, `magic`, `sword`, `city`). Generic words cause false triggers across the whole lorebook. Instead pair them with a `secondaryKey` and `selective: true` + `logic: "and"`:
  - Bad: `keys: ["king"]`
  - Good: `keys: ["king"], secondaryKeys: ["ironhold"], selective: true, logic: "and"` — activates only when both "king" and "ironhold" appear.
- If a key is a common English word, it almost certainly needs a `secondaryKey`.

## Token-budget & activation discipline

- Lorebook-level: set `tokenBudget` to **4096–6144**, `recursiveScanning: true`, `excludeFromVectorization: false`, with sensible `vectorQueryDepth` / `vectorScoreThreshold` / `vectorMaxResults`.
- Cap **`constant` (always-on) entries at ≤5** — cosmology, the magic-system summary, the current era. Everything else must be **keyword** or **selective**.
- The goal: only the entries relevant to *this turn* inject, chosen by keyword + vector recall — so a 300-entry sourcebook lorebook stays affordable turn by turn.
