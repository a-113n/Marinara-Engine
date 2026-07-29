# Sourcebook → Lorebook + DM Card Skill — Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Build a pi-agent skill (`.agents/skills/sourcebook-to-lorebook/`) that converts an RPG sourcebook PDF into two native Marinara Engine artifacts — a lorebook (chapter-folders/tags/vectorization) and a DM character card (`chara_card_v2` + Marinara `extensions`) specialized from a bundled base card.

**Architecture:** A markdown `SKILL.md` orchestrates a 5-phase, **outline-gated** pipeline. Deterministic steps (PDF text extraction, artifact validation) are Node ESM scripts under `scripts/`; judgment steps (partition, extraction, consolidation, DM-card authoring) are prompt-driven rubrics under `reference/` that the agent follows. Outputs are native Marinara JSON files written to `.tmp/sourcebook-<slug>/`, then POSTed to the server's create endpoints if running. Full design rationale: `docs/plans/2026-07-29-sourcebook-to-lorebook-skill-design.md`.

**Tech Stack:** Node ESM (`.mjs`), `pdf-parse` (existing dep, resolved from `packages/server`), Node built-in test runner (`node --test`) for local proof. **No new runtime dependencies.**

**Repo constraints (AGENTS.md — read it):**
- **Do not keep `.test.ts`/`.test.mjs` in the repo.** Local-proof tests are created, run, then `rm`'d before each commit.
- `console.*` is fine in skill scripts (they are tooling, **not** `packages/server` code — the Pino rule applies only to server code).
- Skill files are not covered by `pnpm check`; keep them clean anyway. No committed test files.

**Worktree:** All paths below are repo-relative and resolve inside `~/worktrees/marinara-engine/sourcebook-to-lorebook` (branch `feat/sourcebook-to-lorebook-skill`, off `origin/staging`).

---

## Phase 1 — Foundation: deterministic code + data

_Checkpoint after Task 4: helper scripts proven, base card valid._

### Task 1: Scaffold the skill directory

**TDD scenario:** Trivial scaffolding — use judgment (no test).

**Files:**
- Create: `.agents/skills/sourcebook-to-lorebook/SKILL.md`
- Create dirs: `.agents/skills/sourcebook-to-lorebook/reference/`, `.agents/skills/sourcebook-to-lorebook/scripts/`

**Step 1: Create directories**

```bash
mkdir -p .agents/skills/sourcebook-to-lorebook/reference .agents/skills/sourcebook-to-lorebook/scripts
```

**Step 2: Create `SKILL.md` stub** (frontmatter only; full content written in Task 8)

```markdown
---
name: sourcebook-to-lorebook
description: Use when the user wants to convert an RPG sourcebook PDF (or text) into a Marinara Engine lorebook and a DM character card. Extracts world facts into a native lorebook with chapter-folders, tags, and vectorization, and specializes a base DM character card with the sourcebook's tone, narration style, fiction inspiration, and turn/step procedures. Runs an outline-gated pipeline: builds a partition plan for human approval, then extracts, consolidates, authors the DM card, and emits native Marinara JSON artifacts. Not for non-sourcebook PDFs or OCR of scanned books.
---

<!-- Full workflow added in Task 8 -->
```

**Step 3: Verify**

```bash
ls -R .agents/skills/sourcebook-to-lorebook
```
Expected: `SKILL.md`, `reference/`, `scripts/`.

**Step 4: Commit**

```bash
git add .agents/skills/sourcebook-to-lorebook
git commit -m "feat(skill): scaffold sourcebook-to-lorebook skill"
```

---

### Task 2: `base-dm-card.json` — generic DM card template

**TDD scenario:** Data file — verify it parses as JSON and matches the V2 shape (the validator from Task 4 will enforce structure; here just ensure valid JSON + required fields).

**Files:**
- Create: `.agents/skills/sourcebook-to-lorebook/reference/base-dm-card.json`

**Step 1: Write the file** with this complete content:

