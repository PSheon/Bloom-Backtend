/**
 * wallet service
 */

import { factories } from "@strapi/strapi";

export default factories.createCoreService(
  "api::wallet.wallet",
  ({ strapi }) => ({})
);
