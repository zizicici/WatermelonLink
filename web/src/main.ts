import QRCode from "qrcode";
import "./brand.css";
import "./link.css";
import { authenticationMAC, randomSecret, sha256, SignalCipher, timingSafeEqual, toBase64URL } from "./crypto";
import { htmlLanguage, localePath, resolveLocale, translator, type Locale, type MessageKey } from "./i18n";
import { allowsLocalICECandidate, filterLocalICECandidates } from "./local-network";
import { installFileSystemNode } from "./file-system-node";

type PublicConfig = {
  protocolVersion: number;
  publicOrigin: string;
  turnstileEnabled: boolean;
  turnstileSiteKey: string | null;
};

type TicketResponse = {
  ticket: string;
  sessionID: string;
  expiresAt: string;
  expiresInSeconds: number;
};

type ServerMessage =
  | { kind: "control"; event: "waiting" | "peer_joined" | "peer_left" | "signaling_complete" }
  | { kind: "relay"; payload: string }
  | { kind: "error"; code: string };

type SignalMessage =
  | { type: "offer"; description: RTCSessionDescriptionInit }
  | { type: "answer"; description: RTCSessionDescriptionInit }
  | { type: "ice"; candidate: RTCIceCandidateInit };

type ConnectionState = "idle" | "preparing" | "waiting" | "negotiating" | "connected" | "error";

const locale = resolveLocale();
let t = translator(locale);
let directoryHandle: FileSystemDirectoryHandle | null = null;
let state: ConnectionState = "idle";
let socket: WebSocket | null = null;
let peerConnection: RTCPeerConnection | null = null;
let dataChannel: RTCDataChannel | null = null;
let pairingSecret: Uint8Array | null = null;
let signalCipher: SignalCipher | null = null;
let activeTicket: TicketResponse | null = null;
let expiryTimer: number | null = null;
let expiryTransitionTimer: number | null = null;
let authenticationTimer: number | null = null;
let connectionAttempt = 0;
let requestController: AbortController | null = null;
let turnstileScriptPromise: Promise<void> | null = null;
let signalingQueue: Promise<void> = Promise.resolve();
let outboundSignalQueue: Promise<void> = Promise.resolve();
let pendingLocalCandidates: RTCIceCandidateInit[] = [];
let pendingRemoteCandidates: RTCIceCandidateInit[] = [];
let localDescriptionSent = false;
let disposeFileSystemNode: (() => void) | null = null;

const app = document.querySelector<HTMLDivElement>("#app")!;

