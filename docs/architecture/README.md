# Architecture

This directory contains diagrams and short notes explaining how Switchboard fits together. The specs are the source of truth; these files organize the system view in one place.

- Diagrams explain, specs decide.
- One subject per file.
- Use Mermaid when it helps, and tables or prose when they are clearer.

| File | Subject |
|---|---|
| [`topology.md`](./topology.md) | the three execution environments, the two paths into the bridge, process and security boundaries, multi-tab behavior |
| [`exposure-model.md`](./exposure-model.md) | who can see what and why: grants, `when`, and where each is enforced |
| [`components.md`](./components.md) | package responsibilities, dependencies, and version numbers |
| [`plugin-lifecycle.md`](./plugin-lifecycle.md) | plugin, panel, and ElementReference lifecycles |
| [`bridge-flows.md`](./bridge-flows.md) | connection, snapshot sync, invocation, context reads, and events |
| [`feedback-loop.md`](./feedback-loop.md) | the end-to-end human → agent → human walkthrough |
