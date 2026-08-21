# 香色闺阁 书源规则（XBS）

> 本文件是本 App「AI 写源」功能的技能文档（system 提示词）。
> 来源：香色闺阁书源规则文档（urzeye/shuyuan-lab）。
>
> **你必须严格按本文档的格式与语法输出书源。** 任何其他格式（开源阅读/Legado、
> 你凭记忆的写法）都是错的，会被 App 拒绝。

---

## 一、基本概念

- **书源** = 一个站点的抓取规则，本质是一个 JSON 对象。
- `.xbs` 文件 = XXTEA 加密后的该 JSON（本 App 的「转换」页可在 XBS ↔ JSON 间互转）。
- 多个站点可合并为一个 JSON 对象，**键为站点名称**（全局唯一）。
- `sourceType` 取值：`text`（文本/小说，默认）、`audio`（音频）、`comic`（图片/漫画）、`video`（视频）。

---

## 二、书源 JSON 顶层结构

每个书源是一个 JSON 对象，**以站点名称为外层键**：

```json
{
  "站点名称": {
    "sourceName": "站点名称",
    "sourceUrl": "https://www.example.com",
    "weight": "100",
    "enable": 1,
    "desc": "备注信息",
    "password": "",
    "miniAppVersion": "2.53.2",
    "lastModifyTime": "1700000000.0",
    "sourceType": "text",
    "httpHeaders": { "User-Agent": "..." },
    "searchBook": {},
    "bookDetail": {},
    "chapterList": {},
    "chapterContent": {},
    "bookWorld": {},
    "shudanList": {},
    "shudanDetail": {},
    "shupingList": {},
    "shupingHome": {},
    "searchShudan": {},
    "relatedWord": {}
  }
}
```

**外层键 = 站点名称**，内部 `sourceName` 也填同一个名称。外层键名不要加空格或特殊字符。

**必填约束**：`sourceUrl` 是唯一必填字段，缺失时书源在 App 中不可用。

**开源阅读书源转换约束**（写源/转换时参照）：
- 开源阅读 `bookSourceUrl` 必填，对应香色闺阁 `sourceUrl`，转换时缺失会给出 error 级提示；
- 开源阅读 `bookSourceType`：0=文本 1=音频 2=图片漫画 3=文件 4=视频。香色闺阁支持文本/音频/图片/视频源（`sourceType`: text/audio/comic/video），但转换器按文本源生成规则，非文本源转换时给出 error 级提示，封面/正文/播放规则需人工核对；
- 开源阅读 `header`（JSON 字符串）映射为顶层 `httpHeaders`；`bookUrlPattern`/`loginUrl`/`canReName`/`bookInfoInit`/`isVip`/`webJs`/`sourceRegex` 无对应，忽略并提示；
- 分类（exploreUrl/ruleExplore）转换后统一写入 `bookWorld.分类.moreKeys.requestFilters`：`_type` 共享 URL 模板 → 格式三 `_type` 键 + `@js:` 模板拼接；无共享模板 → **格式二多键数组**（`key:"order"`，value 为各分类根路径，中文原文），requestInfo 用 `params.filters.order + "/page/" + params.pageIndex` 拼接分页并 `encodeURI(url)` 返回；路径结构不一致时 value 保留完整路径（含 `{{page}}`），requestInfo 用 `params.filters.order.replace('{{page}}', params.pageIndex)`。

---

