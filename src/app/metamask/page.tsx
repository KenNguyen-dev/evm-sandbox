'use client';

import { useState, useEffect, useSyncExternalStore } from 'react';
import styles from '../page.module.css';
import { ethers, formatEther, parseEther } from 'ethers';
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  Hex,
  http,
  parseAbi,
  WalletClient,
} from 'viem';
import { sepolia } from 'viem/chains';
import { BigNumberish } from 'ethers';
import { UniswapQuoterAbi } from '../../../abi/UniswapQuoterAbi';
import { UniswapSwapRouterAbi } from '../../../abi/UniswapSwapRouterAbi';

interface EIP6963ProviderInfo {
  rdns: string;
  uuid: string;
  name: string;
  icon: string;
}

interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: EIP1193Provider;
}

type EIP6963AnnounceProviderEvent = {
  detail: {
    info: EIP6963ProviderInfo;
    provider: Readonly<EIP1193Provider>;
  };
};

interface EIP1193Provider {
  isStatus?: boolean;
  host?: string;
  path?: string;
  sendAsync?: (
    request: { method: string; params?: Array<unknown> },
    callback: (error: Error | null, response: unknown) => void,
  ) => void;
  send?: (
    request: { method: string; params?: Array<unknown> },
    callback: (error: Error | null, response: unknown) => void,
  ) => void;
  request: (request: {
    method: string;
    params?: Array<unknown>;
  }) => Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: any[] }) => Promise<any>;
      on: (eventName: string, handler: (...args: any[]) => void) => void;
      removeListener: (
        eventName: string,
        handler: (...args: any[]) => void,
      ) => void;
      removeAllListeners: () => void;
    };
  }
}

declare global {
  interface WindowEventMap {
    'eip6963:announceProvider': CustomEvent;
  }
}

// An array to store the detected wallet providers.
let providers: EIP6963ProviderDetail[] = [];

export const store = {
  value: () => providers,
  subscribe: (callback: () => void) => {
    function onAnnouncement(event: EIP6963AnnounceProviderEvent) {
      if (providers.map((p) => p.info.uuid).includes(event.detail.info.uuid))
        return;
      providers = [...providers, event.detail];
      callback();
    }

    // Listen for eip6963:announceProvider and call onAnnouncement when the event is triggered.
    window.addEventListener('eip6963:announceProvider', onAnnouncement);

    // Dispatch the event, which triggers the event listener in the MetaMask wallet.
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    // Return a function that removes the event listener.
    return () =>
      window.removeEventListener('eip6963:announceProvider', onAnnouncement);
  },
};

const POOL_FACTORY_CONTRACT_ADDRESS =
  '0x0227628f3F023bb0B980b67D528571c95c6DaC1c';
// Uniswap V3 Quoter address on ETH Sepolia
const QUOTER_CONTRACT_ADDRESS = '0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3';
// ETH Sepolia USDC address
const USDC_ADDRESS = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
// Uniswap V3 Router address on ETH Sepolia
const UNISWAP_SEPOLIA_V3_ROUTER = '0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E';
// WETH address on ETH Sepolia
const WETH_ADDRESS = '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14';
// USDT address on ETH Sepolia
const USDT_ADDRESS = '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0';
//DAI address on ETH Sepolia
const DAI_ADDRESS = '0xff34b3d4aee8ddcd6f9afffb6fe49bd371b8a357';

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(),
});

