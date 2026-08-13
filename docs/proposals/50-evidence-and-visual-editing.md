# Workstream 50 — Evidence & Visual Editing Requirements

**Status:** Workstream proposal; not an accepted decision  
**Owns:** Q-003, Q-006, Q-007  
**Coordinates with:** Q-004, Q-005, Q-012, Q-013  
**Applies:** ADR-0003, ADR-0011, and ADR-0012

## Boundary

Annotation, evidence capture, and visual editing are app-layer behavior. They must not become the product model or app-specific core abstractions. The portable runtime supplies the accepted app lifecycle and may inject accepted generic environment services such as overlay hosting and browser targeting. The annotation reference app owns capture policy, masking policy, serializable target snapshots, visual-edit semantics, evidence assembly, and user interaction.

In production, these behaviors are restricted to rendered-document inspection and reversible, tab-local presentation mutation. They must not read framework stores or other application-runtime state, invoke development-only source/server facilities, or intentionally persist application or server state. A visual-edit diff is evidence, never an executable source patch.

## Live targets and serializable snapshots

ADR-0012 places live coordination and durable description on opposite sides of an explicit seam:

- Core's browser-targeting capability creates opaque, page-lifetime live target references. Workstream 50 does not define, inspect, serialize, reconstruct, compare, or persist their representation.
- A live target reference may be consumed during the same page lifetime by an app operation or another compatible injected service. It is invalid after navigation, document replacement, or page teardown and must never enter feedback or evidence envelopes.
- Workstream 50 defines a separate serializable target snapshot captured from a live target. A snapshot is descriptive evidence, not a durable handle and not a promise that the same element can later be resolved.
- A snapshot should contain only masked, bounded descriptive fields needed to understand the observation: document URL under URL-redaction policy, frame relationship, viewport-relative geometry, element category, selected non-sensitive attributes, bounded accessible description, and optional app-owned locator hints.
- Snapshot IDs are evidence-local correlation identifiers. Locator hints may aid human interpretation or correlate items within one evidence bundle, but consumers must not use them to retarget a live page automatically.
- Snapshot creation applies Q-006 before serialization. Inaccessible frames or roots, detached targets, navigation races, and masking uncertainty produce explicit coverage/failure metadata and fail closed where content could leak.

## Q-003 — Evidence transport and storage requirements

### Evidence envelope

Every attachment should have a generated evidence ID and immutable metadata sufficient to validate and deliver it without repository assumptions:

- media type, byte length, digest, capture timestamp, and schema version;
- exact source origin and page URL, with URL fragments and sensitive query values removed by policy;
- viewport dimensions and device-pixel ratio for screenshots;
- masking-policy version and a successful-masking marker;
- relation to the parent feedback event and, for DOM evidence, its serialization format;
- optional serializable target snapshot ID, never a live target reference;
- visual-edit state: `none`, `preview-applied`, or `restored-before-capture`, plus the associated diff ID when applicable.

The envelope must not contain credentials, repository identifiers required by the core, raw selectors that reveal masked content, or executable patch instructions.

### Transport topology

Use a bounded inline-or-upload topology:

1. Small evidence may travel inline with the authenticated feedback event.
2. Larger evidence is uploaded before event dispatch to destination-authorized storage, and the event carries an opaque evidence reference plus integrity metadata.
3. A reference must be scoped to the destination link and feedback event, expire, and require authorization to retrieve. It must not be a permanent public URL.
4. Event dispatch occurs only after all required evidence has been masked and either embedded or durably acknowledged by the selected storage endpoint.

Exact byte thresholds and aggregate limits must be frozen jointly with Q-004 after testing the generic webhook and GitHub adapter. Regardless of numeric values, implementations must enforce per-item, per-event, decoded-image-dimension, DOM-node/depth, and total-upload limits before allocation or dispatch.

### Ownership, retention, and deletion

- Before dispatch, temporary bytes are owned by the capture surface and must be deleted after success, terminal failure, cancellation, unlinking, or expiry.
- After an acknowledged upload, the configured destination/storage operator owns retention and deletion under its published policy; Switchboard must expose this boundary to the user before capture.
- Core must not create a second indefinite evidence archive. Diagnostic logs must exclude evidence bytes and sensitive DOM content.
- Unlinking prevents new retrieval grants and deletes uncommitted temporary evidence. Deletion of already delivered evidence follows the destination contract and must be requestable when that contract supports it.
- Retries reuse the same evidence ID and digest and must not silently create independently retained copies. Expired references require a fresh authorized upload, not widened access.

