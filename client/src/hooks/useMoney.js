import { useApp } from './useApp';

/**
 * Prices in the signed-in account's own currency.
 *
 * Everything on screen has to agree with what the server will charge, so the figures come from the
 * pricebook the server sent rather than from anything compiled into this bundle: prices are edited
 * from the dashboard, and a stale build must not go on quoting last month's. The region still comes
 * from the country on the account, which is what stops a cheaper price being a request away.
 */
export function useMoney() {
  const { user, prices } = useApp();
  const region = prices.regionFor(user);
  return {
    region,
    onSale: prices.sellsTo(user),
    money: amount => prices.money(amount, region),
    priceOf: planId => prices.premiumPrice(planId, user),
    seatRate: planId => prices.seatPrice(planId, user),
    currencyNote: () => prices.currencyNote(region),
  };
}
