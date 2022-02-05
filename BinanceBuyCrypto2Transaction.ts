import { fetchAssetPrice } from "./api/binance.ts";
import { DB } from "./deps.ts";

const binanceDB = new DB("db/binance.db");

binanceDB.query(`
  CREATE TABLE IF NOT EXISTS \`transaction\` (
    transactionID INTEGER PRIMARY KEY AUTOINCREMENT,
    type                  CHARACTER(20),
    refId                 INTEGER,
    asset                 CHARACTER(20),
    side                  BOOLEAN,
    amount                FLOAT,
    price                 FLOAT,
    timestamp             INTEGER,
    UNIQUE(type, refId, side)
  )
`);
const filename = "BuyHistory.csv";
import { parseCsv } from "./deps.ts";
const buyCryptoSpreadSheet = await parseCsv(
  await Deno.readTextFile(`db/${filename}`),
);
let row = 1;
for (const buyCryptoEntry of buyCryptoSpreadSheet) {
  const [date, c2, c3, priceString, c5, amountAndAsset, c7, c8] =
    buyCryptoEntry;
  const amount = amountAndAsset.replace(/[^\d.-]/g, "");
  const asset = amountAndAsset.replace(/[\d .-]/g, "");
  if (!amount.length || !priceString.length) continue;
  const price = parseFloat(priceString.replace(/[^\d.-]/g, ""));
  binanceDB.query(
    `INSERT OR IGNORE INTO \`transaction\` (
            type,
            refId,
            asset,
            side,
            amount,
            price,
            timestamp
          ) VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
          )`,
    [
      filename,
      row,
      asset,
      "IN",
      parseFloat(amount),
      price,
      Date.parse(date),
    ],
  );
  console.log(asset, price);
  row++;
}
binanceDB.close();