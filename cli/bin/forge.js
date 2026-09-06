#!/usr/bin/env node
'use strict';

/* ForgeGrit Open CLI.
 *
 *   forge help
 *   forge models
 *   forge search models [--recommended] [KEYWORD]
 *   forge install model <cli-model-id>
 *   forge run <cli-model-id> [--agent | --chatbot]
 *   forge serve
 *   forge doctor
 */

const path = require('path');

const agent = require('../src/agent');
const chat = require('../src/chat');
const ollama = require('../src/ollama');
const registry = require('../src/registry');
const ui = require('../src/ui');

const pkg = require('../../package.json');
const CONTACT_URL = 'https://contact2.me/VA7XQI';

/* ---------- help ---------- */

function help() {
  const { c } = ui;
  ui.banner();
  ui.out('  ' + c.dim('Open models, run locally through Ollama.'));
  ui.out();
  ui.out('  ' + c.bold('USAGE'));
  ui.out('    ' + c.cyan('forge') + ' <command> [options]');
  ui.out();
  ui.out('  ' + c.bold('COMMANDS'));
  ui.out('    ' + c.cyan('forge help') + '                          this help');
  ui.out('    ' + c.cyan('forge models') + '                        every model the CLI knows about');
  ui.out('    ' + c.cyan('forge search models --recommended') + '   recommended models');
  ui.out('    ' + c.cyan('forge search models <KEYWORD>') + '       search by name, tag or id');
  ui.out('    ' + c.cyan('forge install model <MODEL>') + '         pull a model into Ollama');
  ui.out('    ' + c.cyan('forge run <MODEL>') + '                   start a model');
  ui.out('    ' + c.cyan('forge serve') + '                         start ollama serve with CORS open');
  ui.out('    ' + c.cyan('forge doctor') + '                        check the setup');
  ui.out('    ' + c.cyan('forge version') + '                       version');
  ui.out();
  ui.out('  ' + c.bold('OPTIONS FOR run'));
  ui.out('    ' + c.cyan('--agent') + '      skip the question, start as an agent');
  ui.out('    ' + c.cyan('--chatbot') + '    skip the question, start as a chatbot');
  ui.out();
  ui.out('  ' + c.bold('THE TWO MODES'));
  ui.out('    ' + c.bold('Agent') + '     runs in the folder ' + c.cyan('cd') + ' put you in. It can create,');
  ui.out('              edit and delete files there. You approve every change.');
  ui.out('    ' + c.bold('Chatbot') + '   chat only. It never touches your files.');
  ui.out();
  ui.out('  ' + c.bold('EXAMPLES'));
  ui.out('    ' + c.dim('$') + ' forge search models --recommended');
  ui.out('    ' + c.dim('$') + ' forge install model muse-code');
  ui.out('    ' + c.dim('$') + ' cd ~/my-project && forge run muse-code --agent');
  ui.out();
  ui.out('  ' + c.bold('REQUIREMENTS'));
  ui.out('    Ollama must be installed — ' + c.cyan('https://ollama.com/download'));
  ui.out('    The CLI checks for it, signs you in, and starts the server itself.');
  ui.out();
  ui.out('  ' + c.bold('PUBLISHING A MODEL'));
  ui.out('    Visit ' + c.cyan(CONTACT_URL) + ' — describe your model or its system');
  ui.out('    instructions and include your email. You get an answer either way.');
  ui.out();
}

/* ---------- listing ---------- */

function listModels() {
  const ids = registry.ids();
  ui.banner();
  ui.out('  ' + ui.c.bold('Models in CLI.txt') + ui.c.dim('  (' + ids.length + ')'));
  ui.out();
  for (const id of ids) {
    const d = registry.detail(id);
    const star = d && d.recommended ? ui.c.ember(' *') : '  ';
    ui.out('  ' + star + ' ' + ui.c.bold(id.padEnd(18)) + ' ' + ui.c.dim(registry.ollamaId(id)));
    if (d) ui.out('     ' + ui.c.dim(d.summary));
    ui.out('     ' + ui.c.dim('ollama.txt: ' + registry.ollamaTxtPath(id)));
    ui.out();
  }
  ui.out('  ' + ui.c.dim('* recommended.  Install one with ') + ui.c.cyan('forge install model <id>'));
  ui.out();
}

