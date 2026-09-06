'use strict';

/* Chatbot mode: conversation only. No system prompt, no tools, no file
 * access — whatever folder you are in is not touched. */

const ollama = require('./ollama');
const ui = require('./ui');

const HELP = `
  ${ui.c.bold('Chatbot mode')}
    Type a message and press enter. Commands:
      ${ui.c.cyan('/reset')}   forget the conversation so far
      ${ui.c.cyan('/help')}    this list
      ${ui.c.cyan('/exit')}    leave (ctrl+c also works)
`;

async function run(cliId, ollamaModelId) {
  ui.out();
  ui.out('  ' + ui.c.bold(cliId) + ui.c.dim('  chatbot  ·  ' + ollamaModelId));
  ui.out('  ' + ui.c.dim('Chat only — this mode cannot read or change your files.'));
  ui.out('  ' + ui.c.dim('/help for commands, /exit to leave.'));
  ui.out();

  const messages = [];

  for (;;) {
    const input = await ui.ask(ui.c.ember('you ') + ui.c.dim('> '));

    if (!input) continue;
    if (input === '/exit' || input === '/quit') break;
    if (input === '/help') {
      ui.out(HELP);
      continue;
    }
    if (input === '/reset') {
      messages.length = 0;
      ui.info('conversation cleared');
      continue;
    }

    messages.push({ role: 'user', content: input });

    process.stdout.write('\n' + ui.c.cyan(cliId) + ui.c.dim(' > '));
    let reply = '';
    try {
      reply = await ollama.chat(ollamaModelId, messages, {
        onDelta: (piece) => process.stdout.write(piece),
      });
      process.stdout.write('\n\n');
    } catch (err) {
      process.stdout.write('\n');
      ui.fail(err.message);
      messages.pop();
      continue;
    }

    messages.push({ role: 'assistant', content: reply });
  }

  ui.out();
  ui.info('bye');
}

module.exports = { run };
