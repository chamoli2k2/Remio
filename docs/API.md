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
