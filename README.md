# @tokenring-ai/telegram

Telegram bot service for TokenRing agents with multi-bot support, group/DM conversations, and escalation provider integration.

## Overview

The `@tokenring-ai/telegram` package provides a comprehensive Telegram bot service that integrates with TokenRing agents, enabling natural language conversations through Telegram. Each Telegram user or group gets their own dedicated agent instance that maintains conversation history and context. The service handles message routing, event processing, and automatic agent management.

As a core integration package, it provides:

- **Multi-Bot Support**: Manage multiple Telegram bots simultaneously with named configurations
- **Group-Based Configuration**: Configure bots with specific groups for different agent types
- **Direct Messaging (DM) Support**: Optional DM support with per-user agent instances
- **Per-User/Group Agents**: Each Telegram user or group gets a dedicated agent with persistent chat history
- **Event-Driven Communication**: Handles agent events and sends responses back to Telegram
- **Escalation Provider**: Implements `EscalationProvider` interface for agent-to-human escalation workflows
- **Message Buffering**: Efficient message buffering with automatic edit/update for long responses
- **File Attachments**: Supports photos and documents with configurable size limits
- **Command Mapping**: Configurable command mapping for custom bot commands
- **Markdown Support**: Messages are sent with Markdown formatting (with fallback to plain text)

## Key Features

- **Multi-Bot Architecture**: Support for multiple independently configured bots
- **Authorization Control**: User whitelists for both groups and DMs
- **Reply-Based Communication**: Support for Telegram reply feature in escalation workflows
- **Intelligent Message Buffering**: 250ms throttled batching with message editing
- **Automatic Agent Lifecycle**: Creates, manages, and cleans up agents per chat
- **Graceful Shutdown**: Proper cleanup of all resources on service termination
- **Error Handling**: Robust error handling with Markdown parse error fallbacks
- **File Processing**: Photo and document extraction with size validation

## Core Components

### TelegramBotService

The main service class that manages multiple Telegram bot instances.

**Location**: `TelegramService.ts`

**Implements**: `TokenRingService`

**Key Methods**:

- `constructor(app: TokenRingApp, options: ParsedTelegramServiceConfig)`: Initializes the service with app instance and configuration
- `run(signal: AbortSignal): Promise<void>`: Starts all configured bots and handles lifecycle
- `getAvailableBots(): string[]`: Returns array of configured bot names
- `getBot(botName: string): TelegramBot`: Returns the specified bot instance

**Properties**:

- `name: string`: Service identifier ("TelegramService")
- `description: string`: Service description

### TelegramBot

The bot implementation that handles Telegram API interactions and message processing.

**Location**: `TelegramBot.ts`

**Note**: Not exported from main entry point. Access via `telegramService.getBot()`.

**Key Methods**:

- `constructor(app: TokenRingApp, telegramService: TelegramBotService, botName: string, botConfig: ParsedTelegramBotConfig)`: Initializes bot with configuration
- `start(): Promise<void>`: Starts the bot and begins polling
- `stop(): Promise<void>`: Gracefully stops the bot and cleans up resources
- `createCommunicationChannelWithGroup(groupName: string): CommunicationChannel`: Creates a communication channel for escalation
- `createCommunicationChannelWithUser(userId: string): CommunicationChannel`: Creates a communication channel for a specific user
- `getBotUsername(): string | undefined`: Returns the bot's username

**Internal Components**:

- **Message Handling**: Processes incoming messages with authorization checks
- **Agent Management**: Creates and manages agents per chat ID
- **Event Processing**: Subscribes to agent events and forwards to Telegram
- **Response Buffering**: Implements throttled batch processing for efficient messaging
- **File Extraction**: Handles photo and document attachments

### TelegramEscalationProvider

Implements the `EscalationProvider` interface for escalation workflows.

**Location**: `TelegramEscalationProvider.ts`

**Key Methods**:

- `constructor(config: ParsedTelegramEscalationProviderConfig)`: Initializes with bot and group configuration
- `createCommunicationChannelWithUser(groupName: string, agent: Agent): Promise<CommunicationChannel>`: Creates a communication channel for escalation

## Services

### TelegramBotService

**Type**: `TokenRingService`

**Purpose**: Manages multiple Telegram bot instances and their lifecycle

**Registration**: Automatically registered when plugin is installed with telegram configuration

**Integration**:

- Integrates with `TokenRingApp` for service management
- Uses `AgentManager` for agent lifecycle
- Integrates with `EscalationService` when escalation plugin is configured

## RPC Endpoints

