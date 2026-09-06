'use strict';

/* Agent mode: the model works inside the folder you ran `forge` from — the
 * one `cd` put you in. It can list, read, create, edit and delete files
 * there, and nowhere else.
 *
 * There is no system prompt. ForgeGrit hands the model the action format and
 * the user's first prompt together as the opening user message, and from
 * then on the conversation is the user's.
 */

const fs = require('fs');
const path = require('path');

const ollama = require('./ollama');
const ui = require('./ui');

const MAX_STEPS = 12;          // tool rounds per user turn
const MAX_READ_BYTES = 96 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', 'dist', 'build', '.next', '__pycache__']);

/* ---------- the brief ---------- */

function brief(root, firstPrompt) {
  return `You are running as an agent through the ForgeGrit Open CLI.

Working folder: ${root}
You may only touch files inside that folder.

To act on files, reply with one or more action blocks. Each block is one JSON
object inside a fenced code block tagged forge:

\`\`\`forge
{"action": "list", "path": "."}
\`\`\`

\`\`\`forge
{"action": "read", "path": "src/app.js"}
\`\`\`

\`\`\`forge
{"action": "write", "path": "notes.md", "content": "line one\\nline two"}
\`\`\`

\`\`\`forge
{"action": "edit", "path": "src/app.js", "find": "const port = 3000", "replace": "const port = 8080"}
\`\`\`

\`\`\`forge
{"action": "delete", "path": "old.txt"}
\`\`\`

Rules:
- One JSON object per block. Paths are relative to the working folder.
- "write" replaces the whole file and creates it if it is missing.
- "edit" replaces the first exact match of "find"; it fails if the text is not there.
- Read a file before editing it.
- After your blocks, stop and wait. The results come back in the next message.
- The user approves every write, edit and delete, so a rejection is normal.
- When the work is finished, reply with plain text and no action blocks, and
  say what you changed.

The user's request:

${firstPrompt}`;
}

/* ---------- parsing ---------- */

const FENCE = /```[ \t]*(forge|json|tool)?[ \t]*\r?\n([\s\S]*?)```/g;

function parseActions(text) {
  const actions = [];
  let m;
  FENCE.lastIndex = 0;
  while ((m = FENCE.exec(text)) !== null) {
    const body = m[2].trim();
    if (!body.startsWith('{')) continue;
    let obj;
    try {
      obj = JSON.parse(body);
    } catch (err) {
      actions.push({ bad: true, reason: 'that block is not valid JSON', raw: body.slice(0, 200) });
      continue;
    }
    if (obj && typeof obj.action === 'string') actions.push(obj);
  }
  return actions;
}

/* ---------- the sandbox ---------- */

function makeSandbox(root) {
  function resolve(p) {
    const target = path.resolve(root, String(p == null ? '' : p));
    const rel = path.relative(root, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('path is outside the working folder');
    }
    return target;
  }

  function show(p) {
    const rel = path.relative(root, p);
    return rel === '' ? '.' : rel;
  }

  return { resolve, show, root };
}

/* ---------- executing ---------- */

async function execute(action, sandbox, approvals) {
  const kind = action.action;

  if (action.bad) {
    return { ok: false, label: 'block', detail: action.reason };
  }

  let target;
  try {
    target = sandbox.resolve(action.path);
  } catch (err) {
    return { ok: false, label: `${kind} ${action.path}`, detail: err.message };
  }
  const rel = sandbox.show(target);

  switch (kind) {
    case 'list': {
      if (!fs.existsSync(target)) return { ok: false, label: `list ${rel}`, detail: 'no such folder' };
      const entries = fs
        .readdirSync(target, { withFileTypes: true })
        .filter((e) => !SKIP_DIRS.has(e.name))
        .slice(0, 200)
        .map((e) => (e.isDirectory() ? e.name + '/' : e.name));
      ui.info('list ' + rel + ui.c.dim(`  (${entries.length} entries)`));
      return { ok: true, label: `list ${rel}`, detail: entries.join('\n') || '(empty)' };
    }

    case 'read': {
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        return { ok: false, label: `read ${rel}`, detail: 'no such file' };
      }
      const size = fs.statSync(target).size;
      let text = fs.readFileSync(target, 'utf8');
      let note = '';
      if (size > MAX_READ_BYTES) {
        text = text.slice(0, MAX_READ_BYTES);
        note = `\n\n[truncated — file is ${size} bytes]`;
      }
      ui.info('read ' + rel + ui.c.dim(`  (${size} bytes)`));
      return { ok: true, label: `read ${rel}`, detail: text + note };
    }

    case 'write': {
      const content = typeof action.content === 'string' ? action.content : '';
      const exists = fs.existsSync(target);
      const verb = exists ? 'overwrite' : 'create';
      const lines = content.split('\n').length;

      if (!(await approvals.check(`${verb} ${ui.c.bold(rel)} ${ui.c.dim(`(${lines} lines)`)}`))) {
        return { ok: false, label: `write ${rel}`, detail: 'the user rejected this write' };
      }

      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
      ui.ok((exists ? 'wrote ' : 'created ') + rel);
      return { ok: true, label: `write ${rel}`, detail: `${verb}d, ${lines} lines` };
    }

    case 'edit': {
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        return { ok: false, label: `edit ${rel}`, detail: 'no such file — read it first' };
      }
      const find = String(action.find == null ? '' : action.find);
      const replace = String(action.replace == null ? '' : action.replace);
      if (!find) return { ok: false, label: `edit ${rel}`, detail: '"find" was empty' };

      const before = fs.readFileSync(target, 'utf8');
      const at = before.indexOf(find);
      if (at === -1) {
        return { ok: false, label: `edit ${rel}`, detail: 'that exact text is not in the file' };
      }

      if (!(await approvals.check(`edit ${ui.c.bold(rel)} ${ui.c.dim('(1 replacement)')}`))) {
        return { ok: false, label: `edit ${rel}`, detail: 'the user rejected this edit' };
      }

      fs.writeFileSync(target, before.slice(0, at) + replace + before.slice(at + find.length));
      ui.ok('edited ' + rel);
      return { ok: true, label: `edit ${rel}`, detail: 'replaced 1 occurrence' };
    }

    case 'delete': {
      if (!fs.existsSync(target)) {
        return { ok: false, label: `delete ${rel}`, detail: 'no such file' };
      }
      const isDir = fs.statSync(target).isDirectory();

      if (!(await approvals.check(ui.c.red('delete ') + ui.c.bold(rel) + (isDir ? ui.c.dim(' (folder)') : '')))) {
        return { ok: false, label: `delete ${rel}`, detail: 'the user rejected this delete' };
      }

      if (isDir) {
        const left = fs.readdirSync(target);
        if (left.length) {
          return { ok: false, label: `delete ${rel}`, detail: 'folder is not empty' };
        }
        fs.rmdirSync(target);
      } else {
        fs.unlinkSync(target);
      }
      ui.ok('deleted ' + rel);
      return { ok: true, label: `delete ${rel}`, detail: 'deleted' };
    }

    default:
      return {
        ok: false,
        label: kind,
        detail: 'unknown action — use list, read, write, edit or delete',
      };
  }
}

