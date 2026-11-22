# Hotel Offer Orchestrator — Implementation Spec

**Stack:** Node.js 20 (TypeScript, strict mode), Express 4, `@temporalio/{client,worker,workflow,activity}`, `ioredis`, Docker Compose.
**Rule:** Follow this spec verbatim. Every design choice is locked in—do not add alternative modes, RediSearch, or extra abstractions.

---

## 1. Folder Structure

Single TypeScript package compiled to `dist/` and shared by both the `app` and `worker` containers.
*Justification:* One repo and one compiled image eliminates shared-type drift between Express and Temporal while keeping `docker-compose` builds fast.

```text
hotel-offer-orchestrator/
├── src/
│   ├── config/
│   │   └── env.ts                      # Typed env loader + defaults (fails fast on missing required vars)
│   ├── mock/
│   │   ├── data.ts                     # Static supplier A & B datasets (delhi, mumbai)
│   │   └── supplierRoutes.ts           # Express router: GET /supplierA/hotels, GET /supplierB/hotels
│   ├── redis/
│   │   ├── client.ts                   # Singleton ioredis client
│   │   └── hotelStore.ts               # saveCityOffers() + queryCityOffers() (ZSET + HASH)
│   ├── temporal/
│   │   ├── types.ts                    # Shared RawSupplierHotel, HotelOffer, SupplierId types
│   │   ├── activities/
│   │   │   └── hotelActivities.ts      # fetchSupplier, saveToRedis
│   │   ├── workflows/
│   │   │   ├── dedupe.ts               # Pure deterministic dedupeAndSelectBestOffers()
│   │   │   └── hotelOfferWorkflow.ts   # hotelOfferAggregationWorkflow
│   │   ├── client/
│   │   │   └── temporalClient.ts       # Lazy singleton Temporal Client + executeHotelOfferWorkflow()
│   │   └── worker/
│   │       └── index.ts                # Standalone Temporal Worker entrypoint
│   └── api/
│       ├── validation.ts               # Query param parsing & validation for /api/hotels
│       ├── hotelRoutes.ts              # GET /api/hotels
│       ├── healthRoutes.ts             # GET /health (probes supplierA, supplierB, redis)
│       └── server.ts                   # Express app bootstrap (mounts /api, /supplierA, /supplierB, /health)
├── Dockerfile                          # Multi-stage build (builder -> runtime) shared by app & worker
├── docker-compose.yml                  # 6 services: temporal-db, temporal, temporal-ui, redis, app, worker
├── postman_collection.json             # Ready-to-import Postman v2.1 collection matching Section 7
├── package.json
├── tsconfig.json
└── README.md
```

### Shared Types (`src/temporal/types.ts`)

| Type | Exact Fields |
| :--- | :--- |
| `SupplierId` | `'A' \| 'B'` |
| `RawSupplierHotel` | `{ hotelId: string; name: string; price: number; city: string; commissionPct: number }` |
| `HotelOffer` | `{ name: string; price: number; supplier: 'Supplier A' \| 'Supplier B'; commissionPct: number }` |

---

## 2. Temporal Design

* **Task Queue:** `hotel-offers-queue`
* **Workflow Name:** `hotelOfferAggregationWorkflow(city: string): Promise<HotelOffer[]>`
* **Workflow ID Pattern:** `hotel-offers-${normalizedCity}-${crypto.randomUUID()}` (generated in `src/temporal/client/temporalClient.ts` before starting the workflow).
  *Justification:* Unique per-request IDs avoid Temporal `WorkflowExecutionAlreadyStarted` collisions on concurrent requests for the same city.

### Activities (`src/temporal/activities/hotelActivities.ts`)

| Activity | Signature | Responsibility |
| :--- | :--- | :--- |
| `fetchSupplier` | `(supplier: SupplierId, city: string) => Promise<RawSupplierHotel[]>` | Calls `GET ${SUPPLIER_BASE_URL}/supplier${supplier}/hotels?city=${encodeURIComponent(city)}` via native `fetch` with `AbortSignal.timeout(3000)`. Throws an Error on non-2xx responses (including `503`). |
| `saveToRedis` | `(city: string, offers: HotelOffer[]) => Promise<void>` | Calls `hotelStore.saveCityOffers(city, offers)` to atomically replace the city's Redis Sorted Set and Hash with a 300s TTL. |

