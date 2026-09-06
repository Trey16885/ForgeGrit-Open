# The ForgeGrit Open CLI

`forge` is how you install and run the models published on ForgeGrit Open.
Every model runs locally on your own machine, through Ollama.

## Install

```bash
git clone https://github.com/Trey16885/ForgeGrit-Open
cd ForgeGrit-Open
npm install -g .
```

Or as one line:

```bash
git clone https://github.com/Trey16885/ForgeGrit-Open && npm install -g ./ForgeGrit-Open
```

Node 18 or newer. That is all it takes — `forge` is on your PATH afterwards and
works from any folder.

To update later, `git pull` in that clone and run `npm install -g .` again.

> Once `forgegrit-open` is published to the npm registry, `npm install -g
> forgegrit-open` will work too. See
> [publishing-to-npm.md](publishing-to-npm.md). Installing straight from a git
> URL (`npm install -g git+https://...`) is **not** recommended — npm 10 has a
> bug that leaves the global install pointing at a deleted cache folder.

### Ollama is required

ForgeGrit Open does not ship a model runtime. It drives
[Ollama](https://ollama.com/download), which has to be installed before any
model will start. The CLI checks for it every single time you open a model —
if `ollama --version` does not answer, `forge` stops and tells you how to
install it.

| Platform | Install |
|---|---|
| macOS | `brew install ollama` |
| Linux | `curl -fsSL https://ollama.com/install.sh \| sh` |
| Windows | `winget install Ollama.Ollama` |

You also need a free account at [ollama.com](https://ollama.com). The CLI runs
`ollama signin` for you; if that hands back a link, open the link in your
browser, finish signing in, and come back.

## Commands

```
forge help                          this help
forge models                        every model the CLI knows about
forge search models --recommended   recommended models
forge search models <KEYWORD>       search by name, tag or id
forge install model <MODEL>         pull a model into Ollama
forge run <MODEL>                   start a model
forge serve                         start ollama serve with CORS open
forge doctor                        check the setup
forge version                       version
```

### forge models

Prints every model in `CLI.txt`, with the Ollama id it resolves to and the
path to the `ollama.txt` that holds it. `CLI.txt` is the file that answers
"the user typed this id — which model is that?".

### forge search models

```bash
forge search models --recommended
forge search models code
forge search models writing
```

Searches names, ids, summaries and tags.

### forge install model

```bash
forge install model muse-code
```

Resolves the id through `CLI.txt`, reads the model's `ollama.txt`, and runs
`ollama pull` on what it finds there. Run it once per model per machine.

### forge run

```bash
forge run muse-code
forge run muse-code --agent
forge run gpt-6-astra --chatbot
```

Everything `install` does, and then it asks:

> Do you want to run this model as an agent or a chatbot?

Pass `--agent` or `--chatbot` to skip the question.

## The two modes

### Agent

The agent works inside the folder you ran `forge` from — the one `cd` put you
in. It can **create, edit and delete files** there, and nowhere else. Paths
that climb out of the folder are refused.

There is no hidden system prompt. Your first message *is* the brief: ForgeGrit
hands the model the action format and your prompt together, as one opening
user message, and everything after that is your conversation.

```bash
cd ~/my-project
forge run muse-code --agent
```

```
you > this is a small Express API. add a /health route that returns
      {"ok": true}, and a test for it in test/.
```

The model replies with action blocks:

````
```forge
{"action": "read", "path": "server.js"}
```
````

and `forge` runs them. Every write, edit and delete is shown to you first:

```
  proposed: create test/health.test.js (18 lines)
  allow? [y]es / [n]o / [a]ll for this session >
```

Answer `a` once and the rest of the session runs without asking.

| Action | What it does |
|---|---|
| `list` | names in a folder |
| `read` | file contents |
| `write` | create or replace a file — needs approval |
| `edit` | replace the first exact match of some text — needs approval |
| `delete` | remove a file or an empty folder — needs approval |

Commands inside agent mode: `/pwd`, `/reset`, `/help`, `/exit`.

### Chatbot

Chat only. It cannot see or change your files, no matter what you or the model
say. Commands: `/reset`, `/help`, `/exit`.

## How the CLI talks to Ollama

`forge` never runs `ollama run`. It starts a server in the background and
speaks HTTP to it:

1. `ollama --version` — installed? If not, stop and say how to install it.
2. `ollama signin` — if a link comes back, tell you to open it.
3. `ollama serve` in the background, unless something is already answering.
4. `GET /api/tags` — is the model already pulled?
5. `ollama pull <id from ollama.txt>` in the background if it is not.
6. `POST /v1/chat/completions` for the conversation itself, streamed.

The server is started with:

```bash
export OLLAMA_HOST=0.0.0.0:11434
export OLLAMA_ORIGINS=*
ollama serve
```

`OLLAMA_ORIGINS=*` is the part that stops a browser blocking localhost Ollama
on CORS, which matters if you also use Ollama from a web page. `forge serve`
does exactly this and nothing else, if you want the server without a model.

Set `OLLAMA_HOST` yourself before running `forge` to use a different port —
the CLI follows it for both the server and its own requests.

## Where things live

| File | What it is |
|---|---|
| `CLI.txt` | `<cli-model-id> = <path to ollama.txt>` for every model |
| `models/<id>/ollama.txt` | the Ollama model id, on one line |
| `models/<id>/README.md` | the model's documentation |
| `models/<id>/index.html` | the model's page on the site |
| `models.json` | names, summaries, tags, recommended flags |
| `~/.forgegrit/serve.log` | output from the background `ollama serve` |

Set `FORGE_HOME` to point the CLI at a different checkout. Set `FORGE_DEBUG=1`
for stack traces on error.

## Troubleshooting

**`ollama not found on PATH`** — install Ollama, then reopen your terminal.

**`could not reach the Ollama server`** — check `~/.forgegrit/serve.log`, then
try the three `export`/`ollama serve` lines above by hand.

**The model is slow** — that is the model size against your hardware, not the
CLI. `forge search models --recommended` lists lighter options.

**`forge doctor`** — prints all of it: Ollama version, registry location,
model count, whether a server is answering, and what is installed.
