import {Agent, AgentManager} from "@tokenring-ai/agent";
import {AgentEventState} from "@tokenring-ai/agent/state/agentEventState";
import {AgentExecutionState} from "@tokenring-ai/agent/state/agentExecutionState";
import TokenRingApp from "@tokenring-ai/app";

import {TokenRingService} from "@tokenring-ai/app/types";
import waitForAbort from "@tokenring-ai/utility/promise/waitForAbort";
import type {ParsedTelegramServiceConfig} from "./schema.ts";
import TelegramBot = require('node-telegram-bot-api');

export default class TelegramService implements TokenRingService {
  name = "TelegramService";
  description = "Provides a Telegram bot for interacting with TokenRing agents.";
  private chatId?: string;
  private bot: TelegramBot | null = null;
  private userAgents = new Map<string, Agent>();

  constructor(private app: TokenRingApp, private options: ParsedTelegramServiceConfig) {
  }

  async run(signal: AbortSignal): Promise<void> {
    this.bot = new TelegramBot(this.options.botToken, {polling: false});

    // Set up message handler
    this.bot.on('message', async (msg: any) => {
      try {
        const userId = msg.from?.id?.toString();
        const chatId = msg.chat.id;
        const text = msg.text || '';

        if (!userId || !text.trim()) return;

        if (this.options.authorizedUserIds.length > 0 && !this.options.authorizedUserIds.includes(userId)) {
          await this.bot!.sendMessage(chatId, "Sorry, you are not authorized to use this bot.");
          return;
        }

        this.chatId = chatId.toString();
        const agent = await this.getOrCreateAgentForUser(userId);

        // Wait for agent to be idle before sending new message
        await agent.waitForState(AgentExecutionState, (state) => state.idle);

        const eventCursor = agent.getState(AgentEventState).getEventCursorFromCurrentPosition();

        // Send the message to the agent
        const requestId = agent.handleInput({message: text});

        // Subscribe to agent events to process the response
        const unsubscribe = agent.subscribeState(AgentEventState, (state) => {
          for (const event of state.yieldEventsByCursor(eventCursor)) {
            switch (event.type) {
              case 'output.chat':
                this.handleChatOutput(chatId, event.message);
                break;
              case 'output.info':
                this.handleSystemOutput(chatId, event.message, 'info');
                break;
              case 'output.warning':
                this.handleSystemOutput(chatId, event.message, 'warning');
                break;
              case 'output.error':
                this.handleSystemOutput(chatId, event.message, 'error');
                break;
              case 'input.handled':
                if (event.requestId === requestId) {
                  unsubscribe();
                  // If no response was sent, send a default message
                  if (!this.lastResponseSent) {
                    this.bot!.sendMessage(chatId, "No response received from agent.");
                  }
                }
                break;
            }
          }
        });

        // Set timeout for the response
        if (agent.config.maxRunTime > 0) {
          setTimeout(() => {
            unsubscribe();
            this.bot!.sendMessage(chatId, `Agent timed out after ${agent.config.maxRunTime} seconds.`);
          }, agent.config.maxRunTime * 1000);
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    });

    // Set up error handler
    this.bot.on('polling_error', (error: any) => {
      console.error('Polling error:', error);
    });

    // Start polling
    await this.bot.startPolling({restart: true});

    if (this.chatId) {
      await this.bot.sendMessage(this.chatId, "Telegram bot is online!");
    }

    return waitForAbort(signal, async (ev) => {
      const agentManager = this.app.requireService(AgentManager);

      // Clean up all user agents
      for (const [userId, agent] of this.userAgents.entries()) {
        await agentManager.deleteAgent(agent);
      }
      this.userAgents.clear();

      if (this.bot) {
        try {
          await this.bot.stopPolling();
        } catch (error) {
          console.error('Error stopping polling:', error);
        }
        this.bot = null;
      }
    });
  }

  private lastResponseSent = false;

  private async handleChatOutput(chatId: number, content: string): Promise<void> {
    // Accumulate chat content and send when complete
    this.lastResponseSent = true;
    await this.bot!.sendMessage(chatId, content);
  }

  private async handleSystemOutput(chatId: number, message: string, level: string): Promise<void> {
    const formattedMessage = `[${level.toUpperCase()}]: ${message}`;
    await this.bot!.sendMessage(chatId, formattedMessage);
  }

  private async getOrCreateAgentForUser(userId: string): Promise<Agent> {
    const agentManager = this.app!.requireService(AgentManager);
    if (!this.userAgents.has(userId)) {
      const agent = await agentManager.spawnAgent({agentType: this.options.defaultAgentType, headless: false});
      this.userAgents.set(userId, agent);
    }
    return this.userAgents.get(userId)!;
  }
}