# Marinara Create Paths

How Phase 5 emits the two native artifacts. **Always write inspectable JSON files first** (human-in-the-loop), validate them, then POST to the running server if reachable. If the server is down, print file paths + import instructions instead.

## Working directory

`.tmp/sourcebook-<slug>/` at the repo root (create if missing; it is gitignored). Write:

- `dm-card.json` — the specialized character card.
- `lorebook.json` — the lorebook shell (metadata + folders).
- `lorebook-entries.json` — the array of consolidated entries (posted individually to the entry endpoint).

`<slug>` = the sourcebook filename (or title) lowercased, non-alphanumerics → `-`.

## Validate before emitting

```bash
node .agents/skills/sourcebook-to-lorebook/scripts/validate-artifacts.mjs \
  .tmp/sourcebook-<slug>/dm-card.json \
  .tmp/sourcebook-<slug>/lorebook.json
```

Both must print `OK`. Fix and re-validate before any POST.

## Character create

`POST /api/characters`

```jsonc
// body: the entire card object (spec/spec_version/data)
{
  "data": /* the CharacterData object (i.e. the card's "data" field) */
}
```

- Validated server-side by `createCharacterSchema = { data: characterDataSchema }`.
- The native card JSON is **already** `chara_card_v2` with `data`; POST `{ "data": card.data }`.
- Returns the created character (with its `id`).

Repo references: `packages/shared/src/types/character.ts` (`CharacterData`, `CharacterExtensions` incl. `backstory`/`appearance`/`depth_prompt`/`rpgStats`), `packages/shared/src/schemas/character.schema.ts` (`createCharacterSchema`, passthrough).

## Lorebook create

### 1. Create the lorebook shell

`POST /api/lorebooks`

```jsonc
{
  "name": "<Sourcebook> — World",
  "description": "World lore extracted from <Sourcebook>.",
  "category": "world",
  "scanDepth": 1,
  "tokenBudget": 5120,
  "entryLimit": 0,
  "recursiveScanning": true,
  "excludeFromVectorization": false,
  "vectorQueryDepth": 1,
  "vectorScoreThreshold": 0.25,
  "vectorMaxResults": 10,
  "scope": "global",
  "tags": ["sourcebook", "<sourcebook-slug>"]
}
```

- Returns the created lorebook with `id`. Capture it.
- Tune `tokenBudget` within **4096–6144** per the extraction-schema discipline.

Repo reference: `packages/server/src/db/schema/lorebooks.ts` (field set + defaults).

### 2. Create one folder per chapter that holds ≥1 entry

`POST /api/lorebooks/:id/folders` — one call per chapter folder. Capture each folder's `id` to assign `entry.folderId`.

### 3. Create entries

`POST /api/lorebooks/:id/entries` — one call per consolidated entry. Set each entry's `folderId` to its chapter folder. Entries may be posted in a loop; if the API accepts a batch array, prefer that.

Entry payload (native Marinara entry):

```jsonc
{
  "name": "...",
  "content": "...",
  "description": "...",
  "keys": ["..."],
  "secondaryKeys": ["..."],
  "selective": true,
  "logic": "and",            // and | and_all | or | not | not_all
  "category": "world",       // world | character | npc | spellbook
  "tag": "location",         // location | character | item | faction | lore | magic | creature | event
  "position": "before_char", // or as appropriate
  "depth": 1,
  "order": 100,
  "role": "system",
  "constant": false,         // true ONLY for the ≤5 always-on entries
  "relationships": ["..."]   // names; resolved to links
}
```

## Server-down path

If the POSTs fail (connection refused / not running):

1. Leave the JSON files in `.tmp/sourcebook-<slug>/`.
2. Print the absolute file paths and these manual steps:
   - Character: open the Characters UI → import/create → paste `dm-card.json`'s `data` (or use the ST-compatible export path if the UI expects it).
   - Lorebook: open the Lorebooks UI → create the lorebook, then add the folders and entries from the JSON files.
3. Do **not** delete the `.tmp` files — the user may need them.

## Compatibility fallback (optional, for sharing outside Marinara)

Only if the user wants to share a card with a non-Marinara SillyTavern install: the existing importers (`importSTCharacter`, `importSTLorebook`) consume ST World Info / V2 character-book JSON. The native card is already `chara_card_v2`-compatible; the native lorebook can be re-exported via the server's `compatible` export format. This is a sharing convenience, not the primary path.
