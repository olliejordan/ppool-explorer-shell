// Profit Pool Explorer shell: sign-in, data download, ask drawer, comments, feedback panel.
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
    answers: [], markUrl: null, refreshing: null, repliesNote: ""
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
    var step1 = h("form", { class: "ppa-form", id: "ppa-step-email" }, [
      h("label", { for: "ppa-email", text: "Email address" }), email, send
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
        loadFeedbackData().catch(function () {})
      ]);
    }).then(function (res) {
      if (!res) return;
      S.meta = res[0].meta || {};
      S.markUrl = res[1] ? URL.createObjectURL(res[1]) : null;
      drawBar();
      clear(host);
      window.PPExplorer.mount({
        data: res[0], root: host, markUrl: S.markUrl, actions: { decorate: decorate }
      });
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
    var who = S.me ? S.me.display_name + (S.me.role === "admin" ? " (admin)" : "") : "";
    bar.appendChild(h("span", { class: "ppa-bar-title", text: "Profit Pool Explorer" }));
    bar.appendChild(tabs);
    bar.appendChild(h("span", { class: "ppa-spacer" }));
    bar.appendChild(h("span", { class: "ppa-who", id: "ppa-who", text: who }));
    bar.appendChild(h("button", { type: "button", class: "ppa-btn ppa-small", id: "ppa-signout", text: "Sign out", onclick: function () { signOut(); } }));
    markTabs();
  }
  function markTabs() {
    ["explorer", "feedback"].forEach(function (v) {
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
    $("ppa-feedback").hidden = v !== "feedback";
    markTabs();
    if (v === "feedback") openFeedback();
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
      type: "button", class: "ppa-badge", onclick: function () { S.filterTarget = key; S.filterStatus = "all"; setView("feedback"); }
    });
    paintBadge(badge, key);
    S.badges.push({ el: badge, key: key });
    el.appendChild(h("button", { type: "button", class: "ppa-btn ppa-small ppa-ask", text: "Ask", onclick: function () { openAsk(target); } }));
    el.appendChild(h("button", { type: "button", class: "ppa-btn ppa-small ppa-comment", text: "Comment", onclick: function () { openComment(target); } }));
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

  // ------------------------------------------------------------ ask drawer
  function openAsk(target) {
    var d = $("ppa-drawer");
    d.hidden = false;
    clear(d);
    var max = C.ASK_MAX_CHARS || 2000;
    var box = h("textarea", { id: "ppa-ask-text", rows: "4", maxlength: String(max), placeholder: "Ask about the model, an assumption, or what you are looking at" });
    var count = h("span", { class: "ppa-count", text: "0 / " + max });
    var status = h("p", { class: "ppa-msg", id: "ppa-ask-status", role: "status" });
    var quota = h("p", { class: "ppa-quota", id: "ppa-ask-quota" });
    var answers = h("div", { class: "ppa-answers", id: "ppa-answers" });
    var send = h("button", { type: "button", class: "ppa-btn ppa-primary", id: "ppa-ask-send", text: "Ask" });
    box.addEventListener("input", function () { count.textContent = box.value.length + " / " + max; });
    d.appendChild(h("div", { class: "ppa-drawer-head" }, [
      h("h2", { text: "Ask about the model" }),
      h("button", { type: "button", class: "ppa-btn ppa-small", id: "ppa-ask-close", text: "Close", onclick: closeDrawer })
    ]));
    d.appendChild(h("p", { class: "ppa-from" }, [h("strong", { text: "Asking from: " }), h("span", { id: "ppa-ask-from", text: targetLine(target) })]));
    d.appendChild(box);
    d.appendChild(h("div", { class: "ppa-row" }, [count, send]));
    d.appendChild(status);
    d.appendChild(quota);
    d.appendChild(answers);
    paintAnswers(answers);
    box.focus();

    callFn("quota").then(function (r) {
      if (r.ok && r.body.remaining) paintQuota(quota, r.body.remaining);
    }).catch(function () {});

    send.addEventListener("click", function () {
      var q = box.value.trim();
      if (!q) { status.textContent = "Type a question first."; return; }
      send.disabled = true;
      status.textContent = "Thinking…";
      callFn("ask", { question: q, target: target }).then(function (r) {
        send.disabled = false;
        if (r.ok && r.body.answer) {
          S.answers.unshift({ q: q, a: r.body.answer, from: targetLine(target), truncated: !!r.body.truncated });
          box.value = ""; count.textContent = "0 / " + max;
          status.textContent = "";
          paintAnswers(answers);
          if (r.body.remaining) paintQuota(quota, r.body.remaining);
        } else {
          status.textContent = r.body.message || "The question could not be answered (" + r.status + ").";
          if (r.body.remaining) paintQuota(quota, r.body.remaining);
        }
      }, function () { send.disabled = false; status.textContent = "Could not reach the server. Try again."; });
    });
  }
  function paintQuota(el, rem) {
    var n = rem.effective !== undefined ? rem.effective : Math.min(rem.user, rem.total);
    el.textContent = n + (n === 1 ? " question" : " questions") + " left this month";
  }
  function paintAnswers(el) {
    clear(el);
    S.answers.forEach(function (a) {
      el.appendChild(h("div", { class: "ppa-qa" }, [
        h("p", { class: "ppa-q", text: a.q }),
        h("p", { class: "ppa-a", text: a.a }),
        a.truncated ? h("p", { class: "ppa-note", text: "The answer was cut at the length limit." }) : null,
        h("p", { class: "ppa-note", text: "From: " + a.from })
      ]));
    });
  }
  function closeDrawer() { $("ppa-drawer").hidden = true; }

  // ------------------------------------------------------------ comment form
  function openComment(target) {
    var root = $("ppa-modal-root");
    clear(root);
    var max = C.COMMENT_MAX_CHARS || 4000;
    var type = h("select", { id: "ppa-comment-type" }, TYPES.map(function (t) { return h("option", { value: t, text: t }); }));
    var box = h("textarea", { id: "ppa-comment-text", rows: "6", maxlength: String(max), placeholder: "What would you like to say about this?" });
    var count = h("span", { class: "ppa-count", text: "0 / " + max });
    var status = h("p", { class: "ppa-msg", id: "ppa-comment-status", role: "status" });
    var save = h("button", { type: "button", class: "ppa-btn ppa-primary", id: "ppa-comment-save", text: "Save" });
    function close() { clear(root); }
    box.addEventListener("input", function () { count.textContent = box.value.length + " / " + max; });
    var modal = h("div", { class: "ppa-modal", role: "dialog", "aria-modal": "true", "aria-label": "Add a comment" }, [
      h("h2", { text: "Add to the feedback log" }),
      h("p", { class: "ppa-from" }, [h("strong", { text: "About: " }), h("span", { text: targetLine(target) })]),
      h("label", { for: "ppa-comment-type", text: "Type" }), type,
      h("label", { for: "ppa-comment-text", text: "Your comment" }), box,
      h("div", { class: "ppa-row" }, [count]),
      status,
      h("div", { class: "ppa-row ppa-end" }, [
        h("button", { type: "button", class: "ppa-btn", id: "ppa-comment-cancel", text: "Cancel", onclick: close }), save
      ])
    ]);
    root.appendChild(h("div", { class: "ppa-overlay" }, [modal]));
    box.focus();
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
        close();
        if (S.view === "feedback") openFeedback();
      }).catch(function () { save.disabled = false; status.textContent = "Could not save. Try again."; });
    });
  }

  // ------------------------------------------------------------ feedback panel
  function loadFeedbackData() {
    return Promise.all([
      rest("items", "?select=*&order=id.desc"),
      rest("decisions", "?select=*&order=id.asc"),
      rest("status_history", "?select=*&order=id.asc"),
      rest("agent_replies", "?select=*&order=id.asc"),
      rest("members", "?select=*")
    ]).then(function (r) {
      S.items = r[0]; S.decisions = r[1]; S.history = r[2]; S.replies = r[3];
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

  // ------------------------------------------------------------ keyboard
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if ($("ppa-modal-root").firstChild) clear($("ppa-modal-root"));
    else if (!$("ppa-drawer").hidden) closeDrawer();
  });

  // ------------------------------------------------------------ go
  var flash = sessionStorage.getItem(FLASH_KEY);
  sessionStorage.removeItem(FLASH_KEY);
  loadSession();
  if (S.session && S.session.access_token) { scheduleRefresh(); bootstrap(); }
  else showLogin(flash);
})();
