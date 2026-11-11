# Demo 影片設計

- **日期：** 2026-11-11
- **目標：** 讓評審看完 115 秒的影片後，記住一件事：Oceania 讓不同成員的 agent 互相溝通、互相協調。
- **形式：** 只有影片，沒有現場簡報。影片用英文旁白。

## 主軸

- 開場呼應 YC Request for Startups 的「Multiplayer AI」：agent 是團隊最強的新工具，但每個人都單獨使用 agent。
- Oceania 的答案：每位成員保留自己的 agent。Oceania 讓這些 agent 互相溝通。影響小的衝突由 agent 自行解決。只有產品決定才問人。
- 影片不點名其他產品。影片只說明 Oceania 的差異。
- 規模放在結尾的旁白。旁白只說願景，不說成已經完成。

## 做法

評估過三種做法：

| 做法 | 內容 | 取捨 |
|---|---|---|
| A | 不改程式。錄真實流程，用旁白解說。 | 風險最低。但訊息分散在 terminal 與 Slack，評審不容易看出 agent 在溝通。 |
| B | 加入 Oceania feed，並在看板顯示衝突的生命週期。 | 只改顯示。開發約 25 分鐘。 |
| C | B 加上模擬幾十個 agent 的規模畫面。 | 80 分鐘內做不穩。模擬必須明確標示，否則會誤導評審。 |

選擇 B。理由：影片的核心是 agent 之間的溝通。Oceania feed 直接顯示每一則訊息。這個決定由實作者決定，參賽團隊授權（「help me reach this goal」）。

## Oceania feed

- Oceania 伺服器的 stdout 變成 Oceania feed。每一行是一則經過 Oceania 的訊息。
- 訊息有三種方向：
  - agent 寫入 Oceania：任務、變更、推送。
  - Oceania 送給 agent：團隊現況、拒絕、暫停、通知、恢復。
  - master agent 與成員：衝突紀錄、Slack 的待決事項、決定。
- 每一行有時間、角色、符號與一句短文字。顏色代表階段。
- 判斷回合只印一行精簡的摘要。完整的文字寫入 `oceania.log`。

## 進度看板

- 每個衝突顯示生命週期，例如 `Before 9:03 PM → During 9:04 PM → After 9:05 PM → Resolved 9:06 PM`。
- Memory 為每個衝突保存階段、影響與狀態的變動紀錄。

## 腳本

- 三個 agent 從三個角度各寫一版腳本。
- 一個評審 agent 依 YC 的 demo 準則評分，再合併成最終版本。
- 最終版本放在 `docs/demo-video-script.md`。內容包含旁白、時間、畫面與字幕。

## 錄影

- 筆電 B 準備好時，Bob 在筆電 B 上操作。
- 筆電 A 的畫面以 Oceania feed 為主，旁邊是兩個 agent 與 Slack。
- 錄影步驟見 `docs/demo-runbook.md`。

## 留給實作者決定

- Oceania feed 的版面、符號與顏色。
- 腳本的最終措辭。
