import type { TokenRingPlugin } from "@tokenring-ai/app";
import { requireSecret } from "@tokenring-ai/secrets/SecretService";
import { z } from "zod";
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
  install(app, config) {
    const accounts = Object.entries(config.telegram.accounts);
    if (accounts.length === 0) return;

    // Resolve up front so a misconfigured token fails at boot, not on first message.
    const resolvedAccounts: Record<string, ResolvedTelegramAccountConfig> = {};
    for (const [accountName, account] of accounts) {
      resolvedAccounts[accountName] = {
        ...account,
        botToken: requireSecret(app, account.botToken, `Telegram account "${accountName}" bot token`),
      };
    }

    app.addServices(new TelegramService(app, { accounts: resolvedAccounts }));
  },
  configSchema: packageConfigSchema,
} satisfies TokenRingPlugin<typeof packageConfigSchema>;
