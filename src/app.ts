import express, { Application, NextFunction, Request, Response } from "express";
import { TransactionManager } from "./TransactionManager";
import { foundry } from "viem/chains";
import { createPublicClient, webSocket } from "viem";
import { NonceManagedWallet } from "./NonceManagedWallet";
import { privateKeyToAccount } from "viem/accounts";
import { BaseGasOracle } from "./gasOracle";
import { RequestMediator } from "./RequestMediator";
import { MongoRequestRepository } from "./MongoRequestRepo";
import "dotenv/config";
import { createRequestInput, strictUUID } from "./TypesAndValidation";

const app: Application = express();
const port: number = 3001;
app.use(express.json());

const account = privateKeyToAccount(process.env.PK! as any);
const client = createPublicClient({ chain: foundry, transport: webSocket() });
const managedWallet = new NonceManagedWallet(account, webSocket(), foundry);
const oracle = new BaseGasOracle(client);
const manager = new TransactionManager(
  foundry,
  client,
  managedWallet,
  oracle,
  3
);
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

app.post("/tx", async (req: Request, res: Response, next: NextFunction) => {
  const result = createRequestInput.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json(result.error.format());
  }
  const { to, value, data } = result.data;

  try {
    const id = await mediator.start(to, value, data);
    return res.status(200).json({ id });
  } catch (error) {
    next(error);
  }
});

app.get("/tx/:id", async (req: Request, res: Response, next: NextFunction) => {
  const result = strictUUID.safeParse(req.params.id);
  if (!result.success) {
    return res.status(400).json(result.error.format());
  }
  const id = result.data;

  try {
    const request = await mediator.find(id);

    if (request === null) {
      return res.status(404);
    }
    return res.status(200).json(request);
  } catch (error) {
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
