import type { ChatAttachment } from "@tokenring-ai/agent/AgentEvents";
import { ChatAttachmentSchema } from "@tokenring-ai/agent/AgentEvents";
import type TokenRingApp from "@tokenring-ai/app";
import type { IncomingMessage, IncomingMessageHandler, MessagingProvider } from "@tokenring-ai/bot";
import type { Message } from "node-telegram-bot-api";
import TelegramBotAPI from "node-telegram-bot-api";
import { fetchTelegramFile } from "./fetchTelegramFile.ts";
import type { ResolvedTelegramAccountConfig } from "./schema.ts";
import type TelegramService from "./TelegramService.ts";

/** Telegram's own limit is 4096; leave room for the markdown we send. */
const MAX_MESSAGE_LENGTH = 4090;

/**
 * One Telegram bot account, exposed as a messaging transport. It knows how to
 * carry text and files to and from Telegram, and nothing about agents.
 */
export default class TelegramMessagingProvider implements MessagingProvider {
  readonly maxMessageLength = MAX_MESSAGE_LENGTH;

  private bot!: TelegramBotAPI;
  private botUsername = "";
  private botId: number | undefined;
  private handlers = new Set<IncomingMessageHandler>();

  constructor(
    private readonly app: TokenRingApp,
    private readonly service: TelegramService,
    readonly accountName: string,
    private readonly config: ResolvedTelegramAccountConfig,
  ) {}

  async start(): Promise<void> {
    this.bot = new TelegramBotAPI(this.config.botToken, { polling: true });

    const botInfo = await this.bot.getMe();
    this.botUsername = botInfo.username ?? "";
    this.botId = botInfo.id;

    this.app.serviceOutput(this.service, `Telegram account ${this.accountName} connected as @${this.botUsername}`);

    this.bot.on("message", msg => {
      void this.handleRawMessage(msg).catch((error: unknown) => {
        this.app.serviceError(this.service, "Error processing Telegram message:", error);
      });
    });

    this.bot.on("polling_error", error => {
      this.app.serviceError(this.service, "Telegram polling error:", error);
    });
  }

  async stop(): Promise<void> {
    this.handlers.clear();
    try {
      await this.bot.stopPolling();
    } catch (error: unknown) {
      this.app.serviceError(this.service, "Error stopping Telegram polling:", error);
    }
  }

  onMessage(handler: IncomingMessageHandler): void {
    this.handlers.add(handler);
  }

  /** Telegram chat ids double as conversation ids, for both users and groups. */
  resolveConversation(targetId: string): string {
    return targetId;
  }

  async sendMessage(conversationId: string, text: string): Promise<string> {
    let message: Message;
    try {
      message = await this.bot.sendMessage(conversationId, text, { parse_mode: "Markdown" });
    } catch (error: unknown) {
      if (!isMarkdownParseError(error)) throw error;
      message = await this.bot.sendMessage(conversationId, text);
    }
    return String(message.message_id);
  }

  async updateMessage(conversationId: string, messageId: string, text: string): Promise<string> {
    const options = { chat_id: conversationId, message_id: Number(messageId) };
    try {
      await this.bot.editMessageText(text, { ...options, parse_mode: "Markdown" });
    } catch (error: unknown) {
      if (isUnchangedError(error)) return messageId;
      if (!isMarkdownParseError(error)) throw error;
      await this.bot.editMessageText(text, options);
    }
    return messageId;
  }

  private async handleRawMessage(msg: Message): Promise<void> {
    if (!msg.from || msg.from.is_bot) return;

    const rawText = msg.text ?? msg.caption ?? "";
    const direct = msg.chat.type === "private";
    const mention = this.botUsername ? `@${this.botUsername}` : "";
    const mentioned = mention !== "" && rawText.includes(mention);
    const repliedTo = msg.reply_to_message?.from?.id === this.botId;

    const message: IncomingMessage = {
      conversationId: String(msg.chat.id),
      userId: String(msg.from.id),
      userName: msg.from.username ? `${msg.from.first_name} (@${msg.from.username})` : msg.from.first_name,
      text: mentioned ? rawText.split(mention).join("").trim() : rawText,
      attachments: await this.extractAllAttachments(msg),
      direct,
      addressed: direct || mentioned || repliedTo,
    };

    for (const handler of this.handlers) {
      await handler(message);
    }
  }

  private async extractAllAttachments(msg: Message): Promise<ChatAttachment[]> {
    const attachments: ChatAttachment[] = [];

    if (msg.photo && msg.photo.length > 0) {
      const sortedPhotos = [...msg.photo].sort((a, b) => b.width * b.height - a.width * a.height);
      const bestPhoto = sortedPhotos.find(p => p.width * p.height <= this.config.maxPhotoPixels) || sortedPhotos[sortedPhotos.length - 1]!;

      const buffer = await fetchTelegramFile(this.bot, this.config.botToken, bestPhoto.file_id);

      attachments.push({
        name: "Image Attachment from Telegram",
        mimeType: "image/jpeg",
        body: buffer.toString("base64"),
        encoding: "base64",
      });
    }

    const document = msg.document;
    // Images arrive as photos above, so documents that are images are skipped here.
    if (document && !document.mime_type?.startsWith("image/")) {
      if (document.file_size && document.file_size > this.config.maxDocumentSize) {
        this.app.serviceOutput(this.service, `Telegram document too large (${document.file_size} bytes), skipping`);
      } else {
        try {
          const buffer = await fetchTelegramFile(this.bot, this.config.botToken, document.file_id);

          attachments.push({
            name: document.file_name || `document_${document.file_id}`,
            mimeType: ChatAttachmentSchema.shape.mimeType.parse(document.mime_type),
            body: buffer.toString("base64"),
            encoding: "base64",
          });
        } catch (error: unknown) {
          this.app.serviceError(this.service, `Failed to fetch Telegram document ${document.file_id}:`, error);
        }
      }
    }

    return attachments;
  }
}

function isMarkdownParseError(error: unknown): boolean {
  if (!Error.isError(error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("can't parse entities") || message.includes("can't find end");
}

function isUnchangedError(error: unknown): boolean {
  return Error.isError(error) && error.message.includes("message is not modified");
}