function escapeHTML(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

function render(): void {
  if (location.pathname.endsWith("/pair")) {
    renderHandoff();
    return;
  }

  document.documentElement.lang = htmlLanguage(locale);
  document.body.dataset.lang = locale;
  updateMetadata();
  app.innerHTML = `
    ${iconSprite()}
    ${siteHeader()}
    <main id="top" class="link-main">
      <section class="link-hero" aria-labelledby="connect-title">
        <div class="container link-layout">
          <section class="link-panel" aria-labelledby="connect-title">
            <div class="link-panel-heading">
              <h1 id="connect-title">${escapeHTML(t("panelTitle"))}</h1>
            </div>
            <div id="connection-content">${connectionContent()}</div>
            <p class="link-panel-footer">${escapeHTML(t("connectDetail"))}</p>
          </section>
        </div>
      </section>
    </main>
    ${siteFooter()}
  `;
  bindUI();
  updateHeader();
}

function iconSprite(): string {
  return `
    <svg class="icon-sprite" aria-hidden="true" focusable="false">
      <symbol id="icon-language" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><path d="M2 12h20"></path><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z"></path></symbol>
      <symbol id="icon-menu" viewBox="0 0 24 24"><path d="M4 7h16"></path><path d="M4 12h16"></path><path d="M4 17h16"></path></symbol>
      <symbol id="icon-folder" viewBox="0 0 24 24"><path d="M3 6.5h6l2 2h10v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.5z"></path><path d="M3 9h18"></path></symbol>
      <symbol id="icon-link" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 4.93"></path><path d="M14 11a5 5 0 0 0-7.07 0l-2.12 2.12a5 5 0 0 0 7.07 7.07L13 19.07"></path></symbol>
      <symbol id="icon-check" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"></path></symbol>
      <symbol id="icon-edit" viewBox="0 0 24 24"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></symbol>
    </svg>
  `;
}

function siteHeader(): string {
  return `
    <header class="site-header" data-header>
      <a class="site-brand" href="${mainSiteURL("/")}" aria-label="${escapeHTML(t("homepage"))}">
        <img src="/assets/app-icon.png?v=2" alt="" width="36" height="36" decoding="async">
        <span>${escapeHTML(t("brand"))}</span>
      </a>
      <div class="header-actions">
        <label class="language-switch">
          <svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#icon-language"></use></svg>
          <select id="locale-select" data-lang-select aria-label="${escapeHTML(t("language"))}">
            <option value="en" ${locale === "en" ? "selected" : ""}>English</option>
            <option value="zh-Hans" ${locale === "zh-Hans" ? "selected" : ""}>简体中文</option>
            <option value="zh-Hant" ${locale === "zh-Hant" ? "selected" : ""}>繁體中文</option>
            <option value="ja" ${locale === "ja" ? "selected" : ""}>日本語</option>
            <option value="ko" ${locale === "ko" ? "selected" : ""}>한국어</option>
            <option value="de" ${locale === "de" ? "selected" : ""}>Deutsch</option>
            <option value="fr" ${locale === "fr" ? "selected" : ""}>Français</option>
            <option value="es" ${locale === "es" ? "selected" : ""}>Español</option>
            <option value="es-419" ${locale === "es-419" ? "selected" : ""}>Español LATAM</option>
            <option value="pt-BR" ${locale === "pt-BR" ? "selected" : ""}>Português BR</option>
            <option value="pt-PT" ${locale === "pt-PT" ? "selected" : ""}>Português PT</option>
            <option value="ru" ${locale === "ru" ? "selected" : ""}>Русский</option>
            <option value="uk" ${locale === "uk" ? "selected" : ""}>Українська</option>
          </select>
        </label>
        <button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="site-nav">
          <svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#icon-menu"></use></svg>
          <span class="sr-only">${escapeHTML(t("navOpen"))}</span>
        </button>
      </div>
      <nav class="site-nav" id="site-nav" data-nav>
        <a href="${mainSiteURL("/#privacy")}">${escapeHTML(t("navPrivacy"))}</a>
        <a href="${mainSiteURL("/#pricing")}">${escapeHTML(t("navPricing"))}</a>
        <a href="${mainSiteURL("/#faq")}">${escapeHTML(t("navFAQ"))}</a>
        <a href="${mainSiteURL("/#specs")}">${escapeHTML(t("navSpecs"))}</a>
        <a class="nav-icon-link" href="${mainSiteURL("/support.html")}" aria-label="${escapeHTML(t("navContact"))}">
          <svg class="nav-svg-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4.4 5.2h15.2c1.05 0 1.9.85 1.9 1.9v9.8c0 1.05-.85 1.9-1.9 1.9H4.4c-1.05 0-1.9-.85-1.9-1.9V7.1c0-1.05.85-1.9 1.9-1.9zm.28 2.05 6.2 5.07c.66.54 1.58.54 2.24 0l6.2-5.07H4.68zm14.82 9.6V8.82l-5.44 4.45a3.24 3.24 0 0 1-4.12 0L4.5 8.82v8.03h15z"></path></svg>
          <span class="sr-only">${escapeHTML(t("navContact"))}</span>
        </a>
        <a class="nav-icon-link" href="https://github.com/zizicici/Watermelon" target="_blank" rel="noreferrer" aria-label="GitHub">
          <svg class="nav-svg-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2C6.48 2 2 6.58 2 12.24c0 4.52 2.87 8.35 6.84 9.71.5.1.68-.22.68-.49 0-.24-.01-1.04-.01-1.89-2.78.62-3.37-1.21-3.37-1.21-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.93.86.09-.66.35-1.12.64-1.38-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.34 9.34 0 0 1 12 6.98c.85 0 1.7.12 2.5.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.57 5.05.36.32.68.94.68 1.9 0 1.38-.01 2.49-.01 2.83 0 .27.18.59.69.49A10.07 10.07 0 0 0 22 12.24C22 6.58 17.52 2 12 2z"></path></svg>
          <span class="sr-only">GitHub</span>
        </a>
      </nav>
    </header>
  `;
}

function siteFooter(): string {
  return `
    <footer class="site-footer">
      <div class="container footer-layout">
        <p class="footer-copyright">Copyright &copy; ZIZICICI LIMITED</p>
        <nav aria-label="${escapeHTML(t("footerNav"))}">
          <a href="${appStoreURL()}" target="_blank" rel="noreferrer">App Store</a>
          <a href="https://github.com/zizicici/Watermelon" target="_blank" rel="noreferrer">GitHub</a>
          <a href="${mainSiteURL("/privacy.html")}">${escapeHTML(t("privacyPolicy"))}</a>
          <a href="${mainSiteURL("/support.html")}">${escapeHTML(t("navContact"))}</a>
        </nav>
      </div>
    </footer>
  `;
}

function connectionContent(): string {
  if (state === "waiting" && activeTicket) {
    return `
      <div class="pairing-view" aria-live="polite">
        <div class="qr-frame"><canvas id="pairing-qr" aria-label="Pairing QR code"></canvas></div>
        <div class="pairing-copy">
          <h3>${escapeHTML(t("waitingTitle"))}</h3>
          <p>${escapeHTML(t("waitingDetail"))}</p>
          <p class="expiry"><span class="pulse-dot"></span>${escapeHTML(t("expires"))} <strong id="expiry-value">03:00</strong></p>
          <button id="cancel-button" class="button button-tonal" type="button">${escapeHTML(t("cancel"))}</button>
        </div>
      </div>
      <div id="turnstile-slot" class="turnstile-slot"></div>
    `;
  }

  if (state === "preparing" || state === "negotiating" || state === "connected") {
    const titleKey: MessageKey = state === "connected" ? "connectedTitle" : state === "negotiating" ? "connectingTitle" : "preparing";
    return `
      <div class="connection-state ${state}" aria-live="polite">
        <div class="state-orbit" aria-hidden="true"><span></span></div>
        <h3>${escapeHTML(t(titleKey))}</h3>
        ${state === "connected" ? `<p>${escapeHTML(t("connectedDetail"))}</p>` : ""}
        ${state !== "connected" ? `<button id="cancel-button" class="button button-tonal" type="button">${escapeHTML(t("cancel"))}</button>` : ""}
        <div id="turnstile-slot" class="turnstile-slot"></div>
      </div>
    `;
  }

  return `
    <ol class="steps">
      <li class="step ${directoryHandle ? "complete" : "active"}">
        <span class="step-number">01</span>
        <div class="step-copy">
          <h3>${escapeHTML(t("chooseTitle"))}</h3>
        </div>
        ${directoryHandle ? `
          <div class="folder-actions">
            <div class="button button-tonal folder-selected" role="status" title="${escapeHTML(directoryHandle.name)}">
              <svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>
              <span class="folder-name">${escapeHTML(directoryHandle.name)}</span>
            </div>
            <button id="choose-folder" class="copy-icon-button folder-edit" type="button" aria-label="${escapeHTML(t("change"))}">
              <svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#icon-edit"></use></svg>
            </button>
          </div>
        ` : `
          <button id="choose-folder" class="button button-primary" type="button">
            <svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#icon-folder"></use></svg>${escapeHTML(t("choose"))}
          </button>
        `}
      </li>
      <li class="step ${directoryHandle ? "active" : "disabled"}">
        <span class="step-number">02</span>
        <div class="step-copy">
          <h3>${escapeHTML(t("connectTitle"))}</h3>
        </div>
        <button id="create-link" class="button button-primary" type="button" ${directoryHandle ? "" : "disabled"}>
          <svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#icon-link"></use></svg>${escapeHTML(t("connect"))}
        </button>
      </li>
    </ol>
    <p id="inline-error" class="inline-error" role="alert"></p>
    <div id="turnstile-slot" class="turnstile-slot"></div>
  `;
}

function bindUI(): void {
  const nav = document.querySelector<HTMLElement>("[data-nav]");
  const navToggle = document.querySelector<HTMLButtonElement>("[data-nav-toggle]");
  navToggle?.addEventListener("click", () => {
    const open = nav?.classList.toggle("is-open") ?? false;
    navToggle.setAttribute("aria-expanded", String(open));
  });
  nav?.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement || (event.target instanceof Element && event.target.closest("a"))) closeNavigation();
  });
  const localeSelect = document.querySelector<HTMLSelectElement>("#locale-select");
  if (localeSelect) updateLanguageSelectWidth(localeSelect);
  localeSelect?.addEventListener("change", (event) => {
    const value = (event.target as HTMLSelectElement).value as Locale;
    localStorage.setItem("watermelon-link-locale", value);
    location.href = localePath(value);
  });
  document.querySelector<HTMLButtonElement>("#choose-folder")?.addEventListener("click", chooseFolder);
  document.querySelector<HTMLButtonElement>("#create-link")?.addEventListener("click", createLink);
  document.querySelector<HTMLButtonElement>("#cancel-button")?.addEventListener("click", cancelConnection);
  if (state === "waiting") void drawQRCode();
}

