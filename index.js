import { connect } from "cloudflare:sockets";

// Variables
const rootDomain = ""; // Ganti dengan domain utama kalian
const serviceName = ""; // Ganti dengan nama workers kalian
const apiKey = "fd337fa91b9a1fc4d867f941d560dbbeb7c19"; // Ganti dengan Global API key kalian (https://dash.cloudflare.com/profile/api-tokens)
const apiEmail = "ex.bal27389@gmail.com"; // Ganti dengan email yang kalian gunakan
const accountID = "1f8c8ff6943731c4bf5fa0705311fe98"; // Ganti dengan Account ID kalian (https://dash.cloudflare.com -> Klik domain yang kalian gunakan)
const zoneID = "0a3a59fed4f26e128ab1ae2eb59f252a"; // Ganti dengan Zone ID kalian (https://dash.cloudflare.com -> Klik domain yang kalian gunakan)
let isApiReady = false;
let proxyIP = "";
let cachedProxyList = [];
let cachedCountryCodes = [];

// Constant
const APP_DOMAIN = `${serviceName}.${rootDomain}`;
const PORTS = [443, 80];
const PROTOCOLS = [reverse("najort"), reverse("sselv"), reverse("ss")];
const KV_PROXY_KEY = "kvProxyList.json";

const DNS_SERVER_ADDRESS = "8.8.8.8";
const DNS_SERVER_PORT = 53;
const PROXY_HEALTH_CHECK_API = `https://health.ex27.my.id/check`; // Menggunakan dedicated health worker
const CONVERTER_URL = "https://api.foolvpn.me/convert";
const DONATE_LINK = "https://trakteer.id/dickymuliafiqri/tip";
const PROXY_PER_PAGE = 24;
const WS_READY_STATE_OPEN = 1;
const WS_READY_STATE_CLOSING = 2;
const CORS_HEADER_OPTIONS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

async function getKVProxyList(kvProxyUrl = KV_PROXY_URL) {
  // Fungsi ini sekarang menerima env sebagai argumen
  if (!arguments[0] || !arguments[0].PROXY_KV) {
    throw new Error("No KV binding provided!");
  }
  const env = arguments[0];
  const kvProxy = await env.PROXY_KV.get(KV_PROXY_KEY);
  if (kvProxy) {
    try {
      return JSON.parse(kvProxy);
    } catch (e) {
      return {};
    }
  } else {
    return {};
  }
}

// Removed legacy flat list loader (proxyList.txt). Use getProxyListByCountryCodes(env, cc) instead.

// Cache sederhana per negara agar tidak fetch berulang
const countryCache = new Map();

