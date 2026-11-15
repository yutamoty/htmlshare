# htmlshare

AI が生成した HTML やローカルの HTML ファイルをアップロードし、ユニーク URL (`https://share.yutamoty.com/{id}`) で閲覧・共有するための軽量サービス。

## 構成

- `worker/`: Cloudflare Workers (Hono) + Cloudflare R2 による API・HTML 配信・Web UI
- `mcp/`: MCP サーバー (`upload_html` ツール)

## セットアップ

### 1. Worker (GitHub Actions で自動デプロイ)

`main` ブランチの `worker/` に push すると、`.github/workflows/deploy.yml` によって自動で型チェックと Cloudflare Workers へのデプロイが走ります。

事前準備:

1. Cloudflare ダッシュボード等で R2 バケット `htmlshare` を作成し、`public/` プレフィックスに対して 90 日後に削除する Lifecycle Rule を設定する
2. GitHub リポジトリの Secrets に `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を登録する
3. デプロイ後、Cloudflare ダッシュボード（または `npx wrangler secret put API_KEY`）で Worker のシークレット `API_KEY` を設定する

ローカル開発:

```sh
cd worker
cp .dev.vars.example .dev.vars
npm run dev
```

### 2. 非公開ページ (`/private*`) の保護

Cloudflare Zero Trust (Access) で `share.yutamoty.com/private*` を Self-hosted アプリケーションとして登録し、Google ログイン等で自分のアカウントのみ許可してください。
