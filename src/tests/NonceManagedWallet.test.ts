import { foundry } from "viem/chains";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { NonceManagedWallet } from "../NonceManagedWallet.js";
import { ALICE, BOB } from "./constants.js";
import { publicClient, testChain, testClient } from "./utils.js";
import { createWalletClient, parseEther, webSocket } from "viem";
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

    await testClient.setNonce({
      address: nonceManagedWallet.address,
      nonce: 50,
    });
    await nonceManagedWallet.send(ALICE, parseEther("0.05"));

    await testClient.mine({ blocks: 1 });

    const aliceBalanceAfter2 = await publicClient.getBalance({
      address: ALICE,
    });

    expect(aliceBalanceAfter2).to.eq(aliceBalanceAfter + parseEther("0.05"));
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

    const hash = await nonceManagedWallet.send(ALICE, parseEther("0.1"));
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

    const hash = await nonceManagedWallet.send(ALICE, parseEther("0.1"));
    const txn = await publicClient.getTransaction({ hash });
    const retryHash = await nonceManagedWallet.retry({
      to: txn.to!,
      value: txn.value,
      nonce: txn.nonce,
      maxFeePerGas: txn.maxFeePerGas! * 2n,
      maxPriorityFeePerGas: txn.maxPriorityFeePerGas! * 2n,
      previousHash: hash,
    });

    expect(retryHash).to.not.eq(hash);

    // first transaction was replaced in the mempool
    const content = await testClient.getTxpoolContent();
    const pending =
      content.pending[
        nonceManagedWallet.address.toLowerCase() as `0x${string}`
      ];

    expect(pending["0"].hash).to.equal(retryHash);

    // test that replacement transaction goes through
    await testClient.mine({ blocks: 1 });
    const confirmations = await publicClient.getTransactionConfirmations({
      hash: retryHash,
    });

    expect(confirmations > 0n);
  });

  test("If the previous transaction was mined, retrying will return the mined hash", async () => {
    const nonceManagedWallet = new NonceManagedWallet(
      privateKeyToAccount(generatePrivateKey()),
      webSocket(),
      testChain
    );

    await testClient.setBalance({
      address: nonceManagedWallet.address,
      value: parseEther("1"),
    });

    const hash = await nonceManagedWallet.send(ALICE, parseEther("0.1"));
    const txn = await publicClient.getTransaction({ hash });
    await testClient.mine({ blocks: 1 });

    const retryHash = await nonceManagedWallet.retry({
      to: txn.to!,
      value: txn.value,
      nonce: txn.nonce,
      maxFeePerGas: txn.maxFeePerGas! * 2n,
      maxPriorityFeePerGas: txn.maxPriorityFeePerGas! * 2n,
      previousHash: hash,
    });

    expect(retryHash).to.eq(hash);
  });
});
