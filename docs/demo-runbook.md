# Tower demo 錄影手冊

本手冊說明參賽團隊如何錄製 spec §8 的 demo 影片。每次錄影都從「每次錄影前」開始。

- Tverous 扮演 spec 作者，並在最後打開進度看板。
- 參賽團隊的另外兩個人扮演 Alice 與 Bob。

## 每次錄影前

1. [ ] Tverous 在 Tower 的 terminal 按 Ctrl+C，停止 Tower 伺服器。
2. [ ] Alice 與 Bob 輸入 `/exit`，結束各自的 agent。
3. [ ] Tverous 在筆電 A 執行重設腳本：

   ```bash
   cd /Users/tverous/works/hackathon && scripts/reset-demo.sh
   ```

   這個腳本執行以下動作：
   - 把 seed commit 強制推送到 main。
   - 重設筆電 A 上的 `alice/`、`main/` 與 `bob/` clone。
   - 刪除 `tower.db` 與 `.tower`。
   - 刪除 issue #1 上以 `Decision:` 開頭的留言。
4. [ ] Bob 在筆電 B 上時，Bob 在筆電 B 執行以下指令。筆電 A 沒有 `bob/` 時，腳本也印出這行指令。

   ```bash
   cd ~/acme/bob && git fetch && git reset --hard origin/main && git clean -fd
   ```

5. [ ] Tverous 在 `/Users/tverous/works/hackathon` 執行 `npm start`。
6. [ ] Tverous 等到 Tower 印出 `Tower is ready at http://127.0.0.1:4100.`。
7. [ ] Alice 啟動 Copilot CLI，再執行 `/memory off`：

   ```bash
   cd /Users/tverous/works/acme/alice && copilot --allow-all-tools
   ```

   Tverous 的 Copilot 記憶要求用繁體中文回覆。`/memory off` 讓 Copilot 改用英文回覆。
8. [ ] Bob 啟動 Claude Code。Bob 的 shell 不得設定 `ANTHROPIC_API_KEY`。

   ```bash
   cd /Users/tverous/works/acme/bob && claude --permission-mode acceptEdits   # 筆電 A
   cd ~/acme/bob && claude --permission-mode acceptEdits                      # 筆電 B
   ```

9. [ ] Tverous 確認 Tower 印出 `Bob's agent (Claude Code) joined.`。
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
| Terminal | Tower 伺服器，位於 `/Users/tverous/works/hackathon`。 |
| Terminal | Alice 的 Copilot CLI，位於 `/Users/tverous/works/acme/alice`。 |
| Terminal | Bob 的 Claude Code，位於 `/Users/tverous/works/acme/bob`。筆電 B 沒有準備好時，Bob 使用這個視窗。 |
| Slack | `#tower-activity`、衝突頻道與 Tower 的 Home 分頁。 |
| 瀏覽器 | https://github.com/Tverous/acme-pricing/issues/1 |
| Terminal | `/Users/tverous/works/acme/main`，用來產生最後的定價頁面。 |

Bob 的 hook 預設使用 tailnet 網址。因此筆電 A 必須執行 `tailscale serve --bg 4100`。

**筆電 B**（選用）：Bob 的 Claude Code，位於 `~/acme/bob`。

筆電 B 的操作者只需要設定一次。設定前，筆電 B 必須準備好以下工具：

- Tailscale，並且能連到筆電 A。
- Node 26。
- `gh` 與 Claude Code，都已登入。

Tower 伺服器必須在筆電 A 上執行。操作者在 Tower 的 clone（`~/tower`）執行：

```bash
scripts/setup-claude-agent.sh <Bob 的 Slack email> https://wonderland.tail757928.ts.net
```

預期結果：

```text
ANTHROPIC_API_KEY set in this shell: 0 (must be 0)
Tower reachable (expect 400): 400
```

**錄製方式：**

- Bob 在筆電 A 上時，筆電 A 並排顯示 Alice 與 Bob 的 terminal。筆電 A 只錄製一個螢幕。
- Bob 在筆電 B 上時，兩台筆電同時錄製各自的螢幕。
- 參賽團隊用 QuickTime Player 的 File → New Screen Recording 錄製。

## 錄影

以下步驟對應 spec §8 的影片節奏。時間是影片中的秒數。一次完整錄影的真實時間大約 5 到 6 分鐘。參賽團隊錄下全部過程，之後再剪輯。成員只輸入兩則任務，並在 Slack 點選一次（spec §9）。

1. **0–15 秒：說明問題。** 旁白說明問題。畫面可以顯示 issue #1。
2. **15–30 秒：送出兩個任務。** Alice 與 Bob 必須逐字複製任務。
   - Alice 在 Copilot CLI 送出以下任務：

     ```text
     Add the Pro plan from #1 to src/plans.ts: 14-day trial, card required.
     ```

   - 大約 10 秒後，Bob 在 Claude Code 送出以下任務：

     ```text
     Show the Pro plan from #1 on the pricing page. Use a 30-day free trial with no card.
     ```

