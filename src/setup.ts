import { privateKeyToAccount } from "viem/accounts";
import { NonceManagedWallet } from "./NonceManagedWallet";
import {
  Address,
  PrivateKeyAccount,
  createPublicClient,
  webSocket,
} from "viem";
import { MongoRequestRepository } from "./RequestRepository";
import { TransactionManager } from "./TransactionManager";
import { chainIdToViemChain } from "./TypesAndValidation";
import { BaseGasOracle } from "./gasOracle";
import { env } from "./env";
import { RequestMediator } from "./RequestMediator";

export async function setupMonitoring(): Promise<RequestMediator> {
  console.info(`Loading env...`);

  // parse wallets from private keys
  const accounts = env.KEYS.split(",").map((pk) =>
    privateKeyToAccount(pk as any)
  );

  // build transaction managers for each rpc url provided
  const managers = new Map<number, TransactionManager>();
  const webSockets = env.RPCS.split(",");
  const addManagerFromWebSocket = (ws: string) => {
    return buildManager(ws, accounts).then((manager) =>
      managers.set(manager.chain.id, manager)
    );
  };
  await Promise.all(webSockets.map(addManagerFromWebSocket));

  let accountLog = "Loaded accounts:";
  for (const account of accounts) {
    accountLog += "\n" + account.address;
  }
  console.info(accountLog);

  let chainLog = "Running on chains:";
  for (const manager of managers.values()) {
    chainLog += "\n" + manager.chain.name;
  }
  console.info(chainLog);

  return new RequestMediator(
    managers,
    new MongoRequestRepository(env.MONGO_DATABASE)
  );
}

async function buildManager(url: string, accounts: PrivateKeyAccount[]) {
  const ws = webSocket(url);
  const client = createPublicClient({ transport: ws });
  const chainId = await client.getChainId();

  const chain = chainIdToViemChain.get(Number(chainId));

  if (chain === undefined) {
    throw new Error(`chain with id ${chainId} not defined in code`);
  }

  const walletMap = new Map<Address, NonceManagedWallet>();
  accounts.forEach((account) =>
    walletMap.set(account.address, new NonceManagedWallet(account, ws, chain))
  );
  const oracle = new BaseGasOracle(client);
  return new TransactionManager({
    chain,
    client,
    managedWallets: walletMap,
    gasOracle: oracle,
    blockRetry: 3,
    blockCancel: 10,
  });
}
