'use client';

import styles from './page.module.css';
import { ethers } from 'ethers';
import { useState } from 'react';
import {
  toSafeSmartAccount,
  ToSafeSmartAccountReturnType,
} from 'permissionless/accounts';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import {
  createPublicClient,
  http,
  Account,
  parseEther,
  encodeFunctionData,
  erc20Abi,
  parseAbi,
  getContract,
  parseErc6492Signature,
  encodePacked,
  hexToBigInt,
  formatUnits,
  parseUnits,
  Call,
  Hex,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { createSmartAccountClient, SmartAccountClient } from 'permissionless';
import { entryPoint07Address, SmartAccount } from 'viem/account-abstraction';
import {
  generatePrivateKey,
  privateKeyToAccount,
  privateKeyToAddress,
} from 'viem/accounts';
import { eip2612Abi, eip2612Permit } from '@/lib/permit-helper';
import { UniswapSwapRouterAbi } from '../../abi/UniswapSwapRouterAbi';
import { UniswapQuoterAbi } from '../../abi/UniswapQuoterAbi';
import { useRouter } from 'next/navigation';
/* DOCUMENTATION:
  Why cant we use MetaMask?
  https://docs.pimlico.io/guides/eip7702/erc4337-vs-eip7702

  Short answer:
  MetaMask is not EIP-7702 compliant. So we must generate a new wallet.
  This is a simple example of how to deploy a Safe Account using a private key.

  Using on Base Sepolia.

  REFERENCES:
  https://docs.pimlico.io/references/permissionless/reference/clients/smartAccountClient#smart-account-client
  https://docs.pimlico.io/references/permissionless/reference/smart-account-actions/sendTransaction
*/

const pimlicoBundlerUrl =
  'https://api.pimlico.io/v2/84532/rpc?apikey=pim_GeuxsytM4ZFK28cuZsiAb4'; // create an account on dashboard.pimlico.io and get your own key

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(),
});

//https://docs.pimlico.io/references/permissionless/reference/clients/pimlicoClient#pimlico-client
const pimlicoClient = createPimlicoClient({
  transport: http(pimlicoBundlerUrl),
  entryPoint: {
    address: entryPoint07Address,
    version: '0.7',
  },
});

// Base Sepolia USDC address
const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
// Uniswap V3 Router address on Base Sepolia
const UNISWAP_SEPOLIA_V3_ROUTER = '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4';
// WETH address on Base Sepolia
const WETH_ADDRESS = '0x4200000000000000000000000000000000000006';
// Circle Paymaster address on Base Sepolia
const CIRCLE_PAYMASTER_ADDRESS = '0x31BE08D380A21fc740883c0BC434FcFc88740b58';
// Uniswap V3 Pool Factory address on Base Sepolia
const POOL_FACTORY_CONTRACT_ADDRESS =
  '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24';
// Uniswap V3 Quoter address on Base Sepolia
const QUOTER_CONTRACT_ADDRESS = '0xC5290058841028F1614F3A6F0F5816cAd0df5E27';

const MAX_GAS_USDC = 1000000n; // 1 USDC

