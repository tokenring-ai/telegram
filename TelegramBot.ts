import {Agent, AgentManager} from "@tokenring-ai/agent";
import type {InputAttachment} from "@tokenring-ai/agent/AgentEvents";
import {AgentEventState} from "@tokenring-ai/agent/state/agentEventState";
import TokenRingApp from "@tokenring-ai/app";
import type {CommunicationChannel} from "@tokenring-ai/escalation/EscalationProvider";
import axios from "axios";
import TelegramBotAPI from 'node-telegram-bot-api';
import type {ParsedTelegramBotConfig} from "./schema.ts";
import TelegramService from "./TelegramService.ts";

type UserChannel = {
  chatId: string;
  trackedMessageIds: Set<number>;
  queue: string[];
  resolve?: (value: IteratorResult<string>) => void;
  closed: boolean;
};

type ChatBuffer = {
  text: string;
  lastSentText?: string;
  messageId?: number;
  isComplete?: boolean;
};

export default class TelegramBot {
  private bot!: TelegramBotAPI;
  private botUsername?: string;
  private groupAgents = new Map<number, Agent>();
  private dmAgents = new Map<number, Agent>();
  private userChannels = new Map<number, UserChannel>();
  private chatBuffers = new Map<number, ChatBuffer>();
  private lastSendTime = 0;
  private sendTimer: NodeJS.Timeout | null = null;
  private pendingChatIds = new Set<number>();
  private isProcessing = false;
  private messageIdToBotUsername = new Map<number, string>();
  private activeRequests = new Map<string, { chatId: number; responseSent: boolean }>();
  private groupListeners = new Set<number>();

  constructor(
    private app: TokenRingApp,
    private telegramService: TelegramService,
    private botName: string,
    private botConfig: ParsedTelegramBotConfig
  ) {}

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
          await this.bot.sendMessage(groupConfig.groupId, this.botConfig.joinMessage, { parse_mode: 'Markdown' });
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
    this.chatBuffers.clear();
    this.groupListeners.clear();
    this.activeRequests.clear();

    const agentManager = this.app.requireService(AgentManager);
    for (const agent of this.groupAgents.values()) {
      await agentManager.deleteAgent(agent.id, "Telegram bot was shut down.");
    }
    this.groupAgents.clear();

