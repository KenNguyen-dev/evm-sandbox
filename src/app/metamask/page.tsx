'use client';

import { useState, useEffect } from 'react';
import styles from '../page.module.css';
import { formatEther, parseEther } from 'ethers';
import { createWalletClient, custom, WalletClient } from 'viem';
import { sepolia } from 'viem/chains';

// Supported networks for atomic batch transactions according to MetaMask docs
const supportedAtomicNetworks = {
  '0x1': 'Ethereum Mainnet',
  '0xaa36a7': 'Ethereum Sepolia',
  '0x64': 'Gnosis Mainnet',
  '0x27d8': 'Gnosis Chiado',
  '0x38': 'BNB Smart Chain',
};

const getNetworkName = (chainId) => {
  const networks = {
    '0x1': 'Ethereum Mainnet',
    '0x3': 'Ropsten Testnet',
    '0x4': 'Rinkeby Testnet',
    '0x5': 'Goerli Testnet',
    '0xaa36a7': 'Ethereum Sepolia',
    '0x38': 'BNB Smart Chain',
    '0x89': 'Polygon',
    '0xa86a': 'Avalanche',
    '0x64': 'Gnosis Mainnet',
    '0x27d8': 'Gnosis Chiado',
  };
  return networks[chainId] || `Chain ID: ${chainId}`;
};

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