## 三、顶层基本字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `sourceName` | String | 站点名称，同时作为外层 JSON 键，全局唯一 |
| `sourceUrl` | String | **必填**。站点首页 URL（`http://` 或 `https://` 开头），全局唯一，不写书源在 App 中不可用 |
| `weight` | String | 权重（排序优先级），数值越大越靠前 |
| `enable` | Integer/Boolean | `1`/`true` 启用，`0`/`false` 禁用 |
| `desc` | String | 备注说明 |
| `password` | String | 站点密码（修改规则时需输入，不影响正常使用，可为空） |
| `miniAppVersion` | String | 最低 App 版本号，如 `"2.53.2"` |
| `lastModifyTime` | String | 最后修改时间戳（Unix 时间戳字符串） |
| `sourceType` | String | `text`（默认）/ `audio` / `comic` / `video`。对应开源阅读 `bookSourceType`：0=文本→`text`，1=音频→`audio`，2=图片漫画→`comic`，3=文件（极少）→无对应，4=视频→`video` |
| `httpHeaders` | Object/String | 全局 HTTP 请求头（JSON 对象），子规则可继承或覆盖；不需要时可为空字符串 `""` |
| `toTop` | String | 置顶时间戳（App 自动写入，无需手动设置） |
| `authorId` | String | 作者 ID（通常为空字符串 `""`） |

---

## 四、通用子规则公共字段

`searchBook` / `bookDetail` / `chapterList` / `chapterContent` / `bookWorld` 等子规则共享以下公共字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `actionID` | String | 操作标识，值与所属键同名（如 `"searchBook"`） |
| `parserID` | String | 解析方式，默认 `"DOM"`（XPath 解析）；复杂规则可用 `"JS"` + 手动解析函数 |
| `host` | String | 该子规则使用的 host，覆盖顶层 `sourceUrl` |
| `requestInfo` | String | 请求信息（URL 模板或 `@js:` 动态脚本），见第九章 |
| `responseFormatType` | String | 响应格式：默认空=普通字符串（配手动解析）；`xml`=XML；`json`=JSON（JSON 书源）；`html`=DOM（XPath 常用）；`base64str`=base64；`data`=数据流；`filePath`=文件路径。**常规 HTML 书源固定 `"html"`** |
| `validConfig` | String | 有效性配置，**固定为空字符串 `""`** |
| `moreKeys` | Object | 额外配置（分页、筛选等） |
| `httpHeaders` | Object | 子规则级 HTTP 请求头，覆盖顶层 httpHeaders（用于特殊 UA/Cookie 场景） |

> **手动解析**：XPath 表达不了的场景（如返回纯字符串、JSON 加工、复杂重组），可用 `parserID:"JS"` + 手动解析函数，与标准规则解析共用：
> ```
> function functionName(config, params, result)
> {
>     let list = [];            // 自定义解析结果
>     return {'list':list};     // 返回各解析值即可（bookName/author/... 同理）
> }
> ```
> `parserID:"DOM"` + `responseFormatType:"json"` 时用 JSONPath（如 `$.data.list`）；`responseFormatType` 默认空时结果是普通字符串，配合手动解析处理。

---

## 五、书籍搜索规则（searchBook）

| 字段 | 说明 |
|---|---|
| `requestInfo` | 搜索请求 URL 模板或 `@js:` 动态脚本 |
| `list` | 搜索结果列表节点选择器（每本书的容器） |
| `bookName` | 书名 |
| `author` | 作者 |
| `cover` | 封面图 URL |
| `desc` | 书籍简介 |
| `cat` | 分类 |
| `status` | 更新状态（连载/完结） |
| `wordCount` | 字数 |
| `lastChapterTitle` | 最新章节标题 |
| `detailUrl` | 书籍详情页 URL |
| `moreKeys.pageSize` | 每页结果数（Integer） |
| `moreKeys.maxPage` | 最大翻页次数限制（Integer） |
| `JSParser` | 自定义 JS 解析函数（见第十一章） |

### requestInfo：URL 模板（简单写法）

在 URL 中直接使用占位符：

| 占位符 | 说明 |
|---|---|
| `%@keyWord` | **搜索关键词**（App 搜索时替换为用户输入） |
| `%@pageIndex` | 页码（从 1 开始） |
| `%@filter` | 单键筛选参数（对应 moreKeys.requestFilters 的 value） |
| `%@result` | 上一步解析结果（如 detailUrl 值） |

示例：
```
https://www.example.com/search.php?q=%@keyWord&p=%@pageIndex
```