```json
{
  "spec": "chara_card_v2",
  "spec_version": "2.0",
  "data": {
    "name": "The Game Master",
    "description": "An impartial, vivid narrator and referee for tabletop-style roleplay. Portrays the world, its people, and its perils; adjudicates actions fairly; and keeps the story moving.",
    "personality": "Cinematic and grounded. Sets scenes with concrete sensory detail, voices NPCs distinctly, escalates and relieves tension deliberately, and never softens consequences or railroads the player. Tone defaults to dramatic-but-fair; the sourcebook may override.",
    "scenario": "The Game Master narrates the world and all non-player characters. The player describes their character's actions; the GM resolves outcomes, reveals consequences, and advances the scene.",
    "first_mes": "*The world holds its breath.*\n\nSo — tell me who you are, where you stand, and what you intend to do. The story begins with your next words.",
    "mes_example": "",
    "creator_notes": "Generic base DM character card for Marinara Engine. Specialize via the sourcebook-to-lorebook skill (tone, narration style, fiction inspiration, turn/step procedures).",
    "system_prompt": "You are the Game Master.\n\nRUNNING THE GAME:\n1. Narrate the scene, then ask the player for their action.\n2. Resolve the action: determine intent, consider the fiction and any rules, then narrate the outcome (success, partial success, failure, or cost).\n3. Advance: introduce consequences, reactions, and the next beat.\n4. Be fair: fail forward when possible; make failure interesting rather than a dead end.\n5. Stay consistent with established lore (consult active lorebook entries) and prior events.\n6. Voice NPCs distinctly; never speak or decide for the player's character.",
    "post_history_instructions": "Before each reply: confirm you understand the player's intent, consult any active lorebook entries for relevant world facts, and keep narration consistent with what has been established. Portray the world honestly — including its dangers.",
    "tags": ["DM", "AI-Game-Master", "narrator", "referee"],
    "creator": "Marinara Engine",
    "character_version": "1.0",
    "alternate_greetings": [],
    "extensions": {
      "talkativeness": 0.5,
      "fav": false,
      "world": "",
      "depth_prompt": {
        "prompt": "Referee check: have I confirmed the player's intent and consulted active lorebook entries before narrating outcomes? Resolve actions fairly and keep the world consistent.",
        "depth": 1,
        "role": "system"
      },
      "backstory": "",
      "appearance": ""
    },
    "character_book": null
  }
}
```

**Step 2: Verify** it is valid JSON and has the V2 envelope:

```bash
node -e "const c=require('./.agents/skills/sourcebook-to-lorebook/reference/base-dm-card.json'); if(c.spec!=='chara_card_v2'||!c.data?.name||!c.data.extensions?.depth_prompt){console.error('BAD');process.exit(1)} console.log('OK:',c.data.name)"
```
Expected: `OK: The Game Master`.

**Step 3: Commit**

```bash
git add .agents/skills/sourcebook-to-lorebook/reference/base-dm-card.json
git commit -m "feat(skill): add generic base DM character card template"
```

---

### Task 3: `extract-pdf.mjs` — PDF → text + scanned-PDF detection (TDD)

**TDD scenario:** New feature — full TDD cycle on the **pure helpers** (argument parsing + scanned-detection heuristic). The PDF I/O path is verified later in the Task 11 e2e smoke (it needs a real PDF).

**Files:**
- Create: `.agents/skills/sourcebook-to-lorebook/scripts/extract-pdf.mjs`
- Temp test (deleted before commit): `.agents/skills/sourcebook-to-lorebook/scripts/extract-pdf.test.mjs`

**Step 1: Write the failing test**

`.agents/skills/sourcebook-to-lorebook/scripts/extract-pdf.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, detectLikelyScanned } from "./extract-pdf.mjs";

test("parseArgs reads pdf path and optional --out", () => {
  assert.deepEqual(parseArgs(["node", "x.mjs", "book.pdf"]), { pdfPath: "book.pdf", outDir: null });
  assert.deepEqual(parseArgs(["node", "x.mjs", "book.pdf", "--out", "o"]), { pdfPath: "book.pdf", outDir: "o" });
});

test("parseArgs exits when no pdf given", () => {
  assert.throws(() => parseArgs(["node", "x.mjs"]), { name: "Error" });
});

test("detectLikelyScanned flags tiny text relative to size", () => {
  assert.equal(detectLikelyScanned("hello", 200_000), true);   // 5 non-ws chars / ~195KB
  assert.equal(detectLikelyScanned("a".repeat(50_000), 200_000), false); // healthy text
  assert.equal(detectLikelyScanned("   ", 1000), true);        // blank
});
```