async function chooseFolder(): Promise<void> {
  if (state !== "idle" && state !== "error") return;
  const error = document.querySelector<HTMLParagraphElement>("#inline-error");
  if (!window.isSecureContext) {
    if (error) error.textContent = t("secureContextRequired");
    return;
  }
  if (!window.showDirectoryPicker) {
    if (error) error.textContent = t("browserUnsupported");
    return;
  }
  try {
    directoryHandle = await window.showDirectoryPicker({ id: "watermelon-link-backup", mode: "readwrite" });
    render();
  } catch (caught) {
    if ((caught as DOMException).name !== "AbortError" && error) error.textContent = t("folderCancelled");
  }
}

async function createLink(): Promise<void> {
  if (!directoryHandle || (state !== "idle" && state !== "error")) return;
  const attempt = ++connectionAttempt;
  const controller = new AbortController();
  requestController?.abort();
  requestController = controller;
  resetSignalingState();
  state = "preparing";
  render();
  try {
    const config = await fetchJSON<PublicConfig>("/api/v1/config", { signal: controller.signal });
    assertCurrentAttempt(attempt, controller.signal);
    const turnstileToken = config.turnstileEnabled ? await requestTurnstileToken(config.turnstileSiteKey, controller.signal) : "development-bypass";
    assertCurrentAttempt(attempt, controller.signal);
    const secret = randomSecret();
    const capabilityHash = await sha256(secret);
    assertCurrentAttempt(attempt, controller.signal);
    const ticket = await fetchJSON<TicketResponse>("/api/v1/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnstileToken, capabilityHash }),
      signal: controller.signal
    });
    assertCurrentAttempt(attempt, controller.signal);
    const cipher = await SignalCipher.create(secret, ticket.sessionID);
    assertCurrentAttempt(attempt, controller.signal);
    pairingSecret = secret;
    activeTicket = ticket;
    signalCipher = cipher;
    if (requestController === controller) requestController = null;
    state = "waiting";
    render();
    startExpiryCountdown(ticket.expiresInSeconds, attempt);
    openSignalingSocket(ticket.ticket, attempt);
  } catch (error) {
    if (!isAbortError(error) && connectionAttempt === attempt) failConnection(attempt, error, t("connectionFailed"));
  } finally {
    if (requestController === controller) requestController = null;
  }
}

