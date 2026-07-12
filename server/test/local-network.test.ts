import assert from "node:assert/strict";
import test from "node:test";
import { allowsLocalICECandidate, filterLocalICECandidates } from "../../web/src/local-network.js";

test("only local host ICE candidates are allowed", () => {
  assert.equal(allowsLocalICECandidate("candidate:1 1 udp 1 192.168.1.20 5000 typ host"), true);
  assert.equal(allowsLocalICECandidate("candidate:1 1 udp 1 10.0.0.2 5000 typ host"), true);
  assert.equal(allowsLocalICECandidate("candidate:1 1 udp 1 fd12::1 5000 typ host"), true);
  assert.equal(allowsLocalICECandidate("candidate:1 1 udp 1 peer-id.local 5000 typ host"), true);
  assert.equal(allowsLocalICECandidate("candidate:1 1 udp 1 8.8.8.8 5000 typ host"), false);
  assert.equal(allowsLocalICECandidate("candidate:1 1 udp 1 2001:4860::1 5000 typ host"), false);
  assert.equal(allowsLocalICECandidate("candidate:1 1 udp 1 192.168.1.20 5000 typ srflx"), false);
});

test("public candidates are removed from session descriptions", () => {
  const filtered = filterLocalICECandidates([
    "v=0\r",
    "a=candidate:1 1 udp 1 192.168.1.20 5000 typ host\r",
    "a=candidate:2 1 udp 1 2001:4860::1 5001 typ host\r",
    "a=end-of-candidates\r",
    ""
  ].join("\n"));
  assert.match(filtered, /192\.168\.1\.20/);
  assert.doesNotMatch(filtered, /2001:4860/);
  assert.match(filtered, /a=end-of-candidates/);
});
