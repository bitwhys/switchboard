# Choosing the default bridge port

> Research for wayfinder ticket [bitwhys/switchboard#40], answering open question 1 of [adapter-next-hosting.md](./adapter-next-hosting.md) §7: *pick the default bridge port before the contract spec freezes.* Researched 2026-08-06 against primary sources.
>
> **Registry snapshot:** IANA *Service Name and Transport Protocol Port Number Registry*, page Last Updated **2026-08-05**; CSV pulled 2026-08-06 (15,398 data rows) and parsed **range-aware** — a naive single-port grep silently misreports any port covered by a range row, which changed the verdict on three candidates (§3).
>
> Claims tagged: **[spec]** = normative spec/RFC text, **[reg]** = the IANA registry itself, **[docs]** = official project docs, **[src]** = verified in project source, **[obs]** = measured on a dev machine during this research, **[sec]** = secondary/community source (unverified).

---

## TL;DR + recommendation

**Default `7654`. Fallbacks `7655` and `7656`. On `EADDRINUSE`, fail loud with an actionable message — never silently scan onto a different port.**

All three sit inside one explicitly-Unassigned IANA range row, `7649-7662` [reg]:

```
,7649-7662,,Unassigned,,,,,,,,
```

```
agent (Claude Code / Cursor / …)
   │  MCP Streamable HTTP  —  http://localhost:7654/mcp
   ▼
bridge (in the `next dev` child process, started from instrumentation.ts)
   │  Switchboard wire protocol over WebSocket
   │  ws://localhost:7654/ws
   ▼
page kernel (app served from http://localhost:3000)
```

Load-bearing reasons, each expanded below:

1. **The dynamic/private range is normatively disqualified, not merely risky.** RFC 6335 §8.1.2: a port in 49152-65535 "**MUST NOT** be used as a service identifier" [spec]. A documented, hard-coded-into-agent-configs bridge port is exactly a service identifier. That kills the whole 49152+ family in one line — and the OS facts back the rule up (§2.2).
2. **The real usable zone is `1024-32767`, narrower than the User range.** Linux's default ephemeral pool starts at **32768**, inside the IANA User range [docs] — so "User range" alone is not a safety guarantee (§2.2).
3. **`7649-7662` is explicitly Unassigned for both TCP and UDP**, giving a default and two fallbacks from one contiguous, uncontested block — no split TCP/UDP status, no "Known Unauthorized Uses" flag, no assigned neighbours inside the block (§3).
4. **The neighbourhood is quiet and, crucially, nothing scans into it.** The underappreciated hazard is not a colliding *default* but a colliding *search window*: tools that auto-increment sweep dozens of ports. Gradio alone sweeps **7860-7959** [src], which is why the otherwise-attractive `7923` was dropped (§4.3).
5. **Fail-loud is the only option that keeps a hard-coded agent config honest.** A scanning adapter that silently moves to 7655 leaves every MCP client still pointed at 7654 — the bridge is "up" and the agent is broken, with no error anywhere. Failing loudly costs one `next dev` restart and tells you exactly what to do (§6).

App-developer surface is unchanged from the adapter research — one line in `instrumentation.ts`, plus a documented `.mcp.json` snippet whose port and the adapter's port are driven by **one** environment variable (§6.3).

---

## 1. What the port has to satisfy

Constraints inherited from [bridge-protocol.md](../spec/bridge-protocol.md) §1/§15 and [adapter-next-hosting.md](./adapter-next-hosting.md) §6:

1. **One port carries both doors.** MCP Streamable HTTP on `/mcp` and the page WebSocket on `/ws` share a single listener started from `instrumentation.ts` — so a collision breaks the agent leg *and* the page leg together.
2. **Loopback only, both literals.** The bridge binds `127.0.0.1` *and* `::1` (spec §15.1). A conflict on either literal is a conflict — a survey that only checks IPv4 is incomplete.
3. **It goes into agent config by hand.** The port appears as a literal in `.mcp.json` / `mcp.json` and in the page client's URL. Stability across restarts matters more than availability on any single boot — this is the constraint that decides §6.
4. **It must not be a *dev* port.** The population at risk is developer machines, where the dense, contested part of the port space is precisely where framework tooling lives. Registry cleanliness is necessary but nowhere near sufficient.
5. **It should survive a second Switchboard project.** Two projects running at once must be told to differ; the failure has to say so (§6.4).

## 2. Which IANA range is even eligible

### 2.1 The three ranges

RFC 6335 §6, verbatim [spec]:

> o the System Ports, also known as the Well Known Ports, from 0-1023 (assigned by IANA)
> o the User Ports, also known as the Registered Ports, from 1024-49151 (assigned by IANA)
> o the Dynamic Ports, also known as the Private or Ephemeral Ports, from 49152-65535 (never assigned)

Assignable ports are in one of three states — **Assigned**, **Unassigned**, or **Reserved** ("assigned to IANA" for special purposes, typically at range edges) [spec]. Note the registry's own caveat: "IANA typically only records the Assigned and Reserved service names and port numbers in the registry. Unassigned values are typically not explicitly listed" [spec]. In practice the CSV *does* carry explicit `Unassigned` range rows across the User range, so unassigned status can be asserted positively rather than inferred from absence — which is what §3 does.

System ports (0-1023) are out: they need elevation on Unix-likes and are irrelevant to a dev tool.

### 2.2 The dynamic range is disqualified by rule *and* by measurement

The ticket asks whether 49152-65535 is a real option. It is not. RFC 6335 §8.1.2, verbatim [spec]:

> Ports in the Dynamic Ports range (49152-65535) have been specifically set aside for local and dynamic use and cannot be assigned through IANA. Application software may simply use any dynamic port that is available on the local host, without any sort of assignment. On the other hand, application software MUST NOT assume that a specific port number in the Dynamic Ports range will always be available for communication at all times, and a port number in that range hence MUST NOT be used as a service identifier.

Both halves matter. The permission ("may simply use any dynamic port that is available") is exactly what `listen(0)` does — and is fine for an *ephemeral* port. The prohibition is on a *fixed, published* one, which is what a bridge port is. Confirmed empirically: the registry contains **zero** entries at or above 49152; the highest port number appearing anywhere in the CSV is 49151 [reg].

The OS facts make this a live hazard rather than a formality:

| OS | Default ephemeral range | Source |
|---|---|---|
| Linux | **32768-60999** | kernel.org `ip-sysctl`: "ip_local_port_range … The default values are 32768 and 60999 respectively" [docs] |
| Windows (Vista/2008+) | **49152-65535** | Microsoft Learn KB929851: "The new default start port is 49152, and the new default end port is 65535" [docs] |
| Windows 11 (measured) | Start 49152, 16384 ports, TCP+UDP, IPv4+IPv6 | `netsh int ipv4 show dynamicport tcp` [obs] |
| macOS (xnu) | **49152-65535** | `bsd/netinet/in.h`: `IPPORT_HIFIRSTAUTO 49152` / `IPPORT_HILASTAUTO 65535`; surfaced as `net.inet.ip.portrange.first`/`.last` [src] |

Three consequences:

- **A fixed listener in 49152-65535 competes with every outbound socket on Windows and macOS.** Sampled once on a Windows 11 dev machine: 465 TCP connections, 238 distinct local ports occupied within 49152-65535 — about **1.45%** of the 16,384-port pool at that instant [obs]. One snapshot on one machine, not a population statistic; a box with a busy browser, Docker, or a sync client runs materially higher, and `TIME_WAIT` holds ports for tens of seconds after close. The failure shape is the worst kind for a dev tool: it only bites at bind time, intermittently, on some machines, for some users — and once bound, everything works, so it never reproduces.
- **"High ports are safe" is a Linux-only intuition.** 61000-65535 is outside Linux's default pool but fully inside Windows' and macOS'. **There is no sub-range of 49152-65535 that is safe on all three platforms.**
- **Linux's pool starts at 32768, inside the User range.** So the genuinely safe zone is **1024-32767**, not 1024-49151. RFC 6056 §3.2 pushes allocators wider still — "ephemeral port selection algorithms should use the whole range 1024-65535" [spec] — with the mitigation that "port numbers that may be needed for providing a particular service at the local host SHOULD NOT be included in the pool" [spec]. That exclusion is keyed to known services; it is not a protection an unregistered dev-tool port can rely on.

**Windows adds a second, quieter hazard:** administered *port exclusion ranges*. Measured on this machine, `netsh int ipv4 show excludedportrange protocol=tcp` reports exclusions at 80, 5357, 5985, **8182**, **9191**, 47001 [obs] — binds into an excluded range fail regardless of whether anything is listening. With Hyper-V / WSL2 / Docker Desktop installed, WinNAT reserves *blocks* that vary per boot. I could not find an authoritative Microsoft Learn page documenting those block sizes or placement, and this machine showed no Hyper-V block — so treat the block behaviour as real-but-not-primary-sourced [sec]. The singleton exclusions at 8182 and 9191 are themselves a good argument against picking anything in the 8xxx range that "looks free."

### 2.3 What IANA registration actually buys a loopback dev tool

Essentially nothing — but "unassigned User port" and "dynamic-range port" are still not equivalent, and RFC 6335 treats them very differently.

- **Explicit free-use permission exists only for the dynamic range** ("without any sort of assignment", §8.1.2) [spec]. There is no parallel sentence blessing free use of unassigned User ports; §8.1.2 says User ports "are available for assignment through IANA, and MAY be used as service identifiers **upon successful assignment**" [spec]. This is permissive-by-omission, not prohibitive: **there is no MUST NOT against using an unassigned User port**, and the word "squatting" does not appear in RFC 6335 at all.
- **The entire enforcement mechanism is a note in a CSV.** §8.1.1 defines an optional registry field, "**Known Unauthorized Uses**: A list of uses by applications or organizations who are not the Assignee… may be augmented by IANA after assignment when unauthorized uses are reported" [spec]. It is visibly in use: 3000, 5555 and 7011 all carry such flags, and 3000's `remoteware-cl` entry literally reads *"This entry records an unassigned but widespread use"* [reg].
- **Registration is discouraged and expensive.** A User-port request "MUST explain why using a port number in the Dynamic Ports range is unsuitable for the given application" and goes through Expert Review; §7.2's stated principle is "to conserve use of the port space where possible", recommending that "applications that do not require an assigned port should register only a service name without an associated port number" [spec]. A loopback-only dev tool cannot honestly clear that bar.

**So the registry is a conflict-avoidance dataset, not a permission system.** The observed pattern across the dev ecosystem confirms it — nearly every famous dev port is either unassigned-and-squatted (5173 Vite, 9229 Node inspector, 8969 Spotlight, 6274 MCP Inspector) or assigned-to-something-else-and-squatted-anyway (9222 → `teamcoherence`, 4321 → `rwhois`, 5555 → `personal-agent`, 4200 → inside `vrml-multi-use`, 6006 → inside `x11 6000-6063`) [reg].

**Switchboard should therefore not seek registration**, and should pick an Unassigned User-range port purely because unassigned space is *less likely to have a real listener on a developer's machine*. The priority order that follows:

1. Not in 49152-65535 (violates a MUST NOT; measurable collision risk).
2. Not in 32768-49151 either (Linux ephemeral pool).
3. Not colliding with a popular dev tool's default **or its search window** (§4) — this is the risk that actually generates bug reports.
4. Not colliding with an IANA assignment, weighted by whether that service could plausibly run on a developer's machine.

## 3. Candidates and registry status

Every row verified against the range-aware parse of the 2026-08-05 registry [reg]. "Unassigned" means an explicit `Unassigned` registry row covers the port for **both** transports.

| Port | IANA status | Verdict |
|---|---|---|
| **7654** | **Unassigned** — row `7649-7662` | **Recommended default** (§7) |
| **7655** | **Unassigned** — row `7649-7662` | **Fallback 1** |
| **7656** | **Unassigned** — row `7649-7662` | **Fallback 2** |
| 6772 | Unassigned — row `6772-6776` | Viable runner-up; block is only 5 ports wide, and it sits at the block's edge (6771 is assigned), so a default + 2 fallbacks consumes over half of it |
| 13579 | Unassigned — row `13401-13719` | Viable; memorable (odd digits). Higher in the space with no compensating benefit |
| 5177 | Unassigned — row `5173-5189` | **Rejected** — same block as Vite's 5173, straight into Vite's increment path (§4.3) |
| 7923 / 7924 / 7925 | Unassigned — row `7914-7931` | **Rejected** — inside Gradio's 7860-7959 search window (§4.3). Was the leading candidate on registry grounds alone |
| 7331 | **Assigned** — inside `swx 7300-7359`, "The Swiss Exchange" | Rejected. A single-port grep shows nothing here; the range row is what matters |
| 4114 | Assigned TCP+UDP — `jomamqmonitor` | Rejected |
| 4115 | Assigned TCP+UDP — `cds`, "CDS Transfer Agent" | Rejected |
| 4173 | TCP **Reserved**; UDP `mma-discovery` | Rejected — and it is Vite's `preview` port [docs] |
| 4711 | Assigned TCP+UDP+SCTP — `trinity-dist` | Rejected |
| 4747 | TCP **Reserved**; UDP `buschtrommel` | Rejected |
| 5757 | Assigned TCP+UDP — `x500ms` | Rejected |
| 7011 | Assigned TCP+UDP — `talon-disc`; carries a **Known Unauthorized Use** flag | Rejected |
| 8181 | TCP `intermapper`; UDP Reserved | Rejected — plus 8182 is an excluded port on the measured Windows box [obs] |
| 8384 | UDP `marathontp`; TCP Reserved | Rejected — also Syncthing's GUI port [sec] |
| 8765 | Assigned TCP+UDP — `ultraseek-http` | Rejected |
| 9339 | TCP `gnmi-gnoi` (Google Netops); UDP Reserved | Rejected — gNMI plausibly runs on a network-automation dev machine |
| 9999 | Assigned TCP+UDP — `distinct` | Rejected — and heavily squatted generally |
| 47100 | UDP `jvl-mactalk`; TCP Reserved | Rejected — also inside Linux's ephemeral pool |
| 49200 / 51515 / 55555 / 57000 / 60123 | Not in registry — **Dynamic/Private** | **Rejected by rule** — RFC 6335 §8.1.2 MUST NOT (§2.2) |

For reference, the status of the ports the adapter research told us to avoid [reg]: **3000** is doubly assigned (`hbci` *and* `remoteware-cl`); **3001** TCP `origo-native`, UDP Reserved; **5173** genuinely Unassigned (Vite squats free space); **6006** is inside `x11 6000-6063` — Storybook's default collides with X display `:6`; **8969** Unassigned (row `8955-8979`); **5555** assigned with a Known Unauthorized Use flag.

## 4. Known conflicts with development tooling

### 4.1 The survey

Defaults verified from official docs or project source unless marked. The point of the table is not completeness — it is to show that the contested space is dense, clustered, and almost entirely below 10000.

**Framework, bundler and backend dev servers** [docs][src]

| Port | Claimed by |
|---|---|
| 1234 | Parcel; LM Studio |
| 1313 | Hugo |
| 3000 | Next.js, Nuxt, CRA, Rails, Docusaurus, Rsbuild, `remix-serve`, Vercel dev, serverless-offline, SAM local, **Grafana** |
| 3001 | second-instance overflow for most of the above; serverless-offline |
| 4000 | Phoenix; Jekyll; Firebase emulator UI; `next experimental-analyze` |
| 4173 | **Vite `preview`** (`DEFAULT_PREVIEW_PORT = 4173`) [src]; SvelteKit preview |
| 4200 | Angular CLI; Ember CLI |
| 4321 | Astro (dev *and* preview) |
| 4873 | Verdaccio |
| 4983 | Drizzle Studio (`127.0.0.1:4983`) |
| 5000 | Flask; ASP.NET Core; Firebase Hosting; Docker Registry — **and macOS AirPlay Receiver** |
| 5173 | **Vite dev**; SvelteKit; Remix v2 / React Router v7 dev |
| 5555 | Prisma Studio; `adb` |
| 6006 | Storybook — a convention injected by `storybook init` rather than a hardcoded CLI default [src] |
| 8000 | Django, Laravel, uvicorn/FastAPI, Gatsby `develop`, DynamoDB Local, SurrealDB |
| 8080 | webpack-dev-server, Rspack CLI, Vue CLI, Spring Boot, Keycloak, code-server, Firestore emulator, Traefik dashboard |
| 8081 | Metro / React Native / Expo; Nexus; Datastore emulator |
| 8787 | Cloudflare Wrangler |
| 8888 | Jupyter (retries 8888-8938); Netlify dev |
| 8969 | Sentry Spotlight sidecar |
| 24678 | Vite's standalone HMR WebSocket (middleware mode only) [src] |

**Debuggers and inspectors.** Node `--inspect` binds **9229** on `127.0.0.1` [docs], and cluster workers increment from there [docs]. Chrome/Edge **9222** is *convention only* — `--remote-debugging-port` has no default [docs]. Metro/React Native 8081 [docs]. Java JDWP has **no spec default** (Oracle examples use 8000; 5005 is IntelliJ's convention) [docs]; debugpy's 5678 is a VS Code launch-config default, not a library default [docs].

**Databases and admin GUIs.** 5432 Postgres · 3306/33060 MySQL · 6379 Redis · 27017 Mongo · 9200-9300/9300-9400 Elasticsearch (**ranges**) · 5984 CouchDB · 7474/7473/**7687** Neo4j · 8123/9000/9009 ClickHouse · 5050 pgAdmin [src] · 9000 MinIO API · 1433 SQL Server · 9042 Cassandra · **8086 InfluxDB v1/v2, 8181 InfluxDB 3 Core** · 7700 Meilisearch · 8108 Typesense · 6333/6334 Qdrant · 19530 Milvus · 4213 DuckDB UI · **Supabase local stack 54320-54327** (API 54321, DB 54322, Studio 54323) [src].

**Container and orchestration.** Docker 2375/2376 (both opt-in; the default is a unix socket) · K8s API 6443 · kubectl proxy 8001 · kubelet 10250 · etcd 2379/2380 · **NodePort 30000-32767** · Consul 8300-8302/8500/8600 · Vault 8200/8201 · Nomad 4646-4648 · Portainer 9443/8000 · Docker Registry 5000 · Tilt 10350 · **Apache Ignite 47100** · Podman and containerd bind no TCP by default.

**Local cloud emulators.** LocalStack **4566** (the old 4571-4599 per-service range was removed in 3.0.0; the live spawned-service range is 4510-4559) · Azurite 10000-10002 · **Firebase emulator suite** 4000/4400/4500/5000/5001/5002/8080/8085/9000/9099/9199/9299/9399/9499 [docs][src] · GCP Pub/Sub 8085, Datastore 8081, Bigtable 8086, Spanner 9010/9020 · MailHog and Mailpit both 1025/8025 · MailDev 1025/1080 · RabbitMQ 5672/15672 · Kafka 9092/9093 · NATS 4222/6222 · ngrok 4040 · Convex 3210/3211/6791 · PocketBase 8090 · Stripe CLI binds nothing (outbound only).

**Two whole-range claims worth knowing**, because they invalidate single-port reasoning:

- The **Prometheus default-port registry** allocates **9100-9999 wholesale** to exporters [docs] — which is the real reason to drop 9339 and 9999, independent of their IANA status.
- **Apple's own port list** claims `5000 TCP AirPlay`, `6000 TCP AirPlay`, `7000 TCP AirPlay`, `8000-8999 Web service, iTunes Radio streams`, and `49152-65535 AirPlay, device pairing, network diagnostics, Xsan` [docs]. The 8000-8999 claim is a further mark against every 8xxx candidate; the 49152-65535 claim independently corroborates §2.2 on macOS.

### 4.2 A constraint the page leg adds: browser-blocked ports

Easy to miss, and fatal if missed: **the page dials the bridge**, so the bridge port must be one a browser will actually connect to. The Fetch standard defines a list of "bad ports" that user agents block for all schemes, WebSocket included [spec]. Chromium implements it as `kRestrictedPorts` in `net/base/port_util.cc` — 100 entries including 0, 1, 7, 9, 11, 13, 15, 17, 19-23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101-104, 109-111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512-515, 526, 530-532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, **6000**, 6566, 6665-6669, 6697, and **10080** [src].

Two traps for dev tooling sit in that list: **6000** (X11 — note Storybook's 6006 escapes by six) and **10080**, which looks like an innocuous "HTTP-ish" port and is permanently unreachable from a page. **7654, 7655 and 7656 are not in the list** [src], nor is any other candidate considered here.

### 4.3 The hazard nobody budgets for: search windows, not defaults

### 4.2 The hazard nobody budgets for: search windows, not defaults

Comparing a candidate against a list of *default* ports is not enough, because several widely-installed tools **sweep upward** when their default is busy. A port that is clean against every default can still be claimed by the third instance of some other tool.

- **Gradio** — default 7860, and on collision it sweeps a fixed window. From source: `INITIAL_PORT_VALUE = int(os.getenv("GRADIO_SERVER_PORT", "7860"))`, `TRY_NUM_PORTS = int(os.getenv("GRADIO_NUM_PORTS", "100"))`, and the candidate list is `range(INITIAL_PORT_VALUE, INITIAL_PORT_VALUE + TRY_NUM_PORTS)` — i.e. **7860-7959** [src]. The docs state the behaviour without the bound: "If None, will search for an available port starting at 7860" [docs]. **This is what disqualified 7923**, which was otherwise the strongest candidate: IANA-unassigned in an 18-port block, with a tidy mnemonic. Gradio is common on exactly the ML/agent-adjacent machines Switchboard targets, so this is not a hypothetical.
- **Vite** — default 5173, and "if the port is already being used, Vite will automatically try the next available port so this may not be the actual port the server ends up listening on" [docs]. The sweep is unbounded, so a developer with several Vite projects open walks 5174, 5175, 5176… **This is what disqualified 5177**, which shares the `5173-5189` Unassigned block with Vite's own default.
- **Next.js** — documented default 3000 (`-p/--port`, env `PORT`) [docs]. The auto-increment to 3001 that [adapter-next-hosting.md](./adapter-next-hosting.md) §5 relies on is **not documented in the CLI reference**, but it *is* verifiable in source, and this note upgrades that claim from [sec] to [src] — with an important qualification the original did not capture. `start-server.ts` retries only under a gate [src]:

  ```ts
  if (allowRetry && port && isDev && err.code === 'EADDRINUSE' && portRetryCount < 10) {
    port += 1; portRetryCount += 1; server.listen(port, hostname)
  } else { Log.error(`Failed to start server`); console.error(err); process.exit(1) }
  ```

  and `next-dev.ts` computes that gate as [src]:

  ```ts
  // If neither --port nor PORT were specified, it's okay to retry new ports.
  const allowRetry = portSource === 'default'
  ```

  So Next.js's own rule is: **a port the user configured is never silently moved; only an unconfigured default drifts** — and even then it is bounded to 10 attempts, dev-only, and announced ("Port X is in use by process Y, using available port Z instead"). This is the single most relevant precedent for §6, and it points the same way.

The lesson generalises into a selection rule worth writing down: **prefer a candidate that is not within ~100 ports above any popular tool's default.** 7654 clears this — the nearest lower defaults of any popularity are far below, and neither of the two real-world listeners in the neighbourhood sweeps.

### 4.4 The 7654 neighbourhood, audited

Registry rows spanning 7600-7700 [reg] are uniformly obscure enterprise/industrial services. The two entries that plausibly run on a real developer machine are both **outside** the chosen block and neither scans:

- **7680** — `ms-do`, "Microsoft Delivery Optimization Peer-to-Peer" [reg]. Present on Windows machines by default. 26 ports above the block; fixed, does not sweep.
- **7687** — `bolt`, "Bolt database connection" [reg] — Neo4j's Bolt port. Fixed, does not sweep.

Inside `7649-7662` itself: nothing assigned, nothing reserved, no Known Unauthorized Use flags [reg]. A web search for "port 7654" as a development default surfaced no tool claiming it [sec].

## 5. Conventions among comparable tools

**The headline finding is negative: there is no numbering convention to align with.** The ports comparable tools use are mutually unrelated, undocumented in their rationale, and in several cases not fixed at all. What *does* exist is a split in **strategy**, and that split is the useful thing to learn from.

**Strategy A — publish a fixed port, document it, let the user override.** Sentry Spotlight's sidecar defaults to **8969**, overridable via `spotlight -p <port>` or by pointing the SDK at a custom URL. Its docs state neither a rationale for the number nor what happens when it is busy [docs]. This is the strategy Switchboard is choosing, and Spotlight is the closest architectural analogue overall — page dials a loopback sidecar, origin-allowlisted (per [adapter-next-hosting.md](./adapter-next-hosting.md) §2.4).

**Strategy B — never publish a port; make the client find it.** Two variants, both first-party:

- **Vercel Toolbar's Next plugin** spawns its sidecar on a *free* port and injects a rewrite so the browser only ever sees a same-origin path — the port is an implementation detail nobody types [src, per [adapter-next-hosting.md](./adapter-next-hosting.md) §2.4].
- **`next-devtools-mcp`** puts a stdio shim in `.mcp.json` and discovers dev servers at runtime (§6.2) [docs].

The lesson is not "pick a number like theirs" but **the number only matters if you chose Strategy A** — and Strategy A is worth choosing only when the ergonomic cost of the alternative (a second published artifact, a discovery mechanism with its own failure modes) exceeds the cost of a documented collision. For v1 it does (§6.2).

**MCP-specific observations:**

- **A local MCP server's port is not conventionally its own.** Next.js mounts at `/_next/mcp` on the app's port [docs]; Vercel's `mcp-handler` mounts on a route handler [docs, per [adapter-next-hosting.md](./adapter-next-hosting.md) §1.4]. Switchboard's separate port is a deliberate departure, already argued in the adapter research (§2.3 there) on the grounds that the app port drifts — and §4.3 here strengthens that argument with the verbatim source showing exactly when Next lets it drift.
- **MCP Inspector** binds **6274** for its client UI [docs]. The widely-repeated keypad-mnemonic reading ("MCPI" → 6274, and 6277 → "MCPP") is *not* stated in the project's README, and I could not find it documented anywhere first-party [sec].

**On mnemonics.** They are a nice-to-have and were not permitted to override safety. Switchboard's own best candidate — **7923 = "SWBD"** on an E.161 telephone keypad, a pleasing fit for a project named after a telephone operator's board ([ITU-T E.161](https://www.itu.int/rec/T-REC-E.161/en), "Arrangement of digits, letters and symbols on telephones and other devices…"; the letter table itself is behind a paywalled PDF and was **not** read verbatim, so the S=7/W=9/B=2/D=3 mapping is asserted from common keypad layout only [sec]) — was dropped once Gradio's 7860-7959 sweep was found (§4.3). **`7654` earns memorability more cheaply and more robustly: four descending digits, nothing to look up.**

## 6. `EADDRINUSE`: fail loud, or scan for a free port?

### 6.1 What each choice costs

The two doors share one listener, and the port is a literal in the agent's MCP client config. That asymmetry decides the question.

| | **Scan for a free port** | **Fail loud** |
|---|---|---|
| `next dev` | Always starts | **Blocked** until the developer acts |
| Agent whose `.mcp.json` says `localhost:7654` | **Silently broken.** The bridge is listening on 7655; the agent connects to whatever is on 7654 (or nothing). No error is raised anywhere the developer looks | Unaffected — there is no running bridge to be wrong about |
| Page client (bundled URL) | Same silent break, unless the chosen port is threaded back into the client bundle | Unaffected |
| Diagnosability | Terrible. Symptom is "my agent can't see any tools", cause is three layers away | Excellent. One message at startup, at the moment of failure |
| Two Switchboard projects at once | "Works", with the second project's agents pointing at the first project's page | Refuses, and can say precisely that |

Scanning optimises for the process that *hosts* the bridge. Fail-loud optimises for the clients that *consume* it. Since the bridge exists solely to serve those clients, and since a silently-moved bridge is indistinguishable from a broken one from the agent's side, **fail loud wins**.

The precedent supports making this the *default* rather than merely an option:

- **Vite** ships both behaviours and makes fail-loud opt-in via `strictPort` ("Set to `true` to exit if port is already in use, instead of automatically trying the next available port") [docs] — but Vite's port is discovered by a human reading terminal output, not hard-coded into a machine's config file. Switchboard is the opposite case, so Switchboard's default should be Vite's `strictPort: true`, not Vite's default.
- **Next.js draws the line in exactly the place this argument predicts** (§4.3): `allowRetry = portSource === 'default'` [src]. A port the user configured is never silently moved. The reasoning transfers, and then goes one step further: Switchboard's port is *always* effectively configured, because even the built-in default is duplicated into `.mcp.json` on the client side. There is no "unconfigured" case for the bridge port the way there is for `next dev`. **So Switchboard should not drift even from its default** — the case where Next.js permits drift does not exist here.

That last point is the crux, and it is why "just do what Next does" resolves to "never scan" rather than "scan when unconfigured."

### 6.2 The discovery escape hatch — real, first-party, and out of scope for v1

The obvious middle path is "scan, then publish the chosen port where clients can find it." As stated, it fails: **MCP clients do not read discovery files.** `.mcp.json` holds a URL string, and nothing in either MCP transport era gives an HTTP client a way to rendezvous with a moving local server. Publishing a port that no consumer reads is a no-op.

But there is a version that *does* work, and Vercel shipped it for this exact problem — worth stating plainly because it is the strongest argument against the recommendation in this note.

Next.js 16 runs its own MCP endpoint at **`/_next/mcp` inside the dev server**, on the app's own port — the port that drifts [docs]. Rather than fight that, the documented client config contains **no port and no URL at all** [docs]:

```jsonc
{ "mcpServers": { "next-devtools": { "command": "npx", "args": ["-y", "next-devtools-mcp@latest"] } } }
```

That is a **stdio** server. The shim then discovers running dev servers and forwards JSON-RPC to each one's `/_next/mcp` over HTTP, exposing a `discover_servers` action that reports port, PID and URL per instance; the docs advertise it can "connect to multiple Next.js instances running on different ports" [docs][sec].

This dissolves the dilemma rather than resolving it: the client config has nothing to invalidate, so the server is free to scan. The consumer *is* a program that knows to look — which is precisely the condition the naive discovery-file idea fails and this one satisfies. (The same condition explains the other precedent in this space: Chrome writes its chosen port to a `DevToolsActivePort` file in the user-data-dir under `--remote-debugging-port=0`, and `chrome-devtools-mcp` reads it — a program, again, not a config file [sec, per [mcp-live-page-transport.md](./mcp-live-page-transport.md) §5.1].)

**Why it is still not the v1 answer:**

- It requires shipping and maintaining a **second published artifact** — a stdio↔HTTP proxy on npm, versioned independently, that every user runs via `npx`. That is a large increase in surface area for a project whose stated integration bar is one line in `instrumentation.ts`.
- Discovery is not free of failure modes; it trades a legible bind error for an illegible "found nothing" (Vercel's own tracker carries Windows/Cursor discovery failures) [sec].
- It only helps the **agent** leg. The **page** leg still needs a URL in the browser bundle, and the page cannot run a discovery shim. A scanning bridge would still have to thread its chosen port into the client bundle at runtime — the harder half of the problem, untouched.

**Ruling:** record it as the principled long-term direction, not the v1 mechanism. It is also the natural home for stdio-only client support, which [mcp-live-page-transport.md](./mcp-live-page-transport.md) §1 already earmarked for an `mcp-remote`-style proxy — so if Switchboard ever ships that proxy, it should absorb discovery at the same time (§9).

### 6.3 The override contract: one variable drives both sides

Claude Code supports environment-variable expansion in `.mcp.json` [docs]:

> **Supported syntax:** `${VAR}` expands to the value of environment variable `VAR`; `${VAR:-default}` expands to `VAR` if set, otherwise uses `default`.
> **Expansion locations:** … `url`: for HTTP server types …

So the adapter and the agent config can be driven by the *same* variable, and the default lives in both places without either silently drifting:

```jsonc
// .mcp.json — shipped in the adapter docs
{
  "mcpServers": {
    "switchboard": {
      "type": "http",
      "url": "http://localhost:${SWITCHBOARD_PORT:-7654}/mcp"
    }
  }
}
```

`register()` reads `process.env.SWITCHBOARD_PORT ?? 7654`. A developer who needs a different port sets **one** variable and both ends follow. Note the failure mode of the expansion when a variable is referenced with no default: "the config still loads: Claude Code reports a missing-variable warning for that server in `claude mcp list` output and uses the unexpanded `${VAR}` text as-is" [docs] — hence always ship the `:-7654` default in the snippet.

One convenient asymmetry with Next.js: `PORT` "cannot be set in `.env` as booting up the HTTP server happens before any other code is initialized" [docs], but `SWITCHBOARD_PORT` is read inside `register()`, which runs after Next has loaded env files — so `SWITCHBOARD_PORT` **can** live in `.env` where `PORT` cannot. Worth confirming during implementation (§9).

### 6.4 The ruling, precisely

**Fail loud — but distinguish the one case where a retry is legitimate.**

[adapter-next-hosting.md](./adapter-next-hosting.md) §6.2 already identified it: Next 16.3 re-forks the dev child on config edits and on memory-pressure restarts, and the new child can race the old child's socket release. That is a *transient* `EADDRINUSE` against **ourselves**, and it resolves in milliseconds. Node's own documentation models exactly this retry [docs].

So:

1. **Bounded retry** — a few attempts over a short window (order of 1s total), for the re-fork race only. Not a scan: every attempt is for the *same* port.
2. **Then fail loud**, refusing to start, with a message that names all three remedies:
   - another Switchboard project is already using this port → set `SWITCHBOARD_PORT` for one of them;
   - some other process holds it → name the port and how to find the holder;
   - and the two documented fallbacks, `7655` and `7656`.
3. **Never** silently bind a different port.
4. The failure must not take down `next dev` itself where that can be avoided — the bridge is a devtool, and an app developer who does not care about Switchboard right now should still be able to work. Refusing to *start the bridge* with a loud error, rather than throwing out of `register()` and killing the dev server, is the right severity. This is a genuine judgement call and is flagged as such in §9.

Point 4 is the honest resolution of the ticket's framing ("a failing adapter blocks `next dev`"): fail loud about the *bridge*, not about the *app*.

## 7. Recommendation

| Role | Port | Why |
|---|---|---|
| **Default** | **`7654`** | Unassigned for both transports in the explicit `7649-7662` registry row [reg]; comfortably inside the safe `1024-32767` zone (§2.2); no popular tool's default and — decisively — outside every search window found (§4.3); not on any browser blocked-port list (§4.2); quiet neighbourhood whose only real-world listeners are fixed and outside the block (§4.4); trivially memorable and typable as four descending digits |
| **Fallback 1** | **`7655`** | Same Unassigned block; adjacent, so "the next one up" is a rule a human can hold in their head |
| **Fallback 2** | **`7656`** | Same Unassigned block |

Keeping all three inside one block means the fallbacks inherit every property that justified the default — there is no second analysis to do, and no chance a fallback lands somewhere worse than the default.

The fallbacks are **documentation, not automation**: they are what the error message tells you to try and what a second concurrent project should be set to. Nothing in the adapter ever selects them on its own (§6.4).

Two things deliberately *not* recommended:

- **No IANA registration request.** RFC 6335 §7.2's conservation principle and §8.1.2's "MUST explain why using a port number in the Dynamic Ports range is unsuitable" bar cannot be honestly cleared by a loopback-only dev tool [spec]. Switchboard squats, in good company and on genuinely unassigned space.
- **No dynamic-range port, ever, for the fixed default** — see §2.2. `listen(0)` remains perfectly legal for anything genuinely ephemeral (a test harness, a spike), and that is the one place the dynamic range belongs.

## 8. Notes toward the adapter contract spec

Amending [adapter-next-hosting.md](./adapter-next-hosting.md) §6.7 ("Port policy") with what this research settles:

1. **`DEFAULT_BRIDGE_PORT = 7654`**, exported as a named constant from the shared bridge package so the adapter, the page client's default URL, and the docs all read the same source. Documented fallbacks 7655 / 7656.
2. **`SWITCHBOARD_PORT` is the single override**, read by `register()` on the server side and mirrored to the page bundle (`NEXT_PUBLIC_SWITCHBOARD_PORT`) for the client. The adapter docs ship the `.mcp.json` snippet from §6.3 with `${SWITCHBOARD_PORT:-7654}` so that one variable moves both ends.
3. **`EADDRINUSE` policy is normative-ish adapter behaviour**, not an implementation detail: bounded same-port retry for the re-fork race, then refuse to start the bridge with an actionable error naming the port, the likely causes, and the fallbacks. No scanning. This deserves a line in the adapter contract because a future adapter that scans would silently break every agent config in the ecosystem.
4. **Both loopback literals** (spec §15.1) — a port is only "free" if it is free on `127.0.0.1` *and* `::1`. The availability check and the error message must both be literal-aware, or a half-bound port will read as success.
5. **Selection rule for any future adapter that needs its own port:** unassigned in the current IANA registry (range-aware check), inside 1024-32767, and at least ~100 ports clear above any popular tool's default (§4.3), and absent from the Fetch/Chromium blocked-port list (§4.2).

## 9. Open questions

1. **Should a failed bridge bind abort `next dev`, or only the bridge?** §6.4 recommends the latter — loud error, dev server survives — on the grounds that a devtool must not hold the app hostage. But it means a developer can miss the message in a noisy startup log and later wonder why no tools appear, which is precisely the silent-failure mode fail-loud exists to prevent. Needs a call from the contract grilling; the mitigation (make `switchboard.status` say "bridge failed to bind" rather than merely being absent) may make the choice moot.
2. **Can `SWITCHBOARD_PORT` actually live in `.env`?** Reasoned in §6.3 from Next's documented explanation of why `PORT` cannot [docs], but not exercised. Confirm during adapter implementation — the docs' recommended snippet depends on the answer.
3. **Does the port need to be per-project rather than per-machine?** Next 16's dev lockfile makes one `next dev` per project safe, but says nothing about two projects. The current answer is "set `SWITCHBOARD_PORT` on the second one, and the error tells you to" — acceptable for v1, but a project-scoped derivation (hash the project path into the `7649-7662` block) is a cheap future option worth recording before it is needed.
4. **Should Switchboard ship a stdio discovery shim (§6.2), and when?** It is the only mechanism that makes a scanning bridge safe, it is first-party-validated by `next-devtools-mcp`, and it is the same artifact already earmarked for stdio-only client support. The blocker is that it does nothing for the page leg. Worth its own ticket once the adapter exists — and if it ever ships, the fail-loud ruling here should be revisited, not inherited.
5. **Tunneled/remote dev** (open question 3 of the adapter research) is untouched by this decision: forwarding 7654 is the same problem as forwarding any fixed port, and the rewrite façade remains the escape hatch.
6. **Re-audit the registry before the contract freezes.** The `7649-7662` block is unassigned as of the 2026-08-05 registry snapshot; IANA assignments are additive and this took ~one line to check [reg].
