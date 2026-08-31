# @tokenring-ai/telegram

## Overview

Telegram transport for TokenRing bots. This package connects Telegram bot accounts and hands each one to
[`@tokenring-ai/bot`](../bot) as a messaging provider — it carries text and files to and from Telegram, and nothing
else.

Who a bot talks to, which groups it sits in, and which agent answers are configured on the bot, not here. See the
`@tokenring-ai/bot` README for that half.

### Key Features

- **Multiple accounts**: run any number of Telegram bot accounts side by side
- **Long polling**: no public webhook endpoint required
- **Markdown with fallback**: messages are sent as Markdown, retried as plain text if Telegram rejects the entities
- **Streaming edits**: messages are edited in place as an agent's response grows
- **Attachments**: photos and documents are fetched and passed to the agent, within configurable size limits — and only
  once a bot has decided to handle the message, so a busy group costs nothing
- **Group discovery**: being added to a group is reported to the bot service, which can join a bot to it automatically

## Installation

```bash
bun add @tokenring-ai/telegram
```

Create a bot with [@BotFather](https://t.me/botfather) to get a token. For group chats, disable BotFather's privacy
mode so the bot can see messages that mention it.

## Configuration

```yaml
telegram:
  accounts:
    telegram:                         # the service name bots address, e.g. telegram:123456789
      botToken: { source: env, env: TELEGRAM_BOT_TOKEN }
      maxPhotoPixels: 1000000
      maxFileSize: 20971520
      maxDocumentSize: 10485760

bot:
  bots:
    helper:
      agentType: assistant
      users:
        "telegram:123456789": admin
      channels:
        ops:
          target: telegram:-1001234567890
```

| Field             | Type     | Required | Default    | Description                                                        |
|-------------------|----------|----------|------------|--------------------------------------------------------------------|
| `botToken`        | `secret` | yes      | —          | Telegram bot token from BotFather                                  |
| `maxPhotoPixels`  | `number` | no       | `1000000`  | Largest photo, in pixels, fetched from Telegram                    |
| `maxFileSize`     | `number` | no       | `20971520` | Largest file, in bytes, fetched from Telegram                      |
| `maxDocumentSize` | `number` | no       | `10485760` | Largest document, in bytes, fetched from Telegram                  |

Account names are service names. A Telegram account named `telegram` therefore addresses users and groups as
`telegram:<chatId>`.

`botToken` is a secret reference resolved by `@tokenring-ai/secrets` before an account connects. It can be a literal
string in the config, `{ source: env, env: <name> }` to read an environment variable, or
`{ source: vault, category, key }` to read from the credential vault. This package does not read environment variables
itself — point `botToken` at one with `{ source: env, env: ... }`.

### Schema Metadata

The configuration schema carries these `.meta()` annotations for the config UI:

- `TelegramServiceConfigSchema` — `{ label: "Telegram", description: "Telegram bot accounts" }`
- `accounts` — `{ label: "Accounts", description: "Telegram bot accounts, keyed by the service name bots address them by" }`
- `accounts.<name>.botToken` — `secret({ description: "Telegram bot token" })` (marked secret and sensitive)
- `accounts.<name>.maxPhotoPixels` — `{ advanced: true, description: "Largest photo, in pixels, fetched from Telegram" }`
- `accounts.<name>.maxFileSize` — `{ advanced: true, description: "Largest file, in bytes, fetched from Telegram. Telegram itself refuses to serve a bot more than 20MB" }`
- `accounts.<name>.maxDocumentSize` — `{ advanced: true, description: "Largest document, in bytes, fetched from Telegram" }`

### Joining a group

A Telegram bot cannot add itself to a group — a person invites it. When that happens this package reports the group to
`@tokenring-ai/bot`, which lists it under "Discovered channels" in `/bots` and on the Bots dashboard. From there:

- run `/bots join helper telegram:-1001234567890`, or click **Join** on the dashboard, or
- set `joinPolicy` on the bot so it joins by itself when invited — see the `@tokenring-ai/bot` README.

Group chat ids are negative numbers, and are logged when the bot is added to a group or first sees traffic from one, so
you can also read one off the service log and write it into `channels` by hand.

Disable BotFather's privacy mode for the bot, or Telegram will not deliver it group messages that merely mention it.

### Forum topics

A bot joins a forum supergroup once, as `telegram:-1001234567890` — there is nothing to configure per topic. Each topic
then gets an agent of its own, so the release thread and the incidents thread do not share history, and every answer is
posted back into the topic that asked. Messages in a forum's General topic belong to the group itself.

Should you want a bot in one topic and nowhere else, address that topic directly as `telegram:<chatId>:<topicId>`; the
topic id is the `message_thread_id` Telegram shows in the `t.me/c/<chat>/<topic>` link.

## Chat Commands

| Command              | Description                          |
|----------------------|--------------------------------------|
| `/connect telegram`  | Connects a Telegram bot account      |

The command is also available as `/telegram connect`.

```text
/connect telegram <botToken> [--name=telegram] [--save=workspace]
```

- `<botToken>` is an optional positional. When run interactively without it, the token is requested with a masked
  prompt.
- `--name` names the account it is saved under (default `telegram`).
- `--save` chooses the config layer the account is written to: `global` (user configuration) or `workspace` (workspace
  configuration), default `workspace`.
- The token is merged into an existing account, preserving any other fields it already has.

## Tools

This package does not define any tools.

## License

MIT License — see LICENSE file for details.

---

## Developer Reference

### TelegramService

Connects every configured account and registers each one with `BotService` under its account name. Disconnects and
deregisters them on shutdown.

| Method                    | Description                                                                                                            |
|---------------------------|------------------------------------------------------------------------------------------------------------------------|
| `getAvailableAccounts()`  | Names of the connected accounts                                                                                        |
| `getProvider(name)`       | The provider for an account                                                                                            |
| `reconfigure(options)`    | Connects new accounts, stops removed ones, and reconnects accounts whose config changed, registering each with `BotService` |
| `stop()`                  | Unregisters and stops every connected account                                                                          |

`reconfigure` throws a `ConfigurationError` when accounts are configured but the `@tokenring-ai/bot` plugin is not
installed — there would be nothing to connect them to.

### TelegramMessagingProvider

Implements `MessagingProvider` from `@tokenring-ai/bot` for one bot account:

- `maxMessageLength` is 4090, just under Telegram's 4096 limit
- `start()` creates the Telegram Bot API client with long polling, calls `getMe()` to learn the bot's username and id,
  and registers the message, membership, and polling-error handlers
- `stop()` clears all handlers and stops polling
- `resolveConversation` is the identity function — Telegram chat ids address users and groups alike
- `sendMessage` posts Markdown, falling back to plain text when Telegram cannot parse the entities, and threads off
  `replyToMessageId` via `reply_parameters` when one is given
- `updateMessage` edits in place, with the same fallback, and treats "message is not modified" as success
- inbound messages are marked `addressed` when they are a DM, mention the bot's `@username`, or reply to one of its
  messages. The mention match is case insensitive and stops at a username boundary, so `@help` does not match inside
  `@helpdesk`, and the `@botname` Telegram appends to group commands is stripped so `/reset@helper_bot` reads as
  `/reset`. A `/cmd@another_bot` addressed to somebody else is dropped
- `attachments` is a fetcher, not a list: nothing is downloaded until a bot claims the message
- `onMembershipChange` reports `my_chat_member` updates as `via: "invite"`, and the first message out of a group the
  process was already in as `via: "observed"` — the latter never triggers an automatic join

### Plugin lifecycle

| Field          | Value                                                            |
|----------------|------------------------------------------------------------------|
| `name`         | `@tokenring-ai/telegram`                                         |
| `displayName`  | `Telegram Integration`                                           |
| `version`      | `0.2.0`                                                          |
| `description`  | `Telegram transport for TokenRing bots.`                         |
| `configSchema` | `z.object({ telegram: TelegramServiceConfigSchema.prefault({ accounts: {} }) })` |

- `install` — registers `TelegramService` and waits for `AgentCommandService` to register the `connect telegram` command.
- `reconfigure` — resolves every account's `botToken` secret via `requireSecret` and hands the resolved accounts to
  `TelegramService.reconfigure`, which connects, reconnects, or stops accounts as the configuration changes.

### Package Structure

```text
plugin/telegram/
├── index.ts                       # Main exports
├── plugin.ts                      # Plugin definition for TokenRing integration
├── TelegramService.ts             # Connects accounts, registers them with BotService
├── TelegramMessagingProvider.ts   # The Telegram transport
├── fetchTelegramFile.ts           # File download helper
├── commands.ts                    # Command exports
├── commands/
│   └── connect/telegram.ts        # /connect telegram command
├── schema.ts                      # Configuration schemas
├── bun.config.ts                  # Bun test configuration
├── package.json                   # Package manifest
└── LICENSE                        # MIT License
```

### Dependencies

| Package                    | Description                              |
|----------------------------|------------------------------------------|
| `@tokenring-ai/bot`        | Bot service and provider contract        |
| `@tokenring-ai/agent`      | Attachment types, agent commands         |
| `@tokenring-ai/app`        | Application framework and plugin types   |
| `@tokenring-ai/utility`    | `KeyedRegistry`, used by `TelegramService` |
| `@tokenring-ai/secrets`    | Secret resolution                        |
| `node-telegram-bot-api`    | Telegram Bot API client                  |
| `zod`                      | Configuration schema validation          |

### Testing

```bash
bun test
bun run build
```

This package does not currently ship any `*.test.ts` files; the test commands are defined for future coverage.
`bun run build` type-checks the package.
