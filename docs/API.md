# API overview

All routes use the `/api` prefix. The browser sends the HttpOnly `remio_session` cookie automatically. Server errors return `{ "error": "message", "code": "optional code" }`.

| Method | Route | Access / purpose |
| --- | --- | --- |
| POST | `/auth/signup` | Create account; name, username, email, password |
| POST | `/auth/login` | identifier (username/email), password |
| POST | `/auth/logout` | End current session |
| GET | `/auth/me` | Current user, or null |
| PATCH | `/auth/profile` | Own name, bio, dailyGoal, desiredRetention (0.7–0.97) |
| GET | `/users?q=` | People search (prefix on username or name, limit 8). Public |
| GET | `/users/:username` | Public profile: counts (followers, following, friends), `relation` for the viewer, global folders (likeCount, copyCount, thumbnail) |
| POST / DELETE | `/users/:username/follow` | Signed-in; one-way follow. Unique `(from,to,kind)`; counts `$inc` only when the row changes |
| POST | `/users/:username/connect` | Send a friend request, or accept if they already requested you |
| POST | `/users/:username/connect/accept` or `/decline` | Addressee only |
| DELETE | `/users/:username/connect` | Unfriend |
| GET | `/me/friends` · `/me/requests` | Accepted friends; incoming pending requests |
| GET / POST | `/projects` | Owner’s projects; create `{ title, description, visibility }` |
| GET / PATCH | `/projects/:id` | Global projects are readable; owner updates with version |
| PATCH | `/projects/:id/archive` | Owner; `{ archived }` |
| POST / DELETE | `/projects/:id/folders` | Add `{ folderId }` or remove `/:folderId`. Folder stays; many-to-many |
| GET | `/folders` | Own/shared/saved accessible collections |
| GET | `/folders?scope=explore` | Public discovery |
| GET | `/folders/archived` | Own archived folders |
| POST | `/folders` | Create own folder |
| GET | `/folders/:id` | Reader permission |
| PATCH | `/folders/:id` | Owner; full editable folder fields + version |
| POST | `/folders/:id/members` | Owner; username and viewer/editor/remove role |
| POST | `/folders/:id/copy` | Signed-in reader; independent private copy |
| PATCH | `/folders/:id/archive` | Owner; archived boolean |
| PATCH | `/folders/:id/save` | Reader; `{ saved }` likes/unlikes. `likeCount` on the folder; viewer’s `liked` flag |
| GET | `/folders/:id/activity` | Member-only activity details |
| GET | `/folders/:id/cards` | Reader; includes only caller’s progress (FSRS `stability`, `difficulty`, `state`, `retrievability`, and a `preview` of the interval for each rating) |
| POST | `/folders/:id/cards` | Editor/owner. `front.text`/`back.text` are Markdown source and may contain `$…$`/`$$…$$` LaTeX and Anki-style cloze markers `{{c1::answer::hint}}`; when the front has a cloze, the back may be empty |
| POST | `/folders/:id/images` | Editor/owner; multipart field `image` |
| POST | `/folders/:id/import` | Editor/owner; multipart `file` (.apkg, Anki .txt, .csv/.tsv, .md, .json ≤ 25 MB) and optional `tags`. `?dryRun=1` returns `{ format, total, skipped, sample }` without writing; otherwise inserts up to 2000 cards in one transaction and returns `{ imported, skipped }` |
| GET | `/folders/:id/export` | Reader; JSON download of the folder's cards, or `?format=csv` |
| GET | `/media/:id` | Reader permission on the parent folder |
| PATCH | `/cards/:id` | Editor/owner; full card fields + version |
| DELETE | `/cards/:id` | Editor/owner; permanent deletion |
| GET | `/cards/:id/revisions` | Editor/owner |
| PATCH | `/cards/:id/bookmark` | Reader; own bookmarked boolean |
| POST | `/reviews` | Reader; cardId, rating, requestId UUID, progress version |
| GET | `/stats` | Own study statistics: totals, `retention { desired, predicted, observed, sampled, averageStability }`, 14-day `forecast`, memory `states`, `hardest` cards, one-year daily `heatmap`, `streak { current, longest, activeDays }`, `insights[]`, 30-day `ratingMix` |
| GET | `/notifications` | Own 30 most recent notifications plus `unread` count. Types: `follow`, `connect.request`, `connect.accepted`, `premium.requested`, `premium.approved`, `premium.declined` |
| POST | `/notifications/read` | `{ ids?: string[] }`. Omit `ids` to mark everything read. Returns the new `unread` count |
| GET | `/premium/order` | `{ order, subscription, methods }`. `subscription` carries `plan`, `expiresAt`, `daysLeft`, `active`. `methods` lists only what this server can actually take money with, each `{ id, label, blurb, instant, requiresProof }`. The checkout page renders whatever is returned |
| POST | `/premium/checkout` | Gateway flow, step one. Same JSON fields plus `method: razorpay`. Reserves a Razorpay order and returns `{ order, checkout }` for the browser SDK. 502 `GATEWAY_UNREACHABLE`/`GATEWAY_REJECTED` if the gateway declines, and the pending order is removed so the buyer can retry |
| POST | `/premium/checkout/confirm` | Gateway flow, step two. `{ orderId, paymentId, signature }` from the checkout callback. The signature is verified against `RAZORPAY_KEY_SECRET` before anything is granted; a mismatch is 400 `BAD_SIGNATURE` |
| POST | `/premium/webhook/razorpay` | Gateway callback, unauthenticated but signed. Mounted on the **raw** body before the JSON parser, because `X-Razorpay-Signature` covers the exact bytes. Handles `payment.captured` and `payment.failed`. Safe to retry: the grant is a conditional status update, so a replay returns `alreadySettled` and adds no days |
| DELETE | `/premium/order` | Discards the caller's pending order, e.g. after they close the checkout window |
| GET / POST | `/teams` | Own teams with `role`, `seats`, `memberCount`, `daysLeft`, `active`. POST takes `{ name, kind: classroom\|team, description }` and creates it unpaid with no seats |
| GET | `/teams/:id` | `{ team, members, folders, assignments }`. Only for members; a team you are not in is a 404 |
| PATCH / PATCH | `/teams/:id`, `/teams/:id/archive` | Owner only. Update takes `version` for optimistic concurrency; archiving keeps the folders and study history |
| GET | `/teams/code/:code` | What a join code leads to: team name, kind, and the role it grants. Nothing else is revealed before the seat is taken |
| POST | `/teams/join` | `{ code }`. Takes a seat in one transaction; 400 `NO_SEATS` when the team is full, `TEAM_INACTIVE` when unpaid, `ALREADY_MEMBER` when already in |
| GET / POST | `/teams/:id/invites` | Teacher or owner. POST returns the plaintext `code` **once**; only a SHA-256 hash is stored. Optional `role`, `maxUses`, `expiresInDays` |
| DELETE | `/teams/:id/invites/:inviteId` | Revoke an unused link |
| PATCH / DELETE | `/teams/:id/members/:userId` | Owner sets `role` (teacher\|student). Removing frees the seat at once; a member may remove themselves, but the owner cannot leave |
| POST | `/teams/:id/folders` | Teacher or owner; creates a folder the team owns, readable by the whole roster |
| POST / DELETE | `/teams/:id/assignments` | `{ folderId, title?, instructions?, dueAt? }`. Everyone else on the roster gets a `team.assignment` notification |
| GET | `/teams/:id/progress` | Teacher or owner; optional `?folderId=`. Per-person coverage, reviews, accuracy, cards due, and last studied, read from each learner's own progress |
| POST | `/teams/:id/quote` | `{ plan: team-monthly\|team-yearly, seats }`. Prices from the team's own state: `team-new` pays for every seat, `team-renew` extends the current count, `team-seats` prorates extras against the days left |
| GET | `/teams/:id/billing` | The owner's pending seat order, if any, plus the usable payment `methods` |
| POST | `/teams/:id/checkout` | Gateway flow for seats. Same shape as `/premium/checkout` plus `seats`; confirm through `/premium/checkout/confirm` |
| GET | `/admin/users` | Admin/Superadmin; list accounts (`+email`) with `plan`, `expiresAt`, `daysLeft`, `premiumActive`. `?q=` filters |
| PATCH | `/admin/users/:id` | `{ account: normal\|premium\|admin\|superadmin }`. Admin may only set normal/premium. A hand-granted role carries no end date; moving off premium clears the subscription |
| GET | `/admin/orders` | Premium orders, including the requested `plan` and `method` |
| PATCH | `/admin/orders/:id` | `{ status: approved\|declined }`. Goes through the same fulfilment as a verified gateway payment: approving applies the plan's window, extending an unexpired subscription rather than truncating it, and notifies the buyer |
| GET | `/health` | Liveness: Express is running. Public, no database access, always 200 |
| GET | `/ready` | Readiness: MongoDB answers a ping within `READINESS_TIMEOUT_MS`. 200 ready / 503 unavailable; no error details |

