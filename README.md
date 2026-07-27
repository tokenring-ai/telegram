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
- **Attachments**: photos and documents are fetched and passed to the agent, within configurable size limits

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
      maxDocumentSize: 10485760
```

| Option            | Type     | Default      | Description                                          |
|-------------------|----------|--------------|------------------------------------------------------|
| `botToken`        | `secret` | required     | Telegram bot token from BotFather                    |
| `maxPhotoPixels`  | `number` | `1000000`    | Largest photo, in pixels, fetched from Telegram      |
| `maxDocumentSize` | `number` | `10485760`   | Largest document, in bytes, fetched from Telegram    |

Then point a bot at it:

```yaml
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

Group chat ids are negative numbers. The easiest way to find one is to add the bot to the group and read the id from
the service log when a message arrives.

### ENV Variables

This package does not read environment variables directly — point `botToken` at one with
`{ source: env, env: ... }`.

## Chat Commands

This package does not define any chat commands. See `@tokenring-ai/bot` for `/message` and `/bots`.

## Tools

This package does not define any tools.

## License

MIT License - see LICENSE file for details.

---

## Developer Reference

### TelegramService

Connects every configured account at startup and registers each one with `BotService` under its account name.
Disconnects and deregisters them on shutdown.

| Method                    | Description                          |
|---------------------------|--------------------------------------|
| `getAvailableAccounts()`  | Names of the connected accounts      |
| `getProvider(name)`       | The provider for an account          |

### TelegramMessagingProvider

Implements `MessagingProvider` from `@tokenring-ai/bot` for one bot account:

- `maxMessageLength` is 4090, just under Telegram's 4096 limit
- `resolveConversation` is the identity function — Telegram chat ids address users and groups alike
- `sendMessage` posts Markdown, falling back to plain text when Telegram cannot parse the entities
- `updateMessage` edits in place, with the same fallback, and treats "message is not modified" as success
- inbound messages are marked `addressed` when they are a DM, mention the bot's `@username`, or reply to one of its
  messages

### Package Structure

```text
plugin/telegram/
├── index.ts                       # Main exports
├── plugin.ts                      # Plugin definition for TokenRing integration
├── TelegramService.ts             # Connects accounts, registers them with BotService
├── TelegramMessagingProvider.ts   # The Telegram transport
├── fetchTelegramFile.ts           # File download helper
├── schema.ts                      # Configuration schemas
└── LICENSE                        # MIT License
```

### Dependencies

| Package                    | Description                       |
|----------------------------|-----------------------------------|
| `@tokenring-ai/bot`        | Bot service and provider contract |
| `@tokenring-ai/agent`      | Attachment types                  |
| `@tokenring-ai/app`        | Application framework             |
| `@tokenring-ai/secrets`    | Secret resolution                 |
| `node-telegram-bot-api`    | Telegram Bot API client           |
