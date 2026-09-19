# dsh-balance-bar

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web plugin that shows
your model-provider account balance as a **vertical progress bar pinned to the right edge of
the GUI**, with colour bands that tell you how much runway you have left — and a persistent
animated wave for whatever you hold above the healthy threshold.

```
        ┌──┐
        │≈≈│   ← balance > 50: light blue-violet waves, always moving
        │≈≈│
        │▓▓│
        │▓▓│   ← 30 – 50: green
        │▓▓│
        │▓▓│   ← 10 – 30: yellow
        └──┘   ← < 10: red
         ¥10.06
```

| Balance (CNY) | Fill |
|---|---|
| `< 10` | **red** — time to top up |
| `10 – 30` | **yellow** |
| `30 – 50` | **green** |
| `> 50` | **green** pinned at the 50 scale mark, and every yuan above it is drawn as an animated light blue-violet wave layer |

Hover the bar for a card with the exact amount, the scale position, the topped-up / granted
split, and how old the reading is. Click it to refresh immediately. With no reading yet the
bar shows `…`; if the provider call fails it keeps the last good figure and reports the error
in the card instead of going blank.

## 中文速览

一个 DeepSeek Harness Web 插件：在界面**最右侧贴边显示一根竖直的账户余额进度条**。

- **红色**：余额 < 10 元
- **黄色**：10 – 30 元
- **绿色**：30 – 50 元
- **浅蓝紫色波纹**：超过 50 元的部分——绿色填满到 50 元刻度，超出部分画成持续流动的波浪

鼠标悬停显示精确金额、刻度百分比、充值/赠送拆分和读数新鲜度；点击立即刷新。每 60 秒自动
更新一次，Host 侧还有 5 分钟的兜底刷新。

**安装**（插件不在 npm 上，直接从仓库加载）：

```sh
git clone https://github.com/hfdsdfgr/123.git dsh-balance-bar
# 方式一：单次启动时挂载
dsh web --patch /绝对路径/dsh-balance-bar/cordis.patch.yml
# 方式二：写进 profile 的补丁层（Web profile 会热重载，刷新页面即可生效）
node scripts/install.mjs
```

API Key 走 Harness 的凭据体系（默认引用 `DEEPSEEK_API_KEY`），**永远不会进入浏览器**；浏览器
只拿到一个同源 JSON 快照。阈值、刻度、波纹颜色、刷新间隔都是 `src/client.js` 顶部的具名常量。

## Highlights

- **No build step.** The browser half is one plain CommonJS file wrapped in the client module
  table's registration contract. The file in `src/` is the file the browser downloads.
- **The API key never reaches the browser.** The Host half resolves it through the Harness
  credential seam and calls the provider; the page only ever sees a small JSON snapshot on a
  same-origin route.
- **First-frame correct.** The Host embeds the last snapshot into the served index, so the bar
  paints a real number before its first poll instead of flashing an empty bar.
- **Polls, caches, and degrades.** 60 s freshness window, 5 min background cadence, hover/click
  for an on-demand read, and stale-but-labelled data when the provider is unreachable.
- **Does not get in your way.** The overlay row is `pointer-events: none` except for the 16 px
  bar itself, so nothing in the GUI becomes unclickable. Honours
  `prefers-reduced-motion: reduce`.

## Install

This plugin is not published to npm; it loads straight from a checkout.

```sh
git clone https://github.com/hfdsdfgr/123.git dsh-balance-bar
```

Then either pass the overlay for one run:

```sh
dsh web --patch /absolute/path/to/dsh-balance-bar/cordis.patch.yml
```

…or make it permanent by appending the row to your profile's own patch layer, which the Web
profile reloads live (no restart, just reload the page):

```sh
node scripts/install.mjs            # writes $DSH_HOME/profiles/web/cordis.patch.yml
node scripts/install.mjs --dry-run  # show the exact result first
```