## Realtime (Socket.IO, same origin, path `/socket.io`)

The socket authenticates from the `remio_session` cookie during the handshake; the `Origin` header must be same-origin or in `CLIENT_ORIGIN`. Sockets are observe-only: no event mutates data. Every write still goes through the HTTP routes above.

| Direction | Event | Payload / purpose |
| --- | --- | --- |
| client → server | `folder:join` (folderId, ack) | Reader permission. Ack `{ ok, presence, version }` or `{ ok: false, error }` |
| client → server | `folder:leave` (folderId) | Leave the room |
| client → server | `card:editing` (folderId, cardId or null) | Advisory "I am editing this card" for presence |
| client → server | `doc:join` (cardId, ack) | Editor permission. Ack `{ ok, state, version }` where `state` is the Yjs document update |
| client → server | `doc:update` (cardId, update) / `doc:awareness` (cardId, update) | Yjs document and cursor updates; relayed to other editors |
| client → server | `doc:leave` (cardId) | Release the document |
| server → client | `presence` (folderId, list) | `[{ user, color, editing, tabs }]` for everyone signed in and viewing |
| server → client | `folder:event` (event) | `{ type, folderId, aggregateId, detail, actor, at, version? }` after a transaction commits |
| server → client | `folder:revoked` (folderId) | Caller lost access; they were removed from the room and its documents |
| server → client | `doc:update`, `doc:awareness`, `doc:peer-joined`, `doc:peer-left` | Co-editing relay |
| client → server | `room:create` (folderId, `{ count?, seconds? }`, ack) | Signed-in reader of the folder hosts a live quiz. Ack `{ ok, code, room }`. 2–30 questions, 5–60 s each |
| client → server | `room:join` (code, ack) / `room:leave` (code) | Any signed-in user; ack `{ ok, code, room }` or `{ ok: false, error }` |
| client → server | `room:start` (code, ack) / `room:next` (code, ack) | Host only; `next` moves reveal → next question, or → `finished` after the last one |
| client → server | `room:answer` (code, optionIndex) | One answer per player per question; ignored after the deadline |
| server → client | `room:state` (room) | Whole-room snapshot after every change: `{ code, phase, index, total, deadline, players[], question: { prompt, options, correct }, myAnswer, results }`. `correct`, `myAnswer.correct` and `results` are `null` while a question is open |