function searchModels(args) {
  const wantRecommended = args.includes('--recommended');
  const keyword = args.filter((a) => !a.startsWith('--')).join(' ');

  let rows = wantRecommended ? registry.recommended() : registry.search(keyword);
  if (wantRecommended && keyword) {
    const term = keyword.toLowerCase();
    rows = rows.filter((m) =>
      [m.id, m.name, m.summary, (m.tags || []).join(' ')].join(' ').toLowerCase().includes(term)
    );
  }

  ui.banner();
  const title = wantRecommended
    ? 'Recommended models'
    : keyword
      ? `Models matching "${keyword}"`
      : 'All models';
  ui.out('  ' + ui.c.bold(title) + ui.c.dim('  (' + rows.length + ')'));
  ui.out();

  if (!rows.length) {
    ui.out('  ' + ui.c.dim('Nothing matched. Try ') + ui.c.cyan('forge search models --recommended'));
    ui.out();
    return;
  }

  for (const m of rows) {
    ui.out(
      '  ' +
        (m.recommended ? ui.c.ember('*') : ' ') +
        ' ' +
        ui.c.bold((m.name || m.id).padEnd(18)) +
        ' ' +
        ui.c.dim(m.id)
    );
    if (m.summary) ui.out('    ' + ui.c.dim(m.summary));
    if (m.tags && m.tags.length) ui.out('    ' + ui.c.dim('tags: ' + m.tags.join(', ')));
    ui.out();
  }
  ui.out('  ' + ui.c.cyan('forge install model <id>') + ui.c.dim(' to install one.'));
  ui.out();
}

/* ---------- resolving ---------- */

function resolveOrExit(cliId) {
  if (!cliId) {
    ui.fail('Which model? Try ' + ui.c.cyan('forge models') + ' to see them.');
    process.exit(1);
  }
  if (!registry.has(cliId)) {
    ui.fail(`"${cliId}" is not a model in CLI.txt.`);
    const near = registry.suggest(cliId);
    if (near.length) ui.info('did you mean: ' + near.join(', '));
    ui.info('run ' + ui.c.cyan('forge models') + ' for the full list');
    process.exit(1);
  }
  const id = registry.ollamaId(cliId);
  ui.info(cliId + ui.c.dim('  ->  ' + registry.ollamaTxtPath(cliId) + '  ->  ' + id));
  return id;
}

/**
 * Everything that has to be true before a model can talk: Ollama installed,
 * signed in, server up, model pulled.
 */
async function prepare(cliId) {
  const ollamaModelId = resolveOrExit(cliId);
  ui.out();
  ollama.requireInstalled();
  ollama.signin();
  await ollama.ensureServing();
  await ollama.ensureModel(ollamaModelId);
  return ollamaModelId;
}

/* ---------- commands ---------- */

async function install(args) {
  // `forge install model <id>` — "model" is optional sugar.
  const rest = args[0] === 'model' ? args.slice(1) : args;
  const cliId = rest[0];

  ui.banner();
  const ollamaModelId = await prepare(cliId);

  ui.out();
  ui.ok(ui.c.bold(cliId) + ' is ready.');
  ui.out();
  ui.out('  Start it with ' + ui.c.cyan('forge run ' + cliId));
  ui.out();
  return ollamaModelId;
}

