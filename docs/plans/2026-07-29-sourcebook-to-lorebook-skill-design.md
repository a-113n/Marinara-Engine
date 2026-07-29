# Sourcebook → Lorebook + DM Card — Skill Design

- **Date:** 2026-07-29
- **Status:** Approved (brainstorm complete)
- **Branch:** `feat/sourcebook-to-lorebook-skill` (off `origin/staging`)
- **Skill location:** `.agents/skills/sourcebook-to-lorebook/` (registered in `skills-lock.json`)

## Goal

A **pi-agent skill** that converts an RPG sourcebook PDF into two **native Marinara Engine** artifacts:

1. A **lorebook** (world facts, entities, rules, mechanics) — native Marinara lorebook JSON with chapter-folders, tags, vectorization.
2. A **DM character card** — a native `chara_card_v2` with Marinara `extensions`, specialized from a bundled *generic* base DM card using the sourcebook's "how to run the game" material (tone, narration style, fiction inspiration, turn/step procedures, pacing).

The DM card targets **Roleplay/Conversation mode** (a real, importable character that narrates and referees). The same card can later be fed into Game Mode as `gmCharacterCard` if desired.

## Why a skill (not a server feature)

Chosen as a **pi-agent skill** (option A): a reusable `SKILL.md` + helper scripts + reference rubrics, driven by an AI agent. It reuses Marinara's existing infrastructure rather than adding product surface:

- **PDF text extraction already exists** via `pdf-parse` (used in `packages/server/src/routes/knowledge-sources.routes.ts`: `new PDFParse({ data }).getText()`).
- **Native create paths already exist** — `POST /api/characters` (`createCharacterSchema = { data: CharacterData }`) and lorebook create + entry-create endpoints.
- The novel work is the **LLM extraction** step (unstructured prose → structured, keyable entries), which is inherently prompt-driven.

## Operating mode: outline-gated

One human checkpoint after Phase 1. The partition decision (world-facts → lorebook vs. run-the-game → DM card) is cheap to fix on an outline and expensive to fix after entries are generated.

## Outputs (native Marinara JSON, not ST-format intermediates)

| Artifact | Format | Lands via |
|---|---|---|
| DM card | Native `chara_card_v2` + Marinara `extensions` | `POST /api/characters { data }` |
| Lorebook | Native Marinara lorebook (folders/tags/vectorization/relationships) | `POST /api/lorebooks` + entry-create |

The skill writes these as **inspectable JSON files** in `.tmp/sourcebook-<slug>/` first (human-in-the-loop), then POSTs to the running server's create endpoints if it is up — printing file paths + import instructions otherwise. An ST "compatible" export remains available only as a fallback for sharing cards outside Marinara.

**Rationale for native over ST-format:** Marinara's native character card *is* `chara_card_v2` JSON, but with a richer `extensions` object (`backstory`, `appearance`, `depth_prompt`, `rpgStats`, color fields) — the "more parts" worth populating. Native lorebooks are meaningfully richer than the ST World Info subset (`importSTLorebook` consumes): folders, scope, tags, per-entry `tag`/`category`/`relationships`/`activationConditions`, vectorization settings, `locked` flags.

## Pipeline (5 phases, gated)

| Phase | What happens | Human? |
|---|---|---|
| **1. Ingest & outline** | Extract PDF text → detect chapter structure → build a **partition plan** (per section: `lorebook` / `dm-card` / `discard`, + entry-count estimate). | ✅ **Gate:** approve/edit |
| **2. Extract** | Per chunk: LLM pulls candidate lorebook entries (name, content, description, keys, category, tag) **and** DM-card fragments (tone, narration, fiction, procedures). | auto |
| **3. Consolidate** | Dedupe across chapters, merge fragments, finalize distinctive keys, enforce token budget. | auto |
| **4. Author DM card** | Apply DM profile to the bundled **base DM card template** → specialized native V2 card. | auto |
| **5. Emit** | Write importable artifacts + import instructions (or POST to running server). | auto |

## Partition rubric

| Sourcebook content | Bucket |
|---|---|
| Tone & mood, narration style, fiction inspirations, "how to run", turn/round/step procedures, pacing, when-to-roll, fail-forward, NPC portrayal, session/arc advice | **DM card** |
| Geography, history, factions, religions, NPCs, creatures/bestiary, magic systems, spells, items, races/cultures, cosmology, world-rules | **Lorebook** |
| OGL/legal, ToC/indexes (used for outline only), blank sheets, ads/credits, page chrome | **Discard** |

**Judgment-call rule:** content that is *both* world-fact *and* tone → split it. "Magic is rare and feared" → a lorebook entry (keyword-activatable) **and** a sentence in `personality`. Don't lose either side. Procedures that reference world facts ("when encountering the Crowned, roll X") → split: the entity → lorebook, the procedure → DM `system_prompt`.

## DM-card field mapping

