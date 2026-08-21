"use strict";
/*
 * 规则管道：把一条 Legado 字段规则转换为 XSGG 字段表达式
 * 处理顺序：
 *   1. 顶层 || 拆解（备选）
 *   2. 尾部 ##正则##替换(###) 净化提取
 *   3. 尾部 @js: / <js></js> 提取
 *   4. 规则体分类：@css: / @XPath: / // / @json: / $. / :正则 / @js: / Default
 *   5. 组装 XPath + @js: 后处理
 */

var utils = require("./utils");
var defaultRule = require("./defaultRule");
var cssRule = require("./cssRule");
var jsRule = require("./jsRule");

var escStr = utils.escStr;
var escRegex = utils.escRegex;
var isLiteralText = utils.isLiteralText;

// 查找顶层 @js: 位置（跳过引号/括号/{{}}/<js>）
function findTopLevelJs(rule) {
  var depth = { paren: 0, bracket: 0, brace: 0 };
  var quote = null;
  var jsMode = false;
  var i = 0;
  var n = rule.length;
  var found = -1;
  while (i < n) {
    var c = rule[i];
    if (jsMode) {
      if (c === "<" && rule.substr(i, 6) === "</js>") { jsMode = false; i += 6; continue; }
      i++; continue;
    }
    if (quote) {
      if (c === "\\") { i += 2; continue; }
      if (c === quote) quote = null;
      i++; continue;
    }
    if (c === '"' || c === "'") { quote = c; i++; continue; }
    if (c === "<" && rule.substr(i, 4) === "<js>") { jsMode = true; i += 4; continue; }
    if (c === "(") { depth.paren++; i++; continue; }
    if (c === ")") { depth.paren--; i++; continue; }
    if (c === "[") { depth.bracket++; i++; continue; }
    if (c === "]") { depth.bracket--; i++; continue; }
    if (c === "{") { depth.brace++; i++; continue; }
    if (c === "}") { depth.brace--; i++; continue; }
    if (depth.paren === 0 && depth.bracket === 0 && depth.brace === 0) {
      if (rule.substr(i, 4) === "@js:") {
        found = i;
        break;
      }
    }
    i++;
  }
  return found;
}

// 提取尾部 <js>code</js>（仅在末尾）
function extractTrailingJsTag(rule) {
  var idx = rule.lastIndexOf("</js>");
  if (idx === -1) return null;
  var openIdx = rule.lastIndexOf("<js>", idx);
  if (openIdx === -1) return null;
  var before = rule.slice(0, openIdx);
  var after = rule.slice(idx + 5);
  if (after.trim() !== "") return null; // 必须是末尾
  return { before: before, code: rule.slice(openIdx + 4, idx) };
}

// 净化 → JS replace 表达式
function cleanupToJs(cleanup) {
  var regex = cleanup.regex;
  var repl = cleanup.repl === undefined ? "" : cleanup.repl;
  if (!cleanup.onlyOne && isLiteralText(regex)) {
    // 纯文本：用字符串 replace（首次匹配），与人工书写习惯一致
    return 'result.replace("' + escStr(regex) + '","' + escStr(repl) + '")';
  }
  var flags = cleanup.onlyOne ? "" : "g";
  return "result.replace(/" + escRegex(regex) + "/" + flags + ',"' + escStr(repl) + '")';
}

// 确保 JS 代码有返回值：若无显式 return，包装为 return (...)
function ensureReturn(code) {
  var c = code.trim();
  if (/^(return|throw|function)\b/.test(c)) return c;
  if (/\breturn\b/.test(c)) return c;
  return "return (" + c + ");";
}

