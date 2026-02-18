import {Agent, AgentManager} from "@tokenring-ai/agent";
import {AgentEventState} from "@tokenring-ai/agent/state/agentEventState";
import {AgentExecutionState} from "@tokenring-ai/agent/state/agentExecutionState";
import TokenRingApp from "@tokenring-ai/app";
import type {CommunicationChannel} from "@tokenring-ai/escalation/EscalationProvider";
import TelegramBotAPI from 'node-telegram-bot-api';
import type {ParsedTelegramBotConfig} from "./schema.ts";

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
};

export default class TelegramBot {
  private bot!: TelegramBotAPI;
  private botUsername?: string;
  private groupAgents = new Map<number, Agent>();
  private userChannels = new Map<number, UserChannel>();
  private chatBuffers = new Map<number, ChatBuffer>();
  private lastSendTime = 0;
  private sendTimer: NodeJS.Timeout | null = null;
  private pendingChatIds = new Set<number>();
  private isProcessing = false;
  private messageIdToBotUsername = new Map<number, string>();

  constructor(
    private app: TokenRingApp,
    private botName: string,
    private botConfig: ParsedTelegramBotConfig
  ) {}

  async start(): Promise<void> {
    this.bot = new TelegramBotAPI(this.botConfig.botToken, {polling: true});
    const botInfo = await this.bot.getMe();
    this.botUsername = botInfo.username;
    this.app.serviceOutput(`Bot @${this.botUsername} started`);

    this.bot.on('message', async (msg: any) => {
      this.app.serviceOutput(`Raw message received: ${JSON.stringify(msg)}`);
      try {
        await this.handleMessage(msg);
      } catch (error) {
        this.app.serviceError('Error processing message:', error);
      }
    });

    this.bot.on('polling_error', (error: any) => {
      this.app.serviceError('Polling error:', error);
    });

    if (this.botConfig.joinMessage) {
      for (const groupConfig of Object.values(this.botConfig.groups)) {
        try {
          await this.bot.sendMessage(groupConfig.groupId, this.botConfig.joinMessage);
        } catch (error) {
          this.app.serviceError(`Failed to announce to group ${groupConfig.groupId}:`, error);
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

    const agentManager = this.app.requireService(AgentManager);
    for (const agent of this.groupAgents.values()) {
      await agentManager.deleteAgent(agent);
    }
    this.groupAgents.clear();

    try {
      await this.bot.stopPolling();
    } catch (error) {
      this.app.serviceError('Error stopping polling:', error);
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
        const sentMessage = await this.bot.sendMessage(chatId, message);
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

  private async handleMessage(msg: any): Promise<void> {
    const userId = msg.from?.id?.toString();
    const chatId = msg.chat.id;
    const text = msg.text || '';

    if (!userId || !text.trim()) return;

    this.app.serviceOutput(`Message from ${userId} in chat ${chatId}: "${text}"`);

    // Check if reply to tracked message
    const replyToMessageId = msg.reply_to_message?.message_id;
    if (replyToMessageId) {
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
      this.app.serviceOutput(`Group message, checking if "${text}" starts with "${mentionString}"`);
      if (!text.trim().startsWith(mentionString)) return;

      const groupConfig = Object.values(this.botConfig.groups).find(g => g.groupId === chatId);
      this.app.serviceOutput(`Found group config: ${!!groupConfig}`);
      if (!groupConfig) return;

      if (groupConfig.allowedUsers.length > 0 && !groupConfig.allowedUsers.includes(userId)) {
        await this.bot.sendMessage(chatId, "Sorry, you are not authorized.");
        return;
      }

      await this.handleAgentMessage(chatId, text, groupConfig.agentType);
    }
  }

  private async handleAgentMessage(chatId: number, text: string, agentType: string): Promise<void> {
    const agent = await this.getOrCreateAgentForGroup(chatId, agentType);
    await agent.waitForState(AgentExecutionState, (state) => state.idle);

    let responseSent = false;
    const requestId = agent.handleInput({message: `/chat send ${text}`});
    const abortController = new AbortController();
    const eventCursor = agent.getState(AgentEventState).getEventCursorFromCurrentPosition();

    let timeoutHandle: NodeJS.Timeout | null = null;
    if (agent.config.maxRunTime > 0) {
      timeoutHandle = setTimeout(() => abortController.abort(), agent.config.maxRunTime * 1000);
    }

    try {
      for await (const state of agent.subscribeStateAsync(AgentEventState, abortController.signal)) {
        for (const event of state.yieldEventsByCursor(eventCursor)) {
          switch (event.type) {
            case 'output.chat':
              responseSent = true;
              this.handleChatOutput(chatId, event.message);
              break;
            case 'output.info':
            case 'output.warning':
            case 'output.error':
              await this.bot.sendMessage(chatId, `[${event.type.split('.')[1].toUpperCase()}]: ${event.message}`);
              break;
            case 'input.handled':
              if (event.requestId === requestId) {
                this.pendingChatIds.add(chatId);
                this.scheduleSend();
                if (!responseSent) {
                  await this.bot.sendMessage(chatId, "No response received from agent.");
                }
                abortController.abort();
              }
              break;
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        this.app.serviceError('Error processing message:', error);
      }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      this.pendingChatIds.add(chatId);
      this.scheduleSend();
    }
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
          const sent = await this.bot.sendMessage(chatId, currentChunk);
          this.messageIdToBotUsername.set(sent.message_id, this.botUsername!);
        }
      } catch (error) {
        this.app.serviceError('Error flushing partial buffer:', error);
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
        const sent = await this.bot.sendMessage(chatId, textToSend);
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
        } catch (editError: any) {
          if (!editError.message?.includes("message is not modified")) {
            throw editError;
          }
        }
      }
    } catch (error) {
      this.app.serviceError('Error flushing buffer:', error);
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

  getBotUsername(): string | undefined {
    return this.botUsername;
  }
}
