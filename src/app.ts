import express, { Application, NextFunction, Request, Response } from "express";
import { TransactionManager } from "./TransactionManager";
import { foundry } from "viem/chains";
import { createPublicClient, webSocket } from "viem";
import { NonceManagedWallet } from "./NonceManagedWallet";
import { privateKeyToAccount } from "viem/accounts";
import { BaseGasOracle } from "./gasOracle";
import { RequestMediator } from "./RequestMediator";
import { MongoRequestRepository } from "./MongoRequestRepo";
import {
  createRequestInput,
  hexWithPrefix,
  strictUUID,
} from "./TypesAndValidation";
import { env } from "./env";
import { ZodError } from "zod";

const app: Application = express();
const port: number = 3001;
app.use(express.json());

const client = createPublicClient({ chain: foundry, transport: webSocket() });
const wallets = env.KEYS.split(",").map((pk) => {
  const account = privateKeyToAccount(pk as any);
  return new NonceManagedWallet(account, webSocket(), foundry);
});
const oracle = new BaseGasOracle(client);
const manager = new TransactionManager(foundry, client, wallets, oracle, 3);
const repo = new MongoRequestRepository(process.env.MONGO_DATABASE! as any);
const mediator = new RequestMediator(manager, repo);

// Make sure events emitted from handler don't stop the node process
manager.on("error", (error) => {
  console.error("An error occurred on the transaction manager", error);
  // handle error
});

process.on("uncaughtException", (err) => {
  console.error("There was an uncaught error", err);
  // process.exit(1); //mandatory (as per the Node.js docs)
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  // process.exit(1); //mandatory (as per the Node.js docs)
});

app.post(
  "/key/:address/tx",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { to, value, data } = createRequestInput.parse(req.body);
      const address = hexWithPrefix.parse(req.params.address);

      const id = await mediator.start(to, address, value, data);
      return res.status(200).json({ id });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json(error.format());
      }

      next(error);
    }
  }
);

app.get("/tx/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = strictUUID.parse(req.params.id);
    const request = await mediator.find(id);

    if (request === null) {
      return res.status(404);
    }
    return res.status(200).json(request);
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json(error.format());
    }

    next(error);
  }
});

// Error handling middleware
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

app.listen(port, function () {
  console.log(`App is listening on port ${port} !`);
});