> **`cordis.patch.yml` ships a machine-specific absolute path.** The loader row names the Host
> half by absolute file URL, so edit that line (or let `install.mjs` write it) to point at
> wherever you cloned this repository. There is deliberately no `pnpm add` step and no
> `node_modules` entry to create.

Requirements: a DSH Web profile and a DeepSeek API key configured as the credential
`DEEPSEEK_API_KEY` (the same key the Harness already uses).

## Configuration

Every key is optional; the defaults are shown here and live in `cordis.patch.yml`.

| Key | Default | Meaning |
|---|---|---|
| `credentialRef` | `DEEPSEEK_API_KEY` | Credential reference holding the provider key |
| `endpoint` | `https://api.deepseek.com/user/balance` | Balance endpoint (any DeepSeek-compatible one works) |
| `cacheTtlMs` | `60000` | How long a reading is served before re-fetching |
| `pollIntervalMs` | `300000` | Background refresh cadence |
| `timeoutMs` | `10000` | Per-request timeout |

## Architecture

Two halves, one plugin, no overlap between them.

```text
Host half (src/index.ts)
  ctx.credentials.resolve(credentialRef)      → the API key, Host-side only
  GET https://api.deepseek.com/user/balance   → provider truth
  ├─ GET /dsh-balance/snapshot                → same-origin JSON the page polls
  └─ globalThis.__DSH_BALANCE__               → index-injection row for first paint

Browser half (src/client.js)
  window.__ModuleLoader__.load({ id, factory })   → the whole transport contract
  require('react')                                → the shell's platform seed
  ctx.slots.inject('shell.overlay')               → the fixed bar + hover card
```

**Why an HTTP route instead of `@Remote`?** Remote methods are generated by the Typert build
pipeline from Host decoration. A plugin that lives outside the Harness build must describe its
own wire protocol, so this one publishes on `ctx.webServer` with an exact named route. It is
deliberately *not* under `/api`: that carrier belongs to the Connection plugin, which
authenticates and would reject every route it does not own. What crosses the wire is a
display-only reading, and the shipped Web composition binds loopback only.

**Why `shell.overlay`?** It is the layout package's root-scope list slot — the only place a
plugin can put something at the shell edge without taking over a column. `ctx.slots.inject`
waits for the declaration, reruns after a redeclaration, and removes the contribution when
this plugin unloads.

## Tests

Three checks, plain Node, no test framework:

```sh
node scripts/client-spec.mjs      # colour bands, scale, wave geometry, payload projection
node scripts/client-smoke.mjs     # loads the bundle through a stubbed window.__ModuleLoader__
node scripts/balance-smoke.mjs    # mounts the Host half and drives the live provider
node scripts/verify-deployed.mjs  # read-only probe of a running GUI
```

`client-spec` pins the product rule at its boundaries — `10` is yellow, `30` is green, `50` is
still green, anything above turns the wave on — and proves the wave path closes its phase, so
the animation loops without a visible jump. `verify-deployed` mints the browser-session cookie,
reads `window.__DSH_BOOT__` from the served index, and downloads the bundle route the browser
will actually use: it is the difference between "the files are correct" and "the GUI is running
them".

## Tuning the look

Thresholds, scale, wave colours, and refresh cadence are named constants at the top of
`src/client.js`:

| Constant | Default | Meaning |
|---|---|---|
| `SCALE_LIMIT` | `50` | Yuan at which the fill tops out |
| `RED_LIMIT` | `10` | Upper bound of the red band (exclusive) |
| `YELLOW_LIMIT` | `30` | Upper bound of the yellow band (exclusive) |
| `REFRESH_MS` | `60000` | Browser polling interval |
| `PALETTE` | red / yellow / green gradients | Fill colours |
| `WAVE_CREST`, `WAVE_BODY` | `#cddcff`, `#8fb0ff` | The light blue-violet wave |

Layout lives in the `STYLES` block in the same file: `right: 12px`, 16 px wide, widening on
hover.

## License

MIT — see [LICENSE](LICENSE).