### requestInfo：`@js:` 动态脚本（高级写法）

以 `@js:` 开头写 JS，返回请求配置对象：

```json
"requestInfo": "@js:
let url = config.host + '/search.html';
let hp = {'name': params.keyWord};
return {'url': url, 'POST': true, 'httpParams': hp, 'httpHeaders': config.httpHeaders, forbidCookie: true, cacheTime: 3600};"
```

**可用变量：**

| 变量 | 说明 |
|---|---|
| `config.host` | 站点 host |
| `config.httpHeaders` | 全局请求头 |
| `params.keyWord` | 搜索词 |
| `params.pageIndex` | 当前页码 |
| `params.filters` | 多键筛选参数对象（如 `params.filters.cat`） |
| `params.responseUrl` | 实际响应 URL |
| `params.nativeTool` | 原生工具对象（见第十一章） |
| `result` | 上一步结果（如章节页 URL） |

**返回对象可含字段：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `url` | String | 请求 URL（必填） |
| `POST` | Boolean | `true` 表示 POST，默认 GET |
| `httpParams` | Object | 请求参数（GET 追加到 URL / POST 作为 body） |
| `httpHeaders` | Object | 请求头 |
| `forbidCookie` | Boolean | 禁止携带 Cookie |
| `cacheTime` | Number/String | 缓存时长（秒） |
| `webView` | String/Boolean | 使用 WebView 加载（空字符串 `""` 或 `true` 均可启用） |
| `webViewSkipUrls` | Array | WebView 中跳过加载的 URL（黑名单） |
| `webViewJsDelay` | Number | WebView 加载后等待 JS 执行的秒数 |

### cover 字段的 URL 后处理（`||@js:`）

当封面图 URL 需要由 detailUrl 计算时：
```json
"cover": "//h4/a/@href ||@js:
let id = result.match(/(\\d+)/)[0];
return `${config.host}/files/image/${parseInt(id/1000)}/${id}/${id}s.jpg`"
```

---

## 六、书籍详情规则（bookDetail）

从书籍详情页提取元信息。

| 字段 | 说明 |
|---|---|
| `bookName` | 书名 |
| `author` | 作者 |
| `cover` | 封面图 URL |
| `desc` | 简介 |
| `cat` | 分类 |
| `status` | 状态（连载/完结） |
| `wordCount` | 字数 |
| `lastChapterTitle` | 最新章节 |

### 示例（使用 og 元标签）
```json
"bookDetail": {
  "actionID": "bookDetail",
  "parserID": "DOM",
  "responseFormatType": "html",
  "host": "https://www.example.com",
  "cover": "//meta[@property='og:image']/@content",
  "cat": "//meta[@property='og:novel:category']/@content",
  "desc": "//meta[@property='og:description']/@content",
  "validConfig": ""
}
```

---

## 七、章节列表规则（chapterList）

从书籍目录页爬取章节列表。

| 字段 | 说明 |
|---|---|
| `requestInfo` | 目录页 URL；可用 `@js:` 动态构建，`result` 变量为书籍详情页 URL |
| `list` | 章节列表节点选择器 |
| `title` | 章节标题选择器 |
| `url` | 章节内容页 URL 选择器；支持 `|| @js:` 后处理 URL（如拼接 responseUrl） |
| `nextPageUrl` | 目录下一页 URL（目录分页时使用），配合 `moreKeys.maxPage` |
| `moreKeys.maxPage` | 目录最大翻页次数 |
| `moreKeys.skipCount` | 跳过列表头部 N 项（用于去除非章节行） |

### 示例
```json
"chapterList": {
  "actionID": "chapterList",
  "parserID": "DOM",
  "responseFormatType": "html",
  "host": "https://www.example.com",
  "list": "//div[@id='list']/dl/dd",
  "title": "//a/text()",
  "url": "//a/@href",
  "moreKeys": { "maxPage": 500 },
  "validConfig": ""
}
```

