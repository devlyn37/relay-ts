import { anvil, port, testClient } from "./utils.js";
import { afterEach, beforeAll, beforeEach } from "vitest";

beforeEach(async () => {
  console.log(`Starting Anvil on port ${port}`);
  await anvil.start();
  await testClient.setAutomine(false);
});

afterEach(async (context) => {
  console.log(`Starting Anvil on port ${port}`);
  await anvil.stop();
});
