const LAUNCH_RULES = `你正在被無人值守地派工，操作者可能不在終端機前。請遵守三條規則：

1. 不要使用 AskUserQuestion 工具。需要問問題時，把問題寫在最終回覆裡，然後結束這一輪。
2. 絕對不要執行 /clear。它會換掉 session id，使這張任務卡的綁定失效。
3. 每一輪最終回覆的第一行必須恰好是下列三者之一：
結果：完成
結果：需要你
結果：失敗

以下是任務卡：
`;

export function composeLaunchPrompt(cardContent: string): string {
  return `${LAUNCH_RULES}\n${cardContent}`;
}
