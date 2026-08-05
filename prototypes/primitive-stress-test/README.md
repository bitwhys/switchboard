# Composition examples: stress-testing the four-primitive rule

> Artifact for [wayfinder ticket #13](https://github.com/bitwhys/switchboard/issues/13) — eval §16's request.
> Three written cross-plugin scenarios, pseudocoded against the locked kernel API (#5), manifest (#6),
> bridge protocol (#11), storage (#8), element identity (#12), and the pinned reference-plugin briefs (#14).
> Each example ends with **Where it strains** — the places the four-primitive rule was genuinely tempted —
> and a verdict. The overall verdict is at the bottom.

The rule under test: every inter-plugin and agent-facing interaction is expressible with exactly
**Command / Event / Context / Service**, with storage as non-primitive infrastructure and the bridge
semantics assigned as locked (Command, Event, Context bridgeable under grants; Service never).

Pseudocode is TypeScript-ish and illustrative — shapes follow the locked decisions, but nothing here is
schema-final; that's #16's job.

---

## Example 1 — Scanner ⇄ Inspector ⇄ Feedback: in-page composition, all four primitives in one flow

**Cast.** `a11y.scanner` (requires `toolbar` + `dom.inspector`; grants `bridge:commands|context|events`,
`dom:read|write`) · `dom.inspector` (provides `dom.inspector@1`) · `switchboard.feedback` (requires
`toolbar` + `dom.inspector`; grants `bridge:commands|events`, `storage:use`).

### The flow

```ts
// ---- a11y.scanner setup ----
const inspector = await api.services.get('dom.inspector')   // hard require: resolves or setup fails loud

api.commands.register({
  id: 'a11y.scan',
  title: 'Run accessibility scan',
  inputSchema: {/* optional `scope`: an ElementReference display envelope */},
  annotations: { readOnlyHint: true },
  async execute(input, invocation) {
    // 1. Hydrate the wire-legal envelope back into a live node — service, never wire
    let root: Element | Document = document
    if (input.scope) {
      const node = inspector.resolve(input.scope)   // throws the single `stale reference` failure
      root = node
    }

    // 2. Run the real third-party dep on live DOM
    const axeResult = await axe.run(root, { signal: invocation.signal })

    // 3. Mint references for violation nodes via the inspector's registry (non-pinning)
    const violations = axeResult.violations.map(v => ({
      ruleId: v.id, impact: v.impact, help: v.helpUrl,
      targets: v.nodes.map(n => inspector.mint(n.element)),  // → display envelopes, wire-legal
    }))

    // 4. Latest state → Context (whole-value replace); the moment → Event (summary only)
    api.context.set('a11y.violations', { scope: input.scope ?? null, violations, ranAt: isoNow() })
    api.events.emit('a11y.scan-completed', { count: violations.length, scoped: !!input.scope })

    return { count: violations.length }              // wire-legal command result
  },
})

// Panel: violations list; "jump to element" = resolve + scroll/flash (dom:write, advisory)
// Command item badge bound to a context key carrying the violation count.
```

```ts
// ---- switchboard.feedback setup (the downstream consumer) ----
// Loose-coupling seam: feedback observes the *event*, reads the *context*, hydrates via the *service*.
api.events.on('a11y.scan-completed', ({ count }) => {
  if (count === 0) return
  const { violations } = api.context.get('a11y.violations')
  panel.offer('Draft annotations from these violations', async () => {
    const inspector = await api.services.get('dom.inspector')
    for (const v of violations) {
      // Durable anchor = element description (a hydration facet), never the reference itself
      const { description } = await inspector.describe(v.targets[0], ['description'])
      outbox.addDraft({ route: currentRoute(), body: prefillFrom(v), anchor: description })
    }  // drafts land in storage — private, reload-surviving, invisible to agents
  })
})
```

### Where it strains

1. **A Context value whose payload is only "half-live."** `a11y.violations` carries ElementReference
   envelopes — honest JSON anywhere (agents can read the key under `bridge:context` and see kind/id/tag/label),
   but *resolving* one requires the inspector service, in-page only. It's tempting to read this as Context
   smuggling liveness — a fifth "live handle" primitive hiding in data. It isn't: the envelope is pure data
   and useful as data; liveness is a separate act with a separate owner (service `resolve` in-page, the
   faceted `dom.describe-element` command over the bridge). The #12 split holds under real load.
2. **The event wants to carry the violation list.** The lazy design puts `violations` in the
   `a11y.scan-completed` payload — and then a feedback panel opened *after* the scan has missed it, and the
   tail buffer bloats. The boundary rule (*latest value → Context; the moment → Event*) forced the right
   shape: summary in the event, state in the context. The rule did work here, not just taxonomy.
3. **Stale scope from an agent.** An agent passes yesterday's reference as `scope` → `resolve` throws the
   single `stale reference` failure → structured invocation error → MCP `isError: true`. No second failure
   vocabulary needed; #12's "one failure" survives contact with a real consumer.

**Verdict: survives.** One flow exercises service hydration, ElementReference as command *input*,
Event-vs-Context boundary, storage-as-working-state, and cross-plugin loose coupling — with zero new
vocabulary.

---

## Example 2 — The agent loop: driving feedback over the bridge

**Cast.** An MCP agent (e.g. Claude Code against the dev server) · `switchboard.feedback`
(grants `bridge:commands` + `bridge:events` — deliberately **no** `bridge:context`) ·
`dom.inspector` (grants `bridge:commands|context`).

### The flow

```ts
// ---- Phase A: human authors (in-page; creation is human-only by design) ----
// Compose in the feedback panel → "anchor to element":
const ref = await api.commands.execute('dom.pick-element', {})
//   ^ cross-plugin in-page dispatch — inspector's handler sees invocation.source: 'plugin';
//     resolves when the human clicks; wire-legal envelope back
const { description } = await (await api.services.get('dom.inspector'))
  .describe(ref, ['description'])                       // durable anchor, fuzzy by design
outbox.addDraft({ route, body, anchor: description })    // storage: survives reload, agents can't see it

// Human clicks "submit" → draft becomes open:
outbox.transition(id, 'open')
api.events.emit('feedback.submitted', { id, route })     // bridge:events → lands in the tail buffer
api.context.set('feedback.open-count', outbox.countOpen()) // page-only key: no bridge:context grant,
                                                           // so this key does not exist at the bridge
```

```
---- Phase B: agent acts (MCP tools, out of page) ----
agent → switchboard.events.tail()          # sees feedback.submitted (bounded ring buffer; poll, not push)
agent → feedback.list({ status: "open" })  # annotations: id, route, body, anchor (description), timestamps
agent   reads anchor.selector / anchor.textHints, finds the component in the codebase, fixes it
agent → feedback.resolve({ id, resolution: "Added aria-label to the icon button (Button.tsx:41)" })
```

```ts
// ---- Phase C: resolution flows back (in-page) ----
// feedback.resolve's execute handler (invocation.source: 'agent'):
outbox.transition(id, 'resolved', resolutionNote)
api.events.emit('feedback.resolved', { id })
api.context.set('feedback.open-count', outbox.countOpen())  // badge on the command item ticks down
// Human sees the resolution note in the panel; resolved annotation stays in the outbox until egressed/cleared.
```

### Where it strains

1. **The agent has no push channel — is one missing?** The loop's reactive half is "agent notices the
   submission." The tempting fifth primitive is a subscription/notification primitive to the agent
   ("agent inbox"). Rejected on the same grounds #5 locked: MCP's notification layer is lossy by spec, and
   kernel Events are strictly ephemeral. The tail buffer closes the gap as *bridge infrastructure acting as
   an ordinary subscriber* — the kernel primitive set is untouched, and polling `switchboard.events.tail`
   is honest about the delivery guarantee actually available.
2. **The outbox begs to be bridged.** The obvious shortcut is exposing storage over the bridge so the agent
   reads annotations "directly." That would misassign a bridge semantic (storage never bridges, #8) *and*
   dissolve the deliberate agent surface: `feedback.list`/`feedback.resolve` is read + resolve only, which
   is what keeps creation human-only. The commands aren't ceremony — they're the policy. Strain resolved by
   the existing rule, not despite it.
3. **`feedback.open-count` proves permission = existence in the negative.** The agent cannot read the badge
   count (no `bridge:context`); if it wants a count it calls `feedback.list` and counts. Slightly less
   convenient for the agent — and exactly the demonstration #6/#14 wanted: an ungranted family simply does
   not exist at the bridge, with no per-key carve-outs creeping in.
4. **The agent gets a fuzzy anchor, not a live element.** Over the bridge the annotation carries an element
   description — selector and text hints — not a resolvable reference (the node is likely gone; the human
   may have navigated away). Tempting to want "durable ElementReference." #12 already ruled it: references
   are session-live, descriptions are the reload-surviving anchor, and the agent's real target is the
   *codebase* anyway. The split is load-bearing, not pedantry.

**Verdict: survives.** The flagship loop closes with two commands, two events, one page-only context key,
and storage — no agent-push primitive, no bridged storage, no durable live handles.

---

## Example 3 — Metrics feeding another plugin's visibility predicate

**Cast.** `switchboard.metrics` (command-less pure producer; grants `bridge:context|events`) ·
`acme.perf-coach`, a **hypothetical third-party plugin** (grants `bridge:commands`) — deliberately not a
reference plugin, to test whether the composition works for code the suite never blessed.

### The flow

```ts
// ---- switchboard.metrics setup (no commands, no UI, no capabilities) ----
onLCP(m  => api.context.set('metrics.vitals.lcp', { value: m.value, rating: m.rating }))
onCLS(m  => api.context.set('metrics.vitals.cls', { value: m.value, rating: m.rating }))
new PerformanceObserver(list => {
  for (const e of list.getEntries())
    api.events.emit('metrics.long-task', { duration: e.duration, startTime: e.startTime })
}).observe({ entryTypes: ['longtask'] })
```

```ts
// ---- acme.perf-coach setup ----
// (a) Visibility over another plugin's context key — open channel, no capability required
api.commands.register({
  id: 'perf-coach.diagnose-lcp',
  title: 'Diagnose slow LCP',
  when: ctx => (ctx.get('metrics.vitals.lcp')?.value ?? 0) > 2500,   // pure, cheap, undefined-tolerant
  async execute() { /* inspect the LCP entry, return wire-legal findings */ },
})

// (b) Visibility derived from *events* — the kernel refuses this directly; the plugin must reduce
const recent: number[] = []
api.events.on('metrics.long-task', ({ startTime }) => {
  recent.push(startTime)
  api.context.set('perf-coach.long-task-pressure', pressureFrom(recent))  // plugin-owned reduction
})
api.commands.register({
  id: 'perf-coach.explain-jank',
  title: 'Explain main-thread jank',
  when: ctx => ctx.get('perf-coach.long-task-pressure') === 'high',
  async execute() { /* ... */ },
})
```

Kernel behavior along the way: signals-style tracking records that the first predicate reads
`metrics.vitals.lcp` and re-evaluates only when that key is set; sync-replay-on-observe means activation
order between metrics and perf-coach doesn't matter (a predicate evaluated before metrics ever wrote sees
`undefined` and the `?? 0` fallback answers honestly); when LCP crosses 2500 the command appears in the
toolbar *and* the agent tool list, with the bridge debouncing `list_changed` churn.

### Where it strains

1. **`when` cannot see Events — is that a missing kernel feature?** Scenario (b) is the sharpest genuine
   temptation in all three examples: "visible when a long task happened recently" cannot be written as a
   predicate, and the plugin is forced to subscribe, reduce, and publish its own context key. A built-in
   event→context reducer (windowing, decay, counts) is the fifth-primitive-shaped hole. Rejected: every
   reduction semantic (how recent? how many? decaying how?) is domain logic no kernel default could pin,
   and the forced detour lands the derived state somewhere *observable and nameable* — the reduction
   becomes debuggable Context instead of invisible kernel machinery. The strain is real; the resolution is
   principled, and it's the strongest evidence in this artifact that Event ephemerality is load-bearing
   rather than dogma.
2. **Soft coupling on a bare key name.** perf-coach depends on `metrics.vitals.lcp` existing yet declares
   no `requires` — nothing checks the coupling at activation. That's the locked open-channel posture
   (context keys and event names are open; capabilities cover services and contracts), and the
   undefined-tolerant predicate is the price of admission. If a consumer needs a guarantee, the move
   already exists: metrics grows `provides: ['metrics.vitals']` and the consumer requires it — an additive
   convention, not a kernel change.
3. **Predicate churn under a chatty producer.** CLS can update often; every `set` re-evaluates dependent
   predicates (no kernel equality dedup), and a threshold predicate could flap the tool list. The locked
   answers compose: predicates must be cheap, the bridge debounces `list_changed`, and hysteresis — if a
   plugin cares — is the plugin's own reduction. No new kernel obligation surfaced.

**Verdict: survives** — including for an unblessed third-party plugin, which is the stronger claim.

---

## Overall verdict

**The four primitives survive all three stress tests. No fifth primitive; no bridge semantic misassigned;
the kernel API decision (#5) stands unamended.**

Candidate fifth primitives that showed up, and where each was absorbed:

| Temptation | Where it appeared | Absorbed by |
| --- | --- | --- |
| Durable/bridgeable live element handle | Ex. 1, Ex. 2 | ElementReference (session-live, service-resolved) vs element description (durable facet) — #12 |
| Agent push/subscription channel ("agent inbox") | Ex. 2 | Bridge tail buffer as an ordinary subscriber; kernel Events stay ephemeral — #11 |
| Bridged storage / shared persistent state | Ex. 2 | Deliberate command surface (`feedback.list`/`resolve`); storage never bridges — #8 |
| Kernel event→context reducer (event-derived visibility) | Ex. 3 | Plugin-owned reduction into a plugin-owned Context key — #5's boundary rule |

Two spec-detail flags for assembly (#16) — details to pin, not decisions to reopen:

1. **The read-only Context view passed to `when` needs its API pinned** (these examples assume
   `ctx.get(key)`); the kernel spec should define its exact surface and its relationship to
   dependency tracking.
2. **`dom.pick-element`'s dual outcome** — these examples assume it both *returns* the picked envelope to
   its invoker and *writes* `dom.selected-element` — should be pinned in the `dom.inspector` capability
   contract so the in-page (await-the-result) and agent (read-the-context) flows are both normative.