### Failure behavior

- Masking failure is terminal for that attachment: never send the unmasked original as fallback.
- Partial attachment success must be explicit. Required evidence failure blocks feedback dispatch; optional evidence may be omitted only after clear user confirmation and the event records the omission without sensitive details.
- Size-limit, serialization, upload, integrity, expiry, and authorization failures are distinct machine-readable outcomes.
- Cancellation or page teardown triggers best-effort cleanup and restoration; cleanup failure is surfaced and never represented as successful delivery.

## Q-006 — Exact masking transformation requirements

Masking is a deterministic, versioned transformation applied before evidence leaves the capture process. The same selected regions must be used for DOM and screenshot evidence.

### Selection

Mask an element subtree when it or an ancestor is explicitly marked private, or when a form control has a sensitive semantic:

- `input[type=password]`;
- autocomplete tokens `cc-name`, `cc-given-name`, `cc-additional-name`, `cc-family-name`, `cc-number`, `cc-exp`, `cc-exp-month`, `cc-exp-year`, and `cc-csc`;
- an app-configured explicit mask marker whose exact attribute name is fixed with the reference app.

Do not add heuristic/general-purpose PII detection in v1. Ordinary `name`, `email`, `tel`, and address fields are not automatically masked unless explicitly marked.

### DOM evidence

- Replace a selected subtree with a non-content placeholder; do not traverse or serialize its descendants.
- Retain only layout-oriented data needed to correlate the placeholder: generated mask ID, bounding-box geometry, and element display category. Drop text, values, URLs, accessibility names, IDs, classes, `name`, `value`, `src`, `href`, `style`, `data-*`, and event-related attributes.
- Serialize form-control state from the rendered property only after masking selection; never rely on markup attributes as proof that current values are absent.
- Strip scripts, event handlers, executable URLs, and application-owned object references from all serialized DOM evidence, including unmasked regions.

### Screenshot evidence

- Compute mask rectangles from the same selected nodes and render opaque, non-reversible fills before encoding or upload.
- Expand rectangles to device-pixel boundaries and include overflow-visible descendants belonging to the selected subtree.
- Do not use blur, pixelation, transparency, or post-upload masking.
- Capture and masking must be atomic with respect to scrolling and layout: if geometry changes before encoding, retry the masked capture or fail closed.

### Shadow DOM and frames

- Traverse open shadow roots and apply the same rules.
- Treat closed shadow roots as opaque; if a masked host contains one, mask the host rectangle and replace the whole host in DOM evidence. Otherwise, exclude inaccessible internals and record the coverage limitation.
- Same-origin frames may be captured recursively only when the active app/environment supports that operation and the same masking policy can run inside them.
- Cross-origin frames are opaque. Exclude their DOM; for screenshots, cover their full frame rectangle unless a future accepted policy explicitly allows visible pixels.

The evidence envelope records the masking-policy version and coverage limitations. Any traversal, geometry, rasterization, or serialization error that could break parity fails the affected attachment closed.

## Q-007 — Visual-editor utility grammar and restoration requirements

The annotation reference app should own a small, versioned utility grammar for reversible presentation previews. It is not a core command language and must not be interpreted by downstream agents as source-edit instructions.

### Grammar

- Namespace all utilities under `sb:` and include the grammar version in every diff.
- v1 uses an explicit allowlist of presentation-only properties: display, visibility, opacity, color, background color, border color/style/width/radius, spacing, dimensions, typography, alignment, flex/grid placement, transform, and z-index.
- Allow only enumerated state modifiers needed for preview, initially base plus `hover`, `focus`, `focus-visible`, and responsive viewport buckets supplied by the app.
- Disallow arbitrary property names, arbitrary selectors, URLs, generated content, animations, transitions with external effects, custom-property mutation, and values containing `url()`, `var()`, `attr()`, or executable syntax.
- Arbitrary values, if retained for v1, must be typed per allowlisted property, normalized, length-bounded, and rejected unless parsed completely. They are data values, not raw CSS fragments.
- Computed-style fallback records a bounded allowlist of before/after computed values when no utility token can express the preview. It must never synthesize or claim a source utility or source-file edit.

### Mutation and overlay behavior

- Prefer app-owned overlay DOM for selection outlines, handles, annotations, and mask previews. Overlay nodes must not be inserted into or reconciled by application-owned subtrees.
- Host-element mutation is permitted only when an overlay cannot express the preview. Record the target locator, original attribute/property value and priority, applied value, grammar version, and mutation generation before changing it.
- Do not mutate application state, dispatch synthetic application actions, rewrite stylesheets, modify persisted browser storage, or call development-only facilities in production.
- Diff locators are evidence correlation hints, not stable source identifiers. They must tolerate target disappearance without retargeting a different node.

