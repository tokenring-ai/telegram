import type {TokenRingPlugin} from "@tokenring-ai/app";
import {EscalationService} from "@tokenring-ai/escalation";
import {z} from "zod";
import {TelegramEscalationProvider} from "./index.ts";
import packageJSON from "./package.json" with {type: "json"};
import {type ParsedTelegramBotConfig, TelegramServiceConfigSchema} from "./schema.ts";
import TelegramService from "./TelegramService.ts";

const packageConfigSchema = z.object({
  telegram: TelegramServiceConfigSchema.prefault({bots: {}}),
});

function addBotsFromEnv(
  bots: Record<string, Partial<ParsedTelegramBotConfig>>,
) {
  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(/^TELEGRAM_BOT_TOKEN(\d*)$/);
    if (!match || !value) continue;
    const n = match[1];
    const dmAgentType = process.env[`TELEGRAM_DM_AGENT${n}`];
    if (!dmAgentType) continue;
    const name =
      process.env[`TELEGRAM_BOT_NAME${n}`] ?? `Telegram Bot${n ? ` ${n}` : ""}`;

    const escalationGroup = process.env[`TELEGRAM_ESCALATION_GROUP${n}`];

    bots[name] = {
      name,
      botToken: value,
      dmAgentType,
      escalation: escalationGroup
        ? {group: escalationGroup}
        : undefined,
      groups: {},
    };
  }
}

export default {
  name: packageJSON.name,
  displayName: "Telegram Integration",
  version: packageJSON.version,
  description: packageJSON.description,
  install(app, config) {
    addBotsFromEnv(config.telegram.bots);
    if (Object.keys(config.telegram.bots).length === 0) return;

    app.addServices(
      new TelegramService(
        app,
        TelegramServiceConfigSchema.parse(config.telegram),
      ),
    );

    app.waitForService(EscalationService, (escalationService) => {
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
  config: packageConfigSchema,
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
