"use strict";
/*
 * Legado Default(JSOUP) 规则 → XPath
 * 例：class.odd.0@tag.a.0@text  →  //*[contains(@class,"odd")]//a[1]/text()
 * 例：#info p:contains(作者)@text → //*[contains(@id,"info")]//p[contains(text(),"作者")]/text()
 * 例：dt a@href → //dt//a/@href
 * 支持：. / # 简写、class./id./tag./text. 类型、位置 .N（含负数）、!排除、
 *       [n]/[a:b] 数组索引、children、:contains(...)、CSS 式裸选择器、尾部内容提取。
 */

var utils = require("./utils");
var escAttr = utils.escAttr;

var CONTENT_OPS = ["text", "textNodes", "ownText", "href", "src", "html", "all"];
var TYPE_PREFIX = ["class.", "id.", "tag.", "text.", "rel."];

// 内容操作 → XPath 尾部
// field: 'content' 表示正文规则（html 视为全部文本）
function mapContentOp(op, field) {
  var notes = [];
  var xpath;
  switch (op) {
    case "text":
      xpath = field === "content" ? "//text()" : "/text()";
      break;
    case "ownText":
      xpath = "/text()";
      break;
    case "textNodes":
      xpath = "//text()";
      break;
    case "html":
    case "all":
      xpath = "/html()";
      break;
    case "href":
      xpath = "/@href";
      break;
    case "src":
      xpath = "/@src";
      break;
    default:
      xpath = "/@" + op; // 其他一律视为属性名
  }
  return { xpath: xpath, notes: notes };
}

function isContentOp(op) {
  return CONTENT_OPS.indexOf(op) !== -1;
}

function hasTypePrefix(seg) {
  for (var i = 0; i < TYPE_PREFIX.length; i++) {
    if (seg.indexOf(TYPE_PREFIX[i]) === 0) return true;
  }
  return false;
}

// 解析数组索引语法 [..]：返回 {type:'index'|'range'|'list', index/indices/start/end, exclude} 或 null
function parseArraySpec(spec) {
  var inner = spec.slice(1, -1);
  var exclude = inner[0] === "!";
  if (exclude) inner = inner.slice(1);
  var parts = inner.split(":");
  if (parts.length === 1) {
    var items = parts[0].split(",");
    if (items.length === 1) {
      var n = parseInt(items[0], 10);
      if (!isNaN(n)) return { type: "index", index: n, exclude: exclude };
      return null;
    }
    var idxs = [];
    for (var i = 0; i < items.length; i++) {
      var m = parseInt(items[i], 10);
      if (isNaN(m)) return null;
      idxs.push(m);
    }
    return { type: "list", indices: idxs, exclude: exclude };
  }
  if (parts.length === 2) {
    var a = parseInt(parts[0], 10);
    var b = parseInt(parts[1], 10);
    if (isNaN(a)) a = 0;
    if (isNaN(b)) b = -1;
    return { type: "range", start: a, end: b, exclude: exclude };
  }
  return null; // 带步长 [a:b:c] 等复杂形式
}

function parseExclusion(tail) {
  var parts = tail.split(":");
  var idxs = [];
  for (var i = 0; i < parts.length; i++) {
    var n = parseInt(parts[i], 10);
    if (isNaN(n)) return null;
    idxs.push(n);
  }
  return idxs;
}

function indexToPosExpr(index) {
  return utils.indexToPosExpr(index);
}

function rangeExpr(a, b) {
  var parts = [];
  if (a !== 0) parts.push("position()>=" + (a + 1));
  if (b !== -1) parts.push("position()<=" + (b + 1));
  return parts.length ? parts.join(" and ") : "true()";
}

function arraySpecPredicates(spec) {
  var preds = [];
  var notes = [];
  var exprs;
  if (spec.type === "index") exprs = [indexToPosExpr(spec.index)];
  else if (spec.type === "list") exprs = spec.indices.map(indexToPosExpr);
  else exprs = [rangeExpr(spec.start, spec.end)];
  if (spec.exclude) {
    preds.push("not(" + exprs.join(" or ") + ")");
  } else {
    preds.push(exprs.join(" or "));
  }
  if (spec.type === "range" && (spec.start < 0 || spec.end < 0)) {
    notes.push("负数区间索引已尽力转换，请人工验证");
  }
  return { preds: preds, notes: notes };
}

