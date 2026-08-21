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
  return { module: m, warnings: warnings };
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

  var typeMode = analyzeTypeMode(lines);
  if (typeMode) {
    // _type 模式：共享 URL 模板 + 格式三筛选（对齐手工转换基准：小原文学网（香色闺阁）.json）
    var filters = "_type";
    for (var i = 0; i < lines.length; i++) {
      filters += "\n" + lines[i].name + "::" + typeMode.tokens[i];
    }
    var urlTpl = typeMode.pattern.replace("_TYPE_", "${_type}") + "${params.pageIndex}" + typeMode.post;
    m.requestInfo = "@js:\nlet {_type}=params.filters\nlet url=`" + urlTpl + "`;\n\nreturn {url:url}";
    m._sIndex = 0;
    m.moreKeys = {
      pageSize: 20,
      requestFilters: filters
    };
    warnings.push({ level: "note", msg: "bookWorld 分类已写入 moreKeys.requestFilters（" + lines.length + " 个分类共享 URL 模板），pageSize 固定 20" });
  } else {
    // 逐行模式（无共享 URL 模板）：格式二筛选数组 + requestInfo JS 拼接分页
    // 对齐手动转换基准：三四娱乐（手动分类）.json（params.filters.order + encodeURI）
    var items = [];
    var splittable = true;
    var pageSeg = null;
    var post = null;
    var PAGE_WORDS = /^(page|p|index|pn|pagenum|pageindex)$/i;
    for (var j = 0; j < lines.length; j++) {
      var path = safeDecode(lines[j].path);
      var pi = path.indexOf("{{page}}");
      if (pi === -1) {
        splittable = false;
        break;
      }
      var preI = path.slice(0, pi);
      var postI = path.slice(pi + 8);
      var preTrim = preI.replace(/\/+$/, "");
      var lastSeg = preTrim.split("/").pop() || "";
      var hasTrail = preI.length > preTrim.length;
      var isPageWord = hasTrail && PAGE_WORDS.test(lastSeg);
      if (j === 0) {
        pageSeg = isPageWord ? "/" + lastSeg + "/" : "";
        post = postI;
      } else if ((isPageWord ? "/" + lastSeg + "/" : "") !== pageSeg || postI !== post) {
        splittable = false;
        break;
      }
    }
    if (splittable && lines.length > 1) {
      // 拼接方案：value = 分类根路径（去掉分页段），requestInfo 统一拼 pageIndex
      for (var s = 0; s < lines.length; s++) {
        var p2 = safeDecode(lines[s].path);
        var pi2 = p2.indexOf("{{page}}");
        var preI2 = p2.slice(0, pi2);
        var preTrim2 = preI2.replace(/\/+$/, "");
        var lastSeg2 = preTrim2.split("/").pop() || "";
        var basePath = preTrim2;
        if (pageSeg !== "") {
          basePath = preTrim2.slice(0, preTrim2.length - lastSeg2.length).replace(/\/+$/, "");
        }
        if (basePath === "") basePath = "/";
        items.push({ title: lines[s].name, value: basePath });
        if (!/^https?:\/\//i.test(lines[s].path)) {
          warnings.push({ level: "note", msg: "分类[" + lines[s].name + "] URL 为相对地址（" + basePath + "），将基于站点 host 拼接" });
        }
      }
      var tpl = pageSeg === ""
          ? "params.filters.order + \"/\" + params.pageIndex" + (post ? " + \"" + post + "\"" : "")
          : "params.filters.order + \"" + pageSeg + "\" + params.pageIndex" + (post ? " + \"" + post + "\"" : "");
      m.requestInfo = "@js:\nlet url = " + tpl + "\n\nreturn encodeURI(url)";
    } else {
      // replace 方案：value 保留完整路径（含 {{page}}），运行时替换页码
      for (var r = 0; r < lines.length; r++) {
        var p3 = safeDecode(lines[r].path);
        items.push({ title: lines[r].name, value: p3 });
        if (!/^https?:\/\//i.test(lines[r].path)) {
          warnings.push({ level: "note", msg: "分类[" + lines[r].name + "] URL 为相对地址（" + p3 + "），将基于站点 host 拼接" });
        }
      }
      m.requestInfo = "@js:\nlet url = params.filters.order.replace('{{page}}', params.pageIndex)\n\nreturn encodeURI(url)";
    }
    m._sIndex = 0;
    m.moreKeys = {
      pageSize: 20,
      requestFilters: [{ key: "order", items: items }]
    };
    warnings.push({ level: "note", msg: "bookWorld 分类已写入 moreKeys.requestFilters（格式二数组，" + items.length + " 个分类），pageSize 固定 20" });
  }
  var world2 = {};
  world2["分类"] = m;
  return { module: world2, warnings: warnings };
}

module.exports = {
  buildSearchBook: buildSearchBook,
  buildBookDetail: buildBookDetail,
  buildChapterList: buildChapterList,
  buildChapterContent: buildChapterContent,
  buildBookWorld: buildBookWorld
};
