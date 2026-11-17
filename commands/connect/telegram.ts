import { CommandFailedError } from "@tokenring-ai/agent/AgentError";
import type { AgentCommandInputSchema, AgentCommandInputType, TokenRingAgentCommand } from "@tokenring-ai/agent/types";
import { type ConfigLayer, ConfigurationService } from "@tokenring-ai/app";
import SecretService from "@tokenring-ai/secrets/SecretService";
import { accountCredentialRef, saveToVaultThen, VAULT_LOCKED_MESSAGE } from "@tokenring-ai/secrets/vaultCredentials";

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
      description: "The Telegram bot token issued by BotFather. Typed inline it stays in the chat history; omit it to use a masked prompt",
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
    const secrets = agent.requireService(SecretService);
    if (!secrets.canStore()) throw new CommandFailedError(VAULT_LOCKED_MESSAGE);

    if (!botToken) {
      botToken =
        (await agent.askForText({
          message: "What is the bot token for the Telegram account you want to connect?",
          label: "Bot Token",
          masked: true,
        })) ?? undefined;
    }

    if (!botToken) throw new CommandFailedError("Usage: /connect telegram <botToken>");

    const ref = accountCredentialRef("telegram", name, "botToken");
    const configService = agent.requireService(ConfigurationService);
    await saveToVaultThen(secrets, [[ref, botToken]], async () => {
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
              botToken: ref,
            },
          },
        },
      } satisfies ConfigLayer;

      const result = await configService.apply(save, next);
      if (!result.ok) {
        throw new CommandFailedError(result.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("\n"));
      }
    });

    return `Telegram account "${name}" connected. Its bot token is in the vault under telegram/${name}.botToken.`;
  },
  help: `Connect a Telegram bot account. The bot token is saved in the vault (category
"telegram", key "<name>.botToken"), and the configuration only references it. The vault
must be unlocked.

When run interactively, the token is requested using a masked prompt. Passing it as an
argument also works (where nobody can answer the prompt), but then it stays in the chat history.

## Example

/connect telegram --name=telegram`,
} satisfies TokenRingAgentCommand<typeof inputSchema>;
