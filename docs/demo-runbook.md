# Oceania demo 錄影手冊

本手冊說明參賽團隊如何錄製 spec §8 的 demo 影片。每次錄影都從「每次錄影前」開始。

- Tverous 扮演 spec 作者，並在最後打開進度看板。
- 參賽團隊的另外兩個人扮演 Alice 與 Bob。
- Bob 的 agent 在筆電 B 上執行。Tverous 在筆電 A 透過 SSH 操作這個 agent。
- demo 有三輪。Alice 與 Bob 各送出三則任務。Tverous 在 Slack 點選一次。

## 每次錄影前

1. [ ] Tverous 在 Oceania 的 terminal 按 Ctrl+C，停止 Oceania 伺服器。
2. [ ] Alice 在 Copilot CLI 輸入 `/exit`。Tverous 在 Bob 的 terminal 輸入 `/exit`。
3. [ ] Tverous 在筆電 A 執行重設腳本：

   ```bash
   cd /Users/tverous/works/hackathon && scripts/reset-demo.sh
   ```

   這個腳本執行以下動作：
   - 把 seed commit 強制推送到 main。
   - 重設筆電 A 上的 `alice/`、`main/` 與 `bob/` clone。
   - 刪除 `oceania.db`、`oceania.log` 與 `.oceania`。舊的 `oceania.db` 沒有衝突的歷程欄位，因此新版本必須先刪除它。
   - 刪除 issue #1 上以 `Decision:` 開頭的留言。
4. [ ] Bob 在筆電 B 上時，Tverous 在 Bob 的 terminal 執行以下指令。筆電 A 沒有 `bob/` 時，腳本也印出這行指令。

   ```bash
   cd ~/acme/bob && git fetch && git reset --hard origin/main && git clean -fd
   ```

5. [ ] Tverous 在 `/Users/tverous/works/hackathon` 執行 `npm start`。
6. [ ] Tverous 等到 Oceania feed 印出 `Oceania is ready.`。這行之前有一行標題：`Oceania feed · http://127.0.0.1:4100 · details in oceania.log`。
7. [ ] Alice 啟動 Copilot CLI，再執行 `/memory off`：

   ```bash
   cd /Users/tverous/works/acme/alice && copilot --allow-all-tools
   ```

   Tverous 的 Copilot 記憶要求用繁體中文回覆。`/memory off` 讓 Copilot 改用英文回覆。
8. [ ] Tverous 啟動 Bob 的 Claude Code。Bob 的 shell 不得設定 `ANTHROPIC_API_KEY`。
   - 筆電 B（預設）：Tverous 在筆電 A 的 Bob 的 terminal 執行以下指令。

     ```bash
     ssh <筆電 B 的使用者>@<筆電 B 的 tailnet 名稱>
     cd ~/acme/bob && claude --permission-mode acceptEdits
     ```

   - 筆電 A（備案）：

     ```bash
     cd /Users/tverous/works/acme/bob && claude --permission-mode acceptEdits
     ```

9. [ ] Tverous 確認 Oceania feed 印出兩行 `● joined`：一行是 `Alice's agent`，另一行是 `Bob's agent`。
10. [ ] 參賽團隊開始錄製螢幕（見下一節）。

這些啟動方式讓影片中沒有權限詢問：

- `--allow-all-tools` 讓 Copilot 不詢問工具權限。
- `alice/` 在 `~/.copilot/config.json` 的 `trustedFolders` 中。因此 Copilot 載入 repo 的 hook。
- `acceptEdits` 讓 Claude Code 自動接受檔案修改。
- Bob 的 `.claude/settings.local.json` 允許 git 指令。

## 每台筆電的視窗

**筆電 A**（Tverous 的筆電）：

