/*
 * Loaded in <head>, not deferred, so it runs before first paint:
 *   1. applies the stored theme (data-theme on <html>);
 *   2. sets `dtz` in the URL to the device's time zone (location.replace,
 *      at most once per page view), and on narrow screens with no `view`,
 *      asks for the Day view.
 * The pure functions are exposed on globalThis.TimeHead for tests.
 */
(function () {
  "use strict";

  var THEME_KEY = "time.theme";
  var GUARD_KEY = "time.head-replaced-at";
  var GUARD_MS = 5000;
  var NARROW_QUERY = "(max-width: 640px)";

  /** The stored theme, or null. Never throws, even if storage does. */
  function readTheme(storage) {
    try {
      var v = storage ? storage.getItem(THEME_KEY) : null;
      return v === "light" || v === "dark" ? v : null;
    } catch (e) {
      return null;
    }
  }

  /** Store a theme. Returns false if storage is unavailable. */
  function writeTheme(storage, value) {
    try {
      storage.setItem(THEME_KEY, value);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * The URL to replace the current one with, or null to stay.
   * - sets `dtz` to the device zone when it is missing or different;
   * - keeps every other parameter, including `tz`, and the hash;
   * - on "/" with no `view` on a narrow screen, adds view=day;
   * - never replaces twice: not again in this page view (state.replaced),
   *   and not again within a few seconds of the last replace (lastReplaceAt),
   *   so a zone the server rewrites can't cause a loop.
   */
  function headRedirect(href, deviceZone, options) {
    var o = options || {};
    var state = o.state || {};
    if (state.replaced) return null;
    if (typeof o.lastReplaceAt === "number" && typeof o.now === "number" && o.now - o.lastReplaceAt < GUARD_MS) {
      return null;
    }
    var url = new URL(href);
    var changed = false;
    if (deviceZone && url.searchParams.get("dtz") !== deviceZone) {
      url.searchParams.set("dtz", deviceZone);
      changed = true;
    }
    if (o.narrow && url.pathname === "/" && !url.searchParams.has("view")) {
      url.searchParams.set("view", "day");
      changed = true;
    }
    if (!changed) return null;
    state.replaced = true;
    // Keep zone names readable in the address bar ("Europe/Paris", not "Europe%2FParis").
    return url.toString().replace(/%2F/gi, "/");
  }

  function deviceZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch (e) {
      return null;
    }
  }

  var api = {
    THEME_KEY: THEME_KEY,
    readTheme: readTheme,
    writeTheme: writeTheme,
    headRedirect: headRedirect,
    deviceZone: deviceZone,
  };
  globalThis.TimeHead = api;

  if (typeof document === "undefined" || typeof location === "undefined") return;

  var root = document.documentElement;
  root.classList.add("js");

  var local = null;
  try {
    local = window.localStorage;
  } catch (e) {
    local = null;
  }
  var theme = readTheme(local);
  if (theme) root.setAttribute("data-theme", theme);

  var session = null;
  try {
    session = window.sessionStorage;
  } catch (e) {
    session = null;
  }
  var last = null;
  try {
    last = session ? Number(session.getItem(GUARD_KEY)) || null : null;
  } catch (e) {
    last = null;
  }
  var narrow = false;
  try {
    narrow = window.matchMedia(NARROW_QUERY).matches;
  } catch (e) {
    narrow = false;
  }
  var target = headRedirect(location.href, deviceZone(), {
    narrow: narrow,
    lastReplaceAt: last,
    now: Date.now(),
    state: api,
  });
  if (target) {
    try {
      if (session) session.setItem(GUARD_KEY, String(Date.now()));
    } catch (e) {
      /* storage unavailable: the in-page guard still applies */
    }
    location.replace(target);
  }
})();