async function requestTurnstileToken(siteKey: string | null, signal: AbortSignal): Promise<string> {
  if (!siteKey) throw new Error("Turnstile is enabled without a site key");
  await abortable(loadTurnstileScript(), signal);
  if (signal.aborted) throw abortError();
  const slot = document.querySelector<HTMLElement>("#turnstile-slot");
  if (!slot || !window.turnstile) throw new Error("Turnstile did not load");
  const turnstile = window.turnstile;
  slot.classList.add("visible");
  return new Promise((resolve, reject) => {
    let widgetID: string | null = null;
    let settled = false;
    const finish = (value: string | Error, success: boolean) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (widgetID) {
        try { turnstile.remove(widgetID); } catch {}
      }
      if (success) resolve(value as string);
      else reject(value);
    };
    const onAbort = () => finish(abortError(), false);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      widgetID = turnstile.render(slot, {
        sitekey: siteKey,
        action: "create_link",
        theme: "auto",
        callback: (token) => finish(token, true),
        "error-callback": () => finish(new Error("Turnstile verification failed"), false),
        "expired-callback": () => finish(new Error("Turnstile verification expired"), false)
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error("Turnstile failed to render"), false);
    }
  });
}

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (turnstileScriptPromise) return turnstileScriptPromise;
  document.querySelector<HTMLScriptElement>('script[data-turnstile="true"]')?.remove();
  const script = document.createElement("script");
  const pending = new Promise<void>((resolve, reject) => {
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.turnstile = "true";
    const timeout = window.setTimeout(() => reject(new Error("Turnstile load timed out")), 10_000);
    script.addEventListener("load", () => {
      window.clearTimeout(timeout);
      if (window.turnstile) resolve();
      else reject(new Error("Turnstile did not initialize"));
    }, { once: true });
    script.addEventListener("error", () => {
      window.clearTimeout(timeout);
      reject(new Error("Turnstile failed to load"));
    }, { once: true });
    document.head.append(script);
  });
  turnstileScriptPromise = pending.catch((error) => {
    turnstileScriptPromise = null;
    script.remove();
    throw error;
  });
  return turnstileScriptPromise;
}

