"use strict";
/*
 * Legado JS 代码 → XSGG @js: 代码翻译
 * - java.* 常用函数 → CryptoJS / 原生 JS（触发 cryptojs 注入）
 * - 变量 baseUrl/src → config.host/result
 * - 无法翻译的 java.* → 保留原样并标记不支持
 */

var escStr = require("./utils").escStr;

// cryptojs 注入前缀（香色闺阁支持在 @js: 中直接定义 cryptojs=<完整js文件>）
var CRYPTOJS_PREFIX = "cryptojs=";

// 找 java.xxx( 的完整调用（平衡括号），返回 {name, args, start, end}
function findJavaCall(code, from) {
  var m = code.slice(from).match(/java\.[a-zA-Z_]\w*\s*\(/);
  if (!m) return null;
  var start = from + m.index;
  var nameStart = start + 5; // 跳过 "java."
  var nameEnd = code.indexOf("(", start);
  var name = code.slice(nameStart, nameEnd).trim();
  var openIdx = nameEnd;
  var depth = 1;
  var quote = null;
  var i = openIdx + 1;
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
      if (depth === 0) {
        return {
          name: name,
          args: code.slice(openIdx + 1, i),
          start: start,
          end: i + 1
        };
      }
    }
    i++;
  }
  return null;
}

function parseTransformation(transformation) {
  // 形如 AES/CBC/PKCS5Padding 或 AES/ECB/NoPadding
  var parts = String(transformation || "").split("/");
  var mode = "CBC";
  var padding = "Pkcs7";
  if (parts[1]) {
    mode = parts[1].toUpperCase();
  }
  if (parts[2]) {
    var p = parts[2].toUpperCase();
    if (p.indexOf("PKCS") !== -1) padding = "Pkcs7";
    else if (p === "NOPADDING") padding = "NoPadding";
    else if (p === "ZEROPADDING") padding = "ZeroPadding";
    else padding = "Pkcs7";
  }
  var modeMap = { CBC: "CryptoJS.mode.CBC", ECB: "CryptoJS.mode.ECB", CFB: "CryptoJS.mode.CFB", OFB: "CryptoJS.mode.OFB", CTR: "CryptoJS.mode.CTR" };
  var padMap = { Pkcs7: "CryptoJS.pad.Pkcs7", NoPadding: "CryptoJS.pad.NoPadding", ZeroPadding: "CryptoJS.pad.ZeroPadding" };
  return {
    mode: modeMap[mode] || "CryptoJS.mode.CBC",
    padding: padMap[padding] || "CryptoJS.pad.Pkcs7",
    modeName: mode
  };
}

function aesOptions(transformation, iv) {
  var t = parseTransformation(transformation);
  var opts = "{mode: " + t.mode + ", padding: " + t.padding;
  // iv 为参数原文（JS 表达式）；空字面量或 ECB 模式下不输出
  var ivExpr = String(iv || "").trim();
  var ivEmpty = ivExpr === "" || ivExpr === '""' || ivExpr === "''";
  if (!ivEmpty && t.modeName !== "ECB") {
    opts += ", iv: CryptoJS.enc.Utf8.parse(" + ivExpr + ")";
  }
  opts += "}";
  return { opts: opts, modeName: t.modeName };
}

