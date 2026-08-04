# Schema authoring for Switchboard commands

**Research question:** Which schema library/standard should Switchboard plugin authors use to put JSON Schema on commands — TypeBox, Zod (v4), Standard Schema, or raw hand-written JSON Schema?

**Date:** 2026-08-04 · **Branch:** `research/shema-authoring-for-commands`
**Versions checked (npm `latest` as of today):** `zod@4.4.3`, `typebox@1.3.10` (v1 line), `@sinclair/typebox@0.34.52` (0.x LTS line), `@standard-schema/spec@1.1.0`, MCP TypeScript SDK v2 (`@modelcontextprotocol/server`, implementing spec revision 2026-07-28).

---

## TL;DR

**The kernel (`core`) should depend on no schema library.** `Command.inputSchema`/`outputSchema` stay plain JSON Schema objects (target dialect: draft 2020-12, matching MCP's default), exactly as already locked. For runtime validation, `Command` additionally carries an optional plain **`validate` function** (Standard Schema's `validate` signature, typed structurally against the vendored ~30-line `@standard-schema/spec` interfaces — a *types-only* dependency with zero runtime bytes).

**Plugin authors should be told: "anything that implements Standard Schema *with* JSON Schema support works; Zod v4 is the default recommendation; raw JSON Schema always works."** A tiny first-party helper (`defineSchema()` / `fromStandardSchema()`, ~20 lines, shippable inside `core`) accepts any `StandardSchemaV1 & StandardJSONSchemaV1` object (Zod ≥4.2, ArkType, Valibot), extracts JSON Schema via `~standard.jsonSchema.input({ target: 'draft-2020-12' })`, and wires `~standard.validate` into the command's `validate` slot. TypeBox authors need no conversion at all — their types *are* JSON Schema objects — and pair with `typebox/value` if they want validation.

**Evidence flag — one premise in the task brief is outdated:** Standard Schema is no longer validation-only. Spec **v1.1.0 (released 2025-12-15)** added a second spec, `StandardJSONSchemaV1`, which standardizes JSON Schema *emission* (`~standard.jsonSchema.input/output({ target })`), and Zod implements it since 4.2.0. The MCP TypeScript SDK v2 builds its entire tool-schema story on exactly this interface. This does **not** overturn the locked decision (commands still carry verbatim JSON Schema; the bridge still consumes it verbatim) — it *strengthens* it, because there is now a standard, library-agnostic way to get from any major schema library to the JSON Schema the command carries.

---

## 1. Fidelity of emitted JSON Schema

### What the MCP side expects (the consumer contract)

The current MCP spec (revision 2026-07-28) is explicit about tool schemas:

> `inputSchema`: JSON Schema defining expected parameters … **Defaults to 2020-12 if no `$schema` field is present** … MUST be a valid JSON Schema object (not `null`)

