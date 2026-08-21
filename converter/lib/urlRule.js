"use strict";
/*
 * Legado URL 规则 → XSGG requestInfo
 * 处理：
 *   - {{key}} / {{page}} → %@keyWord / %@pageIndex（简单情形直接替换）
 *   - 复杂 {{表达式}}（含 java.*、算术、<,X> 可选前缀）→ @js: 动态脚本
 *   - ,{"method":"POST","body":"a={{key}}&b=1","headers":{...},"webView":true,"charset":"gbk"}
 *     → @js: 返回 {url, POST, httpParams, httpHeaders, webView} + 动作级 responseEncode
 */

var utils = require("./utils");
var jsRule = require("./jsRule");

var escStr = utils.escStr;

// 编码 → XSGG responseEncode
var CHARSET_MAP = {
  "": "",
  "utf-8": "",
  "utf8": "",
  "gbk": "2147485234",
  "gb2312": "2147485232",
  "gb18030": "2147485232",
  "big5": "2147485232"
};

// 匹配 {{...}}，返回 [{expr, start, end}]
function findTemplates(url) {
  var out = [];
  var i = 0;
  var n = url.length;
  while (i < n) {
    if (url[i] === "{" && url[i + 1] === "{") {
      var end = url.indexOf("}}", i + 2);
      if (end === -1) break;
      out.push({ expr: url.slice(i + 2, end), start: i, end: end + 2 });
      i = end + 2;
      continue;
    }
    i++;
  }
  return out;
}

// 表达式 → JS 表达式（key/page/java.*/算术）
// 返回 {expr, needsCrypto, notes}
function exprToJs(expr, ctx) {
  var notes = [];
  var e = expr;
  var needsCrypto = false;
  // java.* 调用翻译
  var i = 0;
  var out = "";
  var n = e.length;
  while (i < n) {
    if (e.substr(i, 5) === "java.") {
      var call = jsRule.findJavaCall ? findJavaCallSafe(e, i) : null;
      if (call) {
        var r = jsRule.translateJavaCall(call.name, call.args);
        if (r) {
          out += r.expr;
          if (r.crypto) needsCrypto = true;
          if (r.note) notes.push(r.note);
          i = call.end;
          continue;
        }
        notes.push("java." + call.name + "() 无法翻译，已保留原样");
        out += e.slice(i, call.end);
        i = call.end;
        continue;
      }
    }
    // key / page 变量（词边界）
    var m = e.slice(i).match(/^[a-zA-Z_$][\w$]*/);
    if (m) {
      var w = m[0];
      var prevOk = i === 0 || !/[a-zA-Z0-9_$]/.test(e[i - 1]);
      if (prevOk && w === "key") { out += "params.keyWord"; i += w.length; continue; }
      if (prevOk && w === "page") { out += "params.pageIndex"; i += w.length; continue; }
      out += w;
      i += w.length;
      continue;
    }
    out += e[i];
    i++;
  }
  return { expr: out, needsCrypto: needsCrypto, notes: notes };
}

