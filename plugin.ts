import {TokenRingPlugin} from "@tokenring-ai/app";
import {EscalationService} from "@tokenring-ai/escalation";
import GroupEscalationProvider from "@tokenring-ai/escalation/GroupEscalationProvider";
import {EscalationServiceConfigSchema, GroupEscalationProviderConfigSchema} from "@tokenring-ai/escalation/schema";
import {z} from "zod";
import {TelegramEscalationProvider} from "./index.ts";
import packageJSON from './package.json' with {type: 'json'};
import {TelegramEscalationProviderConfigSchema, TelegramServiceConfigSchema} from "./schema.ts";
import TelegramService from "./TelegramService.ts";

const packageConfigSchema = z.object({
  telegram: TelegramServiceConfigSchema.optional(),
  escalation: EscalationServiceConfigSchema.optional()
});

export default {
  name: packageJSON.name,
  version: packageJSON.version,
  description: packageJSON.description,
  install(app, config) {
    if (config.telegram) {
      app.addServices(new TelegramService(app, config.telegram));
      if (config.escalation) {
        app.waitForService(EscalationService, escalationService => {
          for (const [providerName, provider] of Object.entries(config.escalation!.providers)) {
            if (provider.type === 'telegram') {
              escalationService.registerProvider(providerName, new TelegramEscalationProvider(TelegramEscalationProviderConfigSchema.parse(provider)));
            }
          }
        })
      }
    }
  },
  config: packageConfigSchema
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