| 視窗 | 內容 |
|---|---|
| Terminal（主要視窗） | Oceania feed，位於 `/Users/tverous/works/hackathon`。字體放大，寬度大約 100 欄。 |
| Terminal | Alice 的 Copilot CLI，位於 `/Users/tverous/works/acme/alice`。 |
| Terminal | Bob 的 terminal：連到筆電 B 的 SSH session。筆電 B 沒有準備好時，改用 `/Users/tverous/works/acme/bob`。 |
| Slack | `#oceania-activity`、衝突頻道與 Oceania 的 Home 分頁。 |
| 瀏覽器 | https://github.com/Tverous/acme-pricing/issues/1 |
| Terminal | `/Users/tverous/works/acme/main`，用來產生最後的定價頁面。 |

Oceania feed 的每一行是一則經過 Oceania 的訊息：

- agent 寫入 Oceania 的事件，例如 `▶ task`、`✎ changed` 與 `⬆ pushed to main`。
- Oceania 送給 agent 的文字，例如 `Oceania → Bob    ⊘ blocked a write to src/pricing.ts · sent Alice's diff`。
- 每個衝突的生命週期，例如 `⚠ Conflict #2 · Before → During · low impact`。
- Slack 的待決事項、決定，以及每個判斷回合的一行摘要。

太長的行以 `…` 結尾。完整的文字寫入 `oceania.log`，例如判斷回合的結果、工具呼叫與 Slack 的記錄。

Bob 的 hook 預設使用 tailnet 網址。因此筆電 A 必須執行 `tailscale serve --bg 4100`。

**筆電 B**：Bob 的 Claude Code，位於 `~/acme/bob`。Tverous 從筆電 A 透過 SSH 操作它。因此錄影時，筆電 B 不需要操作者。

筆電 B 的操作者只需要設定一次。設定前，筆電 B 必須準備好以下項目：

- Tailscale。筆電 B 必須與筆電 A 在同一個 tailnet 中。
- 遠端登入：系統設定 → 一般 → 共享 → 遠端登入，打開。macOS 的 Tailscale app 沒有 Tailscale SSH 伺服器，因此 SSH 使用 macOS 的遠端登入。
- Node 26。
- `gh` 與 Claude Code，都已登入。

Oceania 伺服器必須在筆電 A 上執行。操作者在 Oceania 的 clone（`~/oceania`）執行：

```bash
scripts/setup-claude-agent.sh <Bob 的 Slack email> https://wonderland.tail757928.ts.net
```

預期結果：

```text
ANTHROPIC_API_KEY set in this shell: 0 (must be 0)
Oceania reachable (expect 400): 400
```

設定後，Tverous 在筆電 A 確認 SSH 可以使用：

```bash
ssh <筆電 B 的使用者>@<筆電 B 的 tailnet 名稱> 'cd ~/acme/bob && git status -sb && claude --version'
```

**錄製方式：**

- 筆電 A 同時顯示兩個 agent。因此參賽團隊只錄製筆電 A 的螢幕。
- 參賽團隊用 QuickTime Player 的 File → New Screen Recording 錄製。

## 錄影

以下步驟對應 spec §8 的影片節奏。時間是影片中的秒數。一次完整錄影的真實時間大約 10 到 14 分鐘。參賽團隊錄下全部過程，之後再剪輯。

每一輪的規則：

- Alice 與 Bob 必須逐字複製任務。
- Alice 先送出任務。大約 10 秒後，Tverous 在 Bob 的 terminal 送出 Bob 的任務。
- 兩個 agent 都推送到 main 後，下一輪才開始。Oceania feed 印出兩行 `⬆ pushed to main` 後，等待 20 秒。

1. **0–10 秒：說明問題。** 旁白說明問題。畫面顯示 issue #1。
2. **10–25 秒：第 1 輪，不同的需求。**
   - Alice 在 Copilot CLI 送出以下任務：

     ```text
     Add a yearly price to each plan in src/plans.ts. The yearly price is 10 times the monthly price.
     ```

   - Bob 的任務：

     ```text
     Add a short FAQ section below the plan table on the pricing page.
     ```

   - Oceania feed 印出 `⇢ update:` 開頭的行。這些行顯示每個 agent 收到另一個 agent 的任務與推送。
   - 兩個任務修改不同的檔案。因此沒有衝突，或最多只有一則影響小的通知。
   - 第二個推送的 agent 先用 rebase 合併 main（`AGENTS.md`）。
