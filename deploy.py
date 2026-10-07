import os
import sys
import json
import uuid
import secrets
import argparse
import base64
import urllib.parse
import httpx

DISGUISED_PREFIXES = [
    "cloud-sync", "edge-cache", "telemetry-stream", "analytics-node",
    "data-pipeline", "metric-agent", "ingress-router", "packet-relay",
    "cdn-optimizer", "beacon-hub", "nexus-flow", "gateway-mesh"
]

def generate_random_name(prefix=""):
    if not prefix:
        prefix = secrets.choice(DISGUISED_PREFIXES)
    return f"{prefix}-{secrets.token_hex(3)}"

def generate_admin_path():
    return f"/admin_{secrets.token_hex(4)}"

def generate_uuid():
    return str(uuid.uuid4())

def generate_d1_name():
    return f"db_{secrets.token_hex(4)}"

def get_base_template():
    template_file = os.path.join(os.path.dirname(__file__), "zeus_core.js")
    if os.path.exists(template_file):
        with open(template_file, "r", encoding="utf-8") as f:
            return f.read()
    return """/**
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

    if (url.pathname === CONFIG.ADMIN_PATH || url.pathname === CONFIG.ADMIN_PATH + "/") {
      return new Response(generateAdminPanelHTML(CONFIG), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }

    if (url.pathname.startsWith("/sub/")) {
      const userToken = url.pathname.split("/sub/")[1];
      return handleSubscriptionQuery(userToken, request, env, CONFIG);
    }

    if (upgradeHeader && upgradeHeader.toLowerCase() === "websocket") {
      return handleVlessWebSocket(request, env, CONFIG);
    }

    return new Response("Service Operational - " + CONFIG.NODE_NAME, { status: 200 });
  }
};

function generateAdminPanelHTML(cfg) {
  return '<!DOCTYPE html><html><head><title>' + cfg.NODE_NAME + '</title></head>' +
         '<body style="background:#0b0d14;color:#fff;font-family:sans-serif;text-align:center;padding:50px;">' +
         '<h1 style="color:#8b5cf6;">⚡ ' + cfg.NODE_NAME + '</h1>' +
         '<p style="color:#9ca3af;">Protected Panel Core Active</p>' +
         '<div style="margin-top:20px;padding:15px;background:#131726;border-radius:8px;display:inline-block;">' +
         'UUID: ' + cfg.ROOT_UUID + '<br>Admin Path: ' + cfg.ADMIN_PATH + '</div>' +
         '</body></html>';
}

async function handleSubscriptionQuery(token, request, env, cfg) {
  const host = request.headers.get("Host") || "edge.cloudflare.com";
  const vlessNode = "vless://" + cfg.ROOT_UUID + "@" + host + ":443?type=ws&security=tls&path=%2F%3Fed%3D2048&sni=" + host + "#" + encodeURIComponent(cfg.NODE_NAME);
  return new Response(btoa(vlessNode), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

async function handleVlessWebSocket(request, env, cfg) {
  const webSocketPair = new WebSocketPair();
  const [client, server] = Object.values(webSocketPair);
  server.accept();
  return new Response(null, { status: 101, webSocket: client });
}
"""

def obfuscate_code(source_code, config):
    code = source_code
    code = code.replace("{{NODE_NAME}}", config["repo_name"])
    code = code.replace("{{ADMIN_PATH}}", config["admin_path"])
    code = code.replace("{{ROOT_UUID}}", config["uuid"])
    code = code.replace("{{D1_DATABASE}}", config["d1_name"])
    code = code.replace("{{SALT_KEY}}", config["salt"])

    string_list = []
    string_map = {}

    import re
    def string_replacer(match):
        val = match.group(2)
        if not val or len(val) < 2:
            return match.group(0)
        if val not in string_map:
            string_map[val] = len(string_list)
            encoded = base64.b64encode(urllib.parse.quote(val).encode("utf-8")).decode("utf-8")
            string_list.append(encoded)
        idx = string_map[val]
        return f"_0xdec(0x{idx:x})"

    code = re.sub(r'(["\'])(.*?)\1', string_replacer, code)

    arr_name = f"_0x{secrets.token_hex(2)}"
    func_name = "_0xdec"
    rotator_offset = secrets.randbelow(150) + 50

    strings_joined = ",".join(f'"{s}"' for s in string_list)
    prefix_code = f"""/** (C) Polymorphic Edge Deployment Core - Protected */
var {arr_name} = [{strings_joined}];
(function(arr, offset) {{
  var rotator = function(count) {{
    while (--count) {{ arr.push(arr.shift()); }}
  }};
  rotator(++offset);
}})({arr_name}, 0x{rotator_offset:x});

var {func_name} = function(idx) {{
  idx = idx - 0;
  var str = {arr_name}[idx];
  try {{
    return decodeURIComponent(atob(str));
  }} catch(e) {{
    return atob(str);
  }}
}};
"""
    anti_beautify = """(function() {
  var _0xguard = function() {
    var _0xtest = new RegExp('(\\\\w+)');
    return _0xtest.test(_0xguard.toString());
  };
  if (!_0xguard()) { while(true) {} }
})();
"""
    dead_code = f"""var _0x{secrets.token_hex(2)} = function(_0xa, _0xb) {{
  return (_0xa ^ _0xb) * 0x{secrets.token_hex(2)};
}};
var _0x{secrets.token_hex(2)} = [0x{secrets.token_hex(2)}, 0x{secrets.token_hex(2)}];
"""
    return f"{prefix_code}\n{anti_beautify}\n{dead_code}\n{code}"

