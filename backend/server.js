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
function isValidHttpUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === "http:" || u.protocol === "https:";
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
    const host = u.hostname.replace(/^www\./, "");
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
  if (!url || !isValidHttpUrl(url)) {
    return res.status(400).json({ ok: false, error: "Valid URL is required (http/https)." });
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
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700&family=Roboto:wght@400;500&display=swap" rel="stylesheet">
  <style>
    /* CSS same as before */
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h2>
      Opening the app<span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>
    </h2>
    <p>If nothing happens, the link will open in your browser automatically.</p>
    <a id="openChrome" href="${chromeScheme}" rel="noopener noreferrer">Open in Browser</a>
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
</html>
`);
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
