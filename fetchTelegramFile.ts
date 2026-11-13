import type { Bot } from "node-telegram-bot-api";

const FETCH_TIMEOUT_MS = 30_000;

export async function fetchTelegramFile(bot: Bot, botToken: string, fileId: string): Promise<Buffer> {
  const file = await bot.api.getFile({ file_id: fileId });
  if (!file.file_path) throw new Error(`Telegram returned no path for file ${fileId}`);
  const response = await fetch(`https://api.telegram.org/file/bot${botToken}/${file.file_path}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Telegram file: ${response.statusText}`);
  }
  const data = await response.arrayBuffer();
  return Buffer.from(data);
}
