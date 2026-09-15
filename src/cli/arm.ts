import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

export async function requireArmPhrase(enabled: boolean): Promise<void> {
  if (!enabled) return;
  if (!stdin.isTTY || !stdout.isTTY) throw new Error("interactive TTY is required for the ARM confirmation");
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await readline.question('Type exactly "ARM" to enable normal page submission actions: ');
    if (answer.trim() !== "ARM") throw new Error("ARM phrase did not match; no submission started");
  } finally {
    readline.close();
  }
}
