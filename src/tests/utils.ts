import { createAnvil } from "@viem/anvil";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  webSocket,
} from "viem";
import { Chain, foundry } from "viem/chains";

/**
 * The id of the current test worker.
 *
 * This is used by the anvil proxy to route requests to the correct anvil instance.
 */
const pool = Number(process.env.VITEST_POOL_ID ?? 1);
export const port = parseInt(`500${pool}`);
export const anvil = createAnvil({ port });

console.log("Here's the pool!");
console.log(process.env.VITEST_POOL_ID);

console.log("Here's the port");
console.log(port);

export const ws = webSocket(`ws://127.0.0.1:${port}`);

export const testClient = createTestClient({
  chain: foundry,
  mode: "anvil",
  transport: ws,
});

export const publicClient = createPublicClient({
  chain: foundry,
  transport: ws,
});

export const walletClient = createWalletClient({
  chain: foundry,
  transport: ws,
});