### Deduplication Logic (`src/temporal/workflows/dedupe.ts`)

* **Location:** Pure synchronous function imported and executed directly inside `hotelOfferAggregationWorkflow`.
  *Justification:* Keeping deduplication pure and side-effect-free inside the workflow guarantees Temporal replay determinism without wasting an extra activity round trip.
* **Rules:**
  1. Map each `RawSupplierHotel` to a `HotelOffer` (`supplier: 'Supplier A'` or `'Supplier B'`), trimming `name`.
  2. Group by canonical key `hotel.name.trim().toLowerCase()`.
  3. When a hotel appears in both suppliers, select the offer with the **lower `price`**.
  4. Tie-breaker: if `price` is equal, select the offer with the **higher `commissionPct`**; if still equal, select **Supplier A**.
  5. Return offers sorted ascending by `price` (tie-break alphabetically by `name`).

### Retry & Timeout Policy (`proxyActivities` inside `hotelOfferWorkflow.ts`)

| Activity | `startToCloseTimeout` | `initialInterval` | `backoffCoefficient` | `maximumInterval` | `maximumAttempts` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `fetchSupplier` | `'5s'` | `'500ms'` | `2` | `'2s'` | `3` |
| `saveToRedis` | `'5s'` | `'500ms'` | `2` | `'2s'` | `3` |

*Justification:* 3 attempts with 500ms→1s backoff fails fast (~2s total retry overhead) so synchronous HTTP requests do not hang when a supplier is down.

### Failed Supplier Handling

* Invoke both suppliers in parallel with `Promise.allSettled([fetchSupplier('A', city), fetchSupplier('B', city)])`.
* If **one** supplier rejects (after exhausting its 3 Temporal retries): log a warning via `workflow.log.warn(...)`, substitute `[]` for the failed supplier, dedupe using the surviving supplier's offers, save to Redis, and return them.
* If **both** suppliers reject: throw `ApplicationFailure.nonRetryable('All hotel suppliers failed')`; the Express handler catches this and responds with `502 Bad Gateway`.
  *Justification:* `Promise.allSettled` isolates single-supplier outages inside the workflow so partial results still flow through deduplication and Redis caching.

---

## 3. Redis Design (Plain Redis, No RediSearch)

Use `ioredis` against plain Redis 7 with a **Sorted Set** for price indexing and a **Hash** per city for hotel details.
*Justification:* One Sorted Set + one Hash per city enables atomic `MULTI/EXEC` replacement and O(K) batch detail fetches (`HMGET`) without RediSearch or per-hotel key sprawl.

### Exact Key Schema

Let `c = city.trim().toLowerCase()` and `k = offer.name.trim().toLowerCase()`.

| Key | Redis Type | Structure | TTL |
| :--- | :--- | :--- | :--- |
| `hotels:city:{c}:prices` | `ZSET` | member = `{k}`, score = `offer.price` | `300` seconds (5 min) |
| `hotels:city:{c}:details` | `HASH` | field = `{k}`, value = `JSON.stringify(offer)` | `300` seconds (5 min) |

### Write Commands (`saveCityOffers` in `src/redis/hotelStore.ts`)

Execute inside a single `redis.multi() ... .exec()` transaction:
1. `DEL hotels:city:{c}:prices hotels:city:{c}:details` (clears stale offers when a supplier goes down or a city returns empty).
2. If `offers.length > 0`:
   * `ZADD hotels:city:{c}:prices <price_1> <k_1> <price_2> <k_2> ...`
   * `HSET hotels:city:{c}:details <k_1> <json_1> <k_2> <json_2> ...`
   * `EXPIRE hotels:city:{c}:prices 300`
   * `EXPIRE hotels:city:{c}:details 300`

### Read & Filter Commands (`queryCityOffers` in `src/redis/hotelStore.ts`)