### url 字段后处理示例
```json
"url": "//a/@href || @js:
return params.responseUrl + result;"
```

---

## 八、章节内容规则（chapterContent）

从章节页面抓取正文内容。

| 字段 | 说明 |
|---|---|
| `requestInfo` | 章节页 URL；留空时 App 自动使用 chapterList 中的 url |
| `content` | 正文内容选择器；支持 `||` 备选和 `||@js:` 后处理 |
| `nextPageUrl` | 章节下一页 URL 选择器（章节分页时使用），配合 `moreKeys.maxPage` |
| `moreKeys.maxPage` | 章节最大翻页次数（如 `6` 表示最多翻 6 页合并） |

### 普通示例
```json
"chapterContent": {
  "actionID": "chapterContent",
  "parserID": "DOM",
  "responseFormatType": "html",
  "host": "https://www.example.com",
  "content": "//div[@id='content']",
  "validConfig": ""
}
```

### 分页章节 + 内容过滤示例
```json
"chapterContent": {
  "actionID": "chapterContent",
  "parserID": "DOM",
  "responseFormatType": "html",
  "host": "https://m.richvv.com",
  "content": "//*[@id='nr1'] | @js:
return result.replace(/精华书阁.*?最新章节！/, '').replace(/为您提供.*?保存好书签！/g, '');",
  "nextPageUrl": "//a[text()='下一页']/@href",
  "moreKeys": { "maxPage": 6 },
  "validConfig": ""
}
```

### WebView 示例（需要 JS 渲染的站点）
```json
"requestInfo": "@js:
return {'url': result, 'webView': '', 'webViewSkipUrls': ['hm.baidu.com', 'https://www.hongxiu.com/ajax/user/info'], 'forbidCookie': true};"
```

---

## 九、请求信息（requestInfo）配置详解

### 方法一：URL 模板（简单写法）

在 URL 中直接使用占位符（见第五章）。

### 方法二：`@js:` 动态脚本（高级写法）

见第五章。

### `@js:` 运行环境能力

- **完整前端 JS 环境**：所有标准 JS/浏览器函数可直接使用——`btoa`/`atob`（Base64）、`encodeURIComponent`、`Date`、`JSON`、`RegExp`、`String.prototype.replace` 等。
- **引用外部 .js 库**：可创建 `<script>` 标签引入整个 .js 文件后使用其导出的函数，例如：
  ```js
  var s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/crypto-js@4.2.0/crypto-js.min.js';
  document.head.appendChild(s);
  // 之后即可使用 window.CryptoJS（注意加载时序，必要时配合 cacheTime/预加载）
  ```
- **加密实践**：MD5/AES/DES 等建议用 CryptoJS（`CryptoJS.MD5(x).toString()`、`CryptoJS.AES.decrypt(...)`）；纯 Base64 直接用原生 `btoa`/`atob`（UTF-8 需先 `unescape(encodeURIComponent(s))` 转字节）。
- **调试输出**：`params.nativeTool.log(msg)`。

---

## 十、选择器语法（XPath）

> **所有选择器都用 XPath，不要用 CSS 选择器。** demo.json 中未见任何 CSS 选择器。

### 基本语法
```xpath
//div[@id="list"]/dl/dd         -- 标准节点路径
//a/text()                        -- 取文本内容
//img/@src                        -- 取属性值
//meta[@property="og:image"]/@content
```

### `||` 双管道：备选选择器

当第一个选择器无结果时，尝试第二个：
```json
"list": "//*[@class='grid']//tr ||//*[@class='listBox']//li"
```

### `||@js:` 双管道接 JS：后处理

XPath 选出结果后，交给 JS 进一步处理，`result` 为 XPath 的结果字符串：
```json
"content": "//div[@id='content'] ||@js:
return result.replace(/最新网址：.*/,"").replace(/txt下载地址：.*/,"")"
```

### `|@replace:` 单管道接文本替换

去除结果中的指定前缀文本：
```json
"status": "//div[@id='info']/p[3]|@replace:最后更新："
```