3. **25–45 秒：第 2 輪，同一份 spec 的兩種解讀。**
   - Alice 在 Copilot CLI 送出以下任務：

     ```text
     Add the Pro plan from #1 to src/plans.ts: 14-day trial, card required.
     ```

   - Bob 的任務：

     ```text
     Show the Pro plan from #1 on the pricing page. Use a 30-day free trial with no card.
     ```

   - 大約 20 到 40 秒後，Oceania feed 印出衝突 A：`⚠ Conflict #N · Before · HIGH impact`。
   - Oceania 建立 Slack 頻道 `oceania-1-<id>`，並邀請 Alice、Bob 與 Tverous。Oceania feed 印出 `? asked Tverous`。
   - Oceania 暫停兩個 agent。Oceania feed 為每個 agent 印出一行 `‖ paused until Tverous decides`。
   - 衝突 B 是重複的工作，影響小。Oceania feed 印出衝突 B，之後印出給 Bob 的 `✉ note:`。
4. **45–60 秒：Tverous 決定。**
   - Tverous 先讀完按鈕文字，再點選「30 days, no card」的選項。
   - 兩次彩排都誤點了 14 天的選項。Tverous 必須確認文字再點選。
   - 決定以留言的形式出現在 issue #1。Tverous 重新整理瀏覽器，顯示這則留言。
   - 兩個 agent 自動恢復。Oceania feed 為每個 agent 印出一行 `▶ resumed:`。Alice 與 Bob 不輸入任何文字。
5. **60–75 秒：第 2 輪的推送。**
   - Alice 的 agent 推送後，Oceania feed 把衝突改成 `After`。
   - Oceania 通知 Bob 的 agent：先用 rebase 合併 main，再推送。
   - 某次推送顯示 main 已有決定後，衝突 A 才解決。Oceania feed 印出 `✓ Conflict #N · Before → … → Resolved`。
   - Bob 的 agent 推送後，衝突 B 也解決。
6. **75–95 秒：第 3 輪，同時修改同一個檔案。**
   - Alice 在 Copilot CLI 送出以下任務：

     ```text
     Show the yearly price next to the monthly price on the pricing page.
     ```

   - Bob 的任務：

     ```text
     Mark the Pro plan as Most popular on the pricing page.
     ```

   - 兩個 agent 都修改 `src/pricing.ts`。Bob 的 agent 寫入時，Oceania feed 印出 `⊘ blocked a write to src/pricing.ts · sent Alice's diff`。
   - 衝突 C 改成 `During`。Bob 的 agent 以 Alice 的變更為基礎修改。
   - 一個 agent 推送後，衝突 C 改成 `After`。Oceania 通知另一個 agent 先用 rebase 合併 main。
   - 另一個 agent 推送後，衝突 C 解決。
7. **95–115 秒：查看結果。** Tverous 等到 Oceania feed 顯示所有衝突都已解決。
   - Tverous 在 Slack 打開 Apps → Oceania → Home。
   - 進度看板顯示兩個 agent。每個衝突都有一行生命週期，例如 `Before 9:03 PM → During 9:04 PM → After 9:05 PM → Resolved 9:06 PM`。
   - Tverous 在筆電 A 執行以下指令：

     ```bash
     cd /Users/tverous/works/acme/main && git pull && node src/pricing.ts && open pricing.html
     ```

   - 定價頁面顯示 Pro 方案：30 天免費試用，不需要信用卡，並標示 Most popular。
   - 每個方案顯示月費與年費。表格下方有 FAQ。
   - 旁白說明規模：想像 50 位工程師在不同的時區工作。