/* ---------- approvals ---------- */

function makeApprovals() {
  let allowAll = false;
  return {
    get allowAll() {
      return allowAll;
    },
    async check(description) {
      if (allowAll) {
        return true;
      }
      ui.out();
      ui.out('  ' + ui.c.yellow('proposed:') + ' ' + description);
      const answer = await ui.choose(
        '  ' + ui.c.dim('allow? [y]es / [n]o / [a]ll for this session ') + '> ',
        [
          { keys: ['y', 'yes', ''], value: 'yes', label: 'y' },
          { keys: ['n', 'no'], value: 'no', label: 'n' },
          { keys: ['a', 'all'], value: 'all', label: 'a' },
        ]
      );
      if (answer === 'all') {
        allowAll = true;
        ui.info('approving the rest of this session automatically');
        return true;
      }
      return answer === 'yes';
    },
  };
}

/* ---------- the loop ---------- */

async function run(cliId, ollamaModelId) {
  const root = process.cwd();
  const sandbox = makeSandbox(root);
  const approvals = makeApprovals();

  ui.out();
  ui.out('  ' + ui.c.bold(cliId) + ui.c.dim('  agent  ·  ' + ollamaModelId));
  ui.out('  ' + ui.c.dim('working folder: ') + root);
  ui.out('  ' + ui.c.dim('It can create, edit and delete files here. You approve each one.'));
  ui.out('  ' + ui.c.dim('/help for commands, /exit to leave.'));
  ui.out();

  const messages = [];
  let firstTurn = true;

  for (;;) {
    const input = await ui.ask(ui.c.ember('you ') + ui.c.dim('> '));

    if (!input) continue;
    if (input === '/exit' || input === '/quit') break;
    if (input === '/help') {
      ui.out();
      ui.out('  ' + ui.c.bold('Agent mode'));
      ui.out('    Describe what you want done in this folder. The model proposes');
      ui.out('    file actions and you approve them one at a time.');
      ui.out('      ' + ui.c.cyan('/pwd') + '     show the working folder');
      ui.out('      ' + ui.c.cyan('/reset') + '   start over (the next message becomes the brief again)');
      ui.out('      ' + ui.c.cyan('/help') + '    this list');
      ui.out('      ' + ui.c.cyan('/exit') + '    leave');
      ui.out();
      continue;
    }
    if (input === '/pwd') {
      ui.info(root);
      continue;
    }
    if (input === '/reset') {
      messages.length = 0;
      firstTurn = true;
      ui.info('conversation cleared');
      continue;
    }

    // The brief and the user's first prompt go in together, as one user
    // message. Later turns are the user's words alone.
    messages.push({ role: 'user', content: firstTurn ? brief(root, input) : input });
    firstTurn = false;

    for (let stepNo = 0; stepNo < MAX_STEPS; stepNo++) {
      process.stdout.write('\n' + ui.c.cyan(cliId) + ui.c.dim(' > '));
      let reply;
      try {
        reply = await ollama.chat(ollamaModelId, messages, {
          onDelta: (piece) => process.stdout.write(piece),
        });
        process.stdout.write('\n');
      } catch (err) {
        process.stdout.write('\n');
        ui.fail(err.message);
        break;
      }

      messages.push({ role: 'assistant', content: reply });

      const actions = parseActions(reply);
      if (!actions.length) break;

      ui.out();
      const results = [];
      for (const action of actions) {
        results.push(await execute(action, sandbox, approvals));
      }

      const report = results
        .map((r, i) => `[${i + 1}] ${r.label} -> ${r.ok ? 'ok' : 'FAILED'}\n${r.detail}`)
        .join('\n\n');

      messages.push({
        role: 'user',
        content:
          'FORGE RESULTS\n\n' +
          report +
          '\n\nContinue, or reply with plain text and no action blocks if the work is done.',
      });

      if (stepNo === MAX_STEPS - 1) {
        ui.out();
        ui.warn(`stopped after ${MAX_STEPS} action rounds — say "continue" to let it keep going`);
      }
    }

    process.stdout.write('\n');
  }

  ui.out();
  ui.info('bye');
}

module.exports = { run, parseActions, makeSandbox, brief, execute, makeApprovals };
