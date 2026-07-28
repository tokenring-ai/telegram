import type TokenRingApp from "@tokenring-ai/app";
import type { TokenRingService } from "@tokenring-ai/app/types";
import { BotService } from "@tokenring-ai/bot";
import { deepEqual } from "@tokenring-ai/one-frontend/src/lib/utils";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import type { ResolvedTelegramServiceConfig } from "./schema.ts";
import TelegramMessagingProvider from "./TelegramMessagingProvider.ts";

/**
 * Connects the configured Telegram accounts and registers each one with the
 * bot service, where it becomes the `telegram`-style prefix of a
 * `service:userId` target.
 */
export default class TelegramService implements TokenRingService {
  readonly name = "TelegramService";
  description = "Connects Telegram bot accounts to the bot service.";

  private providers = new KeyedRegistry<TelegramMessagingProvider>();
  private options: ResolvedTelegramServiceConfig = { accounts: {} };

  getAvailableAccounts = this.providers.keysArray;
  getProvider = this.providers.get;

  constructor(private app: TokenRingApp) {}

  async reconfigure(options: ResolvedTelegramServiceConfig) {
    const botService = this.app.requireService(BotService);

    await this.providers.reconcileAgainstAsync(this.options.accounts, {
      creating: async (accountName, accountConfig) => {
        const provider = new TelegramMessagingProvider(this.app, this, accountName, accountConfig);
        this.app.serviceOutput(this, `Creating Telegram account ${accountName}`);
        await provider.start();
        botService.registerProvider(accountName, provider);
        return provider;
      },
      deleting: async (accountName, provider) => {
        this.app.serviceOutput(this, `Stopping Telegram account ${accountName}`);
        botService.unregisterProvider(accountName);
        await provider.stop();
      },
      updating: async (accountName, provider, accountConfig) => {
        if (deepEqual(this.options.accounts[accountName], accountConfig)) return provider;

        // Token/config changes require a reconnect.
        botService.unregisterProvider(accountName);
        await provider.stop();
        const next = new TelegramMessagingProvider(this.app, this, accountName, accountConfig);
        await next.start();
        botService.registerProvider(accountName, next);
        this.providers.set(accountName, next);
        return next;
      },
    });
    this.options = options;
  }

  async stop(): Promise<void> {
    const botService = this.app.requireService(BotService);
    for (const [accountName, provider] of this.providers.entriesArray()) {
      botService.unregisterProvider(accountName);
      await provider.stop();
      this.providers.unregister(accountName);
    }
  }
}
