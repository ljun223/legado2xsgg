#!/usr/bin/env node
"use strict";
var fs = require("fs");
var path = require("path");
var converter = require("./lib/index.js");

function main(argv) {
  if (argv.length < 1 || argv[0] === "-h" || argv[0] === "--help") {
    console.log("用法: legado2xsgg <input.json> [output.json]");
    console.log("  不指定 output.json 时输出到 stdout");
    return;
  }
  var input = argv[0];
  var output = argv[1];
  var raw;
  try {
    raw = fs.readFileSync(input, "utf8");
  } catch (e) {
    console.error("读取失败: " + e.message);
    process.exit(1);
  }
  var source;
  try {
    source = JSON.parse(raw);
  } catch (e) {
    console.error("JSON 解析失败: " + e.message);
    process.exit(1);
  }
  var cryptoJsSource = null;
  var assetPath = path.join(__dirname, "assets", "crypto-js.min.js");
  try {
    cryptoJsSource = fs.readFileSync(assetPath, "utf8");
  } catch (e) { /* 无资产时降级 */ }

  var result = converter.convert(source, { cryptoJsSource: cryptoJsSource });
  var hasError = false;
  result.warnings.forEach(function (w) {
    var tag = w.module ? "[" + w.module + "] " : "";
    console.error("[" + w.level + "] " + tag + w.msg);
    if (w.level === "error" || w.level === "unsupported") hasError = true;
  });
  if (!result.output) {
    console.error("转换失败，无输出");
    process.exit(1);
  }
  var text = JSON.stringify(result.output, null, 2);
  if (output) {
    fs.writeFileSync(output, text + "\n", "utf8");
    console.error("已写入 " + output + "（共 " + result.warnings.length + " 条提示）");
  } else {
    process.stdout.write(text + "\n");
  }
}

main(process.argv.slice(2));
