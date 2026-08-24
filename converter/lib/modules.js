"use strict";
/*
 * 动作模块组装：searchBook / bookDetail / chapterList / chapterContent / bookWorld
 * 输入 Legado 顶层字段，输出 XSGG 动作 JSON
 */

var rules = require("./rules");
var urlRule = require("./urlRule");
var utils = require("./utils");

// JSON 解析源检测：规则为 JSONPath（$.x / $.. / @json:）即整模块启用 JSON 解析
function isJsonRule(s) {
  s = String(s || "").trim();
  return s.charAt(0) === "$" || s.indexOf("@json:") === 0;
}
// 返回启用 jsonEnabled 的 ctx 副本（非 JSON 规则时原样返回）
function jsonCtx(ctx, listRule) {
  if (!isJsonRule(listRule)) return ctx;
  var c = {};
  for (var k in ctx) c[k] = ctx[k];
  c.jsonEnabled = true;
  return c;
}
// 无列表规则的模块：任一字段为 JSONPath 即视为 JSON 源
function anyJson(obj) {
  if (!obj) return false;
  var keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++) {
    if (isJsonRule(obj[keys[i]])) return true;
  }
  return false;
}
function jsonNote(warnings) {
  warnings.push({ level: "note", msg: "检测到 JSONPath 规则，已启用 JSON 解析（parserID=JSON，responseFormatType=json），JSONPath 直接透传" });
}

function base(moduleName, host, jsonEnabled) {
  var m = {
    validConfig: "",
    actionID: moduleName,
    host: host,
    parserID: "DOM",
    responseFormatType: "html"
  };
  if (jsonEnabled) {
    m.parserID = "JSON";
    m.responseFormatType = "json";
  }
  return m;
}

// 按映射挑选存在且非空的字段并转换
// mapping: [[legadoKey, xsggKey, {optional:true}], ...]
function pickFields(src, mapping, ctx) {
  var out = {};
  var warnings = [];
  for (var i = 0; i < mapping.length; i++) {
    var legadoKey = mapping[i][0];
    var xsggKey = mapping[i][1];
    var optional = mapping[i][2] && mapping[i][2].optional;
    var raw = src[legadoKey];
    if (raw === undefined || raw === null || String(raw).trim() === "") {
      if (!optional) {
        warnings.push({ level: "note", msg: xsggKey + "：Legado 无 " + legadoKey + " 规则，已省略" });
      }
      continue;
    }
    var r = rules.convertRule(String(raw), ctx);
    if (r.value === "") continue;
    out[xsggKey] = r.value;
    warnings = warnings.concat(r.warnings);
  }
  return { out: out, warnings: warnings };
}

// searchBook
function buildSearchBook(src, ctx) {
  var warnings = [];
  if (!src.searchUrl) {
    return { module: null, warnings: warnings.concat([{ level: "note", msg: "无 searchUrl，跳过 searchBook" }]) };
  }
  var rs = src.ruleSearch;
  if (!rs || !Object.keys(rs).length) {
    // 搜索/分类共用一套列表解析规则：ruleSearch 为空时用 ruleExplore 补全
    if (src.ruleExplore && Object.keys(src.ruleExplore).length) {
      rs = src.ruleExplore;
      warnings.push({ level: "note", msg: "ruleSearch 为空，已用 ruleExplore 列表规则补全 searchBook" });
    } else {
      return { module: null, warnings: warnings.concat([{ level: "note", msg: "无 ruleSearch/ruleExplore，跳过 searchBook" }]) };
    }
  }
  var jctx = jsonCtx(ctx, rs.bookList);
  if (jctx.jsonEnabled) jsonNote(warnings);
  var ri = urlRule.buildRequestInfo(String(src.searchUrl), jctx, "search");
  warnings = warnings.concat(ri.warnings);
  var m = base("searchBook", jctx.host, jctx.jsonEnabled);
  m.requestInfo = ri.requestInfo;
  var p = pickFields(rs, [
    ["bookList", "list"],
    ["name", "bookName"],
    ["bookUrl", "detailUrl"],
    ["coverUrl", "cover"],
    ["kind", "cat", { optional: true }],
    ["author", "author", { optional: true }],
    ["intro", "desc", { optional: true }],
    ["wordCount", "wordCount", { optional: true }],
    ["lastChapter", "lastChapterTitle", { optional: true }]
  ], jctx);
  Object.keys(p.out).forEach(function (k) { m[k] = p.out[k]; });
  warnings = warnings.concat(p.warnings);
  return { module: m, warnings: warnings };
}

