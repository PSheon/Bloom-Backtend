/**
 * package service
 */

import { factories } from "@strapi/strapi";

export default factories.createCoreService(
  "api::package.package",
  ({ strapi }) => ({})
);
