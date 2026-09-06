#!/usr/bin/env node
/* ForgeGrit Open — static site generator.
 *
 * Reads models.json + CLI.txt and writes:
 *   index.html                  the model index, with the + New Repository modal
 *   models/<cli-model-id>/index.html   one page per model
 *
 * Run after editing models.json:  node tools/build.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPO_URL = 'https://github.com/Trey16885/ForgeGrit-Open';
const CONTACT_URL = 'https://contact2.me/VA7XQI';
const CONTACT_EMAIL = 'treyleo16@gmail.com';

// One copy-pasteable line that works without the package being on npm.
const INSTALL_CLI =
  'git clone https://github.com/Trey16885/ForgeGrit-Open && npm install -g ./ForgeGrit-Open';

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------- inputs ---------- */

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'models.json'), 'utf8'));

// CLI.txt is the registry of record: <cli-model-id> = <path to ollama.txt>
const registry = new Map();
fs.readFileSync(path.join(ROOT, 'CLI.txt'), 'utf8')
  .split('\n')
  .forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const eq = t.indexOf('=');
    if (eq === -1) return;
    registry.set(t.slice(0, eq).trim(), t.slice(eq + 1).trim());
  });

// Cross-check models.json against CLI.txt and each ollama.txt.
for (const m of catalog.models) {
  const rel = registry.get(m.id);
  if (!rel) throw new Error(`models.json lists "${m.id}" but CLI.txt does not`);
  const onDisk = fs.readFileSync(path.join(ROOT, rel), 'utf8').trim();
  if (onDisk !== m.ollama) {
    throw new Error(`${rel} says "${onDisk}" but models.json says "${m.ollama}"`);
  }
}
for (const id of registry.keys()) {
  if (!catalog.models.some((m) => m.id === id)) {
    throw new Error(`CLI.txt lists "${id}" but models.json does not`);
  }
}

/* ---------- shared chrome ---------- */

function head(title, depth, description) {
  const up = '../'.repeat(depth) || './';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="icon" href="${up}assets/mark.svg" type="image/svg+xml">
<link rel="icon" href="${up}assets/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="${up}assets/favicon-192.png" sizes="192x192" type="image/png">
<link rel="apple-touch-icon" href="${up}assets/apple-touch-icon.png">
<link rel="stylesheet" href="${up}assets/forge.css">
</head>
<body>
<header class="topbar">
  <div class="wrap">
    <a class="brand" href="${up}index.html"><img class="mark" src="${up}assets/mark.svg" width="26" height="26" alt="">ForgeGrit <span class="dim">Open</span></a>
    <nav>
      <a href="${up}index.html">Models</a>
      <a href="${up}docs/cli.html">CLI</a>
      <a class="optional" href="https://ollama.com" target="_blank" rel="noopener">Ollama</a>
      <a class="optional" href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a>
    </nav>
  </div>
</header>`;
}

function footer(depth) {
  const up = '../'.repeat(depth) || './';
  return `<footer>
  <div class="wrap">
    <span>ForgeGrit Open — open models, run locally through Ollama.</span>
    <span class="spacer"></span>
    <a href="${up}docs/cli.html">CLI docs</a>
    <a href="${CONTACT_URL}" target="_blank" rel="noopener">Publish a model</a>
    <a href="${REPO_URL}" target="_blank" rel="noopener">Source</a>
  </div>
</footer>
</body>
</html>`;
}

const copyScript = `<script>
document.addEventListener('click', function (e) {
  var btn = e.target.closest('.copybtn');
  if (!btn) return;
  var text = btn.parentNode.querySelector('code').textContent;
  var done = function () {
    var old = btn.textContent;
    btn.textContent = 'copied';
    btn.classList.add('done');
    setTimeout(function () { btn.textContent = old; btn.classList.remove('done'); }, 1400);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () {});
  } else {
    var ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (err) {}
    document.body.removeChild(ta);
  }
});
</script>`;

/* ---------- index.html ---------- */

/** Spec chips, only for specs the catalog actually records. */
function specChips(m) {
  const chips = [];
  if (m.params) chips.push(`<span class="chip">${esc(m.params)}</span>`);
  if (m.context) chips.push(`<span class="chip">${esc(m.context)} ctx</span>`);
  return chips.length ? chips.join('\n          ') + '\n          ' : '';
}

/** Optional rows in the Details panel — absent fields are simply not claimed. */
function detailRows(m) {
  const rows = [];
  if (m.params) rows.push(`          <dt>Parameters</dt><dd>${esc(m.params)}</dd>`);
  if (m.context) rows.push(`          <dt>Context</dt><dd>${esc(m.context)}</dd>`);
  if (m.license) rows.push(`          <dt>License</dt><dd>${esc(m.license)}</dd>`);
  return rows.length ? rows.join('\n') + '\n' : '';
}

function card(m) {
  return `      <a class="card" href="models/${esc(m.id)}/" data-search="${esc([m.name, m.id, m.ollama, m.summary, m.tags.join(' ')].join(' ').toLowerCase())}" data-recommended="${m.recommended ? 'yes' : 'no'}">
        <h3>${esc(m.name)}${m.recommended ? ' <span class="star" title="Recommended">★ recommended</span>' : ''}</h3>
        <div class="cid">${esc(m.id)}</div>
        <p>${esc(m.summary)}</p>
        <div class="meta">
          ${specChips(m)}${m.tags.slice(0, 3).map((t) => `<span class="chip">${esc(t)}</span>`).join('\n          ')}
        </div>
      </a>`;
}

const indexHtml = `${head('ForgeGrit Open — open models for Ollama', 0, 'Open models published on ForgeGrit Open. Install them into the forge CLI and run them locally through Ollama.')}

