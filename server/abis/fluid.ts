// Selected ABI entries from official Fluid Ethereum deployments.
// The used functions and tuple fields match the Plasma deployment ABIs at the same commit.
// Source: https://github.com/Instadapp/fluid-contracts-public/tree/404d73f91e6806f881f8dabeb30494f93f9e99b7/deployments/mainnet
// Use deployment ABIs, not current Solidity structs: current source has extra fields.
export const vaultResolverAbi = [
  {
    "inputs": [
      {
        "name": "nftId_",
        "type": "uint256"
      }
    ],
    "name": "positionByNftId",
    "outputs": [
      {
        "components": [
          {
            "name": "nftId",
            "type": "uint256"
          },
          {
            "name": "owner",
            "type": "address"
          },
          {
            "name": "isLiquidated",
            "type": "bool"
          },
          {
            "name": "isSupplyPosition",
            "type": "bool"
          },
          {
            "name": "tick",
            "type": "int256"
          },
          {
            "name": "tickId",
            "type": "uint256"
          },
          {
            "name": "beforeSupply",
            "type": "uint256"
          },
          {
            "name": "beforeBorrow",
            "type": "uint256"
          },
          {
            "name": "beforeDustBorrow",
            "type": "uint256"
          },
          {
            "name": "supply",
            "type": "uint256"
          },
          {
            "name": "borrow",
            "type": "uint256"
          },
          {
            "name": "dustBorrow",
            "type": "uint256"
          }
        ],
        "name": "userPosition_",
        "type": "tuple"
      },
      {
        "components": [
          {
            "name": "vault",
            "type": "address"
          },
          {
            "name": "isSmartCol",
            "type": "bool"
          },
          {
            "name": "isSmartDebt",
            "type": "bool"
          },
          {
            "components": [
              {
                "name": "liquidity",
                "type": "address"
              },
              {
                "name": "factory",
                "type": "address"
              },
              {
                "name": "operateImplementation",
                "type": "address"
              },
              {
                "name": "adminImplementation",
                "type": "address"
              },
              {
                "name": "secondaryImplementation",
                "type": "address"
              },
              {
                "name": "deployer",
                "type": "address"
              },
              {
                "name": "supply",
                "type": "address"
              },
              {
                "name": "borrow",
                "type": "address"
              },
              {
                "components": [
                  {
                    "name": "token0",
                    "type": "address"
                  },
                  {
                    "name": "token1",
                    "type": "address"
                  }
                ],
                "name": "supplyToken",
                "type": "tuple"
              },
              {
                "components": [
                  {
                    "name": "token0",
                    "type": "address"
                  },
                  {
                    "name": "token1",
                    "type": "address"
                  }
                ],
                "name": "borrowToken",
                "type": "tuple"
              },
              {
                "name": "vaultId",
                "type": "uint256"
              },
              {
                "name": "vaultType",
                "type": "uint256"
              },
              {
                "name": "supplyExchangePriceSlot",
                "type": "bytes32"
              },
              {
                "name": "borrowExchangePriceSlot",
                "type": "bytes32"
              },
              {
                "name": "userSupplySlot",
                "type": "bytes32"
              },
              {
                "name": "userBorrowSlot",
                "type": "bytes32"
              }
            ],
            "name": "constantVariables",
            "type": "tuple"
          },
          {
            "components": [
              {
                "name": "supplyRateMagnifier",
                "type": "uint16"
              },
              {
                "name": "borrowRateMagnifier",
                "type": "uint16"
              },
              {
                "name": "collateralFactor",
                "type": "uint16"
              },
              {
                "name": "liquidationThreshold",
                "type": "uint16"
              },
              {
                "name": "liquidationMaxLimit",
                "type": "uint16"
              },
              {
                "name": "withdrawalGap",
                "type": "uint16"
              },
              {
                "name": "liquidationPenalty",
                "type": "uint16"
              },
              {
                "name": "borrowFee",
                "type": "uint16"
              },
              {
                "name": "oracle",
                "type": "address"
              },
              {
                "name": "oraclePriceOperate",
                "type": "uint256"
              },
              {
                "name": "oraclePriceLiquidate",
                "type": "uint256"
              },
              {
                "name": "rebalancer",
                "type": "address"
              },
              {
                "name": "lastUpdateTimestamp",
                "type": "uint256"
              }
            ],
            "name": "configs",
            "type": "tuple"
          },
          {
            "components": [
              {
                "name": "lastStoredLiquiditySupplyExchangePrice",
                "type": "uint256"
              },
              {
                "name": "lastStoredLiquidityBorrowExchangePrice",
                "type": "uint256"
              },
              {
                "name": "lastStoredVaultSupplyExchangePrice",
                "type": "uint256"
              },
              {
                "name": "lastStoredVaultBorrowExchangePrice",
                "type": "uint256"
              },
              {
                "name": "liquiditySupplyExchangePrice",
                "type": "uint256"
              },
              {
                "name": "liquidityBorrowExchangePrice",
                "type": "uint256"
              },
              {
                "name": "vaultSupplyExchangePrice",
                "type": "uint256"
              },
              {
                "name": "vaultBorrowExchangePrice",
                "type": "uint256"
              },
              {
                "name": "supplyRateLiquidity",
                "type": "uint256"
              },
              {
                "name": "borrowRateLiquidity",
                "type": "uint256"
              },
              {
                "name": "supplyRateVault",
                "type": "int256"
              },
              {
                "name": "borrowRateVault",
                "type": "int256"
              },
              {
                "name": "rewardsOrFeeRateSupply",
                "type": "int256"
              },
              {
                "name": "rewardsOrFeeRateBorrow",
                "type": "int256"
              }
            ],
            "name": "exchangePricesAndRates",
            "type": "tuple"
          },
          {
            "components": [
              {
                "name": "totalSupplyVault",
                "type": "uint256"
              },
              {
                "name": "totalBorrowVault",
                "type": "uint256"
              },
              {
                "name": "totalSupplyLiquidityOrDex",
                "type": "uint256"
              },
              {
                "name": "totalBorrowLiquidityOrDex",
                "type": "uint256"
              },
              {
                "name": "absorbedSupply",
                "type": "uint256"
              },
              {
                "name": "absorbedBorrow",
                "type": "uint256"
              }
            ],
            "name": "totalSupplyAndBorrow",
            "type": "tuple"
          },
          {
            "components": [
              {
                "name": "withdrawLimit",
                "type": "uint256"
              },
              {
                "name": "withdrawableUntilLimit",
                "type": "uint256"
              },
              {
                "name": "withdrawable",
                "type": "uint256"
              },
              {
                "name": "borrowLimit",
                "type": "uint256"
              },
              {
                "name": "borrowableUntilLimit",
                "type": "uint256"
              },
              {
                "name": "borrowable",
                "type": "uint256"
              },
              {
                "name": "borrowLimitUtilization",
                "type": "uint256"
              },
              {
                "name": "minimumBorrowing",
                "type": "uint256"
              }
            ],
            "name": "limitsAndAvailability",
            "type": "tuple"
          },
          {
            "components": [
              {
                "name": "totalPositions",
                "type": "uint256"
              },
              {
                "name": "topTick",
                "type": "int256"
              },
              {
                "name": "currentBranch",
                "type": "uint256"
              },
              {
                "name": "totalBranch",
                "type": "uint256"
              },
              {
                "name": "totalBorrow",
                "type": "uint256"
              },
              {
                "name": "totalSupply",
                "type": "uint256"
              },
              {
                "components": [
                  {
                    "name": "status",
                    "type": "uint256"
                  },
                  {
                    "name": "minimaTick",
                    "type": "int256"
                  },
                  {
                    "name": "debtFactor",
                    "type": "uint256"
                  },
                  {
                    "name": "partials",
                    "type": "uint256"
                  },
                  {
                    "name": "debtLiquidity",
                    "type": "uint256"
                  },
                  {
                    "name": "baseBranchId",
                    "type": "uint256"
                  },
                  {
                    "name": "baseBranchMinima",
                    "type": "int256"
                  }
                ],
                "name": "currentBranchState",
                "type": "tuple"
              }
            ],
            "name": "vaultState",
            "type": "tuple"
          },
          {
            "components": [
              {
                "name": "modeWithInterest",
                "type": "bool"
              },
              {
                "name": "supply",
                "type": "uint256"
              },
              {
                "name": "withdrawalLimit",
                "type": "uint256"
              },
              {
                "name": "lastUpdateTimestamp",
                "type": "uint256"
              },
              {
                "name": "expandPercent",
                "type": "uint256"
              },
              {
                "name": "expandDuration",
                "type": "uint256"
              },
              {
                "name": "baseWithdrawalLimit",
                "type": "uint256"
              },
              {
                "name": "withdrawableUntilLimit",
                "type": "uint256"
              },
              {
                "name": "withdrawable",
                "type": "uint256"
              },
              {
                "name": "decayEndTimestamp",
                "type": "uint256"
              },
              {
                "name": "decayAmount",
                "type": "uint256"
              }
            ],
            "name": "liquidityUserSupplyData",
            "type": "tuple"
          },
          {
            "components": [
              {
                "name": "modeWithInterest",
                "type": "bool"
              },
              {
                "name": "borrow",
                "type": "uint256"
              },
              {
                "name": "borrowLimit",
                "type": "uint256"
              },
              {
                "name": "lastUpdateTimestamp",
                "type": "uint256"
              },
              {
                "name": "expandPercent",
                "type": "uint256"
              },
              {
                "name": "expandDuration",
                "type": "uint256"
              },
              {
                "name": "baseBorrowLimit",
                "type": "uint256"
              },
              {
                "name": "maxBorrowLimit",
                "type": "uint256"
              },
              {
                "name": "borrowableUntilLimit",
                "type": "uint256"
              },
              {
                "name": "borrowable",
                "type": "uint256"
              },
              {
                "name": "borrowLimitUtilization",
                "type": "uint256"
              }
            ],
            "name": "liquidityUserBorrowData",
            "type": "tuple"
          }
        ],
        "name": "vaultData_",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "name": "user_",
        "type": "address"
      }
    ],
    "name": "positionsNftIdOfUser",
    "outputs": [
      {
        "name": "nftIds_",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
export const dexResolverAbi = [
  {
    "inputs": [
      {
        "name": "dex_",
        "type": "address"
      }
    ],
    "name": "getDexState",
    "outputs": [
      {
        "components": [
          {
            "name": "lastToLastStoredPrice",
            "type": "uint256"
          },
          {
            "name": "lastStoredPrice",
            "type": "uint256"
          },
          {
            "name": "centerPrice",
            "type": "uint256"
          },
          {
            "name": "lastUpdateTimestamp",
            "type": "uint256"
          },
          {
            "name": "lastPricesTimeDiff",
            "type": "uint256"
          },
          {
            "name": "oracleCheckPoint",
            "type": "uint256"
          },
          {
            "name": "oracleMapping",
            "type": "uint256"
          },
          {
            "name": "totalSupplyShares",
            "type": "uint256"
          },
          {
            "name": "totalBorrowShares",
            "type": "uint256"
          },
          {
            "name": "isSwapAndArbitragePaused",
            "type": "bool"
          },
          {
            "components": [
              {
                "name": "isRangeChangeActive",
                "type": "bool"
              },
              {
                "name": "isThresholdChangeActive",
                "type": "bool"
              },
              {
                "name": "isCenterPriceShiftActive",
                "type": "bool"
              },
              {
                "components": [
                  {
                    "name": "oldUpper",
                    "type": "uint256"
                  },
                  {
                    "name": "oldLower",
                    "type": "uint256"
                  },
                  {
                    "name": "duration",
                    "type": "uint256"
                  },
                  {
                    "name": "startTimestamp",
                    "type": "uint256"
                  },
                  {
                    "name": "oldTime",
                    "type": "uint256"
                  }
                ],
                "name": "rangeShift",
                "type": "tuple"
              },
              {
                "components": [
                  {
                    "name": "oldUpper",
                    "type": "uint256"
                  },
                  {
                    "name": "oldLower",
                    "type": "uint256"
                  },
                  {
                    "name": "duration",
                    "type": "uint256"
                  },
                  {
                    "name": "startTimestamp",
                    "type": "uint256"
                  },
                  {
                    "name": "oldTime",
                    "type": "uint256"
                  }
                ],
                "name": "thresholdShift",
                "type": "tuple"
              },
              {
                "components": [
                  {
                    "name": "shiftPercentage",
                    "type": "uint256"
                  },
                  {
                    "name": "duration",
                    "type": "uint256"
                  },
                  {
                    "name": "startTimestamp",
                    "type": "uint256"
                  }
                ],
                "name": "centerPriceShift",
                "type": "tuple"
              }
            ],
            "name": "shifts",
            "type": "tuple"
          },
          {
            "name": "token0PerSupplyShare",
            "type": "uint256"
          },
          {
            "name": "token1PerSupplyShare",
            "type": "uint256"
          },
          {
            "name": "token0PerBorrowShare",
            "type": "uint256"
          },
          {
            "name": "token1PerBorrowShare",
            "type": "uint256"
          }
        ],
        "name": "state_",
        "type": "tuple"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
export const lendingResolverAbi = [
  {
    "inputs": [],
    "name": "getAllFTokens",
    "outputs": [
      {
        "name": "",
        "type": "address[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