// java.* 函数 → JS 表达式；返回 null 表示不支持（保留原样）
// 新增可转函数：在下方 switch 中追加 case，格式：
//   case "java 里的函数名": return { expr: "目标 JS 表达式(" + args + ")", crypto: 是否需要cryptojs, note: 说明或null };
//   args 为调用参数原文；note 非 null 时会进入转换提示（App 标红展示）。
//   常见可用目标：CryptoJS.* / params.nativeTool.* / params.filters.* / config.host / result / console.log
function translateJavaCall(name, args) {
  switch (name) {
    case "base64Encode":
      // 原生 btoa（UTF-8 安全），无需 cryptojs 库
      return {
        expr: "(function(s){return btoa(unescape(encodeURIComponent(String(s))))})(" + args + ")",
        crypto: false, note: null
      };
    case "base64Decode":
    case "base64DecodeToByteArray":
      // 原生 atob；兼容 URL_SAFE(-_) 字母表并补齐 padding
      return {
        expr: "(function(s){s=String(s).replace(/-/g,'+').replace(/_/g,'/').replace(/\\s+/g,'');while(s.length%4)s+='=';return decodeURIComponent(escape(atob(s)))})(" + args + ")",
        crypto: false,
        note: name === "base64DecodeToByteArray" ? "ByteArray 语义已按字符串处理" : null
      };
    case "md5Encode":
      return { expr: "CryptoJS.MD5(" + args + ").toString()", crypto: true, note: null };
    case "md5Encode16":
      return { expr: "CryptoJS.MD5(" + args + ").toString().substring(8,24)", crypto: true, note: null };
    case "encodeURI": {
      var encParts = splitArgs(args, 2);
      var first = encParts[0];
      if (encParts.length > 1) {
        var encName = String(encParts[1]).replace(/["'\s]/g, "").toLowerCase();
        if (encName && encName !== "utf-8" && encName !== "utf8") {
          return {
            expr: "encodeURIComponent(String(" + first + "))",
            crypto: false,
            note: "java.encodeURI 指定了非 UTF-8 编码（" + encParts[1] + "），已按 UTF-8 的 encodeURIComponent 处理；GBK 等编码需人工改写"
          };
        }
      }
      return { expr: "encodeURIComponent(String(" + first + "))", crypto: false, note: null };
    }
    case "utf8ToGbk":
      return {
        keep: true,
        msg: "java.utf8ToGbk 无浏览器端 GBK 编码器，已保留原样，请人工处理（或改用站点 UTF-8 接口）"
      };
    case "ajax":
    case "ajaxAll":
    case "connect":
    case "get":
    case "post":
      // 联网取内容函数：XSGG 规则 JS 无对应能力，无法等价改写 → 保留原样
      return {
        keep: true,
        msg: "java." + name + "() 是联网取内容函数，香色闺阁规则 JS 无对应能力，已保留原样；请改用模块 requestInfo 配置请求或人工改写"
      };
    case "getCookie":
      return {
        keep: true,
        msg: "java.getCookie() 无法转换（XSGG 自动携带站点 Cookie，通常可整段删除该调用），已保留原样"
      };
    case "timeFormat":
      return {
        expr: "(function(ts){var t=String(ts);var d=t.indexOf('.')>-1?new Date(parseFloat(t)*1000):new Date(Number(t));function p(n){return (n<10?'0':'')+n}return d.getFullYear()+'/'+p(d.getMonth()+1)+'/'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes())})(" + args + ")",
        crypto: false,
        note: "timeFormat 已用 JS Date 近似实现（毫秒/秒自动识别）"
      };
    case "log":
      // java.log → 香色闺阁 params.nativeTool.log（App 内置调试输出）
      return { expr: "params.nativeTool.log(" + args + ")", crypto: false, note: "java.log → params.nativeTool.log" };
    case "aesDecodeToString":
    case "aesBase64DecodeToString":
    case "aesDecodeToByteArray":
    case "aesBase64DecodeToByteArray": {
      var parts = splitArgs(args, 4);
      var ao = aesOptions(parts[2], parts[3]);
      var expr = "CryptoJS.AES.decrypt(" + parts[0] + ", CryptoJS.enc.Utf8.parse(" + parts[1] + "), " + ao.opts + ").toString(CryptoJS.enc.Utf8)";
      return {
        expr: expr,
        crypto: true,
        note: "AES 解码已按 base64 密文+UTF-8 key 处理（" + ao.modeName + "），若解密失败请人工核对 key/iv/填充"
      };
    }
    case "aesEncodeToString":
    case "aesEncodeToBase64String":
    case "aesEncodeToBase64ByteArray":
    case "aesEncodeToByteArray": {
      var parts2 = splitArgs(args, 4);
      var ao2 = aesOptions(parts2[2], parts2[3]);
      var expr2 = "CryptoJS.AES.encrypt(" + parts2[0] + ", CryptoJS.enc.Utf8.parse(" + parts2[1] + "), " + ao2.opts + ").ciphertext.toString(CryptoJS.enc.Base64)";
      return {
        expr: expr2,
        crypto: true,
        note: "AES 加密输出按 base64（" + ao2.modeName + "），若目标站点期望其他形式请人工核对"
      };
    }
    default:
      return null;
  }
}

// 按逗号拆分参数（顶层），最多 max 个
function splitArgs(args, max) {
  var out = [];
  var depth = 0;
  var quote = null;
  var cur = "";
  var n = args.length;
  for (var i = 0; i < n; i++) {
    var c = args[i];
    if (quote) {
      if (c === "\\") { cur += c; i++; cur += args[i] || ""; continue; }
      if (c === quote) quote = null;
      cur += c;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; cur += c; continue; }
    if (c === "(" || c === "[" || c === "{") { depth++; cur += c; continue; }
    if (c === ")" || c === "]" || c === "}") { depth--; cur += c; continue; }
    if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      if (out.length === max - 1) {
        out.push(args.slice(i + 1).trim());
        return out;
      }
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

// 翻译整段 JS：java.* → 表达式；变量映射
// 返回 { code, needsCrypto, notes }
function translateJs(code, ctx) {
  var notes = [];
  var needsCrypto = false;
  var out = "";
  var i = 0;
  var n = code.length;
  while (i < n) {
    var c = code[i];
    if (c === "j" && code.substr(i, 5) === "java.") {
      var call = findJavaCall(code, i);
      if (call) {
        var r = translateJavaCall(call.name, call.args);
        if (r) {
          if (r.keep) {
            notes.push(r.msg);
            out += code.slice(i, call.end);
            i = call.end;
            continue;
          }
          out += r.expr;
          if (r.crypto) needsCrypto = true;
          if (r.note) notes.push(r.note);
          i = call.end;
          continue;
        }
        notes.push("java." + call.name + "() 无法翻译，已保留原样（运行时可能报错，需人工处理）");
        out += code.slice(i, call.end);
        i = call.end;
        continue;
      }
    }
    // 变量映射（词边界）
    if (/[a-zA-Z0-9_$]/.test(c) || c === "$") {
      var m = code.slice(i).match(/^[a-zA-Z_$][\w$]*/);
      if (!m) {
        // 数字等非标识符开头：原样保留
        out += c;
        i++;
        continue;
      }
      var word = m[0];
      var beforeOk = i === 0 || !/[a-zA-Z0-9_$]/.test(code[i - 1]);
      if (beforeOk) {
        // baseUrl：Legado 每个模块内表示「上一步传来的 URL」。
        // 字段级 @js: 对应香色闺阁 params.responseUrl（当前响应页 URL，见规则文档第七章）；
        // requestInfo 内的 baseUrl 由 urlRule 按 role 单独映射（搜索/分类→config.host，目录/正文→result）。
        if (word === "baseUrl") {
          out += "params.responseUrl";
          notes.push("baseUrl 已映射为 params.responseUrl（模块内=上一步传入的页面 URL）");
          i += word.length;
          continue;
        }
        if (word === "src") {
          out += "result";
          notes.push("src 已映射为 result");
          i += word.length;
          continue;
        }
        // book.*：上游（搜索/分类/详情）解析结果 → params.queryInfo.*（字段名按两端规范对齐）
        if (word === "book" && code.charAt(i + word.length) === ".") {
          var bp = code.slice(i + word.length + 1).match(/^[a-zA-Z_$][\w$]*/);
          if (bp) {
            var bmap = { name: "bookName", author: "author", kind: "cat", intro: "desc",
                         coverUrl: "cover", wordCount: "wordCount",
                         lastChapter: "lastChapterTitle", bookUrl: "detailUrl" };
            var bk = bmap[bp[0]] || bp[0];
            out += "params.queryInfo." + bk;
            if (bmap[bp[0]] === undefined) {
              notes.push("book." + bp[0] + " 已直映为 params.queryInfo." + bp[0] + "（无官方对应，请人工确认）");
            } else {
              notes.push("book." + bp[0] + " 已映射为 params.queryInfo." + bk);
            }
            i += word.length + 1 + bp[0].length;
            continue;
          }
        }
        // chapter.*：章节上下文
        if (word === "chapter" && code.charAt(i + word.length) === ".") {
          var cp = code.slice(i + word.length + 1).match(/^[a-zA-Z_$][\w$]*/);
          if (cp) {
            var ck = cp[0];
            if (ck === "url") {
              out += "params.responseUrl";
              notes.push("chapter.url 已映射为 params.responseUrl（本章页 URL）");
            } else if (ck === "title") {
              out += "params.queryInfo.title";
              notes.push("chapter.title 已映射为 params.queryInfo.title（如 App 取值异常请人工调整）");
            } else {
              notes.push("chapter." + ck + " 在香色闺阁无可靠对应，已保留原样（需人工处理）");
              out += "chapter." + ck;
            }
            i += word.length + 1 + ck.length;
            continue;
          }
        }
        // source.*：书源 JSON 字段
        if (word === "source" && code.charAt(i + word.length) === ".") {
          var sp = code.slice(i + word.length + 1).match(/^[a-zA-Z_$][\w$]*/);
          if (sp) {
            if (sp[0] === "sourceUrl") {
              out += "config.host";
              notes.push("source.sourceUrl 已映射为 config.host");
            } else if (sp[0] === "loginHeader" || sp[0] === "headerMap") {
              out += "config.httpHeaders";
              notes.push("source." + sp[0] + " 已映射为 config.httpHeaders");
            } else {
              notes.push("source." + sp[0] + " 在香色闺阁无对应（可用 config.host / config.httpHeaders），已保留原样");
              out += "source." + sp[0];
            }
            i += word.length + 1 + sp[0].length;
            continue;
          }
        }
        if (word === "log" && code[i + word.length] === "(") {
          out += "console.log";
          notes.push("log() 已映射为 console.log()");
          i += word.length;
          continue;
        }
        if (word === "cookie" || word === "cache" || word === "java") {
          if (word !== "java") {
            notes.push("变量 " + word + " 在香色闺阁无对应，已保留原样（需人工处理）");
          }
        }
      }
      out += word;
      i += word.length;
      continue;
    }
    out += c;
    i++;
  }
  return { code: out, needsCrypto: needsCrypto, notes: notes };
}

// 生成带 cryptojs 注入的 @js: 块文本
// bodyLines: 脚本行数组（不含 @js: 前缀）
function wrapJsBlock(bodyLines, ctx, needsCrypto) {
  var lines = bodyLines.slice();
  if (needsCrypto && ctx.cryptoJsSource) {
    lines.unshift(CRYPTOJS_PREFIX + ctx.cryptoJsSource);
  }
  return "@js:\n" + lines.join("\n");
}

module.exports = {
  translateJs: translateJs,
  wrapJsBlock: wrapJsBlock,
  translateJavaCall: translateJavaCall,
  CRYPTOJS_PREFIX: CRYPTOJS_PREFIX
};