Both sides need text or an image, unless the front contains a cloze deletion (then the back may be empty).

## Create a card

```json
{
  "front": { "text": "What is optimistic concurrency?", "image": null },
  "back": { "text": "Checking a version before committing an update.", "image": null },
  "tags": ["concurrency", "databases"],
  "hint": "Think about conflicting edits.",
  "source": ""
}
```

Each image ID must belong to the target folder. Folder identity comes from the route and cannot be replaced through card input.

## Version conflict

Edits and reviews can return `409` with `VERSION_CONFLICT`. Preserve the local draft and fetch the current version. Do not silently retry a stale edit as an overwrite.

For retrying a review after a network error, reuse the same request ID and the same payload. A different review requires a new request ID and the latest progress version.

## AI assistants (MCP)

An assistant connected by the account holder speaks the Model Context Protocol over Streamable HTTP
at `POST /mcp`. It is not part of `/api`: the MCP specification and the OAuth RFCs put these paths
at fixed unprefixed locations, and a client that cannot find them where the spec says they live
will not connect.

Authentication is a bearer token and only a bearer token. A session cookie is refused here, which
is what lets the endpoint answer any origin: there is no ambient credential for another site to
borrow, so there is nothing for a cross-site rule to protect.

### Discovery

| Path | Purpose |
| --- | --- |
| `/.well-known/oauth-protected-resource` | RFC 9728. Names the resource and its authorization server. |
| `/.well-known/oauth-authorization-server` | RFC 8414. Endpoints, scopes, and supported flows. |
| `/oauth/register` | RFC 7591 dynamic client registration. Open, and rate limited accordingly. |
| `/oauth/authorize` | The approval screen. Rendered by the app, not the API. |
| `/oauth/token` | Authorization code and refresh grants. |
| `/oauth/revoke` | RFC 7009. Always answers 200. |

