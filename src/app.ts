import express, { Application, Request, Response } from "express";
import { TransactionManager } from "./TransactionManager";
import { goerli, polygonMumbai } from "viem/chains";
import { webSocket } from "viem";

const txManager = new TransactionManager(
  polygonMumbai,
  webSocket(
    "wss://polygon-mumbai.g.alchemy.com/v2/bDtkZcHKjEo6ZD8BCGW5A0qh4tv10qnh"
  )
);
const app: Application = express();

const port: number = 3001;

app.post("/tx", (req: Request, res: Response) => {
  const id = txManager.send();
  res.send(id);
});

app.listen(port, function () {
  console.log(`App is listening on port ${port} !`);
});
