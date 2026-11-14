/* Profit Pool Explorer: the whole UI. Plain ES2020, no modules, no network calls.
   Public-shell rule (notes/explorer/CONTRACT.md): this file holds UI chrome only. Every sentence about the model, every
   figure and every dimension member lives in data.json (texts, figs, tables, dims). The mark arrives as markUrl. */
(function () {
  "use strict";

  var D = null, ROOT = null, ACTIONS = null, MARK = null;
  var S = { tab: "universe", basis: "net_assets", scenario: "central", measure: "revenue", f: {}, focus: {}, dim: "line", view: "drill", xr: "product", xc: "region", xs: "abs", xh: "bars" };
  var US = { i: 0, sc: "central" };
  var BI = 0;
  var ACT = [];
  var CI = {};          // column index maps per cube
  var DIMS = {};
  var SCEN = ["low", "central", "high"];
  var SCEN_LABEL = { low: "Low", central: "Central", high: "High" };
  var MEASURES = { revenue: "rev", profit: "profit", balances: "bal" };
  var MEASURE_LABEL = { revenue: "Revenue", profit: "Profit", balances: "Banking balances" };
  var BASIS_KEY = { net_assets: "cube", investable: "cube_inv" };
  var ORDER = ["line", "product", "segment", "geo", "region", "sector", "band"];
  var CLS_ORDER = ["Observed", "Derived", "Modelled", "Assumption"];

  // ------------------------------------------------------------------ small helpers
  function $(sel, el) { return (el || ROOT).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || ROOT).querySelectorAll(sel)); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function lc(s) { return String(s).charAt(0).toLowerCase() + String(s).slice(1); }
  var NF = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
  function nf(v, d) { return v.toLocaleString("en-GB", { maximumFractionDigits: d, minimumFractionDigits: d }); }
  function sg(v) { return v < 0 ? "\u2212" : ""; }

  // formatters named in data.json (figs[*].f, tables[*].cols[*].f); money in GBP m, shares 0-1 unless named otherwise
  var FMT = {
    bn: function (v) { var a = Math.abs(v) / 1000; return sg(v) + "\u00a3" + (a >= 1000 ? nf(a / 1000, 2) + "tn" : nf(a, a < 100 ? 1 : 0) + "bn"); },
    m0: function (v) { var a = Math.abs(v); return sg(v) + "\u00a3" + nf(a, a < 10 ? 1 : 0) + "m"; },
    tn: function (v) { return sg(v) + "\u00a3" + nf(Math.abs(v) / 1e6, 2) + "tn"; },
    k: function (v) { return NF.format(Math.round(v / 1000)) + "k"; },
    int: function (v) { return NF.format(Math.round(v)); },
    pct0: function (v) { return sg(v) + NF.format(Math.round(Math.abs(v) * 100)) + "%"; },
    pct1: function (v) { return sg(v) + nf(Math.abs(v) * 100, 1) + "%"; },
    pct0s: function (v) { var r = Math.round(v * 100); return (r > 0 ? "+" : r < 0 ? "\u2212" : "") + NF.format(Math.abs(r)) + "%"; },
    pp0s: function (v) { var r = Math.round(v); return (r > 0 ? "+" : r < 0 ? "\u2212" : "") + NF.format(Math.abs(r)) + "%"; },
    gbm2: function (v) { return "\u00a3" + nf(v, 1) + "m"; },
    gbp0: function (v) { return sg(v) + "\u00a3" + NF.format(Math.abs(Math.round(v))); },
    x1: function (v) { return nf(v, 1) + "\u00d7"; },
    text: function (v) { return String(v); }
  };
  function fmtv(f, v) { return v == null ? "\u2013" : (FMT[f] || FMT.m0)(v); }
  function fmtM(v) { // explorer cell values: GBP m below 1,000, GBP bn above
    if (v == null) return "\u2013";
    var a = Math.abs(v);
    return sg(v) + "\u00a3" + (a >= 1000 ? nf(a / 1000, 2) + "bn" : nf(a, a < 10 ? 1 : 0) + "m");
  }

  // ------------------------------------------------------------------ text fill ({fig}, {fig.low}, {meta.release}, extras)
  function figVal(key, sc) {
    var f = D.figs[key];
    if (!f) return undefined;
    var v = f.v;
    if (v !== null && typeof v === "object") v = v[sc || "central"];
    return v;
  }
  function fill(t, sc, extra) {
    if (t == null) return "";
    return String(t).replace(/\{([A-Za-z0-9_.]+)\}/g, function (m, k) {
      if (extra && k in extra) return extra[k];
      if (k === "scenario_name") return lc(SCEN_LABEL[sc || "central"]);
      if (k.indexOf("meta.") === 0) return D.meta[k.slice(5)];
      var parts = k.split("."), s = sc;
      if (parts.length > 1 && SCEN.indexOf(parts[parts.length - 1]) >= 0) { s = parts.pop(); k = parts.join("."); }
      var f = D.figs[k];
      if (!f) return m;
      return fmtv(f.f, figVal(k, s));
    });
  }
  function T() { return D.texts; }
  function tx(path) { var o = D.texts, p = path.split("."); for (var i = 0; i < p.length; i++) { if (o == null) return ""; o = o[p[i]]; } return o == null ? "" : o; }

  // ------------------------------------------------------------------ dimensions
  function byId(arr) { var m = {}; arr.forEach(function (x) { m[x.id] = x; }); return m; }
  function buildDims() {
    var d = D.dims, P = byId(d.products), SG = byId(d.segments), SC = byId(d.sectors), RG = byId(d.regions), LN = {};
    d.lines.forEach(function (l) { LN[l.code] = l; });
    var lineOf = function (p) { return P[p].line; };
    var map = {};
    (d.sector_display_map || []).forEach(function (m) { map[m.segment + ":" + m.from] = m.to; });
    DIMS = {
      line: { label: "Product line", key: function (r) { return lineOf(r[CI.product]); }, name: function (k) { return LN[k].name; }, short: function (k) { return LN[k].short; } },
      product: { label: "Product", key: function (r) { return r[CI.product]; }, name: function (k) { return P[k].name; }, short: function (k) { return P[k].short; }, sub: function (k) { return P[k].method; } },
      geo: { label: "Geography", key: function (r) { return RG[d.regions[r[CI.region]].id].geo; }, name: function (k) { return k === "NI" ? "Northern Ireland" : "Great Britain"; }, short: function (k) { return k; } },
      region: { label: "Region", key: function (r) { return d.regions[r[CI.region]].id; }, name: function (k) { return RG[k].name; }, short: function (k) { return RG[k].short; } },
      segment: { label: "Segment", key: function (r) { return r[CI.segment]; }, name: function (k) { return SG[k].name; }, short: function (k) { return SG[k].short; } },
      sector: { label: "Sector", key: function (r) { var s = r[CI.sector]; return map[r[CI.segment] + ":" + s] || s; }, name: function (k) { return SC[k].name; }, short: function (k) { return SC[k].short; } },
      band: { get label() { return S.basis === "net_assets" ? "Net-assets band" : "Investable band"; }, key: function (r) { return r[CI.band]; },
        name: function (k) { return bandList().filter(function (b) { return b.id == k; })[0].name; }, short: function (k) { return bandList().filter(function (b) { return b.id == k; })[0].short || bandList().filter(function (b) { return b.id == k; })[0].name; } }
    };
    DIMS._lineOf = lineOf;
  }
  function bandList() { return S.basis === "net_assets" ? D.dims.bands : D.dims.inv_bands; }
  function cubeRows() { return D[BASIS_KEY[S.basis]]; }
  function setCI() {
    var cols = D.meta.schema.cube_cols[BASIS_KEY[S.basis]];
    CI = {}; cols.forEach(function (c, i) { CI[c] = i; });
  }
  function colOf(sc) { return MEASURES[S.measure] + "_" + sc; }
  function val(r, sc) { return r[CI[colOf(sc || S.scenario)]]; }
  function F() { var o = {}; Object.keys(S.f).forEach(function (k) { o[k] = S.f[k]; }); if (S.view === "xt") Object.keys(S.focus).forEach(function (k) { o[k] = S.focus[k]; }); return o; }
  function availDims() {
    return ORDER.filter(function (d) {
      return !(d in S.f) && !(d === "line" && "product" in S.f) && !(d === "geo" && "region" in S.f) && !(d === "sector" && S.basis !== "net_assets");
    });
  }
  function filtered(all) {
    var f = S.f, ks = Object.keys(f);
    return cubeRows().filter(function (r) {
      if (!all && S.measure === "balances" && r[CI.bal_central] == null) return false;
      for (var i = 0; i < ks.length; i++) if (DIMS[ks[i]].key(r) != f[ks[i]]) return false;
      return true;
    });
  }
  function agg(rows, dim) {
    var m = new Map(), K = DIMS[dim].key;
    rows.forEach(function (r) {
      var k = K(r), a = m.get(k);
      if (!a) { a = { k: k, l: 0, c: 0, h: 0 }; m.set(k, a); }
      a.l += val(r, "low") || 0; a.c += val(r, "central") || 0; a.h += val(r, "high") || 0;
    });
    return Array.from(m.values());
  }
  function cur(a) { return a[S.scenario === "low" ? "l" : S.scenario === "high" ? "h" : "c"]; }
  function spreadClass(l, h) { if (!(l > 0)) return "na"; var x = h / l; return x <= 3 ? "ok" : x <= 6 ? "mid" : "wide"; }
  function spreadPill(l, h) {
    if (!(l > 0)) return '<span class="pp-pill na">n/a</span>';
    return '<span class="pp-pill ' + spreadClass(l, h) + '" title="High pool \u00f7 low pool">' + nf(h / l, 1) + "\u00d7</span>";
  }
  function keyOf(d, k) { return isNaN(+k) || d === "region" || d === "line" || d === "geo" ? k : +k; }
  function lineOfSel(f) { return f.product ? DIMS._lineOf(+f.product) : f.line || null; }

  // ------------------------------------------------------------------ actions (the app decorates items through this hook)
  function act(kind, ctx) {
    if (!ACTIONS || typeof ACTIONS.decorate !== "function") return "";
    ACT.push({ kind: kind, ctx: ctx });
    return '<div class="pp-actions" data-act="' + (ACT.length - 1) + '"></div>';
  }
  function decorateAll(scope) {
    if (!ACTIONS || typeof ACTIONS.decorate !== "function") return;
    $$(".pp-actions[data-act]", scope).forEach(function (el) {
      var a = ACT[+el.getAttribute("data-act")];
      if (a) ACTIONS.decorate(a.kind, a.ctx, el);
    });
  }
  function selFilters(f) {
    var o = { line: null, product: null, geo: null, region: null, band: null, segment: null, sector: null };
    Object.keys(f).forEach(function (k) { o[k] = f[k]; });
    return o;
  }
  function selLabel(f) {
    var parts = [];
    ORDER.forEach(function (d) { if (d in f) parts.push(DIMS[d].name(f[d])); });
    return parts.length ? parts.join(" \u00b7 ") : tx("explore.crumb_all");
  }

  // ------------------------------------------------------------------ shell
  function shell() {
    var t = T();
    ROOT.classList.add("pp-root");
    ROOT.innerHTML =
      '<div class="pp-wrap">' +
      '<header class="pp-head"><div class="pp-headtxt"><div class="pp-eyebrow">' + esc(t.eyebrow) + '</div><h1>' + esc(t.title) + '</h1>' +
      '<div class="pp-sub" id="pp-snap"></div></div>' +
      '<div class="pp-headr"><button class="pp-theme" id="pp-theme" aria-label="Switch light and dark" title="Switch light and dark">Theme</button>' +
      (MARK ? '<img class="pp-mark" src="' + esc(MARK) + '" alt="">' : "") + "</div></header>" +
      '<div class="pp-conf" id="pp-conf">' + esc(t.confidential) + "</div>" +
      '<nav class="pp-tabs" id="pp-tabs" aria-label="Sections">' +
      '<a href="#universe" data-t="universe"><b>1</b> Size the universe</a><a href="#build" data-t="build"><b>2</b> How the model is built</a><a href="#explore" data-t="explore"><b>3</b> Explore the pools</a></nav>' +
      '<section id="pp-t-universe" class="pp-tab"><div class="pp-card pp-exec" id="pp-exec"></div>' +
      '<div class="pp-card"><div class="pp-stephead"><div class="pp-dots" id="pp-udots"></div>' + scenSeg("pp-uscen") + '</div><div id="pp-ustep" class="pp-stepbody"></div>' +
      '<div class="pp-stepnav"><button class="pp-btn" id="pp-uprev">\u2190 Back</button><button class="pp-btn primary" id="pp-unext">Next \u2192</button></div></div></section>' +
      '<section id="pp-t-build" class="pp-tab" hidden><div class="pp-card"><h2>' + esc(tx("build.heading")) + '</h2><p class="pp-lede">' + esc(fill(tx("build.intro"))) + '</p>' +
      '<div class="pp-buildgrid"><ol class="pp-blist" id="pp-blist"></ol><div class="pp-bdetail" id="pp-bdetail"></div></div></div></section>' +
      '<section id="pp-t-explore" class="pp-tab" hidden>' + exploreHTML() + "</section>" +
      '<footer class="pp-foot"><p>' + esc(fill(tx("foot.grain"))) + '</p><p>' + esc(fill(tx("foot.display_map"))) + '</p><p class="pp-caveat">' + esc(tx("caveat_range")) + "</p></footer></div>";
    $("#pp-snap").innerHTML = fill(tx("snap"), "central");
  }
  function scenSeg(id) {
    return '<div class="pp-seg" role="group" aria-label="Scenario" id="' + id + '">' + SCEN.map(function (s) { return '<button data-s="' + s + '" aria-pressed="' + (s === "central") + '">' + SCEN_LABEL[s] + "</button>"; }).join("") + "</div>";
  }
  function exploreHTML() {
    return '<div class="pp-top"><div class="pp-banner" id="pp-banner">' + esc(fill(tx("explore.banner"))) + '</div>' +
      '<div class="pp-controls">' +
      '<div class="pp-seg" role="group" aria-label="Band basis" id="pp-basis"><button data-b="net_assets" aria-pressed="true">Net-assets bands</button><button data-b="investable" aria-pressed="false">Investable bands</button></div>' +
      '<div class="pp-seg" role="group" aria-label="Measure" id="pp-measure"><button data-m="revenue" aria-pressed="true">Revenue</button><button data-m="profit" aria-pressed="false">Profit</button><button data-m="balances" aria-pressed="false">Banking balances</button></div>' +
      '<div class="pp-seg" role="group" aria-label="Scenario" id="pp-scen"><button data-s="low" aria-pressed="false">Low</button><button data-s="central" aria-pressed="true">Central</button><button data-s="high" aria-pressed="false">High</button></div></div></div>' +
      '<div class="pp-note" id="pp-basisnote" hidden></div>' +
      '<div class="pp-tiles" id="pp-tiles"></div>' +
      '<div class="pp-main" id="pp-main"><div class="pp-card">' +
      '<div class="pp-viewbar"><div class="pp-seg" role="group" aria-label="View" id="pp-view"><button data-v="drill" aria-pressed="true">Drill list</button><button data-v="xt" aria-pressed="false">Cross-tab</button></div><div class="pp-crumbs" id="pp-crumbs"></div></div>' +
      '<div id="pp-drillv"><div class="pp-drillby"><label for="pp-dim">Break down by</label><select id="pp-dim"></select><span class="pp-muted" id="pp-hint">Click a row to drill in.</span></div>' +
      '<div class="pp-tbl"><div class="pp-hd"><div>Item</div><div class="r" id="pp-hval">Central</div><div class="c3">Low \u00b7 central \u00b7 high</div><div class="r" title="High-pool value divided by low-pool value">Spread</div></div><div id="pp-rows"></div></div></div>' +
      '<div id="pp-xtv" hidden><div class="pp-drillby"><label for="pp-xr">Rows</label><select id="pp-xr"></select><label for="pp-xc">Columns</label><select id="pp-xc"></select>' +
      '<label for="pp-xs">Show</label><select id="pp-xs"><option value="abs">Value</option><option value="row">% of row</option><option value="col">% of column</option></select>' +
      '<label for="pp-xl">Business line</label><select id="pp-xl"></select>' +
      '<label for="pp-xh">Display</label><select id="pp-xh"><option value="bars">Data bars</option><option value="size">Heat map</option><option value="spread">Spread (confidence)</option></select></div>' +
      '<span class="pp-muted pp-small">Use Business line to narrow to one line. With products as rows, each business line gets its own subheading and subtotal. Click a cell for its method and assumptions; click a heading to filter; hover a cell for its low\u2013high range.</span>' +
      '<div class="pp-xtwrap"><table class="pp-xt" id="pp-xt"></table></div></div></div>' +
      '<div class="pp-card pp-audit" id="pp-audit"></div></div>';
  }

  // ------------------------------------------------------------------ tab 3: tiles, drill, cross-tab
  function renderExplore() {
    var rows = filtered(), tot = { l: 0, c: 0, h: 0, p: 0, b: 0 };
    filtered(true).forEach(function (r) {
      tot.l += r[CI.rev_low] || 0; tot.c += r[CI.rev_central] || 0; tot.h += r[CI.rev_high] || 0; tot.p += r[CI.profit_central] || 0; tot.b += r[CI.bal_central] || 0;
    });
    var tiles = [
      [fmtM(tot.c), "Revenue, central", true],
      [fmtM(tot.l) + " \u2013 " + fmtM(tot.h), "Revenue, low to high pool"],
      [fmtM(tot.p), "Profit, central"],
      [tot.b ? fmtM(tot.b) : "\u2013", "Banking balances, central"],
      [spreadPill(tot.l, tot.h), "Spread for this selection" + '<details class="pp-ex"><summary>What\u2019s this?</summary><p>' + esc(fill(tx("explore.spread_explain"), "central", { spread_now: tot.l > 0 ? nf(tot.h / tot.l, 1) + "\u00d7" : "n/a" })) + "</p></details>"]
    ];
    $("#pp-tiles").innerHTML = tiles.map(function (a) { return '<div class="pp-tile"><b' + (a[2] ? ' class="gold"' : "") + ">" + a[0] + "</b><span>" + a[1] + "</span></div>"; }).join("");
    var fk = Object.keys(S.f);
    $("#pp-crumbs").innerHTML = '<button class="pp-crumb all" data-clear="*">' + esc(tx("explore.crumb_all")) + "</button>" +
      fk.map(function (d) { return '<span class="pp-muted">\u203a</span><button class="pp-crumb" data-clear="' + d + '" title="Remove this filter">' + esc(DIMS[d].label + ": " + DIMS[d].name(S.f[d])) + " \u2715</button>"; }).join("");
    $("#pp-main").classList.toggle("wide", S.view === "xt");
    $("#pp-drillv").hidden = S.view === "xt"; $("#pp-xtv").hidden = S.view !== "xt";
    var bn = $("#pp-basisnote"); bn.hidden = S.basis === "net_assets"; bn.textContent = S.basis === "net_assets" ? "" : tx("explore.inv_note");
    if (S.view === "xt") { renderXT(); renderAudit(); return; }
    var avail = availDims();
    if (avail.indexOf(S.dim) < 0) S.dim = avail[0];
    $("#pp-dim").innerHTML = avail.map(function (d) { return '<option value="' + d + '"' + (d === S.dim ? " selected" : "") + ">" + esc(DIMS[d].label) + "</option>"; }).join("");
    $("#pp-hval").textContent = MEASURE_LABEL[S.measure] + ", " + lc(SCEN_LABEL[S.scenario]);
    var g = agg(rows, S.dim).filter(function (a) { return a.c > 0.0005 || a.h > 0.0005; }).sort(function (a, b) { return S.dim === "band" ? a.k - b.k : cur(b) - cur(a); });
    var max = Math.max.apply(null, g.map(function (a) { return a.h; }).concat([1e-9]));
    var leaf = avail.length <= 1, d = DIMS[S.dim];
    $("#pp-rows").innerHTML = g.length ? g.map(function (a) {
      var sub = d.sub ? "<small>" + esc(d.sub(a.k)) + "</small>" : "";
      var bar = '<div class="pp-bar"><div class="rng" style="left:' + a.l / max * 100 + "%;width:" + Math.max((a.h - a.l) / max * 100, 0.5) + '%"></div><div class="mid" style="left:' + a.c / max * 100 + '%"></div></div>';
      return '<div class="pp-row' + (leaf ? " leaf" : "") + '" tabindex="0" data-k="' + esc(a.k) + '"><div class="name">' + esc(d.name(a.k)) + sub + '</div><div class="r num">' + fmtM(cur(a)) + '</div><div class="c3">' + bar + '</div><div class="r">' + spreadPill(a.l, a.h) + "</div></div>";
    }).join("") : '<div class="pp-loading">Nothing in this selection.</div>';
    $("#pp-hint").textContent = leaf ? "Lowest level reached." : "Click a row to drill in.";
    renderAudit();
  }

  function renderXT() {
    var av = availDims();
    if (av.indexOf(S.xr) < 0) S.xr = av[0];
    if (av.indexOf(S.xc) < 0 || S.xc === S.xr) S.xc = av.filter(function (d) { return d !== S.xr; })[0];
    var opt = function (sel, ex) { return av.filter(function (d) { return d !== ex; }).map(function (d) { return '<option value="' + d + '"' + (d === sel ? " selected" : "") + ">" + esc(DIMS[d].label) + "</option>"; }).join(""); };
    $("#pp-xr").innerHTML = opt(S.xr, S.xc); $("#pp-xc").innerHTML = opt(S.xc, S.xr);
    $("#pp-xs").value = S.xs; $("#pp-xh").value = S.xh;
    var xl = $("#pp-xl");
    xl.innerHTML = '<option value="">All lines</option>' + D.dims.lines.map(function (l) { return '<option value="' + l.code + '">' + esc(l.name) + "</option>"; }).join("");
    xl.value = S.f.line || (S.f.product ? DIMS._lineOf(+S.f.product) : ""); xl.disabled = !!S.f.product;
    var Tb = $("#pp-xt");
    if (!S.xc) { Tb.innerHTML = '<tbody><tr><td class="empty">Remove a filter to get two dimensions to cross.</td></tr></tbody>'; return; }
    var rd = DIMS[S.xr], cd = DIMS[S.xc], rows = filtered();
    var cell = new Map(), rt = new Map(), ct = new Map(), G = { l: 0, c: 0, h: 0 };
    var add = function (m, k, r) { var a = m.get(k); if (!a) { a = { l: 0, c: 0, h: 0 }; m.set(k, a); } a.l += val(r, "low") || 0; a.c += val(r, "central") || 0; a.h += val(r, "high") || 0; };
    rows.forEach(function (r) { var a = rd.key(r), b = cd.key(r); add(cell, a + "|" + b, r); add(rt, a, r); add(ct, b, r); G.l += val(r, "low") || 0; G.c += val(r, "central") || 0; G.h += val(r, "high") || 0; });
    var curv = function (v) { return S.scenario === "low" ? v.l : S.scenario === "high" ? v.h : v.c; };
    var rk = Array.from(rt.entries()).filter(function (e) { return curv(e[1]) > 0.0005; }).sort(function (x, y) { return S.xr === "band" ? x[0] - y[0] : curv(y[1]) - curv(x[1]); }).map(function (x) { return x[0]; });
    var ck = Array.from(ct.entries()).filter(function (e) { return curv(e[1]) > 0.0005; }).sort(function (x, y) { return S.xc === "band" ? x[0] - y[0] : curv(y[1]) - curv(x[1]); }).map(function (x) { return x[0]; });
    var mx = 0; cell.forEach(function (v) { mx = Math.max(mx, curv(v)); });
    var show = function (v, r, c) { if (!v || !(curv(v) > 0.0005)) return null; if (S.xs === "row") return nf(curv(v) / curv(r) * 100, 1) + "%"; if (S.xs === "col") return nf(curv(v) / curv(c) * 100, 1) + "%"; return fmtM(curv(v)); };
    var tip = function (v) { return v && v.l > 0 ? "Low " + fmtM(v.l) + " \u00b7 central " + fmtM(v.c) + " \u00b7 high " + fmtM(v.h) + " \u00b7 spread " + nf(v.h / v.l, 1) + "\u00d7" : ""; };
    var shade = function (v) {
      if (S.xh === "spread") return { cls: v.l > 0 ? "s-" + spreadClass(v.l, v.h) : "", st: "" };
      if (S.xh === "bars") { var w = Math.max(1, Math.round(curv(v) / mx * 100)); return { cls: "bar", st: "background:linear-gradient(to right,var(--pp-barfill) " + w + "%,transparent " + w + "%)" }; }
      return { cls: "", st: "background:color-mix(in srgb,var(--pp-forest) " + Math.round(Math.sqrt(curv(v) / mx) * 45) + "%,transparent)" };
    };
    var fsel = S.focus, LORD = D.dims.lines.map(function (l) { return l.code; });
    var h = "<thead><tr><th>" + esc(rd.label) + " \u2193 \u00b7 " + esc(cd.label) + " \u2192</th>" + ck.map(function (k) { return '<th data-col="' + esc(k) + '" title="' + esc(cd.name(k)) + ': click to filter">' + esc(cd.short(k)) + "</th>"; }).join("") + '<th class="tot">Total</th></tr></thead><tbody>';
    var grouped = S.xr === "product", lineOf = DIMS._lineOf;
    if (grouped) rk.sort(function (x, y) { return LORD.indexOf(lineOf(+x)) - LORD.indexOf(lineOf(+y)) || curv(rt.get(y)) - curv(rt.get(x)); });
    var curLine = null;
    rk.forEach(function (a) {
      var Rw = rt.get(a);
      if (grouped && lineOf(+a) !== curLine) {
        curLine = lineOf(+a);
        var gk = rk.filter(function (x) { return lineOf(+x) === curLine; });
        var gs = function (b) { return gk.reduce(function (t, x) { return t + (cell.get(x + "|" + b) ? curv(cell.get(x + "|" + b)) : 0); }, 0); };
        var gt = gk.reduce(function (t, x) { return t + curv(rt.get(x)); }, 0);
        h += '<tr class="grp"><th>' + esc(DIMS.line.name(curLine)) + "</th>" + ck.map(function (b) { return "<td>" + (S.xs === "abs" ? fmtM(gs(b)) : S.xs === "col" ? nf(gs(b) / curv(ct.get(b)) * 100, 1) + "%" : nf(gs(b) / gt * 100, 1) + "%") + "</td>"; }).join("") +
          "<td>" + (S.xs === "abs" ? fmtM(gt) : S.xs === "col" ? nf(gt / curv(G) * 100, 1) + "%" : "100%") + "</td></tr>";
      }
      h += '<tr><th data-row="' + esc(a) + '" title="Filter to ' + esc(rd.name(a)) + '">' + esc(rd.name(a)) + "</th>" + ck.map(function (b) {
        var v = cell.get(a + "|" + b), t = show(v, Rw, ct.get(b));
        if (t == null) return '<td class="empty">\u2013</td>';
        var s = shade(v), sel = fsel[S.xr] == a && fsel[S.xc] == b ? " sel" : "";
        return '<td class="' + s.cls + sel + '" style="' + s.st + '" data-r="' + esc(a) + '" data-c="' + esc(b) + '" title="' + esc(tip(v)) + '">' + t + "</td>";
      }).join("") + '<td class="tot" title="' + esc(tip(Rw)) + '">' + (S.xs === "col" ? nf(curv(Rw) / curv(G) * 100, 1) + "%" : S.xs === "row" ? "100%" : fmtM(curv(Rw))) + "</td></tr>";
    });
    h += '<tr><th class="tot">Total</th>' + ck.map(function (b) { var C = ct.get(b); return '<td class="tot" title="' + esc(tip(C)) + '">' + (S.xs === "row" ? nf(curv(C) / curv(G) * 100, 1) + "%" : S.xs === "col" ? "100%" : fmtM(curv(C))) + "</td>"; }).join("") +
      '<td class="tot" title="' + esc(tip(G)) + '">' + (S.xs === "abs" ? fmtM(curv(G)) : "100%") + "</td></tr></tbody>";
    Tb.innerHTML = h;
  }

  // ------------------------------------------------------------------ method and assumptions panel
  function evClass(t) { t = t || ""; for (var i = 0; i < CLS_ORDER.length; i++) if (t.indexOf(CLS_ORDER[i]) === 0) return CLS_ORDER[i]; return /Derived/.test(t) ? "Derived" : /Modelled/.test(t) ? "Modelled" : "Assumption"; }
  function srcNames(s) {
    if (!s) return "";
    var seen = {}, out = [];
    s.split(/[;,\s]+/).filter(Boolean).forEach(function (id) {
      if (seen[id]) return; seen[id] = 1;
      out.push(D.ledger[id] ? '<span title="' + esc(D.ledger[id]) + '">' + esc(id) + "</span>: " + esc(D.ledger[id]) : esc(id));
    });
    return out.join("<br>");
  }
  function hv(a, x) {
    if (x === "" || x == null) return "not set";
    var u = a.unit || "", n = +x;
    var pc = function (v) { var p = v * 100; return (Math.abs(p) < 1 ? p.toFixed(2) : Math.abs(p) < 10 ? p.toFixed(1) : p.toFixed(0)).replace(/\.0+$/, "") + "%"; };
    if (/^bps/.test(u)) return (n / 100).toFixed(2).replace(/0$/, "") + "%";
    if (/^share/.test(u) || /^ratio 0-1/.test(u) || /^weight/.test(u)) return pc(n);
    if (/% a year/.test(u)) return n.toFixed(2) + "%";
    if (/^GBP/.test(u)) return "\u00a3" + n.toLocaleString("en-GB");
    if (/years/.test(u)) return x + " yrs";
    if (/ratio|log-sd|elasticity/.test(u)) return n.toLocaleString("en-GB", { maximumFractionDigits: 3 }) + "\u00d7";
    return x;
  }
  function plainEN(a) {
    var id = a.assumption_id, rules = D.texts.assumption_plain || [];
    var P = (id.match(/-P(\d\d)/) || [])[1], B = (id.match(/-B(\d)\b/) || [])[1], Sg = (id.match(/-S(\d)\b/) || [])[1];
    var prod = P ? DIMS.product.name(+P) : "", band = B ? D.dims.bands.filter(function (b) { return b.id == B; })[0].name : "";
    var seg = Sg ? DIMS.segment.name(+Sg) : "", line = (id.match(/-(BANK|WM|ADV|TAX|TE)$/) || [])[1];
    var cn = +a.central, ex = { per1000: nf(cn * 1000, 1), rest: hv(a, 1 - cn), base: ((a.unit || "").match(/share of (.+)/) ? (D.texts.unit_base[(a.unit.match(/share of (.+)/))[1]] || a.unit.match(/share of (.+)/)[1]) : ""), V: hv(a, a.central), prod: prod, band: band, seg: seg, line: line ? lc(DIMS.line.name(line)) : "", desc: a.description, c: a.central,
      low: hv(a, a.low), high: hv(a, a.high), prov: (a.description.split(":")[0] || "").replace(/\s*\(.*\)/, "") };
    if (a.central === "" && !/METHOD|NOTE/.test(id)) return fill(tx("assumption_not_set"), "central", ex);
    if (/METHOD|NOTE/.test(id)) return fill(tx("assumption_note"), "central", ex);
    for (var i = 0; i < rules.length; i++) if (new RegExp(rules[i].match).test(id)) {
      var tpl = rules[i].t;
      if (B && tpl.indexOf("{band}") < 0) tpl = tpl.indexOf("{prod}:") === 0 ? tpl.replace("{prod}:", "{prod}, {band} of net assets:") : tpl.replace(/([.]?)$/, " ({band} of net assets)$1");
      return fill(tpl, "central", ex);
    }
    return a.description + ".";
  }
  function relevantAssumptions() {
    var f = F(), line = lineOfSel(f), out = [], net = S.basis === "net_assets";
    D.assumptions.forEach(function (a) {
      var sc = a.scope || {};
      if (sc.basis === "investable" && net) return;
      if (sc.band && f.band && net && sc.band != f.band) return;
      if (sc.products) { if (f.product ? sc.products.indexOf(+f.product) >= 0 : line && sc.products.some(function (p) { return DIMS._lineOf(p) === line; })) out.push(a); return; }
      if (sc.segments) { if (f.segment ? sc.segments.indexOf(+f.segment) >= 0 : (S.dim === "segment" || S.xr === "segment" || S.xc === "segment") ) out.push(a); return; }
      if (sc.line) { if (!line || sc.line === line) out.push(a); return; }
      if (sc.general) out.push(a);
    });
    return out;
  }
  function inheritedLine(f) {
    if (S.basis !== "net_assets") return "";
    var band = f.band ? +f.band : null, hh = 0, ih = 0, ri = null;
    if (f.region) ri = D.dims.regions.map(function (r) { return r.id; }).indexOf(f.region);
    D.inherited.forEach(function (r) {
      if (band && r[0] !== band) return;
      if (f.geo && D.dims.regions[r[1]].geo !== f.geo) return;
      if (ri != null && ri >= 0 && r[1] !== ri) return;
      hh += r[2]; ih += r[3];
    });
    if (!hh) return "";
    var out = '<section><h3>' + esc(tx("inherited.heading")) + "</h3><p class=\"pp-src\">" + fill(tx("inherited.line"), "central", { inh_share: nf(ih / hh * 100, 0) + "%", inh_hh: NF.format(Math.round(ih)) }) + "</p>";
    if (f.segment) {
      var sh = 0, si = 0;
      D.inherited_seg.forEach(function (r) { if (r[1] == f.segment && (!band || r[0] === band)) { sh += r[2]; si += r[3]; } });
      if (sh) out += '<p class="pp-src">' + fill(tx("inherited.seg_line"), "central", { inh_share: nf(si / sh * 100, 0) + "%", seg: DIMS.segment.name(+f.segment) }) + "</p>";
    }
    return out + "</section>";
  }
  function ladderHTML(f) {
    var code = lineOfSel(f) || "TOTAL", L = D.ladder[code] || D.ladder.TOTAL, tl = T().ladder, h = "";
    var lv = ["national", "band", "region", "segment", "sector"].filter(function (k) { return L.levels[k]; });
    h += '<section><h3>' + esc(fill(tl.heading, "central", { slice: code === "TOTAL" ? tl.whole : DIMS.line.name(code) })) + "</h3>" +
      '<div class="pp-score"><span class="pp-scorenum">' + nf(L.score, 0) + "%</span> <span class=\"pp-src\">" + esc(tl.score_label) + (L.range && L.range.revenue ? ";" : "") + "</span>" +
      (L.range && L.range.revenue ? ' <span class="pp-src">' + esc(tl.range_label) + " " + FMT.pp0s(L.range.revenue.p10) + " to " + FMT.pp0s(L.range.revenue.p90) + "</span>" : "") + "</div>" +
      '<div class="pp-ladder">' + lv.map(function (k) {
        var x = L.levels[k], cls = x.weakest ? evClass(x.weakest) : null;
        return (cls ? '<span class="pp-ev ' + cls + '" title="Weakest input at this level">' + esc(tl.weakest_label) + " " + cls + "</span>" : '<span class="pp-ev none">\u2013</span>') +
          "<div><b>" + esc(tl.levels[k].name) + '</b> <span class="pp-src">\u00b7 ' + nf(x.backed, 0) + "% " + esc(tl.backed) + "</span><br><span class=\"pp-src\">" + esc(tl.levels[k].note) + "</span></div>";
      }).join("") + "</div>" +
      '<p class="pp-src">' + esc(tl.classes) + "</p></section>";
    return h;
  }
  function renderAudit() {
    var f = F(), h = "", t = T();
    h += '<section><h3>' + esc(tx("panel.selection")) + "</h3><div>" + esc(selLabel(f)) + "</div>" + act("cell", { release: D.meta.release, basis: S.basis, scenario: S.scenario, measure: S.measure, filters: selFilters(f), label: selLabel(f) }) + "</section>";
    if (f.product) {
      var P = D.dims.products.filter(function (p) { return p.id == f.product; })[0];
      h += "<section><h3>" + esc(fill(tx("panel.how_product"), "central", { prod: lc(P.name) })) + '</h3><dl class="pp-kv">' +
        "<dt>Formula</dt><dd>" + esc(P.method) + "</dd><dt>Components</dt><dd>" + esc(P.comp) + "</dd>" +
        "<dt>Balance route</dt><dd>" + esc(tx("panel.route." + (P.route || "none"))) + "</dd>" +
        '<dt>Balance sources</dt><dd class="pp-src">' + srcNames(P.bsrc) + '</dd><dt>Price / yield</dt><dd class="pp-src">' + srcNames(P.ysrc) + "</dd>" +
        '<dt>Cost / income</dt><dd class="num">' + (P.cir != null ? nf(P.cir * 100, 0) + "%" : "\u2013") + "</dd></dl>" +
        (t.method_notes && t.method_notes[P.id] ? '<p class="pp-src">' + esc(fill(t.method_notes[P.id])) + "</p>" : "") + "</section>";
    } else {
      h += "<section><h3>" + esc(tx("panel.how_pool")) + '</h3><p class="pp-src">' + esc(fill(tx("panel.pool_built"))) + "</p></section>";
    }
    h += inheritedLine(f);
    h += ladderHTML(f);
    var A = relevantAssumptions(), shown = A.slice(0, 14), seenP = {};
    shown.forEach(function (a) { a._p = plainEN(a); seenP[a._p] = (seenP[a._p] || 0) + 1; });
    shown.forEach(function (a) { if (seenP[a._p] > 1) a._p += " [" + a.assumption_id + "]"; });
    h += "<section><h3>" + esc(fill(tx("panel.assumptions"), "central", { n: A.length })) + "</h3>" + shown.map(function (a) {
      var plain = a._p, cls = evClass(a.evidence_class);
      return '<details class="pp-as"><summary><span>' + esc(plain) + '</span><span class="pp-ev ' + cls + '">' + esc(a.evidence_class) + "</span></summary>" +
        act("assumption", { release: D.meta.release, assumption_id: a.assumption_id, label: plain }) +
        '<div class="pp-lch">Range tested: low ' + esc(hv(a, a.low)) + " \u00b7 central " + esc(hv(a, a.central)) + " \u00b7 high " + esc(hv(a, a.high)) + (a.sensitivity_pct_pool ? " \u00b7 swings the total pool by about " + esc(a.sensitivity_pct_pool) + "%" : "") + "</div>" +
        "<p><b>Why this value (technical):</b> " + esc(a.rationale) + "</p><p>Ref " + esc(a.assumption_id) + " \u00b7 source " + esc(a.source_id || "\u2013") + " \u00b7 status: " + esc(a.status) + "</p></details>";
    }).join("") + (A.length > shown.length ? '<span class="pp-src">Plus ' + (A.length - shown.length) + " smaller ones. Narrow by band or product to see them.</span>" : "") + "</section>";
    $("#pp-audit").innerHTML = h;
    decorateAll($("#pp-audit"));
  }

  // ------------------------------------------------------------------ tabs 1 and 2 (data-driven)
  function chip(cls) { return '<span class="pp-conf-chip ' + evClass(cls) + '">' + esc(fill(tx("chip_prefix"), "central", {})) + " " + esc(cls) + "</span>"; }
  function bars(specs, sc) {
    return specs.map(function (b) {
      var total = figVal(b.total, "central"), part = figVal(b.part, sc), lo = null, hi = null, F2 = D.figs[b.part], f = F2.f;
      if (F2.v !== null && typeof F2.v === "object") { lo = F2.v.low; hi = F2.v.high; }
      var W = function (v) { return Math.min(v / total * 100, 100); };
      return '<div class="pp-mkt"><div class="pp-mlab"><span>' + esc(b.tlabel) + ": <b class=\"num\">" + fmtv(D.figs[b.total].f, total) + "</b></span><span>" + esc(b.label) + ": <b class=\"num\">" + fmtv(f, part) + "</b> (" + nf(part / total * 100, 1) + "%)" +
        (lo != null ? " \u00b7 range " + fmtv(f, lo) + "\u2013" + fmtv(f, hi) : "") + '</span></div><div class="pp-mbar" role="img" aria-label="' + esc(b.label) + '"><div class="s" style="width:' + W(part) + '%"></div>' +
        (lo != null ? '<div class="w" style="left:' + W(lo) + "%;width:" + Math.max(W(hi) - W(lo), 0.5) + '%"></div>' : "") + "</div></div>";
    }).join("");
  }
  function cellText(c, f) {
    if (c == null) return "\u2013";
    if (Array.isArray(c)) return fmtv(f, c[0]) + "\u2013" + fmtv(f, c[1]);
    if (typeof c === "string") return esc(c);
    return fmtv(f, c);
  }
  function tableHTML(name, sc, only) {
    var tb = D.tables[name], tt = (D.texts.tables || {})[name] || {}, cols = tb.cols, heat = tb.heat, max = 0;
    var rowsOf = function (r) { return tb.scen ? r.v[sc] : r.v; };
    if (heat) tb.rows.forEach(function (r) { r.v.forEach(function (x) { if (x != null && x > max) max = x; }); });
    var heads = (tt.cols || []).slice();
    var head = "<tr><th>" + esc(tt.first || "") + "</th>" + cols.map(function (c, i) {
      var hd = c.head ? (SCEN_LABEL[c.head] || c.head) : heads[i] || "";
      return "<th>" + esc(hd) + "</th>";
    }).join("") + "</tr>";
    var body = tb.rows.filter(function (r) { return !only || only.indexOf(r.label) >= 0; }).map(function (r) {
      var lab = (tt.rows && tt.rows[r.label]) || (r.label === "total" ? tx("total_label") : r.label), v = rowsOf(r);
      return "<tr" + (r.tot ? ' class="tot"' : "") + "><td" + (r.sub ? ' class="sub"' : "") + ">" + esc(lab) + (r.note && tt.show_notes ? '<small class="pp-src"> ' + esc(r.note) + "</small>" : "") + "</td>" +
        v.map(function (x, i) {
          var st = "";
          if (heat) st = x == null || x < 5 ? "" : ' style="background:color-mix(in srgb,var(--pp-forest) ' + Math.round(Math.sqrt(x / max) * 50) + '%,transparent)"';
          return "<td" + st + ">" + (heat && (x == null || x < 5) ? "\u2013" : cellText(x, cols[i].f)) + "</td>";
        }).join("") + "</tr>";
    }).join("");
    return '<div class="pp-mini"><table><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div>" + (tt.note ? '<p class="pp-src pp-tnote">' + esc(fill(tt.note, sc)) + "</p>" : "");
  }
  function renderExec() {
    var e = T().exec;
    $("#pp-exec").innerHTML = "<h2>" + esc(e.title) + "</h2><ul>" + e.items.map(function (i) { return "<li><b>" + esc(i.h) + ":</b> " + esc(fill(i.t, "central")) + "</li>"; }).join("") + '</ul><div class="pp-req">' + esc(fill(e.req, "central")) + "</div>";
  }
  function renderU() {
    var steps = T().universe_steps, s = steps[US.i], sc = US.sc;
    $("#pp-udots").innerHTML = steps.map(function (x, j) { return '<button data-i="' + j + '"' + (j === US.i ? ' aria-current="step"' : "") + ">" + (j + 1) + " " + esc(x.label) + "</button>"; }).join("");
    var left = "<h3>" + esc("Step " + (US.i + 1) + " \u00b7 " + s.kicker) + "</h3><h2>" + esc(fill(s.title, sc)) + "</h2>";
    if (s.big) left += '<div class="big gold">' + esc(fill(s.big, sc)) + "</div>";
    if (s.bigsub) left += '<span class="pp-muted">' + esc(fill(s.bigsub, sc)) + "</span>";
    (s.blocks || []).forEach(function (b) {
      if (b.table) left += (b.heading ? "<h3 class=\"pp-sub3\">" + esc(fill(b.heading, sc)) + "</h3>" : "") + tableHTML(b.table, sc, b.rows);
      else if (b.bars) left += bars(b.bars, sc);
      else if (b.text) left += '<p class="pp-src">' + esc(fill(b.text, sc)) + "</p>";
    });
    var right = '<div class="pp-why">' + chip(s.evidence) + "<ul>" + s.why.map(function (w) { return "<li>" + esc(fill(w, sc)) + "</li>"; }).join("") + "</ul>" +
      act("universe_step", { release: D.meta.release, universe_step: US.i + 1, label: s.label }) + "</div>";
    $("#pp-ustep").innerHTML = '<div class="pp-left">' + left + "</div>" + right;
    $("#pp-uprev").disabled = US.i === 0;
    $("#pp-unext").textContent = US.i === steps.length - 1 ? "How it is built \u2192" : "Next \u2192";
    $$("#pp-uscen button").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.s === US.sc); });
    decorateAll($("#pp-ustep"));
  }
  function renderB() {
    var B = T().build, steps = B.steps, h = "", part = "";
    steps.forEach(function (s, i) {
      if (s.part !== part) { part = s.part; h += '<li class="part">' + esc(B.parts[part]) + "</li>"; }
      h += '<li><button data-b="' + i + '"' + (i === BI ? ' aria-current="step"' : "") + '><span class="n">' + String(i + 1).padStart(2, "0") + "</span><span>" + esc(s.title) + '</span><span class="pp-conf-chip sm ' + evClass(s.evidence) + '">' + esc(s.evidence) + "</span></button></li>";
    });
    $("#pp-blist").innerHTML = h;
    var s = steps[BI], n = steps.length;
    $("#pp-bdetail").innerHTML = "<h3>Step " + (BI + 1) + " of " + n + " \u00b7 " + esc(B.parts[s.part]) + "</h3><h2>" + esc(s.title) + "</h2>" + chip(s.evidence) +
      '<p class="pp-body">' + esc(fill(s.body, "central")) + "</p><dl><dt>Source</dt><dd>" + esc(s.source) + "</dd><dt>" + esc(B.why_label) + "</dt><dd>" + esc(fill(s.why, "central")) + "</dd><dt>" + esc(B.improve_label) + "</dt><dd>" + esc(s.improve) + "</dd></dl>" +
      act("build_step", { release: D.meta.release, build_step: BI + 1, label: s.title }) +
      '<div class="pp-stepnav"><button class="pp-btn" data-bn="-1"' + (BI === 0 ? " disabled" : "") + '>\u2190 Back</button><button class="pp-btn primary" data-bn="1">' + (BI === n - 1 ? "Explore the pools \u2192" : "Next \u2192") + "</button></div>";
    decorateAll($("#pp-bdetail"));
  }

  // ------------------------------------------------------------------ routing and events
  function route() {
    var h = location.hash.slice(1), t = ["universe", "build", "explore"].indexOf(h) >= 0 ? h : S.tab;
    S.tab = t;
    ["universe", "build", "explore"].forEach(function (x) { $("#pp-t-" + x).hidden = x !== t; });
    $$("#pp-tabs a").forEach(function (a) { if (a.dataset.t === t) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  }
  function pressed(sel, attr, v) { $$(sel + " button").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset[attr] === v); }); }
  function drill(k) {
    var d = S.dim; S.f[d] = keyOf(d, k); if (d === "product") delete S.f.line;
    S.dim = availDims()[0]; renderExplore();
  }
  function onClick(e) {
    var tg = e.target, c;
    if (!tg.closest) return;
    if ((c = tg.closest("#pp-theme"))) { var r = document.documentElement; r.setAttribute("data-theme", r.getAttribute("data-theme") === "dark" ? "light" : "dark"); return; }
    if ((c = tg.closest("#pp-measure button"))) { S.measure = c.dataset.m; pressed("#pp-measure", "m", S.measure); renderExplore(); return; }
    if ((c = tg.closest("#pp-scen button"))) { S.scenario = c.dataset.s; pressed("#pp-scen", "s", S.scenario); renderExplore(); return; }
    if ((c = tg.closest(".pp-crumb"))) { var d = c.dataset.clear; if (d === "*") S.f = {}; else delete S.f[d]; S.focus = {}; renderExplore(); return; }
    if ((c = tg.closest("#pp-basis button"))) { S.basis = c.dataset.b; setCI(); S.f = {}; S.focus = {}; pressed("#pp-basis", "b", S.basis); renderExplore(); return; }
    if ((c = tg.closest("#pp-view button"))) { S.view = c.dataset.v; S.focus = {}; pressed("#pp-view", "v", S.view); renderExplore(); return; }
    if ((c = tg.closest(".pp-xt td[data-r]"))) { var o = {}; o[S.xr] = keyOf(S.xr, c.dataset.r); o[S.xc] = keyOf(S.xc, c.dataset.c); S.focus = o; renderExplore(); return; }
    if ((c = tg.closest(".pp-xt th[data-row],.pp-xt th[data-col]"))) { var dd = c.dataset.row != null ? S.xr : S.xc, kk = c.dataset.row != null ? c.dataset.row : c.dataset.col; S.f[dd] = keyOf(dd, kk); if (dd === "product") delete S.f.line; S.focus = {}; renderExplore(); return; }
    if ((c = tg.closest("#pp-udots button"))) { US.i = +c.dataset.i; renderU(); return; }
    if ((c = tg.closest("#pp-uscen button"))) { US.sc = c.dataset.s; renderU(); return; }
    if (tg.closest("#pp-uprev")) { US.i = Math.max(0, US.i - 1); renderU(); return; }
    if (tg.closest("#pp-unext")) { if (US.i < T().universe_steps.length - 1) { US.i++; renderU(); } else { location.hash = "build"; } return; }
    if ((c = tg.closest(".pp-blist button"))) { BI = +c.dataset.b; renderB(); return; }
    if ((c = tg.closest("[data-bn]"))) { var n = BI + +c.dataset.bn; if (n > T().build.steps.length - 1) location.hash = "explore"; else { BI = Math.max(0, n); renderB(); } return; }
    if ((c = tg.closest(".pp-row")) && !c.classList.contains("leaf")) drill(c.dataset.k);
  }
  function onKey(e) {
    var row = e.target.closest && e.target.closest(".pp-row");
    if (row && (e.key === "Enter" || e.key === " ") && !row.classList.contains("leaf")) { e.preventDefault(); drill(row.dataset.k); }
  }
  function onChange(e) {
    var id = e.target.id;
    if (id === "pp-dim") { S.dim = e.target.value; renderExplore(); }
    else if (id === "pp-xr" || id === "pp-xc" || id === "pp-xs" || id === "pp-xh") { S[id.slice(3)] = e.target.value; S.focus = {}; renderExplore(); }
    else if (id === "pp-xl") { var v = e.target.value; if (v) S.f.line = v; else delete S.f.line; S.focus = {}; renderExplore(); }
  }

  // ------------------------------------------------------------------ public API
  window.PPExplorer = {
    mount: function (o) {
      D = o.data; ROOT = o.root; ACTIONS = o.actions || null; MARK = o.markUrl || null;
      setCI(); buildDims(); shell();
      renderExec(); renderU(); renderB(); renderExplore(); route();
      ROOT.addEventListener("click", onClick); ROOT.addEventListener("keydown", onKey); ROOT.addEventListener("change", onChange);
      window.addEventListener("hashchange", route);
    },
    getState: function () {
      var f = {}; ORDER.forEach(function (d) { f[d] = d in S.f ? S.f[d] : null; });
      return { tab: S.tab, basis: S.basis, scenario: S.scenario, measure: S.measure, filters: f };
    },
    release: function () { return D ? D.meta.release : null; }
  };
})();
