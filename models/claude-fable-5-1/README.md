# Claude Fable 5.1

Mythos-class model, published on ForgeGrit Open.

Fable is built for people who write. It holds a voice across long scenes, keeps
character names and details straight, and does not flatten your prose into
corporate summary-speak the moment a chapter gets long.

## At a glance

| Field | Value |
|---|---|
| CLI model ID | `claude-fable-5-1` |
| Ollama model | `treyleo16/fable-5-1` |
| Publisher | treyleo16 |

For size, quantisation and context length, ask the model itself once it is
installed:

```bash
ollama show treyleo16/fable-5-1
```

## Install

```bash
forge install model claude-fable-5-1
forge run claude-fable-5-1
```

## What it is good at

- Chapters, scenes and short fiction that stay in one voice
- Dialogue that sounds like two different people talking
- Rewriting a passage tighter without losing the meaning
- Worldbuilding notes, character sheets, outlines
- Keeping continuity over a long chat instead of forgetting act one

## What it is not

Fable is a writing model. It is a weak choice for code, math and strict JSON
output. Use [Muse Code](../muse-code/) for code and [GLM 5.3](../zai-glm-5.3/)
for structured output.

## Prompting notes

Fable takes direction well when you tell it the voice up front. It responds
better to a described narrator than to a list of adjectives.

Good:

```
Write chapter two. Narrator is a tired night-shift paramedic, first person,
present tense, short sentences. He does not explain his feelings, he describes
what his hands are doing.
```

Weak:

```
Write a good sad story.
```

In **agent mode**, your first prompt is the whole brief — Fable does not get a
hidden system prompt, so put the voice, the format and the file layout you want
into that first message.

## Modes

| Mode | Use it for |
|---|---|
| Chatbot | Drafting, brainstorming, editing in conversation |
| Agent | Writing chapters straight to files in the folder you `cd`'d into |
