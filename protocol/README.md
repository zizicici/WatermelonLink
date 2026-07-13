# Watermelon Link protocol v1

The protocol turns a user-approved browser directory into a temporary remote-storage node for the existing Watermelon backup pipeline. Signaling remains server-relayed and encrypted; filesystem requests and file bytes travel only over the authenticated DataChannel.

## Pairing

1. The browser chooses a directory with the File System Access API.
2. It creates a random 32-byte pairing secret and sends only the v1 domain-separated SHA-256 commitment to `POST /api/v1/tickets` after Turnstile succeeds.
3. The server returns a compact, signed, 90-second binary ticket. Creating a ticket does not allocate a room.
4. The QR code contains the universal HTTPS URL `/pair#t=<ticket>&s=<secret>`. The URL fragment is not sent in HTTP requests.
5. The iPhone can obtain the same URL in either of two ways: Camera opens it as a Universal Link, or Watermelon Backup scans it from the One-Time Link node.
6. Browser and phone connect to `/ws/v1` with the same ticket and distinct roles.
7. Offer, answer, and ICE candidates are encrypted with AES-256-GCM. The key is derived from the QR secret with HKDF-SHA-256 and the session ID.
8. WebRTC uses an empty ICE server list. Both peers parse candidate lines case-insensitively, normalize SDP line endings, and discard malformed, non-host, public, or noncanonical candidates before they reach WebRTC. There is no STUN or TURN service. Numeric candidates are limited to private, ULA, or link-local addresses; Chromium mDNS host candidates rely on the operating system's link-local `.local` resolution semantics. This prevents public-candidate routing but does not claim that a routed enterprise private network or site VPN is one physical layer-2 LAN.
9. The browser authenticates the DataChannel with an HMAC challenge. Once it succeeds, both peers close signaling.

## Trust boundary

The service sees IP addresses, ticket claims, connection timing, peer roles, and encrypted signal sizes. It cannot read the QR secret, SDP, ICE candidates, DataChannel messages, filenames, or photos. It accepts no file-upload endpoint.

The QR secret authorizes the paired phone to use the selected browser directory as a temporary storage node, including listing, reading, creating, replacing, moving, copying, and deleting entries beneath that root. This is the storage protocol's intended authority; users should scan only with their own phone and select a dedicated backup folder.

The ticket is 73 bytes before base64url encoding: version, 16-byte session ID, 32-byte capability commitment, issue and expiry times, and a 16-byte truncated HMAC-SHA-256 signature. Its short lifetime and 128-bit authenticator keep the QR payload compact without weakening the pairing secret.

## Resource bounds

- Raw ticket requests and eligible Turnstile verifications are independently rate-limited per IPv4 address or IPv6 `/64`. Siteverify also has a global minute budget and a non-queueing concurrent-request ceiling.
- Rooms exist only while a WebSocket peer is connected.
- Each room permits one browser and one phone.
- Unpaired rooms and connections have per-network ceilings. A reserved slice of global room capacity remains available to networks without an existing room, while the second peer may still join a room at the ordinary room-count boundary.
- Room count, lifetime, signal messages, message size, cumulative signal bytes, WebSocket fragments and client control frames, per-network pre-verification WebSocket upgrades, globally accepted signed upgrades, server connections, and per-peer outbound WebSocket buffering all have hard limits. Automatic PONG is disabled; bounded PING replies and server heartbeats share the same outbound backpressure boundary, and control events yield between frames. The unsigned global path deliberately has no shared quota that an unauthenticated source could exhaust for every legitimate network; its work is limited to canonical ticket parsing and one HMAC check. Resource accounting is released before socket shutdown and does not depend on a peer emitting `close`.
- Completed, cancelled, expired, or invalidated tickets cannot create another room during their remaining lifetime.
- State is memory-only. A per-process signing key invalidates every outstanding ticket on restart.
- Authenticated filesystem messages, queued requests, active transfers, response size, and idle uploads are bounded in the browser.

## DataChannel authentication

After installing its DataChannel delegate, the phone sends:

```json
{"type":"auth_ready","protocolVersion":1}
```

The browser then sends:

```json
{"type":"auth_challenge","nonce":"<24 random bytes, base64url>"}
```

The phone replies with an HMAC-SHA-256 over `watermelon-link-auth-v1:<session>:phone-to-browser:<nonce>`, keyed by the QR secret:

```json
{"type":"auth_response","mac":"<base64url HMAC>"}
```

After verifying the response, the browser confirms authentication and the selected folder name over the same DataChannel:

```json
{"type":"auth_ok","protocolVersion":1,"folderName":"Photos Backup","browserNodeID":"<current node scope>","reclaimBrowserNodeIDs":["<recent quiesced scope>"],"uploadChunkBytes":131072,"mac":"<browser confirmation HMAC>"}
```

