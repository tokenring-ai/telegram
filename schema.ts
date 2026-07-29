import type { ConfigFieldMeta } from "@tokenring-ai/app/config/metadata";
import { secret, type WithResolvedSecrets } from "@tokenring-ai/secrets/secret";
import z from "zod";

/**
 * A Telegram bot account. What the account *does* — who may talk to it, which
 * groups it sits in, which agent answers — is configured on the bot that uses
 * it, in the `bot` plugin.
 */
export const TelegramAccountConfigSchema = z.object({
  botToken: secret({ description: "Telegram bot token" }),
  maxPhotoPixels: z
    .number()
    .default(1_000_000)
    .meta({ advanced: true, description: "Largest photo, in pixels, fetched from Telegram" } satisfies ConfigFieldMeta),
  maxFileSize: z
    .number()
    .default(20_971_520)
    .meta({
      advanced: true,
      description: "Largest file, in bytes, fetched from Telegram. Telegram itself refuses to serve a bot more than 20MB",
    } satisfies ConfigFieldMeta),
  maxDocumentSize: z
    .number()
    .default(10_485_760)
    .meta({ advanced: true, description: "Largest document, in bytes, fetched from Telegram" } satisfies ConfigFieldMeta),
});

export type ParsedTelegramAccountConfig = z.output<typeof TelegramAccountConfigSchema>;

/** An account as handed to the service, with its token secret already resolved. */
export type ResolvedTelegramAccountConfig = WithResolvedSecrets<ParsedTelegramAccountConfig, "botToken">;

export const TelegramServiceConfigSchema = z
  .object({
    accounts: z
      .record(z.string(), TelegramAccountConfigSchema)
      .default({})
      .meta({ label: "Accounts", description: "Telegram bot accounts, keyed by the service name bots address them by" } satisfies ConfigFieldMeta),
  })
  .meta({ label: "Telegram", description: "Telegram bot accounts" } satisfies ConfigFieldMeta);

export type ParsedTelegramServiceConfig = z.output<typeof TelegramServiceConfigSchema>;

/** Service config with every account's secrets resolved. */
export type ResolvedTelegramServiceConfig = { accounts: Record<string, ResolvedTelegramAccountConfig> };
