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
export const anvil = createAnvil({ port, noMining: true });

export const testChain = {
  ...foundry, // We are using a mainnet fork for testing.
  rpcUrls: {
    // These rpc urls are automatically used in the transports.
    default: {
      http: [`http://127.0.0.1:${port}`],
      webSocket: [`ws://127.0.0.1:${port}`],
    },
    public: {
      http: [`http://127.0.0.1:${port}`],
      webSocket: [`ws://127.0.0.1:${port}`],
    },
  },
  name: `testchain ${pool}`,
} as const satisfies Chain;

export const testClient = createTestClient({
  chain: testChain,
  mode: "anvil",
  transport: webSocket(),
});

export const publicClient = createPublicClient({
  chain: testChain,
  transport: webSocket(),
});

export const walletClient = createWalletClient({
  chain: testChain,
  transport: webSocket(),
});