export default function MetaMaskPage() {
  const [provider, setProvider] = useState<EIP1193Provider>();
  const [userAccount, setUserAccount] = useState<string>('');
  const [chainId, setChainId] = useState<string>('');
  const [chainName, setChainName] = useState<string>('');
  const [refresh, setRefresh] = useState<boolean>(false);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [explorerUrl, setExplorerUrl] = useState<string>('');
  const [isSmartEoa, setIsSmartEoa] = useState<boolean>(false);
  const [supportAtomic, setSupportAtomic] = useState<boolean>(false);
  const [isConnectDisabled, setConnectDisabled] = useState<boolean>(false);
  const [processingTxn, setProcessingTxn] = useState<boolean>(false);
  const [connectStatus, setConnectStatus] = useState<string>('Connect Wallet');
  const [balance, setBalance] = useState<string>('');
  const [batch, setBatch] = useState<{ to: string; value: string }[]>([]);
  const [toAddress, setToAddress] = useState<string>('');
  const [value, setValue] = useState<string>('');
  const [client, setClient] = useState<WalletClient>();
  const [swapAmount, setSwapAmount] = useState<string>('');
  const providers = useSyncExternalStore(
    store.subscribe,
    store.value,
    store.value,
  );

  const mmProvider = providers.find((p) => p.info.name == 'MetaMask');

  // Connect to the selected provider using eth_requestAccounts.
  const handleConnect = async (providerWithInfo: EIP6963ProviderDetail) => {
    setConnectDisabled(true);
    try {
      const client = createWalletClient({
        chain: sepolia,
        transport: custom(providerWithInfo.provider),
      });

      const accounts = await client.requestAddresses();

      setClient(client);
      await update(client, providerWithInfo.provider, accounts[0]);
      setConnectStatus('Wallet Connected');

      (providerWithInfo.provider as any).on(
        'accountsChanged',
        handleAccountChanged,
      );
      (providerWithInfo.provider as any).on('chainChanged', handleChainChanged);
    } catch (error) {
      console.error(error);
      setConnectDisabled(false);
    }
  };

  // Disconnect from the selected provider.
  // const handleDisconnect = async () => {
  //   try {
  //     (await provider?.request({
  //       method: 'wallet_revokePermissions',
  //       params: [
  //         {
  //           eth_accounts: {},
  //         },
  //       ],
  //     })) as string[];

  //     setConnectDisabled(false);
  //     setProvider(undefined);
  //     setUserAccount('');
  //     setChainId('');
  //     setChainName('');
  //     setCapabilities([]);
  //     setConnectStatus('Connect Wallet');
  //     setExplorerUrl('');
  //   } catch (error) {
  //     console.error(error);
  //   }
  // };

  const handleChainChanged = async (newChainId: string) => {
    setRefresh(true);
    setChainId(newChainId);
  };

  const handleAccountChanged = async (newAccounts: string[]) => {
    setRefresh(true);
    setUserAccount(newAccounts[0]);
  };

  // const handleRefresh = async () => {
  //   setRefresh(false);
  //   setExplorerUrl('');
  //   await update(provider as EIP1193Provider, userAccount);
  // };

  const handleSendCalls = async () => {
    setExplorerUrl('');

    const calls = batch.map((tx) => ({
      to: tx.to as `0x${string}`,
      value: parseEther(tx.value),
    }));

    try {
      const res = await client?.sendCalls({
        account: userAccount as `0x${string}`,
        chain: sepolia,
        version: '2.0.0',
        forceAtomic: true,
        calls,
      });

      console.log('SendCalls Res', res);
      setProcessingTxn(true);

      if (!res) {
        setProcessingTxn(false);
        return;
      }

      const int = setInterval(async () => {
        const status = (await mmProvider?.provider.request({
          method: 'wallet_getCallsStatus',
          params: [res.id],
        })) as any;
        if (status.status == 200) {
          const chainListData = await fetch('https://chainlist.org/rpcs.json');
          const chainListJson: any[] = await chainListData.json();
          const chainInfo = chainListJson.find(
            (c: any) => c.chainId == chainId,
          );
          const baseExplorerUrl = chainInfo['explorers'][0]['url'];
          const txnHash = status['receipts'][0]['transactionHash'];
          const explorerUrl = `${baseExplorerUrl}/tx/${txnHash}`;
          setExplorerUrl(explorerUrl);

          const ethersProvider = new ethers.BrowserProvider(
            mmProvider?.provider as EIP1193Provider,
          );
          const eoaCode = await ethersProvider.getCode(userAccount);
          setIsSmartEoa(eoaCode != '0x');
          clearInterval(int);
          setProcessingTxn(false);
        }
      }, 1000);
    } catch (error) {
      console.error(error);
    }
  };

  const update = async (
    client: WalletClient,
    eipProvider: EIP1193Provider,
    account: string,
  ) => {
    const currProvider = eipProvider || (provider as EIP1193Provider);
    const currAccount = account;
    const ethersProvider = new ethers.BrowserProvider(currProvider);
    const network = await ethersProvider.getNetwork();
    const currChainId = (await client?.getChainId()).toString();
    const currChainName = network.name;
    const currCapabilities = await client?.getCapabilities({
      account: currAccount as `0x${string}`,
    });
    const eoaCode = await ethersProvider.getCode(currAccount);
    const balance = await ethersProvider.getBalance(currAccount);

    setBalance(formatEther(balance as BigNumberish));
    setProvider(currProvider);
    setUserAccount(currAccount);
    setChainId(currChainId);
    setChainName(currChainName);
    setIsSmartEoa(eoaCode != '0x');
    if (currCapabilities[currChainId]) {
      const keys = Object.keys(currCapabilities[currChainId]);
      setCapabilities(keys);
      setSupportAtomic(keys.includes('atomic'));
    } else {
      setCapabilities(['None']);
      setSupportAtomic(false);
    }
  };

  const addBatchItem = () => {
    setBatch([...batch, { to: toAddress, value: value }]);
  };

  //--------------------------------- SWAP ETH TO USDC ---------------------------------
  // Add Quoter ABI

  /**
   * Get a quote for swapping ETH to USDC
   * @param amountIn Amount of ETH to swap (in wei)
   * @returns Expected amount of USDC out
   */
  async function getQuote(
    amountIn: bigint,
    tokenIn: `0x${string}`,
    tokenOut: `0x${string}`,
  ): Promise<bigint> {
    try {
      console.log('🚀 ~ MetaMaskPage ~ tokenIn:', tokenIn);
      console.log('🚀 ~ MetaMaskPage ~ tokenOut:', tokenOut);
      // First get the pool address from the factory
      const poolAddress = await publicClient.readContract({
        address: POOL_FACTORY_CONTRACT_ADDRESS,
        abi: parseAbi([
          'function getPool(address,address,uint24) external view returns (address)',
        ]),
        functionName: 'getPool',
        args: [tokenIn, tokenOut, 3000],
      });
      console.log('🚀 ~ MetaMaskPage ~ poolAddress:', poolAddress);

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
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            fee: 3000,
            recipient: userAccount as `0x${string}`,
            deadline: Math.floor(new Date().getTime() / 1000 + 60 * 10),
            amountIn: amountIn,
            sqrtPriceLimitX96: 0n,
          },
        ],
      });
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
  async function createSwapCalldata(
    amountIn: bigint,
    slippagePercentage: number = 0.5,
    tokenIn: `0x${string}`,
    tokenOut: `0x${string}`,
  ): Promise<Hex> {
    // Get expected amount out
    const expectedAmountOut = await getQuote(amountIn, tokenIn, tokenOut);

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
          tokenIn: tokenIn,
          tokenOut: tokenOut,
          fee: 3000, // 0.3% fee tier
          recipient: userAccount as `0x${string}`,
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
      const amountIn = parseEther(swapAmount);

      // Get expected amount out for logging
      const expectedAmountOut = await getQuote(
        amountIn,
        WETH_ADDRESS,
        USDC_ADDRESS,
      );
      console.log(
        `Expected to receive approximately ${formatUnits(
          expectedAmountOut,
          6,
        )} USDC for ${amountIn} WETH`,
      );

      // Create the swap calldata
      const swapCalldata = await createSwapCalldata(
        amountIn,
        0.5,
        WETH_ADDRESS,
        USDC_ADDRESS,
      );

      // Send the transaction
      const res = await client?.sendCalls({
        account: userAccount as `0x${string}`,
        chain: sepolia,
        version: '2.0.0',
        forceAtomic: true,
        calls: [
          {
            to: UNISWAP_SEPOLIA_V3_ROUTER,
            data: swapCalldata,
            value: amountIn,
          },
        ],
      });
      console.log('🟠 Swapping WETH to USDC....');

      console.log('SendCalls Res', res);
      setProcessingTxn(true);

      if (!res) {
        setProcessingTxn(false);
        return;
      }

      const int = setInterval(async () => {
        const status = (await mmProvider?.provider.request({
          method: 'wallet_getCallsStatus',
          params: [res.id],
        })) as any;
        if (status.status == 200) {
          const chainListData = await fetch('https://chainlist.org/rpcs.json');
          const chainListJson: any[] = await chainListData.json();
          const chainInfo = chainListJson.find(
            (c: any) => c.chainId == chainId,
          );
          const baseExplorerUrl = chainInfo['explorers'][0]['url'];
          const txnHash = status['receipts'][0]['transactionHash'];
          const explorerUrl = `${baseExplorerUrl}/tx/${txnHash}`;
          setExplorerUrl(explorerUrl);

          const ethersProvider = new ethers.BrowserProvider(
            mmProvider?.provider as EIP1193Provider,
          );
          const eoaCode = await ethersProvider.getCode(userAccount);
          setIsSmartEoa(eoaCode != '0x');
          clearInterval(int);
          setProcessingTxn(false);
        }
      }, 1000);
    } catch (error) {
      console.error('Error swapping WETH to USDC:', error);
      alert(
        `Error swapping WETH to USDC: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  const swapUSDCToDAI = async () => {
    try {
      const amountIn = parseEther(swapAmount);

      // Get expected amount out for logging
      const expectedAmountOut = await getQuote(
        amountIn,
        USDC_ADDRESS,
        DAI_ADDRESS,
      );

      console.log(
        `Expected to receive approximately ${formatUnits(
          expectedAmountOut,
          6,
        )} DAI for ${amountIn} USDC`,
      );

      // Create the swap calldata
      const swapCalldata = await createSwapCalldata(
        amountIn,
        0.5,
        USDC_ADDRESS,
        DAI_ADDRESS,
      );

      // Send the transaction
      const res = await client?.sendCalls({
        account: userAccount as `0x${string}`,
        chain: sepolia,
        version: '2.0.0',
        forceAtomic: true,
        calls: [
          {
            to: USDC_ADDRESS,
            abi: erc20Abi,
            functionName: 'approve',
            args: [UNISWAP_SEPOLIA_V3_ROUTER, amountIn],
          },
          {
            to: UNISWAP_SEPOLIA_V3_ROUTER,
            data: swapCalldata,
            value: amountIn,
          },
        ],
      });

      console.log('🟠 Swapping USDC to DAI....');

      console.log('SendCalls Res', res);
      setProcessingTxn(true);

      if (!res) {
        setProcessingTxn(false);
        return;
      }

      const int = setInterval(async () => {
        const status = (await mmProvider?.provider.request({
          method: 'wallet_getCallsStatus',
          params: [res.id],
        })) as any;
        if (status.status == 200) {
          const chainListData = await fetch('https://chainlist.org/rpcs.json');
          const chainListJson: any[] = await chainListData.json();
          const chainInfo = chainListJson.find(
            (c: any) => c.chainId == chainId,
          );
          const baseExplorerUrl = chainInfo['explorers'][0]['url'];
          const txnHash = status['receipts'][0]['transactionHash'];
          const explorerUrl = `${baseExplorerUrl}/tx/${txnHash}`;
          setExplorerUrl(explorerUrl);

          const ethersProvider = new ethers.BrowserProvider(
            mmProvider?.provider as EIP1193Provider,
          );
          const eoaCode = await ethersProvider.getCode(userAccount);
          setIsSmartEoa(eoaCode != '0x');
          clearInterval(int);
          setProcessingTxn(false);
        }
      }, 1000);
    } catch (error) {
      console.error('Error swapping USDT to USDC:', error);
      alert(
        `Error swapping USDT to USDC: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  };

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>MetaMask Integration</h1>
        <h2 style={{ color: 'red' }}>
          NOTE: If account is new. You need to send a single transaction first
          to deploy the smart account. After that you can send the batch.
        </h2>

        {!userAccount ? (
          <button onClick={() => handleConnect(mmProvider!)}>
            Connect MetaMask
          </button>
        ) : (
          <div>
            <h2>Connected Account</h2>
            <p>Address: {userAccount}</p>
            <p>Chain ID: {chainId}</p>
            <p>Chain Name: {chainName}</p>
            <p>Balance: {balance} sepoliaETH</p>
            <p>Status: {connectStatus}</p>

            <>---------------------------------------------</>

            <p>Capabilities: {capabilities.join(', ')}</p>
            <p>Support Atomic: {supportAtomic ? 'Yes' : 'No'}</p>
            <p>Is Smart EOA: {isSmartEoa ? 'Yes' : 'No'}</p>
            <p>Processing Txn: {processingTxn ? 'Yes' : 'No'}</p>

            <br />
            <h2>Batch Transactions</h2>
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
              </div>
              <button onClick={addBatchItem}>Add another transaction</button>
            </div>
            {batch.map((tx, index) => (
              <div key={index}>
                <p>To: {tx.to}</p>
                <p>Value: {tx.value} sepoliaETH</p>
              </div>
            ))}
            <br />
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <button onClick={handleSendCalls}>Send Atomic Batch</button>
            </div>

            <br />
            <h2>Swap WETH to USDC</h2>
            <div style={{ display: 'flex', flexDirection: 'row', gap: '10px' }}>
              <input
                type="text"
                placeholder="Amount"
                value={swapAmount}
                onChange={(e) => setSwapAmount(e.target.value)}
              />
              <button onClick={swapWETHToUSDC}>Swap WETH to USDC</button>
            </div>

            <br />
            <h2>Swap USDC to DAI</h2>
            <div style={{ display: 'flex', flexDirection: 'row', gap: '10px' }}>
              <input
                type="text"
                placeholder="Amount"
                value={swapAmount}
                onChange={(e) => setSwapAmount(e.target.value)}
              />
              <button onClick={swapUSDCToDAI}>Swap USDC to DAI</button>
            </div>
          </div>
        )}
        {processingTxn && (
          <div>
            <p>Processing Tx... Please wait.</p>
          </div>
        )}
        {explorerUrl && (
          <div>
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
              Explorer URL: {explorerUrl}
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
