import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  NonceAlreadyIncludedError,
  NonceManagedWallet,
} from "../NonceManagedWallet.js";
import { ALICE } from "./constants.js";
import {
  publicClient,
  testChain,
  testClient,
  getPendingTxnsForAddress,
} from "./utils.js";
import { parseEther, webSocket } from "viem";
import { test, describe, expect } from "vitest";

describe("Nonce Managed Wallet", () => {
  test("Can send many transactions in parallel", async () => {
    const nonceManagedWallet = new NonceManagedWallet(
      privateKeyToAccount(generatePrivateKey()),
      webSocket(),
      testChain
    );

    await testClient.setBalance({
      address: nonceManagedWallet.address,
      value: parseEther("1"),
    });

    await Promise.all([
      nonceManagedWallet.send(ALICE, parseEther("0.1")),
      nonceManagedWallet.send(ALICE, parseEther("0.1")),
      nonceManagedWallet.send(ALICE, parseEther("0.1")),
      nonceManagedWallet.send(ALICE, parseEther("0.1")),
      nonceManagedWallet.send(ALICE, parseEther("0.1")),
    ]);

    await testClient.setBalance({
      address: nonceManagedWallet.address,
      value: parseEther("1"),
    });

    const aliceBalanceBefore = await publicClient.getBalance({
      address: ALICE,
    });
    await testClient.mine({ blocks: 1 });
    const aliceBalanceAfter = await publicClient.getBalance({ address: ALICE });

    expect(aliceBalanceAfter).to.eq(aliceBalanceBefore + parseEther("0.5"));
  });

  test("Can recover from nonce to low errors when sending transactions", async () => {
    const nonceManagedWallet = new NonceManagedWallet(
      privateKeyToAccount(generatePrivateKey()),
      webSocket(),
      testChain
    );

    await testClient.setBalance({
      address: nonceManagedWallet.address,
      value: parseEther("1"),
    });

    await nonceManagedWallet.send(ALICE, parseEther("0.1"));
    await testClient.mine({ blocks: 1 });

    await testClient.setNonce({
      address: nonceManagedWallet.address,
      nonce: 50,
    });

    const { hash } = await nonceManagedWallet.send(ALICE, parseEther("0.1"));
    await testClient.mine({ blocks: 1 });

    const tx = await publicClient.getTransaction({
      hash,
    });

    expect(tx.nonce).to.eq(50);
  });

  test("Can retry a transaction", async () => {
    const nonceManagedWallet = new NonceManagedWallet(
      privateKeyToAccount(generatePrivateKey()),
      webSocket(),
      testChain
    );

    await testClient.setBalance({
      address: nonceManagedWallet.address,
      value: parseEther("1"),
    });

    const { hash } = await nonceManagedWallet.send(ALICE, parseEther("0.1"));
    const txn = await publicClient.getTransaction({ hash });
    const retryHash = await nonceManagedWallet.replace({
      to: txn.to!,
      value: txn.value,
      nonce: txn.nonce,
      fees: {
        maxFeePerGas: txn.maxFeePerGas! * 2n,
        maxPriorityFeePerGas: txn.maxPriorityFeePerGas! * 2n,
      },
    });

    expect(retryHash).to.not.eq(hash);

    // first transaction was replaced in the mempool

    const pending = await getPendingTxnsForAddress(nonceManagedWallet.address);
    expect(pending.length).to.eq(1);
    expect(pending[0].hash).to.equal(retryHash);

    // test that replacement transaction goes through
    await testClient.mine({ blocks: 1 });
    const confirmations = await publicClient.getTransactionConfirmations({
      hash: retryHash,
    });

    expect(confirmations > 0n);
  });

  test("If the previous transaction was mined, retrying will throw a special error", async () => {
    const nonceManagedWallet = new NonceManagedWallet(
      privateKeyToAccount(generatePrivateKey()),
      webSocket(),
      testChain
    );

    await testClient.setBalance({
      address: nonceManagedWallet.address,
      value: parseEther("1"),
    });

    const { hash } = await nonceManagedWallet.send(ALICE, parseEther("0.1"));
    const txn = await publicClient.getTransaction({ hash });
    await testClient.mine({ blocks: 1 });

    await expect(() =>
      nonceManagedWallet.replace({
        to: txn.to!,
        value: txn.value,
        nonce: txn.nonce,
        fees: {
          maxFeePerGas: txn.maxFeePerGas! * 2n,
          maxPriorityFeePerGas: txn.maxPriorityFeePerGas! * 2n,
        },
      })
    ).rejects.toThrowError(
      new NonceAlreadyIncludedError(txn.nonce, nonceManagedWallet.address)
    );
  });
});