// bookDetail
function buildBookDetail(src, ctx) {
  var warnings = [];
  if (!src.ruleBookInfo || !Object.keys(src.ruleBookInfo).length) {
    return { module: null, warnings: warnings.concat([{ level: "note", msg: "无 ruleBookInfo，跳过 bookDetail" }]) };
  }
  var jctx = anyJson(src.ruleBookInfo) ? jsonCtx(ctx, "$.x") : ctx;
  if (jctx.jsonEnabled) jsonNote(warnings);
  var m = base("bookDetail", jctx.host, jctx.jsonEnabled);
  // 无 requestInfo：App 会沿用点击进入的详情页 URL
  warnings.push({ level: "note", msg: "bookDetail 未设 requestInfo，将沿用搜索结果/分类点击进入的详情页 URL" });
  if (src.ruleBookInfo.tocUrl) {
    warnings.push({ level: "degraded", msg: "详情页含目录 URL 规则(tocUrl)：XSGG 目录将沿用详情页 URL 解析；若目录页与详情页不同，请为 chapterList 手动配置 requestInfo" });
  }
  var p = pickFields(src.ruleBookInfo, [
    ["name", "bookName"],
    ["author", "author", { optional: true }],
    ["coverUrl", "cover", { optional: true }],
    ["intro", "desc", { optional: true }],
    ["kind", "cat", { optional: true }],
    ["wordCount", "wordCount", { optional: true }],
    ["lastChapter", "lastChapterTitle", { optional: true }]
  ], jctx);
  Object.keys(p.out).forEach(function (k) { m[k] = p.out[k]; });
  warnings = warnings.concat(p.warnings);
  return { module: m, warnings: warnings };
}

// chapterList
function buildChapterList(src, ctx) {
  var warnings = [];
  if (!src.ruleToc || !Object.keys(src.ruleToc).length) {
    return { module: null, warnings: warnings.concat([{ level: "note", msg: "无 ruleToc，跳过 chapterList" }]) };
  }
  var jctx = jsonCtx(ctx, src.ruleToc.chapterList);
  if (jctx.jsonEnabled) jsonNote(warnings);
  var m = base("chapterList", jctx.host, jctx.jsonEnabled);
  // 无 requestInfo：沿用 bookDetail 页 URL（Legado 的目录解析即在详情页进行）
  warnings.push({ level: "note", msg: "chapterList 未设 requestInfo，将沿用 bookDetail 页 URL 解析目录" });
  var p = pickFields(src.ruleToc, [
    ["chapterList", "list"],
    ["chapterName", "title"],
    ["chapterUrl", "url"],
    ["nextTocUrl", "nextPageUrl", { optional: true }],
    ["updateTime", "updateTime", { optional: true }]
  ], jctx);
  Object.keys(p.out).forEach(function (k) { m[k] = p.out[k]; });
  warnings = warnings.concat(p.warnings);
  if (src.ruleToc.chapterUrl && /^[^\/\s]/.test(String(src.ruleToc.chapterUrl).trim())) {
    warnings.push({ level: "degraded", msg: "章节 URL 规则可能产出相对路径，XSGG 需要绝对 URL，请人工确认" });
  }
  return { module: m, warnings: warnings };
}

