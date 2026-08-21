"use strict";
/*
 * 顶层组装：Legado 书源 JSON → XSGG 书源 JSON
 * 核心逻辑不依赖 Node API，可在浏览器/WebView 中运行
 */

var utils = require("./utils");
var modules = require("./modules");

function normalizeSource(source) {
  if (Array.isArray(source)) {
    return source.length ? source[0] : null;
  }
  if (source && typeof source === "object") {
    // Legado 导出格式 { "0": {...} } 或直接对象
    if ("0" in source) return source["0"];
    if ("bookSourceUrl" in source || "searchUrl" in source) return source;
    var keys = Object.keys(source);
    for (var i = 0; i < keys.length; i++) {
      var v = source[keys[i]];
      if (v && typeof v === "object" && ("bookSourceUrl" in v || "searchUrl" in v)) return v;
    }
  }
  return null;
}

function convert(source, options) {
  options = options || {};
  var warnings = [];
  var src = normalizeSource(source);
  if (!src) {
    return { output: null, warnings: [{ level: "error", msg: "无法识别的书源格式" }] };
  }

  // 必填校验：bookSourceUrl（开源阅读）→ sourceUrl（香色闺阁，规则必填）
  if (!src.bookSourceUrl || !String(src.bookSourceUrl).trim()) {
    warnings.push({ level: "error", msg: "缺少 bookSourceUrl：香色闺阁 sourceUrl 必填（站点首页 URL，全局唯一），转换结果中 sourceUrl 为空，请人工补充" });
  }

  // bookSourceType：0=文本 1=音频 2=图片漫画 3=文件 4=视频
  // 香色闺阁支持文本/图片/音频/视频源（sourceType: text/audio/comic/video），
  // 但转换器按文本源生成规则，非文本源需人工核对封面/正文/播放相关规则
  var bst = src.bookSourceType;
  if (bst !== undefined && bst !== null && Number(bst) !== 0) {
    var bstName = { 1: "音频", 2: "图片漫画", 3: "文件", 4: "视频" }[Number(bst)] || "未知类型";
    warnings.push({ level: "error", msg: "bookSourceType=" + bst + "（" + bstName + "）：香色闺阁支持对应 sourceType（text/audio/comic/video），但转换规则按文本源生成，封面/正文/播放规则请人工核对" });
  }

  var host = utils.originOf(src.bookSourceUrl) || "";
  var ctx = {
    src: src,
    host: host,
    jsonEnabled: false,
    cryptoJsSource: options.cryptoJsSource || null
  };

  var modulesOut = {};
  var order = ["searchBook", "bookDetail", "chapterList", "chapterContent", "bookWorld"];
  var builders = {
    searchBook: modules.buildSearchBook,
    bookDetail: modules.buildBookDetail,
    chapterList: modules.buildChapterList,
    chapterContent: modules.buildChapterContent,
    bookWorld: modules.buildBookWorld
  };
  for (var i = 0; i < order.length; i++) {
    var name = order[i];
    var r = builders[name](src, ctx);
    warnings = warnings.concat(r.warnings.map(function (w) {
      return { level: w.level, module: name, msg: w.msg };
    }));
    if (r.module) {
      modulesOut[name] = r.module;
    }
  }

  var now = Date.now() / 1000;
  // bookSourceType → sourceType：0=text 1=audio 2=comic 4=video（3=文件无对应，默认 text）
  var bstMap = { 0: "text", 1: "audio", 2: "comic", 4: "video" };
  var sourceType = bstMap[Number(src.bookSourceType)] || "text";
  var top = {
    sourceName: src.bookSourceName || "未命名书源",
    sourceUrl: String(src.bookSourceUrl || "").replace(/\/+$/, ""),
    sourceType: sourceType,
    weight: String(src.weight === undefined ? 0 : src.weight),
    enable: src.enabled === false ? "0" : "1",
    miniAppVersion: "2.53.2",
    lastModifyTime: String(now),
    shudanList: {},
    shudanDetail: { actionID: "shudanDetail", parserID: "DOM" },
    shupingList: { actionID: "shupingList", parserID: "DOM" },
    shupingHome: { actionID: "shupingHome", parserID: "DOM" },
    searchShudan: { actionID: "searchShudan", parserID: "DOM" },
    relatedWord: { actionID: "relatedWord", parserID: "DOM" }
  };
  Object.keys(modulesOut).forEach(function (k) { top[k] = modulesOut[k]; });

  // header（JSON 字符串/对象）→ httpHeaders：站点需要特定 UA/Referer/Cookie 时必需
  var hdr = src.header;
  if (hdr !== undefined && hdr !== null && hdr !== "") {
    try {
      var ho = typeof hdr === "string" ? JSON.parse(hdr) : hdr;
      if (ho && typeof ho === "object" && Object.keys(ho).length) {
        top.httpHeaders = ho;
        warnings.push({ level: "note", msg: "已映射请求头 header → httpHeaders（" + Object.keys(ho).length + " 项）" });
      }
    } catch (e) {
      warnings.push({ level: "degraded", msg: "header 不是合法 JSON，未映射到 httpHeaders，需人工处理（原值：" + String(hdr).slice(0, 80) + "）" });
    }
  }

  // 文档中存在但 XSGG 无直接对应的字段：汇总提示，避免静默丢失
  var ignored = [];
  if (src.bookUrlPattern) ignored.push("bookUrlPattern");
  if (src.loginUrl) ignored.push("loginUrl");
  if (src.ruleBookInfo) {
    if (src.ruleBookInfo.canReName) ignored.push("canReName");
    if (src.ruleBookInfo.bookInfoInit) ignored.push("bookInfoInit");
  }
  if (src.ruleToc && src.ruleToc.isVip) ignored.push("isVip");
  if (src.ruleContent) {
    if (src.ruleContent.webJs) ignored.push("webJs");
    if (src.ruleContent.sourceRegex) ignored.push("sourceRegex");
  }
  if (ignored.length) {
    warnings.push({ level: "note", msg: "以下字段无香色闺阁对应，已忽略：" + ignored.join("、") });
  }

  var output = {};
  output[top.sourceName] = top;

  return { output: output, warnings: warnings };
}

module.exports = { convert: convert };
