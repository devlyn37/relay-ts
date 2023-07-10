import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { NonceManagedWallet } from "../NonceManagedWallet.js";
import { ALICE } from "./constants.js";
import {
  getPendingTxnsForAddress,
  publicClient,
  testChain,
  testClient,
} from "./utils.js";
import { parseEther, parseGwei, webSocket } from "viem";
import { test, describe, expect } from "vitest";
import { TransactionManager } from "../TransactionManager.js";
import { BaseGasOracle } from "../gasOracle.js";
import { sleep } from "../utils.js";
import { randomUUID } from "crypto";

describe("TransactionManager", () => {
  test(
    "Retries a transaction after blockRetry blocks have been mined",
    async () => {
      const managedWallet = new NonceManagedWallet(
        privateKeyToAccount(generatePrivateKey()),
        webSocket(),
        testChain
      );
      const transactionManager = new TransactionManager(
        testChain,
        publicClient,
        new Map([[managedWallet.address, managedWallet]]),
        new BaseGasOracle(publicClient),
        5,
        25
      );

      await testClient.setBalance({
        address: managedWallet.address,
        value: parseEther("1"),
      });

      // send a transaction to monitor
      const transactionId = randomUUID();
      await transactionManager.send(
        transactionId,
        ALICE,
        managedWallet.address,
        parseEther("0.1")
      );

      // drop the transaction from the mempool so it doesn't get mined
      const hash = transactionManager.pending.get(transactionId)!.hash;
      const pendingBeforeRetry = await getPendingTxnsForAddress(
        managedWallet.address
      );
      expect(pendingBeforeRetry.length).to.eq(1);
      const hashBeforeRetry = pendingBeforeRetry[0].hash;

      // Drop the transaction and mine enough blocks so that the next block that is mined will trigger a retry
      await testClient.dropTransaction({ hash });
      await testClient.mine({ blocks: 4 });
      await sleep(1000);

      // Check that despite being dropped from the mempool, the transaction manager is keeping track of the transaction we sent
      const pendingAfterDropping = await getPendingTxnsForAddress(
        managedWallet.address
      );
      expect(pendingAfterDropping.length).to.eq(0);

      // Check that the transaction is still pending
      expect(transactionManager.pending.has(transactionId)).toBe(true);
      console.log("Transactions before retry");
      console.log(transactionManager.pending);

      // Mine another block, triggering a retry
      await testClient.mine({ blocks: 1 });
      await sleep(500);

      // Check that a new transaction has replaced the former, with a different hash
      const pendingAfterRetry = await getPendingTxnsForAddress(
        managedWallet.address
      );
      expect(pendingAfterRetry.length).to.eq(1);
      const hashAfterRetry = pendingAfterRetry[0].hash;

      expect(hashAfterRetry).to.not.eq(hashBeforeRetry);
      expect(
        transactionManager.pending.get(transactionId)?.blocksSpentWaiting
      ).toBe(0);

      // Finally, the retried transaction should have been mined
      await testClient.mine({ blocks: 1 });
      await sleep(500);
      expect(transactionManager.pending.has(transactionId)).toBe(false);
      const pendingFinal = await getPendingTxnsForAddress(
        managedWallet.address
      );
      expect(pendingFinal.length).to.eq(0);
    },
    { timeout: 30000 }
  );

  test(
    "Does not retry a transaction if it is mined within blockRetry blocks",
    async () => {
      const managedWallet = new NonceManagedWallet(
        privateKeyToAccount(generatePrivateKey()),
        webSocket(),
        testChain
      );
      const transactionManager = new TransactionManager(
        testChain,
        publicClient,
        new Map([[managedWallet.address, managedWallet]]),
        new BaseGasOracle(publicClient),
        5,
        25
      );

      await testClient.setBalance({
        address: managedWallet.address,
        value: parseEther("1"),
      });

      // send a transaction to monitor
      const transactionId = randomUUID();
      await transactionManager.send(
        transactionId,
        ALICE,
        managedWallet.address,
        parseEther("0.1")
      );

      // Drop the transaction, and mine a few blocks but not enough to trigger a retry
      const hash = transactionManager.pending.get(transactionId)!.hash;
      await testClient.dropTransaction({ hash });
      await testClient.mine({ blocks: 3 });
      await sleep(1000);

      // Check that the transaction is still pending
      expect(transactionManager.pending.has(transactionId)).toBe(true);
      expect(transactionManager.pending.size).toBe(1);
    },
    { timeout: 30000 }
  );

  test(
    "Will handle large spikes in gas",
    async () => {
      const managedWallet = new NonceManagedWallet(
        privateKeyToAccount(generatePrivateKey()),
        webSocket(),
        testChain
      );
      const transactionManager = new TransactionManager(
        testChain,
        publicClient,
        new Map([[managedWallet.address, managedWallet]]),
        new BaseGasOracle(publicClient),
        1,
        25
      );

      await testClient.setBalance({
        address: managedWallet.address,
        value: parseEther("1"),
      });

      // send transaction to monitor
      const transactionId = randomUUID();
      await transactionManager.send(
        transactionId,
        ALICE,
        managedWallet.address,
        parseEther("0.1")
      );
      const initialHash = transactionManager.pending.get(transactionId)!.hash;

      // mine a block, the previous transaction won't get mined because it's gas values are too low
      await testClient.setNextBlockBaseFeePerGas({
        baseFeePerGas: parseGwei("1000"),
      });
      await sleep(500);

      await testClient.mine({ blocks: 1 });
      await sleep(500);

      const pendingAfterRetry = await getPendingTxnsForAddress(
        managedWallet.address
      );
      expect(pendingAfterRetry.length).to.eq(1);
      expect(pendingAfterRetry[0].hash).to.not.eq(initialHash);
      expect(transactionManager.pending.has(transactionId)).to.eq(true);
      expect(transactionManager.pending.get(transactionId)?.hash).to.eq(
        pendingAfterRetry[0].hash
      );

      // Finally, mine the next block w/ the same crazy high base fee
      await testClient.setNextBlockBaseFeePerGas({
        baseFeePerGas: parseGwei("1000"),
      });
      await testClient.mine({ blocks: 1 });
      await sleep(500);

      expect(transactionManager.pending.has(transactionId)).toBe(false);
      const pendingFinal = await getPendingTxnsForAddress(
        managedWallet.address
      );
      expect(pendingFinal.length).to.eq(0);
    },
    { timeout: 30000 }
  );
  test(
    "Can manage more than a single wallet",
    async () => {
      const managedWallet1 = new NonceManagedWallet(
        privateKeyToAccount(generatePrivateKey()),
        webSocket(),
        testChain
      );
      const managedWallet2 = new NonceManagedWallet(
        privateKeyToAccount(generatePrivateKey()),
        webSocket(),
        testChain
      );
      const transactionManager = new TransactionManager(
        testChain,
        publicClient,
        new Map([
          [managedWallet1.address, managedWallet1],
          [managedWallet2.address, managedWallet2],
        ]),
        new BaseGasOracle(publicClient),
        1,
        25
      );

      await testClient.setBalance({
        address: managedWallet1.address,
        value: parseEther("1"),
      });
      await testClient.setBalance({
        address: managedWallet2.address,
        value: parseEther("1"),
      });

      // send a transaction to monitor
      const transactionId1 = randomUUID();
      await transactionManager.send(
        transactionId1,
        ALICE,
        managedWallet1.address,
        parseEther("0.1")
      );
      const transactionId2 = randomUUID();
      await transactionManager.send(
        transactionId2,
        ALICE,
        managedWallet2.address,
        parseEther("0.1")
      );

      // Check that both wallets have a single transaction in the mempool
      let pendingAddress1 = await getPendingTxnsForAddress(
        managedWallet1.address
      );
      expect(pendingAddress1.length).to.eq(1);
      let pendingAddress2 = await getPendingTxnsForAddress(
        managedWallet2.address
      );
      expect(pendingAddress2.length).to.eq(1);

      await testClient.mine({ blocks: 1 });
      await sleep(500);

      // Check that both wallet had their transactions mined
      expect(transactionManager.pending.has(transactionId1)).toBe(false);
      expect(transactionManager.pending.has(transactionId2)).toBe(false);
      pendingAddress1 = await getPendingTxnsForAddress(managedWallet1.address);
      expect(pendingAddress1.length).to.eq(0);
      pendingAddress2 = await getPendingTxnsForAddress(managedWallet2.address);
      expect(pendingAddress2.length).to.eq(0);
    },
    { timeout: 30000 }
  );
});
