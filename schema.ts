import z from "zod";

export const TelegramBotConfigSchema = z.object({
  name: z.string(),
  botToken: z.string().min(1, "Bot token is required"),
  joinMessage: z.string().optional(),
  groups: z.record(z.string(), z.object({
    groupId: z.number().max(0, "Group ID must be a negative number"),
    allowedUsers: z.array(z.string()).default([]),
    agentType: z.string(),
  }))
});

export type ParsedTelegramBotConfig = z.output<typeof TelegramBotConfigSchema>;

export const TelegramServiceConfigSchema = z.object({
  bots: z.record(z.string(),TelegramBotConfigSchema)
});
export type ParsedTelegramServiceConfig = z.output<typeof TelegramServiceConfigSchema>;


export const TelegramEscalationProviderConfigSchema = z.object({
  type: z.literal('telegram'),
  bot: z.string(),
  group: z.string(),
});

export type ParsedTelegramEscalationProviderConfig = z.output<typeof TelegramEscalationProviderConfigSchema>;