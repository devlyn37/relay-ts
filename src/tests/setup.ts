import { anvil, port, testClient } from "./utils.js";
import { afterEach, beforeAll, beforeEach } from "vitest";

beforeEach(async () => {
  console.log(`Starting Anvil on port ${port}`);
  await anvil.start();
});

afterEach(async (context) => {
  console.log(`Stopping Anvil on port ${port}`);
  await anvil.stop();

  context.onTestFailed(async () => {
    // If a test fails, you can fetch and print the logs of your anvil instance.
    // Only print the 20 most recent log messages.
    // console.log(...anvil.logs.slice(-20));
  });
});