| Native field | Holds |
|---|---|
| `system_prompt` | Turn/step resolution flow, when-to-roll, pacing procedures |
| `post_history_instructions` | Persistent referee directives (stay lorebook-consistent, voice NPCs, don't railroad) |
| `extensions.depth_prompt` | Shallow-depth nudge (e.g. depth 1: "confirm player intent, consult active lorebook entries") |
| `personality` | Narration style/voice/register/POV + tone dial |
| `description` + `extensions.backstory` | DM identity + condensed world premise |
| `tags` | sourcebook name, system, `DM`, `AI-Game-Master`, genre |
| `creator_notes` | Provenance: "Generated from \<Sourcebook\> by sourcebook-to-lorebook skill on \<date\>" |
| `first_mes` (optional) | Opening narrator hook that establishes tone |

## Lorebook entry mapping + token/activation discipline

Each entry: `name`, concise reference `content` (not raw prose), one-line `description` (for the knowledge-router), distinctive `keys` + `secondaryKeys`, `category` (world/character/npc/spellbook), `tag` (location/character/item/faction/lore/magic/creature/event), `folderId` = **one folder per chapter**, and `relationships` linking related entries.

**Two discipline rules (make-or-break for a sourcebook lorebook):**

1. **Token budget.** A sourcebook is hundreds of entries. Set lorebook `tokenBudget` ≈ 4096–6144, `entryLimit` generous; lean on **keyword activation + recursive scanning + vectorization** (`excludeFromVectorization=false`) so only relevant entries inject per turn. Cap `constant` (always-on) entries at ≤5 (cosmology, magic-system summary, current era) — everything else keyword/selective.
2. **Key quality.** Keys must be distinctive nouns/names, lowercase, with aliases/plurals/variants. Avoid lone generic words ("king", "magic") — pair them with `secondaryKeys` + `selective` logic to prevent false triggers.

## Skill file structure

```
.agents/skills/sourcebook-to-lorebook/
  SKILL.md                     # frontmatter (name + description) + full 5-phase workflow + phase-1 gate
  reference/
    base-dm-card.json          # complete, ready-to-import GENERIC RPG DM card (native chara_card_v2 + extensions); Phase 4 copies + overrides
    partition-rubric.md        # the routing table above
    dm-card-field-map.md       # run-the-game content → native field
    extraction-schema.md       # exact JSON shapes the LLM must emit (entries + DM fragments)
    marina-create-paths.md     # POST /api/characters, /api/lorebooks (+entries); token-budget & vectorization guidance
  scripts/
    extract-pdf.mjs            # pdf-parse → text + page boundaries; detects scanned/image-only PDFs
    validate-artifacts.mjs     # lightweight structural check of emitted JSON before import
```

Split: **deterministic steps are scripts** (PDF parse, validation); **judgment steps are prompt-driven** rubrics the agent follows.

## Error handling (fail gracefully, don't fabricate)

- **Scanned / encrypted PDF** → `extract-pdf.mjs` detects (text length vs page count) → stop with a clear message (OCR is out of scope for v1).
- **LLM malformed JSON** → one repair-and-retry with the schema fed back; still bad → skip chunk + log.
- **No "run-the-game" content found** → ship the base DM card unchanged + flag in `creator_notes`; never invent procedures.
- **Entry explosion / cross-chapter duplicates** → consolidation pass dedupes by normalized name, unions keys; hard cap + warn.
- **Server down at emit** → write files + print import instructions (POST deferred).

## Testing / verification

Respecting AGENTS.md's "no committed `.test.ts`": an end-to-end smoke against a small `reference/sample-sourcebook.md` fixture → confirm both artifacts import cleanly into a running Marinara (character + lorebook with chapter-folders appear) → a short DM chat confirms tone matches **and** a lorebook entry activates on its keyword (check the Active Context panel). `validate-artifacts.mjs` is a helper script, not a test file, so it stays.

## Out of scope (v1 YAGNI)

- OCR for scanned PDFs (detect + fail gracefully only)
- Auto-generating avatars/sprites for the DM card
- Embedding the lorebook inside the DM card's `character_book`
- Structured `extensions.rpgStats` parsing (stats go in entry `content` as reference text)
- Re-run / idempotent updates to an existing lorebook

## Implementation references (repo facts)

- PDF extraction pattern: `packages/server/src/routes/knowledge-sources.routes.ts` (`new PDFParse({ data }).getText()`, page-boundary handling, scanned-PDF heuristic).
- Character data model: `packages/shared/src/types/character.ts` (`CharacterData`, `CharacterExtensions` incl. `backstory`/`appearance`/`depth_prompt`/`rpgStats`).
- Character create schema: `packages/shared/src/schemas/character.schema.ts` (`createCharacterSchema = { data: characterDataSchema }`, passthrough).
- Lorebook schema: `packages/server/src/db/schema/lorebooks.ts` (entries incl. `folderId`, `relationships`, `tag`, `category`, vectorization fields).
- Lorebook category vocabulary: `LorebookCategory` = world/character/npc/spellbook/uncategorized; entry-tag signals in `st-lorebook.importer.ts` `detectEntryTag`.
- Skill format precedent: `.agents/skills/impeccable/` (frontmatter `name`+`description`, `reference/*.md`, `scripts/*.mjs`, `skills-lock.json`).

## Git

Skill files + this doc live on `feat/sourcebook-to-lorebook-skill` (off `origin/staging`), per AGENTS.md. Worktree: `~/worktrees/marinara-engine/sourcebook-to-lorebook`. Rebase onto fresh `origin/staging` before opening a PR.
