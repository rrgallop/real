(() => {
  "use strict";

  const page = document.getElementById("wrapper-page");
  if (!(page instanceof HTMLElement)) {
    return;
  }

  const eventUrl = page.dataset.eventUrl;
  const dwellThresholdMs = Number(page.dataset.dwellThresholdMs);
  if (
    typeof eventUrl !== "string" ||
    !/^\/w\/[A-Za-z0-9_-]{22,128}\/events$/.test(eventUrl) ||
    !Number.isInteger(dwellThresholdMs) ||
    dwellThresholdMs < 5000 ||
    dwellThresholdMs > 3_600_000
  ) {
    return;
  }

  function clientEventId() {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }

    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
  }

  function emit(payload, preferBeacon = false) {
    const body = JSON.stringify(payload);
    if (
      preferBeacon &&
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon(
        eventUrl,
        new Blob([body], { type: "application/json" }),
      )
    ) {
      return;
    }

    void fetch(eventUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      credentials: "omit",
      keepalive: true,
      mode: "same-origin",
      referrerPolicy: "no-referrer",
    }).catch(() => undefined);
  }

  emit({
    event_type: "wrapper_viewed",
    client_event_id: clientEventId(),
  });

  let accumulatedVisibleMs = 0;
  let visibleStartedAt =
    document.visibilityState === "visible" ? performance.now() : null;
  let dwellSent = false;
  let dwellTimer = null;

  function visibleMilliseconds() {
    if (visibleStartedAt === null) {
      return accumulatedVisibleMs;
    }
    return accumulatedVisibleMs + (performance.now() - visibleStartedAt);
  }

  function clearDwellTimer() {
    if (dwellTimer !== null) {
      clearTimeout(dwellTimer);
      dwellTimer = null;
    }
  }

  function maybeEmitDwell(preferBeacon = false) {
    if (dwellSent) {
      return;
    }
    const elapsed = visibleMilliseconds();
    if (elapsed < dwellThresholdMs) {
      return;
    }
    dwellSent = true;
    clearDwellTimer();
    emit(
      {
        event_type: "wrapper_engaged",
        client_event_id: clientEventId(),
        engagement_kind: "dwell",
        dwell_ms: Math.min(
          3_600_000,
          Math.max(dwellThresholdMs, Math.round(elapsed)),
        ),
      },
      preferBeacon,
    );
  }

  function scheduleDwellCheck() {
    clearDwellTimer();
    if (dwellSent || visibleStartedAt === null) {
      return;
    }
    const remaining = Math.max(
      0,
      dwellThresholdMs - visibleMilliseconds(),
    );
    dwellTimer = setTimeout(() => {
      dwellTimer = null;
      maybeEmitDwell();
      scheduleDwellCheck();
    }, Math.ceil(remaining));
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (visibleStartedAt === null) {
        visibleStartedAt = performance.now();
      }
      scheduleDwellCheck();
      return;
    }

    if (visibleStartedAt !== null) {
      accumulatedVisibleMs += performance.now() - visibleStartedAt;
      visibleStartedAt = null;
    }
    clearDwellTimer();
    maybeEmitDwell(true);
  });

  window.addEventListener("pagehide", () => {
    if (visibleStartedAt !== null) {
      accumulatedVisibleMs += performance.now() - visibleStartedAt;
      visibleStartedAt = null;
    }
    clearDwellTimer();
    maybeEmitDwell(true);
  });

  let ctaSent = false;
  const cta = document.querySelector("[data-wrapper-cta]");
  if (cta instanceof HTMLAnchorElement) {
    cta.addEventListener("click", () => {
      if (ctaSent) {
        return;
      }
      ctaSent = true;
      emit(
        {
          event_type: "wrapper_engaged",
          client_event_id: clientEventId(),
          engagement_kind: "cta",
        },
        true,
      );
    });
  }

  scheduleDwellCheck();
})();
