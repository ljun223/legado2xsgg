"use strict";
/*
 * 金标准回归测试：转换 小原文学网 Legado 书源并与人工 XSGG 书源比对
 * 已知差异白名单（人工精修项/语义等价项）之外的差异视为失败
 */
var fs = require("fs");
var path = require("path");
var converter = require("../lib/index.js");

var FIXTURES = path.join(__dirname, "fixtures");

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
}

// 已知差异：路径 → 说明
var WHITELIST = {
  ".sourceType": "mine 新增字段（bookSourceType 映射 text/audio/comic/video），golden 无",
  ".sourceUrl": "golden 去掉尾部 /，mine 保留后由转换器统一去掉（应一致）",
  ".weight": "golden 人工改为 9999，mine 沿用 Legado 权重",
  ".lastModifyTime": "生成时间戳，必然不同",
  ".searchBook.requestInfo": "golden 去掉了 /search/ 的尾部斜杠，mine 保留（等价）",
  ".searchBook.list": "golden 人工简化为 //div，mine //* 语义更通用",
  ".searchBook.bookName": "mine //dt//a（后代），golden //dt/a（子级），等价",
  ".searchBook.detailUrl": "同上",
  ".searchBook.cover": "mine 保留 Legado 的 || 备选（data-original 优先），golden 人工只留 @src",
  ".searchBook.cat": "mine //*[contains(@class...)]，golden 人工限定 //em（等价）",
  ".searchBook.status": "golden 人工追加字段，Legado 无对应规则",
  ".bookDetail.bookName": "mine 忠实输出 Legado name 规则，golden 人工删除",
  ".bookDetail.author": "mine 忠实输出 Legado author 规则（含净化），golden 人工删除",
  ".bookDetail.cover": "mine //（后代），golden /（子级），等价",
  ".bookDetail.cat": "mine 带 return 更安全，golden 无 return（语义等价）",
  ".bookDetail.lastChapterTitle": "golden 含拼写简化（hiden-xs），mine 忠实原规则",
  ".chapterList.list": "mine //（后代），golden /（子级），等价",
  ".chapterContent.content": "mine //*，golden //div，等价",
  ".chapterContent.nextPageUrl": "mine 忠实 Legado 文本「下一章」，golden 人工改「下一页」",
  ".bookWorld.分类.list": "mine 保留 hotcontent 上下文，golden 人工简化为 //div[contains(@class,\"item\")]",
  ".bookWorld.分类.bookName": "mine //a[position()=1]/@title，golden 人工简化为 //dt/a/@title",
  ".bookWorld.分类.detailUrl": "同上",
  ".bookWorld.分类.author": "mine 保留净化 @js（\\d+.* 删除），golden 人工去掉净化",
  ".bookWorld.分类.wordCount": "mine //em[position()=1]，golden //em[1]（等价）",
  ".bookWorld.分类.lastChapterTitle": "mine //em[position()=2]，golden //em[2]（等价）"
};

function collectDiffs(a, b, prefix, out) {
  var keys = new Set(Object.keys(a || {}).concat(Object.keys(b || {})));
  keys.forEach(function (k) {
    var p = prefix + "." + k;
    if (!(k in a)) { out.push({ p: p, goldenOnly: true }); return; }
    if (!(k in b)) { out.push({ p: p, mineOnly: true }); return; }
    var av = a[k], bv = b[k];
    if (av && bv && typeof av === "object" && typeof bv === "object") {
      collectDiffs(av, bv, p, out);
      return;
    }
    if (String(av) !== String(bv)) out.push({ p: p });
  });
}

var tests = [];
var failures = 0;

function test(name, fn) {
  tests.push({ name: name, fn: fn });
}

test("小原文学网 转换不报错", function () {
  var r = converter.convert(load("legado_小原文学网.json"));
  if (!r.output) throw new Error("无输出");
  if (r.warnings.some(function (w) { return w.level === "unsupported"; })) {
    throw new Error("存在 unsupported 警告: " + JSON.stringify(r.warnings));
  }
});

