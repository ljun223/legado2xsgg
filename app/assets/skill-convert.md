# 书源转换 Skill：开源阅读(Legado) → 香色闺阁(XSGG)

把用户提供的开源阅读书源 JSON 转换为香色闺阁格式书源 JSON。用户可能一次给出多个书源（顶层数组），全部转换输出。

## 输出格式（直接输出结果，不要 markdown 代码块、不要注释、不要解释）

```json
{"站点名":{"sourceName":"站点名","sourceUrl":"https://example.com","sourceType":"text","weight":"0","enable":"1","miniAppVersion":"2.53.2","lastModifyTime":"1730000000.0","searchBook":{...},"bookDetail":{...},"chapterList":{...},"chapterContent":{...},"bookWorld":{},"shudanList":{},"shudanDetail":{"actionID":"shudanDetail","parserID":"DOM"},"shupingList":{"actionID":"shupingList","parserID":"DOM"},"shupingHome":{"actionID":"shupingHome","parserID":"DOM"},"searchShudan":{"actionID":"searchShudan","parserID":"DOM"},"relatedWord":{"actionID":"relatedWord","parserID":"DOM"}}}
```

## 字段映射

| 开源阅读 | 香色闺阁 | 说明 |
|---|---|---|
| bookSourceName | 外层键 + sourceName | |
| bookSourceUrl | sourceUrl | 去掉末尾 `/` |
| bookSourceType | sourceType | 0→text、1→audio、2→comic、4→video、3(文件)→text |
| weight | weight | 转字符串 |
| enabled | enable | false→"0"，否则"1" |
| ruleSearch + searchUrl | searchBook | |
| ruleBookInfo | bookDetail | |
| ruleToc | chapterList | |
| ruleContent | chapterContent | |
| exploreUrl + ruleExplore | bookWorld.分类 | 见分类章节 |
| header（JSON 字符串） | httpHeaders | 顶层对象；UA/Referer/Cookie 等站点必需头 |
| bookUrlPattern / loginUrl / canReName / bookInfoInit / isVip / webJs / sourceRegex | （无对应） | 忽略并在说明中列出 |

## 子模块通用结构

所有子模块必须含：`actionID`(模块名)、`parserID:"DOM"`、`responseFormatType:"html"`、`host`(域名)、`validConfig:""`。
- `responseFormatType`：默认空=普通字符串（可手动解析）；`xml`=XML；`json`=JSON（解析 JSON 书源）；`html`=DOM（XPath 解析）；`base64str`=base64；`data`=数据流；`filePath`=文件路径。转换时一般固定 `"html"`。
- searchBook 额外：`requestInfo` = searchUrl 转换（把 `{{key}}`/`%@key`/`[[key]]` 统一替换为 `%@keyWord`）。
- bookDetail / chapterList / chapterContent **不设** requestInfo（App 沿用点击进入的 URL）。
- 无对应规则的模块跳过；bookWorld 的 shudan 等辅助模块照抄骨架。
- 极复杂规则可改用**手动解析**：`parserID:"JS"` 或自定义函数（`function functionName(config, params, result){...}` 返回 `{'list':list}` 等各解析值），仅在 XPath 无法表达时使用并注明。

## Legado 规则 → XPath 转换

链式规则按 `@` 分段，逐段转换后用 `//` 连接（末段内容操作直接附在最后）。样例：`class.a@tag.b@text` → `//*[contains(@class,"a")]//b/text()`。

### 段类型
- `tag.xxx` → `//xxx`（xxx=标签名，如 `tag.a` → `//a`）
- `class.xxx` → `//*[contains(@class,"xxx")]`；`class.x y`（空格多类）→ 链中为 `/*[contains(@class,"x") and contains(@class,"y")]`（直接子节点），作为规则首段时用 `//*[contains(@class,"x") and contains(@class,"y")]`
- `id.xxx` / `#xxx` → `//*[contains(@id,"xxx")]`
- `text.xxx` → `//*[contains(text(),"xxx")]`
- `rel.xxx` → `//rel[contains(@class,"xxx")]`
- 裸词为标签名 → `//标签名`（如 `a` → `//a`）

### 索引与位置（段尾）
- `.N` → `[N+1]`：`a.0` → `//a[1]`、`class.x.1` → `//*[contains(@class,"x")][2]`、`a.-1` → `//a[last()]`、`a.-2` → `//a[last()-1]`
- `:eq(N)` → `[N+1]`、`:first` → `[1]`、`:last` → `[last()]`
- `[0]` → `[1]`、`[0,2]` → `[1 or 3]`、`[!1]` → `not([2])`、`[0,3)` 等区间 → 对应的 `position()` 表达式
- `:gt(N)` → `[position()>N+1]`、`:lt(N)` → `[position()<N+1]`

