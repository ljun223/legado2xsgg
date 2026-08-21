"use strict";
/*
 * 公共工具：不依赖任何 Node API，可在浏览器/WebView 运行。
 */

// 在顶层（括号/方括号/花括号/引号/<js> 之外）查找分隔符出现的位置
// seps: 数组，如 ['||','&&','%%'] 或 '@'
function topLevelPositions(str, seps) {
  var pos = [];
  var depth = { paren: 0, bracket: 0, brace: 0 };
  var quote = null; // null | '"' | "'"
  var i = 0;
  var n = str.length;
  var jsMode = false; // <js>...</js> 内部
  while (i < n) {
    var c = str[i];
    if (jsMode) {
      if (c === '<' && str.substr(i, 6) === '</js>') {
        jsMode = false;
        i += 6;
        continue;
      }
      i++;
      continue;
    }
    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; i++; continue; }
    if (c === '<' && str.substr(i, 4) === '<js>') { jsMode = true; i += 4; continue; }
    if (c === '(') { depth.paren++; i++; continue; }
    if (c === ')') { depth.paren--; i++; continue; }
    if (c === '[') { depth.bracket++; i++; continue; }
    if (c === ']') { depth.bracket--; i++; continue; }
    if (c === '{') { depth.brace++; i++; continue; }
    if (c === '}') { depth.brace--; i++; continue; }
    if (depth.paren === 0 && depth.bracket === 0 && depth.brace === 0) {
      var matched = false;
      for (var k = 0; k < seps.length; k++) {
        if (str.substr(i, seps[k].length) === seps[k]) {
          pos.push({ index: i, sep: seps[k] });
          i += seps[k].length;
          matched = true;
          break;
        }
      }
      if (matched) continue;
    }
    i++;
  }
  return pos;
}

// 按顶层分隔符拆分（保留分隔符信息）
function splitTopLevel(str, seps) {
  var pos = topLevelPositions(str, seps);
  if (!pos.length) return [str];
  var out = [];
  var start = 0;
  pos.forEach(function (p) {
    out.push(str.slice(start, p.index));
    start = p.index + p.sep.length;
  });
  out.push(str.slice(start));
  return out;
}

// 提取尾部 ##正则##替换(###) 净化规则。
// 返回 { regex, repl, onlyOne } 或 null（无净化）。
// 规则体之外的 ## 才会被识别（跳过引号/括号/{{}}/<js> 内）。
function findCleanup(rule) {
  var n = rule.length;
  var depth = { paren: 0, bracket: 0, brace: 0 };
  var quote = null;
  var jsMode = false;
  var hashPos = [];
  var i = 0;
  while (i < n) {
    var c = rule[i];
    if (jsMode) {
      if (c === '<' && rule.substr(i, 6) === '</js>') { jsMode = false; i += 6; continue; }
      i++; continue;
    }
    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = null;
      i++; continue;
    }
    if (c === '"' || c === "'") { quote = c; i++; continue; }
    if (c === '<' && rule.substr(i, 4) === '<js>') { jsMode = true; i += 4; continue; }
    if (c === '(') { depth.paren++; i++; continue; }
    if (c === ')') { depth.paren--; i++; continue; }
    if (c === '[') { depth.bracket++; i++; continue; }
    if (c === ']') { depth.bracket--; i++; continue; }
    if (c === '{') { depth.brace++; i++; continue; }
    if (c === '}') { depth.brace--; i++; continue; }
    if (c === '#' && depth.paren === 0 && depth.bracket === 0 && depth.brace === 0) {
      if (rule[i + 1] === '#') {
        var triple = rule[i + 2] === '#';
        hashPos.push({ i: i, triple: triple });
        i += triple ? 3 : 2;
        continue;
      }
    }
    i++;
  }
  if (!hashPos.length) return null;
  var start = hashPos[0].i;
  var onlyOne = hashPos[0].triple;
  var tail = rule.slice(start + (onlyOne ? 3 : 2));
  var regex, repl = "";
  var idx2 = tail.indexOf('##');
  if (idx2 === -1) {
    regex = tail;
  } else {
    regex = tail.slice(0, idx2);
    var rest = tail.slice(idx2 + 2);
    if (rest.slice(-3) === '###') {
      onlyOne = true;
      rest = rest.slice(0, -3);
    }
    repl = rest;
  }
  return { regex: regex, repl: repl, onlyOne: onlyOne, start: start };
}

// 转义进入双引号属性的字符串
function escAttr(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// 转义 JS 正则字面量中的 /（反斜杠按原样保留，字面量里 \d 即数字类）
function escRegex(s) {
  return String(s).replace(/\//g, "\\/");
}

// 转义 JS 字符串字面量
function escStr(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r");
}

// 是否为纯文本字面量（无可疑正则元字符），可用 JS 字符串 replace 形式
var REGEX_META = /[\\^$.*+?()[\]{}|]/;
function isLiteralText(s) {
  return !REGEX_META.test(s);
}

// 将 -1 -> last() 之类的位置索引转 XPath 谓词
// index 为 0 起始，负数表示倒数
function indexPredicate(index) {
  if (index >= 0) return "[" + (index + 1) + "]";
  var k = -index - 1; // -1->0, -2->1
  return k === 0 ? "[last()]" : "[last()-" + k + "]";
}

function indexToPosExpr(index) {
  // 正索引直接输出数字：XPath 中 //a[1] 等价于 //a[position()=1]
  if (index >= 0) return String(index + 1);
  var k = -index - 1;
  return k === 0 ? "last()" : "last()-" + k;
}

// 规范化站点 URL：去掉尾部斜杠
function normalizeOrigin(url) {
  if (!url) return "";
  var s = String(url).trim();
  while (s.length > 1 && s.slice(-1) === "/") s = s.slice(0, -1);
  return s;
}

// 解析 URL 的 origin（scheme://host[:port]）
function originOf(url) {
  try {
    var u = new URL(url);
    return u.origin;
  } catch (e) {
    return null;
  }
}

// 相对 URL 绝对化（保护 {{}} / %@ 模板占位符不被 URL 编码）
function resolveUrl(rel, base) {
  if (!rel) return rel;
  var s = String(rel).trim();
  if (/^https?:\/\//i.test(s) || /^data:/i.test(s)) return s;
  s = s.replace(/\{\{/g, "_XSTMPL_O_").replace(/\}\}/g, "_XSTMPL_C_").replace(/%@/g, "_XSTMPL_P_");
  try {
    return new URL(s, base).href
      .replace(/_XSTMPL_O_/g, "{{")
      .replace(/_XSTMPL_C_/g, "}}")
      .replace(/_XSTMPL_P_/g, "%@");
  } catch (e) {
    return String(rel).trim();
  }
}

module.exports = {
  topLevelPositions: topLevelPositions,
  splitTopLevel: splitTopLevel,
  findCleanup: findCleanup,
  escAttr: escAttr,
  escRegex: escRegex,
  escStr: escStr,
  isLiteralText: isLiteralText,
  indexPredicate: indexPredicate,
  indexToPosExpr: indexToPosExpr,
  normalizeOrigin: normalizeOrigin,
  originOf: originOf,
  resolveUrl: resolveUrl
};