// Baca daftar proxy berdasarkan kode negara (bisa multi, dipisah koma)
async function getProxyListByCountryCodes(env, countryCodes) {
  if (!env || !env.PROXY_KV) {
    throw new Error("No KV binding provided!");
  }
  const codes = (countryCodes || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (codes.length === 0) return [];

  const results = await Promise.all(
    codes.map(async (cc) => {
      if (countryCache.has(cc)) return countryCache.get(cc);
      const key = `proxyList_${cc}.txt`;
      const text = await env.PROXY_KV.get(key);
      if (!text) {
        countryCache.set(cc, []);
        return [];
      }
      const list = text
        .split("\n")
        .filter(Boolean)
        .map((entry) => {
          const [proxyIP, proxyPort, country, org] = entry.split(",");
          return {
            proxyIP: proxyIP || "Unknown",
            proxyPort: proxyPort || "Unknown",
            country: country || cc,
            org: org || "Unknown Org",
          };
        });
      countryCache.set(cc, list);
      return list;
    })
  );

  return results.flat();
}

// Ambil daftar kode negara dari KV berdasarkan key yang tersedia (proxyList_XX.txt)
async function getAvailableCountryCodes(env) {
  if (cachedCountryCodes.length) return cachedCountryCodes;
  if (!env || !env.PROXY_KV) {
    throw new Error("No KV binding provided!");
  }
  const found = new Set();
  let cursor = undefined;
  do {
    const list = await env.PROXY_KV.list({ prefix: "proxyList_", cursor });
    for (const k of list.keys || []) {
      const m = k.name.match(/^proxyList_(\w{2})\.txt$/i);
      if (m) found.add(m[1].toUpperCase());
    }
    cursor = list.cursor;
  } while (cursor);
  cachedCountryCodes = Array.from(found).sort();
  return cachedCountryCodes;
}

async function reverseProxy(request, target, targetPath) {
  const targetUrl = new URL(request.url);
  const targetChunk = target.split(":");

  targetUrl.hostname = targetChunk[0];
  targetUrl.port = targetChunk[1]?.toString() || "443";
  targetUrl.pathname = targetPath || targetUrl.pathname;

  const modifiedRequest = new Request(targetUrl, request);

  modifiedRequest.headers.set("X-Forwarded-Host", request.headers.get("Host"));

  const response = await fetch(modifiedRequest);

  const newResponse = new Response(response.body, response);
  for (const [key, value] of Object.entries(CORS_HEADER_OPTIONS)) {
    newResponse.headers.set(key, value);
  }
  newResponse.headers.set("X-Proxied-By", "Cloudflare Worker");

  return newResponse;
}



function getAllConfig(request, hostName, proxyList, page = 0) {
  const startIndex = PROXY_PER_PAGE * page;

  try {
    const uuid = crypto.randomUUID();

    // Build URI
    const uri = new URL(`${reverse("najort")}://${hostName}`);
    uri.searchParams.set("encryption", "none");
    uri.searchParams.set("type", "ws");
    uri.searchParams.set("host", hostName);

    // Build HTML
    const document = new Document(request);
    document.setTitle("Welcome to <span class='text-blue-500 font-semibold'>Nautica</span>");
    document.addInfo(`Total: ${proxyList.length}`);
    document.addInfo(`Page: ${page}/${Math.floor(proxyList.length / PROXY_PER_PAGE)}`);

    for (let i = startIndex; i < startIndex + PROXY_PER_PAGE; i++) {
      const proxy = proxyList[i];
      if (!proxy) break;

      const { proxyIP, proxyPort, country, org } = proxy;

      uri.searchParams.set("path", `/${proxyIP}-${proxyPort}`);

      const proxies = [];
      for (const port of PORTS) {
        uri.port = port.toString();
        uri.hash = `${i + 1} ${getFlagEmoji(country)} ${org} WS ${port == 443 ? "TLS" : "NTLS"} [${serviceName}]`;
        for (const protocol of PROTOCOLS) {
          // Special exceptions
          if (protocol === "ss") {
            uri.username = btoa(`none:${uuid}`);
            uri.searchParams.set(
              "plugin",
              `v2ray-plugin${
                port == 80 ? "" : ";tls"
              };mux=0;mode=websocket;path=/${proxyIP}-${proxyPort};host=${hostName}`
            );
          } else {
            uri.username = uuid;
            uri.searchParams.delete("plugin");
          }

          uri.protocol = protocol;
          uri.searchParams.set("security", port == 443 ? "tls" : "none");
          uri.searchParams.set("sni", port == 80 && protocol == reverse("sselv") ? "" : hostName);

          // Build VPN URI
          let uriString = uri.toString();
          
          proxies.push(uriString);
        }
      }
      document.registerProxies(
        {
          proxyIP,
          proxyPort,
          country,
          org,
        },
        proxies
      );
    }

    // Build pagination
    document.addPageButton("Prev", `/sub/${page > 0 ? page - 1 : 0}`, page > 0 ? false : true);
    document.addPageButton("Next", `/sub/${page + 1}`, page < Math.floor(proxyList.length / 10) ? false : true);

    return document.build();
  } catch (error) {
    return `An error occurred while generating the ${reverse("SSELV")} configurations. ${error}`;
  }
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const upgradeHeader = request.headers.get("Upgrade");

      // Gateway check
      if (apiKey && apiEmail && accountID && zoneID) {
        isApiReady = true;
      }

      // Handle proxy client
      if (upgradeHeader === "websocket") {
        const proxyMatch = url.pathname.match(/^\/(.+[:=-]\d+)$/);

        if (url.pathname.length == 3 || url.pathname.match(",")) {
          // Contoh: /ID, /SG, dll
          const proxyKeys = url.pathname.replace("/", "").toUpperCase().split(",");
          // Load proxies by requested country codes and pick one randomly
          const proxies = await getProxyListByCountryCodes(env, proxyKeys.join(","));
          if (!proxies.length) return new Response("No proxy available for requested country", { status: 404 });
          const pick = proxies[Math.floor(Math.random() * proxies.length)];
          proxyIP = `${pick.proxyIP}-${pick.proxyPort}`;
          return await websocketHandler(request);
        } else if (proxyMatch) {
          proxyIP = proxyMatch[1];
          return await websocketHandler(request);
        }
      }

      if (url.pathname.startsWith("/sub")) {
        const page = url.pathname.match(/^\/sub\/(\d+)$/);
        const pageIndex = parseInt(page ? page[1] : "0");
        const hostname = request.headers.get("Host");

        // Ambil cc dari query, default ID (memuat hanya negara yang diminta)
        const ccParam = url.searchParams.get("cc") || "ID";
        let proxyList = await getProxyListByCountryCodes(env, ccParam);
        // Scan daftar negara untuk dropdown
        try { cachedCountryCodes = await getAvailableCountryCodes(env); } catch (e) { /* noop */ }

        const result = getAllConfig(request, hostname, proxyList, pageIndex);
        return new Response(result, {
          status: 200,
          headers: { "Content-Type": "text/html;charset=utf-8" },
        });
      } else if (url.pathname.startsWith("/check")) {
        // Health check telah dipindah ke health.ex27.my.id
        return new Response(JSON.stringify({ 
          error: "Health check has been moved",
          new_endpoint: "https://health.ex27.my.id/check",
          message: "Please use the dedicated health worker for better performance"
        }), {
          status: 301,
          headers: {
            ...CORS_HEADER_OPTIONS,
            "Content-Type": "application/json",
            "Location": "https://health.ex27.my.id" + url.pathname + url.search
          },
        });
      } else if (url.pathname.startsWith("/api/v1/check")) {
        // Health check telah dipindah ke health.ex27.my.id
        return new Response(JSON.stringify({ 
          error: "Health check has been moved",
          new_endpoint: "https://health.ex27.my.id/check",
          message: "Please use the dedicated health worker for better performance"
        }), {
          status: 301,
          headers: {
            ...CORS_HEADER_OPTIONS,
            "Content-Type": "application/json",
            "Location": "https://health.ex27.my.id/check" + (url.search || "")
          },
        });
      } else if (url.pathname.startsWith("/api/config") || 
                url.pathname.startsWith("/api/bfr") || 
                url.pathname.startsWith("/api/clash") || 
                url.pathname.startsWith("/api/sfa") || 
                url.pathname.startsWith("/api/v2ray") || 
                url.pathname.startsWith("/api/raw")) {
        // Menentukan format berdasarkan endpoint
        let format = "raw"; // Default format
        if (url.pathname.startsWith("/api/bfr")) format = "bfr";
        else if (url.pathname.startsWith("/api/clash")) format = "clash";
        else if (url.pathname.startsWith("/api/sfa")) format = "sfa";
        else if (url.pathname.startsWith("/api/v2ray")) format = "v2ray";
        else if (url.pathname.startsWith("/api/config")) format = url.searchParams.get("format") || "raw";
        
        // Parameter dasar
        const countryCode = url.searchParams.get("cc") || "ID";
        
        // Parameter protokol (bisa multiple dengan separator koma)
  const protocolParam = url.searchParams.get("protocols") || url.searchParams.get("protocol") || reverse("sselv");
        const protocols = protocolParam.split(",").map(p => {
          // Konversi nama protokol ke format yang digunakan dalam kode
          if (p === reverse("najort")) return reverse("najort");
          if (p === reverse("sselv")) return reverse("sselv");
          if (p.toLowerCase() === "ss") return "ss";
          return p;
        });
        
        // Parameter keamanan (bisa multiple dengan separator koma)
        const securityParam = url.searchParams.get("securities") || url.searchParams.get("security") || "tls";
        const securities = securityParam.split(",");
        
        // Filter port berdasarkan security
        const ports = [];
        for (const security of securities) {
          if (security.toLowerCase() === "tls") ports.push(443);
          if (security.toLowerCase() === "ntls") ports.push(80);
        }
        
        // Parameter tambahan
        const serverIds = url.searchParams.get("servers"); // Opsional, ID server spesifik
        const limit = parseInt(url.searchParams.get("limit") || "0"); // Batasi jumlah server (0 = tidak ada batasan)
        const hostname = request.headers.get("Host");
        
        // Mengambil daftar proxy hanya untuk negara yang diminta
        let proxyList = await getProxyListByCountryCodes(env, countryCode);
        
        // Filter berdasarkan server ID jika ada
        if (serverIds) {
          const serverIdList = serverIds.split(",");
          proxyList = proxyList.filter(proxy => {
            const serverId = `${proxy.proxyIP}-${proxy.proxyPort}`;
            return serverIdList.includes(serverId);
          });
        }
        
        // Acak daftar proxy
        shuffleArray(proxyList);
        
        // Batasi jumlah proxy jika diperlukan
        if (limit > 0 && proxyList.length > limit) {
          proxyList = proxyList.slice(0, limit);
        }
        
        // Menghasilkan konfigurasi
        const uuid = crypto.randomUUID();
        const result = [];
        
        for (const proxy of proxyList) {
          for (const protocol of protocols) {
            for (const port of ports) {
              const uri = new URL(`${protocol}://${hostname}`);
              uri.searchParams.set("encryption", "none");
              uri.searchParams.set("type", "ws");
              uri.searchParams.set("host", hostname);
              uri.searchParams.set("path", `/${proxy.proxyIP}-${proxy.proxyPort}`);
              
              uri.port = port.toString();
              
              // Special exceptions for SS protocol
              if (protocol === "ss") {
                uri.username = btoa(`none:${uuid}`);
                uri.searchParams.set(
                  "plugin",
                  `v2ray-plugin${
                    port == 80 ? "" : ";tls"
                  };mux=0;mode=websocket;path=/${proxy.proxyIP}-${proxy.proxyPort};host=${hostname}`
                );
              } else {
                uri.username = uuid;
                uri.searchParams.delete("plugin");
              }
              
              uri.searchParams.set("security", port == 443 ? "tls" : "none");
              uri.searchParams.set("sni", port == 80 && protocol == reverse("sselv") ? "" : hostname);
              
              // Menambahkan informasi ke hash
              const securityType = port == 443 ? "TLS" : "NTLS";
              uri.hash = `${result.length + 1} ${getFlagEmoji(proxy.country)} ${proxy.org} WS ${securityType} [${serviceName}]`;
              
              // Konversi URI ke string
              let uriString = uri.toString();
              
              result.push(uriString);
            }
          }
        }
        
        // Menghasilkan hasil akhir berdasarkan format
        let finalResult = "";
        let contentType = "text/plain";
        let filename = `${countryCode}-config.txt`;
        
        switch (format) {
          case "raw":
            finalResult = result.join("\n");
            break;
          case "clash":
          case "sfa":
          case "bfr":
          case "v2ray":
            const res = await fetch(CONVERTER_URL, {
              method: "POST",
              body: JSON.stringify({
                url: result.join(","),
                format: format,
                template: "cf",
              }),
            });
            
            if (res.status == 200) {
              finalResult = await res.text();
              // Set filename berdasarkan format
              if (format === "bfr") {
                filename = `${countryCode}-bfr-config.txt`;
              } else if (format === "clash") {
                contentType = "application/yaml";
                filename = `${countryCode}-clash-config.yaml`;
              } else if (format === "sfa") {
                filename = `${countryCode}-sfa-config.txt`;
              } else if (format === "v2ray") {
                contentType = "application/json";
                filename = `${countryCode}-v2ray-config.json`;
              }
            } else {
              return new Response(res.statusText, {
                status: res.status,
                headers: {
                  ...CORS_HEADER_OPTIONS,
                },
              });
            }
            break;
        }
        
        // Mengembalikan hasil
        return new Response(finalResult, {
          status: 200,
          headers: {
            ...CORS_HEADER_OPTIONS,
            "Content-Type": contentType,
            "Content-Disposition": `attachment; filename="${filename}"`,
          },
        });
      } else if (url.pathname.startsWith("/api/servers")) {
        // Endpoint untuk mendapatkan daftar server
        const countryCode = url.searchParams.get("cc") || "ID";
        
        // Mengambil daftar proxy
  let proxyList = await getProxyListByCountryCodes(env, countryCode);
        
        // Mengubah format untuk respons API
        const serverList = proxyList.map((proxy, index) => {
          return {
            id: `${proxy.proxyIP}-${proxy.proxyPort}`,
            ip: proxy.proxyIP,
            port: proxy.proxyPort,
            country: proxy.country,
            org: proxy.org,
            protocols: [reverse("najort")+"-tls", reverse("sselv")+"-tls", "ss-tls", reverse("najort")+"-ntls", reverse("sselv")+"-ntls", "ss-ntls"],
          };
        });
        
        // Mengembalikan daftar server
        return new Response(JSON.stringify(serverList), {
          status: 200,
          headers: {
            ...CORS_HEADER_OPTIONS,
            "Content-Type": "application/json",
          },
        });
      } else if (url.pathname.startsWith("/api/docs")) {
        // Endpoint untuk dokumentasi API
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Proxy API Documentation</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
            h1, h2, h3 { color: #333; }
            code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; }
            pre { background: #f4f4f4; padding: 10px; border-radius: 5px; overflow-x: auto; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; }
          </style>
        </head>
        <body>
          <h1>Proxy API Documentation</h1>
          
          <h2>Main Endpoint</h2>
          <p><code>GET /api/config</code> - Generate configuration in any format</p>
          
          <h3>Parameters:</h3>
          <table>
            <tr><th>Name</th><th>Description</th><th>Default</th></tr>
            <tr><td>cc</td><td>Country code</td><td>ID</td></tr>
            <tr><td>format</td><td>Configuration format (bfr, clash, sfa, v2ray, raw)</td><td>raw</td></tr>
            <tr><td>protocols</td><td>Comma-separated list of protocols (sselv, najort, ss)</td><td>sselv</td></tr>
            <tr><td>securities</td><td>Comma-separated list of security types (tls, ntls)</td><td>tls</td></tr>
            <tr><td>servers</td><td>Optional comma-separated list of server IDs</td><td>All servers</td></tr>
            <tr><td>limit</td><td>Limit number of servers in configuration</td><td>10</td></tr>
          </table>
          
          <h3>Example:</h3>
          <pre>https://${APP_DOMAIN}/api/config?cc=ID&format=bfr&protocols=sselv&securities=tls</pre>
          
          <h2>Format-Specific Endpoints</h2>
          <p>These endpoints use the same parameters as the main endpoint, but with the format pre-set.</p>
          <ul>
            <li><code>GET /api/bfr</code> - Generate BFR configuration</li>
            <li><code>GET /api/clash</code> - Generate Clash configuration</li>
            <li><code>GET /api/sfa</code> - Generate SFA configuration</li>
            <li><code>GET /api/v2ray</code> - Generate V2Ray/Xray configuration</li>
            <li><code>GET /api/raw</code> - Generate Raw configuration</li>
          </ul>
          
          <h2>Server List Endpoint</h2>
          <p><code>GET /api/servers</code> - Get list of available servers</p>
          
          <h3>Parameters:</h3>
          <table>
            <tr><th>Name</th><th>Description</th><th>Default</th></tr>
            <tr><td>cc</td><td>Country code</td><td>ID</td></tr>
          </table>
          
          <h3>Example:</h3>
          <pre>https://${APP_DOMAIN}/api/servers?cc=ID</pre>
        </body>
        </html>
        `;
        
        return new Response(html, {
          status: 200,
          headers: {
            "Content-Type": "text/html;charset=utf-8",
          },
        });
      } else if (url.pathname.startsWith("/api/v1")) {
        const apiPath = url.pathname.replace("/api/v1", "");

        if (apiPath.startsWith("/domains")) {
          if (!isApiReady) {
            return new Response("Api not ready", {
              status: 500,
            });
          }

          const wildcardApiPath = apiPath.replace("/domains", "");
          const cloudflareApi = new CloudflareApi();

          if (wildcardApiPath == "/get") {
            const domains = await cloudflareApi.getDomainList();
            return new Response(JSON.stringify(domains), {
              headers: {
                ...CORS_HEADER_OPTIONS,
              },
            });
          } else if (wildcardApiPath == "/put") {
            const domain = url.searchParams.get("domain");
            const register = await cloudflareApi.registerDomain(domain);

            return new Response(register.toString(), {
              status: register,
              headers: {
                ...CORS_HEADER_OPTIONS,
              },
            });
          }
        } else if (apiPath.startsWith("/sub")) {
          const filterCC = url.searchParams.get("cc")?.split(",") || [];
          const filterPort = url.searchParams.get("port")?.split(",") || PORTS;
          const filterVPN = url.searchParams.get("vpn")?.split(",") || PROTOCOLS;
          const filterLimit = parseInt(url.searchParams.get("limit")) || 10;
          const filterFormat = url.searchParams.get("format") || "raw";
          const fillerDomain = url.searchParams.get("domain") || APP_DOMAIN;

          const ccJoined = (filterCC.length ? filterCC : ["ID"]).join(",");
          const proxyList = await getProxyListByCountryCodes(env, ccJoined).then((proxies) => {
            shuffleArray(proxies);
            return proxies;
          });

          const uuid = crypto.randomUUID();
          const result = [];
          for (const proxy of proxyList) {
            const uri = new URL(`${reverse("najort")}://${fillerDomain}`);
            uri.searchParams.set("encryption", "none");
            uri.searchParams.set("type", "ws");
            uri.searchParams.set("host", APP_DOMAIN);

            for (const port of filterPort) {
              for (const protocol of filterVPN) {
                if (result.length >= filterLimit) break;

                uri.protocol = protocol;
                uri.port = port.toString();
                if (protocol == "ss") {
                  uri.username = btoa(`none:${uuid}`);
                  uri.searchParams.set(
                    "plugin",
                    `v2ray-plugin${port == 80 ? "" : ";tls"};mux=0;mode=websocket;path=/${proxy.proxyIP}-${
                      proxy.proxyPort
                    };host=${APP_DOMAIN}`
                  );
                } else {
                  uri.username = uuid;
                }

                uri.searchParams.set("security", port == 443 ? "tls" : "none");
                uri.searchParams.set("sni", port == 80 && protocol == reverse("sselv") ? "" : APP_DOMAIN);
                uri.searchParams.set("path", `/${proxy.proxyIP}-${proxy.proxyPort}`);

                uri.hash = `${result.length + 1} ${getFlagEmoji(proxy.country)} ${proxy.org} WS ${
                  port == 443 ? "TLS" : "NTLS"
                } [${serviceName}]`;
                
                // Konversi URI ke string
                let uriString = uri.toString();
                
                result.push(uriString);
              }
            }
          }

          let finalResult = "";

          switch (filterFormat) {
            case "raw":
              finalResult = result.join("\n");
              break;
            case "clash":
            case "sfa":
            case "bfr":
              // case "v2ray":

              const res = await fetch(CONVERTER_URL, {
                method: "POST",
                body: JSON.stringify({
                  url: result.join(","),
                  format: filterFormat,
                  template: "cf",
                }),
              });
              if (res.status == 200) {
                finalResult = await res.text();
              } else {
                return new Response(res.statusText, {
                  status: res.status,
                  headers: {
                    ...CORS_HEADER_OPTIONS,
                  },
                });
              }
              break;
          }

          return new Response(finalResult, {
            status: 200,
            headers: {
              ...CORS_HEADER_OPTIONS,
            },
          });
        } else if (apiPath.startsWith("/myip")) {
          return new Response(
            JSON.stringify({
              ip:
                request.headers.get("cf-connecting-ipv6") ||
                request.headers.get("cf-connecting-ip") ||
                request.headers.get("x-real-ip"),
              colo: request.headers.get("cf-ray")?.split("-")[1],
              ...request.cf,
            }),
            {
              headers: {
                ...CORS_HEADER_OPTIONS,
              },
            }
          );
        }
      }

      const targetReverseProxy = env.REVERSE_PROXY_TARGET || "example.com";
      return await reverseProxy(request, targetReverseProxy);
    } catch (err) {
      return new Response(`An error occurred: ${err.toString()}`, {
        status: 500,
        headers: {
          ...CORS_HEADER_OPTIONS,
        },
      });
    }
  },
};

