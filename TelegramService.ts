import type TokenRingApp from "@tokenring-ai/app";
import { ConfigurationError, type TokenRingService } from "@tokenring-ai/app/types";
import { BotService } from "@tokenring-ai/bot";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import { deepEquals } from "bun";
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
  /**
   * The account config each live provider was started with. Reconciles compare against this
   * (not the last fully applied options), so a change that failed part-way is retried and a
   * revert to the running config is a no-op. An account whose provider is down has no entry,
   * so the next reconfigure (including a revert) re-creates it.
   */
  private providerConfigs = new Map<string, ResolvedTelegramServiceConfig["accounts"][string]>();

  getAvailableAccounts = this.providers.keysArray;
  getProvider = this.providers.get;

  constructor(private app: TokenRingApp) {}

  async reconfigure(options: ResolvedTelegramServiceConfig) {
    const botService = this.requireBotService();

    // Reconcile the live providers against the *incoming* accounts; `providerConfigs`
    // records what each one runs with, to spot which ones actually changed.
    await this.providers.reconcileAgainstAsync(options.accounts, {
      creating: async (accountName, accountConfig) => {
        this.app.serviceOutput(this, `Connecting Telegram account ${accountName}`);
        const provider = new TelegramMessagingProvider(this.app, this, accountName, accountConfig);
        await provider.start();
        botService.registerProvider(accountName, provider);
        this.providerConfigs.set(accountName, accountConfig);
        return provider;
      },
      deleting: async (accountName, provider) => {
        this.app.serviceOutput(this, `Stopping Telegram account ${accountName}`);
        botService.unregisterProvider(accountName);
        this.providerConfigs.delete(accountName);
        await provider.stop();
      },
      updating: async (accountName, provider, accountConfig) => {
        if (deepEquals(this.providerConfigs.get(accountName), accountConfig, true)) return provider;

        // Token/config changes require a reconnect. Telegram allows one long poll per bot token,
        // so unlike the other bot services the old provider must stop before the new one starts.
        this.app.serviceOutput(this, `Reconnecting Telegram account ${accountName}`);
        const previousConfig = this.providerConfigs.get(accountName);
        botService.unregisterProvider(accountName);
        this.providerConfigs.delete(accountName);
        await provider.stop();

        const next = new TelegramMessagingProvider(this.app, this, accountName, accountConfig);
        try {
          await next.start();
        } catch (error: unknown) {
          if (previousConfig) await this.restoreAccount(botService, accountName, previousConfig);
          throw error;
        }
        botService.registerProvider(accountName, next);
        this.providerConfigs.set(accountName, accountConfig);
        return next;
      },
    });
  }

  async stop(): Promise<void> {
    const botService = this.app.getService(BotService);
    for (const [accountName, provider] of this.providers.entriesArray()) {
      botService?.unregisterProvider(accountName);
      this.providers.unregister(accountName);
      this.providerConfigs.delete(accountName);
      await provider.stop();
    }
  }

  /**
   * After a failed reconnect, brings the account back on the config it ran with. If that fails
   * too, the stopped provider stays in the registry with no recorded config, so the next
   * reconfigure replaces it.
   */
  private async restoreAccount(botService: BotService, accountName: string, config: ResolvedTelegramServiceConfig["accounts"][string]): Promise<void> {
    const restored = new TelegramMessagingProvider(this.app, this, accountName, config);
    try {
      await restored.start();
    } catch (error: unknown) {
      this.app.serviceError(this, `Could not restore Telegram account ${accountName} on its previous config:`, error);
      return;
    }
    // The reconcile keeps its old (stopped) entry when the update throws; swap the live one in here.
    this.providers.set(accountName, restored);
    botService.registerProvider(accountName, restored);
    this.providerConfigs.set(accountName, config);
  }

  private requireBotService(): BotService {
    const botService = this.app.getService(BotService);
    if (!botService) {
      throw new ConfigurationError(
        this.name,
        "Telegram accounts are configured but the @tokenring-ai/bot plugin is not installed, so there is nothing to connect them to",
      );
    }
    return botService;
  }
}
