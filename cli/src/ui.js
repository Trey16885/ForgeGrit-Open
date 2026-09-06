'use strict';

const readline = require('readline');

// `forge models | head` closes the pipe on us; that is not a crash.
process.stdout.on('error', (err) => {
  if (err && err.code === 'EPIPE') process.exit(0);
});
process.stderr.on('error', () => {});

const useColor =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb' &&
  process.stdout.isTTY;

const ESC = String.fromCharCode(27);

function paint(code) {
  return (s) => (useColor ? ESC + '[' + code + 'm' + s + ESC + '[0m' : String(s));
}

const c = {
  ember: paint('38;5;208'),
  dim: paint('2'),
  bold: paint('1'),
  red: paint('31'),
  green: paint('32'),
  yellow: paint('33'),
  cyan: paint('36'),
  gray: paint('90'),
};

function out(s = '') {
  process.stdout.write(s + '\n');
}

function info(s) {
  out(c.dim('  ' + s));
}

function step(s) {
  out(c.ember('  ->') + ' ' + s);
}

function ok(s) {
  out(c.green('  ok') + ' ' + s);
}

function warn(s) {
  out(c.yellow('  !!') + ' ' + s);
}

function fail(s) {
  process.stderr.write(c.red('  xx') + ' ' + s + '\n');
}

function banner() {
  out();
  out('  ' + c.ember('/\\') + ' ' + c.bold('ForgeGrit Open') + c.dim('  ·  open models, run locally'));
  out();
}

/* ---------- input ---------- */

let rl = null;

function getRL() {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on('close', () => {
      rl = null;
    });
  }
  return rl;
}

function ask(question) {
  return new Promise((resolve) => {
    getRL().question(question, (answer) => resolve(answer.trim()));
  });
}

async function confirm(question, defaultYes = false) {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const a = (await ask(`${question} ${c.dim(hint)} `)).toLowerCase();
  if (!a) return defaultYes;
  return a === 'y' || a === 'yes';
}

/**
 * Ask a question with fixed choices. Returns the matched choice value.
 * choices: [{ keys: ['1','a','agent'], value: 'agent', label: 'Agent' }, ...]
 */
async function choose(question, choices) {
  for (;;) {
    const a = (await ask(question)).toLowerCase();
    const hit = choices.find((ch) => ch.keys.includes(a));
    if (hit) return hit.value;
    warn('Pick one of: ' + choices.map((ch) => ch.label).join(', '));
  }
}

function closeRL() {
  if (rl) {
    rl.close();
    rl = null;
  }
}

/* ---------- spinner ---------- */

function spinner(label) {
  const frames = ['|', '/', '-', '\\'];
  let i = 0;
  let timer = null;
  const live = process.stdout.isTTY;

  if (live) {
    timer = setInterval(() => {
      process.stdout.write('\r  ' + c.ember(frames[i++ % frames.length]) + ' ' + label + '   ');
    }, 110);
  } else {
    info(label);
  }

  return {
    stop(finalLine) {
      if (timer) {
        clearInterval(timer);
        process.stdout.write('\r' + ' '.repeat(label.length + 12) + '\r');
      }
      if (finalLine) out(finalLine);
    },
  };
}

module.exports = { c, out, info, step, ok, warn, fail, banner, ask, confirm, choose, closeRL, spinner };