// chapterContent
function buildChapterContent(src, ctx) {
  var warnings = [];
  if (!src.ruleContent || !Object.keys(src.ruleContent).length) {
    return { module: null, warnings: warnings.concat([{ level: "note", msg: "无 ruleContent，跳过 chapterContent" }]) };
  }
  var jctx = anyJson(src.ruleContent) ? jsonCtx(ctx, "$.x") : ctx;
  if (jctx.jsonEnabled) jsonNote(warnings);
  var m = base("chapterContent", jctx.host, jctx.jsonEnabled);
  // 无 requestInfo：沿用章节列表点击的章节页 URL
  warnings.push({ level: "note", msg: "chapterContent 未设 requestInfo，将沿用章节列表点击的章节页 URL" });
  var p = pickFields(src.ruleContent, [
    ["content", "content"],
    ["nextContentUrl", "nextPageUrl", { optional: true }]
  ], jctx);
  Object.keys(p.out).forEach(function (k) { m[k] = p.out[k]; });
  warnings = warnings.concat(p.warnings);

  // replaceRegex（##正则##替换 净化）→ content 尾部 ||@js: 后处理
  var rrRaw = src.ruleContent.replaceRegex;
  if (rrRaw !== undefined && rrRaw !== null && String(rrRaw).trim() !== "") {
    var prr = parsePurifyRule(String(rrRaw).trim());
    if (prr && typeof m.content === "string" && m.content !== "") {
      var seg = ".replace(/" + utils.escRegex(prr.regex) + "/gi, \"" + utils.escStr(prr.repl) + "\")";
      if (m.content.indexOf("||@js:\n") !== -1) {
        // 已有 @js 块：把净化链并入其 return 表达式末尾
        var lastSemi = m.content.lastIndexOf(";");
        m.content = m.content.slice(0, lastSemi) + seg + m.content.slice(lastSemi);
      } else {
        m.content += "||@js:\nreturn result" + seg + ";";
      }
      warnings.push({ level: "note", msg: "已映射 replaceRegex 净化规则（/" + prr.regex.slice(0, 30) + "/gi）到 content 后处理" });
    } else if (!prr) {
      warnings.push({ level: "degraded", msg: "replaceRegex 仅支持 ##正则##替换 形式，当前值未映射，需人工处理" });
    }
  }
  return { module: m, warnings: warnings };
}

/** 解析阅读净化规则：##正则##替换（替换可省略）。 */
function parsePurifyRule(v) {
  if (v.charAt(0) !== "#" || v.charAt(1) !== "#") return null;
  var body = v.slice(2);
  if (body === "") return null;
  var i2 = body.indexOf("##");
  if (i2 === -1) return { regex: body, repl: "" };
  return { regex: body.slice(0, i2), repl: body.slice(i2 + 2) };
}

// 解码 percent-encoding（失败时返回原文）
function safeDecode(s) {
  try {
    return decodeURIComponent(String(s));
  } catch (e) {
    return String(s);
  }
}

// 解析 exploreUrl 文本：返回 [{name, path}]
// 支持两种格式：每行「名称::路径」；或 JSON 数组 [{"title":"..","url":".."},...]（含 style 字段）
function parseExploreLines(exploreUrl) {
  var s = String(exploreUrl).trim();
  if (s.charAt(0) === "[") {
    try {
      var arr = JSON.parse(s);
      if (Array.isArray(arr)) {
        var jsonLines = [];
        for (var ji = 0; ji < arr.length; ji++) {
          var it = arr[ji] || {};
          var jn = String(it.title || it.name || "").trim() || ("分类" + (ji + 1));
          var ju = String(it.url || "").trim();
          if (ju) jsonLines.push({ name: jn, path: ju });
        }
        if (jsonLines.length) return jsonLines;
      }
    } catch (e) {
      // 非法 JSON：按文本行解析
    }
  }
  var lines = s.split(/\r?\n/);
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var idx = line.indexOf("::");
    if (idx === -1) {
      out.push({ name: "分类", path: line });
      continue;
    }
    var name = line.slice(0, idx).trim();
    var path = line.slice(idx + 2).trim();
    if (!name) name = "分类";
    out.push({ name: name, path: path });
  }
  return out;
}

