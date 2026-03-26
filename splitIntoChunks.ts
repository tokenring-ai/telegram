import getRandomItem from "@tokenring-ai/utility/string/getRandomItem";
import workingMessages from "@tokenring-ai/utility/string/workingMessages";
const MAX = 4090;

export function splitIntoChunks(text: string | null): string[] {
  if (!text) {
    return [`***${getRandomItem(workingMessages)}... ⏳***`];
  }

  // Split on headers and paragraph breaks for more natural boundaries
  const sections = text.split(/(?=\n#|\n\n)/);

  const chunks: string[] = [];
  let current = '';

  for (const section of sections) {
    if (current.length + section.length > MAX) {
      if (current) chunks.push(current);
      // Force-split oversized individual sections immediately
      let remaining = section;
      while (remaining.length > MAX) {
        const breakPoint = remaining.lastIndexOf('\n', MAX);
        const splitAt = breakPoint > MAX * 0.5 ? breakPoint : MAX;
        chunks.push(remaining.substring(0, splitAt));
        remaining = remaining.substring(splitAt);
      }
      current = remaining;
    } else {
      current += section;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}