// WETH ABI (minimal for deposit function)
const WETH_ABI = [
  {
    inputs: [],
    name: 'deposit',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
] as const;

export interface TransactionData {
  to: string;
  value: string;
  data: string;
}

export default function Home() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [safeSmartAccount, setSafeSmartAccount] =
    useState<ToSafeSmartAccountReturnType>();
  const [smartAccountClient, setSmartAccountClient] =
    useState<SmartAccountClient>();
  const [smartAccountBalance, setSmartAccountBalance] = useState<string | null>(
    '----',
  );
  const [smartAccountBalanceInUSDC, setSmartAccountBalanceInUSDC] = useState<
    string | null
  >('----');
  const [smartAccountBalanceInWETH, setSmartAccountBalanceInWETH] = useState<
    string | null
  >('----');
  const [transactions, setTransactions] = useState<TransactionData[]>([]);
  const [toAddress, setToAddress] = useState<string>('');
  const [value, setValue] = useState<string>('');
  const [data, setData] = useState<string>('0x');

  const generateWallet = async () => {
    // replace with your own private key if you want to use your own
    const privateKey = generatePrivateKey();
    setPrivateKey(privateKey);
    setAddress(privateKeyToAddress(privateKey));

    const account = privateKeyToAccount(privateKey);
    setAccount(account);

    const safeSmartAccount = await toSafeSmartAccount({
      client: publicClient,
      owners: [account],
      entryPoint: {
        address: entryPoint07Address,
        version: '0.7',
      },
      version: '1.4.1',
    });
    setSafeSmartAccount(safeSmartAccount);

    const smartAccountClient = createSmartAccountClient({
      account: safeSmartAccount,
      chain: baseSepolia,
      bundlerTransport: http(pimlicoBundlerUrl),
      userOperation: {
        estimateFeesPerGas: async () => {
          return (await pimlicoClient.getUserOperationGasPrice()).fast;
        },
      },
    });
    setSmartAccountClient(smartAccountClient);
  };

  const getSmartAccountBalance = async () => {
    const balance = await publicClient.getBalance({
      address: safeSmartAccount!.address,
    });
    setSmartAccountBalance(ethers.formatEther(balance));
  };

  const addTransaction = async () => {
    if (!toAddress) {
      alert('Please enter a recipient address');
      return;
    }

    const newTransaction: TransactionData = {
      to: toAddress,
      value: value,
      data: data || '0x',
    };

    setTransactions([...transactions, newTransaction]);
    setToAddress('');
    setValue('');
    setData('0x');

    console.log(
      `Added transaction to: ${toAddress}, value: ${value}, data: ${data}`,
    );
  };

  const sendTransaction = async () => {
    try {
      if (!safeSmartAccount || !smartAccountClient) {
        throw new Error('Smart account or smart account client not found');
      }

      if (transactions.length === 0) {
        throw new Error('No transactions to send');
      }

      // Check balance first
      const balance = await publicClient.getBalance({
        address: safeSmartAccount.address,
      });

      if (balance === BigInt(0)) {
        alert(
          `Please send some ETH to your smart account: ${safeSmartAccount.address}`,
        );
        return;
      }

      const calls = transactions.map((tx) => {
        const value = tx.value ? ethers.parseEther(tx.value).toString() : '0';

        return {
          to: tx.to,
          value: BigInt(value),
        };
      });

      const gasPrice = await smartAccountClient.estimateUserOperationGas({
        account: safeSmartAccount,
        calls,
      });

      console.log('Gas price:', gasPrice);

      // Convert to the right format
      const txHash = await smartAccountClient.sendTransaction({
        calls,
      });

      console.log('Transaction hash:', txHash);
      alert(`Transaction sent! Hash: ${txHash}`);

      // Clear transactions after sending
      setTransactions([]);

      // Update balance
      getSmartAccountBalance();
    } catch (error) {
      console.error('Error sending transactions:', error);
      alert(
        `Error sending transactions: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  //REFERENCE: https://developers.circle.com/stablecoins/quickstart-circle-paymaster
  const sendTransactionWithCirclePaymaster = async () => {
    try {
      if (!safeSmartAccount || !smartAccountClient) {
        throw new Error('Smart account or smart account client not found');
      }

      if (transactions.length === 0) {
        throw new Error('No transactions to send');
      }

      const usdc = getContract({
        client: publicClient,
        address: USDC_ADDRESS,
        abi: [...erc20Abi, ...eip2612Abi],
      });

      // Check balance first
      const usdcBalance = await usdc.read.balanceOf([
        safeSmartAccount!.address,
      ]);
      if (usdcBalance === 0n) {
        alert('Please send some USDC to your smart account');
        return;
      }

      //EIP-2612 permit to authorize the paymaster to spend the smart wallet's USDC
      const permitData = await eip2612Permit({
        token: usdc,
        chain: baseSepolia,
        ownerAddress: safeSmartAccount!.address,
        spenderAddress: CIRCLE_PAYMASTER_ADDRESS,
        value: MAX_GAS_USDC,
      });

      const signData = { ...permitData, primaryType: 'Permit' as const };
      const wrappedPermitSignature = await safeSmartAccount?.signTypedData(
        signData,
      );
      const { signature: permitSignature } = parseErc6492Signature(
        wrappedPermitSignature as `0x${string}`,
      );

      const calls = transactions.map((tx) => {
        const value = tx.value ? parseUnits(tx.value, 6).toString() : '0';

        return {
          to: usdc.address,
          abi: usdc.abi,
          functionName: 'transfer',
          args: [tx.to, value],
        };
      });

      const paymaster = CIRCLE_PAYMASTER_ADDRESS;
      const paymasterData = encodePacked(
        ['uint8', 'address', 'uint256', 'bytes'],
        [
          0, // Reserved for future use
          USDC_ADDRESS, // Token address
          MAX_GAS_USDC, // Max spendable gas in USDC
          permitSignature, // EIP-2612 permit signature
        ],
      );

      const additionalGasCharge = hexToBigInt(
        (
          await publicClient.call({
            to: paymaster,
            data: encodeFunctionData({
              abi: parseAbi([
                'function additionalGasCharge() returns (uint256)',
              ]),
              functionName: 'additionalGasCharge',
            }),
          })
        ).data as `0x${string}`,
      );

      const { standard: fees } = await pimlicoClient.request({
        method: 'pimlico_getUserOperationGasPrice',
        params: [],
      });

      const maxFeePerGas = hexToBigInt(fees.maxFeePerGas);
      const maxPriorityFeePerGas = hexToBigInt(fees.maxPriorityFeePerGas);

      console.log('Max fee per gas:', maxFeePerGas);
      console.log('Max priority fee per gas:', maxPriorityFeePerGas);
      console.log('Estimating user op gas limits...');

      const {
        callGasLimit,
        preVerificationGas,
        verificationGasLimit,
        paymasterPostOpGasLimit,
        paymasterVerificationGasLimit,
      } = await pimlicoClient.estimateUserOperationGas({
        account: safeSmartAccount,
        calls,
        paymaster,
        paymasterData,
        // Make sure to pass in the `additionalGasCharge` from the paymaster
        paymasterPostOpGasLimit: additionalGasCharge,
        // Use very low gas fees for estimation to ensure successful permit/transfer,
        // since the bundler will simulate the user op with very high gas limits
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
      });

      console.log('Call gas limit:', callGasLimit);
      console.log('Pre-verification gas:', preVerificationGas);
      console.log('Verification gas limit:', verificationGasLimit);
      console.log('Paymaster post op gas limit:', paymasterPostOpGasLimit);
      console.log(
        'Paymaster verification gas limit:',
        paymasterVerificationGasLimit,
      );

      console.log('Sending user op...');

      const userOpHash = await smartAccountClient.sendUserOperation({
        account: safeSmartAccount,
        calls,
        callGasLimit,
        preVerificationGas,
        verificationGasLimit,
        paymaster,
        paymasterData,
        paymasterVerificationGasLimit,
        // Make sure that `paymasterPostOpGasLimit` is always at least
        // `additionalGasCharge`, regardless of what the bundler estimated.
        paymasterPostOpGasLimit: BigInt(
          Math.max(
            Number(paymasterPostOpGasLimit),
            Number(additionalGasCharge),
          ),
        ),
        maxFeePerGas,
        maxPriorityFeePerGas,
      });

      console.log('Submitted user op:', userOpHash);
      console.log('Waiting for execution...');

      const userOpReceipt =
        await smartAccountClient.waitForUserOperationReceipt({
          hash: userOpHash,
        });

      console.log('Done! Details:');
      console.log('  success:', userOpReceipt.success);
      console.log('  actualGasUsed:', userOpReceipt.actualGasUsed);
      console.log(
        '  actualGasCost:',
        formatUnits(userOpReceipt.actualGasCost, 18),
        'ETH',
      );
      console.log('  transaction hash:', userOpReceipt.receipt.transactionHash);
      console.log('  transaction gasUsed:', userOpReceipt.receipt.gasUsed);

      //const usdcBalanceAfter = await usdc.read.balanceOf([safeSmartAccount!.address])
      //const usdcConsumed = usdcBalance - usdcBalanceAfter - transactions.reduce((acc, tx) => acc + (tx.value ? parseUnits(tx.value, 6).toBigInt() : 0n), 0n) // Exclude what we sent
      //console.log('  USDC paid:', formatUnits(usdcBalance - usdcBalanceAfter, 6))

      alert(`Transaction sent! Hash: ${userOpReceipt.receipt.transactionHash}`);

      // Update balance
      getSmartAccountBalanceInUSDC();
    } catch (error) {
      console.error('Error sending transactions:', error);
      alert(
        `Error sending transactions: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  const wrapEthToWETH = async () => {
    try {
      if (!safeSmartAccount || !smartAccountClient) {
        throw new Error('Smart account or smart account client not found');
      }

      // Amount of ETH to wrap (0.000001 ETH)
      const amountIn = parseEther('0.001');

      // Send the transaction
      const txHash = await smartAccountClient.sendUserOperation({
        account: safeSmartAccount,
        calls: [
          {
            to: WETH_ADDRESS,
            abi: WETH_ABI,
            functionName: 'deposit',
            value: amountIn,
          },
        ],
      });

      console.log('Wrap ETH transaction hash:', txHash);
      alert(`ETH wrapped to WETH! Transaction hash: ${txHash}`);

      // Update balances after wrap
      getSmartAccountBalance();
      getSmartAccountBalanceInWETH();
    } catch (error) {
      console.error('Error wrapping ETH to WETH:', error);
      alert(
        `Error wrapping ETH to WETH: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  // Add Quoter ABI

  /**
   * Get a quote for swapping ETH to USDC
   * @param amountIn Amount of ETH to swap (in wei)
   * @returns Expected amount of USDC out
   */
  async function getWethToUsdcQuote(amountIn: bigint): Promise<bigint> {
    try {
      // First get the pool address from the factory
      const poolAddress = await publicClient.readContract({
        address: POOL_FACTORY_CONTRACT_ADDRESS,
        abi: parseAbi([
          'function getPool(address,address,uint24) external view returns (address)',
        ]),
        functionName: 'getPool',
        args: [WETH_ADDRESS, USDC_ADDRESS, 3000],
      });

      if (
        !poolAddress ||
        poolAddress === '0x0000000000000000000000000000000000000000'
      ) {
        throw new Error('Pool does not exist');
      }

      console.log(`Using pool: ${poolAddress}`);

      // Get quote from Quoter contract
      const result = await publicClient.simulateContract({
        address: QUOTER_CONTRACT_ADDRESS,
        abi: UniswapQuoterAbi,
        functionName: 'quoteExactInputSingle',
        args: [
          {
            tokenIn: WETH_ADDRESS,
            tokenOut: USDC_ADDRESS,
            fee: 3000,
            recipient: safeSmartAccount!.address,
            deadline: Math.floor(new Date().getTime() / 1000 + 60 * 10),
            amountIn: amountIn,
            sqrtPriceLimitX96: 0n,
          },
        ],
      });
      console.log('🚀 ~ getWethToUsdcQuote ~ result:', result);
      const amountOut = result.result[0];

      return amountOut;
    } catch (error) {
      console.error('Error getting quote:', error);
      if (error instanceof Error) {
        console.error('Error details:', error.message);
      }
      throw error;
    }
  }

  /**
   * Create calldata for swapping ETH to USDC
   * @param amountIn Amount of ETH to swap (in wei)
   * @param slippagePercentage Slippage tolerance (e.g., 0.5 for 0.5%)
   * @returns Encoded function data for the swap
   */
  async function createWethToUsdcSwapCalldata(
    amountIn: bigint,
    slippagePercentage: number = 0.5,
  ): Promise<Hex> {
    // Get expected amount out
    const expectedAmountOut = await getWethToUsdcQuote(amountIn);

    // Calculate minimum amount out based on slippage
    const slippageBps = BigInt(Math.floor(slippagePercentage * 100));
    const minAmountOut =
      expectedAmountOut - (expectedAmountOut * slippageBps) / 10000n;

    // Encode the function call
    const calldata = encodeFunctionData({
      abi: UniswapSwapRouterAbi,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn: WETH_ADDRESS,
          tokenOut: USDC_ADDRESS,
          fee: 3000, // 0.3% fee tier
          recipient: safeSmartAccount!.address,
          amountIn,
          amountOutMinimum: minAmountOut,
          sqrtPriceLimitX96: 0n, // No price limit
        },
      ],
    });

    return calldata;
  }

  const swapWETHToUSDC = async () => {
    try {
      if (!safeSmartAccount || !smartAccountClient) {
        throw new Error('Smart account or smart account client not found');
      }

      const amountIn = parseEther('0.001');

      // Get expected amount out for logging
      const expectedAmountOut = await getWethToUsdcQuote(amountIn);
      console.log(
        `Expected to receive approximately ${formatUnits(
          expectedAmountOut,
          6,
        )} USDC for ${amountIn} WETH`,
      );

      // Create the swap calldata
      const swapCalldata = await createWethToUsdcSwapCalldata(amountIn);

      // Send the transaction
      const txHash = await smartAccountClient.sendUserOperation({
        account: safeSmartAccount,
        calls: [
          {
            to: UNISWAP_SEPOLIA_V3_ROUTER,
            data: swapCalldata,
            value: amountIn,
          },
        ],
      });
      console.log('🟠 Swapping WETH to USDC....');

      console.log('Swap transaction hash:', txHash);

      const { receipt } = await smartAccountClient.waitForUserOperationReceipt({
        hash: txHash,
        retryCount: 7,
        pollingInterval: 2000,
      });

      alert(`Transaction sent! Hash: ${receipt.transactionHash}`);

      // Update balance after swap
      getSmartAccountBalance();
      getSmartAccountBalanceInUSDC();
    } catch (error) {
      console.error('Error swapping WETH to USDC:', error);
      alert(
        `Error swapping WETH to USDC: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  const getSmartAccountBalanceInUSDC = async () => {
    const balance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [safeSmartAccount!.address],
    });
    setSmartAccountBalanceInUSDC(ethers.formatUnits(balance, 6));
  };

  const getSmartAccountBalanceInWETH = async () => {
    const balance = await publicClient.readContract({
      address: WETH_ADDRESS,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [safeSmartAccount!.address],
    });
    setSmartAccountBalanceInWETH(ethers.formatEther(balance));
  };

  const sendWrapSwapPaymaster = async () => {
    if (!safeSmartAccount || !smartAccountClient) {
      throw new Error('Smart account or smart account client not found');
    }

    const calls: Call[] = [];

    //@SEND-CALL: Add the transactions to the send calls
    console.log('Adding send calls to the calls');
    transactions.forEach((tx) => {
      calls.push({
        to: tx.to,
        value: tx.value ? BigInt(parseEther(tx.value)) : undefined,
      });
    });

    //-------------------------------------------------------

    //@WRAP-CALL: Add the wrap call to the calls
    console.log('Adding wrap call to the calls');
    const amountIn = parseEther(transactions[0].value);

    calls.push({
      to: WETH_ADDRESS,
      abi: WETH_ABI,
      functionName: 'deposit',
      value: amountIn,
    });

    //-------------------------------------------------------

    //@SWAP-CALL: Add the swap call to the calls
    console.log('Adding swap call to the calls');
    // Get expected amount out for logging
    const expectedAmountOut = await getWethToUsdcQuote(amountIn);
    console.log(
      `Expected to receive approximately ${formatUnits(
        expectedAmountOut,
        6,
      )} USDC for ${amountIn} WETH`,
    );

    // Create the swap calldata
    const swapCalldata = await createWethToUsdcSwapCalldata(amountIn);

    calls.push({
      to: UNISWAP_SEPOLIA_V3_ROUTER,
      data: swapCalldata,
      value: amountIn,
    });

    //-------------------------------------------------------

    //@PAYMASTER-CALL: Add the paymaster call to the calls
    console.log('Adding paymaster call to the calls');
    const usdc = getContract({
      client: publicClient,
      address: USDC_ADDRESS,
      abi: [...erc20Abi, ...eip2612Abi],
    });

    // Check balance first
    const usdcBalance = await usdc.read.balanceOf([safeSmartAccount!.address]);
    if (usdcBalance === 0n) {
      alert('Please send some USDC to your smart account');
      return;
    }

    //EIP-2612 permit to authorize the paymaster to spend the smart wallet's USDC
    const permitData = await eip2612Permit({
      token: usdc,
      chain: baseSepolia,
      ownerAddress: safeSmartAccount!.address,
      spenderAddress: CIRCLE_PAYMASTER_ADDRESS,
      value: MAX_GAS_USDC,
    });

    const signData = { ...permitData, primaryType: 'Permit' as const };
    const wrappedPermitSignature = await safeSmartAccount?.signTypedData(
      signData,
    );
    const { signature: permitSignature } = parseErc6492Signature(
      wrappedPermitSignature as `0x${string}`,
    );

    const paymasterCalls = transactions.map((tx) => {
      const value = tx.value ? parseUnits(tx.value, 6).toString() : '0';

      return {
        to: usdc.address,
        abi: usdc.abi,
        functionName: 'transfer',
        args: [tx.to, value],
      };
    });

    calls.push(...paymasterCalls);

    const paymasterAddress = CIRCLE_PAYMASTER_ADDRESS;
    const paymasterData = encodePacked(
      ['uint8', 'address', 'uint256', 'bytes'],
      [
        0, // Reserved for future use
        USDC_ADDRESS, // Token address
        MAX_GAS_USDC, // Max spendable gas in USDC
        permitSignature, // EIP-2612 permit signature
      ],
    );

    const additionalGasCharge = hexToBigInt(
      (
        await publicClient.call({
          to: paymasterAddress,
          data: encodeFunctionData({
            abi: parseAbi(['function additionalGasCharge() returns (uint256)']),
            functionName: 'additionalGasCharge',
          }),
        })
      ).data as `0x${string}`,
    );

    const { standard: fees } = await pimlicoClient.request({
      method: 'pimlico_getUserOperationGasPrice',
      params: [],
    });

    const maxFeePerGas = hexToBigInt(fees.maxFeePerGas);
    const maxPriorityFeePerGas = hexToBigInt(fees.maxPriorityFeePerGas);

    const {
      callGasLimit,
      preVerificationGas,
      verificationGasLimit,
      paymasterPostOpGasLimit,
      paymasterVerificationGasLimit,
    } = await pimlicoClient.estimateUserOperationGas({
      account: safeSmartAccount,
      calls,
      paymaster: paymasterAddress,
      paymasterData,
      // Make sure to pass in the `additionalGasCharge` from the paymaster
      paymasterPostOpGasLimit: additionalGasCharge,
      // Use very low gas fees for estimation to ensure successful permit/transfer,
      // since the bundler will simulate the user op with very high gas limits
      maxFeePerGas: 1n,
      maxPriorityFeePerGas: 1n,
    });

    const paymasterToUse = {
      callGasLimit,
      preVerificationGas,
      verificationGasLimit,
      paymasterPostOpGasLimit,
      paymasterVerificationGasLimit,
      paymaster: paymasterAddress,
      paymasterData,
      maxFeePerGas,
      maxPriorityFeePerGas,
    };

    const txHash = await execute(calls, safeSmartAccount, paymasterToUse);

    const { receipt } = await smartAccountClient.waitForUserOperationReceipt({
      hash: txHash,
      retryCount: 7,
      pollingInterval: 2000,
    });

    alert(`Transaction sent! Hash: ${receipt.transactionHash}`);

    setTransactions([]);
    getSmartAccountBalance();
    getSmartAccountBalanceInWETH();
    getSmartAccountBalanceInUSDC();
  };

  const execute = async (
    calls: Call[],
    safeSmartAccount: SmartAccount,
    paymaster?: {
      callGasLimit: bigint;
      preVerificationGas: bigint;
      verificationGasLimit?: bigint;
      paymaster: string;
      paymasterData: string | undefined;
      paymasterVerificationGasLimit?: bigint;
      paymasterPostOpGasLimit?: bigint;
      maxFeePerGas: bigint;
      maxPriorityFeePerGas: bigint;
    },
  ) => {
    if (!safeSmartAccount || !smartAccountClient) {
      throw new Error('Smart account or smart account client not found');
    }

    const paymasterToUse = paymaster
      ? {
          callGasLimit: paymaster.callGasLimit,
          preVerificationGas: paymaster.preVerificationGas,
          verificationGasLimit: paymaster.verificationGasLimit,
          paymaster: paymaster.paymaster,
          paymasterData: paymaster.paymasterData as `0x${string}`,
          paymasterVerificationGasLimit:
            paymaster.paymasterVerificationGasLimit,
          paymasterPostOpGasLimit: paymaster.paymasterPostOpGasLimit,
          maxFeePerGas: paymaster.maxFeePerGas,
          maxPriorityFeePerGas: paymaster.maxPriorityFeePerGas,
        }
      : {};

    const txHash = await smartAccountClient.sendUserOperation({
      account: safeSmartAccount,
      calls,
      ...paymasterToUse,
    });

    return txHash;
  };

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        {account && address && safeSmartAccount ? (
          <>
            <p>Private Key: {privateKey}</p>
            <p>Wallet Address: {address}</p>
            <p>
              Smart Account Address: {safeSmartAccount?.address}{' '}
              <span>{`<--- Send ETH to this address `}</span>
            </p>
            <p>
              Smart Account Balance: {smartAccountBalance}{' '}
              <button onClick={() => getSmartAccountBalance()}>
                Refresh balance
              </button>
            </p>
            <p>
              Smart Account Balance in WETH: {smartAccountBalanceInWETH}{' '}
              <button onClick={() => getSmartAccountBalanceInWETH()}>
                Refresh balance
              </button>
            </p>
            <p>
              Smart Account Balance in USDC: {smartAccountBalanceInUSDC}{' '}
              <button onClick={() => getSmartAccountBalanceInUSDC()}>
                Refresh balance
              </button>
            </p>

            <h2>Transactions Builder</h2>
            <div style={{ display: 'flex', flexDirection: 'row', gap: '10px' }}>
              <div
                style={{ display: 'flex', flexDirection: 'row', gap: '10px' }}
              >
                <input
                  type="text"
                  placeholder="To"
                  value={toAddress}
                  onChange={(e) => setToAddress(e.target.value)}
                />
                <input
                  type="text"
                  placeholder="Value"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
                {/* <input type="text" placeholder="Data" value={data} onChange={(e) => setData(e.target.value)} /> */}
              </div>
              <button onClick={addTransaction}>Add another transaction</button>
            </div>

            <ul>
              {transactions.map((tx, index) => (
                <li key={index}>
                  <p>To: {tx.to}</p>
                  <p>Value: {tx.value}</p>
                  {/* <p>Data: {tx.data}</p> */}
                </li>
              ))}
            </ul>

            <h2>Send simple transactions</h2>
            <button onClick={sendTransaction}>Send transactions</button>

            <h2>Send transactions with Circle Paymaster</h2>
            <button onClick={sendTransactionWithCirclePaymaster}>
              Send transactions with Circle Paymaster
            </button>

            <p style={{ textAlign: 'center' }}>
              ---------------------------------------------------------------------
            </p>

            <h2>Wrap ETH to WETH</h2>
            <button onClick={wrapEthToWETH}>Wrap 0.000001 ETH to WETH</button>

            <h2>Swap WETH to USDC</h2>
            <button onClick={swapWETHToUSDC}>Swap 0.001 ETH to USDC</button>

            <p style={{ textAlign: 'center' }}>
              ---------------------------------------------------------------------
            </p>

            <h2>Send ETH + WRAP ETH + SWAP WETH to USDC + Paymaster</h2>
            <button onClick={sendWrapSwapPaymaster}>
              Send ETH + WRAP ETH + SWAP WETH to USDC + Paymaster
            </button>
          </>
        ) : (
          <>
            <h2>EVM Smart Account Demo</h2>
            <button
              onClick={() => {
                generateWallet();
              }}
            >
              Generate Wallet
            </button>
          </>
        )}

        <button onClick={() => router.push('/metamask')}>To Metamask</button>
      </main>
    </div>
  );
}

//Private Key: 0xcbaf1f4b2282dd0ded3889d121596dd2c903ca1175e32c97a49378988be51e37
