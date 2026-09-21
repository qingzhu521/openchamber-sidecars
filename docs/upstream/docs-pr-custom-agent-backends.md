# Docs PR: using a different coding agent

Status: filed as https://github.com/openchamber/openchamber/pull/3780

Local clone: `openchamber-pi/reference/openchamber`
Fork: `qingzhu521/openchamber` (remote `fork`)
Branch: `docs/custom-agent-backends`, rebased on `main` at `896776d81`
Commit: `b4f0dfc0a` `docs: explain using a different coding agent as the backend`
Patch: `opencode-server-agent-backends.patch` (same directory)

Touches one file: `packages/docs/content/docs/opencode-server.mdx` (+22 lines,
no new page and no sidebar change, so no translation files are required).

## Resubmit

```bash
cd <clone>
git fetch origin main && git rebase origin/main docs/custom-agent-backends
git push fork docs/custom-agent-backends --force-with-lease
```

If the PR was closed and you want it again:

```bash
gh pr create --repo openchamber/openchamber --base main --head qingzhu521:docs/custom-agent-backends \
  --title "docs: explain using a different coding agent as the backend" \
  --body-file <this-file from "## Intent">
```


## PR body

Paste everything below into the PR.

---

## Intent

The docs describe OpenChamber as running on an OpenCode server, and never say
that the server can be something else. People who want to run another coding
agent either assume it is impossible or find the `opencodeBinary` setting and
guess at the contract.

This adds a short section to the OpenCode server page that states the API is the
boundary, shows the two ways to point OpenChamber at a different backend
(external server or `OpenCode binary` in settings), and writes down the two
calls a backend has to answer. No behavior changes.

## Non-goals

- No code, settings, or UI changes.
- No endorsement of any specific adapter. The two examples are marked
  third-party and maintained elsewhere; say the word and I will drop them or
  move them to a community list the project owns.
- The limitations paragraph is deliberately short. A per-adapter feature matrix
  would go stale faster than the docs could keep up.

## Affected surfaces

`packages/docs` only: `content/docs/opencode-server.mdx`, plus one Related line
pointing at the existing Remote Instances page.

| Runtime | Behavior after this change |
|---|---|
| Web | No change |
| Desktop (Electron) | No change |
| VS Code | No change |
| Hosted mobile | No change |
| Capacitor mobile | No change |

## Repository guidance

| Guidance | Why it applies | How the change complies |
|---|---|---|
| Root `AGENTS.md` validation rules | Docs-only change, so the narrowest relevant check applies | Ran `bun run docs:validate`, no source work, no dependency changes |
| `packages/docs/CONTRIBUTING.md` | Owns page structure, voice, and the rule that new pages need every locale | Extended an existing page that already ships in all locales instead of adding a page; sentence-case headings; wrote the contract as two copyable calls |
| `.agents/skills/communication-style/SKILL.md` | Applies to any user-facing text | No em dashes in the new text, no puffery, active voice, plain words, straight quotes |

## Validation

| Check | Result |
|---|---|
| `bun run docs:validate` | Passed: 572 pages, 52 sidebar links |
| Rendered check | Not run. Text-only change to an existing page; no new layout or component |

**Live run:** Not applicable. No user-reachable behavior changes.

## Visual evidence

No visible change. The diff only adds prose to an existing docs page and cannot
affect rendered app behavior.

## Risks and failure behavior

- Third-party links can rot or be renamed. The text already says the adapters
  are maintained outside the project; if you prefer, drop the links and keep the
  mechanism.
- The readiness line (`opencode server listening on <url>`) and `/global/health`
  are implementation details. They are stable and used by the VS Code managed
  process, but the wording here would need to change if that contract does.
- Rollback is reverting this commit; nothing else depends on it.
