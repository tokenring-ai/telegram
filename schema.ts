import z from "zod";

export const TelegramServiceConfigSchema = z.object({
  botToken: z.string().min(1, "Bot token is required"),
  chatId: z.string().optional(),
  authorizedUserIds: z.array(z.string()).default([]),
  defaultAgentType: z.string()
});
export type ParsedTelegramServiceConfig = z.output<typeof TelegramServiceConfigSchema>;