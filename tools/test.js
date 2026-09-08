#!/usr/bin/env node
'use strict';

/* ForgeGrit Open test suite.  node tools/test.js
 *
 * Covers the registry, the agent's parser and sandbox, the markdown
 * renderer, the generated site, and the streaming chat client (against a
 * stub server that speaks the same shapes Ollama does). */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const agent = require(path.join(ROOT, 'cli/src/agent.js'));
const registry = require(path.join(ROOT, 'cli/src/registry.js'));
const ollama = require(path.join(ROOT, 'cli/src/ollama.js'));

require(path.join(ROOT, 'assets/md.js'));
const md = globalThis.ForgeMarkdown;

const buildHelpers = require(path.join(ROOT, 'tools/build.js')).helpers;

let passed = 0;
let failed = 0;
const only = process.argv[2];

async function test(name, fn) {
  if (only && !name.includes(only)) return;
  try {
    await fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (err) {
    failed++;
    console.log('  FAIL ' + name);
    console.log('       ' + (err && err.message));
  }
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'forge-test-'));
}

const yesToEverything = { allowAll: true, check: async () => true };
const noToEverything = { allowAll: false, check: async () => false };

(async function main() {
  console.log('\nregistry');

  await test('CLI.txt parses into id -> ollama.txt path', () => {
    const map = registry.readRegistry();
    assert.strictEqual(map.size, 4);
    assert.strictEqual(map.get('muse-code'), 'models/muse-code/ollama.txt');
  });

  await test('comments and blank lines in CLI.txt are ignored', () => {
    const map = registry.parseRegistry('# a comment\n\n  x = models/x/ollama.txt\nnot-a-pair\n');
    assert.deepStrictEqual([...map.entries()], [['x', 'models/x/ollama.txt']]);
  });

  await test('every cli-model-id resolves to the id inside its ollama.txt', () => {
    const expected = {
      'claude-fable-5-1': 'treyleo16/fable-5-1',
      'gpt-6-astra': 'treyleo16/gpt-6-astra',
      'zai-glm-5.3': 'treyleo16/glm:5-3',
      'muse-code': 'treyleo16/muse-code',
    };
    for (const [cliId, ollamaId] of Object.entries(expected)) {
      assert.strictEqual(registry.ollamaId(cliId), ollamaId, cliId);
    }
  });

  await test('models.json agrees with CLI.txt', () => {
    const ids = registry.ids().sort();
    const catalogIds = registry.catalog().map((m) => m.id).sort();
    assert.deepStrictEqual(catalogIds, ids);
    for (const m of registry.catalog()) {
      assert.strictEqual(m.ollama, registry.ollamaId(m.id), m.id + ' ollama id');
    }
  });

  await test('unknown ids are rejected and near misses suggested', () => {
    assert.strictEqual(registry.has('nope'), false);
    assert.ok(registry.suggest('muse-cod').includes('muse-code'));
  });

  await test('search finds by tag, name and ollama id', () => {
    assert.ok(registry.search('mythos').some((m) => m.id === 'claude-fable-5-1'));
    assert.ok(registry.search('muse').some((m) => m.id === 'muse-code'));
    assert.ok(registry.search('glm:5-3').some((m) => m.id === 'zai-glm-5.3'));
    assert.strictEqual(registry.search('zzzz').length, 0);
  });

  await test('recommended is a subset of all models', () => {
    const rec = registry.recommended();
    assert.strictEqual(rec.length, 3);
    assert.ok(rec.every((m) => registry.has(m.id)));
  });

  console.log('\nagent parser');

  await test('parses a forge action block', () => {
    const actions = agent.parseActions('sure\n```forge\n{"action":"read","path":"a.js"}\n```\n');
    assert.deepStrictEqual(actions, [{ action: 'read', path: 'a.js' }]);
  });

  await test('parses several blocks in one reply', () => {
    const actions = agent.parseActions(
      '```forge\n{"action":"list","path":"."}\n```\ntext between\n```forge\n{"action":"read","path":"b"}\n```'
    );
    assert.strictEqual(actions.length, 2);
    assert.strictEqual(actions[1].path, 'b');
  });

  await test('accepts json-tagged blocks too (small models drift)', () => {
    const actions = agent.parseActions('```json\n{"action":"list","path":"."}\n```');
    assert.strictEqual(actions.length, 1);
  });

  await test('ignores prose and non-action code blocks', () => {
    const actions = agent.parseActions('here is code:\n```js\nconst a = 1;\n```\nall done.');
    assert.strictEqual(actions.length, 0);
  });

  await test('flags malformed JSON instead of throwing', () => {
    const actions = agent.parseActions('```forge\n{"action": "read", oops}\n```');
    assert.strictEqual(actions.length, 1);
    assert.strictEqual(actions[0].bad, true);
  });

  console.log('\nagent sandbox');

  await test('paths outside the working folder are refused', () => {
    const dir = tempDir();
    const box = agent.makeSandbox(dir);
    assert.throws(() => box.resolve('../escape.txt'), /outside/);
    assert.throws(() => box.resolve('/etc/passwd'), /outside/);
    assert.ok(box.resolve('nested/ok.txt').startsWith(dir));
  });

  await test('write creates a file, read reads it back', async () => {
    const dir = tempDir();
    const box = agent.makeSandbox(dir);
    const { execute } = requireInternals();

    const w = await execute({ action: 'write', path: 'hello.txt', content: 'hi\nthere' }, box, yesToEverything);
    assert.ok(w.ok, w.detail);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'hello.txt'), 'utf8'), 'hi\nthere');

    const r = await execute({ action: 'read', path: 'hello.txt' }, box, yesToEverything);
    assert.ok(r.ok);
    assert.ok(r.detail.includes('there'));
  });

  await test('write creates missing parent folders', async () => {
    const dir = tempDir();
    const { execute } = requireInternals();
    const r = await execute(
      { action: 'write', path: 'a/b/c.txt', content: 'deep' },
      agent.makeSandbox(dir),
      yesToEverything
    );
    assert.ok(r.ok, r.detail);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'a/b/c.txt'), 'utf8'), 'deep');
  });

  await test('edit replaces the first exact match', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'app.js'), 'const port = 3000;\n');
    const { execute } = requireInternals();
    const r = await execute(
      { action: 'edit', path: 'app.js', find: 'const port = 3000', replace: 'const port = 8080' },
      agent.makeSandbox(dir),
      yesToEverything
    );
    assert.ok(r.ok, r.detail);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'app.js'), 'utf8'), 'const port = 8080;\n');
  });

  await test('edit fails cleanly when the text is not there', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'app.js'), 'nothing here\n');
    const { execute } = requireInternals();
    const r = await execute(
      { action: 'edit', path: 'app.js', find: 'missing', replace: 'x' },
      agent.makeSandbox(dir),
      yesToEverything
    );
    assert.strictEqual(r.ok, false);
    assert.ok(/not in the file/.test(r.detail));
  });

  await test('delete removes a file but refuses a non-empty folder', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'gone.txt'), 'x');
    fs.mkdirSync(path.join(dir, 'full'));
    fs.writeFileSync(path.join(dir, 'full/keep.txt'), 'x');
    const box = agent.makeSandbox(dir);
    const { execute } = requireInternals();

    const a = await execute({ action: 'delete', path: 'gone.txt' }, box, yesToEverything);
    assert.ok(a.ok, a.detail);
    assert.strictEqual(fs.existsSync(path.join(dir, 'gone.txt')), false);

    const b = await execute({ action: 'delete', path: 'full' }, box, yesToEverything);
    assert.strictEqual(b.ok, false);
    assert.ok(fs.existsSync(path.join(dir, 'full/keep.txt')));
  });

  await test('a rejected write leaves the disk untouched', async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'original');
    const { execute } = requireInternals();
    const r = await execute(
      { action: 'write', path: 'keep.txt', content: 'clobbered' },
      agent.makeSandbox(dir),
      noToEverything
    );
    assert.strictEqual(r.ok, false);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'keep.txt'), 'utf8'), 'original');
  });

  await test('unknown actions are reported, not crashed on', async () => {
    const { execute } = requireInternals();
    const r = await execute(
      { action: 'sudo', path: '.' },
      agent.makeSandbox(tempDir()),
      yesToEverything
    );
    assert.strictEqual(r.ok, false);
    assert.ok(/unknown action/.test(r.detail));
  });

  await test('the brief carries the folder and the first prompt, with no system role', () => {
    const text = agent.brief('/work/here', 'add a health route');
    assert.ok(text.includes('/work/here'));
    assert.ok(text.includes('add a health route'));
    assert.ok(text.includes('"action": "write"'));
  });

  console.log('\nmarkdown');

  await test('renders headings, tables, code and lists', () => {
    const html = md.render(fs.readFileSync(path.join(ROOT, 'models/muse-code/README.md'), 'utf8'));
    assert.ok(/<h1>Muse Code<\/h1>/.test(html));
    assert.ok(/<table><thead>/.test(html));
    assert.ok(/<pre><code class="lang-bash">/.test(html));
    assert.ok(/<ul><li>/.test(html));
    assert.ok(!/@@FGCODE/.test(html), 'placeholder leaked');
  });

  await test('escapes html and blocks javascript: links', () => {
    const html = md.render('<script>alert(1)</script>\n\n[x](javascript:alert(1))');
    assert.ok(!/<script>/.test(html));
    assert.ok(!/javascript:/.test(html));
  });

  await test('soft wraps become spaces, not line breaks', () => {
    assert.strictEqual(md.render('one\ntwo'), '<p>one two</p>');
  });

  await test('an escaped pipe stays inside its table cell', () => {
    const html = md.render('| A | B |\n|---|---|\n| Linux | `curl x \\| sh` |\n');
    assert.ok(html.includes('curl x | sh'));
    assert.strictEqual((html.match(/<td>/g) || []).length, 2);
  });

  await test('nested fences survive a four-backtick block', () => {
    const html = md.render('````\n```forge\n{"action":"read"}\n```\n````');
    assert.ok(html.includes('```forge'));
  });

  console.log('\nsite');

  await test('index.html lists every model and carries the upload instructions', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    for (const id of registry.ids()) {
      assert.ok(html.includes(`href="models/${id}/"`), 'missing card link for ' + id);
    }
    assert.ok(html.includes('+ New Repository'));
    assert.ok(html.includes('Model Uploading Instructions'));
    assert.ok(html.includes('https://contact2.me/VA7XQI'));
    assert.ok(html.includes('treyleo16@gmail.com'));
    assert.ok(html.includes('Please wait a little; it takes time.'));
  });

  await test('the install command on every page is one that works today', () => {
    // forgegrit-open is on the npm registry, so every page installs from it.
    // Nothing may fall back to the old clone-and-install line, which was only
    // there while the package was unpublished.
    const INSTALL = 'npm install -g forgegrit-open';
    const pages = [
      path.join(ROOT, 'docs/cli.html'),
      ...registry.ids().map((id) => path.join(ROOT, 'models', id, 'index.html')),
    ];
    for (const page of pages) {
      const html = fs.readFileSync(page, 'utf8');
      assert.ok(html.includes(INSTALL), path.relative(ROOT, page) + ' is missing the install command');
      assert.ok(
        !/npm install -g \.\/ForgeGrit-Open/.test(html),
        path.relative(ROOT, page) + ' still uses the pre-publish clone install'
      );
    }

    // The README and the CLI docs are the two places a person actually reads
    // the command from, so pin them too.
    for (const doc of ['README.md', 'docs/cli.md']) {
      const text = fs.readFileSync(path.join(ROOT, doc), 'utf8');
      assert.ok(text.includes(INSTALL), doc + ' is missing the install command');
    }
  });

  await test('no page claims a spec the catalog does not record', () => {
    // These models are GGUF conversions — parameter counts and context lengths
    // belong to the model file, not to us. A page may only state a spec that
    // models.json actually carries, so nothing here can be a guess.
    for (const m of registry.catalog()) {
      const page = fs.readFileSync(path.join(ROOT, 'models', m.id, 'index.html'), 'utf8');
      const readme = fs.readFileSync(path.join(ROOT, 'models', m.id, 'README.md'), 'utf8');

      if (!m.params) {
        assert.ok(!/<dt>Parameters<\/dt>/.test(page), m.id + ' page states a parameter count');
        assert.ok(!/^\|\s*Parameters\s*\|/m.test(readme), m.id + ' README states a parameter count');
      }
      if (!m.context) {
        assert.ok(!/ctx<\/span>/.test(page), m.id + ' page states a context length');
        assert.ok(!/^\|\s*Context\s*\|/m.test(readme), m.id + ' README states a context length');
      }
      if (!m.license) {
        assert.ok(!/<dt>License<\/dt>/.test(page), m.id + ' page states a license');
      }
    }
  });

  await test('a model with real specs still renders them', () => {
    // The optional fields have to work when they are filled in, or the guard
    // above would quietly become "specs never render at all".
    const withSpecs = { id: 'x', name: 'X', ollama: 'o/x', publisher: 'p', summary: 's',
      tags: ['t'], recommended: false, params: '7B', context: '32K', license: 'MIT' };
    const chips = buildHelpers.specChips(withSpecs);
    const rows = buildHelpers.detailRows(withSpecs);
    assert.ok(chips.includes('7B') && chips.includes('32K ctx'), chips);
    assert.ok(rows.includes('7B') && rows.includes('32K') && rows.includes('MIT'), rows);
    assert.strictEqual(buildHelpers.specChips({ tags: [] }), '');
    assert.strictEqual(buildHelpers.detailRows({}), '');
  });

  await test('the icon set exists and every page links it at the right depth', () => {
    for (const f of ['mark.svg', 'logo.svg', 'logo-light.svg', 'logo-dark.svg',
                     'favicon-32.png', 'favicon-192.png', 'apple-touch-icon.png']) {
      assert.ok(fs.existsSync(path.join(ROOT, 'assets', f)), 'assets/' + f + ' missing');
    }
    // PNG magic number + dimensions straight out of the IHDR chunk.
    const sizes = { 'favicon-32.png': 32, 'favicon-192.png': 192, 'apple-touch-icon.png': 180 };
    for (const [file, expected] of Object.entries(sizes)) {
      const buf = fs.readFileSync(path.join(ROOT, 'assets', file));
      assert.ok(buf.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), file + ' is not a PNG');
      assert.strictEqual(buf.readUInt32BE(16), expected, file + ' width');
      assert.strictEqual(buf.readUInt32BE(20), expected, file + ' height');
    }

    const pages = [
      { file: 'index.html', up: './' },
      { file: 'docs/cli.html', up: '../' },
      { file: 'docs/publishing-to-npm.html', up: '../' },
      ...registry.ids().map((id) => ({ file: `models/${id}/index.html`, up: '../../' })),
    ];
    for (const { file, up } of pages) {
      const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
      assert.ok(html.includes(`href="${up}assets/mark.svg" type="image/svg+xml"`), file + ' svg favicon');
      assert.ok(html.includes(`href="${up}assets/favicon-32.png"`), file + ' png fallback');
      assert.ok(html.includes(`rel="apple-touch-icon" href="${up}assets/apple-touch-icon.png"`), file + ' touch icon');
      assert.ok(html.includes(`<img class="mark" src="${up}assets/mark.svg"`), file + ' topbar logo');
      assert.ok(!/<span class="mark">F<\/span>/.test(html), file + ' still has the placeholder letter mark');
    }
  });

  await test('the README logo survives GitHub stripping CSS from SVGs', () => {
    // GitHub removes <style> from SVGs in a README. The two variants carry
    // their fills as attributes so the wordmark cannot end up unfilled, and
    // the README picks between them with <picture>.
    const fills = { 'logo-light.svg': '#14161a', 'logo-dark.svg': '#e9eaec' };
    for (const [file, wordFill] of Object.entries(fills)) {
      const svg = fs.readFileSync(path.join(ROOT, 'assets', file), 'utf8');
      assert.ok(!/<style>/.test(svg), file + ' still carries a <style> block');
      assert.ok(!/class="fg-/.test(svg), file + ' still depends on CSS classes');
      assert.ok(
        new RegExp('fill="' + wordFill + '"').test(svg),
        file + ' is missing the ' + wordFill + ' wordmark fill'
      );
    }

    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    assert.ok(/<picture>/.test(readme), 'README does not use <picture>');
    assert.ok(
      /srcset="assets\/logo-dark\.svg"/.test(readme),
      'README does not offer the dark variant'
    );
    assert.ok(
      /<img src="assets\/logo-light\.svg" alt="ForgeGrit Open"/.test(readme),
      'README fallback image or alt text is wrong'
    );
  });

  await test('both docs pages render their markdown source', () => {
    for (const slug of ['cli', 'publishing-to-npm']) {
      const html = fs.readFileSync(path.join(ROOT, `docs/${slug}.html`), 'utf8');
      assert.ok(fs.existsSync(path.join(ROOT, `docs/${slug}.md`)), slug + '.md missing');
      assert.ok(html.includes(`fetch('${slug}.md'`), slug + ' fetch');
      assert.ok(html.includes('assets/md.js'), slug + ' renderer');
    }
  });

  await test('every model folder has a README, an index.html and an ollama.txt', () => {
    for (const id of registry.ids()) {
      const dir = path.join(ROOT, 'models', id);
      for (const file of ['README.md', 'index.html', 'ollama.txt']) {
        assert.ok(fs.existsSync(path.join(dir, file)), `${id}/${file} missing`);
      }
      const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
      assert.ok(html.includes('forge install model ' + id), id + ' install command');
      assert.ok(html.includes(registry.ollamaId(id)), id + ' ollama id');
      assert.ok(html.includes("fetch('README.md'"), id + ' readme fetch');
      assert.ok(html.includes('assets/md.js'), id + ' markdown renderer');
    }
  });

  console.log('\nollama client');

  await test('client target rewrites the 0.0.0.0 bind address for requests', () => {
    const old = process.env.OLLAMA_HOST;
    process.env.OLLAMA_HOST = '0.0.0.0:11434';
    assert.strictEqual(ollama.baseUrl(), 'http://127.0.0.1:11434');
    process.env.OLLAMA_HOST = 'http://127.0.0.1:9999/';
    assert.strictEqual(ollama.baseUrl(), 'http://127.0.0.1:9999');
    if (old === undefined) delete process.env.OLLAMA_HOST;
    else process.env.OLLAMA_HOST = old;
  });

  await test('serve env opens CORS and binds every interface', () => {
    const old = process.env.OLLAMA_HOST;
    delete process.env.OLLAMA_HOST;
    const env = ollama.serveEnv();
    assert.strictEqual(env.OLLAMA_HOST, '0.0.0.0:11434');
    assert.strictEqual(env.OLLAMA_ORIGINS, '*');
    if (old !== undefined) process.env.OLLAMA_HOST = old;
  });

  await withStubServer(async () => {
    await test('isUp and tags read /api/tags', async () => {
      assert.strictEqual(await ollama.isUp(), true);
      const names = await ollama.tags();
      assert.deepStrictEqual(names, ['treyleo16/muse-code:latest', 'treyleo16/glm:5-3']);
    });

    await test('installed check treats a bare name as its :latest tag', async () => {
      assert.strictEqual(await ollama.isInstalled('treyleo16/muse-code'), true);
      assert.strictEqual(await ollama.isInstalled('treyleo16/glm:5-3'), true);
      assert.strictEqual(await ollama.isInstalled('treyleo16/not-here'), false);
    });

    await test('chat streams deltas and returns the whole reply', async () => {
      const pieces = [];
      const reply = await ollama.chat('m', [{ role: 'user', content: 'hi' }], {
        onDelta: (p) => pieces.push(p),
      });
      assert.strictEqual(reply, 'Hello there!');
      assert.ok(pieces.length > 1, 'expected more than one delta');
    });

    await test('chat surfaces an error payload as a thrown error', async () => {
      await assert.rejects(
        () => ollama.chat('boom', [{ role: 'user', content: 'hi' }], {}),
        /model not found/
      );
    });
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();

/* ---------- helpers ---------- */

function requireInternals() {
  return { execute: agent.execute };
}

/**
 * A stand-in for `ollama serve`: answers /api/tags and streams
 * /v1/chat/completions the way the real server does.
 */
async function withStubServer(body) {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          models: [{ name: 'treyleo16/muse-code:latest' }, { name: 'treyleo16/glm:5-3' }],
        })
      );
      return;
    }

    if (req.url === '/v1/chat/completions') {
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', () => {
        const wantsError = JSON.parse(raw).model === 'boom';
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });

        if (wantsError) {
          res.end(JSON.stringify({ error: { message: 'model not found' } }) + '\n');
          return;
        }

        const frame = (content) =>
          'data: ' + JSON.stringify({ choices: [{ delta: { content } }] }) + '\n\n';

        // Deliberately split a frame across writes — the parser has to cope.
        const all = frame('Hello') + frame(' there') + frame('!') + 'data: [DONE]\n\n';
        res.write(all.slice(0, 40));
        setTimeout(() => res.end(all.slice(40)), 15);
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const old = process.env.OLLAMA_HOST;
  process.env.OLLAMA_HOST = '127.0.0.1:' + port;

  try {
    await body();
  } finally {
    if (old === undefined) delete process.env.OLLAMA_HOST;
    else process.env.OLLAMA_HOST = old;
    await new Promise((resolve) => server.close(resolve));
  }
}