function openSignalingSocket(ticket: string, attempt: number): void {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const url = new URL(`${scheme}://${location.host}/ws/v1`);
  url.searchParams.set("ticket", ticket);
  url.searchParams.set("role", "browser");
  const currentSocket = new WebSocket(url);
  socket = currentSocket;
  currentSocket.addEventListener("message", (event) => {
    signalingQueue = signalingQueue
      .then(() => handleServerMessage(String(event.data), attempt))
      .catch((error) => failConnection(attempt, error, t("connectionFailed")));
  });
  currentSocket.addEventListener("close", (event) => {
    if (socket !== currentSocket || connectionAttempt !== attempt || state === "connected" || state === "idle" || state === "error") return;
    failConnection(attempt, undefined, event.code === 4408 ? t("pairingExpired") : t("connectionFailed"));
  });
}

async function handleServerMessage(raw: string, attempt: number): Promise<void> {
  assertCurrentAttempt(attempt);
  const message = JSON.parse(raw) as ServerMessage;
  if (message.kind === "error") throw new Error(message.code);
  if (message.kind === "control") {
    if (message.event === "peer_joined") await beginPeerConnection(attempt);
    if (message.event === "peer_left" && state !== "connected") cancelConnection();
    return;
  }
  if (message.kind === "relay" && signalCipher) {
    const signal = await signalCipher.decrypt<SignalMessage>(message.payload);
    assertCurrentAttempt(attempt);
    const connection = peerConnection;
    if (!connection) throw new Error("Peer connection is unavailable");
    if (signal.type === "answer") {
      await connection.setRemoteDescription({
        ...signal.description,
        sdp: signal.description.sdp ? filterLocalICECandidates(signal.description.sdp) : signal.description.sdp
      });
      for (const candidate of pendingRemoteCandidates.splice(0)) await connection.addIceCandidate(candidate);
      return;
    }
    if (signal.type === "ice" && signal.candidate) {
      if (!signal.candidate.candidate || !allowsLocalICECandidate(signal.candidate.candidate)) return;
      if (connection.remoteDescription) await connection.addIceCandidate(signal.candidate);
      else pendingRemoteCandidates.push(signal.candidate);
      return;
    }
    throw new Error("Unexpected signaling message");
  }
}

