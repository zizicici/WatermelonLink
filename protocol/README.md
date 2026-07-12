# Watermelon Link protocol v1

The current milestone covers browser-node creation and signaling only. It does not define photo manifests, resume state, file writes, or iOS implementation.

## Pairing

1. The browser chooses a directory with the File System Access API.
2. It creates a random 32-byte pairing secret and sends only its SHA-256 commitment to `POST /api/v1/tickets` after Turnstile succeeds.
3. The server returns a compact, signed, three-minute binary ticket. Creating a ticket does not allocate a room.
4. The QR code contains `/pair#t=<ticket>&s=<secret>`. The URL fragment is not sent in HTTP requests.
5. Browser and phone connect to `/ws/v1` with the same ticket and distinct roles.
6. Offer, answer, and ICE candidates are encrypted with AES-256-GCM. The key is derived from the QR secret with HKDF-SHA-256 and the session ID.
7. WebRTC uses an empty ICE server list. There is no STUN or TURN service in v1.
8. The browser authenticates the DataChannel with an HMAC challenge. Once it succeeds, both peers close signaling.

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

No file-transfer message is accepted until this challenge succeeds. File-transfer protocol work belongs to a later milestone.
