# @tokenring-ai/telegram

A TokenRing plugin providing Telegram bot integration for AI-powered agent interactions through Telegram.

## Overview

This package provides a Telegram bot service that integrates with TokenRing agents, enabling natural language conversations through Telegram. Each Telegram user gets their own dedicated agent instance that maintains conversation history and context. The service handles message routing, event processing, and automatic agent management.

## Features

- **Per-User Agents**: Each Telegram user gets a dedicated agent with persistent chat history
- **Event-Driven Communication**: Handles agent events and sends responses back to Telegram
- **Authorization**: User whitelist for restricted access control
- **Automatic Agent Management**: Creates and manages agents for each user automatically
- **Error Handling**: Robust error handling with user-friendly error messages
- **Timeout Management**: Configurable agent timeout handling
- **Graceful Shutdown**: Proper cleanup of all user agents on shutdown
- **Plugin Integration**: Seamless integration with TokenRing plugin system

## Installation

```bash
bun install @tokenring-ai/telegram
# or
yarn add @tokenring-ai/telegram
# or
bun add @tokenring-ai/telegram
```

## Configuration

The service uses Zod schema validation for configuration. Here are the available options:

### Required

- **`botToken`** (string): Telegram bot token obtained from [@BotFather](https://t.me/botfather)

### Optional

- **`chatId`** (string): Chat ID for startup announcements. If provided, the bot will send a "Telegram bot is online!" message when started.
- **`authorizedUserIds`** (string[]): Array of Telegram user IDs allowed to interact with the bot. If empty or undefined, all users can interact.
- **`defaultAgentType`** (string): Default agent type to create for users.

```typescript
export const TelegramServiceConfigSchema = z.object({
  botToken: z.string().min(1, "Bot token is required"),
  chatId: z.string().optional(),
  authorizedUserIds: z.array(z.string()).default([]),
  defaultAgentType: z.string()
});

export type TelegramServiceConfig = z.infer<typeof TelegramServiceConfigSchema>;
```

## Usage

### Plugin Installation

The recommended way to use the Telegram service is through the TokenRing plugin system:

```typescript
import TokenRingApp from '@tokenring-ai/app';
import telegramPlugin from '@tokenring-ai/telegram';

const app = new TokenRingApp({
  // Your app configuration
});

// Install the Telegram plugin
app.install(telegramPlugin);

// Configure via environment variables or app configuration
// TELEGRAM_BOT_TOKEN=your-bot-token
// TELEGRAM_CHAT_ID=your-chat-id (optional)
// TELEGRAM_AUTHORIZED_USER_IDS=123456789,987654321 (optional)
// TELEGRAM_DEFAULT_AGENT_TYPE=teamLeader (optional)

await app.start();
```

### Manual Service Creation

For more control, you can create the service manually:

```typescript
import TokenRingApp from '@tokenring-ai/app';
import {TelegramBotService} from '@tokenring-ai/telegram';
import {TelegramServiceConfigSchema} from '@tokenring-ai/telegram';

const app = new TokenRingApp({
  // Your app configuration
});

const config: TelegramServiceConfig = {
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  chatId: process.env.TELEGRAM_CHAT_ID,
  authorizedUserIds: ['123456789', '987654321'],
  defaultAgentType: 'teamLeader'
};

// Validate configuration
const validatedConfig = TelegramServiceConfigSchema.parse(config);

const telegramService = new TelegramBotService(app, validatedConfig);
app.addServices(telegramService);

await telegramService.run(signal);
```

## API Reference

### Exports

- **`default`** - Plugin object for TokenRingApp installation
- **`TelegramBotService`** - The main service class (note: exported as `TelegramBotService` from index.ts)
- **`TelegramServiceConfigSchema`** - Zod schema for configuration validation
- **`TelegramServiceConfig`** - TypeScript type for configuration

### TelegramBotService Class

#### Constructor

```typescript
constructor(app: TokenRingApp, config: TelegramServiceConfig)
```

- **app**: TokenRingApp instance
- **config**: Validated configuration object

#### Methods

- **`run(signal: AbortSignal): Promise<void>`**: Starts the Telegram bot and begins polling for messages. Handles the complete service lifecycle including startup, message processing, and graceful shutdown.

#### Properties

- **`name`**: Service identifier ("TelegramService")
- **`description`**: Service description
- **`running`**: Service running status

### Service Lifecycle

1. **Initialization**: Service creates Telegram bot instance with polling disabled
2. **Message Handler Setup**: Configures message processing with authorization checks
3. **Event Subscription**: Subscribes to agent events for response handling
4. **Polling Start**: Begins Telegram API polling
5. **Startup Message**: Sends "online" message to configured chat ID if provided
6. **Message Processing**: Handles incoming messages with agent creation and event processing
7. **Graceful Shutdown**: Cleanup of all user agents and bot resources

## Message Processing Flow

1. **Authorization Check**: Verifies user is authorized (if user whitelist is configured)
2. **Agent Management**: Gets or creates dedicated agent for the user
3. **State Wait**: Waits for agent to be idle before processing new input
4. **Input Handling**: Sends message to agent for processing
5. **Event Processing**: Subscribes to agent events:
   - `output.chat`: Sends chat responses to Telegram
   - `output.info`: Sends system messages with level formatting
   - `output.warning`: Sends system messages with level formatting
   - `output.error`: Sends system messages with level formatting
   - `input.handled`: Cleans up event subscription and handles timeouts
6. **Response Accumulation**: Accumulates chat content and sends when complete
7. **Timeout Handling**: Implements configurable timeout with user feedback

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
TELEGRAM_DEFAULT_AGENT_TYPE=teamLeader
```

## Event Handling

The service handles the following agent events:

- **`output.chat`**: Processes chat content and sends accumulated responses to Telegram
- **`output.info`**: Formats system messages with level indicators (INFO)
- **`output.warning`**: Formats system messages with level indicators (WARNING)
- **`output.error`**: Formats system messages with level indicators (ERROR)
- **`input.handled`**: Handles input completion, cleans up subscriptions, and manages timeouts

## Error Handling

### Bot-Level Errors

- **Polling Errors**: Logged to console with error details
- **Message Processing**: Wrapped in try-catch to prevent crashes
- **Bot Startup**: Validates configuration before initialization

### User-Level Errors

- **Authorization**: Sends "Sorry, you are not authorized to use this bot." for unauthorized users
- **Timeout**: Sends "Agent timed out after {time} seconds." when agents exceed max runtime
- **No Response**: Sends "No response received from agent." when no output is generated

### Service-Level Errors

- **Configuration**: Validates bot token presence on construction
- **Shutdown**: Graceful cleanup with error handling for bot stop operations
- **Resource Management**: Proper cleanup of all user agents on service termination

## Security Considerations

- **Bot Token Security**: Never commit bot tokens to version control
- **User Authorization**: Use `authorizedUserIds` to restrict bot access to specific users
- **Input Validation**: All user input is validated and sanitized
- **Error Information**: Error messages are user-friendly without exposing internal details
- **Resource Cleanup**: Proper cleanup prevents resource leaks

## Performance Considerations

- **Per-User Agents**: Each user gets their own agent instance for isolation
- **Event Subscription**: Proper cleanup of event subscriptions prevents memory leaks
- **Timeout Management**: Configurable timeouts prevent infinite waiting
- **Graceful Shutdown**: Clean resource cleanup on service termination

## Troubleshooting

### Common Issues

1. **"Bot token is required" error**: Ensure you've provided a valid bot token in configuration
2. **"Not authorized" message**: Add your user ID to `authorizedUserIds` array or remove the restriction
3. **Bot not responding**: Check that the service is started and polling is enabled
4. **Timeout messages**: Adjust `maxRunTime` in agent configuration or increase timeout period

### Debug Information

Enable detailed logging to troubleshoot issues:

```typescript
import { setLogLevel } from '@tokenring-ai/utility';

setLogLevel('debug');
```

### Environment Variables

Ensure these environment variables are properly set:

- `TELEGRAM_BOT_TOKEN`: Your bot token from @BotFather
- `TELEGRAM_CHAT_ID`: Optional chat ID for startup messages
- `TELEGRAM_AUTHORIZED_USER_IDS`: Comma-separated list of authorized user IDs
- `TELEGRAM_DEFAULT_AGENT_TYPE`: Agent type for new users

## Integration with TokenRing

### Plugin System

The Telegram service integrates seamlessly with TokenRing's plugin system:

```typescript
app.install({
  name: '@tokenring-ai/telegram',
  version: '0.2.0',
  description: 'A TokenRing plugin providing Telegram integration.',
  install(app, config) {
    const telegramConfig = config.telegram;
    if (telegramConfig) {
      app.addServices(new TelegramBotService(app, telegramConfig));
    }
  }
});
```

### Agent Integration

- **Agent Creation**: Creates agents using `agentType` configuration
- **Event Processing**: Subscribes to agent events for response handling
- **State Management**: Maintains persistent state across conversations
- **Resource Management**: Proper cleanup of agent resources

## License

MIT License - see [LICENSE](./LICENSE) file for details.
