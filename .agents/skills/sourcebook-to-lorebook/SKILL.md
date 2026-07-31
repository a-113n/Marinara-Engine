---
name: sourcebook-to-lorebook
description: "Use when the user wants to convert an RPG sourcebook PDF (or text) into a Marinara Engine lorebook and a DM character card. Extracts world facts into a native lorebook with chapter-folders, tags, and vectorization, and specializes a base DM character card with the sourcebook's tone, narration style, fiction inspiration, and turn/step procedures. Runs an outline-gated pipeline: builds a partition plan for human approval, then extracts, consolidates, authors the DM card, and emits native Marinara JSON artifacts. Not for non-sourcebook PDFs or OCR of scanned books."
---

# Sourcebook → Lorebook + DM Card

Convert an RPG sourcebook (PDF or text) into **two native Marinara Engine artifacts**:

1. A **lorebook** — world facts, entities, rules, mechanics → native Marinara lorebook JSON with chapter-folders, tags, and vectorization.
2. A **DM character card** — a native `chara_card_v2` with Marinara `extensions`, specialized from a bundled **generic base DM card** using the sourcebook's "how to run the game" material.

The DM card targets **Roleplay/Conversation mode** (a real, importable character that narrates and referees). Outline-gated: one human checkpoint after the partition plan, then autonomous through emit.

## Files in this skill

- `reference/base-dm-card.json` — the generic base DM card template (Phase 4 copies + overrides).
- `reference/partition-rubric.md` — routing rules (dm-card / lorebook / discard).
- `reference/extraction-schema.md` — exact JSON shapes to emit + key/token discipline.
- `reference/dm-card-field-map.md` — how DM fragments map to native card fields.
- `reference/marina-create-paths.md` — emit: file layout + create endpoints + server-down path.
- `scripts/extract-pdf.mjs` — PDF → text + scanned-PDF detection.
- `scripts/validate-artifacts.mjs` — structural validation of emitted JSON.

Paths below are relative to the skill directory (`../` reaches repo root).

## Setup gates (before Phase 1)

1. **Input.** Get a PDF path or pasted text from the user. If it's a PDF, you'll run `extract-pdf.mjs`. If text, write it to `.tmp/sourcebook-<slug>/source.md` directly.
2. **Slug.** Derive `<slug>` from the filename/title: lowercase, non-alphanumerics → `-`.
3. **Working dir.** `.tmp/sourcebook-<slug>/` at repo root (gitignored). All outputs land here.
4. **Base card.** Confirm `reference/base-dm-card.json` is readable.
5. **Server reachability.** Probe whether the Marinara server is up (e.g. a quick `GET /api/health` or similar). Remember the result for Phase 5 — it decides POST vs file-only. Don't block on it.
6. **Lorebook probe.** Probe `GET /api/lorebooks` to find existing lorebooks. If a matching lorebook exists (same franchise, same world, or the user already has a related lorebook), present it to the user and ask whether this sourcebook supplements it or creates a new standalone lorebook. This is the supplement-mode decision — cheap to make at the start, expensive to fix later.

## Phase 1 — Ingest & outline  ✅ GATE

**Goal:** produce a **partition plan** and get the user to approve it before any extraction.

### Supplement mode

Some sourcebooks are **supplements** — operations, adventures, or world guides that add to an existing lorebook rather than starting a new one. Examples: a campaign book that adds new locations/NPCs/creatures to a core world's lorebook, or a setting guide that extends a parent world.

In supplement mode:
- The partition plan includes an `existingLorebook` field identifying the target lorebook `id` and `name`.
- Phase 5 does **not** create a new lorebook shell — it POSTs folders and entries directly to the existing lorebook `id`.
- The DM card is still emitted normally (it is always independent).
- Chapter folders are created **inside** the existing lorebook.
- The agent should check whether a Delta Green / Star Trek / etc. lorebook already exists in the user's library before creating a new one. Ask the user or probe the server (`GET /api/lorebooks`) to find existing lorebooks.

### Partition plan additions for supplement mode

