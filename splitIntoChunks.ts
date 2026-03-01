import ridiculousMessages from "@tokenring-ai/utility/string/ridiculousMessages";

const MAX = 4090;

export function splitIntoChunks(text: string | null): string[] {
  if (text === null) {
    let ridiculousMessageOffset = Math.floor(Math.random() * 1000) % ridiculousMessages.length;
    return [`***${ridiculousMessages[ridiculousMessageOffset]}... ⏳***`];
  }

  // Split on header lines (lines starting with #)
  const sections = text.split(/(?=\n#)/);

  const chunks: string[] = [];
  let current = '';

  for (const section of sections) {
    if (current.length + section.length > MAX) {
      if (current) chunks.push(current);
      current = section;
    } else {
      current += section;
    }
  }
  if (current) chunks.push(current);

  // Force-split any chunk that still exceeds MAX
  return chunks.flatMap(chunk => {
    const parts: string[] = [];
    while (chunk.length > MAX) {
      parts.push(chunk.substring(0, MAX));
      chunk = chunk.substring(MAX);
    }
    if (chunk) parts.push(chunk);
    return parts;
  });
}