This package does not define RPC endpoints. It uses the Telegram Bot API directly via the `node-telegram-bot-api` library.

## Chat Commands

The package supports configurable command mapping via the `commandMapping` configuration option. Default mapping:

```typescript
{
  "/reset": "/chat reset"
}
```

**Supported Commands**:

- `/reset` - Resets the agent conversation (maps to `/chat reset`)
- `/stop` - Special command that aborts the current agent operation

**Custom Commands**: Add custom command mappings in configuration:

```typescript
commandMapping: {
  "/reset": "/chat reset",
  "/help": "/chat help",
  "/status": "/chat status"
}
```

## Configuration

### Configuration Schemas

The package uses Zod schemas for configuration validation:

```typescript
import { TelegramBotConfigSchema, TelegramServiceConfigSchema, TelegramEscalationProviderConfigSchema } from '@tokenring-ai/telegram/schema';
```

### TelegramBotConfigSchema

Configuration for individual bot instances:

```typescript
export const TelegramBotConfigSchema = z.object({
  name: z.string(),
  botToken: z.string().min(1, "Bot token is required"),
  joinMessage: z.string().optional(),
  maxPhotoPixels: z.number().default(1_000_000),
  maxFileSize: z.number().default(20_971_520), // 20MB default
  maxDocumentSize: z.number().default(10_485_760), // 10MB default
  groups: z.record(z.string(), z.object({
    groupId: z.number().max(0, "Group ID must be a negative number"),
    allowedUsers: z.array(z.number()).default([]),
    agentType: z.string(),
  })),
  dmAgentType: z.string(),
  dmAllowedUsers: z.array(z.number()).default([]),
  commandMapping: z.record(z.string(), z.string()).default({
    "/reset": "/chat reset",
  })
});
```

**Properties**:

