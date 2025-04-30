"use client";

import styles from "./page.module.css";
import { PredictedSafeProps } from "@safe-global/protocol-kit";
import { ethers } from "ethers";
import { useState } from "react";
import { toSimpleSmartAccount, ToSimpleSmartAccountReturnType } from 'permissionless/accounts'
import {
  createPimlicoClient,
} from 'permissionless/clients/pimlico'
import { createPublicClient, http, Account } from 'viem'
import { baseSepolia } from 'viem/chains'
import { createSmartAccountClient, SmartAccountClient } from "permissionless";
import {  entryPoint07Address } from "viem/account-abstraction";
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from "viem/accounts"

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

const pimlicoBundlerUrl = "https://api.pimlico.io/v2/84532/rpc?apikey=pim_GeuxsytM4ZFK28cuZsiAb4" // create an account on dashboard.pimlico.io and get your own key

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(),
})

//https://docs.pimlico.io/references/permissionless/reference/clients/pimlicoClient#pimlico-client
const pimlicoClient = createPimlicoClient({ 
  transport: http(pimlicoBundlerUrl),
  entryPoint: {
    address: entryPoint07Address,
    version: "0.7",
  }
})

declare global {
  interface Window {
    ethereum?: ethers.Eip1193Provider;
    predictedSafe?: PredictedSafeProps;
  }
}

export interface TransactionData {
  to: string;
  value: string;
  data: string;
}

export default function Home() {
  const [account, setAccount] = useState<Account | null>(null);
  const [privateKey, setPrivateKey] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [simpleSmartAccount, setSimpleSmartAccount] = useState<ToSimpleSmartAccountReturnType>();
  const [smartAccountClient, setSmartAccountClient] = useState<SmartAccountClient>();
  const [smartAccountBalance, setSmartAccountBalance] = useState<string | null>("----");

  const [transactions, setTransactions] = useState<TransactionData[]>([]);
  const [toAddress, setToAddress] = useState<string>("");
  const [value, setValue] = useState<string>("");
  const [data, setData] = useState<string>("0x");

  const generateWallet = async () => {
    // replace with your own private key if you want to use your own
    const privateKey = generatePrivateKey();
    setPrivateKey(privateKey)
    setAddress(privateKeyToAddress(privateKey))

    const account = privateKeyToAccount(privateKey)
    setAccount(account)

    const simpleSmartAccount = await toSimpleSmartAccount({
      client: publicClient,
      owner: account,
      entryPoint: {
            address: entryPoint07Address,
            version: "0.7"
      },
    })
    setSimpleSmartAccount(simpleSmartAccount)

    const smartAccountClient = createSmartAccountClient({
      account: simpleSmartAccount,
      chain: baseSepolia,
      bundlerTransport: http(pimlicoBundlerUrl),
      userOperation: {
          estimateFeesPerGas: async () => {
              return (await pimlicoClient.getUserOperationGasPrice()).fast 
          },
      }
    })
    setSmartAccountClient(smartAccountClient)
  }

  const getSmartAccountBalance = async () => {
    const balance = await publicClient.getBalance({ address: simpleSmartAccount!.address })
    setSmartAccountBalance(ethers.formatEther(balance))
  }

  const addTransaction = async () => {
    if (!toAddress) {
      alert("Please enter a recipient address");
      return;
    }
    
    const newTransaction: TransactionData = {
      to: toAddress,
      value: value ? ethers.parseEther(value).toString() : "0",
      data: data || "0x",
    };
    
    setTransactions([...transactions, newTransaction]);
    setToAddress("");
    setValue("");
    setData("0x");
    
    console.log(`Added transaction to: ${toAddress}, value: ${value}, data: ${data}`);
  }

  const sendTransaction = async () => {
    try {
      if (!simpleSmartAccount || !smartAccountClient) {
        throw new Error("Smart account or smart account client not found");
      }

      if (transactions.length === 0) {
        throw new Error("No transactions to send");
      }

      // Check balance first
      const balance = await publicClient.getBalance({ address: simpleSmartAccount.address });
      console.log("Smart account address:", simpleSmartAccount.address);
      console.log("Account balance:", ethers.formatEther(balance));

      if (balance === BigInt(0)) {
        alert(`Please send some ETH to your smart account: ${simpleSmartAccount.address}`);
        return;
      }
      
      const calls = transactions.map((tx) => {
        console.log(`Sending transaction to: ${tx.to}, value: ${tx.value}`);

        return {
          to: tx.to,
          value: BigInt(tx.value),
        }
      });

      const gasPrice = await smartAccountClient.estimateUserOperationGas({
        account: simpleSmartAccount,
        calls
      })

      console.log("Gas price:", gasPrice);

      // Convert to the right format
      const txHash = await smartAccountClient.sendTransaction({
        calls
      });

      console.log("Transaction hash:", txHash);
      alert(`Transaction sent! Hash: ${txHash}`);
      
      // Clear transactions after sending
      setTransactions([]);
      
      // Update balance
      getSmartAccountBalance();
    } catch (error) {
      console.error("Error sending transactions:", error);
      alert(`Error sending transactions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        {account && address && simpleSmartAccount ? (
          <>
            <p>Private Key: {privateKey}</p>
            <p>Wallet Address: {address}</p>
            <p>Smart Account Address: {simpleSmartAccount?.address} <span>{`<--- Send ETH to this address `}</span></p>
            <p>Smart Account Balance: {smartAccountBalance} <button onClick={() => getSmartAccountBalance()}>Refresh balance</button></p>

            <h2>Transaction Builder</h2>
            <div style={{ display: 'flex', flexDirection: 'row', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'row', gap: '10px' }}>
                <input type="text" placeholder="To" value={toAddress} onChange={(e) => setToAddress(e.target.value)} />
                <input type="text" placeholder="Value" value={value} onChange={(e) => setValue(e.target.value)} />
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

            <button onClick={sendTransaction}>Send Transaction</button>
          </>
        ):
          <>
            <h2>EVM Smart Account Demo</h2>
            <button onClick={() => {
              generateWallet()
            }}>Generate Wallet</button>
          </>
        }
      </main>
    </div>
  );
}

//Private Key: 0xcbaf1f4b2282dd0ded3889d121596dd2c903ca1175e32c97a49378988be51e37
