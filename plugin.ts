import {TokenRingPlugin} from "@tokenring-ai/app";
import {z} from "zod";
import packageJSON from './package.json' with {type: 'json'};
import TelegramService, {TelegramServiceConfigSchema} from "./TelegramService.ts";

const packageConfigSchema = z.object({
  telegram: TelegramServiceConfigSchema.optional()
});

export default {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(app, config) {
    if (config.telegram) {
      app.addServices(new TelegramService(app, config.telegram));
    }
  },
  config: packageConfigSchema
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
