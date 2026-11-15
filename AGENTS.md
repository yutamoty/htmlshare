# AGENTS.md (htmlshare)

HTML をアップロードしてユニーク URL (`https://share.yutamoty.com/{id}`) で閲覧・共有するサービス。

## ブランチ・Git ルール

- デフォルトブランチ: `main`
- `.dev.vars` や `.env`、API キーは絶対にコミットしない

## ディレクトリ構成

- `worker/`: Cloudflare Workers (TypeScript / Hono) + R2
- `mcp/`: MCP サーバー (`@modelcontextprotocol/sdk`)

## よく使うコマンド

```sh
# Worker の型チェック
cd worker && npm run typecheck

# Worker のローカル起動
cd worker && npm run dev

# Worker のデプロイ
cd worker && npm run deploy
```

## 設計方針

- `GET /`: 404 を返す（アップロードフォームを公開しない）
- `GET /private/upload` / `POST /private/upload`: Web UI によるアップロード画面とアップロード受付（Cloudflare Access で保護、`POST` は `X-Htmlshare-Ui: 1` ヘッダー必須）
- `GET /private`: 非公開・限定公開 HTML の一覧管理ページを返す（Cloudflare Access で `share.yutamoty.com/private` 配下を保護する前提）
- `DELETE /private/items/{visibility}/{id}`: 管理 UI から公開・非公開アイテムを削除する（`X-Htmlshare-Ui: 1` ヘッダー必須）
- `GET /private/{id}`: 非公開 HTML (`private/{id}`) を取得して返す
- `POST /api/upload`: `Authorization: Bearer <API_KEY>` で認証し、R2 に HTML を保存して `{ id, visibility, url, expires_at }` を返す（`visibility`: `"public"` は `public/{id}` で最大 90 日、`"private"` は `private/{id}` で無期限）
- `GET /api/items`: `Authorization: Bearer <API_KEY>` で認証し、アップロード済みアイテム一覧を返す
- `DELETE /api/items/{visibility}/{id}`: `Authorization: Bearer <API_KEY>` で認証し、公開・非公開を問わず削除する
- `GET /{id}`: 限定公開 HTML (`public/{id}`) を取得し、`expires_at` を確認したうえで `text/html; charset=utf-8` でそのまま返す