function findJavaCallSafe(code, from) {
  // 轻量复用 jsRule 的平衡括号匹配（导出前先内联一份）
  var m = code.slice(from).match(/java\.[a-zA-Z_]\w*\s*\(/);
  if (!m) return null;
  var start = from + m.index;
  var nameEnd = code.indexOf("(", start);
  var name = code.slice(start + 5, nameEnd).trim();
  var depth = 1;
  var quote = null;
  var i = nameEnd + 1;
  var n = code.length;
  while (i < n) {
    var c = code[i];
    if (quote) {
      if (c === "\\") { i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; i++; continue; }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return { name: name, args: code.slice(nameEnd + 1, i), start: start, end: i + 1 };
    }
    i++;
  }
  return null;
}

// 单个模板值 → JS 片段（用于模板字符串或拼接）
function templateToJs(expr, ctx) {
  // <,X> 形式：X 为空时省略前导逗号
  var m = expr.match(/^<,(.+),\s*$/);
  if (m) {
    var inner = exprToJs(m[1], ctx);
    return {
      js: "(" + inner.expr + ' ? "," + String(' + inner.expr + ") : \"\")",
      needsCrypto: inner.needsCrypto,
      notes: inner.notes
    };
  }
  var r = exprToJs(expr, ctx);
  return { js: "String(" + r.expr + ")", needsCrypto: r.needsCrypto, notes: r.notes };
}

// body 字符串（a=1&b={{key}}&c=x{{page}}y）→ httpParams JS 对象字面量
function bodyToParams(body, ctx) {
  var notes = [];
  var needsCrypto = false;
  var pairs = body.split("&");
  var parts = [];
  for (var i = 0; i < pairs.length; i++) {
    var kv = pairs[i];
    if (!kv) continue;
    var eq = kv.indexOf("=");
    var k = eq === -1 ? kv : kv.slice(0, eq);
    var v = eq === -1 ? "" : kv.slice(eq + 1);
    var tpls = findTemplates(v);
    var jsVal;
    if (!tpls.length) {
      jsVal = '"' + escStr(v) + '"';
    } else if (tpls.length === 1 && tpls[0].start === 0 && tpls[0].end === v.length) {
      var r1 = exprToJs(tpls[0].expr, ctx);
      jsVal = r1.expr;
      notes = notes.concat(r1.notes);
      if (r1.needsCrypto) needsCrypto = true;
    } else {
      // 混合：字符串与表达式拼接
      var out = "";
      var last = 0;
      for (var j = 0; j < tpls.length; j++) {
        var t = tpls[j];
        if (t.start > last) out += '"' + escStr(v.slice(last, t.start)) + '" + ';
        var r2 = exprToJs(t.expr, ctx);
        out += "String(" + r2.expr + ") + ";
        notes = notes.concat(r2.notes);
        if (r2.needsCrypto) needsCrypto = true;
        last = t.end;
      }
      if (last < v.length) out += '"' + escStr(v.slice(last)) + '"';
      else out = out.slice(0, -3);
      jsVal = out;
    }
    parts.push('"' + escStr(k) + '": ' + jsVal);
  }
  return { literal: "{" + parts.join(", ") + "}", needsCrypto: needsCrypto, notes: notes };
}

// 拆分 url,{options}（options 必须是合法 JSON）
// 返回 {url, options} 或 {url}（无选项）
function splitUrlOptions(urlRule) {
  var i = urlRule.indexOf(",{");
  if (i === -1) return { url: urlRule };
  // 找匹配的右花括号
  var depth = 1;
  var quote = null;
  var j = i + 2;
  var n = urlRule.length;
  while (j < n) {
    var c = urlRule[j];
    if (quote) {
      if (c === "\\") { j += 2; continue; }
      if (c === quote) quote = null;
      j++;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; j++; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) break;
    }
    j++;
  }
  if (depth !== 0) return { url: urlRule };
  var optStr = urlRule.slice(i + 1, j + 1);
  try {
    var options = JSON.parse(optStr);
    return { url: urlRule.slice(0, i), options: options };
  } catch (e) {
    return { url: urlRule };
  }
}