// 转换一条规则（无 || 备选）
// ctx: { field, module, src, host, jsonEnabled }
function convertOne(rule, ctx) {
  var warnings = [];
  var original = rule;

  // 1. 提取净化
  var cleanup = utils.findCleanup(rule);
  var body = cleanup ? rule.slice(0, cleanup.start) : rule;
  if (cleanup && body.trim() === "") {
    return { value: rule, warnings: [{ level: "unsupported", msg: "无法解析净化规则" }] };
  }

  // 2. 提取尾部 @js:
  var jsCode = null;
  var jsPos = findTopLevelJs(body);
  if (jsPos !== -1) {
    jsCode = body.slice(jsPos + 4);
    body = body.slice(0, jsPos);
  }

  // 3. 提取尾部 <js></js>
  var tag = extractTrailingJsTag(body);
  if (tag) {
    jsCode = (jsCode === null ? tag.code : tag.code + "\n" + jsCode);
    body = tag.before;
  }
  if (/<js>/.test(body)) {
    warnings.push({ level: "unsupported", msg: "规则中部存在 <js>，无法转换，已保留原样" });
    return { value: original, warnings: warnings };
  }

  // 4. 翻译 JS 片段
  var jsResult = null;
  if (jsCode !== null) {
    jsResult = jsRule.translateJs(jsCode, ctx);
    warnings = warnings.concat(jsResult.notes.map(function (n) {
      return { level: "degraded", msg: n };
    }));
  }

  // 5. 规则体分类
  var xpath = null;
  var bodyW = [];
  body = body.trim();
  if (body === "") {
    xpath = "";
  } else if (body.indexOf("@css:") === 0) {
    var r = cssRule.convertCss(body, ctx);
    if (r.error) { warnings.push({ level: "unsupported", msg: r.error + "（原文：" + body + "）" }); xpath = body; }
    else { xpath = r.xpath; bodyW = r.notes; }
  } else if (body.indexOf("@XPath:") === 0) {
    xpath = body.slice(7);
  } else if (body.indexOf("//") === 0) {
    xpath = body;
  } else if (body.indexOf("@json:") === 0 || body[0] === "$") {
    var jp = body.indexOf("@json:") === 0 ? body.slice(6) : body;
    if (ctx.jsonEnabled) {
      xpath = jp;
      warnings.push({ level: "degraded", msg: "JSONPath 已透传（" + jp + "），模块将使用 json 响应解析，SMJJSONPath 兼容性需人工验证" });
    } else {
      warnings.push({ level: "unsupported", msg: "JSONPath 规则（" + body + "）当前模块不支持，已保留原样，需人工处理" });
      xpath = body;
    }
  } else if (body.indexOf("@js:") === 0) {
    // 整条规则是 js
    var wholeJs = jsRule.translateJs(body.slice(4), ctx);
    jsResult = wholeJs;
    warnings = warnings.concat(wholeJs.notes.map(function (n) { return { level: "degraded", msg: n }; }));
    xpath = "";
  } else if (body[0] === ":" ) {
    warnings.push({ level: "unsupported", msg: "AllInOne 正则列表规则（" + body + "）不支持，已保留原样，需人工处理" });
    xpath = body;
  } else if (body[0] === "{" && body.indexOf("{{") !== 0) {
    warnings.push({ level: "unsupported", msg: "遗留 {} JSONPath 规则（" + body + "）不支持，已保留原样" });
    xpath = body;
  } else if (body.indexOf("@put:") === 0 || body.indexOf("@get") === 0 ||
             body.indexOf("@rule:") === 0 || body.indexOf("@header:") === 0 ||
             body.indexOf("@cookie:") === 0) {
    warnings.push({ level: "unsupported", msg: "变量操作规则（" + body + "）不支持，已保留原样" });
    xpath = body;
  } else if (body.indexOf("{{") !== -1) {
    warnings.push({ level: "unsupported", msg: "规则内嵌 {{}}（" + body + "）不支持，已保留原样，需人工处理" });
    xpath = body;
  } else {
    var d = defaultRule.convertDefault(body, ctx);
    if (d.error) {
      warnings.push({ level: "unsupported", msg: d.error + "（原文：" + body + "）" });
      xpath = body;
    } else {
      xpath = d.xpath;
      bodyW = d.notes;
    }
  }
  warnings = warnings.concat(bodyW.map(function (n) { return { level: "degraded", msg: n }; }));

  // 6. 组装
  var jsLines = [];
  if (xpath === "" && jsResult === null && cleanup === null) {
    return { value: "", warnings: warnings };
  }
  if (jsResult !== null && cleanup !== null) {
    // js + 净化：先执行 js，再对结果 replace
    jsLines.push("var _r = (function(){" + jsResult.code + "})();");
    jsLines.push("return " + cleanupToJs(cleanup).replace("result", "_r") + ";");
  } else if (jsResult !== null) {
    jsLines.push(ensureReturn(jsResult.code));
  } else if (cleanup !== null) {
    jsLines.push("return " + cleanupToJs(cleanup) + ";");
  }

  var value = xpath;
  if (jsLines.length) {
    if (value === "") {
      value = jsRule.wrapJsBlock(jsLines, ctx, jsResult ? jsResult.needsCrypto : false);
    } else {
      value += "\n@js:\n" + jsLines.join("\n");
      if (jsResult && jsResult.needsCrypto && ctx.cryptoJsSource) {
        value = "cryptojs=" + ctx.cryptoJsSource + "\n" + value;
        warnings.push({ level: "note", msg: "已注入 cryptojs（前端 CryptoJS 库），注入语法请以实际 App 验证为准" });
      }
    }
  }
  return { value: value, warnings: warnings };
}

