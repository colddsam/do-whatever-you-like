/**
 * Browser stand-in for Node's `fs` (next.config.ts aliases it for the browser bundle only).
 * @prettier/plugin-php imports fs to look for a composer.json when phpVersion is "composer";
 * we always pass an explicit phpVersion, so these are never really needed.
 */
const fs = {
  existsSync: () => false,
  readFileSync: () => {
    throw new Error("No file system in the browser.");
  },
};
export default fs;
export const { existsSync, readFileSync } = fs;
