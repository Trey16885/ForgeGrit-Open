# GLM 5.3

Multilingual model with strong structured output, published on ForgeGrit Open.

GLM 5.3 is the one to reach for when the answer has to be a *shape* — JSON, a
table, a config file, a tool call — and when the conversation is not in English.

## At a glance

| Field | Value |
|---|---|
| CLI model ID | `zai-glm-5.3` |
| Ollama model | `treyleo16/glm:5-3` |
| Parameters | 9B |
| Context | 128K |
| Publisher | treyleo16 |

## Install

```bash
forge install model zai-glm-5.3
forge run zai-glm-5.3
```

Note the Ollama id carries a tag: `treyleo16/glm:5-3`. The CLI reads it out of
this model's `ollama.txt`, so you never have to type it yourself.

## What it is good at

- JSON, YAML and CSV that actually parses
- Translation and multilingual chat
- Driving ForgeGrit **agent mode**, where every action is a structured block
- Very long inputs — 128K context, the largest on the site
- Extracting fields out of messy text

## What it is not

It is terser than Astra and less imaginative than Fable. If you want warmth in
the prose, this is not the model.

## Prompting notes

Give it the schema. It fills schemas better than it invents them.

```
Return JSON only, no prose:
{"title": string, "people": string[], "date": "YYYY-MM-DD" | null}
Text: ...
```

Because it holds structure well, GLM 5.3 is the most reliable of the four in
agent mode when you want a long run of file edits without the model drifting out
of the action format.

## Modes

| Mode | Use it for |
|---|---|
| Chatbot | Translation, extraction, structured answers |
| Agent | Multi file edits, config generation, repetitive refactors |

## License

ForgeGrit Open Model License.
