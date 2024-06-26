import { ExactNumber as N } from "exactnumber";
import { isNil, isPlainObject } from "lodash/fp";
import { parseMultipartData } from "@strapi/utils";
import type Koa from "koa";
import type { Common, Schema, UID } from "@strapi/types";

type TransformedEntry = {
  id: string;
  attributes: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

type TransformedComponent = {
  id: string;
  [key: string]: unknown;
};

type Entry = {
  id: string;
  [key: string]: Entry | Entry[] | string | number | null | boolean | Date;
};

export function getPeriodBonusAPY(periodInDays: number = 7) {
  const PERIOD_TABLE = [
    {
      period: 7,
      apyBonus: 0,
    },
    {
      period: 30,
      apyBonus: 0.8,
    },
    {
      period: 60,
      apyBonus: 2.4,
    },
  ];

  if (periodInDays === PERIOD_TABLE[0].period) {
    return PERIOD_TABLE[0].apyBonus;
  } else if (periodInDays === PERIOD_TABLE[1].period) {
    return PERIOD_TABLE[1].apyBonus;
  } else if (periodInDays === PERIOD_TABLE[2].period) {
    return PERIOD_TABLE[2].apyBonus;
  } else {
    return 0;
  }
}

export function getLevelBonusAPY(currentExp: number = 0) {
  const LEVEL_TABLE = [
    {
      level: 1,
      title: "Digital Star ⭐",
      expCap: 300,
      apyBonus: 0,
    },
    {
      level: 2,
      title: "Digital Star ⭐⭐",
      expCap: 750,
      apyBonus: 0.3,
    },
    {
      level: 3,
      title: "Decentralized Elite ⭐",
      expCap: 1_250,
      apyBonus: 0.8,
    },
    {
      level: 4,
      title: "Decentralized Elite ⭐⭐",
      expCap: 1_800,
      apyBonus: 1.25,
    },
    {
      level: 5,
      title: "Decentralized Elite ⭐⭐⭐",
      expCap: 2_500,
      apyBonus: 1.5,
    },
    {
      level: 6,
      title: "Crypto Navigator ⭐",
      expCap: 3_500,
      apyBonus: 2,
    },
    {
      level: 7,
      title: "Crypto Navigator ⭐⭐",
      expCap: 3_500,
      apyBonus: 2.2,
    },
    {
      level: 8,
      title: "Crypto Navigator ⭐⭐⭐",
      expCap: 5_000,
      apyBonus: 2.8,
    },
    {
      level: 9,
      title: "Blockchain Titan",
      expCap: 8_000,
      apyBonus: 5,
    },
  ];

  if (0 <= currentExp && currentExp < LEVEL_TABLE[0].expCap) {
    return LEVEL_TABLE[0].apyBonus;
  } else if (currentExp <= LEVEL_TABLE[1].expCap) {
    return LEVEL_TABLE[1].apyBonus;
  } else if (currentExp <= LEVEL_TABLE[2].expCap) {
    return LEVEL_TABLE[2].apyBonus;
  } else if (currentExp <= LEVEL_TABLE[3].expCap) {
    return LEVEL_TABLE[3].apyBonus;
  } else if (currentExp <= LEVEL_TABLE[4].expCap) {
    return LEVEL_TABLE[4].apyBonus;
  } else if (currentExp <= LEVEL_TABLE[5].expCap) {
    return LEVEL_TABLE[5].apyBonus;
  } else if (currentExp <= LEVEL_TABLE[6].expCap) {
    return LEVEL_TABLE[6].apyBonus;
  } else if (currentExp <= LEVEL_TABLE[7].expCap) {
    return LEVEL_TABLE[7].apyBonus;
  } else if (currentExp <= LEVEL_TABLE[8].expCap) {
    return LEVEL_TABLE[8].apyBonus;
  } else {
    return 5;
  }
}

function isEntry(property: unknown): property is Entry | Entry[] {
  return (
    property === null || isPlainObject(property) || Array.isArray(property)
  );
}

function isDZEntries(
  property: unknown
): property is (Entry & { __component: UID.Component })[] {
  return Array.isArray(property);
}

const parseBody = (ctx: Koa.Context) => {
  if (ctx.is("multipart")) {
    return parseMultipartData(ctx);
  }

  const { data } = ctx.request.body || {};

  return { data };
};

const transformResponse = (
  resource: any,
  meta: unknown = {},
  opts: { contentType?: Schema.ContentType | Schema.Component } = {}
) => {
  if (isNil(resource)) {
    return resource;
  }

  return {
    data: transformEntry(resource, opts?.contentType),
    meta,
  };
};

function transformComponent<T extends Entry | Entry[] | null>(
  data: T,
  component: Schema.Component
): T extends Entry[]
  ? TransformedComponent[]
  : T extends Entry
  ? TransformedComponent
  : null;
function transformComponent(
  data: Entry | Entry[] | null,
  component: Schema.Component
): TransformedComponent | TransformedComponent[] | null {
  if (Array.isArray(data)) {
    return data.map((datum) => transformComponent(datum, component));
  }

  const res = transformEntry(data, component);

  if (isNil(res)) {
    return res;
  }

  const { id, attributes } = res;
  return { id, ...attributes };
}

function transformEntry<T extends Entry | Entry[] | null>(
  entry: T,
  type?: Schema.ContentType | Schema.Component
): T extends Entry[]
  ? TransformedEntry[]
  : T extends Entry
  ? TransformedEntry
  : null;
function transformEntry(
  entry: Entry | Entry[] | null,
  type?: Schema.ContentType | Schema.Component
): TransformedEntry | TransformedEntry[] | null {
  if (isNil(entry)) {
    return entry;
  }

  if (Array.isArray(entry)) {
    return entry.map((singleEntry) => transformEntry(singleEntry, type));
  }

  if (!isPlainObject(entry)) {
    throw new Error("Entry must be an object");
  }

  const { id, ...properties } = entry;

  const attributeValues: Record<string, unknown> = {};

  for (const key of Object.keys(properties)) {
    const property = properties[key];
    const attribute = type && type.attributes[key];

    if (
      attribute &&
      attribute.type === "relation" &&
      isEntry(property) &&
      "target" in attribute
    ) {
      const data = transformEntry(
        property,
        strapi.contentType(attribute.target as Common.UID.ContentType)
      );

      attributeValues[key] = { data };
    } else if (
      attribute &&
      attribute.type === "component" &&
      isEntry(property)
    ) {
      attributeValues[key] = transformComponent(
        property,
        strapi.components[attribute.component]
      );
    } else if (
      attribute &&
      attribute.type === "dynamiczone" &&
      isDZEntries(property)
    ) {
      if (isNil(property)) {
        attributeValues[key] = property;
      }

      attributeValues[key] = property.map((subProperty) => {
        return transformComponent(
          subProperty,
          strapi.components[subProperty.__component]
        );
      });
    } else if (attribute && attribute.type === "media" && isEntry(property)) {
      const data = transformEntry(
        property,
        strapi.contentType("plugin::upload.file")
      );

      attributeValues[key] = { data };
    } else {
      attributeValues[key] = property;
    }
  }

  return {
    id,
    attributes: attributeValues,
    // NOTE: not necessary for now
    // meta: {},
  };
}

function getExpectInterestBalanceString(
  balance: bigint,
  apy: number,
  periodInDays: number
): string {
  const formattedApy = 1 + Math.min(Math.max(apy, 1), 24) / 100;
  const interestRatePerDay = Math.pow(formattedApy, 1 / 365);
  const multiplier = Math.pow(interestRatePerDay, periodInDays);

  return N(balance)
    .mul(N(multiplier.toFixed(6)).sub(1))
    .toString();
}

export { parseBody, transformResponse, getExpectInterestBalanceString };