### `|@js:` 单管道接 JS（不备选，仅处理）
```json
"desc": "//div[@id='intro']|@js:return result.replace(/\\n/g,'\n')"
```

---

## 十一、JSParser — 完整自定义 JS 解析函数

当站点结构复杂、XPath 规则难以覆盖时，可在 `searchBook` 中使用 `JSParser` 字段，编写完整的 JavaScript 解析函数。

**函数签名：**
```javascript
function functionName(config, params, result) {
    // result：响应 HTML 字符串
    // params.nativeTool.XPathParserWithSource(result) — 原生 XPath 解析器
    // params.nativeTool.log() — 日志输出（调试用）
    // params.responseUrl — 实际响应 URL

    let list = [];
    let xml = params.nativeTool.XPathParserWithSource(result);
    let items = xml.queryWithXPath("//div[@class='book']//li");

    for (let i in items) {
        list.push({
            "bookName": items[i].queryWithXPath("//h3/a/text()")[0].content(),
            "detailUrl": items[i].queryWithXPath("//h3/a/@href")[0].content(),
            "author":    items[i].queryWithXPath("//span[@class='author']/text()")[0].content(),
            "cover":     items[i].queryWithXPath("//img/@src")[0].content(),
            "status":    items[i].queryWithXPath("//span[@class='status']/text()")[0].content(),
            "wordCount": items[i].queryWithXPath("//span[@class='word']/text()")[0].content(),
            "lastChapterTitle": items[i].queryWithXPath("//a[@class='last']/text()")[0].content()
        });
    }

    return { "list": list };
}
```

**返回值：** 返回对象必须包含 `list` 键，值为书籍信息对象数组，每个对象可含 `bookName`、`detailUrl`、`author`、`cover`、`desc`、`cat`、`status`、`wordCount`、`lastChapterTitle` 等字段。

---

## 十二、书籍分类/发现规则（bookWorld）

书籍分类浏览规则。外层为分类名（可有多个），内层为该分类的抓取规则。

| 字段 | 说明 |
|---|---|
| `requestInfo` | 分类页 URL，支持 `%@filter`、`%@pageIndex` 或 `@js:` |
| `list` | 书籍列表节点 |
| `bookName` / `author` / `cover` / `detailUrl` 等 | 与 searchBook 同 |
| `_sIndex` | 分类排序序号（数值越小越靠前） |
| `moreKeys.pageSize` | 每页书籍数 |
| `moreKeys.requestFilters` | 筛选器定义（见下方三种格式） |

### requestFilters 三种格式

**格式一：简单 dict（单键筛选，value 直接替换 `%@filter`）**
```json
"requestFilters": {
  "风云榜": "hxyuepiao?",
  "热销榜": "hotsales?period=2&",
  "完本榜": "finish?period=2&"
}
```

**格式二：多键筛选数组（多维筛选，在 `@js:` 中通过 `params.filters.key` 访问）**
```json
"requestFilters": [
  {
    "key": "cat",
    "items": [
      { "title": "全部", "value": "f1" },
      { "title": "玄幻", "value": "20001" }
    ]
  },
  {
    "key": "status",
    "items": [
      { "title": "连载", "value": "0" },
      { "title": "完结", "value": "1" }
    ]
  }
]
```

**格式三：换行符分隔的字符串（单键或多键均可）**

单键（无 key 前缀，value 直接替换 `%@filter`）：
```
玄幻::1
仙侠::2
```
 多键（以 key 名开头，空行分隔不同 key）：
```
_class
全部::0
校园言情::1

_status
不限::0
已完本::5
```

### bookWorld 完整示例（榜单，单键筛选 dict）

