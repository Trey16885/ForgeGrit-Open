# Publishing the CLI to npm

`forgegrit-open` is **already published**, so anyone can install it with:

```bash
npm install -g forgegrit-open
```

This page is the reference for shipping the *next* version — and for setting the
whole thing up again on a new machine. The first-time steps take about ten
minutes; every release after that is about twenty seconds.

**Shipping an update in one line:** bump the version, then publish.

```bash
npm version patch && npm publish
```

---

## Once, ever: get an npm account

1. Go to [npmjs.com/signup](https://www.npmjs.com/signup) and make an account.
   Free. The username you pick is public and shows up as the package's owner.
2. Verify the email they send you. **npm will refuse to publish until you do.**
3. Turn on two-factor auth when it offers — npm requires 2FA for publishing on
   most accounts now, and you want it anyway.

## Once per computer: log in

In a terminal, anywhere:

```bash
npm login
```

It prints a URL, you open it in a browser, and you approve the login there.
Back in the terminal it says `Logged in on https://registry.npmjs.org/`.

Check it took:

```bash
npm whoami
```

That should print your npm username. If it prints an error, you are not logged
in and publishing will fail.

## Every time: publish

From the **root of this repo** (the folder with `package.json` in it):

```bash
cd ForgeGrit-Open
npm test          # 34 unit tests + 19 end-to-end tests, all should pass
npm publish
```

That is it. Within a minute or so:

```bash
npm install -g forgegrit-open
```

works for anybody, anywhere.

### Check what you are about to ship first

Optional but a good habit — this prints the exact file list without publishing
anything:

```bash
npm pack --dry-run
```

You should see `CLI.txt`, `models.json`, everything under `cli/` and `models/`,
and `docs/cli.md`. That list is controlled by the `files` field in
`package.json`. If something is missing from the package, the CLI will break for
people who install it, so it is worth a look.

## Publishing an update

npm will **not** let you publish the same version twice. Bump the version
first — this command edits `package.json` for you and makes a git commit:

```bash
npm version patch    # 1.0.0 -> 1.0.1   bug fix
npm version minor    # 1.0.1 -> 1.1.0   new feature, nothing broken
npm version major    # 1.1.0 -> 2.0.0   something people relied on changed
npm publish
```

Adding a model counts as `minor`.

## Things that go wrong

| What npm says | What it means |
|---|---|
| `You must be logged in to publish packages` | Run `npm login` |
| `You do not have permission to publish "forgegrit-open"` | Someone else already owns that name on npm. Rename the package — change `"name"` in `package.json` to something free, e.g. `@yourusername/forgegrit-open`, and publish again |
| `You cannot publish over the previously published versions` | Bump the version — `npm version patch`, then publish |
| `Payment Required` on a scoped name | A `@scope/name` package is private by default. Publish it public: `npm publish --access public` |
| `ENEEDAUTH` | Not logged in on this machine |

### If the name is taken

Check before you get attached to it:

```bash
npm view forgegrit-open
```

"404 Not Found" means the name is free. If it is taken, the easy answer is a
scoped name under your own username, which is always yours:

```json
"name": "@trey16885/forgegrit-open"
```

Then publish with `npm publish --access public`, and the install command becomes
`npm install -g @trey16885/forgegrit-open`.

## Un-publishing

You can remove a version within 72 hours:

```bash
npm unpublish forgegrit-open@1.0.1
```

After 72 hours npm mostly will not let you, because other people may depend on
it. Deprecating is the polite alternative:

```bash
npm deprecate forgegrit-open@1.0.1 "use 1.0.2 instead"
```

## After you publish

Update the install command in these three places so the site matches reality:

- `tools/build.js` — the `INSTALL_CLI` constant near the top
- `docs/cli.md` — the Install section
- `README.md` — the quick start block

Then `node tools/build.js` to regenerate the pages.

---

**One warning.** Do not use `npm install -g git+https://github.com/...` as the
install command you tell people to run. It looks like it works — npm even says
"added 1 package" — but npm 10 links the global install into a temporary cache
folder that it then deletes, so `forge` ends up pointing at nothing. Cloning and
running `npm install -g .` does not have this problem.
