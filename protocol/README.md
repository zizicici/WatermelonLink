# Watermelon Link protocol v2

The protocol turns a user-approved browser directory into a temporary remote-storage node for the existing Watermelon backup pipeline. Signaling remains server-relayed and encrypted; filesystem requests and file bytes travel only over the authenticated DataChannel.

## Pairing

1. The browser chooses a directory with the File System Access API.
2. It creates a random 32-byte pairing secret and sends only its SHA-256 commitment to `POST /api/v1/tickets` after Turnstile succeeds.
3. The server returns a compact, signed, three-minute binary ticket. Creating a ticket does not allocate a room.
4. The QR code contains the universal HTTPS URL `/pair#t=<ticket>&s=<secret>`. The URL fragment is not sent in HTTP requests.
5. The iPhone can obtain the same URL in either of two ways: Camera opens it as a Universal Link, or Watermelon Backup scans it from the One-Time Link node.
6. Browser and phone connect to `/ws/v1` with the same ticket and distinct roles.
7. Offer, answer, and ICE candidates are encrypted with AES-256-GCM. The key is derived from the QR secret with HKDF-SHA-256 and the session ID.
8. WebRTC uses an empty ICE server list. Both peers discard non-host and non-local ICE candidates, including candidates embedded in SDP. There is no STUN or TURN service.
9. The browser authenticates the DataChannel with an HMAC challenge. Once it succeeds, both peers close signaling.

## Trust boundary

The service sees IP addresses, ticket claims, connection timing, peer roles, and encrypted signal sizes. It cannot read the QR secret, SDP, ICE candidates, DataChannel messages, filenames, or photos. It accepts no file-upload endpoint.

The ticket is 73 bytes before base64url encoding: version, 16-byte session ID, 32-byte capability commitment, issue and expiry times, and a 16-byte truncated HMAC-SHA-256 signature. Its short lifetime and 128-bit authenticator keep the QR payload compact without weakening the pairing secret.

## Resource bounds

- Ticket requests are rate-limited per source IP.
- Rooms exist only while a WebSocket peer is connected.
- Each room permits one browser and one phone.
- Room count, connections per IP, lifetime, signal messages, message size, and cumulative signal bytes all have hard limits.
- Completed, cancelled, expired, or invalidated tickets cannot create another room during their remaining lifetime.
- State is memory-only and discarded on restart.

## DataChannel authentication

The browser sends:

```json
{"type":"auth_challenge","nonce":"<24 random bytes, base64url>"}
```

The phone replies with an HMAC-SHA-256 over `watermelon-link-data-v1:<nonce>`, keyed by the QR secret:

```json
{"type":"auth_response","mac":"<base64url HMAC>"}
```

After verifying the response, the browser confirms authentication and the selected folder name over the same DataChannel:

```json
{"type":"auth_ok","protocolVersion":2,"folderName":"Photos Backup"}
```

The phone enters the connected state only after receiving a valid v2 `auth_ok`. The signaling server's `signaling_complete` event only closes signaling and is not an authentication result. No filesystem message is accepted until this challenge succeeds.

## Temporary filesystem node

The phone sends ordered `fs_request` JSON messages carrying a unique request ID and an operation. The browser replies with a matching `fs_response`. Supported operations cover metadata, directory listing and creation, deletion, copy, move, and 32 KiB upload/download chunks. Every path is normalized beneath the directory handle selected by the user; `.` and `..` traversal is rejected.

Uploads use begin/chunk/finish or abort messages. Browser writes are staged by `FileSystemWritableFileStream` and become visible when the stream closes. `create_if_absent` is serialized within the page and reports `name_collision`, which supplies the existing Lite repository write-lock primitive.

The iOS node is memory-only, uses one backup worker, cannot run in the background, and is removed immediately when the DataChannel or page closes. The signaling server never sees these requests or file bytes.