<main>
  <section class="hero">
    <div class="wrap">
      <h1>Open models, built for you.</h1>
      <p>ForgeGrit Open is the model repository for ForgeGrit. Every model here runs
      locally on your machine through Ollama — install one with the <code>forge</code> CLI
      and talk to it as a chatbot, or turn it loose on a folder as an agent.</p>
      <div class="row">
        <button class="btn btn-primary" id="new-repo">+ New Repository</button>
        <span class="cmd"><b>$</b> <code>forge install model gpt-6-astra</code></span>
      </div>
    </div>
  </section>

  <div class="wrap">
    <div class="toolbar">
      <h2>Models</h2>
      <div class="spacer"></div>
      <div class="search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <input id="q" type="search" placeholder="Search models, tags, ids…" autocomplete="off" aria-label="Search models">
      </div>
    </div>

    <div class="grid" id="grid">
${catalog.models.map(card).join('\n')}
    </div>
    <p class="empty" id="empty" hidden>No models match that search. Try <a href="#" id="clear-q">clearing the search</a>.</p>
  </div>
</main>

<div class="overlay" id="modal" hidden role="dialog" aria-modal="true" aria-labelledby="modal-title">
  <div class="modal">
    <h2 id="modal-title">Model Uploading Instructions</h2>
    <p class="sub">Publishing a model to ForgeGrit Open</p>
    <ol>
      <li>
        <b>Visit:</b>
        <div class="link-box"><a href="${CONTACT_URL}" target="_blank" rel="noopener">${CONTACT_URL}</a></div>
      </li>
      <li>Describe your model or create system instructions, then <b>include your email in your message</b>.</li>
      <li>We will email you at <b>${CONTACT_EMAIL}</b> to let you know whether your model was published or rejected.</li>
    </ol>
    <div class="note">Please wait a little; it takes time.</div>
    <div class="actions">
      <button class="btn" id="modal-close">Close</button>
      <a class="btn btn-primary" href="${CONTACT_URL}" target="_blank" rel="noopener">Open the form</a>
    </div>
  </div>
</div>

${footer(0)}
`.replace(
  '</body>',
  `<script>