```json
{
  "existingLorebook": {
    "id": "<lorebook-id>",
    "name": "<existing lorebook name>",
    "action": "supplement"
  }
}
```

Each lorebook-section in the partition plan can also carry a `supplementTo` field (overriding the top-level default if needed).

### Probe for existing lorebooks

Before Phase 1, optionally probe the server:
```bash
curl -s -H "x-marinara-csrf: 1" "http://127.0.0.1:7860/api/lorebooks"
```
Present any matching lorebooks to the user and ask whether this sourcebook supplements one of them or creates a new standalone lorebook.

1. **Extract text.** If PDF, run from the repo root:
   ```bash
   node .agents/skills/sourcebook-to-lorebook/scripts/extract-pdf.mjs <pdf> --out .tmp/sourcebook-<slug>
   ```
   - Exit code `3` → scanned/image-only PDF → **stop**, tell the user OCR is required (out of scope). Do not proceed.
   - Otherwise, read `.tmp/sourcebook-<slug>/extracted.txt`.
   If the input is already text, just use it.
2. **Infer chapter/section structure.** Identify the table of contents, "Chapter N" headings, numbered sections, and page breaks. Map sections to approximate page ranges.
3. **Assign a bucket to every section** using `reference/partition-rubric.md` (`dm-card` / `lorebook` / `discard`). Estimate entry counts for `lorebook` sections.
4. **Emit the partition plan** in the shape from `reference/partition-rubric.md`. Include `existingLorebook` if supplementing a parent lorebook. Include a `roster` flag if pregen characters are present.
5. **🔴 PRESENT THE PLAN TO THE USER AND STOP.** Do not begin extraction until the user approves or edits it (they may flip buckets or adjust estimates). This is the one checkpoint — the partition decision is cheap to fix now and expensive after entries exist.

## Phase 2 — Extract

After approval, process sections **in order**, chunk by chunk (chapter-aware — use the section boundaries from Phase 1, not fixed-size windows).

- For each **`lorebook`** chunk: emit candidate entries following `reference/extraction-schema.md` (the candidate-entry shape). One entry per discrete, nameable fact. Respect the **key-quality rules** — distinctive lowercase nouns, aliases, and `secondaryKeys` + `selective` for generic words.
- For each **`dm-card`** chunk: emit one **DM fragment** bundle following `reference/extraction-schema.md` (the DM-fragment shape).
- Skip **`discard`** sections entirely (their text was only useful for the outline).
- **Malformed JSON?** You may attempt **one** repair-and-retry by re-reading the schema and re-emitting that chunk. Still bad → skip the chunk, log it, continue.

Collect all candidate entries into `.tmp/sourcebook-<slug>/candidates.json` and all DM fragments into `dm-fragments.json`.

## Phase 3 — Consolidate

Apply the consolidation rules in `reference/extraction-schema.md`:

1. Dedupe by normalized name (lowercase, strip punctuation/articles).
2. Union keys, secondaryKeys, relationships.
3. Merge content into one tight reference (not a concatenation).
4. Resolve category/tag conflicts — prefer the **most specific**.
5. Merge cross-chapter duplicates (expected); keep the union of keys.
6. Make relationships bidirectional.
7. Enforce token discipline: **≤5 `constant` entries** (cosmology, magic-system summary, current era); everything else keyword/selective. Lorebook `tokenBudget` 4096–6144.

Write the consolidated entries to `lorebook-entries.json`. Group entries by their `chapter` field — that grouping defines the chapter folders for the lorebook.

## Phase 4 — Author the DM card

1. Load `reference/base-dm-card.json`.
2. Apply the consolidated DM profile per `reference/dm-card-field-map.md`:
   - `procedures` → replace `data.system_prompt`'s running-game block.
   - `tone`/`narrationStyle`/`fictionInspirations` → rewrite `data.personality`.
   - Tune `data.post_history_instructions` and `data.extensions.depth_prompt` if the procedures imply per-turn checks.
   - Optional: `data.name` (sourcebook GM title), `data.extensions.backstory` (condensed premise), `data.first_mes` (tone-setting hook).
