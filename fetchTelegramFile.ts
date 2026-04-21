// Extracted utility — e.g., fetchTelegramFile.ts
import type TelegramBotAPI from "node-telegram-bot-api";

export async function fetchTelegramFile(bot: TelegramBotAPI, botToken: string, fileId: string): Promise<Buffer> {
  const file = await bot.getFile(fileId);
  const response = await fetch(`https://api.telegram.org/file/bot${botToken}/${file.file_path}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch Telegram file: ${response.statusText}`);
  }
  const data = await response.arrayBuffer();
  return Buffer.from(data);
}
