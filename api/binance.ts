import type { Row } from "https://deno.land/x/sqlite@v3.2.1/mod.ts";
import { fiatCurrency } from "../config.ts";
import { DB, sleep, Spot } from "../deps.ts";
import { binanceAPIaccess } from "./credentials.ts";
import type { transaction } from "./types.ts";
const { apiKey, secretKey } = binanceAPIaccess;
export const binance = new Spot(apiKey, secretKey);
export const autoRetry = async <T>(f: () => Promise<T>): Promise<T | false> => {
  try {
    return await f();
  } catch (e) {
    console.log(e);
    const timeout = Number(e.response.headers.get("retry-after"));
    if (timeout <= 0) {
      console.error(e);
      return false;
    }
    console.log(`waiting ${timeout} seconds`);
    await sleep(timeout);
    return await f();
  }
};

/* VERSION TO IMPLEMENT
export const autoRetry = <F extends CallableFunction>(f: F) => async(...args: Parameters<F>) => {
    try {
      return await f(...args);
    } catch (err) {
        console.log(err);
        const timeout = Number(err.response.headers.get('retry-after'));
        if(timeout <= 0) {
          console.error(err.response.data.msg);
          return false;
        }
        console.log(`waiting ${timeout} seconds`);
        await sleep(timeout);
        return true;
    }
  };
*/

export const getAvgPrice = async (
  pair: string,
  timestamp: number,
): Promise<number | boolean> => {
  const candlesResponse = await autoRetry(
    () =>
      binance.klines(
        pair,
        "1m",
        { limit: 1, startTime: new Date(timestamp).setSeconds(0, 0) },
      ),
  );
  if (!(candlesResponse && "data" in candlesResponse)) return false;
  const candlesData = candlesResponse.data;
  if (!candlesData.length) {
    console.log("no candle found");
    return false;
  }
  const firstCandle = candlesData[0];
  const candleOpenPrice = Number(firstCandle[1]);
  const candleClosePrice = Number(firstCandle[4]);
  return (candleOpenPrice + candleClosePrice) / 2;
};

export const fetchAssetPrice = async (
  asset: string,
  timestamp: number,
  pairs: Row[],
): Promise<number | boolean> => {
  if (asset === fiatCurrency) {
    console.log(asset, " is fiat, returning 1");
    return 1;
  }
  console.log();
  console.log();
  console.log("fetching price for: ", asset);
  const fiatPairsData = pairs.filter((pair: Row) =>
    pair[0] === fiatCurrency || pair[1] === fiatCurrency
  );
  const fiatPairs = fiatPairsData.map((fiatPair) => ({
    baseAsset: String(fiatPair[0]),
    quoteAsset: String(fiatPair[1]),
  }));
  console.log("checking if asset is a fiat pair");
  for (const fiatPair of fiatPairs) {
    if (asset === fiatPair.baseAsset) {
      console.log("requesting pair: ", `${asset}${fiatCurrency}`);
      const avgPrice = await getAvgPrice(
        `${asset}${fiatCurrency}`,
        timestamp,
      );
      if (!(avgPrice && typeof avgPrice === "number")) continue;
      console.log("result: ", avgPrice);
      return avgPrice;
    } else if (asset === fiatPair.quoteAsset) {
      console.log("requesting pair: ", `${fiatCurrency}${asset}`);
      const avgInvertedPrice = await getAvgPrice(
        `${fiatCurrency}${asset}`,
        timestamp,
      );
      console.log("result: ", avgInvertedPrice);
      if (!(avgInvertedPrice && typeof avgInvertedPrice === "number")) continue;
      return 1 / avgInvertedPrice;
    }
    console.log(`${asset} not in ${fiatPair.baseAsset}${fiatPair.quoteAsset}`);
  }
  console.log("iterating asset over fiat pairs");
  for (const fiatPair of fiatPairs) {
    const transitoryPairsData = pairs.filter((pair: Row) =>
      (
        pair[0] === asset && pair[1] === fiatPair.quoteAsset
      ) ||
      (
        pair[0] === fiatPair.quoteAsset && pair[1] === asset
      )
    );
    if (!transitoryPairsData || !transitoryPairsData.length) continue;
    const [baseTransitoryAsset, quoteTransitoryAsset] = transitoryPairsData[0]
      .map((result) => String(result));
    let avgTransitoryPrice;
    let transitoryAsset;
    if (asset === baseTransitoryAsset) {
      console.log("requesting pair", `${asset}${quoteTransitoryAsset}`);
      transitoryAsset = quoteTransitoryAsset;
      avgTransitoryPrice = await getAvgPrice(
        `${asset}${quoteTransitoryAsset}`,
        timestamp,
      );
      if (!(avgTransitoryPrice && typeof avgTransitoryPrice === "number")) {
        continue;
      }
    } else if (asset === quoteTransitoryAsset) {
      console.log("requesting pair", `${baseTransitoryAsset}${asset}`);
      transitoryAsset = baseTransitoryAsset;
      const avgInvertedTransitoryPrice = await getAvgPrice(
        `${baseTransitoryAsset}${asset}`,
        timestamp,
      );
      if (
        !(avgInvertedTransitoryPrice &&
          typeof avgInvertedTransitoryPrice === "number")
      ) {
        continue;
      }
      avgTransitoryPrice = 1 / avgInvertedTransitoryPrice;
    }
    console.log("result: ", avgTransitoryPrice);
    if (
      !(
        avgTransitoryPrice &&
        typeof avgTransitoryPrice === "number" &&
        (
          transitoryAsset === baseTransitoryAsset ||
          transitoryAsset === quoteTransitoryAsset
        )
      )
    ) {
      console.log(
        `${asset} not in ${baseTransitoryAsset}${quoteTransitoryAsset}`,
      );
      continue;
    }
    for (const fiatPair of fiatPairs) {
      if (transitoryAsset === fiatPair.quoteAsset) {
        console.log("requesting pair", `${fiatCurrency}${transitoryAsset}`);
        const avgPrice = await getAvgPrice(
          `${fiatCurrency}${transitoryAsset}`,
          timestamp,
        );
        console.log("result: ", avgPrice);
        if (!(avgPrice && typeof avgPrice === "number")) {
          continue;
        }
        return avgTransitoryPrice / avgPrice;
      } else if (transitoryAsset === fiatPair.baseAsset) {
        console.log("requesting pair", `${transitoryAsset}${fiatCurrency}`);
        const avgInvertedPrice = await getAvgPrice(
          `${transitoryAsset}${fiatCurrency}`,
          timestamp,
        );
        console.log("result: ", avgInvertedPrice);
        if (!(avgInvertedPrice && typeof avgInvertedPrice === "number")) {
          continue;
        }
        return avgInvertedPrice * avgTransitoryPrice;
      }
    }
  }
  console.log(`no price found for ${asset}`);
  return false;
};