export default function MetaMaskPage() {
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [status, setStatus] = useState('');
  const [currentNetwork, setCurrentNetwork] = useState('');
  const [currentChainId, setCurrentChainId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [atomicCapabilities, setAtomicCapabilities] = useState({});
  const [balance, setBalance] = useState('');
  const [toAddress, setToAddress] = useState<string>('');
  const [value, setValue] = useState<string>('');
  const [batch, setBatch] = useState<any[]>([]);

  useEffect(() => {
    // Check if MetaMask is installed
    if (typeof window.ethereum! === 'undefined') {
      setStatus(
        'MetaMask is not installed. Please install MetaMask to use this app.',
      );
      return;
    }

    const initializeWallet = async () => {
      try {
        const walletClient = createWalletClient({
          chain: sepolia,
          transport: custom(window.ethereum!),
        });

        setWalletClient(walletClient);

        // Check if already connected
        const accounts = await window.ethereum!.request({
          method: 'eth_accounts',
        });

        if (accounts.length > 0) {
          const [address] = await walletClient.getAddresses();
          setAddress(address);
          setIsConnected(true);
          setStatus(`Connected to ${address}`);

          // Get initial chain ID and network
          const chainId = await window.ethereum!.request({
            method: 'eth_chainId',
          });
          setCurrentChainId(chainId);
          setCurrentNetwork(getNetworkName(chainId));

          // Get initial balance
          const balance = await window.ethereum!.request({
            method: 'eth_getBalance',
            params: [address, 'latest'],
          });
          setBalance(formatEther(balance));
        }
      } catch (error) {
        console.error('Error initializing wallet:', error);
        setStatus(
          `Error: ${
            error instanceof Error
              ? error.message
              : 'Failed to initialize wallet'
          }`,
        );
      }
    };

    initializeWallet();

    // Listen for account changes
    window.ethereum!.on('accountsChanged', handleAccountsChanged);

    // Listen for network changes
    window.ethereum!.on('chainChanged', (chainId) => {
      setCurrentChainId(chainId);
      setCurrentNetwork(getNetworkName(chainId));
      // Check capabilities when network changes
      if (address) {
        checkAtomicCapabilities();
      }
    });

    return () => {
      // Clean up event listeners
      if (window.ethereum!) {
        window.ethereum!.removeListener(
          'accountsChanged',
          handleAccountsChanged,
        );
        window.ethereum!.removeListener('chainChanged', () => {});
      }
    };
  }, []);

  useEffect(() => {
    // Check capabilities when account changes
    if (address && currentChainId) {
      checkAtomicCapabilities();
    }
  }, [address, currentChainId]);

  useEffect(() => {
    const getBalance = async () => {
      if (address && currentChainId) {
        const balance = await window.ethereum!.request({
          method: 'eth_getBalance',
          params: [address, 'latest'],
        });
        // Convert balance from hex to decimal
        const balanceInDecimal = formatEther(balance);
        setBalance(balanceInDecimal);
      }
    };
    getBalance();
  }, [address, currentChainId]);

  const isAtomicSupportedNetwork = (chainId) => {
    return supportedAtomicNetworks.hasOwnProperty(chainId);
  };

  const handleAccountsChanged = (address) => {
    if (address.length === 0) {
      // MetaMask is disconnected
      setIsConnected(false);
      setStatus('Disconnected from MetaMask');
    } else {
      // MetaMask is connected with a different account
      setAddress(address);
      setStatus(`Connected to ${address}`);
    }
  };

  const connectWallet = async () => {
    try {
      setStatus('Connecting to MetaMask...');
      await window.ethereum!.request({
        method: 'eth_requestAccounts',
      });

      const walletClient = createWalletClient({
        chain: sepolia,
        transport: custom(window.ethereum!),
      });

      const [address] = await walletClient.getAddresses();
      setAddress(address);
      setWalletClient(walletClient);
      setIsConnected(true);
      setStatus(`Connected to ${address}`);

      // Get initial chain ID and network
      const chainId = await window.ethereum!.request({ method: 'eth_chainId' });
      setCurrentChainId(chainId);
      setCurrentNetwork(getNetworkName(chainId));

      // Get initial balance
      const balance = await window.ethereum!.request({
        method: 'eth_getBalance',
        params: [address, 'latest'],
      });
      setBalance(formatEther(balance));
    } catch (error) {
      console.error('Error connecting to MetaMask:', error);
      setStatus(
        `Error: ${
          error instanceof Error ? error.message : 'Failed to connect'
        }`,
      );
    }
  };

  const checkAtomicCapabilities = async () => {
    if (!address) {
      setStatus('Please connect to MetaMask first');
      return;
    }

    if (!walletClient) {
      setStatus('Please connect to MetaMask first');
      return;
    }
    console.log(
      '🚀 ~ checkAtomicCapabilities ~ currentChainId:',
      currentChainId,
    );

    try {
      setStatus('Checking atomic capabilities...');

      // Get the networks to check (either current chain or all supported atomic networks)
      const capabilities = await window.ethereum!.request({
        method: 'wallet_getCapabilities',
        params: [address as `0x${string}`, [currentChainId]],
      });

      setAtomicCapabilities(capabilities);
      console.log('Atomic capabilities:', capabilities);

      // Format the capabilities for display
      let statusMessage = 'Atomic capabilities retrieved:\n';
      for (const [networkId, capability] of Object.entries(capabilities)) {
        statusMessage += `\n${getNetworkName(networkId)}: `;
        if (capability.atomic) {
          statusMessage += `atomic ${capability.atomic.status}`;
        } else {
          statusMessage += 'atomic not supported';
        }
      }

      setStatus(statusMessage);
      return capabilities;
    } catch (error) {
      console.error('Error checking atomic capabilities:', error);

      // Handle unsupported method error gracefully
      if (
        error.code === 4200 ||
        (error.message && error.message.includes('Unsupported Method'))
      ) {
        setStatus(
          'Your MetaMask version does not support atomic capabilities (wallet_getCapabilities method).',
        );
      } else {
        setStatus(`Error checking atomic capabilities: ${error.message}`);
      }
      return null;
    }
  };

  const isValidAddress = (address) => {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  };

  const validateTransaction = (tx) => {
    if (!isValidAddress(tx.to)) {
      setStatus(
        'Error: Invalid recipient address. Must be a valid Ethereum address (0x followed by 40 hex characters)',
      );
      return false;
    }
    return true;
  };

  const execute = async (
    calls: {
      to: `0x${string}`;
      value: bigint;
      data?: undefined;
      abi: readonly unknown[];
      functionName: string;
      args?: readonly unknown[] | undefined;
    }[],
    account: `0x${string}`,
  ) => {
    const result = await walletClient!.sendCalls({
      account,
      calls,
      chain: sepolia,
      version: '2.0.0',
      forceAtomic: true,
    });

    return result;
  };

  const sendAtomicBatch = async () => {
    if (!isConnected) {
      setStatus('Please connect to MetaMask first');
      return;
    }

    // Check if current network supports atomic transactions
    if (!isAtomicSupportedNetwork(currentChainId)) {
      setStatus(
        `Current network ${currentNetwork} (${currentChainId}) does not support atomic transactions. Supported networks: ${Object.values(
          supportedAtomicNetworks,
        ).join(', ')}`,
      );
      return;
    }

    // Validate each transaction
    for (let i = 0; i < batch.length; i++) {
      if (!validateTransaction(batch[i])) {
        setStatus(`Error in transaction #${i + 1}: Invalid recipient address`);
        return;
      }
    }

    if (!walletClient) {
      setStatus('Please connect to MetaMask first');
      return;
    }

    try {
      setStatus('Sending atomic batch transaction...');

      // Create the calls array with proper format
      const calls = batch.map((tx) => ({
        to: tx.to,
        value: tx.value,
      })) as any[];

      const result = await execute(calls, address as `0x${string}`);

      console.log('Atomic batch result:', result);

      if (result && result.id) {
        setBatchId(result.id);
        setStatus(`Atomic batch transaction sent! Batch ID: ${result.id}`);
      } else {
        setStatus('Atomic batch transaction sent but no batch ID was returned');
      }
    } catch (error) {
      console.error('Error sending atomic batch transaction:', error);

      // Handle unsupported method error gracefully
      if (
        error.code === 4200 ||
        (error.message && error.message.includes('Unsupported Method'))
      ) {
        setStatus(
          'Your MetaMask version does not support atomic batch transactions (wallet_sendCalls method).',
        );
      } else if (
        error.message &&
        error.message.includes('Account upgrade required')
      ) {
        setStatus(
          'Your MetaMask account needs to be upgraded to a delegator account. Please follow the MetaMask prompts to continue.',
        );
      } else {
        setStatus(`Error sending atomic batch: ${error.message}`);
      }
    }
  };

  const checkBatchStatus = async () => {
    if (!batchId) {
      setStatus(
        'No batch ID available. Send an atomic batch transaction first.',
      );
      return;
    }

    try {
      setStatus(`Checking status of batch ${batchId}...`);

      const status = await window.ethereum!.request({
        method: 'wallet_getCallsStatus',
        params: [batchId],
      });

      console.log('Batch status:', status);

      // Format the status for display
      if (status) {
        const statusCode = status.status || 'unknown';
        const isAtomic = status.atomic || false;
        const receiptCount = status.receipts ? status.receipts.length : 0;

        let statusText = `Batch ID: ${status.id || batchId}\n`;
        statusText += `Status Code: ${statusCode}\n`;
        statusText += `Executed Atomically: ${isAtomic}\n`;
        statusText += `Receipts: ${receiptCount}\n`;

        if (statusCode === 200) {
          statusText += 'Transaction batch confirmed!';
        } else if (statusCode === 202) {
          statusText += 'Transaction batch pending...';
        } else {
          statusText += `Transaction batch status: ${statusCode}`;
        }

        setStatus(statusText);
      } else {
        setStatus('No status information returned for this batch ID');
      }
    } catch (error) {
      console.error('Error checking batch status:', error);

      // Handle unsupported method error gracefully
      if (
        error.code === 4200 ||
        (error.message && error.message.includes('Unsupported Method'))
      ) {
        setStatus(
          'Your MetaMask version does not support batch status checking (wallet_getCallsStatus method).',
        );
      } else {
        setStatus(`Error checking batch status: ${error.message}`);
      }
    }
  };

  const addBatchItem = () => {
    setBatch([
      ...batch,
      {
        to: toAddress,
        value: parseEther(value),
        data: '0x00',
      },
    ]);
    setToAddress('');
    setValue('');
  };

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>MetaMask Integration</h1>
        <h2 style={{ color: 'red' }}>
          NOTE: If account is new. You need to send a single transaction first
          to deploy the smart account. After that you can send the batch.
        </h2>

        {!address ? (
          <button onClick={connectWallet}>Connect MetaMask</button>
        ) : (
          <div>
            <h2>Connected Account</h2>
            <p>Address: {address}</p>
            <p>Chain ID: {currentChainId}</p>
            <p>Balance: {balance} sepoliaETH</p>

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
                <p>Value: {formatEther(tx.value)} sepoliaETH</p>
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
              <button onClick={sendAtomicBatch}>Send Atomic Batch</button>
              <button onClick={checkBatchStatus}>Check Batch Status</button>
            </div>

            <p
              style={{
                fontWeight: 'bold',
                fontStyle: 'italic',
                marginTop: '30px',
              }}
            >
              Status: {status}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
