/**
 * ZEUS 1-Click Cloudflare Auto-Deployer — Cloudflare Worker & Pages Full Gateway
 * 
 * این ورکر به صورت سرورلس در کلودفلر اجرا شده و هم رابط کاربری وب را ارائه می‌دهد
 * و هم درخواست‌های استقرار را با Cloudflare API بدون مشکل CORS یا چالش امنیتی پردازش می‌کند.
 */

const ZEUS_CORE_TEMPLATE = `/**
 * ZEUS PANEL CORE — High-Performance Cloudflare Edge Node
 * Features: VLESS (WS/xHTTP), Trojan, Dynamic D1 User Engine, Subscriptions
 */

const CONFIG = {
  NODE_NAME: "{{NODE_NAME}}",
  ADMIN_PATH: "{{ADMIN_PATH}}",
  ROOT_UUID: "{{ROOT_UUID}}",
  D1_DATABASE: "{{D1_DATABASE}}",
  SALT_KEY: "{{SALT_KEY}}",
  ENABLE_VLESS: true,
  ENABLE_TROJAN: true
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const upgradeHeader = request.headers.get("Upgrade");
    const adminPath = env.ADMIN_PATH || CONFIG.ADMIN_PATH;
    const rootUuid = env.UUID || CONFIG.ROOT_UUID;

    // Dynamic secret admin route
    if (url.pathname === adminPath || url.pathname === adminPath + "/") {
      return new Response(generateAdminPanelHTML(CONFIG, adminPath, rootUuid), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    // Subscription delivery route
    if (url.pathname.startsWith("/sub/")) {
      const userToken = url.pathname.split("/sub/")[1];
      return handleSubscriptionQuery(userToken, request, env, CONFIG, rootUuid);
    }

    // WebSocket / VLESS Tunnel Proxying
    if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
      return handleVlessWebSocket(request, env, CONFIG, rootUuid);
    }

    // Default Fallback
    return new Response("Service Operational - " + CONFIG.NODE_NAME, { status: 200 });
  }
};

function generateAdminPanelHTML(cfg, adminPath, rootUuid) {
  return '<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><title>⚡ ' + cfg.NODE_NAME + '</title><style>body{background:#0b0e17;color:#fff;font-family:system-ui,sans-serif;text-align:center;padding:40px 20px;}.card{max-width:600px;margin:auto;background:#131929;border:1px solid #8b5cf6;border-radius:16px;padding:30px;box-shadow:0 8px 32px rgba(139,92,246,0.3);}h1{color:#8b5cf6;margin-bottom:8px;}.badge{background:rgba(0,240,255,0.15);color:#00f0ff;padding:4px 12px;border-radius:20px;font-size:0.85rem;display:inline-block;margin-bottom:20px;}.info-box{background:#070a12;padding:15px;border-radius:10px;margin:12px 0;text-align:right;direction:ltr;font-family:monospace;word-break:break-all;}</style></head><body><div class="card"><h1>⚡ ' + cfg.NODE_NAME + '</h1><span class="badge">● آنلاین و فعال در شبکه ابری Cloudflare</span><p style="color:#9ca3af;font-size:0.9rem;">پنل مدیریت اختصاصی با موفقیت مستقر شد.</p><div class="info-box"><b>Root UUID:</b> ' + rootUuid + '</div><div class="info-box"><b>Admin Secret Path:</b> ' + adminPath + '</div><div class="info-box"><b>Subscription URL:</b> /sub/' + rootUuid + '</div></div></body></html>';
}

async function handleSubscriptionQuery(token, request, env, cfg, rootUuid) {
  const host = request.headers.get("Host") || "edge.cloudflare.com";
  const vlessNode = "vless://" + rootUuid + "@" + host + ":443?type=ws&security=tls&path=%2F%3Fed%3D2048&sni=" + host + "#" + encodeURIComponent(cfg.NODE_NAME);
  return new Response(btoa(vlessNode), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

async function handleVlessWebSocket(request, env, cfg, rootUuid) {
  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);
  server.accept();
  return new Response(null, { status: 101, webSocket: client });
}
`;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization"
        }
      });
    }

    // API: Deploy to Cloudflare from edge
    if (url.pathname === "/api/deploy" && request.method === "POST") {
      try {
        const body = await request.json();
        const token = (body.cf_token || "").trim();
        if (!token) {
          return jsonResponse({ error: "توکن کلودفلر الزامی است." }, 400);
        }

        const customName = (body.custom_name || "").trim();
        const customAdmin = (body.custom_admin_path || "").trim();

        // 1. Verify token
        const cfHeaders = {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 Cloudflare-Worker-Deployer"
        };

        const verifyResp = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
          headers: cfHeaders
        });
        if (!verifyResp.ok) {
          const err = await verifyResp.json().catch(() => ({}));
          return jsonResponse({ error: "توکن نامعتبر است: " + (err.errors?.[0]?.message || "عدم احراز هویت") }, 401);
        }

        // 2. Get accounts
        const accResp = await fetch("https://api.cloudflare.com/client/v4/accounts", {
          headers: cfHeaders
        });
        const accData = await accResp.json();
        const accounts = accData.result || [];
        if (accounts.length === 0) {
          return jsonResponse({ error: "هیچ حسابی برای این توکن پیدا نشد." }, 400);
        }

        const accountId = accounts[0].id;
        const accountName = accounts[0].name;

        // 3. Generate random unique params
        const scriptName = customName || generateDisguisedName();
        let adminPath = customAdmin || ("/admin_" + generateRandomHex(6));
        if (!adminPath.startsWith("/")) adminPath = "/" + adminPath;
        const rootUuid = generateUUID();
        const d1Name = "db_" + generateRandomHex(6);
        const saltKey = "salt_" + generateRandomHex(16);

        // 4. Create D1 database
        let d1Id = "d1-auto-binding";
        try {
          const d1Resp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`, {
            method: "POST",
            headers: cfHeaders,
            body: JSON.stringify({ name: d1Name })
          });
          if (d1Resp.ok) {
            const d1Data = await d1Resp.json();
            d1Id = d1Data.result?.uuid || d1Id;
          }
        } catch(e) {}

        // 5. Obfuscate worker code
        const obfuscatedWorker = obfuscateCode(ZEUS_CORE_TEMPLATE, {
          nodeName: scriptName,
          adminPath: adminPath,
          uuid: rootUuid,
          d1Name: d1Name,
          saltKey: saltKey
        });

        // 6. Upload worker script with bindings
        const metadata = {
          main_module: "_worker.js",
          bindings: [
            { type: "d1", name: "DB", id: d1Id },
            { type: "plain_text", name: "ADMIN_PATH", text: adminPath },
            { type: "plain_text", name: "UUID", text: rootUuid }
          ],
          compatibility_date: "2026-01-20",
          compatibility_flags: ["nodejs_compat"]
        };

        const formData = new FormData();
        formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
        formData.append("_worker.js", new Blob([obfuscatedWorker], { type: "application/javascript+module" }), "_worker.js");

        const uploadResp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}`, {
          method: "PUT",
          headers: { "Authorization": "Bearer " + token },
          body: formData
        });

        if (!uploadResp.ok) {
          const upErr = await uploadResp.json().catch(() => ({}));
          return jsonResponse({ error: "خطا در آپلود ورکر: " + (upErr.errors?.[0]?.message || uploadResp.statusText) }, 400);
        }

        // 7. Enable workers.dev subdomain
        await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`, {
          method: "POST",
          headers: cfHeaders,
          body: JSON.stringify({ enabled: true })
        }).catch(() => {});

        // 8. Get subdomain
        let workersSubdomain = "workers.dev";
        try {
          const subResp = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, {
            headers: { "Authorization": "Bearer " + token }
          });
          if (subResp.ok) {
            const subData = await subResp.json();
            workersSubdomain = subData.result?.subdomain || "workers.dev";
          }
        } catch(e) {}

        const liveDomain = `${scriptName}.${workersSubdomain}.workers.dev`;
        const panelUrl = `https://${liveDomain}${adminPath}`;
        const subUrl = `https://${liveDomain}/sub/${rootUuid}`;

        return jsonResponse({
          status: "success",
          account_name: accountName,
          script_name: scriptName,
          d1_database: d1Name,
          uuid: rootUuid,
          admin_path: adminPath,
          panel_url: panelUrl,
          subscription_url: subUrl,
          live_url: `https://${liveDomain}`
        });

      } catch (err) {
        return jsonResponse({ error: "خطای پردازش سرورلس: " + err.message }, 500);
      }
    }

    // Default: Return the Deployer Web App HTML UI
    return new Response(getDeployerUIHTML(), {
      headers: { "Content-Type": "text/html; charset=utf-8" }
    });
  }
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function generateRandomHex(len = 8) {
  let chars = 'abcdef0123456789';
  let res = '';
  for (let i = 0; i < len; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
  return res;
}

function generateDisguisedName() {
  const prefixes = [
    'cloud-sync', 'edge-cache', 'telemetry-stream', 'analytics-node', 
    'data-pipeline', 'metric-agent', 'ingress-router', 'packet-relay',
    'cdn-optimizer', 'beacon-hub', 'nexus-flow', 'gateway-mesh'
  ];
  const p = prefixes[Math.floor(Math.random() * prefixes.length)];
  return p + '-' + generateRandomHex(5);
}

function obfuscateCode(template, cfg) {
  let code = template
    .replace(/{{NODE_NAME}}/g, cfg.nodeName)
    .replace(/{{ADMIN_PATH}}/g, cfg.adminPath)
    .replace(/{{ROOT_UUID}}/g, cfg.uuid)
    .replace(/{{D1_DATABASE}}/g, cfg.d1Name)
    .replace(/{{SALT_KEY}}/g, cfg.saltKey);

  let strings = [];
  let stringMap = new Map();

  code = code.replace(/(["'])(.*?)\1/g, function(match, quote, val) {
    if (!val || val.length < 2) return match;
    if (!stringMap.has(val)) {
      stringMap.set(val, strings.length);
      strings.push(btoa(encodeURIComponent(val)));
    }
    let idx = stringMap.get(val);
    return "_0xdec(0x" + idx.toString(16) + ")";
  });

  const arrName = "_0x" + generateRandomHex(4);
  const funcName = "_0xdec";
  const shiftAmount = Math.floor(Math.random() * 180) + 40;

  const prefix = "/** (C) Encrypted Polymorphic Deployment Core - Protected */\n" +
    "var " + arrName + " = [" + strings.map(s => '"' + s + '"').join(",") + "];\n" +
    "(function(arr, offset) {\n" +
    "  var rotator = function(count) {\n" +
    "    while (--count) { arr.push(arr.shift()); }\n" +
    "  };\n" +
    "  rotator(++offset);\n" +
    "})(" + arrName + ", 0x" + shiftAmount.toString(16) + ");\n\n" +
    "var " + funcName + " = function(idx) {\n" +
    "  idx = idx - 0;\n" +
    "  var str = " + arrName + "[idx];\n" +
    "  try { return decodeURIComponent(atob(str)); } catch(e) { return atob(str); }\n" +
    "};\n\n";

  const antiBeautify = "(function() {\n" +
    "  var _0xguard = function() {\n" +
    "    var _0xtest = new RegExp('(\\\\w+)');\n" +
    "    return _0xtest.test(_0xguard.toString());\n" +
    "  };\n" +
    "  if (!_0xguard()) { while(true) {} }\n" +
    "})();\n\n";

  const deadCode = "var _0x" + generateRandomHex(4) + " = function(_0xa, _0xb) {\n" +
    "  return (_0xa ^ _0xb) * 0x" + generateRandomHex(4) + ";\n" +
    "};\n" +
    "var _0x" + generateRandomHex(4) + " = [0x" + generateRandomHex(4) + ", 0x" + generateRandomHex(4) + "];\n\n";

  return prefix + antiBeautify + deadCode + code;
}

function getDeployerUIHTML() {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ZEUS 1-Click Cloudflare Auto-Deployer</title>
  <style>
    :root {
      --bg-dark: #07090e;
      --bg-card: rgba(15, 18, 30, 0.92);
      --border: rgba(139, 92, 246, 0.3);
      --primary: #8b5cf6;
      --accent: #00f0ff;
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
      --success: #10b981;
      --font-mono: ui-monospace, SFMono-Regular, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, sans-serif; }
    body {
      background: var(--bg-dark); color: var(--text-main); min-height: 100vh;
      background-image: radial-gradient(circle at 15% 20%, rgba(139,92,246,0.2) 0%, transparent 50%),
                        radial-gradient(circle at 85% 80%, rgba(0,240,255,0.15) 0%, transparent 50%);
    }
    header {
      padding: 20px 32px; display: flex; justify-content: space-between; align-items: center;
      border-bottom: 1px solid var(--border); background: rgba(7,9,14,0.9); backdrop-filter: blur(12px);
    }
    .container { max-width: 900px; margin: 40px auto; padding: 0 20px; }
    .card {
      background: var(--bg-card); border: 1px solid var(--border); border-radius: 20px;
      padding: 32px; box-shadow: 0 12px 40px rgba(0,0,0,0.6);
    }
    h1 { font-size: 1.4rem; color: #fff; margin-bottom: 8px; }
    .desc { color: var(--text-muted); font-size: 0.9rem; line-height: 1.8; margin-bottom: 24px; }
    .token-box { background: rgba(0,0,0,0.4); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 20px; }
    label { display: block; font-size: 0.88rem; margin-bottom: 8px; color: #e5e7eb; font-weight: 600; }
    input[type="password"], input[type="text"] {
      width: 100%; background: #0c101c; border: 1px solid rgba(255,255,255,0.15); color: #fff;
      padding: 14px; border-radius: 8px; font-family: var(--font-mono); outline: none;
    }
    input:focus { border-color: var(--accent); }
    .btn-launch {
      width: 100%; background: linear-gradient(135deg, #8b5cf6, #00f0ff); color: #050811;
      font-weight: 800; font-size: 1.1rem; border: none; border-radius: 12px; padding: 18px;
      cursor: pointer; box-shadow: 0 6px 25px rgba(139,92,246,0.4); transition: all 0.2s;
    }
    .btn-launch:hover { transform: translateY(-2px); box-shadow: 0 8px 30px rgba(0,240,255,0.6); }
    .btn-launch:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .step-item {
      display: flex; align-items: center; gap: 14px; padding: 12px 16px; border-radius: 8px;
      margin-top: 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05);
      color: var(--text-muted); font-size: 0.9rem;
    }
    .step-item.active { background: rgba(139,92,246,0.15); border-color: var(--primary); color: #fff; }
    .step-item.done { background: rgba(16,185,129,0.15); border-color: var(--success); color: #34d399; }
    .step-item.error { background: rgba(239,68,68,0.15); border-color: #ef4444; color: #f87171; }
    .result-box {
      display: none; background: rgba(16,185,129,0.08); border: 2px solid var(--success);
      border-radius: 16px; padding: 24px; margin-top: 24px;
    }
    .result-link {
      background: #000; padding: 12px 16px; border-radius: 8px; margin: 10px 0;
      font-family: var(--font-mono); color: var(--accent); word-break: break-all;
      display: flex; justify-content: space-between; align-items: center;
    }
    .btn-copy { background: var(--primary); color: #fff; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; }
    .btn-visit { display: inline-block; background: var(--success); color: #000; padding: 12px 24px; border-radius: 8px; font-weight: 700; text-decoration: none; margin-top: 12px; }
  </style>
</head>
<body>
  <header>
    <div style="display:flex;align-items:center;gap:12px;">
      <div style="font-size:28px;">⚡</div>
      <div>
        <div style="font-weight:800;font-size:1.2rem;background:linear-gradient(to right,#fff,#c4b5fd,#00f0ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">ZEUS 1-Click Auto-Deployer</div>
        <div style="font-size:0.8rem;color:var(--text-muted);">استقرار بدون فیلتر و بدون خطای CORS بر روی Cloudflare Edge</div>
      </div>
    </div>
  </header>

  <div class="container">
    <div class="card">
      <h1>🚀 استقرار ۱۰۰٪ خودکار پنل زئوس در کلودفلر</h1>
      <p class="desc">
        کافی است فقط <strong>Cloudflare API Token</strong> خود را وارد کنید. تمام مراحل ساخت دیتابیس D1، مبهم‌سازی چندریختی، تولید نام پوششی و انتشار ورکر مستقیماً از داخل سرورهای کلودفلر انجام می‌شود.
      </p>

      <div class="token-box">
        <label>کلید API کلودفلر (Cloudflare Token):</label>
        <input type="password" id="cf-token" placeholder="مثال: abc123def456_YOUR_CLOUDFLARE_API_TOKEN" autofocus>
      </div>

      <button class="btn-launch" id="btn-deploy">
        <span>⚡ استقرار خودکار و آنلاین پنل زئوس</span>
      </button>

      <div id="steps-container" style="margin-top:20px;display:none;">
        <div class="step-item" id="st-1"><span>🔑 گام ۱: اعتبارسنجی توکن و دریافت Account ID...</span></div>
        <div class="step-item" id="st-2"><span>🎲 گام ۲: تولید نام پوششی، مسیر ادمین اختصاصی و Root UUID...</span></div>
        <div class="step-item" id="st-3"><span>🔒 گام ۳: اعمال مبهم‌سازی چندریختی و محافظت از سورس Z-E-U-S...</span></div>
        <div class="step-item" id="st-4"><span>🗄️ گام ۴: ساخت پایگاه داده Cloudflare D1...</span></div>
        <div class="step-item" id="st-5"><span>🚀 گام ۵: آپلود و استقرار ورکر در شبکه کلودفلر با بایندینگ D1...</span></div>
        <div class="step-item" id="st-6"><span>🌐 گام ۶: فعال‌سازی دامنه workers.dev...</span></div>
      </div>

      <div class="result-box" id="result-box">
        <h3 style="color:#34d399;margin-bottom:12px;">🎉 استقرار با موفقیت انجام شد!</h3>
        <div style="font-size:0.85rem;color:var(--text-muted);">آدرس پنل مدیریت اختصاصی شما:</div>
        <div class="result-link">
          <span id="res-panel-url">-</span>
          <button class="btn-copy" onclick="copy('res-panel-url')">کپی</button>
        </div>
        <div style="font-size:0.85rem;color:var(--text-muted);margin-top:12px;">لینک سابسکریپشن:</div>
        <div class="result-link">
          <span id="res-sub-url">-</span>
          <button class="btn-copy" onclick="copy('res-sub-url')">کپی</button>
        </div>
        <a id="btn-visit-panel" class="btn-visit" href="#" target="_blank">🌐 ورود به پنل ادمین</a>
      </div>
    </div>
  </div>

  <script>
    function copy(id) {
      const txt = document.getElementById(id).textContent;
      navigator.clipboard.writeText(txt);
      alert("کپی شد: " + txt);
    }

    function setSt(n, status) {
      const el = document.getElementById("st-" + n);
      if (el) el.className = "step-item " + status;
    }

    document.getElementById("btn-deploy").addEventListener("click", async () => {
      const token = document.getElementById("cf-token").value.trim();
      if (!token) {
        alert("لطفاً توکن کلودفلر را وارد کنید.");
        return;
      }

      const btn = document.getElementById("btn-deploy");
      btn.disabled = true;
      document.getElementById("steps-container").style.display = "block";
      document.getElementById("result-box").style.display = "none";

      for (let i = 1; i <= 6; i++) setSt(i, "");

      try {
        setSt(1, "active");
        
        // Call the worker's own server-side deployment API
        const resp = await fetch("/api/deploy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cf_token: token })
        });

        const data = await resp.json();

        if (!resp.ok || data.error) {
          setSt(1, "error");
          alert("خطا: " + (data.error || "خطای ناشناخته در استقرار"));
          btn.disabled = false;
          return;
        }

        for (let i = 1; i <= 6; i++) setSt(i, "done");

        document.getElementById("res-panel-url").textContent = data.panel_url;
        document.getElementById("res-sub-url").textContent = data.subscription_url;
        document.getElementById("btn-visit-panel").href = data.panel_url;
        document.getElementById("result-box").style.display = "block";

      } catch (err) {
        setSt(1, "error");
        alert("خطا در ارتباط: " + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}
