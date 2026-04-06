import z from "zod";

export const TelegramEscalationBotConfigSchema = z.object({
  group: z.string(),
});

export const TelegramBotConfigSchema = z.object({
  name: z.string(),
  botToken: z.string().min(1, "Bot token is required"),
  joinMessage: z.string().optional(),
  maxPhotoPixels: z.number().default(1_000_000),
  maxFileSize: z.number().default(20_971_520), // 20MB default (Telegram's limit for bots)
  maxDocumentSize: z.number().default(10_485_760), // 10MB default for documents
  groups: z.record(z.string(), z.object({
    groupId: z.number().max(0, "Group ID must be a negative number"),
    allowedUsers: z.array(z.number()).default([]),
    agentType: z.string(),
  })),
  dmAgentType: z.string(),
  dmAllowedUsers: z.array(z.number()).default([]),
  commandMapping: z.record(z.string(), z.string()).default({
    "/reset": "/chat reset",
  }),
  escalation: TelegramEscalationBotConfigSchema.optional(),
});

export type ParsedTelegramBotConfig = z.output<typeof TelegramBotConfigSchema>;

export const TelegramServiceConfigSchema = z.object({
  bots: z.record(z.string(), TelegramBotConfigSchema).default({}),
});
export type ParsedTelegramServiceConfig = z.output<typeof TelegramServiceConfigSchema>;


export const TelegramEscalationProviderConfigSchema = z.object({
  type: z.literal('telegram'),
  bot: z.string(),
  group: z.string(),
});

export type ParsedTelegramEscalationProviderConfig = z.output<typeof TelegramEscalationProviderConfigSchema>;
export type ParsedTelegramEscalationBotConfig = z.output<typeof TelegramEscalationBotConfigSchema>;