### 内容操作（@ 的末段）
- `text` / `textNodes` / `ownText` → `/text()`
- `href` → `/@href`、`src` → `/@src`
- `html` / `all` → `/html()`（保留标签，漫画/图片正文常用）
- `text.xxx` 段后跟 `@text` → `//*[contains(text(),"xxx")]/text()`

### 复杂语法处理
- 尾部 `##正则##替换`：转换为 `xpath||@js:` 后处理（`return result.replace(...)`），替换内容为空时第二 `##` 省略；`##...##...###`（OnlyOne，只取第一个匹配）用非全局 replace。
- 规则尾部 `<js>代码</js>` 或 `@js:代码`：与选择器组合时输出 `xpath||@js:` 形态（`result` 为选择器取值，`baseUrl`→`config.host`）；纯 JS 规则输出 `@js:` 块。
- **`{{@@规则}}` 内联求值**：Legado 中 `@js:baseUrl+{{@@img@src}}` 等价于 `img@src@js:baseUrl+result`，统一转换为 `//img/@src||@js:\nreturn config.host+result;`（仅支持单个占位符且子规则可转纯选择器）。
- `||` 备选：各备选分别转换后用 ` || ` 连接（香色闺阁原生支持）。
- `&&` 合并所有值：各段均为纯 XPath 时转为并集 `|` 并注明语义差异；含 JS 段时保留原样并注明需人工处理。
- `%%` 依次取数：无对应能力，保留原样并注明需人工处理。
- 列表倒序前缀 `-`（如目录 `-tag.dd`）：剥离前缀后正常转换，注明结果顺序可能相反。
- 详情页 `tocUrl` 规则：香色闺阁目录默认沿用详情页 URL，若目录页与详情页不同需为 chapterList 手动配置 requestInfo，转换说明中必须提示。
- 无法转换的（`@put:`、`@rule:`、`{{}}` 内嵌等）：保留原文并在输出 JSON 中注明需人工处理。

### JSON 解析源（API 源）

当模块的列表规则为 JSONPath（`$.x` / `$..` / `@json:` 前缀）或任一字段为 JSONPath 时，整模块自动切换为 JSON 解析：`parserID:"JSON"`、`responseFormatType:"json"`，规则直接透传：
- JSONPath（`$.info.Datas`）→ 原样透传；
- **裸词**（如 `author`、`cover`、`abstract`）= 相对当前条目的 JSON 键 → 原样透传；
- 多 JSONPath 组合（`{{$.a}},{{$.b}}`）与 URL 内嵌 JSONPath（`https://x.com/d/{{$.id}}`）→ 保留原样 + degraded 提示（XSGG 可用 `JSONPath||@js: result` 拼接改写），需人工确认；
- 同一书源可混合：如搜索/正文为 JSON、目录页为 HTML，各模块独立判定。

### java.* 函数映射表（JS 内调用）

香色闺阁的 `@js:` 运行在完整前端 JS 环境：**所有标准 JS/浏览器函数可直接使用**（btoa/atob、encodeURIComponent、Date、JSON、RegExp 等），还可通过 `document.createElement('script')` + `src` 引入外部 .js 库后使用其函数。转换 java.* 时优先用原生实现：

| 开源阅读 | 转换目标 | 依赖 |
|---|---|---|
| `java.base64Encode(s)` | `(function(s){return btoa(unescape(encodeURIComponent(String(s))))})(s)` | 无（原生） |
| `java.base64Decode(s)` | atob 包装（自动兼容 URL_SAFE `-_` 字母表、补 padding、UTF-8 解码） | 无（原生） |
| `java.md5Encode(s)` | `CryptoJS.MD5(s).toString()` | cryptojs 注入 |
| `java.md5Encode16(s)` | `CryptoJS.MD5(s).toString().substring(8,24)` | cryptojs 注入 |
| `java.aes*ToString/aesBase64*/aes*ByteArray`（8 个变体） | `CryptoJS.AES.decrypt/encrypt(...)`，transformation（如 `AES/CBC/PKCS5Padding`）解析为 mode/padding，key 按 UTF-8，iv 非空且非 ECB 时传入；Base64 变体先 `enc.Base64.parse` 密文 | cryptojs 注入 |
| `java.encodeURI(s[, enc])` | `encodeURIComponent(String(s))`；enc 为 GBK 等非 UTF-8 时注明需人工改写 | 无 |
| `java.timeFormat(ts)` | Date 格式化为 `yyyy/MM/dd HH:mm`（毫秒/秒自动识别） | 无 |
| `java.log(msg)` | `params.nativeTool.log(msg)` | 无 |
| `baseUrl` / `src` 变量 | `config.host` / `result` | 无 |
| `java.utf8ToGbk(s)` | 原样返回 + 提示（无浏览器端 GBK 编码器） | — |
| `java.ajax/ajaxAll/connect/get/post` | 退化为取 URL 参数 + 提示改写到模块 requestInfo | — |
| `java.getCookie(...)` | 置空 + 提示（App 自动携带 Cookie） | — |
| 其余（文件/zip/TTF/字体/setContent/getString 等） | 保留原样 + unsupported 提示 | — |