```json
"bookWorld": {
  "榜单": {
    "actionID": "bookWorld",
    "parserID": "DOM",
    "responseFormatType": "html",
    "host": "https://www.hongxiu.com",
    "requestInfo": "https://www.hongxiu.com/rank/%@filterpageNum=%@pageIndex",
    "list": "//div[@class='book-img-text']//li",
    "bookName": "//div[2]/h4/a",
    "author": "//p[@class='author']/a[1]",
    "cover": "//div[1]/a/img/@src",
    "detailUrl": "//div[2]/h4/a/@href",
    "status": "//p[@class='author']/span[1]",
    "_sIndex": 2,
    "moreKeys": {
      "pageSize": "10",
      "requestFilters": {
        "风云榜": "hxyuepiao?",
        "热销榜": "hotsales?period=2&",
        "完本榜": "finish?period=2&"
      }
    },
    "validConfig": ""
  }
}
```

> `_sIndex` 仅用于排序分类先后，不写时按数组顺序。无分类需求时 `bookWorld` 写 `{}` 即可。

---

## 十三、书单规则（shudanList / shudanDetail）

| 规则键 | 说明 |
|---|---|
| `shudanList` | 书单列表（书单发现页） |
| `shudanDetail` | 书单详情（单个书单内的书籍列表） |

字段结构与其他子规则相同。无数据时写 `{ "actionID": "shudanList", "parserID": "DOM" }`。

---

## 十四、书评规则（shupingList / shupingHome）

| 规则键 | 说明 |
|---|---|
| `shupingList` | 书评列表（某本书的评论列表） |
| `shupingHome` | 书评首页（社区评论入口） |

无数据时写 `{ "actionID": "shupingList", "parserID": "DOM" }`。

---

## 十五、相关词规则（relatedWord）

搜索联想词/相关词规则：
```json
"relatedWord": {
  "actionID": "relatedWord",
  "parserID": "DOM"
}
```

---

## 十六、.xbs 文件格式

- 文件扩展名 `.xbs`，实质为 **XXTEA 加密的 JSON**。
- 加密密钥固定（已硬编码在 App 二进制中）。
- 本 App「转换」页可在 XBS ↔ JSON 间互转，方便查看/编辑书源。
- 导入方式：直链 URL / URL 自动搜索 / 文件导入。

---

## 十七、完整书源示例（精华书阁）

以下为涵盖搜索、详情、目录（分页）、正文（分页+过滤）的完整示例：

```json
{
  "精华书阁": {
    "sourceName": "精华书阁",
    "sourceUrl": "https://m.richvv.com",
    "weight": "9915",
    "enable": 1,
    "miniAppVersion": "2.53.2",
    "httpHeaders": {
      "referer": "https://m.richvv.com",
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1",
      "cookie": "waf_sc=5889647726;sex=boy"
    },
    "searchBook": {
      "actionID": "searchBook",
      "parserID": "DOM",
      "responseFormatType": "html",
      "host": "https://m.richvv.com",
      "requestInfo": "@js:
let url=\"https://m.richvv.com/search.html?ie=utf-8&\";
let hp={'word':params.keyWord};
return {'url':url,'httpParams':hp,'forbidCookie':true,\"cacheTime\":\"3600\"};",
      "list": "//div[@class='searchbook']",
      "bookName": "//h4[@class='bookname']/a/text()",
      "author": "//div[@class='author']/text()",
      "detailUrl": "//h4[@class='bookname']/a/@href",
      "cover": "//a/img/@src",
      "cat": "//div[@class='cat']/text()",
      "validConfig": ""
    },
    "bookDetail": {
      "actionID": "bookDetail",
      "parserID": "DOM",
      "responseFormatType": "html",
      "host": "https://m.richvv.com",
      "cover": "//div[@class='block_img2']/img/@src",
      "cat": "//div[@class='block_txt2']/p[4]/a/text()",
      "desc": "//div[@class='intro_info']/text()",
      "status": "//div[@class='block_txt2']/p[5]/text()",
      "validConfig": ""
    },
    "chapterList": {
      "actionID": "chapterList",
      "parserID": "DOM",
      "responseFormatType": "html",
      "host": "https://m.richvv.com",
      "list": "//ul[2][@class='chapter']/li",
      "title": "//a/text()",
      "url": "//a/@href",
      "nextPageUrl": "//*[contains(text(),'下一页')]/@href",
      "moreKeys": { "maxPage": 500 },
      "validConfig": ""
    },
    "chapterContent": {
      "actionID": "chapterContent",
      "parserID": "DOM",
      "responseFormatType": "html",
      "host": "https://m.richvv.com",
      "content": "//*[@id='nr1'] | @js:
return result.replace(/精华书阁.*?最新章节！/, '').replace(/为您提供.*?保存好书签！/g, '');",
      "nextPageUrl": "//a[text()='下一页']/@href",
      "moreKeys": { "maxPage": 6 },
      "validConfig": ""
    },
    "bookWorld": {},
    "shudanList": { "actionID": "shudanList", "parserID": "DOM" },
    "shudanDetail": { "actionID": "shudanDetail", "parserID": "DOM" },
    "shupingList": { "actionID": "shupingList", "parserID": "DOM" },
    "shupingHome": { "actionID": "shupingHome", "parserID": "DOM" },
    "searchShudan": { "actionID": "searchShudan", "parserID": "DOM" },
    "relatedWord": { "actionID": "relatedWord", "parserID": "DOM" }
  }
}
```