(function () {
  var modal = document.getElementById('modal');
  function open() { modal.hidden = false; }
  function close() { modal.hidden = true; }
  document.getElementById('new-repo').addEventListener('click', open);
  document.getElementById('modal-close').addEventListener('click', close);
  modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

  var q = document.getElementById('q');
  var cards = [].slice.call(document.querySelectorAll('#grid .card'));
  var empty = document.getElementById('empty');
  function filter() {
    var term = q.value.trim().toLowerCase();
    var shown = 0;
    cards.forEach(function (c) {
      var hit = !term || c.dataset.search.indexOf(term) !== -1;
      c.hidden = !hit;
      if (hit) shown++;
    });
    empty.hidden = shown !== 0;
  }
  q.addEventListener('input', filter);
  document.getElementById('clear-q').addEventListener('click', function (e) {
    e.preventDefault();
    q.value = '';
    filter();
    q.focus();
  });
})();
</script>
</body>`
);

function writeAll() {
  fs.writeFileSync(path.join(ROOT, 'index.html'), indexHtml);

/* ---------- models/<id>/index.html ---------- */

function modelPage(m) {
  const install = [
    [INSTALL_CLI, 'Install the ForgeGrit Open CLI (needs Node 18+)'],
    [`forge install model ${m.id}`, 'Pull the model into Ollama'],
    [`forge run ${m.id}`, 'Start it — the CLI asks for agent or chatbot'],
  ];

  return `${head(m.name + ' — ForgeGrit Open', 2, m.summary)}

<main class="wrap">
  <div class="crumbs"><a href="../../index.html">ForgeGrit Open</a> / models / ${esc(m.id)}</div>

  <div class="model-head">
    <h1>${esc(m.name)}</h1>
    <p class="sum">${esc(m.summary)}</p>
    <div class="meta">
      ${m.recommended ? '<span class="chip hot">★ recommended</span>' : ''}
      ${specChips(m)}${m.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('\n      ')}
    </div>
  </div>

  <div class="cols">
    <article class="md" id="readme">
      <p>Loading README…</p>
    </article>

    <aside class="side">
      <div class="panel">
        <h4>Install</h4>
${install.map(([cmd]) => `        <div class="copyrow"><code>${esc(cmd)}</code><button class="copybtn" type="button">copy</button></div>`).join('\n')}
      </div>

      <div class="panel">
        <h4>Details</h4>
        <dl class="kv">
          <dt>CLI model ID</dt><dd>${esc(m.id)}</dd>
          <dt>Ollama model</dt><dd>${esc(m.ollama)}</dd>
${detailRows(m)}          <dt>Publisher</dt><dd>${esc(m.publisher)}</dd>
        </dl>
        <p style="margin:12px 0 0;color:var(--ink-faint);font-size:12.5px">
          Size and context come from the model itself — run
          <code>ollama show ${esc(m.ollama)}</code> after installing it.
        </p>
      </div>

      <div class="panel">
        <h4>Files</h4>
        <dl class="kv">
          <dt>Registry</dt><dd><a href="../../CLI.txt">CLI.txt</a></dd>
          <dt>Ollama id</dt><dd><a href="ollama.txt">ollama.txt</a></dd>
          <dt>Readme</dt><dd><a href="README.md">README.md</a></dd>
        </dl>
      </div>

      <div class="panel">
        <h4>Requires</h4>
        <p style="margin:0;color:var(--ink-dim);font-size:13.5px">
          <a href="https://ollama.com/download" target="_blank" rel="noopener">Ollama</a>
          must be installed and signed in. The CLI starts <code>ollama serve</code> for you.
        </p>
      </div>
    </aside>
  </div>
</main>

${footer(2)}
`.replace(
    '</body>',
    `<script src="../../assets/md.js"></script>
${copyScript}
<script>
fetch('README.md', { cache: 'no-cache' })
  .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
  .then(function (text) {
    document.getElementById('readme').innerHTML = window.ForgeMarkdown.render(text);
  })
  .catch(function () {
    document.getElementById('readme').innerHTML =
      '<p>The README could not be loaded from this page. ' +
      'Open <a href="README.md">README.md</a> directly, or serve this folder over ' +
      'http (for example <code>python3 -m http.server</code>) instead of opening the ' +
      'file straight off disk.</p>';
  });