An unauthenticated call to `/mcp` returns `401` with a `WWW-Authenticate` header naming the
protected-resource document. That header is the whole discovery mechanism — without it a client
reports that the server said no and stops.

PKCE with `S256` is required and `plain` is not advertised. Redirect URIs are matched by exact
string equality against what the client registered, and only `https` or a loopback address may be
registered at all.

### Scopes

| Scope | Grants |
| --- | --- |
| `collections:read` | List collections and search their cards. |
| `collections:write` | Create new collections. Always private, always owned by the user. |
| `cards:write` | Add new cards to a collection. |
| `images:write` | Fetch pictures from web addresses the assistant supplies. |

### Tools

| Tool | Scope | Notes |
| --- | --- | --- |
| `list_collections` | `collections:read` | Read only. |
| `search_cards` | `collections:read` | Read only. Used to avoid writing the same material twice. |
| `create_collection` | `collections:write` | `visibility` is not a parameter and is forced to private. |
| `add_cards` | `cards:write` | At most 50 per call. Requires a `requestId` for idempotency. A card naming an image also needs `images:write`. |
| `set_collection_cover` | `images:write` | Private collections only. Records the previous cover so undo restores it. |

The surface is additive by design. There is no tool that deletes, edits an existing card, or
publishes, because an assistant summarising a document is reading text an attacker may have
written and no instruction to the model reliably survives an instruction hidden in the document.
The defence is that there is nothing dangerous to instruct: the worst outcome of a successful
prompt injection is unwanted cards in a new private collection.

Every write belongs to an `AgentBatch`, listed at `GET /api/agent/batches` and reversible with
`POST /api/agent/batches/:id/undo`. Undo is session-authenticated and has no tool, so the thing
being undone cannot undo it — or prevent it.

Retrying `add_cards` with the same `requestId` returns the original result with `replayed: true`
rather than writing a second copy. MCP clients retry on timeout, so this is required, not optional.

Beyond the ordinary rate limits there is a per-account daily card allowance (`agent.cardsPerDay`),
counted across every connection and refunded by undoing a batch. A rate limit alone does not stop
a model in a loop from exhausting a generous per-minute allowance over an afternoon.

### Images

A language model can look at a picture but cannot reproduce its bytes, so the only thing it can
pass us is a link. Images are therefore given as `frontImage` / `backImage` on a card, or as
`imageUrl` on `set_collection_cover`, and fetched server-side.

Fetching somebody else's URL on demand is server-side request forgery if it is done naively, so
`services/fetchImage.js` holds four rules: https only; the *resolved address* is checked rather
than the hostname; the connection is pinned to the address that was checked, which is what closes
the DNS-rebinding window that defeats most such validation; and redirects are followed by hand
with every hop re-validated. Private, loopback, link-local, carrier-NAT and multicast ranges are
refused, `169.254.169.254` among them. IPv6 is not resolved at all — see the note in that file for
why that is a deliberate simplification rather than a gap. Every refusal reads the same so the
tool cannot be used to map our network.

What arrives is then decoded and re-encoded as WebP by `services/images.js`, which is the same
path a person's upload takes. The stored file is written by us from a pixel buffer, so appended
payloads, EXIF and polyglots do not survive it. The input format is checked against an allowlist
first — JPEG, PNG and WebP — because re-encoding protects the output but not the decoder, and SVG
is an XML document with its own facilities for pulling in external entities.

Three things keep this from becoming free file hosting:

- `agent.imagesPerDay` is a separate, much tighter allowance than the card one, refunded by undo,
  and settable to zero to switch fetching off without disabling assistants.
- Stored bytes are fingerprinted, and an image a collection already has is reused rather than
  stored again — so the same diagram on twenty cards costs one object.
- Undoing a batch deletes the objects it created, resized variants included, once nothing else
  references them.
