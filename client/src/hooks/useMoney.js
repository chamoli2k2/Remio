import { useApp } from './useApp';
import { formatMoney, premiumPrice, regionFor, seatPrice } from '../../../shared/pricing.js';

/**
 * Prices in the signed-in account's own currency.
 *
 * Everything on screen has to agree with what the server will charge, and the server prices from
 * the country on the account. Reading it from the same place here is what keeps a buyer from being
 * quoted one figure and billed another.
 */
export function useMoney() {
  const { user } = useApp();
  const region = regionFor(user);
  return {
    region,
    money: amount => formatMoney(amount || 0, region),
    priceOf: planId => premiumPrice(planId, user),
    seatRate: planId => seatPrice(planId, user),
  };
}