- **`name`** (string): Unique name for this bot configuration
- **`botToken`** (string): Telegram bot token from [@BotFather](https://t.me/botfather)
- **`joinMessage`** (string, optional): Message sent to all groups on bot startup
- **`maxPhotoPixels`** (number): Maximum pixel count for photos (width × height), default 1,000,000
- **`maxFileSize`** (number): Maximum file size in bytes, default 20MB (20,971,520)
- **`maxDocumentSize`** (number): Maximum document size in bytes, default 10MB (10,485,760)
- **`groups`** (object): Map of group configurations
  - **`groupId`** (number): Telegram group/chat ID (must be negative)
  - **`allowedUsers`** (number[]): Array of allowed user IDs (empty = all users)
  - **`agentType`** (string): Agent type for this group
- **`dmAgentType`** (string): Agent type for direct messages (DMs disabled if not provided)
- **`dmAllowedUsers`** (number[]): Array of allowed DM user IDs (empty = all users)
- **`commandMapping`** (Record<string, string>): Map of bot commands to agent commands

### TelegramServiceConfigSchema

Configuration for the service with multiple bots:

```typescript
export const TelegramServiceConfigSchema = z.object({
  bots: z.record(z.string(), TelegramBotConfigSchema)
});
```

### TelegramEscalationProviderConfigSchema

Configuration for escalation provider:

```typescript
export const TelegramEscalationProviderConfigSchema = z.object({
  type: z.literal('telegram'),
  bot: z.string(),
  group: z.string(),
});
```

## Integration

### Plugin Installation

The recommended way to use the Telegram service is through the TokenRing plugin system:

```typescript
import TokenRingApp from '@tokenring-ai/app';
import telegramPlugin from '@tokenring-ai/telegram';

const app = new TokenRingApp({
  telegram: {
    bots: {
      "primaryBot": {
        name: "Primary Bot",
        botToken: process.env.TELEGRAM_BOT_TOKEN!,
        groups: {
          "developers": {
            groupId: -1001234567890,
            allowedUsers: [],
            agentType: "teamLeader"
          }
        }
      }
    }
  }
});

app.install(telegramPlugin);
await app.start();
```

### Escalation Provider Integration

To use the Telegram escalation provider, configure both the Telegram and escalation plugins:

```typescript
import TokenRingApp from '@tokenring-ai/app';
import telegramPlugin from '@tokenring-ai/telegram';
import escalationPlugin from '@tokenring-ai/escalation';

const app = new TokenRingApp({
  telegram: {
    bots: {
      "primaryBot": {
        name: "Primary Bot",
        botToken: process.env.TELEGRAM_BOT_TOKEN!,
        groups: {
          "admins": {
            groupId: -1001234567890,
            allowedUsers: [],
            agentType: "teamLeader"
          }
        }
      }
    }
  },
  escalation: {
    providers: {
      "telegramAdmins": {
        type: "telegram",
        bot: "primaryBot",
        group: "admins"
      }
    },
    groups: {
      "admins": ["123456789@telegram"]
    }
  }
});

app.install(telegramPlugin);
app.install(escalationPlugin);
await app.start();
```

### Manual Service Registration

For advanced usage, services can be registered manually:

```typescript
import TokenRingApp from '@tokenring-ai/app';
import TelegramService from '@tokenring-ai/telegram/TelegramService';
import { TelegramServiceConfigSchema } from '@tokenring-ai/telegram/schema';

const app = new TokenRingApp();

const config = TelegramServiceConfigSchema.parse({
  bots: {
    "primaryBot": {
      name: "Primary Bot",
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      groups: {
        "developers": {
          groupId: -1001234567890,
          allowedUsers: [],
          agentType: "teamLeader"
        }
      }
    }
  }
});

app.addServices(new TelegramService(app, config));
await app.start();
```

## Usage Examples

### Basic Bot Setup

```typescript
import TokenRingApp from '@tokenring-ai/app';
import telegramPlugin from '@tokenring-ai/telegram';

const app = new TokenRingApp({
  telegram: {
    bots: {
      "myBot": {
        name: "My Bot",
        botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
        groups: {
          "main": {
            groupId: -1001234567890,
            allowedUsers: [],
            agentType: "developerAgent"
          }
        }
      }
    }
  }
});

app.install(telegramPlugin);
await app.start();
```

### Direct Messaging Setup

```typescript
const app = new TokenRingApp({
  telegram: {
    bots: {
      "myBot": {
        name: "My Bot",
        botToken: "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
        groups: {
          "main": {
            groupId: -1001234567890,
            allowedUsers: [],
            agentType: "developerAgent"
          }
        },
        dmAgentType: "personalAgent",
        dmAllowedUsers: [123456789, 987654321]
      }
    }
  }
});
```

### Communication Channel Example

```typescript
import { TelegramBotService } from '@tokenring-ai/telegram';
import { EscalationService } from '@tokenring-ai/escalation';

// Get the Telegram service from an agent
const telegramService = agent.requireServiceByType(TelegramBotService);

// Get the bot instance
const bot = telegramService.getBot("primaryBot");

// Create a communication channel with a specific group
const channel = bot.createCommunicationChannelWithGroup("developers");

// Send a message
await channel.send('Please approve this deployment');

// Listen for a response
for await (const message of channel.receive()) {
  console.log('User responded:', message);
  break; // Process response and break out of loop
}

// Clean up
await channel[Symbol.asyncDispose]();
```

### Escalation Example

```typescript
import { EscalationService } from '@tokenring-ai/escalation';

const escalationService = agent.requireServiceByType(EscalationService);

// Create a communication channel and send message
const channel = await escalationService.initiateContactWithUserOrGroup(
  'admins', // Group name
  'Approve production deployment?',
  agent
);

// Listen for response
for await (const message of channel.receive()) {
  if (message.toLowerCase().includes('yes')) {
    console.log('Deployment approved');
  }
  await channel[Symbol.asyncDispose]();
  break;
}
```

## Best Practices

### Security

1. **Never commit bot tokens**: Use environment variables for bot tokens
2. **Use user authorization**: Configure `allowedUsers` and `dmAllowedUsers` to restrict access
3. **Validate group IDs**: Ensure group IDs are negative numbers as required by Telegram
4. **Handle errors gracefully**: Implement proper error handling for all Telegram API calls

### Performance

1. **Configure appropriate limits**: Set `maxPhotoPixels` and `maxDocumentSize` based on your needs
2. **Use message buffering**: The built-in buffering (250ms) optimizes API calls
3. **Clean up resources**: Always dispose of communication channels after use
4. **Monitor agent lifecycle**: The service automatically manages agent lifecycle per chat

### Message Handling

1. **Use Markdown carefully**: Messages support Markdown with automatic fallback to plain text
2. **Handle long responses**: The service automatically chunks messages over 4090 characters
3. **Test reply functionality**: Verify reply-based communication works as expected
4. **Monitor rate limits**: The service includes built-in rate limiting to avoid Telegram API limits

## Testing and Development

### Running Tests

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test --watch

# Run tests with coverage
bun test --coverage
```

### Test Configuration

The package uses Vitest with the following configuration (`vitest.config.ts`):

```typescript
import {defineConfig} from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    environment: "node",
    globals: true,
    isolate: true,
  },
});
```

### Development Setup

1. Install dependencies: `bun install`
2. Run type check: `bun run build`
3. Run tests: `bun test`

### Package Structure

```
pkg/telegram/
├── index.ts                              # Main exports
├── plugin.ts                             # Plugin definition for TokenRing integration
├── TelegramService.ts                    # Core service implementation
├── TelegramBot.ts                        # Bot implementation with message handling
├── TelegramEscalationProvider.ts         # Escalation provider implementation
├── schema.ts                             # Configuration schemas
├── parseCommand.ts                       # Command parsing utility
├── fetchTelegramFile.ts                  # File download utility
├── splitIntoChunks.ts                    # Message chunking utility
├── throttledBatchProcessor.ts            # Batch processing utility
├── vitest.config.ts                      # Vitest configuration
└── README.md                             # This documentation
```

## Utility Functions

### parseCommand

**Location**: `parseCommand.ts`

Parses incoming messages and maps commands to agent commands.

```typescript
type ParsedCommand =
  | { type: 'mapped'; message: string }
  | { type: 'stop' }
  | { type: 'unknown'; command: string }
  | { type: 'chat'; message: string };

