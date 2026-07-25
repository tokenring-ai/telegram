import type { TokenRingPlugin } from "@tokenring-ai/app";
import { EscalationService } from "@tokenring-ai/escalation";
import { requireSecret } from "@tokenring-ai/secrets/SecretService";
import { z } from "zod";
import { TelegramEscalationProvider } from "./index.ts";
import packageJSON from "./package.json" with { type: "json" };
import { type ResolvedTelegramBotConfig, TelegramServiceConfigSchema } from "./schema.ts";
import TelegramService from "./TelegramService.ts";

const packageConfigSchema = z.object({
  telegram: TelegramServiceConfigSchema.prefault({ bots: {} }),
});

export default {
  name: packageJSON.name,
  displayName: "Telegram Integration",
  version: packageJSON.version,
  description: packageJSON.description,
  install(app, config) {
    const bots = Object.entries(config.telegram.bots);
    if (bots.length === 0) return;

    // Resolve up front so a misconfigured token fails at boot, not on first message.
    const resolvedBots: Record<string, ResolvedTelegramBotConfig> = {};
    for (const [botName, bot] of bots) {
      resolvedBots[botName] = { ...bot, botToken: requireSecret(app, bot.botToken, `Telegram bot "${botName}" bot token`) };
    }

    app.addServices(new TelegramService(app, { bots: resolvedBots }));

    app.waitForService(EscalationService, escalationService => {
      for (const [botName, bot] of Object.entries(config.telegram.bots)) {
        if (bot.escalation) {
          escalationService.registerProvider(
            botName,
            new TelegramEscalationProvider({
              type: "telegram",
              bot: botName,
              group: bot.escalation.group,
            }),
          );
        }
      }
    });
  },
  configSchema: packageConfigSchema,
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