async function beginPeerConnection(attempt: number): Promise<void> {
  if (!signalCipher || peerConnection) return;
  state = "negotiating";
  render();
  const connection = new RTCPeerConnection({ iceServers: [] });
  peerConnection = connection;
  connection.addEventListener("icecandidate", (event) => {
    if (!event.candidate || peerConnection !== connection || connectionAttempt !== attempt) return;
    const candidate = event.candidate.toJSON();
    if (!candidate.candidate || !allowsLocalICECandidate(candidate.candidate)) return;
    if (!localDescriptionSent) pendingLocalCandidates.push(candidate);
    else void queueEncryptedSignal({ type: "ice", candidate }, attempt).catch((error) => failConnection(attempt, error, t("connectionFailed")));
  });
  connection.addEventListener("connectionstatechange", () => {
    if (peerConnection !== connection || connectionAttempt !== attempt) return;
    if (connection.connectionState === "failed") failConnection(attempt, new Error("WebRTC connection failed"), t("connectionFailed"));
    else if (connection.connectionState === "disconnected") showInlineError(t("connectionFailed"));
  });
  const channel = connection.createDataChannel("watermelon-link-v1", { ordered: true });
  dataChannel = channel;
  channel.binaryType = "arraybuffer";
  channel.addEventListener("open", () => {
    void authenticateDataChannel(channel, attempt).catch((error) => failConnection(attempt, error, t("connectionFailed")));
  });
  const offer = await connection.createOffer();
  assertCurrentAttempt(attempt);
  await connection.setLocalDescription(offer);
  assertCurrentAttempt(attempt);
  const localDescription = connection.localDescription ?? offer;
  await queueEncryptedSignal({
    type: "offer",
    description: {
      type: localDescription.type,
      sdp: localDescription.sdp ? filterLocalICECandidates(localDescription.sdp) : localDescription.sdp
    }
  }, attempt);
  localDescriptionSent = true;
  for (const candidate of pendingLocalCandidates.splice(0)) {
    void queueEncryptedSignal({ type: "ice", candidate }, attempt).catch((error) => failConnection(attempt, error, t("connectionFailed")));
  }
}

function queueEncryptedSignal(message: SignalMessage, attempt: number): Promise<void> {
  const task = outboundSignalQueue.then(async () => {
    assertCurrentAttempt(attempt);
    const cipher = signalCipher;
    const currentSocket = socket;
    if (!cipher || !currentSocket || currentSocket.readyState !== WebSocket.OPEN) throw new Error("Signaling socket is unavailable");
    const payload = await cipher.encrypt(message);
    assertCurrentAttempt(attempt);
    if (socket !== currentSocket || currentSocket.readyState !== WebSocket.OPEN) throw new Error("Signaling socket changed");
    currentSocket.send(JSON.stringify({ kind: "relay", payload }));
  });
  outboundSignalQueue = task.catch(() => {});
  return task;
}

