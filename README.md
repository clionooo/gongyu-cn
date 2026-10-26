# Gongyu（汉化版）

> 本仓库为 [angristan/gongyu](https://github.com/angristan/gongyu) 的简体中文汉化版，由 [clionooo](https://github.com/clionooo) 汉化并部署。界面文案、提示语均已中文化，并新增管理员密码登录功能（原版仅支持通行密钥）。

Gongyu is a single-user bookmark manager inspired by [Shaarli](https://github.com/shaarli/Shaarli). It runs on Cloudflare Workers with React Router, Effect, and TypeScript.

<p align="center">
  <a href="https://bookmarks.stanislas.blog/">
    <img src="apps/web/public/og-image.png" alt="Gongyu bookmark manager" width="1200">
  </a>
</p>

Gongyu provides public bookmark pages, full-text search, an Atom feed, passkey administration, and a bookmarklet. It extracts metadata and thumbnails in the background, supports data backup and transfer, and can post new bookmarks to Mastodon, Bluesky, and X.

## Architecture

```text
Browser
   |
   v
+---------------------------+
| Cloudflare Worker         |
| React Router SSR + Effect |
+-------------+-------------+
              |
       +------+------+
       |      |      |
       v      v      v
      D1     R2   Queues / Workflows
```

D1 stores application state, R2 stores private files, and Cloudflare Queues and Workflows run background jobs.

## Documentation

[Development](docs/development.md) covers local setup, repository layout, and checks. [Self-hosting](docs/self-hosting.md) covers Cloudflare provisioning, deployment, updates, and recovery. [Public routes](docs/routes.md) lists the browser-facing endpoints.