</script>
</body>`
  );
}

  for (const m of catalog.models) {
    const dir = path.join(ROOT, 'models', m.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), modelPage(m));
  }

/* ---------- docs pages ---------- */

const docsSide = `      <div class="panel">
        <h4>Quick start</h4>
        <div class="copyrow"><code>${INSTALL_CLI}</code><button class="copybtn" type="button">copy</button></div>
        <div class="copyrow"><code>forge search models --recommended</code><button class="copybtn" type="button">copy</button></div>
        <div class="copyrow"><code>forge install model gpt-6-astra</code><button class="copybtn" type="button">copy</button></div>
        <div class="copyrow"><code>forge run gpt-6-astra</code><button class="copybtn" type="button">copy</button></div>
      </div>
      <div class="panel">
        <h4>Requires</h4>
        <p style="margin:0;color:var(--ink-dim);font-size:13.5px">
          <a href="https://ollama.com/download" target="_blank" rel="noopener">Ollama</a>
          and a free <a href="https://ollama.com" target="_blank" rel="noopener">ollama.com</a>
          account. Node 18+.
        </p>
      </div>
      <div class="panel">
        <h4>Docs</h4>
        <dl class="kv">
          <dt>CLI</dt><dd><a href="cli.html">cli</a></dd>
          <dt>npm</dt><dd><a href="publishing-to-npm.html">publishing-to-npm</a></dd>
        </dl>
      </div>
      <div class="panel">
        <h4>Models</h4>
        <dl class="kv">
${catalog.models.map((m) => `          <dt>${esc(m.name)}</dt><dd><a href="../models/${esc(m.id)}/">${esc(m.id)}</a></dd>`).join('\n')}
        </dl>
      </div>`;

/**
 * A docs page renders one of the markdown files in docs/ through the same
 * renderer the model pages use, so the markdown stays the single source.
 */
function docPage({ slug, title, heading, summary, description, hero }) {
  return `${head(title, 1, description)}

<main class="wrap">
  <div class="crumbs"><a href="../index.html">ForgeGrit Open</a> / docs / ${esc(slug)}</div>

  <div class="model-head">
    <h1>${heading}</h1>
    <p class="sum">${esc(summary)}</p>
${hero ? `    <div class="copyrow" style="max-width:640px">
      <code>${esc(hero)}</code><button class="copybtn" type="button">copy</button>
    </div>` : ''}
  </div>

  <div class="cols">
    <article class="md" id="doc"><p>Loading…</p></article>
    <aside class="side">
${docsSide}
    </aside>
  </div>
</main>

${footer(1)}
`.replace(
    '</body>',
    `<script src="../assets/md.js"></script>
${copyScript}
<script>
fetch('${slug}.md', { cache: 'no-cache' })
  .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
  .then(function (text) {
    var html = window.ForgeMarkdown.render(text);
    // Links between docs point at the .md files; on the site use the pages.
    document.getElementById('doc').innerHTML =
      html.replace(/href="([a-z0-9-]+)\\.md"/g, 'href="$1.html"');
  })
  .catch(function () {
    document.getElementById('doc').innerHTML =
      '<p>The docs could not be loaded from this page. Open ' +
      '<a href="${slug}.md">${slug}.md</a> directly, or serve this folder over http ' +
      '(for example <code>python3 -m http.server</code>).</p>';
  });
</script>
</body>`
  );
}

const docs = [
  {
    slug: 'cli',
    title: 'ForgeGrit Open CLI — docs',
    heading: 'The <code>forge</code> CLI',
    summary: 'Install and run ForgeGrit Open models locally, through Ollama.',
    description:
      'How to install and use the forge CLI: installing models, agent mode, chatbot mode, and how it drives Ollama.',
    hero: INSTALL_CLI,
  },
  {
    slug: 'publishing-to-npm',
    title: 'Publishing the CLI to npm',
    heading: 'Publishing the CLI to npm',
    summary:
      'Optional. Putting forgegrit-open on the npm registry so the install command gets shorter.',
    description:
      'Step by step: making an npm account, logging in, publishing the forge CLI, and shipping updates.',
    hero: null,
  },
];

  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  for (const doc of docs) {
    fs.writeFileSync(path.join(ROOT, `docs/${doc.slug}.html`), docPage(doc));
  }

  console.log(
    `built index.html, ${docs.length} docs pages and ${catalog.models.length} model pages`
  );
}

// Only write when run as a command. Requiring this file (the tests do, for the
// helpers) must not regenerate the pages — that would hide a stale build.
if (require.main === module) writeAll();

module.exports = { writeAll, helpers: { specChips, detailRows } };
