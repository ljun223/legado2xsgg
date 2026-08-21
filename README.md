# Legado2XSGG

把「[开源阅读](https://github.com/gedoor/legado)（Legado）」书源转换为「香色闺阁（XSGG）」书源的**纯 JS 转换引擎** + **Android 工具 App**。

> 无需服务器、无需 Node 运行时：转换引擎是零依赖的原生 JavaScript，可跑在 Node、浏览器、Android WebView 里。

## 功能

### 转换引擎（`converter/`）

| 输入（Legado） | 输出（XSGG） |
|---|---|
| Default 规则（`class.x.0@tag.a@text`…） | XPath（位置索引 `[1]`/`last()`、排除、数组区间、多类名合并、`rel.` 前缀等） |
| CSS 规则 `@css:` | XPath |
| URL 规则：`{{key}}`/`{{page}}`、`,{...}` 选项 | `%@keyWord`/`%@pageIndex`；POST+body+charset→`responseEncode`；`<,{{page}}>` 可选段 |
| JS 规则 `<js></js>` / `@js:` | `@js:` 块 + `java.*` 函数映射（见下表） |
| 分类 `exploreUrl` + `ruleExplore` | `bookWorld.分类`（`_type` 共享模板 / 格式二筛选数组两种模式，自动分页拼接） |
| 顶层 `header` | `httpHeaders` |
| `bookSourceType` 0/1/2/4 | `sourceType` text/audio/comic/video |

无法转换的语法（JSONPath、`%%`、AllInOne 正则等）**保留原样并给出分级提示**（note/degraded/error/unsupported），App 内标红展示需人工处理项。

#### java.* 函数映射（节选）

| Legado | 转换目标 | 依赖 |
|---|---|---|
| `java.base64Encode/Decode` | 原生 `btoa`/`atob` 包装（UTF-8 安全，兼容 URL_SAFE 字母表） | 无 |
| `java.md5Encode` / `md5Encode16` | `CryptoJS.MD5(...)` | cryptojs 注入 |
| `java.aes*`（8 个变体） | `CryptoJS.AES.*`，解析 `AES/CBC/PKCS5Padding` 等 transformation | cryptojs 注入 |
| `java.encodeURI` / `timeFormat` / `log` | `encodeURIComponent` / Date 格式化 / `params.nativeTool.log` | 无 |

需要 CryptoJS 的规则会在值首行注入 `cryptojs=<源码>` 前缀（自包含离线可用）；香色闺阁的 `@js:` 是完整前端环境，也可用 `<script src>` 引用外部 .js 库。

### Android App（`app/`）

- **一键转换**：导入 Legado 书源 JSON → 预览转换结果（警告标红）→ 复制 / 转 XBS / 保存到 Download
- **XBS ↔ JSON 双向转换**（XXTEA，与官方格式字节兼容）
- **AI 写源**：内置浏览器抓页 + LLM 多轮迭代生成书源（OpenAI 兼容接口）
- **AI 一键转换**：上传 Legado 书源文件交给 AI 按协议转换（消耗 token 的备选方案）
- 内置两份 Skill 提示词（`skill-xbs.md` 写源协议 / `skill-convert.md` 转换协议），支持导入自定义替换

## 目录结构

```
legado2xsgg/
├── converter/            # 转换引擎（纯 JS，零依赖）
│   ├── lib/              #   核心实现
│   ├── test/             #   金标准回归 + 单元测试
│   ├── cli.js            #   命令行入口
│   └── assets/           #   crypto-js.min.js
├── app/                  # Android 工具 App（纯 Java，无 Go/NDK）
│   ├── apkui/            #   MainActivity / XbsTools / XXTEA / res
│   ├── assets/           #   converter.bundle.js（勿手改，脚本生成）、skill 文档
│   ├── tools/            #   bundle 生成 / zipalign 脚本
│   └── build-apk.sh      #   一键构建 APK
└── docs/                 # 两端书源规则文档（版权归原作者）
```

## 构建与测试

```bash
# 转换引擎测试
cd converter
node test/run.js          # 金标准回归（6 项）
node test/units.js        # 单元测试（28 项）

# 命令行转换
node cli.js 书源.json > 输出.json

# 修改 lib/ 后重新生成 App 内置 bundle
cd ../app && python3 tools/gen-converter-bundle.py

# 构建 APK（需要 Android build-tools：aapt/javac/D8/jarsigner/keytool）
cd app && ./build-apk.sh  # 产物 xbsrebuild.apk
```

环境变量：`ANDROID_JAR`（默认 `/opt/android-platform/android-9/android.jar`）、`R8_JAR`（默认 `/opt/android-tools/r8.jar`）。

## 使用说明（App）

1. **转换页**：「导入开源阅读书源」选择 JSON → 自动转换预览 → 保存或转 XBS 后导入香色闺阁
2. **AI 写源页**：输入起始网址 → 全自动抓页迭代，或手动浏览后「抓取当前页」；顶部 ⚙ 配置 API 地址/模型/Key
3. **AI 转换**：对话行「上传书源」选择 Legado JSON，自动切换转换模式发送

## 免责声明

本项目仅供学习交流与个人使用，请勿用于商业用途。转换生成的书源数据来自用户自备的书源文件，与本项目无关。

## 致谢

- [gedoor/legado](https://github.com/gedoor/legado) —— 开源阅读；规则文档原作者 Celeter、整理者喵公子
- [urzeye/shuyuan-lab](https://github.com/urzeye/shuyuan-lab) —— 香色闺阁书源规则文档
- [crypto-js](https://github.com/brix/crypto-js) —— 加密函数库
- [xxtea-go](https://github.com/xxtea/xxtea-go) —— XBS 文件格式参考实现

## License

[MIT](LICENSE)
