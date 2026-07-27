import type TokenRingApp from "@tokenring-ai/app";
import type { TokenRingService } from "@tokenring-ai/app/types";
import { BotService } from "@tokenring-ai/bot";
import waitForAbort from "@tokenring-ai/utility/promise/waitForAbort";
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

  getAvailableAccounts = this.providers.keysArray;
  getProvider = this.providers.get;

  constructor(
    private app: TokenRingApp,
    private options: ResolvedTelegramServiceConfig,
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    const botService = this.app.requireService(BotService);

    this.app.serviceOutput(this, "Connecting Telegram accounts...");

    for (const [accountName, accountConfig] of Object.entries(this.options.accounts)) {
      const provider = new TelegramMessagingProvider(this.app, this, accountName, accountConfig);
      await provider.start();

      this.providers.set(accountName, provider);
      botService.registerProvider(accountName, provider);
    }

    return waitForAbort(signal, async () => {
      for (const [accountName, provider] of this.providers.entriesArray()) {
        botService.unregisterProvider(accountName);
        await provider.stop();
        this.providers.unregister(accountName);
      }
    });
  }
}