---

## 十八、与 App 的协作协议（AI 必须遵守）

本 App 的「AI 写源」是一个**多轮对话**。每一轮 App 会发给你：

- **system**：本文件全部内容 + 本协议
- **user**：一次「页面抓取」消息，格式如下

```
【页面抓取 #序号】
【URL】 当前页面地址
【标题】 页面标题
【HTML】 页面原始 HTML（截断，含表单与链接结构，优先依赖它）
【表单】 JS 提取到的表单/输入框（可能为空）
【链接】 JS 提取到的链接样本（可能为空）
【正文】 页面可见文本（可能为空）
```

### 18.1 你的回复格式（严格二选一，必须输出合法 JSON）

**需要查看更多页面时**（例如：不知道搜索 URL、需要看搜索结果页、需要看正文页结构）：

```json
{
  "need_page": {
    "url": "https://www.example.com/search.php?q=%@keyWord",
    "keyword": "斗破苍穹",
    "reason": "已从首页表单推断出搜索 URL，需要搜索结果页确认列表结构"
  }
}
```

- `url`：想查看的完整地址。**搜索类 URL 请带入一个真实热门书名作为样本关键字**
  （如「斗破苍穹」），并把它填进 `keyword`，App 会用用户真实关键字替换 `%@keyWord`
- `reason`：为什么要看这一页（会显示给用户）
- 只允许发**一个** need_page

**可以直接编写书源时**：

```json
{
  "source": {
    "站点名称": {
      "sourceName": "站点名称",
      "sourceUrl": "https://www.example.com",
      "searchBook": { ... },
      "bookDetail": { ... },
      "chapterList": { ... },
      "chapterContent": { ... }
    }
  },
  "note": "书源说明"
}
```

### 18.2 编写流程建议（逐步推进，宁可多问一页）

1. 第一轮：分析首页 HTML，推断搜索 URL（优先找 `<form>` 的 action 与输入框 name；
   找不到就用站点常见模式 `/search.php?q=`、`/s.php?q=` 等）→ 回复 need_page
2. 第二轮：看搜索结果页，确认 `searchBook.list`/`bookName`/`author`/`detailUrl` 选择器 → 回复
   need_page 要求打开某本书的详情页
3. 第三轮：看详情/目录页，确认 `bookDetail`、`chapterList.list`/`title`/`url` → 回复 need_page
   要求打开一个章节正文页
4. 第四轮：确认 `chapterContent.content` → 输出完整 `source`

每轮只推进一层，不要跳步。选择器一定要**基于实测 HTML** 写，不要猜类名。

### 18.3 写作要点

