import assert from "node:assert/strict";
import test from "node:test";
import { allowsLocalICECandidate, filterLocalICECandidates, localICECandidateStatistics } from "../../web/src/local-network.js";

test("only local host ICE candidates are allowed", () => {
  assert.equal(allowsLocalICECandidate("candidate:1 1 udp 1 192.168.1.20 5000 typ host"), true);
  assert.equal(allowsLocalICECandidate("candidate:1 1 udp 1 10.0.0.2 5000 typ host"), true);
  assert.equal(allowsLocalICECandidate("candidate:1 1 udp 1 fd12::1 5000 typ host"), true);
  assert.equal(allowsLocalICECandidate("candidate:1 1 udp 1 peer-id.local 5000 typ host"), true);
  assert.equal(allowsLocalICECandidate("candidate:1 1 udp 1 8.8.8.8 5000 typ host"), false);
  assert.equal(allowsLocalICECandidate("candidate:1 1 udp 1 2001:4860::1 5000 typ host"), false);
  assert.equal(allowsLocalICECandidate("candidate:1 1 udp 1 192.168.1.20 5000 typ srflx"), false);
  assert.equal(allowsLocalICECandidate("candidate:1 1 udp 1 fe80.example.com 5000 typ host"), false);
  assert.equal(allowsLocalICECandidate("candidate:1 1 udp 1 192.168.1. 5000 typ host"), false);
});

test("public candidates are removed from session descriptions", () => {
  const sdp = "v=0\ra=candidate:1 1 udp 1 192.168.1.20 5000 typ host\ra=candidate:2 1 udp 1 2001:4860::1 5001 typ host\ra=CANDIDATE:3 1 udp 1 8.8.8.8 5002 typ host\ra=end-of-candidates\r";
  const filtered = filterLocalICECandidates(sdp);
  assert.match(filtered, /192\.168\.1\.20/);
  assert.doesNotMatch(filtered, /2001:4860/);
  assert.doesNotMatch(filtered, /8\.8\.8\.8/);
  assert.match(filtered, /a=end-of-candidates/);
  assert.deepEqual(localICECandidateStatistics(sdp), { total: 3, allowed: 1 });
});

test("ambiguous candidate syntax and address encodings fail closed", () => {
  for (const candidate of [
    "not-a-candidate 1 udp 1 192.168.1.20 5000 typ host",
    "candidate: 1 udp 1 192.168.1.20 5000 typ host",
    "candidate:1 1 udp 1 192.168.1.20 5000 typ host\r\na=candidate:2 1 udp 1 8.8.8.8 5001 typ host",
    "candidate:1 1 udp 1 0xC0.0xA8.1.1 5000 typ host",
    "candidate:1 1 udp 1 192.168.1 5000 typ host",
    "candidate:1 1 udp 1 0192.168.1.1 5000 typ host",
    "candidate:1\u00a01 udp 1 192.168.1.20 5000 typ host",
    "candidate:1 1 udp +1 192.168.1.20 +5000 typ host",
    "candidate:1 1 udp 1 192.168.1.20 5000 typ host\u2028a=candidate:2 1 udp 1 8.8.8.8 5001 typ host",
    "candidate:1 1 udp 1 .local 5000 typ host",
    "candidate:1 1 udp 1 nested.peer.local 5000 typ host",
    "candidate:1 1 udp 1 -peer.local 5000 typ host",
    "candidate:1 1 udp 1 ::ffff:192.168.1.1 5000 typ host",
  ]) assert.equal(allowsLocalICECandidate(candidate), false, candidate);

  const malformedPrefix = "v=0\r\na = CANDIDATE :1 1 udp 1 192.168.1.20 5000 typ host\r\n";
  assert.doesNotMatch(filterLocalICECandidates(malformedPrefix), /192\.168\.1\.20/);
  assert.deepEqual(localICECandidateStatistics(malformedPrefix), { total: 1, allowed: 0 });
  assert.equal(filterLocalICECandidates("v=0\u2028a=candidate:1 1 udp 1 192.168.1.20 5000 typ host"), "");
});
