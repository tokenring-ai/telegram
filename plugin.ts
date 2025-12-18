import TokenRingApp from "@tokenring-ai/app";
import {TokenRingPlugin} from "@tokenring-ai/app";
import packageJSON from './package.json' with {type: 'json'};
import TelegramService, {TelegramServiceConfigSchema} from "./TelegramService.ts";


export default {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(app: TokenRingApp) {
    const telegramConfig = app.getConfigSlice("telegram", TelegramServiceConfigSchema.optional());

    if (telegramConfig) {
      app.addServices(new TelegramService(app, telegramConfig));
    }
  },
} satisfies TokenRingPlugin;
