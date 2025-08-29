// =============================
// File: backend/server.js
// =============================
const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// Let Express trust reverse proxies (needed to read X-Forwarded-* correctly)
app.set("trust proxy", true);

// In-memory store (replace with DB for production)
const linkStore = {};
const permanentLinks = {};

app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend"))); // serve frontend files

// Serve index.html at root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// --- helpers ---
function isValidUrl(str) {
  try {
    const u = new URL(str);
    return (
      u.protocol === "http:" ||
      u.protocol === "https:" ||
      u.protocol === "mailto:"
    );
  } catch (_) {
    return false;
  }
}


function generateId(n = 4) {
  return crypto.randomBytes(n).toString("base64url").slice(0, n + 2);
}

function getOrigin(req) {
  // Prefer forwarded headers when behind a proxy (Vercel, Render, etc.)
  const proto =
    (req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function detectApp(urlStr) {
  try {
    const u = new URL(urlStr);

    // Gmail via mailto:
    if (u.protocol === "mailto:") {
      return { app: "gmail", meta: { kind: "mailto", fields: parseMailto(urlStr) } };
    }

    const host = (u.hostname || "").replace(/^www\./, "");

    // Gmail Web compose
    if (
      host === "mail.google.com" &&
      u.pathname.startsWith("/mail/") &&
      (u.searchParams.get("view") === "cm" || u.searchParams.get("compose") === "1" || u.searchParams.get("fs") === "1")
    ) {
      return { app: "gmail", meta: { kind: "web", fields: parseGmailWeb(u), u } };
    }

    if (host.includes("youtube.com") || host === "youtu.be")
      return { app: "youtube", meta: { u } };
    if (host === "wa.me" || host.includes("whatsapp.com"))
      return { app: "whatsapp", meta: { u } };
    if (host === "t.me" || host.includes("telegram.me") || host.includes("telegram.org"))
      return { app: "telegram", meta: { u } };
    if (host.includes("instagram.com"))
      return { app: "instagram", meta: { u } };
    if (host.startsWith("amazon.") || host.includes("amazon."))
      return { app: "amazon", meta: { u } };
    if (host.includes("twitter.com") || host.includes("x.com"))
      return { app: "twitter", meta: { u } };
    if (host.includes("facebook.com"))
      return { app: "facebook", meta: { u } };
    return { app: null, meta: { u } };
  } catch (e) {
    return { app: null, meta: {} };
  }
}

function parseMailto(urlStr) {
  const u = new URL(urlStr); // mailto:
  const to = decodeURIComponent(u.pathname || "").trim();
  const p = u.searchParams;
  return {
    to,
    subject: p.get("subject") || p.get("su") || "",
    body: p.get("body") || "",
    cc: p.get("cc") || "",
    bcc: p.get("bcc") || "",
  };
}

// Accept Gmail Web compose links like:
// https://mail.google.com/mail/?view=cm&fs=1&to=...&su=...&body=...&cc=...&bcc=...
function parseGmailWeb(u) {
  const p = u.searchParams;
  return {
    to: p.get("to") || "",
    subject: p.get("su") || "",
    body: p.get("body") || "",
    cc: p.get("cc") || "",
    bcc: p.get("bcc") || "",
  };
}


function buildChromeScheme(fallbackHttps) {
  return `googlechrome://${fallbackHttps.replace(/^https?:\/\//, "")}`;
}

// Build a best-effort deep link.
function buildDeepLink(urlStr, userAgent) {
  const { app, meta } = detectApp(urlStr);
  const u = meta.u;
  const fallbackHttps = urlStr; 
  const chromeScheme = buildChromeScheme(fallbackHttps);

  let ios = null;
  let androidIntent = null;

  const encFB = encodeURIComponent(fallbackHttps);
  const asHostPath = (urlObj) =>
    `${urlObj.hostname}${urlObj.pathname}${urlObj.search}${urlObj.hash || ""}`;

  switch (app) {
    case "youtube": {
      let vId = u.searchParams.get("v");
      if (!vId && u.hostname === "youtu.be") vId = u.pathname.slice(1);
      ios = vId ? `youtube://watch?v=${vId}` : `youtube://`;
      const hostPath = vId
        ? `www.youtube.com/watch?v=${encodeURIComponent(vId)}`
        : asHostPath(new URL(`https://www.youtube.com`));
      androidIntent = `intent://${hostPath}#Intent;scheme=https;package=com.google.android.youtube;S.browser_fallback_url=${encFB};end`;
      break;
    }
    case "whatsapp": {
      const pathDigits = u.pathname.replace(/^\/send\/?/, "").replace(/\//g, "");
      const phone = u.searchParams.get("phone") || (/^\d{6,15}$/.test(pathDigits) ? pathDigits : "");
      const text = u.searchParams.get("text") || "";
      const qp = new URLSearchParams();
      if (phone) qp.set("phone", phone);
      if (text) qp.set("text", text);
      const q = qp.toString();
      ios = q ? `whatsapp://send?${q}` : `whatsapp://send`;
      androidIntent = `intent://send${q ? `?${q}` : ""}#Intent;scheme=whatsapp;package=com.whatsapp;S.browser_fallback_url=${encFB};end`;
      break;
    }
    case "telegram": {
      const path = u.pathname.replace(/^\//, "");
      const userMatch = path.match(/^([A-Za-z0-9_]{5,32})$/);
      if (userMatch) ios = `tg://resolve?domain=${userMatch[1]}`;
      const hostPath = asHostPath(u);
      androidIntent = `intent://${hostPath}#Intent;scheme=https;package=org.telegram.messenger;S.browser_fallback_url=${encFB};end`;
      break;
    }
    case "instagram": {
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts[0] && parts[0] !== "p") ios = `instagram://user?username=${encodeURIComponent(parts[0])}`;
      else ios = `instagram://`;
      const hostPath = asHostPath(u);
      androidIntent = `intent://${hostPath}#Intent;scheme=https;package=com.instagram.android;S.browser_fallback_url=${encFB};end`;
      break;
    }
    case "amazon": {
      ios = `amazon://`;
      const hostPath = asHostPath(u);
      androidIntent = `intent://${hostPath}#Intent;scheme=https;package=com.amazon.mShop.android.shopping;S.browser_fallback_url=${encFB};end`;
      break;
    }
    case "twitter": {
      let iosScheme = `twitter://`;
      const statusIdMatch = u.pathname.match(/\/status\/(\d+)/);
      if (statusIdMatch) iosScheme = `twitter://status?id=${statusIdMatch[1]}`;
      ios = iosScheme;
      const hostPath = asHostPath(u);
      androidIntent = `intent://${hostPath}#Intent;scheme=https;package=com.twitter.android;S.browser_fallback_url=${encFB};end`;
      break;
    }
    case "facebook": {
      ios = `fb://`;
      const hostPath = asHostPath(u);
      androidIntent = `intent://${hostPath}#Intent;scheme=https;package=com.facebook.katana;S.browser_fallback_url=${encFB};end`;
      break;
    }
      case "gmail": {
  // normalize fields from mailto: or Gmail Web
  const m = (meta && meta.fields) || {};
  const qp = new URLSearchParams();
  if (m.to) qp.set("to", m.to);
  if (m.subject) qp.set("subject", m.subject);
  if (m.body) qp.set("body", m.body);
  if (m.cc) qp.set("cc", m.cc);
  if (m.bcc) qp.set("bcc", m.bcc);

  // iOS: open Gmail app
  ios = `googlegmail:///co?${qp.toString()}`;

  // Gmail Web compose (fallback)
  const gmailWeb = new URL("https://mail.google.com/mail/");
  gmailWeb.searchParams.set("view", "cm");
  gmailWeb.searchParams.set("fs", "1");
  if (m.to) gmailWeb.searchParams.set("to", m.to);
  if (m.subject) gmailWeb.searchParams.set("su", m.subject);
  if (m.body) gmailWeb.searchParams.set("body", m.body);
  if (m.cc) gmailWeb.searchParams.set("cc", m.cc);
  if (m.bcc) gmailWeb.searchParams.set("bcc", m.bcc);
  const gmailWebStr = gmailWeb.toString();

  // Android: force Gmail app via package + mailto: data
  const mailtoQp = new URLSearchParams();
  if (m.subject) mailtoQp.set("subject", m.subject);
  if (m.body) mailtoQp.set("body", m.body);
  if (m.cc) mailtoQp.set("cc", m.cc);
  if (m.bcc) mailtoQp.set("bcc", m.bcc);
  const mailtoCore = `mailto:${encodeURIComponent(m.to || "")}${mailtoQp.toString() ? "?" + mailtoQp.toString() : ""}`;

  androidIntent =
    `intent://${mailtoCore.replace(/^mailto:/, "")}` +
    `#Intent;scheme=mailto;package=com.google.android.gm;` +
    `S.browser_fallback_url=${encodeURIComponent(gmailWebStr)};end`;

  // Fallbacks for the redirect HTML
  // If original was Gmail Web, keep it; if original was mailto, use Gmail Web as fallback
  const fb = (meta && meta.kind === "web") ? (meta.u ? meta.u.toString() : gmailWebStr) : gmailWebStr;

  return {
    ios,
    androidIntent,
    fallbackHttps: fb,
    chromeScheme: buildChromeScheme(fb),
  };
}
    default: {
      const hostPath = asHostPath(u);
      androidIntent = `intent://${hostPath}#Intent;scheme=${u.protocol.replace(":", "")};S.browser_fallback_url=${encFB};end`;
      ios = null;
    }
  }
  return { ios, androidIntent, fallbackHttps, chromeScheme };
}

// --- API: create short link ---
app.post("/api/create", (req, res) => {
  const { url, slug } = req.body || {};
 if (!url || !isValidUrl(url)) {
  return res.status(400).json({ ok: false, error: "Valid URL is required (http/https/mailto)." });
}


  let id = (slug || "").trim();
  if (id) {
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(id)) return res.status(400).json({ ok: false, error: "Slug must be 3-32 chars (a-z, 0-9, -, _)." });
    if (linkStore[id] || permanentLinks[id]) return res.status(409).json({ ok: false, error: "Slug already in use." });
  } else {
    do { id = generateId(3); } while (linkStore[id] || permanentLinks[id]);
  }

  const data = { url, slug: id, createdAt: Date.now() };
  permanentLinks[id] = data;
  linkStore[id] = data;

  const origin = getOrigin(req);
  return res.json({ ok: true, id, shortUrl: `${origin}/r/${id}` });
});

// --- Redirect handler ---
app.get("/r/:id", (req, res) => {
  const item = permanentLinks[req.params.id];
  if (!item) return res.status(404).send("Link not found");

  const { ios, androidIntent, fallbackHttps, chromeScheme } = buildDeepLink(
    item.url,
    req.headers["user-agent"] || ""
  );

  res.setHeader("Cache-Control", "no-store");
  res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Opening App…</title>
  <!-- Google Fonts -->
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700&family=Roboto:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --accent: #4f46e5;
      --accent-hover: #4338ca;
      --text: #111827;
      --muted: #6b7280;
      --glass-bg: rgba(255, 255, 255, 0.85);
      --shadow: 0 20px 50px rgba(0, 0, 0, 0.08);
    }

    body {
      margin: 0;
      font-family: 'Roboto', system-ui, sans-serif;
      color: var(--text);
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      overflow: hidden;
      background: linear-gradient(135deg, #f0f4f8, #e2e8f0, #f8fafc);
      padding: 1rem;
      box-sizing: border-box;
    }

    .card {
      background: var(--glass-bg);
      backdrop-filter: blur(20px) saturate(140%);
      -webkit-backdrop-filter: blur(20px) saturate(140%);
      border-radius: 1.6rem;
      box-shadow: var(--shadow);
      padding: 2rem;
      max-width: 420px;
      width: 100%;
      text-align: center;
      color: var(--text);
      animation: fadeInUp 1s ease forwards;
      border: 1px solid rgba(0,0,0,0.05);
      box-sizing: border-box;
    }

    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(25px); }
      to { opacity: 1; transform: translateY(0); }
    }

    h2 {
      margin: 0 0 0.75rem;
      font-size: 2rem;
      font-family: 'Poppins', sans-serif;
      font-weight: 700;
      background: linear-gradient(90deg, #4f46e5, #4338ca, #6366f1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      animation: gradientText 3s ease infinite;
      word-break: break-word;
    }

    @keyframes gradientText {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }

    h2 .dot {
      display: inline-block;
      background: linear-gradient(90deg, #4f46e5, #4338ca, #6366f1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      animation: bounceDots 1.5s infinite, gradientText 3s ease infinite;
    }

    h2 .dot:nth-child(2) { animation-delay: 0.2s, 0s; }
    h2 .dot:nth-child(3) { animation-delay: 0.4s, 0s; }

    @keyframes bounceDots {
      0%, 80%, 100% { transform: translateY(0); }
      40% { transform: translateY(-6px); }
    }

    p {
      margin: 0.5rem 0 1.6rem;
      font-size: 1rem;
      font-family: 'Roboto', sans-serif;
      color: var(--muted);
      line-height: 1.5;
    }

    /* Sleek lightweight spinner */
    .spinner {
      width: 50px;
      height: 50px;
      border: 4px solid rgba(79, 70, 229, 0.2);
      border-top-color: var(--accent);
      border-radius: 50%;
      margin: 1rem auto 1.6rem;
      animation: spin 1.2s linear infinite;
      box-shadow: 0 0 8px rgba(79,70,229,0.2);
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    a {
      display: inline-block;
      margin-top: 0.5rem;
      padding: 0.85rem 1.8rem;
      background: var(--accent);
      color: white;
      font-family: 'Poppins', sans-serif;
      font-weight: 600;
      font-size: 0.95rem;
      border-radius: 0.9rem;
      text-decoration: none;
      transition: all 0.35s ease;
      box-shadow: 0 10px 28px rgba(79,70,229,0.2);
      word-break: break-word;
    }

    a:hover {
      background: var(--accent-hover);
      transform: translateY(-2px) scale(1.02);
      box-shadow: 0 14px 36px rgba(79,70,229,0.25);
    }

    @media (max-width: 480px) {
      h2 { font-size: 1.5rem; }
      p { font-size: 0.9rem; }
      .spinner { width: 40px; height: 40px; border-width: 3px; }
      a { padding: 0.7rem 1.5rem; font-size: 0.9rem; }
      .card { padding: 1.5rem; }
    }

    @media (max-width: 360px) {
      h2 { font-size: 1.3rem; }
      p { font-size: 0.85rem; }
      .spinner { width: 35px; height: 35px; border-width: 3px; }
      a { padding: 0.6rem 1.2rem; font-size: 0.85rem; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h2>
      Opening the app<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>
    </h2>
    <p>If nothing happens, the link will open in your browser automatically.</p>
    <a id="openChrome" href="${chromeScheme}" rel="noopener noreferrer">Open in Chrome</a>
  </div>

  <script>
    (function(){
      var ua = navigator.userAgent || navigator.vendor || window.opera;
      var isAndroid = /android/i.test(ua);
      var isIOS = /iPhone|iPad|iPod/i.test(ua);

      var intentUrl = ${JSON.stringify(androidIntent)};
      var iosUrl = ${JSON.stringify(ios)};
      var httpsFallback = ${JSON.stringify(fallbackHttps)};
      var chromeScheme = ${JSON.stringify(chromeScheme)};

      function go(href){ if (href) window.location.href = href; }

      if (isAndroid) {
        go(intentUrl);
        setTimeout(function(){ go(httpsFallback); }, 1200);
      } else if (isIOS) {
        var triedScheme = false;
        if (iosUrl) { triedScheme = true; go(iosUrl); }
        setTimeout(function(){
          go(chromeScheme);
          setTimeout(function(){ go(httpsFallback); }, 900);
        }, triedScheme ? 700 : 0);
      } else {
        go(httpsFallback);
      }
    })();
  </script>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
