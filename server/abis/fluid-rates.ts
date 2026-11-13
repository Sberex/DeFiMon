// Exact selected ABIs: Instadapp/fluid-contracts-public@404d73f deployments/mainnet; Plasma matches.
export const fluidDexRatesAbi = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "dex_",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "user_",
        "type": "address"
      }
    ],
    "name": "getUserBorrowData",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bool",
            "name": "isAllowed",
            "type": "bool"
          },
          {
            "internalType": "uint256",
            "name": "borrow",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "borrowLimit",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "lastUpdateTimestamp",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "expandPercent",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "expandDuration",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "baseBorrowLimit",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "maxBorrowLimit",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "borrowableUntilLimit",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "borrowable",
            "type": "uint256"
          },
          {
            "components": [
              {
                "internalType": "bool",
                "name": "modeWithInterest",
                "type": "bool"
              },
              {
                "internalType": "uint256",
                "name": "borrow",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "borrowLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "lastUpdateTimestamp",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "expandPercent",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "expandDuration",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "baseBorrowLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "maxBorrowLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "borrowableUntilLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "borrowable",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "borrowLimitUtilization",
                "type": "uint256"
              }
            ],
            "internalType": "struct Structs.UserBorrowData",
            "name": "liquidityUserBorrowDataToken0",
            "type": "tuple"
          },
          {
            "components": [
              {
                "internalType": "bool",
                "name": "modeWithInterest",
                "type": "bool"
              },
              {
                "internalType": "uint256",
                "name": "borrow",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "borrowLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "lastUpdateTimestamp",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "expandPercent",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "expandDuration",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "baseBorrowLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "maxBorrowLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "borrowableUntilLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "borrowable",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "borrowLimitUtilization",
                "type": "uint256"
              }
            ],
            "internalType": "struct Structs.UserBorrowData",
            "name": "liquidityUserBorrowDataToken1",
            "type": "tuple"
          },
          {
            "components": [
              {
                "internalType": "uint256",
                "name": "borrowRate",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "supplyRate",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "fee",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "lastStoredUtilization",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "storageUpdateThreshold",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "lastUpdateTimestamp",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "supplyExchangePrice",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "borrowExchangePrice",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "supplyRawInterest",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "supplyInterestFree",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "borrowRawInterest",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "borrowInterestFree",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "totalSupply",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "totalBorrow",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "revenue",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "maxUtilization",
                "type": "uint256"
              },
              {
                "components": [
                  {
                    "internalType": "uint256",
                    "name": "version",
                    "type": "uint256"
                  },
                  {
                    "components": [
                      {
                        "internalType": "address",
                        "name": "token",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "kink",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationZero",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationKink",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationMax",
                        "type": "uint256"
                      }
                    ],
                    "internalType": "struct Structs.RateDataV1Params",
                    "name": "rateDataV1",
                    "type": "tuple"
                  },
                  {
                    "components": [
                      {
                        "internalType": "address",
                        "name": "token",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "kink1",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "kink2",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationZero",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationKink1",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationKink2",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationMax",
                        "type": "uint256"
                      }
                    ],
                    "internalType": "struct Structs.RateDataV2Params",
                    "name": "rateDataV2",
                    "type": "tuple"
                  }
                ],
                "internalType": "struct Structs.RateData",
                "name": "rateData",
                "type": "tuple"
              }
            ],
            "internalType": "struct Structs.OverallTokenData",
            "name": "liquidityTokenData0",
            "type": "tuple"
          },
          {
            "components": [
              {
                "internalType": "uint256",
                "name": "borrowRate",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "supplyRate",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "fee",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "lastStoredUtilization",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "storageUpdateThreshold",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "lastUpdateTimestamp",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "supplyExchangePrice",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "borrowExchangePrice",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "supplyRawInterest",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "supplyInterestFree",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "borrowRawInterest",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "borrowInterestFree",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "totalSupply",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "totalBorrow",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "revenue",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "maxUtilization",
                "type": "uint256"
              },
              {
                "components": [
                  {
                    "internalType": "uint256",
                    "name": "version",
                    "type": "uint256"
                  },
                  {
                    "components": [
                      {
                        "internalType": "address",
                        "name": "token",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "kink",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationZero",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationKink",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationMax",
                        "type": "uint256"
                      }
                    ],
                    "internalType": "struct Structs.RateDataV1Params",
                    "name": "rateDataV1",
                    "type": "tuple"
                  },
                  {
                    "components": [
                      {
                        "internalType": "address",
                        "name": "token",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "kink1",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "kink2",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationZero",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationKink1",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationKink2",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationMax",
                        "type": "uint256"
                      }
                    ],
                    "internalType": "struct Structs.RateDataV2Params",
                    "name": "rateDataV2",
                    "type": "tuple"
                  }
                ],
                "internalType": "struct Structs.RateData",
                "name": "rateData",
                "type": "tuple"
              }
            ],
            "internalType": "struct Structs.OverallTokenData",
            "name": "liquidityTokenData1",
            "type": "tuple"
          }
        ],
        "internalType": "struct Structs.UserBorrowData",
        "name": "userBorrowData_",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "dex_",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "user_",
        "type": "address"
      }
    ],
    "name": "getUserSupplyData",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bool",
            "name": "isAllowed",
            "type": "bool"
          },
          {
            "internalType": "uint256",
            "name": "supply",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "withdrawalLimit",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "lastUpdateTimestamp",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "expandPercent",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "expandDuration",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "baseWithdrawalLimit",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "withdrawableUntilLimit",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "withdrawable",
            "type": "uint256"
          },
          {
            "components": [
              {
                "internalType": "bool",
                "name": "modeWithInterest",
                "type": "bool"
              },
              {
                "internalType": "uint256",
                "name": "supply",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "withdrawalLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "lastUpdateTimestamp",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "expandPercent",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "expandDuration",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "baseWithdrawalLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "withdrawableUntilLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "withdrawable",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "decayEndTimestamp",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "decayAmount",
                "type": "uint256"
              }
            ],
            "internalType": "struct Structs.UserSupplyData",
            "name": "liquidityUserSupplyDataToken0",
            "type": "tuple"
          },
          {
            "components": [
              {
                "internalType": "bool",
                "name": "modeWithInterest",
                "type": "bool"
              },
              {
                "internalType": "uint256",
                "name": "supply",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "withdrawalLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "lastUpdateTimestamp",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "expandPercent",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "expandDuration",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "baseWithdrawalLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "withdrawableUntilLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "withdrawable",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "decayEndTimestamp",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "decayAmount",
                "type": "uint256"
              }
            ],
            "internalType": "struct Structs.UserSupplyData",
            "name": "liquidityUserSupplyDataToken1",
            "type": "tuple"
          },
          {
            "components": [
              {
                "internalType": "uint256",
                "name": "borrowRate",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "supplyRate",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "fee",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "lastStoredUtilization",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "storageUpdateThreshold",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "lastUpdateTimestamp",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "supplyExchangePrice",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "borrowExchangePrice",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "supplyRawInterest",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "supplyInterestFree",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "borrowRawInterest",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "borrowInterestFree",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "totalSupply",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "totalBorrow",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "revenue",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "maxUtilization",
                "type": "uint256"
              },
              {
                "components": [
                  {
                    "internalType": "uint256",
                    "name": "version",
                    "type": "uint256"
                  },
                  {
                    "components": [
                      {
                        "internalType": "address",
                        "name": "token",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "kink",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationZero",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationKink",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationMax",
                        "type": "uint256"
                      }
                    ],
                    "internalType": "struct Structs.RateDataV1Params",
                    "name": "rateDataV1",
                    "type": "tuple"
                  },
                  {
                    "components": [
                      {
                        "internalType": "address",
                        "name": "token",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "kink1",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "kink2",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationZero",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationKink1",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationKink2",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationMax",
                        "type": "uint256"
                      }
                    ],
                    "internalType": "struct Structs.RateDataV2Params",
                    "name": "rateDataV2",
                    "type": "tuple"
                  }
                ],
                "internalType": "struct Structs.RateData",
                "name": "rateData",
                "type": "tuple"
              }
            ],
            "internalType": "struct Structs.OverallTokenData",
            "name": "liquidityTokenData0",
            "type": "tuple"
          },
          {
            "components": [
              {
                "internalType": "uint256",
                "name": "borrowRate",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "supplyRate",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "fee",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "lastStoredUtilization",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "storageUpdateThreshold",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "lastUpdateTimestamp",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "supplyExchangePrice",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "borrowExchangePrice",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "supplyRawInterest",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "supplyInterestFree",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "borrowRawInterest",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "borrowInterestFree",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "totalSupply",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "totalBorrow",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "revenue",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "maxUtilization",
                "type": "uint256"
              },
              {
                "components": [
                  {
                    "internalType": "uint256",
                    "name": "version",
                    "type": "uint256"
                  },
                  {
                    "components": [
                      {
                        "internalType": "address",
                        "name": "token",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "kink",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationZero",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationKink",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationMax",
                        "type": "uint256"
                      }
                    ],
                    "internalType": "struct Structs.RateDataV1Params",
                    "name": "rateDataV1",
                    "type": "tuple"
                  },
                  {
                    "components": [
                      {
                        "internalType": "address",
                        "name": "token",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "kink1",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "kink2",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationZero",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationKink1",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationKink2",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "rateAtUtilizationMax",
                        "type": "uint256"
                      }
                    ],
                    "internalType": "struct Structs.RateDataV2Params",
                    "name": "rateDataV2",
                    "type": "tuple"
                  }
                ],
                "internalType": "struct Structs.RateData",
                "name": "rateData",
                "type": "tuple"
              }
            ],
            "internalType": "struct Structs.OverallTokenData",
            "name": "liquidityTokenData1",
            "type": "tuple"
          }
        ],
        "internalType": "struct Structs.UserSupplyData",
        "name": "userSupplyData_",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