3. **Always:** append `data.tags` (sourcebook name, system, genre; keep `DM`/`AI-Game-Master`) and set `data.creator_notes` to provenance: `"Generated from <Sourcebook> by the sourcebook-to-lorebook skill on <date>."`
4. **Merge rule:** sourcebook evidence overrides only fields it has evidence for; base defaults are preserved where the sourcebook is silent. **Never invent procedures.**
5. **No DM fragments found?** Ship the base card **unchanged** and flag it in `creator_notes` with the `no-run-the-game-content` tag (see `dm-card-field-map.md`).

Write the card to `dm-card.json`.

### Supplement mode in Phase 5

If the partition plan has an `existingLorebook` field with `action: "supplement"`:
- **Do NOT** `POST /api/lorebooks` (no new lorebook shell).
- POST folders directly to the existing lorebook `id`: `POST /api/lorebooks/:existingId/folders`.
- POST entries to the existing lorebook `id`: `POST /api/lorebooks/:existingId/entries/bulk`.
- The DM card is still POSTed normally to `/api/characters`.
- The `lorebook.json` file written for validation contains the shell metadata (for the validator) but its `id` is the existing lorebook's `id`; the emit script skips lorebook creation when `existingLorebook` is set.

For a **roster save** (`bucket: "roster"`), emit a separate `roster-data.mjs` + `save-roster.mjs` alongside the main artifacts. Use the same pattern from prior runs:
- `roster-data.mjs` exports `characters` (full chara_card_v2) and `personas` arrays.
- `save-roster.mjs` POSTs characters to `/api/characters`, personas to `/api/characters/personas`, creates/reuses a named group in both `/api/characters/groups` and `/api/characters/persona-groups`.
- Idempotent: dedup characters by name+creator; personas by name+creator; groups by name (union member IDs on reuse).
- Use `x-marinara-csrf: 1` header and port 7860.

## Phase 5 — Emit

1. **Validate** before anything else:
   ```bash
   node .agents/skills/sourcebook-to-lorebook/scripts/validate-artifacts.mjs \
     .tmp/sourcebook-<slug>/dm-card.json .tmp/sourcebook-<slug>/lorebook.json
   ```
   Build `lorebook.json` (the shell: name, description, category=`world`, tokenBudget, recursiveScanning, vectorization settings, scope, tags) from `reference/marina-create-paths.md`. Both must print `OK`. Fix + re-validate until clean.
2. **If the server is reachable** (from Setup gate 5), POST per `reference/marina-create-paths.md`:
   - `POST /api/characters { "data": card.data }`
   - `POST /api/lorebooks` (shell) → capture `id`
   - `POST /api/lorebooks/:id/folders` per chapter → capture folder `id`s
   - `POST /api/lorebooks/:id/entries` per entry, setting `folderId`
3. **If the server is down,** leave the JSON files in place and print their absolute paths + the manual import steps from `reference/marina-create-paths.md`.
4. Report to the user: what was created, the entry count, how many folders, the constant-entry count, and (if posted) where to find them in the UI.

## Error handling (fail gracefully, never fabricate)

- **Scanned / encrypted / image-only PDF** → `extract-pdf.mjs` exits `3` → stop; OCR is out of scope.
- **Malformed LLM JSON** → one repair-and-retry with the schema re-fed; still bad → skip chunk, log, continue.
- **No "run-the-game" content** → ship the base DM card unchanged, flag in `creator_notes`, **never invent** procedures.
- **Entry explosion / cross-chapter duplicates** → consolidation dedupes, unions keys, caps constant entries, warns.
- **Server down at emit** → write files + print import instructions (do not delete `.tmp`).

## Out of scope (v1)

OCR for scanned PDFs; auto avatars/sprites; embedding the lorebook inside the DM card's `character_book`; structured `extensions.rpgStats` parsing (stats go in entry `content` as reference text); re-run / idempotent updates to an existing lorebook.