// 生成 requestInfo；返回 { requestInfo, actionExtra, warnings }
// ctx: { src, host(origin), jsonEnabled, cryptoJsSource }
function buildRequestInfo(urlRule, ctx, role) {
  // role: 'search' | 'explore' | 'toc' | 'content' | 'nextToc' | 'nextContent'
  var warnings = [];
  var split = splitUrlOptions(urlRule);
  var url = split.url.trim();
  var options = split.options || null;
  var notes = [];

  var urlStr = url;
  // 预处理 <,{{expr}}> 可选前缀 → 条件表达式占位（须在绝对化之前，避免 <> 被编码）
  var opt = expandOptionalPrefix(urlStr);
  urlStr = opt.url;
  var optMaps = opt.maps;

  // 相对 URL 绝对化（以 sourceUrl 为基准）
  if (!/^https?:\/\//i.test(urlStr) && !/^data:/i.test(urlStr)) {
    urlStr = utils.resolveUrl(urlStr, ctx.src.bookSourceUrl || ctx.host);
    notes.push("相对 URL 已基于站点地址绝对化");
  }

  var tpls = findTemplates(urlStr);
  var simple = true; // 是否所有模板都是 key/page 且无可选前缀
  for (var i = 0; i < tpls.length; i++) {
    var e = tpls[i].expr.trim();
    if (e !== "key" && e !== "page") { simple = false; break; }
  }
  if (optMaps.length) simple = false;

  // 选项中的可动作级字段
  var actionExtra = {};
  if (options && options.charset) {
    var enc = CHARSET_MAP[String(options.charset).toLowerCase()];
    if (enc !== undefined) {
      if (enc !== "") actionExtra.responseEncode = enc;
    } else {
      warnings.push({ level: "degraded", msg: "charset=" + options.charset + " 无对应 responseEncode，已忽略（站点若为非 UTF-8 需人工处理）" });
    }
  }

  var needsCrypto = false;
  var jsLines = [];

  if (options && options.method && String(options.method).toUpperCase() === "POST" && options.body) {
    // POST 情形 → @js: 脚本
    var bp = bodyToParams(String(options.body), ctx);
    notes = notes.concat(bp.notes);
    if (bp.needsCrypto) needsCrypto = true;
    var tplLit = jsUrlTemplate(urlStr, tpls, optMaps, ctx, notes);
    if (tplLit.needsCrypto) needsCrypto = true;
    jsLines.push("let url = `" + tplLit.literal + "`;");
    jsLines.push("let httpParams = " + bp.literal + ";");
    var ret = "{url: url, POST: true, httpParams: httpParams";
    if (options.headers) {
      var hdr = typeof options.headers === "string" ? options.headers : JSON.stringify(options.headers);
      jsLines.push("let httpHeaders = " + hdr + ";");
      ret += ", httpHeaders: httpHeaders";
    }
    if (options.webView) ret += ', webView: ""';
    if (options.retry) warnings.push({ level: "note", msg: "retry=" + options.retry + " 已忽略" });
    jsLines.push("return " + ret + "};");
  } else if (!simple || options) {
    // 复杂模板或带选项 → @js: 脚本
    var tplLit2 = jsUrlTemplate(urlStr, tpls, optMaps, ctx, notes);
    if (tplLit2.needsCrypto) needsCrypto = true;
    jsLines.push("let url = `" + tplLit2.literal + "`;");
    var ret2 = "{url: url";
    if (options) {
      if (options.method && String(options.method).toUpperCase() === "POST") {
        warnings.push({ level: "degraded", msg: "POST 但无 body，已按 GET 处理" });
      }
      if (options.headers) {
        var hdr2 = typeof options.headers === "string" ? options.headers : JSON.stringify(options.headers);
        jsLines.push("let httpHeaders = " + hdr2 + ";");
        ret2 += ", httpHeaders: httpHeaders";
      }
      if (options.webView) ret2 += ', webView: ""';
      if (options.js) {
        var jsOpt = jsRule.translateJs(String(options.js), ctx);
        notes = notes.concat(jsOpt.notes.map(function (x) { return x; }));
        if (jsOpt.needsCrypto) needsCrypto = true;
        jsLines.push(jsOpt.code);
        warnings.push({ level: "degraded", msg: "URL 的 js 参数已并入脚本执行，请人工确认" });
      }
    }
    jsLines.push("return " + ret2 + "};");
  } else {
    // 简单情形：直接占位符（反向迭代避免索引错位）
    var plain = urlStr;
    for (var k3 = tpls.length - 1; k3 >= 0; k3--) {
      var t4 = tpls[k3];
      var rep = t4.expr.trim() === "key" ? "%@keyWord" : "%@pageIndex";
      plain = plain.slice(0, t4.start) + rep + plain.slice(t4.end);
    }
    if (role === "search" && urlStr.indexOf("{{key}}") === -1) {
      warnings.push({ level: "note", msg: "搜索 URL 未包含 {{key}}，搜索结果可能不随关键词变化" });
    }
    var ri = plain;
    return { requestInfo: ri, actionExtra: actionExtra, warnings: warnings.concat(notes.map(function (n) { return { level: "note", msg: n }; })) };
  }

  var block = jsRule.wrapJsBlock(jsLines, ctx, needsCrypto);
  warnings = warnings.concat(notes.map(function (n) { return { level: "note", msg: n }; }));
  if (needsCrypto) {
    warnings.push({ level: "note", msg: "已注入 cryptojs（前端 CryptoJS 库），注入语法请以实际 App 验证为准" });
  }
  return { requestInfo: block, actionExtra: actionExtra, warnings: warnings };
}