3. **30–50 秒：衝突 A 出現。** 大約 30 到 60 秒後，Tower 執行以下動作：
   - 建立 Slack 頻道 `tower-1-<id>`。
   - 邀請 Alice、Bob 與 Tverous。
   - 暫停兩個 agent。Tower 的 terminal 印出 `Tower paused` 開頭的一行。
4. **50–60 秒：Tverous 決定。**
   - Tverous 先讀完按鈕文字，再點選「30 days, no card」的選項。
   - 兩次彩排都誤點了 14 天的選項。Tverous 必須確認文字再點選。
   - 決定以留言的形式出現在 issue #1。Tverous 重新整理瀏覽器，顯示這則留言。
   - 兩個 agent 自動恢復。Alice 與 Bob 不輸入任何文字。
5. **60–80 秒：衝突 B 發生中。** 衝突 B 是重複的 Pro 方案，影響小。
   - `#tower-activity` 與進度看板顯示衝突 B 的 Before，再顯示 During。
   - Tower 可能拒絕 Bob 的寫入，並附上 Alice 的 diff。
   - 階段順序每次可能不同（spec §12 第 6 項）。
6. **80–100 秒：衝突 B 發生後。**
   - Alice 的 agent 推送到 main。
   - `#tower-activity` 與進度看板把衝突 B 改成 After。
   - Tower 通知 Bob 的 agent 先 rebase。
   - Bob 的 agent 推送到 main。
7. **100–115 秒：查看結果。** Tverous 等到進度看板顯示兩個衝突都已解決。
   - Tverous 在 Slack 打開 Apps → Tower → Home。
   - 進度看板顯示兩個 session 與兩個已解決的衝突。
   - Tverous 在筆電 A 執行以下指令：

     ```bash
     cd /Users/tverous/works/acme/main && git pull && node src/pricing.ts && open pricing.html
     ```

   - 定價頁面顯示 Pro 方案：試用 30 天，不需要信用卡。
   - 旁白說明規模：想像 50 位工程師在不同的時區工作。

## 錄影後

1. 參賽團隊停止錄影。
2. Tverous 檢查這次錄影：
   - 進度看板只有 Alice 與 Bob 兩個 session（spec §12 第 3 項）。
   - 兩個衝突都已解決。
   - 定價頁面顯示 30 天試用，而且不需要信用卡。
3. 參賽團隊把錄影剪成 115 秒：
   - Edit → Split Clip 切開片段。參賽團隊刪除等待的片段。
   - Edit → Add Clip to End 依照影片節奏接起兩台筆電的片段。
   - QuickTime Player 不能匯出加速的片段。加速等待的片段需要 iMovie。
4. 下一次錄影從「每次錄影前」開始。
5. 全部錄影完成後，Alice 在 Copilot CLI 執行 `/memory on`。
6. 參賽團隊彩排三次，並在 22:15 前完成錄影。

## 已知行為與備案

**已知行為：**

- Tower 啟動時印出 `[WARN] bolt-app already_in_channel`。這行沒有影響。
- 每個判斷回合需要 9 到 25 秒。每個判斷回合結束時，Tower 印出 `Tower judge:` 摘要。
- 每次錄影大約花費 0.40 美元的 Anthropic API 費用。
- master agent 每次重新撰寫按鈕文字。因此按鈕文字每次可能不同。
- 衝突 B 的階段順序每次可能不同。每種順序都符合 demo。
- 衝突 A 維持未解決，直到某次推送顯示 main 已有決定。
- 暫停的 agent 最多等待決定 480 秒。Tverous 必須在這段時間內點選。

**備案：**

- **Tower 停止：** adapter 以 exit code 0 結束。agent 繼續工作，但 Tower 不知道它們的變更。這次錄影作廢。
- **Tverous 點錯選項：** 這次錄影作廢。Tverous 從「每次錄影前」重新開始。
- **Tower 沒有印出 Bob 的 `joined.`：** Tverous 在筆電 A 執行 `tailscale serve status`。輸出必須包含 `http://127.0.0.1:4100`。
- **筆電 B 或 Tailscale 失敗：** Bob 改在筆電 A 的 `/Users/tverous/works/acme/bob` 上執行（plan Task 4）。筆電 A 沒有 `bob/` 時，Tverous 執行：

  ```bash
  cd /Users/tverous/works/hackathon && scripts/setup-claude-agent.sh <Bob 的 Slack email> <Tower URL> /Users/tverous/works/acme/bob
  ```

  `<Tower URL>` 通常是 tailnet 網址。Tailscale 失敗時，Tverous 改用 `http://127.0.0.1:4100`。
- **網路不穩定：** 兩台筆電改用手機熱點（spec §12 第 8 項）。
- **Copilot 的 hook 失敗：** Alice 改用 Claude Code（spec §12）。Tverous 先執行以下指令：

  ```bash
  cd /Users/tverous/works/hackathon && scripts/setup-claude-agent.sh <Alice 的 Slack email> http://127.0.0.1:4100 /Users/tverous/works/acme/alice
  ```

  然後 Alice 在 `/Users/tverous/works/acme/alice` 執行 `claude --permission-mode acceptEdits`。
