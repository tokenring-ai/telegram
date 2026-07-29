import type { ChatAttachment } from "@tokenring-ai/agent/AgentEvents";
import { ChatAttachmentSchema } from "@tokenring-ai/agent/AgentEvents";
import type TokenRingApp from "@tokenring-ai/app";
import type { IncomingMessage, IncomingMessageHandler, MembershipHandler, MessagingProvider, SendOptions } from "@tokenring-ai/bot";
import type { ChatMemberUpdated, Message } from "node-telegram-bot-api";
import TelegramBotAPI from "node-telegram-bot-api";
import { fetchTelegramFile } from "./fetchTelegramFile.ts";
import type { ResolvedTelegramAccountConfig } from "./schema.ts";
import type TelegramService from "./TelegramService.ts";

/** Telegram's own limit is 4096; leave room for the markdown we send. */
const MAX_MESSAGE_LENGTH = 4090;

/** Telegram refuses to serve a file over 20MB to a bot, whatever we ask for. */
const TELEGRAM_DOWNLOAD_LIMIT = 20_971_520;

/** Chat types that are a room the bot can be invited into, rather than a 1:1. */
const GROUP_CHAT_TYPES = new Set(["group", "supergroup"]);

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
  private membershipHandlers = new Set<MembershipHandler>();
  /** Group chats we have already reported, so first-sight is reported once. */
  private reportedChats = new Set<string>();

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

    this.bot.on("my_chat_member", update => {
      void this.handleMembershipUpdate(update).catch((error: unknown) => {
        this.app.serviceError(this.service, "Error processing Telegram membership update:", error);
      });
    });

    this.bot.on("polling_error", error => {
      this.app.serviceError(this.service, "Telegram polling error:", error);
    });
  }

  async stop(): Promise<void> {
    this.handlers.clear();
    this.membershipHandlers.clear();
    this.reportedChats.clear();
    try {
      await this.bot.stopPolling();
    } catch (error: unknown) {
      this.app.serviceError(this.service, "Error stopping Telegram polling:", error);
    }
  }

  onMessage(handler: IncomingMessageHandler): void {
    this.handlers.add(handler);
  }

  onMembershipChange(handler: MembershipHandler): void {
    this.membershipHandlers.add(handler);
  }

  /**
   * Telegram chat ids double as conversation ids, for both users and groups. A
   * forum topic is addressed as `chatId:topicId`, which is also what a target
   * pointing at one looks like, so both arrive here already in the right shape.
   */
  resolveConversation(targetId: string): string {
    return targetId;
  }

  async sendMessage(conversationId: string, text: string, options?: SendOptions): Promise<string> {
    const { chatId, messageThreadId } = splitConversation(conversationId);

    const params = {
      ...(messageThreadId !== undefined ? { message_thread_id: messageThreadId } : {}),
      // `allow_sending_without_reply` so a deleted parent downgrades to a plain
      // post rather than failing the whole send.
      ...(options?.replyToMessageId ? { reply_parameters: { message_id: Number(options.replyToMessageId), allow_sending_without_reply: true } } : {}),
    };

    let message: Message;
    try {
      message = await this.bot.sendMessage(chatId, text, { ...params, parse_mode: "Markdown" });
    } catch (error: unknown) {
      if (!isMarkdownParseError(error)) throw error;
      message = await this.bot.sendMessage(chatId, text, params);
    }
    return String(message.message_id);
  }

  async updateMessage(conversationId: string, messageId: string, text: string): Promise<string> {
    // An edit is addressed by message id alone; the topic is already implied.
    const options = { chat_id: splitConversation(conversationId).chatId, message_id: Number(messageId) };
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

    const roomId = String(msg.chat.id);
    const direct = msg.chat.type === "private";

    // Only a forum topic gets its own conversation. `message_thread_id` alone is
    // not enough — a plain supergroup sets it on reply chains too, and splitting
    // on those would hand every thread of a normal group its own agent.
    const topicId = msg.is_topic_message ? msg.message_thread_id : undefined;
    const conversationId = topicId !== undefined ? `${roomId}:${topicId}` : roomId;

    if (!direct) await this.reportChatOnFirstSight(msg);

    const rawText = msg.text ?? msg.caption ?? "";
    const addressing = this.readAddressing(rawText);
    // Telegram delivers `/cmd@otherbot` to us too; it is plainly not ours.
    if (addressing.addressedToAnotherBot) return;

    const repliedTo = msg.reply_to_message?.from?.id === this.botId;
    const hasAttachments = Boolean(msg.photo?.length) || Boolean(msg.document);

    const message: IncomingMessage = {
      conversationId,
      // The bot is configured into the forum, not into each of its topics.
      roomId: topicId !== undefined ? roomId : undefined,
      userId: String(msg.from.id),
      userName: msg.from.username ? `${msg.from.first_name} (@${msg.from.username})` : msg.from.first_name,
      text: addressing.text,
      messageId: String(msg.message_id),
      replyToMessageId: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
      hasAttachments,
      attachments: hasAttachments ? this.deferAttachments(msg) : undefined,
      direct,
      addressed: direct || addressing.mentioned || repliedTo,
    };

    for (const handler of this.handlers) {
      await handler(message);
    }
  }

  private async handleMembershipUpdate(update: ChatMemberUpdated): Promise<void> {
    if (!GROUP_CHAT_TYPES.has(update.chat.type)) return;

    const status = update.new_chat_member.status;
    const joined = status === "member" || status === "administrator" || status === "creator";
    const conversationId = String(update.chat.id);

    // Logged unconditionally: an operator who is not using the join flow still
    // needs somewhere to read the group's id from.
    this.app.serviceOutput(
      this.service,
      `Telegram account ${this.accountName} was ${joined ? "added to" : "removed from"} ${update.chat.title ?? "a group"} (${conversationId})`,
    );

    if (joined) {
      this.reportedChats.add(conversationId);
    } else {
      this.reportedChats.delete(conversationId);
    }

    await this.emitMembership({
      conversationId,
      title: update.chat.title,
      joined,
      byUserId: String(update.from.id),
      via: "invite",
    });
  }

  /**
   * A group the bot was already in when the process started never produces a
   * membership update, so the first message out of it stands in for one.
   */
  private async reportChatOnFirstSight(msg: Message): Promise<void> {
    const conversationId = String(msg.chat.id);
    if (!GROUP_CHAT_TYPES.has(msg.chat.type) || this.reportedChats.has(conversationId)) return;
    this.reportedChats.add(conversationId);

    this.app.serviceOutput(this.service, `Telegram account ${this.accountName} is in ${msg.chat.title ?? "a group"} (${conversationId})`);

    await this.emitMembership({
      conversationId,
      title: msg.chat.title,
      joined: true,
      via: "observed",
    });
  }

  private async emitMembership(event: Parameters<MembershipHandler>[0]): Promise<void> {
    for (const handler of this.membershipHandlers) {
      await handler(event);
    }
  }

  /**
   * Works out whether the bot was addressed, and strips its own `@username`
   * from the text — both a bare mention and the `@botname` suffix Telegram
   * appends to commands in groups, so `/reset@helper_bot` reads as `/reset`.
   *
   * The lookahead is the username boundary (Telegram usernames are
   * `[A-Za-z0-9_]`), so `@help` no longer matches inside `@helpdesk`, and the
   * match is case insensitive because mentions are.
   */
  private readAddressing(rawText: string): { text: string; mentioned: boolean; addressedToAnotherBot: boolean } {
    if (!this.botUsername) return { text: rawText, mentioned: false, addressedToAnotherBot: false };

    const mention = new RegExp(`@${escapeRegExp(this.botUsername)}(?![A-Za-z0-9_])`, "gi");
    const mentioned = mention.test(rawText);
    mention.lastIndex = 0;

    if (!mentioned) {
      // `/cmd@someone_else` is Telegram routing another bot's command past us.
      const otherBotCommand = /^\s*\/\S+@([A-Za-z0-9_]+)/.exec(rawText);
      return { text: rawText, mentioned: false, addressedToAnotherBot: otherBotCommand !== null };
    }

    return {
      text: rawText
        .replace(mention, "")
        .replace(/\s{2,}/g, " ")
        .trim(),
      mentioned: true,
      addressedToAnotherBot: false,
    };
  }

  /**
   * Hands back a fetcher rather than the files themselves: in a busy group most
   * messages are never handled by any bot, and downloading their photos before
   * routing is pure waste. Memoized so a caller cannot pay twice.
   */
  private deferAttachments(msg: Message): () => Promise<ChatAttachment[]> {
    let pending: Promise<ChatAttachment[]> | undefined;
    return () => (pending ??= this.extractAllAttachments(msg));
  }

  private async extractAllAttachments(msg: Message): Promise<ChatAttachment[]> {
    const attachments: ChatAttachment[] = [];

    if (msg.photo && msg.photo.length > 0) {
      const sortedPhotos = [...msg.photo].sort((a, b) => b.width * b.height - a.width * a.height);
      const bestPhoto = sortedPhotos.find(p => p.width * p.height <= this.config.maxPhotoPixels) || sortedPhotos[sortedPhotos.length - 1]!;

      const limit = Math.min(this.config.maxFileSize, TELEGRAM_DOWNLOAD_LIMIT);
      if (bestPhoto.file_size && bestPhoto.file_size > limit) {
        this.app.serviceOutput(this.service, `Telegram photo too large (${bestPhoto.file_size} bytes, limit ${limit}), skipping`);
      } else {
        try {
          const buffer = await fetchTelegramFile(this.bot, this.config.botToken, bestPhoto.file_id);

          attachments.push({
            name: "Image Attachment from Telegram",
            mimeType: "image/jpeg",
            body: buffer.toString("base64"),
            encoding: "base64",
          });
        } catch (error: unknown) {
          this.app.serviceError(this.service, `Failed to fetch Telegram photo ${bestPhoto.file_id}:`, error);
        }
      }
    }

    const document = msg.document;
    // Images arrive as photos above, so documents that are images are skipped here.
    if (document && !document.mime_type?.startsWith("image/")) {
      const limit = Math.min(this.config.maxDocumentSize, TELEGRAM_DOWNLOAD_LIMIT);
      // An unsupported type is declined rather than thrown: a .docx is a normal
      // thing to post in a group, not an error condition.
      const mimeType = ChatAttachmentSchema.shape.mimeType.safeParse(document.mime_type);

      if (document.file_size && document.file_size > limit) {
        this.app.serviceOutput(this.service, `Telegram document too large (${document.file_size} bytes, limit ${limit}), skipping`);
      } else if (!mimeType.success) {
        this.app.serviceOutput(
          this.service,
          `Telegram document ${document.file_name ?? document.file_id} has unsupported type ${document.mime_type ?? "unknown"}, skipping`,
        );
      } else {
        try {
          const buffer = await fetchTelegramFile(this.bot, this.config.botToken, document.file_id);

          attachments.push({
            name: document.file_name || `document_${document.file_id}`,
            mimeType: mimeType.data,
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

/**
 * Splits a conversation id back into the chat and, for a forum topic, the thread
 * within it. Chat ids are numeric — a group's is negative, as in
 * `-1001234567890` — so the only colon a conversation id can hold is the one
 * this provider put there.
 */
function splitConversation(conversationId: string): { chatId: string; messageThreadId?: number } {
  const [, chatId, topicId] = /^(.+):(\d+)$/.exec(conversationId) ?? [];
  if (!chatId || !topicId) return { chatId: conversationId };

  return { chatId, messageThreadId: Number(topicId) };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isMarkdownParseError(error: unknown): boolean {
  if (!Error.isError(error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("can't parse entities") || message.includes("can't find end");
}

function isUnchangedError(error: unknown): boolean {
  return Error.isError(error) && error.message.includes("message is not modified");
}
