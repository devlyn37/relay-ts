import { ALICE } from "./constants.js";
import {
  generateFundedAccounts,
  getPendingTxnsForAddress,
  mineAndProcessBlocks,
  publicClient,
  testChain,
  testClient,
} from "./utils.js";
import { parseEther, parseGwei } from "viem";
import { test, describe, expect, vi } from "vitest";
import { TransactionEvent, TransactionManager } from "../TransactionManager.js";
import { BaseGasOracle } from "../gasOracle.js";
import { randomUUID } from "crypto";

describe("TransactionManager", () => {
  test("Retries a transaction after blockRetry blocks have been mined", async () => {
    const accounts = await generateFundedAccounts(1);
    const transactionManager = new TransactionManager({
      chain: testChain,
      client: publicClient,
      managedWallets: new Map([[accounts[0].address, accounts[0]]]),
      gasOracle: new BaseGasOracle(publicClient),
      blockRetry: 5,
      blockCancel: 25,
    });
    const emitSpy = vi.spyOn(transactionManager, "emit");

    // send a transaction to monitor
    const transactionId = randomUUID();
    await transactionManager.send(
      transactionId,
      ALICE,
      accounts[0].address,
      parseEther("0.1")
    );

    const initiallyTrackedRequest =
      transactionManager.pending.get(transactionId);
    if (initiallyTrackedRequest === undefined) {
      throw new Error(
        `Transaction manager should be keeping track of txn ${transactionId}`
      );
    }

    const pendingBeforeRetry = await getPendingTxnsForAddress(
      accounts[0].address
    );
    expect(
      pendingBeforeRetry.length,
      "Only a single transaction should be in the mempool after sending"
    ).to.eq(1);
    const initiallySubmittedTxn = pendingBeforeRetry[0];
    expect(emitSpy).toHaveBeenCalledWith(
      `${TransactionEvent.submitted}-${transactionId}`,
      {
        nonce: 0,
        hash: initiallySubmittedTxn.hash,
        fees: initiallyTrackedRequest.fees,
        from: accounts[0].address,
      }
    );

    // Drop the transaction and mine enough blocks so that the next block that is mined will trigger a retry
    await testClient.dropTransaction({ hash: initiallyTrackedRequest.hash });
    await mineAndProcessBlocks(transactionManager, 4, 1000);

    // Check that despite being dropped from the mempool, the transaction manager is keeping track of the transaction we sent
    const pendingAfterDropping = await getPendingTxnsForAddress(
      accounts[0].address
    );
    expect(pendingAfterDropping.length).to.eq(0);

    // Check that the transaction is still pending
    expect(transactionManager.pending.has(transactionId)).toBe(true);

    // Mine another block, triggering a retry
    await mineAndProcessBlocks(transactionManager, 1, 1000);

    // Check that a new transaction has replaced the former, with a different hash
    const pendingAfterRetry = await getPendingTxnsForAddress(
      accounts[0].address
    );
    expect(
      pendingAfterRetry.length,
      "Only a single transaction should be in the mempool after retry"
    ).to.eq(1);
    const submittedRetryTxn = pendingAfterRetry[0];
    const trackedRequestPostRetry =
      transactionManager.pending.get(transactionId);

    expect(submittedRetryTxn.hash).to.not.eq(initiallySubmittedTxn.hash);
    expect(trackedRequestPostRetry!.blocksSpentWaiting).toBe(0);
    expect(emitSpy).toHaveBeenCalledWith(
      `${TransactionEvent.retry}-${transactionId}`,
      {
        hash: submittedRetryTxn.hash,
        fees: trackedRequestPostRetry!.fees,
        from: accounts[0].address,
      }
    );

    // Finally, the retried transaction should have been mined
    await mineAndProcessBlocks(transactionManager, 1, 1000);

    expect(transactionManager.pending.has(transactionId)).toBe(false);
    expect(transactionManager.pending.size).to.eq(0);
    const pendingFinal = await getPendingTxnsForAddress(accounts[0].address);
    expect(pendingFinal.length).to.eq(0);

    expect(emitSpy).toHaveBeenCalledWith(
      `${TransactionEvent.included}-${transactionId}`,
      {
        hash: submittedRetryTxn.hash,
        fees: trackedRequestPostRetry!.fees,
        nonce: 0,
        from: accounts[0].address,
      }
    );
  });

  test("Does not retry a transaction if it is mined within blockRetry blocks", async () => {
    const accounts = await generateFundedAccounts(1);
    const transactionManager = new TransactionManager({
      chain: testChain,
      client: publicClient,
      managedWallets: new Map([[accounts[0].address, accounts[0]]]),
      gasOracle: new BaseGasOracle(publicClient),
      blockRetry: 5,
      blockCancel: 25,
    });

    // send a transaction to monitor
    const transactionId = randomUUID();
    await transactionManager.send(
      transactionId,
      ALICE,
      accounts[0].address,
      parseEther("0.1")
    );

    // Drop the transaction, and mine a few blocks but not enough to trigger a retry
    const hash = transactionManager.pending.get(transactionId)!.hash;
    await testClient.dropTransaction({ hash });
    await mineAndProcessBlocks(transactionManager, 3, 1000);

    // Check that the transaction is still pending
    expect(transactionManager.pending.has(transactionId)).toBe(true);
    expect(transactionManager.pending.size).toBe(1);
  });

  test("Will handle large spikes in gas", async () => {
    const accounts = await generateFundedAccounts(1);
    const transactionManager = new TransactionManager({
      chain: testChain,
      client: publicClient,
      managedWallets: new Map([[accounts[0].address, accounts[0]]]),
      gasOracle: new BaseGasOracle(publicClient),
      blockRetry: 1,
      blockCancel: 25,
    });

    // send transaction to monitor
    const transactionId = randomUUID();
    await transactionManager.send(
      transactionId,
      ALICE,
      accounts[0].address,
      parseEther("0.1")
    );
    const initialHash = transactionManager.pending.get(transactionId)!.hash;

    // mine a block, the previous transaction won't get mined because it's gas values are too low
    await testClient.setNextBlockBaseFeePerGas({
      baseFeePerGas: parseGwei("1000"),
    });
    await mineAndProcessBlocks(transactionManager, 1, 1000);

    const mempoolTxns = await getPendingTxnsForAddress(accounts[0].address);
    expect(mempoolTxns.length).to.eq(1);
    expect(mempoolTxns[0].hash).to.not.eq(initialHash);
    expect(transactionManager.pending.has(transactionId)).to.eq(true);
    expect(transactionManager.pending.get(transactionId)?.hash).to.eq(
      mempoolTxns[0].hash
    );

    // Finally, mine the next block w/ the same crazy high base fee
    await testClient.setNextBlockBaseFeePerGas({
      baseFeePerGas: parseGwei("1000"),
    });
    await mineAndProcessBlocks(transactionManager, 1, 1000);

    expect(transactionManager.pending.has(transactionId)).toBe(false);
    const pendingFinal = await getPendingTxnsForAddress(accounts[0].address);
    expect(pendingFinal.length).to.eq(0);
  });

  test("Will retry multiple times", async () => {
    const accounts = await generateFundedAccounts(1);

    const transactionManager = new TransactionManager({
      chain: testChain,
      client: publicClient,
      managedWallets: new Map([[accounts[0].address, accounts[0]]]),
      gasOracle: new BaseGasOracle(publicClient),
      blockRetry: 3,
      blockCancel: 25,
    });

    // send transaction to monitor
    const transactionId = randomUUID();
    await transactionManager.send(
      transactionId,
      ALICE,
      accounts[0].address,
      parseEther("0.1")
    );

    for (let i = 0; i < 9; i++) {
      const managerTracked = transactionManager.pending.get(transactionId);
      expect(managerTracked).to.not.be.undefined;

      const initialHash = transactionManager.pending.get(transactionId)!.hash;

      await testClient.dropTransaction({ hash: initialHash });
      await mineAndProcessBlocks(transactionManager, 3, 1000);

      // Check blockchain state
      const pendingAfterRetry = await getPendingTxnsForAddress(
        accounts[0].address
      );
      expect(pendingAfterRetry.length).to.eq(1);
      const hashAfterRetry = pendingAfterRetry[0].hash;
      expect(hashAfterRetry).to.not.eq(initialHash);

      // Check transaction manager state
      expect(
        transactionManager.pending.get(transactionId)?.blocksSpentWaiting
      ).toBe(0);
    }

    // Finally, the transaction should be mined
    await mineAndProcessBlocks(transactionManager, 1, 1000);
    expect(transactionManager.pending.has(transactionId)).toBe(false);
    const pendingFinal = await getPendingTxnsForAddress(accounts[0].address);
    expect(pendingFinal.length).to.eq(0);
  });

  test("Will cancel a transaction after enough time", async () => {
    const accounts = await generateFundedAccounts(1);
    // Also testing here that cancellation will take precedence over retrying
    const transactionManager = new TransactionManager({
      chain: testChain,
      client: publicClient,
      managedWallets: new Map([[accounts[0].address, accounts[0]]]),
      gasOracle: new BaseGasOracle(publicClient),
      blockRetry: 5,
      blockCancel: 5,
    });

    // send a transaction to monitor
    const transactionId = randomUUID();
    await transactionManager.send(
      transactionId,
      ALICE,
      accounts[0].address,
      parseEther("0.1")
    );

    // drop the transaction from the mempool so it doesn't get mined
    const hash = transactionManager.pending.get(transactionId)!.hash;
    const pendingBeforeRetry = await getPendingTxnsForAddress(
      accounts[0].address
    );
    expect(pendingBeforeRetry.length).to.eq(1);
    const hashBeforeRetry = pendingBeforeRetry[0].hash;

    // Drop the transaction and mine enough blocks so that the next block that is mined will trigger a retry
    await testClient.dropTransaction({ hash });
    await mineAndProcessBlocks(transactionManager, 4, 4000);

    // Check that despite being dropped from the mempool, the transaction manager is keeping track of the transaction we sent
    const pendingAfterDropping = await getPendingTxnsForAddress(
      accounts[0].address
    );
    expect(pendingAfterDropping.length).to.eq(0);

    // Check that the transaction is still pending
    expect(transactionManager.pending.has(transactionId)).toBe(true);
    console.log("Transactions before retry");
    console.log(transactionManager.pending);

    // Mine another block, triggering the cancellation
    await mineAndProcessBlocks(transactionManager, 1, 3000);

    // Check that a new transaction has replaced the former, with a different hash
    const pendingAfterCancellation = await getPendingTxnsForAddress(
      accounts[0].address
    );
    expect(pendingAfterCancellation.length).to.eq(1);
    const hashAfterRetry = pendingAfterCancellation[0].hash;

    // Check that the transaction is a cancellation transaction
    expect(pendingAfterCancellation[0].value).to.eq("0x0");
    expect(pendingAfterCancellation[0].to).to.eq(
      "0xe898bbd704cce799e9593a9ade2c1ca0351ab660"
    );

    expect(hashAfterRetry).to.not.eq(hashBeforeRetry);

    // The transaction manager shouldn't be tracking it anymore
    expect(transactionManager.pending.get(transactionId)).to.be.undefined;

    // Finally, the cancellation transaction should have been mined

    await mineAndProcessBlocks(transactionManager, 1, 1000);

    const pendingFinal = await getPendingTxnsForAddress(accounts[0].address);
    expect(pendingFinal.length).to.eq(0);
  });

  test("Can manage more than a single wallet", async () => {
    const accounts = await generateFundedAccounts(2);
    const transactionManager = new TransactionManager({
      chain: testChain,
      client: publicClient,
      managedWallets: new Map([
        [accounts[0].address, accounts[0]],
        [accounts[1].address, accounts[1]],
      ]),
      gasOracle: new BaseGasOracle(publicClient),
      blockRetry: 5,
      blockCancel: 25,
    });
    const emitSpy = vi.spyOn(transactionManager, "emit");

    // send a transaction to monitor
    const transactionId1 = randomUUID();
    await transactionManager.send(
      transactionId1,
      ALICE,
      accounts[0].address,
      parseEther("0.1")
    );
    const transactionId2 = randomUUID();
    await transactionManager.send(
      transactionId2,
      ALICE,
      accounts[1].address,
      parseEther("0.1")
    );

    // Check that both wallets have a single transaction in the mempool
    const pendingAddress1 = await getPendingTxnsForAddress(accounts[0].address);
    const trackedAddress1 = transactionManager.pending.get(transactionId1)!;

    const pendingAddress2 = await getPendingTxnsForAddress(accounts[1].address);
    const trackedAddress2 = transactionManager.pending.get(transactionId2)!;

    expect(pendingAddress1.length).to.eq(1);
    expect(pendingAddress2.length).to.eq(1);

    expect(emitSpy).toHaveBeenCalledWith(
      `${TransactionEvent.submitted}-${transactionId1}`,
      {
        nonce: 0,
        hash: pendingAddress1[0].hash,
        fees: trackedAddress1.fees,
        from: accounts[0].address,
      }
    );

    expect(emitSpy).toHaveBeenCalledWith(
      `${TransactionEvent.submitted}-${transactionId2}`,
      {
        nonce: 0,
        hash: pendingAddress2[0].hash,
        fees: trackedAddress2.fees,
        from: accounts[1].address,
      }
    );

    await mineAndProcessBlocks(transactionManager, 1, 1000);

    // Check that both wallet had their transactions mined
    expect(transactionManager.pending.has(transactionId1)).toBe(false);
    expect(transactionManager.pending.has(transactionId2)).toBe(false);
    const pendingAddressAfter1 = await getPendingTxnsForAddress(
      accounts[0].address
    );
    expect(pendingAddressAfter1.length).to.eq(0);
    const pendingAddressAfter2 = await getPendingTxnsForAddress(
      accounts[1].address
    );
    expect(pendingAddressAfter2.length).to.eq(0);

    expect(emitSpy).toHaveBeenCalledWith(
      `${TransactionEvent.included}-${transactionId1}`,
      {
        nonce: 0,
        hash: pendingAddress1[0].hash,
        fees: trackedAddress1.fees,
        from: accounts[0].address,
      }
    );

    expect(emitSpy).toHaveBeenCalledWith(
      `${TransactionEvent.included}-${transactionId2}`,
      {
        nonce: 0,
        hash: pendingAddress2[0].hash,
        fees: trackedAddress2.fees,
        from: accounts[1].address,
      }
    );
  });

  // TODO
  // Retry when the transaction has already been mined
  // Cancel when the transaction has already been mined
  // Start testing events emitted
  // Tidy up in general v/ messy right now
});
