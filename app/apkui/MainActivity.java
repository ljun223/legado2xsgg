package org.golang.todo.xbs;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.res.Resources;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.PorterDuff;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.text.InputType;
import android.text.SpannableString;
import android.text.SpannableStringBuilder;
import android.text.style.ForegroundColorSpan;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.provider.OpenableColumns;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.ImageView;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 纯 Android 的 XBS 工具：转换（XBS <-> JSON）+ AI 写源。
 *
 * 转换：文件选择器选 .xbs/.json -> 应用内 XXTEA 加解密 -> 预览 -> 保存到
 * Download（MediaStore 29+ / 直写文件 21-28 / SAF 兜底）。
 *
 * AI 写源：一个可见的 WebView 浏览器（用户可直接操作、手动过盾），配合
 * shouldInterceptRequest 自动缓存主文档原始 HTML；「抓取当前页」把 URL+HTML
 * 发给 LLM，LLM 按 skill-xbs.md 协议返回 need_page / source，多轮迭代直至
 * 产出书源 JSON，可预览并保存。
 */
public class MainActivity extends Activity {

    // 转换
    private static final int PICK_FILE = 2;
    private static final int PICK_LEGADO = 4;
    private static final int PICK_SKILL = 3;
    private byte[] convertedData;
    private String convertedName;
    private TextView convertPreview;
    private Button saveConvertBtn;
    private Button clearConvertBtn;
    private LinearLayout convertEmpty;
    private TextView convertInfo;
    private Button copyJsonBtn, toXbsBtn;
    private WebView convWeb;
    private LinearLayout actionRow;
    private LinearLayout resultMoreRow;
    private String convBundle, convCrypto;

    // AI 写源
    private WebView browser;
    private final ArrayList<JSONObject> aiMessages = new ArrayList<JSONObject>();
    private TextView aiLog;
    private TextView aiStatus;
    private EditText keywordInput;
    private Button openSuggestionBtn;
    private boolean aiBusy = false;
    private String capturedHtml = "";
    private String capturedUrl = "";
    private int grabCount = 0;
    private String lastNeedUrl;
    private String lastNeedKeyword;
    private EditText urlInput;
    private boolean autoMode = true;
    private boolean autoRunning = false;
    private boolean manualFallback = false;
    private boolean waitingKeyword = false;
    private TextView autoTab, manualTab;
    private Button autoBtn;
    private LinearLayout autoRow, manualRow1, manualSearchRow;
    private EditText chatInput;
    private LinearLayout chatRow;
    private boolean pendingAutoFetch = false;
    private Runnable autoTimeoutRunnable;
    private String capturedDom = "";
    private LinearLayout logPanel;
    private String skillText = "";
    private String aiBaseUrl = "https://api.deepseek.com";
    private String aiModel = "deepseek-chat";
    private String aiApiKey = "";
    // AI 用途：0=写源（skill-xbs.md） 1=转换书源（skill-convert.md）
    private int aiMode = 0;
    private String aiSkillFile = "skill-xbs.md";
    private double aiTemperature = 0.3;
    private int aiMaxTokens = 8000;
    private static final int GRAB_JS_TIMEOUT = 3000;
    private static final int PICK_AI_SOURCE = 5;
    private TextView footerSkill;

