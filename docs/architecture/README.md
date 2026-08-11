# Architecture

Diagrams and short write-ups that explain how Switchboard fits together, grounded in the [spec suite](../spec/README.md). These files are for whoever is implementing or reading the system — they explain; they never decide.

House rules:

- **Diagrams explain; the specs decide.** Important claims link their spec section. If a diagram disagrees with a spec, the spec wins.
- **One subject per file**, so nothing gets drawn twice. Each file names what it owns and points elsewhere for the rest.
- **Mermaid where a picture helps; tables and prose where they're clearer.**

| File | Subject |
|---|---|
| [`topology.md`](./topology.md) | the three worlds (agent / dev-server / page), the two doors and their two protocols, process and security boundaries, multi-tab |
| [`exposure-model.md`](./exposure-model.md) | who can see what and why: grants, `when`, the two enforcement points |
| [`components.md`](./components.md) | what each package owns, what depends on what, and the four independent version numbers |
| [`plugin-lifecycle.md`](./plugin-lifecycle.md) | the page-world lifecycles: plugin, panel, and ElementReference state diagrams |
| [`bridge-flows.md`](./bridge-flows.md) | everything that crosses the wire: connection, snapshot sync, invocation, context reads, events — drawn here and nowhere else |
| [`feedback-loop.md`](./feedback-loop.md) | the end-to-end human → agent → human walkthrough |
