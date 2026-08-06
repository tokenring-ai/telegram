import { CommandFailedError } from "@tokenring-ai/agent/AgentError";
import type { AgentCommandInputSchema, AgentCommandInputType, TokenRingAgentCommand } from "@tokenring-ai/agent/types";
import { type ConfigLayer, ConfigurationService } from "@tokenring-ai/app";

const inputSchema = {
  args: {
    name: {
      description: "The name to save the Telegram account under",
      type: "string",
      defaultValue: "telegram",
    },
    save: {
      description: "Where to save the Telegram account configuration",
      type: "enum",
      values: ["global", "workspace"],
      defaultValue: "workspace",
    },
  },
  positionals: [
    {
      name: "botToken",
      description: "The Telegram bot token issued by BotFather",
      required: false,
    },
  ],
} as const satisfies AgentCommandInputSchema;

export default {
  name: "connect telegram",
  alias: "telegram connect",
  description: "Connects a Telegram bot account",
  inputSchema,
  execute: async ({ agent, args: { botToken, name, save } }: AgentCommandInputType<typeof inputSchema>): Promise<string> => {
    if (!agent.headless && !botToken) {
      botToken =
        (await agent.askForText({
          message: "What is the bot token for the Telegram account you want to connect?",
          label: "Bot Token",
          masked: true,
        })) ?? undefined;
    }

    if (!botToken) throw new CommandFailedError("Usage: /connect telegram <botToken>");

    const configService = agent.requireService(ConfigurationService);
    const overrides = configService.getOverrides(save);
    const telegram = (overrides.telegram ?? {}) as { accounts?: Record<string, unknown> };
    const accounts = telegram.accounts ?? {};
    const existingAccount = (accounts[name] ?? {}) as Record<string, unknown>;
    const next = {
      ...overrides,
      telegram: {
        ...telegram,
        accounts: {
          ...accounts,
          [name]: {
            ...existingAccount,
            botToken,
          },
        },
      },
    } satisfies ConfigLayer;

    const result = await configService.apply(save, next);
    if (!result.ok) {
      throw new CommandFailedError(result.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("\n"));
    }

    return `Telegram account "${name}" connected.`;
  },
  help: `Connect a Telegram bot account and save its token in the configuration.

When run interactively, the token is requested using a masked prompt.

## Example

/connect telegram --name=telegram`,
} satisfies TokenRingAgentCommand<typeof inputSchema>;
