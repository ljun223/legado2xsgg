"use strict";
/*
 * Legado @css: 规则 → XPath（子集）
 * 支持：tag / .class / #id / [attr] / [attr=val] / [attr^=val] / [attr$=val] / [attr*=val] / [attr~=val]
 *      后代(空格) / 子代(>) / 相邻(+) / :eq(n) / :gt(n) / :lt(n) / :first / :last / :contains / :containsOwn
 * 不支持：:has / :not 嵌套等复杂伪类 → 标记不支持
 */

var utils = require("./utils");
var escAttr = utils.escAttr;
var escStr = utils.escStr;

// [attr=val] → XPath 谓词（不含方括号）
function attrPredicateToXpath(bracket) {
  var inner = bracket.slice(1, -1).trim();
  var m = inner.match(/^([\w-]+)\s*(?:(\^=|\$=|\*=|~=|=|!=)\s*(.+))?$/);
  if (!m) return { error: "属性选择器无法解析: " + bracket };
  var attr = m[1];
  var op = m[2];
  var val = m[3];
  if (val === undefined || val === null) return { predicate: "[@" + attr + "]", error: null };
  // 去掉引号
  val = val.trim();
  if ((val[0] === '"' && val.slice(-1) === '"') || (val[0] === "'" && val.slice(-1) === "'")) {
    val = val.slice(1, -1);
  }
  var v = '"' + escAttr(val) + '"';
  switch (op) {
    case "=": return { predicate: "[@" + attr + "=" + v + "]", error: null };
    case "^=": return { predicate: "[starts-with(@" + attr + "," + v + ")]", error: null };
    case "$=": return {
      predicate: "[substring(@" + attr + ", string-length(@" + attr + ")-string-length(" + v + ")+1)=" + v + "]",
      error: null
    };
    case "*=": return { predicate: "[contains(@" + attr + "," + v + ")]", error: null };
    case "~=": return {
      predicate: "[contains(concat(' ',normalize-space(@" + attr + "),' '),' " + escAttr(val) + " ')]",
      error: null
    };
    case "!=":
      return { predicate: "[not(@" + attr + "=" + v + ")]", error: null };
    default:
      return { error: "属性操作符不支持: " + op };
  }
}

// 单个 compound 选择器（如 div.foo[attr=x]:eq(0)）→ {tag, preds, notes}
function parseCompound(tok, ctx, notes) {
  var tag = "*";
  var preds = [];
  var i = 0;
  var n = tok.length;
  var first = true;
  while (i < n) {
    var c = tok[i];
    if (first && /[a-zA-Z_*]/.test(c)) {
      var m = tok.slice(i).match(/^[a-zA-Z_*][\w-]*/);
      tag = m[0];
      i += m[0].length;
      first = false;
      continue;
    }
    if (c === ".") {
      var m2 = tok.slice(i).match(/^\.([\w-]+)/);
      if (!m2) return { error: "class 选择器无法解析: " + tok };
      preds.push('contains(@class,"' + escAttr(m2[1]) + '")');
      i += m2[0].length;
      first = false;
      continue;
    }
    if (c === "#") {
      var m3 = tok.slice(i).match(/^#([\w-]+)/);
      if (!m3) return { error: "id 选择器无法解析: " + tok };
      preds.push('@id="' + escAttr(m3[1]) + '"');
      i += m3[0].length;
      first = false;
      continue;
    }
    if (c === "[") {
      var end = tok.indexOf("]", i);
      if (end === -1) return { error: "属性选择器未闭合: " + tok };
      var r = attrPredicateToXpath(tok.slice(i, end + 1));
      if (r.error) return { error: r.error };
      preds.push(r.predicate.slice(1, -1));
      i = end + 1;
      first = false;
      continue;
    }
    if (c === ":") {
      var pm = tok.slice(i).match(/^:([a-zA-Z]+)(\(([^)]*)\))?/);
      if (!pm) return { error: "伪类无法解析: " + tok };
      var name = pm[1];
      var arg = pm[3] !== undefined ? pm[3] : null;
      var pr;
      switch (name) {
        case "eq":
          var idx = parseInt(arg, 10);
          if (isNaN(idx)) return { error: ":eq 参数非法: " + arg };
          pr = String(idx + 1); // //div[1] 等价于 //div[position()=1]
          break;
        case "gt":
          var idx2 = parseInt(arg, 10);
          if (isNaN(idx2)) return { error: ":gt 参数非法: " + arg };
          pr = "position()>" + (idx2 + 1);
          break;
        case "lt":
          var idx3 = parseInt(arg, 10);
          if (isNaN(idx3)) return { error: ":lt 参数非法: " + arg };
          pr = "position()<" + (idx3 + 1);
          break;
        case "first":
          pr = "1";
          break;
        case "last":
          pr = "position()=last()";
          break;
        case "contains":
          pr = 'contains(.,"' + escAttr(arg) + '")';
          break;
        case "containsOwn":
          pr = 'contains(text(),"' + escAttr(arg) + '")';
          break;
        default:
          notes.push("伪类 :" + name + " 不支持，已忽略");
          i += pm[0].length;
          first = false;
          continue;
      }
      preds.push(pr);
      i += pm[0].length;
      first = false;
      continue;
    }
    if (c === "*" && first) {
      i++;
      first = false;
      continue;
    }
    return { error: "选择器无法解析: " + tok + "（位置 " + i + "）" };
  }
  return { tag: tag, preds: preds };
}

