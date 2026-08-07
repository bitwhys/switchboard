# Issue tracker

The tracker for this repo is **GitHub Issues on `bitwhys/switchboard`**. Skills that ask
for "the tracker doc" mean this file. Everything below is concrete enough to act on
without opening any issue first.

## Wayfinding operations

The active wayfinder map is [Wayfinder: Switchboard 0.1.0 implementation (#24)](https://github.com/bitwhys/switchboard/issues/24).

### Maps and tickets

- A map and its tickets are ordinary GitHub issues. The map carries the label
  `wayfinder:map`; every ticket carries exactly one of `wayfinder:research`,
  `wayfinder:prototype`, `wayfinder:grilling`, `wayfinder:task`. All five labels already
  exist in the repo.
- Parent/child is native GitHub **sub-issues**: tickets are sub-issues of the map. Read
  them via GraphQL:

  ```sh
  gh api graphql -f query='
    query {
      repository(owner: "bitwhys", name: "switchboard") {
        issue(number: 24) {
          subIssues(first: 100) {
            nodes { number title state assignees(first: 5) { nodes { login } } }
          }
        }
      }
    }'
  ```

### Blocking

Blocking is native GitHub **issue dependencies**, and those edges are the **canonical**
blocking record (the Project's Status field below is only a proxy).

```sh
gh api repos/bitwhys/switchboard/issues/<n>/dependencies/blocked_by
```

An empty array means the ticket is unblocked. Add an edge with:

```sh
gh api -X POST repos/bitwhys/switchboard/issues/<n>/dependencies/blocked_by -F issue_id=<blocker-issue-id>
```

(`issue_id` is the numeric database id from `gh api repos/bitwhys/switchboard/issues/<blocker-n> --jq .id`, not the issue number.)

### Claiming and resolving

- **Claim = assignee.** Assign yourself before any work; an open, unassigned ticket is
  unclaimed. `gh issue edit <n> --add-assignee bitwhys`
- **Resolution**, in order: post a `## Resolution` comment holding the answer, close the
  issue, then append a one-line context pointer to the map's `## Decisions so far`.
- **Frontier** = open + unblocked + unassigned children of the map. That's the pool a
  "take the next ticket" session picks from.

### The Project scheduling layer

[Switchboard development (Project 5)](https://github.com/users/bitwhys/projects/5) is a
**view over the map's tickets, never canonical**. Iteration = which cycle a ticket is
*intended* for; the blocked-by edges = what is *possible*. 2-week iterations from
Aug 5, 2026.

Because Projects can't filter on native blocked-by edges, **Status encodes frontier
state**: Ready = unblocked + unclaimed. The
[Frontier view](https://github.com/users/bitwhys/projects/5/views/7) filters
`is:open no:assignee status:Ready`.

Per-session conventions:

1. **On ticket creation**: add it to the Project —
   `gh project item-add 5 --owner bitwhys --url <issue-url>` (idempotent) — then set
   Status **Ready** if unblocked, **Backlog** if blocked. Set Iteration only when the
   human schedules it.
2. **On claiming**: set Status → **In progress** (alongside the assignee, which is the
   actual claim).
3. **On resolution**: after closing, promote any tickets the closure unblocks from
   **Backlog** → **Ready** so the Frontier view stays truthful.

Field ids for `gh project item-edit` (also recorded in
[issue #27](https://github.com/bitwhys/switchboard/issues/27)):

| Handle | Id |
| --- | --- |
| Project | `PVT_kwHOAZd5rM4BfhE-` |
| Status field | `PVTSSF_lAHOAZd5rM4BfhE-zhZzbtM` |
| Status: Backlog | `f75ad846` |
| Status: Ready | `e18bf179` |
| Status: In progress | `47fc9ee4` |
| Status: In review | `aba860b9` |
| Status: Done | `98236657` |
| Iteration field | `PVTIF_lAHOAZd5rM4BfhE-zhZzb2g` |

Example — set an item's Status:

```sh
ITEM_ID=$(gh project item-list 5 --owner bitwhys --format json --limit 100 \
  --jq '.items[] | select(.content.number == <n>) | .id')
gh project item-edit --id "$ITEM_ID" --project-id PVT_kwHOAZd5rM4BfhE- \
  --field-id PVTSSF_lAHOAZd5rM4BfhE-zhZzbtM --single-select-option-id <status-id>
```
