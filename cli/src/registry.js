'use strict';

/* Reads the ForgeGrit Open model registry.
 *
 * CLI.txt is the file that answers "the user typed this id — where is its
 * ollama.txt?".  models.json carries the human-facing detail used by
 * `forge models` and `forge search models`.
 */

const fs = require('fs');
const path = require('path');

const REMOTE_BASE = 'https://raw.githubusercontent.com/Trey16885/ForgeGrit-Open/main/';

/** Find the repo root: the nearest ancestor directory holding CLI.txt. */
function findRoot() {
  if (process.env.FORGE_HOME) {
    const forced = path.resolve(process.env.FORGE_HOME);
    if (fs.existsSync(path.join(forced, 'CLI.txt'))) return forced;
    throw new Error(`FORGE_HOME=${forced} does not contain CLI.txt`);
  }
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'CLI.txt'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

const ROOT = findRoot();

/** Parse CLI.txt into a Map of <cli-model-id> -> <path to ollama.txt>. */
function parseRegistry(text) {
  const map = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const id = line.slice(0, eq).trim();
    const file = line.slice(eq + 1).trim();
    if (id && file) map.set(id, file);
  }
  return map;
}

function readRegistry() {
  if (!ROOT) {
    throw new Error(
      'Could not find CLI.txt. Reinstall the CLI, or set FORGE_HOME to a ForgeGrit Open checkout.'
    );
  }
  return parseRegistry(fs.readFileSync(path.join(ROOT, 'CLI.txt'), 'utf8'));
}

/** Every cli-model-id the registry knows about. */
function ids() {
  return [...readRegistry().keys()];
}

function has(cliId) {
  return readRegistry().has(cliId);
}

/**
 * Resolve a cli-model-id to the Ollama model id, by reading the model's
 * ollama.txt exactly as CLI.txt points at it.
 */
function ollamaId(cliId) {
  const rel = readRegistry().get(cliId);
  if (!rel) return null;
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    throw new Error(`CLI.txt points at ${rel}, but that file is missing`);
  }
  const id = fs.readFileSync(file, 'utf8').trim();
  if (!id) throw new Error(`${rel} is empty — no Ollama model id in it`);
  return id;
}

/** The path CLI.txt records for a model's ollama.txt (for display). */
function ollamaTxtPath(cliId) {
  return readRegistry().get(cliId) || null;
}

/** Catalog detail from models.json, keyed by cli-model-id. */
function catalog() {
  if (!ROOT) return [];
  const file = path.join(ROOT, 'models.json');
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data.models) ? data.models : [];
  } catch (err) {
    return [];
  }
}

function detail(cliId) {
  return catalog().find((m) => m.id === cliId) || null;
}

/** Suggest close matches for a mistyped id. */
function suggest(cliId) {
  const all = ids();
  const needle = cliId.toLowerCase();
  return all
    .filter((id) => {
      const hay = id.toLowerCase();
      return hay.includes(needle) || needle.includes(hay) || hay.slice(0, 3) === needle.slice(0, 3);
    })
    .slice(0, 3);
}

/** Search across id, name, summary and tags. */
function search(keyword) {
  const term = String(keyword || '').toLowerCase();
  const rows = catalog().length
    ? catalog()
    : ids().map((id) => ({ id, name: id, summary: '', tags: [] }));
  if (!term) return rows;
  return rows.filter((m) => {
    const hay = [m.id, m.name, m.summary, (m.tags || []).join(' '), m.ollama || '']
      .join(' ')
      .toLowerCase();
    return hay.includes(term);
  });
}

function recommended() {
  return catalog().filter((m) => m.recommended);
}

module.exports = {
  ROOT,
  REMOTE_BASE,
  parseRegistry,
  readRegistry,
  ids,
  has,
  ollamaId,
  ollamaTxtPath,
  catalog,
  detail,
  suggest,
  search,
  recommended,
};