export function parseCommand(
  text: string | undefined,
  commandMapping: Record<string, string>,
  from?: { first_name?: string; username?: string }
): ParsedCommand
```

**Parameters**:

- `text`: The message text to parse
- `commandMapping`: Map of bot commands to agent commands
- `from`: Optional sender information for chat message formatting

**Returns**: ParsedCommand object with type and message

### fetchTelegramFile

**Location**: `fetchTelegramFile.ts`

Downloads a file from Telegram and returns it as a Buffer.

```typescript
export async function fetchTelegramFile(
  bot: TelegramBotAPI,
  botToken: string,
  fileId: string
): Promise<Buffer>
```

**Parameters**:

- `bot`: TelegramBotAPI instance
- `botToken`: Bot token for API authentication
- `fileId`: Telegram file ID to download

**Returns**: Buffer containing the file data

### splitIntoChunks

**Location**: `splitIntoChunks.ts`

Splits text into chunks suitable for Telegram messages (max 4090 characters).

```typescript
export function splitIntoChunks(text: string | null): string[]
```

**Parameters**:

- `text`: Text to split into chunks

**Returns**: Array of message chunks

**Features**:

- Splits on headers (`\n#`) and paragraph breaks (`\n\n`)
- Force-splits oversized sections at line breaks
- Falls back to character-based splitting if needed
- Returns "working..." message for null input

### ThrottledBatchProcessor

**Location**: `throttledBatchProcessor.ts`

Batch processor with throttling for efficient message sending.

```typescript
export class ThrottledBatchProcessor<T> {
  constructor(
    processItems: (items: T[]) => Promise<void>,
    intervalMs: number = 250
  )

  add(item: T): void
  flush(): Promise<void>
  dispose(): void
  get hasPending(): boolean
}
```

**Parameters**:

- `processItems`: Function to process batch of items
- `intervalMs`: Minimum interval between batches (default 250ms)

**Methods**:

- `add(item)`: Add item to pending batch
- `flush()`: Process all pending items immediately
- `dispose()`: Clear pending items and cancel timer
- `hasPending`: Check if there are pending items

## Dependencies

### Production Dependencies

- `@tokenring-ai/app` (0.2.0) - Application framework
- `@tokenring-ai/chat` (0.2.0) - Chat service integration
- `@tokenring-ai/agent` (0.2.0) - Agent management
- `@tokenring-ai/utility` (0.2.0) - Utility functions
- `@tokenring-ai/escalation` (0.2.0) - Escalation provider interface
- `node-telegram-bot-api` (^0.67.0) - Telegram API binding
- `axios` (^1.13.6) - HTTP client for file downloads
- `marked` (^17.0.4) - Markdown parsing
- `zod` (^4.3.6) - Schema validation

### Development Dependencies

- `@types/node-telegram-bot-api` (^0.64.14) - TypeScript definitions
- `vitest` (^4.1.0) - Testing framework
- `typescript` (^5.9.3) - TypeScript compiler

## Related Components

- **@tokenring-ai/agent**: Core agent system used by Telegram bots
- **@tokenring-ai/escalation**: Escalation service integrated with Telegram provider
- **@tokenring-ai/app**: Base application framework
- **@tokenring-ai/chat**: Chat service for agent interactions

## License

MIT License - see [LICENSE](./LICENSE) file for details.