## 錄影後

1. 參賽團隊停止錄影。
2. Tverous 檢查這次錄影：
   - 進度看板只有 Alice 與 Bob 兩個 agent（spec §12 第 3 項）。
   - 所有衝突都已解決，而且每個衝突都有一行生命週期。
   - 定價頁面顯示 30 天試用、不需要信用卡、Most popular、年費與 FAQ。
3. 參賽團隊把錄影剪成 115 秒：
   - Edit → Split Clip 切開片段。參賽團隊刪除等待的片段。
   - QuickTime Player 不能匯出加速的片段。加速等待的片段需要 iMovie。
4. 下一次錄影從「每次錄影前」開始。
5. 全部錄影完成後，Alice 在 Copilot CLI 執行 `/memory on`。
6. 參賽團隊彩排三次，並在 22:15 前完成錄影。

## 已知行為與備案

**已知行為：**

- Slack 的 `[WARN] bolt-app already_in_channel` 只寫入 `oceania.log`，不出現在 Oceania feed。這行沒有影響。
- 每個判斷回合需要 5 到 35 秒。每個判斷回合結束時，Oceania feed 印出一行，例如 `◆ round 8 · 22 s · 5 actions`。
- 判斷回合的完整結果寫入 `oceania.log`。
- 彩排的三輪有 18 個判斷回合，Anthropic API 費用是 1.09 美元。
- master agent 每次重新撰寫按鈕文字。因此按鈕文字每次可能不同。
- 衝突 B 的階段順序每次可能不同。每種順序都符合 demo。
- 衝突 A 維持未解決，直到某次推送顯示 main 已有決定。
- 暫停的 agent 最多等待決定 480 秒。Tverous 必須在這段時間內點選。
- 進度看板用 Slack 的時間格式。每位觀看者看到自己的時區與時鐘格式。錄影的 Slack 帳號必須使用 12 小時制，進度看板才顯示 `9:03 PM`。

**備案：**

- **Oceania 停止：** adapter 以 exit code 0 結束。agent 繼續工作，但 Oceania 不知道它們的變更。這次錄影作廢。
- **Tverous 點錯選項：** 這次錄影作廢。Tverous 從「每次錄影前」重新開始。
- **Oceania feed 沒有印出 Bob 的 `● joined`：** Tverous 在筆電 A 執行 `tailscale serve status`。輸出必須包含 `http://127.0.0.1:4100`。
- **Claude Code 在 SSH session 中要求登入，或 `git push` 要求帳號：** macOS 的 keychain 在 SSH session 中可能是鎖定的。Tverous 在 SSH session 執行 `security unlock-keychain`，並輸入筆電 B 的登入密碼。然後 Tverous 重新啟動 Claude Code。
- **SSH、筆電 B 或 Tailscale 失敗：** Bob 改在筆電 A 的 `/Users/tverous/works/acme/bob` 上執行（plan Task 4）。筆電 A 沒有 `bob/` 時，Tverous 執行：

  ```bash
  cd /Users/tverous/works/hackathon && scripts/setup-claude-agent.sh <Bob 的 Slack email> <Oceania URL> /Users/tverous/works/acme/bob
  ```

  `<Oceania URL>` 通常是 tailnet 網址。Tailscale 失敗時，Tverous 改用 `http://127.0.0.1:4100`。
- **網路不穩定：** 兩台筆電改用手機熱點（spec §12 第 8 項）。
- **Copilot 的 hook 失敗：** Alice 改用 Claude Code（spec §12）。Tverous 先執行以下指令：

  ```bash
  cd /Users/tverous/works/hackathon && scripts/setup-claude-agent.sh <Alice 的 Slack email> http://127.0.0.1:4100 /Users/tverous/works/acme/alice
  ```

  然後 Alice 在 `/Users/tverous/works/acme/alice` 執行 `claude --permission-mode acceptEdits`。
