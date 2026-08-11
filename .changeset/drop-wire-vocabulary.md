---
"@switchboard-dev/bridge-mcp": minor
---

Rename the exported protocol types and two diagnostic codes so the package matches the vocabulary the specs now use. The specs dropped `wire` as a term because the rule it named — a value must be plain JSON — already had a name, and "the wire" was a third word for something `path`, `protocol`, and `channel` already covered.

Breaking for anyone importing these names or matching on these codes. Doing it now, while the package is unpublished, rather than carrying two vocabularies into 0.1.0.

Exported types:

- `WireMessage` → `ProtocolMessage` (the `PageMessage | BridgeMessage` union)
- `WireCommand` → `AnnouncedCommand` (one announced registry entry, per bridge spec §6.1)

Diagnostic codes, which contract tests match on:

- `wire-illegal` → `not-plain-json`
- `unknown-wire-data` → `unknown-message-data`

The adapter contract's connection-handle interface is renamed `WireConnection` → `ChannelHandle` in the spec. It has no implementation yet, and `ChannelHandle` avoids colliding with the node side's existing `PageConnection`, which is a different thing.
