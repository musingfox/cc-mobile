# ADR-011 端到端 live E2E runbook（EX-11）

驗證**完整 permission 迴路**：真 claude（PTY 驅動）→ PreToolUse hook → cc-mobile server → 手機 → 你點 allow/deny → 回 hook → claude 放行/擋下。

這是 ADR-011 唯一還沒被驗過的部分。前面 15 輪 /spiral 已把 PTY 驅動、JSONL 讀回、hook 觸發、permission relay、client 觸發全部建好並各自驗過；這份 runbook 是把它們**串成一條真的迴路**跑一次。

> 為什麼要你親手跑：送 prompt 走 PTY 落 ToS §3(7) 範圍，只有人逐次驅動才站得住；且互動 claude 走訂閱額度，須你本人操作。建議等 **2026-06-11 週額度重置**後再跑（2026-06-09 已 91%）。

---

## 0. 前置

- `claude` CLI 已登入可用（`claude` 能進互動模式）。
- 手機與 dev 機在同一 Tailscale / 區網，手機能開 cc-mobile PWA。
- 選一個**測試專案目錄**（空目錄即可，例 `~/work/pty-live-test`）。下面用 `$TESTDIR` 代稱。

```fish
set TESTDIR ~/work/pty-live-test
mkdir -p $TESTDIR
```

---

## 1. 裝 hook（門檻，不裝則 permission 不會到手機）

```fish
bash docs/adr/spike-011/install-pty-hook.sh $TESTDIR
# prod server 用：
# bash docs/adr/spike-011/install-pty-hook.sh $TESTDIR http://localhost:7701/api/pty-permission
```

它在 `$TESTDIR/.claude/settings.json` 寫一個 `PreToolUse`（matcher `Bash`）hook，指向 `server/pty-permission-hook.ts`。matcher 用 `Bash` 是刻意——第一次 live 用秒級 Bash 工具（見 §5 條件二）。

---

## 2. 起 server，allowedRoots 要含 $TESTDIR

`pty_send` 會用 `CC_MOBILE_ALLOWED_ROOTS` 沙箱驗 cwd；測試目錄不在裡面會被 `path_not_allowed` 擋掉（且會觸發已知的 streaming-卡住小洞 H1，輸入列會鎖住）。

```fish
# dev（:3001，對應 hook 預設 URL）
env CC_MOBILE_ALLOWED_ROOTS=$TESTDIR bun run dev:server
```

另一個 terminal 起前端（或用已部署的 prod）：

```fish
bunx vite --host
```

---

## 3. 手機端開 session、開 PTY 模式

1. 手機 PWA 連上 server，進 `$TESTDIR` 這個專案、**新建一個 session**（cwd = `$TESTDIR`）。
   - 這步走 `new_session`，只建 session 記錄、**不啟動 SDK query、不計費**。
2. 在輸入列打開 **PTY 模式 toggle**（`aria-label="PTY mode"` 那顆，預設關）。
   - 開了之後，這個 session 的送出會走 `pty_send`（PTY 驅動互動 claude，落訂閱桶），不走 SDK `send`。

---

## 4. 送一個會用工具的 prompt

在手機輸入列（PTY 模式開著）送：

```
Run this bash command: ls
```

---

## 5. 預期流程與 PASS 判準

**預期**：
1. server 用 PTY spawn `claude --session-id <該session>`，送進 prompt。
2. claude 要跑 `ls`（Bash 工具）→ 觸發 `$TESTDIR/.claude/settings.json` 的 PreToolUse hook。
3. hook POST 到 server `/api/pty-permission` → relay 推 `permission_request` 到手機。
4. **手機跳出 permission sheet**（PermissionSheetA），顯示 Bash / `ls`。
5. 你點 **Allow** → server resolve → hook 回 `permissionDecision:"allow"` → claude 跑 `ls` → 回覆讀回 → 手機渲染結果。
6. 再試一次點 **Deny** → claude 該工具被擋（畫面顯示被攔截 / 未執行）。

**PASS**：手機跳出 permission sheet、Allow 能放行並看到結果、Deny 能擋下。這三點成立 = permission bridge 端到端通。

---

## 6. 測試條件（來自已知 parkable 洞，避開才不會誤判 FAIL）

| 條件 | 為什麼 | 對應洞 |
|---|---|---|
| 核准等待期間**別把手機切到背景 / 息屏** | 斷 WS 時 `close()` 會殺 PTY claude，且 paused pending 取消了 600s 兜底 → 該次永不完成 | H1-C / turn-14 H1 |
| 第一次用**秒級工具**（`ls`/`echo`），別用會跑很久的 | 工具自身執行 >60s 仍會 poll timeout 刪 session（H2-B 只解了「等人」沒解「等工具」） | turn-14 H2 |
| cwd 確定在 `CC_MOBILE_ALLOWED_ROOTS` | 否則 `pty_send` 被沙箱擋、輸入列 streaming 卡住 | turn-15 H1 |
| 一台手機連就好（別同時多端） | server 用單一 `wsRef`，多連會互蓋、permission 可能推錯端 | turn-12 H3 |

---

## 7. 排錯

- **手機沒跳 permission**：hook 沒 fire 或 POST 失敗。查 server log 有沒有收到 `/api/pty-permission`；查 hook 的 `CC_MOBILE_PERMISSION_URL` 對不對（dev :3001 / prod :7701）；查 `$TESTDIR/.claude/settings.json` 在不在。
- **hook 一直 deny**：server log 看 relay 回什麼。`session_not_found`（404）= 該 session 不在 orchestrator（確認手機是用 PTY 模式 + 同一 session 驅動的，不是手動終端 claude——turn-14 H2 把 permission 綁死 orchestrator 驅動的 session）。
- **送了沒反應**：PTY 模式有沒有開？cwd 在 allowedRoots 嗎？（H3：無 cwd 會靜默 no-op、目前無提示。）

移除 hook：`bash docs/adr/spike-011/install-pty-hook.sh --uninstall $TESTDIR`

---

## 8. 這一跑證明 / 不證明什麼

- **證明**：ADR-011 的混合架構端到端可行——便宜的 PTY 驅動 + 免費的 hook permission bridge + 手機觸控核准，整條通。
- **不證明**：划不划算。經濟性要等 **2026-06-15** 計費新規生效後，於互動模式實際量訂閱桶用量才知道（技術可行 ≠ 經濟可行）。
- **還沒做（parkable，不阻擋這次單輪 live）**：長壽互動 session（撐多輪、撐斷線重連，H1-C）、慢工具 timeout（H2）、多 client（H3）、hook 安裝產品化、6/15 後讓 `pty_send` 完全脫離 SDK session（目前複用 `new_session` 是 test-enabler）。
