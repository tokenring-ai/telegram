import {Agent, AgentManager} from "@tokenring-ai/agent";
import type {InputAttachment} from "@tokenring-ai/agent/AgentEvents";
import {AgentEventState} from "@tokenring-ai/agent/state/agentEventState";
import TokenRingApp from "@tokenring-ai/app";
import type {CommunicationChannel} from "@tokenring-ai/escalation/EscalationProvider";
import axios from "axios";
import TelegramBotAPI from 'node-telegram-bot-api';
import type {ParsedTelegramBotConfig} from "./schema.ts";
import {splitIntoChunks} from "./splitIntoChunks.ts";
import TelegramService from "./TelegramService.ts";

type UserChannel = {
  chatId: string;
  trackedMessageIds: Set<number>;
  queue: string[];
  resolve?: (value: IteratorResult<string>) => void;
  closed: boolean;
};

type ChatResponse = {
  text: string | null;           // full accumulated text so far
  // per-chunk state: index = chunk position
  messageIds: (number | undefined)[];
  sentTexts: string[];
  isComplete?: boolean;
};

export default class TelegramBot {
  private bot!: TelegramBotAPI;
  private botUsername?: string;
  private chatAgents = new Map<number, Promise<Agent>>();
  private userChannels = new Map<number, UserChannel>();
  private chatResponses = new Map<number, ChatResponse>();
  private lastSendTime = 0;
  private sendTimer: NodeJS.Timeout | null = null;
  private pendingChatIds = new Set<number>();
  private isProcessing = false;
  private messageIdToBotUsername = new Map<number, string>();
  private activeRequests = new Map<string, { chatId: number }>();
  private chatListeners = new Set<number>();

  constructor(
    private app: TokenRingApp,
    private telegramService: TelegramService,
    private botName: string,
    private botConfig: ParsedTelegramBotConfig
  ) {
  }

  async start(): Promise<void> {
    this.bot = new TelegramBotAPI(this.botConfig.botToken, {polling: true});
    const botInfo = await this.bot.getMe();
    this.botUsername = botInfo.username;
    this.app.serviceOutput(this.telegramService, `Bot @${this.botUsername} started`);

    this.bot.on('message', async (msg) => {
      this.app.serviceOutput(this.telegramService, `Raw message received: ${JSON.stringify(msg)}`);
      try {
        await this.handleMessage(msg);
      } catch (error) {
        this.app.serviceError(this.telegramService, 'Error processing message:', error);
      }
    });

    this.bot.on('polling_error', (error) => {
      this.app.serviceError(this.telegramService, 'Polling error:', error);
    });

    if (this.botConfig.joinMessage) {
      for (const groupConfig of Object.values(this.botConfig.groups)) {
        try {
          await this.bot.sendMessage(groupConfig.groupId, this.botConfig.joinMessage, {parse_mode: 'Markdown'});
        } catch (error) {
          this.app.serviceError(this.telegramService, `Failed to announce to group ${groupConfig.groupId}:`, error);
        }
      }
    }
  }

  async stop(): Promise<void> {
    if (this.sendTimer) {
      clearTimeout(this.sendTimer);
      this.sendTimer = null;
    }

    const chatIds = [...this.pendingChatIds];
    for (const chatId of chatIds) {
      await this.flushBuffer(chatId);
    }
    this.pendingChatIds.clear();
    this.chatResponses.clear();
    this.chatListeners.clear();
    this.activeRequests.clear();

    const agentManager = this.app.requireService(AgentManager);
    for (const agentPromise of this.chatAgents.values()) {
      const agent = await agentPromise;
      await agentManager.deleteAgent(agent.id, "Telegram bot was shut down.");
    }
    this.chatAgents.clear();

    try {
      await this.bot.stopPolling();
    } catch (error) {
      this.app.serviceError(this.telegramService, 'Error stopping polling:', error);
    }
  }

  createCommunicationChannelWithGroup(groupName: string): CommunicationChannel {
    const groupConfig = this.botConfig.groups[groupName];
    if (!groupConfig) {
      throw new Error(`Group "${groupName}" not found in configuration.`);
    }
    return this.createCommunicationChannelWithUser(groupConfig.groupId.toString());
  }

