import { foundry } from "viem/chains";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { NonceManagedWallet } from "../NonceManagedWallet.js";
import { ALICE, BOB } from "./constants.js";
import { publicClient, testClient, ws, walletClient } from "./utils.js";
import { type Address, webSocket, parseEther, createWalletClient } from "viem";
import { test, describe } from "vitest";

describe("Nonce Managed Wallet", () => {
  test("Can send Transaction", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const client = createWalletClient({
      account,
      chain: foundry,
      transport: ws,
    });
    await testClient.setBalance({
      address: account.address,
      value: parseEther("1"),
    });
    const hash = await client.sendTransaction({ value: parseEther("0.5") });

    console.log(`Send transaction here's the hash ${hash}`);

    const nonceManagedWallet = new NonceManagedWallet(account, ws, foundry);
    await testClient.setBalance({
      address: nonceManagedWallet.address,
      value: parseEther("1"),
    });

    const testBalance = await publicClient.getBalance({
      address: account.address,
    });
    console.log(`test balance: ${testBalance}`);

    const test = await nonceManagedWallet.send(ALICE, parseEther("0.5"));

    const aliceBalance = await publicClient.getBalance({ address: ALICE });

    await testClient.mine({ blocks: 1 });
  });
});