* **Defaults when omitted:** `min = minPrice !== undefined ? String(minPrice) : '-inf'`, `max = maxPrice !== undefined ? String(maxPrice) : '+inf'`.
* **Commands:**
  1. `const keys = await redis.zrangebyscore(`hotels:city:${c}:prices`, min, max)` (returns keys sorted ascending by price).
  2. If `keys.length === 0`, return `[]`.
  3. `const raw = await redis.hmget(`hotels:city:${c}:details`, ...keys)`
  4. Filter out nulls and `JSON.parse` each entry into `HotelOffer[]`.

### End-to-End Request Flow (Workflow → Redis Filter)

1. `GET /api/hotels` validates and normalizes `city`, `minPrice`, and `maxPrice`.
2. Express calls `await executeHotelOfferWorkflow(city)` (waits for workflow completion).
3. Inside the workflow: parallel `fetchSupplier('A', city)` + `fetchSupplier('B', city)` → deterministic `dedupeAndSelectBestOffers` → `saveToRedis(city, dedupedOffers)`.
4. Once the workflow completes, Express ignores the raw workflow return list for filtering and calls `await queryCityOffers(city, minPrice, maxPrice)` against Redis (`ZRANGEBYSCORE` + `HMGET`), returning the JSON array with `200 OK`.
   *Justification:* Always reading the final response through `ZRANGEBYSCORE` guarantees every request—filtered or unfiltered—exercises Redis price indexing consistently and returns price-sorted results.

---

## 4. Docker Compose Services

