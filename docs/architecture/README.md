# Architecture

This directory contains diagrams and short notes that explain how Switchboard fits together. The specs are the source of truth; these files organize the system view in one place.

- Diagrams explain, specs decide.
- One subject per file.
- Use Mermaid when it helps, and tables or prose when they are clearer.

| File | Subject |
|---|---|
| [`topology.md`](./topology.md) | the three environments, the two communication paths, process and security boundaries, multi-tab behavior |
| [`exposure-model.md`](./exposure-model.md) | who can see what and why: grants, `when`, and the enforcement points |
| [`components.md`](./components.md) | package ownership, dependencies, and version numbers |
| [`plugin-lifecycle.md`](./plugin-lifecycle.md) | plugin, panel, and ElementReference lifecycles |
| [`bridge-flows.md`](./bridge-flows.md) | connection, snapshot sync, invocation, context reads, and events |
| [`feedback-loop.md`](./feedback-loop.md) | the end-to-end human → agent → human walkthrough |
