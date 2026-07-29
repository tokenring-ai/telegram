import { AgentCommandService } from "@tokenring-ai/agent";
import type { TokenRingPlugin } from "@tokenring-ai/app";
import { requireSecret } from "@tokenring-ai/secrets/SecretService";
import { z } from "zod";
import agentCommands from "./commands.ts";
import packageJSON from "./package.json" with { type: "json" };
import { type ResolvedTelegramAccountConfig, TelegramServiceConfigSchema } from "./schema.ts";
import TelegramService from "./TelegramService.ts";

const packageConfigSchema = z.object({
  telegram: TelegramServiceConfigSchema.prefault({ accounts: {} }),
});

export default {
  name: packageJSON.name,
  displayName: "Telegram Integration",
  version: packageJSON.version,
  description: packageJSON.description,
  install(app) {
    app.addServices(new TelegramService(app));
    app.waitForService(AgentCommandService, commandService => {
      commandService.addAgentCommands(agentCommands);
    });
  },
  async reconfigure(app, config) {
    // Resolve up front so a misconfigured token fails at configure, not on first message.
    const resolvedAccounts: Record<string, ResolvedTelegramAccountConfig> = {};
    for (const [accountName, account] of Object.entries(config.telegram.accounts)) {
      resolvedAccounts[accountName] = {
        ...account,
        botToken: requireSecret(app, account.botToken, `Telegram account "${accountName}" bot token`),
      };
    }

    await app.requireService(TelegramService).reconfigure({ accounts: resolvedAccounts });
  },
  configSchema: packageConfigSchema,
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
