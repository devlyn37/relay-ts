import { createAnvil } from "@viem/anvil";
import { Address, createPublicClient, createTestClient, webSocket } from "viem";
import { Chain, foundry } from "viem/chains";
import {
  BlockEvent,
  BlockEventParams,
  TransactionManager,
} from "../TransactionManager";

/**
 * The id of the current test worker.
 *
 * This is used by the anvil proxy to route requests to the correct anvil instance.
 */
const pool = Number(process.env.VITEST_POOL_ID ?? 1) + 1;
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

export async function getPendingTxnsForAddress(address: Address) {
  const content = await testClient.getTxpoolContent();
  const pending = content.pending[address.toLowerCase() as `0x${string}`];
  if (pending === undefined) {
    return [];
  }

  return Object.values(pending);
}

export async function mineAndProcessBlocks(
  manager: TransactionManager,
  blocks: number,
  timeoutMs: number
) {
  const initialBlockNumber = await publicClient.getBlockNumber({ maxAge: 0 });
  console.log(`initial block number ${initialBlockNumber}`);

  // assumes block processing will complete in sequential order
  const eventHook = new Promise<void>((resolve) => {
    manager.on(BlockEvent.proccessed, (e: BlockEventParams) => {
      console.log(
        `recieved block number ${e.blockNumber}, endpoint ${
          initialBlockNumber + BigInt(blocks)
        }, equal ${e.blockNumber === initialBlockNumber + BigInt(blocks)}`
      );
      if (e.blockNumber === initialBlockNumber + BigInt(blocks)) {
        console.log("resolving");
        manager.removeAllListeners(BlockEvent.proccessed);
        resolve();
      }
    });
  });

  await testClient.mine({ blocks });

  const timeout = new Promise<void>((_, reject) => {
    setTimeout(
      () =>
        reject(
          `Waiting for ${blocks} blocks to get processed after block ${initialBlockNumber} by the tx manager timed out after ${timeoutMs} milliseconds`
        ),
      timeoutMs
    );
  });

  return Promise.race([eventHook, timeout]);
}
