# @switchboard-dev/bridge-mcp

## 0.1.0

### Minor Changes

- [#75](https://github.com/bitwhys/switchboard/pull/75) [`ea638ae`](https://github.com/bitwhys/switchboard/commit/ea638aedb54763cdcc21006b5162ca50a69c1916) Thanks [@bitwhys](https://github.com/bitwhys)! - Bridge spec §2, §4–§11, §13–§15 node side, ported from the transport spike: the shared Switchboard protocol (`BRIDGE_PROTOCOL_VERSION` defined once, spec-conformant §4–§9 message shapes); the channel-agnostic `Bridge` core — exact-match handshake gate with structured rejection, snapshot-diff registry sync with debounced fan-out, the invocation lifecycle (timeout → cancel path, cooperative cancel, honest disconnect-mid-invoke failure), live context reads with grant reasons, the bounded tail buffer with tab attribution and sequence cursor, the active-tab model, and the reload grace period; the MCP edge — one low-level SDK `Server` per agent session over the one canonical registry, verbatim schema pass-through, `_meta["switchboard/pluginId"]` attribution with the closed-world `openWorldHint` default, the three always-registered `switchboard.*` built-ins, and Ajv `outputSchema` enforcement naming the command; the Streamable HTTP agent path with the Origin allowlist and idle-session reaping; and `startBridgeServer` — loopback-only on default port 7654, where `EADDRINUSE` fails loud with `port-in-use` and never scans. Node-side diagnostics are stderr JSON lines per diagnostics spec §8.

- [#91](https://github.com/bitwhys/switchboard/pull/91) [`05b0692`](https://github.com/bitwhys/switchboard/commit/05b0692edbd1f550f0749d84a1d7c7507fd21e82) Thanks [@bitwhys](https://github.com/bitwhys)! - Rename the exported protocol types and two diagnostic codes so the package matches the vocabulary the specs now use. The specs dropped `wire` as a term because the rule it named — a value must be plain JSON — already had a name, and "the wire" was a third word for something `path`, `protocol`, and `channel` already covered.

  Breaking for anyone importing these names or matching on these codes. Doing it now, while the package is unpublished, rather than carrying two vocabularies into 0.1.0.

  Exported types:

  - `WireMessage` → `ProtocolMessage` (the `PageMessage | BridgeMessage` union)
  - `WireCommand` → `AnnouncedCommand` (one announced registry entry, per bridge spec §6.1)

  Diagnostic codes, which contract tests match on:

  - `wire-illegal` → `not-plain-json`
  - `unknown-wire-data` → `unknown-message-data`

  The adapter contract's connection-handle interface is renamed `WireConnection` → `ChannelHandle` in the spec. It has no implementation yet, and `ChannelHandle` avoids colliding with the node side's existing `PageConnection`, which is a different thing.

### Patch Changes

- Updated dependencies [[`ddbc144`](https://github.com/bitwhys/switchboard/commit/ddbc144a3391d5bfd1475f2ab902a73260265a9e), [`b056780`](https://github.com/bitwhys/switchboard/commit/b056780ac47972c98eac68bf47bc8edfe8684ec9), [`9a28b40`](https://github.com/bitwhys/switchboard/commit/9a28b40f8c0c7062d3a61f9b131a83508d171469), [`db1a331`](https://github.com/bitwhys/switchboard/commit/db1a3314cbf7072dfbb51c6dde9b5d5eb4e77a2a), [`17c312b`](https://github.com/bitwhys/switchboard/commit/17c312b04ca0d960f5189ee5de8e84afac19061a)]:
  - @switchboard-dev/core@0.1.0
