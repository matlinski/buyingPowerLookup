import { Binance2Transaction } from "./api/binance.ts";
import { DB, parseCsv } from "./deps.ts";

const b2t = Binance2Transaction(new DB("db/binance.db"));
b2t.init();
const filename = "SellHistory.csv";
const transactionBundle = (
  await parseCsv(
    await Deno.readTextFile(`db/${filename}`),
  )
).map((data: array, row: nunber) => {
  const [date, c2, amountAndAsset, priceString, c5, c6, c7, c8] = data;
  const dateUTC = new Date(date);
  dateUTC.setHours(dateUTC.getHours() + 1);
  const createTime = dateUTC.getTime();
  const amount = amountAndAsset.replace(/[^\d.-]/g, "");
  const asset = amountAndAsset.replace(/[\d .-]/g, "");
  if (!amount.length || !priceString.length) return null;
  const price = parseFloat(priceString.replace(/[^\d.-]/g, ""));
  return [
    {
      type: filename,
      refId: row,
      asset: asset,
      side: "OUT",
      amount: parseFloat(amount),
      price: price,
      timestamp: createTime,
    },
  ];
});
for (const transactions of transactionBundle) {
  if (!transactions) continue;
  for (const transaction of transactions) {
    b2t.add(transaction);
  }
}
b2t.close();