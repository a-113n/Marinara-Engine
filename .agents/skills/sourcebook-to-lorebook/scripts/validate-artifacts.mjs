#!/usr/bin/env node
// validate-artifacts.mjs — lightweight structural validation for emitted Marinara JSON.
// Usage: node validate-artifacts.mjs <card.json|lorebook.json> [<another.json> ...]
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

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
    if (!e || typeof e !== "object") {
      errors.push(`${where} must be an object`);
      return;
    }
    if (typeof e.name !== "string" || !e.name.trim()) errors.push(`${where}.name must be a non-empty string`);
    if (typeof e.content !== "string") errors.push(`${where}.content must be a string`);
    if (!Array.isArray(e.keys)) errors.push(`${where}.keys must be an array`);
  });
  return { ok: errors.length === 0, errors };
}

function detectAndValidate(obj) {
  if (obj && (obj.spec === "chara_card_v2" || obj.data)) {
    return { kind: "card", result: validateCharacterCard(obj) };
  }
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

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = process.argv.slice(2);
  if (files.length) {
    main(files).catch((err) => {
      console.error("ERROR:", err?.message ?? err);
      process.exit(1);
    });
  } else {
    console.error("Usage: node validate-artifacts.mjs <file.json> [<file2.json> ...]");
    process.exit(2);
  }
}