export const BinanceTrade = (db: DB) => ({
  init: () =>
    db.query(`
  CREATE TABLE IF NOT EXISTS trade (
    tradeID INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol                CHARACTER(20),
    orderId               INTEGER,
    orderListId           INTEGER,
    clientOrderId         VARCHAR(50),
    price                 FLOAT,
    origQty               FLOAT,
    executedQty           FLOAT,
    cummulativeQuoteQty   FLOAT,
    status                CHARACTER(20),
    timeInForce           CHARACTER(20),
    type                  CHARACTER(20),
    side                  CHARACTER(20),
    stopPrice             FLOAT,
    icebergQty            FLOAT,
    time                  INTEGER,
    updateTime            INTEGER,
    isWorking             BOOLEAN,
    origQuoteOrderQty     FLOAT,
    UNIQUE(orderId)
  )
`),
  add: (trade: any) =>
    db.query(
      `INSERT OR IGNORE INTO trade (
      symbol,
      orderId,
      orderListId,
      clientOrderId,
      price,
      origQty,
      executedQty,
      cummulativeQuoteQty,
      status,
      timeInForce,
      type,
      side,
      stopPrice,
      icebergQty,
      time,
      updateTime,
      isWorking,
      origQuoteOrderQty
    ) VALUES (
      :symbol,
      :orderId,
      :orderListId,
      :clientOrderId,
      :price,
      :origQty,
      :executedQty,
      :cummulativeQuoteQty,
      :status,
      :timeInForce,
      :type,
      :side,
      :stopPrice,
      :icebergQty,
      :time,
      :updateTime,
      :isWorking,
      :origQuoteOrderQty
    )`,
      trade,
    ),
});

export const BinanceTransaction = (db: DB) => ({
  init: () =>
    db.query(`
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
    `),
  add: (transaction: transaction) =>
    db.query(
      `INSERT OR IGNORE INTO \`transaction\` (
        type, refId, asset, side, amount, price, timestamp
      ) VALUES (
        :type, :refId, :asset, :side, :amount, :price, :timestamp
      )`,
      transaction,
    ),
});
