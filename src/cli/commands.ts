import { createInterface, type Interface } from "node:readline";
import { stdin, stdout } from "node:process";
import type { Logger } from "../logger/Logger.js";
import type { Scheduler } from "../scheduler/Scheduler.js";

export function startCommandConsole(scheduler: Scheduler, logger: Logger): Interface | undefined {
  if (!stdin.isTTY || !stdout.isTTY) return undefined;
  const readline = createInterface({ input: stdin, output: stdout });
  readline.on("line", (line) => {
    const command = line.trim().toLocaleLowerCase();
    if (command === "pause") {
      scheduler.pause();
      void logger.info("CLI", "scheduler paused; in-flight page transaction is allowed to finish verification");
    } else if (command === "resume") {
      scheduler.resume();
      void logger.info("CLI", "scheduler resumed");
    } else if (command === "stop") {
      void scheduler.stop("stopped by CLI command");
    } else if (command === "status") {
      void logger.info(
        "CLI",
        scheduler.workers.map((worker) => `${worker.name}=${worker.state}`).join(" ")
      );
    } else if (command !== "") {
      void logger.warn("CLI", "commands: pause | resume | status | stop");
    }
  });
  return readline;
}
