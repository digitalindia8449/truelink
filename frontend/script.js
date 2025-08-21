// =============================
// File: frontend/script.js
// =============================
const el = (id) => document.getElementById(id);

async function createLink() {
  const url = el("url").value.trim();
  const slug = el("slug").value.trim();
  el("msg").textContent = "";
  el("resultBox").classList.add("hidden");

  if (!/^https?:\/\//i.test(url)) {
    el("msg").textContent = "Enter a valid http/https URL.";
    return;
  }

  try {
    const res = await fetch("/api/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, slug: slug || undefined }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Failed to create link");

    // ✅ Always full short URL (absolute)
    const shortUrl = `${window.location.protocol}//${window.location.host}/r/${data.id}`;

    // Show result
    el("resultBox").classList.remove("hidden");
    const a = el("shortLink");
    a.href = shortUrl;
    a.textContent = shortUrl;

    const openBtn = el("btnOpen");
    openBtn.href = shortUrl;

    // QR code
    const box = el("qrcode");
    box.innerHTML = "";
    new QRCode(box, {
      text: shortUrl,
      width: 160,
      height: 160,
      correctLevel: QRCode.CorrectLevel.M,
    });

    await loadRecent();
  } catch (e) {
    el("msg").textContent = e.message;
  }
}

async function loadRecent() {
  try {
    const res = await fetch("/api/links");
    const data = await res.json();
    if (!data.ok) return;
    const wrap = el("recent");
    wrap.innerHTML = "";

    if (!data.rows.length) {
      wrap.innerHTML = '<div class="text-gray-500">No links yet.</div>';
      return;
    }

    data.rows.forEach((r) => {
      const shortUrl = `${window.location.protocol}//${window.location.host}/r/${r.id}`;
      const s = `
        <div class="flex items-center justify-between gap-3 border border-gray-200 rounded-lg p-3">
          <div class="min-w-0">
            <div class="font-medium truncate">${shortUrl}</div>
            <div class="text-gray-500 truncate">${r.url}</div>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <a class="text-sm underline" href="${shortUrl}" target="_blank">Open</a>
            <button class="text-sm underline" data-copy="${shortUrl}">Copy</button>
          </div>
        </div>`;
      const div = document.createElement("div");
      div.innerHTML = s;
      wrap.appendChild(div.firstElementChild);
    });

    // ✅ Reliable copy handling
    wrap.querySelectorAll("[data-copy]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const text = btn.getAttribute("data-copy");
        try {
          await navigator.clipboard.writeText(text);
          btn.textContent = "Copied";
        } catch {
          // fallback (execCommand for Safari/older browsers)
          const tmp = document.createElement("textarea");
          tmp.value = text;
          document.body.appendChild(tmp);
          tmp.select();
          document.execCommand("copy");
          document.body.removeChild(tmp);
          btn.textContent = "Copied";
        }
        setTimeout(() => (btn.textContent = "Copy"), 1200);
      });
    });
  } catch (e) {
    console.error("Failed to load recent links:", e);
  }
}

// Events
addEventListener("DOMContentLoaded", () => {
  el("btnGen").addEventListener("click", createLink);

  el("btnCopy").addEventListener("click", async () => {
    const t = el("shortLink").textContent;
    if (t) {
      try {
        await navigator.clipboard.writeText(t);
      } catch {
        const tmp = document.createElement("textarea");
        tmp.value = t;
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand("copy");
        document.body.removeChild(tmp);
      }
      el("btnCopy").textContent = "Copied";
      setTimeout(() => (el("btnCopy").textContent = "Copy"), 1200);
    }
  });

  el("btnRefresh").addEventListener("click", loadRecent);
  loadRecent();
});
