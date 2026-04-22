// Extracted utility — e.g., parseCommand.ts
type ParsedCommand = { type: "mapped"; message: string } | { type: "stop" } | { type: "unknown"; command: string } | { type: "chat"; message: string };

export function parseCommand(
  text: string | undefined,
  commandMapping: Record<string, string>,
  from?: { first_name?: string | undefined; username?: string | undefined }  ,
): ParsedCommand {
  const commandMatch = text?.match(/^\s*(\/\S+)(.*)/);
  if (commandMatch) {
    const command = commandMatch[1];
    if (Object.hasOwn(commandMapping, command)) {
      return {
        type: "mapped",
        message: `${commandMapping[command]}${commandMatch[2]}`,
      };
    }
    if (command === "/stop") {
      return { type: "stop" };
    }
    return { type: "unknown", command };
  }
  return {
    type: "chat",
    message: `/chat send From: ${from?.first_name}, Username: (@${from?.username}) ${text ?? "No text sent"}`,
  };
}
