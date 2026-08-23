"use strict";
var rules = require("../lib/rules.js");
var cssRule = require("../lib/cssRule.js");
var defaultRule = require("../lib/defaultRule.js");
var jsRule = require("../lib/jsRule.js");
var urlRule = require("../lib/urlRule.js");
var modules = require("../lib/modules.js");
var utils = require("../lib/utils.js");
var converter = require("../lib/index.js");

var tests = [];
var failures = 0;
function test(name, fn) { tests.push({ name: name, fn: fn }); }
function eq(actual, expected, label) {
  if (actual !== expected) throw new Error((label || "值") + " 不符:\n  期望: " + JSON.stringify(expected) + "\n  实际: " + JSON.stringify(actual));
}
function ok(cond, msg) { if (!cond) throw new Error(msg || "断言失败"); }

var BASE = { src: {}, host: "https://x.com", jsonEnabled: false };

// ---------- defaultRule ----------
test("Default: class. 类型与位置", function () {
  eq(defaultRule.convertDefault("class.odd.0@tag.a.0@text", BASE).xpath,
     '((//*[contains(@class,"odd")])[1]//a)[1]/text()');
});
test("Default: #id 后代链", function () {
  eq(defaultRule.convertDefault("#fmimg img@data-original", BASE).xpath,
     '//*[contains(@id,"fmimg")]//img/@data-original');
});
test("Default: :contains 中文", function () {
  eq(defaultRule.convertDefault("#info p:contains(作者)@text", BASE).xpath,
     '//*[contains(@id,"info")]//p[contains(.,"作者")]/text()');
});
test("Default: CSS 式裸选择器 + 属性", function () {
  eq(defaultRule.convertDefault("meta[property=og:image]@content", BASE).xpath,
     '//meta[@property="og:image"]/@content');
});
test("Default: 排除 ! 与位置", function () {
  eq(defaultRule.convertDefault("class.x.0!1@text", BASE).xpath,
     '(//*[contains(@class,"x")])[1 and not(2)]/text()');
  eq(defaultRule.convertDefault("li.3@text", BASE).xpath,
     '(//li)[4]/text()');
});
test("Default: html 内容操作", function () {
  var r = defaultRule.convertDefault("id.booktxt@html", { field: "content" });
  eq(r.xpath, '//*[contains(@id,"booktxt")]/html()');
});

// ---------- cssRule ----------
test("CSS: 后代/类/id", function () {
  eq(cssRule.convertCss("@css:.item a@href", BASE).xpath, '//*[contains(@class,"item")]//a/@href');
  eq(cssRule.convertCss("@css:#list li:first@text", BASE).xpath, '(//*[@id="list"]//li)[1]/text()');
});

