'use strict';

/* Everything the CLI does with Ollama.
 *
 * ForgeGrit Open never shells into `ollama run`. It starts `ollama serve` in
 * the background and talks HTTP to it — /api/tags to see what is installed,
 * /v1/chat/completions to hold the conversation.
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ui = require('./ui');

const DEFAULT_HOST = '0.0.0.0:11434';
const STATE_DIR = path.join(os.homedir(), '.forgegrit');
const SERVE_LOG = path.join(STATE_DIR, 'serve.log');

/* ---------- host ---------- */

/** What we tell `ollama serve` to bind to. */
function bindHost() {
  return process.env.OLLAMA_HOST || DEFAULT_HOST;
}

/** Where this process should send its own requests. */
function clientTarget() {
  let raw = bindHost().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  let [host, port] = raw.split(':');
  if (!host || host === '0.0.0.0' || host === '::' || host === '*') host = '127.0.0.1';
  return { host, port: Number(port || 11434) };
}

function baseUrl() {
  const { host, port } = clientTarget();
  return `http://${host}:${port}`;
}

/**
 * The environment `ollama serve` is started with. Setting OLLAMA_HOST and
 * OLLAMA_ORIGINS here is what stops the browser blocking localhost Ollama
 * on CORS when people use it from a web page.
 */
function serveEnv() {
  return Object.assign({}, process.env, {
    OLLAMA_HOST: bindHost(),
    OLLAMA_ORIGINS: process.env.OLLAMA_ORIGINS || '*',
  });
}

/* ---------- installed? ---------- */

/** `ollama --version` — returns the version string, or null if not installed. */
function version() {
  try {
    const r = spawnSync('ollama', ['--version'], { encoding: 'utf8', timeout: 10000 });
    if (r.error || r.status !== 0) return null;
    const text = ((r.stdout || '') + (r.stderr || '')).trim();
    if (!text) return null;
    const m = /(\d+\.\d+\.\d+[^\s]*)/.exec(text);
    return m ? m[1] : text.split('\n')[0];
  } catch (err) {
    return null;
  }
}

function installHelp() {
  const p = process.platform;
  ui.out();
  ui.fail('Ollama is not installed (or is not on your PATH).');
  ui.out();
  ui.out('  ForgeGrit Open runs every model through Ollama, so you need it first.');
  ui.out();
  ui.out('  ' + ui.c.bold('Install it:'));
  if (p === 'darwin') {
    ui.out('    ' + ui.c.cyan('brew install ollama') + ui.c.dim('   (or download the app)'));
    ui.out('    https://ollama.com/download/mac');
  } else if (p === 'win32') {
    ui.out('    ' + ui.c.cyan('winget install Ollama.Ollama'));
    ui.out('    https://ollama.com/download/windows');
  } else {
    ui.out('    ' + ui.c.cyan('curl -fsSL https://ollama.com/install.sh | sh'));
    ui.out('    https://ollama.com/download/linux');
  }
  ui.out();
  ui.out('  Then run this command again.');
  ui.out();
}

/** Hard requirement — prints install help and exits when Ollama is missing. */
function requireInstalled() {
  const v = version();
  if (!v) {
    installHelp();
    process.exit(1);
  }
  ui.ok('Ollama ' + ui.c.dim(v));
  return v;
}

/* ---------- sign in ---------- */

/**
 * `ollama signin`. Older builds do not have the command — that is fine, we
 * skip. If it hands back a URL, the user has to open it themselves.
 */
