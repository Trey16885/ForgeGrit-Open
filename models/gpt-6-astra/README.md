# GPT 6 Astra

General purpose assistant model, published on ForgeGrit Open.

Astra is the default pick. If you do not know which model you want, take this
one — it answers questions, explains things, plans work, and handles the long
middle of most conversations without falling over.

## At a glance

| Field | Value |
|---|---|
| CLI model ID | `gpt-6-astra` |
| Ollama model | `treyleo16/gpt-6-astra` |
| Parameters | 12B |
| Context | 64K |
| Publisher | treyleo16 |

## Install

```bash
forge install model gpt-6-astra
forge run gpt-6-astra
```

## What it is good at

- Straight answers to normal questions
- Step by step reasoning that shows its work when you ask for it
- Summarising and comparing long documents
- Planning a task before you hand it to a smaller model
- Email, notes, explanations, general drafting

## What it is not

Astra is a generalist. A specialist beats it on its own turf: Muse Code writes
better code, Fable writes better prose, GLM 5.3 emits cleaner JSON.

## Prompting notes

Astra follows explicit constraints well. Tell it the shape of the answer you
want and it holds to it.

```
Answer in three bullets. No preamble. If you are unsure, say which part.
```

It is the biggest of the four models here at 12B, so it is also the slowest on a
laptop CPU. If it feels sluggish, `forge search models --recommended` will show
you lighter options.

## Modes

| Mode | Use it for |
|---|---|
| Chatbot | Questions, explanations, drafting, day to day work |
| Agent | Reading a folder and reporting on it, small edits, file cleanup |

## License

ForgeGrit Open Model License.