// 找匹配的右括号（openIdx 指向 '(' 之后的位置）
function findCloseParen(str, openIdx) {
  var depth = 1;
  var quote = null;
  for (var i = openIdx; i < str.length; i++) {
    var c = str[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// 解析单个 Default 元素段（不含末段内容操作）
// 返回 { xpath, notes } 或 { error }
function parseSegment(seg, ctx) {
  var notes = [];
  if (seg === "") return { error: "空段" };
  if (seg === "children") return { xpath: "/*", notes: notes };
  if (seg[0] === "[") {
    var spec = parseArraySpec(seg);
    if (!spec) return { error: "数组索引语法过复杂: " + seg };
    var r0 = arraySpecPredicates(spec);
    return { xpath: "/*" + (r0.preds.length ? "[" + r0.preds.join(" and ") + "]" : ""), notes: notes.concat(r0.notes) };
  }
  if (/^\.-?\d+$/.test(seg)) {
    var n1 = parseInt(seg.slice(1), 10);
    return { xpath: "/*" + utils.indexPredicate(n1), notes: notes };
  }

  var type = null, rest = seg;
  for (var i = 0; i < TYPE_PREFIX.length; i++) {
    if (seg.indexOf(TYPE_PREFIX[i]) === 0) {
      type = TYPE_PREFIX[i].slice(0, -1);
      rest = seg.slice(TYPE_PREFIX[i].length);
      break;
    }
  }
  if (!type) {
    if (seg[0] === "#") { type = "id"; rest = seg.slice(1); }
    else if (seg[0] === ".") { type = "class"; rest = seg.slice(1); }
    else if (/^[a-zA-Z_*]/.test(seg)) {
      // 裸词：含空格或 [attr] 时为 CSS 式选择器，否则为 tag 段
      if (/[\s\[:.]/.test(seg)) {
        // tag.N 位置简写（a.0 / em.1），不是 CSS 类选择器
        if (/^[a-zA-Z_*][\w-]*\.-?\d+$/.test(seg)) {
          type = "tag";
          rest = seg;
        } else {
          var css = require("./cssRule").selectorToXpathChain(seg, ctx);
          if (css.error) return { error: css.error };
          return { xpath: css.xpath, notes: notes.concat(css.notes) };
        }
      } else {
        type = "tag";
        rest = seg;
      }
    } else {
      return { error: "无法识别段类型: " + seg };
    }
  }

  // `#fmimg img` / `.item a`：空格分隔 = id/class 节点的后代链
  // `class.excerpt excerpt-one`：后续段为类名样式（含 -/_）→ 同节点多类合并
  if ((type === "id" || type === "class") && /\s/.test(rest)) {
    var subParts = rest.split(/\s+/);
    var prefix = type === "id" ? "#" : ".";
    var multiClass = type === "class" && subParts.length > 1;
    for (var mc = 1; mc < subParts.length; mc++) {
      if (!/^[\w-]+$/.test(subParts[mc]) || !/[_-]/.test(subParts[mc])) {
        multiClass = false;
        break;
      }
    }
    if (multiClass) {
      var mpreds = [];
      for (var ci = 0; ci < subParts.length; ci++) {
        mpreds.push('contains(@class,"' + escAttr(subParts[ci]) + '")');
      }
      notes.push("多类名已合并为同节点条件（class=\"" + subParts.join(" ") + "\"），如为后代结构请人工调整");
      return { xpath: "/*[" + mpreds.join(" and ") + "]", notes: notes };
    }
    var subX = "";
    var subNotes = [];
    for (var pi = 0; pi < subParts.length; pi++) {
      var sub = parseSegment((pi === 0 ? prefix : "") + subParts[pi], ctx);
      if (sub.error) return { error: sub.error };
      if (pi === 0) subX = sub.xpath;
      else subX += "//" + sub.xpath.slice(2);
      subNotes = subNotes.concat(sub.notes);
    }
    return { xpath: subX, notes: notes.concat(subNotes) };
  }

  // 解析 name 与修饰
  var name = "";
  var position = null;
  var exclusion = null;
  var arraySpec = null;
  var containsText = null;
  var tagPreds = null;
  var i2 = 0;
  var n = rest.length;
  while (i2 < n) {
    var c = rest[i2];
    if (c === "!") {
      var excl = parseExclusion(rest.slice(i2 + 1));
      if (!excl) return { error: "排除语法无法解析: " + seg };
      exclusion = excl;
      i2 = n;
      break;
    }
    if (c === "[") {
      var end = rest.indexOf("]", i2);
      if (end === -1) return { error: "属性/数组索引未闭合: " + seg };
      var inner = rest.slice(i2, end + 1);
      // tag 段的 [attr=...] 谓词 vs 数组索引
      if (type === "tag" && /^\[[^\d!]/.test(inner)) {
        var attrPred = require("./cssRule").attrPredicateToXpath(inner);
        if (attrPred.error) return { error: attrPred.error };
        if (!tagPreds) tagPreds = [];
        tagPreds.push(attrPred.predicate);
        i2 = end + 1;
        continue;
      }
      var spec2 = parseArraySpec(rest.slice(i2, end + 1));
      if (!spec2) return { error: "数组索引语法过复杂: " + seg };
      arraySpec = spec2;
      i2 = end + 1;
      continue;
    }
    if (c === ":") {
      if (rest.substr(i2, 10) === ":contains(") {
        var close = findCloseParen(rest, i2 + 10);
        if (close === -1) return { error: ":contains( 未闭合: " + seg };
        containsText = rest.slice(i2 + 10, close);
        i2 = close + 1;
        continue;
      }
      return { error: "不支持的修饰符: " + seg };
    }
    if (c === ".") {
      var m2 = rest.slice(i2).match(/^\.(-?\d+)/);
      if (m2) {
        position = parseInt(m2[1], 10);
        i2 += m2[0].length;
        continue;
      }
      // 名称的一部分（如类名含点）
    }
    name += c;
    i2++;
  }
  if (!name && !tagPreds) return { error: "段缺少名称: " + seg };

  var xp;
  switch (type) {
    case "class":
      xp = '//*[contains(@class,"' + escAttr(name) + '")]';
      break;
    case "id":
      xp = '//*[contains(@id,"' + escAttr(name) + '")]';
      break;
    case "tag":
      xp = "//" + name;
      break;
    case "text":
      xp = '//*[contains(text(),"' + escAttr(name) + '")]';
      break;
    case "rel":
      // rel.xxx：标签 rel + class 条件（WordPress 常见 <a rel=...> 场景按标签+类处理）
      xp = '//rel[contains(@class,"' + escAttr(name) + '")]';
      break;
    default:
      return { error: "未知类型: " + type };
  }

  var preds = [];
  if (containsText !== null) {
    preds.push('contains(text(),"' + escAttr(containsText) + '")');
  }
  if (tagPreds) preds = preds.concat(tagPreds);
  if (position !== null) preds.push(indexToPosExpr(position));
  if (exclusion) preds.push("not(" + exclusion.map(indexToPosExpr).join(" or ") + ")");
  if (arraySpec) {
    var r2 = arraySpecPredicates(arraySpec);
    preds = preds.concat(r2.preds);
    notes = notes.concat(r2.notes);
  }
  if (preds.length) xp += "[" + preds.join(" and ") + "]";
  return { xpath: xp, notes: notes };
}

// 主入口：Default 规则（不含 ## 净化、不含 @js:、不含 ||）
// ctx: { field, src }
function convertDefault(rule, ctx) {
  var notes = [];
  var segs = utils.splitTopLevel(rule, ["@"]);
  var parts = [];
  for (var i = 0; i < segs.length; i++) {
    var seg = segs[i].trim();
    if (!seg) continue;
    var isLast = i === segs.length - 1;
    if (isLast && !hasTypePrefix(seg) && seg[0] !== "." && seg[0] !== "#" && seg[0] !== "[") {
      // 末段裸词 = 内容操作或属性
      var m = mapContentOp(seg, ctx.field);
      parts.push(m.xpath);
      notes = notes.concat(m.notes);
      continue;
    }
    var r = parseSegment(seg, ctx);
    if (r.error) {
      return { error: "Default 规则段解析失败: " + seg + "（" + r.error + "）", notes: notes };
    }
    notes = notes.concat(r.notes);
    if (parts.length === 0) {
      parts.push(r.xpath.indexOf("/*") === 0 ? "//" + r.xpath.slice(1) : r.xpath);
    } else if (r.xpath === "/*" || r.xpath.indexOf("/*[") === 0) {
      parts.push(r.xpath);
    } else {
      parts.push("//" + r.xpath.slice(2));
    }
  }
  if (!parts.length) return { error: "空规则", notes: notes };
  return { xpath: parts.join(""), notes: notes };
}

module.exports = {
  convertDefault: convertDefault,
  mapContentOp: mapContentOp,
  isContentOp: isContentOp,
  parseSegment: parseSegment,
  findCloseParen: findCloseParen
};