import type TokenRingApp from "@tokenring-ai/app";
import type { TokenRingService } from "@tokenring-ai/app/types";
import waitForAbort from "@tokenring-ai/utility/promise/waitForAbort";
import KeyedRegistry from "@tokenring-ai/utility/registry/KeyedRegistry";
import type { ParsedTelegramServiceConfig } from "./schema.ts";
import TelegramBot from "./TelegramBot.ts";

export default class TelegramService implements TokenRingService {
  readonly name = "TelegramService";
  description = "Manages multiple Telegram bots for interacting with TokenRing agents.";

  private bots = new KeyedRegistry<TelegramBot>();

  getAvailableBots = this.bots.keysArray;
  getBot = this.bots.get;

  constructor(
    private app: TokenRingApp,
    private options: ParsedTelegramServiceConfig,
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    this.app.serviceOutput(this, "Starting Telegram bots...");

    for (const [botName, botConfig] of Object.entries(this.options.bots)) {
      const bot = new TelegramBot(this.app, this, botName, botConfig);
      await bot.start();

      this.bots.set(botName, bot);
    }

    return waitForAbort(signal, async () => {
      for (const [botName, bot] of this.bots.entriesArray()) {
        await bot.stop();
        this.bots.unregister(botName);
      }
    });
  }
}