  createCommunicationChannelWithUser(userId: string): CommunicationChannel {
    const chatId = userId;
    const trackedMessageIds = new Set<number>();

    const channel: UserChannel = {
      chatId,
      trackedMessageIds,
      queue: [],
      closed: false
    };

    return {
      send: async (message: string) => {
        const sentMessage = await this.bot.sendMessage(chatId, message, {parse_mode: 'Markdown'});
        trackedMessageIds.add(sentMessage.message_id);
        this.userChannels.set(sentMessage.message_id, channel);
        this.messageIdToBotUsername.set(sentMessage.message_id, this.botUsername!);
      },
      receive: async function* (): AsyncGenerator<string> {
        while (!channel.closed) {
          if (channel.queue.length > 0) {
            yield channel.queue.shift()!;
          } else {
            await new Promise<IteratorResult<string>>((resolve) => {
              channel.resolve = resolve;
            });
          }
        }
      },
      [Symbol.asyncDispose]: async () => {
        channel.closed = true;
        if (channel.resolve) {
          channel.resolve({value: undefined, done: true});
          channel.resolve = undefined;
        }
        for (const msgId of trackedMessageIds) {
          this.userChannels.delete(msgId);
          this.messageIdToBotUsername.delete(msgId);
        }
        trackedMessageIds.clear();
      }
    };
  }

  private async handleMessage(msg: TelegramBotAPI.Message): Promise<void> {
    const userId = msg.from?.id;
    const chatId = msg.chat.id;
    const text = msg.text ?? msg.caption;

    if (!userId) return;

    this.app.serviceOutput(this.telegramService, `Message from ${userId} in chat ${chatId}: "${text}"`);

    // Check if reply to tracked message
    const replyToMessageId = msg.reply_to_message?.message_id;
    if (replyToMessageId) {
      if (!text) return;

      const replyToBotUsername = this.messageIdToBotUsername.get(replyToMessageId);
      if (replyToBotUsername !== this.botUsername) return;

      const channel = this.userChannels.get(replyToMessageId);
      if (channel) {
        channel.trackedMessageIds.add(msg.message_id);
        this.userChannels.set(msg.message_id, channel);
        this.messageIdToBotUsername.set(msg.message_id, this.botUsername!);

        if (channel.resolve) {
          channel.resolve({value: text, done: false});
          channel.resolve = undefined;
        } else {
          channel.queue.push(text);
        }
        return;
      }
    }

    // Check if group message with mention
    const chatType = msg.chat.type;
    if (chatType === 'group' || chatType === 'supergroup') {
      const mentionString = `@${this.botUsername}`;
      this.app.serviceOutput(this.telegramService, `Group message, checking if text or caption "${text}" contains "${mentionString}"`);
      if (!text?.trim().includes(mentionString)) return;

      const groupConfig = Object.values(this.botConfig.groups).find(g => g.groupId === chatId);
      this.app.serviceOutput(this.telegramService, `Found group config: ${!!groupConfig}`);
      if (!groupConfig) return;

      if (groupConfig.allowedUsers.length > 0 && !groupConfig.allowedUsers.includes(userId)) {
        await this.bot.sendMessage(chatId, "Sorry, you are not authorized.");
        return;
      }

      const attachments = await this.extractAllAttachments(msg);

      const agent = await this.ensureAgentForChat(chatId, groupConfig.agentType);
      let message: string;
      const commandMatch = text.match(/^\s*(\/\S+)(.*)/);
      if (commandMatch) {
        const command = commandMatch[1];
        if (Object.hasOwn(this.botConfig.commandMapping, command)) {
          message = `${this.botConfig.commandMapping[command]}${commandMatch[2]}`;
        } else if (command === '/stop') {
          agent.requestAbort("User requested abort from telegram");
          return;
        } else {
          throw new Error(`Command ${command} not found: ${command}`);
        }
      } else {
        message = `/chat send From: ${msg.from?.first_name}, Username: (@${msg.from?.username}) ${text ?? "No text sent"}`;
      }

      await agent.waitForState(AgentEventState, (state) => state.idle);

      this.chatResponses.set(chatId, {text: null, messageIds: [], sentTexts: []});

      await this.processPending();

      const requestId = agent.handleInput({message, attachments});
      this.activeRequests.set(requestId, {chatId});
    }

    // Handle private (DM) messages
    if (chatType === 'private') {
      if (!text) return;

      if (!this.botConfig.dmAgentType) {
        await this.bot.sendMessage(chatId, "DMs are not enabled for this bot.");
        return;
      }

      if (this.botConfig.dmAllowedUsers && this.botConfig.dmAllowedUsers.length > 0
        && !this.botConfig.dmAllowedUsers.includes(userId)) {
        await this.bot.sendMessage(chatId, "Sorry, you are not authorized to DM this bot.");
        return;
      }

      const fromUserId = msg.from!.id;

      const attachments = await this.extractAllAttachments(msg);

      const agent = await this.ensureAgentForChat(fromUserId, this.botConfig.dmAgentType);

      let message: string;
      const commandMatch = text.match(/^\s*(\/\S+)(.*)/);
      if (commandMatch) {
        const command = commandMatch[1];
        if (Object.hasOwn(this.botConfig.commandMapping, command)) {
          message = `${this.botConfig.commandMapping[command]}${commandMatch[2]}`;
        } else if (command === '/stop') {
          agent.requestAbort("User requested abort from telegram");
          return;
        } else {
          throw new Error(`Command ${command} not found: ${command}`);
        }
      } else {
        message = `/chat send From: ${msg.from?.first_name}, Username: (@${msg.from?.username}) ${text ?? "No text sent"}`;
      }

      await agent.waitForState(AgentEventState, (state) => state.idle);

      this.chatResponses.set(chatId, {text: null, messageIds: [], sentTexts: []});

      await this.processPending();

      const requestId = agent.handleInput({message, attachments});
      this.activeRequests.set(requestId, {chatId});
    }
  }