async function run(args) {
  const cliId = args.find((a) => !a.startsWith('--'));
  const wantAgent = args.includes('--agent');
  const wantChatbot = args.includes('--chatbot');

  ui.banner();
  const ollamaModelId = await prepare(cliId);

  let mode;
  if (wantAgent && wantChatbot) {
    ui.fail('Pick one: --agent or --chatbot.');
    process.exit(1);
  } else if (wantAgent) {
    mode = 'agent';
  } else if (wantChatbot) {
    mode = 'chatbot';
  } else {
    ui.out();
    ui.out('  ' + ui.c.bold('Do you want to run this model as an agent or a chatbot?'));
    ui.out();
    ui.out('    ' + ui.c.cyan('1') + ' ' + ui.c.bold('Agent') + '     runs in ' + ui.c.dim(process.cwd()));
    ui.out('              it can create, edit and delete files there');
    ui.out('    ' + ui.c.cyan('2') + ' ' + ui.c.bold('Chatbot') + '   chat only, your files are not touched');
    ui.out();
    mode = await ui.choose('  ' + ui.c.dim('1 or 2 ') + '> ', [
      { keys: ['1', 'a', 'agent'], value: 'agent', label: '1 (agent)' },
      { keys: ['2', 'c', 'chat', 'chatbot'], value: 'chatbot', label: '2 (chatbot)' },
    ]);
  }

  if (mode === 'agent') {
    await agent.run(cliId, ollamaModelId);
  } else {
    await chat.run(cliId, ollamaModelId);
  }
}

async function serve() {
  ui.banner();
  ollama.requireInstalled();
  ollama.signin();
  await ollama.ensureServing();
  ui.out();
  ui.out('  ' + ui.c.dim('Equivalent to running:'));
  ui.out('    export OLLAMA_HOST=' + ollama.bindHost());
  ui.out('    export OLLAMA_ORIGINS=' + ollama.serveEnv().OLLAMA_ORIGINS);
  ui.out('    ollama serve');
  ui.out();
  ui.info('OLLAMA_ORIGINS=* is what keeps the browser from blocking localhost Ollama on CORS.');
  ui.info('log: ' + ollama.SERVE_LOG);
  ui.out();
}

async function doctor() {
  ui.banner();
  ui.out('  ' + ui.c.bold('Checking your setup'));
  ui.out();

  const v = ollama.version();
  if (v) ui.ok('ollama ' + ui.c.dim(v));
  else ui.fail('ollama not found on PATH — https://ollama.com/download');

  ui.info('registry: ' + (registry.ROOT ? path.join(registry.ROOT, 'CLI.txt') : 'NOT FOUND'));
  try {
    ui.ok(registry.ids().length + ' models in CLI.txt');
  } catch (err) {
    ui.fail(err.message);
  }

  if (v) {
    const up = await ollama.isUp();
    if (up) {
      ui.ok('server answering at ' + ui.c.dim(ollama.baseUrl()));
      try {
        const installed = await ollama.tags();
        ui.info('installed models: ' + (installed.length ? installed.join(', ') : 'none yet'));
      } catch (err) {
        ui.warn('could not read /api/tags: ' + err.message);
      }
    } else {
      ui.warn('no server on ' + ollama.baseUrl() + ' — ' + ui.c.cyan('forge serve') + ' starts one');
    }
  }
  ui.out();
}

/* ---------- dispatch ---------- */

async function main(argv) {
  const [command, ...args] = argv;

  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      help();
      return;

    case 'version':
    case '--version':
    case '-v':
      ui.out('forgegrit-open ' + pkg.version);
      return;

    case 'models':
      listModels();
      return;

    case 'search': {
      const what = args[0];
      if (what && what !== 'models') {
        ui.fail(`Unknown search target "${what}". Only ` + ui.c.cyan('forge search models') + ' exists.');
        process.exit(1);
      }
      searchModels(args.slice(1));
      return;
    }

    case 'install':
      await install(args);
      return;

    case 'run':
      await run(args);
      return;

    case 'serve':
      await serve();
      return;

    case 'doctor':
      await doctor();
      return;

    default:
      ui.fail(`Unknown command "${command}".`);
      ui.info('run ' + ui.c.cyan('forge help'));
      process.exit(1);
  }
}

main(process.argv.slice(2))
  .then(() => {
    ui.closeRL();
  })
  .catch((err) => {
    ui.closeRL();
    ui.out();
    ui.fail(err && err.message ? err.message : String(err));
    if (process.env.FORGE_DEBUG && err && err.stack) ui.out(err.stack);
    ui.out();
    process.exit(1);
  });