function escTemplate(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function applyOptMaps(s, maps) {
  for (var i = 0; i < maps.length; i++) {
    s = s.split(maps[i].marker).join("${" + maps[i].js + "}");
  }
  return s;
}

// 构建模板字符串字面量正文：
// 1. 模板插值位置先放占位符 \u0002N\u0002（反向迭代避免索引错位）
// 2. escTemplate 只转义 URL 文本自身的 \ ` ${，不动占位符
// 3. 最后把占位符还原为真实 ${expr} 插值
function jsUrlTemplate(urlStr, tpls, optMaps, ctx, notes) {
  var tplMarkers = [];
  var needsCrypto = false;
  var i;
  for (i = tpls.length - 1; i >= 0; i--) {
    var t = tpls[i];
    var r = exprToJs(t.expr, ctx);
    notes = notes.concat(r.notes);
    if (r.needsCrypto) needsCrypto = true;
    var marker = "\u0002tpl" + tplMarkers.length + "\u0002";
    tplMarkers.push({ marker: marker, js: r.expr });
    urlStr = urlStr.slice(0, t.start) + marker + urlStr.slice(t.end);
  }
  var escaped = escTemplate(urlStr);
  var maps = tplMarkers.concat(optMaps);
  for (i = 0; i < maps.length; i++) {
    escaped = escaped.split(maps[i].marker).join("${" + maps[i].js + "}");
  }
  return { literal: escaped, needsCrypto: needsCrypto };
}

// 展开 <,{{expr}}> 可选前缀：expr 为空(假)时省略前导逗号
// 返回 { url: 替换后的url, maps: [{marker, js}] }
function expandOptionalPrefix(urlStr) {
  var out = "";
  var maps = [];
  var i = 0;
  var n = urlStr.length;
  var counter = 0;
  while (i < n) {
    if (urlStr[i] === "<" && urlStr[i + 1] === "," && urlStr[i + 2] === "{" && urlStr[i + 3] === "{") {
      var exprEnd = urlStr.indexOf("}}", i + 4);
      if (exprEnd !== -1 && urlStr[exprEnd + 2] === ">") {
        var expr = urlStr.slice(i + 4, exprEnd);
        var r = exprToJs(expr, {});
        var marker = "_XOPT" + (counter++) + "_";
        maps.push({
          marker: marker,
          js: "(" + r.expr + ' ? "," + String(' + r.expr + ") : \"\")"
        });
        out += marker;
        i = exprEnd + 3;
        continue;
      }
    }
    out += urlStr[i];
    i++;
  }
  return { url: out, maps: maps };
}

module.exports = {
  buildRequestInfo: buildRequestInfo,
  splitUrlOptions: splitUrlOptions,
  findTemplates: findTemplates,
  CHARSET_MAP: CHARSET_MAP
};
