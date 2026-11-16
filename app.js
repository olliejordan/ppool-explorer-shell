// Profit Pool Explorer shell: sign-in, data download, comment mode with pins and threads, the assistant panel, feedback log.
// Plain JavaScript, no libraries. The only host it talks to is the Supabase address in config.js.
// Every piece of user or model text is put on the page with textContent. Nothing is ever parsed as HTML.
(function () {
  "use strict";

  var C = window.PP_CONFIG;
  var SESSION_KEY = "pp_session";
  var FLASH_KEY = "pp_flash";
  var EXPLORER_FILES = { data: "data.json", mark: "mark.png" };
  var TYPES = ["question", "challenge", "feedback", "change request"];

  var S = {
    session: null, me: null, members: {}, meta: null,
    items: [], decisions: [], history: [], replies: [],
    badges: [], view: "explorer", filterStatus: "all", filterTarget: null,
    answers: [], markUrl: null, refreshing: null, repliesNote: "",
    comments: [], resolutions: [], collab: false, pending: {}, rail: { open: false, tab: "threads" },
    cmode: false, openThread: null, threadFilter: "open", conv: null, askTarget: null
  };

  // ------------------------------------------------------------ DOM helpers (text only)
  function h(tag, props, kids) {
    var el = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "text") el.textContent = String(v);
      else if (k === "class") el.className = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "value") el.value = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    });
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function $(id) { return document.getElementById(id); }
  function fmtTime(t) {
    if (!t) return "";
    var d = new Date(t);
    return isNaN(d.getTime()) ? String(t) : d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  }
  function toast(msg) {
    var t = $("ppa-toast");
    t.textContent = msg;
    t.className = "ppa-toast ppa-toast-on";
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = "ppa-toast"; }, 4000);
  }

  // ------------------------------------------------------------ session and HTTP
  function loadSession() {
    try { S.session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null"); } catch (e) { S.session = null; }
  }
  function saveSession(j) {
    var exp = j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600);
    S.session = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: exp, user_id: j.user && j.user.id };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(S.session));
    scheduleRefresh();
  }
  function signOut(flash) {
    var tok = S.session && S.session.access_token;
    sessionStorage.removeItem(SESSION_KEY);
    if (flash) sessionStorage.setItem(FLASH_KEY, flash);
    var done = function () { window.location.reload(); };
    if (tok) {
      fetch(C.SUPABASE_URL + "/auth/v1/logout?scope=local", {
        method: "POST", headers: { apikey: C.SUPABASE_ANON_KEY, Authorization: "Bearer " + tok }
      }).then(done, done);
    } else done();
  }
  function scheduleRefresh() {
    clearTimeout(scheduleRefresh._t);
    if (!S.session) return;
    var ms = S.session.expires_at * 1000 - Date.now() - 90000;
    scheduleRefresh._t = setTimeout(function () { refresh().catch(function () {}); }, Math.max(ms, 5000));
  }
  function refresh() {
    if (S.refreshing) return S.refreshing;
    var rt = S.session && S.session.refresh_token;
    if (!rt) { signOut("Your session has ended. Sign in again."); return Promise.reject(new Error("no session")); }
    S.refreshing = fetch(C.SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST", headers: { apikey: C.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: rt })
    }).then(function (r) {
      if (!r.ok) throw new Error("refresh failed");
      return r.json();
    }).then(function (j) {
      saveSession(j);
      S.refreshing = null;
    }).catch(function (e) {
      S.refreshing = null;
      signOut("Your session has ended. Sign in again.");
      throw e;
    });
    return S.refreshing;
  }
  function authed(path, opts) {
    opts = opts || {};
    function go() {
      var headers = { apikey: C.SUPABASE_ANON_KEY, Authorization: "Bearer " + S.session.access_token };
      Object.keys(opts.headers || {}).forEach(function (k) { headers[k] = opts.headers[k]; });
      if (path.indexOf("/rest/") === 0) {
        headers["Accept-Profile"] = "explorer";
        if (opts.method && opts.method !== "GET") headers["Content-Profile"] = "explorer";
      }
      var body;
      if (opts.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.json); }
      return fetch(C.SUPABASE_URL + path, { method: opts.method || "GET", headers: headers, body: body });
    }
    var needs = S.session.expires_at * 1000 - Date.now() < 60000;
    return (needs ? refresh() : Promise.resolve()).then(go).then(function (r) {
      if (r.status !== 401) return r;
      return refresh().then(go);
    });
  }
  function rest(table, query) { return authed("/rest/v1/" + table + (query || "")).then(jsonOrThrow); }
  function jsonOrThrow(r) {
    if (!r.ok) throw new Error("Request failed (" + r.status + ")");
    return r.json();
  }
  function callFn(action, payload) {
    var body = { action: action };
    Object.keys(payload || {}).forEach(function (k) { body[k] = payload[k]; });
    return authed("/functions/v1/" + C.FUNCTION_NAME, { method: "POST", json: body }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, ok: r.ok, body: j }; });
    });
  }

  // ------------------------------------------------------------ sign-in
  function showLogin(flash) {
    var root = $("ppa-login");
    root.hidden = false;
    $("ppa-app").hidden = true;
    clear(root);
    var msg = h("p", { class: "ppa-msg", role: "status" });
    var email = h("input", { type: "email", id: "ppa-email", autocomplete: "username", required: true, placeholder: "name@example.com" });
    var code = h("input", { type: "text", id: "ppa-code", inputmode: "numeric", autocomplete: "one-time-code", pattern: "[0-9]{6,10}", maxlength: "10", placeholder: "6-digit code" });
    var send = h("button", { type: "submit", class: "ppa-btn ppa-primary", text: "Send code" });
    var verify = h("button", { type: "submit", class: "ppa-btn ppa-primary", text: "Sign in" });
    var back = h("button", { type: "button", class: "ppa-btn ppa-link", text: "Use a different email" });
    var pw = h("input", { type: "password", id: "ppa-password", autocomplete: "current-password", placeholder: "Password (optional)" });
    var pwBtn = h("button", { type: "button", class: "ppa-btn ppa-link", text: "Sign in with a password instead" });
    var step1 = h("form", { class: "ppa-form", id: "ppa-step-email" }, [
      h("label", { for: "ppa-email", text: "Email address" }), email, send,
      h("label", { for: "ppa-password", text: "Or use the password you were given" }), pw, pwBtn
    ]);
    var step2 = h("form", { class: "ppa-form", id: "ppa-step-code", hidden: true }, [
      h("label", { for: "ppa-code", text: "Code from your email" }), code, verify, back
    ]);
    root.appendChild(h("div", { class: "ppa-card" }, [
      h("h1", { id: "ppa-login-title", text: "Profit Pool Explorer" }),
      h("p", { class: "ppa-sub", text: "Sign in with the email address you were invited on. We will send a one-time code." }),
      step1, step2, msg
    ]));
    if (flash) msg.textContent = flash;

    step1.addEventListener("submit", function (e) {
      e.preventDefault();
      var addr = email.value.trim();
      if (!addr) return;
      send.disabled = true;
      msg.textContent = "Sending…";
      fetch(C.SUPABASE_URL + "/auth/v1/otp", {
        method: "POST", headers: { apikey: C.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: addr, create_user: false })
      }).then(function (r) {
        send.disabled = false;
        if (r.status === 429) { msg.textContent = "Too many requests. Wait a minute and try again."; return; }
        // Same message whether or not the address is invited.
        msg.textContent = "If that address has been invited, a code is on its way. It can take a minute to arrive.";
        step1.hidden = true; step2.hidden = false; code.focus();
      }, function () { send.disabled = false; msg.textContent = "Could not reach the sign-in service. Check the connection and try again."; });
    });
    pwBtn.addEventListener("click", function () {
      var addr = email.value.trim();
      if (!addr || !pw.value) { msg.textContent = "Enter your email address and password."; return; }
      pwBtn.disabled = true;
      msg.textContent = "Checking…";
      fetch(C.SUPABASE_URL + "/auth/v1/token?grant_type=password", {
        method: "POST", headers: { apikey: C.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email: addr, password: pw.value })
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; });
      }).then(function (res) {
        pwBtn.disabled = false;
        if (res.status === 429) { msg.textContent = "Too many attempts. Wait a minute and try again."; return; }
        if (!res.ok || !res.j.access_token) { msg.textContent = "That email or password did not work."; return; }
        pw.value = "";
        saveSession(res.j);
        bootstrap();
      }, function () { pwBtn.disabled = false; msg.textContent = "Could not reach the sign-in service. Try again."; });
    });
    step2.addEventListener("submit", function (e) {
      e.preventDefault();
      var tok = code.value.replace(/\s+/g, "");
      if (!tok) return;
      verify.disabled = true;
      msg.textContent = "Checking…";
      fetch(C.SUPABASE_URL + "/auth/v1/verify", {
        method: "POST", headers: { apikey: C.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "email", email: email.value.trim(), token: tok })
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; });
      }).then(function (res) {
        verify.disabled = false;
        if (!res.ok || !res.j.access_token) { msg.textContent = "That code did not work. It may have expired: go back and ask for a new one."; return; }
        saveSession(res.j);
        bootstrap();
      }, function () { verify.disabled = false; msg.textContent = "Could not reach the sign-in service. Try again."; });
    });
    back.addEventListener("click", function () {
      step2.hidden = true; step1.hidden = false; code.value = ""; msg.textContent = ""; email.focus();
    });
  }

  // ------------------------------------------------------------ start-up after sign-in
  function bootstrap() {
    $("ppa-login").hidden = true;
    var host = $("ppa-explorer");
    clear(host);
    host.appendChild(h("p", { class: "ppa-loading", text: "Loading…" }));
    $("ppa-app").hidden = false;
    var uid;
    authed("/auth/v1/user").then(jsonOrThrow).then(function (u) {
      uid = u.id;
      return rest("members", "?select=*");
    }).then(function (rows) {
      rows.forEach(function (m) { S.members[m.user_id] = m; });
      S.me = S.members[uid];
      if (!S.me || S.me.active === false) { showNoAccess(); return null; }
      return Promise.all([
        authed("/storage/v1/object/authenticated/explorer-data/" + EXPLORER_FILES.data).then(jsonOrThrow),
        authed("/storage/v1/object/authenticated/explorer-data/" + EXPLORER_FILES.mark).then(function (r) {
          return r.ok ? r.blob() : null;
        }).catch(function () { return null; }),
        loadFeedbackData().catch(function () {}),
        loadConversation(uid)
      ]);
    }).then(function (res) {
      if (!res) return;
      S.meta = res[0].meta || {};
      S.markUrl = res[1] ? URL.createObjectURL(res[1]) : null;
      drawBar();
      clear(host);
      window.PPExplorer.mount({
        data: res[0], root: host, markUrl: S.markUrl, actions: { decorate: decorate, onRender: onExplorerRender }
      });
      wireCommentMode(host);
      if (window.innerWidth >= 1200) openRail("threads");
      schedulePins();
    }).catch(function (e) {
      clear(host);
      host.appendChild(h("p", { class: "ppa-error", text: "Could not load the Explorer data (" + (e && e.message ? e.message : "error") + "). Try signing in again." }));
      drawBar();
    });
  }
  function showNoAccess() {
    var host = $("ppa-explorer");
    clear(host);
    host.appendChild(h("div", { class: "ppa-card" }, [
      h("h1", { text: "Profit Pool Explorer" }),
      h("p", { text: "This account has not been set up for access. Ask the administrator." }),
      h("button", { type: "button", class: "ppa-btn ppa-primary", text: "Sign out", onclick: function () { signOut(); } })
    ]));
  }

  // ------------------------------------------------------------ top bar
  function drawBar() {
    var bar = $("ppa-bar");
    clear(bar);
    var tabs = h("div", { class: "ppa-tabs", role: "tablist" }, [
      h("button", { type: "button", id: "ppa-tab-explorer", role: "tab", class: "ppa-tab", text: "Explorer", onclick: function () { setView("explorer"); } }),
      h("button", { type: "button", id: "ppa-tab-feedback", role: "tab", class: "ppa-tab", text: "Feedback", onclick: function () { setView("feedback"); } })
    ]);
    if (isAdmin()) tabs.appendChild(h("button", { type: "button", id: "ppa-tab-users", role: "tab", class: "ppa-tab", text: "Users", onclick: function () { setView("users"); } }));
    var who = S.me ? S.me.display_name + (S.me.role === "admin" ? " (admin)" : "") : "";
    bar.appendChild(h("span", { class: "ppa-bar-title", text: "Profit Pool Explorer" }));
    bar.appendChild(tabs);
    bar.appendChild(h("span", { class: "ppa-spacer" }));
    if (S.me) {
      bar.appendChild(h("button", { type: "button", class: "ppa-btn ppa-small ppa-cmode-btn", id: "ppa-cmode", "aria-pressed": "false", text: "+ Comment", title: "Then click any number, row, bar or paragraph", onclick: function () { setView("explorer"); setCommentMode(!S.cmode); } }));
      bar.appendChild(h("button", { type: "button", class: "ppa-btn ppa-small", id: "ppa-open-threads", text: "Comments", onclick: function () { openRail("threads"); } }));
      bar.appendChild(h("button", { type: "button", class: "ppa-btn ppa-small", id: "ppa-open-ask", text: "Assistant", onclick: function () { openAsk(null); } }));
    }
    bar.appendChild(h("span", { class: "ppa-who", id: "ppa-who", text: who }));
    bar.appendChild(h("button", { type: "button", class: "ppa-btn ppa-small", id: "ppa-signout", text: "Sign out", onclick: function () { signOut(); } }));
    markTabs();
  }
  function markTabs() {
    ["explorer", "feedback", "users"].forEach(function (v) {
      var t = $("ppa-tab-" + v);
      if (!t) return;
      t.setAttribute("aria-selected", S.view === v ? "true" : "false");
      t.className = "ppa-tab" + (S.view === v ? " ppa-tab-on" : "");
    });
    var fb = $("ppa-tab-feedback");
    if (fb) fb.textContent = "Feedback" + (S.items.length ? " (" + S.items.length + ")" : "");
  }
  function setView(v) {
    S.view = v;
    $("ppa-explorer").hidden = v !== "explorer";
    if (v !== "explorer") setCommentMode(false);
    schedulePins();
    $("ppa-feedback").hidden = v !== "feedback";
    $("ppa-users").hidden = v !== "users";
    markTabs();
    if (v === "feedback") openFeedback();
    if (v === "users") openUsers();
  }

  // ------------------------------------------------------------ targets and badges
  var CTX_KEYS = ["release", "label", "basis", "scenario", "measure", "assumption_id", "build_step", "universe_step"];
  function makeTarget(kind, ctx) {
    var t = { kind: kind };
    CTX_KEYS.forEach(function (k) { if (ctx && ctx[k] !== undefined && ctx[k] !== null && ctx[k] !== "") t[k] = ctx[k]; });
    if (ctx && ctx.filters && typeof ctx.filters === "object") {
      var f = {};
      Object.keys(ctx.filters).sort().forEach(function (k) {
        var v = ctx.filters[k];
        if (v !== null && v !== undefined && v !== "" && v !== "all") f[k] = v;
      });
      t.filters = f;
    }
    if (!t.release) t.release = (S.meta && S.meta.release) || "unknown";
    return t;
  }
  function targetKey(t) {
    if (!t) return "";
    if (t.kind === "anchor" || t.kind === "screen") return t.kind + "|" + (t.sig || "") + "|" + (t.a || "");
    if (t.kind === "cell") {
      var f = t.filters || {};
      var fk = Object.keys(f).sort().map(function (k) { return k + "=" + f[k]; }).join("&");
      return ["cell", t.basis || "", t.scenario || "", t.measure || "", fk].join("|");
    }
    return t.kind + "|" + (t.assumption_id || t.build_step || t.universe_step || "");
  }
  function countFor(key) {
    var n = 0;
    S.items.forEach(function (it) { if (targetKey(it.target) === key) n++; });
    return n;
  }
  function refreshBadges() {
    S.badges = S.badges.filter(function (b) { return b.el.isConnected; });
    S.badges.forEach(function (b) { paintBadge(b.el, b.key); });
    markTabs();
    schedulePins();
    drawRailTabsIfOpen();
  }
  function paintBadge(el, key) {
    var n = countFor(key);
    el.hidden = n === 0;
    el.textContent = String(n);
    el.setAttribute("title", n + (n === 1 ? " item" : " items") + " raised on this");
    el.setAttribute("aria-label", n + (n === 1 ? " item" : " items") + " raised on this. Show them.");
  }

  // ------------------------------------------------------------ actions the Explorer calls
  function decorate(kind, context, el) {
    if (!el) return;
    el.setAttribute("data-pp-kind", kind);
    clear(el);
    var target = makeTarget(kind, context);
    var key = targetKey(target);
    var badge = h("button", {
      type: "button", class: "ppa-badge", onclick: function () {
        var first = S.items.filter(function (it) { return targetKey(it.target) === key; })[0];
        S.openThread = first ? first.id : null; S.threadFilter = "all"; openRail("threads");
      }
    });
    paintBadge(badge, key);
    S.badges.push({ el: badge, key: key });
    el.appendChild(h("button", { type: "button", class: "ppa-btn ppa-small ppa-ask", text: "Ask", onclick: function () { openAsk(target); } }));
    el.appendChild(h("button", { type: "button", class: "ppa-btn ppa-small ppa-comment", text: "Comment", onclick: function () { openComment(target, el); } }));
    el.appendChild(badge);
  }

  function targetLine(t) {
    if (!t) return "";
    var parts = [];
    if (t.label) parts.push(t.label);
    else if (t.assumption_id) parts.push("Assumption " + t.assumption_id);
    else if (t.build_step) parts.push("Build step " + t.build_step);
    else if (t.universe_step) parts.push("Universe step " + t.universe_step);
    else parts.push(t.kind || "general");
    if (t.kind === "cell") {
      var bits = [];
      if (t.basis) bits.push(t.basis);
      if (t.scenario) bits.push(t.scenario);
      if (t.measure) bits.push(t.measure);
      if (bits.length) parts.push(bits.join(", "));
    }
    return parts.join(" · ");
  }

  // ------------------------------------------------------------ markdown-lite (text nodes only, never HTML)
  function mdInline(text) {
    var out = [], re = /\*\*([^*]+)\*\*|`([^`]+)`/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      out.push(m[1] !== undefined ? h("strong", { text: m[1] }) : h("code", { text: m[2] }));
      last = re.lastIndex;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }
  function md(text) {
    var box = h("div", { class: "ppa-md" }), lines = String(text || "").split(/\r?\n/), i = 0;
    function cells(l) { return l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(function (c) { return c.trim(); }); }
    while (i < lines.length) {
      var l = lines[i];
      if (!l.trim()) { i++; continue; }
      if (/^\s*\|/.test(l)) {
        var rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
        var body = rows.filter(function (r) { return !/^\s*\|[\s:|-]+\|?\s*$/.test(r); });
        box.appendChild(h("div", { class: "ppa-md-tw" }, [h("table", {}, body.map(function (r, n) {
          return h("tr", {}, cells(r).map(function (c) { return h(n === 0 && rows.length > body.length ? "th" : "td", {}, mdInline(c)); }));
        }))]));
        continue;
      }
      if (/^\s*([-*]|\d+[.)])\s+/.test(l)) {
        var ord = /^\s*\d+[.)]\s+/.test(l), items = [];
        while (i < lines.length && /^\s*([-*]|\d+[.)])\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*]|\d+[.)])\s+/, "")); i++; }
        box.appendChild(h(ord ? "ol" : "ul", {}, items.map(function (t) { return h("li", {}, mdInline(t)); })));
        continue;
      }
      if (/^#{1,4}\s+/.test(l)) { box.appendChild(h("p", { class: "ppa-md-h" }, mdInline(l.replace(/^#{1,4}\s+/, "")))); i++; continue; }
      var para = [];
      while (i < lines.length && lines[i].trim() && !/^\s*(\||[-*]\s|\d+[.)]\s|#{1,4}\s)/.test(lines[i])) { para.push(lines[i]); i++; }
      box.appendChild(h("p", {}, mdInline(para.join(" "))));
    }
    return box;
  }

  // ------------------------------------------------------------ the Explorer's collaboration hooks (absent in old builds)
  function PX() { return window.PPExplorer || {}; }
  function canAnchor() { return typeof PX().locate === "function" && typeof PX().find === "function"; }
  function screenTarget() {
    var t = { kind: "screen", release: (S.meta && S.meta.release) || "unknown" };
    if (typeof PX().screenLabel === "function") { t.label = PX().screenLabel(); t.sig = PX().sig(); t.view = PX().getView(); }
    else { t.kind = "general"; t.label = "The Explorer"; }
    return t;
  }
  function goTo(t) {
    if (!t) return;
    setView("explorer");
    var v = t.view;
    if (!v && t.kind === "universe_step") v = { tab: "universe", step: +t.universe_step };
    if (!v && t.kind === "build_step") v = { tab: "build", bstep: +t.build_step };
    if (v && typeof PX().setView === "function") PX().setView(v);
    if (t.a && canAnchor()) {
      var el = PX().find(t.a);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.classList.add("ppa-flash");
        setTimeout(function () { el.classList.remove("ppa-flash"); }, 2200);
      }
    }
    schedulePins();
  }
  function isResolved(id) { return S.resolutions.some(function (r) { return r.item_id === id; }); }
  function isOpen(it) { return !isResolved(it.id) && it.status !== "declined"; }
  function onScreen(it) {
    var t = it.target || {}, sig = typeof PX().sig === "function" ? PX().sig() : null;
    if (!sig) return false;
    if (t.kind === "anchor" || t.kind === "screen") return t.sig === sig;
    if (t.kind === "universe_step") return sig === "u:" + t.universe_step;
    if (t.kind === "build_step") return sig === "b:" + t.build_step;
    return false;
  }

  // ------------------------------------------------------------ pins: a marker on the page wherever an open comment is anchored
  function schedulePins() {
    if (schedulePins._q) return;
    schedulePins._q = true;
    (window.requestAnimationFrame || setTimeout)(function () { schedulePins._q = false; paintPins(); });
  }
  function paintPins() {
    var layer = $("ppa-pins");
    if (!layer) return;
    clear(layer);
    if (S.view !== "explorer" || !canAnchor()) return;
    var sig = PX().sig(), host = $("ppa-explorer-wrap").getBoundingClientRect(), groups = {};
    S.items.forEach(function (it) {
      var t = it.target || {};
      if (t.kind !== "anchor" || t.sig !== sig || !isOpen(it)) return;
      (groups[t.a] = groups[t.a] || []).push(it);
    });
    Object.keys(groups).forEach(function (a) {
      var el = PX().find(a);
      if (!el) return;
      var r = el.getBoundingClientRect(), g = groups[a], n = g.length;
      var pin = h("button", {
        type: "button", class: "ppa-pin" + (g.some(function (x) { return x.status === "new"; }) ? "" : " ppa-pin-seen"), "data-pin": a,
        title: n + (n === 1 ? " comment" : " comments") + " here", "aria-label": n + (n === 1 ? " comment" : " comments") + " here. Show.",
        text: String(n), onclick: function (e) { e.stopPropagation(); S.openThread = g[0].id; openRail("threads"); }
      });
      pin.style.left = Math.max(0, Math.min(r.right - host.left - 8, host.width - 22)) + "px";
      pin.style.top = Math.max(0, r.top - host.top - 9) + "px";
      layer.appendChild(pin);
    });
  }
  function onExplorerRender() {
    schedulePins();
    if (S.rail.open && S.rail.tab === "threads") renderThreads();
    var from = $("ppa-ask-from");
    if (from && !S.askTarget) from.textContent = targetLine(screenTarget());
  }

  // ------------------------------------------------------------ comment mode: click anything on the page to pin a comment to it
  function setCommentMode(on) {
    S.cmode = !!on && canAnchor();
    document.body.classList.toggle("ppa-cmode-on", S.cmode);
    var b = $("ppa-cmode");
    if (b) { b.setAttribute("aria-pressed", S.cmode ? "true" : "false"); b.textContent = S.cmode ? "Click the page to comment" : "+ Comment"; }
    var hot = document.querySelector(".ppa-hot");
    if (hot) hot.classList.remove("ppa-hot");
    if (on && !canAnchor()) toast("Use the Comment button beside a section.");
  }
  function wireCommentMode(host) {
    host.addEventListener("click", function (e) {
      if (!S.cmode) return;
      e.preventDefault(); e.stopPropagation();
      var loc = PX().locate(e.target);
      if (!loc) { toast("Click a number, a row, a bar or a paragraph."); return; }
      openComment({ kind: "anchor", release: (S.meta && S.meta.release) || "unknown", a: loc.a, sig: loc.sig, label: loc.label, quote: loc.quote, view: loc.view }, loc.el);
    }, true);
    host.addEventListener("mouseover", function (e) {
      if (!S.cmode) return;
      var old = document.querySelector(".ppa-hot"), loc = PX().locate(e.target);
      if (old && (!loc || old !== loc.el)) old.classList.remove("ppa-hot");
      if (loc) loc.el.classList.add("ppa-hot");
    });
    host.addEventListener("toggle", schedulePins, true);
    window.addEventListener("resize", schedulePins);
    if (window.ResizeObserver) new ResizeObserver(schedulePins).observe(host);
  }

  // ------------------------------------------------------------ the side panel: comments and the assistant
  function openRail(tab) {
    S.rail.open = true; S.rail.tab = tab || S.rail.tab;
    $("ppa-rail").hidden = false;
    $("ppa-threads").hidden = S.rail.tab !== "threads";
    $("ppa-drawer").hidden = S.rail.tab !== "ask";
    drawRailTabs();
    if (S.rail.tab === "threads") renderThreads(); else renderAsk();
    schedulePins();
  }
  function closeRail() { S.rail.open = false; $("ppa-rail").hidden = true; schedulePins(); }
  function closeDrawer() { closeRail(); }
  function drawRailTabs() {
    var host = $("ppa-rail-tabs"), n = S.items.filter(isOpen).length;
    clear(host);
    [["threads", "Comments" + (n ? " (" + n + ")" : "")], ["ask", "Assistant"]].forEach(function (t) {
      host.appendChild(h("button", {
        type: "button", id: "ppa-rtab-" + t[0], class: "ppa-rtab" + (S.rail.tab === t[0] ? " ppa-rtab-on" : ""), role: "tab",
        "aria-selected": S.rail.tab === t[0] ? "true" : "false", text: t[1], onclick: function () { openRail(t[0]); }
      }));
    });
    host.appendChild(h("span", { class: "ppa-spacer" }));
    host.appendChild(h("button", { type: "button", class: "ppa-btn ppa-small", id: "ppa-rail-close", text: "Hide", onclick: closeRail }));
  }

  // ------------------------------------------------------------ assistant
  function newConvId() {
    var a = new Uint8Array(12), s = "";
    (window.crypto || window.msCrypto).getRandomValues(a);
    for (var i = 0; i < a.length; i++) s += ("0" + a[i].toString(16)).slice(-2);
    return s;
  }
  function loadConversation(uid) {
    return rest("question_log", "?select=id,question,answer,target,conversation_id&asked_by=eq." + encodeURIComponent(uid) + "&order=id.desc&limit=30").then(function (rows) {
      var cid = null;
      rows.forEach(function (r) { if (!cid && r.conversation_id) cid = r.conversation_id; });
      if (!cid) return;
      S.conv = cid;
      S.answers = rows.filter(function (r) { return r.conversation_id === cid && r.answer; }).reverse().map(function (r) {
        return { q: r.question, a: r.answer, from: targetLine(r.target), target: r.target };
      });
    }).catch(function () {});
  }
  function openAsk(target) {
    S.askTarget = target || null;
    openRail("ask");
    var box = $("ppa-ask-text");
    if (box) box.focus();
  }
  function renderAsk() {
    var d = $("ppa-drawer");
    clear(d);
    var max = C.ASK_MAX_CHARS || 2000;
    var box = h("textarea", { id: "ppa-ask-text", rows: "3", maxlength: String(max), placeholder: "Ask about the model, an assumption, or what you are looking at" });
    var count = h("span", { class: "ppa-count", text: "0 / " + max });
    var status = h("p", { class: "ppa-msg", id: "ppa-ask-status", role: "status" });
    var quota = h("p", { class: "ppa-quota", id: "ppa-ask-quota" });
    var answers = h("div", { class: "ppa-answers", id: "ppa-answers", "aria-live": "polite" });
    var send = h("button", { type: "button", class: "ppa-btn ppa-primary", id: "ppa-ask-send", text: "Ask" });
    var from = h("span", { id: "ppa-ask-from", text: targetLine(S.askTarget || screenTarget()) });
    box.addEventListener("input", function () { count.textContent = box.value.length + " / " + max; });
    box.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send.click(); });
    d.appendChild(h("div", { class: "ppa-drawer-head" }, [
      h("h2", { text: "Ask about the model" }),
      h("div", { class: "ppa-row" }, [
        h("button", { type: "button", class: "ppa-btn ppa-small", id: "ppa-ask-new", text: "New conversation", onclick: function () { S.conv = null; S.answers = []; S.askTarget = null; renderAsk(); } }),
        h("button", { type: "button", class: "ppa-btn ppa-small", id: "ppa-ask-close", text: "Close", onclick: closeDrawer })
      ])
    ]));
    d.appendChild(answers);
    d.appendChild(h("p", { class: "ppa-from" }, [
      h("strong", { text: "Asking from: " }), from,
      S.askTarget ? h("button", { type: "button", class: "ppa-btn ppa-link ppa-small", id: "ppa-ask-follow", text: "follow the screen instead", onclick: function () { S.askTarget = null; renderAsk(); } }) : null
    ]));
    d.appendChild(box);
    d.appendChild(h("div", { class: "ppa-row" }, [count, send]));
    d.appendChild(status);
    d.appendChild(quota);
    paintAnswers(answers);

    callFn("quota").then(function (r) {
      if (r.ok && r.body.remaining) paintQuota(quota, r.body.remaining);
    }).catch(function () {});

    send.addEventListener("click", function () {
      var q = box.value.trim();
      if (!q) { status.textContent = "Type a question first."; return; }
      var target = S.askTarget || screenTarget();
      if (!S.conv) S.conv = newConvId();
      send.disabled = true;
      status.textContent = "";
      var wait = h("div", { class: "ppa-thinking" }, [h("p", { class: "ppa-q", text: q }), h("p", { class: "ppa-note ppa-pending", text: "Thinking…" })]);
      if (answers.firstChild && answers.firstChild.className === "ppa-empty") clear(answers);
      answers.appendChild(wait); answers.scrollTop = answers.scrollHeight;
      callFn("ask", { question: q, target: target, conversation_id: S.conv }).then(function (r) {
        send.disabled = false;
        if (wait.parentNode) wait.parentNode.removeChild(wait);
        if (r.ok && r.body.answer) {
          S.answers.push({ q: q, a: r.body.answer, from: targetLine(target), target: target, truncated: !!r.body.truncated });
          box.value = ""; count.textContent = "0 / " + max;
          status.textContent = "";
          paintAnswers(answers);
          if (r.body.remaining) paintQuota(quota, r.body.remaining);
        } else {
          status.textContent = r.body.message || "The question could not be answered (" + r.status + ").";
          if (r.body.remaining) paintQuota(quota, r.body.remaining);
        }
      }, function () { send.disabled = false; if (wait.parentNode) wait.parentNode.removeChild(wait); status.textContent = "Could not reach the server. Try again."; });
    });
  }
  function paintQuota(el, rem) {
    var n = rem.effective !== undefined ? rem.effective : Math.min(rem.user, rem.total);
    el.textContent = n + (n === 1 ? " question" : " questions") + " left this month";
  }
  function paintAnswers(el) {
    clear(el);
    if (!S.answers.length) {
      el.appendChild(h("p", { class: "ppa-empty", text: "Ask anything about what is on screen. Follow-up questions keep the thread of the conversation." }));
      return;
    }
    S.answers.forEach(function (a) {
      var ans = h("div", { class: "ppa-a" }, [md(a.a)]);
      el.appendChild(h("div", { class: "ppa-qa" }, [
        h("p", { class: "ppa-q", text: a.q }),
        ans,
        a.truncated ? h("p", { class: "ppa-note", text: "The answer was cut at the length limit." }) : null,
        h("div", { class: "ppa-qa-foot" }, [
          h("button", { type: "button", class: "ppa-btn ppa-link ppa-small ppa-goto", text: "From: " + a.from, title: "Go to that view", onclick: function () { goTo(a.target); } }),
          h("button", { type: "button", class: "ppa-btn ppa-link ppa-small ppa-tocomment", text: "Raise as a comment", onclick: function () {
            var t = a.target && a.target.kind !== "screen" && a.target.kind !== "general" ? a.target : screenTarget();
            openComment(t, null, { text: a.q, type: "change request" });
          } })
        ])
      ]));
    });
    el.scrollTop = el.scrollHeight;
  }

  // ------------------------------------------------------------ comment box (pinned beside what was clicked, or centred)
  function guessType(text) {
    return /\?\s*$/.test(text) ? "question" : "feedback";
  }
  function openComment(target, nearEl, preset) {
    var root = $("ppa-modal-root");
    clear(root);
    var max = C.COMMENT_MAX_CHARS || 4000, touched = !!(preset && preset.type);
    var type = h("select", { id: "ppa-comment-type", "aria-label": "Type" }, TYPES.map(function (t) { return h("option", { value: t, text: t }); }));
    type.value = (preset && preset.type) || "feedback";
    type.addEventListener("change", function () { touched = true; });
    var box = h("textarea", { id: "ppa-comment-text", rows: "3", maxlength: String(max), placeholder: "Comment, question or request", "aria-label": "Your comment" });
    if (preset && preset.text) box.value = preset.text;
    var status = h("p", { class: "ppa-msg", id: "ppa-comment-status", role: "status" });
    var save = h("button", { type: "button", class: "ppa-btn ppa-primary", id: "ppa-comment-save", text: "Comment" });
    var ask = h("button", { type: "button", class: "ppa-btn", id: "ppa-comment-ask", text: "Ask the assistant", title: "Ask this as a question instead of logging a comment" });
    function close() { clear(root); }
    box.addEventListener("input", function () { if (!touched) type.value = guessType(box.value); });
    box.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save.click(); });
    var modal = h("div", { class: "ppa-modal" + (nearEl ? " ppa-pop" : ""), role: "dialog", "aria-modal": nearEl ? "false" : "true", "aria-label": "Add a comment" }, [
      h("p", { class: "ppa-from" }, [h("strong", { text: "On: " }), h("span", { text: targetLine(target) })]),
      target.quote ? h("p", { class: "ppa-quote", text: target.quote }) : null,
      box,
      status,
      h("div", { class: "ppa-row" }, [
        type,
        h("span", { class: "ppa-spacer" }),
        h("button", { type: "button", class: "ppa-btn ppa-small", id: "ppa-comment-cancel", text: "Cancel", onclick: close }), ask, save
      ])
    ]);
    if (nearEl) {
      var r = nearEl.getBoundingClientRect(), w = Math.min(420, window.innerWidth - 24);
      modal.style.width = w + "px";
      modal.style.left = Math.max(12, Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - w - 12)) + "px";
      modal.style.top = (r.bottom + window.scrollY + 8) + "px";
      root.appendChild(modal);
    } else {
      root.appendChild(h("div", { class: "ppa-overlay" }, [modal]));
    }
    box.focus();
    ask.addEventListener("click", function () {
      var q = box.value.trim();
      if (!q) { status.textContent = "Type a question first."; return; }
      close(); setCommentMode(false);
      openAsk(target);
      $("ppa-ask-text").value = q;
      $("ppa-ask-send").click();
    });
    save.addEventListener("click", function () {
      var text = box.value.trim();
      if (!text) { status.textContent = "Write a comment first."; return; }
      save.disabled = true;
      status.textContent = "Saving…";
      authed("/rest/v1/items", {
        method: "POST", headers: { Prefer: "return=representation" },
        json: { type: type.value, release: target.release, target: target, text: text }
      }).then(function (r) {
        if (!r.ok) throw new Error("status " + r.status);
        return r.json();
      }).then(function (rows) {
        S.items.unshift(rows[0]);
        refreshBadges();
        toast("Saved as item #" + rows[0].id);
        close(); setCommentMode(false);
        if (S.view === "feedback") openFeedback();
        else { S.openThread = rows[0].id; openRail("threads"); }
        assistantReply(rows[0].id);
      }).catch(function () { save.disabled = false; status.textContent = "Could not save. Try again."; });
    });
  }

  // ------------------------------------------------------------ threads
  function assistantReply(id) {
    if (!S.collab || S.pending[id]) return Promise.resolve();
    S.pending[id] = "Assistant is replying…";
    renderThreadsIfOpen();
    return callFn("thread_reply", { item_id: id }).then(function (r) {
      if (r.ok && r.body.comment) { S.comments.push(r.body.comment); delete S.pending[id]; }
      else S.pending[id] = r.status === 409 ? null : (r.body.message || "The assistant could not reply.");
      if (S.pending[id] === null) delete S.pending[id];
      renderThreadsIfOpen();
    }, function () { S.pending[id] = "Could not reach the assistant."; renderThreadsIfOpen(); });
  }
  function hasAssistantLast(id) {
    var c = S.comments.filter(function (x) { return x.item_id === id; });
    return c.length > 0 && c[c.length - 1].by_assistant;
  }
  function renderThreadsIfOpen() { if (S.rail.open && S.rail.tab === "threads") renderThreads(); drawRailTabsIfOpen(); schedulePins(); }
  function drawRailTabsIfOpen() { if (S.rail.open) drawRailTabs(); }
  function renderThreads() {
    var host = $("ppa-threads");
    clear(host);
    var sel = h("select", { id: "ppa-thread-filter", "aria-label": "Show" }, [["open", "Open"], ["resolved", "Resolved or declined"], ["all", "All"]].map(function (o) {
      return h("option", { value: o[0], text: o[1] });
    }));
    sel.value = S.threadFilter;
    sel.addEventListener("change", function () { S.threadFilter = sel.value; renderThreads(); });
    var unanswered = S.items.filter(function (it) { return isOpen(it) && !hasAssistantLast(it.id) && !S.pending[it.id]; });
    host.appendChild(h("div", { class: "ppa-toolbar" }, [
      sel,
      h("button", { type: "button", class: "ppa-btn ppa-small", id: "ppa-threads-refresh", text: "Refresh", onclick: function () { loadFeedbackData().then(renderThreads, function () {}); } }),
      S.collab && isAdmin() && unanswered.length ? h("button", {
        type: "button", class: "ppa-btn ppa-small", id: "ppa-reply-all", text: "Assistant: reply to " + unanswered.length + " waiting",
        onclick: function () { unanswered.reduce(function (p, it) { return p.then(function () { return assistantReply(it.id); }); }, Promise.resolve()); }
      }) : null
    ]));
    if (!S.collab) host.appendChild(h("p", { class: "ppa-note", text: "Replies and resolving are not switched on yet (the database update has not been run). Comments still save." }));
    var shown = S.items.filter(function (it) { return S.threadFilter === "all" || (S.threadFilter === "open") === isOpen(it); });
    if (!shown.length) {
      host.appendChild(h("div", { class: "ppa-howto" }, [
        h("h3", { text: S.items.length ? "Nothing in this view" : "How to use this" }),
        h("ol", {}, [
          h("li", { text: "Read The story, one step at a time. Each step has the claim, a short explanation, the numbers and a way into the data." }),
          h("li", { text: "To comment, press + Comment at the top, then click the number, row, bar or paragraph you mean." }),
          h("li", { text: "To ask a question, open Assistant. It can see which screen you are on and remembers the conversation." })
        ])
      ]));
      return;
    }
    var here = shown.filter(onScreen), rest2 = shown.filter(function (it) { return !onScreen(it); });
    function group(title, list) {
      if (!list.length) return;
      host.appendChild(h("h3", { class: "ppa-thead", text: title + " (" + list.length + ")" }));
      list.forEach(function (it) { host.appendChild(renderThread(it)); });
    }
    group("On this screen", here);
    group(here.length ? "Elsewhere" : "All comments", rest2);
    if (S.openThread) {
      var el = host.querySelector('[data-thread-id="' + S.openThread + '"]');
      if (el) { el.classList.add("ppa-thread-on"); el.scrollIntoView({ block: "nearest" }); }
    }
  }
  function renderThread(it) {
    var t = it.target || {}, comments = S.comments.filter(function (c) { return c.item_id === it.id; });
    var runReplies = S.replies.filter(function (x) { return x.item_id === it.id; });
    var card = h("article", { class: "ppa-thread", "data-thread-id": it.id }, [
      h("header", { class: "ppa-item-head" }, [
        h("strong", { text: nameOf(it.author) }),
        h("span", { class: "ppa-by", text: fmtTime(it.created_at) }),
        h("span", { class: "ppa-status", text: isResolved(it.id) ? "resolved" : it.status }),
        h("span", { class: "ppa-type", text: it.type })
      ]),
      h("button", { type: "button", class: "ppa-btn ppa-link ppa-small ppa-where", text: targetLine(t), title: "Show this on the page", onclick: function () { S.openThread = it.id; goTo(t); } }),
      t.quote ? h("p", { class: "ppa-quote", text: t.quote }) : null,
      h("p", { class: "ppa-text", text: it.text })
    ]);
    comments.forEach(function (c) {
      card.appendChild(h("div", { class: "ppa-c" + (c.by_assistant ? " ppa-c-ai" : "") }, [
        h("p", { class: "ppa-c-head" }, [h("strong", { text: c.by_assistant ? "Assistant" : nameOf(c.author) }), h("span", { class: "ppa-by", text: " " + fmtTime(c.created_at) })]),
        c.by_assistant ? md(c.text) : h("p", { class: "ppa-text", text: c.text })
      ]));
    });
    runReplies.forEach(function (r) {
      card.appendChild(h("div", { class: "ppa-c ppa-c-run" }, [
        h("p", { class: "ppa-c-head" }, [h("strong", { text: "Model run" }), h("span", { class: "ppa-by", text: " " + r.outcome + (r.release ? " · " + r.release : "") })]),
        h("p", { class: "ppa-text", text: r.text })
      ]));
    });
    if (S.pending[it.id]) card.appendChild(h("p", { class: "ppa-note ppa-pending", text: S.pending[it.id] }));
    if (!S.collab) return card;
    var box = h("textarea", { class: "ppa-reply-box", rows: "1", maxlength: "4000", placeholder: "Reply", "aria-label": "Reply" });
    var msg = h("span", { class: "ppa-note" });
    var send = h("button", { type: "button", class: "ppa-btn ppa-small ppa-reply-send", text: "Reply" });
    send.addEventListener("click", function () {
      var text = box.value.trim();
      if (!text) return;
      send.disabled = true;
      authed("/rest/v1/item_comments", { method: "POST", headers: { Prefer: "return=representation" }, json: { item_id: it.id, text: text } }).then(function (r) {
        if (!r.ok) throw new Error("status " + r.status);
        return r.json();
      }).then(function (rows) { S.comments.push(rows[0]); delete S.pending[it.id]; S.openThread = it.id; renderThreads(); })
        .catch(function () { send.disabled = false; msg.textContent = "Could not save. Try again."; });
    });
    var acts = [send];
    if (!hasAssistantLast(it.id) && !S.pending[it.id]) acts.push(h("button", { type: "button", class: "ppa-btn ppa-small ppa-askai", text: "Ask the assistant", onclick: function () { S.openThread = it.id; assistantReply(it.id); } }));
    if (!isResolved(it.id) && (isAdmin() || (S.me && it.author === S.me.user_id))) {
      acts.push(h("button", { type: "button", class: "ppa-btn ppa-small ppa-resolve", text: "Resolve", onclick: function () {
        authed("/rest/v1/item_resolutions", { method: "POST", headers: { Prefer: "return=representation" }, json: { item_id: it.id } }).then(function (r) {
          if (!r.ok) throw new Error("status " + r.status);
          S.resolutions.push({ item_id: it.id, resolved_by: S.me.user_id });
          renderThreadsIfOpen();
        }).catch(function () { msg.textContent = "Could not resolve. Try again."; });
      } }));
    }
    if (isAdmin() && it.status === "new") {
      ["accept", "decline"].forEach(function (which) {
        acts.push(h("button", { type: "button", class: "ppa-btn ppa-small ppa-t-" + which, text: which === "accept" ? "Add to backlog" : "Decline", onclick: function () {
          callFn("decide", { item_id: it.id, decision: which, note: "" }).then(function (r) {
            if (r.ok) { toast(r.body.message || "Recorded."); loadFeedbackData().then(renderThreads, function () {}); }
            else msg.textContent = r.body.message || "Not recorded (" + r.status + ").";
          }, function () { msg.textContent = "Could not reach the server."; });
        } }));
      });
    }
    card.appendChild(box);
    card.appendChild(h("div", { class: "ppa-thread-acts" }, acts.concat([msg])));
    return card;
  }

  // ------------------------------------------------------------ feedback panel
  function loadFeedbackData() {
    return Promise.all([
      rest("items", "?select=*&order=id.desc"),
      rest("decisions", "?select=*&order=id.asc"),
      rest("status_history", "?select=*&order=id.asc"),
      rest("agent_replies", "?select=*&order=id.asc"),
      rest("members", "?select=*"),
      rest("item_comments", "?select=*&order=id.asc").catch(function () { return null; }),
      rest("item_resolutions", "?select=*").catch(function () { return null; })
    ]).then(function (r) {
      S.items = r[0]; S.decisions = r[1]; S.history = r[2]; S.replies = r[3];
      S.collab = Array.isArray(r[5]) && Array.isArray(r[6]);
      S.comments = S.collab ? r[5] : []; S.resolutions = S.collab ? r[6] : [];
      S.members = {};
      r[4].forEach(function (m) { S.members[m.user_id] = m; });
      refreshBadges();
    });
  }
  function isAdmin() { return S.me && S.me.role === "admin"; }
  function nameOf(uid) {
    var m = S.members[uid];
    return m ? m.display_name : "Unknown";
  }
  function openFeedback() {
    var host = $("ppa-feedback");
    S.repliesNote = "";
    var pre = isAdmin() ? callFn("replies").then(function (r) {
      if (!r.ok) S.repliesNote = r.body.message || "";
    }).catch(function () {}) : Promise.resolve();
    pre.then(loadFeedbackData).then(renderFeedback, function () {
      clear(host);
      host.appendChild(h("p", { class: "ppa-error", text: "Could not load the feedback log. Try again." }));
    });
    if (!host.firstChild) host.appendChild(h("p", { class: "ppa-loading", text: "Loading…" }));
  }
  function statusMatches(st) {
    var f = S.filterStatus;
    if (f === "all") return true;
    if (f === "fixed") return st.indexOf("fixed") === 0;
    return st === f;
  }
  function renderFeedback() {
    var host = $("ppa-feedback");
    clear(host);
    var sel = h("select", { id: "ppa-filter-status", "aria-label": "Filter by status" },
      ["all", "new", "in backlog", "answered", "fixed", "backlog", "declined"].map(function (s) {
        return h("option", { value: s, text: s === "all" ? "All statuses" : s });
      }));
    sel.value = S.filterStatus;
    sel.addEventListener("change", function () { S.filterStatus = sel.value; renderFeedback(); });
    var tools = h("div", { class: "ppa-toolbar" }, [
      h("label", { for: "ppa-filter-status", text: "Status" }), sel,
      S.filterTarget ? h("button", { type: "button", class: "ppa-chip", id: "ppa-clear-target", text: "On one item only ✕", onclick: function () { S.filterTarget = null; renderFeedback(); } }) : null,
      h("button", { type: "button", class: "ppa-btn ppa-small", id: "ppa-fb-refresh", text: "Refresh", onclick: openFeedback })
    ]);
    host.appendChild(tools);
    if (S.repliesNote) host.appendChild(h("p", { class: "ppa-note", text: S.repliesNote }));
    var list = h("div", { class: "ppa-items", id: "ppa-items" });
    var shown = S.items.filter(function (it) {
      return statusMatches(it.status) && (!S.filterTarget || targetKey(it.target) === S.filterTarget);
    });
    if (!shown.length) list.appendChild(h("p", { class: "ppa-empty", text: "Nothing here yet." }));
    shown.forEach(function (it) { list.appendChild(renderItem(it)); });
    host.appendChild(list);
  }
  function renderItem(it) {
    var hist = S.history.filter(function (x) { return x.item_id === it.id; });
    var dec = S.decisions.filter(function (x) { return x.item_id === it.id; })[0];
    var reps = S.replies.filter(function (x) { return x.item_id === it.id; });
    var card = h("article", { class: "ppa-item", "data-item-id": it.id }, [
      h("header", { class: "ppa-item-head" }, [
        h("strong", { text: "#" + it.id }),
        h("span", { class: "ppa-type", text: it.type }),
        h("span", { class: "ppa-status", text: it.status }),
        h("span", { class: "ppa-by", text: nameOf(it.author) + " · " + fmtTime(it.created_at) })
      ]),
      h("p", { class: "ppa-target", text: "On: " + targetLine(it.target) + "  (release " + it.release + ")" }),
      h("p", { class: "ppa-text", text: it.text })
    ]);
    if (hist.length) {
      card.appendChild(h("ol", { class: "ppa-history", "aria-label": "Status history" }, hist.map(function (x) {
        return h("li", { text: x.status + " · " + nameOf(x.changed_by) + " · " + fmtTime(x.changed_at) + (x.note ? " · " + x.note : "") });
      })));
    }
    if (dec) {
      var line = (dec.decision === "accept" ? "Accepted" : "Declined") + " by " + nameOf(dec.decided_by) + ", " + fmtTime(dec.decided_at);
      card.appendChild(h("p", { class: "ppa-decision", text: line + (dec.note ? ". Note: " + dec.note : "") }));
      if (dec.decision === "accept" && dec.commit_status) {
        card.appendChild(h("p", { class: "ppa-note", text: "Repo queue: " + dec.commit_status + (dec.commit_ref ? " (" + dec.commit_ref + ")" : "") }));
        if (isAdmin() && dec.commit_status !== "committed") {
          card.appendChild(h("button", { type: "button", class: "ppa-btn ppa-small ppa-retry", text: "Retry commit", onclick: function () { retryCommit(dec.id); } }));
        }
      }
    }
    reps.forEach(function (r) {
      card.appendChild(h("div", { class: "ppa-reply" }, [
        h("p", { class: "ppa-reply-head", text: "Reply (" + r.outcome + ") · release " + (r.release || "") + (r.run_ref ? " · run " + r.run_ref : "") + (r.commit_ref ? " · " + r.commit_ref : "") }),
        h("p", { class: "ppa-reply-text", text: r.text })
      ]));
    });
    if (isAdmin() && it.status === "new") {
      var note = h("textarea", { class: "ppa-decide-note", rows: "2", maxlength: "1000", placeholder: "Note (optional)" });
      var msg = h("p", { class: "ppa-msg", role: "status" });
      var acc = h("button", { type: "button", class: "ppa-btn ppa-primary ppa-accept", text: "Accept" });
      var dec2 = h("button", { type: "button", class: "ppa-btn ppa-decline", text: "Decline" });
      function decide(which) {
        acc.disabled = true; dec2.disabled = true;
        msg.textContent = "Saving…";
        callFn("decide", { item_id: it.id, decision: which, note: note.value }).then(function (r) {
          if (r.ok) { toast(r.body.message || "Recorded."); openFeedback(); }
          else { acc.disabled = false; dec2.disabled = false; msg.textContent = r.body.message || "Not recorded (" + r.status + ")."; }
        }, function () { acc.disabled = false; dec2.disabled = false; msg.textContent = "Could not reach the server."; });
      }
      acc.addEventListener("click", function () { decide("accept"); });
      dec2.addEventListener("click", function () { decide("decline"); });
      card.appendChild(h("div", { class: "ppa-decide" }, [note, h("div", { class: "ppa-row" }, [acc, dec2]), msg]));
    }
    return card;
  }
  function retryCommit(id) {
    callFn("retry_commit", { decision_id: id }).then(function (r) {
      toast(r.body.message || "Done.");
      openFeedback();
    }).catch(function () { toast("Could not reach the server."); });
  }

  
// ------------------------------------------------------------ user management (administrator only; the function enforces it)
function openUsers() {
  var host = $("ppa-users");
  clear(host);
  host.appendChild(h("p", { class: "ppa-loading", text: "Loading…" }));
  callFn("users_list").then(function (r) {
    if (!r.ok) { clear(host); host.appendChild(h("p", { class: "ppa-error", text: r.body.message || "Could not load users (" + r.status + ")." })); return; }
    renderUsers(r.body.users || []);
  }, function () { clear(host); host.appendChild(h("p", { class: "ppa-error", text: "Could not reach the server." })); });
}
function renderUsers(list) {
  var host = $("ppa-users");
  clear(host);
  var msg = h("p", { class: "ppa-msg", role: "status", id: "ppa-users-msg" });
  if (window.MutationObserver) new MutationObserver(function () { if (msg.textContent) toast(msg.textContent); }).observe(msg, { childList: true, characterData: true, subtree: true });
  host.appendChild(h("h2", { text: "Users" }));
  host.appendChild(h("p", { class: "ppa-note", text: "Passwords are at least 12 characters. They are sent once to set the account and are never shown or stored here. Tell each person their password directly." }));
  host.appendChild(msg);
  list.forEach(function (u) {
    var pw = h("input", { type: "password", autocomplete: "new-password", placeholder: "New password", "aria-label": "New password for " + u.display_name });
    var setBtn = h("button", { type: "button", class: "ppa-btn ppa-small", text: "Set password" });
    var actBtn = h("button", { type: "button", class: "ppa-btn ppa-small", text: u.active ? "Deactivate" : "Reactivate" });
    setBtn.addEventListener("click", function () {
      if (!pw.value) { msg.textContent = "Type a new password first."; return; }
      setBtn.disabled = true;
      callFn("user_password", { user_id: u.user_id, password: pw.value }).then(function (r) {
        setBtn.disabled = false;
        msg.textContent = r.body.message || (r.ok ? "Done." : "Not changed (" + r.status + ").");
        if (r.ok) pw.value = "";
      }, function () { setBtn.disabled = false; msg.textContent = "Could not reach the server."; });
    });
    actBtn.addEventListener("click", function () {
      actBtn.disabled = true;
      callFn("user_active", { user_id: u.user_id, active: !u.active }).then(function (r) {
        msg.textContent = r.body.message || (r.ok ? "Done." : "Not changed (" + r.status + ").");
        if (r.ok) openUsers(); else actBtn.disabled = false;
      }, function () { actBtn.disabled = false; msg.textContent = "Could not reach the server."; });
    });
    host.appendChild(h("article", { class: "ppa-item ppa-user" + (u.active ? "" : " ppa-user-off") }, [
      h("header", { class: "ppa-item-head" }, [
        h("strong", { text: u.display_name }),
        h("span", { class: "ppa-type", text: u.role }),
        h("span", { class: "ppa-status", text: u.active ? "active" : "deactivated" }),
        h("span", { class: "ppa-by", text: (u.email || "") + (u.last_sign_in_at ? " · last in " + fmtTime(u.last_sign_in_at) : " · never signed in") })
      ]),
      h("div", { class: "ppa-row" }, [pw, setBtn, actBtn])
    ]));
  });
  var em = h("input", { type: "email", id: "ppa-new-email", autocomplete: "off", placeholder: "name@example.com", "aria-label": "Email address" });
  var nm = h("input", { type: "text", id: "ppa-new-name", maxlength: "80", autocomplete: "off", placeholder: "Name shown to others", "aria-label": "Name" });
  var np = h("input", { type: "password", id: "ppa-new-pass", autocomplete: "new-password", placeholder: "Password (12+ characters)", "aria-label": "Password" });
  var add = h("button", { type: "button", class: "ppa-btn ppa-primary", id: "ppa-new-add", text: "Add user" });
  add.addEventListener("click", function () {
    add.disabled = true;
    callFn("user_add", { email: em.value, display_name: nm.value, password: np.value }).then(function (r) {
      add.disabled = false;
      msg.textContent = r.body.message || (r.ok ? "Added." : "Not added (" + r.status + ").");
      if (r.ok) openUsers();
    }, function () { add.disabled = false; msg.textContent = "Could not reach the server."; });
  });
  host.appendChild(h("h3", { text: "Add a user" }));
  host.appendChild(h("div", { class: "ppa-form" }, [em, nm, np, add]));
}

// ------------------------------------------------------------ keyboard
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if ($("ppa-modal-root").firstChild) clear($("ppa-modal-root"));
    else if (S.cmode) setCommentMode(false);
    else if (S.rail.open) closeRail();
  });

  // ------------------------------------------------------------ go
  var flash = sessionStorage.getItem(FLASH_KEY);
  sessionStorage.removeItem(FLASH_KEY);
  loadSession();
  if (S.session && S.session.access_token) { scheduleRefresh(); bootstrap(); }
  else showLogin(flash);
})();