// 分类 URL 中的 {{...}} 模板归一化：
// 页码类模板（含 page 变量的 JS 表达式，如 {{page}}、{{(page-1)*20}}、{{page == 1 ? "" : page + ".html"}}）
// 翻译为 JS 后统一占位为 {{page}}；规则前缀型占位符（@@/@css:/@json:/@xpath://$）记为 bad。
function normalizePageTemplates(path) {
  var re = /\{\{([\s\S]+?)\}\}/g;
  var norm = "";
  var last = 0, m;
  var exprs = [], bad = [];
  while ((m = re.exec(path)) !== null) {
    norm += path.slice(last, m.index);
    var e = m[1].trim();
    var rulePrefix = /^(@@|@css:|@json:|@xpath:|\$)/.test(e) || e.indexOf("//") === 0;
    if (rulePrefix) {
      bad.push(e);
      norm += m[0];
    } else {
      try {
        var tr = urlRule.exprToJs(e, {});
        exprs.push(tr.expr);
        norm += "{{page}}";
      } catch (err) {
        bad.push(e);
        norm += m[0];
      }
    }
    last = m.index + m[0].length;
  }
  norm += path.slice(last);
  return { norm: norm, exprs: exprs, bad: bad, ok: bad.length === 0 };
}

// 判断 _type 模式：所有行均有 {{page}}，各路径只在同一路径段上不同（token），
// 兼容相对（/xuanhuan/{{page}}.html）与绝对（https://a.com/x/?page={{page}}）URL、
// 兼容 token 在中间段（/item/{cat}/page/{{page}}）
function analyzeTypeMode(lines) {
  if (!lines.length) return null;
  var segsList = [];
  for (var i = 0; i < lines.length; i++) {
    var p = lines[i].path;
    var pi = p.indexOf("{{page}}");
    if (pi === -1) return null;
    segsList.push({
      preI: p.slice(0, pi),
      postI: p.slice(pi + 8),
      segs: p.slice(0, pi).split("/").filter(function (s) { return s !== ""; })
    });
  }
  // 找第一个互不相同的路径段索引
  var diffIdx = -1;
  var firstSegs = segsList[0].segs;
  for (var s = 0; s < firstSegs.length; s++) {
    var v = firstSegs[s];
    var allSame = true;
    for (var j = 1; j < segsList.length; j++) {
      if (segsList[j].segs[s] !== v) { allSame = false; break; }
    }
    if (!allSame) { diffIdx = s; break; }
  }
  if (diffIdx === -1) return null;
  var tokens = [];
  for (var k = 0; k < segsList.length; k++) {
    var token = segsList[k].segs[diffIdx];
    if (!token || /[?=&\s]/.test(token)) return null;
    tokens.push(token);
  }
  // 用首行构造 pattern，并验证其余行一致
  var firstPre = segsList[0].preI;
  var pos = firstPre.indexOf(tokens[0]);
  if (pos === -1) return null;
  var pattern = firstPre.slice(0, pos) + "_TYPE_" + firstPre.slice(pos + tokens[0].length);
  var post0 = segsList[0].postI;
  for (var m = 0; m < segsList.length; m++) {
    var pp = segsList[m].preI.indexOf(tokens[m]);
    if (pp === -1) return null;
    var pat = segsList[m].preI.slice(0, pp) + "_TYPE_" + segsList[m].preI.slice(pp + tokens[m].length);
    if (pat !== pattern || segsList[m].postI !== post0) return null;
  }
  return { pattern: pattern, post: post0, tokens: tokens };
}