The phone enters the connected state only after receiving a valid v1 `auth_ok`. The signaling server's `signaling_complete` event only closes signaling and is not an authentication result. No filesystem message is accepted until this challenge succeeds.

## Temporary filesystem node

The phone sends ordered `fs_request` JSON messages carrying a unique request ID and an operation. The browser replies with a matching `fs_response`; results larger than 48 KiB use ordered 24 KiB `fs_response_part` messages with bounded reassembly. Supported operations cover metadata, directory listing and creation, deletion, copy, move, and bidirectional file streaming. Every path is normalized beneath the directory handle selected by the user; `.` and `..` traversal is rejected.

Uploads and downloads use JSON begin/start/finish/abort controls and binary DataChannel frames. A frame contains a four-byte protocol/type prefix (`WML\x01` for upload or `WML\x02` for download), a 16-byte transfer UUID, an eight-byte big-endian offset, a four-byte payload length, and up to the authenticated `uploadChunkBytes` payload (128 KiB maximum). Non-final frames are at least 8 KiB. Each direction has a shared 4 MiB unacknowledged window, with data transfers capped at 3.5 MiB so canonical lock traffic always retains 512 KiB. The native data reservation is limited to one maximum frame and the total native queue target is 192 KiB, preserving capacity for control and acknowledgement messages. The receiver validates contiguous offsets and returns cumulative JSON acknowledgements only after its destination write call resolves: the browser acknowledges uploads after `FileSystemWritableFileStream.write()`, and the phone acknowledges downloads after writing the bytes to its local file. This removes per-chunk request round trips and Base64 expansion while keeping queued payload memory bounded.

The browser batches upload frames into no more than 512 KiB per writable call, so every one of four interleaved data workers can receive an acknowledgement before the phone's shared 3.5 MiB data window is exhausted. Non-final upload frames are at least 8 KiB. Frames remain ordered within each transfer while admission is split into four data-upload slots and one canonical lock-upload slot. Active upload paths are reserved against competing streams and overlapping namespace mutations. Ordinary downloads have two session-wide slots; a third slot accepts only canonical `.watermelon/locks/<writer UUID>.lock` reads, and the phone serializes those lock reads. Lock controls and every mutation overlapping the lock namespace use an independent browser queue. On the phone, six ordinary filesystem requests may be in flight; a seventh slot is reserved for priority control traffic and an eighth for cleanup. Queued callers are separately bounded at 12 ordinary, 15 through control priority, and 16 total. One-Time Link manifest sync uses one data download at a time, leaving the other data slot available to an inline restore. `upload_finish` becomes a final barrier when received: earlier queued frames are committed before it, while later frames are rejected. Browser writes remain staged until the stream closes. A download retains the immutable `File` snapshot captured at begin, starts only after the phone registers its receiver, and may finish only after every byte has been acknowledged. Both directions report capacity or idle expiry as retryable transfer errors without closing the shared channel. The browser upload idle deadline is 60 seconds, its download deadline is five minutes, and the phone's upload-flow fallback is 65 seconds. Read-only filesystem request timeouts remain request-scoped. A timed-out mutation or transfer control closes the session so queued browser mutations cannot execute after the phone has reported a definite timeout; local task cancellation abandons only that request or transfer and keeps the authenticated connection available. An explicitly aborted or timed-out native read blocks new reads and keeps the Web Lock until the browser operation settles, so uncancellable reads cannot accumulate across consecutive Links; the page asks for a reload if browser cleanup itself never returns. `create_if_absent` is serialized within one browser node and reports `name_collision`.

The product contract permits only one active Watermelon Link writer for a selected root, and the page displays this restriction. The browser API cannot provide an atomic lock spanning another tab, Finder, or an unrelated process, so this remains a safety assumption rather than a cross-process filesystem guarantee.

An iOS installation keeps one stable Link writer identity. Each Link page generates a random node scope and holds a Web Lock for the entire Link lifetime. Only after its filesystem request queue, upload cleanup, download tasks, and abandoned native reads are quiescent does the page retain that scope among a bounded set of recent reclaim receipts and release the browser lease. A later foreground Link may reclaim only an unchanged, decodable fresh lock carrying the same iOS writer and one of those authenticated receipts; it confirms the complete lock snapshot repeatedly before deletion. A page or browser crash cannot mint its current receipt and therefore waits for normal lock expiry. Normal nodes, background work, foreign writers, changing locks, and invalid lock bodies remain fail-closed.

The iOS node is memory-only, uses one PeerConnection with up to four backup workers, cannot run in the background, and is removed immediately when the DataChannel or page closes. The signaling server never sees these requests or file bytes.

The phone rejects a node-declared download above 64 GiB before creating a local file, caps repository SQLite downloads at 256 MiB and lock bodies at 1 MiB, requires restore downloads to match the manifest size exactly, and preserves 128 MiB of reported local capacity. Download frames can never exceed the size accepted at `download_begin`.