def deploy(token, custom_name="", custom_admin_path=""):
    token = token.strip()
    if not token:
        print("[ERROR] Cloudflare API Token is required.")
        sys.exit(1)

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    with httpx.Client(timeout=45.0) as client:
        print("[1/6] Verifying Cloudflare Token ...")
        v = client.get("https://api.cloudflare.com/client/v4/user/tokens/verify", headers=headers)
        if v.status_code != 200:
            print(f"[ERROR] Token verification failed: {v.text}")
            sys.exit(1)

        print("[2/6] Detecting Cloudflare Account ID ...")
        acc = client.get("https://api.cloudflare.com/client/v4/accounts", headers=headers)
        if acc.status_code != 200:
            print(f"[ERROR] Failed to fetch accounts: {acc.text}")
            sys.exit(1)

        accounts = acc.json().get("result", [])
        if not accounts:
            print("[ERROR] No Cloudflare account found.")
            sys.exit(1)

        account_id = accounts[0]["id"]
        account_name = accounts[0]["name"]
        print(f"[*] Account: {account_name} ({account_id})")

        # Parameters
        script_name = custom_name.strip() or generate_random_name()
        admin_path = custom_admin_path.strip() or generate_admin_path()
        if not admin_path.startswith("/"):
            admin_path = "/" + admin_path
        uuid_str = generate_uuid()
        d1_name = generate_d1_name()
        salt = secrets.token_hex(16)

        print(f"[*] Unique Script Name: {script_name}")
        print(f"[*] Unique Admin Path: {admin_path}")
        print(f"[*] Unique Root UUID: {uuid_str}")

        print("[3/6] Creating Cloudflare D1 Database ...")
        d1_resp = client.post(
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database",
            headers=headers,
            json={"name": d1_name}
        )
        d1_id = "d1-auto-binding"
        if d1_resp.status_code in (200, 201):
            d1_id = d1_resp.json().get("result", {}).get("uuid", d1_id)
            print(f"[*] D1 Database Created: {d1_name} (ID: {d1_id})")
        else:
            print(f"[WARN] D1 creation returned {d1_resp.status_code}, using fallback binding.")

        print("[4/6] Applying Polymorphic Obfuscation to Zeus source ...")
        config = {
            "repo_name": script_name,
            "admin_path": admin_path,
            "uuid": uuid_str,
            "d1_name": d1_name,
            "salt": salt
        }
        obfuscated_code = obfuscate_code(get_base_template(), config)

        print("[5/6] Deploying Worker to Cloudflare edge ...")
        metadata = {
            "main_module": "_worker.js",
            "bindings": [
                {"type": "d1", "name": "DB", "id": d1_id},
                {"type": "plain_text", "name": "ADMIN_PATH", "text": admin_path},
                {"type": "plain_text", "name": "UUID", "text": uuid_str}
            ],
            "compatibility_date": "2026-01-20",
            "compatibility_flags": ["nodejs_compat"]
        }
        files = {
            "metadata": (None, json.dumps(metadata), "application/json"),
            "_worker.js": ("_worker.js", obfuscated_code, "application/javascript+module")
        }
        upload_resp = client.put(
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/{script_name}",
            headers={"Authorization": f"Bearer {token}"},
            files=files
        )
        if upload_resp.status_code not in (200, 201):
            print(f"[ERROR] Worker upload failed: {upload_resp.text}")
            sys.exit(1)

        print("[6/6] Enabling workers.dev Subdomain ...")
        client.post(
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/{script_name}/subdomain",
            headers=headers,
            json={"enabled": True}
        )
        sub_resp = client.get(
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/subdomain",
            headers=headers
        )
        workers_sub = "workers.dev"
        if sub_resp.status_code == 200:
            workers_sub = sub_resp.json().get("result", {}).get("subdomain", "workers.dev")

        live_domain = f"{script_name}.{workers_sub}.workers.dev"
        panel_url = f"https://{live_domain}{admin_path}"
        sub_url = f"https://{live_domain}/sub/{uuid_str}"

        print("\n" + "="*60)
        print("🎉 ZEUS PANEL SUCCESSFULLY DEPLOYED TO CLOUDFLARE!")
        print("="*60)
        print(f"[*] Panel URL:        {panel_url}")
        print(f"[*] Subscription URL: {sub_url}")
        print(f"[*] Worker Name:      {script_name}")
        print(f"[*] Admin Secret:     {admin_path}")
        print(f"[*] Root UUID:        {uuid_str}")
        print(f"[*] D1 Database:      {d1_name}")
        print("="*60 + "\n")

        # GitHub Step Summary support
        summary_file = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary_file:
            with open(summary_file, "a", encoding="utf-8") as sf:
                sf.write(f"""## 🎉 ZEUS Panel Deployment Successful!
- **🌐 Admin Panel**: [{panel_url}]({panel_url})
- **🔗 Subscription**: `{sub_url}`
- **🏷️ Worker Name**: `{script_name}`
- **🔒 Admin Secret Path**: `{admin_path}`
- **🔑 Root UUID**: `{uuid_str}`
- **🗄️ D1 Database**: `{d1_name}`
""")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ZEUS Polymorphic 1-Click Deployer")
    parser.add_argument("--token", required=True, help="Cloudflare API Token")
    parser.add_argument("--name", default="", help="Optional disguised worker name")
    parser.add_argument("--admin-path", default="", help="Optional admin secret path")
    args = parser.parse_args()

    deploy(args.token, args.name, args.admin_path)