  private async extractAllAttachments(msg: TelegramBotAPI.Message): Promise<InputAttachment[]> {
    const attachments: InputAttachment[] = [];

    // Handle photos
    if (msg.photo && msg.photo.length > 0) {
      const sortedPhotos = [...msg.photo].sort((a, b) =>
        (b.width * b.height) - (a.width * a.height)
      );
      const bestPhoto = sortedPhotos.find(p => (p.width * p.height) <= this.botConfig.maxPhotoPixels)
        || sortedPhotos[sortedPhotos.length - 1];

      const fileId = bestPhoto.file_id;
      const file = await this.bot.getFile(fileId);
      const {data} = await axios.get(
        `https://api.telegram.org/file/bot${this.botConfig.botToken}/${file.file_path}`,
        {responseType: 'arraybuffer'}
      );

      attachments.push({
        name: "Image Attachment from Telegram",
        mimeType: "image/jpeg",
        body: Buffer.from(data as ArrayBuffer).toString("base64"),
        encoding: "base64",
        timestamp: Date.now(),
      });
    }

    // Handle documents
    if (msg.document) {
      const document = msg.document;
      if (document.mime_type && document.mime_type.startsWith("image/")) {
        // Skip images which are processed above
      } else {
        const document = msg.document;
        if (document.file_size && document.file_size > this.botConfig.maxDocumentSize) {
          this.app.serviceOutput(this.telegramService, `Document too large (${document.file_size} bytes), skipping`);
        } else {
          const fileId = document.file_id;
          try {
            const file = await this.bot.getFile(fileId);
            const {data} = await axios.get(
              `https://api.telegram.org/file/bot${this.botConfig.botToken}/${file.file_path}`,
              {responseType: 'arraybuffer'}
            );

            attachments.push({
              name: document.file_name || `document_${fileId}`,
              mimeType: document.mime_type || "text/plain",
              body: Buffer.from(data as ArrayBuffer).toString("base64"),
              encoding: "base64",
              timestamp: Date.now(),
            });
          } catch (error) {
            this.app.serviceError(this.telegramService, `Failed to fetch document ${fileId}:`, error);
          }
        }
      }
    }

    return attachments;
  }

  private async ensureAgentForChat(chatId: number, agentType: string): Promise<Agent> {
    if (!this.chatAgents.has(chatId)) {
      const agentManager = this.app.requireService(AgentManager);
      const agentPromise = agentManager.spawnAgent({agentType, headless: true});
      this.chatAgents.set(chatId, agentPromise);
    }

    const agent = await this.chatAgents.get(chatId)!;

    if (!this.chatListeners.has(chatId)) {
      this.chatListeners.add(chatId);

      agent.runBackgroundTask((signal) => this.agentEventLoop(chatId, agent, signal));
    }

    return agent;
  }

