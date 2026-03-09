// Extracted utility — e.g., fetchTelegramFile.ts
import axios from "axios";
import TelegramBotAPI from "node-telegram-bot-api";

export async function fetchTelegramFile(
  bot: TelegramBotAPI,
  botToken: string,
  fileId: string
): Promise<Buffer> {
  const file = await bot.getFile(fileId);
  const { data } = await axios.get(
    `https://api.telegram.org/file/bot${botToken}/${file.file_path}`,
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(data as ArrayBuffer);
}