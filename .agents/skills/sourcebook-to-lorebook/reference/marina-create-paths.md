# Marinara Create Paths

How Phase 5 emits the two native artifacts. **Always write inspectable JSON files first** (human-in-the-loop), validate them, then POST to the running server if reachable. If the server is down, print file paths + import instructions instead.

## Working directory

`.tmp/sourcebook-<slug>/` at the repo root (create if missing; it is gitignored). Write:

- `dm-card.json` — the specialized character card.
- `lorebook.json` — the full lorebook for inspection: shell metadata **plus** an `entries: [...]` array (the validator requires both `name` and `entries`).
- `lorebook-entries.json` — the consolidated entries (consumed by your build/emit step to produce `lorebook.json`).

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
  "recursiveScanning": true,
  "excludeFromVectorization": false,
  "vectorQueryDepth": 1,
  "vectorScoreThreshold": 0.25,
  "vectorMaxResults": 10,
  "isGlobal": true,
  "tags": ["sourcebook", "<sourcebook-slug>"]
}
```

- Returns the created lorebook with `id`. Capture it.
- Tune `tokenBudget` within **4096–6144** per the extraction-schema discipline.
- `isGlobal: true` makes it a global lorebook (the schema field). Do NOT send `scope: "global"` — `scope` is an object `{mode:"all"|"character"|"chat",chatIds:[]}` with its own default; `isGlobal` + no `characterId`/`personaId` passes the server's conflict check.
- Omit `entryLimit` → default `100`. The schema minimum is **1** (not 0); sending `0` 400s.

Repo references: `packages/shared/src/schemas/lorebook.schema.ts` (`createLorebookSchema`, `createLorebookEntrySchema`, `createLorebookFolderSchema`), `packages/server/src/routes/lorebooks.routes.ts` (handlers), `packages/server/src/db/schema/lorebooks.ts` (field set + defaults).

### 2. Create one folder per chapter that holds ≥1 entry

`POST /api/lorebooks/:id/folders` — one call per chapter folder. Body `{ "name": "<chapter>", "enabled": true }` (only `name` required). Capture each folder's `id` to assign `entry.folderId`. List existing folders first with `GET /api/lorebooks/:id/folders` so a re-run can reuse them by name (idempotent).

### 3. Create entries

Prefer the **bulk** endpoint (one call for all entries):

`POST /api/lorebooks/:id/entries/bulk` — body `{ "entries": [ {entry}, ... ] }`. The server validates each entry with `createLorebookEntrySchema` and injects `lorebookId` itself, so **omit `lorebookId`** from each entry object. On a validation failure the whole call 400s with a `details` array naming the offending field — fix and resend.

Fallback: `POST /api/lorebooks/:id/entries` — one call per entry.

Entry payload (native Marinara entry). The fields below are the ones worth setting; all others have safe schema defaults (omit them):

```jsonc
{
  "name": "...",
  "content": "...",
  "description": "...",
  "keys": ["..."],
  "secondaryKeys": ["..."],
  "selective": true,
  "selectiveLogic": "and",            // and | and_all | or | not | not_all  (field is "selectiveLogic", NOT "logic")
  "tag": "location",                 // location | character | item | faction | lore | magic | creature | event
  "constant": false,                  // true ONLY for the ≤5 always-on entries
  "folderId": "<chapter-folder-id>", // assign to its chapter folder
  "relationships": { "<entry-name>": "related" }  // Record<string,string>: target entry name -> descriptor (NOT a string[] array)
}
```

Field notes (schema-verified against `packages/shared/src/schemas/lorebook.schema.ts`):

- `selectiveLogic` — enum, default `"and"`. Do NOT send `logic` (it is ignored).
- `position` — **number `0`–`2`**, default `0` (= before char). Omit unless you need a different anchor.
- `depth` — number, default `4`; `order` — default `100`; `role` — default `"system"`. Omit unless overriding.
- `relationships` — `Record<string,string>` (object), **not** `string[]`. Key = an existing entry's `name`, value = a descriptor such as `"related"`.
- `constant` — `true` only for the ≤5 always-on entries.

### Optional: vectorize

`POST /api/lorebooks/:id/vectorize` — body `{ "connectionId": "<id>", "model": "<id>"?, "onlyMissing": true }`. Requires a configured embedding connection (or `connectionId === LOCAL_SIDECAR_CONNECTION_ID`); if none is configured it 400s. Keyword/selective activation works without it — vectorization only improves semantic recall. The lorebook just needs `excludeFromVectorization: false` (set above) to be eligible.

## Server-down path

If the POSTs fail (connection refused / not running):

1. Leave the JSON files in `.tmp/sourcebook-<slug>/`.
2. Print the absolute file paths and these manual steps:
   - Character: open the Characters UI → import/create → paste `dm-card.json`'s `data` (or use the ST-compatible export path if the UI expects it).
   - Lorebook: open the Lorebooks UI → create the lorebook, then add the folders and entries from the JSON files.
3. Do **not** delete the `.tmp` files — the user may need them.

## Compatibility fallback (optional, for sharing outside Marinara)

Only if the user wants to share a card with a non-Marinara SillyTavern install: the existing importers (`importSTCharacter`, `importSTLorebook`) consume ST World Info / V2 character-book JSON. The native card is already `chara_card_v2`-compatible; the native lorebook can be re-exported via the server's `compatible` export format. This is a sharing convenience, not the primary path.
