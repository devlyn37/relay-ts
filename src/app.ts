import express, { Application, Request, Response } from "express";
import { TransactionManager } from "./TransactionManager";
import { goerli, polygonMumbai } from "viem/chains";
import { parseEther, webSocket } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const txManager = new TransactionManager(
  polygonMumbai,
  webSocket(
    "wss://polygon-mumbai.g.alchemy.com/v2/bDtkZcHKjEo6ZD8BCGW5A0qh4tv10qnh"
  ),
  privateKeyToAccount(process.env.PK as any)
);
const app: Application = express();

const port: number = 3001;

app.post("/tx", (req: Request, res: Response) => {
  // TODO Validate XD
  const id = txManager.send(
    req.body.to as any,
    parseEther(req.body.value),
    req.body.data
  );
  res.send(id);
});

app.listen(port, function () {
  console.log(`App is listening on port ${port} !`);
});
