# ForgeGrit Open

## Open Models built for you

We don't take lightweight, if someone says we do, tell them you would rather call onions a piece of dog crap.

ForgeGrit Open is part of ForgeGrit. It is a place to publish open models and a
CLI to run them — locally, on your own machine, through Ollama.

```bash
git clone https://github.com/Trey16885/ForgeGrit-Open && npm install -g ./ForgeGrit-Open

forge search models --recommended
forge install model muse-code
cd ~/my-project && forge run muse-code
```

## About Us

We don't restrict much, only real safety that can actually affect the real world, your model can cuss but it can't generate a SVG vector of human body parts.

We are Conservative, and will not fine tune models to be political, unless you are looking for Republican, or Conservative. Your model is small, we don't care but, we won't act like it's breaking technology.

## Connectors

Requires an account at [https://ollama.com](https://ollama.com).

Ollama must be installed before any model will run. The CLI checks for it every
time you open a model, signs you in, and starts the server itself.

## Models on the site

| Model | CLI model ID | Ollama model |
|---|---|---|
| [Claude Fable 5.1](models/claude-fable-5-1/) | `claude-fable-5-1` | `treyleo16/fable-5-1` |
| [GPT 6 Astra](models/gpt-6-astra/) | `gpt-6-astra` | `treyleo16/gpt-6-astra` |
| [GLM 5.3](models/zai-glm-5.3/) | `zai-glm-5.3` | `treyleo16/glm:5-3` |
| [Muse Code](models/muse-code/) | `muse-code` | `treyleo16/muse-code` |

## Publishing a model

Press **+ New Repository** on the site, or follow it here:

> **Model Uploading Instructions**
>
> Visit: https://contact2.me/VA7XQI
>
> Describe your model or create system instructions, then include your email in
> your message. We will email you at treyleo16@gmail.com to let you know whether
> your model was published or rejected. Please wait a little; it takes time.

## The CLI

Full docs: [docs/cli.md](docs/cli.md) · [on the site](docs/cli.html)

Installing it does not require npm publishing — the clone above puts `forge` on
your PATH. To put it on the npm registry as `npm install -g forgegrit-open`,
follow [docs/publishing-to-npm.md](docs/publishing-to-npm.md).

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

### Agent or chatbot

`forge run <model>` asks which one you want:

- **Agent** — runs in the folder `cd` put you in. It can create, edit and
  delete files there, and nowhere else. You approve every change. There is no
  hidden system prompt; your first message is the brief.
- **Chatbot** — chat only. Your files are never touched.

Skip the question with `--agent` or `--chatbot`.

### What it does with Ollama

`forge` never runs `ollama run`. It starts a server in the background and talks
HTTP to it:

1. `ollama --version` — if that fails, it tells you how to install Ollama and stops.
2. `ollama signin` — if a link comes back, you are told to open it.
3. `ollama serve` in the background, unless something already answers.
4. `GET /api/tags` to see whether the model is installed.
5. `ollama pull <id from ollama.txt>` in the background if it is not.
6. `POST /v1/chat/completions`, streamed, for the conversation.

The background server is started with CORS open, so Ollama on localhost still
works from a browser:

```bash
export OLLAMA_HOST=0.0.0.0:11434
export OLLAMA_ORIGINS=*
ollama serve
```

`forge serve` runs exactly that.

## Repository layout

```
index.html              the model index, with + New Repository
CLI.txt                 <cli-model-id> = <path to that model's ollama.txt>
models.json             names, summaries, tags, recommended flags
models/<id>/
  index.html            model page — renders the README, shows install steps
  README.md             the model's documentation
  ollama.txt            the Ollama model id, one line
docs/cli.md             CLI documentation
docs/publishing-to-npm.md  how to put the CLI on the npm registry
cli/bin/forge.js        CLI entry point
cli/src/                registry, ollama client, chat mode, agent mode, ui
tools/build.js          regenerates index.html, docs and model pages
tools/test.js           unit tests
tools/e2e.js            end-to-end CLI test against a stub Ollama
assets/                 stylesheet and the markdown renderer the pages use
```

`CLI.txt` is the file the CLI checks first: if the id the user typed is on the
left, the path on the right is where its `ollama.txt` lives.

## Working on this repo

```bash
node tools/build.js     # regenerate the site after editing models.json
node tools/test.js      # unit tests: registry, agent sandbox, markdown, pages
node tools/e2e.js       # end-to-end: drives the real CLI against a fake Ollama
python3 -m http.server  # then open http://localhost:8000
```

`tools/e2e.js` puts a stub `ollama` on `PATH` and a stub server on a port, so it
never touches a real Ollama install and never pulls a real model.

### Adding a model

1. `mkdir models/<cli-model-id>` with a `README.md` and an `ollama.txt`.
2. Add the model to `models.json`.
3. Add the line to `CLI.txt`.
4. `node tools/build.js && node tools/test.js`.

The build fails loudly if `CLI.txt`, `models.json` and the `ollama.txt` files
disagree with each other.

**Do not guess a model's specs.** `params`, `context` and `license` in
`models.json` are optional — leave a field out and the site simply does not
show it. Fill one in only from the model file itself:

```bash
ollama show <ollama-model-id>
```

A test fails the build if a page states a parameter count, context length or
license that `models.json` does not actually record.
