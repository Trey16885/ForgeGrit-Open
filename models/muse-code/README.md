# Muse Code

Code model, published on ForgeGrit Open.

Muse Code writes, refactors and explains software. It was tuned with ForgeGrit
agent mode in mind, so it is comfortable reading a folder, changing files, and
saying what it changed.

## At a glance

| Field | Value |
|---|---|
| CLI model ID | `muse-code` |
| Ollama model | `treyleo16/muse-code` |
| Parameters | 7B |
| Context | 32K |
| Publisher | treyleo16 |

## Install

```bash
forge install model muse-code
forge run muse-code --agent
```

## What it is good at

- Writing a function, a script or a small module from a description
- Explaining code you did not write
- Refactoring across a handful of files in agent mode
- Test writing
- Shell, Python, JavaScript, TypeScript, Go, Rust, SQL, HTML/CSS

## What it is not

It is 7B. It is fast and it is useful, but it is not going to redesign your
architecture. Keep the asks concrete and local and it earns its keep.

## Prompting notes

In **agent mode** ForgeGrit does not send a hidden system prompt — your first
message is the brief. Say what the project is and what "done" means:

```
This folder is a small Express API. Add a /health route that returns
{"ok": true}, add a test for it in test/, and do not touch package.json.
```

Then let it work. It will show you each file write before it happens, and you
approve or reject.

In **chatbot mode** it will not touch your files at all — good for "explain this
error" without any risk to the folder you are sitting in.

## Modes

| Mode | Use it for |
|---|---|
| Chatbot | Explaining code, snippets, debugging by conversation |
| Agent | Real edits in the folder you `cd`'d into |

## License

ForgeGrit Open Model License.