export const fluidLegacyLendingRatesAbi = [
  {
    "inputs": [
      {
        "internalType": "contract IFToken",
        "name": "fToken_",
        "type": "address"
      }
    ],
    "name": "getFTokenDetails",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "tokenAddress",
            "type": "address"
          },
          {
            "internalType": "bool",
            "name": "eip2612Deposits",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "isNativeUnderlying",
            "type": "bool"
          },
          {
            "internalType": "string",
            "name": "name",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "symbol",
            "type": "string"
          },
          {
            "internalType": "uint256",
            "name": "decimals",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "asset",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "totalAssets",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "totalSupply",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "convertToShares",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "convertToAssets",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "rewardsRate",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "supplyRate",
            "type": "uint256"
          },
          {
            "internalType": "int256",
            "name": "rebalanceDifference",
            "type": "int256"
          },
          {
            "components": [
              {
                "internalType": "bool",
                "name": "modeWithInterest",
                "type": "bool"
              },
              {
                "internalType": "uint256",
                "name": "supply",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "withdrawalLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "lastUpdateTimestamp",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "expandPercent",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "expandDuration",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "baseWithdrawalLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "withdrawableUntilLimit",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "withdrawable",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "decayEndTimestamp",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "decayAmount",
                "type": "uint256"
              }
            ],
            "internalType": "struct Structs.UserSupplyData",
            "name": "liquidityUserSupplyData",
            "type": "tuple"
          }
        ],
        "internalType": "struct Structs.FTokenDetails",
        "name": "fTokenDetails_",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