async function websocketHandler(request) {
  const webSocketPair = new WebSocketPair();
  const [client, webSocket] = Object.values(webSocketPair);

  webSocket.accept();

  let addressLog = "";
  let portLog = "";
  const log = (info, event) => {
    console.log(`[${addressLog}:${portLog}] ${info}`, event || "");
  };
  const earlyDataHeader = request.headers.get("sec-websocket-protocol") || "";

  const readableWebSocketStream = makeReadableWebSocketStream(webSocket, earlyDataHeader, log);

  let remoteSocketWrapper = {
    value: null,
  };
  let isDNS = false;

  readableWebSocketStream
    .pipeTo(
      new WritableStream({
        async write(chunk, controller) {
          if (isDNS) {
            return handleUDPOutbound(DNS_SERVER_ADDRESS, DNS_SERVER_PORT, chunk, webSocket, null, log);
          }
          if (remoteSocketWrapper.value) {
            const writer = remoteSocketWrapper.value.writable.getWriter();
            await writer.write(chunk);
            writer.releaseLock();
            return;
          }

          const protocol = await protocolSniffer(chunk);
          let protocolHeader;

          if (protocol === reverse("najorT")) {
            protocolHeader = parseNajortHeader(chunk);
          } else if (protocol === reverse("SSELV")) {
            protocolHeader = parseSselvHeader(chunk);
          } else if (protocol === reverse("skcoswodahS")) {
            protocolHeader = parseSsHeader(chunk);
          } else {
            throw new Error("Unknown Protocol!");
          }

          addressLog = protocolHeader.addressRemote;
          portLog = `${protocolHeader.portRemote} -> ${protocolHeader.isUDP ? "UDP" : "TCP"}`;

          if (protocolHeader.hasError) {
            throw new Error(protocolHeader.message);
          }

          if (protocolHeader.isUDP) {
            if (protocolHeader.portRemote === 53) {
              isDNS = true;
            } else {
              // return handleUDPOutbound(protocolHeader.addressRemote, protocolHeader.portRemote, chunk, webSocket, protocolHeader.version, log);
              throw new Error("UDP only support for DNS port 53");
            }
          }

          if (isDNS) {
            return handleUDPOutbound(
              DNS_SERVER_ADDRESS,
              DNS_SERVER_PORT,
              chunk,
              webSocket,
              protocolHeader.version,
              log
            );
          }

          handleTCPOutBound(
            remoteSocketWrapper,
            protocolHeader.addressRemote,
            protocolHeader.portRemote,
            protocolHeader.rawClientData,
            webSocket,
            protocolHeader.version,
            log
          );
        },
        close() {
          log(`readableWebSocketStream is close`);
        },
        abort(reason) {
          log(`readableWebSocketStream is abort`, JSON.stringify(reason));
        },
      })
    )
    .catch((err) => {
      log("readableWebSocketStream pipeTo error", err);
    });

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

async function protocolSniffer(buffer) {
  if (buffer.byteLength >= 62) {
    const najortDelimiter = new Uint8Array(buffer.slice(56, 60));
    if (najortDelimiter[0] === 0x0d && najortDelimiter[1] === 0x0a) {
      if (najortDelimiter[2] === 0x01 || najortDelimiter[2] === 0x03 || najortDelimiter[2] === 0x7f) {
        if (najortDelimiter[3] === 0x01 || najortDelimiter[3] === 0x03 || najortDelimiter[3] === 0x04) {
          return reverse("najorT");
        }
      }
    }
  }

  const sselvDelimiter = new Uint8Array(buffer.slice(1, 17));
  // Hanya mendukung UUID v4
  if (arrayBufferToHex(sselvDelimiter).match(/^[0-9a-f]{8}[0-9a-f]{4}4[0-9a-f]{3}[89ab][0-9a-f]{3}[0-9a-f]{12}$/i)) {
    return reverse("SSELV");
  }

  return reverse("skcoswodahS"); // default
}

async function handleTCPOutBound(
  remoteSocket,
  addressRemote,
  portRemote,
  rawClientData,
  webSocket,
  responseHeader,
  log
) {
  async function connectAndWrite(address, port) {
    const tcpSocket = connect({
      hostname: address,
      port: port,
    });
    remoteSocket.value = tcpSocket;
    log(`connected to ${address}:${port}`);
    const writer = tcpSocket.writable.getWriter();
    await writer.write(rawClientData);
    writer.releaseLock();

    return tcpSocket;
  }

  async function retry() {
    const tcpSocket = await connectAndWrite(
      proxyIP.split(/[:=-]/)[0] || addressRemote,
      proxyIP.split(/[:=-]/)[1] || portRemote
    );
    tcpSocket.closed
      .catch((error) => {
        console.log("retry tcpSocket closed error", error);
      })
      .finally(() => {
        safeCloseWebSocket(webSocket);
      });
    remoteSocketToWS(tcpSocket, webSocket, responseHeader, null, log);
  }

  const tcpSocket = await connectAndWrite(addressRemote, portRemote);

  remoteSocketToWS(tcpSocket, webSocket, responseHeader, retry, log);
}

async function handleUDPOutbound(targetAddress, targetPort, udpChunk, webSocket, responseHeader, log) {
  try {
    let protocolHeader = responseHeader;
    const tcpSocket = connect({
      hostname: targetAddress,
      port: targetPort,
    });

    log(`Connected to ${targetAddress}:${targetPort}`);

    const writer = tcpSocket.writable.getWriter();
    await writer.write(udpChunk);
    writer.releaseLock();

    await tcpSocket.readable.pipeTo(
      new WritableStream({
        async write(chunk) {
          if (webSocket.readyState === WS_READY_STATE_OPEN) {
            if (protocolHeader) {
              webSocket.send(await new Blob([protocolHeader, chunk]).arrayBuffer());
              protocolHeader = null;
            } else {
              webSocket.send(chunk);
            }
          }
        },
        close() {
          log(`UDP connection to ${targetAddress} closed`);
        },
        abort(reason) {
          console.error(`UDP connection to ${targetPort} aborted due to ${reason}`);
        },
      })
    );
  } catch (e) {
    console.error(`Error while handling UDP outbound, error ${e.message}`);
  }
}

function makeReadableWebSocketStream(webSocketServer, earlyDataHeader, log) {
  let readableStreamCancel = false;
  const stream = new ReadableStream({
    start(controller) {
      webSocketServer.addEventListener("message", (event) => {
        if (readableStreamCancel) {
          return;
        }
        const message = event.data;
        controller.enqueue(message);
      });
      webSocketServer.addEventListener("close", () => {
        safeCloseWebSocket(webSocketServer);
        if (readableStreamCancel) {
          return;
        }
        controller.close();
      });
      webSocketServer.addEventListener("error", (err) => {
        log("webSocketServer has error");
        controller.error(err);
      });
      const { earlyData, error } = base64ToArrayBuffer(earlyDataHeader);
      if (error) {
        controller.error(error);
      } else if (earlyData) {
        controller.enqueue(earlyData);
      }
    },

    pull(controller) {},
    cancel(reason) {
      if (readableStreamCancel) {
        return;
      }
      log(`ReadableStream was canceled, due to ${reason}`);
      readableStreamCancel = true;
      safeCloseWebSocket(webSocketServer);
    },
  });

  return stream;
}

function parseSsHeader(ssBuffer) {
  const view = new DataView(ssBuffer);

  const addressType = view.getUint8(0);
  let addressLength = 0;
  let addressValueIndex = 1;
  let addressValue = "";

  switch (addressType) {
    case 1:
      addressLength = 4;
      addressValue = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 3:
      addressLength = new Uint8Array(ssBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 4:
      addressLength = 16;
      const dataView = new DataView(ssBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    default:
      return {
        hasError: true,
        message: `Invalid addressType for ${reverse("skcoswodahS")}: ${addressType}`,
      };
  }

  if (!addressValue) {
    return {
      hasError: true,
      message: `Destination address empty, address type is: ${addressType}`,
    };
  }

  const portIndex = addressValueIndex + addressLength;
  const portBuffer = ssBuffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);
  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: portIndex + 2,
    rawClientData: ssBuffer.slice(portIndex + 2),
    version: null,
    isUDP: portRemote == 53,
  };
}

function parseSselvHeader(buffer) {
  const version = new Uint8Array(buffer.slice(0, 1));
  let isUDP = false;

  const optLength = new Uint8Array(buffer.slice(17, 18))[0];

  const cmd = new Uint8Array(buffer.slice(18 + optLength, 18 + optLength + 1))[0];
  if (cmd === 1) {
  } else if (cmd === 2) {
    isUDP = true;
  } else {
    return {
      hasError: true,
      message: `command ${cmd} is not support, command 01-tcp,02-udp,03-mux`,
    };
  }
  const portIndex = 18 + optLength + 1;
  const portBuffer = buffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);

  let addressIndex = portIndex + 2;
  const addressBuffer = new Uint8Array(buffer.slice(addressIndex, addressIndex + 1));

  const addressType = addressBuffer[0];
  let addressLength = 0;
  let addressValueIndex = addressIndex + 1;
  let addressValue = "";
  switch (addressType) {
    case 1: // For IPv4
      addressLength = 4;
      addressValue = new Uint8Array(buffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(".");
      break;
    case 2: // For Domain
      addressLength = new Uint8Array(buffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(buffer.slice(addressValueIndex, addressValueIndex + addressLength));
      break;
    case 3: // For IPv6
      addressLength = 16;
      const dataView = new DataView(buffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    default:
      return {
        hasError: true,
        message: `invild  addressType is ${addressType}`,
      };
  }
  if (!addressValue) {
    return {
      hasError: true,
      message: `addressValue is empty, addressType is ${addressType}`,
    };
  }

  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: addressValueIndex + addressLength,
    rawClientData: buffer.slice(addressValueIndex + addressLength),
    version: new Uint8Array([version[0], 0]),
    isUDP: isUDP,
  };
}

function parseNajortHeader(buffer) {
  const socks5DataBuffer = buffer.slice(58);
  if (socks5DataBuffer.byteLength < 6) {
    return {
      hasError: true,
      message: "invalid SOCKS5 request data",
    };
  }

  let isUDP = false;
  const view = new DataView(socks5DataBuffer);
  const cmd = view.getUint8(0);
  if (cmd == 3) {
    isUDP = true;
  } else if (cmd != 1) {
    throw new Error("Unsupported command type!");
  }

  let addressType = view.getUint8(1);
  let addressLength = 0;
  let addressValueIndex = 2;
  let addressValue = "";
  switch (addressType) {
    case 1: // For IPv4
      addressLength = 4;
      addressValue = new Uint8Array(socks5DataBuffer.slice(addressValueIndex, addressValueIndex + addressLength)).join(
        "."
      );
      break;
    case 3: // For Domain
      addressLength = new Uint8Array(socks5DataBuffer.slice(addressValueIndex, addressValueIndex + 1))[0];
      addressValueIndex += 1;
      addressValue = new TextDecoder().decode(
        socks5DataBuffer.slice(addressValueIndex, addressValueIndex + addressLength)
      );
      break;
    case 4: // For IPv6
      addressLength = 16;
      const dataView = new DataView(socks5DataBuffer.slice(addressValueIndex, addressValueIndex + addressLength));
      const ipv6 = [];
      for (let i = 0; i < 8; i++) {
        ipv6.push(dataView.getUint16(i * 2).toString(16));
      }
      addressValue = ipv6.join(":");
      break;
    default:
      return {
        hasError: true,
        message: `invalid addressType is ${addressType}`,
      };
  }

  if (!addressValue) {
    return {
      hasError: true,
      message: `address is empty, addressType is ${addressType}`,
    };
  }

  const portIndex = addressValueIndex + addressLength;
  const portBuffer = socks5DataBuffer.slice(portIndex, portIndex + 2);
  const portRemote = new DataView(portBuffer).getUint16(0);
  return {
    hasError: false,
    addressRemote: addressValue,
    addressType: addressType,
    portRemote: portRemote,
    rawDataIndex: portIndex + 4,
    rawClientData: socks5DataBuffer.slice(portIndex + 4),
    version: null,
    isUDP: isUDP,
  };
}

async function remoteSocketToWS(remoteSocket, webSocket, responseHeader, retry, log) {
  let header = responseHeader;
  let hasIncomingData = false;
  await remoteSocket.readable
    .pipeTo(
      new WritableStream({
        start() {},
        async write(chunk, controller) {
          hasIncomingData = true;
          if (webSocket.readyState !== WS_READY_STATE_OPEN) {
            controller.error("webSocket.readyState is not open, maybe close");
          }
          if (header) {
            webSocket.send(await new Blob([header, chunk]).arrayBuffer());
            header = null;
          } else {
            webSocket.send(chunk);
          }
        },
        close() {
          log(`remoteConnection!.readable is close with hasIncomingData is ${hasIncomingData}`);
        },
        abort(reason) {
          console.error(`remoteConnection!.readable abort`, reason);
        },
      })
    )
    .catch((error) => {
      console.error(`remoteSocketToWS has exception `, error.stack || error);
      safeCloseWebSocket(webSocket);
    });
  if (hasIncomingData === false && retry) {
    log(`retry`);
    retry();
  }
}

function safeCloseWebSocket(socket) {
  try {
    if (socket.readyState === WS_READY_STATE_OPEN || socket.readyState === WS_READY_STATE_CLOSING) {
      socket.close();
    }
  } catch (error) {
    console.error("safeCloseWebSocket error", error);
  }
}

// ===================================================
// 🏥 HEALTH CHECK FUNCTIONS MOVED TO DEDICATED WORKER
// ===================================================
// Health check telah dipindah ke health.ex27.my.id
// untuk optimasi performance dan maintenance.
// Total 318 baris kode health check telah dihapus.
// ===================================================

// Helpers
function base64ToArrayBuffer(base64Str) {
  if (!base64Str) {
    return { error: null };
  }
  try {
    base64Str = base64Str.replace(/-/g, "+").replace(/_/g, "/");
    const decode = atob(base64Str);
    const arryBuffer = Uint8Array.from(decode, (c) => c.charCodeAt(0));
    return { earlyData: arryBuffer.buffer, error: null };
  } catch (error) {
    return { error };
  }
}

function arrayBufferToHex(buffer) {
  return [...new Uint8Array(buffer)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function shuffleArray(array) {
  let currentIndex = array.length;

  // While there remain elements to shuffle...
  while (currentIndex != 0) {
    // Pick a remaining element...
    let randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }
}

async function generateHashFromText(text) {
  const msgUint8 = new TextEncoder().encode(text); // encode as (utf-8) Uint8Array
  const hashBuffer = await crypto.subtle.digest("MD5", msgUint8); // hash the message
  const hashArray = Array.from(new Uint8Array(hashBuffer)); // convert buffer to byte array
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join(""); // convert bytes to hex string

  return hashHex;
}

function reverse(s) {
  return s.split("").reverse().join("");
}

function getFlagEmoji(isoCode) {
  const codePoints = isoCode
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// CloudflareApi Class
class CloudflareApi {
  constructor() {
    this.bearer = `Bearer ${apiKey}`;
    this.accountID = accountID;
    this.zoneID = zoneID;
    this.apiEmail = apiEmail;
    this.apiKey = apiKey;

    this.headers = {
      Authorization: this.bearer,
      "X-Auth-Email": this.apiEmail,
      "X-Auth-Key": this.apiKey,
    };
  }

  async getDomainList() {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountID}/workers/domains`;
    const res = await fetch(url, {
      headers: {
        ...this.headers,
      },
    });

    if (res.status == 200) {
      const respJson = await res.json();

      return respJson.result.filter((data) => data.service == serviceName).map((data) => data.hostname);
    }

    return [];
  }

  async registerDomain(domain) {
    domain = domain.toLowerCase();
    const registeredDomains = await this.getDomainList();

    if (!domain.endsWith(rootDomain)) return 400;
    if (registeredDomains.includes(domain)) return 409;

    try {
      const domainTest = await fetch(`https://${domain.replaceAll("." + APP_DOMAIN, "")}`);
      if (domainTest.status == 530) return 530;
    } catch (e) {
      return 400;
    }

    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountID}/workers/domains`;
    const res = await fetch(url, {
      method: "PUT",
      body: JSON.stringify({
        environment: "production",
        hostname: domain,
        service: serviceName,
        zone_id: this.zoneID,
      }),
      headers: {
        ...this.headers,
      },
    });

    return res.status;
  }
}

// HTML page base
/**
 * Cloudflare worker gak support DOM API, tetapi mereka menggunakan HTML Rewriter.
 * Tapi, karena kelihatannta repot kalo pake HTML Rewriter. Kita pake cara konfensional saja...
 */
let baseHTML = `
<!DOCTYPE html>
<html lang="en" id="html" class="scroll-auto scrollbar-hide dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Proxy List</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      /* For Webkit-based browsers (Chrome, Safari and Opera) */
      .scrollbar-hide::-webkit-scrollbar {
          display: none;
      }

      /* For IE, Edge and Firefox */
      .scrollbar-hide {
          -ms-overflow-style: none;  /* IE and Edge */
          scrollbar-width: none;  /* Firefox */
      }
    </style>
    <script type="text/javascript" src="https://cdn.jsdelivr.net/npm/lozad/dist/lozad.min.js"></script>

    <script>
      tailwind.config = {
        darkMode: 'selector',
        theme: {
          extend: {
            screens: {
              'sm': '640px',
              'md': '768px',
              'lg': '1024px',
              'xl': '1280px',
              '2xl': '1450px', // Custom breakpoint at 1450px
              '3xl': '1600px'
            }
          }
        }
      }
    </script>
  </head>
  <body class="bg-white dark:bg-neutral-800 bg-fixed">
    <!-- Notification -->
    <div
      id="notification-badge"
      class="fixed z-50 opacity-0 transition-opacity ease-in-out duration-300 top-24 right-3 p-3 max-w-sm bg-white rounded-xl border border-2 border-neutral-800 flex items-center gap-x-4"
    >
      <div class="shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#171717" class="size-6">
          <path
            d="M5.85 3.5a.75.75 0 0 0-1.117-1 9.719 9.719 0 0 0-2.348 4.876.75.75 0 0 0 1.479.248A8.219 8.219 0 0 1 5.85 3.5ZM19.267 2.5a.75.75 0 1 0-1.118 1 8.22 8.22 0 0 1 1.987 4.124.75.75 0 0 0 1.48-.248A9.72 9.72 0 0 0 19.266 2.5Z"
          />
          <path
            fill-rule="evenodd"
            d="M12 2.25A6.75 6.75 0 0 0 5.25 9v.75a8.217 8.217 0 0 1-2.119 5.52.75.75 0 0 0 .298 1.206c1.544.57 3.16.99 4.831 1.243a3.75 3.75 0 1 0 7.48 0 24.583 24.583 0 0 0 4.83-1.244.75.75 0 0 0 .298-1.205 8.217 8.217 0 0 1-2.118-5.52V9A6.75 6.75 0 0 0 12 2.25ZM9.75 18c0-.034 0-.067.002-.1a25.05 25.05 0 0 0 4.496 0l.002.1a2.25 2.25 0 1 1-4.5 0Z"
            clip-rule="evenodd"
          />
        </svg>
      </div>
      <div>
        <div class="text-md font-bold text-blue-500">Berhasil!</div>
        <p class="text-sm text-neutral-800">Akun berhasil disalin</p>
      </div>
    </div>
    <!-- Select Country Dropdown -->
    <div class="fixed top-3 left-3 z-30">
      <button
        id="country-dropdown-button"
        class="flex items-center justify-center bg-amber-400 border-2 border-neutral-800 rounded-full p-2"
        onclick="toggleCountryDropdown()"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-6">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
        </svg>
      </button>
      <div
        id="country-dropdown"
        class="hidden mt-2 p-3 bg-white dark:bg-neutral-800 border-2 border-neutral-800 dark:border-white rounded-lg shadow-lg max-h-80 overflow-y-auto scrollbar-hide"
      >
        <div class="grid grid-cols-4 gap-2">
          PLACEHOLDER_BENDERA_NEGARA
        </div>
      </div>
    </div>
    <!-- Main -->
    <div class="container mx-auto px-4">
      <div
        id="container-title"
        class="sticky bg-white dark:bg-neutral-800 border-b-2 border-neutral-800 dark:border-white z-10 py-6 w-full"
      >
        <h1 class="text-xl text-center text-neutral-800 dark:text-white">
          PLACEHOLDER_JUDUL
        </h1>
      </div>

      <!-- Info Header - Moved below title -->
      <div id="container-header" class="flex justify-center mt-2 mb-6">
        <div id="container-info" class="bg-amber-400 border-2 border-neutral-800 rounded-lg pt-1 pl-6 pb-1 pr-6 shadow-md">
          <div class="flex flex-row items-center gap-6 text-sm">
            <div id="container-info-country" class="flex items-center gap-3 font-medium font-bold">
              <span>Loading...</span>
            </div>
            <div id="container-info-isp" class="line-clamp-1 max-w-[200px]">Checking ISP...</div>
            <div id="container-info-ip" class="font-medium font-mono rounded">Checking IP...</div>
          </div>
        </div>
      </div>
      <div class="flex gap-6 pt-4 w-full justify-center">
        PLACEHOLDER_PROXY_GROUP
      </div>

      <!-- Pagination -->
      <nav id="container-pagination" class="w-full mt-8 sticky bottom-0 right-0 left-0 transition -translate-y-6 z-20">
        <ul class="flex justify-center space-x-4">
          PLACEHOLDER_PAGE_BUTTON
        </ul>
      </nav>
    </div>

    <div id="container-window" class="hidden">
      <!-- Windows -->
      <!-- Informations -->
      <div class="fixed z-20 top-0 w-full h-full bg-white dark:bg-neutral-800">
        <p id="container-window-info" class="text-center w-full h-full top-1/4 absolute dark:text-white"></p>
      </div>
      <!-- Output Format -->
      <div id="output-window" class="fixed z-20 top-0 right-0 w-full h-full flex justify-center items-center hidden">
        <div class="w-[75%] h-[30%] flex flex-col gap-1 p-1 text-center rounded-md">
          <div class="basis-1/6 w-full h-full rounded-md">
            <div class="flex w-full h-full gap-1 justify-between">
              <button
                onclick="ConvertAsTarget('clash')"
                class="basis-1/2 p-2 rounded-full bg-amber-400 flex justify-center items-center"
              >
                Clash
              </button>
              <button
                onclick="ConvertAsTarget('sfa')"
                class="basis-1/2 p-2 rounded-full bg-amber-400 flex justify-center items-center"
              >
                SFA
              </button>
              <button
                onclick="ConvertAsTarget('bfr')"
                class="basis-1/2 p-2 rounded-full bg-amber-400 flex justify-center items-center"
              >
                BFR
              </button>
            </div>
          </div>
          <div class="basis-1/6 w-full h-full rounded-md">
            <div class="flex w-full h-full gap-1 justify-between">
              <button
                onclick="ConvertAsTarget('v2ray')"
                class="basis-1/2 p-2 rounded-full bg-amber-400 flex justify-center items-center"
              >
                V2Ray/Xray
              </button>
              <button
                onclick="ConvertAsRaw()"
                class="basis-1/2 p-2 rounded-full bg-amber-400 flex justify-center items-center"
              >
                Raw
              </button>
            </div>
          </div>
          <div class="basis-1/6 w-full h-full rounded-md">
            <div class="flex w-full h-full gap-1 justify-center">
              <button
                onclick="toggleOutputWindow()"
                class="basis-1/2 border-2 border-indigo-400 hover:bg-indigo-400 dark:text-white p-2 rounded-full flex justify-center items-center"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
      <!-- Wildcards -->
      <div id="wildcards-window" class="fixed hidden z-20 top-0 right-0 w-full h-full flex justify-center items-center">
        <div class="w-[75%] h-[30%] flex flex-col gap-1 p-1 text-center rounded-md">
          <div class="basis-1/6 w-full h-full rounded-md">
            <div class="flex w-full h-full gap-1 justify-between">
              <input
                id="new-domain-input"
                type="text"
                placeholder="Input wildcard"
                class="basis-11/12 w-full h-full px-6 rounded-md focus:outline-0"
              />
              <button
                onclick="registerDomain()"
                class="p-2 rounded-full bg-amber-400 flex justify-center items-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
                  <path
                    fill-rule="evenodd"
                    d="M16.72 7.72a.75.75 0 0 1 1.06 0l3.75 3.75a.75.75 0 0 1 0 1.06l-3.75 3.75a.75.75 0 1 1-1.06-1.06l2.47-2.47H3a.75.75 0 0 1 0-1.5h16.19l-2.47-2.47a.75.75 0 0 1 0-1.06Z"
                    clip-rule="evenodd"
                  ></path>
                </svg>
              </button>
            </div>
          </div>
          <div class="basis-5/6 w-full h-full rounded-md">
            <div
              id="container-domains"
              class="w-full h-full rounded-md flex flex-col gap-1 overflow-scroll scrollbar-hide"
            ></div>
          </div>
        </div>
      </div>
      

    </div>

    <footer>
      <div class="fixed bottom-3 right-3 flex flex-col gap-1 z-50">
        <a href="${DONATE_LINK}" target="_blank">
          <button class="bg-green-500 rounded-full border-2 border-neutral-800 p-1 block">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
              <path
                d="M10.464 8.746c.227-.18.497-.311.786-.394v2.795a2.252 2.252 0 0 1-.786-.393c-.394-.313-.546-.681-.546-1.004 0-.323.152-.691.546-1.004ZM12.75 15.662v-2.824c.347-.085.664-.228.921.421.427.32.579.686.579.991 0 .305-.152.671-.579.991a2.534 2.534 0 0 1-.921.42Z"
              />
              <path
                fill-rule="evenodd"
                d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25ZM12.75 6a.75.75 0 0 0-1.5 0v.816a3.836 3.836 0 0 0-1.72.756c-.712.566-1.112 1.35-1.112 2.178 0 .829.4 1.612 1.113 2.178.502.4 1.102.647 1.719.756v2.978a2.536 2.536 0 0 1-.921-.421l-.879-.66a.75.75 0 0 0-.9 1.2l.879.66c.533.4 1.169.645 1.821.75V18a.75.75 0 0 0 1.5 0v-.81a4.124 4.124 0 0 0 1.821-.749c.745-.559 1.179-1.344 1.179-2.191 0-.847-.434-1.632-1.179-2.191a4.122 4.122 0 0 0-1.821-.75V8.354c.29.082.559.213.786.393l.415.33a.75.75 0 0 0 .933-1.175l-.415-.33a3.836 3.836 0 0 0-1.719-.755V6Z"
                clip-rule="evenodd"
              />
            </svg>
          </button>
        </a>
        <button onclick="toggleWildcardsWindow()" class="bg-indigo-400 rounded-full border-2 border-neutral-800 p-1 PLACEHOLDER_API_READY">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
            class="size-6"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25"
            />
          </svg>
        </button>
        <button onclick="toggleDarkMode()" class="bg-amber-400 rounded-full border-2 border-neutral-800 p-1">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
            class="size-6"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
          ></path>
        </svg>
      </button>

      <button onclick="Convert()" class="bg-blue-500 rounded-full border-2 border-neutral-800 p-1">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-6">
          <path d="M12.0312 2.03125C10.0813 2.03125 8.26125 2.59125 6.73125 3.55125L13.5913 10.4213L13.6013 7.68125C13.6013 7.27125 13.9413 6.93125 14.3513 6.93125C14.7713 6.93125 15.1013 7.27125 15.1013 7.68125L15.0913 12.2312C15.0913 12.5413 14.9012 12.8113 14.6213 12.9213C14.5312 12.9613 14.4313 12.9812 14.3413 12.9812C14.1413 12.9812 13.9513 12.9013 13.8113 12.7613L5.62125 4.56125C5.58125 4.52125 5.55125 4.48125 5.52125 4.44125C3.38125 6.28125 2.03125 9.00125 2.03125 12.0312C2.03125 17.5513 6.51125 22.0312 12.0312 22.0312C13.9812 22.0312 15.8013 21.4712 17.3313 20.5112L10.4713 13.6413L10.4613 16.3812C10.4613 16.7912 10.1213 17.1312 9.71125 17.1312C9.29125 17.1312 8.96125 16.7912 8.96125 16.3812L8.97125 11.8313C8.97125 11.5212 9.16125 11.2513 9.44125 11.1413C9.71125 11.0213 10.0413 11.0813 10.2513 11.3013L18.4412 19.5012C18.4813 19.5413 18.5112 19.5812 18.5413 19.6213C20.6812 17.7812 22.0312 15.0612 22.0312 12.0312C22.0312 6.51125 17.5513 2.03125 12.0312 2.03125Z" fill="#292D32"/>
        </svg>
      </button>
    </div>
  </footer>

    <script>
      // Shared
      const serviceName = "${serviceName}";
      const rootDomain = "${rootDomain}";
      const notification = document.getElementById("notification-badge");
      const windowContainer = document.getElementById("container-window");
      const windowInfoContainer = document.getElementById("container-window-info");
      const converterUrl =
        "https://script.google.com/macros/s/AKfycbwwVeHNUlnP92syOP82p1dOk_-xwBgRIxkTjLhxxZ5UXicrGOEVNc5JaSOu0Bgsx_gG/exec";






      
      // Switches
      let isDomainListFetched = false;

      // Local variable
      let rawConfig = "";

      function getDomainList() {
        if (isDomainListFetched) return;
        isDomainListFetched = true;

        windowInfoContainer.innerText = "Fetching data...";

        const url = "https://" + serviceName + "." + rootDomain + "/api/v1/domains/get";
        const res = fetch(url).then(async (res) => {
          const domainListContainer = document.getElementById("container-domains");
          domainListContainer.innerHTML = "";

          if (res.status == 200) {
            windowInfoContainer.innerText = "Done!";
            const respJson = await res.json();
            for (const domain of respJson) {
              const domainElement = document.createElement("p");
              domainElement.classList.add("w-full", "bg-amber-400", "rounded-md");
              domainElement.innerText = domain;
              domainListContainer.appendChild(domainElement);
            }
          } else {
            windowInfoContainer.innerText = "Failed!";
          }
        });
      }

      function registerDomain() {
        const domainInputElement = document.getElementById("new-domain-input");
        const rawDomain = domainInputElement.value.toLowerCase();
        const domain = domainInputElement.value + "." + rootDomain;

        if (!rawDomain.match(/\\w+\\.\\w+$/) || rawDomain.endsWith(rootDomain)) {
          windowInfoContainer.innerText = "Invalid URL!";
          return;
        }

        windowInfoContainer.innerText = "Pushing request...";

        const url = "https://" + rootDomain + "/api/v1/domains/put?domain=" + domain;
        const res = fetch(url).then((res) => {
          if (res.status == 200) {
            windowInfoContainer.innerText = "Done!";
            domainInputElement.value = "";
            isDomainListFetched = false;
            getDomainList();
          } else {
            if (res.status == 409) {
              windowInfoContainer.innerText = "Domain exists!";
            } else {
              windowInfoContainer.innerText = "Error " + res.status;
            }
          }
        });
      }

      function copyToClipboard(text) {
        console.log("Original URL:", text);
        toggleOutputWindow();
        rawConfig = text;
      }

      function ConvertAsRaw() {
        // Salin rawConfig langsung ke clipboard tanpa modifikasi domain
        console.log("Raw config:", rawConfig);
        
        navigator.clipboard.writeText(rawConfig);

        notification.classList.remove("opacity-0");
        setTimeout(() => {
          notification.classList.add("opacity-0");
        }, 2000);
      }

      // Fungsi untuk memformat dokumen JSON
      function formatJsonDocument(jsonString) {
        try {
          const obj = JSON.parse(jsonString);
          return JSON.stringify(obj, null, 2);
        } catch (e) {
          console.error("Error formatting JSON:", e);
          return jsonString;
        }
      }
      
      // Fungsi untuk memformat dokumen YAML
      function formatYamlDocument(yamlString) {
        // Untuk YAML, kita hanya mengembalikan string asli karena tidak ada formatter bawaan
        // Dalam implementasi nyata, Anda mungkin ingin menggunakan library YAML
        return yamlString;
      }
      
      // Fungsi untuk membuat dan menampilkan popup
      function showConfigPopup(content, format) {
        // Hapus popup lama jika ada
        const oldPopup = document.getElementById('config-popup');
        if (oldPopup) {
          oldPopup.remove();
        }
        
        // Buat elemen popup
        const popup = document.createElement('div');
        popup.id = 'config-popup';
        popup.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        // Buat konten popup
        const popupContent = document.createElement('div');
        popupContent.className = 'bg-white rounded-lg p-4 max-w-4xl w-full max-h-[80vh] flex flex-col';
        
        // Buat header popup
        const popupHeader = document.createElement('div');
        popupHeader.className = 'flex justify-between items-center mb-4';
        
        const popupTitle = document.createElement('h3');
        popupTitle.className = 'text-lg font-bold';
        popupTitle.textContent = 'Configuration (' + format.toUpperCase() + ')';
        
        const closeButton = document.createElement('button');
        closeButton.className = 'text-gray-500 hover:text-gray-700';
        closeButton.textContent = '✕';
        closeButton.onclick = function() { popup.remove(); };
        
        popupHeader.appendChild(popupTitle);
        popupHeader.appendChild(closeButton);
        
        // Buat area teks
        const textArea = document.createElement('textarea');
        textArea.className = 'w-full flex-grow p-2 border rounded font-mono text-sm overflow-auto';
        textArea.value = content;
        textArea.readOnly = true;
        textArea.style.height = '800px';
        
        // Buat footer dengan tombol
        const popupFooter = document.createElement('div');
        popupFooter.className = 'flex justify-end mt-4 gap-2';
        
        const copyButton = document.createElement('button');
        copyButton.className = 'px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600';
        copyButton.textContent = 'Copy to Clipboard';
        copyButton.onclick = function() {
          navigator.clipboard.writeText(content);
          notification.classList.remove("opacity-0");
          setTimeout(function() {
            notification.classList.add("opacity-0");
          }, 2000);
        };
        
        popupFooter.appendChild(copyButton);
        
        // Tambahkan semua elemen ke popup
        popupContent.appendChild(popupHeader);
        popupContent.appendChild(textArea);
        popupContent.appendChild(popupFooter);
        popup.appendChild(popupContent);
        
        // Tambahkan popup ke body
        document.body.appendChild(popup);
      }
      
      async function ConvertAsTarget(target) {
        windowInfoContainer.innerText = "Generating config...";
        
        // Kirim rawConfig langsung ke converter tanpa modifikasi domain
        const url = "${CONVERTER_URL}";
        const res = await fetch(url, {
          method: "POST",
          body: JSON.stringify({
            url: rawConfig,
            format: target,
            template: "cf",
          }),
        });

        if (res.status == 200) {
          windowInfoContainer.innerText = "Done!";
          
          // Dapatkan respons dari converter
          let responseText = await res.text();
          
          // Format dokumen berdasarkan target
          if (target === "bfr") {
            // Format JSON untuk BFR
            responseText = formatJsonDocument(responseText);
          } else if (target === "clash" || target === "sfa") {
            // Format YAML untuk Clash dan SFA
            responseText = formatYamlDocument(responseText);
          }
          
          // Tampilkan dalam popup alih-alih menyalin ke clipboard
          showConfigPopup(responseText, target);
        } else {
          windowInfoContainer.innerText = "Error " + res.statusText;
        }
      }

      function navigateTo(link) {
        window.location.href = link + window.location.search;
      }

      function toggleOutputWindow() {
        windowInfoContainer.innerText = "Select output:";
        toggleWindow();
        const rootElement = document.getElementById("output-window");
        if (rootElement.classList.contains("hidden")) {
          rootElement.classList.remove("hidden");
        } else {
          rootElement.classList.add("hidden");
        }
      }

      function toggleWildcardsWindow() {
        windowInfoContainer.innerText = "Domain list";
        toggleWindow();
        getDomainList();
        const rootElement = document.getElementById("wildcards-window");
        if (rootElement.classList.contains("hidden")) {
          rootElement.classList.remove("hidden");
        } else {
          rootElement.classList.add("hidden");
        }
      }
      

      


      function toggleWindow() {
        if (windowContainer.classList.contains("hidden")) {
          windowContainer.classList.remove("hidden");
        } else {
          windowContainer.classList.add("hidden");
        }
      }

      function toggleDarkMode() {
        const rootElement = document.getElementById("html");
        if (rootElement.classList.contains("dark")) {
          rootElement.classList.remove("dark");
        } else {
          rootElement.classList.add("dark");
        }
      }

      function checkProxy() {
        for (let i = 0; ; i++) {
          const pingElement = document.getElementById("ping-"+i);
          if (pingElement == undefined) return;

          const target = pingElement.textContent.split(" ").filter((ipPort) => ipPort.match(":"))[0];
          if (target) {
            pingElement.textContent = "Checking...";
          } else {
            continue;
          }

          let isActive = false;
          new Promise(async (resolve) => {
            const res = await fetch("https://health.ex27.my.id/check?target=" + target)
              .then(async (res) => {
                if (isActive) return;
                if (res.status == 200) {
                  pingElement.classList.remove("dark:text-white");
                  const jsonResp = await res.json();
                  if (jsonResp.proxyip === true) {
                    isActive = true;
                    // Buat routeInfo dari data yang ada
                    const coloCode = jsonResp.colo || 'CF';
                    const targetLocation = jsonResp.city || jsonResp.regionName || 'Unknown';
                    const routeInfo = coloCode + " -> " + targetLocation;
                    
                    pingElement.textContent = "Active " + jsonResp.delay + " ms " + "(" + (jsonResp.routeInfo || routeInfo) + ")";
                    pingElement.classList.add("text-green-600");
                  } else {
                    pingElement.textContent = "Inactive";
                    pingElement.classList.add("text-red-600");
                  }
                } else {
                  pingElement.textContent = "Check Failed!";
                }
              })
              .finally(() => {
                resolve(0);
              });
          });
        }
      }

      function checkRegion() {
        for (let i = 0; ; i++) {
          console.log("Halo " + i)
          const containerRegionCheck = document.getElementById("container-region-check-" + i);
          const configSample = document.getElementById("config-sample-" + i).value.replaceAll(" ", "");
          if (containerRegionCheck == undefined) break;

          const res = fetch(
            "https://api.foolvpn.me/regioncheck?config=" + encodeURIComponent(configSample)
          ).then(async (res) => {
            if (res.status == 200) {
              containerRegionCheck.innerHTML = "<hr>";
              for (const result of await res.json()) {
                containerRegionCheck.innerHTML += "<p>" + result.name + ": " + result.region + "</p>";
              }
            }
          });
        }
      }

      function checkGeoip() {
        console.log("checkGeoip function called"); // Debug log

        const containerIP = document.getElementById("container-info-ip");
        const containerCountry = document.getElementById("container-info-country");
        const containerISP = document.getElementById("container-info-isp");

        if (!containerIP || !containerCountry || !containerISP) {
          console.error("One or more container elements not found");
          return;
        }

        // Immediately set some default values to ensure something is displayed
        containerIP.innerHTML = '<span class="font-mono">Fetching IP...</span>';
        containerCountry.innerHTML = '<span>Detecting location...</span>';
        containerISP.innerHTML = '<span>Identifying ISP...</span>';

        // Set a timeout to ensure we show something if all APIs fail
        const fallbackTimeout = setTimeout(() => {
          console.log("Fallback timeout triggered");
          if (containerIP.innerHTML.includes('Fetching')) {
            containerIP.innerHTML = '<span class="font-mono">Unknown IP</span>';
          }
          if (containerCountry.innerHTML.includes('Detecting')) {
            containerCountry.innerHTML = '<span>Unknown Location</span>';
          }
          if (containerISP.innerHTML.includes('Identifying')) {
            containerISP.innerHTML = '<span>Unknown ISP</span>';
          }
        }, 8000); // 8 seconds timeout

        // Try a direct approach with ip-api.com first (most reliable for all info)
        console.log("Trying ip-api.com first");
        fetch('https://ip-api.com/json/?fields=query,country,countryCode,isp,org,as')
          .then(res => {
            if (!res.ok) throw new Error('ip-api.com response not ok: ' + res.status);
            return res.json();
          })
          .then(data => {
            console.log("ip-api.com response:", data);
            clearTimeout(fallbackTimeout);

            // Update IP
            if (data.query) {
              containerIP.innerHTML = '<span class="font-mono">' + data.query + '</span>';
            }

            // Update country
            if (data.countryCode) {
              const countryCode = data.countryCode.toLowerCase();
              containerCountry.innerHTML = '<div class="flex items-center gap-1">' +
                '<img width="20" height="15" src="https://flagcdn.com/w320/' + countryCode + '.png" alt="' + data.country + '" />' +
                '<span>' + data.country + '</span>' +
              '</div>';
            }

            // Update ISP - try multiple fields
            const ispInfo = data.org || data.isp || data.as || "Unknown ISP";
            containerISP.innerHTML = '<span title="' + ispInfo + '" class="line-clamp-1">' + ispInfo + '</span>';
          })
          .catch(err => {
            console.error('ip-api.com failed:', err);
            // Try ipinfo.io as backup
            tryIpInfoIo();
          });

        function tryIpInfoIo() {
          console.log("Trying ipinfo.io as backup");
          fetch('https://ipinfo.io/json')
            .then(res => {
              if (!res.ok) throw new Error('ipinfo.io response not ok: ' + res.status);
              return res.json();
            })
            .then(data => {
              console.log("ipinfo.io response:", data);
              clearTimeout(fallbackTimeout);

              // Update IP
              if (data.ip) {
                containerIP.innerHTML = '<span class="font-mono">' + data.ip + '</span>';
              }

              // Update country
              if (data.country) {
                const countryCode = data.country.toLowerCase();
                containerCountry.innerHTML = '<div class="flex items-center gap-1">' +
                  '<img width="20" height="15" src="https://flagcdn.com/w320/' + countryCode + '.png" alt="' + data.country + '" />' +
                  '<span>' + data.country + '</span>' +
                '</div>';
              }

              // Update ISP
              if (data.org) {
                const ispInfo = data.org.replace(/^AS\\d+\\s+/, ''); // Remove AS number prefix if present
                containerISP.innerHTML = '<span title="' + ispInfo + '" class="line-clamp-1">' + ispInfo + '</span>';
              }
            })
            .catch(err => {
              console.error('ipinfo.io failed:', err);
              // Try our own API as last resort
              tryOurApi();
            });
        }

        function tryOurApi() {
          console.log("Trying our own API as last resort");
          
          try {
            const apiUrl = "https://" + serviceName + "." + rootDomain + "/api/v1/myip";
            
            fetch(apiUrl)
              .then(res => {
                if (!res.ok) throw new Error('Our API response not ok: ' + res.status);
                return res.json();
              })
            .then(data => {
              console.log("Our API response:", data);
              clearTimeout(fallbackTimeout);

              // Update IP
              if (data.ip) {
                containerIP.innerHTML = '<span class="font-mono">' + data.ip + '</span>';
              }

              // Update country
              if (data.country) {
                const countryCode = data.country.toLowerCase();
                containerCountry.innerHTML = '<div class="flex items-center gap-1">' +
                  '<img width="20" height="15" src="https://flagcdn.com/w320/' + countryCode + '.png" alt="' + data.country + '" />' +
                  '<span>' + data.country + '</span>' +
                '</div>';
              }

              // Update ISP
              const ispInfo = data.asOrganization || data.isp || data.asn || "Unknown ISP";
              containerISP.innerHTML = '<span title="' + ispInfo + '" class="line-clamp-1">' + ispInfo + '</span>';
            })
            .catch(err => {
              console.error('Our API failed:', err);
              // If all APIs fail, ensure we don't show loading messages
              if (containerIP.innerHTML.includes('Fetching')) {
                containerIP.innerHTML = '<span class="font-mono">Unknown IP</span>';
              }
              if (containerCountry.innerHTML.includes('Detecting')) {
                containerCountry.innerHTML = '<span>Unknown Location</span>';
              }
              if (containerISP.innerHTML.includes('Identifying')) {
                containerISP.innerHTML = '<span>Unknown ISP</span>';
              }
            });
          } catch (err) {
            console.error('Error in tryOurApi:', err);
            // If all APIs fail, ensure we don't show loading messages
            if (containerIP.innerHTML.includes('Fetching')) {
              containerIP.innerHTML = '<span class="font-mono">Unknown IP</span>';
            }
            if (containerCountry.innerHTML.includes('Detecting')) {
              containerCountry.innerHTML = '<span>Unknown Location</span>';
            }
            if (containerISP.innerHTML.includes('Identifying')) {
              containerISP.innerHTML = '<span>Unknown ISP</span>';
            }
          }
        }
      }

      function toggleCountryDropdown() {
        const dropdown = document.getElementById('country-dropdown');
        if (dropdown.classList.contains('hidden')) {
          dropdown.classList.remove('hidden');
          // Close dropdown when clicking outside
          document.addEventListener('click', closeDropdownOnClickOutside);
        } else {
          dropdown.classList.add('hidden');
          document.removeEventListener('click', closeDropdownOnClickOutside);
        }
      }

      function closeDropdownOnClickOutside(event) {
        const dropdown = document.getElementById('country-dropdown');
        const button = document.getElementById('country-dropdown-button');

        if (!dropdown.contains(event.target) && !button.contains(event.target)) {
          dropdown.classList.add('hidden');
          document.removeEventListener('click', closeDropdownOnClickOutside);
        }
      }

      window.onload = () => {
        console.log("Window loaded, initializing...");

        // Run checkGeoip immediately to start fetching data
        console.log("Running checkGeoip...");
        checkGeoip();

        // Run other initialization functions
        checkProxy();
        // checkRegion();

        const observer = lozad(".lozad", {
          load: function (el) {
            el.classList.remove("scale-95");
          },
        });
        observer.observe();
      };

      window.onscroll = () => {
        const paginationContainer = document.getElementById("container-pagination");

        if (window.innerHeight + Math.round(window.scrollY) >= document.body.offsetHeight) {
          paginationContainer.classList.remove("-translate-y-6");
        } else {
          paginationContainer.classList.add("-translate-y-6");
        }
      };

      // Add this function to handle the selection of proxies
      function toggleProxySelection(proxy, index) {
        // Pastikan index adalah string dan tidak menggunakan variabel x secara langsung
        if (!index || typeof index !== 'string') {
          console.error('Invalid index parameter:', index);
          return;
        }

        const selectedProxies = JSON.parse(localStorage.getItem('selectedProxies')) || [];
        const proxyIndex = selectedProxies.indexOf(proxy);

        if (proxyIndex > -1) {
          selectedProxies.splice(proxyIndex, 1);
        } else {
          selectedProxies.push(proxy);
        }

        localStorage.setItem('selectedProxies', JSON.stringify(selectedProxies));
        
        // Gunakan index yang diberikan dari parameter (sudah dalam format 'i-x')
        const checkbox = document.getElementById('proxy-checkbox-' + index);
        if (checkbox) {
          checkbox.checked = proxyIndex === -1;
        }
      }

      // Fungsi untuk mengkonversi dan menampilkan proxy yang dipilih dalam popup
      async function Convert() {
        const selectedProxies = JSON.parse(localStorage.getItem('selectedProxies')) || [];
        if (selectedProxies.length === 0) {
          alert('No proxies selected');
          return;
        }

        // Buat popup untuk pilihan format
        const popup = document.createElement('div');
        popup.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        
        const popupContent = document.createElement('div');
        popupContent.className = 'bg-white rounded-lg p-6 max-w-md w-full';
        
        const popupHeader = document.createElement('div');
        popupHeader.className = 'flex justify-between items-center mb-4';
        
        const title = document.createElement('h3');
        title.className = 'text-lg font-semibold';
        title.textContent = 'Pilih Format Konfigurasi';
        
        const closeButton = document.createElement('button');
        closeButton.className = 'text-gray-500 hover:text-gray-700';
        closeButton.innerHTML = '&times;';
        closeButton.onclick = function() {
          document.body.removeChild(popup);
        };
        
        popupHeader.appendChild(title);
        popupHeader.appendChild(closeButton);
        
        // Buat container untuk tombol-tombol
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'grid grid-cols-2 gap-4 mt-4';
        
        // Fungsi untuk membuat tombol format
        function createFormatButton(formatName, formatValue, bgColor) {
          const button = document.createElement('button');
          button.className = 'px-4 py-3 ' + bgColor + ' text-white rounded hover:opacity-90 font-medium';
          button.textContent = formatName;
          button.onclick = async function() {
            document.body.removeChild(popup);
            await convertWithFormat(formatValue);
          };
          return button;
        }
        
        // Tambahkan tombol-tombol format
        buttonContainer.appendChild(createFormatButton('Raw Config', 'raw', 'bg-gray-600'));
        buttonContainer.appendChild(createFormatButton('Clash Config', 'clash', 'bg-blue-600'));
        buttonContainer.appendChild(createFormatButton('SFA Config', 'sfa', 'bg-green-600'));
        buttonContainer.appendChild(createFormatButton('BFR Config', 'bfr', 'bg-purple-600'));
        buttonContainer.appendChild(createFormatButton('V2Ray Config', 'v2ray', 'bg-red-600'));
        
        // Tambahkan semua elemen ke popup
        popupContent.appendChild(popupHeader);
        popupContent.appendChild(buttonContainer);
        popup.appendChild(popupContent);
        
        // Tambahkan popup ke body
        document.body.appendChild(popup);
      }
      
      // Fungsi untuk mengkonversi dengan format tertentu
      async function convertWithFormat(format) {
        const selectedProxies = JSON.parse(localStorage.getItem('selectedProxies')) || [];
        
        const url = "${CONVERTER_URL}";
        const res = await fetch(url, {
          method: "POST",
          body: JSON.stringify({
            url: selectedProxies.join(","),
            format: format,
            template: "cf",
          }),
        });

        if (res.status === 200) {
          let responseText = await res.text();
          
          // Format dokumen berdasarkan format
          if (format === "bfr") {
            // Format JSON untuk BFR
            responseText = formatJsonDocument(responseText);
          } else if (format === "clash" || format === "sfa") {
            // Format YAML untuk Clash dan SFA
            responseText = formatYamlDocument(responseText);
          }
          
          // Tampilkan dalam popup alih-alih menyalin ke clipboard
          showConfigPopup(responseText, format);
          
          // Hapus centang pada semua checkbox yang dipilih
          selectedProxies.forEach(() => {
            const checkboxes = document.querySelectorAll('input[type="checkbox"]:checked');
            checkboxes.forEach(checkbox => {
              checkbox.checked = false;
            });
          });
          
          // Kosongkan daftar proxy yang dipilih di localStorage
          localStorage.removeItem('selectedProxies');
        } else {
          alert('Failed to get proxies');
        }
      }

      // Add this button to the HTML to trigger the copySelectedProxies function
      // Add this function to toggle the visibility of proxy buttons
      function toggleProxyButtons(index) {
        const proxyButtons = document.getElementById('proxy-buttons-' + index);
        if (proxyButtons.classList.contains("hidden")) {
          proxyButtons.classList.remove("hidden");
        } else {
          proxyButtons.classList.add("hidden");
        }
      }

    </script>
    </body>

</html>
`;

class Document {
  proxies = [];

  constructor(request) {
    this.html = baseHTML;
    this.request = request;
    this.url = new URL(this.request.url);
  }

  setTitle(title) {
    this.html = this.html.replaceAll("PLACEHOLDER_JUDUL", title);
  }

  addInfo(text) {
    text = `<span>${text}</span>`;
    this.html = this.html.replaceAll("PLACEHOLDER_INFO", `${text}\nPLACEHOLDER_INFO`);
  }

  registerProxies(data, proxies) {
    this.proxies.push({
      ...data,
      list: proxies,
    });
  }

  buildProxyGroup() {
    let proxyGroupElement = "";
    proxyGroupElement += `<div class="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-6">`;
    for (let i = 0; i < this.proxies.length; i++) {
      const proxyData = this.proxies[i];

      // Assign proxies
      proxyGroupElement += `<div class="lozad scale-95 mb-2 dark:bg-neutral-800 transition-transform duration-200 rounded-lg p-2 w-full border-2 border-orange-600">`;
      proxyGroupElement += `  <div id="countryFlag" class="absolute -translate-y-9 -translate-x-2 border-2 border-neutral-800 overflow-hidden"><img width="35" height="25" src="https://flagcdn.com/w320/${proxyData.country.toLowerCase()}.png" /></div>`;
      proxyGroupElement += `  <div class="flex flex-col items-center">`;
      proxyGroupElement += `    <div class="text-center">`;
      proxyGroupElement += `      <div id="ping-${i}" class="animate-pulse text-xs font-semibold dark:text-white">Idle ${proxyData.proxyIP}:${proxyData.proxyPort}</div>`;
      proxyGroupElement += `      <div class="rounded py-1 px-2">`;
      proxyGroupElement += `        <h5 class="font-bold text-md text-neutral-900 dark:text-white mb-1 overflow-x-scroll scrollbar-hide text-nowrap">${proxyData.org}</h5>`;
      proxyGroupElement += `        <div class="text-neutral-900 dark:text-white text-sm">`;
      proxyGroupElement += `          <p>Ip: ${proxyData.proxyIP} - Port: ${proxyData.proxyPort}</p>`;
      proxyGroupElement += `          <div id="container-region-check-${i}">`;
      proxyGroupElement += `            <input id="config-sample-${i}" class="hidden" type="text" value="${proxyData.list[0]}">`;
      proxyGroupElement += `          </div>`;
      proxyGroupElement += `        </div>`;
      proxyGroupElement += `      </div>`;
      proxyGroupElement += `    </div>`;
      proxyGroupElement += `    <button class="bg-blue-500 dark:bg-neutral-800 dark:border-2 dark:border-blue-500 rounded p-1 w-full text-white mt-2" onclick="toggleProxyButtons(${i})">Show Proxies</button>`;
      proxyGroupElement += `    <div id="proxy-buttons-${i}" class="hidden grid grid-cols-3 gap-2 text-sm mt-2">`; // Container for proxy buttons
      for (let x = 0; x < proxyData.list.length; x++) {
        const indexName = [
          `${reverse("NAJORT")} TLS`,
          `${reverse("SSELV")} TLS`,
          `${reverse("SS")} TLS`,
          `${reverse("NAJORT")} NTLS`,
          `${reverse("SSELV")} NTLS`,
          `${reverse("SS")} NTLS`,
        ];
        const proxy = proxyData.list[x];

        proxyGroupElement += `<div class="flex items-center gap-2">`;
        proxyGroupElement += `<input type="checkbox" id="proxy-checkbox-${i}-${x}" onclick="toggleProxySelection('${proxy}', '${i}-${x}')">`;
        proxyGroupElement += `<button class="bg-blue-500 dark:bg-neutral-800 dark:border-2 dark:border-blue-500 rounded p-1 w-full text-white" onclick="copyToClipboard('${proxy}')">${indexName[x]}</button>`;
        proxyGroupElement += `</div>`;
      }
      proxyGroupElement += `    </div>`;
      proxyGroupElement += `  </div>`;
      proxyGroupElement += `</div>`;
    }
    proxyGroupElement += `</div>`;

    this.html = this.html.replaceAll("PLACEHOLDER_PROXY_GROUP", `${proxyGroupElement}`);
  }

  buildCountryFlag() {
    let flagElement = "";
    const codes = (cachedCountryCodes && cachedCountryCodes.length)
      ? cachedCountryCodes
      : Array.from(new Set((cachedProxyList || []).map(p => p.country)));

    for (const flag of codes) {
      flagElement += `
        <a href="/sub?cc=${flag}"
           class="flex flex-col items-center p-2 hover:bg-gray-100 dark:hover bg-neutral-700 rounded-lg transition-colors">
          <img width="35" height="25" src="https://flagcdn.com/w320/${flag.toLowerCase()}.png" class="mb-1" />
          <span class="text-xs font-medium text-center dark:text-white">${flag}</span>
        </a>`;
    }

    this.html = this.html.replaceAll("PLACEHOLDER_BENDERA_NEGARA", flagElement);
  }

  addPageButton(text, link, isDisabled) {
    const pageButton = `<li><button ${
      isDisabled ? "disabled" : ""
    } class="px-3 py-1 bg-amber-400 border-2 border-neutral-800 rounded" onclick=navigateTo('${link}')>${text}</button></li>`;

    this.html = this.html.replaceAll("PLACEHOLDER_PAGE_BUTTON", `${pageButton}\nPLACEHOLDER_PAGE_BUTTON`);
  }

  build() {
    this.buildProxyGroup();
    this.buildCountryFlag();

    this.html = this.html.replaceAll("PLACEHOLDER_API_READY", isApiReady ? "block" : "hidden");

    return this.html.replaceAll(/PLACEHOLDER_\w+/gim, "");
  }
}