async function authenticateDataChannel(channel: RTCDataChannel, attempt: number): Promise<void> {
  const secret = pairingSecret;
  if (dataChannel !== channel || !secret) return;
  const nonce = toBase64URL(crypto.getRandomValues(new Uint8Array(24)));
  const expectedMAC = await authenticationMAC(secret, nonce);
  assertCurrentAttempt(attempt);
  authenticationTimer = window.setTimeout(() => failConnection(attempt, new Error("Data channel authentication timed out"), t("connectionFailed")), 10_000);
  const onMessage = (event: MessageEvent) => {
    try {
      const message = JSON.parse(String(event.data)) as { type?: string; mac?: string };
      if (message.type !== "auth_response" || !message.mac || !timingSafeEqual(message.mac, expectedMAC)) return;
      assertCurrentAttempt(attempt);
      if (authenticationTimer !== null) window.clearTimeout(authenticationTimer);
      authenticationTimer = null;
      channel.removeEventListener("message", onMessage);
      if (!directoryHandle) throw new Error("Folder access is unavailable");
      disposeFileSystemNode?.();
      disposeFileSystemNode = installFileSystemNode(channel, directoryHandle);
      channel.send(JSON.stringify({ type: "auth_ok", protocolVersion: 2, folderName: directoryHandle.name }));
      clearExpiryTimers();
      state = "connected";
      render();
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ kind: "complete" }));
    } catch (error) {
      failConnection(attempt, error, t("connectionFailed"));
    }
  };
  channel.addEventListener("message", onMessage);
  channel.send(JSON.stringify({ type: "auth_challenge", nonce }));
}

async function drawQRCode(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#pairing-qr");
  if (!canvas || !activeTicket || !pairingSecret) return;
  const pairURL = new URL("/pair", location.origin);
  pairURL.hash = new URLSearchParams({ t: activeTicket.ticket, s: toBase64URL(pairingSecret) }).toString();
  await QRCode.toCanvas(canvas, pairURL.toString(), {
    width: 256,
    margin: 2,
    errorCorrectionLevel: "M",
    color: { dark: "#102018", light: "#ffffff" }
  });
}

function startExpiryCountdown(expiresInSeconds: number, attempt: number): void {
  clearExpiryTimers();
  const expiry = performance.now() + Math.max(0, expiresInSeconds) * 1_000;
  const update = () => {
    const remaining = Math.max(0, Math.ceil((expiry - performance.now()) / 1_000));
    const minutes = Math.floor(remaining / 60).toString().padStart(2, "0");
    const seconds = (remaining % 60).toString().padStart(2, "0");
    const target = document.querySelector<HTMLElement>("#expiry-value");
    if (target) target.textContent = `${minutes}:${seconds}`;
    if (remaining === 0 && expiryTransitionTimer === null) {
      if (expiryTimer !== null) window.clearInterval(expiryTimer);
      expiryTimer = null;
      expiryTransitionTimer = window.setTimeout(() => {
        expiryTransitionTimer = null;
        if (!activeTicket || connectionAttempt !== attempt || state === "connected" || state === "idle") return;
        failConnection(attempt, undefined, t("pairingExpired"));
      }, 650);
    }
  };
  expiryTimer = window.setInterval(update, 1000);
  update();
}

function clearExpiryTimers(): void {
  if (expiryTimer !== null) window.clearInterval(expiryTimer);
  if (expiryTransitionTimer !== null) window.clearTimeout(expiryTransitionTimer);
  expiryTimer = null;
  expiryTransitionTimer = null;
}

function cancelConnection(): void {
  connectionAttempt += 1;
  disposeConnection(true);
  state = "idle";
  render();
}

function failConnection(attempt: number, error: unknown, message: string): void {
  if (connectionAttempt !== attempt || state === "idle" || state === "error") return;
  if (error && !isAbortError(error)) console.error(error);
  connectionAttempt += 1;
  disposeConnection(true);
  state = "error";
  render();
  showInlineError(message);
}

function disposeConnection(sendCancel: boolean): void {
  clearExpiryTimers();
  if (authenticationTimer !== null) window.clearTimeout(authenticationTimer);
  authenticationTimer = null;
  requestController?.abort();
  requestController = null;
  if (sendCancel && socket?.readyState === WebSocket.OPEN) {
    try { socket.send(JSON.stringify({ kind: "cancel" })); } catch {}
  }
  socket?.close();
  dataChannel?.close();
  disposeFileSystemNode?.();
  disposeFileSystemNode = null;
  peerConnection?.close();
  socket = null;
  peerConnection = null;
  dataChannel = null;
  pairingSecret = null;
  signalCipher = null;
  activeTicket = null;
  resetSignalingState();
}

