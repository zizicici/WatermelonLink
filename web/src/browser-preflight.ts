export type BrowserPreflightResult =
  | { kind: "ready" }
  | { kind: "unsupported"; reason: "secure-context" | "browser" }
  | { kind: "blocked"; reason: "permission" | "network" };

type PermissionQuery = (descriptor: PermissionDescriptor) => Promise<PermissionStatus>;

export async function runBrowserPreflight(): Promise<BrowserPreflightResult> {
  if (!window.isSecureContext) return { kind: "unsupported", reason: "secure-context" };
  if (!window.showDirectoryPicker || !window.RTCPeerConnection || !window.WebSocket || !window.crypto?.subtle || !navigator.locks) {
    return { kind: "unsupported", reason: "browser" };
  }

  const permissionBefore = await queryLocalNetworkPermission(navigator.permissions?.query?.bind(navigator.permissions));
  if (permissionBefore === "denied") return { kind: "blocked", reason: "permission" };

  const reachable = await probeLocalWebRTC(permissionBefore === "prompt" ? 20_000 : 8_000);
  const permissionAfter = await queryLocalNetworkPermission(navigator.permissions?.query?.bind(navigator.permissions));
  if (permissionAfter === "denied") return { kind: "blocked", reason: "permission" };
  return reachable ? { kind: "ready" } : { kind: "blocked", reason: "network" };
}

export async function queryLocalNetworkPermission(query?: PermissionQuery): Promise<PermissionState | null> {
  if (!query) return null;
  for (const name of ["local-network", "local-network-access"] as const) {
    try {
      return (await query({ name } as unknown as PermissionDescriptor)).state;
    } catch {}
  }
  return null;
}

async function probeLocalWebRTC(timeoutMilliseconds = 20_000): Promise<boolean> {
  const deadline = performance.now() + timeoutMilliseconds;
  let offerer: RTCPeerConnection | null = null;
  let answerer: RTCPeerConnection | null = null;
  let channel: RTCDataChannel | null = null;
  let openTimeout: number | null = null;

  try {
    offerer = new RTCPeerConnection({ iceServers: [] });
    answerer = new RTCPeerConnection({ iceServers: [] });
    const createdChannel = offerer.createDataChannel("watermelon-link-preflight");
    channel = createdChannel;
    const opened = new Promise<boolean>((resolve) => {
      openTimeout = window.setTimeout(() => resolve(false), timeoutMilliseconds);
      createdChannel.addEventListener("open", () => {
        if (openTimeout !== null) window.clearTimeout(openTimeout);
        openTimeout = null;
        resolve(true);
      }, { once: true });
    });

    const offer = await offerer.createOffer();
    await offerer.setLocalDescription(offer);
    await waitForICEGathering(offerer, deadline);
    if (!offerer.localDescription) return false;
    await answerer.setRemoteDescription(offerer.localDescription);

    const answer = await answerer.createAnswer();
    await answerer.setLocalDescription(answer);
    await waitForICEGathering(answerer, deadline);
    if (!answerer.localDescription) return false;
    await offerer.setRemoteDescription(answerer.localDescription);
    return await opened;
  } catch {
    return false;
  } finally {
    if (openTimeout !== null) window.clearTimeout(openTimeout);
    channel?.close();
    offerer?.close();
    answerer?.close();
  }
}

function waitForICEGathering(connection: RTCPeerConnection, deadline: number): Promise<void> {
  if (connection.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = window.setTimeout(finish, Math.max(0, deadline - performance.now()));
    function finish(): void {
      window.clearTimeout(timeout);
      connection.removeEventListener("icegatheringstatechange", handleChange);
      resolve();
    }
    function handleChange(): void {
      if (connection.iceGatheringState === "complete") finish();
    }
    connection.addEventListener("icegatheringstatechange", handleChange);
  });
}
