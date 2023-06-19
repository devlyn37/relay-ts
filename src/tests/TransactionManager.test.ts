import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { NonceManagedWallet } from "../NonceManagedWallet.js";
import { ALICE } from "./constants.js";
import {
  getPendingTxnsForAddress,
  publicClient,
  testChain,
  testClient,
} from "./utils.js";
import { Address, parseEther, webSocket } from "viem";
import { test, describe, expect } from "vitest";
import { TransactionManager } from "../TransactionManager.js";
import { BaseGasOracle } from "../gasOracle.js";
import { sleep } from "../utils.js";

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
        managedWallet,
        new BaseGasOracle(publicClient),
        5
      );

      await testClient.setBalance({
        address: managedWallet.address,
        value: parseEther("1"),
      });

      // send a transaction to monitor
      const transactionId = await transactionManager.send(
        ALICE,
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
      expect(transactionManager.pending.get(transactionId)?.blocksPending).toBe(
        0
      );

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
        managedWallet,
        new BaseGasOracle(publicClient),
        5
      );

      await testClient.setBalance({
        address: managedWallet.address,
        value: parseEther("1"),
      });

      // send a transaction to monitor
      const transactionId = await transactionManager.send(
        ALICE,
        parseEther("0.1")
      );

      // Drop the transaction, and mine a few blocks but not enough to trigger a retry
      const hash = transactionManager.pending.get(transactionId)!.hash;
      await testClient.dropTransaction({ hash });
      await testClient.mine({ blocks: 3 });
      await sleep(1000);

      // Check that the transaction is still pending
      expect(transactionManager.pending.has(transactionId)).toBe(true);
      console.log("Transactions before retry");
      console.log(transactionManager.pending);
    },
    { timeout: 30000 }
  );
});
