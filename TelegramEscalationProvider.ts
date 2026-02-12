import {Agent} from "@tokenring-ai/agent";
import type {CommunicationChannel, EscalationProvider} from "@tokenring-ai/escalation/EscalationProvider";
import type {ParsedTelegramEscalationProviderConfig} from "./schema.ts";
import TelegramService from "./TelegramService.ts";

export default class TelegramEscalationProvider implements EscalationProvider {
  constructor(readonly config: ParsedTelegramEscalationProviderConfig) {}
  async createCommunicationChannelWithUser(groupName: string, agent: Agent): Promise<CommunicationChannel> {
    const telegramService = agent.requireServiceByType(TelegramService);

    const bot = telegramService.getBot(this.config.bot);
    if (!bot) throw new Error(`Bot ${this.config.bot} not found`);

    return bot.createCommunicationChannelWithGroup(groupName);
  }
}