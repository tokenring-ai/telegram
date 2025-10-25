import {AgentTeam, TokenRingPackage} from "@tokenring-ai/agent";
import packageJSON from './package.json' with {type: 'json'};
import TelegramService, {TelegramServiceConfigSchema} from "./TelegramService.ts";

export default {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(agentTeam: AgentTeam) {
    const telegramConfig = agentTeam.getConfigSlice("telegram", TelegramServiceConfigSchema.optional());

    if (telegramConfig) {
      agentTeam.addServices(new TelegramService(telegramConfig));
    }
  },
} as TokenRingPackage;

export {default as TelegramBotService} from "./TelegramService.ts";
