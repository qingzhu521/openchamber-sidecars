Two working adapters, no fork needed. Same shape @ftiasch described in #1422: a local server that speaks the OpenCode HTTP API and drives the other agent underneath.

- https://github.com/qingzhu521/openchamber-pi-connector drives pi in RPC mode (one `pi --mode rpc` process per session). M1+M2: session create/list/rename/delete, prompt, live text/reasoning over SSE, tool-call parts mapped to the SDK v2 `ToolState` union, abort, model catalog.
- https://github.com/qingzhu521/openchamber-mcode-connector does the same for mcode (`mcode exec --output-format stream-json`, one process per turn, and sessions/history survive adapter restarts via mcode's own store).

On the "implement the runtime in the UI" proposal: you do not have to touch `packages/ui`. The seam already exists in two forms today, `settings.opencodeBinary` for a local launcher and an external server host (URL + apiUrl). Pointing OpenChamber at an adapter needs no change on either side, which is a much smaller blast radius than re-implementing `OpencodeClient` against a second agent in the UI code that imports `@opencode-ai/sdk/v2`.

What a backend has to do is small and testable: it is started as `<binary> serve --hostname <host> --port <port>`, prints `opencode server listening on <url>` on stdout, and answers `/global/health`. Past that it is an API-subset question. We wrote the subset down from OpenChamber's own reducer, bootstrap, and actions: https://github.com/qingzhu521/openchamber-pi-connector/blob/main/docs/api-surface.md

For @tomzx's point in #1422 about a standard so new tools don't reinvent the wheel, the useful artifact is probably a connector spec plus a conformance smoke test, not a UI interface. We have both, running against 1.24.2 (`npm run smoke` in each repo). Happy to hand that over as a starting point if you want it hosted here.

One gap to be honest about: an adapter implements only the endpoints it needs, so permissions and questions are usually stubbed first (that is M3 in both repos). Sessions, streaming, tool calls, and file edits work today.

Adoption friction is mostly documentation: the docs read as OpenCode-only. Opened #3780 to add a short "use a different coding agent" section to the OpenCode server page. Feedback welcome.
