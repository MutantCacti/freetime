/*
 * Progressive enhancement. Without this file every view, link and form still
 * works; with it you get toasts, the current-time line moving, the starting
 * scroll position, the time-zone dropdown, the date-picker popover, the
 * dialogs, the theme switcher and the Copy button.
 * Pure functions are exposed on globalThis.TimeApp for tests.
 */
(function () {
  "use strict";

  // ============================================================== toasts (pure)

  var SEVERITY_RANK = { error: 0, warning: 1 };

  /**
   * The toast queue. Sticky toasts stay until their condition ends and can
   * only be minimised; transient ones hide after `duration` ms (paused while
   * hovered or focused). At most `max` show at once: sticky above transient,
   * errors above warnings, then oldest first. The rest wait their turn.
   */
  function createToastQueue(options) {
    var o = options || {};
    var max = o.max || 3;
    var duration = o.duration || 6000;
    var items = [];
    var seq = 0;

    function find(id) {
      for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
      return null;
    }
    function remove(id) {
      items = items.filter(function (t) {
        return t.id !== id;
      });
    }
    function order(a, b) {
      if (a.kind !== b.kind) return a.kind === "sticky" ? -1 : 1;
      if (a.severity !== b.severity) return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      return a.seq - b.seq;
    }

    var q = {
      add: function (toast) {
        if (find(toast.id)) return false;
        items.push({
          id: toast.id,
          kind: toast.kind === "sticky" ? "sticky" : "transient",
          severity: toast.severity === "error" ? "error" : "warning",
          message: toast.message || "",
          minimised: false,
          shownAt: null,
          remaining: duration,
          paused: false,
          seq: seq++,
        });
        return true;
      },
      /** The toasts on screen now, in display order. Starts timers for newly shown ones. */
      visible: function (now) {
        var list = items
          .filter(function (t) {
            return !t.minimised;
          })
          .sort(order)
          .slice(0, max);
        list.forEach(function (t) {
          if (t.kind === "transient" && t.shownAt === null) t.shownAt = now;
        });
        return list;
      },
      /** Hide transient toasts whose time is up. Returns true if any hid. */
      tick: function (now) {
        var before = items.length;
        items = items.filter(function (t) {
          return !(t.kind === "transient" && !t.paused && t.shownAt !== null && now - t.shownAt >= t.remaining);
        });
        return items.length !== before;
      },
      pause: function (id, now) {
        var t = find(id);
        if (!t || t.kind !== "transient" || t.paused || t.shownAt === null) return;
        t.remaining -= now - t.shownAt;
        t.paused = true;
      },
      resume: function (id, now) {
        var t = find(id);
        if (!t || !t.paused) return;
        t.paused = false;
        t.shownAt = now;
      },
      /** Close a transient toast. Sticky toasts can't be dismissed: returns false. */
      dismiss: function (id) {
        var t = find(id);
        if (!t || t.kind === "sticky") return false;
        remove(id);
        return true;
      },
      minimise: function (id) {
        var t = find(id);
        if (!t || t.kind !== "sticky") return false;
        t.minimised = true;
        return true;
      },
      restore: function (id) {
        var t = find(id);
        if (t) t.minimised = false;
      },
      restoreAll: function () {
        items.forEach(function (t) {
          t.minimised = false;
        });
      },
      /** The condition behind a sticky toast has ended. */
      resolve: function (id) {
        remove(id);
      },
      /** Severity for the top-bar indicator, or null when nothing is minimised. */
      indicator: function () {
        var min = items.filter(function (t) {
          return t.minimised;
        });
        if (!min.length) return null;
        return min.some(function (t) {
          return t.severity === "error";
        })
          ? "error"
          : "warning";
      },
      all: function () {
        return items.slice();
      },
    };
    return q;
  }

  // ============================================================== scroll (pure)

  /**
   * Starting scrollTop for the time window, clamped to the column.
   * With a current-time line, it sits about a third of the way down the
   * visible window; otherwise the window opens at the start-hour row.
   */
  function initialScrollTop(m) {
    var visible = m.viewport - m.header;
    var maxTop = Math.max(0, m.content - m.viewport);
    var target = m.lineY != null ? m.lineY - m.header - visible / 3 : m.anchorY - m.header;
    return Math.min(maxTop, Math.max(0, Math.round(target)));
  }

  // ============================================================== time zones (pure)

  /** "UTC+1", "UTC+5:30", "UTC-3", from Intl's "GMT+1" style. */
  function utcOffsetLabel(zone, date) {
    try {
      var parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(date);
      var name = "";
      for (var i = 0; i < parts.length; i++) if (parts[i].type === "timeZoneName") name = parts[i].value;
      var m = /^GMT([+-]\d{1,2})?(?::(\d{2}))?$/.exec(name);
      if (!m) return "";
      if (!m[1]) return "UTC+0"; // PRINTED OUTPUT: time zone dropdown / zero offset
      var h = Number(m[1]);
      return "UTC" + (h < 0 ? "-" : "+") + Math.abs(h) + (m[2] ? ":" + m[2] : ""); // PRINTED OUTPUT: time zone dropdown / offset
    } catch (e) {
      return "";
    }
  }

  function filterZones(zones, query) {
    var q = String(query || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
    if (!q) return zones.slice();
    return zones.filter(function (z) {
      return z.toLowerCase().indexOf(q) !== -1;
    });
  }

  /** The URL for choosing a zone: null removes `tz`. Everything else is kept. */
  function urlWithTz(href, tz) {
    var url = new URL(href);
    if (tz) url.searchParams.set("tz", tz);
    else url.searchParams.delete("tz");
    return url.toString();
  }

  // ============================================================== date picker (pure)

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }
  function iso(y, m, d) {
    return y + "-" + pad(m) + "-" + pad(d);
  }
  /** 6 weeks of dates for a month, Monday first. */
  function monthGrid(year, month) {
    var first = new Date(Date.UTC(year, month - 1, 1));
    var offset = (first.getUTCDay() + 6) % 7;
    var out = [];
    for (var i = 0; i < 42; i++) {
      var d = new Date(Date.UTC(year, month - 1, 1 - offset + i));
      out.push({ date: iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), day: d.getUTCDate(), inMonth: d.getUTCMonth() === month - 1 });
    }
    return out;
  }
  function addDaysIso(date, n) {
    var p = date.split("-").map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  var api = {
    createToastQueue: createToastQueue,
    initialScrollTop: initialScrollTop,
    utcOffsetLabel: utcOffsetLabel,
    filterZones: filterZones,
    urlWithTz: urlWithTz,
    monthGrid: monthGrid,
    glideStep: function (v, dt) {
      return glideStep(v, dt);
    },
  };
  globalThis.TimeApp = api;

  if (typeof document === "undefined") return;

  // ============================================================== DOM

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function announce(message, assertive) {
    var region = document.getElementById(assertive ? "live-assertive" : "live-polite");
    if (!region) return;
    region.textContent = "";
    setTimeout(function () {
      region.textContent = message;
    }, 50);
  }
  // -------------------------------------------------------------- motion helpers

  var reducedMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  /**
   * Play an exit (or any one-off) animation class, then call done. With
   * reduced motion, or if the animation never reports back, done runs anyway.
   */
  function play(el, cls, done) {
    if (reducedMotion.matches) {
      if (done) done();
      return;
    }
    var finished = false;
    function end(e) {
      if (finished || (e && e.target !== el)) return;
      finished = true;
      el.removeEventListener("animationend", end);
      el.classList.remove(cls);
      if (done) done();
    }
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation if the class was just used
    el.classList.add(cls);
    el.addEventListener("animationend", end);
    setTimeout(end, 400);
  }

  /** "dx dy" from el's centre to target's centre, for animations that shrink into or grow out of a point. */
  function vectorTo(el, target) {
    var a = el.getBoundingClientRect();
    var b = target.getBoundingClientRect();
    return b.left + b.width / 2 - (a.left + a.width / 2) + "px " + (b.top + b.height / 2 - (a.top + a.height / 2)) + "px";
  }

  /** Make a popover grow from just under the control that opened it. */
  function originAt(pop, anchor) {
    var a = anchor.getBoundingClientRect();
    var p = pop.getBoundingClientRect();
    pop.style.transformOrigin = Math.round(a.left + a.width / 2 - p.left) + "px 0";
  }

  /** A copy of an inline SVG icon from a server-rendered <template>. */
  function icon(id) {
    var t = document.getElementById(id);
    return t ? t.content.firstElementChild.cloneNode(true) : document.createTextNode("");
  }
  function storage() {
    try {
      return window.localStorage;
    } catch (e) {
      return null;
    }
  }

  // -------------------------------------------------------------- toasts

  function initToasts() {
    var layer = document.getElementById("notices");
    var indicator = document.getElementById("notice-indicator");
    var template = document.getElementById("toast-template");
    if (!layer) return null;
    var queue = createToastQueue({ max: 3, duration: 6000 });
    var nodes = {};

    // Server-rendered sticky toasts: adopt them and show their minimise button.
    $$(".toast[data-kind='sticky']", layer).forEach(function (el) {
      var id = el.getAttribute("data-id");
      queue.add({ id: id, kind: "sticky", severity: el.getAttribute("data-severity"), message: $(".toast-msg", el).textContent });
      nodes[id] = el;
      var btn = $("[data-action='minimise']", el);
      if (btn) {
        btn.hidden = false;
        btn.addEventListener("click", function () {
          queue.minimise(id);
          render();
        });
      }
    });

    function build(t) {
      var el = template.content.firstElementChild.cloneNode(true);
      el.classList.add("toast-" + t.severity);
      el.setAttribute("data-id", t.id);
      $(".toast-msg", el).textContent = t.message;
      var icon = document.getElementById("icon-" + t.severity);
      if (icon) $(".toast-icon", el).appendChild(icon.content.firstElementChild.cloneNode(true));
      $("[data-action='close']", el).addEventListener("click", function () {
        queue.dismiss(t.id);
        render();
      });
      var pause = function () {
        queue.pause(t.id, Date.now());
      };
      var resume = function () {
        queue.resume(t.id, Date.now());
      };
      el.addEventListener("mouseenter", pause);
      el.addEventListener("mouseleave", resume);
      el.addEventListener("focusin", pause);
      el.addEventListener("focusout", resume);
      return el;
    }

    // Toasts grow in at the top right and shrink away. A sticky toast that is
    // minimised shrinks into the notice indicator, and grows back out of it.
    function setIndicator() {
      if (!indicator) return;
      var sev = queue.indicator();
      var wasHidden = indicator.hidden;
      indicator.hidden = !sev;
      indicator.classList.toggle("sev-error", sev === "error");
      if (sev && wasHidden) play(indicator, "anim-in");
    }

    function render() {
      var now = Date.now();
      var visible = queue.visible(now);
      var keep = {};
      visible.forEach(function (t, i) {
        keep[t.id] = true;
        var el = nodes[t.id];
        var fresh = !el;
        if (fresh) {
          el = build(t);
          nodes[t.id] = el;
        }
        // Server-rendered sticky toasts are already on screen, so they don't animate on load.
        var appearing = fresh || el.hidden || el.getAttribute("data-leaving");
        el.removeAttribute("data-leaving");
        el.hidden = false;
        if (layer.children[i] !== el) layer.insertBefore(el, layer.children[i] || null);
        if (appearing) {
          if (el.getAttribute("data-restoring") && indicator && !indicator.hidden) {
            el.style.setProperty("--point", vectorTo(el, indicator));
            play(el, "anim-from-point");
          } else {
            play(el, "anim-in");
          }
        }
        el.removeAttribute("data-restoring");
        if (fresh) announce(t.message, t.severity === "error");
      });
      var minimisedNow = false;
      Object.keys(nodes).forEach(function (id) {
        if (keep[id]) return;
        var el = nodes[id];
        if (el.hidden || el.getAttribute("data-leaving")) return;
        var item = queue.all().filter(function (t) {
          return t.id === id;
        })[0];
        el.setAttribute("data-leaving", "1");
        if (item && item.minimised && indicator) {
          // Into the indicator, which then appears where the toast went.
          minimisedNow = true;
          var hadFocus = el.contains(document.activeElement);
          indicator.hidden = false;
          el.style.setProperty("--point", vectorTo(el, indicator));
          indicator.hidden = true;
          play(el, "anim-to-point", function () {
            if (!el.getAttribute("data-leaving")) return;
            el.removeAttribute("data-leaving");
            el.hidden = true;
            setIndicator();
            // Focus follows the notice into the indicator.
            if (hadFocus) indicator.focus();
          });
        } else if (item) {
          // Waiting for a free place: just hide it.
          el.removeAttribute("data-leaving");
          el.hidden = true;
        } else {
          play(el, "anim-out", function () {
            if (!el.getAttribute("data-leaving")) return;
            el.remove();
            delete nodes[id];
          });
        }
      });
      if (!minimisedNow) setIndicator();
    }

    if (indicator) {
      indicator.addEventListener("click", function () {
        Object.keys(nodes).forEach(function (id) {
          if (nodes[id].hidden) nodes[id].setAttribute("data-restoring", "1");
        });
        queue.restoreAll();
        render();
        var btn = $(".toast [data-action='minimise']", layer);
        if (btn) btn.focus();
      });
    }

    setInterval(function () {
      if (queue.tick(Date.now())) render();
    }, 250);

    // Inline transient notices become toasts.
    $$(".inline-notice[data-kind='transient']").forEach(function (el) {
      queue.add({ id: el.getAttribute("data-id"), kind: "transient", severity: el.getAttribute("data-severity"), message: $(".toast-msg", el).textContent });
    });
    render();

    return {
      transient: function (id, message, severity) {
        queue.add({ id: id + ":" + Date.now(), kind: "transient", severity: severity || "warning", message: message });
        render();
      },
    };
  }

  // -------------------------------------------------------------- theme

  function initTheme() {
    var store = storage();
    // Dark unless the viewer chose light; the system setting isn't used.
    function current() {
      return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    }
    $$(".theme-toggle").forEach(function (btn) {
      function label() {
        // PRINTED OUTPUT: theme switcher / accessible names
        btn.setAttribute("aria-label", current() === "dark" ? "Switch to light mode" : "Switch to dark mode");
      }
      btn.hidden = false;
      label();
      btn.addEventListener("click", function () {
        var next = current() === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        if (globalThis.TimeHead) globalThis.TimeHead.writeTheme(store, next);
        label();
      });
    });
  }

  // -------------------------------------------------------------- dialogs

  function initDialogs() {
    var opener = null; // where focus goes back to
    var switching = false; // one dialog is replacing another
    // Any link with data-dialog opens that dialog instead of its page.
    $$("[data-dialog]").forEach(function (link) {
      var dlg = document.getElementById(link.getAttribute("data-dialog"));
      if (!dlg || typeof dlg.showModal !== "function") return;
      link.addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
        e.preventDefault();
        var menu = document.getElementById("tb-menu-items");
        if (menu && menu.hidePopover && menu.matches(":popover-open")) menu.hidePopover();
        // A link inside another dialog keeps the original opener.
        var returnTo = link.closest("dialog") ? opener : link;
        // A link in the closed narrow-screen menu can't take focus; use the menu button.
        if (returnTo && !returnTo.offsetParent) returnTo = $(".tb-menu") || returnTo;
        var current = $("dialog[open]");
        if (current && current !== dlg) {
          switching = true;
          current.close();
          switching = false;
        }
        opener = returnTo;
        dlg.showModal();
      });
    });
    // Closing plays the exit (shrinking back towards the top right) before the dialog goes.
    function closeAnimated(dlg) {
      if (!dlg.open || dlg.classList.contains("is-closing")) return;
      play(dlg, "is-closing", function () {
        dlg.close();
      });
    }
    $$("dialog.dialog").forEach(function (dlg) {
      $$("[data-close]", dlg).forEach(function (b) {
        b.addEventListener("click", function () {
          closeAnimated(dlg);
        });
      });
      dlg.addEventListener("click", function (e) {
        if (e.target === dlg) closeAnimated(dlg);
      });
      // Escape: run the same animated close instead of the instant native one.
      dlg.addEventListener("cancel", function (e) {
        e.preventDefault();
        closeAnimated(dlg);
      });
      // Escape closes natively; either way focus goes back to what opened it.
      dlg.addEventListener("close", function () {
        if (switching || !opener) return;
        opener.focus();
        opener = null;
      });
    });
  }

  // -------------------------------------------------------------- copy

  function initCopy(toasts) {
    $$(".copy-btn").forEach(function (btn) {
      if (!navigator.clipboard || !navigator.clipboard.writeText) return;
      btn.hidden = false;
      var timer = null;
      function show(state) {
        btn.setAttribute("data-state", state);
        $$(".copy-state", btn).forEach(function (s) {
          s.setAttribute("aria-hidden", s.classList.contains("copy-" + state) ? "false" : "true");
        });
        clearTimeout(timer);
        if (state !== "idle") {
          timer = setTimeout(function () {
            show("idle");
          }, 2000);
        }
      }
      btn.addEventListener("click", function () {
        navigator.clipboard.writeText(btn.getAttribute("data-copy")).then(
          function () {
            show("done");
            announce($(".copy-done", btn).textContent.trim(), false);
          },
          function () {
            show("fail");
            // PRINTED OUTPUT: contact / copy failed toast
            if (toasts) toasts.transient("copy-failed", "Couldn't copy. Select the address and copy it instead.", "error");
          },
        );
      });
    });
  }

  // -------------------------------------------------------------- time window

  function initCalendar() {
    var scroller = document.getElementById("cal-scroll");
    if (!scroller) return;
    var head = $(".colhead", scroller);
    var header = head ? head.offsetHeight : 0;
    var line = document.getElementById("now-line");
    var anchor = document.getElementById(scroller.getAttribute("data-start-anchor") || "h08");
    var lineY = null;
    if (line) {
      var slot = line.parentElement;
      lineY = slot.offsetTop + line.offsetTop;
    }
    scroller.scrollTop = initialScrollTop({
      lineY: lineY,
      anchorY: anchor ? anchor.offsetTop : 0,
      header: header,
      viewport: scroller.clientHeight,
      content: scroller.scrollHeight,
    });
    // Narrow screens: open scrolled sideways to today.
    var todayHead = $(".colhead.is-today", scroller);
    var timeCol = $(".corner", scroller);
    if (todayHead && scroller.scrollWidth > scroller.clientWidth) {
      scroller.scrollLeft = Math.max(0, todayHead.offsetLeft - (timeCol ? timeCol.offsetWidth : 0));
    }

    // Move the line and the greying every minute.
    function tick() {
      var now = Date.now() / 1000;
      var current = null;
      $$(".slot", scroller).forEach(function (s) {
        var start = Number(s.getAttribute("data-s"));
        var end = Number(s.getAttribute("data-e"));
        var isNow = start <= now && now < end;
        s.classList.toggle("past", end <= now && !isNow);
        s.className = s.className.replace(/\s?\bm\d+\b/g, "");
        s.classList.toggle("split", isNow);
        if (isNow) current = { el: s, start: start, end: end };
      });
      var el = document.getElementById("now-line");
      if (!current) {
        if (el) el.remove();
        return;
      }
      var step = Math.min(29, Math.floor(((now - current.start) / (current.end - current.start)) * 30));
      current.el.classList.add("m" + step);
      if (!current.el.classList.contains("is-today")) return;
      if (!el) {
        el = document.createElement("div");
        el.id = "now-line";
        el.setAttribute("aria-hidden", "true");
      }
      el.className = "now-line m" + step;
      if (el.parentElement !== current.el) current.el.appendChild(el);
    }
    if ($(".slot", scroller)) {
      setTimeout(function () {
        tick();
        setInterval(tick, 60000);
      }, 60000 - (Date.now() % 60000));
    }

    // One tab stop for the grid; arrow keys move between cells.
    var cells = $$(".slot", scroller);
    var cols = $$(".colhead", scroller).length || 1;
    if (!cells.length) return;
    var startCell = (line && line.parentElement) || (anchor && anchor.nextElementSibling) || cells[0];
    cells.forEach(function (c) {
      c.tabIndex = c === startCell ? 0 : -1;
    });
    scroller.addEventListener("keydown", function (e) {
      var i = cells.indexOf(document.activeElement);
      if (i < 0) return;
      var j = i;
      if (e.key === "ArrowDown") j = i + cols;
      else if (e.key === "ArrowUp") j = i - cols;
      else if (e.key === "ArrowRight" && (i % cols) < cols - 1) j = i + 1;
      else if (e.key === "ArrowLeft" && i % cols > 0) j = i - 1;
      else if (e.key === "Home") j = i - (i % cols);
      else if (e.key === "End") j = i - (i % cols) + cols - 1;
      else return;
      e.preventDefault();
      if (j < 0 || j >= cells.length) return;
      cells[i].tabIndex = -1;
      cells[j].tabIndex = 0;
      cells[j].focus();
    });
  }

  // -------------------------------------------------------------- time-zone dropdown

  function initZonePicker() {
    var button = document.getElementById("tz-button");
    if (!button || !Intl.supportedValuesOf) return;
    var pop = null;
    var input = null;
    var list = null;
    var options = [];
    var active = -1;
    var zones = null;

    function close(focusButton) {
      if (!pop) return;
      var leaving = pop;
      pop = null;
      play(leaving, "anim-out", function () {
        leaving.remove();
      });
      button.setAttribute("aria-expanded", "false");
      document.removeEventListener("mousedown", outside);
      if (focusButton) button.focus();
    }
    function outside(e) {
      if (pop && !pop.contains(e.target) && !button.contains(e.target)) close(false);
    }
    function choose(tz) {
      location.href = urlWithTz(location.href, tz);
    }
    function setActive(i) {
      if (!options.length) return;
      active = Math.max(0, Math.min(options.length - 1, i));
      options.forEach(function (o, k) {
        o.setAttribute("aria-selected", k === active ? "true" : "false");
      });
      input.setAttribute("aria-activedescendant", options[active].id);
      options[active].scrollIntoView({ block: "nearest" });
    }
    function fill() {
      list.textContent = "";
      options = [];
      var now = new Date();
      var shown = filterZones(zones, input.value);
      function option(value, text, off) {
        var li = document.createElement("li");
        li.className = "tz-opt";
        li.id = "tz-opt-" + options.length;
        li.setAttribute("role", "option");
        li.setAttribute("data-value", value);
        var name = document.createElement("span");
        name.textContent = text;
        li.appendChild(name);
        if (off) {
          var o = document.createElement("span");
          o.className = "off";
          o.textContent = off;
          li.appendChild(o);
        }
        li.addEventListener("mousedown", function (e) {
          e.preventDefault();
          choose(value || null);
        });
        list.appendChild(li);
        options.push(li);
      }
      // PRINTED OUTPUT: time zone dropdown / device default option
      if (!input.value.trim()) option("", "Device default", "");
      var region = null;
      shown.forEach(function (z) {
        var r = z.indexOf("/") > 0 ? z.slice(0, z.indexOf("/")) : "Other"; // PRINTED OUTPUT: time zone dropdown / group for zones with no region
        if (r !== region) {
          region = r;
          var g = document.createElement("li");
          g.className = "tz-group";
          g.setAttribute("role", "presentation");
          g.textContent = r;
          list.appendChild(g);
        }
        option(z, z, utcOffsetLabel(z, now));
      });
      if (!options.length) {
        var empty = document.createElement("li");
        empty.className = "tz-empty";
        empty.setAttribute("role", "presentation");
        empty.textContent = "No matching time zones"; // PRINTED OUTPUT: time zone dropdown / no results
        list.appendChild(empty);
      }
      setActive(0);
    }
    function open() {
      if (!zones) {
        zones = Intl.supportedValuesOf("timeZone").slice();
        if (zones.indexOf("UTC") === -1) zones.push("UTC");
      }
      pop = document.createElement("div");
      pop.className = "tz-pop";
      var summary = button.getAttribute("data-summary");
      if (summary) {
        var cur = document.createElement("p");
        cur.className = "tz-current";
        cur.textContent = summary; // built and marked on the server (topbar / zoneLabel)
        pop.appendChild(cur);
      }
      input = document.createElement("input");
      input.type = "search";
      input.setAttribute("role", "combobox");
      input.setAttribute("aria-expanded", "true");
      input.setAttribute("aria-controls", "tz-listbox");
      input.setAttribute("aria-autocomplete", "list");
      // PRINTED OUTPUT: time zone dropdown / search field label and placeholder
      input.setAttribute("aria-label", "Search time zones");
      input.placeholder = "Search time zones";
      list = document.createElement("ul");
      list.className = "tz-list";
      list.id = "tz-listbox";
      list.setAttribute("role", "listbox");
      list.setAttribute("aria-label", "Time zones"); // PRINTED OUTPUT: time zone dropdown / list name
      pop.appendChild(input);
      pop.appendChild(list);
      document.body.appendChild(pop);
      var r = button.getBoundingClientRect();
      var width = pop.offsetWidth;
      pop.style.top = r.bottom + 6 + "px";
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) + "px";
      button.setAttribute("aria-expanded", "true");
      fill();
      originAt(pop, button);
      play(pop, "anim-in");
      input.addEventListener("input", fill);
      input.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive(active + 1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive(active - 1);
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (options[active]) choose(options[active].getAttribute("data-value") || null);
        } else if (e.key === "Escape") {
          e.preventDefault();
          close(true);
        }
      });
      document.addEventListener("mousedown", outside);
      input.focus();
    }
    button.addEventListener("click", function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      if (pop) close(true);
      else open();
    });
  }

  // -------------------------------------------------------------- range picker

  function initRangePicker() {
    var form = document.getElementById("range-form");
    var trigger = document.getElementById("range-pick");
    var from = document.getElementById("range-from");
    var to = document.getElementById("range-to");
    if (!form || !trigger || !from || !to) return;
    trigger.hidden = false;
    var pop = null;
    var view = null; // { y, m }
    var picking = null; // first click while choosing a new range
    var focusDate = null;
    var monthFmt = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    var todayIso = (function () {
      var d = new Date();
      return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
    })();

    function close(focusTrigger) {
      if (!pop) return;
      var leaving = pop;
      pop = null;
      play(leaving, "anim-out", function () {
        leaving.remove();
      });
      trigger.setAttribute("aria-expanded", "false");
      document.removeEventListener("mousedown", outside);
      if (focusTrigger) trigger.focus();
    }
    function outside(e) {
      if (pop && !pop.contains(e.target) && e.target !== trigger && !trigger.contains(e.target)) close(false);
    }
    function render() {
      pop.textContent = "";
      var head = document.createElement("div");
      head.className = "picker-head";
      var prev = document.createElement("button");
      prev.type = "button";
      prev.className = "btn btn-icon";
      prev.appendChild(icon("icon-left"));
      prev.setAttribute("aria-label", "Previous month"); // PRINTED OUTPUT: date picker / previous month
      var next = document.createElement("button");
      next.type = "button";
      next.className = "btn btn-icon";
      next.appendChild(icon("icon-right"));
      next.setAttribute("aria-label", "Next month"); // PRINTED OUTPUT: date picker / next month
      var title = document.createElement("span");
      title.setAttribute("aria-live", "polite");
      title.textContent = monthFmt.format(new Date(Date.UTC(view.y, view.m - 1, 1))); // PRINTED OUTPUT: date picker / month heading
      prev.addEventListener("click", function () {
        shift(-1);
      });
      next.addEventListener("click", function () {
        shift(1);
      });
      head.appendChild(prev);
      head.appendChild(title);
      head.appendChild(next);
      pop.appendChild(head);

      var grid = document.createElement("div");
      grid.className = "picker-grid";
      grid.setAttribute("role", "grid");
      // PRINTED OUTPUT: date picker / weekday headings
      ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].forEach(function (d) {
        var h = document.createElement("span");
        h.className = "picker-dow";
        h.setAttribute("aria-hidden", "true");
        h.textContent = d;
        grid.appendChild(h);
      });
      var start = picking || from.value;
      var end = picking ? "" : to.value;
      var dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
      monthGrid(view.y, view.m).forEach(function (cell) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "picker-day";
        b.textContent = String(cell.day); // PRINTED OUTPUT: date picker / day number
        var p = cell.date.split("-").map(Number);
        b.setAttribute("aria-label", dayFmt.format(new Date(Date.UTC(p[0], p[1] - 1, p[2])))); // PRINTED OUTPUT: date picker / day accessible name
        b.setAttribute("data-date", cell.date);
        if (!cell.inMonth) b.classList.add("other");
        if (cell.date === todayIso) b.classList.add("is-today");
        if (start && cell.date === start) b.classList.add("is-start");
        if (end && cell.date === end) b.classList.add("is-end");
        if (start && end && cell.date > start && cell.date < end) b.classList.add("in-range");
        b.setAttribute("aria-pressed", cell.date === start || cell.date === end ? "true" : "false");
        b.tabIndex = cell.date === focusDate ? 0 : -1;
        b.addEventListener("click", function () {
          pick(cell.date);
        });
        grid.appendChild(b);
      });
      grid.addEventListener("keydown", function (e) {
        var step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
        if (e.key === "Escape") {
          e.preventDefault();
          close(true);
          return;
        }
        if (!step) return;
        e.preventDefault();
        moveFocus(addDaysIso(focusDate, step));
      });
      pop.appendChild(grid);
      var hint = document.createElement("p");
      hint.className = "picker-hint";
      // PRINTED OUTPUT: date picker / hint
      hint.textContent = picking ? "Select the end date, then Apply." : "Select the start date.";
      pop.appendChild(hint);
      var target = $("[data-date='" + focusDate + "']", grid);
      if (target) target.focus();
    }
    function shift(months) {
      var idx = view.y * 12 + (view.m - 1) + months;
      view = { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
      focusDate = iso(view.y, view.m, 1);
      render();
    }
    function moveFocus(date) {
      focusDate = date;
      var p = date.split("-").map(Number);
      if (p[0] !== view.y || p[1] !== view.m) view = { y: p[0], m: p[1] };
      render();
    }
    function pick(date) {
      if (!picking) {
        picking = date;
        focusDate = date;
        render();
        return;
      }
      var a = picking < date ? picking : date;
      var b = picking < date ? date : picking;
      from.value = a;
      to.value = b;
      picking = null;
      close(true);
    }
    trigger.setAttribute("aria-expanded", "false");
    trigger.addEventListener("click", function () {
      if (pop) {
        close(true);
        return;
      }
      var base = from.value || todayIso;
      var p = base.split("-").map(Number);
      view = { y: p[0], m: p[1] };
      focusDate = base;
      picking = null;
      pop = document.createElement("div");
      pop.className = "picker";
      pop.setAttribute("role", "dialog");
      pop.setAttribute("aria-label", "Choose dates"); // PRINTED OUTPUT: date picker / dialog name
      form.appendChild(pop);
      trigger.setAttribute("aria-expanded", "true");
      document.addEventListener("mousedown", outside);
      render();
      originAt(pop, trigger);
      play(pop, "anim-in");
    });
  }

  // Today is always clickable; when the period already contains now it does nothing.
  function initToday() {
    $$("[data-noop]").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.preventDefault();
      });
    });
  }

  // -------------------------------------------------------------- drag to scroll

  /** Pixels a press must move before it counts as a drag rather than a click. */
  var DRAG_THRESHOLD = 5;

  /**
   * Velocity (px/ms) after a glide step of dt ms. The glide slows
   * exponentially, like touch scrolling, and stops below 0.02 px/ms.
   */
  function glideStep(v, dt) {
    var next = v * Math.pow(0.995, dt);
    return Math.abs(next) < 0.02 ? 0 : next;
  }

  /**
   * Click and drag the calendar with a mouse, as on a touch screen. Only the
   * mouse is handled: touch and pens already scroll natively. A press that
   * moves less than DRAG_THRESHOLD stays a click, so cells can still be
   * focused and Month's day links still open. After a drag, the click that
   * would follow is swallowed. On release the calendar glides to a stop,
   * except under reduced motion.
   */
  function initDragScroll() {
    $$(".cal-scroll").forEach(function (el) {
      var press = null; // { x, y, left, top, id, dragging, samples }
      var glide = 0;
      var swallowClick = false;

      function stopGlide() {
        if (glide) cancelAnimationFrame(glide);
        glide = 0;
      }

      el.addEventListener("pointerdown", function (e) {
        if (e.pointerType !== "mouse" || e.button !== 0) return;
        stopGlide();
        press = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, id: e.pointerId, dragging: false, samples: [] };
      });

      el.addEventListener("pointermove", function (e) {
        if (!press || e.pointerId !== press.id) return;
        var dx = e.clientX - press.x;
        var dy = e.clientY - press.y;
        if (!press.dragging) {
          if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
          press.dragging = true;
          el.classList.add("is-dragging");
          try {
            el.setPointerCapture(press.id);
          } catch (err) {
            /* capture is a nicety */
          }
        }
        el.scrollLeft = press.left - dx;
        el.scrollTop = press.top - dy;
        press.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
        if (press.samples.length > 5) press.samples.shift();
        e.preventDefault();
      });

      function release(e) {
        if (!press || e.pointerId !== press.id) return;
        var was = press;
        press = null;
        if (!was.dragging) return;
        el.classList.remove("is-dragging");
        swallowClick = true;
        setTimeout(function () {
          swallowClick = false;
        }, 0);
        // Glide on with the speed of the last few moves.
        var s = was.samples;
        if (reducedMotion.matches || s.length < 2 || e.type === "pointercancel") return;
        var a = s[0];
        var b = s[s.length - 1];
        var dt = Math.max(1, b.t - a.t);
        if (e.timeStamp - b.t > 80) return; // the pointer had stopped before release
        var vx = -(b.x - a.x) / dt;
        var vy = -(b.y - a.y) / dt;
        var last = performance.now();
        function frame(now) {
          var step = Math.min(50, now - last);
          last = now;
          el.scrollLeft += vx * step;
          el.scrollTop += vy * step;
          vx = glideStep(vx, step);
          vy = glideStep(vy, step);
          glide = vx || vy ? requestAnimationFrame(frame) : 0;
        }
        glide = requestAnimationFrame(frame);
      }
      el.addEventListener("pointerup", release);
      el.addEventListener("pointercancel", release);

      // The click that ends a drag doesn't open a day or focus a cell.
      el.addEventListener(
        "click",
        function (e) {
          if (!swallowClick) return;
          swallowClick = false;
          e.preventDefault();
          e.stopPropagation();
        },
        true,
      );
      // Links (Month's day cells) would otherwise start a native link drag.
      el.addEventListener("dragstart", function (e) {
        e.preventDefault();
      });
      // A wheel or key scroll stops a glide.
      el.addEventListener("wheel", stopGlide, { passive: true });
      el.addEventListener("keydown", stopGlide);
    });
  }

  function start() {
    initToday();
    var toasts = initToasts();
    initTheme();
    initDialogs();
    initCopy(toasts);
    initCalendar();
    initDragScroll();
    initZonePicker();
    initRangePicker();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