需要 CryptoJS 的规则会在值首行注入 `cryptojs=<CryptoJS 源码>` 前缀（自包含、离线可用）；若确认目标 App 支持 `<script src>` 引用外部 .js，也可改为 CDN 引用以减小书源体积。

## 分类 exploreUrl → bookWorld.分类（重点）

exploreUrl 支持两种输入格式：
1. **文本行**：每行 `名称::路径`（无 `::` 时名称取「分类」）；
2. **JSON 数组**：`[{"title":"今日限免","url":"...","style":{...}},...]`（title→名称、url→路径，style 忽略）。

分类路径可能含 `{{page}}` 分页占位（先做 percent-encoding 解码还原中文，如 `%e8%bf%9e%e8%bd%bd` → `连载`）。

**模式一（_type，共享 URL 模板）**：所有路径含 `{{page}}` 且去掉 token 后骨架一致（token 为各路径中互不相同的那一段，可能在路径中间）：
```
美女写真::/meinv/page/{{page}}
连载漫画::/item/%e8%bf%9e%e8%bd%bd/page/{{page}}
```
→ `requestFilters`（键 `_type`，格式三）：
```
_type
美女写真::meinv
连载漫画::%e8%bf%9e%e8%bd%bd
```
→ `requestInfo`（`_TYPE_` 换成 `${_type}`，`{{page}}` 换成 `${params.pageIndex}`，相对路径保留）：
```
@js:
let {_type}=params.filters
let url=`/item/${_type}/page/${params.pageIndex}`;

return {url:url}
```

**模式二（逐行，格式二数组）**：无共享模板时，`requestFilters` 用**格式二多键数组**，`key` 取 `order`，value 为各分类根路径（去掉 `{{page}}` 及前面的页码段 `/page/`），中文用原文（requestInfo 里统一 encodeURI）：
```json
"requestFilters": [
  {
    "key": "order",
    "items": [
      { "title": "连载漫画", "value": "/item/连载" },
      { "title": "美女写真", "value": "/meinv" }
    ]
  }
]
```
→ 若所有路径的页码段相同（都是 `/page/` 等页码词段，或都是直接接在分类名后）→ requestInfo 用**拼接方案**：
```
@js:
let url = params.filters.order + "/page/" + params.pageIndex

return encodeURI(url)
```
页码段为 `""`（直接接在分类后，如 `/xuanhuan/{{page}}.html`）时：`params.filters.order + "/" + params.pageIndex`（有后缀则再 `+ ".html"`）。
若路径含 `{{page}}` 但结构不一致、或无分页占位 → value 保留完整路径（含 `{{page}}`），requestInfo 用 **replace 方案**：
```
@js:
let url = params.filters.order.replace('{{page}}', params.pageIndex)

return encodeURI(url)
```

bookWorld 模块：`actionID:"bookWorld"`、`parserID:"DOM"`、`responseFormatType:"html"`、`host`、`validConfig:""`、`requestInfo`(如上)、`_sIndex:0`、`moreKeys:{"pageSize":20,"requestFilters":...}`，列表规则取 ruleExplore（`bookList`→`list`、`name`→`bookName`、`bookUrl`→`detailUrl`、`coverUrl`→`cover`、`author`→`author`、`intro`→`desc`、`kind`→`cat`、`wordCount`→`wordCount`、`lastChapter`→`lastChapterTitle`）。ruleExplore 为空时用 ruleSearch 的相同字段。

## 输出约束（违反即视为失败）

- 禁止输出任何 Legado 语法：`ruleSearch`/`ruleBookInfo`/`ruleToc`/`ruleContent`/`ruleExplore`/`bookList`/`bookAuthor`/`bookUrl`/`bookSourceName`/`bookSourceUrl`/`@css:`/`[[key]]` 字段名。注意 `bookName` 是香色闺阁合法字段（searchBook/bookWorld 的书名规则键），不要误禁。
- 搜索占位符必须 `%@keyWord`。
- 必须只输出一个 JSON 对象（多个书源时合并为一个大对象，键=站点名）；不要输出代码块标记、不要输出解释文字。
- 规则为空或缺失时，对应模块/字段直接省略，不要用空字符串占位（validConfig 除外）。