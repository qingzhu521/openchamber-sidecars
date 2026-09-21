# Issue draft: choose a coding agent backend in onboarding

Title: `Onboarding: let people pick a coding agent backend`

Labels: `enhancement`, `docs` (suggested)

## Problem

First launch offers two paths: **Local** (use the OpenCode CLI) and **Remote**
(connect to a server). Both assume OpenCode. OpenChamber actually needs an
OpenCode-compatible API, not OpenCode itself: `opencodeBinary` already accepts
any launcher, and a remote host is just a URL.

So a new user who wants to run pi, mcode, or their own agent sees no entry
point, and the only discoverable route is **Settings → OpenCode CLI** after
setup, with no hint that it accepts anything besides the OpenCode binary.

## Proposal

Two steps, in order. The first is small and can land alone.

### Step 1: name the concept where people already look

In `ChooserScreen.tsx` the Local tab points at the OpenCode install
(`INSTALL_COMMAND`, `DOCS_URL`) and the advanced section exposes the binary path.
Add one sentence and one docs link near the advanced binary field: the app runs
whatever speaks the OpenCode API, and here is how to point it at something else.
Link `packages/docs/content/docs/opencode-server.mdx` (the section added in the
docs PR).

This changes copy only, no flow.

### Step 2: a backend choice in first launch

Give the Local tab a backend picker:

```
Local
  ( ) OpenCode            the bundled CLI (default)
  ( ) Another agent       a launcher that speaks the OpenCode API
        [ path to launcher ]   [ Docs ]
  ( ) Remote              connect to a server URL
```

Reuse the existing binary input and its file picker from `ChooserScreen.tsx`
(`opencodeBinary` state, `requestFileAccess`). When the user picks "Another
agent", set the same `opencodeBinary` setting used today, then continue through
the existing readiness poll (`/global/health`) so a broken launcher fails with
the message already in place.

Files this would touch:

- `packages/ui/src/components/onboarding/ChooserScreen.tsx` (tabs, advanced field)
- `packages/ui/src/components/onboarding/LocalSetupScreen.tsx` (same field, for the recovery path)
- `packages/ui/src/lib/settings/registry.ts` (`opencodeBinary` label/description, if the surface moves)
- `packages/ui/src/lib/i18n/*` (new keys, all locales)
- `packages/docs/content/docs/opencode-server.mdx` (link target)

## Non-goals

- Bundling, installing, or auto-updating a third-party adapter. The user
  supplies the path.
- Validating that a launcher is trustworthy. It runs as a child process with the
  user's permissions, same as the OpenCode binary today.
- A curated in-app adapter catalog. If that is wanted, it is a separate decision
  with a maintenance owner.

## Open questions

1. Is "agent backend" the right words for the reader? `settings.opencodeBinary`
   and the "OpenCode CLI" section name argue for "agent binary" or "server".
2. Should the picker verify the path answers `serve` and `/global/health` before
   accepting it, or reuse the existing post-save health check?
3. Do you want community adapters listed by name in the app, or only in docs?
   Listing them in one place means owning the list.

## Related

- Docs PR: `docs/custom-agent-backends` (adds the "Use a different coding agent"
  section to the OpenCode server page).
- `opencode-server.mdx` already covers external servers with
  `OPENCODE_HOST` + `OPENCODE_SKIP_START=true`; the Remote tab covers the URL
  case, so only the local-binary path is missing from onboarding.