Use pinned, verified image versions for Temporal ([Temporal Docker Compose template](https://portainer-templates.as93.net/temporal)), Postgres, and Redis on a single bridge network (`hotel-net`).
*Justification:* `temporalio/auto-setup:1.29.7` auto-provisions the Postgres schema and `default` namespace on first boot, eliminating manual migration scripts in a take-home setup.

| Service | Image / Build | Ports (Host:Container) | Key Environment Variables | Depends On | Healthcheck |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `temporal-db` | `postgres:16-alpine` | `5432:5432` | `POSTGRES_USER=temporal`, `POSTGRES_PASSWORD=temporal`, `POSTGRES_DB=temporal` | — | `["CMD-SHELL", "pg_isready -U temporal -d temporal"]` (`interval: 5s`, `timeout: 5s`, `retries: 10`) |
| `temporal` | `temporalio/auto-setup:1.29.7` | `7233:7233` | `DB=postgres12`, `DB_PORT=5432`, `POSTGRES_SEEDS=temporal-db`, `POSTGRES_USER=temporal`, `POSTGRES_PWD=temporal`, `DBNAME=temporal`, `VISIBILITY_DBNAME=temporal_visibility` | `temporal-db` (`service_healthy`) | `["CMD", "temporal", "operator", "cluster", "health", "--address", "temporal:7233"]` (`interval: 10s`, `timeout: 5s`, `retries: 12`, `start_period: 20s`) |
| `temporal-ui` | `temporalio/ui:2.51.0` | `8080:8080` | `TEMPORAL_ADDRESS=temporal:7233`, `TEMPORAL_UI_PORT=8080` | `temporal` (`service_healthy`) | `["CMD-SHELL", "wget -q --spider http://localhost:8080 || exit 1"]` (`interval: 10s`, `timeout: 5s`, `retries: 5`) |
| `redis` | `redis:7-alpine` | `6379:6379` | — | — | `["CMD", "redis-cli", "ping"]` (`interval: 5s`, `timeout: 3s`, `retries: 5`) |
| `app` | `build: .` (`node dist/api/server.js`) | `3000:3000` | `PORT=3000`, `REDIS_URL=redis://redis:6379`, `TEMPORAL_ADDRESS=temporal:7233`, `SUPPLIER_BASE_URL=http://app:3000`, `SUPPLIER_A_DOWN=${SUPPLIER_A_DOWN:-false}`, `SUPPLIER_B_DOWN=${SUPPLIER_B_DOWN:-false}` | `redis` (`service_healthy`), `temporal` (`service_healthy`) | `["CMD-SHELL", "wget -q --spider http://localhost:3000/health || exit 1"]` (`interval: 10s`, `timeout: 5s`, `retries: 5`) |
| `worker` | `build: .` (`node dist/temporal/worker/index.js`) | — | `REDIS_URL=redis://redis:6379`, `TEMPORAL_ADDRESS=temporal:7233`, `SUPPLIER_BASE_URL=http://app:3000` | `redis` (`service_healthy`), `temporal` (`service_healthy`), `app` (`service_healthy`) | `["CMD-SHELL", "pgrep -f 'dist/temporal/worker/index.js' > /dev/null"]` (`interval: 10s`, `timeout: 5s`, `retries: 5`) |

*Note on `temporal` healthcheck:* Passing `--address temporal:7233` avoids the known `127.0.0.1:7233` loopback bind issue in `temporalio/auto-setup` ([temporalio/docker-builds#109](https://github.com/temporalio/docker-builds/issues/109)).

### `/health` Endpoint Contract (`src/api/healthRoutes.ts`)

* Probes `GET ${SUPPLIER_BASE_URL}/supplierA/hotels?city=delhi`, `GET ${SUPPLIER_BASE_URL}/supplierB/hotels?city=delhi` (each with a 2s timeout), and `redis.ping()`.
* Always returns `200 OK` if the Express process and Redis are up (so `docker-compose` keeps `app` healthy during supplier-down simulations), with `status: "ok"` when both suppliers are up or `"degraded"` when one/both suppliers are down:
  ```json
  { "status": "ok", "redis": "up", "suppliers": { "supplierA": "up", "supplierB": "up" } }
  ```

---

## 5. Validation & Edge Cases

Validate all inputs synchronously in `src/api/validation.ts` before starting any Temporal workflow.
*Justification:* Rejecting bad queries at the HTTP boundary prevents useless Temporal workflow executions and keeps workflow history clean.

| Case | Input Example | Behavior / HTTP Status | Response Body |
| :--- | :--- | :--- | :--- |
| Missing or blank `city` | `/api/hotels` or `?city=%20` | `400 Bad Request` | `{ "error": "Query parameter 'city' is required and must be a non-empty string." }` |
| Non-numeric or negative `minPrice` / `maxPrice` | `?city=delhi&minPrice=abc`, `?minPrice=`, `?maxPrice=-10` | `400 Bad Request` (reject if `Number.isNaN(n)`, `!Number.isFinite(n)`, empty string, or `n < 0`) | `{ "error": "Query parameter 'minPrice' must be a non-negative number." }` (or `'maxPrice'`) |
| `minPrice > maxPrice` | `?city=delhi&minPrice=7000&maxPrice=5000` | `400 Bad Request` | `{ "error": "'minPrice' cannot be greater than 'maxPrice'." }` |
| Case-insensitive `city` | `?city=DeLhI` | Normalize with `city.trim().toLowerCase()` across API, suppliers, workflow, and Redis | `200 OK` with same results as `delhi` |
| Case-insensitive hotel `name` | `"Oberoi Grand"` vs `"oberoi grand"` | Dedupe key is `name.trim().toLowerCase()`; output preserves trimmed `name` of the winning offer | Single merged entry |
| Unknown city or no offers in price range | `?city=jaipur` or `?city=delhi&minPrice=50000` | Workflow saves empty state (`DEL` keys); Redis `ZRANGEBYSCORE` returns `[]` | `200 OK` with `[]` |
| Both suppliers down | `SUPPLIER_A_DOWN=true` & `SUPPLIER_B_DOWN=true` | Workflow fails non-retryably after activity retries | `502 Bad Gateway` `{ "error": "All hotel suppliers failed to respond." }` |

---

## 6. Mock Data (`src/mock/data.ts`)

Both `GET /supplierA/hotels` and `GET /supplierB/hotels` filter their static arrays by `city` (case-insensitive) when `?city=` is provided, or return the full array if `?city=` is omitted.
*Justification:* Static deterministic datasets make curl tests, Postman assertions, and reviewer verification 100% reproducible.

### City 1: `delhi` (7 hotels per supplier, 4 overlaps, 10 unique deduped hotels)

**Supplier A (`delhi`):**

| hotelId | name | price | city | commissionPct |
| :--- | :--- | ---: | :--- | ---: |
| `a1` | `Holtin` | 6000 | `delhi` | 10 |
| `a2` | `Radison` | 5900 | `delhi` | 13 |
| `a3` | `Taj Palace` | 8200 | `delhi` | 12 |
| `a4` | `Oberoi Grand` | 9500 | `delhi` | 15 |
| `a5` | `Leela Ambience` | 7100 | `delhi` | 14 |
| `a6` | `ITC Maurya` | 8800 | `delhi` | 11 |
| `a7` | `Bloomrooms` | 3200 | `delhi` | 8 |

**Supplier B (`delhi`):**

| hotelId | name | price | city | commissionPct |
| :--- | :--- | ---: | :--- | ---: |
| `b1` | `Holtin` | 5340 | `delhi` | 20 |
| `b2` | `Radison` | 6200 | `delhi` | 18 |
| `b3` | `Taj Palace` | 7900 | `delhi` | 16 |
| `b4` | `oberoi grand` | 9900 | `delhi` | 19 |
| `b5` | `Hyatt Regency` | 6500 | `delhi` | 15 |
| `b6` | `Lemon Tree` | 4100 | `delhi` | 12 |
| `b7` | `Shangri-La` | 7600 | `delhi` | 17 |

*(Overlap outcomes: `Holtin` → Supplier B at 5340; `Radison` → Supplier A at 5900; `Taj Palace` → Supplier B at 7900; `Oberoi Grand` → Supplier A at 9500, also exercising case-insensitive matching against `oberoi grand`.)*

### City 2: `mumbai` (3 hotels per supplier, 1 overlap, 5 unique deduped hotels)

* **Supplier A:** `a8` `Trident Nariman` (7500, 12%), `a9` `Taj Mahal Tower` (11000, 14%), `a10` `Ginger Andheri` (3500, 9%)
* **Supplier B:** `b8` `Trident Nariman` (7200, 16%), `b9` `St. Regis` (12500, 18%), `b10` `Suba Palace` (4800, 11%)
* **Overlap outcome:** `Trident Nariman` → Supplier B at 7200.

### Unknown City

* Any city not in `{delhi, mumbai}` (e.g., `jaipur`) returns `[]` from both mock endpoints and `200 OK` `[]` from `/api/hotels`.

---

## 7. Test Plan (`curl` Verification)

Run after `docker compose up --build -d` and all services report `healthy`.

| # | Test Case | Command | Expected Status & Output |
| :--- | :--- | :--- | :--- |
| 1 | Health check (normal) | `curl -s -w "\n%{http_code}\n" http://localhost:3000/health` | `200` — `{"status":"ok","redis":"up","suppliers":{"supplierA":"up","supplierB":"up"}}` |
| 2 | Full deduped `delhi` list | `curl -s -w "\n%{http_code}\n" "http://localhost:3000/api/hotels?city=delhi"` | `200` — 10 hotels sorted by price: `Bloomrooms` (3200, A), `Lemon Tree` (4100, B), `Holtin` (5340, B, 20), `Radison` (5900, A, 13), `Hyatt Regency` (6500, B), `Leela Ambience` (7100, A), `Shangri-La` (7600, B), `Taj Palace` (7900, B, 16), `ITC Maurya` (8800, A), `Oberoi Grand` (9500, A, 15) |
| 3 | Case-insensitive `city` | `curl -s -w "\n%{http_code}\n" "http://localhost:3000/api/hotels?city=DELHI"` | `200` — Exact same 10-element JSON array as Test 2 |
| 4 | Price range (`min` + `max`) | `curl -s -w "\n%{http_code}\n" "http://localhost:3000/api/hotels?city=delhi&minPrice=5000&maxPrice=7500"` | `200` — 4 hotels: `Holtin` (5340), `Radison` (5900), `Hyatt Regency` (6500), `Leela Ambience` (7100) |
| 5 | Lower bound only (`maxPrice` omitted → `+inf`) | `curl -s -w "\n%{http_code}\n" "http://localhost:3000/api/hotels?city=delhi&minPrice=8000"` | `200` — 2 hotels: `ITC Maurya` (8800, A), `Oberoi Grand` (9500, A) |
| 6 | Upper bound only (`minPrice` omitted → `-inf`) | `curl -s -w "\n%{http_code}\n" "http://localhost:3000/api/hotels?city=delhi&maxPrice=4500"` | `200` — 2 hotels: `Bloomrooms` (3200, A), `Lemon Tree` (4100, B) |
| 7 | Second city (`mumbai`) | `curl -s -w "\n%{http_code}\n" "http://localhost:3000/api/hotels?city=mumbai"` | `200` — 5 hotels: `Ginger Andheri` (3500, A), `Suba Palace` (4800, B), `Trident Nariman` (7200, B, 16), `Taj Mahal Tower` (11000, A), `St. Regis` (12500, B) |
| 8 | Unknown city | `curl -s -w "\n%{http_code}\n" "http://localhost:3000/api/hotels?city=jaipur"` | `200` — `[]` |
| 9 | Valid city, empty price range | `curl -s -w "\n%{http_code}\n" "http://localhost:3000/api/hotels?city=delhi&minPrice=20000"` | `200` — `[]` |
| 10 | Missing `city` | `curl -s -w "\n%{http_code}\n" "http://localhost:3000/api/hotels"` | `400` — `{"error":"Query parameter 'city' is required and must be a non-empty string."}` |
| 11 | `minPrice > maxPrice` | `curl -s -w "\n%{http_code}\n" "http://localhost:3000/api/hotels?city=delhi&minPrice=7000&maxPrice=5000"` | `400` — `{"error":"'minPrice' cannot be greater than 'maxPrice'."}` |
| 12 | Non-numeric price | `curl -s -w "\n%{http_code}\n" "http://localhost:3000/api/hotels?city=delhi&minPrice=abc"` | `400` — `{"error":"Query parameter 'minPrice' must be a non-negative number."}` |
| 13 | Supplier B down (restart `app` with `SUPPLIER_B_DOWN=true`) | `curl -s -w "\n%{http_code}\n" "http://localhost:3000/api/hotels?city=delhi"` | `200` — 7 Supplier A hotels only (`Holtin` at `6000` from `Supplier A`, `Taj Palace` at `8200` from `Supplier A`, etc.) |
| 14 | Health check with Supplier B down | `curl -s -w "\n%{http_code}\n" http://localhost:3000/health` | `200` — `{"status":"degraded","redis":"up","suppliers":{"supplierA":"up","supplierB":"down"}}` |

---

## 8. Simulating a Supplier Outage

* **Environment Flags:** `SUPPLIER_A_DOWN` and `SUPPLIER_B_DOWN` (string boolean, default `"false"`, parsed via `process.env.SUPPLIER_B_DOWN === 'true'`).
* **Behavior in `src/mock/supplierRoutes.ts`:** When `SUPPLIER_B_DOWN=true`, `GET /supplierB/hotels` immediately returns `503 Service Unavailable` with `{ "error": "Supplier B is currently unavailable" }` (and analogously for `SUPPLIER_A_DOWN=true`).
* **How to trigger in Docker Compose:**
  ```bash
  SUPPLIER_B_DOWN=true docker compose up -d app
  ```
* **Expected System Effect:** `fetchSupplier('B', city)` fails and retries 3 times in Temporal (visible in Temporal UI at `http://localhost:8080`), then `hotelOfferAggregationWorkflow` degrades gracefully to Supplier A's results, overwrites Redis with Supplier A's data via `DEL` + `ZADD` + `HSET`, and `GET /health` reports `supplierB: "down"`.
  *Justification:* Env-flag injection in the mock route tests the real HTTP error path, Temporal activity retries, workflow fallback, and `/health` reporting without modifying code.
