export interface ShareListItem {
  id: string;
  visibility: "public" | "private";
  title: string;
  url: string;
  createdAt: string;
  expiresAt: string | null;
  size: number;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SHARED_STYLES = `
  :root {
    color-scheme: light dark;
    --bg: #f6f7f9;
    --card: #ffffff;
    --text: #1c1e21;
    --muted: #606770;
    --border: #d8dde6;
    --accent: #2563eb;
    --accent-hover: #1d4ed8;
    --danger: #dc2626;
    --ok-bg: #ecfdf5;
    --ok-border: #10b981;
    --err-bg: #fef2f2;
    --err-border: #ef4444;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1115;
      --card: #181b20;
      --text: #e5e7eb;
      --muted: #9ca3af;
      --border: #2d333b;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --danger: #ef4444;
      --ok-bg: #064e3b;
      --ok-border: #10b981;
      --err-bg: #7f1d1d;
      --err-border: #ef4444;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 20px 16px 48px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
  }
  .container {
    max-width: 760px;
    margin: 0 auto;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 24px;
  }
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 6px;
  }
  h1 {
    margin: 0;
    font-size: 1.4rem;
  }
  .nav-link {
    color: var(--accent);
    text-decoration: none;
    font-size: 0.9rem;
    font-weight: 600;
  }
  .nav-link:hover { text-decoration: underline; }
  .subtitle {
    margin: 0 0 20px;
    color: var(--muted);
    font-size: 0.9rem;
  }
`;

export function renderUploadUi(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>htmlshare - HTML Upload</title>
  <style>
    ${SHARED_STYLES}
    label {
      display: block;
      font-size: 0.85rem;
      font-weight: 600;
      margin-bottom: 6px;
    }
    .field { margin-bottom: 16px; }
    .row {
      display: grid;
      grid-template-columns: 1fr 160px;
      gap: 12px;
    }
    @media (max-width: 600px) {
      .row { grid-template-columns: 1fr; }
    }
    input[type="text"],
    input[type="password"],
    input[type="number"],
    select,
    textarea {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: transparent;
      color: var(--text);
      font-size: 0.95rem;
      font-family: inherit;
    }
    input:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    textarea {
      min-height: 260px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.85rem;
      resize: vertical;
    }
    .inline-check {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 6px;
      font-size: 0.82rem;
      color: var(--muted);
      font-weight: normal;
    }
    .file-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .btn {
      appearance: none;
      border: none;
      border-radius: 8px;
      padding: 11px 18px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      background: var(--accent);
      color: #fff;
    }
    .btn:hover { background: var(--accent-hover); }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-secondary {
      background: transparent;
      color: var(--text);
      border: 1px solid var(--border);
      padding: 7px 12px;
      font-size: 0.85rem;
    }
    .btn-secondary:hover { background: rgba(128, 128, 128, 0.1); }
    .result {
      margin-top: 18px;
      padding: 14px;
      border-radius: 8px;
      border: 1px solid var(--border);
      display: none;
    }
    .result.ok {
      display: block;
      background: var(--ok-bg);
      border-color: var(--ok-border);
    }
    .result.err {
      display: block;
      background: var(--err-bg);
      border-color: var(--err-border);
    }
    .url-box {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .url-box a {
      word-break: break-all;
      color: inherit;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <main class="container">
    <div class="topbar">
      <h1>htmlshare</h1>
      <a class="nav-link" href="/private">非公開一覧を見る →</a>
    </div>
    <p class="subtitle">HTML をアップロードして共有 URL を発行します（最大 5MB / 限定公開は 1〜90 日、非公開は無期限）。</p>

    <form id="upload-form">
      <div class="field">
        <label for="visibility">公開範囲</label>
        <select id="visibility">
          <option value="public">限定公開（URL を知る全員が閲覧可能 / 最大 90 日で削除）</option>
          <option value="private">非公開（/private/* — Google ログイン限定・無期限・一覧あり）</option>
        </select>
      </div>

      <div class="row">
        <div class="field">
          <label for="title">タイトル（任意）</label>
          <input id="title" type="text" maxlength="200" placeholder="例: 試験対策シミュレーター" />
        </div>
        <div class="field">
          <label for="expires-days">有効期限（日）</label>
          <input id="expires-days" type="number" min="1" max="90" value="30" />
        </div>
      </div>

      <div class="field">
        <label for="content">HTML</label>
        <div class="file-row">
          <input id="file-input" type="file" accept=".html,.htm,text/html" />
        </div>
        <textarea id="content" required placeholder="<!DOCTYPE html>..."></textarea>
      </div>

      <button id="submit-btn" class="btn" type="submit">アップロード</button>
    </form>

    <div id="result" class="result" role="status" aria-live="polite"></div>
  </main>

  <script>
    try { localStorage.removeItem("htmlshare_api_key"); } catch {}
    const visibilityInput = document.getElementById("visibility");
    const titleInput = document.getElementById("title");
    const expiresInput = document.getElementById("expires-days");
    const fileInput = document.getElementById("file-input");
    const contentInput = document.getElementById("content");
    const form = document.getElementById("upload-form");
    const submitBtn = document.getElementById("submit-btn");
    const resultEl = document.getElementById("result");

    function syncVisibility() {
      const isPrivate = visibilityInput.value === "private";
      expiresInput.disabled = isPrivate;
    }
    visibilityInput.addEventListener("change", syncVisibility);
    syncVisibility();

    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      contentInput.value = await file.text();
      if (!titleInput.value.trim()) {
        titleInput.value = file.name.replace(/\\.(html?|HTML?)$/, "");
      }
    });

    function showError(message) {
      resultEl.className = "result err";
      resultEl.textContent = message;
    }

    function showSuccess(data) {
      resultEl.className = "result ok";
      resultEl.innerHTML = "";

      const header = document.createElement("div");
      header.textContent = data.expires_at
        ? "アップロード完了（有効期限: " + new Date(data.expires_at).toLocaleString("ja-JP") + "）"
        : "アップロード完了（非公開・無期限）";
      resultEl.appendChild(header);

      const box = document.createElement("div");
      box.className = "url-box";

      const link = document.createElement("a");
      link.href = data.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = data.url;

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "btn btn-secondary";
      copyBtn.textContent = "URL をコピー";
      copyBtn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(data.url);
        copyBtn.textContent = "コピーしました";
        setTimeout(() => { copyBtn.textContent = "URL をコピー"; }, 1800);
      });

      box.appendChild(link);
      box.appendChild(copyBtn);
      resultEl.appendChild(box);
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const content = contentInput.value;
      if (!content.trim()) {
        showError("HTML を入力してください。");
        return;
      }

      const visibility = visibilityInput.value;
      const payload = {
        content,
        title: titleInput.value.trim() || undefined,
        visibility,
      };
      if (visibility === "public") {
        payload.expires_days = Number(expiresInput.value) || 30;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "アップロード中...";
      try {
        const res = await fetch("/private/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Htmlshare-Ui": "1",
          },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          showError(data.error || "アップロードに失敗しました。");
          return;
        }
        showSuccess(data);
      } catch (err) {
        showError("通信エラーが発生しました: " + (err instanceof Error ? err.message : String(err)));
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "アップロード";
      }
    });
  </script>
</body>
</html>`;
}

function renderItemSection(
  heading: string,
  emptyText: string,
  items: ShareListItem[],
): string {
  const body =
    items.length === 0
      ? `<p class="empty">${escapeHtml(emptyText)}</p>`
      : `<ul class="item-list">
          ${items
            .map((item) => {
              const title = escapeHtml(item.title || "(無題)");
              const kb = Math.max(1, Math.round(item.size / 1024));
              const dateText = item.createdAt
                ? escapeHtml(new Date(item.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }))
                : "日時不明";
              const expiresText = item.expiresAt
                ? ` ・ 期限 ${escapeHtml(new Date(item.expiresAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }))}`
                : "";
              return `<li class="item" data-id="${escapeHtml(item.id)}">
                <div class="item-main">
                  <a class="item-title" href="${escapeHtml(item.url)}">${title}</a>
                  <div class="item-meta">${dateText}${expiresText} ・ 約 ${kb} KB</div>
                </div>
                <button class="btn-delete" type="button" onclick="deleteItem('${item.visibility}', '${escapeHtml(item.id)}', this)">削除</button>
              </li>`;
            })
            .join("")}
        </ul>`;

  return `<section class="section">
    <h2 class="section-title">${escapeHtml(heading)}（${items.length} 件）</h2>
    ${body}
  </section>`;
}

export function renderPrivateListUi(
  privateItems: ShareListItem[],
  publicItems: ShareListItem[],
): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>htmlshare - 一覧管理</title>
  <style>
    ${SHARED_STYLES}
    .section { margin-top: 24px; }
    .section-title {
      margin: 0 0 12px;
      font-size: 1.05rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 6px;
    }
    .empty {
      color: var(--muted);
      padding: 16px 0;
      text-align: center;
      font-size: 0.9rem;
    }
    .item-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      border: 1px solid var(--border);
      border-radius: 10px;
    }
    .item-main { min-width: 0; }
    .item-title {
      display: block;
      font-weight: 600;
      color: var(--text);
      text-decoration: none;
      word-break: break-word;
    }
    .item-title:hover { color: var(--accent); text-decoration: underline; }
    .item-meta {
      margin-top: 4px;
      font-size: 0.82rem;
      color: var(--muted);
    }
    .btn-delete {
      flex-shrink: 0;
      appearance: none;
      background: transparent;
      color: var(--danger);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 12px;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .btn-delete:hover {
      border-color: var(--danger);
    }
  </style>
</head>
<body>
  <main class="container">
    <div class="topbar">
      <h1>htmlshare 一覧管理</h1>
      <a class="nav-link" href="/private/upload">＋ 新規アップロード</a>
    </div>
    <p class="subtitle">非公開（無期限）と限定公開（期限付き）の HTML を確認・削除できます。</p>
    ${renderItemSection("非公開 HTML", "非公開 HTML はまだありません。", privateItems)}
    ${renderItemSection("限定公開 HTML", "限定公開中の HTML はありません。", publicItems)}
  </main>

  <script>
    async function deleteItem(visibility, id, btn) {
      if (!confirm("この HTML を削除しますか？")) return;
      btn.disabled = true;
      try {
        const res = await fetch("/private/items/" + encodeURIComponent(visibility) + "/" + encodeURIComponent(id), {
          method: "DELETE",
          headers: { "X-Htmlshare-Ui": "1" },
        });
        if (!res.ok) {
          alert("削除に失敗しました (" + res.status + ")");
          btn.disabled = false;
          return;
        }
        const li = btn.closest("li");
        if (li) li.remove();
      } catch (err) {
        alert("通信エラー: " + (err instanceof Error ? err.message : String(err)));
        btn.disabled = false;
      }
    }
  </script>
</body>
</html>`;
}
