import { Agent, AgentTeam } from "@tokenring-ai/agent";
import { TokenRingService } from "@tokenring-ai/agent/types";
import TelegramBot = require('node-telegram-bot-api');
import { z } from "zod";

export const TelegramServiceConfigSchema = z.object({
  botToken: z.string().min(1, "Bot token is required"),
  chatId: z.string().optional(),
  authorizedUserIds: z.array(z.string()).optional(),
  defaultAgentType: z.string().optional()
});

export type TelegramServiceConfig = z.infer<typeof TelegramServiceConfigSchema>;

export default class TelegramService implements TokenRingService {
  name = "TelegramService";
  description = "Provides a Telegram bot for interacting with TokenRing agents.";
  private running = false;
  private botToken: string;
  private chatId?: string;
  private authorizedUserIds: string[] = [];
  private defaultAgentType: string;
  private bot: TelegramBot | null = null;
  private agentTeam: AgentTeam | null = null;
  private userAgents = new Map<string, Agent>();

  constructor({ botToken, chatId, authorizedUserIds, defaultAgentType }: TelegramServiceConfig) {
    if (!botToken) {
      throw new Error("TelegramBotService requires a botToken.");
    }
    this.botToken = botToken;
    this.chatId = chatId;
    this.authorizedUserIds = authorizedUserIds || [];
    this.defaultAgentType = defaultAgentType || "teamLeader";
  }

  private async getOrCreateAgentForUser(userId: string): Promise<Agent> {
    if (!this.userAgents.has(userId)) {
      const agent = await this.agentTeam!.createAgent(this.defaultAgentType);
      this.userAgents.set(userId, agent);
    }
    return this.userAgents.get(userId)!;
  }

  async start(agentTeam: AgentTeam): Promise<void> {
    this.running = true;
    this.agentTeam = agentTeam;

    this.bot = new TelegramBot(this.botToken, { polling: false });

    // Set up message handler
    this.bot.on('message', async (msg: any) => {
      try {
        const userId = msg.from?.id?.toString();
        const chatId = msg.chat.id;
        const text = msg.text || '';

        if (!userId || !text.trim()) return;

        if (this.authorizedUserIds.length > 0 && !this.authorizedUserIds.includes(userId)) {
          await this.bot!.sendMessage(chatId, "Sorry, you are not authorized to use this bot.");
          return;
        }

        this.chatId = chatId.toString();
        const agent = await this.getOrCreateAgentForUser(userId);
        let response = "";

        for await (const event of agent.events(new AbortController().signal)) {
          if (event.type === 'output.chat') {
            response += event.data.content;
          } else if (event.type === 'output.system') {
            response += `\n[${event.data.level.toUpperCase()}]: ${event.data.message}\n`;
          } else if (event.type === 'state.idle') {
            if (response) {
              await this.bot!.sendMessage(chatId, response);
              break;
            }
            await agent.handleInput({ message: text });
            response = "";
          }
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
    this.bot.startPolling({ restart: true });

    if (this.chatId) {
      await this.bot.sendMessage(this.chatId, "Telegram bot is online!");
    }
  }

  async stop(agentTeam: AgentTeam): Promise<void> {
    this.running = false;
    
    // Clean up all user agents
    for (const [userId, agent] of this.userAgents.entries()) {
      await agentTeam.deleteAgent(agent);
    }
    this.userAgents.clear();

    if (this.bot) {
      try {
        this.bot.stopPolling();
      } catch (error) {
        console.error('Error stopping polling:', error);
      }
      this.bot = null;
    }
  }
}