    /** 页面 DOM 提取脚本：表单（探测搜索接口）+ 链接样本 + 正文文本。 */
    private static final String DOM_SCRIPT =
            "javascript:(function(){try{var f=[],ls=[],seen={},n=0;"
                    + "var as=document.querySelectorAll('a');"
                    + "for(var i=0;i<as.length&&n<150;i++){var h=as[i].href;"
                    + "if(h&&h.indexOf('javascript:')<0&&!seen[h]){seen[h]=1;"
                    + "ls.push((as[i].textContent||'').replace(/\\s+/g,' ').trim().slice(0,40)+' -> '+h);n++;}}"
                    + "var fs=document.querySelectorAll('form');"
                    + "for(var j=0;j<fs.length;j++){var fd=[];var ins=fs[j].querySelectorAll('input,select,textarea');"
                    + "for(var k=0;k<ins.length;k++){var e=ins[k];"
                    + "fd.push(e.tagName.toLowerCase()+(e.name?('['+e.name+']'):'')+(e.type?(':'+e.type):''));}"
                    + "f.push('<'+(fs[j].method||'GET').toUpperCase()+' '+fs[j].action+'> '+fd.join(', '));}"
                    + "var t=document.body?(document.body.innerText||''):'';"
                    + "t=t.replace(/\\s+/g,' ').slice(0,30000);"
                    + "return JSON.stringify({forms:f,links:ls,text:t});"
                    + "}catch(e){return JSON.stringify({error:String(e)});}})()";

/** 执行 DOM 提取并缓存为【表单/链接样本/正文文本】文本块，供抓取与全自动使用。
 *  onDone 可空回调：提取完成（或 3 秒看门狗超时）后触发，保证 capturedDom 已更新。 */
private void runDomExtract(final Runnable onDone) {
    final boolean[] done = {false};
    final Runnable finish = new Runnable() {
        @Override
        public void run() {
            if (!done[0]) {
                done[0] = true;
                if (onDone != null) {
                    onDone.run();
                }
            }
        }
    };
    handler.postDelayed(finish, GRAB_JS_TIMEOUT);
    try {
        browser.evaluateJavascript(DOM_SCRIPT, new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                try {
                    String v = value;
                    if (v.startsWith("\"")) {
                        v = new JSONObject("{\"x\":" + v + "}").getString("x");
                    }
                    JSONObject o = new JSONObject(v);
                    StringBuilder sb = new StringBuilder();
                    if (o.has("forms") && o.getJSONArray("forms").length() > 0) {
                        sb.append("【表单】 ").append(o.getJSONArray("forms").join(" | ")).append("\n");
                    }
                    if (o.has("links") && o.getJSONArray("links").length() > 0) {
                        sb.append("【链接样本】\n").append(o.getJSONArray("links").join("\n")).append("\n");
                    }
                    if (o.has("text") && o.getString("text").length() > 0) {
                        sb.append("【正文文本】 ").append(o.getString("text")).append("\n");
                    }
                    capturedDom = sb.toString();
                } catch (Exception ignored) {
                }
                handler.removeCallbacks(finish);
                finish.run();
            }
        });
    } catch (Exception e) {
        handler.removeCallbacks(finish);
        finish.run();
    }
}

    // 文件保存
    private static final int FILE_CHOOSER_REQUEST = 1;
    private static final int REQ_STORAGE = 42;
    private static final int SAVE_REQUEST = 43;
    private byte[] pendingSaveData;
    private String pendingSaveName;
    private final Handler handler = new Handler();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(0xFF4F46E5);

        SharedPreferences prefs = getSharedPreferences("xbs", MODE_PRIVATE);
        aiBaseUrl = prefs.getString("ai_base_url", aiBaseUrl);
        aiModel = prefs.getString("ai_model", aiModel);
        aiApiKey = prefs.getString("ai_api_key", "");
        aiMode = prefs.getInt("ai_mode", 0);
        aiTemperature = prefs.getFloat("ai_temperature", 0.3f);
        aiMaxTokens = prefs.getInt("ai_max_tokens", 8000);
        applyAiMode();
        skillText = loadSkill();

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFFF8FAFC);

        // ---- 顶部应用栏 ----
        LinearLayout topBar = new LinearLayout(this);
        topBar.setOrientation(LinearLayout.HORIZONTAL);
        topBar.setGravity(Gravity.CENTER_VERTICAL);
        topBar.setPadding(dp(12), dp(10), dp(8), dp(10));
        topBar.setBackgroundResource(R.drawable.bg_topbar);

        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        logo.setScaleType(ImageView.ScaleType.FIT_CENTER);
        logo.setLayoutParams(new LinearLayout.LayoutParams(dp(30), dp(30)));
        topBar.addView(logo);

        LinearLayout titleBlock = new LinearLayout(this);
        titleBlock.setOrientation(LinearLayout.VERTICAL);
        titleBlock.setPadding(dp(10), 0, dp(8), 0);
        TextView appTitle = new TextView(this);
        appTitle.setText("XBS 工具");
        appTitle.setTextColor(Color.WHITE);
        appTitle.setTextSize(17);
        appTitle.setTypeface(Typeface.DEFAULT_BOLD);
        TextView appSub = new TextView(this);
        appSub.setText("书源转换 · AI 智能写源");
        appSub.setTextColor(0xFFC7D2FE);
        appSub.setTextSize(10);
        titleBlock.addView(appTitle);
        titleBlock.addView(appSub);
        topBar.addView(titleBlock, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        ImageView gear = new ImageView(this);
        gear.setImageResource(R.drawable.ic_gear);
        gear.setColorFilter(Color.WHITE, PorterDuff.Mode.SRC_IN);
        gear.setPadding(dp(10), dp(10), dp(10), dp(10));
        gear.setClickable(true);
        gear.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showSettingsDialog();
            }
        });
        topBar.addView(gear);
        root.addView(topBar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // ---- 内容区 ----
        FrameLayout content = new FrameLayout(this);
        content.addView(buildConvertPanel());
        content.addView(buildAiPanel());
        root.addView(content, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        // ---- 底部导航 ----
        View navDivider = new View(this);
        navDivider.setBackgroundResource(R.drawable.divider);
        root.addView(navDivider, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));

        LinearLayout bottomNav = new LinearLayout(this);
        bottomNav.setOrientation(LinearLayout.HORIZONTAL);
        bottomNav.setBackgroundColor(Color.WHITE);
        bottomNav.setPadding(0, dp(4), 0, dp(4));

        navConvert = makeNavItem(R.drawable.ic_convert, "转换");
        navAi = makeNavItem(R.drawable.ic_ai, "AI 写源");
        LinearLayout.LayoutParams navItemLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        bottomNav.addView(navConvert, navItemLp);
        bottomNav.addView(navAi, navItemLp);
        root.addView(bottomNav, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        setContentView(root);

        navConvert.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                switchTab(true);
            }
        });
        navAi.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                switchTab(false);
            }
        });
        switchTab(true);
    }

    private void switchTab(boolean convert) {
        convertPanel.setVisibility(convert ? View.VISIBLE : View.GONE);
        aiPanel.setVisibility(convert ? View.GONE : View.VISIBLE);
        applyNavStyle(navConvert, convert);
        applyNavStyle(navAi, !convert);
    }

    private void applyNavStyle(View item, boolean sel) {
        int color = sel ? 0xFF4F46E5 : 0xFF94A3B8;
        ImageView iv = (ImageView) item.findViewWithTag("icon");
        TextView tv = (TextView) item.findViewWithTag("label");
        iv.setColorFilter(color, PorterDuff.Mode.SRC_IN);
        tv.setTextColor(color);
        tv.setTypeface(sel ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
    }

    private LinearLayout makeNavItem(int iconRes, String label) {
        LinearLayout item = new LinearLayout(this);
        item.setOrientation(LinearLayout.VERTICAL);
        item.setGravity(Gravity.CENTER);
        item.setPadding(dp(6), dp(2), dp(6), dp(2));
        item.setClickable(true);
        ImageView iv = new ImageView(this);
        iv.setImageResource(iconRes);
        iv.setColorFilter(0xFF94A3B8, PorterDuff.Mode.SRC_IN);
        iv.setTag("icon");
        LinearLayout.LayoutParams ivLp = new LinearLayout.LayoutParams(dp(22), dp(22));
        ivLp.setMargins(0, 0, 0, dp(1));
        iv.setLayoutParams(ivLp);
        TextView tv = new TextView(this);
        tv.setText(label);
        tv.setTextSize(11);
        tv.setGravity(Gravity.CENTER);
        tv.setTag("label");
        item.addView(iv);
        item.addView(tv);
        return item;
    }

    private ImageView makeIconButton(int iconRes) {
        ImageView iv = new ImageView(this);
        iv.setImageResource(iconRes);
        iv.setColorFilter(0xFF4F46E5, PorterDuff.Mode.SRC_IN);
        iv.setBackgroundResource(R.drawable.bg_icon_btn);
        iv.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        iv.setClickable(true);
        iv.setLayoutParams(new LinearLayout.LayoutParams(dp(34), dp(34)));
        return iv;
    }

    private LinearLayout navConvert;
    private LinearLayout navAi;
    private View convertPanel;
    private View aiPanel;

    private TextView sectionHeader(String text) {
        TextView h = new TextView(this);
        h.setText(text);
        h.setTextColor(0xFF6D28D9);
        h.setTextSize(12);
        h.setTypeface(Typeface.DEFAULT_BOLD);
        h.setPadding(dp(2), dp(4), dp(2), dp(4));
        return h;
    }

    // ---------------- 转换页 ----------------

    private View buildConvertPanel() {
        FrameLayout panel = new FrameLayout(this);

        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setPadding(dp(10), dp(6), dp(10), dp(10));

        column.addView(sectionHeader("书源转换"));

        // 文件信息条：已载入文件 / 转换结果统计
        convertInfo = new TextView(this);
        convertInfo.setTextColor(0xFF475569);
        convertInfo.setTextSize(11);
        convertInfo.setBackgroundResource(R.drawable.panel_bg);
        convertInfo.setPadding(dp(10), dp(7), dp(10), dp(7));
        convertInfo.setVisibility(View.GONE);
        LinearLayout.LayoutParams infoLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        infoLp.setMargins(0, dp(6), 0, 0);
        column.addView(convertInfo, infoLp);

        // 结果动作行：复制 JSON / 转 XBS / 保存
        actionRow = new LinearLayout(this);
        actionRow.setOrientation(LinearLayout.HORIZONTAL);
        actionRow.setVisibility(View.GONE);
        copyJsonBtn = new Button(this);
        copyJsonBtn.setText("复制 JSON");
        styleSecondary(copyJsonBtn);
        copyJsonBtn.setTextSize(12);
        setBtnIcon(copyJsonBtn, R.drawable.ic_send, 0xFF4338CA);
        copyJsonBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (convertedData != null && convertedName != null && convertedName.endsWith(".json")) {
                    try {
                        android.content.ClipboardManager cm = (android.content.ClipboardManager)
                                getSystemService(android.content.Context.CLIPBOARD_SERVICE);
                        cm.setPrimaryClip(android.content.ClipData.newPlainText("xsgg",
                                new String(convertedData, "UTF-8")));
                        toast("JSON 已复制到剪贴板");
                    } catch (Exception e) {
                        toast("复制失败: " + e.getMessage());
                    }
                }
            }
        });
        toXbsBtn = new Button(this);
        toXbsBtn.setText("转 XBS");
        styleSecondary(toXbsBtn);
        toXbsBtn.setTextSize(12);
        setBtnIcon(toXbsBtn, R.drawable.ic_convert, 0xFF4338CA);
        toXbsBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (convertedData != null && convertedName != null && convertedName.endsWith(".json")) {
                    try {
                        byte[] xbs = XbsTools.json2xbs(convertedData);
                        convertedData = xbs;
                        convertedName = baseName(convertedName) + ".xbs";
                        convertInfo.setText("✓ " + convertedName + "（" + xbs.length + " 字节）→ 已加密为 XBS");
                        showResultRow(false);
                        convertPreview.setText("已生成 XBS 二进制（" + xbs.length + " 字节）\n可直接保存后导入香色闺阁");
                        toast("已转 XBS（" + xbs.length + " 字节）");
                    } catch (Exception e) {
                        toast("转 XBS 失败: " + e.getMessage());
                    }
                }
            }
        });
        saveConvertBtn = new Button(this);
        saveConvertBtn.setText("保存");
        stylePrimary(saveConvertBtn);
        saveConvertBtn.setTextSize(12);
        setBtnIcon(saveConvertBtn, R.drawable.ic_download, Color.WHITE);
        saveConvertBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (convertedData != null) {
                    saveBytesToDownloadAsync(convertedData, convertedName);
                }
            }
        });
        LinearLayout.LayoutParams btnLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        LinearLayout.LayoutParams btnLpMid = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        btnLpMid.setMargins(dp(6), 0, 0, 0);
        actionRow.addView(copyJsonBtn, btnLp);
        actionRow.addView(toXbsBtn, btnLpMid);
        LinearLayout.LayoutParams btnLpSave = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        btnLpSave.setMargins(dp(6), 0, 0, 0);
        actionRow.addView(saveConvertBtn, btnLpSave);
        LinearLayout.LayoutParams actionLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        actionLp.setMargins(0, dp(6), 0, 0);
        column.addView(actionRow, actionLp);

        // 结果态二次入口：重新导入 / 打开文件
        resultMoreRow = new LinearLayout(this);
        resultMoreRow.setOrientation(LinearLayout.HORIZONTAL);
        resultMoreRow.setVisibility(View.GONE);
        TextView moreLegado = new TextView(this);
        moreLegado.setText("↺ 重新导入开源阅读书源");
        moreLegado.setTextColor(0xFF6366F1);
        moreLegado.setTextSize(11);
        moreLegado.setClickable(true);
        moreLegado.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openDocumentPicker(PICK_LEGADO);
            }
        });
        TextView moreFile = new TextView(this);
        moreFile.setText("打开 XBS / JSON 文件");
        moreFile.setTextColor(0xFF6366F1);
        moreFile.setTextSize(11);
        moreFile.setClickable(true);
        moreFile.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openDocumentPicker(PICK_FILE);
            }
        });
        LinearLayout.LayoutParams moreLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        moreLp.setMargins(0, dp(2), 0, 0);
        resultMoreRow.addView(moreLegado, moreLp);
        resultMoreRow.addView(moreFile, moreLp);
        column.addView(resultMoreRow);

        // 清空按钮：独立一行，大号红色描边，结果态可见
        clearConvertBtn = new Button(this);
        clearConvertBtn.setText("清空转换结果");
        clearConvertBtn.setTextColor(0xFFDC2626);
        clearConvertBtn.setTextSize(14);
        clearConvertBtn.setAllCaps(false);
        clearConvertBtn.setBackgroundResource(R.drawable.btn_danger);
        clearConvertBtn.setVisibility(View.GONE);
        clearConvertBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                resetConvertUi();
            }
        });
        LinearLayout.LayoutParams clearLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(46));
        clearLp.setMargins(0, dp(6), 0, 0);
        column.addView(clearConvertBtn, clearLp);

        // 预览容器：滚动预览 + 工作台卡
        FrameLayout previewBox = new FrameLayout(this);
        convertPreview = new TextView(this);
        convertPreview.setText("");
        convertPreview.setTextColor(Color.DKGRAY);
        convertPreview.setTextSize(12);
        convertPreview.setTypeface(Typeface.MONOSPACE);
        convertPreview.setPadding(dp(10), dp(8), dp(10), dp(8));
        ScrollView sv = new ScrollView(this);
        sv.setBackgroundResource(R.drawable.panel_bg);
        sv.addView(convertPreview, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        previewBox.addView(sv, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // 工作台卡：主流程（导入开源阅读书源）+ 辅助（XBS/JSON 加解密）
        convertEmpty = new LinearLayout(this);
        convertEmpty.setOrientation(LinearLayout.VERTICAL);
        convertEmpty.setGravity(Gravity.CENTER_HORIZONTAL);
        convertEmpty.setPadding(dp(20), dp(12), dp(20), dp(12));
        ImageView emptyIcon = new ImageView(this);
        emptyIcon.setImageResource(R.drawable.ic_folder);
        emptyIcon.setColorFilter(0xFFA5B4FC, PorterDuff.Mode.SRC_IN);
        emptyIcon.setLayoutParams(new LinearLayout.LayoutParams(dp(48), dp(48)));
        convertEmpty.addView(emptyIcon);
        TextView emptyTitle = new TextView(this);
        emptyTitle.setText("书源转换工作台");
        emptyTitle.setTextColor(0xFF1E293B);
        emptyTitle.setTextSize(15);
        emptyTitle.setTypeface(Typeface.DEFAULT_BOLD);
        emptyTitle.setGravity(Gravity.CENTER);
        emptyTitle.setPadding(0, dp(8), 0, 0);
        convertEmpty.addView(emptyTitle);
        TextView emptySub = new TextView(this);
        emptySub.setText("开源阅读书源 → 香色闺阁书源 · XBS 加解密");
        emptySub.setTextColor(0xFF94A3B8);
        emptySub.setTextSize(11);
        emptySub.setGravity(Gravity.CENTER);
        emptySub.setPadding(0, dp(3), 0, dp(14));
        convertEmpty.addView(emptySub);

        Button legadoBtn = new Button(this);
        legadoBtn.setText("导入开源阅读书源");
        stylePrimary(legadoBtn);
        legadoBtn.setTextSize(14);
        setBtnIcon(legadoBtn, R.drawable.ic_convert, Color.WHITE);
        legadoBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openDocumentPicker(PICK_LEGADO);
            }
        });
        convertEmpty.addView(legadoBtn, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(46)));

        Button pickBtn = new Button(this);
        pickBtn.setText("打开 XBS / JSON 文件");
        styleSecondary(pickBtn);
        pickBtn.setTextSize(13);
        setBtnIcon(pickBtn, R.drawable.ic_folder, 0xFF4338CA);
        LinearLayout.LayoutParams pickLp2 = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(42));
        pickLp2.setMargins(0, dp(6), 0, 0);
        pickBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                openDocumentPicker(PICK_FILE);
            }
        });
        convertEmpty.addView(pickBtn, pickLp2);

        TextView tip = new TextView(this);
        tip.setText("自动识别格式：开源阅读书源直接转换为香色闺阁书源\n可一键转 XBS（加密）保存导入；也可打开 XBS/JSON 互转修改。");
        tip.setTextColor(0xFF94A3B8);
        tip.setTextSize(11);
        tip.setGravity(Gravity.CENTER);
        tip.setPadding(0, dp(12), 0, dp(6));
        convertEmpty.addView(tip);

        View sep = new View(this);
        sep.setBackgroundResource(R.drawable.divider);
        LinearLayout.LayoutParams sepLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(1));
        sepLp.setMargins(0, dp(12), 0, dp(6));
        convertEmpty.addView(sep, sepLp);

        TextView aiHint = new TextView(this);
        aiHint.setText("不会写书源？→ 去 AI 写源页全自动生成");
        aiHint.setTextColor(0xFF6366F1);
        aiHint.setTextSize(11);
        aiHint.setGravity(Gravity.CENTER);
        aiHint.setClickable(true);
        aiHint.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                switchTab(false);
            }
        });
        convertEmpty.addView(aiHint);
        previewBox.addView(convertEmpty, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER));

        column.addView(previewBox, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        panel.addView(column, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        initConverterWeb();
        if (convWeb != null) {
            convWeb.setVisibility(View.GONE);
            panel.addView(convWeb, new FrameLayout.LayoutParams(1, 1));
        }

        convertPanel = panel;
        return panel;
    }

    private void openDocumentPicker(int requestCode) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        try {
            startActivityForResult(i, requestCode);
        } catch (Exception e) {
            toast("无法打开文件选择器: " + e.getMessage());
        }
    }

    /** 结果显示辅助：切换信息条 / 动作行 / 二次入口的可见性与可用性。 */
    private void showResultRow(boolean isJson) {
        convertInfo.setVisibility(View.VISIBLE);
        actionRow.setVisibility(View.VISIBLE);
        resultMoreRow.setVisibility(View.VISIBLE);
        clearConvertBtn.setVisibility(View.VISIBLE);
        copyJsonBtn.setEnabled(isJson);
        toXbsBtn.setEnabled(isJson);
        saveConvertBtn.setEnabled(true);
    }

    /** 隐藏 WebView 专职执行开源阅读书源转换。
     *  不再依赖页面加载：每次转换将 bundle/crypto/输入整体内联为 JS 代码求值，
     *  在任何已加载页面（about:blank）上 evaluateJavascript 均可执行。 */
    private void initConverterWeb() {
        try {
            convWeb = new WebView(this);
            convWeb.getSettings().setJavaScriptEnabled(true);
            convBundle = readAsset("converter.bundle.js");
            convCrypto = readAsset("crypto-js.min.js");
            convWeb.loadUrl("about:blank");
            convWeb.setVisibility(View.GONE);
        } catch (Exception e) {
            convWeb = null;
            toast("转换引擎初始化失败: " + e.getMessage());
        }
    }

    private String readAsset(String name) throws Exception {
        InputStream in = getAssets().open(name);
        return new String(readAllLimited(in, 8 * 1024 * 1024), "UTF-8");
    }

    /** 构造一次性转换 JS：内联 crypto/bundle/输入。
     *  window.ConverterLib 已加载时直接复用；否则首选 <script> 元素注入执行 bundle
     *  （页面加载语义，window.ConverterLib 必然定义），eval 兜底；失败返回诊断信息。 */
    private String buildConvertJs(String text) {
        return "(function(){"
                + "var __c=" + new JSONArray().put(convCrypto).toString() + ";"
                + "var __b=" + new JSONArray().put(convBundle).toString() + ";"
                + "var __i=" + new JSONArray().put(text).toString() + ";"
                + "var __lib=window.ConverterLib,__scriptErr='',__evalErr='';"
                + "if(!__lib||typeof __lib.convert!=='function'){"
                + "__lib=null;"
                + "try{"
                + "var __s=document.createElement('script');"
                + "__s.text=__b;"
                + "document.head.appendChild(__s);"
                + "__lib=window.ConverterLib;"
                + "}catch(e1){__scriptErr=String(e1);__lib=null;}"
                + "if(!__lib||typeof __lib.convert!=='function'){"
                + "try{__lib=eval(__b);}catch(e0){__evalErr=String(e0);__lib=null;}"
                + "if(!__lib||typeof __lib.convert!=='function'){__lib=window.ConverterLib;}"
                + "}"
                + "}"
                + "if(!__lib||typeof __lib.convert!=='function'){"
                + "return JSON.stringify({error:'转换引擎加载失败',diag:{"
                + "scriptErr:__scriptErr,"
                + "evalErr:__evalErr,"
                + "winLib:(typeof window.ConverterLib),"
                + "winKeys:Object.keys(window).slice(0,40).join(',')"
                + "}});"
                + "}"
                + "try{"
                + "var __r=__lib.convert(JSON.parse(__i),{cryptoJsSource:__c||null});"
                + "return JSON.stringify(__r);"
                + "}catch(e){return JSON.stringify({error:String(e),stack:(e.stack||'').slice(0,300)});}"
                + "})()";
    }

    /** 导入开源阅读书源 JSON：一次性 JS 求值执行转换。 */
    private void importLegado(final String text) {
        if (convWeb == null) {
            toast("转换引擎不可用");
            return;
        }
        convertInfo.setVisibility(View.VISIBLE);
        convertInfo.setText("⏳ 正在转换开源阅读书源…");
        appendConvertResult("");
        try {
            convWeb.evaluateJavascript(buildConvertJs(text), new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String value) {
                    handleLegadoResult(value);
                }
            });
        } catch (Exception e) {
            convertInfo.setText("转换执行失败: " + e.getMessage());
        }
    }

    private void handleLegadoResult(String value) {
        try {
            if (value == null || value.trim().isEmpty() || "null".equals(value.trim())) {
                convertInfo.setText("转换执行失败：脚本无返回");
                return;
            }
            String v = value;
            if (v.startsWith("\"")) {
                v = new JSONObject("{\"x\":" + v + "}").getString("x");
            }
            JSONObject r = new JSONObject(v);
            if (r.has("error")) {
                String st = r.optString("stack", "");
                convertInfo.setText("转换引擎错误: " + r.optString("error")
                        + (st.isEmpty() ? "" : "\n" + st));
                return;
            }
            JSONObject output = r.optJSONObject("output");
            if (output == null) {
                convertInfo.setText("转换失败：无法识别的书源格式");
                if (r.optJSONArray("warnings") != null) {
                    SpannableStringBuilder sb = new SpannableStringBuilder("转换提示：\n");
                    sb.append(formatWarnings(r.optJSONArray("warnings")));
                    appendConvertResult(sb);
                } else {
                    appendConvertResult("");
                }
                return;
            }
            String pretty = output.toString(2);
            convertedData = pretty.getBytes("UTF-8");
            String outerKey = "";
            if (output.length() > 0) {
                outerKey = output.keys().next();
            }
            convertedName = sanitizeFilename(
                    outerKey.isEmpty() ? "booksource" : outerKey) + ".json";
            if (convertEmpty != null) {
                convertEmpty.setVisibility(View.GONE);
            }
            StringBuilder info = new StringBuilder("✓ 开源阅读书源已导入 → ").append(convertedName);
            JSONArray warns = r.optJSONArray("warnings");
            if (warns != null && warns.length() > 0) {
                info.append("（").append(warns.length()).append(" 条提示）");
            }
            convertInfo.setText(info.toString());
            SpannableStringBuilder preview = new SpannableStringBuilder();
            CharSequence wtext = formatWarnings(warns);
            if (wtext.length() > 0) {
                preview.append("【转换提示】\n").append(wtext).append("\n\n");
            }
            preview.append(pretty);
            appendConvertResult(preview);
            showResultRow(true);
        } catch (Exception e) {
            convertInfo.setText("转换解析失败: " + e.getMessage());
        }
    }

    private void appendConvertResult(CharSequence text) {
        convertPreview.setText(text);
    }

    /** 转换提示格式化：需人工处理/error/unsupported 的行标红。 */
    private static CharSequence formatWarnings(JSONArray warns) {
        SpannableStringBuilder sb = new SpannableStringBuilder();
        if (warns == null) {
            return sb;
        }
        final int red = Color.rgb(211, 47, 47);
        for (int i = 0; i < warns.length(); i++) {
            JSONObject w = warns.optJSONObject(i);
            if (w == null) {
                continue;
            }
            String lvl = w.optString("level", "");
            String mod = w.optString("module", "");
            String msg = w.optString("msg", "");
            String line = "[" + lvl + "]"
                    + (mod.isEmpty() ? "" : "[" + mod + "] ")
                    + msg + "\n";
            int start = sb.length();
            sb.append(line);
            if (isManualWarning(w)) {
                sb.setSpan(new ForegroundColorSpan(red), start, sb.length(),
                        SpannableString.SPAN_EXCLUSIVE_EXCLUSIVE);
            }
        }
        if (sb.length() > 0) {
            sb.delete(sb.length() - 1, sb.length());
        }
        return sb;
    }

    /** 需人工修改的提示：error/unsupported 级别，或含人工处理相关关键词。 */
    private static boolean isManualWarning(JSONObject w) {
        String lvl = w.optString("level", "");
        if ("error".equals(lvl) || "unsupported".equals(lvl)) {
            return true;
        }
        String msg = w.optString("msg", "");
        return msg.contains("需人工") || msg.contains("人工处理") || msg.contains("人工核对")
                || msg.contains("人工确认") || msg.contains("人工修正") || msg.contains("人工补充")
                || msg.contains("无法翻译") || msg.contains("已保留原样") || msg.contains("不支持")
                || msg.contains("缺失") || msg.contains("需人工处理");
    }

    private void doConvert(byte[] bytes, String name) {
        try {
            try {
                String json = XbsTools.xbs2json(bytes);
                String pretty = new JSONObject(json).toString(2);
                convertedData = pretty.getBytes("UTF-8");
                convertedName = sourceName(pretty, name) + ".json";
                convertPreview.setText(pretty);
                if (convertEmpty != null) {
                    convertEmpty.setVisibility(View.GONE);
                }
                convertInfo.setText("✓ " + name + "（" + bytes.length + " 字节）→ XBS 解码为 JSON");
                showResultRow(true);
                return;
            } catch (Exception e1) {
            }
            try {
                String text = new String(bytes, "UTF-8").trim();
                char c0 = text.length() > 0 ? text.charAt(0) : 0;
                if (c0 == '{') {
                    new JSONObject(text);
                } else if (c0 == '[') {
                    new JSONArray(text);
                } else {
                    throw new Exception("不是 JSON 文本");
                }
                byte[] xbs = XbsTools.json2xbs(text.getBytes("UTF-8"));
                convertedData = xbs;
                convertedName = baseName(name) + ".xbs";
                convertPreview.setText("已生成 XBS 二进制（" + xbs.length + " 字节）\n原内容: "
                        + text.substring(0, Math.min(200, text.length())) + (text.length() > 200 ? "…" : ""));
                if (convertEmpty != null) {
                    convertEmpty.setVisibility(View.GONE);
                }
                convertInfo.setText("✓ " + name + "（" + bytes.length + " 字节）→ JSON 加密为 XBS");
                showResultRow(false);
                return;
            } catch (Exception e2) {
            }
            convertPreview.setText("无法识别文件格式（既不是 XBS 加密文件，也不是 JSON 文本）");
        } catch (Exception e) {
            convertPreview.setText("转换失败: " + e.getMessage());
        }
    }

    /** 清空转换结果，回到工作台初始界面。 */
    private void resetConvertUi() {
        convertedData = null;
        convertedName = null;
        convertPreview.setText("");
        convertInfo.setVisibility(View.GONE);
        actionRow.setVisibility(View.GONE);
        resultMoreRow.setVisibility(View.GONE);
        clearConvertBtn.setVisibility(View.GONE);
        copyJsonBtn.setEnabled(false);
        toXbsBtn.setEnabled(false);
        saveConvertBtn.setEnabled(false);
        if (convertEmpty != null) {
            convertEmpty.setVisibility(View.VISIBLE);
        }
    }

    private static String sourceName(String json, String fallback) {
        try {
            String n = new JSONObject(json).optString("bookSourceName", "");
            if (!n.isEmpty()) {
                return sanitizeFilename(n);
            }
        } catch (Exception ignored) {
        }
        return baseName(fallback);
    }

    private static String baseName(String name) {
        if (name == null) {
            return "booksource";
        }
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name;
        base = sanitizeFilename(base);
        return base.isEmpty() ? "booksource" : base;
    }

    // ---------------- AI 写源页 ----------------

    private View buildAiPanel() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);

        LinearLayout urlBar = new LinearLayout(this);
        urlBar.setOrientation(LinearLayout.HORIZONTAL);
        urlBar.setGravity(Gravity.CENTER_VERTICAL);
        urlBar.setBackgroundResource(R.drawable.bg_searchbar);
        urlBar.setPadding(dp(4), dp(4), dp(4), dp(4));
        urlBar.setElevation(dp(2));
        urlInput = new EditText(this);
        urlInput.setHint("输入网址，如 http://www.gdbzkz.la/");
        urlInput.setTextSize(13);
        urlInput.setSingleLine(true);
        urlInput.setBackgroundResource(0);
        urlInput.setPadding(dp(12), dp(8), dp(8), dp(8));
        urlBar.addView(urlInput, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        Button goBtn = new Button(this);
        goBtn.setText("前往");
        goBtn.setBackgroundColor(0x00000000);
        goBtn.setTextColor(0xFF4F46E5);
        goBtn.setAllCaps(false);
        goBtn.setTextSize(13);
        goBtn.setPadding(dp(12), dp(8), dp(12), dp(8));
        setBtnIcon(goBtn, R.drawable.ic_globe, 0xFF4F46E5);
        goBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String u = urlInput.getText().toString().trim();
                if (u.isEmpty()) {
                    toast("请输入网址");
                    return;
                }
                if (!u.startsWith("http://") && !u.startsWith("https://")) {
                    u = "http://" + u;
                }
                browser.loadUrl(u);
            }
        });
        urlBar.addView(goBtn);
        panel.addView(urlBar);

        // 写源模式：全自动（默认）/ 手动
        LinearLayout modeSeg = new LinearLayout(this);
        modeSeg.setOrientation(LinearLayout.HORIZONTAL);
        modeSeg.setBackgroundResource(R.drawable.bg_segment_group);
        modeSeg.setPadding(dp(3), dp(3), dp(3), dp(3));
        autoTab = new TextView(this);
        autoTab.setText("全自动");
        autoTab.setTextSize(12);
        autoTab.setGravity(Gravity.CENTER);
        autoTab.setPadding(dp(6), dp(4), dp(6), dp(4));
        autoTab.setClickable(true);
        autoTab.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                autoMode = true;
                applyAutoModeTabs();
                updateModeUi();
            }
        });
        manualTab = new TextView(this);
        manualTab.setText("手动");
        manualTab.setTextSize(12);
        manualTab.setGravity(Gravity.CENTER);
        manualTab.setPadding(dp(6), dp(4), dp(6), dp(4));
        manualTab.setClickable(true);
        manualTab.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                autoMode = false;
                autoRunning = false;
                autoBtn.setText("开始全自动写源");
                applyAutoModeTabs();
                updateModeUi();
            }
        });
        modeSeg.addView(autoTab, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        modeSeg.addView(manualTab, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        LinearLayout.LayoutParams modeSegLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        modeSegLp.setMargins(dp(8), dp(6), dp(8), dp(4));
        panel.addView(modeSeg, modeSegLp);

        browser = new WebView(this);
        WebSettings bs = browser.getSettings();
        bs.setJavaScriptEnabled(true);
        bs.setDomStorageEnabled(true);
        bs.setLoadWithOverviewMode(true);
        bs.setUseWideViewPort(true);
        bs.setSupportZoom(true);
        bs.setBuiltInZoomControls(true);
        bs.setDisplayZoomControls(false);
        browser.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return captureMainDocument(request);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (pendingAutoFetch) {
                    pendingAutoFetch = false;
                    if (autoTimeoutRunnable != null) {
                        handler.removeCallbacks(autoTimeoutRunnable);
                    }
                    // 等 DOM 提取完成再分发，避免把上一页的 capturedDom 发给 AI
                    runDomExtract(new Runnable() {
                        @Override
                        public void run() {
                            dispatchAutoFetch(url);
                        }
                    });
                } else {
                    runDomExtract(null);
                }
            }
        });
        browser.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                Intent intent = params.createIntent();
                try {
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    filePathCallback.onReceiveValue(null);
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });
        panel.addView(browser, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        showStartPage();

        View divider = new View(this);
        divider.setBackgroundResource(R.drawable.divider);
        panel.addView(divider, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));

        // ---- 操作/日志面板 ----
        logPanel = new LinearLayout(this);
        logPanel.setOrientation(LinearLayout.VERTICAL);
        logPanel.setPadding(dp(10), dp(8), dp(10), dp(8));
        logPanel.setBackgroundResource(R.drawable.panel_bg);
        LinearLayout.LayoutParams logLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(240));
        logLp.setMargins(dp(8), dp(8), dp(8), dp(8));
        logPanel.setElevation(dp(4));

        // 头部：标题 + 小图标按钮（设置 / 清空）
        LinearLayout headerRow = new LinearLayout(this);
        headerRow.setOrientation(LinearLayout.HORIZONTAL);
        headerRow.setGravity(Gravity.CENTER_VERTICAL);
        headerRow.addView(sectionHeader("AI 写源对话"), new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        ImageView settingsIb = makeIconButton(R.drawable.ic_gear);
        settingsIb.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showSettingsDialog();
            }
        });
        ImageView clearIb = makeIconButton(R.drawable.ic_trash);
        clearIb.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                aiMessages.clear();
                aiLog.setText("");
                lastNeedUrl = null;
                lastNeedKeyword = null;
                openSuggestionBtn.setEnabled(false);
                grabCount = 0;
                setStatus("对话已清空");
            }
        });
        LinearLayout.LayoutParams iconLp = new LinearLayout.LayoutParams(dp(34), dp(34));
        iconLp.setMargins(0, 0, dp(4), 0);
        headerRow.addView(settingsIb, iconLp);
        LinearLayout.LayoutParams iconLp2 = new LinearLayout.LayoutParams(dp(34), dp(34));
        headerRow.addView(clearIb, iconLp2);
        logPanel.addView(headerRow);

        // 全自动操作行（默认模式）
        autoRow = new LinearLayout(this);
        autoRow.setOrientation(LinearLayout.HORIZONTAL);
        autoRow.setGravity(Gravity.CENTER_VERTICAL);
        autoBtn = new Button(this);
        autoBtn.setText("开始全自动写源");
        stylePrimary(autoBtn);
        setBtnIcon(autoBtn, R.drawable.ic_ai, Color.WHITE);
        autoBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                toggleAuto();
            }
        });
        autoRow.addView(autoBtn, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        LinearLayout.LayoutParams autoRowLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        autoRowLp.setMargins(0, dp(6), 0, 0);
        logPanel.addView(autoRow, autoRowLp);

        // AI 对话行：与 AI 自由交流（全自动模式常驻）
        chatRow = new LinearLayout(this);
        chatRow.setOrientation(LinearLayout.HORIZONTAL);
        chatRow.setGravity(Gravity.CENTER_VERTICAL);
        chatRow.setBackgroundResource(R.drawable.bg_searchbar);
        chatRow.setPadding(dp(4), dp(4), dp(4), dp(4));
        chatInput = new EditText(this);
        chatInput.setHint("与 AI 对话（如:跳过这页 / 直接生成书源）");
        chatInput.setTextSize(13);
        chatInput.setSingleLine(true);
        chatInput.setBackgroundResource(0);
        chatInput.setPadding(dp(10), dp(8), dp(6), dp(8));
        chatInput.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_SEND);
        chatInput.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, android.view.KeyEvent event) {
                if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_SEND) {
                    sendChatMessage();
                    return true;
                }
                return false;
            }
        });
        chatRow.addView(chatInput, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        Button uploadBtn = new Button(this);
        uploadBtn.setText("上传书源");
        uploadBtn.setBackgroundColor(0x00000000);
        uploadBtn.setTextColor(0xFF4F46E5);
        uploadBtn.setAllCaps(false);
        uploadBtn.setTextSize(13);
        uploadBtn.setPadding(dp(10), dp(8), dp(10), dp(8));
        setBtnIcon(uploadBtn, R.drawable.ic_upload, 0xFF4F46E5);
        uploadBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (aiBusy) {
                    toast("AI 正在回复中，请稍候");
                    return;
                }
                openDocumentPicker(PICK_AI_SOURCE);
            }
        });
        chatRow.addView(uploadBtn);
        Button chatBtn = new Button(this);
        chatBtn.setText("发送");
        chatBtn.setBackgroundColor(0x00000000);
        chatBtn.setTextColor(0xFF4F46E5);
        chatBtn.setAllCaps(false);
        chatBtn.setTextSize(13);
        chatBtn.setPadding(dp(12), dp(8), dp(12), dp(8));
        setBtnIcon(chatBtn, R.drawable.ic_send, 0xFF4F46E5);
        chatBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                sendChatMessage();
            }
        });
        chatRow.addView(chatBtn);
        LinearLayout.LayoutParams chatRowLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        chatRowLp.setMargins(0, dp(6), 0, 0);
        logPanel.addView(chatRow, chatRowLp);

        manualRow1 = new LinearLayout(this);
        manualRow1.setOrientation(LinearLayout.HORIZONTAL);
        manualRow1.setGravity(Gravity.CENTER_VERTICAL);
        Button grabBtn = new Button(this);
        grabBtn.setText("抓取当前页");
        stylePrimary(grabBtn);
        setBtnIcon(grabBtn, R.drawable.ic_capture, Color.WHITE);
        grabBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                grabCurrentPage();
            }
        });
        LinearLayout.LayoutParams grabLp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1.4f);
        grabLp.setMargins(0, 0, dp(6), 0);
        manualRow1.addView(grabBtn, grabLp);
        openSuggestionBtn = new Button(this);
        openSuggestionBtn.setText("AI建议页 ▸");
        openSuggestionBtn.setEnabled(false);
        styleSecondary(openSuggestionBtn);
        setBtnIcon(openSuggestionBtn, R.drawable.ic_send, 0xFF4338CA);
        openSuggestionBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (lastNeedUrl != null) {
                    appendLog("▶ 已打开 AI 建议页面: " + lastNeedUrl);
                    browser.loadUrl(lastNeedUrl);
                }
            }
        });
        manualRow1.addView(openSuggestionBtn, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        LinearLayout.LayoutParams row1Lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        row1Lp.setMargins(0, dp(6), 0, 0);
        logPanel.addView(manualRow1, row1Lp);

        // 搜索区：输入框与搜索按钮合并为一体化搜索栏，占满一行
        manualSearchRow = new LinearLayout(this);
        manualSearchRow.setOrientation(LinearLayout.HORIZONTAL);
        manualSearchRow.setGravity(Gravity.CENTER_VERTICAL);
        manualSearchRow.setBackgroundResource(R.drawable.bg_searchbar);
        manualSearchRow.setPadding(dp(4), dp(4), dp(4), dp(4));
        manualSearchRow.setElevation(dp(2));
        keywordInput = new EditText(this);
        keywordInput.setHint("书关键字（如:斗破苍穹）");
        keywordInput.setTextSize(14);
        keywordInput.setSingleLine(true);
        keywordInput.setBackgroundResource(0);
        keywordInput.setPadding(dp(12), dp(10), dp(8), dp(10));
        manualSearchRow.addView(keywordInput, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        Button searchBtn = new Button(this);
        searchBtn.setText("搜索");
        searchBtn.setBackgroundColor(0x00000000);
        searchBtn.setTextColor(0xFF4F46E5);
        searchBtn.setAllCaps(false);
        searchBtn.setTextSize(13);
        searchBtn.setPadding(dp(12), dp(8), dp(12), dp(8));
        setBtnIcon(searchBtn, R.drawable.ic_search, 0xFF4F46E5);
        searchBtn.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                doKeywordSearch();
            }
        });
        manualSearchRow.addView(searchBtn);
        LinearLayout.LayoutParams searchRowLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        searchRowLp.setMargins(0, dp(4), 0, 0);
        logPanel.addView(manualSearchRow, searchRowLp);

        aiLog = new TextView(this);
        aiLog.setTextColor(0xFF111827);
        aiLog.setTextSize(12);
        aiLog.setTypeface(Typeface.MONOSPACE);
        aiLog.setPadding(dp(4), dp(2), dp(4), dp(2));
        aiLog.setText("欢迎使用 AI 写源：\n1. 输入起始网址 → 点「开始全自动写源」\n2. 需书关键字时，在搜索框输入后重新开始\n3. 抓不到时按提示手动打开该页即可继续\n4. AI 产出书源后预览并保存");
        ScrollView logSv = new ScrollView(this);
        logSv.addView(aiLog, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        logPanel.addView(logSv, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        panel.addView(logPanel, logLp);

        applyAutoModeTabs();
        updateModeUi();

        LinearLayout footer = new LinearLayout(this);
        footer.setOrientation(LinearLayout.VERTICAL);
        footer.setPadding(dp(8), dp(2), dp(8), dp(4));
        TextView footerSkill = new TextView(this);
        footerSkill.setText(skillInfoText() + " · 书源转换与 AI 写源工具");
        footerSkill.setTextColor(0xFF9CA3AF);
        footerSkill.setTextSize(9);
        footerSkill.setGravity(Gravity.CENTER);
        this.footerSkill = footerSkill;
        aiStatus = new TextView(this);
        aiStatus.setText("全自动：输入起始网址后点「开始全自动写源」；抓不到时手动抓取该页即可自动继续。");
        aiStatus.setTextColor(0xFF94A3B8);
        aiStatus.setTextSize(9);
        aiStatus.setGravity(Gravity.CENTER);
        aiStatus.setPadding(0, dp(2), 0, 0);
        footer.addView(footerSkill);
        footer.addView(aiStatus);
        panel.addView(footer, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        aiPanel = panel;
        return panel;
    }

    private void showStartPage() {
        String html = "<html><head><meta charset='utf-8'/>"
                + "<meta name='viewport' content='width=device-width, initial-scale=1.0'/></head>"
                + "<body style='margin:0;background:#F8FAFC;font-family:sans-serif;padding:56px 24px;text-align:center;color:#64748B'>"
                + "<div style='font-size:44px;line-height:1.2'>📖</div>"
                + "<div style='font-size:20px;color:#4F46E5;font-weight:600;margin-top:14px'>XBS 书源浏览器</div>"
                + "<div style='font-size:14px;margin-top:12px;line-height:1.8'>输入网址前往站点，或点「抓取当前页」<br/>把首页发给 AI，逐步生成香色闺阁书源</div>"
                + "</body></html>";
        browser.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
    }

    /** 缓存主文档原始 HTML（任何版本 WebView 都能可靠拿到页面源码）。 */
    private WebResourceResponse captureMainDocument(WebResourceRequest request) {
        try {
            if (!request.isForMainFrame()) {
                return null;
            }
            if (!"GET".equalsIgnoreCase(request.getMethod())) {
                return null;
            }
            String url = request.getUrl().toString();
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                return null;
            }
            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(20000);
            conn.setInstanceFollowRedirects(true);
            // 转发 WebView 原始请求头（Referer/Accept 等），并带上 CookieJar 中的 Cookie，
            // 保证拦截抓取的 HTML 与浏览器实际渲染一致（登录墙/反爬站点必需）
            Map<String, String> reqHeaders = request.getRequestHeaders();
            if (reqHeaders != null) {
                for (Map.Entry<String, String> en : reqHeaders.entrySet()) {
                    conn.setRequestProperty(en.getKey(), en.getValue());
                }
            }
            try {
                String cookie = android.webkit.CookieManager.getInstance().getCookie(url);
                if (cookie != null && !cookie.isEmpty()) {
                    conn.setRequestProperty("Cookie", cookie);
                }
            } catch (Throwable ignored) {
            }
            conn.setRequestProperty("User-Agent", browser.getSettings().getUserAgentString());
            int code = conn.getResponseCode();
            String mime = conn.getContentType();
            byte[] body = readAllLimited(conn.getInputStream(), 4 * 1024 * 1024);
            // 同步 Set-Cookie 回 CookieManager，保持与 WebView 会话一致
            try {
                java.util.List<String> setCookies = conn.getHeaderFields().get("Set-Cookie");
                if (setCookies != null) {
                    for (String sc : setCookies) {
                        android.webkit.CookieManager.getInstance().setCookie(url, sc);
                    }
                }
            } catch (Throwable ignored) {
            }
            String enc = mime != null ? extractCharset(mime) : "UTF-8";
            if (mime != null && mime.toLowerCase().contains("html")) {
                String charset = enc;
                String finalUrl = conn.getURL().toString();
                final String html = new String(body, charset);
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        capturedHtml = html;
                        capturedUrl = finalUrl;
                    }
                });
            }
            Map<String, String> headers = new HashMap<String, String>();
            headers.put("Cache-Control", "no-cache");
            return new WebResourceResponse(
                    mime != null ? mime : "text/html",
                    enc, code, code == 200 ? "OK" : "Error", headers,
                    new ByteArrayInputStream(body));
        } catch (Exception e) {
            return null;
        }
    }

    private static byte[] readAllLimited(InputStream in, int limit) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int n;
        int total = 0;
        while ((n = in.read(chunk)) > 0) {
            if (total + n > limit) {
                buf.write(chunk, 0, limit - total);
                total = limit;
                break;
            }
            buf.write(chunk, 0, n);
            total += n;
        }
        in.close();
        return buf.toByteArray();
    }

    private static String extractCharset(String contentType) {
        int i = contentType.toLowerCase().indexOf("charset=");
        if (i >= 0) {
            String cs = contentType.substring(i + 8).trim();
            int q = cs.indexOf(';');
            if (q >= 0) {
                cs = cs.substring(0, q);
            }
            cs = cs.replace("\"", "").trim();
            if (!cs.isEmpty()) {
                return cs;
            }
        }
        return "UTF-8";
    }

    /** 抓取当前页并发送给 AI。JS 提取是锦上添花，HTML 拦截缓存是主数据源。 */
    private void grabCurrentPage() {
        if (aiBusy) {
            toast("AI 正在回复中，请稍候");
            return;
        }
        if (manualFallback) {
            manualFallback = false;
            updateModeUi();
        }
        if (browser.getUrl() == null && capturedHtml.isEmpty()) {
            toast("请先在浏览器中打开一个网页");
            return;
        }
        final String url = capturedUrl != null && !capturedUrl.isEmpty()
                ? capturedUrl : browser.getUrl();
        final String title = browser.getTitle() != null ? browser.getTitle() : "";
        final String html = capturedHtml;
        grabCount++;
        setStatus("AI 分析中…");

        // JS 提取（3 秒看门狗；此页 JS 卡死也不影响 HTML 已缓存）
        final StringBuilder jsExtras = new StringBuilder();
        final boolean[] jsDone = {false};
        final Runnable watchdog = new Runnable() {
            @Override
            public void run() {
                if (!jsDone[0]) {
                    jsDone[0] = true;
                    sendPageToAi(url, title, html, jsExtras.toString());
                }
            }
        };
        handler.postDelayed(watchdog, GRAB_JS_TIMEOUT);
        try {
            browser.evaluateJavascript(DOM_SCRIPT,
                    new ValueCallback<String>() {
                        @Override
                        public void onReceiveValue(String value) {
                            if (!jsDone[0]) {
                                jsDone[0] = true;
                                handler.removeCallbacks(watchdog);
                                try {
                                    String v = value;
                                    if (v.startsWith("\"")) {
                                        v = new JSONObject("{\"x\":" + v + "}").getString("x");
                                    }
                                    JSONObject o = new JSONObject(v);
                                    if (o.has("forms") && o.getJSONArray("forms").length() > 0) {
                                        jsExtras.append("【表单】 ").append(o.getJSONArray("forms").join(" | ")).append("\n");
                                    }
                                    if (o.has("links") && o.getJSONArray("links").length() > 0) {
                                        jsExtras.append("【链接样本】\n").append(o.getJSONArray("links").join("\n")).append("\n");
                                    }
                                    if (o.has("text") && o.getString("text").length() > 0) {
                                        jsExtras.append("【正文文本】 ").append(o.getString("text")).append("\n");
                                    }
                                } catch (Exception ignored) {
                                }
                                sendPageToAi(url, title, html, jsExtras.toString());
                            }
                        }
                    });
        } catch (Exception e) {
            if (!jsDone[0]) {
                jsDone[0] = true;
                handler.removeCallbacks(watchdog);
                sendPageToAi(url, title, html, "");
            }
        }
    }

    private void sendPageToAi(String url, String title, String html, String extras) {
        StringBuilder msg = new StringBuilder();
        msg.append("【页面抓取 #").append(grabCount).append("】\n");
        msg.append("【URL】 ").append(url).append("\n");
        msg.append("【标题】 ").append(title == null ? "" : title).append("\n");
        String h = html == null ? "" : html;
        boolean truncated = h.length() > 80000;
        msg.append("【HTML】 ").append(h.substring(0, Math.min(80000, h.length())))
                .append(truncated ? "\n…（HTML 过长已截断）" : "").append("\n");
        msg.append(extras);
        if (extras.isEmpty()) {
            msg.append("（本页 JS 提取不可用，请以 HTML 为准）\n");
        }
        askAi(msg.toString(), "页面 #" + grabCount + " 已发送给 AI");
    }

    private void askAi(String userMsg, String logLabel) {
        aiBusy = true;
        aiMessages.add(message("user", userMsg));
        // 长会话内存保护：请求体只取最近 30 条，历史超 120 条时裁剪
        if (aiMessages.size() > 120) {
            aiMessages.subList(0, aiMessages.size() - 90).clear();
            appendLog("（已裁剪早期对话历史）");
        }
        appendLog(">>> " + logLabel);
        final String body = buildRequestBody();
        new Thread(new Runnable() {
            @Override
            public void run() {
                String reply = callLlm(body);
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        aiBusy = false;
                        if (reply == null) {
                            setStatus("AI 调用失败（查看日志）");
                            return;
                        }
                        aiMessages.add(message("assistant", reply));
                        handleAiReply(reply);
                    }
                });
            }
        }, "llm-call").start();
    }

    private JSONObject message(String role, String content) {
        try {
            JSONObject o = new JSONObject();
            o.put("role", role);
            o.put("content", content);
            return o;
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private String buildRequestBody() {
        try {
            JSONObject body = new JSONObject();
            body.put("model", aiModel);
            JSONArray msgs = new JSONArray();
            JSONObject sys = new JSONObject();
            sys.put("role", "system");
            if (aiMode == 1) {
                sys.put("content", skillText + "\n\n【输出要求】直接输出香色闺阁书源 JSON 对象（外层以站点名为键），"
                        + "不要 need_page/source 信封、不要 markdown 代码块、不要解释文字。");
            } else {
                sys.put("content", skillText + "\n\n" + PROTOCOL_APPENDIX);
            }
            msgs.put(sys);
            int from = Math.max(0, aiMessages.size() - 30);
            for (int i = from; i < aiMessages.size(); i++) {
                msgs.put(aiMessages.get(i));
            }
            body.put("messages", msgs);
            body.put("temperature", aiTemperature);
            body.put("max_tokens", aiMaxTokens);
            body.put("stream", false);
            return body.toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    private static final String PROTOCOL_APPENDIX =
            "\n\n【App 协作协议】\n"
                    + "收到页面抓取后，你必须只回复一个 JSON 对象（不要输出 markdown 代码块）：\n"
                    + "1) 需要看更多页面时: {\"need_page\":{\"url\":\"完整URL\",\"keyword\":\"样本关键字(可省略)\",\"reason\":\"原因\"}}\n"
                    + "2) 可以写书源时: {\"source\":{书源JSON},\"note\":\"说明\"}\n"
                    + "收到以【用户指令】开头的消息时，是用户直接输入，你可以自由文本回复，也可以继续返回 need_page/source 推进写源。\n"
                    + "每轮只推进一层：首页→搜索结果→详情/目录→正文→书源。搜索 URL 请带入一个真实热门书名的样本关键字（如 斗破苍穹），并把该关键字填入 keyword 字段，App 会用用户输入替换 URL 中的 %@keyWord。\n"
                    + "选择器必须基于实测 HTML 写，不要猜类名。\n"
                    + "书源 JSON 必须为香色闺阁格式（外层以站点名为键）:\n"
                    + "{\"站点名\":{\"sourceName\":\"站点名\",\"sourceUrl\":\"域名\",\"searchBook\":{\"actionID\":\"searchBook\",\"parserID\":\"DOM\",\"responseFormatType\":\"html\",\"host\":\"域名\",\"requestInfo\":\"URL模板或@js:脚本\",\"list\":\"XPath\",\"bookName\":\"XPath\",\"author\":\"XPath\",\"detailUrl\":\"XPath\",\"cover\":\"XPath\",\"validConfig\":\"\"},\"bookDetail\":{...},\"chapterList\":{\"actionID\":\"chapterList\",\"parserID\":\"DOM\",\"list\":\"XPath\",\"title\":\"XPath\",\"url\":\"XPath\",\"moreKeys\":{\"maxPage\":N},\"validConfig\":\"\"},\"chapterContent\":{\"actionID\":\"chapterContent\",\"parserID\":\"DOM\",\"content\":\"XPath\",\"nextPageUrl\":\"XPath\",\"moreKeys\":{\"maxPage\":N},\"validConfig\":\"\"}}}\n"
                    + "关键语法：选择器用 XPath（如 //div[@id='list']/dl/dd、//a/text()、//img/@src），不用 CSS；搜索占位符用 %@keyWord（不用 [[key]]）；子规则公共字段 actionID/parserID/responseFormatType/validConfig 必带；bookWorld/shudanList/shudanDetail/shupingList/shupingHome/searchShudan/relatedWord 无数据时写 {actionID:...,parserID:\"DOM\"}。\n"
                    + "严禁输出非香色闺阁语法：禁止 CSS 选择器、禁止 @css: 前缀、禁止 [[key]]/{{key}} 占位符、禁止 ruleSearch/ruleBook/ruleToc/ruleContent/ruleExplore 字段、禁止 bookList/bookAuthor/bookUrl 字段、禁止 bookSourceName/bookSourceUrl 字段。\n";

    private String callLlm(String body) {
        HttpURLConnection conn = null;
        try {
            String base = aiBaseUrl.trim();
            if (base.endsWith("/")) {
                base = base.substring(0, base.length() - 1);
            }
            if (!base.endsWith("/chat/completions")) {
                base = base + "/chat/completions";
            }
            conn = (HttpURLConnection) new URL(base).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(180000);
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            if (!aiApiKey.isEmpty()) {
                conn.setRequestProperty("Authorization", "Bearer " + aiApiKey);
            }
            conn.setDoOutput(true);
            OutputStream os = conn.getOutputStream();
            os.write(body.getBytes("UTF-8"));
            os.close();
            int code = conn.getResponseCode();
            InputStream in = code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
            String resp = new String(readAllLimited(in, 4 * 1024 * 1024), "UTF-8");
            in.close();
            if (code < 200 || code >= 300) {
                appendLog("✗ HTTP " + code + ": " + truncate(resp, 400));
                return null;
            }
            JSONObject o = new JSONObject(resp);
            String content = o.optJSONArray("choices").optJSONObject(0)
                    .optJSONObject("message").optString("content", "");
            if (content.isEmpty()) {
                appendLog("✗ AI 返回空内容: " + truncate(resp, 400));
                return null;
            }
            return content;
        } catch (Exception e) {
            appendLog("✗ AI 调用异常: " + e.getMessage());
            return null;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private void toggleAuto() {
        if (!autoRunning) {
            startAuto();
        } else {
            autoRunning = false;
            autoBtn.setText("开始全自动写源");
            pendingAutoFetch = false;
            if (autoTimeoutRunnable != null) {
                handler.removeCallbacks(autoTimeoutRunnable);
            }
            appendLog("⏹ 已停止全自动");
            setStatus("已停止，可手动继续");
        }
    }

    private void startAuto() {
        String url = urlInput.getText().toString().trim();
        if (url.isEmpty()) {
            toast("请先输入起始网址");
            return;
        }
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "http://" + url;
        }
        aiMessages.clear();
        aiLog.setText("");
        grabCount = 0;
        autoRunning = true;
        manualFallback = false;
        waitingKeyword = false;
        autoBtn.setText("停止");
        updateModeUi();
        setStatus("全自动进行中…");
        appendLog("▶ 全自动开始，抓取起始页: " + url);
        autoFetch(url);
    }

    /** 与 AI 自由对话（全自动模式常驻的输入行）。 */
    private void sendChatMessage() {
        String text = chatInput.getText().toString().trim();
        if (text.isEmpty()) {
            return;
        }
        if (aiBusy) {
            toast("AI 正在回复中，请稍候");
            return;
        }
        chatInput.setText("");
        appendLog(">>> 你: " + text);
        askAi("【用户指令】" + text, "你: " + text);
    }

    /** 全自动抓取一个页面发给 AI；失败则回退到 WebView 手动打开，用户抓取后自动继续。 */
    private void autoFetch(final String rawUrl) {
        if (!autoRunning) {
            return;
        }
        final String url = applyKeyword(rawUrl);
        if (url == null) {
            autoRunning = false;
            autoBtn.setText("开始全自动写源");
            waitingKeyword = true;
            updateModeUi();
            setStatus("AI 需要书关键字，请在上方搜索框输入后重新开始");
            return;
        }
        appendLog("⚙ 打开页面: " + url);
        pendingAutoFetch = true;
        browser.loadUrl(url);
        if (autoTimeoutRunnable != null) {
            handler.removeCallbacks(autoTimeoutRunnable);
        }
        autoTimeoutRunnable = new Runnable() {
            @Override
            public void run() {
                if (!pendingAutoFetch) {
                    return;
                }
                pendingAutoFetch = false;
                fallbackManual("页面加载超时（反爬或需 JS 渲染），请在浏览器中打开后点「抓取当前页」，之后自动继续");
            }
        };
        handler.postDelayed(autoTimeoutRunnable, 25000);
    }

    /** WebView 页面加载完成后分发：自动模式则立即把页面发给 AI。 */
    private void dispatchAutoFetch(final String url) {
        if (!autoRunning) {
            return;
        }
        String html = capturedHtml;
        if (html == null || html.isEmpty()) {
            fallbackManual("页面抓取失败（反爬或需 JS 渲染），请在浏览器中打开后点「抓取当前页」，之后自动继续");
            return;
        }
        grabCount++;
        sendPageToAi(url, extractTitle(html), html, capturedDom);
    }

    private void fallbackManual(String log) {
        manualFallback = true;
        updateModeUi();
        appendLog("⚠ " + log);
        setStatus("该页需手动打开：打开后点「抓取当前页」");
    }

    /** 替换 AI 建议页地址中的占位符；缺少书关键字时返回 null。 */
    private String applyKeyword(String url) {
        if (url.contains("%@keyWord")) {
            String kw = keywordInput.getText().toString().trim();
            if (kw.isEmpty()) {
                return null;
            }
            try {
                url = url.replace("%@keyWord", URLEncoder.encode(kw, "UTF-8"));
            } catch (Exception e) {
                url = url.replace("%@keyWord", kw);
            }
        }
        url = url.replace("%@pageIndex", "1");
        return url;
    }

    private static String extractTitle(String html) {
        if (html == null) {
            return "";
        }
        java.util.regex.Matcher m = java.util.regex.Pattern.compile(
                "<title[^>]*>(.*?)</title>",
                java.util.regex.Pattern.CASE_INSENSITIVE | java.util.regex.Pattern.DOTALL).matcher(html);
        return m.find() ? m.group(1).trim() : "";
    }

    /** 按当前模式显示/隐藏操作区：手动模式或单页回退时显示手动按钮。 */
    private void updateModeUi() {
        boolean manual = !autoMode || manualFallback;
        if (browser != null) {
            browser.setVisibility(autoMode ? View.GONE : View.VISIBLE);
        }
        if (logPanel != null) {
            LinearLayout.LayoutParams llp = (LinearLayout.LayoutParams) logPanel.getLayoutParams();
            if (autoMode) {
                llp.height = 0;
                llp.weight = 1f;
            } else {
                llp.height = dp(240);
                llp.weight = 0;
            }
            logPanel.setLayoutParams(llp);
        }
        if (autoRow != null) {
            autoRow.setVisibility(autoMode ? View.VISIBLE : View.GONE);
        }
        if (chatRow != null) {
            // 转换书源模式依赖对话行上传/发送，任何写源子模式都保持可见
            chatRow.setVisibility((autoMode || aiMode == 1) ? View.VISIBLE : View.GONE);
        }
        if (manualRow1 != null) {
            manualRow1.setVisibility(manual ? View.VISIBLE : View.GONE);
        }
        if (manualSearchRow != null) {
            manualSearchRow.setVisibility(!autoMode || waitingKeyword ? View.VISIBLE : View.GONE);
        }
    }

    private void applyAutoModeTabs() {
        autoTab.setBackgroundResource(autoMode ? R.drawable.bg_tab_active : 0);
        autoTab.setTextColor(autoMode ? 0xFF4F46E5 : 0xFF64748B);
        autoTab.setTypeface(autoMode ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
        manualTab.setBackgroundResource(!autoMode ? R.drawable.bg_tab_active : 0);
        manualTab.setTextColor(!autoMode ? 0xFF4F46E5 : 0xFF64748B);
        manualTab.setTypeface(!autoMode ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
    }

    private void handleAiReply(String reply) {
        appendLog("AI: " + truncate(reply, 600));
        JSONObject env = tryParseEnvelope(reply);
        if (env == null) {
            String txt = reply == null ? "" : reply.trim();
            if (!txt.isEmpty()) {
                setStatus("AI 已回复（文本，见日志）");
            } else {
                setStatus("AI 未返回结构化回复，请重试或点击「抓取当前页」继续");
            }
            return;
        }
        try {
            if (env.has("need_page") && aiMode != 1) {
                JSONObject np = env.getJSONObject("need_page");
                lastNeedUrl = np.optString("url", "");
                lastNeedKeyword = np.has("keyword") ? np.getString("keyword") : null;
                String reason = np.optString("reason", "");
                if (lastNeedUrl.isEmpty()) {
                    setStatus("AI 未给出页面地址");
                    return;
                }
                openSuggestionBtn.setEnabled(true);
                appendLog("AI 想查看: " + lastNeedUrl + (reason.isEmpty() ? "" : "\n  原因: " + reason));
                if (autoRunning) {
                    manualFallback = false;
                    updateModeUi();
                    autoFetch(lastNeedUrl);
                } else {
                    setStatus("点「AI建议页 ▸」打开该页面，浏览后点「抓取当前页」");
                }
            } else if (env.has("source")) {
                JSONObject src = env.getJSONObject("source");
                showSourcePreview(src);
                setStatus("AI 已产出书源，请预览并保存");
            } else if (aiMode == 1 && looksLikeXsggSource(env)) {
                // 转换模式：AI 直接输出书源 JSON（无 need_page/source 信封）
                showSourcePreview(env);
                setStatus("AI 已产出书源，请预览并保存");
            } else if (aiMode == 1) {
                // 转换模式：尝试解析书源数组并合并为单对象（键=站点名）
                JSONObject merged = tryParseSourceList(reply);
                if (merged != null && looksLikeXsggSource(merged)) {
                    showSourcePreview(merged);
                    setStatus("AI 已产出书源（" + countSourceKeys(merged) + " 个），请预览并保存");
                } else {
                    setStatus("AI 回复未包含有效书源 JSON");
                }
            } else {
                setStatus("AI 回复缺少 need_page/source 字段");
            }
        } catch (Exception e) {
            setStatus("解析 AI 回复失败: " + e.getMessage());
        }
    }

    /** 把回复中的 JSON 数组书源列表合并为单对象（外层键=站点名或 sourceName）。 */
    private static JSONObject tryParseSourceList(String reply) {
        try {
            String s = reply == null ? "" : reply.trim();
            if (s.startsWith("```")) {
                int i = s.indexOf('\n');
                if (i > 0) {
                    s = s.substring(i + 1);
                }
                int j = s.lastIndexOf("```");
                if (j > 0) {
                    s = s.substring(0, j);
                }
                s = s.trim();
            }
            if (!s.startsWith("[")) {
                return null;
            }
            JSONArray arr = new JSONArray(s);
            JSONObject merged = new JSONObject();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject item = arr.optJSONObject(i);
                if (item == null) {
                    continue;
                }
                if (item.has("searchBook") && item.has("sourceName")) {
                    merged.put(item.optString("sourceName", "书源" + (i + 1)), item);
                } else if (looksLikeXsggSource(item)) {
                    java.util.Iterator<String> keys = item.keys();
                    while (keys.hasNext()) {
                        String k = keys.next();
                        Object v = item.opt(k);
                        if (v instanceof JSONObject && ((JSONObject) v).has("searchBook")) {
                            merged.put(k, v);
                        }
                    }
                }
            }
            return merged.length() == 0 ? null : merged;
        } catch (Exception e) {
            return null;
        }
    }

    private static int countSourceKeys(JSONObject o) {
        int n = 0;
        try {
            java.util.Iterator<String> keys = o.keys();
            while (keys.hasNext()) {
                Object v = o.opt(keys.next());
                if (v instanceof JSONObject && ((JSONObject) v).has("searchBook")) {
                    n++;
                }
            }
        } catch (Exception ignored) {
        }
        return n;
    }

    /** 判断 JSON 是否为香色闺阁书源对象（自身或任一子值为含 searchBook 的书源）。 */
    private static boolean looksLikeXsggSource(JSONObject o) {
        try {
            if (o.has("searchBook")) {
                return true;
            }
            java.util.Iterator<String> keys = o.keys();
            while (keys.hasNext()) {
                Object v = o.opt(keys.next());
                if (v instanceof JSONObject && ((JSONObject) v).has("searchBook")) {
                    return true;
                }
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    private JSONObject tryParseEnvelope(String reply) {
        String s = reply == null ? "" : reply.trim();
        if (s.startsWith("```")) {
            int i = s.indexOf('\n');
            if (i > 0) {
                s = s.substring(i + 1);
            }
            int j = s.lastIndexOf("```");
            if (j > 0) {
                s = s.substring(0, j);
            }
            s = s.trim();
        }
        if (s.startsWith("{")) {
            try {
                return new JSONObject(s);
            } catch (Exception ignored) {
            }
        }
        int start = s.indexOf('{');
        if (start >= 0) {
            int depth = 0;
            for (int i = start; i < s.length(); i++) {
                char c = s.charAt(i);
                if (c == '{') {
                    depth++;
                } else if (c == '}') {
                    depth--;
                    if (depth == 0) {
                        try {
                            return new JSONObject(s.substring(start, i + 1));
                        } catch (Exception ignored) {
                            break;
                        }
                    }
                }
            }
        }
        return null;
    }

    private void showSourcePreview(final JSONObject src) {
        try {
            String pretty = src.toString(2);
            final ArrayList<String> issues = checkSourceStyle(pretty);
            LinearLayout boxWrap = new LinearLayout(this);
            boxWrap.setOrientation(LinearLayout.VERTICAL);
            if (!issues.isEmpty()) {
                TextView warn = new TextView(this);
                warn.setText("⚠ 疑似开源阅读(Legado)语法，香色闺阁可能不兼容:\n- " +
                        joinLines(issues));
                warn.setTextColor(0xFFB45309);
                warn.setTextSize(12);
                warn.setPadding(dp(4), 0, dp(4), dp(8));
                boxWrap.addView(warn);
            }
            final EditText box = new EditText(this);
            box.setText(pretty);
            box.setTextSize(11);
            box.setTypeface(Typeface.MONOSPACE);
            box.setGravity(Gravity.TOP);
            box.setMinHeight(dp(400));
            boxWrap.addView(box);
            final AlertDialog dlg = new AlertDialog.Builder(this)
                    .setTitle("书源生成结果")
                    .setView(boxWrap)
                    .setPositiveButton("保存到 Download", null)
                    .setNegativeButton("关闭", null)
                    .create();
            dlg.setOnShowListener(new android.content.DialogInterface.OnShowListener() {
                @Override
                public void onShow(android.content.DialogInterface d) {
                    ((android.widget.Button) dlg.getButton(AlertDialog.BUTTON_POSITIVE))
                            .setOnClickListener(new View.OnClickListener() {
@Override
                    public void onClick(View v) {
                        try {
                            JSONObject edited = new JSONObject(box.getText().toString());
                            String name = edited.keys().hasNext()
                                    ? edited.keys().next() : "booksource";
                            byte[] data = edited.toString(2).getBytes("UTF-8");
                            dlg.dismiss();
                            saveBytesToDownloadAsync(data, sanitizeFilename(name) + ".json");
                        } catch (Exception e) {
                            toast("JSON 无效: " + e.getMessage());
                        }
                    }
                            });
                }
            });
            dlg.show();
        } catch (Exception e) {
            toast("书源预览失败: " + e.getMessage());
        }
    }

    /** 检测书源中疑似非香色闺阁格式的痕迹，返回问题列表。 */
    private static ArrayList<String> checkSourceStyle(String json) {
        ArrayList<String> issues = new ArrayList<String>();
        if (json.contains("@css:")) {
            issues.add("@css: 前缀（香色闺阁用 XPath，不要 @css:）");
        }
        if (json.contains("[[key]]") || json.contains("{{key}}") || json.contains("{{searchKey}}")) {
            issues.add("[[key]]/{{key}} 占位符（香色闺阁用 %@keyWord）");
        }
        if (json.contains("\"ruleSearch\"") || json.contains("\"ruleBook\"")
                || json.contains("\"ruleToc\"") || json.contains("\"ruleContent\"")) {
            issues.add("ruleSearch/ruleBook/ruleToc/ruleContent 字段（香色闺阁用 searchBook/bookDetail/chapterList/chapterContent）");
        }
        if (json.contains("\"bookList\"") || json.contains("\"bookAuthor\"")) {
            issues.add("bookList/bookAuthor 字段（香色闺阁用 list/author/detailUrl；bookName 是合法字段）");
        }
        if (json.contains("\"bookSourceName\"") || json.contains("\"bookSourceUrl\"")) {
            issues.add("bookSourceName/bookSourceUrl 字段（香色闺阁用 sourceName/sourceUrl，且作为外层站点名的键）");
        }
        if (!json.contains("\"searchBook\"")) {
            issues.add("缺少 searchBook（搜索规则）");
        }
        if (!json.contains("\"chapterContent\"")) {
            issues.add("缺少 chapterContent（正文规则）");
        }
        if (!json.contains("parserID") || !json.contains("\"DOM\"")) {
            issues.add("缺少 parserID:\"DOM\"（香色闺阁子规则固定写法）");
        }
        return issues;
    }

    private static String joinLines(ArrayList<String> lines) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < lines.size(); i++) {
            if (i > 0) {
                sb.append("\n- ");
            }
            sb.append(lines.get(i));
        }
        return sb.toString();
    }

    private void doKeywordSearch() {
        String kw = keywordInput.getText().toString().trim();
        if (kw.isEmpty()) {
            toast("请输入书关键字");
            return;
        }
        if (lastNeedUrl == null || lastNeedUrl.isEmpty()) {
            toast("请先抓取首页让 AI 推断搜索 URL，或点「AI建议页」打开搜索页");
            return;
        }
        String target = lastNeedUrl;
        try {
            String enc = URLEncoder.encode(kw, "UTF-8");
            if (target.contains("%@keyWord")) {
                target = target.replace("%@keyWord", enc);
            } else if (target.contains("[[key]]") || target.contains("{q}")) {
                target = target.replace("[[key]]", enc).replace("{q}", enc);
            } else if (lastNeedKeyword != null && !lastNeedKeyword.isEmpty()
                    && target.contains(lastNeedKeyword)) {
                target = target.replace(lastNeedKeyword, enc);
            } else {
                appendLog("⚠ 搜索 URL 不含 %@keyWord，直接打开: " + target);
            }
        } catch (Exception e) {
            toast("URL 编码失败: " + e.getMessage());
            return;
        }
        appendLog("▶ 搜索: " + target);
        browser.loadUrl(target);
        setStatus("搜索结果已打开，点「抓取当前页」发给 AI");
    }

    // ---------------- 设置与 Skill ----------------

    private void showSettingsDialog() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(16), dp(8), dp(16), dp(8));

        box.addView(label("AI 用途"));

        final RadioGroup modeGroup = new RadioGroup(this);
        final android.widget.RadioButton rbWrite = new android.widget.RadioButton(this);
        rbWrite.setText("AI 写源（skill-xbs.md：抓页逐步生成书源）");
        rbWrite.setTextSize(13);
        rbWrite.setId(android.view.View.generateViewId());
        modeGroup.addView(rbWrite);
        final android.widget.RadioButton rbConvert = new android.widget.RadioButton(this);
        rbConvert.setText("AI 转换书源（skill-convert.md：上传 Legado 书源一键转换）");
        rbConvert.setTextSize(13);
        rbConvert.setId(android.view.View.generateViewId());
        modeGroup.addView(rbConvert);
        if (aiMode == 1) {
            rbConvert.setChecked(true);
        } else {
            rbWrite.setChecked(true);
        }
        box.addView(modeGroup);
        box.addView(divider());

        box.addView(label("API 配置"));
        box.addView(label("API 地址（OpenAI 兼容 /chat/completions）"));
        EditText baseUrl = new EditText(this);
        baseUrl.setText(aiBaseUrl);
        baseUrl.setHint("如 https://api.deepseek.com");
        baseUrl.setSingleLine(true);
        box.addView(baseUrl, matchWrap());

        box.addView(label("模型"));
        EditText model = new EditText(this);
        model.setText(aiModel);
        model.setHint("如 deepseek-chat");
        model.setSingleLine(true);
        box.addView(model, matchWrap());

        box.addView(label("API Key"));
        LinearLayout keyRow = new LinearLayout(this);
        keyRow.setOrientation(LinearLayout.HORIZONTAL);
        keyRow.setGravity(Gravity.CENTER_VERTICAL);
        final EditText apiKey = new EditText(this);
        apiKey.setText(aiApiKey);
        apiKey.setHint("API Key");
        apiKey.setSingleLine(true);
        apiKey.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        keyRow.addView(apiKey, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        final CheckBox showKey = new CheckBox(this);
        showKey.setText("显示");
        showKey.setTextSize(13);
        showKey.setPadding(dp(6), 0, 0, 0);
        showKey.setOnCheckedChangeListener(new android.widget.CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(android.widget.CompoundButton buttonView, boolean isChecked) {
                int sel = apiKey.getSelectionStart();
                if (isChecked) {
                    apiKey.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
                } else {
                    apiKey.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
                }
                apiKey.setSelection(Math.max(0, sel));
            }
        });
        keyRow.addView(showKey);
        box.addView(keyRow);
        box.addView(divider());

        box.addView(label("高级"));
        box.addView(label("温度（0~2，默认 0.3，数值越高越发散）"));
        EditText tempInput = new EditText(this);
        tempInput.setText(String.valueOf(aiTemperature));
        tempInput.setHint("0~2 之间的小数");
        tempInput.setSingleLine(true);
        box.addView(tempInput, matchWrap());

        box.addView(label("最大输出 tokens（默认 8000）"));
        EditText tokensInput = new EditText(this);
        tokensInput.setText(String.valueOf(aiMaxTokens));
        tokensInput.setHint("正整数");
        tokensInput.setSingleLine(true);
        box.addView(tokensInput, matchWrap());
        box.addView(divider());

        box.addView(label("Skill（发送给 AI 的 system 提示词）"));
        final TextView skillInfo = label("当前: " + aiSkillFile + "（" + skillText.length() + " 字符）");
        box.addView(skillInfo);

        final String origModeFile = aiSkillFile;
        final String origModeSkill = skillText;
        final int origMode = aiMode;
        modeGroup.setOnCheckedChangeListener(new RadioGroup.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(RadioGroup group, int checkedId) {
                String file = checkedId == rbConvert.getId() ? "skill-convert.md" : "skill-xbs.md";
                if (!file.equals(aiSkillFile)) {
                    aiSkillFile = file;
                    skillText = loadSkill();
                }
                skillInfo.setText("当前: " + aiSkillFile + "（" + skillText.length() + " 字符）");
            }
        });

        Button viewSkill = new Button(this);
        viewSkill.setText("查看当前 Skill 内容");
        styleSecondary(viewSkill);
        viewSkill.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                TextView tv = new TextView(MainActivity.this);
                tv.setText(skillText);
                tv.setTextSize(11);
                tv.setTypeface(Typeface.MONOSPACE);
                tv.setTextColor(Color.DKGRAY);
                ScrollView sv = new ScrollView(MainActivity.this);
                sv.addView(tv, new ScrollView.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
                new AlertDialog.Builder(MainActivity.this)
                        .setTitle("Skill 内容（发送给 AI 的 system 提示词）")
                        .setView(sv)
                        .setPositiveButton("关闭", null)
                        .show();
            }
        });
        LinearLayout.LayoutParams btnLp1 = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        btnLp1.setMargins(0, dp(6), 0, 0);
        box.addView(viewSkill, btnLp1);

        Button importSkill = new Button(this);
        importSkill.setText("导入自定义 Skill MD 文件（覆盖当前）");
        styleSecondary(importSkill);
        importSkill.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(i, PICK_SKILL);
                } catch (Exception e) {
                    toast("无法打开文件选择器: " + e.getMessage());
                }
            }
        });
        LinearLayout.LayoutParams btnLp2 = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        btnLp2.setMargins(0, dp(6), 0, 0);
        box.addView(importSkill, btnLp2);

        Button resetSkill = new Button(this);
        resetSkill.setText("恢复默认 Skill（重新加载内置指南）");
        styleSecondary(resetSkill);
        resetSkill.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                File f = new File(getFilesDir(), aiSkillFile);
                f.delete();
                skillText = loadSkill();
                toast("已恢复默认 Skill");
                if (footerSkill != null) {
                    footerSkill.setText(skillInfoText() + " · 书源转换与 AI 写源工具");
                }
            }
        });
        LinearLayout.LayoutParams btnLp3 = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        btnLp3.setMargins(0, dp(6), 0, 0);
        box.addView(resetSkill, btnLp3);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(box, new ScrollView.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        new AlertDialog.Builder(this)
                .setTitle("AI 设置")
                .setView(scroll)
                .setOnCancelListener(new android.content.DialogInterface.OnCancelListener() {
                    @Override
                    public void onCancel(android.content.DialogInterface d) {
                        aiMode = origMode;
                        aiSkillFile = origModeFile;
                        skillText = origModeSkill;
                    }
                })
                .setPositiveButton("保存", new android.content.DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(android.content.DialogInterface d, int which) {
                        aiBaseUrl = baseUrl.getText().toString().trim();
                        aiModel = model.getText().toString().trim();
                        aiApiKey = apiKey.getText().toString().trim();
                        int newMode = rbConvert.isChecked() ? 1 : 0;
                        double t = 0.3;
                        try {
                            t = Double.parseDouble(tempInput.getText().toString().trim());
                        } catch (Exception e) {
                            toast("温度不是有效数字，已使用默认 0.3");
                        }
                        if (t < 0) t = 0;
                        if (t > 2) t = 2;
                        if (Double.isNaN(t) || Double.isInfinite(t)) {
                            t = 0.3;
                            toast("温度数值无效，已使用默认 0.3");
                        }
                        aiTemperature = t;
                        int mt = 8000;
                        try {
                            mt = Integer.parseInt(tokensInput.getText().toString().trim());
                        } catch (Exception e) {
                            toast("最大输出 tokens 不是有效整数，已使用默认 8000");
                        }
                        if (mt < 1) mt = 8000;
                        aiMaxTokens = mt;
                        boolean modeChanged = newMode != origMode;
                        aiMode = newMode;
                        applyAiMode();
                        skillText = loadSkill();
                        getSharedPreferences("xbs", MODE_PRIVATE).edit()
                                .putString("ai_base_url", aiBaseUrl)
                                .putString("ai_model", aiModel)
                                .putString("ai_api_key", aiApiKey)
                                .putInt("ai_mode", aiMode)
                                .putFloat("ai_temperature", (float) aiTemperature)
                                .putInt("ai_max_tokens", aiMaxTokens)
                                .apply();
                        if (footerSkill != null) {
                            footerSkill.setText(skillInfoText() + " · 书源转换与 AI 写源工具");
                        }
                        if (modeChanged) {
                            updateModeUi();
                        }
                        toast("设置已保存" + (modeChanged ? "，Skill 已切换为 " + aiSkillFile : ""));
                    }
                })
                .setNegativeButton("取消", new android.content.DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(android.content.DialogInterface d, int which) {
                        aiMode = origMode;
                        aiSkillFile = origModeFile;
                        skillText = origModeSkill;
                    }
                })
                .show();
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private View divider() {
        View v = new View(this);
        v.setBackgroundResource(R.drawable.divider);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(1));
        lp.setMargins(0, dp(10), 0, dp(6));
        v.setLayoutParams(lp);
        return v;
    }

    private TextView label(String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextColor(Color.DKGRAY);
        t.setTextSize(12);
        t.setPadding(0, dp(8), 0, dp(2));
        return t;
    }

    /** 按当前 aiMode 设定 skill 文件名（写源/转换书源）。 */
    private void applyAiMode() {
        aiSkillFile = aiMode == 1 ? "skill-convert.md" : "skill-xbs.md";
    }

    private String loadSkill() {
        try {
            File f = new File(getFilesDir(), aiSkillFile);
            if (f.exists()) {
                byte[] b = readAllLimited(new java.io.FileInputStream(f), 2 * 1024 * 1024);
                return new String(b, "UTF-8");
            }
            InputStream is = getAssets().open(aiSkillFile);
            byte[] b = readAllLimited(is, 2 * 1024 * 1024);
            return new String(b, "UTF-8");
        } catch (Exception e) {
            return "你是香色闺阁书源编写专家。请基于用户提供的页面抓取内容逐步编写书源。\n"
                    + "书源 JSON 结构: {bookSourceName, bookSourceUrl, ruleSearch:{url,list,name,author,bookUrl}, "
                    + "ruleBook:{toc}, ruleToc:{name,url}, ruleContent:{content}}。"
                    + "搜索 URL 用 [[key]] 表示关键字占位。回复协议见 App 提示。";
        }
    }

    // ---------------- 日志/状态 ----------------

    private void appendLog(final String line) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                aiLog.append(line);
                aiLog.append("\n");
                if (aiLog.getParent() instanceof ScrollView) {
                    ((ScrollView) aiLog.getParent()).fullScroll(View.FOCUS_DOWN);
                }
            }
        });
    }

    private void setStatus(final String s) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                aiStatus.setText(s);
            }
        });
    }

    private static String truncate(String s, int max) {
        if (s == null) {
            return "";
        }
        return s.length() <= max ? s : s.substring(0, max) + "…";
    }

    // ---------------- 文件保存（沿用已验证逻辑） ----------------

    private void saveBytesToDownloadAsync(final byte[] data, final String name) {
        if (Build.VERSION.SDK_INT >= 23 && Build.VERSION.SDK_INT <= 28
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED) {
            pendingSaveData = data;
            pendingSaveName = name;
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    String saved = saveBytesToDownload(data, name);
                    if (saved != null) {
                        toast("已保存到 " + saved);
                    }
                } catch (Exception e) {
                    toast("保存失败: " + e.getMessage());
                }
            }
        }, "save-file").start();
    }

    private String saveBytesToDownload(final byte[] data, final String name) throws Exception {
        if (Build.VERSION.SDK_INT >= 29) {
            try {
                return saveViaMediaStore(data, name);
            } catch (Exception e) {
                // Android 15 等对 MediaStore.Downloads 限制时兜底到系统选择器
            }
            pendingSaveData = data;
            pendingSaveName = name;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    launchCreateDocument(name);
                }
            });
            return null;
        }
        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        if (!dir.exists()) {
            dir.mkdirs();
        }
        File f = new File(dir, name);
        FileOutputStream fos = new FileOutputStream(f);
        fos.write(data);
        fos.close();
        return f.getAbsolutePath();
    }

    private String saveViaMediaStore(byte[] data, String name) throws Exception {
        ContentValues v = new ContentValues();
        v.put("_display_name", name);
        v.put("mime_type", "application/octet-stream");
        v.put("relative_path", "Download");
        Uri uri = getContentResolver().insert(
                Uri.parse("content://media/external/downloads"), v);
        if (uri == null) {
            throw new Exception("MediaStore insert failed");
        }
        OutputStream os = getContentResolver().openOutputStream(uri);
        if (os == null) {
            throw new Exception("openOutputStream failed");
        }
        os.write(data);
        os.close();
        return "Download/" + name;
    }

    private void launchCreateDocument(String name) {
        try {
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/octet-stream");
            intent.putExtra(Intent.EXTRA_TITLE, name);
            intent.putExtra("android.intent.extra.INITIAL_URI",
                    Uri.parse("content://com.android.externalstorage.documents/document/primary%3ADownload"));
            startActivityForResult(intent, SAVE_REQUEST);
        } catch (Exception e) {
            toast("无法打开保存选择器: " + e.getMessage());
            pendingSaveData = null;
            pendingSaveName = null;
        }
    }

    // ---------------- 系统回调 ----------------

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == SAVE_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null
                    && pendingSaveData != null) {
                Uri uri = data.getData();
                try {
                    OutputStream os = getContentResolver().openOutputStream(uri);
                    if (os != null) {
                        os.write(pendingSaveData);
                        os.close();
                        toast("已保存到所选位置");
                    }
                } catch (Exception e) {
                    toast("保存失败: " + e.getMessage());
                }
            }
            pendingSaveData = null;
            pendingSaveName = null;
            return;
        }
        if (requestCode == FILE_CHOOSER_REQUEST) {
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                results = new Uri[]{data.getData()};
            }
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
            return;
        }
        if (requestCode == PICK_FILE && resultCode == RESULT_OK && data != null
                && data.getData() != null) {
            final Uri uri = data.getData();
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        String name = queryDisplayName(uri);
                        InputStream in = getContentResolver().openInputStream(uri);
                        byte[] bytes = readAllLimited(in, 8 * 1024 * 1024);
                        final String fname = name;
                        final byte[] fbytes = bytes;
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                doConvert(fbytes, fname);
                            }
                        });
                    } catch (Exception e) {
                        toast("读取文件失败: " + e.getMessage());
                    }
                }
            }, "read-file").start();
            return;
        }
        if (requestCode == PICK_LEGADO && resultCode == RESULT_OK && data != null
                && data.getData() != null) {
            final Uri uri = data.getData();
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        InputStream in = getContentResolver().openInputStream(uri);
                        byte[] bytes = readAllLimited(in, 8 * 1024 * 1024);
                        final String text = new String(bytes, "UTF-8").trim();
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                importLegado(text);
                            }
                        });
                    } catch (Exception e) {
                        toast("读取文件失败: " + e.getMessage());
                    }
                }
            }, "read-legado").start();
            return;
        }
        if (requestCode == PICK_AI_SOURCE && resultCode == RESULT_OK && data != null
                && data.getData() != null) {
            final Uri uri = data.getData();
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        String name = queryDisplayName(uri);
                        InputStream in = getContentResolver().openInputStream(uri);
                        byte[] bytes = readAllLimited(in, 8 * 1024 * 1024);
                        final String text = new String(bytes, "UTF-8").trim();
                        final String fname = name == null ? "booksource" : name;
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                aiMessages.clear();
                                aiLog.setText("");
                                if (aiMode != 1) {
                                    aiMode = 1;
                                    applyAiMode();
                                    skillText = loadSkill();
                                    getSharedPreferences("xbs", MODE_PRIVATE).edit()
                                            .putInt("ai_mode", 1).apply();
                                    toast("已切换为「AI 转换书源」模式");
                                    updateModeUi();
                                    if (footerSkill != null) {
                                        footerSkill.setText(skillInfoText() + " · 书源转换与 AI 写源工具");
                                    }
                                }
                                appendLog("▶ 已载入书源文件: " + fname + "（" + text.length() + " 字符），发送给 AI 转换…");
                                String content = text;
                                if (content.length() > 300000) {
                                    content = content.substring(0, 300000) + "\n\n[文件过大已截断，仅转换前 30 万字符]";
                                }
                                askAi("请将以下开源阅读书源 JSON 转换为香色闺阁格式书源 JSON，直接输出结果（外层以站点名为键）：\n\n" + content, "转换书源: " + fname);
                            }
                        });
                    } catch (Exception e) {
                        toast("读取文件失败: " + e.getMessage());
                    }
                }
            }, "read-ai-source").start();
            return;
        }
        if (requestCode == PICK_SKILL && resultCode == RESULT_OK && data != null
                && data.getData() != null) {
            final Uri uri = data.getData();
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        InputStream in = getContentResolver().openInputStream(uri);
                        byte[] bytes = readAllLimited(in, 2 * 1024 * 1024);
                        File out = new File(getFilesDir(), aiSkillFile);
                        FileOutputStream fos = new FileOutputStream(out);
                        fos.write(bytes);
                        fos.close();
                        skillText = new String(bytes, "UTF-8");
                        toast("Skill 已导入，将在下次 AI 调用时生效");
                    } catch (Exception e) {
                        toast("导入 Skill 失败: " + e.getMessage());
                    }
                }
            }, "read-skill").start();
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private String queryDisplayName(Uri uri) {
        Cursor c = null;
        try {
            c = getContentResolver().query(uri, null, null, null, null);
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    String n = c.getString(idx);
                    if (n != null && !n.trim().isEmpty()) {
                        return n;
                    }
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) {
                c.close();
            }
        }
        // content URI 最后段常是数字 ID（非真实文件名），不可用时用时间戳名
        String seg = uri.getLastPathSegment();
        if (seg == null || seg.trim().isEmpty() || seg.matches("\\d+")) {
            return fallbackName();
        }
        return seg;
    }

    /** 文件名兜底：content URI 最后段常是数字 ID，不可用时返回时间戳名。 */
    private static String fallbackName() {
        return "booksource_" + System.currentTimeMillis();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQ_STORAGE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                if (pendingSaveData != null) {
                    final byte[] d = pendingSaveData;
                    final String n = pendingSaveName;
                    pendingSaveData = null;
                    new Thread(new Runnable() {
                        @Override
                        public void run() {
                            try {
                                String saved = saveBytesToDownload(d, n);
                                if (saved != null) {
                                    toast("已保存到 " + saved);
                                }
                            } catch (Exception e) {
                                toast("保存失败: " + e.getMessage());
                            }
                        }
                    }, "save-file").start();
                }
            } else {
                toast("未授予存储权限，无法保存到 Download 文件夹");
                pendingSaveData = null;
            }
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    @Override
    protected void onDestroy() {
        if (convWeb != null) {
            convWeb.destroy();
            convWeb = null;
        }
        if (browser != null) {
            browser.destroy();
            browser = null;
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        // 转换页在前台时直接退出流程，不操作隐藏的浏览器历史
        if (convertPanel != null && convertPanel.getVisibility() == View.VISIBLE) {
            super.onBackPressed();
            return;
        }
        if (browser != null && browser.canGoBack()) {
            browser.goBack();
        } else {
            super.onBackPressed();
        }
    }

    private ValueCallback<Uri[]> filePathCallback;

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void stylePrimary(Button b) {
        b.setBackgroundResource(R.drawable.btn_primary);
        b.setTextColor(Color.WHITE);
        b.setAllCaps(false);
        b.setTextSize(13);
        b.setMinHeight(dp(40));
        b.setPadding(dp(14), dp(8), dp(14), dp(8));
    }

    private void styleSecondary(Button b) {
        b.setBackgroundResource(R.drawable.btn_secondary);
        b.setTextColor(0xFF4338CA);
        b.setAllCaps(false);
        b.setTextSize(12);
        b.setMinHeight(dp(36));
        b.setPadding(dp(10), dp(6), dp(10), dp(6));
    }

    private void setBtnIcon(Button b, int iconRes, int tint) {
        Drawable d = getResources().getDrawable(iconRes, getTheme());
        d.mutate().setTint(tint);
        d.setBounds(0, 0, dp(16), dp(16));
        b.setCompoundDrawables(d, null, null, null);
        b.setCompoundDrawablePadding(dp(6));
    }

    private String skillInfoText() {
        boolean imported = new File(getFilesDir(), aiSkillFile).exists();
        return "Skill:" + aiSkillFile + (imported ? "(自定义)" : "(内置)") + " " + skillText.length() + "字";
    }

    private void toast(final String msg) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(MainActivity.this, msg, Toast.LENGTH_LONG).show();
            }
        });
    }

    private static String sanitizeFilename(String name) {
        String out = name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "_").trim();
        if (out.length() > 120) {
            int dot = out.lastIndexOf('.');
            out = dot > 0 ? out.substring(0, 100) + out.substring(dot) : out.substring(0, 120);
        }
        return out.isEmpty() ? "booksource" : out;
    }
}
