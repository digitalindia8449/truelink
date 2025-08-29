// ===== TrueLink Frontend (full script.js) =====

const el = (id) => document.getElementById(id);

// --- ensure delete modal exists (inject if missing) ---
function ensureDeleteModal() {
  if (document.getElementById("deleteModal")) return;

  const modal = document.createElement("div");
  modal.id = "deleteModal";
  modal.className =
    "fixed inset-0 bg-black/50 hidden items-center justify-center z-50 opacity-0 transition-opacity duration-150";
  modal.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full text-center transform transition-all duration-150 scale-95">
      <h3 class="text-lg font-semibold mb-1">Delete this link?</h3>
      <p class="text-sm text-gray-600 mb-6">This action cannot be undone.</p>
      <div class="flex justify-center gap-3">
        <button id="btnCancelDelete"
          class="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100">
          Cancel
        </button>
        <button id="btnConfirmDelete"
          class="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 shadow">
          Delete
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}
ensureDeleteModal();

// --- toast-ish message in #msg ---
function setMsg(text, isError = true) {
  const msg = el("msg");
  if (!msg) return;
  msg.textContent = text || "";
  msg.classList.toggle("text-red-600", !!isError);
  msg.classList.toggle("text-green-600", !isError);
  if (text) {
    setTimeout(() => {
      if (msg.textContent === text) msg.textContent = "";
    }, 1500);
  }
}

// --- helpers ---
function extractIdFromShortUrl(shortUrl) {
  try {
    const u = new URL(shortUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "r" && parts[1]) return parts[1];
  } catch {}
  return "";
}

function openDeleteModal() {
  const modal = document.getElementById("deleteModal");
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  // trigger fade-in
  requestAnimationFrame(() => {
    modal.style.opacity = "1";
    const card = modal.firstElementChild;
    if (card) card.style.transform = "scale(1)";
  });
}

function closeDeleteModal() {
  const modal = document.getElementById("deleteModal");
  if (!modal) return;
  modal.style.opacity = "0";
  const card = modal.firstElementChild;
  if (card) card.style.transform = "scale(0.95)";
  setTimeout(() => {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }, 150);
}

// --- state for delete modal ---
let deleteTarget = null; // { id, shortUrl }

// --- create short link ---
async function createLink() {
  const url = el("url").value.trim();
  const slug = el("slug").value.trim();
  setMsg("");
  el("resultBox").classList.add("hidden");

  // allow http/https/mailto
  const isHttp = /^https?:\/\//i.test(url);
  const isMailto = /^mailto:/i.test(url);
  if (!isHttp && !isMailto) {
    setMsg("Enter a valid http/https or mailto: URL.");
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

    // build absolute short url
    const shortUrl = `${window.location.protocol}//${window.location.host}/r/${data.id}`;

    // show result
    el("resultBox").classList.remove("hidden");
    el("shortLink").href = shortUrl;
    el("shortLink").textContent = shortUrl;
    el("btnOpen").href = shortUrl;

    // QR
    const box = el("qrcode");
    box.innerHTML = "";
    new QRCode(box, {
      text: shortUrl,
      width: 160,
      height: 160,
      correctLevel: QRCode.CorrectLevel.M,
    });

    // save to local recent list
    let recent = JSON.parse(localStorage.getItem("recentLinks") || "[]");
    recent.unshift({ shortUrl, url, createdAt: Date.now() });
    if (recent.length > 50) recent.pop();
    localStorage.setItem("recentLinks", JSON.stringify(recent));

    setMsg("Link created!", false);
    await loadRecent();
  } catch (e) {
    setMsg(e.message || "Error creating link");
  }
}

// --- load and render recent (from localStorage) ---
function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

async function loadRecent() {
  const wrap = el("recent");
  if (!wrap) return;
  wrap.innerHTML = "";

  let data = JSON.parse(localStorage.getItem("recentLinks") || "[]");
  if (!data.length) {
    wrap.innerHTML = '<div class="text-gray-500">No links yet.</div>';
    return;
  }

  data.forEach((r) => {
    const id = extractIdFromShortUrl(r.shortUrl);
    const row = document.createElement("div");
    row.className =
      "flex items-center justify-between gap-3 border border-gray-200 rounded-lg p-3";
    row.innerHTML = `
      <div class="min-w-0">
        <div class="font-medium truncate">${r.shortUrl}</div>
        <div class="text-gray-500 truncate">→ ${r.url}</div>
        <div class="text-xs text-gray-400 mt-0.5">${fmtTime(r.createdAt || Date.now())}</div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <a class="text-sm underline" href="${r.shortUrl}" target="_blank">Open</a>
        <button class="text-sm underline" data-copy="${r.shortUrl}">Copy</button>
        <button class="text-sm text-red-600 underline" data-delete-id="${id}" data-delete-short="${r.shortUrl}">
          Delete
        </button>
      </div>
    `;
    wrap.appendChild(row);
  });

  // copy handlers
  wrap.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = btn.getAttribute("data-copy");
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const tmp = document.createElement("textarea");
        tmp.value = text;
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand("copy");
        document.body.removeChild(tmp);
      }
      const old = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = old), 1200);
    });
  });

  // delete handlers (open modal)
  wrap.querySelectorAll("[data-delete-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      deleteTarget = {
        id: btn.getAttribute("data-delete-id"),
        shortUrl: btn.getAttribute("data-delete-short"),
      };
      openDeleteModal();
    });
  });
}

// --- perform delete (server + local) ---
async function performDelete() {
  if (!deleteTarget) return;
  const { id, shortUrl } = deleteTarget;

  // hit backend (ignore errors so UI still cleans up)
  try {
    const res = await fetch(`/api/delete/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    // optional: check result, but we'll cleanup regardless
    await res.json().catch(() => {});
  } catch {}

  // remove locally
  let recent = JSON.parse(localStorage.getItem("recentLinks") || "[]");
  recent = recent.filter((x) => x.shortUrl !== shortUrl);
  localStorage.setItem("recentLinks", JSON.stringify(recent));

  await loadRecent();
  setMsg(`Deleted ${id}`, false);
}

// --- events ---
addEventListener("DOMContentLoaded", () => {
  // main buttons
  el("btnGen")?.addEventListener("click", createLink);

  el("btnCopy")?.addEventListener("click", async () => {
    const t = el("shortLink").textContent;
    if (!t) return;
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
    const b = el("btnCopy");
    const old = b.textContent;
    b.textContent = "Copied";
    setTimeout(() => (b.textContent = old), 1200);
  });

  el("btnRefresh")?.addEventListener("click", loadRecent);

  // modal buttons
  const modal = document.getElementById("deleteModal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      // click on backdrop closes
      if (e.target === modal) {
        deleteTarget = null;
        closeDeleteModal();
      }
    });
  }

  document.getElementById("btnCancelDelete")?.addEventListener("click", () => {
    deleteTarget = null;
    closeDeleteModal();
  });

  document.getElementById("btnConfirmDelete")?.addEventListener("click", async () => {
    await performDelete();
    deleteTarget = null;
    closeDeleteModal();
  });

  // initial
  loadRecent();
});
