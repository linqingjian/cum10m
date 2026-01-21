# AI Browser Assistant (Chrome Extension)

Simple guide for teammates.

## 1) Install (unpacked)
1. Clone the repo and enter it:
   - `git clone https://github.com/linqingjian/cum10m.git`
   - `cd cum10m`
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and choose:
   - `cum10m/chrome-extension/`
5. Click the extension icon to open the right-side panel.

## 2) Basic configuration
Open the panel, then **Config** section:
- **API URL**: default is `https://model-router.meitu.com/v1`
- **API Token**: paste your personal token
- **Model**: default `gpt-5.2` (can switch anytime)

Optional:
- Webhook URL (for alerts)
- Confluence Token
- Weekly report root page ID

## 3) Daily usage
- **Chat**: ask questions or give tasks. The assistant can read the current page when needed.
- **Page sync**: keep **Auto sync** on, or click **Refresh Page** to force a new capture.
- **Screenshots**: you can paste images into the chat input.
- **History**: use the left sidebar to switch sessions.

## 4) Skills (@skill)
- Go to **Skills Management** to add/edit/delete skills.
- Use in chat with `@skillName`, e.g. `@task_troubleshoot`.

## 5) Safety
- Destructive deletes (table/task/node) are blocked by default.

## 6) Update the extension
1. In the repo directory, run:
   - `git pull`
2. Open `chrome://extensions/` and click **Reload**.
3. Re-open the side panel.

## 7) Troubleshooting
- If the panel looks stale, click **Refresh Page**.
- If it stops responding, click **Reload** in `chrome://extensions/`.