  private async agentEventLoop(chatId: number, agent: Agent, signal: AbortSignal): Promise<void> {
    const eventCursor = agent.getState(AgentEventState).getEventCursorFromCurrentPosition();
    try {
      for await (const state of agent.subscribeStateAsync(AgentEventState, signal)) {
        for (const event of state.yieldEventsByCursor(eventCursor)) {
          switch (event.type) {
            case 'output.chat': {
              this.handleChatOutput(chatId, event.message);
              break;
            }
            case 'output.info':
            case 'output.warning':
            case 'output.error':
              this.handleChatOutput(chatId, `\n[${event.type.split('.')[1].toUpperCase()}]: ${event.message}\n`);

              break;
            case 'input.handled': {
              const req = this.activeRequests.get(event.requestId);
              if (req) {
                const response = this.chatResponses.get(req.chatId);
                if (response) {
                  response.isComplete = true;
                  this.handleChatOutput(chatId, `\n\n${event.message}`);
                }
                this.activeRequests.delete(event.requestId);
              }
              break;
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        this.app.serviceError(this.telegramService, 'Error in group listener:', error);
      }
    } finally {
      this.chatListeners.delete(chatId);
    }
  }

  private handleChatOutput(chatId: number, content: string): void {
    let response = this.chatResponses.get(chatId);
    if (!response) throw new Error(`No response found for chat ${chatId}`);

    if (response.text === null) {
      response.text = content.trimStart();
    } else {
      response.text += content;
    }

    this.pendingChatIds.add(chatId);
    this.scheduleSend();
  }

  private scheduleSend(): void {
    if (this.sendTimer !== null) return;
    const now = Date.now();
    const delay = Math.max(0, (this.lastSendTime + 250) - now);
    this.sendTimer = setTimeout(() => this.processPending(), delay);
  }

  private async processPending(): Promise<void> {
    if (this.isProcessing) return;

    if (this.sendTimer) clearTimeout(this.sendTimer);
    this.isProcessing = true;

    try {
      const chatIds = [...this.pendingChatIds];
      this.pendingChatIds.clear();
      for (const chatId of chatIds) {
        await this.flushBuffer(chatId);
      }
      this.lastSendTime = Date.now();
    } finally {
      this.isProcessing = false;
      this.sendTimer = null;
      if (this.pendingChatIds.size > 0) {
        this.scheduleSend();
      }
    }
  }

  private async flushBuffer(chatId: number): Promise<void> {
    const response = this.chatResponses.get(chatId);
    if (!response) return;

    const chunks = splitIntoChunks(response.text);
    let hadErrors = false;

    // While streaming:
    // - resend previous last sent chunk (it may have shifted/expanded),
    // - send every newly created chunk after it.
    const syncFrom = response.isComplete
      ? 0
      : Math.max(0, response.sentTexts.length - 1);

    for (let i = syncFrom; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk === response.sentTexts[i]) continue;

      try {
        const existingId = response.messageIds[i];
        if (existingId) {
          await this.updateMessageWithFallback(chatId, existingId, chunk);
        } else {
          const sent = await this.sendMessageWithFallback(chatId, chunk);
          response.messageIds[i] = sent.message_id;
          this.messageIdToBotUsername.set(sent.message_id, this.botUsername!);
        }
        response.sentTexts[i] = chunk;
      } catch (error) {
        if (error instanceof Error && error.message?.includes('message is not modified')) continue;
        hadErrors = true;
        this.app.serviceError(this.telegramService, 'Error flushing buffer:', error);
      }
    }

    if (response.isComplete) {
      this.chatResponses.delete(chatId);
    }
  }

  private async sendMessageWithFallback(chatId: number, text: string): Promise<TelegramBotAPI.Message> {
    this.app.serviceOutput(this.telegramService, `Sending text ${text}`);
    let messageId;
    try {
      messageId = await this.bot.sendMessage(chatId, text, {parse_mode: 'Markdown'});
    } catch (error) {
      if (!this.isMarkdownParseError(error)) throw error;
      messageId = await this.bot.sendMessage(chatId, text);
    }
    this.app.serviceOutput(this.telegramService, `Text sent, messageId=${messageId}`);
    return messageId;
  }

  private async updateMessageWithFallback(chatId: number, messageId: number, text: string): Promise<void> {
    this.app.serviceOutput(this.telegramService, `Updating ${messageId} with text ${text}`);
    try {
      await this.bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
      });
    } catch (error) {
      if (!this.isMarkdownParseError(error)) throw error;
      await this.bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId
      });
    }
  }

  private isMarkdownParseError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message?.toLowerCase() ?? '';
    return msg.includes("can't parse entities") || msg.includes("can't find end");
  }

  getBotUsername(): string | undefined {
    return this.botUsername;
  }
}
