/**
 * Fetch Token Transactions Task
 */

import { Strapi } from "@strapi/strapi";

import { Alchemy, Network } from "alchemy-sdk";
import Web3 from "web3";
import { ExactNumber as N } from "exactnumber";

import {
  TRANSFER_TOKEN_EVENT_HASH,
  TRANSFER_TOKEN_EVENT_ABI,
  TRANSFER_VALUE_EVENT_HASH,
  TRANSFER_VALUE_EVENT_ABI,
  SLOT_CHANGED_EVENT_HASH,
  SLOT_CHANGED_EVENT_ABI,
} from "./abi";

const alchemy = new Alchemy({
  apiKey: process.env.ALCHEMY_ETHEREUM_SEPOLIA_KEY,
  network: Network.ETH_SEPOLIA,
});
const web3 = new Web3(Web3.givenProvider);

export const fetchTokenEventLogTask = async ({
  strapi,
}: {
  strapi: Strapi;
}) => {
  let latestTokenEventLogBlockNumber = 0;
  let latestTokenEventLogIndex = 0;

  /* Step 01 - Check Fund exists */
  const fundEntities = await strapi.entityService.findMany("api::fund.fund", {
    populate: ["sft", "defaultPackages", "vault"],
  });
  if (fundEntities.length === 0) {
    return;
  }

  /* Step 02 - Find watch sft contract addresses */
  const watchSFTContracts = fundEntities
    .map((fundEntity) => {
      if (fundEntity?.sft?.contractAddress) {
        return fundEntity.sft.contractAddress;
      } else {
        return null;
      }
    })
    .filter((contractAddress) => contractAddress !== null);
  if (watchSFTContracts.length === 0) {
    return;
  }

  /* Step 03 - Find latest event log entity */
  const tokenEventLogEntities = await strapi.entityService.findMany(
    "api::event-log.event-log",
    {
      start: 0,
      limit: 1,
      sort: "createdAt:desc",
    }
  );
  if (tokenEventLogEntities.length !== 0) {
    latestTokenEventLogBlockNumber = tokenEventLogEntities[0].blockNumber;
    latestTokenEventLogIndex = tokenEventLogEntities[0].logIndex;
  }

  /* Step 04 - Fetch logs from blockchain */
  const txLogsResponse = await alchemy.core.getLogs({
    fromBlock: latestTokenEventLogBlockNumber,
    address: watchSFTContracts,
    topics: [
      [
        TRANSFER_TOKEN_EVENT_HASH,
        TRANSFER_VALUE_EVENT_HASH,
        SLOT_CHANGED_EVENT_HASH,
      ],
    ],
  });

  for await (let txLog of txLogsResponse) {
    if (
      latestTokenEventLogBlockNumber === txLog.blockNumber &&
      latestTokenEventLogIndex >= txLog.logIndex
    ) {
      continue;
    }

    const topics = txLog.topics;
    const eventNameHash = topics[0];
    const fundEntity = fundEntities.find(
      (fund) =>
        fund.sft.contractAddress.toLowerCase() === txLog.address.toLowerCase()
    );

    /* Detect log action - MintPackage, TransferToken, TransferValue, ChangeSlot, Stake, Unstake, Burn */
    if (eventNameHash === TRANSFER_VALUE_EVENT_HASH) {
      const { _fromTokenId, _toTokenId, _value } = web3.eth.abi.decodeLog(
        TRANSFER_VALUE_EVENT_ABI,
        txLog.data,
        txLog.topics.slice(1)
      );

      /* ------------ TransferValue ------------ */
      await strapi.entityService.create("api::event-log.event-log", {
        data: {
          action: "TransferValue",
          blockNumber: txLog.blockNumber,
          blockHash: txLog.blockHash,
          transactionIndex: txLog.transactionIndex,
          sftAddress: txLog.address,
          data: txLog.data,
          topics: txLog.topics,
          transactionHash: txLog.transactionHash,
          logIndex: txLog.logIndex,
        },
      });

      const fromTokenEntities = await strapi.entityService.findMany(
        "api::token.token",
        {
          filters: {
            contractAddress: {
              $eqi: fundEntity.sft.contractAddress,
            },
            tokenId: {
              $eqi: web3.utils.padLeft(
                web3.utils.toHex(_fromTokenId as bigint),
                64
              ),
            },
          },
        }
      );
      if (fromTokenEntities.length !== 0) {
        const tokenEntity = fromTokenEntities[0];
        await strapi.entityService.update("api::token.token", tokenEntity.id, {
          data: {
            tokenValue: N(tokenEntity.tokenValue)
              .sub(_value as string)
              .toString(),
          },
        });
      }

      const toTokenEntities = await strapi.entityService.findMany(
        "api::token.token",
        {
          filters: {
            contractAddress: {
              $eqi: fundEntity.sft.contractAddress,
            },
            tokenId: {
              $eqi: web3.utils.padLeft(
                web3.utils.toHex(_toTokenId as bigint),
                64
              ),
            },
          },
        }
      );
      if (toTokenEntities.length !== 0) {
        const tokenEntity = toTokenEntities[0];
        await strapi.entityService.update("api::token.token", tokenEntity.id, {
          data: {
            tokenValue: N(tokenEntity.tokenValue)
              .add(_value as string)
              .toString(),
          },
        });
      }

      continue;
    } else if (eventNameHash === SLOT_CHANGED_EVENT_HASH) {
      const { _tokenId, _newSlot } = web3.eth.abi.decodeLog(
        SLOT_CHANGED_EVENT_ABI,
        txLog.data,
        txLog.topics.slice(1)
      );

      /* -------------- ChangeSlot ------------- */
      await strapi.entityService.create("api::event-log.event-log", {
        data: {
          action: "ChangeSlot",
          blockNumber: txLog.blockNumber,
          blockHash: txLog.blockHash,
          transactionIndex: txLog.transactionIndex,
          sftAddress: txLog.address,
          data: txLog.data,
          topics: txLog.topics,
          transactionHash: txLog.transactionHash,
          logIndex: txLog.logIndex,
        },
      });

      const tokenEntities = await strapi.entityService.findMany(
        "api::token.token",
        {
          filters: {
            contractAddress: {
              $eqi: fundEntity.sft.contractAddress,
            },
            tokenId: {
              $eqi: web3.utils.padLeft(
                web3.utils.toHex(_tokenId as bigint),
                64
              ),
            },
          },
        }
      );
      if (tokenEntities.length !== 0) {
        const tokenEntity = tokenEntities[0];
        const packageId = fundEntity.defaultPackages.find(
          (pkg) => pkg.packageId === (_newSlot as bigint).toString()
        )?.id;
        await strapi.entityService.update("api::token.token", tokenEntity.id, {
          data: {
            package: packageId || null,
          },
        });
      }

      continue;
    } else if (eventNameHash === TRANSFER_TOKEN_EVENT_HASH) {
      const { _from, _to, _tokenId } = web3.eth.abi.decodeLog(
        TRANSFER_TOKEN_EVENT_ABI,
        txLog.data,
        txLog.topics.slice(1)
      );

      /* ------------- MintPackage; ------------ */
      if (_from === "0x0000000000000000000000000000000000000000") {
        await strapi.entityService.create("api::event-log.event-log", {
          data: {
            action: "MintPackage",
            blockNumber: txLog.blockNumber,
            blockHash: txLog.blockHash,
            transactionIndex: txLog.transactionIndex,
            sftAddress: txLog.address,
            data: txLog.data,
            topics: txLog.topics,
            transactionHash: txLog.transactionHash,
            logIndex: txLog.logIndex,
          },
        });

        await strapi.entityService.create("api::token.token", {
          data: {
            belongToFund: fundEntity.id,
            contractAddress: fundEntity.sft.contractAddress,
            tokenId: web3.utils.padLeft(
              web3.utils.toHex(_tokenId as bigint),
              64
            ),
            owner: _to as string,
          },
        });

        continue;
      }

      /* ----------------- Burn ---------------- */
      if (_to === "0x0000000000000000000000000000000000000000") {
        await strapi.entityService.create("api::event-log.event-log", {
          data: {
            action: "Burn",
            blockNumber: txLog.blockNumber,
            blockHash: txLog.blockHash,
            transactionIndex: txLog.transactionIndex,
            sftAddress: txLog.address,
            data: txLog.data,
            topics: txLog.topics,
            transactionHash: txLog.transactionHash,
            logIndex: txLog.logIndex,
          },
        });

        const tokenEntities = await strapi.entityService.findMany(
          "api::token.token",
          {
            filters: {
              contractAddress: {
                $eqi: fundEntity.sft.contractAddress,
              },
              tokenId: {
                $eqi: web3.utils.padLeft(
                  web3.utils.toHex(_tokenId as bigint),
                  64
                ),
              },
            },
          }
        );
        if (tokenEntities.length !== 0) {
          const tokenEntity = tokenEntities[0];
          await strapi.entityService.update(
            "api::token.token",
            tokenEntity.id,
            {
              data: {
                status: "Burned",
              },
            }
          );
        }

        continue;
      }

      /* --------------- Unstake --------------- */
      if (
        (_from as string).toLowerCase() ===
        fundEntity.vault.contractAddress.toLowerCase()
      ) {
        await strapi.entityService.create("api::event-log.event-log", {
          data: {
            action: "Unstake",
            blockNumber: txLog.blockNumber,
            blockHash: txLog.blockHash,
            transactionIndex: txLog.transactionIndex,
            sftAddress: txLog.address,
            data: txLog.data,
            topics: txLog.topics,
            transactionHash: txLog.transactionHash,
            logIndex: txLog.logIndex,
          },
        });

        const tokenEntities = await strapi.entityService.findMany(
          "api::token.token",
          {
            filters: {
              contractAddress: {
                $eqi: fundEntity.sft.contractAddress,
              },
              tokenId: {
                $eqi: web3.utils.padLeft(
                  web3.utils.toHex(_tokenId as bigint),
                  64
                ),
              },
            },
          }
        );
        if (tokenEntities.length !== 0) {
          const tokenEntity = tokenEntities[0];
          await strapi.entityService.update(
            "api::token.token",
            tokenEntity.id,
            {
              data: {
                status: "Holding",
              },
            }
          );
        }

        continue;
      }

      /* ---------------- Stake ---------------- */
      if (
        (_to as string).toLowerCase() ===
        fundEntity.vault.contractAddress.toLowerCase()
      ) {
        await strapi.entityService.create("api::event-log.event-log", {
          data: {
            action: "Stake",
            blockNumber: txLog.blockNumber,
            blockHash: txLog.blockHash,
            transactionIndex: txLog.transactionIndex,
            sftAddress: txLog.address,
            data: txLog.data,
            topics: txLog.topics,
            transactionHash: txLog.transactionHash,
            logIndex: txLog.logIndex,
          },
        });

        const tokenEntities = await strapi.entityService.findMany(
          "api::token.token",
          {
            filters: {
              contractAddress: {
                $eqi: fundEntity.sft.contractAddress,
              },
              tokenId: {
                $eqi: web3.utils.padLeft(
                  web3.utils.toHex(_tokenId as bigint),
                  64
                ),
              },
            },
          }
        );
        if (tokenEntities.length !== 0) {
          const tokenEntity = tokenEntities[0];
          await strapi.entityService.update(
            "api::token.token",
            tokenEntity.id,
            {
              data: {
                status: "Staking",
              },
            }
          );
        }

        continue;
      }

      /* ------------ TransferToken ------------ */
      await strapi.entityService.create("api::event-log.event-log", {
        data: {
          action: "TransferToken",
          blockNumber: txLog.blockNumber,
          blockHash: txLog.blockHash,
          transactionIndex: txLog.transactionIndex,
          sftAddress: txLog.address,
          data: txLog.data,
          topics: txLog.topics,
          transactionHash: txLog.transactionHash,
          logIndex: txLog.logIndex,
        },
      });

      const tokenEntities = await strapi.entityService.findMany(
        "api::token.token",
        {
          filters: {
            contractAddress: {
              $eqi: fundEntity.sft.contractAddress,
            },
            tokenId: {
              $eqi: web3.utils.padLeft(
                web3.utils.toHex(_tokenId as bigint),
                64
              ),
            },
          },
        }
      );
      if (tokenEntities.length !== 0) {
        const tokenEntity = tokenEntities[0];
        await strapi.entityService.update("api::token.token", tokenEntity.id, {
          data: {
            owner: _to as string,
          },
        });
      }

      continue;
    }
  }
};
