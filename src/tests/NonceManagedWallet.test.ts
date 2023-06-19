import { foundry } from "viem/chains";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { NonceManagedWallet } from "../NonceManagedWallet.js";
import { ALICE, BOB } from "./constants.js";
import { publicClient, testChain, testClient } from "./utils.js";
import { createWalletClient, parseEther, webSocket } from "viem";
import { test, describe, expect } from "vitest";

describe("Nonce Managed Wallet", () => {
  test("Can send Transaction", async () => {
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
});