and the same for `outputSchema`. An explicit `$schema` of draft-07 is also shown as valid. Source: [MCP spec — Tools (2026-07-28)](https://modelcontextprotocol.io/specification/2026-07-28/server/tools). (The older 2025-06-18 revision said only "JSON Schema defining expected parameters" with no dialect language; the 2020-12 default is a 2026 clarification.)

The official MCP TypeScript SDK v2 hard-codes the same target when converting author schemas:

```ts
// packages/core-internal/src/util/standardSchema.ts
export const JSON_SCHEMA_CONVERSION_TARGET = 'draft-2020-12';
result = std.jsonSchema[io]({ target: JSON_SCHEMA_CONVERSION_TARGET });
```

Source: [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk), `packages/core-internal/src/util/standardSchema.ts` (verified from a clone of `main`, 2026-08-04).

**Conclusion:** Switchboard's canonical dialect should be **draft 2020-12, no `$schema` field required** — that is byte-for-byte what the bridge can pass through as MCP `inputSchema`/`outputSchema`.

### Zod v4 — `z.toJSONSchema()` (native, no `zod-to-json-schema` dependency)

Per [zod.dev/json-schema](https://zod.dev/json-schema):

- **Target:** `"draft-2020-12"` is the **default**; also supports `"draft-07"`/`"draft-7"`, `"draft-04"`, and `"openapi-3.0"`.
- **Unrepresentable types** (`z.date()`, `z.bigint()`, `z.symbol()`, `z.map()`, `z.set()`, `z.transform()`, `z.undefined()`, `z.void()`): **throw by default**; `unrepresentable: "any"` degrades them to `{}`. Verified empirically with `zod@4.4.3`: `z.toJSONSchema(z.object({ a: z.date() }))` throws `"Date cannot be represented in JSON Schema"`. Throw-by-default is the right failure mode for Switchboard — a plugin author finds out at build/registration time, not when an agent gets a garbage schema.
- **$ref handling:** `reused: "inline"` (default) vs `"ref"` (extract repeated schemas to `$defs`); cycles are broken with `$defs`/`$ref` by default (`cycles: "ref"`), or `cycles: "throw"`.
- **Metadata:** `.meta({ title, description, examples })` / `z.globalRegistry` flow into the emitted schema — important because `description` fields are what the LLM actually reads.
- **io:** `io: "input" | "output"` picks which side of a transform-bearing schema to emit — maps directly onto command input vs output schemas.
- **Standard JSON Schema:** since zod 4.2.0, Zod schemas expose `~standard.jsonSchema` (see §on Standard Schema below). Verified empirically on `zod@4.4.3`: `Object.keys(schema['~standard'])` → `['validate', 'vendor', 'version', 'jsonSchema']`, and `schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' })` returns `{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object",...}`. (The 4.2.0 version gate is stated in the MCP SDK source: *"zod 4.0–4.1 implements StandardSchemaV1 but not StandardJSONSchemaV1 … Upgrade to zod >=4.2.0"*, `packages/core-internal/src/util/standardSchema.ts`.)

**Fidelity verdict: high.** Emits standard 2020-12 by default with sane, loud failure for non-JSON types. The only caveat is that Zod is a *superset* of JSON Schema (transforms, refinements via arbitrary functions), so a `.refine()` constraint validates at runtime but is invisible in the emitted schema — acceptable, and inherent to any TS-first library.

### TypeBox — types ARE JSON Schema

TypeBox's own description: *"Json Schema Type Builder with Static Type Resolution for TypeScript"*; it *"creates in-memory JSON Schema objects that infer as TypeScript types."* The v1 line (published as **`typebox`**, currently 1.3.10; the 0.x LTS line remains **`@sinclair/typebox`**, currently 0.34.52) advertises *"native JSON Schema 2020-12 support"*, with its validator covering drafts 3 through 2020-12. Source: [github.com/sinclairzx81/typebox](https://github.com/sinclairzx81/typebox).

Verified empirically (`typebox@1.3.10`): `JSON.stringify(Type.Object({ a: Type.String() }))` → `{"type":"object","required":["a"],"properties":{"a":{"type":"string"}}}` — a clean, plain JSON Schema object. (TypeBox's internal bookkeeping lives on symbol keys, which vanish under JSON serialization/`structuredClone`.) There is **no conversion step and therefore zero conversion-fidelity risk**: what the author writes is literally what the MCP bridge transmits. Constraint keywords (`minLength`, `pattern`, `description`, …) are passed as options objects and land verbatim in the schema. The only footguns are TypeBox's deliberately non-serializable types (`Type.Transform`, JS-specific types), which authors must simply not put on a command boundary.

**Fidelity verdict: perfect by construction** — TypeBox is the "the schema field is the source of truth" option.

### Standard Schema — now *two* specs (this changed in Dec 2025)

[standardschema.dev](https://standardschema.dev/) ([spec repo](https://github.com/standard-schema/standard-schema), `@standard-schema/spec@1.1.0`) now defines:

- **`StandardSchemaV1`** (the original, Jan 2025): `~standard.{version, vendor, types, validate}` — a validation + type-inference interface only. This part of the task brief's "spoiler" was correct for v1.0.
- **`StandardJSONSchemaV1`** (added in **v1.1.0, released 2025-12-15** — release note: *"Adds the Standard JSON Schema specification"*, [release](https://github.com/standard-schema/standard-schema/releases/tag/v1.1.0)): `~standard.jsonSchema.{input, output}(options: { target })` returning a JSON Schema object, with targets `"draft-2020-12" | "draft-07" | "openapi-3.0" | (string)`; the spec directs implementers to prioritize 2020-12 and draft-07. Verified against the spec source (`packages/spec/src/index.ts`).

Standard Schema still **emits nothing itself** — it is an interface. But it now standardizes the *shape of the emitter*, so accepting "any Standard Schema library with JSON Schema support" no longer means per-vendor adapters. Known implementers of the combined interface (per MCP SDK source comments): **Zod ≥4.2, ArkType, Valibot** (via `@valibot/to-json-schema`). **TypeBox does not implement Standard Schema** in either its plain types or its compiled validators (verified empirically on 1.3.10: no `~standard` key on either) — TypeBox doesn't need the emission half (it *is* JSON Schema), but it means TypeBox users take the raw-JSON-Schema path through any Standard-Schema-shaped API.

### Raw JSON Schema

Trivially perfect fidelity and dialect control; no inference, no runtime validation, and hand-written schemas drift from hand-written TS types. Fine for zero-arg or one-string-arg commands (a large fraction of dev-tool commands).

---

## 2. TypeScript inference ergonomics

| | Zod v4 | TypeBox | Raw JSON Schema |
|---|---|---|---|
| Inference | `z.infer<typeof S>` / `z.input` / `z.output` | `Type.Static<typeof S>` (v1) / `Static<typeof S>` (0.x) | none (generic cast, or heavyweight `json-schema-to-ts`) |
| Authoring style | chained methods, TS-first (`z.string().min(1).describe(...)`... in v4, `.meta()`) | JSON-Schema-first builder (`Type.String({ minLength: 1, description })`) | hand-written objects |
| Learning curve / familiarity | The de-facto standard; ~**252M downloads/week** ([npm API](https://api.npmjs.org/downloads/point/last-week/zod), 2026-07-28→08-03) | `@sinclair/typebox` ~109M/wk (heavily transitive — Fastify ecosystem); `typebox` v1 ~7M/wk | universal but verbose |
| zod/mini caveat | functional wrappers (`z.nullable(z.optional(z.string()))`) — docs themselves say *"you should probably use regular Zod unless you have uncommonly strict constraints around bundle size"* ([zod.dev/packages/mini](https://zod.dev/packages/mini)) | n/a | n/a |

Practical read: nearly every plugin author already knows Zod; its editor experience (hover types, autocomplete on chains) is best-in-class. TypeBox's ergonomics are genuinely good *if you think in JSON Schema*, which is arguably the honest mental model for an MCP-facing command — but it's a second library to learn, and its v0→v1 package split (`@sinclair/typebox` → `typebox`, different import style) is a churn hazard right now. Raw JSON Schema has the worst DX for anything beyond trivial shapes because types and schema are maintained twice.

---

## 3. Bundle cost

Measured locally on 2026-08-04: `esbuild --bundle --minify --format=esm`, gzip via `gzip -c | wc -c`, on realistic entry points (build one object schema; for validation variants, also validate; for zod, also call `z.toJSONSchema`). Cross-checked against the [Bundlephobia API](https://bundlephobia.com/api/size?package=zod@4.4.3) where it can measure (it can't measure subpath exports like `zod/mini`).

| Entry point | min | min+gzip | Notes |
|---|---:|---:|---|
| **raw JSON Schema** | 0 | **0** | the baseline |
| `zod@4.4.3` (classic, `z.object` + `parse` + `toJSONSchema`) | 330.1 kB | **65.9 kB** | Bundlephobia: 281.3 kB / 61.8 kB for the bare package. Classic Zod barely tree-shakes. |
| `zod/mini` (same workload incl. `toJSONSchema`) | 25.6 kB | **8.7 kB** | tree-shakable functional variant; docs' own numbers: 2.12 kB vs 5.91 kB gz for a boolean parse ([zod.dev/packages/mini](https://zod.dev/packages/mini)) |
| `typebox@1.3.10`, named imports (`Object`, `String`, `Number`) | 22.5 kB | **6.9 kB** | schema construction only |
| `typebox@1.3.10`, default `Type` namespace | 92.5 kB | 24.7 kB | the README's own import style defeats tree-shaking |
| `typebox@1.3.10` + `typebox/value` (Check) | 166.8 kB | 44.6 kB | v1's Value module is heavy |
| `typebox@1.3.10` + `typebox/compile` | 181.7 kB | 47.9 kB | |
| `@sinclair/typebox@0.34.52` Type builder | 52.6 kB | 14.1 kB | Bundlephobia: 45.7 kB / 12.4 kB |
| `@sinclair/typebox@0.34.52` + `Value.Check` | 113.7 kB | 28.4 kB | |
| `@cfworker/json-schema@4.1.1` (raw-JSON-Schema validator) | 22.1 kB | **6.2 kB** | what MCP SDK v2 uses as its edge-runtime default validator |
| `ajv@8.20.0` (reference) | 111.7 kB | 32.8 kB | Bundlephobia; why "just use ajv" is not a kernel answer |

Takeaways:

1. **If `core` depended on classic Zod it would roughly triple-to-quadruple a realistic kernel budget on its own (~66 kB gz).** That alone settles the kernel-dependency question.
2. The *author-side* story is fine either way: `zod/mini` (~9 kB gz incl. emission) and tree-shaken TypeBox construction (~7 kB gz) are both cheap; and **schema construction cost can be kept out of the page entirely** if plugins emit JSON Schema at build time or authors hand-write it.
3. Runtime validation is the expensive half everywhere: TypeBox Value ~45 kB gz (v1), ajv ~33 kB gz. The lightweight raw-schema option is `@cfworker/json-schema` at ~6 kB gz — small enough to be an *optional* Switchboard add-on, not a kernel dependency.

---

## 4. Should `core` depend on a schema library? (prior art + validation)

### Prior art — every comparable boundary stays library-agnostic

- **MCP TypeScript SDK v2** — the most on-point precedent, since our bridge feeds it. `registerTool` accepts a `StandardSchemaWithJSON` — defined in-SDK as the intersection `StandardSchemaV1 & StandardJSONSchemaV1`: *"The SDK needs `~standard.jsonSchema` to advertise the tool's argument shape in `tools/list`, and `~standard.validate` to check incoming arguments when a `tools/call` arrives."* Raw JSON Schema is first-class via `fromJsonSchema(schema, validator?)`, whose docstring says: *"Use this when you already have JSON Schema (e.g. **from TypeBox**, or hand-written)"* — it wraps the plain schema in a synthetic `~standard` object whose `jsonSchema.input/output` just return the schema verbatim, with a pluggable validator (*"AJV on Node.js, CfWorker on edge runtimes"*). The SDK depends on no author-side schema library (it bundles zod only as an internal fallback for pre-4.2 Zod schemas). Sources: `packages/core-internal/src/util/standardSchema.ts`, `packages/core-internal/src/validators/fromJsonSchema.ts`, [repo](https://github.com/modelcontextprotocol/typescript-sdk).
- **Vercel AI SDK** — tools accept *"Zod (v3 and v4) directly or via `zodSchema()`, Valibot via `valibotSchema()`, Standard JSON Schema compatible schemas, Raw JSON schemas via `jsonSchema()`"* ([ai-sdk.dev/docs/foundations/tools](https://ai-sdk.dev/docs/foundations/tools)). Same shape: standard interface + raw-JSON-Schema escape hatch.
- **tRPC** — inputs are inferred *"using the Standard Schema interface if available"*; works with *"any library conforming to Standard Schema"* ([trpc.io/docs/server/validators](https://trpc.io/docs/server/validators)).
- **Hono** — *"provides only a very thin Validator"*; core has zero schema deps; Zod/Standard Schema live in optional middleware packages ([hono.dev/docs/guides/validation](https://hono.dev/docs/guides/validation)).
- **Fastify** — the JSON-Schema-native precedent: routes carry raw JSON Schema, validated by a swappable compiler (*"Route validation relies on Ajv v8"*), with TypeBox layered on via type providers ([fastify.dev — Validation and Serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)).

Not one of these bakes a specific schema library into its kernel. The 2026 convergence is precisely: **plain JSON Schema and/or Standard Schema at the boundary; authoring library is the author's business.**

### The validation angle

The kernel legitimately wants to validate inputs before executing a command (agents *will* send malformed args; the MCP spec's security section says servers **MUST** validate all tool inputs). The options:

- **JSON Schema alone doesn't validate**: you'd need ajv (~33 kB gz, plus `eval`-based codegen that CSP-restricted host pages may block) or `@cfworker/json-schema` (~6 kB gz, no codegen) *in the page*. Too much to force on every host for a feature many commands won't use.
- **Zod / TypeBox Value validate natively** — but only if the live schema object reaches the kernel, which is exactly the coupling we're avoiding.
- **Resolution: decouple "schema" (data) from "validate" (capability).** `Command` carries JSON Schema for transport *and* an optional `validate?: (input: unknown) => { value: T } | { issues: Issue[] }` — the `StandardSchemaV1.validate` signature. Authors using Zod get it for free (the helper wires `~standard.validate` in); TypeBox authors can pass `Value.Check`-based closures; raw-schema authors can omit it (kernel then executes unvalidated, same as today's schemaless commands) or opt into a `@switchboard/validate-json-schema` add-on wrapping `@cfworker/json-schema`. The kernel's behavior: if `validate` is present, run it pre-dispatch and return structured issues to the caller (the MCP bridge maps these onto `isError: true` tool results, which the spec notes are what lets a model self-correct).

---

## Comparison table

| Criterion | Raw JSON Schema | Zod v4 (classic / mini) | TypeBox (v1) | Standard Schema |
|---|---|---|---|---|
| Emitted fidelity (2020-12) | perfect (you wrote it) | high — 2020-12 default, throws on unrepresentable, `$defs` for reuse/cycles, `.meta()` → description | perfect by construction (types are the schema) | n/a — interface, not emitter; v1.1 standardizes the emitter shape |
| TS inference | none | `z.infer` — best-known DX | `Static<T>` — good, JSON-Schema-first | inference via `InferInput/InferOutput` over any implementer |
| Bundle (min+gz, measured) | **0** | 65.9 kB / **8.7 kB** (mini, incl. emission) | **6.9 kB** build-only (named imports); +~45 kB gz for Value | ~0 (types only) |
| Runtime validation | needs external validator (cfworker ~6 kB gz) | native (`parse` / `~standard.validate`) | `typebox/value` or `typebox/compile` | `~standard.validate` on any implementer |
| MCP alignment | verbatim pass-through; SDK `fromJsonSchema()` names this exact path | SDK v2's blessed default (needs ≥4.2) | explicitly named in SDK docs as the raw-schema case | the SDK v2 tool-schema contract itself |
| Risk notes | type/schema drift, verbose | classic Zod too heavy for `core`; superset semantics (refinements invisible in schema) | v0→v1 package rename churn; no `~standard`; namespace import defeats tree-shaking | adoption of the JSON Schema half is young (Dec 2025) |

---

## Recommendation

### (a) What the kernel accepts and depends on

1. **`core` takes zero runtime schema dependencies.** The `Command` type keeps the locked shape and adds one optional capability:

   ```ts
   // conceptually — in @switchboard/core
   interface Command<In = unknown, Out = unknown> {
     // ...id, title, run, etc.
     inputSchema?: JsonSchema;   // plain object, draft 2020-12 semantics, no $schema needed
     outputSchema?: JsonSchema;  // consumed VERBATIM by bridge-mcp as MCP tool schemas
     validate?: (input: unknown) =>
       | { value: In }
       | { issues: ReadonlyArray<{ message: string; path?: ReadonlyArray<PropertyKey> }> };
   }
   ```

   `JsonSchema` is `Record<string, unknown>` (or a structural type); the `validate` result shape is Standard Schema's `Result`, so any `~standard.validate` slots in directly. The only "dependency" is vendoring/`devDep`-ing the `@standard-schema/spec` **types** (~30 lines, 0 runtime bytes) — the same move the MCP SDK makes.

2. **Canonical dialect: JSON Schema draft 2020-12, `$schema` omitted** — matching both the MCP spec default ("Defaults to 2020-12 if no `$schema` field is present") and the MCP SDK's hard-coded conversion target.

3. **Kernel pre-dispatch:** if `command.validate` exists, run it before `run()`; surface issues as a structured invocation error. `bridge-mcp` maps issues to MCP tool-execution errors (`isError: true`). No validator library anywhere in `core`.

4. **First-party helper, shipped in `core` (it's ~20 lines) or as `@switchboard/schema`:**

   ```ts
   import type { StandardSchemaV1, StandardJSONSchemaV1 } from '@standard-schema/spec';

   type SchemaWithJson<I, O> = StandardSchemaV1<I, O> & StandardJSONSchemaV1<I, O>;

   export function fromStandardSchema<I, O>(schema: SchemaWithJson<I, O>) {
     return {
       inputSchema: schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
       validate: (v: unknown) => schema['~standard'].validate(v),
     };
   }
   ```

   Called once at plugin registration; works with Zod ≥4.2, ArkType, and Valibot today, and with anything that adopts spec v1.1 tomorrow. (Emission happens once per command at registration — negligible cost.) A second micro-helper for TypeBox users is *not needed*: they assign the schema object directly.

### (b) What to recommend plugin authors use

- **Default recommendation in docs and templates: Zod v4 (≥4.2), via the helper.** It's what plugin authors already have installed, its `z.toJSONSchema`/`~standard.jsonSchema` emission targets 2020-12 natively with throw-on-unrepresentable safety, and it matches the MCP SDK v2 happy path exactly. Bundle-sensitive plugins use **`zod/mini`** (~8.7 kB gz measured, same emission and Standard Schema support) — worth mentioning, but per Zod's own docs most plugins shouldn't bother.
- **Document TypeBox as the equally-blessed "closest to the wire" option** for authors who think in JSON Schema: assign `Type.Object(...)` straight to `inputSchema` (zero conversion, zero fidelity risk, ~7 kB gz with named imports), add `typebox/value` only if they want `validate`. Advise named imports and the `typebox` v1 package.
- **Raw JSON Schema stays fully supported and documented** — the right choice for zero/one-arg commands, and the guarantee that Switchboard never *requires* a schema library.
- **Do not build on Standard Schema *validation-only* libraries without the JSON Schema half** (e.g. Effect Schema until it implements v1.1): the kernel needs the schema as data; `~standard.validate` alone can't produce it. The helper's type signature (`StandardSchemaV1 & StandardJSONSchemaV1`) enforces this at compile time — same stance as MCP SDK v2, which throws `"does not implement StandardJSONSchemaV1"` at runtime for such vendors.

### What would change this

- If TypeBox v1 adopts Standard Schema (watch [sinclairzx81/typebox](https://github.com/sinclairzx81/typebox)), the helper covers it too and the TypeBox path gets `validate` for free.
- If a future MCP revision moves off 2020-12-by-default (no sign of that; 2026-07-28 doubled down), the canonical dialect note changes — the architecture doesn't, since every author path can retarget (`z.toJSONSchema(s, { target })`, Standard JSON Schema `target` option, or a `$schema` field on raw schemas).

---

## Sources

- MCP spec, Tools (2026-07-28): https://modelcontextprotocol.io/specification/2026-07-28/server/tools (inputSchema "Defaults to 2020-12"); 2025-06-18 revision: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- MCP TypeScript SDK v2: https://github.com/modelcontextprotocol/typescript-sdk — `packages/core-internal/src/util/standardSchema.ts` (`JSON_SCHEMA_CONVERSION_TARGET`, `StandardSchemaWithJSON`, zod 4.2 gate), `packages/core-internal/src/validators/fromJsonSchema.ts` (raw-JSON-Schema wrapper, "e.g. from TypeBox", AJV/CfWorker defaults)
- Zod v4 JSON Schema: https://zod.dev/json-schema · zod/mini: https://zod.dev/packages/mini
- TypeBox: https://github.com/sinclairzx81/typebox
- Standard Schema: https://standardschema.dev/ · spec source: https://github.com/standard-schema/standard-schema (`packages/spec/src/index.ts`) · v1.1.0 release (2025-12-15, adds Standard JSON Schema): https://github.com/standard-schema/standard-schema/releases/tag/v1.1.0
- Vercel AI SDK tools: https://ai-sdk.dev/docs/foundations/tools · tRPC validators: https://trpc.io/docs/server/validators · Hono validation: https://hono.dev/docs/guides/validation · Fastify validation: https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
- Sizes: local esbuild `--bundle --minify` + gzip measurements (2026-08-04, package versions as listed); cross-checked with Bundlephobia API (`zod@4.4.3`: 281,328 B / 61,791 B gz; `@sinclair/typebox@0.34.52`: 45,660 B / 12,388 B gz; `ajv@8.20.0`: 111,708 B / 32,805 B gz)
- Popularity: npm downloads API, week of 2026-07-28 → 08-03 (`zod` 251.8M; `@sinclair/typebox` 109.4M; `typebox` 7.0M)