- `sourceUrl` 用站点根域名（不带路径）
- 搜索结果选择器写**每个条目**的选择器，不要写整个列表
- 正文用 XPath 选择器；接口 JSON 用 `@js:` 拼段落
- 相对链接不用手动拼域名，`@href` 会自动补全
- 不确定的语法点用最保守的写法（纯 XPath + `@text()`/`@href`）
- 只抓取/分析必要页面，不要逐个试探无关 URL

---

## 十九、Agent 自动化验证要求

本项目的 Agent 应以**真实浏览器证据**生成规则，而不是仅根据常见站点结构猜测：

1. **至少采集并区分**搜索、详情、章节目录和章节正文四类页面。
2. 对 `searchBook.list`/`detailUrl`、`chapterList.list`/`url`、`chapterContent.content` 以及实际输出的详情字段
   **运行离线 XPath 检查**（用真实 HTML 验证选择器是否命中正确内容）。
3. `searchBook.requestInfo` **只能来自目标站点已验证的表单或 URL**。
   外部搜索引擎只能协助发现同源详情页，不能成为书源搜索接口。
4. **Cloudflare Cookie、Turnstile token、API Key、代理凭据和本机路径不得进入书源 JSON**。
5. 站内搜索为空、链接失效、选择器覆盖不足或正文分页未验证时，
   应在生成结果的 `warning` 中明确说明，**不得伪造成功链**。

这些要求约束自动生成流程，不改变前文所述的香色闺阁字段和解析语法。

---

## 二十、常见失败与对策

| 症状 | 对策 |
|---|---|
| 搜索结果为空 | `list` 选择器写成了整个列表；改成每条目的选择器；或列表不在常规位置，回看 HTML |
| 打开书籍失败 | `detailUrl` 取到相对地址未补全；试试 `//a/@href` 是否命中正确元素 |
| 目录为空 | `chapterList.list` 与页面结构不符；部分站目录要 `requestInfo` 额外请求 |
| 正文带标签/乱码 | content 改用 XPath + `||@js:` 清洗；接口 JSON 用 `@js:` 拼段落 |
| 正文缺失段落顺序 | 用 `content()` 保序；`text()` 会丢子标签文本 |
| 站点反爬（验证码/盾） | 在 App 的可见浏览器里手动打开页面完成验证后，再「抓取当前页」 |
| 书源格式不对 | 检查是否误用了 CSS 选择器、`[[key]]`、`ruleSearch` 等非香色闺阁语法 |

## 二十一、动态页面（JS 渲染）处理

部分站点（尤其搜索列表）内容由 JS 动态加载，抓到的原始 HTML 里看不到数据。App 会自动在页面加载完成后执行一次 DOM 提取，并在页面抓取消息中附上三块额外信息：

```
【表单】 <GET /search/> input[name=q]:text, input[name=type]:hidden
【链接样本】 书名 -> http://site/book/123.html
【正文文本】 ...页面可见文字...
```

处理原则：

1. **【表单】优先**：构造搜索 URL 时，先看表单的 action 与 input name。如 `<GET /search/> input[name=q]` → 搜索 URL 写成 `http://site/search/?q=%@keyWord`；若表单为 POST 或 JS 提交，在 need_page.reason 中说明无法直接拼 URL。
2. **【链接样本】是 JS 渲染后的真实链接**：动态加载的搜索列表、分类列表，其条目链接都从这里来，优先于原始 HTML 里的 `<a>`。
3. **【正文文本】用于判断页面语义**：如「搜索无结果」「没有找到」等提示，可用于 validConfig 校验或决定是否需要换搜索方式。
4. **JS 接口型搜索**：若站点搜索走 XHR/JS API，无法从 URL 直接推断时，回复 need_page 要求打开站点搜索页（带样本关键字），或提示用户输入搜索链接；写书源时可用 `@js:` 在 requestInfo 里拼接接口 URL。
5. 抓取失败（反爬/超时）时，App 会打开可见浏览器等待用户手动完成验证后点「抓取当前页」，AI 应耐心等待下一次抓取，不要臆测页面结构。