test("小原文学网 与金标准差异均在白名单内", function () {
  var r = converter.convert(load("legado_小原文学网.json"));
  var mine = r.output["小原文学网"];
  var golden = load("xsgg_小原文学网.json")["小原文学网"];
  var diffs = [];
  collectDiffs(mine, golden, "", diffs);
  var unexpected = diffs.filter(function (d) { return !(d.p in WHITELIST); });
  if (unexpected.length) {
    throw new Error("白名单外差异:\n" + unexpected.map(function (d) {
      return "  " + d.p + (d.mineOnly ? " [mine-only]" : d.goldenOnly ? " [golden-only]" : "");
    }).join("\n"));
  }
  if (!diffs.length) throw new Error("无任何差异？请检查比对逻辑");
});

test("bookWorld 结构与金标准一致", function () {
  var r = converter.convert(load("legado_小原文学网.json"));
  var bw = r.output["小原文学网"].bookWorld;
  var golden = load("xsgg_小原文学网.json")["小原文学网"].bookWorld;
  var key = Object.keys(golden)[0];
  if (!bw[key]) throw new Error("缺少分类入口: " + key);
  if (bw[key].moreKeys.requestFilters !== golden[key].moreKeys.requestFilters) {
    throw new Error("requestFilters 不一致");
  }
  if (bw[key].requestInfo !== golden[key].requestInfo) {
    throw new Error("requestInfo 不一致:\n" + bw[key].requestInfo + "\n!=\n" + golden[key].requestInfo);
  }
});

test("searchBook.requestInfo 占位符正确", function () {
  var r = converter.convert(load("legado_小原文学网.json"));
  var ri = r.output["小原文学网"].searchBook.requestInfo;
  if (ri.indexOf("%@keyWord") === -1) throw new Error("缺少 %@keyWord: " + ri);
});

test("顶层字段齐全", function () {
  var r = converter.convert(load("legado_小原文学网.json"));
  var top = r.output["小原文学网"];
  ["sourceName", "sourceUrl", "weight", "enable", "miniAppVersion", "lastModifyTime",
   "shudanList", "shudanDetail", "shupingList", "shupingHome", "searchShudan", "relatedWord",
   "searchBook", "bookDetail", "chapterList", "chapterContent", "bookWorld"].forEach(function (k) {
    if (!(k in top)) throw new Error("缺少顶层字段: " + k);
  });
  if (top.enable !== "1") throw new Error("enable 应为 \"1\"");
  if (top.miniAppVersion !== "2.53.2") throw new Error("miniAppVersion 应为 2.53.2");
});

test("生成的 @js 脚本均可通过语法检查", function () {
  var r = converter.convert(load("legado_小原文学网.json"));
  var top = r.output["小原文学网"];
  function walk(obj) {
    Object.keys(obj || {}).forEach(function (k) {
      var v = obj[k];
      if (typeof v === "string") {
        v.split(" || ").forEach(function (part) {
          if (part.indexOf("@js:") === -1) return;
          var code = part.slice(part.indexOf("@js:") + 4);
          code = code.replace(/^cryptojs=[\s\S]*?\n/, "").trim();
          try {
            new Function("config", "params", "result", code);
          } catch (e) {
            throw new Error("JS 语法错误 in " + k + ": " + e.message + "\n" + code);
          }
        });
      } else if (v && typeof v === "object") walk(v);
    });
  }
  walk(top);
});

tests.forEach(function (t) {
  try {
    t.fn();
    console.log("PASS  " + t.name);
  } catch (e) {
    failures++;
    console.log("FAIL  " + t.name);
    console.log("      " + e.message.replace(/\n/g, "\n      "));
  }
});
console.log("");
console.log(failures === 0 ? "全部通过（" + tests.length + " 项）" : failures + " 项失败");
process.exit(failures === 0 ? 0 : 1);