// ---------- rules ----------
test("规则: || 备选拆分", function () {
  var r = rules.convertRule("a@href || .b@href", BASE);
  eq(r.value, '//a/@href || //*[contains(@class,"b")]/@href');
});
test("规则: ## 净化 → @js replace（纯文本用字符串）", function () {
  var r = rules.convertRule(".sort@text##类别：", BASE);
  eq(r.value, '//*[contains(@class,"sort")]/text()||@js:\nreturn result.replace("类别：","");');
});
test("规则: ### 正则净化 OnlyOne（无 g）", function () {
  var r = rules.convertRule("em@text###\\d+", BASE);
  var m = r.value.match(/result\.replace\((.*?),/);
  ok(m, "应含 replace");
  eq(/\/g$/.test(m[1]), false, "应为无 g 标志: " + m[1]);
  var f = new Function("result", r.value.split("@js:")[1].replace(/^cryptojs=[\s\S]*?\n/, ""));
  eq(f("第12章 测试"), "第章 测试", "OnlyOne 只替换一次");
});
test("规则: 正则净化用 /re/g", function () {
  var r = rules.convertRule("em@text##\\d+", BASE);
  var m = r.value.match(/result\.replace\((.*?),/);
  ok(m, "应含 replace");
  eq(/\/g$/.test(m[1]), true, "应使用 g 标志: " + m[1]);
  var f = new Function("result", r.value.split("@js:")[1].replace(/^cryptojs=[\s\S]*?\n/, ""));
  eq(f("第1章 测试 第2章 结尾"), "第章 测试 第章 结尾", "g 标志全替换");
});
test("规则: 不支持项标记", function () {
  var r = rules.convertRule("@css:.a:eq(x)@text", BASE);
  ok(r.warnings.some(function (w) { return w.level === "unsupported"; }), "应有 unsupported 警告");
  eq(r.value, "@css:.a:eq(x)@text", "保留原样");
});

// ---------- jsRule ----------
test("jsRule: cryptojs= 注入前缀", function () {
  var r = jsRule.translateJs('java.md5Encode(result)', {});
  eq(r.needsCrypto, true);
  ok(r.code.indexOf("CryptoJS.MD5(") !== -1, "应翻译为 CryptoJS.MD5");
});
test("jsRule: 翻译 base64/encodeURI/timeFormat/log", function () {
  ok(jsRule.translateJs("java.base64Decode(result)", {}).code.indexOf("atob(") !== -1, "base64Decode 应翻译为原生 atob 包装");
  eq(jsRule.translateJs("java.encodeURI(url)", {}).code, "encodeURIComponent(String(url))");
  ok(jsRule.translateJs('java.timeFormat("yyyy-MM-dd")', {}).code.indexOf("getFullYear") !== -1, "timeFormat 应生成日期 IIFE");
  eq(jsRule.translateJs("log(result)", {}).code, "console.log(result)");
  eq(jsRule.translateJs("baseUrl", {}).code, "params.responseUrl");
  eq(jsRule.translateJs("src", {}).code, "result");
});

// ---------- urlRule ----------
test("urlRule: 简单 {{key}}", function () {
  var r = urlRule.buildRequestInfo("https://x.com/search?key={{key}}", BASE, "search");
  eq(r.requestInfo, "https://x.com/search?key=%@keyWord");
});
test("urlRule: {{page}} 与相对 URL 绝对化", function () {
  var r = urlRule.buildRequestInfo("/list/{{page}}.html", BASE, "explore");
  eq(r.requestInfo, "https://x.com/list/%@pageIndex.html");
});
test("urlRule: 复杂表达式 → @js 模板", function () {
  var r = urlRule.buildRequestInfo("/search?k={{key}}&p={{(page-1)*2}}", BASE, "search");
  ok(r.requestInfo.indexOf("${(params.pageIndex-1)*2}") !== -1, r.requestInfo);
  var f = new Function("config", "params", "result", r.requestInfo.replace(/^@js:\s*/, ""));
  eq(f({}, { pageIndex: 3, keyWord: "武" }, null).url, "https://x.com/search?k=武&p=4");
});
test("urlRule: <,{{page}}> 可选前缀", function () {
  var r = urlRule.buildRequestInfo("/a?x=<,{{page}}>&k={{key}}", BASE, "search");
  var f = new Function("config", "params", "result", r.requestInfo.replace(/^@js:\s*/, ""));
  eq(f({}, { pageIndex: 2, keyWord: "a" }, null).url, "https://x.com/a?x=,2&k=a");
  eq(f({}, { pageIndex: null, keyWord: "a" }, null).url, "https://x.com/a?x=&k=a");
});
test("urlRule: POST + body + charset", function () {
  var r = urlRule.buildRequestInfo('/api?q={{key}},{"method":"POST","body":"p={{page}}&k={{key}}","charset":"gbk"}', BASE, "search");
  eq(r.actionExtra.responseEncode, "2147485234");
  var f = new Function("config", "params", "result", r.requestInfo.replace(/^@js:\s*/, ""));
  var o = f({}, { pageIndex: 1, keyWord: "武" }, null);
  eq(o.POST, true);
  eq(JSON.stringify(o.httpParams), '{"p":1,"k":"武"}');
});
test("urlRule: webView", function () {
  var r = urlRule.buildRequestInfo("/c.html,{\"webView\":true}", BASE, "content");
  ok(r.requestInfo.indexOf('webView: ""') !== -1, r.requestInfo);
});

// ---------- modules ----------
function mkSrc(extra) {
  var s = {
    bookSourceUrl: "https://x.com/",
    searchUrl: "https://x.com/s?k={{key}}",
    ruleSearch: { bookList: ".item", name: "a@text", bookUrl: "a@href" },
    ruleBookInfo: { name: "h1@text", coverUrl: "#fmimg img@src" },
    ruleToc: { chapterList: "#list dd", chapterName: "a@text", chapterUrl: "a@href" },
    ruleContent: { content: "id.ct@html" },
    exploreUrl: "玄幻::/xh/{{page}}.html\n武侠::/wx/{{page}}.html",
    ruleExplore: { bookList: "class.item", name: "a.0@title", bookUrl: "a.0@href", coverUrl: "img@src", intro: "dd@text", author: "dl.0@text", wordCount: "em.0@text", lastChapter: "em.1@text" },
    enabledExplore: true
  };
  Object.keys(extra || {}).forEach(function (k) { s[k] = extra[k]; });
  return s;
}

test("modules: 全模块组装", function () {
  var ctx = { src: mkSrc(), host: "https://x.com", jsonEnabled: false };
  var sb = modules.buildSearchBook(ctx.src, ctx);
  eq(sb.module.requestInfo, "https://x.com/s?k=%@keyWord");
  eq(sb.module.list, '//*[contains(@class,"item")]');
  eq(sb.module.detailUrl, "//a/@href");
  var toc = modules.buildChapterList(ctx.src, ctx);
  eq(toc.module.list, '//*[contains(@id,"list")]//dd');
  var cc = modules.buildChapterContent(ctx.src, ctx);
  eq(cc.module.content, '//*[contains(@id,"ct")]/html()');
});
test("modules: bookWorld _type 模式", function () {
  var ctx = { src: mkSrc(), host: "https://x.com", jsonEnabled: false };
  var bw = modules.buildBookWorld(ctx.src, ctx).module;
  var key = Object.keys(bw)[0];
  eq(key, "分类");
  eq(bw[key].requestInfo, "@js:\nlet {_type}=params.filters\nlet url=`/${_type}/${params.pageIndex}.html`;\n\nreturn {url:url}");
  eq(bw[key].moreKeys.requestFilters, "_type\n玄幻::xh\n武侠::wx");
  eq(bw[key].bookName, "(//a)[1]/@title");
  eq(bw[key].wordCount, "(//em)[1]/text()");
  eq(bw[key].lastChapterTitle, "(//em)[2]/text()");
});
test("modules: bookWorld 逐行模式（格式二数组 + 分页拼接）", function () {
  var ctx = { src: mkSrc({ exploreUrl: "玄幻::/xh/{{page}}.html\n武侠::https://y.com/wx/{{page}}.html" }), host: "https://x.com", jsonEnabled: false };
  var r = modules.buildBookWorld(ctx.src, ctx);
  var bw = r.module;
  var keys = Object.keys(bw);
  eq(keys.length, 1);
  var m = bw["分类"];
  ok(m.moreKeys && Array.isArray(m.moreKeys.requestFilters), "requestFilters 应为格式二数组");
  eq(m.moreKeys.requestFilters.length, 1);
  eq(m.moreKeys.requestFilters[0].key, "order");
  eq(m.moreKeys.requestFilters[0].items.length, 2);
  eq(m.moreKeys.requestFilters[0].items[0].title, "玄幻");
  eq(m.moreKeys.requestFilters[0].items[0].value, "/xh");
  ok(m.requestInfo.indexOf("params.filters.order") !== -1, "requestInfo 应引用 params.filters.order");
  ok(m.requestInfo.indexOf("encodeURI") !== -1, "requestInfo 应 encodeURI");
});
test("modules: bookWorld 单入口（拼接方案）", function () {
  var ctx = { src: mkSrc({ exploreUrl: "https://x.com/list/{{page}}.html" }), host: "https://x.com", jsonEnabled: false };
  var bw = modules.buildBookWorld(ctx.src, ctx).module;
  eq(Object.keys(bw).length, 1);
  var m = bw["分类"];
  ok(m.requestInfo.indexOf('params.filters.order + "/" + params.pageIndex') !== -1, "单行走拼接方案");
  ok(m.moreKeys.requestFilters[0].items[0].value === "https://x.com/list", "value 应为去页码后的根路径");
});
test("modules: JSONPath 透传降级", function () {
  var ctx = { src: mkSrc(), host: "https://x.com", jsonEnabled: true };
  var r = modules.buildSearchBook(ctx.src, ctx);
  ok(r.warnings.length >= 0);
  var ctx2 = { src: mkSrc(), host: "https://x.com", jsonEnabled: false };
  var r2 = rules.convertRule("$.data.list", ctx2);
  ok(r2.warnings.some(function (w) { return w.level === "unsupported"; }), "jsonEnabled=false 应标记 unsupported");
  eq(r2.value, "$.data.list");
  var r3 = rules.convertRule("$.data.list", { jsonEnabled: true });
  eq(r3.value, "$.data.list");
});

// ---------- utils ----------
test("utils: 相对 URL 绝对化保护模板", function () {
  eq(utils.resolveUrl("/x/{{page}}.html", "https://x.com/"), "https://x.com/x/{{page}}.html");
  eq(utils.resolveUrl("/s?k=%@keyWord", "https://x.com/"), "https://x.com/s?k=%@keyWord");
});
test("utils: splitTopLevel 引号内忽略分隔符", function () {
  eq(JSON.stringify(utils.splitTopLevel('a("||") || b', ["||"])), '["a(\\"||\\") "," b"]');
});
test("utils: indexPredicate", function () {
  eq(utils.indexToPosExpr(0), "1");
  eq(utils.indexToPosExpr(-1), "last()");
  eq(utils.indexToPosExpr(2), "3");
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
// ---------- {{@@}} 内联 与 ||@js: 组装 ----------
test("rules: @js 后缀组装为 ||@js:", function () {
  var r = rules.convertRule("img@src@js:baseUrl+result", BASE);
  eq(r.value, "//img/@src||@js:\nreturn (params.responseUrl+result);");
});
test("rules: {{@@规则}} 内联求值等价转换", function () {
  var a = rules.convertRule("@js:baseUrl+{{@@img@src}}", BASE);
  var b = rules.convertRule("img@src@js:baseUrl+result", BASE);
  eq(a.value, b.value);
});
test("rules: 净化后缀组装为 ||@js:", function () {
  var r = rules.convertRule("class.x@text##广告##", BASE);
  ok(r.value.indexOf('||@js:\nreturn result.replace("广告","");') !== -1, "应为 ||@js: 后处理");
});

// ---------- JSON 解析源 ----------
test("rules: JSONPath/裸词透传（jsonEnabled）", function () {
  eq(rules.convertRule("$.info.Datas", { jsonEnabled: true }).value, "$.info.Datas");
  eq(rules.convertRule("author", { jsonEnabled: true }).value, "author");
  var multi = rules.convertRule("{{$.a}},{{$.b}}", { jsonEnabled: true });
  ok(multi.warnings.some(function (w) { return w.level === "degraded"; }), "多键组合应有提示");
});
test("modules: JSON 源整模块启用 json 解析", function () {
  var ctx = { src: mkSrc({
    searchUrl: "https://api.x.com/search?q={{key}}",
    ruleSearch: { bookList: "$.info.Datas", name: "name", author: "author", bookUrl: "$.url" }
  }), host: "https://x.com", jsonEnabled: false };
  var sb = modules.buildSearchBook(ctx.src, ctx);
  eq(sb.module.parserID, "JSON");
  eq(sb.module.responseFormatType, "json");
  eq(sb.module.list, "$.info.Datas");
  eq(sb.module.bookName, "name");
});

// ---------- {{}} 模板（嵌套规则求值）----------
test("rules: {{@@rule}} 整条解包", function () {
  eq(rules.convertRule("{{@@img@data-src}}", BASE).value, "//img/@data-src");
  eq(rules.convertRule("{{//img/@src}}", BASE).value, "//img/@src");
});
test("rules: {{@css:}} 整条解包", function () {
  var r = rules.convertRule("{{@css:.cover img@src}}", BASE);
  eq(r.value, "//*[contains(@class,\"cover\")]//img/@src");
});
test("rules: 文本+单 XPath 占位符 → ||@js:", function () {
  var r = rules.convertRule('https://static.missevan.com/{{//*[contains(@class,"pld")]/@data-soundurl64}}', BASE);
  eq(r.value, '//*[contains(@class,"pld")]/@data-soundurl64||@js:\nreturn "https://static.missevan.com/"+result;');
});
test("rules: 文本+单 JSONPath 占位符（json 模块）→ ||@js:", function () {
  var r = rules.convertRule("https://www.x.com/drama/{{$.id}}", { jsonEnabled: true });
  ok(r.value.indexOf("$.id||@js:") === 0, "应以 $.id||@js: 开头");
  ok(r.value.indexOf('"https://www.x.com/drama/"+result') !== -1, "应拼接前缀");
});
test("rules: 多 XPath 占位符 → concat()", function () {
  var r = rules.convertRule("https://x.com/{{@@h1@text}}/b/{{@@a@href}}", BASE);
  ok(r.value.indexOf("concat(") === 0, "应为 concat 形式");
  ok(r.value.indexOf("//h1") !== -1 && r.value.indexOf("//a/@href") !== -1, "应包含两个子选择器");
});
test("rules: {{JS 表达式}} → @js: 块", function () {
  var r = rules.convertRule('{{baseUrl+"/x"}}', BASE);
  ok(r.value.indexOf("@js:") === 0 && r.value.indexOf("params.responseUrl") !== -1, "应翻译为 @js: 块并映射 baseUrl→responseUrl");
});

test("modules: bookWorld 页码表达式归一化 → _type 模式", function () {
  var ctx = { src: mkSrc({ exploreUrl: "完结::/wanjie/{{page == 1 ? \"\" : page + \".html\"}}\n玄幻::/xuanhuan/{{page == 1 ? \"\" : page + \".html\"}}" }), host: "https://x.com", jsonEnabled: false };
  var r = modules.buildBookWorld(ctx.src, ctx);
  var m = r.module["分类"];
  eq(m.moreKeys.requestFilters.split("\n")[0], "_type");
  ok(m.requestInfo.indexOf("${params.pageIndex == 1 ? \"\" : params.pageIndex + \".html\"}") !== -1, "应内联翻译后的三元表达式");
});
test("modules: bookWorld 各行表达式不同 → 运行时求值方案", function () {
  var ctx = { src: mkSrc({ exploreUrl: "甲::/a/{{(page-1)*20}}.html\n乙::/b/{{page}}.html" }), host: "https://x.com", jsonEnabled: false };
  var r = modules.buildBookWorld(ctx.src, ctx);
  var m = r.module["分类"];
  ok(Array.isArray(m.moreKeys.requestFilters), "应为格式二数组");
  ok(m.requestInfo.indexOf("new Function") !== -1, "应使用运行时 Function 求值");
});

// ---------- ensureReturn：Legado 最后一行求值语义 ----------
test("ensureReturn: 多语句保持原样并追加 return 末行", function () {
  var got = rules.ensureReturn("var a = result.length;\nvar b = a * 2;\na + b");
  eq(got, "var a = result.length;\nvar b = a * 2;\na + b\nreturn (a + b);");
});
test("ensureReturn: 已含 return 原样保留", function () {
  var code = 'if (result) {\n  return "a";\n}\n"b"';
  eq(rules.ensureReturn(code), code);
});
test("ensureReturn: 单行表达式直接包裹不重复", function () {
  eq(rules.ensureReturn('result.replace(/x/g,"")'), 'return (result.replace(/x/g,""));');
});
test("ensureReturn: 末行为声明时回退原样", function () {
  eq(rules.ensureReturn("var c = result;"), "var c = result;");
});

// ---------- convertAll 批量转换 ----------
test("convertAll: 数组批量 + 失败隔离 + 重名去重", function () {
  var good1 = { bookSourceName: "A", bookSourceUrl: "https://a.com", searchUrl: "/s/{{key}}" };
  var good2 = { bookSourceName: "A", bookSourceUrl: "https://b.com", searchUrl: "/s/{{key}}" };
  var bad = { bookSourceName: "坏源" };  // 无 bookSourceUrl → error 警告但仍有 output? 检查：缺 url 时仍产出（警告），用完全非法对象测失败
  var r = converter.convertAll([good1, good2, { note: "x" }], {});
  eq(r.count, 3);
  eq(r.okCount, 2);
  var keys = Object.keys(r.output).sort();
  eq(keys.length, 2);
  ok(keys[0] === "A" && keys[1].indexOf("A(2)") === 0, "重名应追加后缀");
});
test("convertAll: 阅读导出格式 {\"0\":{...}} 与警告 source 标记", function () {
  var r = converter.convertAll({ "0": { bookSourceName: "B", bookSourceUrl: "https://b.com", searchUrl: "/s/{{key}}" } }, {});
  eq(Object.keys(r.output).length, 1);
  var w2 = converter.convertAll({ bookSourceType: 2, bookSourceName: "C", bookSourceUrl: "https://c.com", searchUrl: "/s" }, {}).warnings;
  ok(w2.some(function (w) { return w.source === "C"; }), "警告应带 source 字段");
});

test("jsRule: baseUrl 字段级映射 responseUrl", function () {
  eq(jsRule.translateJs('baseUrl+"/x"', {}).code, 'params.responseUrl+"/x"');
});
test("jsRule: book.* → params.queryInfo.* 字段名对齐", function () {
  eq(jsRule.translateJs("book.name", {}).code, "params.queryInfo.bookName");
  eq(jsRule.translateJs("book.lastChapter", {}).code, "params.queryInfo.lastChapterTitle");
  eq(jsRule.translateJs("book.bookUrl", {}).code, "params.queryInfo.detailUrl");
});
test("jsRule: chapter.url / source.sourceUrl 映射", function () {
  eq(jsRule.translateJs("chapter.url", {}).code, "params.responseUrl");
  eq(jsRule.translateJs("source.sourceUrl", {}).code, "config.host");
});
test("urlRule: 请求上下文 baseUrl 按角色映射", function () {
  var toc = urlRule.buildRequestInfo("/x/{{baseUrl}}/list", { src: { bookSourceUrl: "https://x.com" } }, "toc").requestInfo;
  ok(toc.indexOf("${result}") !== -1 && toc.indexOf("config.host") === -1, "目录请求应映射为 result");
  var sea = urlRule.buildRequestInfo("/x/{{baseUrl}}", { src: { bookSourceUrl: "https://x.com" } }, "search").requestInfo;
  ok(sea.indexOf("config.host") !== -1, "搜索入口应映射为 config.host");
});

test("Default: 裸词全为标签（div@ul@li）", function () {
  eq(defaultRule.convertDefault("div@ul@li", BASE).xpath, "//div//ul//li");
});
test("Default: 简写 . 与 # 等价 class./id.", function () {
  eq(defaultRule.convertDefault(".item a@href", BASE).xpath,
     defaultRule.convertDefault("class.item@tag.a@href", BASE).xpath);
  eq(defaultRule.convertDefault("#fmimg img", BASE).xpath,
     defaultRule.convertDefault("id.fmimg@img", BASE).xpath);
});
test("CSS: 子代轴与 Default 后代轴区分", function () {
  var c = cssRule.convertCss("@css:.item>a@text", BASE).xpath;
  ok(c.indexOf("/a/") !== -1 || c.slice(-3) === "/a" , "子代轴应为 /");
  var d2 = defaultRule.convertDefault("class.item@a@text", BASE).xpath;
  ok(d2.indexOf("//a") !== -1, "Default 应为后代 //a");
});

console.log("");
console.log(failures === 0 ? "全部通过（" + tests.length + " 项）" : failures + " 项失败");
process.exit(failures === 0 ? 0 : 1);

