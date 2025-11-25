# @tokenring-ai/telegram

A Token Ring plugin providing Telegram integration for AI-powered bot interactions.

## Overview

This package provides a Telegram bot service that integrates with TokenRing agents, enabling natural language conversations through Telegram. Each user gets their own persistent agent instance that maintains conversation history and context.

## Features

- **Per-User Agents**: Each Telegram user gets a dedicated agent with persistent chat history
- **Direct Messages**: Private conversations with the bot via Telegram
- **Authorization**: Optional user whitelist for restricted access
- **Event-Driven Communication**: Handles agent events and sends responses back to Telegram
- **Automatic Agent Management**: Creates and manages agents for each user automatically
- **Error Handling**: Robust error handling with user-friendly error messages

## Prerequisites

- Telegram bot token from [@BotFather](https://t.me/botfather)
- Node.js environment with ES modules support

## Installation

```bash
npm install @tokenring-ai/telegram
# or
yarn add @tokenring-ai/telegram
# or
bun add @tokenring-ai/telegram
```

## Dependencies

- `@tokenring-ai/agent` ^0.1.0 - Agent management and core functionality
- `@tokenring-ai/chat` ^0.1.0 - Chat integration
- `node-telegram-bot-api` ^0.66.0 - Telegram bot API
- `@types/node-telegram-bot-api` ^0.64.12 - TypeScript definitions (dev dependency)

## Configuration

The package uses Zod schema validation for configuration. Here are the available configuration options:

### Required

- **`botToken`** (string): Telegram bot token obtained from [@BotFather](https://t.me/botfather)

### Optional

- **`chatId`** (string): Chat ID for startup announcements. If provided, the bot will send a "Telegram bot is online!" message to this chat when started.
- **`authorizedUserIds`** (string[]): Array of user IDs allowed to interact with the bot. If empty, all users can interact.
- **`defaultAgentType`** (string): Default agent type to create for users (defaults to "teamLeader").

## Usage

### Basic Setup

```typescript
import TelegramService from '@tokenring-ai/telegram';
import { TokenRingApp } from '@tokenring-ai/app';

const app = new TokenRingApp({
  // Your app configuration
});

// Configure the Telegram service
const telegramConfig = {
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  chatId: process.env.TELEGRAM_CHAT_ID, // Optional
  authorizedUserIds: ['123456789', '987654321'], // Optional
  defaultAgentType: 'teamLeader' // Optional
};

// Install as a plugin
app.install({
  name: '@tokenring-ai/telegram',
  version: '1.0.0',
  description: 'A Token Ring plugin providing Telegram integration.',
  install(app: TokenRingApp) {
    const telegramConfig = app.getConfigSlice("telegram", TelegramServiceConfigSchema.optional());
    if (telegramConfig) {
      app.addServices(new TelegramService(app, telegramConfig));
    }
  }
});

// Start the application
await app.start();
```

### Manual Service Creation

```typescript
import TelegramService, { TelegramServiceConfigSchema } from '@tokenring-ai/telegram';
import { TokenRingApp } from '@tokenring-ai/app';

const app = new TokenRingApp({
  // Your app configuration
});

const config: TelegramServiceConfig = {
  botToken: 'your-bot-token-here',
  chatId: 'your-chat-id', // Optional
  authorizedUserIds: ['user1', 'user2'], // Optional
  defaultAgentType: 'teamLeader'
};

const telegramService = new TelegramService(app, config);
app.addServices(telegramService);

await telegramService.start();
```

## Getting Started

### 1. Create a Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Use `/newbot` command to create a new bot
3. Follow the prompts to set up your bot name and username
4. BotFather will provide you with a bot token

### 2. Get Your Chat ID

Send a message to your bot, then visit:
```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
```

The response will contain your chat ID in the `chat` object.

### 3. Set Up Environment Variables

```bash
TELEGRAM_BOT_TOKEN=your-bot-token-here
TELEGRAM_CHAT_ID=your-chat-id
TELEGRAM_AUTHORIZED_USER_IDS=123456789,987654321
```

## API Reference

### Exports

- **`default`** - The plugin object for use with TokenRingApp
- **`TelegramService`** - The main service class
- **`TelegramServiceConfigSchema`** - Zod schema for configuration validation
- **`TelegramServiceConfig`** - TypeScript type for configuration

### TelegramService Class

#### Constructor

```typescript
new TelegramService(app: TokenRingApp, config: TelegramServiceConfig)
```

#### Methods

- **`start()`**: Starts the Telegram bot and begins polling for messages
- **`stop()`**: Stops the bot and cleans up all user agents

### Configuration Schema

```typescript
export const TelegramServiceConfigSchema = z.object({
  botToken: z.string().min(1, "Bot token is required"),
  chatId: z.string().optional(),
  authorizedUserIds: z.array(z.string()).optional(),
  defaultAgentType: z.string().optional()
});

export type TelegramServiceConfig = z.infer<typeof TelegramServiceConfigSchema>;
```

## Event Handling

The service handles the following agent events:

- **`output.chat`**: Accumulates chat content for response
- **`output.system`**: Formats system messages with level indicators
- **`state.idle`**: Sends accumulated response and handles new input

## Security Considerations

- **Bot Token Security**: Never commit your bot token to version control
- **User Authorization**: Use `authorizedUserIds` to restrict bot access to specific users
- **Error Handling**: The service includes error handling to prevent crashes from malformed messages

## Troubleshooting

### Common Issues

1. **"Bot token is required" error**: Ensure you've provided a valid bot token
2. **"Not authorized" message**: Add your user ID to `authorizedUserIds` or remove the restriction
3. **Bot not responding**: Check that the bot is started and polling is enabled

### Debug Information

Enable debug logging to see detailed information about bot operations:

```typescript
import { setLogLevel } from '@tokenring-ai/utility';

setLogLevel('debug');
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Support

For issues and questions, please open an issue in the TokenRing repository.