**Step 2: Run test to verify it fails**

```bash
cd .agents/skills/sourcebook-to-lorebook/scripts && node --test extract-pdf.test.mjs
```
Expected: FAIL (`parseArgs`/`detectLikelyScanned` not exported / module not found).

**Step 3: Write minimal implementation**

`.agents/skills/sourcebook-to-lorebook/scripts/extract-pdf.mjs`:

```js
#!/usr/bin/env node
// extract-pdf.mjs — extract text from a PDF and detect scanned/image-only PDFs.
// Usage: node extract-pdf.mjs <pdf-path> [--out <dir>]
// Run from the repo root so pdf-parse resolves from packages/server.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, basename, extname } from "node:path";

const require = createRequire(import.meta.url);

export function parseArgs(argv) {
  const args = argv.slice(2);
  const pdfPath = args.find((a) => !a.startsWith("--"));
  const outIdx = args.indexOf("--out");
  const outDir = outIdx !== -1 ? args[outIdx + 1] : null;
  if (!pdfPath) throw new Error("Usage: node extract-pdf.mjs <pdf-path> [--out <dir>]");
  return { pdfPath, outDir };
}

// Heuristic: scanned/image-only PDFs yield very little text relative to file size.
export function detectLikelyScanned(text, byteLength) {
  const nonWs = (text ?? "").replace(/\s+/g, "").length;
  if (nonWs < 200) return true;
  const kb = Math.max(1, byteLength / 1024);
  return nonWs / kb < 20; // <20 non-whitespace chars per KB → image-PDF territory
}

function loadPdfParse() {
  for (const base of [
    join(process.cwd(), "packages/server"),
    join(process.cwd(), "node_modules"),
    process.cwd(),
  ]) {
    try {
      return require(require.resolve("pdf-parse", { paths: [base] }));
    } catch {
      /* try next */
    }
  }
  throw new Error(
    "Could not resolve 'pdf-parse'. Run from the repo root (it is a dependency of packages/server).",
  );
}

async function main() {
  const { pdfPath, outDir } = parseArgs(process.argv);
  const buf = await readFile(pdfPath);
  const { PDFParse } = loadPdfParse();
  const pdf = new PDFParse({ data: new Uint8Array(buf) });
  let text = "";
  try {
    const result = await pdf.getText();
    text = result?.text ?? "";
  } finally {
    await pdf.destroy?.();
  }

  if (detectLikelyScanned(text, buf.length)) {
    console.error(
      "ERROR: Extracted text is suspiciously short for this PDF — it is likely a scanned/image-only PDF. OCR is required (out of scope for this skill).",
    );
    process.exit(3);
  }

  const slug = basename(pdfPath, extname(pdfPath)).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const target = outDir ?? join(process.cwd(), ".tmp", `sourcebook-${slug}`);
  await mkdir(target, { recursive: true });
  const outPath = join(target, "extracted.txt");
  await writeFile(outPath, text, "utf-8");
  await writeFile(
    join(target, "extract.manifest.json"),
    JSON.stringify({ source: pdfPath, chars: text.length, outPath }, null, 2),
    "utf-8",
  );
  console.log(`OK: ${text.length} chars -> ${outPath}`);
}

// Only run main when invoked directly (not when imported by tests).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  main().catch((err) => {
    console.error("ERROR:", err?.message ?? err);
    process.exit(1);
  });
}
```

> Note: the `import.meta.url` guard above is simplified; a robust check is
> `process.argv[1] === fileURLToPath(import.meta.url)`. Use `fileURLToPath` from `node:url` in the real file.

**Step 4: Run test to verify it passes**

```bash
cd .agents/skills/sourcebook-to-lorebook/scripts && node --test extract-pdf.test.mjs
```
Expected: PASS (3 tests).

**Step 5: Delete the temp test (AGENTS.md) and commit**

