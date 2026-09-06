#!/usr/bin/env node
'use strict';

/* End-to-end test of `forge run`.  node tools/e2e.js
 *
 * Puts a fake `ollama` on PATH and a fake Ollama server on a port, then
 * drives the real CLI through both modes with scripted stdin. Nothing here
 * touches a real Ollama install or pulls a real model.
 */

const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FORGE = path.join(ROOT, 'cli/bin/forge.js');

let passed = 0;
let failed = 0;

function report(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (err) {
    failed++;
    console.log('  FAIL ' + name);
    console.log('       ' + err.message);
  }
}

/* ---------- fake ollama binary ---------- */

function makeFakeOllama(dir, { installed, serveFor }) {
  const binDir = path.join(dir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const log = path.join(dir, 'calls.log');

  // `ollama serve` has to actually listen, or the CLI is right to give up.
  const serveStub = path.join(dir, 'serve-stub.js');
  fs.writeFileSync(
    serveStub,
    `const http = require('http');
const models = ${JSON.stringify(serveFor || [])};
const [host, port] = (process.env.OLLAMA_HOST || '127.0.0.1:11434').split(':');
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ models: models.map((name) => ({ name })) }));
  })
  .listen(Number(port), host === '0.0.0.0' ? '0.0.0.0' : host);
`
  );

  const script = `#!/bin/sh
echo "$@" >> ${JSON.stringify(log)}
case "$1" in
  --version) echo "ollama version is 0.12.3"; exit 0 ;;
  signin)    ${installed ? 'exit 0' : 'echo "Sign in: https://ollama.com/connect?code=ABC-123"; exit 0'} ;;
  pull)      echo "pulling manifest"; echo "success"; exit 0 ;;
  serve)     exec ${JSON.stringify(process.execPath)} ${JSON.stringify(serveStub)} ;;
  *)         exit 0 ;;
esac
`;
  const file = path.join(binDir, 'ollama');
  fs.writeFileSync(file, script);
  fs.chmodSync(file, 0o755);
  return { binDir, log, serveStub };
}

/* ---------- fake ollama server ---------- */

function startStubServer(state) {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: state.installed.map((name) => ({ name })) }));
      return;
    }

    if (req.url === '/v1/chat/completions') {
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', () => {
        const body = JSON.parse(raw);
        state.requests.push(body);
        const last = body.messages[body.messages.length - 1].content;
        const reply = state.replyFor(last, body.messages);

        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const words = reply.match(/\S+\s*/g) || [reply];
        for (const w of words) {
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: w } }] }) + '\n\n');
        }
        res.end('data: [DONE]\n\n');
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });
  return server;
}

/* ---------- driving the CLI ---------- */

function runForge(args, { cwd, env, stdin, timeout = 20000 }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [FORGE, ...args], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));

    // Feed the scripted answers with a little spacing so prompts land first.
    (async () => {
      for (const line of stdin) {
        await new Promise((r) => setTimeout(r, 350));
        if (!child.stdin.destroyed) child.stdin.write(line + '\n');
      }
    })();

    const killer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('close', (code) => {
      clearTimeout(killer);
      resolve({ code, out, err, all: out + err });
    });
  });
}

/* ---------- the run ---------- */