### Restoration

- Restoration runs on explicit cancel/finish, contribution deactivation, app disposal, navigation/pagehide, extension disconnect, and runtime teardown.
- Restore only a value still carrying the mutation generation written by this app. If host code has changed the same value, report a conflict and remove only app-owned overlay state rather than overwriting the host change.
- Restoration proceeds in reverse mutation order and is idempotent. Observers and event listeners are removed even when individual target restoration fails.
- Before a feedback event is finalized, the app must state whether evidence depicts the original page or an active preview. A preview diff and restoration result travel as evidence metadata.
- Restoration failure is visible to the user and recorded without leaking page content. It never authorizes persistence or source modification.

## ADR-0012 app-contract seam

Q-011 is resolved. Workstream 50 applies its contract as follows:

- use Core's opaque page-lifetime target references only for live coordination and define serializable target snapshots separately as evidence;
- perform restoration during `deactivate -> dispose` before Core removes app UI hosts;
- use the overlay-host service for app-owned overlay UI without adding annotation semantics to that service;
- keep ordinary DOM inspection and presentation mutation as app/browser behavior under ADR-0003, not as security-boundary capability claims;
- make capture or mutation operations cancellable by the app when contribution teardown, navigation, or page teardown begins; this does not add a public dynamic capability-revocation protocol;
- let semantic agent actions consume sanitized snapshots, evidence, and diffs without automating annotation UI or treating a visual diff as an executable patch;
- keep mask markers, utility tokens, evidence retention, snapshot schema, and source-edit projection out of Core's generic app contract.

## Requirements supplied to Q-013

The annotation reference app validates the platform only if it demonstrates, without app-specific core exceptions:

- user selection and app-owned overlay UI;
- optional screenshot and sanitized-DOM evidence with deterministic masking;
- a reversible visual preview and diff, including teardown and host-change conflict handling;
- correct use of opaque live targets and production of separate serializable snapshots;
- safe degraded behavior when the configured environment lacks an accepted service needed by a contribution or when a browser operation is unavailable;
- production operation within ADR-0003 and explicit activation under Q-012;
- feedback delivery through a generic destination without repository assumptions;
- semantic agent-facing actions over shared annotation operations without toolbar automation.

The second reference app should exercise overlay/lifecycle and capability discovery without reusing annotation-specific capture, masking, or utility contracts. Accessibility inspection is a useful contrast because it can consume DOM inspection and overlays while producing a different domain result.

The five ADR-0012 capabilities—toolbar hosting, overlay hosting, browser targeting, development source resolution, and editor opening—are a tracer set to validate through the reference apps. They are not a permission taxonomy, security sandbox, or requirement that every reference app consume all five. Annotation should validate overlay hosting and browser targeting directly; development-only source resolution and editor opening should be exercised only in an explicitly local workflow and must not leak into remote evidence. Toolbar hosting is optional because an app need not contribute toolbar UI.

## Cross-workstream consequences

- **Q-004 / Destinations & Delivery:** define authenticated upload/reference semantics, integrity verification, idempotent retries, limits, expiry, deletion behavior, and partial-evidence result codes without taking ownership of masking.
- **Q-005 / Extension:** origin-link authorization also gates evidence upload/retrieval; unlinking and revocation must terminate new grants and expose residual already-delivered evidence risk.
- **ADR-0012 / Core Primitives:** preserve opaque page-lifetime target references and lifecycle/host cleanup. Any serializable snapshot, evidence descriptor, masking result, or visual diff remains Workstream 50/app-domain data.
- **Q-012 / Extension:** production activation must independently control capture, DOM inspection, overlay, and presentation-mutation availability and communicate those permissions to users.
- **Q-013 / Control Room:** validate genericity with annotation plus a materially different app; do not promote annotation behavior into core to make the validation pass.
- **ADR-0005 / UI bindings:** overlays and portal UI require single-owner DOM boundaries and ordered cleanup before a host removes their mount points.

## Items requiring Control Room integration

Before closing Q-003, Q-006, or Q-007, freeze the numeric evidence limits and retention defaults, the explicit private-marker spelling, the exact utility allowlist and responsive buckets, and whether typed arbitrary values ship in v1. These choices affect destination contracts, extension permissions, and public app behavior and therefore require cross-workstream acceptance.