    for (const agent of this.dmAgents.values()) {
      await agentManager.deleteAgent(agent.id, "Telegram bot was shut down.");
    }
    this.dmAgents.clear();

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
        const sentMessage = await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        trackedMessageIds.add(sentMessage.message_id);
        this.userChannels.set(sentMessage.message_id, channel);
        this.messageIdToBotUsername.set(sentMessage.message_id, this.botUsername!);
      },
      receive: async function*(): AsyncGenerator<string> {
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
          channel.resolve({ value: undefined, done: true });
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
      if (! text) return;

      const replyToBotUsername = this.messageIdToBotUsername.get(replyToMessageId);
      if (replyToBotUsername !== this.botUsername) return;

      const channel = this.userChannels.get(replyToMessageId);
      if (channel) {
        channel.trackedMessageIds.add(msg.message_id);
        this.userChannels.set(msg.message_id, channel);
        this.messageIdToBotUsername.set(msg.message_id, this.botUsername!);

        if (channel.resolve) {
          channel.resolve({ value: text, done: false });
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
      if (! text?.trim().includes(mentionString)) return;

      const groupConfig = Object.values(this.botConfig.groups).find(g => g.groupId === chatId);
      this.app.serviceOutput(this.telegramService, `Found group config: ${!!groupConfig}`);
      if (!groupConfig) return;

      if (groupConfig.allowedUsers.length > 0 && !groupConfig.allowedUsers.includes(userId)) {
        await this.bot.sendMessage(chatId, "Sorry, you are not authorized.");
        return;
      }

      const attachments = await this.extractPhotoAttachments(msg);

      await this.handleAgentMessage(
        chatId,
        `From: ${msg.from?.first_name}, Username: (@${msg.from?.username}) ${text ?? "No text sent"}`,
        attachments,
        groupConfig.agentType
      );
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

      const attachments = await this.extractPhotoAttachments(msg);

      const agent = await this.getOrCreateAgentForDM(fromUserId, this.botConfig.dmAgentType);
      this.ensureGroupListener(chatId, agent);

      await agent.waitForState(AgentEventState, (state) => state.idle);

      const requestId = agent.handleInput({
        message: `/chat send ${text}`,
        attachments
      });
      this.activeRequests.set(requestId, { chatId, responseSent: false });
    }
  }

  private async extractPhotoAttachments(msg: TelegramBotAPI.Message): Promise<InputAttachment[]> {
    const attachments: InputAttachment[] = [];

    if (msg.photo && msg.photo.length > 0) {
      const sortedPhotos = [...msg.photo].sort((a, b) =>
        (b.width * b.height) - (a.width * a.height)
      );
      const bestPhoto = sortedPhotos.find(p => (p.width * p.height) <= this.botConfig.maxPhotoPixels)
        || sortedPhotos[sortedPhotos.length - 1];

      const fileId = bestPhoto.file_id;
      const file = await this.bot.getFile(fileId);
      const { data } = await axios.get(
        `https://api.telegram.org/file/bot${this.botConfig.botToken}/${file.file_path}`,
        { responseType: 'arraybuffer' }
      );

      attachments.push({
        name: "Image Attachment from Telegram",
        mimeType: "image/jpeg",
        body: Buffer.from(data as ArrayBuffer).toString("base64"),
        encoding: "base64",
        timestamp: Date.now(),
      });
    }

    return attachments;
  }

  private async handleAgentMessage(chatId: number, text: string, attachments: InputAttachment[], agentType: string): Promise<void> {
    const agent = await this.getOrCreateAgentForGroup(chatId, agentType);
    this.ensureGroupListener(chatId, agent);

    await agent.waitForState(AgentEventState, (state) => state.idle);

    const requestId = agent.handleInput({message: `/chat send ${text}`, attachments});
    this.activeRequests.set(requestId, { chatId, responseSent: false });
  }

  private ensureGroupListener(chatId: number, agent: Agent): void {
    if (this.groupListeners.has(chatId)) return;
    this.groupListeners.add(chatId);

    const eventCursor = agent.getState(AgentEventState).getEventCursorFromCurrentPosition();
    const abortController = new AbortController();

    (async () => {
      try {
        for await (const state of agent.subscribeStateAsync(AgentEventState, abortController.signal)) {
          for (const event of state.yieldEventsByCursor(eventCursor)) {
            switch (event.type) {
              case 'output.chat': {
                // Find any active request for this chatId to mark as responded
                for (const [, req] of this.activeRequests) {
                  if (req.chatId === chatId) {
                    req.responseSent = true;
                  }
                }
                this.handleChatOutput(chatId, event.message);
                break;
              }
              case 'output.info':
              case 'output.warning':
              case 'output.error':
                // Find any active request for this chatId to mark as responded
                for (const [, req] of this.activeRequests) {
                  if (req.chatId === chatId) {
                    req.responseSent = true;
                  }
                }
                this.handleChatOutput(chatId, `\n[${event.type.split('.')[1].toUpperCase()}]: ${event.message}\n`);

                break;
              case 'input.handled': {
                const req = this.activeRequests.get(event.requestId);
                if (req) {
                  const buffer = this.chatBuffers.get(req.chatId);
                  if (buffer) {
                    buffer.isComplete = true;
                  }
                  this.pendingChatIds.add(req.chatId);
                  this.scheduleSend();
                  
                  if (!req.responseSent) {
                    await this.bot.sendMessage(req.chatId, "No response received from agent.");
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
      }
    })();
  }

  private handleChatOutput(chatId: number, content: string): void {
    let buffer = this.chatBuffers.get(chatId);
    if (!buffer) {
      buffer = { text: '' };
      this.chatBuffers.set(chatId, buffer);
    }
    buffer.text += content;
    this.pendingChatIds.add(chatId);
    this.scheduleSend();
  }

  private readonly MAX_MESSAGE_LENGTH = 4090; // Slightly under 4096 to be safe

  private scheduleSend(): void {
    if (this.sendTimer !== null || this.isProcessing) return;
    const now = Date.now();
    const delay = Math.max(0, (this.lastSendTime + 250) - now);
    this.sendTimer = setTimeout(() => this.processPending(), delay);
  }

  private async processPending(): Promise<void> {
    if (this.isProcessing) return;
    this.sendTimer = null;
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
      if (this.pendingChatIds.size > 0) {
        this.scheduleSend();
      }
    }
  }

  private async flushBuffer(chatId: number): Promise<void> {
    const buffer = this.chatBuffers.get(chatId);
    if (!buffer || !buffer.text || buffer.text === buffer.lastSentText) return;

    let textToSend = buffer.text;

    // If the text is too long, we need to split it
    if (textToSend.length > this.MAX_MESSAGE_LENGTH) {
      // Send what we have so far (up to the limit)
      const currentChunk = textToSend.substring(0, this.MAX_MESSAGE_LENGTH);
      const remaining = textToSend.substring(this.MAX_MESSAGE_LENGTH);

      try {
        if (buffer.messageId) {
          await this.bot.editMessageText(currentChunk, {
            chat_id: chatId,
            message_id: buffer.messageId
          });
        } else {
          const sent = await this.bot.sendMessage(chatId, currentChunk, { parse_mode: 'Markdown' });
          this.messageIdToBotUsername.set(sent.message_id, this.botUsername!);
        }
      } catch (error) {
        this.app.serviceError(this.telegramService, 'Error flushing partial buffer:', error);
      }

      // Reset buffer for the remaining text so it starts a fresh message
      buffer.text = remaining;
      buffer.messageId = undefined;
      buffer.lastSentText = '';
      this.pendingChatIds.add(chatId); // Schedule another send for the remainder
      return;
    }

    try {
      if (!buffer.messageId) {
        const sent = await this.bot.sendMessage(chatId, textToSend, { parse_mode: 'Markdown' });
        buffer.messageId = sent.message_id;
        buffer.lastSentText = textToSend;
        this.messageIdToBotUsername.set(sent.message_id, this.botUsername!);
      } else {
        try {
          await this.bot.editMessageText(textToSend, {
            chat_id: chatId,
            message_id: buffer.messageId
          });
          buffer.lastSentText = textToSend;
        } catch (editError) {
          if (! Error.isError(editError)) throw editError;
          if (!editError.message?.includes("message is not modified")) {
            throw editError;
          }
        }
      }
    } catch (error) {
      this.app.serviceError(this.telegramService, 'Error flushing buffer:', error);
    }

    if (buffer.isComplete && buffer.text === buffer.lastSentText) {
      this.chatBuffers.delete(chatId);
    }
  }

  private async getOrCreateAgentForGroup(chatId: number, agentType: string): Promise<Agent> {
    if (!this.groupAgents.has(chatId)) {
      const agentManager = this.app.requireService(AgentManager);
      const agent = await agentManager.spawnAgent({agentType, headless: true});
      this.groupAgents.set(chatId, agent);
    }
    return this.groupAgents.get(chatId)!;
  }

  private async getOrCreateAgentForDM(userId: number, agentType: string): Promise<Agent> {
    if (!this.dmAgents.has(userId)) {
      const agentManager = this.app.requireService(AgentManager);
      const agent = await agentManager.spawnAgent({agentType, headless: true});
      this.dmAgents.set(userId, agent);
    }
    return this.dmAgents.get(userId)!;
  }

  getBotUsername(): string | undefined {
    return this.botUsername;
  }
}