(async function main() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-e2e-'));
  const projectDir = path.join(work, 'project');
  fs.mkdirSync(projectDir);
  fs.writeFileSync(path.join(projectDir, 'server.js'), 'const port = 3000;\n');

  const state = {
    installed: ['treyleo16/gpt-6-astra:latest'],
    requests: [],
    replyFor: () => 'Hello from the stub.',
  };
  const server = startStubServer(state);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const fake = makeFakeOllama(work, { installed: true });
  const env = Object.assign({}, process.env, {
    PATH: fake.binDir + path.delimiter + process.env.PATH,
    OLLAMA_HOST: '127.0.0.1:' + port,
    NO_COLOR: '1',
  });

  console.log('\nchatbot mode');

  const chatRun = await runForge(['run', 'gpt-6-astra', '--chatbot'], {
    cwd: projectDir,
    env,
    stdin: ['hello there', '/exit'],
  });

  report('resolves the id through CLI.txt to the ollama.txt id', () => {
    assert.ok(
      chatRun.all.includes('gpt-6-astra  ->  models/gpt-6-astra/ollama.txt  ->  treyleo16/gpt-6-astra'),
      chatRun.all.slice(0, 600)
    );
  });
  report('checks the ollama version', () => {
    assert.ok(chatRun.all.includes('Ollama 0.12.3'), chatRun.all.slice(0, 600));
  });
  report('finds the already-running server instead of starting a second one', () => {
    assert.ok(/already running/.test(chatRun.all));
  });
  report('sees the model is already installed and does not pull', () => {
    assert.ok(chatRun.all.includes('already installed'));
    assert.ok(!fs.readFileSync(fake.log, 'utf8').includes('pull'));
  });
  report('streams the reply back', () => {
    assert.ok(chatRun.all.includes('Hello from the stub.'), chatRun.all.slice(-600));
  });
  report('sends no system message — the conversation is the user\'s', () => {
    const roles = state.requests[0].messages.map((m) => m.role);
    assert.deepStrictEqual(roles, ['user']);
  });
  report('exits cleanly', () => assert.strictEqual(chatRun.code, 0));

  console.log('\npulling a missing model');

  state.installed = [];
  const pullRun = await runForge(['install', 'model', 'muse-code'], {
    cwd: projectDir,
    env,
    stdin: [],
  });

  report('pulls the id that came out of ollama.txt', () => {
    const calls = fs.readFileSync(fake.log, 'utf8');
    assert.ok(calls.includes('pull treyleo16/muse-code'), calls);
  });
  report('reports the model as ready', () => {
    assert.ok(pullRun.all.includes('is ready'), pullRun.all.slice(-400));
  });

  console.log('\nagent mode');

  state.installed = ['treyleo16/muse-code:latest'];
  state.requests.length = 0;
  state.replyFor = (last) => {
    if (last.includes('FORGE RESULTS')) return 'Done — I created notes.md.';
    return [
      'I will create that file.',
      '',
      '```forge',
      '{"action": "write", "path": "notes.md", "content": "written by the agent"}',
      '```',
    ].join('\n');
  };

  const agentRun = await runForge(['run', 'muse-code', '--agent'], {
    cwd: projectDir,
    env,
    stdin: ['make a notes.md', 'y', '/exit'],
    timeout: 25000,
  });

  report('the first user message carries the brief and the prompt, with no system role', () => {
    const first = state.requests[0].messages[0];
    assert.strictEqual(first.role, 'user');
    assert.ok(first.content.includes('make a notes.md'));
    assert.ok(first.content.includes('"action": "write"'));
    assert.ok(!state.requests[0].messages.some((m) => m.role === 'system'));
  });
  report('asks the user before writing', () => {
    assert.ok(/proposed:/.test(agentRun.all), agentRun.all.slice(-800));
  });
  report('actually writes the file into the folder cd put you in', () => {
    const written = path.join(projectDir, 'notes.md');
    assert.ok(fs.existsSync(written), 'notes.md was not created');
    assert.strictEqual(fs.readFileSync(written, 'utf8'), 'written by the agent');
  });
  report('feeds the result back and lets the model finish', () => {
    const sentBack = state.requests[1].messages.map((m) => m.content).join('\n');
    assert.ok(sentBack.includes('FORGE RESULTS'));
    assert.ok(agentRun.all.includes('Done — I created notes.md.'));
  });

  console.log('\nmissing ollama');

  const emptyBin = path.join(work, 'empty-bin');
  fs.mkdirSync(emptyBin, { recursive: true });
  const noOllama = await runForge(['run', 'muse-code', '--chatbot'], {
    cwd: projectDir,
    env: Object.assign({}, env, { PATH: emptyBin }),
    stdin: [],
    timeout: 15000,
  });

  report('stops with install instructions when ollama is missing', () => {
    assert.ok(noOllama.all.includes('Ollama is not installed'), noOllama.all.slice(0, 600));
    assert.ok(noOllama.all.includes('https://ollama.com/download'));
    assert.strictEqual(noOllama.code, 1);
  });

  console.log('\nsign-in link');

  const linkWork = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-e2e-link-'));
  const linkFake = makeFakeOllama(linkWork, { installed: false });
  const linkRun = await runForge(['run', 'gpt-6-astra', '--chatbot'], {
    cwd: projectDir,
    env: Object.assign({}, env, { PATH: linkFake.binDir + path.delimiter + process.env.PATH }),
    stdin: ['/exit'],
  });

  report('tells the user to open the sign-in link when ollama returns one', () => {
    assert.ok(/needs you to sign in/i.test(linkRun.all), linkRun.all.slice(0, 800));
    assert.ok(linkRun.all.includes('https://ollama.com/connect?code=ABC-123'));
  });

  console.log('\nthe agent-or-chatbot question');

  state.installed = ['treyleo16/gpt-6-astra:latest'];
  state.replyFor = () => 'Chatbot picked.';
  const askRun = await runForge(['run', 'gpt-6-astra'], {
    cwd: projectDir,
    env,
    stdin: ['2', 'hi', '/exit'],
  });

  report('asks whether to run as an agent or a chatbot', () => {
    assert.ok(
      askRun.all.includes('Do you want to run this model as an agent or a chatbot?'),
      askRun.all.slice(0, 900)
    );
  });
  report('answering 2 starts the chatbot', () => {
    assert.ok(/chatbot .{0,4}·/.test(askRun.all) || askRun.all.includes('chatbot'));
    assert.ok(askRun.all.includes('Chatbot picked.'));
    assert.ok(askRun.all.includes('cannot read or change your files'));
  });

  console.log('\nstarting the server itself');

  // No server on this port yet — the CLI has to start one.
  const serveWork = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-e2e-serve-'));
  const serveFake = makeFakeOllama(serveWork, {
    installed: true,
    serveFor: ['treyleo16/muse-code:latest'],
  });
  const freePort = await new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const p = probe.address().port;
      probe.close(() => resolve(p));
    });
  });

  const serveRun = await runForge(['serve'], {
    cwd: projectDir,
    env: Object.assign({}, env, {
      PATH: serveFake.binDir + path.delimiter + process.env.PATH,
      OLLAMA_HOST: '127.0.0.1:' + freePort,
    }),
    stdin: [],
    timeout: 30000,
  });

  report('starts ollama serve in the background when nothing is listening', () => {
    assert.ok(fs.readFileSync(serveFake.log, 'utf8').includes('serve'), 'serve was never called');
    assert.ok(serveRun.all.includes('Ollama server'), serveRun.all.slice(-700));
  });
  report('opens CORS so a browser can reach localhost ollama', () => {
    assert.ok(serveRun.all.includes('OLLAMA_ORIGINS=*'), serveRun.all.slice(-700));
  });

  server.close();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