function resetSignalingState(): void {
  signalingQueue = Promise.resolve();
  outboundSignalQueue = Promise.resolve();
  pendingLocalCandidates = [];
  pendingRemoteCandidates = [];
  localDescriptionSent = false;
}

function assertCurrentAttempt(attempt: number, signal?: AbortSignal): void {
  if (connectionAttempt !== attempt || signal?.aborted) throw abortError();
}

function abortError(): DOMException {
  return new DOMException("Connection attempt was cancelled", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

function showInlineError(message: string): void {
  const target = document.querySelector<HTMLElement>("#inline-error") ?? document.querySelector<HTMLElement>("#connection-content");
  if (target) {
    if (target.id === "inline-error") target.textContent = message;
    else target.insertAdjacentHTML("beforeend", `<p class="inline-error" role="alert">${escapeHTML(message)}</p>`);
  }
}

async function fetchJSON<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) throw new Error(`Request failed with ${response.status}`);
  return response.json() as Promise<T>;
}

function renderHandoff(): void {
  document.documentElement.lang = htmlLanguage(locale);
  document.body.dataset.lang = locale;
  updateMetadata();
  app.innerHTML = `
    ${iconSprite()}
    ${siteHeader()}
    <main class="handoff-shell">
      <div class="handoff-card">
        <img class="handoff-icon" src="/assets/app-icon.png?v=2" alt="" width="72" height="72">
        <p class="eyebrow">WATERMELON LINK</p>
        <h1>${escapeHTML(t("handoffTitle"))}</h1>
        <p>${escapeHTML(t("handoffDetail"))}</p>
        <a class="button button-primary" href="${appStoreURL()}">${escapeHTML(t("appStore"))}</a>
      </div>
    </main>
    ${siteFooter()}
  `;
  bindUI();
  updateHeader();
}

function updateHeader(): void {
  document.querySelector<HTMLElement>("[data-header]")?.classList.toggle("is-scrolled", window.scrollY > 8);
}

function closeNavigation(): void {
  document.querySelector<HTMLElement>("[data-nav]")?.classList.remove("is-open");
  document.querySelector<HTMLButtonElement>("[data-nav-toggle]")?.setAttribute("aria-expanded", "false");
}

function updateLanguageSelectWidth(select: HTMLSelectElement): void {
  const optionText = select.selectedOptions[0]?.textContent?.trim() ?? "";
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const styles = getComputedStyle(select);
  if (context) context.font = `${styles.fontStyle} ${styles.fontVariant} ${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
  const textWidth = Math.ceil(context?.measureText(optionText).width ?? optionText.length * 8);
  select.style.setProperty("--language-select-width", `${textWidth + 42}px`);
}

function mainSiteURL(path: string): string {
  const prefix = locale === "en" ? "" : `/${locale}`;
  return `https://watermelonbackup.com${prefix}${path}`;
}

function appStoreURL(): string {
  return locale === "zh-Hans" ? "https://apps.apple.com/cn/app/id6762260596" : "https://apps.apple.com/app/id6762260596";
}

function updateMetadata(): void {
  document.title = `Watermelon Link — ${t("panelTitle")}`;
  document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute("content", t("intro"));
  document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.setAttribute("content", t("intro"));
  document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.setAttribute("href", `https://link.watermelonbackup.com${localePath(locale)}`);
  const smartBanner = document.querySelector<HTMLMetaElement>('meta[name="apple-itunes-app"]');
  const appArgument = location.pathname.endsWith("/pair") ? `, app-argument=${location.href}` : "";
  smartBanner?.setAttribute("content", `app-id=6762260596${appArgument}`);
}

window.addEventListener("scroll", updateHeader, { passive: true });
document.addEventListener("click", (event) => {
  const nav = document.querySelector<HTMLElement>("[data-nav]");
  const toggle = document.querySelector<HTMLElement>("[data-nav-toggle]");
  if (!(event.target instanceof Node) || !nav?.classList.contains("is-open")) return;
  if (!nav.contains(event.target) && !toggle?.contains(event.target)) closeNavigation();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeNavigation();
});
render();