```bash
rm .agents/skills/sourcebook-to-lorebook/scripts/extract-pdf.test.mjs
git add .agents/skills/sourcebook-to-lorebook/scripts/extract-pdf.mjs
git commit -m "feat(skill): add extract-pdf.mjs with scanned-PDF detection"
```

---

### Task 4: `validate-artifacts.mjs` — structural JSON validation (TDD)

**TDD scenario:** New feature — full TDD cycle on the pure validators.

**Files:**
- Create: `.agents/skills/sourcebook-to-lorebook/scripts/validate-artifacts.mjs`
- Temp test (deleted before commit): `.agents/skills/sourcebook-to-lorebook/scripts/validate-artifacts.test.mjs`

**Step 1: Write the failing test**

`.agents/skills/sourcebook-to-lorebook/scripts/validate-artifacts.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCharacterCard, validateLorebook } from "./validate-artifacts.mjs";

const goodCard = {
  spec: "chara_card_v2",
  data: { name: "DM", system_prompt: "x", extensions: { depth_prompt: {} } },
};

test("validateCharacterCard accepts a valid card", () => {
  assert.equal(validateCharacterCard(goodCard).ok, true);
});

test("validateCharacterCard rejects missing name / wrong spec", () => {
  assert.equal(validateCharacterCard({ spec: "nope", data: { name: "" } }).ok, false);
  const r = validateCharacterCard({ spec: "chara_card_v2", data: { name: "" } });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(";"), /name/);
});

const goodLb = { name: "World", entries: [{ name: "E1", content: "c", keys: ["k"] }] };

test("validateLorebook accepts a valid lorebook", () => {
  assert.equal(validateLorebook(goodLb).ok, true);
});

test("validateLorebook flags bad entries", () => {
  const r = validateLorebook({ name: "X", entries: [{ content: "c" }] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(";"), /entries\[0\].name/);
});
```

**Step 2: Run test to verify it fails**

```bash
cd .agents/skills/sourcebook-to-lorebook/scripts && node --test validate-artifacts.test.mjs
```
Expected: FAIL (not exported).

**Step 3: Write minimal implementation**

`.agents/skills/sourcebook-to-lorebook/scripts/validate-artifacts.mjs`:

```js
#!/usr/bin/env node
// validate-artifacts.mjs — lightweight structural validation for emitted Marinara JSON.
// Usage: node validate-artifacts.mjs <card.json|lorebook.json> [<another.json> ...]
import { readFile } from "node:fs/promises";

export function validateCharacterCard(card) {
  const errors = [];
  if (!card || typeof card !== "object") return { ok: false, errors: ["card must be an object"] };
  if (card.spec !== "chara_card_v2") errors.push("spec must be 'chara_card_v2'");
  const d = card.data;
  if (!d || typeof d !== "object") return { ok: false, errors: [...errors, "data must be an object"] };
  if (typeof d.name !== "string" || !d.name.trim()) errors.push("data.name must be a non-empty string");
  if (typeof d.system_prompt !== "string") errors.push("data.system_prompt must be a string");
  if (!d.extensions || typeof d.extensions !== "object") errors.push("data.extensions must be an object");
  return { ok: errors.length === 0, errors };
}

export function validateLorebook(lb) {
  const errors = [];
  if (!lb || typeof lb !== "object") return { ok: false, errors: ["lorebook must be an object"] };
  if (typeof lb.name !== "string" || !lb.name.trim()) errors.push("name must be a non-empty string");
  if (!Array.isArray(lb.entries)) return { ok: false, errors: [...errors, "entries must be an array"] };
  lb.entries.forEach((e, i) => {
    const where = `entries[${i}]`;
    if (!e || typeof e !== "object") { errors.push(`${where} must be an object`); return; }
    if (typeof e.name !== "string" || !e.name.trim()) errors.push(`${where}.name must be a non-empty string`);
    if (typeof e.content !== "string") errors.push(`${where}.content must be a string`);
    if (!Array.isArray(e.keys)) errors.push(`${where}.keys must be an array`);
  });
  return { ok: errors.length === 0, errors };
}

function detectAndValidate(obj) {
  if (obj && (obj.spec === "chara_card_v2" || obj.data)) return { kind: "card", result: validateCharacterCard(obj) };
  return { kind: "lorebook", result: validateLorebook(obj) };
}

async function main(files) {
  let failed = false;
  for (const f of files) {
    const obj = JSON.parse(await readFile(f, "utf-8"));
    const { kind, result } = detectAndValidate(obj);
    if (result.ok) {
      console.log(`OK  ${kind.padEnd(8)} ${f}`);
    } else {
      failed = true;
      console.error(`FAIL ${kind.padEnd(8)} ${f}`);
      for (const e of result.errors) console.error(`       - ${e}`);
    }
  }
  if (failed) process.exit(1);
}

const files = process.argv.slice(2);
if (files.length) {
  main(files).catch((err) => {
    console.error("ERROR:", err?.message ?? err);
    process.exit(1);
  });
}
```

