import { createPublicClient, createWalletClient, formatUnits, http, parseEther, type Chain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { BalanceInfo, NetworkInfo } from '@shared/types'
import { requireEvmKey } from '../vault/keystore'

function toViemChain(network: NetworkInfo): Chain {
  return {
    id: network.chainId ?? 0,
    name: network.label,
    nativeCurrency: { name: network.nativeSymbol, symbol: network.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: [network.rpcUrl] } }
  }
}

function publicClientFor(network: NetworkInfo) {
  return createPublicClient({ chain: toViemChain(network), transport: http(network.rpcUrl) })
}

export async function getBalance(network: NetworkInfo, address: string): Promise<BalanceInfo> {
  const base: Omit<BalanceInfo, 'raw' | 'formatted' | 'error'> = {
    networkId: network.id,
    address,
    symbol: network.nativeSymbol,
    decimals: network.decimals,
    fetchedAt: Date.now()
  }
  try {
    const raw = await publicClientFor(network).getBalance({ address: address as `0x${string}` })
    return {
      ...base,
      raw: raw.toString(),
      formatted: Number(formatUnits(raw, network.decimals)).toFixed(6)
    }
  } catch (err) {
    // A dead public RPC is common and must not take the dashboard down.
    return {
      ...base,
      raw: '0',
      formatted: '0.000000',
      error: err instanceof Error ? err.message : 'RPC unreachable'
    }
  }
}

export interface EvmSendResult {
  txHash: string
  explorerUrl: string
}

/**
 * Signs and broadcasts a native transfer. The private key is fetched from the
 * keystore for the duration of this call and is never returned or stored.
 */
export async function sendNative(
  network: NetworkInfo,
  to: string,
  amountEth: string
): Promise<EvmSendResult> {
  const key = requireEvmKey()
  const account = privateKeyToAccount(key.privateKeyHex)
  const chain = toViemChain(network)
  const wallet = createWalletClient({ account, chain, transport: http(network.rpcUrl) })

  const txHash = await wallet.sendTransaction({
    to: to as `0x${string}`,
    value: parseEther(amountEth),
    chain
  })
  return { txHash, explorerUrl: `${network.explorerTxUrl}${txHash}` }
}

/**
 * Dry-run against the node: catches insufficient funds, bad addresses and
 * reverts without spending anything. Used for every action in simulate mode.
 */
export async function simulateNative(
  network: NetworkInfo,
  from: string,
  to: string,
  amountEth: string
): Promise<{ ok: boolean; detail: string; gasEstimate: string | null }> {
  try {
    const client = publicClientFor(network)
    const value = parseEther(amountEth)
    const [balance, gas] = await Promise.all([
      client.getBalance({ address: from as `0x${string}` }),
      client.estimateGas({
        account: from as `0x${string}`,
        to: to as `0x${string}`,
        value
      })
    ])
    if (balance < value) {
      return {
        ok: false,
        detail: `Insufficient balance: holds ${formatUnits(balance, 18)} ${network.nativeSymbol}, needs ${amountEth}.`,
        gasEstimate: gas.toString()
      }
    }
    return {
      ok: true,
      detail: `Simulated on ${network.label}. Estimated gas ${gas.toString()} units.`,
      gasEstimate: gas.toString()
    }
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : 'Simulation failed',
      gasEstimate: null
    }
  }
}

export function isValidAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address.trim())
}