// 主入口：一条字段规则（可含 || && %% 与倒序前缀 -）
// ctx: { field, module, src, host, jsonEnabled }
function convertRule(rule, ctx) {
  if (rule === undefined || rule === null) return { value: "", warnings: [] };
  rule = String(rule).trim();
  if (rule === "") return { value: "", warnings: [] };
  var warnings = [];
  var original = rule;
  if (rule[0] === "+") {
    warnings.push({ level: "unsupported", msg: "AllInOne(+) 列表规则不支持，已保留原样" });
  }
  // 列表倒序前缀 -（如目录 -tag.dd）：XSGG 无对应，剥离后转换并提示
  var reversed = false;
  while (rule.charAt(0) === "-") {
    reversed = true;
    rule = rule.slice(1).trim();
  }
  if (reversed) {
    warnings.push({ level: "degraded", msg: "列表倒序前缀 - 无 XSGG 对应，已忽略（结果顺序可能与原源相反，请人工确认）" });
    if (rule === "") return { value: original, warnings: warnings };
  }
  // %% 依次取数：无 XPath 对应
  if (utils.splitTopLevel(rule, ["%%"]).length > 1) {
    warnings.push({ level: "unsupported", msg: "%% 依次取数规则不支持，已保留原样，需人工处理" });
    return { value: original, warnings: warnings };
  }
  var hasAnd = utils.splitTopLevel(rule, ["&&"]).length > 1;
  var hasOr = utils.splitTopLevel(rule, ["||"]).length > 1;
  if (hasAnd && hasOr) {
    warnings.push({ level: "unsupported", msg: "规则同时含 && 与 ||，转换语义不明确，已保留原样，需人工处理" });
    return { value: original, warnings: warnings };
  }
  if (hasAnd) {
    // && 合并所有值 → 各段转纯 XPath 后用 | 并集（含 JS 的段无法合并）
    var andParts = utils.splitTopLevel(rule, ["&&"]);
    var andVals = [];
    var pureXp = true;
    var andW = [];
    for (var a = 0; a < andParts.length; a++) {
      var ar = convertOne(andParts[a], ctx);
      andW = andW.concat(ar.warnings);
      var av = String(ar.value);
      if (av.indexOf("@js:") !== -1 || av.indexOf("\n") !== -1) pureXp = false;
      andVals.push(av);
    }
    if (!pureXp) {
      warnings.push({ level: "unsupported", msg: "&& 合并规则含 JS 段，无法转 XPath 并集，已保留原样，需人工处理" });
      return { value: original, warnings: warnings.concat(andW) };
    }
    andW.push({ level: "degraded", msg: "&& 合并已转为 XPath 并集 |（文档序去重，与 Legado 依次拼接语义略有差异），请人工确认" });
    return { value: andVals.join(" | "), warnings: andW };
  }
  var alts = utils.splitTopLevel(rule, ["||"]);
  var vals = [];
  for (var i = 0; i < alts.length; i++) {
    var r = convertOne(alts[i], ctx);
    vals.push(r.value);
    warnings = warnings.concat(r.warnings);
  }
  return { value: vals.join(" || "), warnings: warnings };
}

module.exports = {
  convertRule: convertRule,
  convertOne: convertOne,
  cleanupToJs: cleanupToJs,
  ensureReturn: ensureReturn
};