**Step 4: Run test to verify it passes**

```bash
cd .agents/skills/sourcebook-to-lorebook/scripts && node --test validate-artifacts.test.mjs
```
Expected: PASS (4 tests).

**Step 5: Delete temp test and commit**

```bash
rm .agents/skills/sourcebook-to-lorebook/scripts/validate-artifacts.test.mjs
git add .agents/skills/sourcebook-to-lorebook/scripts/validate-artifacts.mjs
git commit -m "feat(skill): add validate-artifacts.mjs structural checks"
```

**— Phase 1 checkpoint: run both scripts' final committed forms once more against `base-dm-card.json` —**

```bash
node .agents/skills/sourcebook-to-lorebook/scripts/validate-artifacts.mjs .agents/skills/sourcebook-to-lorebook/reference/base-dm-card.json
```
Expected: `OK  card     ...base-dm-card.json`.

---

## Phase 2 — Rubrics & workflow (prompt-driven docs)

_Checkpoint after Task 8: skill content complete._

### Task 5: `reference/partition-rubric.md`

**TDD scenario:** Prose doc — verify by inspection (sections present, tables intact).

**Files:**
- Create: `.agents/skills/sourcebook-to-lorebook/reference/partition-rubric.md`

**Content requirements** (write the full doc):
- Title + purpose: the routing rules the agent applies to each chunk in Phase 1/2.
- **Partition table** (copy verbatim from the design doc): content type → `dm-card` / `lorebook` / `discard`.
- **Judgment-call rule:** dual-purpose content (world-fact AND tone) → split into a lorebook entry + a `personality` sentence. Procedures referencing world facts → entity to lorebook, procedure to `system_prompt`.
- **Bucket definitions:** what each of `dm-card`, `lorebook`, `discard` means and examples.
- **Output:** the partition plan JSON shape (see Task 6): `{ sections: [{ title, pageRange, bucket, reason, estEntries }] }`.

**Verify:** `grep -q "partition" .agents/skills/sourcebook-to-lorebook/reference/partition-rubric.md && head -5` shows the table.

**Commit:** `git commit -m "feat(skill): add partition rubric"`.

---

### Task 6: `reference/extraction-schema.md` — exact JSON shapes the LLM emits

**TDD scenario:** Prose/data spec — verify by inspection.

**Files:**
- Create: `.agents/skills/sourcebook-to-lorebook/reference/extraction-schema.md`

**Content requirements:**
- **Candidate entry shape** (Phase 2 output per chunk):
  ```json
  { "name": "...", "content": "concise reference, not raw prose", "description": "one-liner for knowledge-router",
    "keys": ["distinctive", "lowercase", "aliases"], "secondaryKeys": [], "category": "world|character|npc|spellbook",
    "tag": "location|character|item|faction|lore|magic|creature|event", "chapter": "Chapter 3", "relationships": [] }
  ```
- **DM fragment shape** (Phase 2 output for `dm-card` chunks):
  ```json
  { "tone": "...", "narrationStyle": "...", "fictionInspirations": [], "procedures": "...", "pacing": "...", "source": "section title" }
  ```
- **Consolidation rules** (Phase 3): dedupe by normalized name (lowercase, strip punctuation), union keys, merge content, resolve category/tag conflicts (prefer most-specific).
- **Key-quality rules** (copy from design): distinctive nouns/names, lowercase, aliases/plurals/variants; no lone generic words without `secondaryKeys` + `selective`.
- **Token-budget discipline:** `tokenBudget` 4096–6144; ≤5 `constant` entries; vectorization on.