// bookWorld
function buildBookWorld(src, ctx) {
  var warnings = [];
  if (!src.exploreUrl) {
    return { module: null, warnings: warnings.concat([{ level: "note", msg: "无 exploreUrl，跳过 bookWorld（书源在 App 中将不可见）" }]) };
  }
  if (src.enabledExplore === false) {
    return { module: null, warnings: warnings.concat([{ level: "note", msg: "enabledExplore=false，跳过 bookWorld" }]) };
  }
  var re = src.ruleExplore;
  if (!re || !Object.keys(re).length) {
    // 搜索/分类共用一套列表解析规则：ruleExplore 为空时用 ruleSearch 补全
    if (src.ruleSearch && Object.keys(src.ruleSearch).length) {
      re = src.ruleSearch;
      warnings.push({ level: "note", msg: "ruleExplore 为空，已用 ruleSearch 列表规则补全 bookWorld" });
    } else {
      return { module: null, warnings: warnings.concat([{ level: "note", msg: "无 ruleExplore/ruleSearch，跳过 bookWorld" }]) };
    }
  }
  var lines = parseExploreLines(src.exploreUrl);
  if (!lines.length) {
    return { module: null, warnings: warnings.concat([{ level: "note", msg: "exploreUrl 为空，跳过 bookWorld" }]) };
  }

  var jctx = jsonCtx(ctx, re.bookList);
  if (jctx.jsonEnabled) jsonNote(warnings);
  var m = base("bookWorld", jctx.host, jctx.jsonEnabled);
  var p = pickFields(re, [
    ["bookList", "list"],
    ["name", "bookName"],
    ["bookUrl", "detailUrl"],
    ["coverUrl", "cover", { optional: true }],
    ["intro", "desc", { optional: true }],
    ["author", "author", { optional: true }],
    ["kind", "cat", { optional: true }],
    ["wordCount", "wordCount", { optional: true }],
    ["lastChapter", "lastChapterTitle", { optional: true }]
  ], jctx);
  Object.keys(p.out).forEach(function (k) { m[k] = p.out[k]; });
  warnings = warnings.concat(p.warnings);

  // ===== 分类多分组：{{}} 归一化后按「tail+post 分页结构」聚合，可产出多个独立分类页 =====
  // 每行分解为：base(根路径) + "/" + tail(连接段,可空) + {{页码表达式}} + post(后缀)
  // 组内 base 仅一段互异且其余全等 → _type 格式三；否则 → 格式二拼接(order+"/"+tail+pageIndex+post)；
  // 无法成组的单行 → 「更多」入口运行时求值。多个分组即多个 bookWorld 条目（多 filters）。
  var normLines = [];
  var hasBad = false, badList = [];
  for (var ni = 0; ni < lines.length; ni++) {
    var nt = normalizePageTemplates(lines[ni].path);
    if (nt.bad.length) { hasBad = true; badList = badList.concat(nt.bad); }
    var rawNorm = nt.norm;
    var pi0 = rawNorm.indexOf("{{page}}");
    var preI0 = pi0 === -1 ? rawNorm : rawNorm.slice(0, pi0);
    var postI0 = pi0 === -1 ? "" : rawNorm.slice(pi0 + 8);
    var lastSlash = preI0.lastIndexOf("/");
    var baseP = lastSlash === -1 ? "" : preI0.slice(0, lastSlash).replace(/\/+$/, "");
    var tailP = lastSlash === -1 ? preI0 : preI0.slice(lastSlash + 1);
    if (baseP === "") baseP = "/";
    normLines.push({
      name: lines[ni].name,
      raw: lines[ni].path,
      base: baseP,
      tail: tailP,
      post: postI0,
      exprs: nt.exprs,
      sig: nt.exprs.join("\u0001")
    });
  }
  if (hasBad) {
    warnings.push({ level: "degraded", msg: "分类 URL 含选择器型占位符（" + badList.slice(0, 3).join("、") + (badList.length > 3 ? "…" : "") + "），无法在分类入口求值，已原样保留，请人工处理" });
  }

  var entries = [];
  var entrySeq = 0;
  function pushEntry(keyHint, ri, filtersVal, noteMsg) {
    entrySeq++;
    var eName = keyHint || (entrySeq === 1 ? "分类" : "分类" + entrySeq);
    var em = base("bookWorld", jctx.host, jctx.jsonEnabled);
    Object.keys(p.out).forEach(function (k3) { em[k3] = p.out[k3]; });
    em.requestInfo = ri;
    em._sIndex = entries.length;
    em.moreKeys = { pageSize: 20 };
    if (filtersVal !== null) em.moreKeys.requestFilters = filtersVal;
    entries.push({ key: eName, module: em });
    if (noteMsg) warnings.push({ level: "note", msg: noteMsg });
  }

  // —— 按 (tail,post) 聚合 ——
  var groupMap = {};
  var groupOrder = [];
  var leftovers = [];
  for (var gi = 0; gi < normLines.length; gi++) {
    var L0 = normLines[gi];
    if (!L0.exprs.length) { leftovers.push(L0); continue; }
    var gkey = L0.tail + "\u0001" + L0.post;
    if (!groupMap[gkey]) { groupMap[gkey] = []; groupOrder.push(gkey); }
    groupMap[gkey].push(L0);
  }

  for (var g2 = 0; g2 < groupOrder.length; g2++) {
    var grp = groupMap[groupOrder[g2]];
    var head = grp[0];
    var sigOk = true;
    for (var s1 = 1; s1 < grp.length; s1++) {
      if (grp[s1].sig !== head.sig) { sigOk = false; break; }
    }
    if (!sigOk) { leftovers = leftovers.concat(grp); continue; }

    // 尝试 _type：各 base 段数相同；互异列可为 1 列（单键）或多列（多键组合，如 /${f1}/${f2}）；其余列全等；token 干净
    var uniform = grp.length >= 2;
    var segsArr = [];
    if (uniform) {
      for (var m2 = 0; m2 < grp.length; m2++) {
        var sg = grp[m2].base.split("/");
        if (m2 > 0 && sg.length !== segsArr[0].length) { uniform = false; break; }
        segsArr.push(sg);
      }
    }
    var diffCols = [];
    if (uniform) {
      for (var si = 0; si < segsArr[0].length; si++) {
        var colDiff = false;
        for (var m3 = 1; m3 < segsArr.length; m3++) {
          if (segsArr[m3][si] !== segsArr[0][si]) { colDiff = true; break; }
        }
        if (colDiff) diffCols.push(si);
      }
      if (!diffCols.length) uniform = false;
    }
    var tokensByCol = [];
    if (uniform) {
      for (var d1 = 0; d1 < diffCols.length; d1++) {
        var colTokens = [];
        for (var m4 = 0; m4 < grp.length; m4++) {
          var tk = segsArr[m4][diffCols[d1]];
          if (!tk || /[?=&\s]/.test(tk) || tk.indexOf("{{") !== -1) { uniform = false; break; }
          colTokens.push(tk);
        }
        if (!uniform) break;
        tokensByCol.push(colTokens);
      }
    }

    if (uniform) {
      var skelSegs = segsArr[0].slice();
      var keyNames = [];
      for (var d2 = 0; d2 < diffCols.length; d2++) {
        skelSegs[diffCols[d2]] = "_K" + d2 + "_";
        keyNames.push(diffCols.length === 1 ? "_type" : "f" + (d2 + 1));
      }
      var pgExprs = head.sig === "" ? [] : head.sig.split("\u0001");
      var pIdx = 0;
      var urlTpl = skelSegs.join("/") + "/" + head.tail + "{{page}}" + head.post;
      for (var d3 = 0; d3 < keyNames.length; d3++) {
        urlTpl = urlTpl.replace("_K" + d3 + "_", "${" + keyNames[d3] + "}");
      }
      urlTpl = urlTpl.replace(/\{\{page\}\}/g, function () {
        pIdx++;
        return "${" + (pgExprs[pIdx] || "params.pageIndex") + "}";
      });
      var filtersVal;
      var riHead;
      if (diffCols.length === 1) {
        // 单键：保持格式三字符串（对齐手工基准）
        var f3 = "_type";
        for (var m6 = 0; m6 < grp.length; m6++) {
          f3 += "\n" + grp[m6].name + "::" + tokensByCol[0][m6];
        }
        filtersVal = f3;
        riHead = "let {_type}=params.filters";
      } else {
        // 多键：格式二数组，每列一个筛选变量（组合维度）
        var arr2 = [];
        for (var d4 = 0; d4 < diffCols.length; d4++) {
          var its = [];
          var seenV = {};
          for (var m7 = 0; m7 < grp.length; m7++) {
            var vv = tokensByCol[d4][m7];
            if (seenV[vv]) continue;
            seenV[vv] = 1;
            its.push({ title: grp[m7].name, value: vv });
          }
          arr2.push({ key: keyNames[d4], items: its });
        }
        filtersVal = arr2;
        riHead = "let {" + keyNames.join(",") + "}=params.filters";
      }
      pushEntry(null,
          "@js:\n" + riHead + "\nlet url=`" + urlTpl + "`;\n\nreturn {url:url}",
          filtersVal,
          "分类页[" + (entries.length === 0 ? "分类" : "分类" + (entries.length + 1)) + "]：" + grp.length + " 个分类共享模板"
              + (diffCols.length > 1 ? "（多维筛选 " + keyNames.join("/") + "）" : "（_type）"));
      continue;
    }

    // 非均匀组 → 拼接方案（格式二），tail/post 组内一致
    var itemsJ = [];
    for (var m7 = 0; m7 < grp.length; m7++) {
      itemsJ.push({ title: grp[m7].name, value: grp[m7].base });
      if (!/^https?:\/\//i.test(grp[m7].raw)) {
        warnings.push({ level: "note", msg: "分类[" + grp[m7].name + "] URL 为相对地址（" + grp[m7].base + "），将基于站点 host 拼接" });
      }
    }
    var tplJ = "params.filters.order + \"/\"";
    if (head.tail !== "") tplJ += " + \"" + utils.escStr(head.tail) + "\"";
    tplJ += " + params.pageIndex";
    if (head.post !== "") tplJ += " + \"" + utils.escStr(head.post) + "\"";
    pushEntry(null,
        "@js:\nlet url = " + tplJ + "\n\nreturn encodeURI(url)",
        [{ key: "order", items: itemsJ }],
        "分类页[" + (entries.length === 0 ? "分类" : "分类" + (entries.length + 1)) + "]：" + grp.length + " 个分类共用分页结构（格式二）");
  }

  // —— 兜底「更多」：无法成组的单行/混合表达式，运行时按 page/key 求值 ——
  if (leftovers.length) {
    var itemsR = [];
    for (var r2 = 0; r2 < leftovers.length; r2++) {
      var p3 = safeDecode(leftovers[r2].raw);
      itemsR.push({ title: leftovers[r2].name, value: p3 });
      if (!/^https?:\/\//i.test(leftovers[r2].raw)) {
        warnings.push({ level: "note", msg: "分类[" + leftovers[r2].name + "] URL 为相对地址，将基于站点 host 拼接" });
      }
    }
    pushEntry("更多",
        "@js:\nlet url = String(params.filters.order).replace(/\\{\\{([\\s\\S]*?)\\}\\}/g, function(_, e){\n"
        + "  try {\n"
        + "    var f = new Function('page', 'key', 'return (' + e + ')');\n"
        + "    return String(f(params.pageIndex, params.keyWord));\n"
        + "  } catch (err) {\n"
        + "    return _;\n"
        + "  }\n"
        + "})\n\nreturn encodeURI(url)",
        [{ key: "order", items: itemsR }],
        "分类页[更多]：" + itemsR.length + " 个分类结构特殊，运行时求值（支持算术与三元表达式）");
  }

  if (!entries.length) {
    return { module: null, warnings: warnings.concat([{ level: "note", msg: "exploreUrl 未解析出可用分类，跳过 bookWorld" }]) };
  }
  var world2 = {};
  entries.forEach(function (en2) { world2[en2.key] = en2.module; });
  return { module: world2, warnings: warnings };
}

module.exports = {
  buildSearchBook: buildSearchBook,
  buildBookDetail: buildBookDetail,
  buildChapterList: buildChapterList,
  buildChapterContent: buildChapterContent,
  buildBookWorld: buildBookWorld
};