function signin() {
  let r;
  try {
    r = spawnSync('ollama', ['signin'], { encoding: 'utf8', timeout: 20000 });
  } catch (err) {
    return { status: 'skipped' };
  }
  const text = ((r.stdout || '') + '\n' + (r.stderr || '')).trim();

  if (/unknown command|unknown flag|not a valid command/i.test(text)) {
    return { status: 'skipped' };
  }

  const link = /(https?:\/\/[^\s"'<>]+)/.exec(text);
  if (link) {
    ui.out();
    ui.warn('Ollama needs you to sign in. Open this link in your browser:');
    ui.out();
    ui.out('    ' + ui.c.cyan(link[1]));
    ui.out();
    ui.info('Finish signing in there, then come back here.');
    return { status: 'link', url: link[1] };
  }

  if (r.status === 0) {
    ui.ok('Signed in to Ollama');
    return { status: 'signed-in' };
  }

  if (text) ui.info('ollama signin: ' + text.split('\n')[0]);
  return { status: 'unknown', text };
}

/* ---------- http ---------- */

function request(method, urlPath, body, { timeout = 30000, onChunk } = {}) {
  const { host, port } = clientTarget();
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host,
        port,
        path: urlPath,
        method,
        headers: Object.assign(
          { Accept: 'application/json' },
          payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}
        ),
      },
      (res) => {
        if (onChunk) {
          res.setEncoding('utf8');
          res.on('data', onChunk);
          res.on('end', () => resolve({ status: res.statusCode, text: '' }));
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (data += d));
        res.on('end', () => resolve({ status: res.statusCode, text: data }));
      }
    );
    req.setTimeout(timeout, () => req.destroy(new Error('timed out talking to Ollama')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Is a server already answering on the port? */
async function isUp() {
  try {
    const r = await request('GET', '/api/tags', undefined, { timeout: 2500 });
    return r.status === 200;
  } catch (err) {
    return false;
  }
}

/* ---------- serve ---------- */

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Make sure a server is running. If one is already up we leave it alone;
 * otherwise `ollama serve` is started detached, with the CORS-friendly
 * environment, and we wait for it to answer.
 */
async function ensureServing() {
  if (await isUp()) {
    ui.ok('Ollama server ' + ui.c.dim('already running at ' + baseUrl()));
    return { started: false };
  }

  fs.mkdirSync(STATE_DIR, { recursive: true });
  const log = fs.openSync(SERVE_LOG, 'a');

  const child = spawn('ollama', ['serve'], {
    detached: true,
    stdio: ['ignore', log, log],
    env: serveEnv(),
  });
  child.unref();

  const spin = ui.spinner('starting ollama serve');
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    if (await isUp()) {
      spin.stop();
      ui.ok('Ollama server ' + ui.c.dim(baseUrl() + '  (OLLAMA_ORIGINS=' + serveEnv().OLLAMA_ORIGINS + ')'));
      return { started: true };
    }
  }
  spin.stop();

  ui.fail('Could not reach the Ollama server after starting it.');
  ui.info('Log: ' + SERVE_LOG);
  ui.info('Try starting it yourself:');
  ui.out();
  ui.out('    export OLLAMA_HOST=' + bindHost());
  ui.out('    export OLLAMA_ORIGINS=' + serveEnv().OLLAMA_ORIGINS);
  ui.out('    ollama serve');
  ui.out();
  throw new Error('ollama serve did not come up');
}

/* ---------- models ---------- */

/** Model names from /api/tags. */
async function tags() {
  const r = await request('GET', '/api/tags');
  if (r.status !== 200) throw new Error('/api/tags returned HTTP ' + r.status);
  const data = JSON.parse(r.text);
  return (data.models || []).map((m) => m.name);
}

/** Ollama reports "name:latest"; treat a bare name as its :latest tag. */
function tagMatches(installed, wanted) {
  if (installed === wanted) return true;
  if (!wanted.includes(':') && installed === wanted + ':latest') return true;
  return false;
}

async function isInstalled(ollamaModelId) {
  const list = await tags();
  return list.some((name) => tagMatches(name, ollamaModelId));
}

/**
 * `ollama pull <id>` as a background child process, with its progress
 * mirrored onto one line so the CLI keeps the screen.
 */
function pull(ollamaModelId) {
  return new Promise((resolve, reject) => {
    ui.step('pulling ' + ui.c.bold(ollamaModelId) + ui.c.dim('  (first run can take a while)'));

    const child = spawn('ollama', ['pull', ollamaModelId], {
      env: serveEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const live = process.stdout.isTTY;
    let lastLine = '';
    const show = (buf) => {
      const text = buf.toString();
      const parts = text.split(/[\r\n]+/).filter((s) => s.trim());
      if (!parts.length) return;
      lastLine = parts[parts.length - 1].trim();
      if (live) {
        const line = lastLine.length > 76 ? lastLine.slice(0, 73) + '...' : lastLine;
        process.stdout.write('\r     ' + ui.c.dim(line.padEnd(78)));
      }
    };

    child.stdout.on('data', show);
    child.stderr.on('data', show);

    child.on('error', (err) => {
      if (live) process.stdout.write('\r' + ' '.repeat(84) + '\r');
      reject(err);
    });

    child.on('close', (code) => {
      if (live) process.stdout.write('\r' + ' '.repeat(84) + '\r');
      if (code === 0) {
        ui.ok('pulled ' + ollamaModelId);
        resolve();
      } else {
        reject(new Error('ollama pull failed (exit ' + code + '): ' + lastLine));
      }
    });
  });
}

/** Ensure the model is present locally, pulling it if it is not. */
async function ensureModel(ollamaModelId) {
  if (await isInstalled(ollamaModelId)) {
    ui.ok(ollamaModelId + ui.c.dim(' already installed'));
    return { pulled: false };
  }
  ui.info(ollamaModelId + ' is not installed yet');
  await pull(ollamaModelId);
  return { pulled: true };
}

/* ---------- chat ---------- */

/**
 * Stream a chat completion. Calls onDelta(text) as tokens arrive and
 * resolves with the whole reply.
 */
async function chat(model, messages, { onDelta, temperature } = {}) {
  let full = '';
  let buffer = '';
  let failed = null;

  const body = { model, messages, stream: true };
  if (typeof temperature === 'number') body.temperature = temperature;

  await request('POST', '/v1/chat/completions', body, {
    timeout: 0,
    onChunk(chunk) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        if (!line.startsWith('data:')) {
          // Non-stream error payloads come back as plain JSON.
          try {
            const obj = JSON.parse(line);
            if (obj.error) failed = obj.error.message || String(obj.error);
          } catch (err) {
            /* partial json, ignore */
          }
          continue;
        }

        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;

        try {
          const obj = JSON.parse(data);
          if (obj.error) {
            failed = obj.error.message || String(obj.error);
            continue;
          }
          const delta = obj.choices && obj.choices[0] && obj.choices[0].delta;
          const piece = delta && delta.content;
          if (piece) {
            full += piece;
            if (onDelta) onDelta(piece);
          }
        } catch (err) {
          /* keep going — a split frame lands on the next chunk */
        }
      }
    },
  });

  if (failed) throw new Error(failed);
  return full;
}

module.exports = {
  DEFAULT_HOST,
  SERVE_LOG,
  bindHost,
  baseUrl,
  serveEnv,
  version,
  installHelp,
  requireInstalled,
  signin,
  isUp,
  ensureServing,
  tags,
  isInstalled,
  pull,
  ensureModel,
  chat,
};