// 选择器链（不含内容提取）→ XPath
// 支持组合符：空格(后代) > (子代) + (相邻)
function selectorToXpathChain(selector, ctx) {
  var notes = [];
  var tokens = [];
  var buf = "";
  var comb = null; // null | ' ' | '>' | '+'
  var i = 0;
  var n = selector.length;
  var step = 0;
  while (i < n) {
    var c = selector[i];
    if (c === ">" || c === "+") {
      if (buf) { tokens.push({ sel: buf, comb: comb }); buf = ""; }
      else if (tokens.length) tokens[tokens.length - 1].comb = tokens[tokens.length - 1].comb || " ";
      comb = c;
      i++;
      continue;
    }
    if (c === " " || c === "\t") {
      if (buf) { tokens.push({ sel: buf, comb: comb }); buf = ""; comb = " "; }
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  if (buf) tokens.push({ sel: buf, comb: comb });
  if (!tokens.length) return { error: "空选择器", notes: notes };

  var parts = [];
  for (var t = 0; t < tokens.length; t++) {
    var pc = parseCompound(tokens[t].sel, ctx, notes);
    if (pc.error) return { error: pc.error, notes: notes };
    var stepXp = pc.tag + (pc.preds.length ? "[" + pc.preds.join(" and ") + "]" : "");
    var comb2 = tokens[t].comb;
    if (t === 0) {
      parts.push("//" + stepXp);
    } else if (comb2 === ">") {
      parts.push("/" + stepXp);
    } else if (comb2 === "+") {
      parts.push("/following-sibling::" + stepXp + "[1]");
    } else {
      parts.push("//" + stepXp);
    }
  }
  return { xpath: parts.join(""), notes: notes };
}

// 完整 @css: 规则 → XPath
// 格式：@css:选择器@内容
function convertCss(rule, ctx) {
  var body = rule.slice(5); // 去掉 @css:
  var notes = [];
  var selector = body;
  var content = null;
  // 找最后一个位于方括号外的 @
  var at = -1;
  var depth = 0;
  var quote = null;
  for (var i = 0; i < body.length; i++) {
    var c = body[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "[") depth++;
    else if (c === "]") depth--;
    else if (c === "@" && depth === 0) at = i;
  }
  if (at !== -1) {
    selector = body.slice(0, at);
    content = body.slice(at + 1);
  }
  var ch = selectorToXpathChain(selector, ctx);
  if (ch.error) return { error: ch.error, notes: notes.concat(ch.notes) };
  notes = notes.concat(ch.notes);
  if (content !== null) {
    var m = require("./defaultRule").mapContentOp(content, ctx.field);
    ch.xpath += m.xpath;
    notes = notes.concat(m.notes);
  }
  return { xpath: ch.xpath, notes: notes };
}

module.exports = {
  convertCss: convertCss,
  selectorToXpathChain: selectorToXpathChain,
  attrPredicateToXpath: attrPredicateToXpath
};