**Verify:** the doc contains both JSON shapes (grep for `"category"` and `"fictionInspirations"`).

**Commit:** `git commit -m "feat(skill): add extraction schema reference"`.

---

### Task 7: `reference/dm-card-field-map.md` + `reference/marina-create-paths.md`

**Files:**
- Create: `.agents/skills/sourcebook-to-lorebook/reference/dm-card-field-map.md`
- Create: `.agents/skills/sourcebook-to-lorebook/reference/marina-create-paths.md`

**`dm-card-field-map.md` content:** the field-mapping table from the design (DM fragment field → native card field), plus the merge rule: **sourcebook overrides only the fields it has evidence for; base-card defaults are preserved where the sourcebook is silent.** If no `dm-card` material is found, ship the base card unchanged with a `creator_notes` flag.

**`marina-create-paths.md` content:**
- Character create: `POST /api/characters` with body `{ "data": <CharacterData> }` (validated by `createCharacterSchema`).
- Lorebook create: `POST /api/lorebooks` (name, description, category, tokenBudget, scanDepth, recursiveScanning, excludeFromVectorization, vector* settings) → returns `id`; then `POST /api/lorebooks/:id/entries` per entry, and `POST /api/lorebooks/:id/folders` per chapter folder (set each entry's `folderId`).
- Working dir: `.tmp/sourcebook-<slug>/`; write `dm-card.json` + `lorebook.json` (+ `lorebook-entries.json`), validate with `validate-artifacts.mjs`, then POST if server reachable, else print import instructions.
- Reference repo paths: `packages/shared/src/types/character.ts`, `packages/shared/src/schemas/character.schema.ts`, `packages/server/src/db/schema/lorebooks.ts`.

**Verify:** both files non-empty; `grep "POST /api" marina-create-paths.md` returns the endpoints.

**Commit:** `git commit -m "feat(skill): add DM field map and Marina create-path reference"`.

---

### Task 8: `SKILL.md` — full 5-phase workflow + phase-1 gate

**TDD scenario:** Prose doc — verify by inspection + lint of frontmatter.

**Files:**
- Modify: `.agents/skills/sourcebook-to-lorebook/SKILL.md` (replace the Task 1 stub).

**Content requirements** (write the full doc, preserving the frontmatter from Task 1):
- **Setup gates:** require a PDF path; confirm `base-dm-card.json` exists; choose working dir `.tmp/sourcebook-<slug>/`; detect whether the Marinara server is reachable (for POST vs file-only).
- **Phase 1 — Ingest & outline (GATE):** run `scripts/extract-pdf.mjs <pdf>`; read `extracted.txt`; infer chapter/section structure (headings, "Chapter N", numbered sections, page breaks); produce the **partition plan** (rubric from Task 5) and **present it to the user for approval/edit** — do not proceed until approved.
- **Phase 2 — Extract:** for each `lorebook` chunk, emit candidate entries (schema from Task 6); for each `dm-card` chunk, emit DM fragments.
- **Phase 3 — Consolidate:** apply consolidation rules (Task 6): dedupe, union keys, finalize, enforce token budget.
- **Phase 4 — Author DM card:** load `reference/base-dm-card.json`, apply the DM profile per `dm-card-field-map.md` (Task 7), set `tags`/`creator_notes` provenance.
- **Phase 5 — Emit:** write native JSON to `.tmp/sourcebook-<slug>/`; run `scripts/validate-artifacts.mjs`; POST to create endpoints (Task 7) if server up, else print import instructions.
- **Error handling** (copy the design's bullets): scanned/encrypted PDF, malformed JSON (one repair-retry), no run-the-game content, entry explosion, server down.
- Cross-link every `reference/*.md` and `scripts/*.mjs` by relative path.

**Verify:** frontmatter present (`grep -A3 "^name:" SKILL.md`), all 5 phases present (`grep -c "Phase [1-5]" SKILL.md` → ≥5).

**Commit:** `git commit -m "feat(skill): write full SKILL.md workflow"`.

**— Phase 2 checkpoint: the skill is functionally complete as a doc set. —**

---

## Phase 3 — Integration & verification

### Task 9: `reference/sample-sourcebook.md` fixture

**Files:**
- Create: `.agents/skills/sourcebook-to-lorebook/reference/sample-sourcebook.md`

**Content requirements:** a small (1–2 page) synthetic sourcebook with all three buckets represented:
- A `dm-card` section ("Tone & Running the Game": grim noir tone, fiction inspiration "X meets Y", turn procedure: declare→resolve→narrate).
- `lorebook` content: one location, one NPC, one creature, one magic-system note, one world-rule.
- A `discard` section ("OGL / Legal").
- A ToC line (used for outline detection, not imported).

Purpose: lets the e2e smoke (Task 11) run without a real PDF, and exercises the text path too.

**Commit:** `git commit -m "test(skill): add sample sourcebook fixture"`.

---

### Task 10: Register in `skills-lock.json`

**Files:**
- Modify: `skills-lock.json` (repo root).

**Step 1: Inspect the existing format** (`cat skills-lock.json`) — it tracks `impeccable` with `source`/`sourceType`/`skillPath`/`computedHash`. This skill is repo-local (not from GitHub), so model it as a local entry.

**Step 2: Add the entry** under `skills`:
```json
"sourcebook-to-lorebook": {
  "source": "local",
  "sourceType": "local",
  "skillPath": ".agents/skills/sourcebook-to-lorebook/SKILL.md"
}
```
(Omit `computedHash` if the loader recomputes it; if the loader requires it, run its sync command. Check how the repo's skill loader consumes this file before finalizing the shape.)

**Step 3: Verify** the JSON is still valid: `node -e "JSON.parse(require('fs').readFileSync('skills-lock.json','utf-8')); console.log('valid')"`.

**Commit:** `git commit -m "feat(skill): register sourcebook-to-lorebook in skills-lock.json"`.

---

### Task 11: E2E smoke — run the skill on the fixture, verify import + activation

**TDD scenario:** End-to-end verification (manual/agent-driven; no committed test file).

**Steps:**
1. Invoke the skill against `reference/sample-sourcebook.md` (text path) — the agent follows `SKILL.md` through Phase 5, writing `dm-card.json` + `lorebook.json` to `.tmp/sourcebook-sample/`.
2. Validate: `node scripts/validate-artifacts.mjs .tmp/sourcebook-sample/dm-card.json .tmp/sourcebook-sample/lorebook.json` → both `OK`.
3. Confirm the partition happened correctly: DM-procedure content is in `dm-card.json` `data.system_prompt`/`extensions`; world content is lorebook entries; OGL was discarded.
4. Confirm chapter-folder assignment: ≥1 folder, entries reference it.
5. If a Marinara server is running: POST both artifacts via the create endpoints (Task 7); confirm the character and lorebook (with entries + folders) appear. Then run a short DM chat and verify (a) tone matches the fixture, and (b) a lorebook entry activates on its keyword (Active Context panel). If no server, stop after step 4 and document the manual steps.
6. Clean up `.tmp/sourcebook-sample/` (it is gitignored) — do not commit it.

**Commit:** only if any smoke findings required fixing the skill files:
```bash
git commit -am "fix(skill): address e2e smoke findings"   # only if changes were needed
```

---

## Definition of Done

- `.agents/skills/sourcebook-to-lorebook/` contains `SKILL.md`, `reference/{base-dm-card.json,partition-rubric.md,extraction-schema.md,dm-card-field-map.md,marina-create-paths.md,sample-sourcebook.md}`, `scripts/{extract-pdf.mjs,validate-artifacts.mjs}`.
- No committed `.test.*` files.
- `skills-lock.json` registers the skill and is valid JSON.
- E2E smoke (Task 11) passes: artifacts validate, partition is correct, (if server up) imports land and a keyword activates an entry.
- All commits on `feat/sourcebook-to-lorebook-skill` (off `origin/staging`).

## Open follow-ups (post-PR, not blocking)

- OCR for scanned PDFs.
- Re-run / idempotent lorebook updates.
- Structured `extensions.rpgStats` parsing.
- Optional combined export (lorebook embedded in DM card `character_book`).
